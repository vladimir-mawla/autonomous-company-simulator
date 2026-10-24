import { headroomOf } from "../../allowance/index.js";
import { CAPABILITIES, CHARTER, g, grant, mulberry32, p, treeOf } from "../../chain/__tests__/fixtures.js";
import type { Cap, GrantSpec } from "../../chain/__tests__/fixtures.js";
import { chainOf, firstDeadLink, liveAuthorityAbove, readCharter, trailOf } from "../../chain/index.js";
import { MAX_ROOT_DEPTH, commitId, grantId, principalId } from "../../contracts/index.js";
import type {
  Charge,
  Charter,
  CommitId,
  Commitment,
  EventInput,
  Grant,
  GrantId,
  Log,
  LogEvent,
  PrincipalId,
  Seq,
  Verdict,
} from "../../contracts/index.js";
import { admitInput } from "../append.js";
import { apply, emptyLedger } from "../fold.js";
import { append, fold, mayCommit } from "../index.js";
import type { AppendFailure, Folded } from "../index.js";

/**
 * Shared test data and the WHOLE-SYSTEM GENERATOR for `lib/standing`. This file is not a test (vitest includes only
 * `*.test.ts`).
 *
 * THE GENERATOR (`runWorld`) builds a log by OFFERING events to the real `append`, one per step, and keeping whatever it
 * admits. It re-implements no rule: whether a proposal is admitted, what its verdict is and what it is rejected for are
 * answers from `append`, never decisions made here. What the generator DOES decide is what to PROPOSE, and it is
 * deliberately wrong a good part of the time (a widened capability, a borrowed grant, a limit one over the headroom, a
 * revoke by the wrong principal, a malformed shape), because a generator that only proposes valid events could not show
 * that a refusal fires. To propose sensibly it keeps a MIRROR of what it has been told was admitted (a tree and a list of
 * charges built from `append`'s own answers) and reads it with M3's and M4's published functions, the way
 * `lib/allowance/__tests__/fixtures.ts` does. The mirror steers proposals and nothing else: if it were wrong the only
 * effect would be worse proposals, and `runWorld` returns it so a test can check it equals what `fold` rebuilds.
 *
 * WHAT THE MIRROR READS. `chainOf`, `trailOf`, `firstDeadLink`, `liveAuthorityAbove` and `headroomOf` of the mirror, to
 * pick a live parent with room, a grantee not already on the chain, a revoker above the target, an amount near the
 * headroom. No comparison here decides admission; ADR 0005 lists every comparison in the generator and says what each one
 * chooses.
 *
 * TWO PROFILES. The default draws principals from a pool of 12 (2 charter roots and 10 others), so a principal repeating
 * on a chain is common and `principal-cycle` is reached. The `deep` profile tilts towards the longest chain M3 admits
 * (`MAX_ROOT_DEPTH + 1` = 8 grants): a root of depth 7, children chosen under the deepest live grant, a grantee off the
 * chain, and few revokes until late. Both are deterministic from the seed (`mulberry32`).
 */

export { CAPABILITIES, CHARTER, g, grant, mulberry32, p, treeOf };
export type { Cap, GrantSpec };

/** Two charter roots and ten others. A pool of 12 is the least that can hold a chain of 8 grants (9 principals on the trail). */
export const ROOTS = ["dana", "erin"] as const;
export const OTHERS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10"] as const;
export const POOL: readonly string[] = [...ROOTS, ...OTHERS];

/** The one-root charter of plan section 7 is `CHARTER`; seeds that are odd use this one, so a root that is NOT on a chain exists. */
export const CHARTER2: Charter<Cap> = { roots: [p("dana"), p("erin")], capabilities: CAPABILITIES };

export function charterFor(seed: number): Charter<Cap> {
  return seed % 2 === 0 ? CHARTER : CHARTER2;
}

export const cap = (name: Cap): Cap => name;

export function commit(id: string, actor: string, actedUnder: string, capability: Cap, amount: number): Commitment<Cap> {
  return { id: commitId(id), actor: p(actor), actedUnder: g(actedUnder), capability, amount };
}

