import { describe, expect, it } from "vitest";
import { absorbedBy, headroomOf } from "../../allowance/index.js";
import type { Breach, EventInput, Log, Rejection, Standing } from "../../contracts/index.js";
import { append, standings } from "../index.js";
import {
  CANON_AFTER,
  CANON_ALL,
  CANON_COMMITS,
  CANON_GRANTS,
  CANON_REVOKE,
  CHARTER,
  cid,
  g,
  grantEvent,
  mustFold,
  p,
  revokeEvent,
} from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * THE CANONICAL INCIDENT, replayed through the real engine (plan §7: "numbers verified by execution of the throwaway model").
 *
 * `lib/contracts/__tests__/canonical-incident.test.ts` (M1) wrote every value of §7 as a value of the real TYPES, and says of
 * itself that it is not evidence about behaviour: no engine existed to compute the numbers. This file is the other half. The
 * eighteen admitted events of §7 are offered to the real `append` one at a time; the fifteen rejections of its beat 1 and its
 * intake lines are offered at the points §7 places them; and these numbers and standings are asserted
 * against what the engine computed: the headroom of G1, G2, G4 and G6 after seq 10, absorbed 220 000 and returned 180 000 at the
 * revoke, G1's headroom from 500 000 to 680 000, the verdicts of c1 to c10, the three standings at seq 10 and after, and the
 * scrub back to seq 10. §7's numbers are the plan's; where this file agrees with them, it is the engine that computed them.
 *
 * Then two things §7 describes in words and does not table: that dana revoking G2 instead of cfo changes nothing (failure case
 * 11), and that cutting G1 later moves every heir up to dana, with `chargedTo` null.
 */

interface Step {
  readonly seq: number;
  readonly log: Log<Cap>;
}

/** Offer `events` to append one at a time, expecting every one to be admitted; return the log after each, by seq. */
function admitAll(events: readonly EventInput<Cap>[]): { readonly steps: Step[]; readonly log: Log<Cap>; readonly verdicts: Map<string, string> } {
  let log: Log<Cap> = [];
  const steps: Step[] = [];
  const verdicts = new Map<string, string>();
  for (const event of events) {
    const result = append(CHARTER, log, event);
    if (!result.ok) throw new Error(`§7 event ${steps.length + 1} was refused: ${JSON.stringify(result.failure)}`);
    log = result.log;
    steps.push({ seq: result.event.seq, log });
    if (event.kind === "commit") verdicts.set(event.commit.id, JSON.stringify(result.verdict));
  }
  return { steps, log, verdicts };
}

const SCRIPT = admitAll(CANON_ALL);
const at = (seq: number): Log<Cap> => {
  const step = SCRIPT.steps[seq - 1];
  if (step === undefined) throw new Error(`no step ${seq}`);
  return step.log;
};
const standingsAt = (seq: number): readonly Standing[] => {
  const result = standings(CHARTER, at(seq));
  if (!result.ok) throw new Error("standings");
  return result.standings;
};
const kinds = (list: readonly Standing[]): string[] => list.map((standing) => `${standing.commitId}:${standing.kind}`);

