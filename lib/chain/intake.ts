import {
  MAX_AMOUNT,
  MAX_ID_LENGTH,
  MAX_ROOT_DEPTH,
  commitId,
  grantId,
  principalId,
} from "../contracts/index.js";
import type {
  Charter,
  EventInput,
  Grant,
  LogEvent,
  NonEmptyReadonlyArray,
  Rejection,
} from "../contracts/index.js";

/**
 * Intake: turn UNTRUSTED input (a charter, or one event as it arrived) into plain data the rest of the
 * engine may trust, or into a typed refusal. Plan §5, §6 (M3).
 *
 * THE RULE THAT SHAPES EVERY FUNCTION HERE: each property of the input is read EXACTLY ONCE, in a fixed order,
 * through `read()`, and only the local that holds that one read is looked at afterwards. A getter or a Proxy
 * can answer differently the second time it is asked ("valid" while being checked, "huge" while being
 * copied); reading once makes the value that was validated the value that is kept. Nothing here spreads,
 * `Object.keys`es or `JSON.stringify`es the input, and a value that is not a string or a number is never
 * coerced to one (no `String(x)`, no template of an unvalidated value), because coercion calls code the
 * input supplies.
 *
 * TWO WAYS TO FAIL, kept apart on purpose:
 *  - `invalid`: the data was read and is the wrong shape. ALL offending fields are reported, deduplicated and
 *    sorted, so a caller fixing an event sees every problem in one round.
 *  - `hostile`: a read THREW (a throwing getter, a Proxy trap, a revoked Proxy). Once the event's `kind` is
 *    known, every field of that kind's payload is read in order even after an earlier field was found invalid,
 *    so `hostile` outranks `invalid` for every field intake reads. (An unknown `kind`, or a payload that is not
 *    an object, leaves no fields to read; the others are not touched.) The message names the field
 *    (`reading grant.limit threw`) and never includes the thrown value, which is itself untrusted.
 * Only a `HostileRead` made by this file is caught. Any other exception is a bug in this file and propagates.
 *
 * WHAT THIS FILE DOES NOT DO: it does not compare an event with a grant tree (that is `structure.ts`), with
 * the log's length or `seq` sequence, or with the headroom (those are M4/M5's), and it never reads a `revoke`'s
 * `by` for authority: `by` is checked to be a well-formed id and nothing more.
 */

/**
 * The most entries intake will read from one list: a charter's `roots`, a charter's `capabilities`, and an
 * event's `capabilities`. INVENTED, not derived, and not in the plan: the four bounds in
 * `lib/contracts/limits.ts` are M1's and are not edited here, so this one lives in this layer. It exists because a
 * list's `length` is itself input. A Proxy can claim `2 ** 32 - 1` elements and answer every index, and an
 * unbounded loop over that, measured in ADR 0003 (sabotage row X16), ran for between about 16 s and 23 s and then threw
 * `RangeError: Invalid array length` from `push`: an exception out of intake instead of a typed refusal. For a charter that went through
 * `readCharter`, an event's capability list longer than this cannot be a duplicate-free subset of its
 * vocabulary (the vocabulary is itself capped here), so refusing the list unread loses no valid event.
 * `__tests__/boundaries.test.ts` pins N and N + 1 for all three uses.
 */
export const MAX_CHARTER_ENTRIES = 1000;

export type CharterRead<C extends string> =
  | { readonly ok: true; readonly charter: Charter<C> }
  | { readonly ok: false; readonly fields: NonEmptyReadonlyArray<string> };

export type IntakeRejection = Extract<Rejection, { kind: "invalid-event-shape" | "unknown-capability" }>;
export type IntakeFailure =
  | { readonly kind: "invalid"; readonly rejection: IntakeRejection }
  | { readonly kind: "hostile"; readonly message: string };
export type IntakeResult<E> =
  | { readonly ok: true; readonly event: E }
  | { readonly ok: false; readonly failure: IntakeFailure };

/** Thrown by `read` and `isArray` when the input's own code throws, and caught by the entry points below. */
class HostileRead extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`reading ${path} threw`);
    this.path = path;
  }
}

function read(owner: object, key: string, path: string): unknown {
  try {
    return (owner as Record<string, unknown>)[key];
  } catch {
    throw new HostileRead(path);
  }
}

/** `Array.isArray` looks through a Proxy, and THROWS on a revoked one, so it needs the same guard as a read. */
function isArray(value: unknown, path: string): value is readonly unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    throw new HostileRead(path);
  }
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** An id: a string of 1 to `MAX_ID_LENGTH` UTF-16 code units. Ids are opaque, so that is the whole rule. */
function isId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_ID_LENGTH;
}

