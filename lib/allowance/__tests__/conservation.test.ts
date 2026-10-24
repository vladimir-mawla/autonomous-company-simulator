import { describe, expect, it } from "vitest";
import { chainOf, checkGrantStructure, firstDeadLink } from "../../chain/index.js";
import { grantId } from "../../contracts/index.js";
import type { GrantId } from "../../contracts/index.js";
import { absorbedBy, checkHeadroom, headroomOf, usedOf } from "../index.js";
import { CHARTER, REAL_DEPS, lineLength, liveByData, rootIds, runWorld, subtreeOwnByData } from "./fixtures.js";
import type { DriverEvent, WorldView } from "./fixtures.js";

/**
 * The SAFETY half of the conservation theorem (plan section 4.4, section 6 M4), checked at EVERY prefix of every
 * trace a seeded driver builds, plus the proof that the traces reach what the properties need, plus the proof that the
 * driver adds no rule of its own. The LIVENESS half (the exact-return equality) is `exact-return.test.ts`; the
 * hand-worked numbers are `accounting.test.ts`. They are separate files so a sabotage can be seen to trip one and not
 * the other.
 *
 * WHAT IS CHECKED, after each step of each trace (a step is a grant proposal, a charge or a revoke):
 *   live-headroom-nonnegative   every live grant has `headroomOf` >= 0           (theorem, first clause)
 *   root-not-overspent          every root grant has subtreeOwn <= limit          (theorem, second clause)
 *   root-subtree-monotone       a root grant's subtreeOwn never decreases         (theorem, last clause, for roots)
 *   dead-headroom-zero          every dead grant has `headroomOf` exactly 0      (must refuse: a dead grant with headroom)
 *   boundary                    for a live grant `checkHeadroom` allows exactly its headroom and not one more, and says
 *                               how much there was; for a dead grant it refuses 0 and 1, with headroom 0
 *   absorbed                    `absorbedBy` is a number exactly for a grant with a recorded revocation, is at most its
 *                               limit, and does not change after the revocation (a dead subtree takes no more charges)
 *   unknown-id                  `usedOf`, `headroomOf` and `absorbedBy` give `undefined` for an id outside the tree and
 *                               `checkHeadroom` refuses it with headroom 0     (must refuse: a number for an unknown id)
 *   reservation-fits            a child grant was admitted only with `limit` <= the parent's `headroomOf`, and a refusal
 *                               carries the exact shortfall   (must refuse: reserving more than the parent's headroom)
 * and, about the oracle rather than the library:
 *   oracle-agrees-with-chain    the oracle's liveness equals what `lib/chain` says (`chainOf` + `firstDeadLink`)
 *
 * WHAT "THE THEOREM'S LAST CLAUSE" COVERS HERE: the plan says `subtreeOwn` never decreases. This file checks it for
 * ROOT grants, from the raw charges. That clause is about the charges, not about anything `lib/allowance` returns (the
 * library exposes `subtreeOwn` only through `absorbedBy`), so the library can make it fail only indirectly, by making
 * the driver draw a negative amount; `absorbed` is the library-side counterpart.
 *
 * WHICH NUMBERS COME FROM WHERE. Liveness and the root's subtreeOwn are computed by the oracle from the raw maps
 * (`fixtures.ts`), never by the library. `headroomOf`, `checkHeadroom`, `usedOf` and `absorbedBy` are the library's.
 * The driver builds the trace only from answers of `checkGrantStructure`, `checkHeadroom`, `headroomOf` and
 * `firstDeadLink`, and the describe block "the driver re-implements no predicate" below proves that by handing it stand-ins.
 *
 * To replay a failing case: the failure message carries the seed and step, and `runWorld(seed, ...)` is deterministic.
 */

const SEEDS = 40;
const STEPS = 80;

/**
 * Per-test timeout for every test that reads the shared pass: the first of them to run performs the whole pass, and a
 * filtered run (`-t`) may start anywhere, so they all carry it. vitest's default is 5 s. It is a failure threshold, not
 * a guard against a hang (the pass is synchronous). ADR 0004, Decision 8, gives the measured durations and why SEEDS
 * is not cut further.
 */