export const commitEvent = (c: Commitment<Cap>): EventInput<Cap> => ({ kind: "commit", commit: c });
export const grantEvent = (spec: GrantSpec): EventInput<Cap> => ({ kind: "grant", grant: grant(spec) });
export const revokeEvent = (id: string, by: string): EventInput<Cap> => ({ kind: "revoke", grantId: g(id), by: p(by) });

/** Offer `events` to the real `append` in order and return the log; an event that is not admitted is a test failure. */
export function logOf(charter: Charter<Cap>, events: readonly EventInput<Cap>[]): Log<Cap> {
  let log: Log<Cap> = [];
  events.forEach((input, index) => {
    const result = append(charter, log, input);
    if (!result.ok) throw new Error(`logOf: event ${index} (${input.kind}) was not admitted: ${JSON.stringify(result.failure)}`);
    log = result.log;
  });
  return log;
}

/** Offer events like `logOf`, but keep whatever is admitted and report each outcome (for a fixture that includes refusals). */
export function tryLog(charter: Charter<Cap>, events: readonly unknown[]): { readonly log: Log<Cap>; readonly outcomes: readonly Outcome[] } {
  let log: Log<Cap> = [];
  const outcomes: Outcome[] = [];
  for (const input of events) {
    const result = append(charter, log, input as EventInput<Cap>);
    if (result.ok) {
      log = result.log;
      outcomes.push({ ok: true, event: result.event, verdict: result.verdict });
    } else {
      outcomes.push({ ok: false, failure: result.failure });
    }
  }
  return { log, outcomes };
}

// ---------------------------------------------------------------------------------------------------
// Plan section 7's canonical incident as raw events
// ---------------------------------------------------------------------------------------------------

