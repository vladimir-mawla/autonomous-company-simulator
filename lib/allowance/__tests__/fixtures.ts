import { chainOf, checkGrantStructure, firstDeadLink } from "../../chain/index.js";
import type { StructureRejection } from "../../chain/index.js";
import { CAPABILITIES, CHARTER, mulberry32 } from "../../chain/__tests__/fixtures.js";
import type { Cap } from "../../chain/__tests__/fixtures.js";
import { MAX_ROOT_DEPTH, grantId, principalId } from "../../contracts/index.js";
import type { Charge, Grant, GrantId, GrantTree, Seq } from "../../contracts/index.js";
import { checkHeadroom, headroomOf, usedOf } from "../index.js";
import type { Shortfall } from "../index.js";

/**
 * Shared test data, an ORACLE and a trace DRIVER for `lib/allowance`. This file is not a test (vitest includes only
 * `*.test.ts`). It has three parts, and the line between the last two is the point of the file:
 *
 *   1. DATA. Plan section 7's grants (re-exported from `lib/chain`'s fixtures, which are frozen with M3) and its
 *      charges c1 to c4 (here), and small constructors.
 *
 *   2. THE ORACLE (`liveByData`, `subtreeOwnByData`, ...). It reads a finished state in ASSERTIONS and decides
 *      nothing about what enters a trace. It restates two definitions of plan section 4.4 that the theorem is
 *      written in (live, and subtreeOwn) by walking the raw maps a different way from `lib/allowance` (repeated
 *      passes over the parent pointers, no child index, no use of `lib/chain`), so a defect in the library's walk
 *      is not repeated here. It does NOT restate `used`, `headroom` or `chargeToParent`: those are what the
 *      properties constrain, and a second copy of them in a test would share the library's mistakes.
 *
 *   3. THE DRIVER, `runWorld`. It BUILDS a trace: a tree of grants, a list of charges, a revoke here and there. It
 *      re-implements no rule. Every decision about what enters the trace is an answer from a published function:
 *        - a grant enters the tree only if M3's `checkGrantStructure` says `ok` AND then M4's `checkHeadroom` says
 *          `ok` for the parent (the order of plan section 4.3: over-allocation is the last rule);
 *        - a charge's amount is chosen INSIDE `[0, headroomOf(grant)]`, so it is made to fit and never compared;
 *        - a revoke is applied unless M3's `firstDeadLink` finds a dead link on the target's chain (the plan's
 *          `already-dead` refusal, section 4.3, with the answer taken from M3 and not worked out here), and then it
 *          is written once, as `revokedAt` is meant to be.
 *      The only other branching is on the seeded random numbers and on WHERE to propose: under a grant that has
 *      room (`headroomOf` above 0) or whose `depth` is at least 1 so chains get deep, against a grant that has
 *      room, or revoking one that has children. All of that chooses what to PROPOSE. Proposals are deliberately
 *      often wrong (a limit one over the headroom, a dead parent, a widened capability): whether they are right
 *      is not the driver's to say. `Deps` lets a test hand the driver a stand-in for any of the functions it
 *      consults; `conservation.test.ts` uses that to show the driver adds no refusal of its own.
 */

export { CAPABILITIES, CHARTER, mulberry32 };
export type { Cap };
export { CANON, canonAfterRevokingG2, canonBefore, g, grant, p, treeOf } from "../../chain/__tests__/fixtures.js";

// ---------------------------------------------------------------------------------------------------
// 1. Data
// ---------------------------------------------------------------------------------------------------

export const charge = (id: string, amount: number): Charge => ({ grantId: grantId(id), amount });

/**
 * Plan section 7's four warranted commitments c1 to c4 as charges (seqs 7 to 10): c1 buyer-a 50 000 under G4, c2 buyer-b
 * 90 000 under G5, c3 refunder 12 000 under G6, c4 ops 80 000 under G2. After them the plan gives headroom G1 500 000,
 * G2 50 000, G4 70 000, G6 28 000.
 */
export const canonCharges = (): Charge[] => [charge("G4", 50_000), charge("G5", 90_000), charge("G6", 12_000), charge("G2", 80_000)];

/** A fresh, mutable `GrantTree` over the given maps, so a test can add a grant or a revocation and ask again. */
export function mutableTree(grants: readonly Grant<Cap>[], revoked: Readonly<Record<string, Seq>> = {}): { readonly grants: Map<GrantId, Grant<Cap>>; readonly revokedAt: Map<GrantId, Seq> } {
  return {
    grants: new Map(grants.map((entry) => [entry.id, entry])),
    revokedAt: new Map(Object.entries(revoked).map(([id, seq]) => [grantId(id), seq])),
  };
}

