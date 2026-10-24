import { describe, expect, it } from "vitest";
import { MAX_AMOUNT, MAX_ID_LENGTH, MAX_ROOT_DEPTH } from "../../contracts/index.js";
import type { Charter } from "../../contracts/index.js";
import { MAX_CHARTER_ENTRIES, chainOf, checkGrantStructure, readCharter, readEventInput, readLogEvent, trailOf } from "../index.js";
import { CHARTER, g, grant, rawCommitEvent, rawGrantEvent, rawRevokeEvent, treeOf } from "./fixtures.js";

/**
 * Boundaries, N and N + 1, for every constant this layer enforces (plan section 6, M3, layer 3). Each test is
 * written in terms of the constant, so changing a constant moves the test with it; `lib/contracts/__tests__/limits.test.ts`
 * is what pins the constants' values.
 *
 *   MAX_AMOUNT           limit and amount            (here: 0 and -1 too)
 *   MAX_ROOT_DEPTH       depth, and chain length     (a chain has at most MAX_ROOT_DEPTH + 1 grants)
 *   MAX_ID_LENGTH        every id field and every charter name
 *   MAX_CHARTER_ENTRIES  a charter's two lists and an event's capability list   (invented here, not in the plan)
 *
 * Not here: `MAX_LOG_EVENTS`. Nothing in `lib/chain` reads it; the log's length is M5's `log-too-long`.
 */

const shape = (eventKind: "grant" | "commit" | "revoke", ...fields: string[]) => ({
  ok: false,
  failure: { kind: "invalid", rejection: { kind: "invalid-event-shape", eventKind, fields } },
});

describe("MAX_AMOUNT: limit and amount", () => {
  it.each([
    ["0, the smallest", 0, true],
    ["-1, one below the smallest", -1, false],
    ["MAX_AMOUNT, the largest", MAX_AMOUNT, true],
    ["MAX_AMOUNT + 1, one above", MAX_AMOUNT + 1, false],
    ["MAX_AMOUNT - 1", MAX_AMOUNT - 1, true],
  ])("grant.limit %s", (_label, value, accepted) => {
    const result = readEventInput(CHARTER, rawGrantEvent({ limit: value }));
    if (accepted) expect(result.ok).toBe(true);
    else expect(result).toEqual(shape("grant", "limit"));
  });

  it.each([
    ["0, the smallest", 0, true],
    ["-1, one below the smallest", -1, false],
    ["MAX_AMOUNT, the largest", MAX_AMOUNT, true],
    ["MAX_AMOUNT + 1, one above", MAX_AMOUNT + 1, false],
  ])("commit.amount %s", (_label, value, accepted) => {
    const result = readEventInput(CHARTER, rawCommitEvent({ amount: value }));
    if (accepted) expect(result.ok).toBe(true);
    else expect(result).toEqual(shape("commit", "amount"));
  });

  it("MAX_AMOUNT + 1 is still a safe integer, so it is the bound that refuses it and not the integer check", () => {
    expect(Number.isSafeInteger(MAX_AMOUNT + 1)).toBe(true);
  });
});