const SHARED_PASS_TIMEOUT_MS = 30_000;

type Property =
  | "live-headroom-nonnegative"
  | "root-not-overspent"
  | "root-subtree-monotone"
  | "dead-headroom-zero"
  | "boundary"
  | "absorbed"
  | "unknown-id"
  | "reservation-fits"
  | "oracle-agrees-with-chain";

const PROPERTIES: readonly Property[] = [
  "live-headroom-nonnegative",
  "root-not-overspent",
  "root-subtree-monotone",
  "dead-headroom-zero",
  "boundary",
  "absorbed",
  "unknown-id",
  "reservation-fits",
  "oracle-agrees-with-chain",
];

type Counts = Map<string, number>;
const bump = (counts: Counts, key: string): void => void counts.set(key, (counts.get(key) ?? 0) + 1);

interface Run {
  /** The first few violations of each property, each naming its seed and step. Empty means the property held at every prefix. */
  readonly violations: ReadonlyMap<Property, readonly string[]>;
  readonly tally: Counts;
}

const GHOST: GrantId = grantId("g-ghost");

/** What a world remembers from one prefix to the next. */
interface Memory {
  readonly rootSubtree: Map<GrantId, number>;
  readonly absorbed: Map<GrantId, number>;
}

function runAll(): Run {
  const violations = new Map<Property, string[]>(PROPERTIES.map((property) => [property, []]));
  const tally: Counts = new Map();

  for (let seed = 1; seed <= SEEDS; seed++) {
    const memory: Memory = { rootSubtree: new Map(), absorbed: new Map() };
    runWorld(seed, { steps: STEPS, snapshots: false }, (event, world) => {
      const record = (property: Property, what: string): void => {
        bump(tally, `violations:${property}`);
        const list = violations.get(property);
        if (list !== undefined && list.length < 5) list.push(`seed ${seed}, step ${event.step}: ${what}`);
      };
      classify(event, world, tally);
      checkEvent(event, record);
      checkPrefix(world, memory, tally, record);
    });
  }
  return { violations, tally };
}

let memo: Run | undefined;
/** One pass over all the seeds, shared by every test below (the first to ask pays for it). */
function results(): Run {
  memo ??= runAll();
  return memo;
}

// ---------------------------------------------------------------------------------------------------
// The properties
// ---------------------------------------------------------------------------------------------------

function checkEvent(event: DriverEvent, record: (property: Property, what: string) => void): void {
  if (event.kind !== "grant" || event.parentHeadroom === undefined || event.grant.parent === null) return;
  const { grant, parentHeadroom, fate } = event;
  if (fate.kind === "admitted" && !(grant.limit <= parentHeadroom)) {
    record("reservation-fits", `${grant.id} was admitted with limit ${grant.limit} under ${grant.parent}, whose headroom was ${parentHeadroom}`);
  }
  if (fate.kind === "refused-headroom") {
    const { shortfall } = fate;
    if (!(grant.limit > parentHeadroom)) record("reservation-fits", `${grant.id} (limit ${grant.limit}) was refused by headroom although ${grant.parent} had ${parentHeadroom}`);
    if (shortfall.grantId !== grant.parent || shortfall.requested !== grant.limit || shortfall.headroom !== parentHeadroom) {
      record("reservation-fits", `${grant.id}: the shortfall ${JSON.stringify(shortfall)} is not {${grant.parent}, requested ${grant.limit}, headroom ${parentHeadroom}}`);
    }
  }
}

