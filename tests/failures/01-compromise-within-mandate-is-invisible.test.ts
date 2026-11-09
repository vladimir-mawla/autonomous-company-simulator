import { describe, expect, it } from "vitest";
import { MAX_AMOUNT, grantId, principalId } from "../../lib/contracts/index.js";
import { append, standings } from "../../lib/standing/index.js";
import { CHARTER, admit, build, commitEv, grantEv, kindsOf, revokeEv, standingFor } from "./helpers.js";
import type { CompanyLog } from "./helpers.js";

/**
 * KIND: DISCLOSES + PROVES THE BOUND. This is the project's deliberate failure test (plan section 6 M7; section 11, case 01).
 * TRACES TO: D1 (standing is derived from the act and the chain; nothing in it reads intent), D2 (authority is conserved).
 *
 * THE LIMIT, STATED AS A FAILURE. The engine cannot tell a compromised agent from a diligent one. An agent that holds a
 * live, in-scope, funded grant and spends inside it is ruled `binding`, whoever is driving it and whatever it is for.
 * Nothing in the engine reads who or why: no commit field, no rule and no policy is about intent. So the first thing
 * this file pins is a failure, on purpose: a "compromised" buyer and a "diligent" buyer who make the same five commits
 * get the same five rulings, and the engine does not flag the first.
 *
 * WHAT IS PROVED INSTEAD: the loss is bounded by the grant, not detected. With limit 50 000 and five commits of 10 000
 * the sixth commit of even 1 is `void: over-limit { requested 1, headroom 0 }`; a delegation does not widen the bound
 * (what a confederate spends is taken out of the same 50 000); and after the grantor revokes, the five commits are
 * `inherited` by the grantor (they are not undone, D1) and a seventh act is `void: link-dead`.
 *
 * WHAT WOULD MAKE THIS FAIL: (1) an anomaly rule that ruled the compromised agent's acts differently from the diligent
 * agent's; (2) any change that lets a grant's subtree be charged for more than its limit (the headroom sum ignoring a
 * commit's own charge turns the sixth commit `binding`, a reservation not counted turns the confederate's last commit
 * `binding`); (3) revocation that undid the five commits instead of passing them to an heir.
 */

const G1 = "G1";
const G2 = "G2";

/** G1 dana -> cfo, everything, 1 000 000; then G2 cfo -> `holder`, purchase, 50 000, depth `depth`. */
function company(holder: string, grant: string, depth = 0): CompanyLog {
  return build([
    grantEv({ id: G1, grantor: "dana", grantee: "cfo", capabilities: ["purchase", "refund", "hire", "sign-contract"], limit: 1_000_000, depth: 3 }),
    grantEv({ id: grant, parent: G1, grantor: "cfo", grantee: holder, capabilities: ["purchase"], limit: 50_000, depth }),
  ]);
}

/** The five commits of 10 000, in order, by `actor` under `grant`, id prefix `prefix`. */
function spendFive(log: CompanyLog, actor: string, grant: string, prefix: string): CompanyLog {
  let next = log;
  for (let n = 1; n <= 5; n++) next = admit(next, commitEv(`${prefix}${n}`, actor, grant, "purchase", 10_000)).log;
  return next;
}

/** A standing with the names of the one run replaced by neutral ones, so two runs can be compared as values. */
function neutral(value: unknown, names: Readonly<Record<string, string>>): string {
  let text = JSON.stringify(value);
  for (const [name, replacement] of Object.entries(names)) text = text.split(`"${name}`).join(`"${replacement}`);
  return text;
}

