import { describe, expect, it } from "vitest";
import { MAX_AMOUNT, MAX_ID_LENGTH, MAX_ROOT_DEPTH, commitId, grantId, principalId } from "../../contracts/index.js";
import { readCharter, readEventInput, readLogEvent } from "../index.js";
import type { IntakeResult } from "../index.js";
import { CAPABILITIES, CHARTER, rawCommit, rawCommitEvent, rawGrant, rawGrantEvent, rawRevokeEvent, without } from "./fixtures.js";

/**
 * Intake on ordinary (non-hostile) input: what is accepted, what it becomes, and which fields are named
 * when it is refused. Input that fights back (throwing getters, Proxies, getters that change their answer) is
 * `hostile-input.test.ts`; the exact edges of each bound are `boundaries.test.ts`.
 */

const TOO_LONG = "x".repeat(MAX_ID_LENGTH + 1);

/** `[ <hole>, "purchase" ]`: length 2, index 0 never assigned. */
function sparse(): unknown[] {
  const list = new Array<unknown>(2);
  list[1] = "purchase";
  return list;
}

/** What a refused shape looks like, written once so each case below states only what differs. */
function shape(eventKind: "grant" | "revoke" | "commit" | "unknown", ...fields: string[]) {
  return {
    ok: false,
    failure: { kind: "invalid", rejection: { kind: "invalid-event-shape", eventKind, fields } },
  };
}

describe("readCharter", () => {
  it("returns a fresh, frozen copy of a valid charter", () => {
    const input = { roots: ["dana", "eve"], capabilities: ["purchase", "refund"] };
    const result = readCharter(input as never);
    expect(result).toEqual({ ok: true, charter: { roots: ["dana", "eve"], capabilities: ["purchase", "refund"] } });
    if (!result.ok) throw new Error("unreachable");

    expect(result.charter).not.toBe(input);
    expect(result.charter.roots).not.toBe(input.roots);
    expect(result.charter.capabilities).not.toBe(input.capabilities);
    expect(Object.isFrozen(result.charter)).toBe(true);
    expect(Object.isFrozen(result.charter.roots)).toBe(true);
    expect(Object.isFrozen(result.charter.capabilities)).toBe(true);
    expect(() => {
      (result.charter.roots as unknown as string[]).push("mallory");
    }).toThrow(TypeError);
  });

  it("a change to the original after reading does not reach the copy", () => {
    const input = { roots: ["dana"], capabilities: ["purchase"] };
    const result = readCharter(input as never);
    input.roots.push("mallory");
    input.capabilities[0] = "launder";
    expect(result).toEqual({ ok: true, charter: { roots: ["dana"], capabilities: ["purchase"] } });
  });

  it("accepts the shared fixture charter unchanged", () => {
    expect(readCharter(CHARTER)).toEqual({ ok: true, charter: { roots: ["dana"], capabilities: [...CAPABILITIES] } });
  });

  it("keeps a repeated root or capability as given: no rule asks for them to be refused", () => {
    const result = readCharter({ roots: ["dana", "dana"], capabilities: ["purchase", "purchase"] } as never);
    expect(result).toEqual({ ok: true, charter: { roots: ["dana", "dana"], capabilities: ["purchase", "purchase"] } });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a string", "dana"],
    ["a boolean", true],
  ])("a charter that is %s is invalid in both fields, sorted", (_label, value) => {
    expect(readCharter(value as never)).toEqual({ ok: false, fields: ["capabilities", "roots"] });
  });

  it("an empty object is invalid in both fields", () => {
    expect(readCharter({} as never)).toEqual({ ok: false, fields: ["capabilities", "roots"] });
  });

  const goodCaps = ["purchase"];
  const goodRoots = ["dana"];
  it.each([
    ["roots missing", { capabilities: goodCaps }, ["roots"]],
    ["roots empty", { roots: [], capabilities: goodCaps }, ["roots"]],
    ["roots a string", { roots: "dana", capabilities: goodCaps }, ["roots"]],
    ["roots array-like, not an array", { roots: { length: 1, 0: "dana" }, capabilities: goodCaps }, ["roots"]],
    ["a root that is the empty string", { roots: [""], capabilities: goodCaps }, ["roots"]],
    ["a root that is not a string", { roots: [7], capabilities: goodCaps }, ["roots"]],
    ["a root over the id length", { roots: [TOO_LONG], capabilities: goodCaps }, ["roots"]],
    ["one good root and one bad", { roots: ["dana", null], capabilities: goodCaps }, ["roots"]],
    ["capabilities missing", { roots: goodRoots }, ["capabilities"]],
    ["capabilities empty", { roots: goodRoots, capabilities: [] }, ["capabilities"]],
    ["capabilities a string", { roots: goodRoots, capabilities: "purchase" }, ["capabilities"]],
    ["a capability that is the empty string", { roots: goodRoots, capabilities: [""] }, ["capabilities"]],
    ["a capability that is not a string", { roots: goodRoots, capabilities: [true] }, ["capabilities"]],
    ["a capability over the id length", { roots: goodRoots, capabilities: [TOO_LONG] }, ["capabilities"]],
    ["both bad", { roots: [], capabilities: [] }, ["capabilities", "roots"]],
  ])("%s: names only the offending field", (_label, charter, fields) => {
    expect(readCharter(charter as never)).toEqual({ ok: false, fields });
  });
});