/** Plan section 7, seq 1 to 6: G1 to G6, as events. */
export const CANON_GRANTS: readonly EventInput<Cap>[] = [
  grantEvent({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase", "refund", "hire", "sign-contract"], limit: 1_000_000, depth: 4 }),
  grantEvent({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase", "sign-contract"], limit: 400_000, depth: 3 }),
  grantEvent({ id: "G3", parent: "G1", grantor: "cfo", grantee: "support", capabilities: ["refund"], limit: 100_000, depth: 2 }),
  grantEvent({ id: "G4", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 120_000, depth: 0 }),
  grantEvent({ id: "G5", parent: "G2", grantor: "ops", grantee: "buyer-b", capabilities: ["purchase"], limit: 150_000, depth: 0 }),
  grantEvent({ id: "G6", parent: "G3", grantor: "support", grantee: "refunder", capabilities: ["refund"], limit: 40_000, depth: 0 }),
];

/** Plan section 7, seq 7 to 10: c1 to c4, all warranted. */
export const CANON_COMMITS: readonly EventInput<Cap>[] = [
  commitEvent(commit("c1", "buyer-a", "G4", "purchase", 50_000)),
  commitEvent(commit("c2", "buyer-b", "G5", "purchase", 90_000)),
  commitEvent(commit("c3", "refunder", "G6", "refund", 12_000)),
  commitEvent(commit("c4", "ops", "G2", "sign-contract", 80_000)),
];

/** Plan section 7, seq 11: cfo revokes G2. */
export const CANON_REVOKE: EventInput<Cap> = revokeEvent("G2", "cfo");

/** Plan section 7, seq 12 to 16, then G7 at 17 and c10 at 18. */
export const CANON_AFTER: readonly EventInput<Cap>[] = [
  commitEvent(commit("c5", "buyer-a", "G4", "purchase", 10_000)),
  commitEvent(commit("c6", "buyer-b", "G4", "purchase", 5_000)),
  commitEvent(commit("c7", "refunder", "G6", "purchase", 3_000)),
  commitEvent(commit("c8", "refunder", "G6", "refund", 50_000)),
  commitEvent(commit("c9", "buyer-a", "g-ghost", "purchase", 1_000)),
  grantEvent({ id: "G7", parent: "G1", grantor: "cfo", grantee: "buyer-a", capabilities: ["purchase"], limit: 60_000, depth: 0 }),
  commitEvent(commit("c10", "buyer-a", "G7", "purchase", 10_000)),
];

/** The whole of plan section 7's 18 admitted events, in order. */
export const CANON_ALL: readonly EventInput<Cap>[] = [...CANON_GRANTS, ...CANON_COMMITS, CANON_REVOKE, ...CANON_AFTER];

// ---------------------------------------------------------------------------------------------------
// A small org, for the tables
// ---------------------------------------------------------------------------------------------------

/**
 * Four grants, seq 1 to 4, that the verdict and revoke tables share:
 *
 *   G1  dana -> cfo     all four capabilities   limit 10 000  depth 3  (root)
 *   G2  cfo  -> ops     purchase refund          4 000        depth 2  (under G1)
 *   G3  ops  -> buyer   purchase                 1 000        depth 0  (under G2)
 *   G4  cfo  -> other   purchase                   500        depth 0  (under G1)
 */
export const ORG: readonly EventInput<Cap>[] = [
  grantEvent({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase", "refund", "hire", "sign-contract"], limit: 10_000, depth: 3 }),
  grantEvent({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase", "refund"], limit: 4_000, depth: 2 }),
  grantEvent({ id: "G3", parent: "G2", grantor: "ops", grantee: "buyer", capabilities: ["purchase"], limit: 1_000, depth: 0 }),
  grantEvent({ id: "G4", parent: "G1", grantor: "cfo", grantee: "other", capabilities: ["purchase"], limit: 500, depth: 0 }),
];

// ---------------------------------------------------------------------------------------------------
// The longest chain M3 admits, as events
// ---------------------------------------------------------------------------------------------------

/** `MAX_ROOT_DEPTH + 1` = 8 grants: the most a delegation chain can hold. */
export const DEEP_LENGTH = MAX_ROOT_DEPTH + 1;

/** The grantee of link `index` of `deepChainEvents`: `d0` holds `D0`, `d1` holds `D1`, and so on. */
export const deepHolder = (index: number): string => `d${index}`;
/** The grantor of link `index`: `dana` for the root grant, otherwise the holder of the link above. */
export const deepGrantor = (index: number): string => (index === 0 ? "dana" : deepHolder(index - 1));

/**
 * A chain of `length` grants `D0 ... D(length-1)` under the root `dana`, each link delegating to the next holder: `Di` is
 * granted by `deepGrantor(i)` to `deepHolder(i)`, has depth `length - 1 - i` and limit `(length - i) * 10 000`, so once its
 * child has reserved its own limit a link has exactly 10 000 left for its own commits, and every link has a different
 * limit. Every grant carries `purchase` and `refund`. With the default length this is the longest chain M3 admits: the
 * trail is 9 principals.
 */
export function deepChainEvents(length: number = DEEP_LENGTH): EventInput<Cap>[] {
  const events: EventInput<Cap>[] = [];
  for (let index = 0; index < length; index++) {
    events.push(
      grantEvent({
        id: `D${index}`,
        parent: index === 0 ? null : `D${index - 1}`,
        grantor: deepGrantor(index),
        grantee: deepHolder(index),
        capabilities: ["purchase", "refund"],
        limit: (length - index) * 10_000,
        depth: length - 1 - index,
      }),
    );
  }
  return events;
}

// ---------------------------------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------------------------------

export type Outcome =
  | { readonly ok: true; readonly event: LogEvent<Cap>; readonly verdict: Verdict | null }
  | { readonly ok: false; readonly failure: AppendFailure };

/** One proposal and what the engine said, with the length of the log it was offered to. */
export interface Attempt {
  readonly step: number;
  readonly kind: "grant" | "revoke" | "commit" | "malformed";
  readonly input: unknown;
  readonly logLength: number;
  readonly outcome: Outcome;
}

/** What the generator believes is admitted: built only from `append`'s answers, and used only to steer proposals. */
export interface Mirror {
  readonly grants: Map<GrantId, Grant<Cap>>;
  readonly revokedAt: Map<GrantId, Seq>;
  readonly charges: Charge[];
}

export interface World {
  readonly seed: number;
  readonly charter: Charter<Cap>;
  readonly profile: "default" | "deep";
  readonly log: Log<Cap>;
  readonly attempts: readonly Attempt[];
  readonly mirror: Mirror;
}

export interface WorldOptions {
  readonly seed: number;
  readonly steps: number;
  readonly profile?: "default" | "deep";
  /**
   * How a proposal is offered to the engine. `"incremental"` (the default) keeps ONE ledger and offers each proposal to
   * `admitInput`, the admission step `append` runs after it has replayed the log, so building a world costs a pass and not a
   * replay per event. `"append"` calls the public `append` with the whole log every time. The two must give the same world
   * for every seed, and `replay.test.ts` asserts that for all of them; every other file uses the cheaper one.
   */
  readonly engine?: "incremental" | "append";
}

function pick<T>(random: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

function chance(random: () => number, probability: number): boolean {
  return random() < probability;
}

/** A non-empty subset of `names`, in their order, each kept with probability one half. */
function someOf<T>(random: () => number, names: readonly T[]): T[] {
  const kept = names.filter(() => random() < 0.5);
  if (kept.length > 0) return kept;
  const one = pick(random, names);
  return one === undefined ? [] : [one];
}

export function runWorld(options: WorldOptions): World {
  const { seed, steps } = options;
  const profile = options.profile ?? "default";
  const deep = profile === "deep";
  const random = mulberry32(seed * 7919 + (deep ? 13 : 1));
  const charter = charterFor(seed);

  const engine = options.engine ?? "incremental";
  const read = readCharter(charter);
  if (!read.ok) throw new Error(`runWorld: the charter for seed ${seed} was refused: ${JSON.stringify(read.fields)}`);
  const ledger = emptyLedger<Cap>();

  const mirror: Mirror = { grants: new Map(), revokedAt: new Map(), charges: [] };
  const tree = { grants: mirror.grants, revokedAt: mirror.revokedAt };
  const roots: readonly string[] = charter.roots;

  let log: Log<Cap> = [];
  const attempts: Attempt[] = [];
  let grantCounter = 0;
  let commitCounter = 0;
  let lastRevoked: GrantId | undefined;
  const everCommitIds: string[] = [];

  const isLive = (id: GrantId): boolean => {
    const chain = chainOf(tree, id);
    return chain !== undefined && firstDeadLink(tree, chain) === undefined;
  };
  const allGrants = (): Grant<Cap>[] => [...mirror.grants.values()];
  const liveGrants = (): Grant<Cap>[] => allGrants().filter((entry) => isLive(entry.id));
  const lengthOf = (id: GrantId): number => chainOf(tree, id)?.length ?? 0;

  /** The deepest live grant that can still delegate (`depth >= 1`), ties broken by the draw. */
  const deepestDelegator = (): Grant<Cap> | undefined => {
    const candidates = liveGrants().filter((entry) => entry.depth >= 1);
    let best: Grant<Cap>[] = [];
    let bestLength = -1;
    for (const entry of candidates) {
      const length = lengthOf(entry.id);
      if (length > bestLength) {
        best = [entry];
        bestLength = length;
      } else if (length === bestLength) best.push(entry);
    }
    return pick(random, best);
  };

  const proposeGrant = (): unknown => {
    grantCounter += 1;
    let id = `G${grantCounter}`;
    // A duplicate id, now and then: the engine must say `duplicate-id`.
    if (mirror.grants.size > 0 && chance(random, 0.02)) id = pick(random, [...mirror.grants.keys()]) ?? id;

    const asRoot = mirror.grants.size === 0 || chance(random, deep ? 0.04 : 0.1);
    if (asRoot) {
      // Mostly a charter root, now and then not (`not-a-root`).
      const grantor = chance(random, 0.94) ? (pick(random, roots) ?? "dana") : (pick(random, OTHERS) ?? "p1");
      const grantee = pick(random, POOL.filter((name) => name !== grantor)) ?? "p1";
      return {
        kind: "grant",
        grant: {
          id,
          parent: null,
          grantor,
          grantee,
          capabilities: someOf(random, CAPABILITIES),
          limit: chance(random, 0.05) ? 0 : 1000 + Math.floor(random() * 999_000),
          depth: deep ? 7 : Math.floor(random() * (MAX_ROOT_DEPTH + 1)),
        },
      };
    }

    let parent: Grant<Cap> | undefined;
    if (chance(random, deep ? 0.8 : 0.5)) parent = deepestDelegator();
    if (parent === undefined || chance(random, 0.12)) parent = pick(random, allGrants());
    if (parent === undefined) return { kind: "grant", grant: { id, parent: "g-ghost" } };

    // A parent that does not exist (`unknown-parent`).
    const parentRef = chance(random, 0.02) ? "g-ghost" : parent.id;
    const chain = chainOf(tree, parent.id);
    const trail: readonly PrincipalId[] = chain === undefined ? [] : (trailOf(tree, chain) ?? []);
    const offChain = POOL.filter((name) => !trail.includes(p(name)));

    // Grantor: the parent's grantee, now and then somebody else (`grantor-not-holder`).
    const grantor = chance(random, 0.94) ? parent.grantee : (pick(random, POOL) ?? "p1");
    // Grantee: off the chain mostly, anybody now and then (`principal-cycle`).
    const grantee = chance(random, 0.88) ? (pick(random, offChain) ?? "p1") : (pick(random, POOL) ?? "p1");
    // Capabilities: a subset of the parent's, widened now and then (`capability-widening`).
    const caps: string[] = chance(random, 0.93) ? someOf(random, parent.capabilities) : someOf(random, CAPABILITIES);
    // Depth: strictly less than the parent's mostly, equal or more now and then (`depth-not-narrowed`, `depth-exhausted`).
    const depth = chance(random, 0.9) ? Math.max(0, parent.depth - 1 - (chance(random, deep ? 0.02 : 0.3) ? 1 : 0)) : Math.floor(random() * (MAX_ROOT_DEPTH + 1));
    // Limit: near the parent's headroom, exactly it or one over it now and then (`over-allocation`).
    const room = headroomOf(tree, mirror.charges, parent.id) ?? 0;
    const roll = random();
    const limit = roll < 0.07 ? room : roll < 0.12 ? room + 1 : roll < 0.15 ? 0 : Math.floor(room * (0.45 + 0.5 * random()));

    return { kind: "grant", grant: { id, parent: parentRef, grantor, grantee, capabilities: caps, limit, depth } };
  };

  const proposeCommit = (): unknown => {
    commitCounter += 1;
    let id = `c${commitCounter}`;
    // A duplicate commit id, now and then: `duplicate-id` (and the original is not replaced).
    if (everCommitIds.length > 0 && chance(random, 0.02)) id = pick(random, everCommitIds) ?? id;

    const pool = chance(random, 0.05) ? allGrants() : liveGrants();
    const target = pick(random, pool.length > 0 ? pool : allGrants());
    if (target === undefined || chance(random, 0.025)) {
      return { kind: "commit", commit: { id, actor: pick(random, POOL), actedUnder: "g-ghost", capability: "purchase", amount: 10 } };
    }
    // The actor: the grantee mostly, somebody else now and then (`wrong-actor`).
    const actor = chance(random, 0.88) ? target.grantee : (pick(random, POOL) ?? "p1");
    // The capability: one the grant has mostly (`capability-not-granted` otherwise).
    const capability = chance(random, 0.9) ? pick(random, target.capabilities) : pick(random, CAPABILITIES);
    const room = headroomOf(tree, mirror.charges, target.id) ?? 0;
    const roll = random();
    const amount = roll < 0.1 ? room : roll < 0.14 ? room + 1 : roll < 0.18 ? 0 : Math.floor(Math.max(room, 0) * random() ** 3);
    return { kind: "commit", commit: { id, actor, actedUnder: target.id, capability, amount } };
  };

  const proposeRevoke = (): unknown => {
    let target: Grant<Cap> | undefined;
    // Climb: the parent of the grant just revoked, so one chain is cut at more than one level.
    if (lastRevoked !== undefined && chance(random, 0.35)) {
      const previous = mirror.grants.get(lastRevoked);
      if (previous !== undefined && previous.parent !== null) target = mirror.grants.get(previous.parent);
    }
    // Cut again a grant that was already cut (`already-dead`, the grant's own revocation).
    if (target === undefined && mirror.revokedAt.size > 0 && chance(random, 0.1)) {
      const again = pick(random, [...mirror.revokedAt.keys()]);
      if (again !== undefined) target = mirror.grants.get(again);
    }
    // Cut a grant that is dead only because something above it was cut (`already-dead`, through an ancestor).
    if (target === undefined && mirror.revokedAt.size > 0 && chance(random, 0.1)) {
      target = pick(random, allGrants().filter((entry) => !isLive(entry.id) && !mirror.revokedAt.has(entry.id)));
    }
    if (target === undefined) {
      // Mostly a live grant that is not a root: cutting a root kills the whole tree below it and leaves nothing to test.
      const live = liveGrants();
      const nonRoot = live.filter((entry) => entry.parent !== null);
      if (chance(random, 0.1)) target = pick(random, allGrants());
      else if (chance(random, 0.05)) target = pick(random, live);
      else target = pick(random, nonRoot.length > 0 ? nonRoot : live);
    }
    if (target === undefined || chance(random, 0.025)) return { kind: "revoke", grantId: "g-ghost", by: pick(random, POOL) };
    // The revoker: a principal above the grant mostly, anybody now and then (`revoker-not-authorised`).
    const above = liveAuthorityAbove(tree, target.id);
    const by = chance(random, 0.85) ? (pick(random, above) ?? pick(random, POOL)) : pick(random, POOL);
    return { kind: "revoke", grantId: target.id, by };
  };

  /** A proposal broken in a way intake refuses: one field wrong, or an unknown capability. */
  const proposeMalformed = (): unknown => {
    const base = pick(random, [proposeGrant, proposeCommit, proposeRevoke])?.() as { kind: string; [key: string]: unknown };
    const inner = (base["grant"] ?? base["commit"]) as Record<string, unknown> | undefined;
    switch (Math.floor(random() * 8)) {
      case 0:
        if (inner !== undefined && "limit" in inner) inner["limit"] = -1;
        else if (inner !== undefined) inner["amount"] = -1;
        else base["by"] = "";
        break;
      case 1:
        if (inner !== undefined && "capabilities" in inner) inner["capabilities"] = ["launder"];
        else if (inner !== undefined) inner["capability"] = "launder";
        else base["grantId"] = 7;
        break;
      case 2:
        if (inner !== undefined) inner["id"] = "";
        else base["grantId"] = "";
        break;
      case 3:
        base["kind"] = "frobnicate";
        break;
      case 4:
        if (inner !== undefined && "depth" in inner) inner["depth"] = 99;
        else if (inner !== undefined) inner["amount"] = 1.5;
        else base["by"] = null;
        break;
      case 5:
        if (inner !== undefined) delete inner["id"];
        else delete base["by"];
        break;
      case 6:
        if (inner !== undefined && "capabilities" in inner) inner["capabilities"] = [];
        else if (inner !== undefined) inner["actor"] = 42;
        else base["by"] = {};
        break;
      default:
        // An extra key, including a `seq` the caller has no right to choose: it must be ignored, not copied, and the
        // event is otherwise as it was (so the engine decides it like any other).
        base["seq"] = 999;
        base["extra"] = "ignored";
    }
    return base;
  };

  for (let step = 0; step < steps; step++) {
    const t = step / steps;
    const roll = random();
    const grantWeight = deep ? 0.62 - 0.45 * t : 0.5 - 0.3 * t;
    const revokeWeight = deep ? 0.12 * t * t : 0.015 + 0.06 * t;
    const malformedWeight = 0.05;
    let kind: Attempt["kind"];
    let input: unknown;
    if (roll < grantWeight) {
      kind = "grant";
      input = proposeGrant();
    } else if (roll < grantWeight + revokeWeight) {
      kind = "revoke";
      input = proposeRevoke();
    } else if (roll < grantWeight + revokeWeight + malformedWeight) {
      kind = "malformed";
      input = proposeMalformed();
    } else {
      kind = "commit";
      input = proposeCommit();
    }

    const logLength = engine === "append" ? log.length : ledger.events.length;
    let outcome: Outcome;
    if (engine === "append") {
      const result = append(charter, log, input as EventInput<Cap>);
      if (result.ok) log = result.log;
      outcome = result.ok ? { ok: true, event: result.event, verdict: result.verdict } : { ok: false, failure: result.failure };
    } else {
      const prepared = admitInput(read.charter, ledger, input);
      if (prepared.ok) {
        const event = apply(ledger, prepared.event, prepared.effect, prepared.seq);
        outcome = { ok: true, event, verdict: prepared.effect.kind === "commit" ? prepared.effect.verdict : null };
      } else {
        outcome = { ok: false, failure: prepared.failure };
      }
    }

    if (outcome.ok) {
      const event = outcome.event;
      if (event.kind === "grant") mirror.grants.set(event.grant.id, event.grant);
      else if (event.kind === "revoke") {
        mirror.revokedAt.set(event.grantId, event.seq);
        lastRevoked = event.grantId;
      } else {
        everCommitIds.push(event.commit.id);
        if (outcome.verdict?.kind === "warranted") mirror.charges.push({ grantId: event.commit.actedUnder, amount: event.commit.amount });
      }
    }
    attempts.push({ step, kind, input, logLength, outcome });
  }

  return { seed, charter, profile, log: engine === "append" ? log : [...ledger.events], attempts, mirror };
}

// ---------------------------------------------------------------------------------------------------
// Independent reads of a log, for assertions
// ---------------------------------------------------------------------------------------------------

/** For each revoke in the log, the grant it names and the seq; the first revoke of a grant is the only one an admitted log holds. */
export function revokeSeqs(log: Log<Cap>): Map<GrantId, Seq> {
  const out = new Map<GrantId, Seq>();
  for (const event of log) if (event.kind === "revoke" && !out.has(event.grantId)) out.set(event.grantId, event.seq);
  return out;
}

/** Every grant of a log by id, read straight from the events. */
export function grantsOf(log: Log<Cap>): Map<GrantId, Grant<Cap>> {
  const out = new Map<GrantId, Grant<Cap>>();
  for (const event of log) if (event.kind === "grant") out.set(event.grant.id, event.grant);
  return out;
}

/** The commits of a log by id, with their seq, read straight from the events. */
export function commitsOf(log: Log<Cap>): Map<CommitId, { readonly commit: Commitment<Cap>; readonly seq: Seq }> {
  const out = new Map<CommitId, { readonly commit: Commitment<Cap>; readonly seq: Seq }>();
  for (const event of log) if (event.kind === "commit") out.set(event.commit.id, { commit: event.commit, seq: event.seq });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Small helpers shared by the test files
// ---------------------------------------------------------------------------------------------------

/** `fold` that fails the test instead of returning a fault. */
export function mustFold(charter: Charter<Cap>, log: Log<Cap>): Folded<Cap> {
  const result = fold(charter, log);
  if (!result.ok) throw new Error(`mustFold: ${JSON.stringify(result.fault)}`);
  return result.folded;
}

/** `append` that fails the test instead of returning a failure. */
export function mustAppend(charter: Charter<Cap>, log: Log<Cap>, input: EventInput<Cap>): { readonly log: Log<Cap>; readonly event: LogEvent<Cap>; readonly verdict: Verdict | null } {
  const result = append(charter, log, input);
  if (!result.ok) throw new Error(`mustAppend: ${JSON.stringify(result.failure)}`);
  return result;
}

/**
 * The verdict on `commit` against `events`, asked three ways that must agree: `mayCommit`, `append` (whose verdict is
 * the one it records) and the record `fold` rebuilds from the log `append` returned. Fails the test if they differ.
 */
export function judge(charter: Charter<Cap>, events: readonly EventInput<Cap>[], commit: Commitment<Cap>): Verdict {
  const log = logOf(charter, events);
  const asked = mayCommit(charter, log, commit);
  if (!asked.ok) throw new Error(`judge: mayCommit refused: ${JSON.stringify(asked.failure)}`);
  const appended = mustAppend(charter, log, commitEvent(commit));
  if (appended.verdict === null) throw new Error("judge: a commit was recorded without a verdict");
  const record = mustFold(charter, appended.log).commits.get(commit.id);
  if (JSON.stringify(asked.verdict) !== JSON.stringify(appended.verdict) || JSON.stringify(record?.verdict) !== JSON.stringify(appended.verdict)) {
    throw new Error(`judge: mayCommit, append and fold disagree: ${JSON.stringify([asked.verdict, appended.verdict, record?.verdict])}`);
  }
  return appended.verdict;
}

/** Everything a `Folded` holds as plain, ordered data, so two folds can be compared with `toEqual`. */
export function snapshotOf(folded: Folded<Cap>): unknown {
  return {
    grants: [...folded.tree.grants],
    revokedAt: [...folded.tree.revokedAt],
    charges: [...folded.charges],
    commits: [...folded.commits],
    head: folded.head,
  };
}

/**
 * Run `scan` over `total` seeds in `count` equal chunks, lazily and once per chunk, so that tests which each read one chunk
 * share its work and no single test carries the whole run. `range(i)` is the inclusive seed range of chunk `i`.
 */
export function chunked<T>(
  total: number,
  count: number,
  scan: (first: number, last: number) => T,
): { readonly count: number; readonly range: (index: number) => readonly [number, number]; readonly get: (index: number) => T } {
  const size = Math.ceil(total / count);
  const done = new Map<number, T>();
  const range = (index: number): readonly [number, number] => [index * size + 1, Math.min(total, (index + 1) * size)];
  return {
    count,
    range,
    get(index: number): T {
      let value = done.get(index);
      if (value === undefined) {
        const [first, last] = range(index);
        value = scan(first, last);
        done.set(index, value);
      }
      return value;
    },
  };
}

/**
 * Print the counts a coverage test is about to assert, when `ACS_REPORT=1`. The floors in the tests are set well under what
 * the run reaches; this is how the numbers they are compared with are read (ADR 0005 quotes them). Silent otherwise.
 */
export function report(name: string, counts: unknown): void {
  if (process.env["ACS_REPORT"] === "1") console.log(`ACS_REPORT ${name} ${JSON.stringify(counts)}`);
}

/** Seeds and events per seed of every whole-system property (plan section 6 M5: "at least 1 500 seeds x 100 events"). */
export const SEEDS = 1500;
export const STEPS = 100;
/**
 * The per-test timeout of every test that reads a generated chunk, one named constant for all of them. The work is
 * synchronous, so a timeout is a failure threshold and not a guard against a hang. It is far above what a chunk takes (the
 * slowest is about a second on a quiet machine) so that a slow runner does not turn a correct run red; ADR 0005 gives the
 * measured durations, the load they were measured under, and why the chunks are not cut further.
 */
export const SEED_LOOP_TIMEOUT_MS = 20_000;

/** The prefix lengths to check for a world: all of them, or the points where the tree changes plus a spread. */
export function cutsOf(log: Log<Cap>, exhaustive: boolean): number[] {
  const n = log.length;
  const cuts = new Set<number>([n]);
  for (let k = 1; k <= n; k++) {
    const event = log[k - 1];
    if (exhaustive || event?.kind === "revoke") {
      cuts.add(k);
      if (k > 1) cuts.add(k - 1);
    }
  }
  if (!exhaustive) for (let part = 1; part <= 8; part++) cuts.add(Math.max(1, Math.floor((n * part) / 8)));
  return [...cuts].filter((k) => k >= 1 && k <= n).sort((a, b) => a - b);
}

/** Freeze `value` and everything reachable through plain objects and arrays, so a function that writes to an input throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** A structural copy through JSON: plain data only, none of the original's objects. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Every whole-system property runs its seeds in this many chunks, each its own test (`chunked`): 100 seeds a chunk. The slowest
 * test of a file is its first chunk, which also pays for the world-building the later ones share, so a smaller chunk is a
 * shorter worst case.
 */
export const CHUNKS = 15;

/**
 * The seeds whose EVERY prefix is checked by the files that sample cut points (`cutsOf`): every tenth, 150 of the 1 500. Spread
 * over the seed range, so that every chunk carries the same weight; the first 150 seeds in one chunk made that chunk several
 * times heavier than the others, and it was the slowest test in the suite.
 */
export const isExhaustiveSeed = (seed: number): boolean => seed % 10 === 0;

/** The profile a seed runs under: every fifth seed is `deep`. Fixed here so every file agrees on which seeds are deep. */
export const profileOf = (seed: number): "default" | "deep" => (seed % 5 === 0 ? "deep" : "default");

export const pid = (name: string): PrincipalId => principalId(name);
export const gid = (name: string): GrantId => grantId(name);
export const cid = (name: string): CommitId => commitId(name);
