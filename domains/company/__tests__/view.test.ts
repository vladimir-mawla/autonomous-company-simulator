import { describe, expect, it } from "vitest";
import { commitId, grantId, principalId } from "../../../lib/contracts/index.js";
import type { Commitment, EventInput, Log } from "../../../lib/contracts/index.js";
import { append, mayCommit } from "../../../lib/standing/index.js";
import { CANON_ALL, logOf } from "../../../lib/standing/__tests__/fixtures.js";
import { CHARTER } from "../org.js";
import type { CompanyCapability } from "../org.js";
import { makeOrgView } from "../view.js";
import type { OrgView } from "../view.js";

/**
 * `makeOrgView`: what a policy is shown (`view.ts`). The logs are plan §7's incident built by M5's own fixtures (`logOf` over
 * `CANON_ALL`, which offers each event to the real `append`), not by this domain's script, so what the view says is checked against
 * data this domain did not write: §7's chains (G4 hangs from G2, which hangs from G1), and which of them the revoke at seq 11 cut.
 */

const canon = (seq: number): Log<CompanyCapability> => logOf(CHARTER, CANON_ALL.slice(0, seq));

function viewOf(log: Log<CompanyCapability>, tick = 0): OrgView {
  const made = makeOrgView(log, tick);
  if (!made.ok) throw new Error(`no view: ${JSON.stringify(made.fault)}`);
  return made.view;
}

const summary = (view: OrgView): string[] =>
  view.grants.map((entry) => `${entry.grant.id}:${entry.live ? "live" : "dead"}:${entry.links}:${entry.trail.join(">")}`);

