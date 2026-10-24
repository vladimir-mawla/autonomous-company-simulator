import { describe, expect, it } from "vitest";
import { MAX_ROOT_DEPTH } from "../../contracts/index.js";
import { chainOf, firstDeadLink, liveAuthorityAbove, trailOf } from "../index.js";
import { CANON, canonAfterRevokingG2, canonBefore, g, grant, p, treeOf } from "./fixtures.js";

/**
 * The walkers on plan section 7's tree. Hand-built hostile trees (cycles, orphans, over-long ancestry) and the
 * bounds' exact edges are `hostile-input.test.ts` and `boundaries.test.ts`.
 */

describe("chainOf: root first, the grant asked about last", () => {
  const tree = canonBefore();

  it.each([
    ["G1", ["G1"]],
    ["G2", ["G1", "G2"]],
    ["G3", ["G1", "G3"]],
    ["G4", ["G1", "G2", "G4"]],
    ["G5", ["G1", "G2", "G5"]],
    ["G6", ["G1", "G3", "G6"]],
  ])("%s", (id, expected) => {
    expect(chainOf(tree, g(id))).toEqual(expected.map(g));
  });

  it("an id that is not in the tree is undefined", () => {
    expect(chainOf(tree, g("g-ghost"))).toBeUndefined();
    expect(chainOf(tree, g(""))).toBeUndefined();
  });

  it("does not depend on revocations: a revoked grant is still on its chain", () => {
    const after = canonAfterRevokingG2();
    expect(chainOf(after, g("G4"))).toEqual(["G1", "G2", "G4"].map(g));
    expect(chainOf(after, g("G2"))).toEqual(["G1", "G2"].map(g));
  });

  it("returns a fresh array each call, so a caller changing one cannot change the next", () => {
    const first = chainOf(tree, g("G4")) as unknown as string[];
    first.push("tampered");
    expect(chainOf(tree, g("G4"))).toEqual(["G1", "G2", "G4"].map(g));
  });

  it("does not change the tree", () => {
    const before = [...tree.grants.keys()];
    chainOf(tree, g("G6"));
    expect([...tree.grants.keys()]).toEqual(before);
    expect(tree.revokedAt.size).toBe(0);
  });
});

describe("trailOf: the charter root, then each grantee down to the actor", () => {
  const tree = canonBefore();

  it("is one longer than the chain, charter root first", () => {
    expect(trailOf(tree, [g("G1")])).toEqual([p("dana"), p("cfo")]);
    expect(trailOf(tree, [g("G1"), g("G2")])).toEqual([p("dana"), p("cfo"), p("ops")]);
    expect(trailOf(tree, [g("G1"), g("G2"), g("G4")])).toEqual([p("dana"), p("cfo"), p("ops"), p("buyer-a")]);
    expect(trailOf(tree, [g("G1"), g("G3"), g("G6")])).toEqual([p("dana"), p("cfo"), p("support"), p("refunder")]);
  });

  it("agrees with chainOf for every grant: the trail's length is the chain's plus one", () => {
    for (const id of ["G1", "G2", "G3", "G4", "G5", "G6"]) {
      const chain = chainOf(tree, g(id));
      expect(chain).toBeDefined();
      const trail = trailOf(tree, chain as NonNullable<typeof chain>);
      expect(trail?.length).toBe((chain?.length ?? 0) + 1);
    }
  });

  it("a chain naming a grant that is not in the tree is undefined", () => {
    expect(trailOf(tree, [g("G1"), g("g-ghost")])).toBeUndefined();
    expect(trailOf(tree, [g("g-ghost")])).toBeUndefined();
  });

  it.each([
    ["does not start at a root grant", [g("G2")]],
    ["skips a grant", [g("G1"), g("G4")]],
    ["is out of order", [g("G2"), g("G1")]],
    ["jumps to another branch", [g("G1"), g("G2"), g("G6")]],
    ["repeats a grant", [g("G1"), g("G1")]],
  ] as const)("a list that %s is undefined: it is not a chain, and its trail would be one no delegation made", (_label, chain) => {
    expect(trailOf(tree, chain as unknown as readonly [never, ...never[]])).toBeUndefined();
  });

  it("an empty list that reached here through a cast is undefined rather than an empty trail", () => {
    expect(trailOf(tree, [] as unknown as readonly [never, ...never[]])).toBeUndefined();
  });

  it("is the same whether or not the chain has a revoked link", () => {
    expect(trailOf(canonAfterRevokingG2(), [g("G1"), g("G2"), g("G4")])).toEqual([p("dana"), p("cfo"), p("ops"), p("buyer-a")]);
  });
});

