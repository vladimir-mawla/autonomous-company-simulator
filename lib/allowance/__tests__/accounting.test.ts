import { describe, expect, it } from "vitest";
import { MAX_AMOUNT, MAX_ROOT_DEPTH } from "../../contracts/index.js";
import type { Charge } from "../../contracts/index.js";
import { absorbedBy, checkHeadroom, headroomOf, usedOf } from "../index.js";
import { CANON, canonAfterRevokingG2, canonBefore, canonCharges, charge, g, grant, mutableTree, treeOf } from "./fixtures.js";

/**
 * The four functions on hand-built trees whose answers are worked out on paper, so a number here is a fact about the
 * plan and not a copy of what the code returns. Three groups:
 *
 *   1. Plan section 7's own figures (headroom 500 000 before the revoke of G2 and 680 000 after, absorbed 220 000,
 *      returned 180 000, the two shortfalls of the canonical incident).
 *   2. The four things the plan says M4 must refuse, each on a minimal tree.
 *   3. The edges: unknown ids, hostile trees, purity, the top of the Amount range, and what is NOT checked.
 *
 * The properties over generated traces are in `conservation.test.ts` and `exact-return.test.ts`; this file is what they
 * are measured against, and the only place that pins `usedOf` of a DEAD grant to a number (`exact-return.test.ts` pins
 * only that it does not change when a grant is revoked).
 */

const headrooms = (tree: ReturnType<typeof treeOf>, charges: readonly Charge[], ids: readonly string[]): Record<string, number | undefined> =>
  Object.fromEntries(ids.map((id) => [id, headroomOf(tree, charges, g(id))]));

describe("plan section 7: the canonical incident's numbers", () => {
  it("at seq 10 (G1 to G6, c1 to c4 charged) the headrooms are G1 500 000, G2 50 000, G4 70 000, G6 28 000", () => {
    const tree = canonBefore();
    const charges = canonCharges();
    expect(headrooms(tree, charges, ["G1", "G2", "G3", "G4", "G5", "G6"])).toEqual({ G1: 500_000, G2: 50_000, G3: 60_000, G4: 70_000, G5: 60_000, G6: 28_000 });
  });

  it("and the used amounts behind them: own spend plus, per child, its whole reservation", () => {
    const tree = canonBefore();
    const charges = canonCharges();
    // G1: no own spend + G2's 400 000 + G3's 100 000.  G2: own 80 000 + G4's 120 000 + G5's 150 000.  G3: G6's 40 000.
    expect(usedOf(tree, charges, g("G1"))).toBe(500_000);
    expect(usedOf(tree, charges, g("G2"))).toBe(350_000);
    expect(usedOf(tree, charges, g("G3"))).toBe(40_000);
    expect(usedOf(tree, charges, g("G4"))).toBe(50_000);
    expect(usedOf(tree, charges, g("G5"))).toBe(90_000);
    expect(usedOf(tree, charges, g("G6"))).toBe(12_000);
  });

  it("revoking G2 at seq 11: absorbed 220 000 (80 000 + 50 000 + 90 000), returned 180 000, G1's headroom 500 000 -> 680 000", () => {
    const before = canonBefore();
    const after = canonAfterRevokingG2();
    const charges = canonCharges();
    const absorbed = absorbedBy(after, charges, g("G2"));
    expect(absorbed).toBe(220_000);
    expect(CANON.G2.limit - (absorbed ?? 0)).toBe(180_000);
    expect(headroomOf(before, charges, g("G1"))).toBe(500_000);
    expect(headroomOf(after, charges, g("G1"))).toBe(680_000);
  });

  it("after the revoke G2, G4 and G5 are dead (headroom 0), and G3 and G6, which are not under G2, are untouched", () => {
    const tree = canonAfterRevokingG2();
    const charges = canonCharges();
    expect(headrooms(tree, charges, ["G2", "G4", "G5", "G3", "G6"])).toEqual({ G2: 0, G4: 0, G5: 0, G3: 60_000, G6: 28_000 });
    expect(usedOf(tree, charges, g("G1"))).toBe(320_000); // G2 now costs what was spent in it (220 000), G3 its 100 000
  });

  it("the cure at seq 17 is a new grant: G7 reserves 60 000 from G1 (680 000 -> 620 000) and c10 then leaves G7 with 50 000", () => {
    const grants = [CANON.G1, CANON.G2, CANON.G3, CANON.G4, CANON.G5, CANON.G6];
    const charges = canonCharges();
    const tree = mutableTree(grants, { G2: 11 });
    expect(checkHeadroom(tree, charges, g("G1"), CANON.G7.limit)).toEqual({ ok: true });
    tree.grants.set(CANON.G7.id, CANON.G7);
    expect(headroomOf(tree, charges, g("G1"))).toBe(620_000);
    charges.push(charge("G7", 10_000));
    expect(headroomOf(tree, charges, g("G7"))).toBe(50_000);
    expect(headroomOf(tree, charges, g("G1"))).toBe(620_000);
  });

  it("the two shortfalls of the canonical incident: over-delegating 200 000 under G2 and refunding 50 000 under G6", () => {
    const tree = canonBefore();
    const charges = canonCharges();
    expect(checkHeadroom(tree, charges, g("G2"), 200_000)).toEqual({ ok: false, shortfall: { grantId: g("G2"), requested: 200_000, headroom: 50_000 } });
    expect(checkHeadroom(tree, charges, g("G6"), 50_000)).toEqual({ ok: false, shortfall: { grantId: g("G6"), requested: 50_000, headroom: 28_000 } });
  });

  it("N / N+1 at every grant of the canonical tree: asking for exactly the headroom is allowed, one more is not and says how much there was", () => {
    const tree = canonBefore();
    const charges = canonCharges();
    for (const id of ["G1", "G2", "G3", "G4", "G5", "G6"]) {
      const room = headroomOf(tree, charges, g(id));
      expect(room, id).toBeDefined();
      expect(checkHeadroom(tree, charges, g(id), room as number), `${id} at the headroom`).toEqual({ ok: true });
      expect(checkHeadroom(tree, charges, g(id), (room as number) + 1), `${id} one over`).toEqual({
        ok: false,
        shortfall: { grantId: g(id), requested: (room as number) + 1, headroom: room },
      });
    }
  });
});

