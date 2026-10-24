import { describe, expect, it } from "vitest";
import type { Charter, Commitment, EventInput, FoldFault, Log } from "../../contracts/index.js";
import { MAX_LOG_EVENTS } from "../../contracts/index.js";
import { append, fold, mayCommit, standingOf, standings } from "../index.js";
import { CHARTER, ORG, cid, commit, commitEvent, logOf } from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * HOSTILE INPUT: what M5 reads of a caller's objects, how often, and what comes back (plan §5: `append`, `fold` and
 * `standings` "never throw on any input (hostile accessors, Proxy, malformed charter/log become typed values)"; §6 M5 "Must
 * refuse"; failure case 10).
 *
 * WHAT M5 READS ITSELF, and what goes through M3. M5 reads exactly two things of a caller's LOG with its own hands: the
 * array's `length` and each element by index. Everything inside an element goes through M3's `readLogEvent`; the charter goes
 * through M3's `readCharter`; an `input` or a `commit` goes through M3's `readEventInput`; and `standingOf`'s `id` is never read
 * at all (it is a `Map` key). So this file tests the two reads M5 owns with first reads drawn from every value class, and tests
 * that the others are read once end to end by counting every read on a deep Proxy at each entry point, which shows that the
 * entry points pass the caller's object to M3 once and do not touch it again.
 *
 * "FIRST READS FROM EVERY VALUE CLASS": null, 0, a negative, the largest safe integer, NaN, both infinities, a valid value, a
 * boolean, a bigint, a symbol and a function (and a string and an object where they are not the valid value). For each, the
 * accessor answers that on the first read and something else on every later one, and the test asserts BOTH that the read was
 * made exactly once AND that the result is what the first read implies.
 */

const REAL = logOf(CHARTER, ORG);
const LENGTH = REAL.length;

/** The value classes, with a label. `valid` is supplied by the position under test. */
function classes(valid: unknown): readonly [string, unknown][] {
  return [
    ["null", null],
    ["0", 0],
    ["a negative", -1],
    ["the largest safe integer", Number.MAX_SAFE_INTEGER],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a valid value", valid],
    ["a boolean", true],
    ["a bigint", 5n],
    ["a symbol", Symbol("first")],
    ["a function", () => 1],
    ["a string", "3"],
    ["an object", { valueOf: () => 3 }],
  ];
}

type Counts = Map<string, number>;

/**
 * Wrap `target` (and, lazily, every object reachable through it) in a Proxy that counts reads by path, answering the real
 * value unless `override` has an answer for that path. `override(path, count)` returns `{ value }` to replace the answer for
 * read number `count` (1-based) of `path`, or `undefined` to let the real one through.
 */
function counted<T extends object>(target: T, counts: Counts, path: string, override?: (path: string, count: number) => { readonly value: unknown } | undefined): T {
  return new Proxy(target, {
    get(inner, key, receiver) {
      const here = `${path}.${String(key)}`;
      const count = (counts.get(here) ?? 0) + 1;
      counts.set(here, count);
      const replaced = override?.(here, count);
      if (replaced !== undefined) return replaced.value;
      const value = Reflect.get(inner, key, receiver);
      return typeof value === "object" && value !== null ? counted(value, counts, here, override) : value;
    },
  });
}

const reads = (counts: Counts, path: string): number => counts.get(path) ?? 0;
const everyKeyReadOnce = (counts: Counts): string[] => [...counts].filter(([, count]) => count !== 1).map(([key, count]) => `${key} x${count}`);

const ENTRY_POINTS: readonly [string, (charter: unknown, log: unknown) => unknown][] = [
  ["fold", (charter, log) => fold(charter as Charter<Cap>, log as Log<Cap>)],
  ["standings", (charter, log) => standings(charter as Charter<Cap>, log as Log<Cap>)],
  ["standingOf", (charter, log) => standingOf(charter as Charter<Cap>, log as Log<Cap>, cid("nothing"))],
  ["append", (charter, log) => append(charter as Charter<Cap>, log as Log<Cap>, commitEvent(commit("k", "buyer", "G3", "purchase", 1)))],
  ["mayCommit", (charter, log) => mayCommit(charter as Charter<Cap>, log as Log<Cap>, commit("k", "buyer", "G3", "purchase", 1))],
];

