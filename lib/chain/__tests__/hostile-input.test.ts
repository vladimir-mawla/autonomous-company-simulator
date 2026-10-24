import { describe, expect, it } from "vitest";
import { MAX_CHARTER_ENTRIES, readCharter, readEventInput, readLogEvent } from "../index.js";
import { CHARTER, rawCommit, rawCommitEvent, rawGrant, rawGrantEvent, rawRevokeEvent } from "./fixtures.js";

/**
 * Input that fights back: getters that throw or change their answer, Proxies, revoked Proxies, lists that
 * lie about their length. The contract (plan §6 M3, `lib/chain/intake.ts`): every property is read exactly
 * once; a read that throws is `hostile`, never an exception out of intake; a charter that cannot be read is
 * an invalid charter.
 *
 * Reads are counted by accessors and by a Proxy's `get` trap. Every count test also asserts the exact SET of
 * keys that were read, so a test that read nothing (and so counted nothing wrong) cannot pass.
 */

type Reads = Map<string, number>;

/** A plain object whose properties are accessors that count each read under `prefix + key`. */
function spyObject(prefix: string, fields: Readonly<Record<string, unknown>>, reads: Reads): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(object, key, {
      enumerable: true,
      get() {
        reads.set(prefix + key, (reads.get(prefix + key) ?? 0) + 1);
        return value;
      },
    });
  }
  return object;
}

/** A real array behind a Proxy that counts each key read, with `length` and indices named `prefix.length` / `prefix[i]`. */
function spyList(prefix: string, items: readonly unknown[], reads: Reads): unknown {
  return new Proxy([...items], {
    get(target, key, receiver) {
      const name =
        typeof key === "symbol" ? `${prefix}.${key.toString()}` : key === "length" ? `${prefix}.length` : /^\d+$/.test(key) ? `${prefix}[${key}]` : `${prefix}.${key}`;
      reads.set(name, (reads.get(name) ?? 0) + 1);
      return Reflect.get(target, key, receiver);
    },
  });
}

function everyReadHappenedOnce(reads: Reads, expectedKeys: readonly string[]): void {
  expect([...reads.keys()].sort()).toEqual([...expectedKeys].sort());
  for (const [key, count] of reads) expect(count, key).toBe(1);
}

/** A getter that answers `first` the first time and `later` every time after. */
function flipping(first: unknown, later: unknown): PropertyDescriptor {
  let calls = 0;
  return {
    enumerable: true,
    get() {
      calls += 1;
      return calls === 1 ? first : later;
    },
  };
}

/**
 * A copy of `base` with `key` replaced by an accessor. The copy takes `base`'s property DESCRIPTORS rather than
 * spreading it, because a spread would call any accessor `base` already has (and a throwing one would throw here).
 */
function withAccessor(base: Readonly<Record<string, unknown>>, key: string, descriptor: PropertyDescriptor): Record<string, unknown> {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(base)) as Record<string, unknown>;
  Object.defineProperty(copy, key, { configurable: true, ...descriptor });
  return copy;
}

