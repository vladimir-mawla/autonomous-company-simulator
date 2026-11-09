import { describe, expect, it } from "vitest";
import { grantId } from "../../lib/contracts/index.js";
import { append } from "../../lib/standing/index.js";
import { replayScript } from "../../domains/company/index.js";
import { CHARTER, askCommit, build, commitEv, grantEv, revokeEv, standingFor } from "./helpers.js";
import type { CompanyLog } from "./helpers.js";

/**
 * KIND: HONEST PARTIAL PIN (plan section 11, case 02).
 * TRACES TO: D3 (the log is the only state; `seq` is arrival order, not occurrence order).
 *
 * THE LIMIT. A commit that was "initiated before" a revoke but reaches the engine after it is ruled
 * `void: link-dead`. The engine has no `initiatedAt`, no clock and no way to be told when something happened: a
 * commit's place in the order is the place at which it was appended, and that is the only time there is.
 *
 * WHY IT IS A PARTIAL PIN. The engine is a function of a log and cannot interleave anything: it cannot be shown to
 * order two concurrent submissions correctly, because it never sees two at once. What this file fixes is the order
 * itself, and it does so by what comes out on both sides of the boundary, not by the absence of a field: on the
 * plan's canonical log, `c4` at seq 10 is `binding` and, once the revoke at seq 11 has arrived, `inherited`; `c5` at seq 12 is
 * `void: link-dead { G2, atSeq 11 }`; the same commit offered at seq 11 instead (before the revoke) is warranted; and a commit
 * that carries an `initiatedAt` from before the revoke, or a `seq` of 10, is ruled exactly as the commit without them.
 *
 * WHAT WOULD MAKE THIS FAIL: the engine reading a time or a seq from the caller; a `link-dead` check that is skipped, or
 * evaluated against a different moment than the commit's own place in the log.
 */

const full = replayScript().log;
const upTo = (seq: number): CompanyLog => full.slice(0, seq);

describe("02 arrival is order: the canonical incident (plan section 7), both sides of the revoke at seq 11", () => {
  it("the log has c4 at seq 10, the revoke of G2 at seq 11 and c5 at seq 12", () => {
    const [c4, revoke, c5] = [full[9], full[10], full[11]];
    expect(c4).toMatchObject({ seq: 10, kind: "commit", commit: { id: "c4" } });
    expect(revoke).toMatchObject({ seq: 11, kind: "revoke", grantId: "G2", by: "cfo" });
    expect(c5).toMatchObject({ seq: 12, kind: "commit", commit: { id: "c5" } });
  });

  it("c4, which arrived at seq 10, is binding at seq 10 and inherited by cfo once seq 11 has arrived: the same act, a later chain", () => {
    const before = standingFor(upTo(10), "c4");
    const after = standingFor(upTo(11), "c4");
    expect(before.kind).toBe("binding");
    expect(standingFor(full, "c4").kind).toBe("inherited"); // the full log, as the plan reads it
    expect(after).toMatchObject({
      kind: "inherited",
      committedAt: 10,
      severed: { grantId: "G2", atSeq: 11 },
      heir: "cfo",
      chargedTo: "G1",
    });
    // The verdict was fixed at seq 10: the warrant did not change, only the standing derived from it did.
    if (before.kind !== "binding" || after.kind !== "inherited") throw new Error("unreachable");
    expect(after.warrant).toEqual(before.warrant);
  });

  it("c5, which arrived at seq 12, is void: link-dead { G2, atSeq 11 }", () => {
    expect(standingFor(full, "c5")).toEqual({
      commitId: "c5",
      committedAt: 12,
      kind: "void",
      breach: { kind: "link-dead", grantId: grantId("G2"), atSeq: 11 },
    });
  });

  it("the same commit offered one place earlier is warranted, and one place later is link-dead: the boundary is the revoke's seq, N and N+1", () => {
    const c5 = full[11];
    if (c5 === undefined || c5.kind !== "commit") throw new Error("unreachable");
    const { id, actor, actedUnder, capability, amount } = c5.commit;
    const ask = (log: CompanyLog) => askCommit(log, id, actor, actedUnder, capability, amount);

    const beforeTheRevoke = ask(upTo(10)); // it would arrive at seq 11
    expect(beforeTheRevoke.ok && beforeTheRevoke.verdict.kind).toBe("warranted");
    const afterTheRevoke = ask(upTo(11)); // it arrives at seq 12
    expect(afterTheRevoke).toEqual({
      ok: true,
      verdict: { kind: "breached", breach: { kind: "link-dead", grantId: grantId("G2"), atSeq: 11 } },
    });
  });
});

