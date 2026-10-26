import { describe, expect, it } from "vitest";
import { absorbedBy, headroomOf } from "../../../lib/allowance/index.js";
import type { Breach, Log, Rejection, Standing } from "../../../lib/contracts/index.js";
import { grantId, principalId } from "../../../lib/contracts/index.js";
import { fold, standings } from "../../../lib/standing/index.js";
import { CANON_ALL, logOf } from "../../../lib/standing/__tests__/fixtures.js";
import { CHARTER } from "../org.js";
import type { CompanyCapability } from "../org.js";
import { CANON_SCRIPT } from "../script.js";
import { replayScript } from "../simulate.js";
import type { Attempt } from "../simulate.js";

/**
 * Plan §7's canonical incident, offered through THIS DOMAIN'S script to the real engine, and every number the plan gives asserted against
 * what the engine computed. `lib/standing/__tests__/canonical.test.ts` (M5) does the same for M5's own fixtures; this file is the domain's
 * half, and each table below is written from §7's table directly (not copied from that file) so that the two agree only if §7 was read the same
 * way twice and the engine says what §7 says.
 *
 * `scripts/demo-company.ts` holds the same table again and checks it on every run; its exit code is tested in `demo.test.ts`.
 */

const g = grantId;
const p = principalId;
const REPLAY = replayScript();
const byKey = new Map<string, Attempt>(CANON_SCRIPT.map((step, index) => [step.key, REPLAY.attempts[index] as Attempt]));
const attemptOf = (key: string): Attempt => {
  const attempt = byKey.get(key);
  if (attempt === undefined) throw new Error(`no attempt ${key}`);
  return attempt;
};

describe("replayScript offers the 33 steps to the engine from an empty log", () => {
  it("makes 33 attempts, numbered 1 to 33, all at tick 0 from the canon, each carrying its step's narration and the very event the step holds", () => {
    expect(REPLAY.attempts).toHaveLength(33);
    expect(REPLAY.attempts.map((attempt) => attempt.n)).toEqual(Array.from({ length: 33 }, (_, index) => index + 1));
    for (const [index, attempt] of REPLAY.attempts.entries()) {
      const step = CANON_SCRIPT[index];
      expect([attempt.tick, attempt.source, attempt.label]).toEqual([0, "canon", step?.label]);
      expect(attempt.input).toBe(step?.input);
    }
  });

  it("admits 18 and refuses 15, and nothing is a faulty log", () => {
    const kinds = REPLAY.attempts.map((attempt) => attempt.outcome.kind);
    expect(kinds.filter((kind) => kind === "admitted")).toHaveLength(18);
    expect(kinds.filter((kind) => kind === "rejected")).toHaveLength(15);
    expect(kinds.filter((kind) => kind === "faulty-log")).toHaveLength(0);
  });

  it("the log it ends with is the log M5's own fixtures build from M5's own copy of §7: the same eighteen events at seq 1 to 18", () => {
    expect(REPLAY.log).toEqual(logOf(CHARTER, CANON_ALL));
    expect(REPLAY.log.map((event) => event.seq)).toEqual(Array.from({ length: 18 }, (_, index) => index + 1));
  });

  it("the log holds exactly the admitted attempts' events, in order, and a refusal leaves no trace", () => {
    const admitted = REPLAY.attempts.flatMap((attempt) => (attempt.outcome.kind === "admitted" ? [attempt.outcome.event] : []));
    expect(admitted).toEqual([...REPLAY.log]);
  });

  it("is deterministic and leaves the script alone", () => {
    const again = replayScript();
    expect(JSON.stringify(again)).toBe(JSON.stringify(REPLAY));
  });
});