/** A real array behind a Proxy whose element at `index` answers `first` once and `later` thereafter. */
function elementFlipping(items: readonly unknown[], index: number, first: unknown, later: unknown): unknown {
  let calls = 0;
  return new Proxy([...items], {
    get(target, key, receiver) {
      if (key === String(index)) {
        calls += 1;
        return calls === 1 ? first : later;
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

function throwing(thrown: unknown): PropertyDescriptor {
  return {
    enumerable: true,
    get() {
      throw thrown;
    },
  };
}

const hostile = (path: string) => ({ ok: false, failure: { kind: "hostile", message: `reading ${path} threw` } });

describe("every field is read exactly once", () => {
  const grantFields = { id: "G1", parent: null, grantor: "dana", grantee: "cfo", limit: 1000, depth: 3 };
  const grantKeys = ["kind", "grant", "grant.id", "grant.parent", "grant.grantor", "grant.grantee", "grant.capabilities", "grant.capabilities.length", "grant.capabilities[0]", "grant.capabilities[1]", "grant.limit", "grant.depth"];

  it("a grant: the envelope, every payload field, the capability list's length and each element", () => {
    const reads: Reads = new Map();
    const raw = spyObject("", { kind: "grant", grant: spyObject("grant.", { ...grantFields, capabilities: spyList("grant.capabilities", ["purchase", "refund"], reads) }, reads) }, reads);
    expect(readEventInput(CHARTER, raw).ok).toBe(true);
    everyReadHappenedOnce(reads, grantKeys);
  });

  it("a logged grant: the same, plus seq", () => {
    const reads: Reads = new Map();
    const raw = spyObject("", { kind: "grant", seq: 4, grant: spyObject("grant.", { ...grantFields, capabilities: spyList("grant.capabilities", ["purchase", "refund"], reads) }, reads) }, reads);
    expect(readLogEvent(CHARTER, raw).ok).toBe(true);
    everyReadHappenedOnce(reads, [...grantKeys, "seq"]);
  });

  it("a grant refused for shape is still read once per field, and every field is read (the refusal does not stop reading)", () => {
    const reads: Reads = new Map();
    const raw = spyObject("", { kind: "grant", grant: spyObject("grant.", { ...grantFields, limit: -1, id: "", capabilities: spyList("grant.capabilities", ["purchase", "purchase"], reads) }, reads) }, reads);
    expect(readEventInput(CHARTER, raw).ok).toBe(false);
    everyReadHappenedOnce(reads, grantKeys);
  });

  it("a commit", () => {
    const reads: Reads = new Map();
    const raw = spyObject("", { kind: "commit", commit: spyObject("commit.", { id: "c1", actor: "a", actedUnder: "G4", capability: "purchase", amount: 5 }, reads) }, reads);
    expect(readEventInput(CHARTER, raw).ok).toBe(true);
    everyReadHappenedOnce(reads, ["kind", "commit", "commit.id", "commit.actor", "commit.actedUnder", "commit.capability", "commit.amount"]);
  });

  it("a revoke", () => {
    const reads: Reads = new Map();
    const raw = spyObject("", { kind: "revoke", grantId: "G2", by: "cfo" }, reads);
    expect(readEventInput(CHARTER, raw).ok).toBe(true);
    everyReadHappenedOnce(reads, ["kind", "grantId", "by"]);
  });

  it("an unknown kind: `kind` once, and nothing else is read as a payload", () => {
    const reads: Reads = new Map();
    expect(readEventInput(CHARTER, spyObject("", { kind: "ratify", grant: rawGrant() }, reads))).toMatchObject({ ok: false });
    everyReadHappenedOnce(reads, ["kind"]);
  });

  it("a charter: roots, capabilities, each list's length and each element", () => {
    const reads: Reads = new Map();
    const input = spyObject("", { roots: spyList("roots", ["dana", "eve"], reads), capabilities: spyList("capabilities", ["purchase"], reads) }, reads);
    expect(readCharter(input as never).ok).toBe(true);
    everyReadHappenedOnce(reads, ["roots", "roots.length", "roots[0]", "roots[1]", "capabilities", "capabilities.length", "capabilities[0]"]);
  });

  it("the charter passed to readEventInput has its vocabulary read once per call, not once per capability", () => {
    const reads: Reads = new Map();
    const charter = spyObject("", { roots: ["dana"], capabilities: spyList("capabilities", ["purchase", "refund", "hire"], reads) }, reads);
    expect(readEventInput(charter as never, rawGrantEvent({ capabilities: ["purchase", "refund", "hire"] })).ok).toBe(true);
    expect(reads.get("capabilities")).toBe(1);
  });
});

describe("a getter that changes its answer after the first read cannot contaminate a result", () => {
  const expectedGrant = { id: "G1", parent: null, grantor: "dana", grantee: "cfo", capabilities: ["purchase", "refund"], limit: 1000, depth: 3 };

  // For each payload field: a value that is valid, then a value that would be invalid, or would change the
  // result if it were read a second time.
  const later: Readonly<Record<string, unknown>> = {
    id: "",
    parent: "G-other",
    grantor: "mallory",
    grantee: "mallory",
    capabilities: ["launder"],
    limit: -1,
    depth: 999,
  };

  it.each(Object.keys(later))("grant.%s: valid on the first read, garbage afterwards: the result is the first answer", (field) => {
    const raw = { kind: "grant", grant: withAccessor(rawGrant(), field, flipping(expectedGrant[field as keyof typeof expectedGrant], later[field])) };
    expect(readEventInput(CHARTER, raw)).toEqual({ ok: true, event: { kind: "grant", grant: expectedGrant } });
  });

  const invalidFirst: Readonly<Record<string, unknown>> = {
    id: "",
    parent: 7,
    grantor: "",
    grantee: 7,
    capabilities: [],
    limit: -1,
    depth: 999,
  };

  it.each(Object.keys(invalidFirst))("grant.%s: invalid on the first read, valid afterwards: refused, not accepted by luck", (field) => {
    const raw = { kind: "grant", grant: withAccessor(rawGrant(), field, flipping(invalidFirst[field], expectedGrant[field as keyof typeof expectedGrant])) };
    expect(readEventInput(CHARTER, raw)).toMatchObject({ ok: false, failure: { kind: "invalid", rejection: { kind: "invalid-event-shape", fields: [field] } } });
  });

  it("a capability that is in the vocabulary on the first read and outside it afterwards is read once: the result keeps the first", () => {
    const raw = { kind: "grant", grant: rawGrant({ capabilities: elementFlipping(["purchase"], 0, "purchase", "launder") }) };
    expect(readEventInput(CHARTER, raw)).toMatchObject({ ok: true, event: { grant: { capabilities: ["purchase"] } } });
  });

  it("`kind` flipping from grant to revoke: the payload is read as the grant that was seen", () => {
    const raw = withAccessor({ grant: rawGrant(), grantId: "G2", by: "cfo" }, "kind", flipping("grant", "revoke"));
    expect(readEventInput(CHARTER, raw)).toMatchObject({ ok: true, event: { kind: "grant" } });
  });

  it("the grant payload flipping from an object to null: the first object is the one read", () => {
    const raw = withAccessor({ kind: "grant" }, "grant", flipping(rawGrant(), null));
    expect(readEventInput(CHARTER, raw)).toMatchObject({ ok: true, event: { kind: "grant" } });
  });

  it("commit.amount valid then huge, commit.capability in the vocabulary then outside it", () => {
    const amountFlip = { kind: "commit", commit: withAccessor(rawCommit(), "amount", flipping(5, 2 ** 60)) };
    expect(readEventInput(CHARTER, amountFlip)).toMatchObject({ ok: true, event: { commit: { amount: 5 } } });
    const capabilityFlip = { kind: "commit", commit: withAccessor(rawCommit(), "capability", flipping("purchase", "launder")) };
    expect(readEventInput(CHARTER, capabilityFlip)).toMatchObject({ ok: true, event: { commit: { capability: "purchase" } } });
  });

  it("a revoke's `by` and `grantId` flipping", () => {
    const raw = withAccessor(withAccessor(rawRevokeEvent(), "by", flipping("cfo", "mallory")), "grantId", flipping("G2", "G1"));
    expect(readEventInput(CHARTER, raw)).toEqual({ ok: true, event: { kind: "revoke", grantId: "G2", by: "cfo" } });
  });

  it("seq on a logged event flipping from 3 to 0", () => {
    const raw = withAccessor(rawRevokeEvent(), "seq", flipping(3, 0));
    expect(readLogEvent(CHARTER, raw)).toMatchObject({ ok: true, event: { seq: 3 } });
  });

  it("a charter's roots flipping to garbage after the first read: the copy has the first answer", () => {
    const input = withAccessor({ capabilities: ["purchase"] }, "roots", flipping(["dana"], [""]));
    expect(readCharter(input as never)).toEqual({ ok: true, charter: { roots: ["dana"], capabilities: ["purchase"] } });
  });

  it("a charter list's element flipping to garbage after the first read", () => {
    const roots = elementFlipping(["dana"], 0, "dana", "");
    expect(readCharter({ roots, capabilities: ["purchase"] } as never)).toEqual({ ok: true, charter: { roots: ["dana"], capabilities: ["purchase"] } });
  });
});

describe("a read that throws is `hostile`, names the field, and never escapes as an exception", () => {
  const grantFields = ["id", "parent", "grantor", "grantee", "capabilities", "limit", "depth"];
  const commitFields = ["id", "actor", "actedUnder", "capability", "amount"];

  // What is thrown is untrusted too: intake must not call anything on it.
  const poison = {
    toString() {
      throw new Error("the thrown value's toString was called");
    },
    get message(): string {
      throw new Error("the thrown value's message was read");
    },
  };
  const thrown: ReadonlyArray<readonly [string, unknown]> = [
    ["an Error", new Error("boom")],
    ["a string", "boom"],
    ["undefined", undefined],
    ["an object whose toString and message throw", poison],
    ["a null-prototype object", Object.create(null)],
  ];

  describe.each(thrown)("throwing %s", (_label, value) => {
    it.each(grantFields)("grant.%s", (field) => {
      const raw = { kind: "grant", grant: withAccessor(rawGrant(), field, throwing(value)) };
      expect(readEventInput(CHARTER, raw)).toEqual(hostile(`grant.${field}`));
    });
    it.each(commitFields)("commit.%s", (field) => {
      const raw = { kind: "commit", commit: withAccessor(rawCommit(), field, throwing(value)) };
      expect(readEventInput(CHARTER, raw)).toEqual(hostile(`commit.${field}`));
    });
    it.each(["grantId", "by"])("revoke.%s", (field) => {
      expect(readEventInput(CHARTER, withAccessor(rawRevokeEvent(), field, throwing(value)))).toEqual(hostile(field));
    });
    it("kind, the grant payload, the commit payload, and seq", () => {
      expect(readEventInput(CHARTER, withAccessor(rawGrantEvent(), "kind", throwing(value)))).toEqual(hostile("kind"));
      expect(readEventInput(CHARTER, withAccessor(rawGrantEvent(), "grant", throwing(value)))).toEqual(hostile("grant"));
      expect(readEventInput(CHARTER, withAccessor(rawCommitEvent(), "commit", throwing(value)))).toEqual(hostile("commit"));
      expect(readLogEvent(CHARTER, withAccessor({ ...rawGrantEvent(), seq: 1 }, "seq", throwing(value)))).toEqual(hostile("seq"));
    });
  });

  it("a capability list whose length throws, and one whose element throws", () => {
    const lengthThrows = new Proxy(["purchase"], { get: (target, key, receiver) => (key === "length" ? ((): never => { throw new Error("length"); })() : Reflect.get(target, key, receiver)) });
    expect(readEventInput(CHARTER, rawGrantEvent({ capabilities: lengthThrows }))).toEqual(hostile("grant.capabilities.length"));
    const elementThrows = new Proxy(["purchase", "refund"], { get: (target, key, receiver) => (key === "1" ? ((): never => { throw new Error("element"); })() : Reflect.get(target, key, receiver)) });
    expect(readEventInput(CHARTER, rawGrantEvent({ capabilities: elementThrows }))).toEqual(hostile("grant.capabilities[1]"));
  });

  it("a Proxy event whose `get` trap throws on every key: `kind` is the first read, so that is the one named", () => {
    const raw = new Proxy({}, { get: () => { throw new Error("trap"); } });
    expect(readEventInput(CHARTER, raw)).toEqual(hostile("kind"));
  });

  it("a revoked Proxy as the event, as the grant payload, and as the capability list", () => {
    const revokedEvent = Proxy.revocable({}, {});
    revokedEvent.revoke();
    expect(readEventInput(CHARTER, revokedEvent.proxy)).toEqual(hostile("kind"));

    const revokedGrant = Proxy.revocable({}, {});
    revokedGrant.revoke();
    expect(readEventInput(CHARTER, { kind: "grant", grant: revokedGrant.proxy })).toEqual(hostile("grant.id"));

    // `Array.isArray` throws on a revoked Proxy; intake has to treat that as a hostile read, not let it escape.
    const revokedList = Proxy.revocable([], {});
    revokedList.revoke();
    expect(() => Array.isArray(revokedList.proxy)).toThrow(TypeError);
    expect(readEventInput(CHARTER, rawGrantEvent({ capabilities: revokedList.proxy }))).toEqual(hostile("grant.capabilities"));
  });

  it("hostile outranks invalid, wherever the throwing field sits relative to the invalid one", () => {
    // limit is read after id, and id is invalid; the throw comes later. Intake keeps reading after an invalid field.
    const after = { kind: "grant", grant: withAccessor(rawGrant({ id: "" }), "depth", throwing(new Error("late"))) };
    expect(readEventInput(CHARTER, after)).toEqual(hostile("grant.depth"));
    const before = { kind: "grant", grant: withAccessor(rawGrant({ limit: -1 }), "id", throwing(new Error("early"))) };
    expect(readEventInput(CHARTER, before)).toEqual(hostile("grant.id"));
  });

  it("the first throwing read in the fixed order is the one named when several would throw", () => {
    const grant = withAccessor(withAccessor(rawGrant(), "limit", throwing(1)), "grantee", throwing(2));
    expect(readEventInput(CHARTER, { kind: "grant", grant })).toEqual(hostile("grant.grantee"));
  });

  it("a Proxy that throws on every operation except `get` is read fine: intake uses property reads and nothing else", () => {
    const refuse = (): never => {
      throw new Error("only `get` is allowed");
    };
    const guard = (target: object): object =>
      new Proxy(target, {
        get: (t, key) => Reflect.get(t, key),
        has: refuse,
        ownKeys: refuse,
        getOwnPropertyDescriptor: refuse,
        getPrototypeOf: refuse,
        isExtensible: refuse,
        set: refuse,
        defineProperty: refuse,
        deleteProperty: refuse,
      });
    const grant = guard({ ...rawGrant(), capabilities: ["purchase", "refund"] });
    expect(readEventInput(CHARTER, guard({ kind: "grant", grant }))).toMatchObject({ ok: true });
  });

  it("an accessor on the prototype is read, once, like an own one", () => {
    let reads = 0;
    class Event {
      get kind(): string {
        reads += 1;
        return "revoke";
      }
      grantId = "G2";
      by = "cfo";
    }
    expect(readEventInput(CHARTER, new Event())).toMatchObject({ ok: true, event: { kind: "revoke" } });
    expect(reads).toBe(1);
  });

  it("a structure that refers to itself is not followed: nothing recurses", () => {
    const self: Record<string, unknown> = { kind: "grant" };
    self["grant"] = self;
    expect(readEventInput(CHARTER, self)).toMatchObject({ ok: false, failure: { kind: "invalid", rejection: { eventKind: "grant" } } });
    const looping = rawGrant();
    looping["capabilities"] = [looping, looping];
    expect(readEventInput(CHARTER, { kind: "grant", grant: looping })).toMatchObject({ ok: false });
  });
});

describe("a list that lies about its length is not looped over", () => {
  /** An array-like Proxy over an empty array that claims `length` elements and answers any index with `name-<i>`. */
  function liar(length: unknown, reads: Reads): unknown {
    return new Proxy([], {
      get(target, key, receiver) {
        if (key === "length") return length;
        if (typeof key === "string" && /^\d+$/.test(key)) {
          reads.set("element", (reads.get("element") ?? 0) + 1);
          return `name-${key}`;
        }
        return Reflect.get(target, key, receiver);
      },
    });
  }

  it("an event's capability list claiming 2**32 - 1 elements is invalid-event-shape and none of its elements is read", () => {
    const reads: Reads = new Map();
    const result = readEventInput(CHARTER, rawGrantEvent({ capabilities: liar(2 ** 32 - 1, reads) }));
    expect(result).toMatchObject({ ok: false, failure: { rejection: { kind: "invalid-event-shape", fields: ["capabilities"] } } });
    expect(reads.size).toBe(0);
  });

  it("a charter's roots and capabilities claiming 2**32 - 1 elements are invalid and none of their elements is read", () => {
    const reads: Reads = new Map();
    expect(readCharter({ roots: liar(2 ** 32 - 1, reads), capabilities: liar(2 ** 32 - 1, reads) } as never)).toEqual({ ok: false, fields: ["capabilities", "roots"] });
    expect(reads.size).toBe(0);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -1],
    ["a fraction", 1.5],
    ["a numeric string", "2"],
    ["a bigint", 2n],
    ["undefined", undefined],
    ["not a safe integer", 2 ** 53],
  ])("a length that is %s is refused without reading an element", (_label, length) => {
    const reads: Reads = new Map();
    expect(readEventInput(CHARTER, rawGrantEvent({ capabilities: liar(length, reads) }))).toMatchObject({ ok: false });
    expect(readCharter({ roots: liar(length, reads), capabilities: ["purchase"] } as never)).toEqual({ ok: false, fields: ["roots"] });
    expect(reads.size).toBe(0);
  });

  it("the bound in use is the exported one", () => {
    expect(MAX_CHARTER_ENTRIES).toBeGreaterThan(1);
    const reads: Reads = new Map();
    readEventInput(CHARTER, rawGrantEvent({ capabilities: liar(MAX_CHARTER_ENTRIES + 1, reads) }));
    expect(reads.size).toBe(0);
  });
});

describe("a charter that cannot be read is an invalid charter, never an exception", () => {
  it.each([
    ["roots", ["roots"]],
    ["capabilities", ["capabilities"]],
  ] as const)("a throwing getter for %s marks that field", (field, fields) => {
    const input = withAccessor({ roots: ["dana"], capabilities: ["purchase"] }, field, throwing(new Error("boom")));
    expect(readCharter(input as never)).toEqual({ ok: false, fields });
  });

  it("both throwing marks both, sorted", () => {
    const input = withAccessor(withAccessor({}, "roots", throwing(1)), "capabilities", throwing(2));
    expect(readCharter(input as never)).toEqual({ ok: false, fields: ["capabilities", "roots"] });
  });

  it("a Proxy charter whose get trap throws, and a revoked one", () => {
    expect(readCharter(new Proxy({}, { get: () => { throw new Error("trap"); } }) as never)).toEqual({ ok: false, fields: ["capabilities", "roots"] });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(readCharter(revoked.proxy as never)).toEqual({ ok: false, fields: ["capabilities", "roots"] });
  });

  it("a revoked Proxy as a list, a list whose length throws, and a list whose element throws", () => {
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(readCharter({ roots: revoked.proxy, capabilities: ["purchase"] } as never)).toEqual({ ok: false, fields: ["roots"] });

    const lengthThrows = new Proxy(["dana"], { get: (t, k, r) => (k === "length" ? ((): never => { throw new Error("length"); })() : Reflect.get(t, k, r)) });
    expect(readCharter({ roots: lengthThrows, capabilities: ["purchase"] } as never)).toEqual({ ok: false, fields: ["roots"] });

    const elementThrows = new Proxy(["purchase"], { get: (t, k, r) => (k === "0" ? ((): never => { throw new Error("element"); })() : Reflect.get(t, k, r)) });
    expect(readCharter({ roots: ["dana"], capabilities: elementThrows } as never)).toEqual({ ok: false, fields: ["capabilities"] });
  });
});