describe("readEventInput: a well-formed event", () => {
  it("a grant becomes a fresh plain grant with every field copied and nothing else", () => {
    const raw = rawGrantEvent({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase", "sign-contract"], limit: 400_000, depth: 2 });
    const result = readEventInput(CHARTER, raw);
    expect(result).toEqual({
      ok: true,
      event: {
        kind: "grant",
        grant: {
          id: grantId("G2"),
          parent: grantId("G1"),
          grantor: principalId("cfo"),
          grantee: principalId("ops"),
          capabilities: ["purchase", "sign-contract"],
          limit: 400_000,
          depth: 2,
        },
      },
    });
    if (!result.ok || result.event.kind !== "grant") throw new Error("unreachable");
    expect(result.event).not.toBe(raw);
    expect(result.event.grant).not.toBe(raw["grant"]);
    expect(result.event.grant.capabilities).not.toBe((raw["grant"] as { capabilities: unknown }).capabilities);
  });

  it("a root grant has parent null", () => {
    const result = readEventInput(CHARTER, rawGrantEvent());
    expect(result.ok && result.event.kind === "grant" && result.event.grant.parent).toBe(null);
  });

  it("a commit and a revoke become fresh plain events", () => {
    expect(readEventInput(CHARTER, rawCommitEvent())).toEqual({
      ok: true,
      event: {
        kind: "commit",
        commit: { id: commitId("c1"), actor: principalId("buyer-a"), actedUnder: grantId("G4"), capability: "purchase", amount: 50 },
      },
    });
    expect(readEventInput(CHARTER, rawRevokeEvent())).toEqual({
      ok: true,
      event: { kind: "revoke", grantId: grantId("G2"), by: principalId("cfo") },
    });
  });

  it("keeps the event's own capability order", () => {
    const result = readEventInput(CHARTER, rawGrantEvent({ capabilities: ["sign-contract", "purchase", "hire"] }));
    expect(result.ok && result.event.kind === "grant" && result.event.grant.capabilities).toEqual(["sign-contract", "purchase", "hire"]);
  });

  it("extra keys are never copied: not on the envelope, not on the payload, not a `seq`", () => {
    const raw = {
      ...rawGrantEvent({ note: "x", extra: { deep: true } }),
      seq: 9,
      commit: rawCommit(),
      note: "ignored",
    };
    const result = readEventInput(CHARTER, raw);
    if (!result.ok || result.event.kind !== "grant") throw new Error("unreachable");
    expect(Object.keys(result.event)).toEqual(["kind", "grant"]);
    expect(Object.keys(result.event.grant)).toEqual(["id", "parent", "grantor", "grantee", "capabilities", "limit", "depth"]);
  });

  it("`-0` is accepted as a number and comes back as a positive zero", () => {
    const grant = readEventInput(CHARTER, rawGrantEvent({ limit: -0, depth: -0 }));
    if (!grant.ok || grant.event.kind !== "grant") throw new Error("unreachable");
    expect(Object.is(grant.event.grant.limit, 0)).toBe(true);
    expect(Object.is(grant.event.grant.depth, 0)).toBe(true);
    const commit = readEventInput(CHARTER, rawCommitEvent({ amount: -0 }));
    if (!commit.ok || commit.event.kind !== "commit") throw new Error("unreachable");
    expect(Object.is(commit.event.commit.amount, 0)).toBe(true);
  });

  it("accepts the largest and smallest legal limit, amount and depth", () => {
    expect(readEventInput(CHARTER, rawGrantEvent({ limit: MAX_AMOUNT, depth: MAX_ROOT_DEPTH })).ok).toBe(true);
    expect(readEventInput(CHARTER, rawGrantEvent({ limit: 0, depth: 0 })).ok).toBe(true);
    expect(readEventInput(CHARTER, rawCommitEvent({ amount: MAX_AMOUNT })).ok).toBe(true);
    expect(readEventInput(CHARTER, rawCommitEvent({ amount: 0 })).ok).toBe(true);
  });

  it("does not judge a revoke: any well-formed `by` and any grant id are accepted, because M5 owns who may revoke what", () => {
    const result = readEventInput(CHARTER, rawRevokeEvent({ by: "a-principal-nobody-has-heard-of", grantId: "a-grant-that-does-not-exist" }));
    expect(result.ok).toBe(true);
  });
});

describe("readEventInput: what is not an event", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 0],
    ["a string", "grant"],
    ["a boolean", true],
    ["a symbol", Symbol("grant")],
    ["a bigint", 1n],
    ["a function", () => ({ kind: "grant" })],
  ])("%s: eventKind unknown, the one field `kind`", (_label, raw) => {
    expect(readEventInput(CHARTER, raw)).toEqual(shape("unknown", "kind"));
  });

  it.each([
    ["an empty object", {}],
    ["an array", []],
    ["a kind in the wrong case", { kind: "Grant", grant: rawGrant() }],
    ["an empty kind", { kind: "" }],
    ["a numeric kind", { kind: 1 }],
    ["a null kind", { kind: null }],
    ["an object kind", { kind: {} }],
    ["a kind the engine does not have", { kind: "ratify", grant: rawGrant() }],
  ])("%s: eventKind unknown, the one field `kind`", (_label, raw) => {
    expect(readEventInput(CHARTER, raw)).toEqual(shape("unknown", "kind"));
  });

  // A revoke has no nested payload (`grantId` and `by` sit on the event), so it is not in this table.
  it.each([
    ["grant", "grant missing", { kind: "grant" }],
    ["grant", "grant null", { kind: "grant", grant: null }],
    ["grant", "grant a string", { kind: "grant", grant: "G1" }],
    ["grant", "grant a number", { kind: "grant", grant: 5 }],
    ["commit", "commit missing", { kind: "commit" }],
    ["commit", "commit null", { kind: "commit", commit: null }],
  ] as const)("a %s event whose payload is not an object (%s) names the payload field", (kind, _label, raw) => {
    expect(readEventInput(CHARTER, raw)).toEqual(shape(kind, kind));
  });
});