describe("must refuse 1: reserving more than the parent's headroom", () => {
  it("a child may reserve the whole headroom and not one more, and a refusal leaves the parent's numbers where they were", () => {
    const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 1 });
    const tree = treeOf([root]);
    const charges = [charge("R", 30)]; // headroom 70
    expect(checkHeadroom(tree, charges, g("R"), 70)).toEqual({ ok: true });
    expect(checkHeadroom(tree, charges, g("R"), 71)).toEqual({ ok: false, shortfall: { grantId: g("R"), requested: 71, headroom: 70 } });
    expect(headroomOf(tree, charges, g("R"))).toBe(70);
  });

  it("a reservation is a charge on the parent's allowance, spent or not: after it is made the parent's headroom is down by its whole limit", () => {
    const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 1 });
    const child = grant({ id: "C", parent: "R", grantor: "a", grantee: "b", limit: 70 });
    const tree = treeOf([root, child]);
    expect(headroomOf(tree, [], g("R"))).toBe(30);
    expect(headroomOf(tree, [], g("C"))).toBe(70);
    expect(checkHeadroom(tree, [], g("R"), 31)).toEqual({ ok: false, shortfall: { grantId: g("R"), requested: 31, headroom: 30 } });
  });

  it("a parent cannot spend what it has delegated: its own charge is checked against limit minus the reservations", () => {
    const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 1 });
    const child = grant({ id: "C", parent: "R", grantor: "a", grantee: "b", limit: 70 });
    const tree = treeOf([root, child]);
    expect(checkHeadroom(tree, [], g("R"), 30)).toEqual({ ok: true });
    expect(checkHeadroom(tree, [], g("R"), 31).ok).toBe(false);
  });
});

