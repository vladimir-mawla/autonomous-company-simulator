import { describe, expect, it } from "vitest";
import { grantId, principalId } from "../../lib/contracts/index.js";
import { append, fold } from "../../lib/standing/index.js";
import { CHARTER, ENTRY_POINTS, build, commitEv, grantEv, revokeEv, stamped, standingFor } from "./helpers.js";
import type { CompanyLog } from "./helpers.js";

/**
 * KIND: DISCLOSES, and PROVES that replay re-validates (plan section 11, case 05).
 * TRACES TO: D5 (roots are declared, not authenticated; `grantor`, `by` and `actor` are claims), D3 (the log is the only state).
 *
 * THE LIMIT. Who wrote an event is a claim the event makes about itself. The engine checks that the claim is consistent with the
 * grants (the actor is the grantee, the revoker is above the grant) and has no way to check that it is true: a revoke
 * whose `by` names a real principal above the grant is accepted whoever sent it, a commit whose `actor` names the grantee
 * passes `wrong-actor` whoever sent it, and a log of events that are all admissible but never happened folds exactly as one
 * that did. Each of the three is shown beside its contrast (the same event with a claim that does NOT fit is refused or ruled
 * void), so the acceptance is a fact about the claim and not about a check that is missing.
 *
 * WHAT IS PROVED: replay re-runs every admission rule. A log that was cast into shape and contains an event that could not
 * have been admitted is `inadmissible-event { index, rejection }` from every entry point; there is no brand on a `Log` to forge
 * and nothing that makes a hand-built log trusted.
 *
 * WHAT WOULD MAKE THIS FAIL: (disclosure) any authentication of `by` or `actor` added to the engine; (proof) a replay that
 * skipped, or trusted, an event it could not admit; (contrast) a `wrong-actor` or `revoker-not-authorised` check removed.
 */

const world = (): CompanyLog =>
  build([
    grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1_000_000, depth: 3 }),
    grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 400_000, depth: 2 }),
    grantEv({ id: "G4", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 100_000, depth: 0 }),
  ]);

describe("05 authorship is asserted, not authenticated: what the engine accepts on a claim", () => {
  it("a revoke of G4 claiming `by: ops` is admitted whoever sent it; the same revoke claiming the truth (`by: buyer-a`, the grantee) is revoker-not-authorised", () => {
    const log = world();
    // Suppose buyer-a (the grantee) sent both. Nothing in the event says so; the claim is all there is.
    const forged = append(CHARTER, log, revokeEv("G4", "ops"));
    expect(forged.ok).toBe(true);
    if (forged.ok) expect(forged.event).toEqual({ kind: "revoke", grantId: "G4", by: "ops", seq: 4 });

    expect(append(CHARTER, log, revokeEv("G4", "buyer-a"))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "revoker-not-authorised", grantId: grantId("G4"), by: principalId("buyer-a") } },
    });
  });

  it("a commit claiming `actor: buyer-a` under G4 passes wrong-actor whoever sent it; claiming `buyer-b` is void: wrong-actor { holder buyer-a }", () => {
    const log = world();
    const claimed = append(CHARTER, log, commitEv("c1", "buyer-a", "G4", "purchase", 1000));
    expect(claimed.ok && claimed.verdict?.kind).toBe("warranted");

    const other = append(CHARTER, log, commitEv("c2", "buyer-b", "G4", "purchase", 1000));
    expect(other.ok && other.verdict).toEqual({
      kind: "breached",
      breach: { kind: "wrong-actor", grantId: grantId("G4"), holder: principalId("buyer-a") },
    });
  });

  it("a log of admissible events that never happened folds clean, and is indistinguishable from the log append built", () => {
    const events = [
      grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1_000_000, depth: 3 }),
      commitEv("never-happened", "cfo", "G1", "purchase", 900_000),
    ];
    const made = stamped(events);
    const asked = fold(CHARTER, made);
    expect(asked.ok).toBe(true);
    expect(standingFor(made, "never-happened")).toMatchObject({ kind: "binding", committedAt: 2 });

    const real = build(events);
    expect(real).toEqual(made); // the engine's own log and the fabricated one are equal as values: there is nothing to tell them apart
  });
});

describe("05 replay re-validates: a cast-built log with an event that could not have been admitted fails closed at its index", () => {
  const rows: readonly (readonly [string, CompanyLog, number, object])[] = [
    [
      "a grant that widens its parent's capabilities (hire under a purchase-only parent)",
      stamped([
        grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1000, depth: 2 }),
        grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["hire"], limit: 10, depth: 0 }),
      ]),
      1,
      { kind: "capability-widening", capability: "hire" },
    ],
    [
      "a child grant bigger than its parent's headroom",
      stamped([
        grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1000, depth: 2 }),
        grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 1001, depth: 0 }),
      ]),
      1,
      { kind: "over-allocation", grantId: "G1", requested: 1001, headroom: 1000 },
    ],
    [
      "a root grant by a principal the charter does not name",
      stamped([grantEv({ id: "G1", grantor: "intern", grantee: "cfo", capabilities: ["purchase"], limit: 1000, depth: 2 })]),
      0,
      { kind: "not-a-root", grantor: "intern" },
    ],
    [
      "a revoke by the grantee of the grant",
      stamped([
        grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1000, depth: 2 }),
        revokeEv("G1", "cfo"),
      ]),
      1,
      { kind: "revoker-not-authorised", grantId: "G1", by: "cfo" },
    ],
    [
      "a second commit with an id already used",
      stamped([
        grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1000, depth: 2 }),
        commitEv("k", "cfo", "G1", "purchase", 1),
        commitEv("k", "cfo", "G1", "purchase", 1),
      ]),
      2,
      { kind: "duplicate-id", id: "k" },
    ],
  ];

  describe.each(rows)("%s", (_name, log, index, rejection) => {
    it.each(ENTRY_POINTS)("%s answers inadmissible-event at the index, with the rejection a direct append gives", (_entry, run) => {
      expect(run(CHARTER, log)).toEqual({ kind: "inadmissible-event", index, rejection });
    });
  });

  it("the rejection in the fault is the one append gives for the same event on the log before it (one admission path)", () => {
    for (const [, log, index, rejection] of rows) {
      const bad = log[index];
      if (bad === undefined) throw new Error("unreachable");
      const { seq: _seq, ...input } = bad;
      void _seq;
      const direct = append(CHARTER, log.slice(0, index), input);
      expect(direct).toEqual({ ok: false, failure: { kind: "rejected", rejection } });
    }
  });
});
