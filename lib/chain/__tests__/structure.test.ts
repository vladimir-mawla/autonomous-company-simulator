import { describe, expect, it } from "vitest";
import { MAX_ROOT_DEPTH } from "../../contracts/index.js";
import type { Charter, Grant, GrantTree } from "../../contracts/index.js";
import { checkGrantStructure } from "../index.js";
import type { StructureRejection } from "../index.js";
import { CANON, CAPABILITIES, CHARTER, canonAfterRevokingG2, canonBefore, g, grant, p, treeOf } from "./fixtures.js";
import type { Cap, GrantSpec } from "./fixtures.js";

/**
 * `checkGrantStructure`: the nine structural refusals, one table row each, and the order they are reported in.
 *
 * HOW THE TABLE IS MADE MASKING-AWARE. A rejection reports only the FIRST failing rule, so a fixture that breaks
 * rule R can also break rules after R without anyone noticing, and then deleting R makes the fixture fail with
 * a different rule instead of passing. Every row therefore carries two scenarios: `violating`, which must be
 * refused with exactly `expected`, and `repaired`, which differs from it by the ONE change that fixes that rule
 * and must be accepted. If `violating` also broke a later rule, `repaired` would be refused by it and the row
 * would fail. A row passing is the proof that its fixture violates only its own rule.
 *
 * (The plan's note that `parent-dead` needs `limit: 0` is about M5: a dead grant's headroom is 0, so a positive
 * `limit` would be reported there as `over-allocation` before `parent-dead`. `checkGrantStructure` never reads
 * `limit`, so nothing here can be masked that way; the `parent-dead` rows keep `limit: 0` anyway, so the same
 * fixtures stay isolating once M5 composes this check with M4's headroom.)
 */

interface Scenario {
  readonly charter: Charter<Cap>;
  readonly tree: GrantTree<Cap>;
  readonly grant: Grant<Cap>;
}

const TWO_ROOTS: Charter<Cap> = { roots: [p("dana"), p("eve")], capabilities: CAPABILITIES };

const scenario = (candidate: Grant<Cap>, tree: GrantTree<Cap> = canonBefore(), charter: Charter<Cap> = CHARTER): Scenario => ({ charter, tree, grant: candidate });
const run = (s: Scenario) => checkGrantStructure(s.charter, s.tree, s.grant);

/**
 * A grant that is valid under plan section 7's G2 (held by `ops`, capabilities purchase and sign-contract, depth 3):
 * a new grantee, a subset of capabilities, a depth below the parent's, limit 0. A row changes one field of it.
 */
const under = (spec: Partial<GrantSpec> = {}): Grant<Cap> =>
  grant({ id: "G8", parent: "G2", grantor: "ops", grantee: "buyer-c", capabilities: ["purchase"], limit: 0, depth: 2, ...spec });

/** A straight line of three grants: dana -> a -> b -> c, depth 4, 3, 2. A new grant is made by `c`. */
const LINE = [
  grant({ id: "L0", grantor: "dana", grantee: "a", capabilities: ["purchase", "refund", "hire", "sign-contract"], depth: 4 }),
  grant({ id: "L1", parent: "L0", grantor: "a", grantee: "b", capabilities: ["purchase", "refund", "hire", "sign-contract"], depth: 3 }),
  grant({ id: "L2", parent: "L1", grantor: "b", grantee: "c", capabilities: ["purchase", "refund", "hire", "sign-contract"], depth: 2 }),
];
const underL2 = grant({ id: "N", parent: "L2", grantor: "c", grantee: "d", capabilities: ["purchase"], limit: 0, depth: 1 });

/** G4 with its depth raised from 0 to 1, so a grant under it has a delegation hop to use. */
const canonWithDepthOneG4 = (): GrantTree<Cap> =>
  treeOf([CANON.G1, CANON.G2, CANON.G3, { ...CANON.G4, depth: 1 }, CANON.G5, CANON.G6]);

/** `n` grants in a line from a root, each holding the next one's parent role; depths are not narrowed (a hand-built tree). */
const longLine = (n: number): Grant<Cap>[] =>
  Array.from({ length: n }, (_, index) =>
    grant({ id: `H${index}`, parent: index === 0 ? null : `H${index - 1}`, grantor: index === 0 ? "dana" : `m${index}`, grantee: `m${index + 1}`, depth: 3 }),
  );