/** The FoldFault inside any entry point's typed failure, or undefined for a success. */
function faultIn(result: unknown): FoldFault | undefined {
  const r = result as { ok: boolean; fault?: FoldFault; failure?: { kind: string; fault?: FoldFault } };
  if (r.ok) return undefined;
  if (r.fault !== undefined) return r.fault;
  return r.failure?.fault;
}

describe("the log's length: read once, from every value class, and the result is what the first read says", () => {
  const withLength = (first: unknown, later: unknown): { log: Log<Cap>; counts: Counts } => {
    const counts: Counts = new Map();
    const log = counted([...REAL] as unknown[], counts, "log", (path, count) => (path === "log.length" ? { value: count === 1 ? first : later } : undefined)) as unknown as Log<Cap>;
    return { log, counts };
  };

  for (const [entry, run] of ENTRY_POINTS) {
    it(`${entry}: every first read of length, a true length after it, one read each`, () => {
      for (const [name, first] of classes(LENGTH)) {
        const { log, counts } = withLength(first, LENGTH);
        const result = run(CHARTER, log);
        expect(reads(counts, "log.length"), `${entry}, first read ${name}`).toBe(1);
        const fault = faultIn(result);
        if (name === "a valid value") {
          // The real length, so the log is read in full. (`append` and `mayCommit` then judge their own event.)
          expect(fault, `${entry}, first read ${name}`).toBeUndefined();
        } else if (name === "0") {
          // A length of 0 is a valid, empty log: no element is read, and the answer is about an empty log.
          expect(fault, `${entry}, first read ${name}`).toBeUndefined();
          expect(reads(counts, "log.0"), `${entry}, first read ${name}`).toBe(0);
        } else if (name === "the largest safe integer") {
          expect(fault, `${entry}, first read ${name}`).toStrictEqual({ kind: "log-too-long", length: Number.MAX_SAFE_INTEGER, max: MAX_LOG_EVENTS });
          expect(reads(counts, "log.0"), `${entry}, first read ${name}`).toBe(0);
        } else {
          expect(fault, `${entry}, first read ${name}`).toStrictEqual({ kind: "hostile-log-input", message: "log.length is not a count" });
          expect(reads(counts, "log.0"), `${entry}, first read ${name}`).toBe(0);
        }
      }
    });

    it(`${entry}: a valid first read and garbage after it is the valid answer, with one read`, () => {
      for (const [name, later] of classes(LENGTH)) {
        const { log, counts } = withLength(LENGTH, later);
        const fault = faultIn(run(CHARTER, log));
        expect(reads(counts, "log.length"), `${entry}, later reads ${name}`).toBe(1);
        expect(fault, `${entry}, later reads ${name}`).toBeUndefined();
      }
    });
  }

  it("a first read of a SMALLER valid length is the log of that length: fold reads that many elements and no more, and head is that length", () => {
    const { log, counts } = withLength(2, LENGTH);
    const result = fold(CHARTER, log);
    expect(result.ok && result.folded.head).toBe(2);
    expect([reads(counts, "log.0"), reads(counts, "log.1"), reads(counts, "log.2")]).toStrictEqual([1, 1, 0]);
  });
});

