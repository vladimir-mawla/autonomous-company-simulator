import { describe, expect, it } from "vitest";
import { grantId, principalId } from "../../lib/contracts/index.js";
import type { InheritedStanding } from "../../lib/contracts/index.js";
import { append, standings } from "../../lib/standing/index.js";
import { replayScript } from "../../domains/company/index.js";
import { CHARTER, admit, revokeEv, standingFor } from "./helpers.js";
import type { CompanyLog } from "./helpers.js";

/**
 * KIND: PROVES (plan section 11, case 11).
 * TRACES TO: D7 (accountability climbs: the heir is the grantor of the first revoked link counting from the root).
 *
 * THE CLAIM. Who answers for an `inherited` commit is decided by the delegation chain, not by who pressed revoke. On the
 * canonical incident cut at seq 10 (`c1 c2 c3 c4` all binding), revoking G2 by `dana` and revoking it by `cfo` give the same
 * standings, with heir `cfo`. As higher links are cut later, the heir CLIMBS (`ops`, then `cfo`, then `dana` for `c1`), and
 * it is never sideways or down: on each step its place on the commit's trail is nearer the root, and it is never the
 * actor. Cutting the root grant first names `dana` at once, and a later revoke of a lower grant is `already-dead`: the heir
 * cannot be pushed back down.
 *
 * WHAT WOULD MAKE THIS FAIL: an heir read from the grantee of the dead link, or one that always names the top of the chain
 * (each is a sabotage in this milestone's ledger); a first-dead-link walk that counted from the commit upward; a revoke that
 * could cut a grant whose ancestor is already dead and so reassign the heir.
 */

const incident = replayScript().log;
const atSeq10: CompanyLog = incident.slice(0, 10);

const inheritedOf = (log: CompanyLog, id: string): InheritedStanding => {
  const standing = standingFor(log, id);
  if (standing.kind !== "inherited") throw new Error(`${id} is ${standing.kind}, not inherited`);
  return standing;
};

describe("11 accountability follows delegation, not revocation: the revoker is irrelevant", () => {
  it("at seq 10 the four commits are binding (the control)", () => {
    for (const id of ["c1", "c2", "c3", "c4"]) expect(standingFor(atSeq10, id).kind).toBe("binding");
  });

  it("revoking G2 by dana and by cfo gives equal standings for c1, c2 and c4: heir cfo, chargedTo G1, severed G2 at seq 11", () => {
    const byCfo = admit(atSeq10, revokeEv("G2", "cfo")).log;
    const byDana = admit(atSeq10, revokeEv("G2", "dana")).log;
    for (const id of ["c1", "c2", "c4"]) {
      const standing = inheritedOf(byDana, id);
      expect(standing).toEqual(inheritedOf(byCfo, id));
      expect(standing).toMatchObject({ severed: { grantId: grantId("G2"), atSeq: 11 }, heir: principalId("cfo"), chargedTo: grantId("G1") });
    }
    // c3 sits under G3 and G6, not under G2: untouched by either.
    expect(standingFor(byDana, "c3").kind).toBe("binding");
    expect(standingFor(byCfo, "c3").kind).toBe("binding");
  });

  it("a revoker who is not above the grant is not an option: ops revoking its own G2, and buyer-a revoking G4, are revoker-not-authorised", () => {
    expect(append(CHARTER, atSeq10, revokeEv("G2", "ops"))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "revoker-not-authorised", grantId: grantId("G2"), by: principalId("ops") } },
    });
    expect(append(CHARTER, atSeq10, revokeEv("G4", "buyer-a"))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "revoker-not-authorised", grantId: grantId("G4"), by: principalId("buyer-a") } },
    });
  });

  it("G4 (ops -> buyer-a) revoked by ops, by cfo or by dana: c1's heir is ops, chargedTo G2, severed G4 at seq 11, every time", () => {
    for (const by of ["ops", "cfo", "dana"]) {
      const log = admit(atSeq10, revokeEv("G4", by)).log;
      expect(inheritedOf(log, "c1")).toMatchObject({
        severed: { grantId: grantId("G4"), atSeq: 11 },
        heir: principalId("ops"),
        chargedTo: grantId("G2"),
      });
    }
  });
});

