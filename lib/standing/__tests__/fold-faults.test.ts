import { describe, expect, it } from "vitest";
import type { FoldFault, Log, Rejection } from "../../contracts/index.js";
import { MAX_LOG_EVENTS } from "../../contracts/index.js";
import { append, fold, mayCommit } from "../index.js";
import {
  CHARTER,
  CHARTER2,
  CAPABILITIES,
  ORG,
  SEEDS,
  SEED_LOOP_TIMEOUT_MS,
  STEPS,
  chunked,
  commit,
  commitEvent,
  grantEvent,
  logOf,
  mulberry32,
  profileOf,
  report,
  revokeEvent,
  runWorld,
  CHUNKS,
} from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * THE FIVE FOLD FAULTS: why a log or a charter could not be replayed at all (plan §4.3, §5, §6 M5, failure cases 05, 08, 10).
 *
 *   1. ONE ROW PER FAULT, MASKING-AWARE, each with a violating input and a repaired one that folds.
 *   2. WHAT COMES FIRST: the charter before the log, the log's own shape and length before any element, then each event in
 *      order: read, intake, `seq`, admission. Each pair is shown with the earlier one hiding the later and the later one
 *      appearing once the earlier is repaired.
 *   3. `MAX_LOG_EVENTS` at N and N + 1, for `fold`, for `append` and for `mayCommit`.
 *   4. A CORRUPTION PROPERTY over 1 500 generated logs: take a log that folds, damage it in a known way, and the fault must be
 *      exactly the one the damage implies. It must be able to reach every one of the five faults and every one of the fifteen
 *      rejections inside `inadmissible-event`, which a coverage test requires.
 *
 * What is NOT here, because it is `hostile-input.test.ts`'s: reading each property of the log once, and the value classes of
 * a first read.
 */


/** A raw event as it would arrive in a log, for the table; `seq` is where the table says it is. */
const rawGrant = (seq: number, overrides: Record<string, unknown> = {}): unknown => ({
  kind: "grant",
  seq,
  grant: { id: "GX", parent: "G2", grantor: "ops", grantee: "newhire", capabilities: ["purchase"], limit: 10, depth: 0, ...overrides },
});
const rawCommit = (seq: number, overrides: Record<string, unknown> = {}): unknown => ({
  kind: "commit",
  seq,
  commit: { id: "kx", actor: "buyer", actedUnder: "G3", capability: "purchase", amount: 1, ...overrides },
});
const rawRevoke = (seq: number, grantId: string, by: string): unknown => ({ kind: "revoke", seq, grantId, by });

const asLog = (events: readonly unknown[]): Log<Cap> => events as unknown as Log<Cap>;
const faultOf = (charter: unknown, log: unknown): FoldFault | undefined => {
  const result = fold(charter as typeof CHARTER, log as Log<Cap>);
  return result.ok ? undefined : result.fault;
};
const ORG_EVENTS: readonly unknown[] = logOf(CHARTER, ORG);

describe("invalid-charter: the charter cannot be read", () => {
  const rows: readonly [string, unknown, readonly string[]][] = [
    ["no roots", { roots: [], capabilities: ["purchase"] }, ["roots"]],
    ["no capabilities", { roots: ["dana"], capabilities: [] }, ["capabilities"]],
    ["roots missing", { capabilities: ["purchase"] }, ["roots"]],
    ["both lists bad, reported together and sorted", { roots: "dana", capabilities: 3 }, ["capabilities", "roots"]],
    ["a root that is not an id", { roots: [""], capabilities: ["purchase"] }, ["roots"]],
    ["not an object at all", null, ["capabilities", "roots"]],
    ["a string", "charter", ["capabilities", "roots"]],
  ];

  it.each(rows)("%s", (_name, charter, fields) => {
    expect(faultOf(charter, ORG_EVENTS)).toStrictEqual({ kind: "invalid-charter", fields });
    // Repaired: the real charter folds the same log.
    expect(fold(CHARTER, asLog(ORG_EVENTS)).ok).toBe(true);
  });

  it("the charter is judged before the log is touched: a bad charter hides a log that is not an array, a log that is too long and a log with a bad event", () => {
    const bad = { roots: [], capabilities: [] };
    expect(faultOf(bad, "not a log")?.kind).toBe("invalid-charter");
    expect(faultOf(bad, new Array(MAX_LOG_EVENTS + 1).fill(null))?.kind).toBe("invalid-charter");
    expect(faultOf(bad, [{ nonsense: true }])?.kind).toBe("invalid-charter");
    // And the faults those hide appear once the charter is fixed.
    expect(faultOf(CHARTER, "not a log")?.kind).toBe("hostile-log-input");
    expect(faultOf(CHARTER, new Array(MAX_LOG_EVENTS + 1).fill(null))?.kind).toBe("log-too-long");
    expect(faultOf(CHARTER, [{ nonsense: true }])?.kind).toBe("inadmissible-event");
  });
});