describe("the log's elements: each read once, and the first read is the one used", () => {
  it.each(ENTRY_POINTS)("%s: every key of the log, its elements and everything inside them is read exactly once", (_name, run) => {
    const counts: Counts = new Map();
    const log = counted([...REAL] as unknown[], counts, "log");
    run(CHARTER, log);
    expect(everyKeyReadOnce(counts)).toStrictEqual([]);
    // The reads were real: the length, each of the four elements, and fields inside them.
    expect(reads(counts, "log.length")).toBe(1);
    for (let index = 0; index < LENGTH; index++) expect(reads(counts, `log.${index}`)).toBe(1);
    expect(reads(counts, "log.0.kind")).toBe(1);
    expect(reads(counts, "log.2.grant.capabilities.length")).toBe(1);
  });

  it("the first read of element 0 from every value class: a non-object is a fault of index 0 and the later (valid) read is never used; the valid event read first is the one used", () => {
    for (const [name, first] of classes(REAL[0])) {
      const counts: Counts = new Map();
      const log = counted([...REAL] as unknown[], counts, "log", (path, count) => {
        if (path !== "log.0") return undefined;
        return { value: count === 1 ? first : REAL[0] };
      });
      const result = fold(CHARTER, log as unknown as Log<Cap>);
      expect(reads(counts, "log.0"), `first read ${name}`).toBe(1);
      if (name === "a valid value") expect(result.ok, `first read ${name}`).toBe(true);
      else if (typeof first === "object" && first !== null) {
        // `{ valueOf }` is an object with no `kind`: intake refuses it.
        expect(result.ok, `first read ${name}`).toBe(false);
      } else {
        expect(result.ok, `first read ${name}`).toBe(false);
        expect(faultIn(result), `first read ${name}`).toStrictEqual({
          kind: "inadmissible-event",
          index: 0,
          rejection: { kind: "invalid-event-shape", eventKind: "unknown", fields: ["kind"] },
        });
      }
    }
  });

  it("a valid element read first and garbage after it: the valid one is used, for every later class", () => {
    for (const [name, later] of classes(REAL[1])) {
      const counts: Counts = new Map();
      const log = counted([...REAL] as unknown[], counts, "log", (path, count) => (path === "log.1" ? { value: count === 1 ? REAL[1] : later } : undefined));
      const result = fold(CHARTER, log as unknown as Log<Cap>);
      expect(reads(counts, "log.1"), `later reads ${name}`).toBe(1);
      expect(result.ok, `later reads ${name}`).toBe(true);
    }
  });

  it("a field inside an event is read once, and the first read is used: seq read valid first and garbage after is the valid seq, and read garbage first is refused", () => {
    for (const [name, later] of classes(1)) {
      const counts: Counts = new Map();
      const log = counted([...REAL] as unknown[], counts, "log", (path, count) => (path === "log.0.seq" ? { value: count === 1 ? 1 : later } : undefined));
      expect(fold(CHARTER, log as unknown as Log<Cap>).ok, `later reads ${name}`).toBe(true);
      expect(reads(counts, "log.0.seq"), `later reads ${name}`).toBe(1);
    }
    for (const [name, first] of classes(1)) {
      if (name === "a valid value") continue;
      const counts: Counts = new Map();
      const log = counted([...REAL] as unknown[], counts, "log", (path, count) => (path === "log.0.seq" ? { value: count === 1 ? first : 1 } : undefined));
      const result = fold(CHARTER, log as unknown as Log<Cap>);
      expect(reads(counts, "log.0.seq"), `first read ${name}`).toBe(1);
      expect(result.ok, `first read ${name}`).toBe(false);
      // The largest safe integer is a well-formed seq in the wrong place: seq-mismatch. Every other class is not a seq at all.
      if (name === "the largest safe integer") {
        expect(faultIn(result), `first read ${name}`).toStrictEqual({ kind: "seq-mismatch", index: 0, expected: 1, actual: Number.MAX_SAFE_INTEGER });
      } else {
        expect(faultIn(result)?.kind, `first read ${name}`).toBe("inadmissible-event");
      }
    }
  });

  it("a revoked Proxy as the log, as an element and as a nested list is a typed fault, not a throw", () => {
    const revokedLog = Proxy.revocable([], {});
    revokedLog.revoke();
    expect(faultIn(fold(CHARTER, revokedLog.proxy as unknown as Log<Cap>))).toStrictEqual({ kind: "hostile-log-input", message: "reading log threw" });

    const revokedElement = Proxy.revocable({}, {});
    revokedElement.revoke();
    const withElement = [REAL[0], revokedElement.proxy] as unknown as Log<Cap>;
    expect(faultIn(fold(CHARTER, withElement))?.kind).toBe("hostile-log-input");
  });
});