describe("11 accountability follows delegation, not revocation: the heir climbs and never descends", () => {
  it("cutting G4, then G2, then G1: c1's heir is ops, cfo, dana; chargedTo is G2, G1, null; its place on the trail moves 2, 1, 0", () => {
    let log = atSeq10;
    const seen: { heir: string; chargedTo: string | null; severed: string; place: number; trailLength: number }[] = [];
    for (const [grant, by] of [["G4", "ops"], ["G2", "cfo"], ["G1", "dana"]] as const) {
      log = admit(log, revokeEv(grant, by)).log;
      const standing = inheritedOf(log, "c1");
      seen.push({
        heir: standing.heir,
        chargedTo: standing.chargedTo,
        severed: standing.severed.grantId,
        place: standing.warrant.trail.indexOf(standing.heir),
        trailLength: standing.warrant.trail.length,
      });
    }
    // The trail of c1 is dana, cfo, ops, buyer-a: the actor is last, at place 3, and no heir is ever there.
    expect(seen).toEqual([
      { heir: "ops", chargedTo: "G2", severed: "G4", place: 2, trailLength: 4 },
      { heir: "cfo", chargedTo: "G1", severed: "G2", place: 1, trailLength: 4 },
      { heir: "dana", chargedTo: null, severed: "G1", place: 0, trailLength: 4 },
    ]);
  });

  it("c4 (ops, under G2): G4's cut does not touch it; cutting G2 makes cfo its heir; cutting G1 makes it dana", () => {
    const afterG4 = admit(atSeq10, revokeEv("G4", "ops")).log;
    expect(standingFor(afterG4, "c4").kind).toBe("binding");
    const afterG2 = admit(afterG4, revokeEv("G2", "cfo")).log;
    expect(inheritedOf(afterG2, "c4")).toMatchObject({ heir: principalId("cfo"), chargedTo: grantId("G1") });
    const afterG1 = admit(afterG2, revokeEv("G1", "dana")).log;
    expect(inheritedOf(afterG1, "c4")).toMatchObject({ heir: principalId("dana"), chargedTo: null });
  });

  it("over all six orders of the cuts G4, G2, G1: a cut under an already dead ancestor is already-dead, and after every admitted cut each inherited commit's heir is on its trail before its actor", () => {
    const cuts = [["G4", "ops"], ["G2", "cfo"], ["G1", "dana"]] as const;
    const orders: readonly (readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2])[] = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    let inheritedChecked = 0;
    let refused = 0;
    for (const order of orders) {
      let log = atSeq10;
      for (const index of order) {
        const [grant, by] = cuts[index];
        const step = append(CHARTER, log, revokeEv(grant, by));
        if (!step.ok) {
          expect(step.failure).toEqual({ kind: "rejected", rejection: { kind: "already-dead", grantId: grantId(grant) } });
          refused += 1;
          continue;
        }
        log = step.log;
        const result = standings(CHARTER, log);
        if (!result.ok) throw new Error("the log must fold");
        for (const standing of result.standings) {
          if (standing.kind !== "inherited") continue;
          const trail = standing.warrant.trail;
          const place = trail.indexOf(standing.heir);
          expect(standing.heir).not.toBe(trail[trail.length - 1]);
          expect(place).toBeGreaterThanOrEqual(0);
          expect(place).toBeLessThan(trail.length - 1);
          inheritedChecked += 1;
        }
      }
    }
    // Counted, so the loop cannot be satisfied by doing nothing: of the 18 cuts, 7 come after a cut above them (0, 1, 1, 1, 2, 2 over the six orders, read off the orders).
    expect(refused).toBe(7);
    expect(inheritedChecked).toBeGreaterThan(0);
  });

  it("cutting the root grant first names dana for c1, c2, c3 and c4 at once; a later cut of G2 is already-dead", () => {
    const afterG1 = admit(atSeq10, revokeEv("G1", "dana")).log;
    for (const id of ["c1", "c2", "c3", "c4"]) {
      expect(inheritedOf(afterG1, id)).toMatchObject({ heir: principalId("dana"), chargedTo: null, severed: { grantId: grantId("G1"), atSeq: 11 } });
    }
    expect(append(CHARTER, afterG1, revokeEv("G2", "cfo"))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "already-dead", grantId: grantId("G2") } },
    });
    for (const id of ["c1", "c2", "c3", "c4"]) {
      expect(inheritedOf(afterG1, id).heir).toBe(principalId("dana"));
    }
  });
});
