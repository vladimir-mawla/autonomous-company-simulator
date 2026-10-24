import { describe, expect, it } from "vitest";
import { MAX_AMOUNT } from "../../contracts/index.js";
import type { EventInput, Log, Rejection } from "../../contracts/index.js";
import { append } from "../index.js";
import { CHARTER2, ORG, commit, commitEvent, g, grantEvent, logOf, mustAppend, mustFold, p, revokeEvent } from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * ADMISSION ORDER AND THE RULES M5 ADDS TO M3's (plan §4.3: "Admission precedence (first failing rule wins): grant: invalid-event-shape
 * -> unknown-capability -> duplicate-id -> (root: not-a-root | child: unknown-parent -> parent-dead -> grantor-not-holder ->
 * capability-widening -> depth-exhausted -> depth-not-narrowed) -> principal-cycle -> over-allocation").
 *
 * M3 owns the structure rules and M4 the headroom; what M5 owns is putting them in this order, so that is what is tested:
 *
 *   1. `over-allocation` at N and N + 1, and what a reservation does to the parent's own room.
 *   2. A root grant reserves from nothing: there is no `over-allocation` for it (plan §10: roots are trusted).
 *   3. EVERY structure rule hides `over-allocation`: a grant that breaks one of the eight rules a child can break AND asks for
 *      more than the headroom is refused for the structure rule, and once it is repaired `over-allocation` appears. A dead
 *      parent's headroom is 0, so with the order reversed `parent-dead` could never be seen for a grant with a positive limit.
 *   4. A commit is never refused for a breach, intake comes before the duplicate check, and a duplicate commit id changes nothing.
 *   5. Commit ids and grant ids are separate namespaces.
 */

const refusal = (log: Log<Cap>, input: EventInput<Cap>): Rejection | "admitted" | string => {
  const result = append(CHARTER2, log, input);
  if (result.ok) return "admitted";
  return result.failure.kind === "rejected" ? result.failure.rejection : `faulty-log ${result.failure.fault.kind}`;
};

// G2 (ops) has limit 4 000, has reserved 1 000 for G3, and so has 3 000 to lend or to spend.
const BASE = logOf(CHARTER2, ORG);
const child = (over: Partial<{ id: string; parent: string; grantor: string; grantee: string; capabilities: [Cap, ...Cap[]]; limit: number; depth: number }> = {}): EventInput<Cap> =>
  grantEvent({ id: "GN", parent: "G2", grantor: "ops", grantee: "newhire", capabilities: ["purchase"], limit: 100, depth: 1, ...over });

describe("over-allocation at N and N + 1", () => {
  it("a child may reserve exactly the parent's headroom and not one more; the shortfall names the parent, what was asked and what there was", () => {
    expect(refusal(BASE, child({ limit: 3_000 }))).toBe("admitted");
    expect(refusal(BASE, child({ limit: 3_001 }))).toStrictEqual({ kind: "over-allocation", grantId: g("G2"), requested: 3_001, headroom: 3_000 });
  });

  it("a reservation takes the parent's room: after a child of 3 000 the next child of 1 is over-allocation with headroom 0, and a child of 0 is still admitted", () => {
    const full = mustAppend(CHARTER2, BASE, child({ limit: 3_000 })).log;
    expect(refusal(full, child({ id: "GM", grantee: "other-hire", limit: 1 }))).toStrictEqual({ kind: "over-allocation", grantId: g("G2"), requested: 1, headroom: 0 });
    expect(refusal(full, child({ id: "GM", grantee: "other-hire", limit: 0 }))).toBe("admitted");
  });

  it("the parent's own spend takes its room too: after 100 spent, G2 can lend 2 900", () => {
    const spent = mustAppend(CHARTER2, BASE, commitEvent(commit("s", "ops", "G2", "purchase", 100))).log;
    expect(refusal(spent, child({ limit: 2_900 }))).toBe("admitted");
    expect(refusal(spent, child({ limit: 2_901 }))).toStrictEqual({ kind: "over-allocation", grantId: g("G2"), requested: 2_901, headroom: 2_900 });
  });

  it("a void commit takes none of it: after a breached commit of 100, G2 can still lend 3 000", () => {
    const breached = mustAppend(CHARTER2, BASE, commitEvent(commit("v", "cfo", "G2", "purchase", 100))).log; // cfo is not G2's holder
    expect(mustFold(CHARTER2, breached).charges).toHaveLength(0);
    expect(refusal(breached, child({ limit: 3_000 }))).toBe("admitted");
  });

  it("plan failure case 03: a revoked child's spend stays charged, so re-granting what was returned is the limit and not the old reservation", () => {
    // Parent limit 100; child granted 60, spends 50, is revoked: the parent has 100 - 50 = 50 left, not 100.
    const root = grantEvent({ id: "P", grantor: "dana", grantee: "boss", capabilities: ["purchase"], limit: 100, depth: 2 });
    const kid = grantEvent({ id: "K", parent: "P", grantor: "boss", grantee: "kid", capabilities: ["purchase"], limit: 60, depth: 1 });
    const log = logOf(CHARTER2, [root, kid, commitEvent(commit("k50", "kid", "K", "purchase", 50)), revokeEvent("K", "boss")]);
    const again = (limit: number): EventInput<Cap> => grantEvent({ id: "K2", parent: "P", grantor: "boss", grantee: "kid2", capabilities: ["purchase"], limit, depth: 1 });
    expect(refusal(log, again(60))).toStrictEqual({ kind: "over-allocation", grantId: g("P"), requested: 60, headroom: 50 });
    expect(refusal(log, again(50))).toBe("admitted");
  });
});