describe("hostile-log-input: the log cannot be read as a list of events", () => {
  const rows: readonly [string, unknown, string][] = [
    ["null", null, "log is not an array"],
    ["undefined", undefined, "log is not an array"],
    ["a number", 3, "log is not an array"],
    ["a string", "[]", "log is not an array"],
    ["an object", {}, "log is not an array"],
    ["an array-like object with a length and indices", { length: 1, 0: ORG_EVENTS[0] }, "log is not an array"],
  ];

  it.each(rows)("%s", (_name, log, message) => {
    expect(faultOf(CHARTER, log)).toStrictEqual({ kind: "hostile-log-input", message });
    expect(fold(CHARTER, asLog(ORG_EVENTS)).ok).toBe(true);
  });

  it("an element whose read throws names its index, and one whose field throws names the index and the field", () => {
    const throwing = [...ORG_EVENTS];
    Object.defineProperty(throwing, 2, {
      get() {
        throw new Error("no");
      },
    });
    expect(faultOf(CHARTER, throwing)).toStrictEqual({ kind: "hostile-log-input", message: "reading log[2] threw" });

    const field = [...ORG_EVENTS, rawGrant(5, { limit: 5 })];
    Object.defineProperty(field[4] as object, "kind", {
      get() {
        throw new Error("no");
      },
    });
    expect(faultOf(CHARTER, field)).toStrictEqual({ kind: "hostile-log-input", message: "log[4]: reading kind threw" });
  });

  it("a hostile event outranks a later bad one: the first failure in log order is the one reported", () => {
    const events = [ORG_EVENTS[0], { kind: "nonsense", seq: 2 }, new Proxy({}, { get() { throw new Error("no"); } })];
    expect(faultOf(CHARTER, events)).toStrictEqual({ kind: "inadmissible-event", index: 1, rejection: { kind: "invalid-event-shape", eventKind: "unknown", fields: ["kind"] } });
  });
});