describe("02 arrival is order: swapping two events changes the rulings, and nothing the caller adds moves a commit", () => {
  const base = build([
    grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 1000, depth: 2 }),
    grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 500, depth: 0 }),
  ]);

  it("[commit, revoke] leaves the commit inherited (severed at seq 4); [revoke, commit] makes the same commit void: link-dead { G2, atSeq 3 }", () => {
    const commitFirst = build([commitEv("k", "ops", "G2", "purchase", 100), revokeEv("G2", "cfo")], base);
    expect(standingFor(commitFirst, "k")).toMatchObject({ kind: "inherited", committedAt: 3, severed: { grantId: "G2", atSeq: 4 }, heir: "cfo" });

    const revokeFirst = build([revokeEv("G2", "cfo"), commitEv("k", "ops", "G2", "purchase", 100)], base);
    expect(standingFor(revokeFirst, "k")).toEqual({
      commitId: "k",
      committedAt: 4,
      kind: "void",
      breach: { kind: "link-dead", grantId: grantId("G2"), atSeq: 3 },
    });
  });

  it("an `initiatedAt` before the revoke, and a `seq` of 3, on a commit that arrives after it: the same void, the same event, no such field logged", () => {
    const revoked = build([revokeEv("G2", "cfo")], base); // revoke at seq 3
    const plain = commitEv("k", "ops", "G2", "purchase", 100);
    if (plain.kind !== "commit") throw new Error("unreachable");
    // Built outside the typed constructor on purpose: the point is what the engine does with fields it does not know.
    const claiming = { kind: "commit", seq: 3, initiatedAt: 1, commit: { ...plain.commit, initiatedAt: 1, seq: 3 } };

    const a = append(CHARTER, revoked, plain);
    const b = append(CHARTER, revoked, claiming as never);
    if (!a.ok || !b.ok) throw new Error("both are recorded: a commit is a fact");

    const expected = { kind: "breached", breach: { kind: "link-dead", grantId: grantId("G2"), atSeq: 3 } };
    expect(a.verdict).toEqual(expected);
    expect(b.verdict).toEqual(expected);
    expect(b.event).toEqual(a.event);
    expect(b.event.seq).toBe(4);
    expect(Object.keys(b.event).sort()).toEqual(["commit", "kind", "seq"]);
    expect(Object.keys((b.event as { commit: object }).commit).sort()).toEqual(["actedUnder", "actor", "amount", "capability", "id"]);
  });

  it("a hand-built log in which the seqs of the revoke and the commit are exchanged does not fold: seq must be the position (seq-mismatch)", () => {
    // The only way to "back-date" a commit is to write a different log, and a different log is refused, not reinterpreted.
    const log = build([revokeEv("G2", "cfo"), commitEv("k", "ops", "G2", "purchase", 100)], base);
    const moved = [log[0], log[1], { ...log[2], seq: 4 }, { ...log[3], seq: 3 }] as unknown as CompanyLog;
    const result = append(CHARTER, moved, commitEv("z", "ops", "G2", "purchase", 1));
    expect(result).toEqual({
      ok: false,
      failure: { kind: "faulty-log", fault: { kind: "seq-mismatch", index: 2, expected: 3, actual: 4 } },
    });
  });
});