describe("a root grant reserves from nothing", () => {
  it("a root grant of any limit up to MAX_AMOUNT is admitted, and a charter root may issue more than one (the model does not bound a human)", () => {
    const first = grantEvent({ id: "R1", grantor: "dana", grantee: "a1", capabilities: ["purchase"], limit: MAX_AMOUNT, depth: 0 });
    const second = grantEvent({ id: "R2", grantor: "dana", grantee: "a2", capabilities: ["purchase"], limit: MAX_AMOUNT, depth: 0 });
    const log = logOf(CHARTER2, [first, second]);
    expect(mustFold(CHARTER2, log).tree.grants.size).toBe(2);
  });
});

describe("every structure rule hides over-allocation, and over-allocation appears once the structure is repaired", () => {
  // Each row: a child that breaks ONE structure rule and asks for 5 000 against a headroom of 3 000 (or 0, for a dead parent),
  // the rejection that must be reported, and the one-change repair, which must now be over-allocation.
  const GREEDY = 5_000;
  const REVOKED_G2 = mustAppend(CHARTER2, BASE, revokeEvent("G2", "cfo")).log;

  interface Row {
    readonly name: string;
    readonly log: Log<Cap>;
    readonly input: EventInput<Cap>;
    readonly expected: Rejection;
    readonly repaired: EventInput<Cap>;
    /** The log for the repaired scenario, when the fix is to something earlier (the revoke that killed the parent). */
    readonly repairedLog?: Log<Cap>;
    readonly after: Rejection;
  }

  const over = (grantId: string, headroom: number): Rejection => ({ kind: "over-allocation", grantId: g(grantId), requested: GREEDY, headroom });

  const rows: readonly Row[] = [
    {
      name: "duplicate-id",
      log: BASE,
      input: child({ id: "G3", limit: GREEDY }),
      expected: { kind: "duplicate-id", id: "G3" },
      repaired: child({ id: "GN", limit: GREEDY }),
      after: over("G2", 3_000),
    },
    {
      name: "unknown-parent",
      log: BASE,
      input: child({ parent: "g-ghost", limit: GREEDY }),
      expected: { kind: "unknown-parent", parent: g("g-ghost") },
      repaired: child({ limit: GREEDY }),
      after: over("G2", 3_000),
    },
    {
      name: "parent-dead (a dead parent has headroom 0, so with the order reversed this would read as over-allocation)",
      log: REVOKED_G2,
      input: child({ limit: GREEDY }),
      expected: { kind: "parent-dead", deadGrant: g("G2") },
      repaired: child({ limit: GREEDY }),
      repairedLog: BASE,
      after: over("G2", 3_000),
    },
    {
      name: "grantor-not-holder",
      log: BASE,
      input: child({ grantor: "dana", limit: GREEDY }),
      expected: { kind: "grantor-not-holder", parent: g("G2"), grantor: p("dana"), holder: p("ops") },
      repaired: child({ limit: GREEDY }),
      after: over("G2", 3_000),
    },
    {
      name: "capability-widening",
      log: BASE,
      input: child({ capabilities: ["hire"], limit: GREEDY }),
      expected: { kind: "capability-widening", capability: "hire" },
      repaired: child({ limit: GREEDY }),
      after: over("G2", 3_000),
    },
    {
      name: "depth-exhausted",
      log: BASE,
      input: child({ parent: "G3", grantor: "buyer", limit: GREEDY }),
      expected: { kind: "depth-exhausted", parent: g("G3") },
      repaired: child({ limit: GREEDY }),
      after: over("G2", 3_000),
    },
    {
      name: "depth-not-narrowed",
      log: BASE,
      input: child({ depth: 2, limit: GREEDY }),
      expected: { kind: "depth-not-narrowed", parentDepth: 2, requested: 2 },
      repaired: child({ limit: GREEDY }),
      after: over("G2", 3_000),
    },
    {
      name: "principal-cycle",
      log: BASE,
      input: child({ grantee: "cfo", limit: GREEDY }),
      expected: { kind: "principal-cycle", principal: p("cfo") },
      repaired: child({ limit: GREEDY }),
      after: over("G2", 3_000),
    },
  ];

  it.each(rows.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(refusal(row.log, row.input)).toStrictEqual(row.expected);
    expect(refusal(row.repairedLog ?? row.log, row.repaired)).toStrictEqual(row.after);
  });

  it("the shape and the vocabulary come before all of it: a malformed or unknown-capability grant that also over-asks is refused for that", () => {
    expect(refusal(BASE, child({ limit: -1 }))).toStrictEqual({ kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] });
    expect(refusal(BASE, child({ capabilities: ["launder" as Cap], limit: GREEDY }))).toStrictEqual({ kind: "unknown-capability", capability: "launder" });
  });
});