describe("readEventInput: invalid-event-shape names the offending field, one at a time", () => {
  const bad: ReadonlyArray<readonly [string, unknown]> = [
    ["missing", undefined],
    ["null", null],
    ["a number", 7],
    ["an object", {}],
    ["the empty string", ""],
    ["over the id length", TOO_LONG],
  ];

  describe.each(["id", "grantor", "grantee"])("grant.%s", (field) => {
    it.each(bad)("%s", (label, value) => {
      const grant = label === "missing" ? without(rawGrant(), field) : rawGrant({ [field]: value });
      expect(readEventInput(CHARTER, { kind: "grant", grant })).toEqual(shape("grant", field));
    });
  });

  describe("grant.parent: `null` or an id, and nothing else", () => {
    it.each([
      ["missing (absent is not null, so it is not a root)", undefined],
      ["a number", 7],
      ["an object", {}],
      ["the empty string", ""],
      ["over the id length", TOO_LONG],
    ])("%s", (label, value) => {
      const grant = label.startsWith("missing") ? without(rawGrant(), "parent") : rawGrant({ parent: value });
      expect(readEventInput(CHARTER, { kind: "grant", grant })).toEqual(shape("grant", "parent"));
    });
    it("an id is fine", () => {
      expect(readEventInput(CHARTER, rawGrantEvent({ parent: "G1" })).ok).toBe(true);
    });
  });

  describe.each(["limit", "amount"])("%s: a whole number in [0, MAX_AMOUNT]", (field) => {
    const build = (value: unknown) => (field === "limit" ? rawGrantEvent({ limit: value }) : rawCommitEvent({ amount: value }));
    const kind = field === "limit" ? "grant" : "commit";
    it.each([
      ["negative", -1],
      ["a fraction", 1.5],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["a numeric string", "5"],
      ["null", null],
      ["a bigint", 5n],
      ["above MAX_AMOUNT", MAX_AMOUNT + 1],
      ["not a safe integer", 2 ** 53],
    ])("%s", (_label, value) => {
      expect(readEventInput(CHARTER, build(value))).toEqual(shape(kind, field));
    });
    it("missing", () => {
      const event = build(0);
      const payload = (field === "limit" ? event["grant"] : event["commit"]) as Record<string, unknown>;
      expect(readEventInput(CHARTER, { kind, [kind]: without(payload, field) })).toEqual(shape(kind, field));
    });
  });

  describe("grant.depth: a whole number in [0, MAX_ROOT_DEPTH]", () => {
    it.each([
      ["negative", -1],
      ["a fraction", 0.5],
      ["NaN", Number.NaN],
      ["a numeric string", "1"],
      ["null", null],
      ["above MAX_ROOT_DEPTH", MAX_ROOT_DEPTH + 1],
      ["Infinity", Number.POSITIVE_INFINITY],
    ])("%s", (_label, value) => {
      expect(readEventInput(CHARTER, rawGrantEvent({ depth: value }))).toEqual(shape("grant", "depth"));
    });
  });

  describe("grant.capabilities: a non-empty list of distinct strings", () => {
    it.each([
      ["missing", undefined],
      ["a string, which has a length and indexes but is not an array", "purchase"],
      ["an array-like object", { length: 1, 0: "purchase" }],
      ["null", null],
      ["empty", []],
      ["a repeat", ["purchase", "purchase"]],
      ["a non-string", [1]],
      ["a null element", ["purchase", null]],
      ["a nested array", [["purchase"]]],
      ["a sparse array (a hole reads as undefined)", sparse()],
      ["a typed array, which is not an Array", new Uint8Array(1)],
    ])("%s", (label, value) => {
      const grant = label === "missing" ? without(rawGrant(), "capabilities") : rawGrant({ capabilities: value });
      expect(readEventInput(CHARTER, { kind: "grant", grant })).toEqual(shape("grant", "capabilities"));
    });
    it("a repeat AND a non-string are one field, reported once", () => {
      expect(readEventInput(CHARTER, rawGrantEvent({ capabilities: ["purchase", "purchase", 1] }))).toEqual(shape("grant", "capabilities"));
    });
  });

  describe("commit.capability: a string", () => {
    it.each([
      ["missing", undefined],
      ["a number", 1],
      ["null", null],
      ["an array", ["purchase"]],
    ])("%s", (label, value) => {
      const commit = label === "missing" ? without(rawCommit(), "capability") : rawCommit({ capability: value });
      expect(readEventInput(CHARTER, { kind: "commit", commit })).toEqual(shape("commit", "capability"));
    });
  });

  describe.each(["id", "actor", "actedUnder"])("commit.%s", (field) => {
    it.each(bad)("%s", (label, value) => {
      const commit = label === "missing" ? without(rawCommit(), field) : rawCommit({ [field]: value });
      expect(readEventInput(CHARTER, { kind: "commit", commit })).toEqual(shape("commit", field));
    });
  });

  describe.each(["grantId", "by"])("revoke.%s", (field) => {
    it.each(bad)("%s", (label, value) => {
      const raw = label === "missing" ? without(rawRevokeEvent(), field) : rawRevokeEvent({ [field]: value });
      expect(readEventInput(CHARTER, raw)).toEqual(shape("revoke", field));
    });
  });

  it("an id built from a value with a hostile `toString` is refused as a non-string, never coerced", () => {
    let coerced = false;
    const id = {
      toString() {
        coerced = true;
        return "G1";
      },
    };
    expect(readEventInput(CHARTER, rawGrantEvent({ id }))).toEqual(shape("grant", "id"));
    expect(coerced).toBe(false);
  });

  it("ids are opaque tokens, not grammars: whitespace, control characters, a lone surrogate and names that collide with Object.prototype are all accepted unchanged", () => {
    for (const id of [" ", "\t", "\u0000", "\ud800", "__proto__", "constructor", "toString", "G 1", "G1\n"]) {
      const result = readEventInput(CHARTER, rawGrantEvent({ id, grantor: id, grantee: id + "x" }));
      expect(result.ok && result.event.kind === "grant" && result.event.grant.id, JSON.stringify(id)).toBe(id);
      expect(result.ok && result.event.kind === "grant" && result.event.grant.grantor, JSON.stringify(id)).toBe(id);
    }
  });

  it("a String object is not a string", () => {
    expect(readEventInput(CHARTER, rawGrantEvent({ id: new String("G1") }))).toEqual(shape("grant", "id"));
  });
});

