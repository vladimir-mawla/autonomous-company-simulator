import { checkHeadroom } from "../allowance/index.js";
import { chainOf, checkGrantStructure, firstDeadLink, liveAuthorityAbove, readCharter, readLogEvent } from "../chain/index.js";
import { MAX_LOG_EVENTS } from "../contracts/index.js";
import type {
  Charge,
  Charter,
  CommitId,
  Commitment,
  EventInput,
  FoldFault,
  Grant,
  GrantId,
  GrantTree,
  Log,
  LogEvent,
  Rejection,
  Seq,
  Verdict,
} from "../contracts/index.js";
import { judgeCommit } from "./verdict.js";

/**
 * The ledger fold and the ONE admission path (plan §3 D3, D4, D9; §5; §6 M5).
 *
 * THE LOG IS THE ONLY STATE. `fold` replays a log from empty, re-reads every event through M3's intake and re-runs
 * every admission rule on it, so nothing a caller holds (a tree, a list of charges, an earlier result) is ever
 * trusted; `append` and `mayCommit` do the same replay before they look at their own input (`append.ts`). Everything
 * below the entry points works on a `Ledger` that one call creates and nobody else sees; what an entry point returns is
 * built from it at the end, as `Folded`.
 *
 * DECIDE, THEN APPLY. `decide` looks at one already-read event against the ledger and says what admitting it would do,
 * or why it is refused; it changes nothing. `apply` writes that effect. `fold` runs both per event; `append` and
 * `mayCommit` run `decide` against the replayed ledger, so a grant, a revoke or a commit is judged by the same code
 * whether it is being replayed or offered. That is plan §5's "one admission path", and it is why `fold(append-built
 * log)` can only differ from the incremental result by a defect in this file (`replay.test.ts` checks that it does not).
 *
 * ADMISSION PRECEDENCE, first failing rule wins (plan §4.3; M3's intake has already run, so shape and
 * `unknown-capability` came first):
 *   grant:  M3's structure rules (`duplicate-id` ... `principal-cycle`), then `over-allocation`.
 *   revoke: `unknown-grant`, `already-dead`, `revoker-not-authorised`.
 *   commit: `duplicate-id`, then it is recorded whatever `judgeCommit` says (plan D4).
 * `over-allocation` is last for a grant because a dead parent's headroom is 0 (M4): asked first, every positive `limit`
 * under a dead parent would be reported as `over-allocation` and `parent-dead` could never be seen (plan §6 M3).
 *
 * `seq` IS THE POSITION OF AN ADMITTED EVENT, stamped by whoever writes the log (plan D3: arrival order, not occurrence
 * order). A rejected event consumes none. `fold` demands `seq` equal to the event's position plus one and reports the
 * first place it does not, as `seq-mismatch`.
 */

/** One commit as the ledger holds it: the commitment, the `seq` of its event and the verdict fixed at that moment. */
export interface CommitRecord<C extends string = string> {
  readonly commit: Commitment<C>;
  readonly seq: Seq;
  readonly verdict: Verdict;
}

/**
 * What a fold produced: the grant tree and the charges (the inputs to M4's functions, one charge per WARRANTED commit),
 * every commit with its verdict in the order of its `seq`, and `head`, the `seq` of the last event (0 for an empty log).
 *
 * The maps are typed read-only and are fresh for every call: nothing a later call does reaches them. They are NOT
 * frozen (a `ReadonlyMap` is a type, `lib/contracts/tree.ts`), so a caller who casts can write to the copy it holds,
 * and that changes nothing but that copy.
 */
export interface Folded<C extends string = string> {
  readonly tree: GrantTree<C>;
  readonly charges: readonly Charge[];
  readonly commits: ReadonlyMap<CommitId, CommitRecord<C>>;
  readonly head: Seq;
}

export type FoldResult<C extends string = string> =
  | { readonly ok: true; readonly folded: Folded<C> }
  | { readonly ok: false; readonly fault: FoldFault };

/** The working state of one replay. Local to a call; the Maps are written only by `apply`. */
export interface Ledger<C extends string> {
  readonly grants: Map<GrantId, Grant<C>>;
  readonly revokedAt: Map<GrantId, Seq>;
  readonly charges: Charge[];
  readonly commits: Map<CommitId, CommitRecord<C>>;
  /** The admitted events as read through intake, in order; its length is `head`. */
  readonly events: LogEvent<C>[];
}

export function emptyLedger<C extends string>(): Ledger<C> {
  return { grants: new Map(), revokedAt: new Map(), charges: [], commits: new Map(), events: [] };
}

/** The tree M3 and M4 read: the ledger's own maps, as a view. */
function treeOf<C extends string>(ledger: Ledger<C>): GrantTree<C> {
  return { grants: ledger.grants, revokedAt: ledger.revokedAt };
}