describe("log-too-long: the log is longer than MAX_LOG_EVENTS", () => {
  /** One grant and then `count - 1` commits under a grant that does not exist: void, so each costs almost nothing to fold. */
  const cheapLog = (count: number): Log<Cap> => {
    const events: unknown[] = [{ kind: "grant", seq: 1, grant: { id: "G1", parent: null, grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 10, depth: 0 } }];
    for (let index = 1; index < count; index++) {
      events.push({ kind: "commit", seq: index + 1, commit: { id: `v${index}`, actor: "x", actedUnder: "g-ghost", capability: "purchase", amount: 0 } });
    }
    return asLog(events);
  };

  it("N events fold, and N + 1 is refused with the real length and the bound", () => {
    expect(MAX_LOG_EVENTS).toBe(5000);
    const atBound = fold(CHARTER, cheapLog(MAX_LOG_EVENTS));
    expect(atBound.ok && atBound.folded.head).toBe(MAX_LOG_EVENTS);
    expect(faultOf(CHARTER, cheapLog(MAX_LOG_EVENTS + 1))).toStrictEqual({ kind: "log-too-long", length: MAX_LOG_EVENTS + 1, max: MAX_LOG_EVENTS });
  });

  it("the bound is applied before any element is read: N + 1 garbage elements are log-too-long, not a fault of the first", () => {
    expect(faultOf(CHARTER, new Array(MAX_LOG_EVENTS + 1).fill(null))).toStrictEqual({ kind: "log-too-long", length: MAX_LOG_EVENTS + 1, max: MAX_LOG_EVENTS });
    expect(faultOf(CHARTER, new Array(MAX_LOG_EVENTS).fill(null))?.kind).toBe("inadmissible-event");
  });

  it("append: a log of N - 1 takes one more, a log of N takes none, and the refusal names the length the log would have", () => {
    const next = append(CHARTER, cheapLog(MAX_LOG_EVENTS - 1), commitEvent(commit("last", "x", "g-ghost", "purchase", 0)));
    expect(next.ok && next.log.length).toBe(MAX_LOG_EVENTS);
    const full = append(CHARTER, cheapLog(MAX_LOG_EVENTS), commitEvent(commit("one-more", "x", "g-ghost", "purchase", 0)));
    expect(!full.ok && full.failure).toStrictEqual({ kind: "faulty-log", fault: { kind: "log-too-long", length: MAX_LOG_EVENTS + 1, max: MAX_LOG_EVENTS } });
  });

  it("on a full log a bad event is refused for being bad (the bound is checked last), and a grant and a revoke are stopped by the bound like a commit", () => {
    const full = cheapLog(MAX_LOG_EVENTS);
    const bad = append(CHARTER, full, commitEvent(commit("v1", "x", "g-ghost", "purchase", 0)));
    expect(!bad.ok && bad.failure).toStrictEqual({ kind: "rejected", rejection: { kind: "duplicate-id", id: "v1" } });
    const grant = append(CHARTER, full, grantEvent({ id: "G2", grantor: "dana", grantee: "erin", capabilities: ["purchase"], limit: 1, depth: 0 }));
    expect(!grant.ok && grant.failure.kind === "faulty-log" && grant.failure.fault.kind).toBe("log-too-long");
    const revoke = append(CHARTER, full, revokeEvent("G1", "dana"));
    expect(!revoke.ok && revoke.failure.kind === "faulty-log" && revoke.failure.fault.kind).toBe("log-too-long");
  });

  it("mayCommit on a full log: the same bound", () => {
    const asked = mayCommit(CHARTER, cheapLog(MAX_LOG_EVENTS), commit("one-more", "x", "g-ghost", "purchase", 0));
    expect(!asked.ok && asked.failure).toStrictEqual({ kind: "faulty-log", fault: { kind: "log-too-long", length: MAX_LOG_EVENTS + 1, max: MAX_LOG_EVENTS } });
  });
});