function checkPrefix(world: WorldView, memory: Memory, tally: Counts, record: (property: Property, what: string) => void): void {
  const { tree, charges } = world;
  bump(tally, "prefixes");

  for (const [id, grant] of tree.grants) {
    const live = liveByData(world, id);
    const chain = chainOf(tree, id);
    if ((chain !== undefined && firstDeadLink(tree, chain) === undefined) !== live) {
      record("oracle-agrees-with-chain", `${id}: the oracle says live=${live}`);
    }

    const room = headroomOf(tree, charges, id);
    if (room === undefined) {
      record(live ? "live-headroom-nonnegative" : "dead-headroom-zero", `${id} is in the tree and headroomOf gave no answer`);
    } else if (live) {
      bump(tally, "live-checks");
      if (room === 0) bump(tally, "live-at-zero");
      if (room < 0) record("live-headroom-nonnegative", `${id} has headroom ${room}`);

      const at = checkHeadroom(tree, charges, id, room);
      const over = checkHeadroom(tree, charges, id, room + 1);
      bump(tally, "boundary-pairs");
      if (!at.ok) record("boundary", `${id}: requesting exactly the headroom (${room}) was refused`);
      if (over.ok) record("boundary", `${id}: requesting one more than the headroom (${room + 1}) was allowed`);
      else if (over.shortfall.grantId !== id || over.shortfall.requested !== room + 1 || over.shortfall.headroom !== room) {
        record("boundary", `${id}: the shortfall ${JSON.stringify(over.shortfall)} is not {${id}, requested ${room + 1}, headroom ${room}}`);
      }
    } else {
      bump(tally, "dead-checks");
      if (grant.limit > 0) bump(tally, "dead-with-positive-limit");
      if (room !== 0) record("dead-headroom-zero", `${id} is dead and has headroom ${room}`);
      for (const requested of [0, 1]) {
        const refusal = checkHeadroom(tree, charges, id, requested);
        if (refusal.ok || refusal.shortfall.grantId !== id || refusal.shortfall.requested !== requested || refusal.shortfall.headroom !== 0) {
          record("boundary", `${id} is dead and requesting ${requested} gave ${JSON.stringify(refusal)}`);
        }
      }
    }

    const absorbed = absorbedBy(tree, charges, id);
    if (tree.revokedAt.has(id)) {
      bump(tally, "absorbed-checks");
      if (absorbed === undefined) record("absorbed", `${id} is revoked and absorbedBy gave no answer`);
      else {
        if (absorbed > grant.limit) record("absorbed", `${id} absorbed ${absorbed}, more than its limit ${grant.limit}`);
        const before = memory.absorbed.get(id);
        if (before !== undefined && before !== absorbed) record("absorbed", `${id} absorbed ${before}, and later ${absorbed}`);
        memory.absorbed.set(id, absorbed);
      }
    } else if (absorbed !== undefined) {
      record("absorbed", `${id} has no recorded revocation and absorbedBy gave ${absorbed}`);
    }
  }

  for (const root of rootIds(world)) {
    const spent = subtreeOwnByData(world, root);
    const limit = tree.grants.get(root)?.limit ?? 0;
    bump(tally, "root-checks");
    if (spent === limit && limit > 0) bump(tally, "root-at-limit");
    if (spent > limit) record("root-not-overspent", `root ${root} has subtreeOwn ${spent} over its limit ${limit}`);
    const before = memory.rootSubtree.get(root);
    if (before !== undefined && spent < before) record("root-subtree-monotone", `root ${root}: subtreeOwn went from ${before} to ${spent}`);
    memory.rootSubtree.set(root, spent);
  }

  bump(tally, "unknown-id-checks");
  const refusal = checkHeadroom(tree, charges, GHOST, 0);
  if (usedOf(tree, charges, GHOST) !== undefined || headroomOf(tree, charges, GHOST) !== undefined || absorbedBy(tree, charges, GHOST) !== undefined) {
    record("unknown-id", "a function gave a number for an id that is not in the tree");
  }
  if (refusal.ok || refusal.shortfall.grantId !== GHOST || refusal.shortfall.requested !== 0 || refusal.shortfall.headroom !== 0) {
    record("unknown-id", `checkHeadroom for an unknown id gave ${JSON.stringify(refusal)}`);
  }
}

// ---------------------------------------------------------------------------------------------------
// What the traces reach: classification of each step, for the coverage assertions
// ---------------------------------------------------------------------------------------------------

/**
 * Count what each step was, with the numbers it was decided on. This reads the event; it does not feed anything back
 * into the driver, so it cannot make a branch look reached that the trace did not take.
 */