describe("must refuse 2: returning spent authority on revoke (plan failure case 03's numbers)", () => {
  // R has limit 100; C reserves 60 and spends 50; C is revoked.
  const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 1 });
  const child = grant({ id: "C", parent: "R", grantor: "a", grantee: "b", limit: 60 });
  const charges = [charge("C", 50)];

  it("before the revoke R has 40 left (100 - 60), after it 50: the 10 unspent come back and the 50 spent do not", () => {
    expect(headroomOf(treeOf([root, child]), charges, g("R"))).toBe(40);
    const revoked = treeOf([root, child], { C: 2 });
    expect(headroomOf(revoked, charges, g("R"))).toBe(50);
    expect(absorbedBy(revoked, charges, g("C"))).toBe(50);
  });

  it("not 100 (forgiving what was spent) and not 40 (never returning the unspent part)", () => {
    const after = headroomOf(treeOf([root, child], { C: 2 }), charges, g("R"));
    expect(after).not.toBe(100);
    expect(after).not.toBe(40);
  });

  it("so re-granting 60 is refused with the shortfall {60, 50}, re-granting 50 is allowed, and once it is made R has nothing left", () => {
    const revoked = mutableTree([root, child], { C: 2 });
    expect(checkHeadroom(revoked, charges, g("R"), 60)).toEqual({ ok: false, shortfall: { grantId: g("R"), requested: 60, headroom: 50 } });
    expect(checkHeadroom(revoked, charges, g("R"), 50)).toEqual({ ok: true });
    revoked.grants.set(g("C2"), grant({ id: "C2", parent: "R", grantor: "a", grantee: "c", limit: 50 }));
    expect(headroomOf(revoked, charges, g("R"))).toBe(0);
  });

  it("a revoked child that spent nothing returns all of its reservation, and one that spent all of it returns none", () => {
    const none = treeOf([root, child], { C: 2 });
    expect(headroomOf(none, [], g("R"))).toBe(100);
    expect(absorbedBy(none, [], g("C"))).toBe(0);
    const all = treeOf([root, child], { C: 2 });
    expect(headroomOf(all, [charge("C", 60)], g("R"))).toBe(40);
    expect(absorbedBy(all, [charge("C", 60)], g("C"))).toBe(60);
  });
});

describe("must refuse 3: a dead grant having non-zero headroom", () => {
  const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: 500, depth: 3 });
  const mid = grant({ id: "M", parent: "R", grantor: "a", grantee: "b", limit: 200, depth: 2 });
  const leaf = grant({ id: "L", parent: "M", grantor: "b", grantee: "c", limit: 100, depth: 1 });

  it("each is live with its unspent limit, then dead (0) once it, or an ancestor, is revoked", () => {
    expect(headrooms(treeOf([root, mid, leaf]), [], ["R", "M", "L"])).toEqual({ R: 300, M: 100, L: 100 });
    // M revoked: M is dead by its own revocation, L only because M is. L has no revocation of its own.
    const revoked = treeOf([root, mid, leaf], { M: 5 });
    expect(headrooms(revoked, [], ["R", "M", "L"])).toEqual({ R: 500, M: 0, L: 0 });
    expect(revoked.revokedAt.has(g("L"))).toBe(false);
  });

  it("revoking the root kills the whole line, whatever each grant had left", () => {
    expect(headrooms(treeOf([root, mid, leaf], { R: 5 }), [], ["R", "M", "L"])).toEqual({ R: 0, M: 0, L: 0 });
  });

  it("a dead grant's headroom is 0 even though its limit minus its used would be positive", () => {
    const revoked = treeOf([root, mid, leaf], { L: 5 });
    expect(headroomOf(revoked, [], g("L"))).toBe(0);
    expect(usedOf(revoked, [], g("L"))).toBe(0); // limit 100 - used 0 is not what headroomOf reports for a dead grant
  });

  it("checkHeadroom refuses a dead grant whatever the amount, even 0, and reports headroom 0 (plan section 5: unknown/dead => shortfall with headroom 0)", () => {
    const revoked = treeOf([root, mid, leaf], { M: 5 });
    for (const id of ["M", "L"]) {
      for (const requested of [0, 1, 100]) {
        expect(checkHeadroom(revoked, [], g(id), requested), `${id} ${requested}`).toEqual({ ok: false, shortfall: { grantId: g(id), requested, headroom: 0 } });
      }
    }
    // a LIVE grant with nothing left is a different case: asking for 0 is allowed there
    expect(checkHeadroom(treeOf([root]), [charge("R", 500)], g("R"), 0)).toEqual({ ok: true });
  });

  it("a dead grant's `usedOf` is the formula as written (its own spend plus its child's whole limit; the plan defines no `used` for a dead grant), and its headroom is still 0", () => {
    const revoked = treeOf([root, mid, leaf], { M: 5 });
    // used(M) is the formula as written (own 0 + L's whole limit 100): the plan defines no `used` for a dead grant.
    expect(usedOf(revoked, [], g("M"))).toBe(100);
    expect(headroomOf(revoked, [], g("M"))).toBe(0);
  });
});