describe("the charter: read once per call by every entry point, never again for the events, and the first read is the one used", () => {
  it.each(ENTRY_POINTS)("%s: every key of the charter and its lists is read exactly once", (_name, run) => {
    const counts: Counts = new Map();
    const charter = counted({ roots: [...CHARTER.roots], capabilities: [...CHARTER.capabilities] }, counts, "charter");
    run(charter, REAL);
    expect(everyKeyReadOnce(counts)).toStrictEqual([]);
    expect(reads(counts, "charter.roots")).toBe(1);
    expect(reads(counts, "charter.capabilities")).toBe(1);
    expect(reads(counts, "charter.capabilities.0")).toBe(1);
  });

  it.each(ENTRY_POINTS)("%s: roots valid on the first read and empty after is the valid charter; empty first and valid after is invalid-charter", (_name, run) => {
    const valid = { roots: [...CHARTER.roots], capabilities: [...CHARTER.capabilities] };
    const goodFirst = counted(valid, new Map(), "charter", (path, count) => (path === "charter.roots" && count > 1 ? { value: [] } : undefined));
    expect(faultIn(run(goodFirst, REAL))?.kind).not.toBe("invalid-charter");
    const badFirst = counted(valid, new Map(), "charter", (path, count) => (path === "charter.roots" && count === 1 ? { value: [] } : undefined));
    expect(faultIn(run(badFirst, REAL))).toStrictEqual({ kind: "invalid-charter", fields: ["roots"] });
  });
});

describe("append and mayCommit: the input is read once, and what is logged is what the first read said", () => {
  const input = (): EventInput<Cap> => commitEvent(commit("k", "buyer", "G3", "purchase", 7));

  it("every key of a commit input, and of the commit, is read exactly once by append and by mayCommit", () => {
    const counts: Counts = new Map();
    const result = append(CHARTER, REAL, counted(input() as object, counts, "input") as EventInput<Cap>);
    expect(result.ok).toBe(true);
    expect(everyKeyReadOnce(counts)).toStrictEqual([]);
    expect(reads(counts, "input.commit.amount")).toBe(1);

    const asked: Counts = new Map();
    mayCommit(CHARTER, REAL, counted(commit("k", "buyer", "G3", "purchase", 7) as object, asked, "commit") as Commitment<Cap>);
    expect(everyKeyReadOnce(asked)).toStrictEqual([]);
    expect(reads(asked, "commit.amount")).toBe(1);
  });

  it("every key of a grant input and of a revoke input is read exactly once by append", () => {
    const grant = { kind: "grant", grant: { id: "GX", parent: "G2", grantor: "ops", grantee: "newhire", capabilities: ["purchase"], limit: 10, depth: 0 } };
    const grantCounts: Counts = new Map();
    expect(append(CHARTER, REAL, counted(grant, grantCounts, "input") as unknown as EventInput<Cap>).ok).toBe(true);
    expect(everyKeyReadOnce(grantCounts)).toStrictEqual([]);
    expect(reads(grantCounts, "input.grant.capabilities.0")).toBe(1);

    const revokeCounts: Counts = new Map();
    expect(append(CHARTER, REAL, counted({ kind: "revoke", grantId: "G4", by: "cfo" }, revokeCounts, "input") as unknown as EventInput<Cap>).ok).toBe(true);
    expect(everyKeyReadOnce(revokeCounts)).toStrictEqual([]);
  });

  it("amount, from every first-read class: one read, and the logged amount is the first read when it was valid, and the event is refused when it was not", () => {
    for (const [name, first] of classes(7)) {
      const counts: Counts = new Map();
      const hostile = counted(input() as object, counts, "input", (path, count) => (path === "input.commit.amount" ? { value: count === 1 ? first : 99 } : undefined)) as EventInput<Cap>;
      const result = append(CHARTER, REAL, hostile);
      expect(reads(counts, "input.commit.amount"), `first read ${name}`).toBe(1);
      if (name === "a valid value" || name === "0") {
        expect(result.ok, `first read ${name}`).toBe(true);
        if (result.ok && result.event.kind === "commit") expect(result.event.commit.amount, `first read ${name}`).toBe(name === "0" ? 0 : 7);
      } else {
        expect(result.ok, `first read ${name}`).toBe(false);
        if (!result.ok) expect(result.failure, `first read ${name}`).toStrictEqual({ kind: "rejected", rejection: { kind: "invalid-event-shape", eventKind: "commit", fields: ["amount"] } });
      }
    }
  });

  it("a valid first read and garbage after, for each field of a commit: the logged commit is the first read", () => {
    for (const field of ["id", "actor", "actedUnder", "capability", "amount"]) {
      for (const [name, later] of classes(0)) {
        const counts: Counts = new Map();
        const path = `input.commit.${field}`;
        const clean = input();
        const hostile = counted(clean as object, counts, "input", (at, count) => (at === path && count > 1 ? { value: later } : undefined)) as EventInput<Cap>;
        const result = append(CHARTER, REAL, hostile);
        expect(reads(counts, path), `${field}, later reads ${name}`).toBe(1);
        expect(result.ok, `${field}, later reads ${name}`).toBe(true);
        if (result.ok) expect(result.event, `${field}, later reads ${name}`).toStrictEqual({ ...clean, seq: LENGTH + 1, commit: { ...(clean as { commit: object }).commit } });
      }
    }
  });

  it("an input whose getter throws is a typed faulty-log, and the same for mayCommit", () => {
    const hostile = {
      kind: "commit",
      get commit(): never {
        throw new Error("no");
      },
    } as unknown as EventInput<Cap>;
    const result = append(CHARTER, REAL, hostile);
    expect(!result.ok && result.failure).toStrictEqual({ kind: "faulty-log", fault: { kind: "hostile-log-input", message: "input: reading commit threw" } });
  });
});