function asNonEmpty<T>(items: readonly T[]): NonEmptyReadonlyArray<T> {
  const [head, ...tail] = items;
  if (head === undefined) throw new Error("internal error: an empty list reached asNonEmpty");
  return [head, ...tail];
}

// ---------------------------------------------------------------------------------------------------
// Field readers. Each reads ONE property once. When the value is not acceptable it records the field name
// in `bad` and returns a placeholder ("", 0, null, []). A placeholder never escapes: every caller ends in
// `if (bad.size > 0) return invalid(...)` before it builds anything from what was read.
// ---------------------------------------------------------------------------------------------------

function readId(owner: object, key: string, path: string, bad: Set<string>): string {
  const value = read(owner, key, path);
  if (isId(value)) return value;
  bad.add(key);
  return "";
}

/** `null` marks a root grant; `undefined` (an absent field) is NOT null, so it is invalid rather than a root. */
function readParent(owner: object, path: string, bad: Set<string>): string | null {
  const value = read(owner, "parent", path);
  if (value === null || isId(value)) return value;
  bad.add("parent");
  return null;
}

/**
 * A whole number in `[0, max]`. `-0` is accepted and returned as `0`, so a result never carries a negative
 * zero (`Object.is(-0, 0)` is false, and a later `Map` key, `JSON` round trip or `Object.is` comparison
 * would tell the two apart). `NaN`, `Infinity`, a fraction and anything past `Number.MAX_SAFE_INTEGER` fail
 * `Number.isSafeInteger`.
 */
function readWholeNumber(owner: object, key: string, path: string, max: number, bad: Set<string>): number {
  const value = read(owner, key, path);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max) {
    return value === 0 ? 0 : value;
  }
  bad.add(key);
  return 0;
}

/**
 * The elements of the array at `owner[key]`: `length` read once, then each index read once, into a local
 * array. Returns `undefined` for "not an array" or "a length outside `[1, MAX_CHARTER_ENTRIES]`" (the caller
 * records the field). The elements are NOT yet checked: a string is immutable and an object is never
 * touched again, so holding the single read is enough.
 */
function readItems(owner: object, key: string, path: string): readonly unknown[] | undefined {
  const list = read(owner, key, path);
  if (!isArray(list, path)) return undefined;
  const length = read(list, "length", `${path}.length`);
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1 || length > MAX_CHARTER_ENTRIES) {
    return undefined;
  }
  const items: unknown[] = [];
  for (let index = 0; index < length; index++) {
    items.push(read(list, String(index), `${path}[${index}]`));
  }
  return items;
}

/**
 * An event's `capabilities`: a non-empty list of strings with no repeats. Whether each is in the charter's
 * vocabulary is a LATER question (`unknown-capability`), asked only when no field is malformed, so that a
 * shape problem anywhere outranks an unknown name (plan §4.3, admission precedence).
 */
function readCapabilityList(owner: object, path: string, bad: Set<string>): readonly string[] {
  const items = readItems(owner, "capabilities", path);
  if (items === undefined) {
    bad.add("capabilities");
    return [];
  }
  const names: string[] = [];
  const seen = new Set<string>();
  let wellFormed = true;
  for (const item of items) {
    if (typeof item !== "string" || seen.has(item)) {
      wellFormed = false;
      continue;
    }
    seen.add(item);
    names.push(item);
  }
  if (!wellFormed) bad.add("capabilities");
  return names;
}

function sortedFields(bad: ReadonlySet<string>): NonEmptyReadonlyArray<string> {
  return asNonEmpty([...bad].sort());
}

// ---------------------------------------------------------------------------------------------------
// readCharter
// ---------------------------------------------------------------------------------------------------

/**
 * Copy a charter into a fresh, frozen one, reading `roots` and `capabilities` once each (and each list's
 * `length` and each element once). The copy is what an engine should hold: later changes to the original,
 * or a getter that answers differently, cannot reach it.
 *
 * Valid means: each of `roots` and `capabilities` is an array of 1 to `MAX_CHARTER_ENTRIES` entries, each
 * a valid id string (a capability NAME follows the same rule as an id: non-empty, at most `MAX_ID_LENGTH`).
 * Repeats are NOT refused: a repeated root or a repeated vocabulary entry changes nothing, and the plan
 * asks for no such rule; the copy keeps them as given. Failure reports which of `roots` / `capabilities`
 * are bad, sorted; a throwing getter, a throwing Proxy trap or a revoked Proxy marks the field it was
 * reading, and a charter that is not an object marks both. There is no `hostile` variant here (the plan's
 * `CharterRead` has none): a hostile charter is an invalid charter.
 *
 * `C` is whatever the caller says it is. Intake checks the vocabulary entries are strings, not that they
 * belong to `C`: a type parameter has no run-time form.
 */