describe("readEventInput: every offending field at once, deduplicated and sorted", () => {
  it("a grant with four bad fields names all four, in alphabetical order, not the order they were read", () => {
    // Read order is id, parent, grantor, grantee, capabilities, limit, depth.
    const result = readEventInput(CHARTER, rawGrantEvent({ id: "", limit: -1, capabilities: [], depth: 99 }));
    expect(result).toEqual(shape("grant", "capabilities", "depth", "id", "limit"));
  });

  it("a commit with three bad fields: the order is sorted, not read order (id is read first and sorts last)", () => {
    const result = readEventInput(CHARTER, rawCommitEvent({ id: "", actor: "", amount: -5 }));
    expect(result).toEqual(shape("commit", "actor", "amount", "id"));
  });

  it("a revoke with both fields bad", () => {
    expect(readEventInput(CHARTER, rawRevokeEvent({ grantId: "", by: 3 }))).toEqual(shape("revoke", "by", "grantId"));
  });

  it("an unknown kind and a bad seq are both named when reading a logged event, and `kind` sorts first", () => {
    expect(readLogEvent(CHARTER, { kind: "ratify", seq: 0 })).toEqual(shape("unknown", "kind", "seq"));
  });
});

describe("readEventInput: unknown-capability comes after shape, and names the first outsider in the event's order", () => {
  it("a grant naming a capability outside the charter", () => {
    expect(readEventInput(CHARTER, rawGrantEvent({ capabilities: ["purchase", "launder"] }))).toEqual({
      ok: false,
      failure: { kind: "invalid", rejection: { kind: "unknown-capability", capability: "launder" } },
    });
  });

  it("the first outsider in the event's own order is the one named", () => {
    const result = readEventInput(CHARTER, rawGrantEvent({ capabilities: ["purchase", "zeta", "alpha"] }));
    expect(result).toMatchObject({ failure: { rejection: { capability: "zeta" } } });
  });

  it("a commit naming a capability outside the charter", () => {
    expect(readEventInput(CHARTER, rawCommitEvent({ capability: "launder" }))).toEqual({
      ok: false,
      failure: { kind: "invalid", rejection: { kind: "unknown-capability", capability: "launder" } },
    });
  });

  it("is case-sensitive and does no trimming", () => {
    for (const capability of ["Purchase", "purchase ", " purchase", "PURCHASE"]) {
      expect(readEventInput(CHARTER, rawCommitEvent({ capability }))).toMatchObject({ failure: { rejection: { kind: "unknown-capability", capability } } });
    }
  });

  it("a malformed field anywhere outranks an unknown capability", () => {
    expect(readEventInput(CHARTER, rawGrantEvent({ capabilities: ["launder"], limit: -1 }))).toEqual(shape("grant", "limit"));
    expect(readEventInput(CHARTER, rawCommitEvent({ capability: "launder", amount: -1 }))).toEqual(shape("commit", "amount"));
  });

  it("a repeat in the list is a shape problem even when every name is unknown", () => {
    expect(readEventInput(CHARTER, rawGrantEvent({ capabilities: ["launder", "launder"] }))).toEqual(shape("grant", "capabilities"));
  });

  it("the charter's own vocabulary is what is consulted, not a built-in one", () => {
    const narrow = { roots: [principalId("dana")], capabilities: ["only-this"] } as const;
    expect(readEventInput(narrow, rawGrantEvent({ capabilities: ["purchase"] }))).toMatchObject({ failure: { rejection: { kind: "unknown-capability" } } });
    expect(readEventInput(narrow, rawGrantEvent({ capabilities: ["only-this"] })).ok).toBe(true);
  });
});