describe("seq-mismatch: a well-formed seq in the wrong place", () => {
  const rows: readonly [string, readonly unknown[], FoldFault][] = [
    ["a gap: 1, 2, 3, then 5", [ORG_EVENTS[0], ORG_EVENTS[1], ORG_EVENTS[2], { ...(ORG_EVENTS[3] as object), seq: 5 }], { kind: "seq-mismatch", index: 3, expected: 4, actual: 5 }],
    ["a repeat: 1, 2, 2", [ORG_EVENTS[0], ORG_EVENTS[1], { ...(ORG_EVENTS[2] as object), seq: 2 }], { kind: "seq-mismatch", index: 2, expected: 3, actual: 2 }],
    ["out of order: 2 then 1", [{ ...(ORG_EVENTS[0] as object), seq: 2 }, { ...(ORG_EVENTS[1] as object), seq: 1 }], { kind: "seq-mismatch", index: 0, expected: 1, actual: 2 }],
    ["starting at 2", [{ ...(ORG_EVENTS[0] as object), seq: 2 }], { kind: "seq-mismatch", index: 0, expected: 1, actual: 2 }],
    ["a seq far ahead", [ORG_EVENTS[0], { ...(ORG_EVENTS[1] as object), seq: Number.MAX_SAFE_INTEGER }], { kind: "seq-mismatch", index: 1, expected: 2, actual: Number.MAX_SAFE_INTEGER }],
    ["the first fault of several: both 2 and 4 are wrong, 2 is reported", [ORG_EVENTS[0], { ...(ORG_EVENTS[1] as object), seq: 9 }, { ...(ORG_EVENTS[2] as object), seq: 8 }], { kind: "seq-mismatch", index: 1, expected: 2, actual: 9 }],
  ];

  it.each(rows)("%s", (_name, events, fault) => {
    expect(faultOf(CHARTER, events)).toStrictEqual(fault);
  });

  it("repaired: the same events with seq 1 to n fold", () => {
    expect(fold(CHARTER, asLog(ORG_EVENTS)).ok).toBe(true);
  });

  it("the fault's index is the position in the array, wherever the defect is: the first, the middle and the last", () => {
    for (const at of [0, 1, 2, 3]) {
      const events = ORG_EVENTS.map((event, index) => (index === at ? { ...(event as object), seq: 100 } : event));
      expect(faultOf(CHARTER, events)).toStrictEqual({ kind: "seq-mismatch", index: at, expected: at + 1, actual: 100 });
    }
  });

  it("a seq that is not a safe integer of at least 1 never reaches the comparison: intake refuses it, so it is inadmissible-event with seq among the fields", () => {
    for (const seq of [0, -1, 1.5, Number.NaN, "1", null, undefined, Number.POSITIVE_INFINITY]) {
      const events = [{ ...(ORG_EVENTS[0] as object), seq }];
      const fault = faultOf(CHARTER, events);
      expect(fault, String(seq)).toStrictEqual({ kind: "inadmissible-event", index: 0, rejection: { kind: "invalid-event-shape", eventKind: "grant", fields: ["seq"] } });
    }
  });
});

