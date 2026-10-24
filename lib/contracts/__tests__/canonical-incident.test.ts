import { describe, expect, it } from "vitest";
import { commitId, grantId, principalId } from "../ids.js";
import type { Breach, Charter, Commitment, GrantId, Grant, Log, NonEmptyReadonlyArray, PrincipalId, Rejection, Standing } from "../index.js";
import { assertStandingWellFormed } from "../index.js";

/**
 * A TYPE-EXPRESSIBILITY check, not the demo script: can the contract types express every value in
 * `.genesis/PLAN.md` §7, the canonical incident? It is the plan's own §8.A "type trace" re-run against the
 * real types instead of a scratch copy. If a §7 value could not be typed, that would be a plan defect.
 *
 * What it does NOT show: that an engine would compute these standings. The numbers are copied from §7, which
 * says they were executed on a throwaway model; no engine exists. `CANON_SCRIPT` is M6's, and nothing here is
 * imported by it.
 */
type Cap = "purchase" | "refund" | "hire" | "sign-contract";

const dana = principalId("dana");
const cfo = principalId("cfo");
const ops = principalId("ops");
const support = principalId("support");
const buyerA = principalId("buyer-a");
const buyerB = principalId("buyer-b");
const refunder = principalId("refunder");
const G1 = grantId("G1");
const G2 = grantId("G2");
const G3 = grantId("G3");
const G4 = grantId("G4");
const G5 = grantId("G5");
const G6 = grantId("G6");
const G7 = grantId("G7");

const charter: Charter<Cap> = { roots: [dana], capabilities: ["purchase", "refund", "hire", "sign-contract"] };

const grant = (id: GrantId, parent: GrantId | null, grantor: PrincipalId, grantee: PrincipalId, capabilities: Grant<Cap>["capabilities"], limit: number, depth: number): Grant<Cap> =>
  ({ id, parent, grantor, grantee, capabilities, limit, depth });
const g1 = grant(G1, null, dana, cfo, ["purchase", "refund", "hire", "sign-contract"], 1_000_000, 4);
const g2 = grant(G2, G1, cfo, ops, ["purchase", "sign-contract"], 400_000, 3);
const g3 = grant(G3, G1, cfo, support, ["refund"], 100_000, 2);
const g4 = grant(G4, G2, ops, buyerA, ["purchase"], 120_000, 0);
const g5 = grant(G5, G2, ops, buyerB, ["purchase"], 150_000, 0);
const g6 = grant(G6, G3, support, refunder, ["refund"], 40_000, 0);
const g7 = grant(G7, G1, cfo, buyerA, ["purchase"], 60_000, 0);

const commit = (id: string, actor: PrincipalId, actedUnder: GrantId, capability: Cap, amount: number): Commitment<Cap> =>
  ({ id: commitId(id), actor, actedUnder, capability, amount });
const c1 = commit("c1", buyerA, G4, "purchase", 50_000);
const c2 = commit("c2", buyerB, G5, "purchase", 90_000);
const c3 = commit("c3", refunder, G6, "refund", 12_000);
const c4 = commit("c4", ops, G2, "sign-contract", 80_000);
const c5 = commit("c5", buyerA, G4, "purchase", 10_000);
const c6 = commit("c6", buyerB, G4, "purchase", 5_000);
const c7 = commit("c7", refunder, G6, "purchase", 3_000);
const c8 = commit("c8", refunder, G6, "refund", 50_000);
const c9 = commit("c9", buyerA, grantId("g-ghost"), "purchase", 1_000);
const c10 = commit("c10", buyerA, G7, "purchase", 10_000);

/** The 18 admitted events of §7, seq 1 to 18; rejected attempts consume no seq. */
const log: Log<Cap> = [
  { seq: 1, kind: "grant", grant: g1 },
  { seq: 2, kind: "grant", grant: g2 },
  { seq: 3, kind: "grant", grant: g3 },
  { seq: 4, kind: "grant", grant: g4 },
  { seq: 5, kind: "grant", grant: g5 },
  { seq: 6, kind: "grant", grant: g6 },
  { seq: 7, kind: "commit", commit: c1 },
  { seq: 8, kind: "commit", commit: c2 },
  { seq: 9, kind: "commit", commit: c3 },
  { seq: 10, kind: "commit", commit: c4 },
  { seq: 11, kind: "revoke", grantId: G2, by: cfo },
  { seq: 12, kind: "commit", commit: c5 },
  { seq: 13, kind: "commit", commit: c6 },
  { seq: 14, kind: "commit", commit: c7 },
  { seq: 15, kind: "commit", commit: c8 },
  { seq: 16, kind: "commit", commit: c9 },
  { seq: 17, kind: "grant", grant: g7 },
  { seq: 18, kind: "commit", commit: c10 },
];