describe("readLogEvent", () => {
  it("returns the event with its seq", () => {
    expect(readLogEvent(CHARTER, { ...rawRevokeEvent(), seq: 11 })).toEqual({
      ok: true,
      event: { kind: "revoke", grantId: grantId("G2"), by: principalId("cfo"), seq: 11 },
    });
    const grant = readLogEvent(CHARTER, { ...rawGrantEvent(), seq: 1 });
    expect(grant.ok && grant.event.seq).toBe(1);
    const commit = readLogEvent(CHARTER, { ...rawCommitEvent(), seq: 7 });
    expect(commit.ok && commit.event.seq).toBe(7);
  });

  it("builds the result from the fields it read: a nested `seq` or an extra key does not come along", () => {
    const result = readLogEvent(CHARTER, { ...rawGrantEvent({ seq: 99 }), seq: 3, note: "x" });
    if (!result.ok || result.event.kind !== "grant") throw new Error("unreachable");
    expect(Object.keys(result.event)).toEqual(["kind", "grant", "seq"]);
    expect(Object.keys(result.event.grant)).not.toContain("seq");
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
    ["a fraction", 1.5],
    ["NaN", Number.NaN],
    ["a numeric string", "3"],
    ["null", null],
    ["a bigint", 3n],
    ["beyond the safe integers", Number.MAX_SAFE_INTEGER + 1],
  ])("a seq that is %s is invalid-event-shape naming `seq`, not a seq-mismatch", (_label, seq) => {
    expect(readLogEvent(CHARTER, { ...rawGrantEvent(), seq })).toEqual(shape("grant", "seq"));
  });

  it("a missing seq is named", () => {
    expect(readLogEvent(CHARTER, rawGrantEvent())).toEqual(shape("grant", "seq"));
  });

  it("a malformed payload field and a bad seq are both named", () => {
    expect(readLogEvent(CHARTER, { ...rawGrantEvent({ limit: -1 }), seq: 0 })).toEqual(shape("grant", "limit", "seq"));
  });

  it("a non-object is `kind` only, as for an input", () => {
    expect(readLogEvent(CHARTER, null)).toEqual(shape("unknown", "kind"));
  });

  it("unknown-capability applies to a logged event too, after its shape", () => {
    expect(readLogEvent(CHARTER, { ...rawCommitEvent({ capability: "launder" }), seq: 2 })).toMatchObject({
      failure: { rejection: { kind: "unknown-capability", capability: "launder" } },
    });
    expect(readLogEvent(CHARTER, { ...rawCommitEvent({ capability: "launder" }), seq: 0 })).toEqual(shape("commit", "seq"));
  });

  it("readEventInput does not look at `seq` at all: an input that carries one comes back without it", () => {
    const result: IntakeResult<unknown> = readEventInput(CHARTER, { ...rawGrantEvent(), seq: -5 });
    expect(result.ok).toBe(true);
    expect(result.ok && "seq" in (result.event as object)).toBe(false);
  });
});