describe("firstDeadLink: the revoked link nearest the root", () => {
  const chain = ["G1", "G2", "G4"].map(g);

  it("no revocation on the chain is undefined", () => {
    expect(firstDeadLink(canonBefore(), chain)).toBeUndefined();
  });

  it("a revoked middle link, with the seq of its revocation (plan section 7: G2 at seq 11)", () => {
    expect(firstDeadLink(canonAfterRevokingG2(), chain)).toEqual({ grantId: g("G2"), atSeq: 11 });
  });

  it("the leaf alone revoked is the dead link", () => {
    expect(firstDeadLink(treeOf(Object.values(CANON), { G4: 20 }), chain)).toEqual({ grantId: g("G4"), atSeq: 20 });
  });

  it("when several links are revoked it is the one nearest the root, whatever the order of their revocations", () => {
    const tree = treeOf(Object.values(CANON), { G4: 12, G2: 15, G1: 30 });
    expect(firstDeadLink(tree, chain)).toEqual({ grantId: g("G1"), atSeq: 30 });
    expect(firstDeadLink(treeOf(Object.values(CANON), { G4: 12, G2: 15 }), chain)).toEqual({ grantId: g("G2"), atSeq: 15 });
  });

  it("a revocation off the chain is not on it", () => {
    expect(firstDeadLink(treeOf(Object.values(CANON), { G3: 9, G5: 9, G6: 9 }), chain)).toBeUndefined();
  });

  it("an empty chain has no dead link", () => {
    expect(firstDeadLink(canonAfterRevokingG2(), [])).toBeUndefined();
  });

  it("a revocation at seq 1 is still a revocation (the seq is compared with undefined, not truthiness)", () => {
    expect(firstDeadLink(treeOf(Object.values(CANON), { G2: 1 }), chain)).toEqual({ grantId: g("G2"), atSeq: 1 });
  });
});

describe("liveAuthorityAbove: grantors whose own chain-prefix is fully live, root first", () => {
  it("with nothing revoked it is every grantor on the chain, and never the grant's own holder", () => {
    const tree = canonBefore();
    expect(liveAuthorityAbove(tree, g("G1"))).toEqual([p("dana")]);
    expect(liveAuthorityAbove(tree, g("G2"))).toEqual([p("dana"), p("cfo")]);
    expect(liveAuthorityAbove(tree, g("G4"))).toEqual([p("dana"), p("cfo"), p("ops")]);
    expect(liveAuthorityAbove(tree, g("G6"))).toEqual([p("dana"), p("cfo"), p("support")]);
  });

  it("once G2 is revoked, G4's list stops at the grantor of the first dead link: dana and cfo, and cfo is the heir (plan section 7)", () => {
    const after = canonAfterRevokingG2();
    expect(liveAuthorityAbove(after, g("G4"))).toEqual([p("dana"), p("cfo")]);
    expect(liveAuthorityAbove(after, g("G5"))).toEqual([p("dana"), p("cfo")]);
  });

  it("the revoked grant itself still lists its grantor and above (the grantor of the dead link is live)", () => {
    expect(liveAuthorityAbove(canonAfterRevokingG2(), g("G2"))).toEqual([p("dana"), p("cfo")]);
  });

  it("a live branch is untouched by a revocation elsewhere", () => {
    expect(liveAuthorityAbove(canonAfterRevokingG2(), g("G6"))).toEqual([p("dana"), p("cfo"), p("support")]);
    expect(liveAuthorityAbove(canonAfterRevokingG2(), g("G3"))).toEqual([p("dana"), p("cfo")]);
  });

  it("when the root grant is revoked only the charter root is left, whichever grant is asked about", () => {
    const tree = treeOf(Object.values(CANON), { G1: 40 });
    for (const id of ["G1", "G2", "G4", "G6"]) expect(liveAuthorityAbove(tree, g(id)), id).toEqual([p("dana")]);
  });

  it("the list climbs as higher links are cut: cutting G1 after G2 removes cfo", () => {
    const first = liveAuthorityAbove(canonAfterRevokingG2(), g("G4"));
    const later = liveAuthorityAbove(treeOf(Object.values(CANON), { G2: 11, G1: 20 }), g("G4"));
    expect(first).toEqual([p("dana"), p("cfo")]);
    expect(later).toEqual([p("dana")]);
  });

  it("a leaf revoked on its own: its own grantor and everyone above stay", () => {
    expect(liveAuthorityAbove(treeOf(Object.values(CANON), { G4: 12 }), g("G4"))).toEqual([p("dana"), p("cfo"), p("ops")]);
  });

  it("an unknown grant has nobody above it", () => {
    expect(liveAuthorityAbove(canonBefore(), g("g-ghost"))).toEqual([]);
  });

  it("a second root's principal is not above a chain it is not on", () => {
    const tree = treeOf([grant({ id: "A", grantor: "dana", grantee: "x", depth: 1 }), grant({ id: "B", grantor: "eve", grantee: "y", depth: 1 })]);
    expect(liveAuthorityAbove(tree, g("A"))).toEqual([p("dana")]);
    expect(liveAuthorityAbove(tree, g("B"))).toEqual([p("eve")]);
  });
});

describe("the longest chain an admitted tree can hold", () => {
  it(`has MAX_ROOT_DEPTH + 1 = ${MAX_ROOT_DEPTH + 1} grants and is returned whole, with a trail one longer`, () => {
    const length = MAX_ROOT_DEPTH + 1;
    const grants = Array.from({ length }, (_, index) =>
      grant({ id: `L${index}`, parent: index === 0 ? null : `L${index - 1}`, grantor: `m${index}`, grantee: `m${index + 1}`, depth: MAX_ROOT_DEPTH - index }),
    );
    const tree = treeOf(grants);
    const chain = chainOf(tree, g(`L${length - 1}`));
    expect(chain).toHaveLength(length);
    expect(trailOf(tree, chain as NonNullable<typeof chain>)).toHaveLength(length + 1);
  });
});
