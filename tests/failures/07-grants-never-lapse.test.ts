import { describe, expect, it } from "vitest";
import { grantId } from "../../lib/contracts/index.js";
import { append, fold } from "../../lib/standing/index.js";
import { CHARTER, admit, askCommit, build, commitEv, grantEv, revokeEv, stamped } from "./helpers.js";
import type { CompanyLog, Ev } from "./helpers.js";

/**
 * KIND: DISCLOSES (plan section 11, case 07).
 * TRACES TO: D6 (one conserved scalar; no expiry, no rate limit, no per-vendor sub-scopes).
 *
 * THE LIMIT. A grant does not lapse. The engine has no clock and no timestamp on any event, so the only thing that passes
 * is the log getting longer, and that changes nothing about a grant: after 4 000 events that have nothing to do with it, the
 * grant still warrants a commit of its whole limit. There is no rate limit either: the whole limit can be spent in one commit or
 * in consecutive seqs. Authority ends only on an explicit `revoke`, and a time-boxed grant is a revoke someone must
 * schedule (disclosed, not provided).
 *
 * WHAT WOULD MAKE THIS FAIL: any expiry (a grant that stops warranting after some number of events), or any cap on how much of
 * a limit one commit or one stretch of consecutive seqs may take. Either would close the limit, and this file would go
 * red on purpose.
 */

const UNRELATED = 4000;

/**
 * G1 dana -> cfo (1), G2 cfo -> ops, purchase, 100 000 (2): the grant under test. Then `UNRELATED` events that touch neither
 * G2 nor ops: one grant to buyer-b (G3) and commits of 1 under it. Built by hand (stamped) because `append` replays the whole
 * log per call and 4 000 calls would be quadratic; `fold` rules on it below.
 */
function lapseLog(unrelated: number): CompanyLog {
  const events: Ev[] = [
    grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1_000_000, depth: 2 }),
    grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 100_000, depth: 0 }),
  ];
  if (unrelated > 0) {
    events.push(grantEv({ id: "G3", parent: "G1", grantor: "cfo", grantee: "buyer-b", capabilities: ["purchase"], limit: 800_000, depth: 0 }));
    for (let n = 1; n < unrelated; n++) events.push(commitEv(`u${n}`, "buyer-b", "G3", "purchase", 1));
  }
  return stamped(events);
}

describe("07 grants never lapse", () => {
  it(`the hand-built log of ${UNRELATED} unrelated events folds: it is a real log, ${UNRELATED + 2} events, head ${UNRELATED + 2}`, () => {
    const result = fold(CHARTER, lapseLog(UNRELATED));
    expect(result.ok && result.folded.head).toBe(UNRELATED + 2);
  });

  it(`after ${UNRELATED} unrelated events G2 still warrants its whole limit in one commit; the verdict is the one it gave with none`, () => {
    const fresh = askCommit(lapseLog(0), "whole", "ops", "G2", "purchase", 100_000);
    const aged = askCommit(lapseLog(UNRELATED), "whole", "ops", "G2", "purchase", 100_000);
    expect(fresh.ok && fresh.verdict.kind).toBe("warranted");
    expect(aged).toEqual(fresh);

    const recorded = append(CHARTER, lapseLog(UNRELATED), commitEv("whole", "ops", "G2", "purchase", 100_000));
    expect(recorded.ok && recorded.event.seq).toBe(UNRELATED + 3);
    expect(recorded.ok && recorded.verdict?.kind).toBe("warranted");
  });

  it(`after ${UNRELATED} unrelated events, one more than the limit is void: over-limit { requested 100 001, headroom 100 000 }: age moved the limit by nothing`, () => {
    expect(askCommit(lapseLog(UNRELATED), "over", "ops", "G2", "purchase", 100_001)).toEqual({
      ok: true,
      verdict: { kind: "breached", breach: { kind: "over-limit", grantId: grantId("G2"), requested: 100_001, headroom: 100_000 } },
    });
  });

  it("there is no rate limit: the whole limit goes in consecutive seqs (ten commits of 10 000 at seq 3 to 12), and the eleventh, of 1, is over-limit with headroom 0", () => {
    let log = build([
      grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1_000_000, depth: 2 }),
      grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 100_000, depth: 0 }),
    ]);
    for (let n = 1; n <= 10; n++) {
      const step = admit(log, commitEv(`s${n}`, "ops", "G2", "purchase", 10_000));
      expect(step.result.verdict?.kind).toBe("warranted");
      expect(step.result.event.seq).toBe(n + 2);
      log = step.log;
    }
    const eleventh = admit(log, commitEv("s11", "ops", "G2", "purchase", 1));
    expect(eleventh.result.verdict).toEqual({
      kind: "breached",
      breach: { kind: "over-limit", grantId: grantId("G2"), requested: 1, headroom: 0 },
    });
  });

  it(`authority ends only on an explicit revoke: after ${UNRELATED} unrelated events cfo revokes G2 (seq ${UNRELATED + 3}), and the next commit is void: link-dead { G2, atSeq ${UNRELATED + 3} }`, () => {
    const revoked = admit(lapseLog(UNRELATED), revokeEv("G2", "cfo"));
    expect(revoked.result.event.seq).toBe(UNRELATED + 3);
    expect(askCommit(revoked.log, "after", "ops", "G2", "purchase", 1)).toEqual({
      ok: true,
      verdict: { kind: "breached", breach: { kind: "link-dead", grantId: grantId("G2"), atSeq: UNRELATED + 3 } },
    });
  });
});
