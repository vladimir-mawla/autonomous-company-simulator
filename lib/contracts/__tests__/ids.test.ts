import { describe, expect, it } from "vitest";
import { commitId, grantId, principalId } from "../ids.js";

/**
 * Runtime behaviour of the mint functions. The compile-time half (each brand
 * refuses the other two and refuses a bare string) is in
 * `proofs/ids.proofs.ts`, checked by `type-proofs.test.ts`.
 */
describe("mint functions return the string they were given", () => {
  it("is the identity at run time", () => {
    expect(principalId("dana")).toBe("dana");
    expect(grantId("G1")).toBe("G1");
    expect(commitId("c1")).toBe("c1");
  });

  it("a minted id is a primitive string, usable as a Map key and in JSON", () => {
    const id = grantId("G1");
    expect(typeof id).toBe("string");
    expect(new Map([[id, 1]]).get(grantId("G1"))).toBe(1);
    expect(JSON.stringify({ id })).toBe('{"id":"G1"}');
  });
});

describe("HONEST LIMIT: ids are opaque tokens, not validated and not distinguishable at run time", () => {
  it("validates nothing: the empty string, whitespace and a 10 000-character string are all accepted unchanged", () => {
    // .genesis/PLAN.md §4.1: "NO PARSERS". The non-empty and MAX_ID_LENGTH rules
    // are assigned to M3's intake, which does not exist yet; this pins that the
    // mint functions themselves do not reject anything.
    const long = "x".repeat(10_000);
    expect(principalId("")).toBe("");
    expect(grantId("  ")).toBe("  ");
    expect(commitId(long)).toBe(long);
  });

  it("the three brands are erased at run time: the same string mints equal values", () => {
    expect(principalId("x") === (grantId("x") as unknown)).toBe(true);
    expect(grantId("x") === (commitId("x") as unknown)).toBe(true);
  });
});