// ---------------------------------------------------------------------------------------------------
// 2. The oracle
// ---------------------------------------------------------------------------------------------------

/** What an oracle and an observer are given: the grants, the revocations and the charges of a trace so far. */
export interface WorldView {
  readonly tree: GrantTree<Cap>;
  readonly charges: readonly Charge[];
}

/** Plan section 4.4 "live": neither the grant nor any ancestor has a recorded revocation. Walks the parent pointers by hand. */
export function liveByData(world: WorldView, id: GrantId): boolean {
  let current: GrantId | null = id;
  for (let hops = 0; hops < 64 && current !== null; hops++) {
    if (world.tree.revokedAt.has(current)) return false;
    const grant: Grant<Cap> | undefined = world.tree.grants.get(current);
    if (grant === undefined) throw new Error(`oracle: ${current} is not in the tree`);
    current = grant.parent;
  }
  if (current !== null) throw new Error(`oracle: the ancestry of ${id} did not end`);
  return true;
}

/** The grant and every grant below it, found by repeated passes over the parent pointers until a pass adds nothing. */
export function subtreeMembers(world: WorldView, root: GrantId): ReadonlySet<GrantId> {
  const members = new Set<GrantId>([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, entry] of world.tree.grants) {
      if (entry.parent !== null && members.has(entry.parent) && !members.has(id)) {
        members.add(id);
        grew = true;
      }
    }
  }
  return members;
}

/** Plan section 4.4 subtreeOwn: the sum of the charges on the grant and on everything below it. */
export function subtreeOwnByData(world: WorldView, root: GrantId): number {
  const members = subtreeMembers(world, root);
  let total = 0;
  for (const entry of world.charges) if (members.has(entry.grantId)) total += entry.amount;
  return total;
}

/** How many grants are on the line from the root grant down to this one, itself included (1 for a root grant). */
export function lineLength(world: WorldView, id: GrantId): number {
  let length = 0;
  let current: GrantId | null = id;
  for (let hops = 0; hops < 64 && current !== null; hops++) {
    const grant: Grant<Cap> | undefined = world.tree.grants.get(current);
    if (grant === undefined) throw new Error(`oracle: ${current} is not in the tree`);
    length += 1;
    current = grant.parent;
  }
  if (current !== null) throw new Error(`oracle: the ancestry of ${id} did not end`);
  return length;
}

/** The ids of the root grants (`parent: null`), in the tree's order. */
export function rootIds(world: WorldView): GrantId[] {
  return [...world.tree.grants].filter(([, entry]) => entry.parent === null).map(([id]) => id);
}

/** `usedOf` and `headroomOf` for every grant of the tree, as the library answers them right now. */
export interface Snapshot {
  readonly used: ReadonlyMap<GrantId, number | undefined>;
  readonly headroom: ReadonlyMap<GrantId, number | undefined>;
}

export function snapshotOf(world: WorldView): Snapshot {
  const used = new Map<GrantId, number | undefined>();
  const headroom = new Map<GrantId, number | undefined>();
  for (const id of world.tree.grants.keys()) {
    used.set(id, usedOf(world.tree, world.charges, id));
    headroom.set(id, headroomOf(world.tree, world.charges, id));
  }
  return { used, headroom };
}

// ---------------------------------------------------------------------------------------------------
// 3. The driver
// ---------------------------------------------------------------------------------------------------

/** The published functions the driver consults. A test may replace any of them (see the file comment). */
export interface Deps {
  readonly checkGrantStructure: typeof checkGrantStructure;
  readonly checkHeadroom: typeof checkHeadroom;
  readonly headroomOf: typeof headroomOf;
  readonly chainOf: typeof chainOf;
  readonly firstDeadLink: typeof firstDeadLink;
}

export const REAL_DEPS: Deps = { checkGrantStructure, checkHeadroom, headroomOf, chainOf, firstDeadLink };

export type GrantFate =
  | { readonly kind: "admitted" }
  | { readonly kind: "refused-structure"; readonly rejection: StructureRejection }
  | { readonly kind: "refused-headroom"; readonly shortfall: Shortfall };