/** The fifteen attempted rejections of §7, one of each `Rejection` kind. */
const rejections: Rejection[] = [
  { kind: "capability-widening", capability: "hire" },
  { kind: "over-allocation", grantId: G2, requested: 200_000, headroom: 50_000 },
  { kind: "depth-exhausted", parent: G4 },
  { kind: "not-a-root", grantor: principalId("intern") },
  { kind: "grantor-not-holder", parent: G2, grantor: buyerB, holder: ops },
  { kind: "depth-not-narrowed", parentDepth: 3, requested: 3 },
  { kind: "principal-cycle", principal: cfo },
  { kind: "unknown-parent", parent: grantId("g-ghost") },
  { kind: "duplicate-id", id: "G3" },
  { kind: "revoker-not-authorised", grantId: G5, by: buyerA },
  { kind: "unknown-grant", grantId: grantId("g-ghost") },
  { kind: "already-dead", grantId: G2 },
  { kind: "parent-dead", deadGrant: G2 },
  { kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] },
  { kind: "unknown-capability", capability: "launder" },
];

/** The final standings of §7: c1 c2 c4 inherited by cfo, c3 and c10 binding, c5 to c9 void. */
const inherited = (c: Commitment<Cap>, at: number, chain: NonEmptyReadonlyArray<GrantId>, trail: NonEmptyReadonlyArray<PrincipalId>): Standing => ({
  kind: "inherited",
  commitId: c.id,
  committedAt: at,
  warrant: { chain, trail },
  severed: { grantId: G2, atSeq: 11 },
  heir: cfo,
  chargedTo: G1,
});
const standings: Standing[] = [
  inherited(c1, 7, [G1, G2, G4], [dana, cfo, ops, buyerA]),
  inherited(c2, 8, [G1, G2, G5], [dana, cfo, ops, buyerB]),
  { kind: "binding", commitId: c3.id, committedAt: 9, warrant: { chain: [G1, G3, G6], trail: [dana, cfo, support, refunder] } },
  inherited(c4, 10, [G1, G2], [dana, cfo, ops]),
  { kind: "void", commitId: c5.id, committedAt: 12, breach: { kind: "link-dead", grantId: G2, atSeq: 11 } },
  { kind: "void", commitId: c6.id, committedAt: 13, breach: { kind: "wrong-actor", grantId: G4, holder: buyerA } },
  { kind: "void", commitId: c7.id, committedAt: 14, breach: { kind: "capability-not-granted", grantId: G6, capability: "purchase" } },
  { kind: "void", commitId: c8.id, committedAt: 15, breach: { kind: "over-limit", grantId: G6, requested: 50_000, headroom: 28_000 } },
  { kind: "void", commitId: c9.id, committedAt: 16, breach: { kind: "no-such-grant", grantId: grantId("g-ghost") } },
  { kind: "binding", commitId: c10.id, committedAt: 18, warrant: { chain: [G1, G7], trail: [dana, cfo, buyerA] } },
];

describe("plan §7's canonical incident is expressible in the contract types", () => {
  it("the log has 18 admitted events with seq 1 to 18, one of each kind in the order §7 gives", () => {
    expect(log).toHaveLength(18);
    expect(log.map((e) => e.seq)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(log.map((e) => e.kind[0]).join("")).toBe("gggggg" + "cccc" + "r" + "ccccc" + "g" + "c");
    expect(charter.roots).toEqual([dana]);
  });

  it("the fifteen attempted rejections are fifteen DIFFERENT Rejection kinds", () => {
    expect(new Set(rejections.map((r) => r.kind)).size).toBe(15);
  });

  it("the final standings use all three Standing kinds and all five Breach kinds", () => {
    expect(new Set(standings.map((s) => s.kind))).toEqual(new Set(["binding", "inherited", "void"]));
    const breaches: Breach[] = standings.flatMap((s) => (s.kind === "void" ? [s.breach] : []));
    expect(new Set(breaches.map((b) => b.kind)).size).toBe(5);
  });

  it("each final standing is accepted by the run-time guard, and the inherited ones name heir cfo, severed G2@11, chargedTo G1", () => {
    for (const standing of standings) expect(assertStandingWellFormed(standing), standing.commitId).toEqual({ ok: true });
    const inheritedOnes = standings.filter((s) => s.kind === "inherited");
    expect(inheritedOnes.map((s) => s.commitId)).toEqual(["c1", "c2", "c4"]);
    for (const s of inheritedOnes) {
      expect(s).toMatchObject({ heir: cfo, severed: { grantId: G2, atSeq: 11 }, chargedTo: G1 });
    }
  });
});