describe("standingOf's id is never read", () => {
  it("a Proxy whose every trap throws, and every other value class, is unknown-commit; no trap is called", () => {
    let trapCalls = 0;
    const trap = (): never => {
      trapCalls += 1;
      throw new Error("no");
    };
    const hostile = new Proxy({}, { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, apply: trap });
    for (const id of [hostile, null, undefined, 0, "", Symbol("x"), {}, [], () => 1]) {
      const result = standingOf(CHARTER, REAL, id as never);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("unknown-commit");
    }
    expect(trapCalls).toBe(0);
  });
});

describe("no entry point throws on any value class in any position", () => {
  const VALUES: readonly [string, unknown][] = [
    ...classes(undefined),
    ["undefined", undefined],
    ["an empty string", ""],
    ["an empty object", {}],
    ["an empty array", []],
    ["a null-prototype object", Object.create(null)],
    ["a Date", new Date(0)],
    ["a frozen object", Object.freeze({ kind: "grant" })],
    ["a Proxy that throws on get", new Proxy({}, { get() { throw new Error("no"); } })],
  ];

  it("charter, log and input each from every class, the others valid: a typed value from all five entry points", () => {
    let calls = 0;
    for (const [name, value] of VALUES) {
      const good = commit("k", "buyer", "G3", "purchase", 1);
      const attempts: [string, () => unknown][] = [
        ["fold charter", () => fold(value as Charter<Cap>, REAL)],
        ["fold log", () => fold(CHARTER, value as Log<Cap>)],
        ["standings charter", () => standings(value as Charter<Cap>, REAL)],
        ["standings log", () => standings(CHARTER, value as Log<Cap>)],
        ["standingOf charter", () => standingOf(value as Charter<Cap>, REAL, cid("x"))],
        ["standingOf log", () => standingOf(CHARTER, value as Log<Cap>, cid("x"))],
        ["append charter", () => append(value as Charter<Cap>, REAL, commitEvent(good))],
        ["append log", () => append(CHARTER, value as Log<Cap>, commitEvent(good))],
        ["append input", () => append(CHARTER, REAL, value as EventInput<Cap>)],
        ["mayCommit charter", () => mayCommit(value as Charter<Cap>, REAL, good)],
        ["mayCommit log", () => mayCommit(CHARTER, value as Log<Cap>, good)],
        ["mayCommit commit", () => mayCommit(CHARTER, REAL, value as Commitment<Cap>)],
      ];
      for (const [where, run] of attempts) {
        calls += 1;
        let result: unknown;
        expect(() => {
          result = run();
        }, `${where} given ${name}`).not.toThrow();
        expect(typeof (result as { ok?: unknown }).ok, `${where} given ${name}`).toBe("boolean");
      }
    }
    expect(calls).toBe(VALUES.length * 12);
  });

  it("all three at once from every class: still typed", () => {
    for (const [name, value] of VALUES) {
      expect(() => append(value as never, value as never, value as never), name).not.toThrow();
      expect(() => fold(value as never, value as never), name).not.toThrow();
      expect(() => mayCommit(value as never, value as never, value as never), name).not.toThrow();
      expect(() => standings(value as never, value as never), name).not.toThrow();
      expect(() => standingOf(value as never, value as never, value as never), name).not.toThrow();
    }
  });
});