/** Two grants that are each other's parent, plus a root X' that gives X a way out when `fixed`. */
const cyclicTree = (fixed: boolean): GrantTree<Cap> =>
  treeOf([
    ...[CANON.G1, CANON.G2, CANON.G3, CANON.G4, CANON.G5, CANON.G6],
    grant({ id: "X", parent: fixed ? null : "Y", grantor: "dana", grantee: "m", capabilities: ["purchase", "refund"], depth: 3 }),
    grant({ id: "Y", parent: "X", grantor: "m", grantee: "o", capabilities: ["purchase"], depth: 1 }),
  ]);

interface Row {
  readonly name: string;
  readonly violating: Scenario;
  readonly repaired: Scenario;
  readonly expected: StructureRejection;
}

const ROWS: readonly Row[] = [
  // ---- duplicate-id ----
  {
    name: "duplicate-id: reuses G3 (plan section 7)",
    violating: scenario(under({ id: "G3" })),
    repaired: scenario(under({ id: "G8" })),
    expected: { kind: "duplicate-id", id: "G3" },
  },
  {
    name: "duplicate-id: reuses the id of a REVOKED grant (an id is never free again)",
    violating: scenario(grant({ id: "G2", parent: "G1", grantor: "cfo", grantee: "buyer-c", capabilities: ["purchase"], depth: 2 }), canonAfterRevokingG2()),
    repaired: scenario(grant({ id: "G9", parent: "G1", grantor: "cfo", grantee: "buyer-c", capabilities: ["purchase"], depth: 2 }), canonAfterRevokingG2()),
    expected: { kind: "duplicate-id", id: "G2" },
  },
  {
    name: "duplicate-id: a root grant reusing G1",
    violating: scenario(grant({ id: "G1", grantor: "dana", grantee: "buyer-c", depth: 2 })),
    repaired: scenario(grant({ id: "R9", grantor: "dana", grantee: "buyer-c", depth: 2 })),
    expected: { kind: "duplicate-id", id: "G1" },
  },
  // ---- not-a-root ----
  {
    name: "not-a-root: intern mints a root grant (plan section 7)",
    violating: scenario(grant({ id: "R1", grantor: "intern", grantee: "x", depth: 2 })),
    repaired: scenario(grant({ id: "R1", grantor: "dana", grantee: "x", depth: 2 })),
    expected: { kind: "not-a-root", grantor: p("intern") },
  },
  {
    name: "not-a-root: eve is not a root of THIS charter (the charter is what decides)",
    violating: scenario(grant({ id: "R1", grantor: "eve", grantee: "x", depth: 2 })),
    repaired: scenario(grant({ id: "R1", grantor: "eve", grantee: "x", depth: 2 }), canonBefore(), TWO_ROOTS),
    expected: { kind: "not-a-root", grantor: p("eve") },
  },
  // ---- unknown-parent ----
  {
    name: "unknown-parent: parent g-ghost (plan section 7)",
    violating: scenario(under({ parent: "g-ghost" })),
    repaired: scenario(under({ parent: "G2" })),
    expected: { kind: "unknown-parent", parent: g("g-ghost") },
  },
  {
    name: "unknown-parent: a parent whose own ancestry loops (only a hand-built tree has one)",
    violating: scenario(grant({ id: "G8", parent: "X", grantor: "m", grantee: "n", capabilities: ["purchase"], depth: 1 }), cyclicTree(false)),
    repaired: scenario(grant({ id: "G8", parent: "X", grantor: "m", grantee: "n", capabilities: ["purchase"], depth: 1 }), cyclicTree(true)),
    expected: { kind: "unknown-parent", parent: g("X") },
  },
  {
    name: "unknown-parent: a parent whose ancestry is longer than MAX_ROOT_DEPTH + 1 grants",
    violating: scenario(grant({ id: "G8", parent: `H${MAX_ROOT_DEPTH + 1}`, grantor: `m${MAX_ROOT_DEPTH + 2}`, grantee: "n", capabilities: ["purchase"], depth: 2 }), treeOf(longLine(MAX_ROOT_DEPTH + 2))),
    repaired: scenario(grant({ id: "G8", parent: `H${MAX_ROOT_DEPTH}`, grantor: `m${MAX_ROOT_DEPTH + 1}`, grantee: "n", capabilities: ["purchase"], depth: 2 }), treeOf(longLine(MAX_ROOT_DEPTH + 2))),
    expected: { kind: "unknown-parent", parent: g(`H${MAX_ROOT_DEPTH + 1}`) },
  },
  // ---- parent-dead (limit 0 throughout: see the file comment) ----
  {
    name: "parent-dead: G2 was revoked at seq 11, ops tries to grant under it (plan section 7, limit 0)",
    violating: scenario(under({ limit: 0 }), canonAfterRevokingG2()),
    repaired: scenario(under({ limit: 0 }), canonBefore()),
    expected: { kind: "parent-dead", deadGrant: g("G2") },
  },
  {
    name: "parent-dead: a revoked ANCESTOR while the parent itself is live (L1 revoked, grant under L2)",
    violating: scenario(underL2, treeOf(LINE, { L1: 20 })),
    repaired: scenario(underL2, treeOf(LINE)),
    expected: { kind: "parent-dead", deadGrant: g("L1") },
  },
  {
    name: "parent-dead: the root grant is revoked",
    violating: scenario(underL2, treeOf(LINE, { L0: 20 })),
    repaired: scenario(underL2, treeOf(LINE)),
    expected: { kind: "parent-dead", deadGrant: g("L0") },
  },
  {
    name: "parent-dead: the parent itself is revoked",
    violating: scenario(underL2, treeOf(LINE, { L2: 20 })),
    repaired: scenario(underL2, treeOf(LINE)),
    expected: { kind: "parent-dead", deadGrant: g("L2") },
  },
  {
    name: "parent-dead: with several revoked links the one nearest the root is named, not the first revoked in time",
    violating: scenario(underL2, treeOf(LINE, { L2: 10, L1: 30 })),
    repaired: scenario(underL2, treeOf(LINE)),
    expected: { kind: "parent-dead", deadGrant: g("L1") },
  },
  // ---- grantor-not-holder ----
  {
    name: "grantor-not-holder: cfo made G2 but ops holds it",
    violating: scenario(under({ grantor: "cfo" })),
    repaired: scenario(under({ grantor: "ops" })),
    expected: { kind: "grantor-not-holder", parent: g("G2"), grantor: p("cfo"), holder: p("ops") },
  },
  {
    name: "grantor-not-holder: buyer-b delegates under ops' G2 (plan section 7)",
    violating: scenario(under({ grantor: "buyer-b" })),
    repaired: scenario(under({ grantor: "ops" })),
    expected: { kind: "grantor-not-holder", parent: g("G2"), grantor: p("buyer-b"), holder: p("ops") },
  },
  {
    name: "grantor-not-holder: the charter root is not the holder of a grant below the root grant",
    violating: scenario(under({ grantor: "dana" })),
    repaired: scenario(under({ grantor: "ops" })),
    expected: { kind: "grantor-not-holder", parent: g("G2"), grantor: p("dana"), holder: p("ops") },
  },
  // ---- capability-widening (G2 holds purchase and sign-contract) ----
  {
    name: "capability-widening: purchase kept, hire added (plan section 7). One shared capability is not enough",
    violating: scenario(under({ capabilities: ["purchase", "hire"] })),
    repaired: scenario(under({ capabilities: ["purchase"] })),
    expected: { kind: "capability-widening", capability: "hire" },
  },
  {
    name: "capability-widening: nothing in common with the parent",
    violating: scenario(under({ capabilities: ["hire"] })),
    repaired: scenario(under({ capabilities: ["sign-contract"] })),
    expected: { kind: "capability-widening", capability: "hire" },
  },
  {
    name: "capability-widening: the first outsider in the child's own order is named",
    violating: scenario(under({ capabilities: ["refund", "hire", "purchase"] })),
    repaired: scenario(under({ capabilities: ["purchase"] })),
    expected: { kind: "capability-widening", capability: "refund" },
  },
  // ---- depth-exhausted ----
  {
    name: "depth-exhausted: buyer-a holds G4 at depth 0 and delegates anyway (plan section 7)",
    violating: scenario(grant({ id: "G8", parent: "G4", grantor: "buyer-a", grantee: "buyer-c", capabilities: ["purchase"], depth: 0 })),
    repaired: scenario(grant({ id: "G8", parent: "G4", grantor: "buyer-a", grantee: "buyer-c", capabilities: ["purchase"], depth: 0 }), canonWithDepthOneG4()),
    expected: { kind: "depth-exhausted", parent: g("G4") },
  },
  // ---- depth-not-narrowed (G2 has depth 3) ----
  {
    name: "depth-not-narrowed: depth 3 under a depth-3 parent (plan section 7)",
    violating: scenario(under({ depth: 3 })),
    repaired: scenario(under({ depth: 2 })),
    expected: { kind: "depth-not-narrowed", parentDepth: 3, requested: 3 },
  },
  {
    name: "depth-not-narrowed: a child deeper than its parent",
    violating: scenario(under({ depth: 4 })),
    repaired: scenario(under({ depth: 0 })),
    expected: { kind: "depth-not-narrowed", parentDepth: 3, requested: 4 },
  },
  {
    name: "depth-not-narrowed: the largest depth intake allows",
    violating: scenario(under({ depth: MAX_ROOT_DEPTH })),
    repaired: scenario(under({ depth: 1 })),
    expected: { kind: "depth-not-narrowed", parentDepth: 3, requested: MAX_ROOT_DEPTH },
  },
  // ---- principal-cycle (trail under G2 is dana, cfo, ops) ----
  {
    name: "principal-cycle: cfo as grantee under G2 (plan section 7)",
    violating: scenario(under({ grantee: "cfo" })),
    repaired: scenario(under({ grantee: "buyer-c" })),
    expected: { kind: "principal-cycle", principal: p("cfo") },
  },
  {
    name: "principal-cycle: delegating to oneself",
    violating: scenario(under({ grantee: "ops" })),
    repaired: scenario(under({ grantee: "buyer-c" })),
    expected: { kind: "principal-cycle", principal: p("ops") },
  },
  {
    name: "principal-cycle: back to the charter root of its own chain",
    violating: scenario(under({ grantee: "dana" })),
    repaired: scenario(under({ grantee: "buyer-c" })),
    expected: { kind: "principal-cycle", principal: p("dana") },
  },
  {
    name: "principal-cycle: a root grant to its own grantor",
    violating: scenario(grant({ id: "R2", grantor: "dana", grantee: "dana", depth: 2 })),
    repaired: scenario(grant({ id: "R2", grantor: "dana", grantee: "buyer-c", depth: 2 })),
    expected: { kind: "principal-cycle", principal: p("dana") },
  },
];