describe("the view of plan section 7's log", () => {
  it("at seq 10, before the revoke: G1 to G6 in the order they were admitted, all live, with the chain length and the trail of principals each hangs from", () => {
    expect(summary(viewOf(canon(10)))).toEqual([
      "G1:live:1:dana>cfo",
      "G2:live:2:dana>cfo>ops",
      "G3:live:2:dana>cfo>support",
      "G4:live:3:dana>cfo>ops>buyer-a",
      "G5:live:3:dana>cfo>ops>buyer-b",
      "G6:live:3:dana>cfo>support>refunder",
    ]);
  });

  it("at seq 11, after cfo revokes G2: G2 is dead and so are G4 and G5 beneath it, though neither was revoked itself; G1, G3 and G6 are live", () => {
    expect(summary(viewOf(canon(11))).map((line) => line.split(":").slice(0, 2).join(":"))).toEqual(["G1:live", "G2:dead", "G3:live", "G4:dead", "G5:dead", "G6:live"]);
  });

  it("at seq 18, after the cure: G7 is live, one link below G1 (two links, trail dana > cfo > buyer-a); the dead stay dead", () => {
    expect(summary(viewOf(canon(18)))).toEqual([
      "G1:live:1:dana>cfo",
      "G2:dead:2:dana>cfo>ops",
      "G3:live:2:dana>cfo>support",
      "G4:dead:3:dana>cfo>ops>buyer-a",
      "G5:dead:3:dana>cfo>ops>buyer-b",
      "G6:live:3:dana>cfo>support>refunder",
      "G7:live:2:dana>cfo>buyer-a",
    ]);
  });

  it("the longest chain the company can have, by hand: six grants, dana > cfo > ops > support > buyer-a > buyer-b > refunder, each one link longer than its parent, all live; cut at the third link, the third to the sixth are dead and the first two are not", () => {
    // Six agents and a root: a grantee may not already be on the trail, so six grants is the most there can be. Depths 5, 4, 3, 2, 1, 0.
    const NAMES = ["cfo", "ops", "support", "buyer-a", "buyer-b", "refunder"] as const;
    const chain: EventInput<CompanyCapability>[] = NAMES.map((name, index) => ({
      kind: "grant",
      grant: {
        id: grantId(`L${index + 1}`),
        parent: index === 0 ? null : grantId(`L${index}`),
        grantor: index === 0 ? principalId("dana") : principalId(NAMES[index - 1] as string),
        grantee: principalId(name),
        capabilities: ["purchase"],
        limit: 1_000 - index,
        depth: 5 - index,
      },
    }));
    const whole = logOf(CHARTER, chain);
    expect(whole).toHaveLength(6);
    expect(summary(viewOf(whole))).toEqual([
      "L1:live:1:dana>cfo",
      "L2:live:2:dana>cfo>ops",
      "L3:live:3:dana>cfo>ops>support",
      "L4:live:4:dana>cfo>ops>support>buyer-a",
      "L5:live:5:dana>cfo>ops>support>buyer-a>buyer-b",
      "L6:live:6:dana>cfo>ops>support>buyer-a>buyer-b>refunder",
    ]);
    // The seventh link is refused by the engine, whoever is asked to take it: every agent is already on the trail.
    for (const name of NAMES) {
      const seventh = viewOf(whole).dryRun({ kind: "grant", grant: { id: grantId("L7"), parent: grantId("L6"), grantor: principalId("refunder"), grantee: principalId(name), capabilities: ["purchase"], limit: 1, depth: 0 } });
      expect(seventh.ok, name).toBe(false);
    }
    const cut = logOf(CHARTER, [...chain, { kind: "revoke", grantId: grantId("L3"), by: principalId("ops") }]);
    expect(summary(viewOf(cut)).map((line) => line.split(":").slice(0, 2).join(":"))).toEqual(["L1:live", "L2:live", "L3:dead", "L4:dead", "L5:dead", "L6:dead"]);
    expect(viewOf(cut).grants.map((entry) => entry.links)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("carries the tick it was made at, and head is the number of admitted events (seq of the last one)", () => {
    const view = viewOf(canon(18), 7);
    expect([view.tick, view.head, view.log.length]).toEqual([7, 18, 18]);
  });

  it("an empty log has head 0 and no grants", () => {
    const view = viewOf([], 0);
    expect([view.head, view.grants]).toEqual([0, []]);
  });

  it("is a function of the log and the tick: two views of the same log say the same, and a longer log says more", () => {
    expect(summary(viewOf(canon(11)))).toEqual(summary(viewOf(canon(11))));
    expect(viewOf(canon(10)).grants.length).toBeLessThan(viewOf(canon(17)).grants.length);
  });
});

describe("the view's pre-check is the engine's pre-check, unchanged", () => {
  const commit = (id: string, actor: string, under: string, capability: CompanyCapability, amount: number): Commitment<CompanyCapability> => ({
    id: commitId(id),
    actor: principalId(actor),
    actedUnder: grantId(under),
    capability,
    amount,
  });

  it("answers exactly what lib/standing's mayCommit answers, for a commit that would bind, one under a cut chain, one over the limit and one under a grant that does not exist", () => {
    const log = canon(18);
    const view = viewOf(log);
    for (const c of [
      commit("p1", "buyer-a", "G7", "purchase", 1_000),
      commit("p2", "buyer-a", "G4", "purchase", 1_000),
      commit("p3", "refunder", "G6", "refund", 1_000_000),
      commit("p4", "buyer-a", "g-ghost", "purchase", 1),
    ]) {
      expect(view.mayCommit(c)).toEqual(mayCommit(CHARTER, log, c));
    }
    const verdicts = [commit("p1", "buyer-a", "G7", "purchase", 1_000), commit("p2", "buyer-a", "G4", "purchase", 1_000)].map((c) => {
      const answer = view.mayCommit(c);
      return answer.ok ? answer.verdict.kind : "not judged";
    });
    expect(verdicts).toEqual(["warranted", "breached"]);
  });
});

describe("the view's dry run is append itself, called and not kept", () => {
  it("answers exactly what append answers, for a grant that would be admitted, a revoke that would be refused and a commit, and changes no log", () => {
    const log = canon(18);
    const before = JSON.stringify(log);
    const view = viewOf(log);
    const events: EventInput<CompanyCapability>[] = [
      { kind: "grant", grant: { id: grantId("Gd1"), parent: grantId("G1"), grantor: principalId("cfo"), grantee: principalId("ops"), capabilities: ["purchase"], limit: 1_000, depth: 1 } },
      { kind: "revoke", grantId: grantId("G2"), by: principalId("cfo") },
      { kind: "commit", commit: { id: commitId("p9"), actor: principalId("buyer-a"), actedUnder: grantId("G7"), capability: "purchase", amount: 1_000 } },
    ];
    for (const event of events) expect(view.dryRun(event)).toEqual(append(CHARTER, log, event));
    expect(view.dryRun(events[0] as EventInput<CompanyCapability>).ok).toBe(true);
    expect(view.dryRun(events[1] as EventInput<CompanyCapability>).ok).toBe(false);
    expect(JSON.stringify(log)).toBe(before);
    expect(view.head).toBe(18);
  });
});

describe("a log the engine cannot replay is a typed fault, not a view and not a throw", () => {
  it("a log whose seq is out of place", () => {
    const log = canon(3).map((event, index) => (index === 1 ? { ...event, seq: 5 } : event));
    expect(makeOrgView(log, 0)).toEqual({ ok: false, fault: { kind: "seq-mismatch", index: 1, expected: 2, actual: 5 } });
  });

  it("a log that is not an array at all", () => {
    const made = makeOrgView(null as unknown as Log<CompanyCapability>, 0);
    expect(made.ok).toBe(false);
    expect(!made.ok && made.fault.kind).toBe("hostile-log-input");
  });
});