describe("MAX_ROOT_DEPTH: depth", () => {
  it.each([
    ["0, the smallest", 0, true],
    ["-1, one below", -1, false],
    ["MAX_ROOT_DEPTH, the largest", MAX_ROOT_DEPTH, true],
    ["MAX_ROOT_DEPTH + 1, one above", MAX_ROOT_DEPTH + 1, false],
  ])("grant.depth %s", (_label, value, accepted) => {
    const result = readEventInput(CHARTER, rawGrantEvent({ depth: value }));
    if (accepted) expect(result.ok).toBe(true);
    else expect(result).toEqual(shape("grant", "depth"));
  });

  it.each(Array.from({ length: MAX_ROOT_DEPTH }, (_, index) => index + 1))(
    "narrowing under a parent of depth %i: a child of depth parent - 1 is accepted, a child of the parent's own depth is refused",
    (parentDepth) => {
      const parent = grant({ id: "P", grantor: "dana", grantee: "a", depth: parentDepth });
      const tree = treeOf([parent]);
      const child = (depth: number) => grant({ id: "C", parent: "P", grantor: "a", grantee: "b", depth });
      expect(checkGrantStructure(CHARTER, tree, child(parentDepth - 1))).toEqual({ ok: true });
      expect(checkGrantStructure(CHARTER, tree, child(parentDepth))).toEqual({ ok: false, rejection: { kind: "depth-not-narrowed", parentDepth, requested: parentDepth } });
    },
  );

  it("a parent of depth 0 permits no child at all: the smallest depth, 0, is refused as exhausted, not as not-narrowed", () => {
    const tree = treeOf([grant({ id: "P", grantor: "dana", grantee: "a", depth: 0 })]);
    expect(checkGrantStructure(CHARTER, tree, grant({ id: "C", parent: "P", grantor: "a", grantee: "b", depth: 0 }))).toEqual({ ok: false, rejection: { kind: "depth-exhausted", parent: g("P") } });
  });
});

describe("chain length: at most MAX_ROOT_DEPTH + 1 grants", () => {
  /** A line of `n` grants, parent-linked, from a root. Depths are not narrowed: this is a hand-built tree. */
  const line = (n: number) =>
    treeOf(Array.from({ length: n }, (_, index) => grant({ id: `L${index}`, parent: index === 0 ? null : `L${index - 1}`, grantor: `m${index}`, grantee: `m${index + 1}`, depth: 3 })));

  it("chainOf and trailOf return a chain of MAX_ROOT_DEPTH + 1 grants (N) and refuse one of MAX_ROOT_DEPTH + 2 (N + 1)", () => {
    const n = MAX_ROOT_DEPTH + 1;
    const tree = line(n + 1);
    const atLimit = chainOf(tree, g(`L${n - 1}`));
    expect(atLimit).toHaveLength(n);
    expect(trailOf(tree, atLimit as NonNullable<typeof atLimit>)).toHaveLength(n + 1);

    expect(chainOf(tree, g(`L${n}`))).toBeUndefined();
    const tooLong = Array.from({ length: n + 1 }, (_, index) => g(`L${index}`)) as unknown as readonly [never, ...never[]];
    expect(trailOf(tree, tooLong)).toBeUndefined();
  });

  it("the real intake and structure check build a chain of MAX_ROOT_DEPTH + 1 grants, depth narrowing by one each time, and refuse the next", () => {
    const admitted: ReturnType<typeof grant>[] = [];
    for (let index = 0; index <= MAX_ROOT_DEPTH; index++) {
      const raw = rawGrantEvent({
        id: `K${index}`,
        parent: index === 0 ? null : `K${index - 1}`,
        grantor: index === 0 ? "dana" : `q${index}`,
        grantee: `q${index + 1}`,
        capabilities: ["purchase"],
        depth: MAX_ROOT_DEPTH - index,
      });
      const read = readEventInput(CHARTER, raw);
      if (!read.ok || read.event.kind !== "grant") throw new Error(`intake refused link ${index}`);
      expect(checkGrantStructure(CHARTER, treeOf(admitted), read.event.grant), `link ${index}`).toEqual({ ok: true });
      admitted.push(read.event.grant);
    }
    expect(admitted).toHaveLength(MAX_ROOT_DEPTH + 1);
    const tree = treeOf(admitted);
    expect(chainOf(tree, g(`K${MAX_ROOT_DEPTH}`))).toHaveLength(MAX_ROOT_DEPTH + 1);

    // The next link would have to have depth -1, which intake refuses; depth 0 under a depth-0 parent is exhausted.
    const next = grant({ id: "K-next", parent: `K${MAX_ROOT_DEPTH}`, grantor: `q${MAX_ROOT_DEPTH + 1}`, grantee: "z", depth: 0 });
    expect(checkGrantStructure(CHARTER, tree, next)).toEqual({ ok: false, rejection: { kind: "depth-exhausted", parent: g(`K${MAX_ROOT_DEPTH}`) } });
    expect(readEventInput(CHARTER, rawGrantEvent({ id: "K-next", parent: `K${MAX_ROOT_DEPTH}`, depth: -1 }))).toEqual(shape("grant", "depth"));
  });
});