describe("must refuse 4: usedOf and headroomOf on an unknown id returning a number", () => {
  const tree = treeOf([grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 1 })], { R: 9 });
  const strays = [charge("g-ghost", 40), charge("R", 10)];

  it("all four functions say so for an id the tree does not hold", () => {
    expect(usedOf(tree, strays, g("g-ghost"))).toBeUndefined();
    expect(headroomOf(tree, strays, g("g-ghost"))).toBeUndefined();
    expect(absorbedBy(tree, strays, g("g-ghost"))).toBeUndefined();
    expect(checkHeadroom(tree, strays, g("g-ghost"), 0)).toEqual({ ok: false, shortfall: { grantId: g("g-ghost"), requested: 0, headroom: 0 } });
    expect(checkHeadroom(tree, strays, g("g-ghost"), 25)).toEqual({ ok: false, shortfall: { grantId: g("g-ghost"), requested: 25, headroom: 0 } });
  });

  it("a charge, or a recorded revocation, that names the id does not make it known", () => {
    const stray = mutableTree([grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 1 })]);
    stray.revokedAt.set(g("g-ghost"), 3);
    expect(usedOf(stray, strays, g("g-ghost"))).toBeUndefined();
    expect(headroomOf(stray, strays, g("g-ghost"))).toBeUndefined();
    expect(absorbedBy(stray, strays, g("g-ghost"))).toBeUndefined();
  });

  it("and such a charge adds to nothing: the grants the tree does hold are charged only their own", () => {
    const live = treeOf([grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 1 })]);
    expect(usedOf(live, strays, g("R"))).toBe(10);
    expect(headroomOf(live, strays, g("R"))).toBe(90);
  });
});

describe("absorbedBy: a number only for a grant that is in the tree and has a recorded revocation of its own", () => {
  const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: 1000, depth: 3 });
  const a = grant({ id: "A", parent: "R", grantor: "a", grantee: "b", limit: 600, depth: 2 });
  const b = grant({ id: "B", parent: "A", grantor: "b", grantee: "c", limit: 300, depth: 1 });
  const c = grant({ id: "C", parent: "B", grantor: "c", grantee: "d", limit: 100, depth: 0 });
  const charges = [charge("R", 100), charge("A", 50), charge("B", 20), charge("C", 30)];

  it("is undefined for a live grant, and for a grant that is dead only because an ancestor was revoked", () => {
    const tree = treeOf([root, a, b, c], { B: 4 });
    expect(absorbedBy(tree, charges, g("R"))).toBeUndefined();
    expect(absorbedBy(tree, charges, g("A"))).toBeUndefined();
    expect(absorbedBy(tree, charges, g("C"))).toBeUndefined(); // dead under B, no revocation of its own
    expect(absorbedBy(tree, charges, g("B"))).toBe(50); // B's own 20 and C's 30
  });

  it("counts everything charged anywhere below the grant, including below an already revoked descendant", () => {
    const tree = treeOf([root, a, b, c], { C: 3, B: 4 });
    expect(absorbedBy(tree, charges, g("C"))).toBe(30);
    expect(absorbedBy(tree, charges, g("B"))).toBe(50);
    expect(absorbedBy(treeOf([root, a, b, c], { A: 5 }), charges, g("A"))).toBe(100); // A 50, B 20, C 30
    expect(absorbedBy(treeOf([root, a, b, c], { R: 5 }), charges, g("R"))).toBe(200);
  });
});