const NINE_KINDS = {
  "duplicate-id": true,
  "not-a-root": true,
  "unknown-parent": true,
  "parent-dead": true,
  "grantor-not-holder": true,
  "capability-widening": true,
  "depth-exhausted": true,
  "depth-not-narrowed": true,
  "principal-cycle": true,
} satisfies Record<StructureRejection["kind"], true>;

describe("each structural refusal: its fixture is refused for that rule alone, and accepted once that rule is repaired", () => {
  it.each(ROWS.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(run(row.violating)).toEqual({ ok: false, rejection: row.expected });
    expect(run(row.repaired)).toEqual({ ok: true });
  });

  it("the table covers all nine StructureRejection kinds (the key list is tied to the type, so a tenth kind fails typecheck)", () => {
    expect([...new Set(ROWS.map((row) => row.expected.kind))].sort()).toEqual(Object.keys(NINE_KINDS).sort());
  });
});

describe("precedence: a grant that breaks two rules is refused for the first, and the second shows once the first is repaired", () => {
  interface Pair {
    readonly name: string;
    readonly both: Scenario;
    readonly first: StructureRejection;
    readonly afterFirstRepaired: Scenario;
    readonly second: StructureRejection;
  }

  const PAIRS: readonly Pair[] = [
    {
      name: "duplicate-id before not-a-root",
      both: scenario(grant({ id: "G1", grantor: "intern", grantee: "x", depth: 2 })),
      first: { kind: "duplicate-id", id: "G1" },
      afterFirstRepaired: scenario(grant({ id: "R1", grantor: "intern", grantee: "x", depth: 2 })),
      second: { kind: "not-a-root", grantor: p("intern") },
    },
    {
      name: "duplicate-id before unknown-parent",
      both: scenario(under({ id: "G3", parent: "g-ghost" })),
      first: { kind: "duplicate-id", id: "G3" },
      afterFirstRepaired: scenario(under({ id: "G8", parent: "g-ghost" })),
      second: { kind: "unknown-parent", parent: g("g-ghost") },
    },
    {
      name: "parent-dead before grantor-not-holder",
      both: scenario(under({ grantor: "cfo" }), canonAfterRevokingG2()),
      first: { kind: "parent-dead", deadGrant: g("G2") },
      afterFirstRepaired: scenario(under({ grantor: "cfo" }), canonBefore()),
      second: { kind: "grantor-not-holder", parent: g("G2"), grantor: p("cfo"), holder: p("ops") },
    },
    {
      name: "grantor-not-holder before capability-widening",
      both: scenario(under({ grantor: "cfo", capabilities: ["hire"] })),
      first: { kind: "grantor-not-holder", parent: g("G2"), grantor: p("cfo"), holder: p("ops") },
      afterFirstRepaired: scenario(under({ grantor: "ops", capabilities: ["hire"] })),
      second: { kind: "capability-widening", capability: "hire" },
    },
    {
      name: "capability-widening before depth-exhausted",
      both: scenario(grant({ id: "G8", parent: "G4", grantor: "buyer-a", grantee: "buyer-c", capabilities: ["refund"], depth: 0 })),
      first: { kind: "capability-widening", capability: "refund" },
      afterFirstRepaired: scenario(grant({ id: "G8", parent: "G4", grantor: "buyer-a", grantee: "buyer-c", capabilities: ["purchase"], depth: 0 })),
      second: { kind: "depth-exhausted", parent: g("G4") },
    },
    {
      name: "depth-exhausted before depth-not-narrowed (a depth-0 parent makes every child depth 'not narrowed' too)",
      both: scenario(grant({ id: "G8", parent: "G4", grantor: "buyer-a", grantee: "buyer-c", capabilities: ["purchase"], depth: 1 })),
      first: { kind: "depth-exhausted", parent: g("G4") },
      afterFirstRepaired: scenario(grant({ id: "G8", parent: "G4", grantor: "buyer-a", grantee: "buyer-c", capabilities: ["purchase"], depth: 1 }), canonWithDepthOneG4()),
      second: { kind: "depth-not-narrowed", parentDepth: 1, requested: 1 },
    },
    {
      name: "depth-not-narrowed before principal-cycle",
      both: scenario(under({ depth: 3, grantee: "cfo" })),
      first: { kind: "depth-not-narrowed", parentDepth: 3, requested: 3 },
      afterFirstRepaired: scenario(under({ depth: 2, grantee: "cfo" })),
      second: { kind: "principal-cycle", principal: p("cfo") },
    },
    {
      name: "not-a-root before principal-cycle (for a root grant)",
      both: scenario(grant({ id: "R1", grantor: "intern", grantee: "intern", depth: 2 })),
      first: { kind: "not-a-root", grantor: p("intern") },
      afterFirstRepaired: scenario(grant({ id: "R1", grantor: "intern", grantee: "intern", depth: 2 }), canonBefore(), { roots: [p("dana"), p("intern")], capabilities: CAPABILITIES }),
      second: { kind: "principal-cycle", principal: p("intern") },
    },
  ];

  it.each(PAIRS.map((pair) => [pair.name, pair] as const))("%s", (_name, pair) => {
    expect(run(pair.both)).toEqual({ ok: false, rejection: pair.first });
    expect(run(pair.afterFirstRepaired)).toEqual({ ok: false, rejection: pair.second });
  });

  it("an unknown parent hides everything that is judged against the parent", () => {
    const everythingWrong = under({ parent: "g-ghost", grantor: "buyer-b", capabilities: ["hire"], depth: 7, grantee: "cfo" });
    expect(run(scenario(everythingWrong))).toEqual({ ok: false, rejection: { kind: "unknown-parent", parent: g("g-ghost") } });
  });
});

