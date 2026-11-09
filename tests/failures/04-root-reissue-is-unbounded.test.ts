import { describe, expect, it } from "vitest";
import { MAX_AMOUNT, grantId, principalId } from "../../lib/contracts/index.js";
import { append, standings } from "../../lib/standing/index.js";
import { CHARTER, admit, build, commitEv, grantEv, kindsOf, revokeEv, standingFor } from "./helpers.js";
import type { CompanyLog } from "./helpers.js";

/**
 * KIND: DISCLOSES (plan section 11, case 04).
 * TRACES TO: D5 (roots are declared, not authenticated; the charter's roots are trusted).
 *
 * THE LIMIT. Conservation is per ROOT GRANT, not per human. The charter's root (`dana`) can issue as many root grants as she
 * likes, each with its own limit, and nothing bounds their sum: three root grants of 1 000 000 let 3 000 000 be spent, fifty of
 * `MAX_AMOUNT` are all admitted, and a root grant that has been fully spent and revoked does not reduce what the next one may
 * carry. The model protects the organisation from its agents, not from its humans.
 *
 * WHAT IS STILL TRUE, and pinned beside it: each root grant is bounded by its own limit (a commit of 1 more under a spent
 * one is `void: over-limit` with headroom 0), and revoking a root grant gives `inherited` with `heir` the charter root and
 * `chargedTo: null`: no grant's allowance answers for it (it is off-ledger).
 *
 * WHAT WOULD MAKE THIS FAIL: an engine that bounded a principal's root grants in aggregate (a second root grant for the same
 * root refused, or a sum checked); that would turn a disclosed limit into a closed one and this file red on purpose.
 */

const root = (id: string, limit: number) => grantEv({ id, grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit, depth: 1 });

describe("04 root re-issue is unbounded", () => {
  it("one root issues three root grants of 1 000 000 and all three are admitted; 3 000 000 is spent and ruled binding", () => {
    let log: CompanyLog = [];
    for (const id of ["R1", "R2", "R3"]) log = admit(log, root(id, 1_000_000)).log;
    for (const id of ["R1", "R2", "R3"]) log = admit(log, commitEv(`spend-${id}`, "cfo", id, "purchase", 1_000_000)).log;

    expect(kindsOf(log)).toEqual({ "spend-R1": "binding", "spend-R2": "binding", "spend-R3": "binding" });
    const result = standings(CHARTER, log);
    if (!result.ok) throw new Error("the log must fold");
    const bound = new Set(result.standings.filter((s) => s.kind === "binding").map((s) => s.commitId));
    const total = log.reduce((sum, event) => sum + (event.kind === "commit" && bound.has(event.commit.id) ? event.commit.amount : 0), 0);
    expect(total).toBe(3_000_000); // more than any one root grant's limit, and nothing refused it
  });

  it("fifty root grants of MAX_AMOUNT are all admitted: no aggregate bound exists", () => {
    let log: CompanyLog = [];
    for (let n = 1; n <= 50; n++) {
      const result = append(CHARTER, log, root(`R${n}`, MAX_AMOUNT));
      expect(result.ok).toBe(true);
      if (result.ok) log = result.log;
    }
    expect(log).toHaveLength(50);
    expect(log.reduce((sum, event) => sum + (event.kind === "grant" ? event.grant.limit : 0), 0)).toBe(50 * MAX_AMOUNT);
  });

  it("each root grant is still bounded by its own limit: a commit of 1 under a spent root grant is void: over-limit { requested 1, headroom 0 }", () => {
    let log = build([root("R1", 1000), root("R2", 1000)]);
    log = admit(log, commitEv("a", "cfo", "R1", "purchase", 1000)).log;
    const over = admit(log, commitEv("b", "cfo", "R1", "purchase", 1));
    expect(over.result.verdict).toEqual({
      kind: "breached",
      breach: { kind: "over-limit", grantId: grantId("R1"), requested: 1, headroom: 0 },
    });
    // R2 is untouched by what R1 spent: that is what "per root grant" means.
    expect(admit(over.log, commitEv("c", "cfo", "R2", "purchase", 1000)).result.verdict?.kind).toBe("warranted");
  });

  it("a root grant that was fully spent and revoked does not reduce what the next root grant may carry: 1 000 000 is spendable again", () => {
    let log = build([root("R1", 1_000_000), commitEv("a", "cfo", "R1", "purchase", 1_000_000), revokeEv("R1", "dana")]);
    const again = append(CHARTER, log, root("R2", 1_000_000));
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error("unreachable");
    log = admit(again.log, commitEv("b", "cfo", "R2", "purchase", 1_000_000)).log;
    expect(kindsOf(log)).toEqual({ a: "inherited", b: "binding" });
  });

  it("revoking a root grant: the commit under it is inherited by the root itself, chargedTo null, severed at the root grant", () => {
    const log = build([
      root("R1", 1000),
      grantEv({ id: "G2", parent: "R1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 400, depth: 0 }),
      commitEv("direct", "cfo", "R1", "purchase", 100),
      commitEv("below", "ops", "G2", "purchase", 200),
      revokeEv("R1", "dana"),
    ]);
    for (const id of ["direct", "below"]) {
      expect(standingFor(log, id)).toMatchObject({
        kind: "inherited",
        severed: { grantId: grantId("R1"), atSeq: 5 },
        heir: principalId("dana"),
        chargedTo: null,
      });
    }
  });
});