describe("commits: never refused for a breach, intake before the duplicate check, and a duplicate changes nothing", () => {
  const first = commit("k", "buyer", "G3", "purchase", 400);

  it("a commit that breaches every rule it can is admitted and recorded; only a shape or id problem refuses one", () => {
    expect(refusal(BASE, commitEvent(commit("k", "cfo", "G3", "refund", 999_999)))).toBe("admitted");
    expect(refusal(BASE, commitEvent(commit("k", "cfo", "g-ghost", "refund", 999_999)))).toBe("admitted");
  });

  it("an unknown capability AND a duplicate id is unknown-capability, and a malformed amount AND a duplicate id is invalid-event-shape", () => {
    const log = mustAppend(CHARTER2, BASE, commitEvent(first)).log;
    expect(refusal(log, commitEvent(commit("k", "buyer", "G3", "launder" as Cap, 1)))).toStrictEqual({ kind: "unknown-capability", capability: "launder" });
    expect(refusal(log, commitEvent(commit("k", "buyer", "G3", "purchase", -1)))).toStrictEqual({ kind: "invalid-event-shape", eventKind: "commit", fields: ["amount"] });
    expect(refusal(log, commitEvent(commit("k", "buyer", "G3", "purchase", 1)))).toStrictEqual({ kind: "duplicate-id", id: "k" });
  });

  it("a duplicate commit id is refused and the original is untouched: the same verdict, the same one charge, the same seq", () => {
    const log = mustAppend(CHARTER2, BASE, commitEvent(first)).log;
    const before = mustFold(CHARTER2, log);
    expect(refusal(log, commitEvent(commit("k", "buyer", "G3", "purchase", 50)))).toStrictEqual({ kind: "duplicate-id", id: "k" });
    const after = mustFold(CHARTER2, log);
    expect(JSON.stringify([...after.commits])).toBe(JSON.stringify([...before.commits]));
    expect(after.charges).toStrictEqual([{ grantId: g("G3"), amount: 400 }]);
  });

  it("a commit's id and a grant's id are separate namespaces: a commit may carry the id of a grant, and the grant is still there", () => {
    expect(refusal(BASE, commitEvent(commit("G3", "buyer", "G3", "purchase", 1)))).toBe("admitted");
    const log = mustAppend(CHARTER2, BASE, commitEvent(commit("G3", "buyer", "G3", "purchase", 1))).log;
    expect(mustFold(CHARTER2, log).tree.grants.has(g("G3"))).toBe(true);
    // ... and the other way: a grant may carry the id of a commit.
    expect(refusal(log, child({ id: "k" }))).toBe("admitted");
  });
});