describe("inadmissible-event: an event that was read but may not be admitted, one row per rejection", () => {
  const BASE = ORG_EVENTS; // seqs 1 to 4; the event under test is seq 5, index 4.
  const revokedG2 = [...BASE, rawRevoke(5, "G2", "cfo")]; // then the event under test is seq 6, index 5.

  interface Row {
    readonly name: string;
    readonly prefix: readonly unknown[];
    readonly violating: (seq: number) => unknown;
    readonly rejection: Rejection;
    readonly repaired: (seq: number) => unknown;
    /** The prefix for the repaired scenario when the fix is to something earlier (the revoke that killed the parent). */
    readonly repairedPrefix?: readonly unknown[];
  }

  const rows: readonly Row[] = [
    { name: "invalid-event-shape", prefix: BASE, violating: (s) => rawGrant(s, { limit: -1 }), rejection: { kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] }, repaired: (s) => rawGrant(s) },
    { name: "unknown-capability", prefix: BASE, violating: (s) => rawGrant(s, { capabilities: ["launder"] }), rejection: { kind: "unknown-capability", capability: "launder" }, repaired: (s) => rawGrant(s) },
    { name: "duplicate-id (a grant id)", prefix: BASE, violating: (s) => rawGrant(s, { id: "G3" }), rejection: { kind: "duplicate-id", id: "G3" }, repaired: (s) => rawGrant(s) },
    {
      name: "duplicate-id (a commit id)",
      prefix: [...BASE, rawCommit(5)],
      violating: (s) => rawCommit(s),
      rejection: { kind: "duplicate-id", id: "kx" },
      repaired: (s) => rawCommit(s, { id: "ky" }),
    },
    { name: "not-a-root", prefix: BASE, violating: (s) => rawGrant(s, { parent: null, grantor: "cfo", grantee: "x" }), rejection: { kind: "not-a-root", grantor: "cfo" as never }, repaired: (s) => rawGrant(s, { parent: null, grantor: "dana", grantee: "x" }) },
    { name: "unknown-parent", prefix: BASE, violating: (s) => rawGrant(s, { parent: "g-ghost" }), rejection: { kind: "unknown-parent", parent: "g-ghost" as never }, repaired: (s) => rawGrant(s) },
    { name: "parent-dead", prefix: revokedG2, violating: (s) => rawGrant(s, { limit: 0 }), rejection: { kind: "parent-dead", deadGrant: "G2" as never }, repaired: (s) => rawGrant(s, { limit: 0 }), repairedPrefix: BASE },
    { name: "grantor-not-holder", prefix: BASE, violating: (s) => rawGrant(s, { grantor: "dana" }), rejection: { kind: "grantor-not-holder", parent: "G2" as never, grantor: "dana" as never, holder: "ops" as never }, repaired: (s) => rawGrant(s) },
    { name: "capability-widening", prefix: BASE, violating: (s) => rawGrant(s, { capabilities: ["hire"] }), rejection: { kind: "capability-widening", capability: "hire" }, repaired: (s) => rawGrant(s) },
    { name: "depth-exhausted", prefix: BASE, violating: (s) => rawGrant(s, { parent: "G3", grantor: "buyer" }), rejection: { kind: "depth-exhausted", parent: "G3" as never }, repaired: (s) => rawGrant(s) },
    { name: "depth-not-narrowed", prefix: BASE, violating: (s) => rawGrant(s, { depth: 2 }), rejection: { kind: "depth-not-narrowed", parentDepth: 2, requested: 2 }, repaired: (s) => rawGrant(s, { depth: 1 }) },
    { name: "principal-cycle", prefix: BASE, violating: (s) => rawGrant(s, { grantee: "cfo" }), rejection: { kind: "principal-cycle", principal: "cfo" as never }, repaired: (s) => rawGrant(s) },
    { name: "over-allocation", prefix: BASE, violating: (s) => rawGrant(s, { limit: 3_001 }), rejection: { kind: "over-allocation", grantId: "G2" as never, requested: 3_001, headroom: 3_000 }, repaired: (s) => rawGrant(s, { limit: 3_000 }) },
    { name: "unknown-grant", prefix: BASE, violating: (s) => rawRevoke(s, "g-ghost", "cfo"), rejection: { kind: "unknown-grant", grantId: "g-ghost" as never }, repaired: (s) => rawRevoke(s, "G2", "cfo") },
    { name: "already-dead", prefix: revokedG2, violating: (s) => rawRevoke(s, "G2", "cfo"), rejection: { kind: "already-dead", grantId: "G2" as never }, repaired: (s) => rawRevoke(s, "G2", "cfo"), repairedPrefix: BASE },
    { name: "revoker-not-authorised", prefix: BASE, violating: (s) => rawRevoke(s, "G3", "buyer"), rejection: { kind: "revoker-not-authorised", grantId: "G3" as never, by: "buyer" as never }, repaired: (s) => rawRevoke(s, "G3", "ops") },
  ];

  it("there is one row for each of the fifteen rejections", () => {
    const kinds = rows.map((row) => row.rejection.kind);
    expect(new Set(kinds).size).toBe(15);
  });

  it.each(rows.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    const at = row.prefix.length;
    expect(faultOf(CHARTER, [...row.prefix, row.violating(at + 1)])).toStrictEqual({ kind: "inadmissible-event", index: at, rejection: row.rejection });
    const repairedPrefix = row.repairedPrefix ?? row.prefix;
    expect(fold(CHARTER, asLog([...repairedPrefix, row.repaired(repairedPrefix.length + 1)])).ok, `${row.name} repaired`).toBe(true);
  });

  it("the rejection is the one append gives for the same event on the same log (one admission path)", () => {
    for (const row of rows) {
      const at = row.prefix.length;
      const prefix = asLog(row.prefix);
      const result = append(CHARTER, prefix, row.violating(at + 1) as never);
      expect(!result.ok && result.failure, row.name).toStrictEqual({ kind: "rejected", rejection: row.rejection });
    }
  });

  it("a rejected event after valid ones is found at its index, and the events before it were admitted: a fault at index 0, 5 and the last", () => {
    const long = [...BASE, rawCommit(5), rawCommit(6, { id: "ky" }), rawCommit(7, { id: "kz" })];
    for (const at of [0, 5, long.length]) {
      const events = at === 0 ? [rawGrant(1, { parent: "g-ghost" })] : [...long.slice(0, at), rawGrant(at + 1, { parent: "g-ghost" })];
      expect(faultOf(CHARTER, events), `at ${at}`).toStrictEqual({ kind: "inadmissible-event", index: at, rejection: { kind: "unknown-parent", parent: "g-ghost" } });
    }
  });
});