export function readCharter<C extends string>(charter: Charter<C>): CharterRead<C> {
  const input: unknown = charter;
  const bad = new Set<string>();
  let roots: readonly string[] = [];
  let capabilities: readonly string[] = [];

  if (!isObject(input)) {
    bad.add("roots");
    bad.add("capabilities");
  } else {
    roots = readNames(input, "roots", bad);
    capabilities = readNames(input, "capabilities", bad);
  }
  if (bad.size > 0) return { ok: false, fields: sortedFields(bad) };

  return {
    ok: true,
    charter: Object.freeze({
      roots: Object.freeze(asNonEmpty(roots.map((root) => principalId(root)))),
      capabilities: Object.freeze(asNonEmpty(capabilities as readonly C[])),
    }),
  };
}

/** A charter list of ids; any problem, including a throw, marks `key` and yields the placeholder `[]`. */
function readNames(owner: object, key: string, bad: Set<string>): readonly string[] {
  try {
    const items = readItems(owner, key, key);
    if (items !== undefined && items.every((item): item is string => isId(item))) return items;
  } catch (error) {
    if (!(error instanceof HostileRead)) throw error;
  }
  bad.add(key);
  return [];
}

// ---------------------------------------------------------------------------------------------------
// readEventInput / readLogEvent
// ---------------------------------------------------------------------------------------------------

type EventKind = "grant" | "revoke" | "commit" | "unknown";

type Intake<C extends string, X> =
  | { readonly ok: true; readonly event: EventInput<C>; readonly extra: X }
  | { readonly ok: false; readonly failure: IntakeFailure };

function invalid(eventKind: EventKind, bad: ReadonlySet<string>): { readonly ok: false; readonly failure: IntakeFailure } {
  return { ok: false, failure: { kind: "invalid", rejection: { kind: "invalid-event-shape", eventKind, fields: sortedFields(bad) } } };
}

function hostile(path: string): { readonly ok: false; readonly failure: IntakeFailure } {
  return { ok: false, failure: { kind: "hostile", message: `reading ${path} threw` } };
}

function unknownCapability(capability: string): { readonly ok: false; readonly failure: IntakeFailure } {
  return { ok: false, failure: { kind: "invalid", rejection: { kind: "unknown-capability", capability } } };
}

/**
 * The shared body of `readEventInput` and `readLogEvent`. `readExtra` reads whatever the envelope adds
 * (nothing for an input, `seq` for a logged event) and runs right after `kind`, so the order of reads is
 * `kind`, the extra, then the payload.
 *
 * The result is built from the locals only, so an input's extra keys (including a `seq` on something that is
 * not a logged event, or a `commit` next to a `grant`) are never copied: that is the "build the logged event from
 * explicitly read fields" that `lib/contracts/event.ts` says M5's `append` needs.
 */