describe("what is accepted", () => {
  it.each([
    ["a grant valid under G2", scenario(under())],
    ["the parent's exact capability set (a subset includes the whole set)", scenario(under({ capabilities: ["purchase", "sign-contract"] }))],
    ["the largest depth below the parent's (parent 3, child 2)", scenario(under({ depth: 2 }))],
    ["depth 0", scenario(under({ depth: 0 }))],
    ["a root grant by dana at the largest depth", scenario(grant({ id: "R1", grantor: "dana", grantee: "x", depth: MAX_ROOT_DEPTH }))],
    ["a second root grant by the same root (a root may issue many; plan section 10, failure case 04)", scenario(grant({ id: "R2", grantor: "dana", grantee: "buyer-c", depth: 1 }))],
    ["a root grant by the second root of a two-root charter", scenario(grant({ id: "R3", grantor: "eve", grantee: "x", depth: 1 }), canonBefore(), TWO_ROOTS)],
    ["a root grant to a DIFFERENT charter root (not on its chain: plan section 10's rejected `grantee-is-root`)", scenario(grant({ id: "R4", grantor: "dana", grantee: "eve", depth: 1 }), canonBefore(), TWO_ROOTS)],
    ["a delegation to a different root than the chain's", scenario(under({ grantee: "eve" }), canonBefore(), TWO_ROOTS)],
    ["the cure grant G7 after G2 was revoked (plan section 7, seq 17): a NEW grant, not a relabelling", scenario(CANON.G7, canonAfterRevokingG2())],
    ["a grantee who already holds another grant elsewhere (buyer-a holds G4 and is granted G7)", scenario(CANON.G7)],
  ])("%s", (_label, s) => {
    expect(run(s)).toEqual({ ok: true });
  });

  it("limit is not a structural matter: plan section 7's 200 000 over-delegation against a headroom of 50 000 passes here (M5's `over-allocation`)", () => {
    expect(run(scenario(under({ limit: 200_000 })))).toEqual({ ok: true });
    expect(run(scenario(under({ limit: 2 ** 40 })))).toEqual({ ok: true });
  });

  it("limit is never read: a grant whose `limit` getter throws is still judged", () => {
    const hostileLimit = Object.defineProperty({ ...under() }, "limit", {
      enumerable: true,
      get(): never {
        throw new Error("limit was read");
      },
    });
    expect(run(scenario(hostileLimit as Grant<Cap>))).toEqual({ ok: true });
  });
});