describe("what is looked at first: intake, then seq, then admission", () => {
  it("an event with an unknown capability AND a wrong seq is reported for the capability, because seq is read once, by intake, and not again", () => {
    const events = [...ORG_EVENTS, rawGrant(99, { capabilities: ["launder"] })];
    expect(faultOf(CHARTER, events)).toStrictEqual({ kind: "inadmissible-event", index: 4, rejection: { kind: "unknown-capability", capability: "launder" } });
    // Repaired capability: the seq problem appears.
    expect(faultOf(CHARTER, [...ORG_EVENTS, rawGrant(99)])).toStrictEqual({ kind: "seq-mismatch", index: 4, expected: 5, actual: 99 });
  });

  it("an event with a malformed field AND a wrong seq is reported for the field", () => {
    expect(faultOf(CHARTER, [...ORG_EVENTS, rawGrant(99, { limit: -1 })])).toStrictEqual({ kind: "inadmissible-event", index: 4, rejection: { kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] } });
  });

  it("an event that is not admissible AND has a wrong seq is reported for the seq, because seq is compared before admission", () => {
    expect(faultOf(CHARTER, [...ORG_EVENTS, rawGrant(99, { parent: "g-ghost" })])).toStrictEqual({ kind: "seq-mismatch", index: 4, expected: 5, actual: 99 });
    expect(faultOf(CHARTER, [...ORG_EVENTS, rawGrant(5, { parent: "g-ghost" })])?.kind).toBe("inadmissible-event");
  });

  it("two faulty events: the one at the lower index is the one reported, whatever kinds they are", () => {
    const events = [...ORG_EVENTS, rawGrant(5, { parent: "g-ghost" }), rawGrant(99)];
    expect(faultOf(CHARTER, events)).toStrictEqual({ kind: "inadmissible-event", index: 4, rejection: { kind: "unknown-parent", parent: "g-ghost" } });
    expect(faultOf(CHARTER, [...ORG_EVENTS, rawGrant(99), rawGrant(5, { parent: "g-ghost" })])?.kind).toBe("seq-mismatch");
  });

  it("the empty log folds: head 0, nothing in the tree", () => {
    const result = fold(CHARTER, asLog([]));
    expect(result.ok && [result.folded.head, result.folded.tree.grants.size, result.folded.commits.size, result.folded.charges.length]).toStrictEqual([0, 0, 0, 0]);
  });

  it("a log built by append folds, and a charter that drops what the log uses makes the same log fail closed (plan case 08)", () => {
    const log = logOf(CHARTER2, [
      ...ORG,
      commitEvent(commit("c", "buyer", "G3", "purchase", 1)),
      grantEvent({ id: "GE", grantor: "erin", grantee: "zed", capabilities: ["hire"], limit: 1, depth: 0 }),
    ]);
    expect(fold(CHARTER2, log).ok).toBe(true);
    // Without the root erin: the grant by erin, at index 5, is not a root grant by a root.
    expect(faultOf({ roots: ["dana"], capabilities: CAPABILITIES }, log)).toStrictEqual({ kind: "inadmissible-event", index: 5, rejection: { kind: "not-a-root", grantor: "erin" } });
    // Without `hire` and `sign-contract`: G1, at index 0, names them, and the first one in its own order is reported.
    expect(faultOf({ roots: ["dana", "erin"], capabilities: ["purchase", "refund"] }, log)).toStrictEqual({ kind: "inadmissible-event", index: 0, rejection: { kind: "unknown-capability", capability: "hire" } });
  });
});