/** What admitting an event would do. Carries what `apply` needs so that nothing is judged twice. */
export type Effect<C extends string> =
  | { readonly kind: "grant"; readonly grant: Grant<C> }
  | { readonly kind: "revoke"; readonly grantId: GrantId }
  | { readonly kind: "commit"; readonly commit: Commitment<C>; readonly verdict: Verdict };

export type Decision<C extends string> =
  | { readonly ok: true; readonly effect: Effect<C> }
  | { readonly ok: false; readonly rejection: Rejection };

function refuse(rejection: Rejection): { readonly ok: false; readonly rejection: Rejection } {
  return { ok: false, rejection };
}

/**
 * Would admitting `event` be allowed, and what would it do? Pure over the ledger. `event` must already have been read
 * through M3's intake (a fresh, well-formed value whose capabilities are in `charter`).
 */
export function decide<C extends string>(charter: Charter<C>, ledger: Ledger<C>, event: EventInput<C>): Decision<C> {
  const tree = treeOf(ledger);

  switch (event.kind) {
    case "grant": {
      const grant = event.grant;
      const structure = checkGrantStructure(charter, tree, grant);
      if (!structure.ok) return refuse(structure.rejection);

      // A root grant has no parent to reserve from (roots are trusted, plan §10); a child reserves its `limit` out of
      // the parent's headroom. The shortfall names the PARENT, the grant that was asked.
      if (grant.parent !== null) {
        const fit = checkHeadroom(tree, ledger.charges, grant.parent, grant.limit);
        if (!fit.ok) {
          return refuse({
            kind: "over-allocation",
            grantId: fit.shortfall.grantId,
            requested: fit.shortfall.requested,
            headroom: fit.shortfall.headroom,
          });
        }
      }
      return { ok: true, effect: { kind: "grant", grant } };
    }

    case "revoke": {
      // `unknown-grant` also covers a grant whose ancestry cannot be completed (`chainOf` fails closed): only a
      // hand-built tree has one, and a grant that cannot be placed cannot be revoked.
      const chain = chainOf(tree, event.grantId);
      if (chain === undefined) return refuse({ kind: "unknown-grant", grantId: event.grantId });

      // Dead means the grant OR ANY ANCESTOR is revoked (plan §4.4). Revoking it again would overwrite `revokedAt`
      // and stop the parent's headroom rising a second time; a grant dead only through an ancestor is dead already and
      // has nothing left to cut.
      if (firstDeadLink(tree, chain) !== undefined) return refuse({ kind: "already-dead", grantId: event.grantId });

      // Only a principal ABOVE the grant may revoke it (plan §2.4): the grantors on its chain, root first. The grantee
      // is not above its own grant, and a charter root that is not on this chain is not above this grant either.
      if (!liveAuthorityAbove(tree, event.grantId).includes(event.by)) {
        return refuse({ kind: "revoker-not-authorised", grantId: event.grantId, by: event.by });
      }
      return { ok: true, effect: { kind: "revoke", grantId: event.grantId } };
    }

    case "commit": {
      // Commit ids are their own namespace: a commit may share an id with a grant (ids are opaque, plan §4.1).
      if (ledger.commits.has(event.commit.id)) return refuse({ kind: "duplicate-id", id: event.commit.id });
      return { ok: true, effect: { kind: "commit", commit: event.commit, verdict: judgeCommit(tree, ledger.charges, event.commit) } };
    }
  }
}

/**
 * Write an admitted event into the ledger at `seq`. A revocation is recorded once: `decide` refuses a revoke of a grant
 * that is dead, so no key of `revokedAt` is ever written twice. Only a WARRANTED commit charges its grant; a `void`
 * one is recorded and charges nothing (plan §4.2, the `void` row of its table, "What it refuses": "to charge any allowance").
 */
export function apply<C extends string>(ledger: Ledger<C>, event: EventInput<C>, effect: Effect<C>, seq: Seq): LogEvent<C> {
  switch (effect.kind) {
    case "grant":
      ledger.grants.set(effect.grant.id, effect.grant);
      break;
    case "revoke":
      ledger.revokedAt.set(effect.grantId, seq);
      break;
    case "commit":
      ledger.commits.set(effect.commit.id, { commit: effect.commit, seq, verdict: effect.verdict });
      if (effect.verdict.kind === "warranted") {
        ledger.charges.push({ grantId: effect.commit.actedUnder, amount: effect.commit.amount });
      }
      break;
  }
  const logged: LogEvent<C> = { ...event, seq };
  ledger.events.push(logged);
  return logged;
}

// ---------------------------------------------------------------------------------------------------
// Reading the log. M5 reads two things of the caller's log itself, its `length` and its elements; everything inside
// an element goes through M3's `readLogEvent`. Each is read once.
// ---------------------------------------------------------------------------------------------------

