import { describe, expect, it } from "vitest";
import { MAX_ID_LENGTH, grantId, principalId } from "../../lib/contracts/index.js";
import type { Breach } from "../../lib/contracts/index.js";
import { append } from "../../lib/standing/index.js";
import { CHARTER, admit, askCommit, build, commitEv, grantEv, revokeEv, standingFor } from "./helpers.js";
import type { CompanyLog } from "./helpers.js";

/**
 * KIND: DISCLOSES (plan section 11, case 09).
 * TRACES TO: D4 (acts are facts; authority-creating events are admitted or rejected), D9 (one predicate, two call sites).
 *
 * THE LIMIT. `append` of an unauthorised commit SUCCEEDS. The act has happened; the engine records it and rules it void. Only
 * the optional pre-check `mayCommit` could have told the caller beforehand, and even that does not refuse: it answers
 * `ok: true` with the same breached verdict `append` would store. "Refuses" in this project means "refuses to let it bind or
 * create authority", never "prevents the agent from acting".
 *
 * WHAT IS ASSERTED is the engine's behaviour at admission, for each of the five breaches: `append` is `ok: true`, the log is
 * one event longer, the event carries the next seq, the verdict and the derived standing name the breach, and `mayCommit`
 * on the same log answers with that very verdict and writes nothing. Beside it, the contrast: a grant or a revoke that
 * breaks a rule is rejected and nothing is recorded. This file does not assert that any caller consults the pre-check.
 * The consequence side is pinned too, because it is what keeps a recorded void act from being a dashboard entry: it
 * charges nothing (the next warranted commit still has the whole headroom), while a warranted one does.
 *
 * WHAT WOULD MAKE THIS FAIL: a commit that breaks a rule being rejected by `append` (the disclosed limit closed); a `mayCommit` with a
 * predicate of its own; a void commit that charged the allowance, or a warranted one that did not.
 */

const world = (): CompanyLog =>
  build([
    grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase", "refund"], limit: 1000, depth: 3 }),
    grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 100, depth: 0 }),
    grantEv({ id: "G3", parent: "G1", grantor: "cfo", grantee: "support", capabilities: ["refund"], limit: 100, depth: 0 }),
    revokeEv("G3", "cfo"), // seq 4
  ]);

const breaches: readonly (readonly [string, readonly [actor: string, under: string, capability: "purchase" | "refund", amount: number], Breach])[] = [
  ["no-such-grant", ["ops", "g-ghost", "purchase", 1], { kind: "no-such-grant", grantId: grantId("g-ghost") }],
  ["wrong-actor", ["buyer-b", "G2", "purchase", 1], { kind: "wrong-actor", grantId: grantId("G2"), holder: principalId("ops") }],
  ["link-dead", ["support", "G3", "refund", 1], { kind: "link-dead", grantId: grantId("G3"), atSeq: 4 }],
  ["capability-not-granted", ["ops", "G2", "refund", 1], { kind: "capability-not-granted", grantId: grantId("G2"), capability: "refund" }],
  ["over-limit", ["ops", "G2", "purchase", 101], { kind: "over-limit", grantId: grantId("G2"), requested: 101, headroom: 100 }],
];

describe("09 admitting a void commit is not refusing it: append records an unauthorised act, for each of the five breaches", () => {
  it.each(breaches)("%s: append is ok, the log is one longer at seq 5, the verdict and the standing name the breach; mayCommit gave the same verdict and wrote nothing", (_name, [actor, under, capability, amount], breach) => {
    const log = world();
    const before = log.length;
    const asked = askCommit(log, "act", actor, under, capability, amount);
    expect(asked).toEqual({ ok: true, verdict: { kind: "breached", breach } }); // ok: true is not "allowed"
    expect(log).toHaveLength(before); // asking recorded nothing

    const recorded = append(CHARTER, log, commitEv("act", actor, under, capability, amount));
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) throw new Error("unreachable");
    expect(recorded.verdict).toEqual({ kind: "breached", breach });
    expect(recorded.log).toHaveLength(before + 1);
    expect(recorded.event).toMatchObject({ kind: "commit", seq: 5, commit: { id: "act" } });
    expect(standingFor(recorded.log, "act")).toEqual({ commitId: "act", committedAt: 5, kind: "void", breach });
  });
});

describe("09 the contrast: what the engine does refuse to record", () => {
  it("a grant that breaks a rule is rejected, and so is a revoke: ok false, no log", () => {
    const log = world();
    expect(append(CHARTER, log, grantEv({ id: "Gw", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 1, depth: 0 }))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "depth-exhausted", parent: grantId("G2") } },
    });
    expect(append(CHARTER, log, revokeEv("G2", "support"))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "revoker-not-authorised", grantId: grantId("G2"), by: principalId("support") } },
    });
  });

  it("a commit is refused only for being the same act twice (duplicate-id) or not being a commit at all (invalid-event-shape): never for being unauthorised", () => {
    const { log } = admit(world(), commitEv("act", "ops", "G2", "purchase", 1));
    expect(append(CHARTER, log, commitEv("act", "ops", "G2", "purchase", 1))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "duplicate-id", id: "act" } },
    });
    expect(append(CHARTER, log, commitEv("neg", "ops", "G2", "purchase", -1))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "invalid-event-shape", eventKind: "commit", fields: ["amount"] } },
    });
    expect(append(CHARTER, log, commitEv("x".repeat(MAX_ID_LENGTH + 1), "ops", "G2", "purchase", 1))).toMatchObject({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "invalid-event-shape", eventKind: "commit" } },
    });
  });
});

describe("09 the consequence side: a recorded void act is not a dashboard entry", () => {
  it("a void commit charges nothing: 150 under G2 (limit 100) is void: over-limit, and 100 after it is still warranted", () => {
    const first = admit(world(), commitEv("big", "ops", "G2", "purchase", 150));
    expect(first.result.verdict).toEqual({
      kind: "breached",
      breach: { kind: "over-limit", grantId: grantId("G2"), requested: 150, headroom: 100 },
    });
    const second = admit(first.log, commitEv("fits", "ops", "G2", "purchase", 100));
    expect(second.result.verdict?.kind).toBe("warranted");
    expect(standingFor(second.log, "big").kind).toBe("void");
    expect(standingFor(second.log, "fits").kind).toBe("binding");
  });

  it("a warranted commit does charge: 60 under G2 leaves 40, so 50 next is void: over-limit { requested 50, headroom 40 }", () => {
    const first = admit(world(), commitEv("a", "ops", "G2", "purchase", 60));
    expect(first.result.verdict?.kind).toBe("warranted");
    expect(admit(first.log, commitEv("b", "ops", "G2", "purchase", 50)).result.verdict).toEqual({
      kind: "breached",
      breach: { kind: "over-limit", grantId: grantId("G2"), requested: 50, headroom: 40 },
    });
  });
});