function intake<C extends string, X>(
  charter: Charter<C>,
  raw: unknown,
  readExtra: (owner: object, bad: Set<string>) => X,
): Intake<C, X> {
  try {
    // Not an object: no `kind` to read, so `kind` is the one field reported.
    if (!isObject(raw)) return invalid("unknown", new Set(["kind"]));

    const bad = new Set<string>();
    const kind = read(raw, "kind", "kind");
    const eventKind: EventKind = kind === "grant" || kind === "revoke" || kind === "commit" ? kind : "unknown";
    if (eventKind === "unknown") bad.add("kind");
    const extra = readExtra(raw, bad);

    // The charter's vocabulary, read once for this call. `charter` is the caller's trusted, typed charter
    // (in practice `readCharter(...).charter`); a charter whose own getters throw is outside this contract.
    const vocabulary = new Set<string>(charter.capabilities);

    switch (eventKind) {
      case "grant": {
        const body = read(raw, "grant", "grant");
        if (!isObject(body)) {
          bad.add("grant");
          return invalid(eventKind, bad);
        }
        const id = readId(body, "id", "grant.id", bad);
        const parent = readParent(body, "grant.parent", bad);
        const grantor = readId(body, "grantor", "grant.grantor", bad);
        const grantee = readId(body, "grantee", "grant.grantee", bad);
        const capabilities = readCapabilityList(body, "grant.capabilities", bad);
        const limit = readWholeNumber(body, "limit", "grant.limit", MAX_AMOUNT, bad);
        const depth = readWholeNumber(body, "depth", "grant.depth", MAX_ROOT_DEPTH, bad);
        if (bad.size > 0) return invalid(eventKind, bad);

        const outside = capabilities.find((name) => !vocabulary.has(name));
        if (outside !== undefined) return unknownCapability(outside);

        const grant: Grant<C> = {
          id: grantId(id),
          parent: parent === null ? null : grantId(parent),
          grantor: principalId(grantor),
          grantee: principalId(grantee),
          capabilities: asNonEmpty(capabilities as readonly C[]),
          limit,
          depth,
        };
        return { ok: true, event: { kind: "grant", grant }, extra };
      }
      case "commit": {
        const body = read(raw, "commit", "commit");
        if (!isObject(body)) {
          bad.add("commit");
          return invalid(eventKind, bad);
        }
        const id = readId(body, "id", "commit.id", bad);
        const actor = readId(body, "actor", "commit.actor", bad);
        const actedUnder = readId(body, "actedUnder", "commit.actedUnder", bad);
        const capability = read(body, "capability", "commit.capability");
        if (typeof capability !== "string") bad.add("capability");
        const amount = readWholeNumber(body, "amount", "commit.amount", MAX_AMOUNT, bad);
        if (bad.size > 0 || typeof capability !== "string") return invalid(eventKind, bad);

        if (!vocabulary.has(capability)) return unknownCapability(capability);

        return {
          ok: true,
          event: {
            kind: "commit",
            commit: {
              id: commitId(id),
              actor: principalId(actor),
              actedUnder: grantId(actedUnder),
              capability: capability as C,
              amount,
            },
          },
          extra,
        };
      }
      case "revoke": {
        // `by` is a CLAIM about who is revoking. Whether that principal may is M5's `revoker-not-authorised`;
        // all that is checked here is that it is a well-formed id.
        const target = readId(raw, "grantId", "grantId", bad);
        const by = readId(raw, "by", "by", bad);
        if (bad.size > 0) return invalid(eventKind, bad);
        return { ok: true, event: { kind: "revoke", grantId: grantId(target), by: principalId(by) }, extra };
      }
      case "unknown":
        return invalid(eventKind, bad);
    }
  } catch (error) {
    if (error instanceof HostileRead) return hostile(error.path);
    throw error;
  }
}

/**
 * Read one event offered for appending. Returns a fresh event built from the fields it read, never the
 * caller's object, and never a key it did not name.
 *
 * Refusals, in this order (plan §4.3): every malformed field at once as `invalid-event-shape` (`kind` not
 * one of the three, a payload that is not an object, an id that is not a string of 1 to `MAX_ID_LENGTH`,
 * `parent` neither `null` nor an id, `limit` or `amount` not a whole number in `[0, MAX_AMOUNT]`, `depth` not
 * a whole number in `[0, MAX_ROOT_DEPTH]`, `capabilities` not an array of 1 to `MAX_CHARTER_ENTRIES`
 * distinct strings, a commit's `capability` not a string); then the first capability in the event's own order
 * that is outside `charter.capabilities` as `unknown-capability`. Field names are the payload's own
 * (`limit`, not `grant.limit`); `eventKind` says which payload they belong to.
 */
export function readEventInput<C extends string>(charter: Charter<C>, raw: unknown): IntakeResult<EventInput<C>> {
  const result = intake(charter, raw, () => undefined);
  return result.ok ? { ok: true, event: result.event } : result;
}

/**
 * `readEventInput` for an event already in a log: the same fields, plus `seq`, which must be a safe integer
 * of at least 1 (`Seq` is a 1-based position). A `seq` of `0`, `-3`, `1.5` or `NaN` is therefore
 * `invalid-event-shape` with `seq` among the fields, NOT a `seq-mismatch`; a well-formed `seq` that is in
 * the wrong place is M5's `seq-mismatch`, because only M5 knows what the next `seq` should be.
 */
export function readLogEvent<C extends string>(charter: Charter<C>, raw: unknown): IntakeResult<LogEvent<C>> {
  const result = intake(charter, raw, readSeq);
  return result.ok ? { ok: true, event: { ...result.event, seq: result.extra } } : result;
}

function readSeq(owner: object, bad: Set<string>): number {
  const value = read(owner, "seq", "seq");
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) return value;
  bad.add("seq");
  return 0;
}