function failed(reason: FoldFault): { readonly ok: false; readonly fault: FoldFault } {
  return { ok: false, fault: reason };
}

function hostile(message: string): { readonly ok: false; readonly fault: FoldFault } {
  return failed({ kind: "hostile-log-input", message });
}

type OpenLog =
  | { readonly ok: true; readonly source: object; readonly length: number }
  | { readonly ok: false; readonly fault: FoldFault };

/**
 * Check what can be checked about a log without reading an element: that it is an array, that its `length` reads as a
 * count, and that the count is at most `MAX_LOG_EVENTS`. The bound is applied BEFORE any element is read: a Proxy can
 * claim `2 ** 32 - 1` elements and answer every index (the same reason `MAX_CHARTER_ENTRIES` exists in M3). Each read
 * that can throw is guarded, because `Array.isArray` throws on a revoked Proxy as well as a getter can. The messages
 * are built from our own text and an index, never from anything the input supplied.
 */
function openLog(log: unknown): OpenLog {
  let isArray: boolean;
  try {
    isArray = Array.isArray(log);
  } catch {
    return hostile("reading log threw");
  }
  if (!isArray) return hostile("log is not an array");

  const source = log as object;
  let length: unknown;
  try {
    length = (source as { readonly length: unknown }).length;
  } catch {
    return hostile("reading log.length threw");
  }
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    return hostile("log.length is not a count");
  }
  if (length > MAX_LOG_EVENTS) return failed({ kind: "log-too-long", length, max: MAX_LOG_EVENTS });
  return { ok: true, source, length };
}

export type Replay<C extends string> =
  | { readonly ok: true; readonly ledger: Ledger<C> }
  | { readonly ok: false; readonly fault: FoldFault };

/**
 * Replay `log` from empty under an ALREADY READ charter (`readCharter`'s frozen copy: the caller's own object is read
 * once per entry point and never again). Per event, in this order: the element is read, M3 reads it, its `seq` is
 * compared with its position, and it is admitted. The first failure ends the replay.
 *
 * Two consequences of using M3's intake that are worth stating. (1) An event whose `seq` is not a safe integer of at
 * least 1 never reaches the `seq` comparison: intake refuses it as `invalid-event-shape` with `seq` among the fields, so
 * it surfaces as `inadmissible-event`, and `seq-mismatch` is reported only for a well-formed `seq` in the wrong place
 * (`ADR 0003` plan observation 4). (2) Because intake runs first, an event that has BOTH a shape or capability problem
 * and a wrong `seq` is reported for the former: `seq` is read once, by intake, and M5 does not read it a second time.
 */
export function replay<C extends string>(charter: Charter<C>, log: unknown): Replay<C> {
  const opened = openLog(log);
  if (!opened.ok) return opened;

  const ledger = emptyLedger<C>();
  for (let index = 0; index < opened.length; index++) {
    let raw: unknown;
    try {
      raw = (opened.source as Readonly<Record<number, unknown>>)[index];
    } catch {
      return hostile(`reading log[${index}] threw`);
    }

    const read = readLogEvent(charter, raw);
    if (!read.ok) {
      if (read.failure.kind === "hostile") return hostile(`log[${index}]: ${read.failure.message}`);
      return failed({ kind: "inadmissible-event", index, rejection: read.failure.rejection });
    }

    const expected = index + 1;
    if (read.event.seq !== expected) {
      return failed({ kind: "seq-mismatch", index, expected, actual: read.event.seq });
    }

    const decision = decide(charter, ledger, read.event);
    if (!decision.ok) return failed({ kind: "inadmissible-event", index, rejection: decision.rejection });
    apply(ledger, read.event, decision.effect, expected);
  }
  return { ok: true, ledger };
}

/** The read-only result of a replay. `charges` and the maps are the ledger's own, which no one else holds. */
export function foldedOf<C extends string>(ledger: Ledger<C>): Folded<C> {
  return { tree: treeOf(ledger), charges: ledger.charges, commits: ledger.commits, head: ledger.events.length };
}

/**
 * Replay `log` under `charter` and return what it built, or the first reason it cannot be replayed (plan §5). Never
 * throws on any input: a malformed charter, a hostile or oversized log, a gap in `seq` and an event that is not
 * admissible are each a typed `FoldFault`. The charter is checked before the log is touched.
 */
export function fold<C extends string>(charter: Charter<C>, log: Log<C>): FoldResult<C> {
  const read = readCharter(charter);
  if (!read.ok) return failed({ kind: "invalid-charter", fields: read.fields });

  const replayed = replay(read.charter, log);
  if (!replayed.ok) return replayed;
  return { ok: true, folded: foldedOf(replayed.ledger) };
}
