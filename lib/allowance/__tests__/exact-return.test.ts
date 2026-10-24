import { describe, expect, it } from "vitest";
import type { GrantId } from "../../contracts/index.js";
import { absorbedBy } from "../index.js";
import { liveByData, runWorld, subtreeMembers, subtreeOwnByData } from "./fixtures.js";
import type { DriverEvent, WorldView } from "./fixtures.js";

/**
 * The LIVENESS half of the conservation theorem (plan section 4.4, section 6 M4): at every revoke of a grant `h`, the
 * unspent part of its reservation comes back to its parent EXACTLY.
 *
 *   headroom(parent) after  =  headroom(parent) before  +  limit(h) - subtreeOwn(h)
 *
 * This is a separate file because it is the property that the safety checks in `conservation.test.ts` cannot see. A
 * revoke that keeps the whole reservation (returns nothing, leaks the authority for good) leaves every inequality true:
 * a parent that is too cautious is still within its limit. Only an equality notices, and it needs the number to
 * compare with. That number, `subtreeOwn(h)`, is taken from the raw charges by the oracle in `fixtures.ts`, never from
 * the library, so the equality is a check of the library against the definition and not of the library against itself.
 *
 * WHAT IS CHECKED, at every revoke the driver applies (the library's numbers just before and just after):
 *   exact-return              headroom(parent) rose by exactly limit(h) - subtreeOwn(h), for a parent that is live
 *   returned-nonnegative      limit(h) - subtreeOwn(h) >= 0: what was spent below h never exceeds h's own limit
 *   absorbed-equals-subtree   absorbedBy(h) is subtreeOwn(h), from the raw charges
 *   used-moves-only-at-parent usedOf changes for no grant except the parent, and for the parent by exactly
 *                             -(limit(h) - subtreeOwn(h)): "never raises used of any other grant", and in fact never
 *                             changes it (this is stronger than the plan's words, and it holds)
 *   live-elsewhere-unchanged  the headroom of every grant that is still live after the revoke, other than the parent,
 *                             is what it was
 *
 * The driver revokes only a grant that M3's `firstDeadLink` finds live (what M5's `already-dead` will do), so every
 * revoke applied here has a live parent or no parent. A revoke of an already-dead grant is REFUSED by the driver and
 * therefore is not a step of any property here; it is counted, in `conservation.test.ts`, so it is known to be
 * reached. The sabotage that removes that refusal is in ADR 0004's ledger and is caught here.
 *
 * To replay a failing case: the failure message carries the seed and step, and `runWorld(seed, ...)` is deterministic.
 */

const SEEDS = 40;
const STEPS = 80;

type Property = "exact-return" | "returned-nonnegative" | "absorbed-equals-subtree" | "used-moves-only-at-parent" | "live-elsewhere-unchanged";
const PROPERTIES: readonly Property[] = ["exact-return", "returned-nonnegative", "absorbed-equals-subtree", "used-moves-only-at-parent", "live-elsewhere-unchanged"];

type Counts = Map<string, number>;
const bump = (counts: Counts, key: string): void => void counts.set(key, (counts.get(key) ?? 0) + 1);

interface Run {
  readonly violations: ReadonlyMap<Property, readonly string[]>;
  readonly tally: Counts;
}

function runAll(): Run {
  const violations = new Map<Property, string[]>(PROPERTIES.map((property) => [property, []]));
  const tally: Counts = new Map();
  for (let seed = 1; seed <= SEEDS; seed++) {
    runWorld(seed, { steps: STEPS, snapshots: true }, (event, world) => {
      if (event.kind !== "revoke" || event.fate !== "revoked") return;
      const record = (property: Property, what: string): void => {
        bump(tally, `violations:${property}`);
        const list = violations.get(property);
        if (list !== undefined && list.length < 5) list.push(`seed ${seed}, step ${event.step}: ${what}`);
      };
      checkRevoke(event, world, tally, record);
    });
  }
  return { violations, tally };
}

let memo: Run | undefined;
function results(): Run {
  memo ??= runAll();
  return memo;
}

function checkRevoke(
  event: Extract<DriverEvent, { kind: "revoke" }>,
  world: WorldView,
  tally: Counts,
  record: (property: Property, what: string) => void,
): void {
  const { before, after } = event;
  if (before === undefined || after === undefined) throw new Error("internal error: an applied revoke has no snapshots");
  const h = event.target;
  const grant = world.tree.grants.get(h);
  if (grant === undefined) throw new Error(`internal error: ${h} is not in the tree`);

  // From the raw charges. A revoke changes no charge, so the world as it stands is the world at the revoke.
  const spent = subtreeOwnByData(world, h);
  const returned = grant.limit - spent;
  const parent = grant.parent;
  const parentIsLive = parent !== null && liveByData(world, parent);

  classify(world, h, spent, returned, parent, parentIsLive, tally);

  if (returned < 0) record("returned-nonnegative", `${h} has limit ${grant.limit} and subtreeOwn ${spent}`);

  const absorbed = absorbedBy(world.tree, world.charges, h);
  if (absorbed !== spent) record("absorbed-equals-subtree", `absorbedBy(${h}) = ${absorbed}, subtreeOwn from the charges = ${spent}`);

  if (parent !== null && parentIsLive) {
    const was = before.headroom.get(parent);
    const now = after.headroom.get(parent);
    if (was === undefined || now === undefined || now - was !== returned) {
      record("exact-return", `revoking ${h} (limit ${grant.limit}, subtreeOwn ${spent}) moved headroom(${parent}) from ${was} to ${now}; expected +${returned}`);
    }
  }

  for (const [id, usedBefore] of before.used) {
    const usedAfter = after.used.get(id);
    const expected = id === parent && usedBefore !== undefined ? usedBefore - returned : usedBefore;
    if (usedAfter !== expected) record("used-moves-only-at-parent", `revoking ${h}: used(${id}) went from ${usedBefore} to ${usedAfter}; expected ${expected}`);
  }

  for (const [id, roomBefore] of before.headroom) {
    if (id === parent || !liveByData(world, id)) continue;
    const roomAfter = after.headroom.get(id);
    if (roomAfter !== roomBefore) record("live-elsewhere-unchanged", `revoking ${h}: headroom(${id}) went from ${roomBefore} to ${roomAfter}`);
  }
}