const refusal = (log: Log<Cap>, input: unknown): Rejection => {
  const result = append(CHARTER, log, input as EventInput<Cap>);
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.event)}`);
  if (result.failure.kind !== "rejected") throw new Error(`expected a rejection, got ${JSON.stringify(result.failure)}`);
  return result.failure.rejection;
};

describe("the eighteen admitted events of plan section 7, offered to append one at a time", () => {
  it("every one is admitted, at seq 1 to 18 in order", () => {
    expect(SCRIPT.steps.map((step) => step.seq)).toStrictEqual(Array.from({ length: 18 }, (_, index) => index + 1));
    expect(CANON_GRANTS).toHaveLength(6);
    expect(CANON_COMMITS).toHaveLength(4);
    expect(CANON_AFTER).toHaveLength(7);
    expect(CANON_REVOKE.kind).toBe("revoke");
  });

  it("c1 to c4 are warranted at seq 7 to 10 and c10 at seq 18; c5 to c9 are void with one of each of the five breaches, at seq 12 to 16", () => {
    const verdict = (id: string): { kind: string; breach?: Breach } => JSON.parse(SCRIPT.verdicts.get(id) ?? "null");
    for (const id of ["c1", "c2", "c3", "c4", "c10"]) expect(verdict(id).kind, id).toBe("warranted");
    expect(verdict("c5").breach).toStrictEqual({ kind: "link-dead", grantId: "G2", atSeq: 11 });
    expect(verdict("c6").breach).toStrictEqual({ kind: "wrong-actor", grantId: "G4", holder: "buyer-a" });
    expect(verdict("c7").breach).toStrictEqual({ kind: "capability-not-granted", grantId: "G6", capability: "purchase" });
    expect(verdict("c8").breach).toStrictEqual({ kind: "over-limit", grantId: "G6", requested: 50_000, headroom: 28_000 });
    expect(verdict("c9").breach).toStrictEqual({ kind: "no-such-grant", grantId: "g-ghost" });
    const folded = mustFold(CHARTER, SCRIPT.log);
    for (const [id, seq] of [["c5", 12], ["c6", 13], ["c7", 14], ["c8", 15], ["c9", 16], ["c10", 18]] as const) expect(folded.commits.get(cid(id))?.seq, id).toBe(seq);
  });

  it("after seq 10 the headroom is G1 500 000, G2 50 000, G4 70 000, G6 28 000", () => {
    const folded = mustFold(CHARTER, at(10));
    const room = (id: string): number | undefined => headroomOf(folded.tree, folded.charges, g(id));
    expect([room("G1"), room("G2"), room("G4"), room("G6")]).toStrictEqual([500_000, 50_000, 70_000, 28_000]);
  });

  it("the revoke at seq 11 absorbs 220 000 (80 000 + 50 000 + 90 000), returns 180 000, and lifts G1's headroom from 500 000 to 680 000", () => {
    const before = mustFold(CHARTER, at(10));
    const after = mustFold(CHARTER, at(11));
    expect(after.tree.revokedAt.get(g("G2"))).toBe(11);
    expect(absorbedBy(after.tree, after.charges, g("G2"))).toBe(220_000);
    expect(400_000 - (absorbedBy(after.tree, after.charges, g("G2")) ?? 0)).toBe(180_000);
    expect(headroomOf(before.tree, before.charges, g("G1"))).toBe(500_000);
    expect(headroomOf(after.tree, after.charges, g("G1"))).toBe(680_000);
  });
});

describe("the fifteen rejections of plan section 7, each at the point the table places it", () => {
  const BEFORE_REVOKE = (): Log<Cap> => at(10);
  const AFTER_REVOKE = (): Log<Cap> => at(11);

  const beat1: readonly [string, unknown, Rejection][] = [
    ["widen scope: hire under G2", grantEvent({ id: "Gw", parent: "G2", grantor: "ops", grantee: "w1", capabilities: ["hire"], limit: 1, depth: 2 }), { kind: "capability-widening", capability: "hire" }],
    ["over-delegate 200 000 against a headroom of 50 000", grantEvent({ id: "Go", parent: "G2", grantor: "ops", grantee: "o1", capabilities: ["purchase"], limit: 200_000, depth: 2 }), { kind: "over-allocation", grantId: g("G2"), requested: 200_000, headroom: 50_000 }],
    ["buyer-a (depth 0) delegates", grantEvent({ id: "Gd", parent: "G4", grantor: "buyer-a", grantee: "d1", capabilities: ["purchase"], limit: 1, depth: 0 }), { kind: "depth-exhausted", parent: g("G4") }],
    ["intern mints a root", grantEvent({ id: "Gr", grantor: "intern", grantee: "r1", capabilities: ["purchase"], limit: 1, depth: 0 }), { kind: "not-a-root", grantor: p("intern") }],
    ["buyer-b delegates under ops' G2", grantEvent({ id: "Gh", parent: "G2", grantor: "buyer-b", grantee: "h1", capabilities: ["purchase"], limit: 1, depth: 2 }), { kind: "grantor-not-holder", parent: g("G2"), grantor: p("buyer-b"), holder: p("ops") }],
    ["a child of depth 3 under a depth-3 parent", grantEvent({ id: "Gn", parent: "G2", grantor: "ops", grantee: "n1", capabilities: ["purchase"], limit: 1, depth: 3 }), { kind: "depth-not-narrowed", parentDepth: 3, requested: 3 }],
    ["cfo as grantee under G2", grantEvent({ id: "Gc", parent: "G2", grantor: "ops", grantee: "cfo", capabilities: ["purchase"], limit: 1, depth: 2 }), { kind: "principal-cycle", principal: p("cfo") }],
    ["an unknown parent", grantEvent({ id: "Gu", parent: "g-nowhere", grantor: "ops", grantee: "u1", capabilities: ["purchase"], limit: 1, depth: 2 }), { kind: "unknown-parent", parent: g("g-nowhere") }],
    ["a duplicate id, G3", grantEvent({ id: "G3", parent: "G1", grantor: "cfo", grantee: "x1", capabilities: ["refund"], limit: 1, depth: 1 }), { kind: "duplicate-id", id: "G3" }],
    ["buyer-a revokes G5", revokeEvent("G5", "buyer-a"), { kind: "revoker-not-authorised", grantId: g("G5"), by: p("buyer-a") }],
    ["revoking a grant that does not exist", revokeEvent("g-unknown", "cfo"), { kind: "unknown-grant", grantId: g("g-unknown") }],
  ];

  it.each(beat1.map((row) => [row[0], row] as const))("beat 1, before the revoke: %s", (_name, row) => {
    expect(refusal(BEFORE_REVOKE(), row[1])).toStrictEqual(row[2]);
  });

  it("after the revoke: cfo revokes G2 again (already-dead), and ops grants under the dead G2 with limit 0 (parent-dead, which a positive limit would have hidden as over-allocation)", () => {
    expect(refusal(AFTER_REVOKE(), revokeEvent("G2", "cfo"))).toStrictEqual({ kind: "already-dead", grantId: g("G2") });
    const underDead = (limit: number): EventInput<Cap> => grantEvent({ id: "Gz", parent: "G2", grantor: "ops", grantee: "z1", capabilities: ["purchase"], limit, depth: 2 });
    expect(refusal(AFTER_REVOKE(), underDead(0))).toStrictEqual({ kind: "parent-dead", deadGrant: g("G2") });
    // The plan's point about the limit: with a positive limit the order of the rules still reports parent-dead.
    expect(refusal(AFTER_REVOKE(), underDead(5_000))).toStrictEqual({ kind: "parent-dead", deadGrant: g("G2") });
  });

  it("the two intake lines: a grant with limit -1, and a grant naming the capability launder", () => {
    const base = { id: "Gi", parent: "G1", grantor: "cfo", grantee: "i1", capabilities: ["purchase"], limit: 1, depth: 1 };
    expect(refusal(at(18), { kind: "grant", grant: { ...base, limit: -1 } })).toStrictEqual({ kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] });
    expect(refusal(at(18), { kind: "grant", grant: { ...base, capabilities: ["launder"] } })).toStrictEqual({ kind: "unknown-capability", capability: "launder" });
  });

  it("together they are all fifteen kinds of Rejection, one or more of each", () => {
    const seen = new Set<string>(beat1.map((row) => row[2].kind));
    for (const kind of ["already-dead", "parent-dead", "invalid-event-shape", "unknown-capability"]) seen.add(kind);
    expect([...seen].sort()).toStrictEqual(
      [
        "already-dead",
        "capability-widening",
        "depth-exhausted",
        "depth-not-narrowed",
        "duplicate-id",
        "grantor-not-holder",
        "invalid-event-shape",
        "not-a-root",
        "over-allocation",
        "parent-dead",
        "principal-cycle",
        "revoker-not-authorised",
        "unknown-capability",
        "unknown-grant",
        "unknown-parent",
      ].sort(),
    );
  });
});

describe("the standings of plan section 7, and the scrub", () => {
  it("at seq 10 c1 c2 c3 c4 are all binding: revocation has not happened yet", () => {
    expect(kinds(standingsAt(10))).toStrictEqual(["c1:binding", "c2:binding", "c3:binding", "c4:binding"]);
  });

  it("at seq 11 c1, c2 and c4 are inherited, severed at G2 at seq 11, heir cfo, chargedTo G1; c3 stays binding", () => {
    const list = standingsAt(11);
    expect(kinds(list)).toStrictEqual(["c1:inherited", "c2:inherited", "c3:binding", "c4:inherited"]);
    for (const standing of list) {
      if (standing.kind !== "inherited") continue;
      expect([standing.severed, standing.heir, standing.chargedTo], standing.commitId).toStrictEqual([{ grantId: g("G2"), atSeq: 11 }, p("cfo"), g("G1")]);
    }
  });

  it("the final standings: c1 c2 c4 inherited by cfo, c3 and c10 binding, c5 to c9 void", () => {
    expect(kinds(standingsAt(18))).toStrictEqual([
      "c1:inherited",
      "c2:inherited",
      "c3:binding",
      "c4:inherited",
      "c5:void",
      "c6:void",
      "c7:void",
      "c8:void",
      "c9:void",
      "c10:binding",
    ]);
  });

  it("scrubbing back from seq 18 to seq 10 gives the same standings as the log that stopped at seq 10 (revocation did not rewrite the past)", () => {
    const scrubbed = standings(CHARTER, SCRIPT.log.slice(0, 10));
    expect(scrubbed.ok && kinds(scrubbed.standings)).toStrictEqual(["c1:binding", "c2:binding", "c3:binding", "c4:binding"]);
    expect(scrubbed.ok && JSON.stringify(scrubbed.standings)).toBe(JSON.stringify(standingsAt(10)));
  });

  it("all three standings and all five breaches occur in this one incident", () => {
    const final = standingsAt(18);
    expect(new Set(final.map((standing) => standing.kind))).toStrictEqual(new Set(["binding", "inherited", "void"]));
    const breaches = new Set(final.flatMap((standing) => (standing.kind === "void" ? [standing.breach.kind] : [])));
    expect([...breaches].sort()).toStrictEqual(["capability-not-granted", "link-dead", "no-such-grant", "over-limit", "wrong-actor"]);
  });
});

describe("two things the plan describes in words", () => {
  it("failure case 11: dana revoking G2 gives the same standings as cfo revoking it, and the heir is still cfo", () => {
    const withDana = admitAll([...CANON_GRANTS, ...CANON_COMMITS, revokeEvent("G2", "dana")]).log;
    const withCfo = admitAll([...CANON_GRANTS, ...CANON_COMMITS, revokeEvent("G2", "cfo")]).log;
    const a = standings(CHARTER, withDana);
    const b = standings(CHARTER, withCfo);
    expect(a.ok && b.ok && JSON.stringify(a.standings)).toBe(b.ok ? JSON.stringify(b.standings) : undefined);
    const heirs = a.ok ? a.standings.flatMap((standing) => (standing.kind === "inherited" ? [standing.heir] : [])) : [];
    expect(heirs).toStrictEqual(["cfo", "cfo", "cfo"]);
  });

  it("cutting G1 later, at seq 19, moves every heir up to dana with chargedTo null, and c3 and c10 become inherited too; the voids do not move", () => {
    const { log } = admitAll([...CANON_ALL, revokeEvent("G1", "dana")]);
    const list = standings(CHARTER, log);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const byId = new Map(list.standings.map((standing) => [standing.commitId, standing]));
    for (const id of ["c1", "c2", "c3", "c4", "c10"]) {
      const standing = byId.get(cid(id));
      expect(standing?.kind, id).toBe("inherited");
      if (standing?.kind !== "inherited") continue;
      expect([standing.severed, standing.heir, standing.chargedTo], id).toStrictEqual([{ grantId: g("G1"), atSeq: 19 }, p("dana"), null]);
    }
    const before = standingsAt(18);
    for (const id of ["c5", "c6", "c7", "c8", "c9"]) {
      expect(JSON.stringify(byId.get(cid(id))), id).toBe(JSON.stringify(before.find((standing) => standing.commitId === cid(id))));
    }
  });
});