describe("it only looks", () => {
  it("does not change the tree or the grant, and gives the same answer twice", () => {
    const tree = canonAfterRevokingG2();
    const candidate = under({ grantor: "cfo" });
    const snapshot = JSON.stringify([[...tree.grants], [...tree.revokedAt], candidate]);
    const first = checkGrantStructure(CHARTER, tree, candidate);
    const second = checkGrantStructure(CHARTER, tree, candidate);
    expect(first).toEqual(second);
    expect(JSON.stringify([[...tree.grants], [...tree.revokedAt], candidate])).toBe(snapshot);
  });

  it("a refused grant is not added: the tree is the caller's to extend", () => {
    const tree = canonBefore();
    checkGrantStructure(CHARTER, tree, under({ grantor: "cfo" }));
    expect(tree.grants.has(g("G8"))).toBe(false);
  });
});

describe("every grant of plan section 7's tree is accepted when added in order, and G7 after the revocation", () => {
  it("G1 to G6 are admitted one after another by the same check", () => {
    const admitted: Grant<Cap>[] = [];
    for (const entry of [CANON.G1, CANON.G2, CANON.G3, CANON.G4, CANON.G5, CANON.G6]) {
      expect(checkGrantStructure(CHARTER, treeOf(admitted), entry), entry.id).toEqual({ ok: true });
      admitted.push(entry);
    }
    expect(checkGrantStructure(CHARTER, treeOf(admitted, { G2: 11 }), CANON.G7)).toEqual({ ok: true });
  });

  it("and the same grants are refused when added out of order, by `unknown-parent`", () => {
    expect(checkGrantStructure(CHARTER, treeOf([]), CANON.G2)).toEqual({ ok: false, rejection: { kind: "unknown-parent", parent: g("G1") } });
  });
});