describe("nested revocations on a four-link line, worked by hand", () => {
  // R(1000) > A(600) > B(300) > C(100); each also spends: R 100, A 50, B 20, C 30.
  const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: 1000, depth: 3 });
  const a = grant({ id: "A", parent: "R", grantor: "a", grantee: "b", limit: 600, depth: 2 });
  const b = grant({ id: "B", parent: "A", grantor: "b", grantee: "c", limit: 300, depth: 1 });
  const c = grant({ id: "C", parent: "B", grantor: "c", grantee: "d", limit: 100, depth: 0 });
  const charges = [charge("R", 100), charge("A", 50), charge("B", 20), charge("C", 30)];
  const all = [root, a, b, c] as const;
  const room = (revoked: Record<string, number>) => headrooms(treeOf(all, revoked), charges, ["R", "A", "B", "C"]);

  it("nothing revoked: R 300, A 250, B 180, C 70", () => {
    expect(room({})).toEqual({ R: 300, A: 250, B: 180, C: 70 });
  });

  it("revoke C: B gets back 100 - 30 = 70 (180 -> 250), nothing above B moves", () => {
    expect(room({ C: 2 })).toEqual({ R: 300, A: 250, B: 250, C: 0 });
  });

  it("then revoke B: A gets back 300 - 50 = 250 (250 -> 500), R does not move, B and C are dead", () => {
    expect(room({ C: 2, B: 3 })).toEqual({ R: 300, A: 500, B: 0, C: 0 });
  });

  it("then revoke A: R gets back 600 - 100 = 500 (300 -> 800)", () => {
    expect(room({ C: 2, B: 3, A: 4 })).toEqual({ R: 800, A: 0, B: 0, C: 0 });
  });

  it("revoking B first, with C still live, gives A the same 500: a descendant revoked earlier changes nothing above its parent", () => {
    expect(room({ B: 3 })).toEqual({ R: 300, A: 500, B: 0, C: 0 });
  });

  it("revoking the root returns nothing to anyone (there is no parent) and leaves every grant dead", () => {
    expect(room({ R: 2 })).toEqual({ R: 0, A: 0, B: 0, C: 0 });
    expect(absorbedBy(treeOf(all, { R: 2 }), charges, g("R"))).toBe(200);
  });

  it("used of a dead grant is the formula as written: B's used is unchanged by B's own revocation, since it depends on B's children", () => {
    expect(usedOf(treeOf(all, { C: 2 }), charges, g("B"))).toBe(50); // own 20 + C's spent 30
    expect(usedOf(treeOf(all, { C: 2, B: 3 }), charges, g("B"))).toBe(50);
    expect(usedOf(treeOf(all, {}), charges, g("B"))).toBe(120); // own 20 + C's whole limit 100
  });

  it("only WHETHER a revocation is recorded matters, not its seq: recording it again with another seq changes no number", () => {
    const tree = mutableTree(all, { C: 2, B: 3 });
    const first = [headrooms(tree, charges, ["R", "A", "B", "C"]), absorbedBy(tree, charges, g("B")), usedOf(tree, charges, g("A"))];
    tree.revokedAt.set(g("B"), 99);
    tree.revokedAt.set(g("C"), 100);
    expect([headrooms(tree, charges, ["R", "A", "B", "C"]), absorbedBy(tree, charges, g("B")), usedOf(tree, charges, g("A"))]).toEqual(first);
  });
});