// ---------------------------------------------------------------------------------------------------
// The corruption property
// ---------------------------------------------------------------------------------------------------

interface Scan {
  readonly failures: string[];
  readonly counts: { readonly faults: Record<string, number>; readonly rejections: Record<string, number>; readonly seeds: number; readonly elementReadsOnTooLong: number };
}

const scans = chunked(SEEDS, CHUNKS, (first, last): Scan => {
  const failures: string[] = [];
  const faults: Record<string, number> = {};
  const rejections: Record<string, number> = {};
  let elementReadsOnTooLong = 0;
  const note = (fault: FoldFault | undefined, expected: unknown, label: string): void => {
    if (fault === undefined) {
      failures.push(`${label}: the damaged log folded`);
      return;
    }
    faults[fault.kind] = (faults[fault.kind] ?? 0) + 1;
    if (fault.kind === "inadmissible-event") rejections[fault.rejection.kind] = (rejections[fault.rejection.kind] ?? 0) + 1;
    if (JSON.stringify(fault) !== JSON.stringify(expected)) failures.push(`${label}: got ${JSON.stringify(fault)}, expected ${JSON.stringify(expected)}`);
  };

  for (let seed = first; seed <= last; seed++) {
    const world = runWorld({ seed, steps: STEPS, profile: profileOf(seed) });
    const { charter, log } = world;
    const n = log.length;
    if (n < 6) continue;
    const random = mulberry32(seed * 2654435761);
    const events = log as readonly unknown[];

    // Delete an event that is not the last: the next one now sits at the deleted one's index with a seq one too high.
    const gone = Math.floor(random() * (n - 1));
    note(faultOf(charter, [...events.slice(0, gone), ...events.slice(gone + 1)]), { kind: "seq-mismatch", index: gone, expected: gone + 1, actual: gone + 2 }, `seed ${seed} delete ${gone}`);

    // Swap two neighbours.
    const swap = Math.floor(random() * (n - 1));
    const swapped = [...events];
    swapped[swap] = events[swap + 1];
    swapped[swap + 1] = events[swap];
    note(faultOf(charter, swapped), { kind: "seq-mismatch", index: swap, expected: swap + 1, actual: swap + 2 }, `seed ${seed} swap ${swap}`);

    // Repeat the last event.
    note(faultOf(charter, [...events, events[n - 1]]), { kind: "seq-mismatch", index: n, expected: n + 1, actual: n }, `seed ${seed} repeat last`);

    // A throwing element in the middle.
    const hostileAt = Math.floor(random() * n);
    const hostileLog = [...events];
    hostileLog[hostileAt] = new Proxy({}, { get() { throw new Error("no"); } });
    note(faultOf(charter, hostileLog), { kind: "hostile-log-input", message: `log[${hostileAt}]: reading kind threw` }, `seed ${seed} hostile ${hostileAt}`);

    // A log that claims too many events: refused before any element is read.
    let reads = 0;
    const claimed = MAX_LOG_EVENTS + 1 + (seed % 7);
    const huge = new Proxy([] as unknown[], {
      get(target, key, receiver) {
        if (key === "length") return claimed;
        if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    note(faultOf(charter, huge), { kind: "log-too-long", length: claimed, max: MAX_LOG_EVENTS }, `seed ${seed} too long`);
    elementReadsOnTooLong += reads;

    // A charter with no roots.
    note(faultOf({ roots: [], capabilities: charter.capabilities }, log), { kind: "invalid-charter", fields: ["roots"] }, `seed ${seed} no roots`);

    // A charter without a capability the log uses, and one without a root the log uses: the log fails closed at the first use.
    for (const name of CAPABILITIES) {
      const use = events.findIndex((event) => {
        const e = event as { kind: string; grant?: { capabilities: string[] }; commit?: { capability: string } };
        return e.kind === "grant" ? e.grant?.capabilities.includes(name) === true : e.kind === "commit" ? e.commit?.capability === name : false;
      });
      if (use < 0 || (seed + CAPABILITIES.indexOf(name)) % 3 !== 0) continue;
      note(faultOf({ roots: charter.roots, capabilities: CAPABILITIES.filter((c) => c !== name) }, log), { kind: "inadmissible-event", index: use, rejection: { kind: "unknown-capability", capability: name } }, `seed ${seed} without ${name}`);
    }
    if (charter.roots.length === 2) {
      const dropped = charter.roots[1];
      const use = events.findIndex((event) => {
        const e = event as { kind: string; grant?: { parent: string | null; grantor: string } };
        return e.kind === "grant" && e.grant?.parent === null && e.grant.grantor === dropped;
      });
      if (use >= 0) note(faultOf({ roots: [charter.roots[0]], capabilities: charter.capabilities }, log), { kind: "inadmissible-event", index: use, rejection: { kind: "not-a-root", grantor: dropped } }, `seed ${seed} without root ${dropped}`);
    }

    // Every rejected proposal, put back at the place it was offered with the seq it would have had: the log fails closed there
    // with exactly the rejection append gave.
    for (const attempt of world.attempts) {
      if (attempt.outcome.ok || attempt.outcome.failure.kind !== "rejected") continue;
      const damaged = [...events.slice(0, attempt.logLength), { ...(attempt.input as object), seq: attempt.logLength + 1 }];
      note(faultOf(charter, damaged), { kind: "inadmissible-event", index: attempt.logLength, rejection: attempt.outcome.failure.rejection }, `seed ${seed} step ${attempt.step} rejected proposal`);
    }
  }
  return { failures, counts: { faults, rejections, seeds: last - first + 1, elementReadsOnTooLong } };
});

describe(`fold faults over ${SEEDS} damaged generated logs`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const [first, last] = scans.range(index);
    it(
      `seeds ${first} to ${last}: every kind of damage is the fault it implies, at the index it implies`,
      () => {
        expect(scans.get(index).failures).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
  }

  it(
    "coverage: all five faults and all fifteen rejections inside inadmissible-event were produced, and no element of a too-long log was read",
    () => {
      const faults: Record<string, number> = {};
      const rejections: Record<string, number> = {};
      let reads = 0;
      for (let index = 0; index < CHUNKS; index++) {
        const counts = scans.get(index).counts;
        reads += counts.elementReadsOnTooLong;
        for (const [key, value] of Object.entries(counts.faults)) faults[key] = (faults[key] ?? 0) + value;
        for (const [key, value] of Object.entries(counts.rejections)) rejections[key] = (rejections[key] ?? 0) + value;
      }
      report("fold-faults", { faults, rejections, reads });
      for (const kind of ["invalid-charter", "hostile-log-input", "log-too-long", "seq-mismatch", "inadmissible-event"]) {
        expect(faults[kind] ?? 0, kind).toBeGreaterThanOrEqual(500);
      }
      for (const kind of [
        "invalid-event-shape",
        "unknown-capability",
        "duplicate-id",
        "not-a-root",
        "unknown-parent",
        "parent-dead",
        "grantor-not-holder",
        "capability-widening",
        "depth-exhausted",
        "depth-not-narrowed",
        "principal-cycle",
        "over-allocation",
        "unknown-grant",
        "already-dead",
        "revoker-not-authorised",
      ]) {
        expect(rejections[kind] ?? 0, kind).toBeGreaterThanOrEqual(130);
      }
      expect(reads).toBe(0);
    },
    SEED_LOOP_TIMEOUT_MS,
  );
});