function classify(event: DriverEvent, world: WorldView, tally: Counts): void {
  const { tree } = world;
  if (event.kind === "grant") {
    const { grant, parentHeadroom, fate } = event;
    bump(tally, `grant:proposed`);
    if (fate.kind === "admitted") {
      bump(tally, grant.parent === null ? "grant:admitted:root" : "grant:admitted:child");
      if (grant.parent !== null) {
        const parent = tree.grants.get(grant.parent);
        if (parent !== undefined && parent.parent !== null) bump(tally, "grant:admitted:nested");
        if (lineLength(world, grant.id) >= 4) bump(tally, "grant:admitted:four-deep");
        if (parentHeadroom !== undefined && parentHeadroom > 0 && grant.limit === parentHeadroom) bump(tally, "grant:admitted:at-headroom");
        if (grant.limit === 0) bump(tally, "grant:admitted:zero-limit");
      }
    } else if (fate.kind === "refused-headroom") {
      bump(tally, "grant:refused:over-allocation");
      if (parentHeadroom !== undefined && grant.limit === parentHeadroom + 1) bump(tally, "grant:refused:over-allocation:one-over");
    } else {
      bump(tally, `grant:refused:${fate.rejection.kind}`);
    }
  } else if (event.kind === "charge") {
    bump(tally, "charge");
    const grant = tree.grants.get(event.grantId);
    if (event.amount === event.headroom && event.amount > 0) bump(tally, "charge:at-headroom");
    if (event.amount > 0 && event.amount < event.headroom) bump(tally, "charge:below-headroom");
    if (grant !== undefined && grant.parent !== null) bump(tally, "charge:non-root");
    if (event.amount === 0) bump(tally, "charge:zero");
  } else if (event.fate === "revoked") {
    bump(tally, "revoke:applied");
    const target = tree.grants.get(event.target);
    bump(tally, target !== undefined && target.parent === null ? "revoke:applied:root" : "revoke:applied:non-root");
  } else {
    bump(tally, "revoke:refused-dead");
    // refused with a recorded revocation of its own, or dead only because an ancestor was revoked
    bump(tally, tree.revokedAt.has(event.target) ? "revoke:refused-dead:own-revocation" : "revoke:refused-dead:ancestor-revoked");
  }
}

/**
 * What the traces must reach, and how often at least. Each floor is well below (about a third of) what the 40 x 80 run
 * gives, so a change of the driver's dynamics or a sabotaged library that shifts the traces does not trip a floor by
 * accident, while a branch the driver stops reaching does.
 */
const COVERAGE_FLOORS: Readonly<Record<string, number>> = {
  prefixes: SEEDS * STEPS,
  // the shapes of trace the properties need
  "grant:admitted:root": 50,
  "grant:admitted:child": 250,
  "grant:admitted:nested": 120,
  "grant:admitted:four-deep": 25,
  "grant:admitted:at-headroom": 30,
  "grant:refused:over-allocation": 30,
  "grant:refused:over-allocation:one-over": 15,
  "grant:refused:parent-dead": 30,
  charge: 400,
  "charge:at-headroom": 30,
  "charge:below-headroom": 150,
  "charge:non-root": 200,
  "revoke:applied": 40,
  "revoke:applied:root": 5,
  "revoke:applied:non-root": 30,
  "revoke:refused-dead": 25,
  "revoke:refused-dead:own-revocation": 10,
  "revoke:refused-dead:ancestor-revoked": 6,
  // that each property was evaluated, and at its edge
  "live-checks": 5000,
  "live-at-zero": 1500,
  "boundary-pairs": 5000,
  "dead-checks": 1500,
  "dead-with-positive-limit": 1500,
  "absorbed-checks": 1500,
  "root-checks": 1500,
  "root-at-limit": 150,
  "unknown-id-checks": SEEDS * STEPS,
};

// ---------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------

const header = `${SEEDS} seeds x ${STEPS} steps, at every prefix`;

