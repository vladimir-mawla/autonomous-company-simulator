import { describe, expect, it } from "vitest";
import { grantId, type GrantId } from "../ids.js";
import type { Seq } from "../limits.js";
import type { GrantTree } from "../tree.js";

/**
 * The compile-time half (the view has no mutators; a dead link, a charge and a
 * warrant are whole facts) is in `proofs/tree-and-warrant.proofs.ts`. This file
 * pins at run time what `GrantTree` does NOT guarantee.
 */
describe("HONEST LIMIT: GrantTree is a view over maps, not a frozen or write-once structure", () => {
  it("follows the underlying Map, so revokedAt can be overwritten by whoever holds that Map", () => {
    const g = grantId("G2");
    const underlying = new Map<GrantId, Seq>();
    const tree: GrantTree = { grants: new Map(), revokedAt: underlying };

    underlying.set(g, 11);
    expect(tree.revokedAt.get(g)).toBe(11);

    // The plan calls `revokedAt` write-once. Nothing in M1 makes it so; this is M5's to build.
    underlying.set(g, 99);
    expect(tree.revokedAt.get(g)).toBe(99);
  });

  it("a tree can be built by hand, which the plan's M3 case (a hand-built cyclic tree must make `chainOf` return `undefined`) requires", () => {
    const empty: GrantTree = { grants: new Map(), revokedAt: new Map() };
    expect(empty.grants.size).toBe(0);
    expect(empty.revokedAt.size).toBe(0);
  });
});