describe("MAX_ID_LENGTH: every id field", () => {
  const atLimit = "i".repeat(MAX_ID_LENGTH);
  const overLimit = "i".repeat(MAX_ID_LENGTH + 1);

  const fields: ReadonlyArray<readonly [string, "grant" | "commit" | "revoke", (value: string) => unknown, string]> = [
    ["grant.id", "grant", (value) => rawGrantEvent({ id: value }), "id"],
    ["grant.parent", "grant", (value) => rawGrantEvent({ parent: value }), "parent"],
    ["grant.grantor", "grant", (value) => rawGrantEvent({ grantor: value }), "grantor"],
    ["grant.grantee", "grant", (value) => rawGrantEvent({ grantee: value }), "grantee"],
    ["commit.id", "commit", (value) => rawCommitEvent({ id: value }), "id"],
    ["commit.actor", "commit", (value) => rawCommitEvent({ actor: value }), "actor"],
    ["commit.actedUnder", "commit", (value) => rawCommitEvent({ actedUnder: value }), "actedUnder"],
    ["revoke.grantId", "revoke", (value) => rawRevokeEvent({ grantId: value }), "grantId"],
    ["revoke.by", "revoke", (value) => rawRevokeEvent({ by: value }), "by"],
  ];

  describe.each(fields)("%s", (_name, kind, build, field) => {
    it("1 character (the shortest) and MAX_ID_LENGTH characters (N) are accepted", () => {
      expect(readEventInput(CHARTER, build("i")).ok).toBe(true);
      expect(readEventInput(CHARTER, build(atLimit)).ok).toBe(true);
    });
    it("0 characters (one below the shortest) and MAX_ID_LENGTH + 1 characters (N + 1) are refused", () => {
      expect(readEventInput(CHARTER, build(""))).toEqual(shape(kind, field));
      expect(readEventInput(CHARTER, build(overLimit))).toEqual(shape(kind, field));
    });
  });

  it("the length is counted in UTF-16 code units, as String.prototype.length counts them (the unit lib/contracts/limits.ts names)", () => {
    const astral = "\u{1F600}"; // one code point, two code units
    expect(astral).toHaveLength(2);
    const atLimitInUnits = astral.repeat(MAX_ID_LENGTH / 2);
    const oneCodePointOver = astral.repeat(MAX_ID_LENGTH / 2 + 1);
    expect(atLimitInUnits).toHaveLength(MAX_ID_LENGTH);
    expect(readEventInput(CHARTER, rawGrantEvent({ id: atLimitInUnits })).ok).toBe(true);
    expect(readEventInput(CHARTER, rawGrantEvent({ id: oneCodePointOver }))).toEqual(shape("grant", "id"));
    // 65 code points would be inside a count of code points and is refused all the same.
    expect(Array.from(oneCodePointOver)).toHaveLength(MAX_ID_LENGTH / 2 + 1);
  });

  it("a charter's root and a charter's capability name follow the same rule", () => {
    expect(readCharter({ roots: [atLimit], capabilities: [atLimit] } as never).ok).toBe(true);
    expect(readCharter({ roots: [overLimit], capabilities: [atLimit] } as never)).toEqual({ ok: false, fields: ["roots"] });
    expect(readCharter({ roots: [atLimit], capabilities: [overLimit] } as never)).toEqual({ ok: false, fields: ["capabilities"] });
    expect(readCharter({ roots: [""], capabilities: ["x"] } as never)).toEqual({ ok: false, fields: ["roots"] });
    expect(readCharter({ roots: ["x"], capabilities: [""] } as never)).toEqual({ ok: false, fields: ["capabilities"] });
  });
});