describe(`conservation: ${header}`, () => {
  const holds = (property: Property): void => {
    const found = results().violations.get(property);
    expect(found, `${property} was violated (first few)`).toEqual([]);
  };

  it("every live grant has headroom >= 0", () => holds("live-headroom-nonnegative"), SHARED_PASS_TIMEOUT_MS);
  it("every root grant has subtreeOwn <= its limit", () => holds("root-not-overspent"), SHARED_PASS_TIMEOUT_MS);
  it("a root grant's subtreeOwn never decreases (the oracle's number: this clause constrains the trace, not the library)", () => holds("root-subtree-monotone"), SHARED_PASS_TIMEOUT_MS);
  it("every dead grant has headroom exactly 0", () => holds("dead-headroom-zero"), SHARED_PASS_TIMEOUT_MS);
  it("checkHeadroom allows exactly the headroom and not one more, with the true shortfall; a dead grant is refused at 0 and at 1", () => holds("boundary"), SHARED_PASS_TIMEOUT_MS);
  it("absorbedBy is a number exactly for a revoked grant, at most its limit, and fixed once the grant is revoked", () => holds("absorbed"), SHARED_PASS_TIMEOUT_MS);
  it("usedOf, headroomOf and absorbedBy give undefined for an id outside the tree, and checkHeadroom refuses it with headroom 0", () => holds("unknown-id"), SHARED_PASS_TIMEOUT_MS);
  it("a child grant is admitted only with limit <= the parent's headroom, and a refusal carries the exact shortfall", () => holds("reservation-fits"), SHARED_PASS_TIMEOUT_MS);
  it("the oracle's idea of live agrees with lib/chain's at every grant of every prefix", () => holds("oracle-agrees-with-chain"), SHARED_PASS_TIMEOUT_MS);
});