describe("hostile trees: a grant whose ancestry cannot be completed is treated as not in the tree", () => {
  const sane = grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 1 });

  it("a grant that is its own parent, two grants that are each other's parent, and a grant whose parent is missing", () => {
    const hostile = [
      grant({ id: "S", parent: "S", grantor: "x", grantee: "y", limit: 5 }),
      grant({ id: "X", parent: "Y", grantor: "x", grantee: "y", limit: 5 }),
      grant({ id: "Y", parent: "X", grantor: "x", grantee: "y", limit: 5 }),
      grant({ id: "O", parent: "nowhere", grantor: "x", grantee: "y", limit: 5 }),
    ];
    const tree = treeOf([sane, ...hostile]);
    // a recorded revocation does not make a floating grant answerable either
    const revoked = treeOf([sane, ...hostile], { S: 3, X: 3, Y: 3, O: 3 });
    for (const id of ["S", "X", "Y", "O"]) {
      expect(usedOf(tree, [charge(id, 1)], g(id)), id).toBeUndefined();
      expect(headroomOf(tree, [charge(id, 1)], g(id)), id).toBeUndefined();
      expect(absorbedBy(revoked, [charge(id, 2)], g(id)), id).toBeUndefined();
      expect(checkHeadroom(tree, [], g(id), 0), id).toEqual({ ok: false, shortfall: { grantId: g(id), requested: 0, headroom: 0 } });
    }
  });

  it("the grants that ARE well-formed are unaffected by them, however many cycles sit beside them", () => {
    const tree = treeOf([
      sane,
      grant({ id: "X", parent: "Y", grantor: "x", grantee: "y", limit: 5 }),
      grant({ id: "Y", parent: "X", grantor: "x", grantee: "y", limit: 5 }),
      grant({ id: "Z", parent: "X", grantor: "x", grantee: "y", limit: 5 }),
    ]);
    expect(headroomOf(tree, [charge("R", 25), charge("X", 9), charge("Z", 9)], g("R"))).toBe(75);
    expect(usedOf(tree, [charge("X", 9)], g("R"))).toBe(0);
  });

  it("the sums below a grant that is well-formed visit each descendant once: a three-deep line under a revoked grant adds up to the plain total", () => {
    const tree = treeOf(
      [
        sane,
        grant({ id: "C", parent: "R", grantor: "a", grantee: "b", limit: 50, depth: 0 }),
        grant({ id: "D", parent: "C", grantor: "b", grantee: "c", limit: 10 }),
        grant({ id: "E", parent: "D", grantor: "c", grantee: "d", limit: 5 }),
      ],
      { C: 2 },
    );
    expect(absorbedBy(tree, [charge("C", 1), charge("D", 2), charge("E", 3)], g("C"))).toBe(6);
  });

  it("a descendant beyond the walker's bound (more than MAX_ROOT_DEPTH + 1 grants deep) is unanswerable itself but is still summed into a revoked ancestor", () => {
    const line = Array.from({ length: MAX_ROOT_DEPTH + 2 }, (_, index) =>
      grant({ id: `L${index}`, parent: index === 0 ? null : `L${index - 1}`, grantor: index === 0 ? "dana" : `q${index - 1}`, grantee: `q${index}`, limit: 100 - index }),
    );
    const deepest = `L${MAX_ROOT_DEPTH + 1}`;
    const charges = [charge(deepest, 7), charge(`L${MAX_ROOT_DEPTH}`, 3)];
    const tree = treeOf(line, { [`L${MAX_ROOT_DEPTH}`]: 9 });
    expect(headroomOf(tree, charges, g(deepest))).toBeUndefined();
    expect(checkHeadroom(tree, charges, g(deepest), 0).ok).toBe(false);
    expect(absorbedBy(tree, charges, g(`L${MAX_ROOT_DEPTH}`))).toBe(10);
    // the root of that line still answers: limit 100, and its child L1 reserves 99
    expect(headroomOf(tree, charges, g("L0"))).toBe(1);
    // N / N+1 on the line's length with nothing revoked: the 8th grant (MAX_ROOT_DEPTH + 1 grants deep, limit 93) answers
    // with what its child (limit 92) leaves it, and the 9th does not answer
    const unrevoked = treeOf(line);
    expect(headroomOf(unrevoked, [], g(`L${MAX_ROOT_DEPTH}`))).toBe(1);
    expect(headroomOf(unrevoked, [], g(deepest))).toBeUndefined();
  });

  it("a grant is found by the KEY it is stored under and its `parent` names that key, not the grant's own `id` field: a child's revocation and charge are read by that key", () => {
    const tree = mutableTree([], { K2: 3 });
    tree.grants.set(g("K1"), grant({ id: "other-1", grantor: "dana", grantee: "a", limit: 100, depth: 1 }));
    tree.grants.set(g("K2"), grant({ id: "other-2", parent: "K1", grantor: "a", grantee: "b", limit: 40 }));
    const charges = [charge("K2", 15)];
    expect(usedOf(tree, charges, g("K1"))).toBe(15); // K2 is revoked: it costs what was spent in it, not its limit 40
    expect(headroomOf(tree, charges, g("K1"))).toBe(85);
    expect(absorbedBy(tree, charges, g("K2"))).toBe(15);
    expect(usedOf(tree, charges, g("other-1"))).toBeUndefined();
    expect(absorbedBy(tree, charges, g("other-2"))).toBeUndefined();
  });
});