describe("the eighteen admitted steps, at the seq plan section 7 gives each", () => {
  const SEQ: readonly (readonly [string, number])[] = [
    ["G1", 1], ["G2", 2], ["G3", 3], ["G4", 4], ["G5", 5], ["G6", 6],
    ["c1", 7], ["c2", 8], ["c3", 9], ["c4", 10],
    ["revoke-G2", 11],
    ["c5", 12], ["c6", 13], ["c7", 14], ["c8", 15], ["c9", 16],
    ["G7", 17], ["c10", 18],
  ];

  it.each(SEQ)("%s is admitted at seq %i", (key, seq) => {
    const outcome = attemptOf(key).outcome;
    expect(outcome.kind).toBe("admitted");
    expect(outcome.kind === "admitted" && outcome.event.seq).toBe(seq);
  });

  it("the verdict of each commit: c1 to c4 and c10 warranted; c5 to c9 breached, one breach of each of the five kinds, in the precedence order §7 shows", () => {
    const verdictOf = (key: string): string | Breach => {
      const outcome = attemptOf(key).outcome;
      if (outcome.kind !== "admitted" || outcome.verdict === null) throw new Error(`${key} has no verdict`);
      return outcome.verdict.kind === "warranted" ? "warranted" : outcome.verdict.breach;
    };
    for (const key of ["c1", "c2", "c3", "c4", "c10"]) expect(verdictOf(key), key).toBe("warranted");
    expect(verdictOf("c5")).toEqual({ kind: "link-dead", grantId: g("G2"), atSeq: 11 });
    expect(verdictOf("c6")).toEqual({ kind: "wrong-actor", grantId: g("G4"), holder: p("buyer-a") });
    expect(verdictOf("c7")).toEqual({ kind: "capability-not-granted", grantId: g("G6"), capability: "purchase" });
    expect(verdictOf("c8")).toEqual({ kind: "over-limit", grantId: g("G6"), requested: 50_000, headroom: 28_000 });
    expect(verdictOf("c9")).toEqual({ kind: "no-such-grant", grantId: g("g-ghost") });
  });

  it("a grant and a revoke carry no verdict, and a commit always does", () => {
    for (const step of CANON_SCRIPT) {
      const outcome = attemptOf(step.key).outcome;
      if (outcome.kind !== "admitted") continue;
      expect(outcome.verdict === null, step.key).toBe(step.input.kind !== "commit");
    }
  });
});

describe("the fifteen refusals, each at the point plan section 7 places it, each with the engine's own words", () => {
  const REFUSED: readonly (readonly [string, Rejection])[] = [
    ["widen-scope", { kind: "capability-widening", capability: "hire" }],
    ["over-delegate", { kind: "over-allocation", grantId: g("G2"), requested: 200_000, headroom: 50_000 }],
    ["delegate-past-depth", { kind: "depth-exhausted", parent: g("G4") }],
    ["mint-root", { kind: "not-a-root", grantor: p("intern") }],
    ["delegate-borrowed", { kind: "grantor-not-holder", parent: g("G2"), grantor: p("buyer-b"), holder: p("ops") }],
    ["keep-depth", { kind: "depth-not-narrowed", parentDepth: 3, requested: 3 }],
    ["delegate-upward", { kind: "principal-cycle", principal: p("cfo") }],
    ["orphan-grant", { kind: "unknown-parent", parent: g("g-nowhere") }],
    ["reuse-grant-id", { kind: "duplicate-id", id: "G3" }],
    ["revoke-own-grant", { kind: "revoker-not-authorised", grantId: g("G5"), by: p("buyer-a") }],
    ["revoke-ghost", { kind: "unknown-grant", grantId: g("g-unknown") }],
    ["revoke-twice", { kind: "already-dead", grantId: g("G2") }],
    ["delegate-from-dead", { kind: "parent-dead", deadGrant: g("G2") }],
    ["negative-limit", { kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] }],
    ["launder-capability", { kind: "unknown-capability", capability: "launder" }],
  ];

  it.each(REFUSED)("%s", (key, rejection) => {
    expect(attemptOf(key).outcome).toEqual({ kind: "rejected", rejection });
  });

  it("these are the fifteen steps the script marks as refused, and the fifteen kinds of Rejection, one each", () => {
    expect(REFUSED.map((row) => row[0]).sort()).toEqual(
      CANON_SCRIPT.filter((step) => attemptOf(step.key).outcome.kind === "rejected")
        .map((step) => step.key)
        .sort(),
    );
    expect(new Set(REFUSED.map((row) => row[1].kind)).size).toBe(15);
  });
});