describe(`COVERAGE: the traces reach each shape named in COVERAGE_FLOORS at least that many times (${header})`, () => {
  it("each count is at least its floor, so each property above was evaluated over many prefixes, at the edges the floors name", () => {
    const { tally } = results();
    const short = Object.entries(COVERAGE_FLOORS)
      .filter(([key, floor]) => (tally.get(key) ?? 0) < floor)
      .map(([key, floor]) => `${key}: ${tally.get(key) ?? 0} < ${floor}`);
    expect(short, `counts ${JSON.stringify([...tally].sort())}`).toEqual([]);
  }, SHARED_PASS_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------------
// The driver adds no rule of its own
// ---------------------------------------------------------------------------------------------------

describe("the driver re-implements no predicate: replace what it consults and its trace changes exactly as far as the replacement allows", () => {
  const WORLDS = 60;
  const play = (deps: Partial<typeof REAL_DEPS>, onEvent: (event: DriverEvent, world: WorldView) => void): number => {
    let charges = 0;
    for (let seed = 1; seed <= WORLDS; seed++) {
      charges += runWorld(seed, { steps: 60, snapshots: false, deps: { ...REAL_DEPS, ...deps } }, onEvent).world.charges.length;
    }
    return charges;
  };

  it("with M4's checkHeadroom replaced by `always ok`, nothing is refused for headroom, and grants are admitted that the real check refuses", () => {
    let proposals = 0;
    let admittedOverHeadroom = 0;
    let refusedForHeadroom = 0;
    play({ checkHeadroom: () => ({ ok: true }) }, (event) => {
      if (event.kind !== "grant" || event.grant.parent === null) return;
      proposals += 1;
      if (event.fate.kind === "refused-headroom") refusedForHeadroom += 1;
      if (event.fate.kind === "admitted" && event.parentHeadroom !== undefined && event.grant.limit > event.parentHeadroom) admittedOverHeadroom += 1;
    });
    expect(proposals).toBeGreaterThan(500);
    expect(refusedForHeadroom).toBe(0);
    expect(admittedOverHeadroom).toBeGreaterThan(20);
  });

  it("with M3's checkGrantStructure replaced by `always ok`, nothing is refused for structure, and grants are admitted that break M3's rules", () => {
    let proposals = 0;
    let refusedForStructure = 0;
    let notHeldByGrantor = 0;
    play({ checkGrantStructure: () => ({ ok: true }) }, (event, world) => {
      if (event.kind !== "grant") return;
      proposals += 1;
      if (event.fate.kind === "refused-structure") refusedForStructure += 1;
      const parent = event.grant.parent === null ? undefined : world.tree.grants.get(event.grant.parent);
      if (event.fate.kind === "admitted" && parent !== undefined && event.grant.grantor !== parent.grantee) notHeldByGrantor += 1;
    });
    expect(proposals).toBeGreaterThan(1000);
    expect(refusedForStructure).toBe(0);
    expect(notHeldByGrantor).toBeGreaterThan(20);
  });

  it("with M3's firstDeadLink replaced by `nothing is dead`, no revoke is refused and some grant is revoked twice; with the real function none is revoked twice", () => {
    const revokes = (deps: Partial<typeof REAL_DEPS>): { applied: number; refused: number; revokedTwice: number } => {
      const out = { applied: 0, refused: 0, revokedTwice: 0 };
      for (let seed = 1; seed <= WORLDS; seed++) {
        const times = new Map<GrantId, number>();
        runWorld(seed, { steps: 60, snapshots: false, deps: { ...REAL_DEPS, ...deps } }, (event) => {
          if (event.kind !== "revoke") return;
          if (event.fate === "refused-dead") out.refused += 1;
          else {
            out.applied += 1;
            times.set(event.target, (times.get(event.target) ?? 0) + 1);
          }
        });
        for (const count of times.values()) if (count > 1) out.revokedTwice += 1;
      }
      return out;
    };
    const stubbed = revokes({ firstDeadLink: () => undefined });
    expect(stubbed.refused).toBe(0);
    expect(stubbed.applied).toBeGreaterThan(200);
    expect(stubbed.revokedTwice).toBeGreaterThan(10);
    const real = revokes({});
    expect(real.refused).toBeGreaterThan(50);
    expect(real.revokedTwice).toBe(0);
  });

  it("with headroomOf replaced by the constant 7, every charge is drawn from [0, 7], all are recorded, and 7 itself is reached", () => {
    const amounts: number[] = [];
    const total = play({ headroomOf: () => 7 }, (event) => {
      if (event.kind === "charge") amounts.push(event.amount);
    });
    expect(total).toBe(amounts.length);
    expect(amounts.length).toBeGreaterThan(500);
    expect(Math.min(...amounts)).toBe(0);
    expect(Math.max(...amounts)).toBe(7);
  });

  it("with headroomOf replaced by the constant 0, every charge is 0: an amount comes from nothing but headroomOf", () => {
    const amounts: number[] = [];
    play({ headroomOf: () => 0 }, (event) => {
      if (event.kind === "charge") amounts.push(event.amount);
    });
    expect(amounts.length).toBeGreaterThan(500);
    expect(Math.max(...amounts)).toBe(0);
  });

  it("every grant the driver refuses is one the published function refuses when asked again in the same state, with the same answer (a refusal changes nothing, so it can be re-asked)", () => {
    let structure = 0;
    let headroom = 0;
    play({}, (event, world) => {
      if (event.kind !== "grant") return;
      if (event.fate.kind === "refused-structure") {
        structure += 1;
        expect(checkGrantStructure(CHARTER, world.tree, event.grant)).toEqual({ ok: false, rejection: event.fate.rejection });
      } else if (event.fate.kind === "refused-headroom" && event.grant.parent !== null) {
        headroom += 1;
        expect(checkHeadroom(world.tree, world.charges, event.grant.parent, event.grant.limit)).toEqual({ ok: false, shortfall: event.fate.shortfall });
      }
    });
    expect(structure).toBeGreaterThan(100);
    expect(headroom).toBeGreaterThan(50);
  });
});

describe("the trace is a function of the seed", () => {
  it("one seed and one set of options replay exactly; a different seed gives a different trace; a trace has one entry per step", () => {
    const first = runWorld(7, { steps: STEPS, snapshots: false });
    const again = runWorld(7, { steps: STEPS, snapshots: false });
    const other = runWorld(8, { steps: STEPS, snapshots: false });
    expect(again.steps).toEqual(first.steps);
    expect(again.world.charges).toEqual(first.world.charges);
    expect([...again.world.tree.grants]).toEqual([...first.world.tree.grants]);
    expect(other.steps).not.toEqual(first.steps);
    expect(first.steps).toHaveLength(STEPS);
  });
});
