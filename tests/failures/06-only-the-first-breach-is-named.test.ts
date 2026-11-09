import { describe, expect, it } from "vitest";
import { grantId, principalId } from "../../lib/contracts/index.js";
import type { Breach, Rejection } from "../../lib/contracts/index.js";
import { append } from "../../lib/standing/index.js";
import { replayScript } from "../../domains/company/index.js";
import { CHARTER, admit, askCommit, build, grantEv, revokeEv, standingFor } from "./helpers.js";
import type { CompanyLog, Ev } from "./helpers.js";

/**
 * KIND: DISCLOSES (plan section 11, case 06).
 * TRACES TO: D8 (single-reason enums: `Breach` and `Rejection` each name the first failing rule in a documented precedence).
 *
 * THE LIMIT. A commit that breaks several rules is told about one. On the canonical incident (plan section 7), `c6` is by the
 * wrong agent AND under a chain that is already cut: only `wrong-actor` is named; `link-dead` is hidden, and fixing the
 * actor would reveal it. The same holds for a rejected event: only the first rule is named.
 *
 * HOW IT IS SHOWN. Not by asserting what is absent but by REPAIRING: each case below takes one event that breaks several rules,
 * names the one reported, repairs exactly that, and finds the next one that was behind it. If a masked reason were not really
 * there, repairing would admit the event; that it names the next is what makes "hidden" a fact. The ladders run to the last
 * rule, which is then satisfied (`warranted`, or admitted).
 *
 * WHAT WOULD MAKE THIS FAIL: a change of precedence (any rung of a ladder naming a different kind), an engine that reported
 * every failing rule (the disclosed limit closed), or a rule removed (its rung would be skipped).
 */

const caps = ["purchase", "refund"] as const;

describe("06 only the first breach is named: the canonical c6", () => {
  it("c6 is by buyer-b under G4 (buyer-a's, and cut): void: wrong-actor { holder buyer-a }, which hides link-dead", () => {
    const { log } = replayScript();
    expect(standingFor(log, "c6")).toEqual({
      commitId: "c6",
      committedAt: 13,
      kind: "void",
      breach: { kind: "wrong-actor", grantId: grantId("G4"), holder: principalId("buyer-a") },
    });
  });

  it("fixing the actor reveals it: the same commit by buyer-a is void: link-dead { G2, atSeq 11 }; this is c5's ruling, which the log gives at seq 12", () => {
    const { log } = replayScript();
    const upToC5 = log.slice(0, 12); // the log as c6 found it: c5 at seq 12 is in
    const fixed = askCommit(upToC5, "c6", "buyer-a", "G4", "purchase", 5_000);
    expect(fixed).toEqual({
      ok: true,
      verdict: { kind: "breached", breach: { kind: "link-dead", grantId: grantId("G2"), atSeq: 11 } },
    });
  });
});

describe("06 only the first breach is named: the repair ladder of one commit, five rungs", () => {
  // G1 dana -> cfo [purchase, refund] 1000; G2 cfo -> ops [purchase] 100, then cut by cfo. G3 cfo -> support [refund] 100 (live).
  const log: CompanyLog = build([
    grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: caps, limit: 1000, depth: 3 }),
    grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 100, depth: 1 }),
    grantEv({ id: "G3", parent: "G1", grantor: "cfo", grantee: "support", capabilities: ["refund"], limit: 100, depth: 1 }),
    revokeEv("G2", "cfo"),
  ]);

  const rungs: readonly (readonly [string, readonly [id: string, actor: string, under: string, capability: "purchase" | "refund", amount: number], Breach])[] = [
    ["a grant that does not exist, by the wrong actor, dead-and-out-of-scope and over the limit anyway", ["x", "intern", "g-ghost", "refund", 10_000], { kind: "no-such-grant", grantId: grantId("g-ghost") }],
    ["repair 1: the grant exists (G2), still by the wrong actor, a refund, 10 000", ["x", "intern", "G2", "refund", 10_000], { kind: "wrong-actor", grantId: grantId("G2"), holder: principalId("ops") }],
    ["repair 2: the right actor (ops); G2 is cut, a refund, 10 000", ["x", "ops", "G2", "refund", 10_000], { kind: "link-dead", grantId: grantId("G2"), atSeq: 4 }],
    ["repair 3: a live grant held by support (G3), still a purchase, 10 000", ["x", "support", "G3", "purchase", 10_000], { kind: "capability-not-granted", grantId: grantId("G3"), capability: "purchase" }],
    ["repair 4: the capability fits (refund), 10 000 against a headroom of 100", ["x", "support", "G3", "refund", 10_000], { kind: "over-limit", grantId: grantId("G3"), requested: 10_000, headroom: 100 }],
  ];

  it.each(rungs)("%s", (_name, [id, actor, under, capability, amount], breach) => {
    expect(askCommit(log, id, actor, under, capability, amount)).toEqual({ ok: true, verdict: { kind: "breached", breach } });
  });

  it("repair 5: 100 under G3 by support is warranted: the ladder ends, nothing was hidden behind the last rung", () => {
    const result = askCommit(log, "x", "support", "G3", "refund", 100);
    expect(result.ok && result.verdict.kind).toBe("warranted");
  });
});