describe("the numbers of plan section 7, computed by the engine from the log this domain's script produced", () => {
  const folded = (seq: number) => {
    const result = fold(CHARTER, REPLAY.log.slice(0, seq));
    if (!result.ok) throw new Error(`fold ${seq}`);
    return result.folded;
  };

  it("after seq 10 the headroom is G1 500 000, G2 50 000, G4 70 000, G6 28 000", () => {
    const f = folded(10);
    expect(["G1", "G2", "G4", "G6"].map((id) => headroomOf(f.tree, f.charges, g(id)))).toEqual([500_000, 50_000, 70_000, 28_000]);
  });

  it("the revoke absorbs 220 000 (80 000 + 50 000 + 90 000), returns 180 000 of G2's 400 000, and lifts G1's headroom from 500 000 to 680 000", () => {
    const before = folded(10);
    const after = folded(11);
    const absorbed = absorbedBy(after.tree, after.charges, g("G2"));
    expect(absorbed).toBe(220_000);
    expect(400_000 - (absorbed ?? 0)).toBe(180_000);
    expect([headroomOf(before.tree, before.charges, g("G1")), headroomOf(after.tree, after.charges, g("G1"))]).toEqual([500_000, 680_000]);
  });

  it("the revoke is what puts G2 into the tree's revokedAt at seq 11; at seq 10 it is not there", () => {
    expect(folded(11).tree.revokedAt.get(g("G2"))).toBe(11);
    expect(folded(10).tree.revokedAt.get(g("G2"))).toBeUndefined();
  });
});

describe("the standings of plan section 7, and the scrub", () => {
  const list = (log: Log<CompanyCapability>): readonly Standing[] => {
    const result = standings(CHARTER, log);
    if (!result.ok) throw new Error("standings");
    return result.standings;
  };
  const kinds = (log: Log<CompanyCapability>): string[] => list(log).map((standing) => `${standing.commitId}:${standing.kind}`);

  it("at seq 10 c1 c2 c3 c4 are all binding", () => {
    expect(kinds(REPLAY.log.slice(0, 10))).toEqual(["c1:binding", "c2:binding", "c3:binding", "c4:binding"]);
  });

  it("at seq 11 c1, c2 and c4 are inherited, severed at G2 at seq 11, heir cfo, chargedTo G1; c3 stays binding", () => {
    const after = list(REPLAY.log.slice(0, 11));
    expect(after.map((standing) => `${standing.commitId}:${standing.kind}`)).toEqual(["c1:inherited", "c2:inherited", "c3:binding", "c4:inherited"]);
    for (const standing of after) {
      if (standing.kind !== "inherited") continue;
      expect([standing.severed, standing.heir, standing.chargedTo], standing.commitId).toEqual([{ grantId: g("G2"), atSeq: 11 }, p("cfo"), g("G1")]);
    }
  });

  it("at seq 18 c1 c2 c4 are inherited, c3 and c10 binding, c5 to c9 void", () => {
    expect(kinds(REPLAY.log)).toEqual(["c1:inherited", "c2:inherited", "c3:binding", "c4:inherited", "c5:void", "c6:void", "c7:void", "c8:void", "c9:void", "c10:binding"]);
  });

  it("scrubbing from seq 18 back to seq 10 gives the standings the log that stopped at seq 10 gave: revocation did not rewrite the past", () => {
    const stopped = logOf(CHARTER, CANON_ALL.slice(0, 10));
    expect(JSON.stringify(list(REPLAY.log.slice(0, 10)))).toBe(JSON.stringify(list(stopped)));
  });

  it("all three standings and all five breaches occur in this one incident, and all fifteen rejections in its attempts", () => {
    const final = list(REPLAY.log);
    expect(new Set(final.map((standing) => standing.kind))).toEqual(new Set(["binding", "inherited", "void"]));
    expect(new Set(final.flatMap((standing) => (standing.kind === "void" ? [standing.breach.kind] : [])))).toEqual(
      new Set(["no-such-grant", "wrong-actor", "link-dead", "capability-not-granted", "over-limit"]),
    );
    const refused = new Set(REPLAY.attempts.flatMap((attempt) => (attempt.outcome.kind === "rejected" ? [attempt.outcome.rejection.kind] : [])));
    expect(refused.size).toBe(15);
  });
});