describe("purity: the answers are a function of (tree, charges) as they are at the call, and nothing is kept or changed", () => {
  const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 2 });
  const child = grant({ id: "C", parent: "R", grantor: "a", grantee: "b", limit: 60, depth: 1 });

  it("the same tree object and charges array, edited between calls, give the new answer each time", () => {
    const tree = mutableTree([root, child]);
    const charges: Charge[] = [];
    expect(headroomOf(tree, charges, g("R"))).toBe(40);
    charges.push(charge("R", 15));
    expect(headroomOf(tree, charges, g("R"))).toBe(25);
    tree.revokedAt.set(g("C"), 3);
    expect(headroomOf(tree, charges, g("R"))).toBe(85);
    tree.grants.set(g("D"), grant({ id: "D", parent: "R", grantor: "a", grantee: "c", limit: 20, depth: 0 }));
    expect(headroomOf(tree, charges, g("R"))).toBe(65);
    expect(checkHeadroom(tree, charges, g("R"), 65)).toEqual({ ok: true });
    expect(checkHeadroom(tree, charges, g("R"), 66).ok).toBe(false);
  });

  it("no argument is changed by a call, and calling again gives the same answer", () => {
    const tree = mutableTree([root, child], { C: 3 });
    const charges: Charge[] = [charge("R", 15), charge("C", 20)];
    const grantsBefore = [...tree.grants];
    const revokedBefore = [...tree.revokedAt];
    const chargesBefore = charges.map((entry) => ({ ...entry }));
    const run = () => [usedOf(tree, charges, g("R")), headroomOf(tree, charges, g("R")), absorbedBy(tree, charges, g("C")), checkHeadroom(tree, charges, g("R"), 999)];
    const first = run();
    expect(run()).toEqual(first);
    expect([...tree.grants]).toEqual(grantsBefore);
    expect([...tree.revokedAt]).toEqual(revokedBefore);
    expect(charges).toEqual(chargesBefore);
    for (const [id, entry] of tree.grants) expect(entry, id).toBe(grantsBefore.find(([key]) => key === id)?.[1]);
  });

  it("the order of the charges does not matter", () => {
    const tree = treeOf([root, child]);
    const charges = [charge("R", 3), charge("C", 4), charge("R", 5), charge("C", 6)];
    const reversed = [...charges].reverse();
    expect(headroomOf(tree, reversed, g("R"))).toBe(headroomOf(tree, charges, g("R")));
    expect(usedOf(tree, reversed, g("C"))).toBe(usedOf(tree, charges, g("C")));
    expect(usedOf(tree, charges, g("R"))).toBe(68); // own 3 + 5, plus C's whole limit 60
  });
});

describe("the top of the Amount range: the sums are exact at MAX_AMOUNT", () => {
  const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: MAX_AMOUNT, depth: 1 });
  const child = grant({ id: "C", parent: "R", grantor: "a", grantee: "b", limit: MAX_AMOUNT });

  it("a child may reserve all of a root of limit MAX_AMOUNT, leaving 0, and MAX_AMOUNT + 1 is refused with the true shortfall", () => {
    expect(checkHeadroom(treeOf([root]), [], g("R"), MAX_AMOUNT)).toEqual({ ok: true });
    expect(checkHeadroom(treeOf([root]), [], g("R"), MAX_AMOUNT + 1)).toEqual({ ok: false, shortfall: { grantId: g("R"), requested: MAX_AMOUNT + 1, headroom: MAX_AMOUNT } });
    expect(headroomOf(treeOf([root, child]), [], g("R"))).toBe(0);
  });

  it("MAX_AMOUNT - 1 spent in the child, then the child revoked: R gets back exactly 1 and absorbs exactly MAX_AMOUNT - 1", () => {
    const charges = [charge("C", MAX_AMOUNT - 1)];
    expect(headroomOf(treeOf([root, child]), charges, g("C"))).toBe(1);
    const revoked = treeOf([root, child], { C: 2 });
    expect(headroomOf(revoked, charges, g("R"))).toBe(1);
    expect(absorbedBy(revoked, charges, g("C"))).toBe(MAX_AMOUNT - 1);
  });
});