describe("01 compromise within a mandate is invisible, and the loss is bounded by the grant", () => {
  it("a compromised buyer's five commits and a diligent buyer's five identical commits get the same five rulings, and none is flagged", () => {
    const compromised = spendFive(company("buyer-a", "GA"), "buyer-a", "GA", "ca");
    const diligent = spendFive(company("buyer-b", "GB"), "buyer-b", "GB", "db");

    const kindsA = Object.values(kindsOf(compromised));
    expect(kindsA).toEqual(["binding", "binding", "binding", "binding", "binding"]);
    expect(Object.values(kindsOf(diligent))).toEqual(["binding", "binding", "binding", "binding", "binding"]);

    const a = standings(CHARTER, compromised);
    const d = standings(CHARTER, diligent);
    if (!a.ok || !d.ok) throw new Error("the logs must fold");
    const names = { ca: "c", db: "c", GA: "G", GB: "G", "buyer-a": "buyer", "buyer-b": "buyer" };
    // Equal as values once the names are neutral: nothing in a standing says which of them was compromised.
    expect(neutral(a.standings, names)).toBe(neutral(d.standings, names));
    // And a standing carries no field that could say it: the three binding fields are the whole of it.
    for (const standing of a.standings) {
      expect(Object.keys(standing).sort()).toEqual(["commitId", "committedAt", "kind", "warrant"]);
    }
  });

  it("the bound: after 5 x 10 000 under a limit of 50 000, a sixth commit of 1 is recorded void: over-limit { requested 1, headroom 0 }, and the binding amounts sum to the limit", () => {
    const log = spendFive(company("buyer-a", G2), "buyer-a", G2, "c");
    const sixth = admit(log, commitEv("c6", "buyer-a", G2, "purchase", 1));

    expect(sixth.result.verdict).toEqual({
      kind: "breached",
      breach: { kind: "over-limit", grantId: grantId(G2), requested: 1, headroom: 0 },
    });
    expect(sixth.log).toHaveLength(log.length + 1);
    expect(standingFor(sixth.log, "c6")).toEqual({
      commitId: "c6",
      committedAt: 8,
      kind: "void",
      breach: { kind: "over-limit", grantId: grantId(G2), requested: 1, headroom: 0 },
    });

    const result = standings(CHARTER, sixth.log);
    if (!result.ok) throw new Error("the log must fold");
    const bound = result.standings.filter((standing) => standing.kind !== "void").length * 10_000;
    expect(bound).toBe(50_000);
  });

  it("the bound is not an accident of the sixth commit's size: 1, 10 000 and MAX_AMOUNT are each void: over-limit with headroom 0", () => {
    const log = spendFive(company("buyer-a", G2), "buyer-a", G2, "c");
    for (const amount of [1, 10_000, MAX_AMOUNT]) {
      const verdict = admit(log, commitEv("c6", "buyer-a", G2, "purchase", amount)).result.verdict;
      expect(verdict).toEqual({
        kind: "breached",
        breach: { kind: "over-limit", grantId: grantId(G2), requested: amount, headroom: 0 },
      });
    }
  });

  it("a delegation does not widen the bound: a confederate's 30 000 comes out of the same 50 000, and the subtree's binding total is 50 000", () => {
    // ops holds G2 with depth 1 and delegates 30 000 of it to buyer-a (G3); ops spends 20 000; each then tries 1 more.
    let log = build([
      grantEv({ id: G1, grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1_000_000, depth: 3 }),
      grantEv({ id: G2, parent: G1, grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 50_000, depth: 1 }),
      grantEv({ id: "G3", parent: G2, grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 30_000, depth: 0 }),
    ]);
    log = admit(log, commitEv("c-conf", "buyer-a", "G3", "purchase", 30_000)).log;
    log = admit(log, commitEv("c-ops", "ops", G2, "purchase", 20_000)).log;

    const opsMore = admit(log, commitEv("c-ops2", "ops", G2, "purchase", 1));
    expect(opsMore.result.verdict).toEqual({
      kind: "breached",
      breach: { kind: "over-limit", grantId: grantId(G2), requested: 1, headroom: 0 },
    });
    const confMore = admit(opsMore.log, commitEv("c-conf2", "buyer-a", "G3", "purchase", 1));
    expect(confMore.result.verdict).toEqual({
      kind: "breached",
      breach: { kind: "over-limit", grantId: grantId("G3"), requested: 1, headroom: 0 },
    });

    const kinds = kindsOf(confMore.log);
    expect(kinds).toEqual({ "c-conf": "binding", "c-ops": "binding", "c-ops2": "void", "c-conf2": "void" });

    // And a delegation beyond the headroom is refused before it can spend anything.
    const tooMuch = append(CHARTER, log, grantEv({ id: "G4", parent: G2, grantor: "ops", grantee: "buyer-b", capabilities: ["purchase"], limit: 1, depth: 0 }));
    expect(tooMuch).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "over-allocation", grantId: grantId(G2), requested: 1, headroom: 0 } },
    });
  });

  it("revocation does not undo the five: they become inherited by the grantor with chargedTo its parent grant, and the next act is void: link-dead", () => {
    const spent = spendFive(company("buyer-a", G2), "buyer-a", G2, "c");
    const revoked = admit(spent, revokeEv(G2, "cfo")).log; // seq 8
    expect(revoked).toHaveLength(8);

    for (let n = 1; n <= 5; n++) {
      const standing = standingFor(revoked, `c${n}`);
      expect(standing).toEqual({
        commitId: `c${n}`,
        committedAt: n + 2,
        kind: "inherited",
        warrant: expect.anything(),
        severed: { grantId: grantId(G2), atSeq: 8 },
        heir: principalId("cfo"),
        chargedTo: grantId(G1),
      });
    }

    const after = admit(revoked, commitEv("c6", "buyer-a", G2, "purchase", 1));
    expect(after.result.verdict).toEqual({ kind: "breached", breach: { kind: "link-dead", grantId: grantId(G2), atSeq: 8 } });

    // What was spent is not forgiven: G1 gave 50 000 away and has all of it back as spent, so 950 000 is what is left to delegate.
    const fits = append(CHARTER, revoked, grantEv({ id: "G9", parent: G1, grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 950_000, depth: 2 }));
    expect(fits.ok).toBe(true);
    const over = append(CHARTER, revoked, grantEv({ id: "G9", parent: G1, grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 950_001, depth: 2 }));
    expect(over).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "over-allocation", grantId: grantId(G1), requested: 950_001, headroom: 950_000 } },
    });
  });
});