/** Count what this revoke was, so the floors below can show that each branch the equality needs was taken. */
function classify(world: WorldView, h: GrantId, spent: number, returned: number, parent: GrantId | null, parentIsLive: boolean, tally: Counts): void {
  const grant = world.tree.grants.get(h);
  if (grant === undefined) return;
  bump(tally, "revoke:applied");
  if (parent === null) {
    bump(tally, "revoke:root");
    return;
  }
  if (parentIsLive) bump(tally, "revoke:with-live-parent");
  const parentGrant = world.tree.grants.get(parent);
  bump(tally, parentGrant !== undefined && parentGrant.parent === null ? "revoke:parent-is-root" : "revoke:parent-is-child");

  if (returned > 0) bump(tally, "revoke:returns-something");
  if (returned === 0) bump(tally, "revoke:returns-nothing");
  if (spent === 0) bump(tally, "revoke:nothing-spent");
  if (spent > 0 && returned > 0) bump(tally, "revoke:partly-spent");
  if (spent > 0 && returned === 0) bump(tally, "revoke:fully-spent");

  const own = world.charges.filter((entry) => entry.grantId === h).reduce((sum, entry) => sum + entry.amount, 0);
  if (spent > own) bump(tally, "revoke:spend-below");
  if (spent > own && returned > 0) bump(tally, "revoke:spend-below-and-returns");

  const below = [...subtreeMembers(world, h)].filter((id) => id !== h);
  if (below.length > 0) bump(tally, "revoke:has-descendants");
  if (below.some((id) => world.tree.revokedAt.has(id))) bump(tally, "revoke:descendant-already-revoked");
  if (below.some((id) => world.tree.revokedAt.has(id)) && returned > 0) bump(tally, "revoke:descendant-already-revoked-and-returns");
}

/**
 * What the revokes must reach, and how often at least. Each floor is well below (about a third of) what the 40 x 80 run
 * gives, for the reason given in `conservation.test.ts`.
 */
const COVERAGE_FLOORS: Readonly<Record<string, number>> = {
  "revoke:applied": 50,
  "revoke:root": 5,
  "revoke:with-live-parent": 40,
  "revoke:parent-is-root": 25,
  "revoke:parent-is-child": 12,
  "revoke:returns-something": 35,
  "revoke:returns-nothing": 8,
  "revoke:nothing-spent": 20,
  "revoke:partly-spent": 15,
  "revoke:fully-spent": 4,
  "revoke:spend-below": 8,
  "revoke:spend-below-and-returns": 6,
  "revoke:has-descendants": 20,
  "revoke:descendant-already-revoked": 3,
  "revoke:descendant-already-revoked-and-returns": 3,
};

const header = `${SEEDS} seeds x ${STEPS} steps, at every revoke`;

describe(`exact return: ${header}`, () => {
  const holds = (property: Property): void => {
    expect(results().violations.get(property), `${property} was violated (first few)`).toEqual([]);
  };

  it("revoking h raises its live parent's headroom by exactly limit(h) - subtreeOwn(h)", () => holds("exact-return"));
  it("limit(h) - subtreeOwn(h) is never negative: what was spent below h never exceeds h's limit", () => holds("returned-nonnegative"));
  it("absorbedBy(h) is subtreeOwn(h), computed from the raw charges", () => holds("absorbed-equals-subtree"));
  it("usedOf changes for no grant but the parent, and for the parent by exactly the amount returned", () => holds("used-moves-only-at-parent"));
  it("the headroom of every grant that is still live after the revoke, other than the parent, is unchanged", () => holds("live-elsewhere-unchanged"));
});

describe(`COVERAGE: the revokes reach every branch the equality needs (${header})`, () => {
  it("each count is at least its floor, so the equality was not checked only where it is trivial", () => {
    const { tally } = results();
    const short = Object.entries(COVERAGE_FLOORS)
      .filter(([key, floor]) => (tally.get(key) ?? 0) < floor)
      .map(([key, floor]) => `${key}: ${tally.get(key) ?? 0} < ${floor}`);
    expect(short, `counts ${JSON.stringify([...tally].sort())}`).toEqual([]);
  });
});