describe("what is NOT checked here (HONEST LIMIT): shape of a requested amount, and an overspent live grant", () => {
  const root = grant({ id: "R", grantor: "dana", grantee: "a", limit: 100, depth: 1 });
  const tree = treeOf([root]);

  it("a live grant charged past its limit (only a hand-built state can be) shows a NEGATIVE headroom: headroomOf does not clamp", () => {
    const charges = [charge("R", 130)];
    expect(usedOf(tree, charges, g("R"))).toBe(130);
    expect(headroomOf(tree, charges, g("R"))).toBe(-30);
    expect(checkHeadroom(tree, charges, g("R"), 0)).toEqual({ ok: false, shortfall: { grantId: g("R"), requested: 0, headroom: -30 } });
  });

  it("a NaN request is refused, because `requested <= headroom` is false for NaN; no plan rule asks for that, it is how the comparison is written", () => {
    const result = checkHeadroom(tree, [], g("R"), Number.NaN);
    expect(result.ok).toBe(false);
  });

  it("a NEGATIVE request is allowed: intake refuses a negative `limit` or `amount`, this layer trusts typed values and does not look", () => {
    expect(checkHeadroom(tree, [], g("R"), -1)).toEqual({ ok: true });
  });
});

describe("an eight-link line (MAX_ROOT_DEPTH + 1 grants, the longest chain M3 admits) with a different charge on every grant: the sums are right at every depth", () => {
  const LIMITS = [1000, 900, 800, 700, 600, 500, 400, 300];
  const SPENT = [1, 2, 4, 8, 16, 32, 64, 128]; // distinct powers of two, so a term left out of any sum shows in the total
  const line = LIMITS.map((limit, index) =>
    grant({ id: `L${index}`, parent: index === 0 ? null : `L${index - 1}`, grantor: index === 0 ? "dana" : `q${index - 1}`, grantee: `q${index}`, limit, depth: Math.max(MAX_ROOT_DEPTH - index, 0) }),
  );
  const charges: Charge[] = SPENT.map((amount, index) => charge(`L${index}`, amount));
  const ids = LIMITS.map((_, index) => `L${index}`);
  const used = (revoked: Record<string, number>) => ids.map((id) => usedOf(treeOf(line, revoked), charges, g(id)));
  const room = (revoked: Record<string, number>) => ids.map((id) => headroomOf(treeOf(line, revoked), charges, g(id)));

  it("is MAX_ROOT_DEPTH + 1 grants long", () => {
    expect(line).toHaveLength(MAX_ROOT_DEPTH + 1);
  });

  it("nothing revoked: used is the grant's own spend plus the next grant's whole limit, at all eight depths", () => {
    expect(used({})).toEqual([901, 802, 704, 608, 516, 432, 364, 128]);
    expect(room({})).toEqual([99, 98, 96, 92, 84, 68, 36, 172]);
  });

  it("revoking the second grant absorbs the spend of the seven grants from it down (2 + 4 + ... + 128 = 254), and the root's headroom is 1000 - (1 + 254)", () => {
    const tree = treeOf(line, { L1: 2 });
    expect(absorbedBy(tree, charges, g("L1"))).toBe(254);
    expect(usedOf(tree, charges, g("L0"))).toBe(255);
    expect(headroomOf(tree, charges, g("L0"))).toBe(745);
  });

  it("revoking the root absorbs all eight (1 + 2 + ... + 128 = 255)", () => {
    expect(absorbedBy(treeOf(line, { L0: 2 }), charges, g("L0"))).toBe(255);
  });

  it("revoking only the deepest grant: its parent's headroom is 400 - (64 + 128)", () => {
    const tree = treeOf(line, { L7: 2 });
    expect(absorbedBy(tree, charges, g("L7"))).toBe(128);
    expect(headroomOf(tree, charges, g("L6"))).toBe(208);
  });

  it("revoking from the bottom up, and a deeper grant before a shallower one: each parent's headroom is its limit less its own spend and what was spent below", () => {
    expect(absorbedBy(treeOf(line, { L7: 2, L6: 3 }), charges, g("L6"))).toBe(192);
    expect(headroomOf(treeOf(line, { L7: 2, L6: 3 }), charges, g("L5"))).toBe(276);
    const tree = treeOf(line, { L5: 2, L3: 3 });
    expect(absorbedBy(tree, charges, g("L3"))).toBe(248);
    expect(absorbedBy(tree, charges, g("L5"))).toBe(224);
    expect(headroomOf(tree, charges, g("L2"))).toBe(548);
  });
});