/** One step of a trace. Every step emits exactly one event, after the step's effect (if any) is in the world. */
export type DriverEvent =
  | {
      readonly kind: "grant";
      readonly seed: number;
      readonly step: number;
      readonly grant: Grant<Cap>;
      /** `headroomOf(parent)` when the proposal was decided; `undefined` for a root grant. Nothing changes between that read and the decision. */
      readonly parentHeadroom: number | undefined;
      readonly fate: GrantFate;
    }
  | {
      readonly kind: "charge";
      readonly seed: number;
      readonly step: number;
      readonly grantId: GrantId;
      /** `headroomOf(grantId)` just before the charge; `amount` was drawn from `[0, headroom]`. */
      readonly headroom: number;
      readonly amount: number;
    }
  | {
      readonly kind: "revoke";
      readonly seed: number;
      readonly step: number;
      readonly target: GrantId;
      readonly fate: "revoked" | "refused-dead";
      /** The library's numbers just before and just after the revocation was written; absent when it was refused. */
      readonly before: Snapshot | undefined;
      readonly after: Snapshot | undefined;
    };

/** Called after every step with the event and the world as it stands (the same objects every time: do not keep them). */
export type Observer = (event: DriverEvent, world: WorldView) => void;

export interface RunOptions {
  readonly steps: number;
  /** Compute `before`/`after` snapshots at each applied revoke. They cost a full pass over the tree, so a test that does not read them turns them off. */
  readonly snapshots?: boolean;
  readonly deps?: Deps;
}

export interface RunOutcome {
  /** One short string per step: the same seed and options give the same list. */
  readonly steps: readonly string[];
  readonly world: WorldView;
}

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("internal error: picked from an empty list");
  return item;
}

/** A non-empty subset of `from`. */
function someOf(random: () => number, from: readonly Cap[]): [Cap, ...Cap[]] {
  const chosen = from.filter(() => random() < 0.6);
  const first = chosen[0] ?? pick(random, from);
  return [first, ...chosen.slice(1)];
}

/** Probability of each kind of step once the tree is not empty: a grant, else a charge, else a revoke (the remaining 8%). */
const GRANT_SHARE = 0.45;
const CHARGE_SHARE = 0.47;

/**
 * Play one world of `options.steps` steps from `seed`. Deterministic: the same seed and options give the same trace.
 * Every step is one proposal (a grant, a charge or a revoke) and emits one event to `observe`.
 */