describe("06 only the first rejection is named: the repair ladder of one grant", () => {
  // G1 dana -> cfo [purchase] 1000 depth 2; G2 cfo -> ops [purchase] 100 depth 1 (cut); G3 cfo -> support [purchase] 100 depth 1 (live);
  // G4 support -> refunder [purchase] 10 depth 0.
  const log: CompanyLog = build([
    grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1000, depth: 2 }),
    grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 100, depth: 1 }),
    grantEv({ id: "G3", parent: "G1", grantor: "cfo", grantee: "support", capabilities: ["purchase"], limit: 100, depth: 1 }),
    grantEv({ id: "G4", parent: "G3", grantor: "support", grantee: "refunder", capabilities: ["purchase"], limit: 10, depth: 0 }),
    revokeEv("G2", "cfo"),
  ]);

  const rungs: readonly (readonly [string, Ev, Rejection])[] = [
    [
      "unknown capability, a taken id, a missing parent, ...: the capability is named",
      grantEv({ id: "G1", parent: "g-ghost", grantor: "intern", grantee: "cfo", capabilities: ["launder" as never], limit: 10_000, depth: 7 }),
      { kind: "unknown-capability", capability: "launder" },
    ],
    [
      "repair 1: a real capability; the id G1 is taken",
      grantEv({ id: "G1", parent: "g-ghost", grantor: "intern", grantee: "cfo", capabilities: ["purchase"], limit: 10_000, depth: 7 }),
      { kind: "duplicate-id", id: "G1" },
    ],
    [
      "repair 2: a fresh id; the parent does not exist",
      grantEv({ id: "N", parent: "g-ghost", grantor: "intern", grantee: "cfo", capabilities: ["purchase"], limit: 10_000, depth: 7 }),
      { kind: "unknown-parent", parent: grantId("g-ghost") },
    ],
    [
      "repair 3: the parent exists but is cut (G2)",
      grantEv({ id: "N", parent: "G2", grantor: "intern", grantee: "cfo", capabilities: ["purchase"], limit: 10_000, depth: 7 }),
      { kind: "parent-dead", deadGrant: grantId("G2") },
    ],
    [
      "repair 4: a live parent (G3), but the grantor is not its holder",
      grantEv({ id: "N", parent: "G3", grantor: "intern", grantee: "cfo", capabilities: ["purchase"], limit: 10_000, depth: 7 }),
      { kind: "grantor-not-holder", parent: grantId("G3"), grantor: principalId("intern"), holder: principalId("support") },
    ],
    [
      "repair 5: the holder (support) grants; the capability is hire, which G3 does not carry",
      grantEv({ id: "N", parent: "G3", grantor: "support", grantee: "cfo", capabilities: ["hire"], limit: 10_000, depth: 7 }),
      { kind: "capability-widening", capability: "hire" },
    ],
    [
      "repair 6: purchase, but under G4 whose depth is 0",
      grantEv({ id: "N", parent: "G4", grantor: "refunder", grantee: "cfo", capabilities: ["purchase"], limit: 10_000, depth: 7 }),
      { kind: "depth-exhausted", parent: grantId("G4") },
    ],
    [
      "repair 7: under G3 (depth 1) with a depth of 7",
      grantEv({ id: "N", parent: "G3", grantor: "support", grantee: "cfo", capabilities: ["purchase"], limit: 10_000, depth: 7 }),
      { kind: "depth-not-narrowed", parentDepth: 1, requested: 7 },
    ],
    [
      "repair 8: depth 0, but the grantee (cfo) is already above support on the chain",
      grantEv({ id: "N", parent: "G3", grantor: "support", grantee: "cfo", capabilities: ["purchase"], limit: 10_000, depth: 0 }),
      { kind: "principal-cycle", principal: principalId("cfo") },
    ],
    [
      "repair 9: a grantee below the chain, limit 10 000 against a headroom of 100",
      grantEv({ id: "N", parent: "G3", grantor: "support", grantee: "buyer-a", capabilities: ["purchase"], limit: 10_000, depth: 0 }),
      { kind: "over-allocation", grantId: grantId("G3"), requested: 10_000, headroom: 90 },
    ],
  ];

  it.each(rungs)("%s", (_name, event, rejection) => {
    expect(append(CHARTER, log, event)).toEqual({ ok: false, failure: { kind: "rejected", rejection } });
  });

  it("repair 10: limit 90 is admitted: the ladder ends, nothing was hidden behind the last rung", () => {
    const result = append(CHARTER, log, grantEv({ id: "N", parent: "G3", grantor: "support", grantee: "buyer-a", capabilities: ["purchase"], limit: 90, depth: 0 }));
    expect(result.ok).toBe(true);
  });

  it("a revoke breaks three rules at once and names the first: unknown-grant, then already-dead, then revoker-not-authorised", () => {
    expect(append(CHARTER, log, revokeEv("g-ghost", "intern"))).toMatchObject({ failure: { rejection: { kind: "unknown-grant", grantId: "g-ghost" } } });
    expect(append(CHARTER, log, revokeEv("G2", "intern"))).toMatchObject({ failure: { rejection: { kind: "already-dead", grantId: "G2" } } });
    expect(append(CHARTER, log, revokeEv("G3", "intern"))).toMatchObject({ failure: { rejection: { kind: "revoker-not-authorised", grantId: "G3", by: "intern" } } });
    expect(admit(log, revokeEv("G3", "cfo")).result.ok).toBe(true);
  });
});