describe("MAX_CHARTER_ENTRIES: a charter's two lists, and an event's capability list", () => {
  const names = (count: number) => Array.from({ length: count }, (_, index) => `c${index}`);

  it("a charter's roots: 1 entry and MAX_CHARTER_ENTRIES entries (N) are valid, 0 and N + 1 are not", () => {
    expect(readCharter({ roots: names(1), capabilities: ["x"] } as never).ok).toBe(true);
    expect(readCharter({ roots: names(MAX_CHARTER_ENTRIES), capabilities: ["x"] } as never).ok).toBe(true);
    expect(readCharter({ roots: names(0), capabilities: ["x"] } as never)).toEqual({ ok: false, fields: ["roots"] });
    expect(readCharter({ roots: names(MAX_CHARTER_ENTRIES + 1), capabilities: ["x"] } as never)).toEqual({ ok: false, fields: ["roots"] });
  });

  it("a charter's capabilities: the same", () => {
    expect(readCharter({ roots: ["r"], capabilities: names(1) } as never).ok).toBe(true);
    expect(readCharter({ roots: ["r"], capabilities: names(MAX_CHARTER_ENTRIES) } as never).ok).toBe(true);
    expect(readCharter({ roots: ["r"], capabilities: names(0) } as never)).toEqual({ ok: false, fields: ["capabilities"] });
    expect(readCharter({ roots: ["r"], capabilities: names(MAX_CHARTER_ENTRIES + 1) } as never)).toEqual({ ok: false, fields: ["capabilities"] });
  });

  describe("an event's capability list, against a vocabulary as large as a charter may have", () => {
    const read = readCharter({ roots: ["r"], capabilities: names(MAX_CHARTER_ENTRIES) } as never);
    if (!read.ok) throw new Error("the largest permitted charter was refused");
    const big = read.charter as Charter<string>;

    it("N distinct capabilities, all in the vocabulary, are accepted", () => {
      const result = readEventInput(big, rawGrantEvent({ capabilities: names(MAX_CHARTER_ENTRIES) }));
      expect(result.ok).toBe(true);
      expect(result.ok && result.event.kind === "grant" && result.event.grant.capabilities).toHaveLength(MAX_CHARTER_ENTRIES);
    });

    it("N + 1 distinct capabilities are a shape error: the list cannot be a duplicate-free subset of a vocabulary of at most N", () => {
      expect(readEventInput(big, rawGrantEvent({ capabilities: names(MAX_CHARTER_ENTRIES + 1) }))).toEqual(shape("grant", "capabilities"));
    });

    it("N capabilities all OUTSIDE the vocabulary pass the shape check and are an unknown capability, so the change at N + 1 is the length and nothing else", () => {
      const outside = Array.from({ length: MAX_CHARTER_ENTRIES }, (_, index) => `x${index}`);
      expect(readEventInput(big, rawGrantEvent({ capabilities: outside }))).toMatchObject({ failure: { rejection: { kind: "unknown-capability", capability: "x0" } } });
    });

    it("an empty list is refused (one below the shortest), a one-element list is accepted", () => {
      expect(readEventInput(big, rawGrantEvent({ capabilities: [] }))).toEqual(shape("grant", "capabilities"));
      expect(readEventInput(big, rawGrantEvent({ capabilities: ["c0"] })).ok).toBe(true);
    });
  });
});

describe("seq on a logged event: 1 is the smallest position, and the largest is the largest safe integer", () => {
  it.each([
    ["0, one below the smallest", 0, false],
    ["1, the smallest", 1, true],
    ["Number.MAX_SAFE_INTEGER, the largest", Number.MAX_SAFE_INTEGER, true],
    ["Number.MAX_SAFE_INTEGER + 1, one above", Number.MAX_SAFE_INTEGER + 1, false],
  ])("seq %s", (_label, seq, accepted) => {
    const result = readLogEvent(CHARTER, { ...rawGrantEvent(), seq });
    if (accepted) expect(result.ok).toBe(true);
    else expect(result).toEqual(shape("grant", "seq"));
  });
});