export function runWorld(seed: number, options: RunOptions, observe: Observer = () => undefined): RunOutcome {
  const deps = options.deps ?? REAL_DEPS;
  const random = mulberry32(seed);
  const grants = new Map<GrantId, Grant<Cap>>();
  const revokedAt = new Map<GrantId, Seq>();
  const charges: Charge[] = [];
  const tree: GrantTree<Cap> = { grants, revokedAt };
  const world: WorldView = { tree, charges };
  const log: string[] = [];
  let seq = 0;
  let counter = 0;

  for (let step = 1; step <= options.steps; step++) {
    const ids = [...grants.keys()];
    const roll = random();
    // Which grants the library says have something to spend or lend. Used only to choose what to propose: most
    // proposals go where there is room, because otherwise a world is mostly refusals against dead or full grants.
    const withRoom = ids.filter((id) => (deps.headroomOf(tree, charges, id) ?? 0) > 0);

    if (ids.length === 0 || roll < GRANT_SHARE) {
      // ---- propose a grant, usually close to valid and sometimes wrong in one way ----
      counter += 1;
      const asRoot = ids.length === 0 || random() < 0.1;
      // Parents that have room and can still delegate are preferred so chains get deep; others are proposed under
      // sometimes anyway (a dead parent, a full one, one at depth 0), so the refusals are reached too.
      const delegating = withRoom.filter((id) => (grants.get(id)?.depth ?? 0) >= 1);
      const lead = random();
      const parentId = asRoot ? undefined : lead < 0.8 && delegating.length > 0 ? pick(random, delegating) : lead < 0.9 && withRoom.length > 0 ? pick(random, withRoom) : pick(random, ids);
      const parent = parentId === undefined ? undefined : grants.get(parentId);
      const parentHeadroom = parent === undefined ? undefined : deps.headroomOf(tree, charges, parent.id);

      // The limit is chosen RELATIVE to the parent's headroom so the boundary is common: the whole of it, one over,
      // nothing, a share. Nothing here decides anything; `checkHeadroom` below does.
      const room = parentHeadroom ?? 500;
      const share = Math.floor(random() * (room + 1));
      const draw = random();
      const limit =
        parent === undefined
          ? 1 + Math.floor(random() * 1000)
          : draw < 0.06
            ? room // all of it
            : draw < 0.12
              ? room + 1 // one over
              : draw < 0.17
                ? room + 1 + Math.floor(random() * (room + 1)) // well over
                : draw < 0.2
                  ? 0
                  : draw < 0.6
                    ? share
                    : 1 + Math.floor(share * 0.25); // a small positive share (over, and so refused, if there is no room at all)

      const proposal: Grant<Cap> = {
        id: grantId(`g${counter}`),
        parent: parent === undefined ? null : parent.id,
        grantor: parent === undefined ? CHARTER.roots[0] : random() < 0.92 ? parent.grantee : principalId(`p${Math.floor(random() * counter)}`),
        // Mostly a fresh principal; sometimes one already used, which a chain may refuse as a cycle.
        grantee: principalId(random() < 0.95 ? `p${counter}` : `p${Math.floor(random() * counter)}`),
        capabilities: parent !== undefined && random() < 0.9 ? someOf(random, parent.capabilities) : someOf(random, CAPABILITIES),
        limit,
        depth: parent === undefined ? 1 + Math.floor(random() * MAX_ROOT_DEPTH) : random() < 0.92 ? Math.max(parent.depth - 1, 0) : Math.floor(random() * (MAX_ROOT_DEPTH + 1)),
      };

      let fate: GrantFate;
      const structure = deps.checkGrantStructure(CHARTER, tree, proposal);
      if (!structure.ok) {
        fate = { kind: "refused-structure", rejection: structure.rejection };
      } else {
        const reservation = proposal.parent === null ? undefined : deps.checkHeadroom(tree, charges, proposal.parent, proposal.limit);
        if (reservation !== undefined && !reservation.ok) {
          fate = { kind: "refused-headroom", shortfall: reservation.shortfall };
        } else {
          grants.set(proposal.id, proposal);
          seq += 1;
          fate = { kind: "admitted" };
        }
      }
      log.push(`grant:${fate.kind === "admitted" ? "admitted" : fate.kind === "refused-structure" ? fate.rejection.kind : "over-allocation"}`);
      observe({ kind: "grant", seed, step, grant: proposal, parentHeadroom, fate }, world);
    } else if (roll < GRANT_SHARE + CHARGE_SHARE) {
      // ---- a charge: the amount is drawn from inside [0, headroom], so it fits by construction ----
      const target = random() < 0.8 && withRoom.length > 0 ? pick(random, withRoom) : pick(random, ids);
      // `undefined` is the library saying it does not know the grant. With the real M3 check that cannot happen to a
      // grant in the tree; it can when a test replaces that check and lets an over-deep chain in. Nothing is charged then.
      const headroom = deps.headroomOf(tree, charges, target) ?? 0;
      const share = Math.floor(random() * (headroom + 1));
      const draw = random();
      const amount = draw < 0.08 ? headroom : draw < 0.14 ? 0 : draw < 0.55 ? share : Math.floor(share * 0.25);
      charges.push({ grantId: target, amount });
      seq += 1;
      log.push("charge");
      observe({ kind: "charge", seed, step, grantId: target, headroom, amount }, world);
    } else {
      // ---- a revoke, of any grant, live or already dead. Mostly a grant that is not a root and often one that has
      // children, so a revoke usually has something below it to absorb or return; sometimes anything at all. ----
      const parents = new Set(ids.map((id) => grants.get(id)?.parent ?? null));
      const inner = ids.filter((id) => parents.has(id) && grants.get(id)?.parent !== null);
      const below = ids.filter((id) => grants.get(id)?.parent !== null);
      const lead = random();
      const target = lead < 0.5 && inner.length > 0 ? pick(random, inner) : lead < 0.8 && below.length > 0 ? pick(random, below) : pick(random, ids);
      const chain = deps.chainOf(tree, target);
      const dead = chain === undefined || deps.firstDeadLink(tree, chain) !== undefined;
      if (dead) {
        log.push("revoke:refused-dead");
        observe({ kind: "revoke", seed, step, target, fate: "refused-dead", before: undefined, after: undefined }, world);
      } else {
        const before = options.snapshots === true ? snapshotOf(world) : undefined;
        seq += 1;
        revokedAt.set(target, seq);
        const after = options.snapshots === true ? snapshotOf(world) : undefined;
        log.push("revoke:revoked");
        observe({ kind: "revoke", seed, step, target, fate: "revoked", before, after }, world);
      }
    }
  }

  return { steps: log, world };
}
