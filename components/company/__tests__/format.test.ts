import { describe, expect, it } from "vitest";
import { grantId as g, principalId as p } from "../../../lib/contracts/index.js";
import type { Breach, Rejection, Standing } from "../../../lib/contracts/index.js";
import { formatAmount, formatBreach } from "../format-breach.js";
import { formatRejection } from "../format-rejection.js";
import { commitLine, formatStanding, standingLine } from "../format-standing.js";
import { formatOffered, formatOutcome, formatTally } from "../format-attempt.js";
import type { AttemptOutcome } from "../compute-demo-view.js";
import { REPLAY, after } from "./support/states.js";

/**
 * The words the page uses for the engine's closed vocabularies, pinned exactly: all 5 `Breach` kinds, all 15 `Rejection` kinds and all 3 `Standing` kinds.
 *
 * The fixtures are typed `Record<Kind, ...>`, so a kind added to or removed from `lib/contracts` is a compile error here and the table
 * cannot go on pinning a stale list. Each sentence says only what its fields say; the expected strings are written out, not computed.
 */

const BREACHES: Readonly<Record<Breach["kind"], { readonly breach: Breach; readonly text: string }>> = {
  "no-such-grant": { breach: { kind: "no-such-grant", grantId: g("g-ghost") }, text: "the grant g-ghost does not exist, so there was nothing to act under" },
  "wrong-actor": { breach: { kind: "wrong-actor", grantId: g("G4"), holder: p("buyer-a") }, text: "the grant G4 was given to buyer-a, and someone else acted under it" },
  "link-dead": { breach: { kind: "link-dead", grantId: g("G2"), atSeq: 11 }, text: "a grant on the chain, G2, had been revoked at seq 11 before this act" },
  "capability-not-granted": { breach: { kind: "capability-not-granted", grantId: g("G6"), capability: "purchase" }, text: "the grant G6 does not carry the capability purchase" },
  "over-limit": { breach: { kind: "over-limit", grantId: g("G6"), requested: 50000, headroom: 28000 }, text: "50,000 was asked of G6, which had 28,000 left" },
};

const REJECTIONS: Readonly<Record<Rejection["kind"], { readonly rejection: Rejection; readonly text: string }>> = {
  "invalid-event-shape": { rejection: { kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] }, text: "the grant event is malformed in: limit" },
  "unknown-capability": { rejection: { kind: "unknown-capability", capability: "launder" }, text: '"launder" is not one of the company\'s capabilities' },
  "duplicate-id": { rejection: { kind: "duplicate-id", id: "G3" }, text: "the id G3 is already taken" },
  "not-a-root": { rejection: { kind: "not-a-root", grantor: p("intern") }, text: "intern is not a root of the charter, so it cannot start a grant with no parent" },
  "unknown-parent": { rejection: { kind: "unknown-parent", parent: g("g-nowhere") }, text: "the parent grant g-nowhere does not exist" },
  "parent-dead": { rejection: { kind: "parent-dead", deadGrant: g("G2") }, text: "the parent grant G2 has been revoked" },
  "grantor-not-holder": { rejection: { kind: "grantor-not-holder", parent: g("G2"), grantor: p("buyer-b"), holder: p("ops") }, text: "buyer-b does not hold G2; ops does" },
  "capability-widening": { rejection: { kind: "capability-widening", capability: "hire" }, text: "the parent grant does not carry the capability hire" },
  "depth-exhausted": { rejection: { kind: "depth-exhausted", parent: g("G4") }, text: "G4 has no depth left, so it cannot be delegated further" },
  "depth-not-narrowed": { rejection: { kind: "depth-not-narrowed", parentDepth: 3, requested: 3 }, text: "a grant of depth 3 under a parent of depth 3 does not narrow it" },
  "principal-cycle": { rejection: { kind: "principal-cycle", principal: p("cfo") }, text: "cfo is already on the chain above, so it cannot be granted authority again" },
  "over-allocation": { rejection: { kind: "over-allocation", grantId: g("G2"), requested: 200000, headroom: 50000 }, text: "200,000 was asked of G2, which has 50,000 left" },
  "unknown-grant": { rejection: { kind: "unknown-grant", grantId: g("g-unknown") }, text: "there is no grant g-unknown to revoke" },
  "already-dead": { rejection: { kind: "already-dead", grantId: g("G2") }, text: "G2 has already been revoked" },
  "revoker-not-authorised": { rejection: { kind: "revoker-not-authorised", grantId: g("G5"), by: p("buyer-a") }, text: "buyer-a is not allowed to revoke G5" },
};

describe("formatBreach: five kinds, one sentence each", () => {
  for (const [kind, { breach, text }] of Object.entries(BREACHES)) {
    it(`${kind}`, () => {
      expect(formatBreach(breach)).toEqual({ name: kind, text });
    });
  }
});

describe("formatRejection: fifteen kinds, one sentence each", () => {
  for (const [kind, { rejection, text }] of Object.entries(REJECTIONS)) {
    it(`${kind}`, () => {
      expect(formatRejection(rejection)).toEqual({ name: kind, text });
    });
  }

  it("an invalid-event-shape with several fields lists all of them", () => {
    expect(formatRejection({ kind: "invalid-event-shape", eventKind: "commit", fields: ["amount", "actor"] }).text).toBe("the commit event is malformed in: amount, actor");
  });
});

describe("a kind the compiler does not know is reported as unknown, never thrown", () => {
  it("breach, rejection and outcome", () => {
    const stray = { kind: "from-the-future" };
    expect(formatBreach(stray as never)).toEqual({ name: "unknown", text: 'a breach this page does not know: {"kind":"from-the-future"}' });
    expect(formatRejection(stray as never)).toEqual({ name: "unknown", text: 'a refusal this page does not know: {"kind":"from-the-future"}' });
    expect(formatOutcome(stray as never)).toEqual({ tone: "fault", headline: "unknown answer", text: '{"kind":"from-the-future"}' });
    expect(formatStanding(stray as never).answers).toBe("a standing this page does not know");
  });
});

describe("formatAmount groups thousands by hand (no locale, so server and browser agree)", () => {
  it("0, 999, 1 000, 28 000, 1 000 000 and a large number", () => {
    expect([0, 999, 1000, 28000, 1000000, 1234567890].map(formatAmount)).toEqual(["0", "999", "1,000", "28,000", "1,000,000", "1,234,567,890"]);
  });
});

describe("formatStanding and standingLine: the layout of scripts/demo-company.ts", () => {
  const chain = [g("G1"), g("G2"), g("G4")] as const;
  const trail = [p("dana"), p("cfo"), p("ops"), p("buyer-a")] as const;
  const binding: Standing = { kind: "binding", commitId: "c1" as never, committedAt: 7, warrant: { chain, trail } };
  const inherited: Standing = { kind: "inherited", commitId: "c1" as never, committedAt: 7, warrant: { chain, trail }, severed: { grantId: g("G2"), atSeq: 11 }, heir: p("cfo"), chargedTo: g("G1") };
  const rootHeir: Standing = { ...inherited, heir: p("dana"), chargedTo: null };
  const voided: Standing = { kind: "void", commitId: "c8" as never, committedAt: 15, breach: { kind: "over-limit", grantId: g("G6"), requested: 50000, headroom: 28000 } };

  it("binding: everyone on the trail answers", () => {
    expect(formatStanding(binding)).toEqual({
      kind: "binding",
      detail: "warrant chain G1>G2>G4  trail dana>cfo>ops>buyer-a",
      answers: "dana, cfo, ops, buyer-a answer for it",
    });
  });

  it("inherited: the heir answers, charged to the parent of the cut link", () => {
    expect(formatStanding(inherited)).toEqual({
      kind: "inherited",
      detail: "severed G2@11  heir cfo  chargedTo G1  chain G1>G2>G4",
      answers: "cfo answers for it, charged to G1",
    });
  });

  it("inherited by a charter root: chargedTo is null and the sentence says it is off the ledger", () => {
    expect(formatStanding(rootHeir)).toEqual({
      kind: "inherited",
      detail: "severed G2@11  heir dana  chargedTo null (heir is a charter root)  chain G1>G2>G4",
      answers: "dana answers for it, off the ledger",
    });
  });

  it("void: the actor alone answers, with the breach in words and its fields as the demo prints them", () => {
    expect(formatStanding(voided)).toEqual({
      kind: "void",
      detail: 'breach {"kind":"over-limit","grantId":"G6","requested":50000,"headroom":28000}',
      answers: "the actor alone answers: 50,000 was asked of G6, which had 28,000 left",
    });
  });

  it("standingLine is the demo's line: id padded to 4, seq padded to 2, kind padded to 9", () => {
    expect(standingLine(binding)).toBe("c1   at seq  7  binding   warrant chain G1>G2>G4  trail dana>cfo>ops>buyer-a");
    expect(standingLine(inherited)).toBe("c1   at seq  7  inherited severed G2@11  heir cfo  chargedTo G1  chain G1>G2>G4");
    expect(standingLine(voided)).toBe('c8   at seq 15  void      breach {"kind":"over-limit","grantId":"G6","requested":50000,"headroom":28000}');
  });

  it("commitLine says who, what, how much and under which grant", () => {
    expect(commitLine("buyer-a", "purchase", 50000, "G4")).toBe("buyer-a · purchase · 50,000 · under G4");
  });
});

describe("formatOutcome and formatOffered on the real canonical calls", () => {
  const whole = after(REPLAY);
  const byLabel = (needle: string) => {
    const found = whole.attempts.find((attempt) => attempt.label?.includes(needle) === true);
    if (found === undefined) throw new Error(`no attempt like ${needle}`);
    return found;
  };

  it("a grant admitted at seq 2", () => {
    const attempt = byLabel("cfo grants ops purchase and sign-contract");
    expect(formatOffered(attempt.input)).toBe("grant G2: cfo -> ops [purchase,sign-contract] limit 400000 depth 3 parent G1");
    expect(formatOutcome(attempt.outcome)).toEqual({ tone: "admitted", headline: "admitted at seq 2", text: "" });
  });

  it("a root grant has parent (root)", () => {
    expect(formatOffered(byLabel("dana grants cfo").input)).toBe("grant G1: dana -> cfo [purchase,refund,hire,sign-contract] limit 1000000 depth 4 parent (root)");
  });

  it("a warranted commit", () => {
    const attempt = byLabel("buyer-a buys 50 000 under G4");
    expect(formatOffered(attempt.input)).toBe("commit c1: buyer-a purchase 50000 under G4");
    expect(formatOutcome(attempt.outcome)).toEqual({ tone: "admitted", headline: "admitted at seq 7, warranted", text: "the chain G1>G2>G4 held at that moment" });
  });

  it("a breached commit is admitted and void, with the breach in words", () => {
    const attempt = byLabel("buyer-a buys 10 000 under G4, whose chain has been cut");
    expect(formatOutcome(attempt.outcome)).toEqual({
      tone: "breached",
      headline: "admitted at seq 12, void: link-dead",
      text: "a grant on the chain, G2, had been revoked at seq 11 before this act",
    });
  });

  it("a refusal names the rejection and takes no seq", () => {
    const attempt = byLabel("ops tries to hand down 200 000");
    expect(formatOutcome(attempt.outcome)).toEqual({
      tone: "refused",
      headline: "refused: over-allocation",
      text: "200,000 was asked of G2, which has 50,000 left",
    });
  });

  it("a revoke, and a refused revoke", () => {
    const revoke = byLabel("cfo revokes G2");
    expect(formatOffered(revoke.input)).toBe("revoke G2 by cfo");
    expect(formatOutcome(revoke.outcome)).toEqual({ tone: "admitted", headline: "admitted at seq 11", text: "" });
    expect(formatOutcome(byLabel("cfo tries to revoke G2 again").outcome).headline).toBe("refused: already-dead");
  });

  it("a faulty log is a fault with the fault's kind", () => {
    const outcome: AttemptOutcome = { kind: "faulty-log", fault: { kind: "log-too-long", length: 9, max: 5 } };
    expect(formatOutcome(outcome)).toEqual({ tone: "fault", headline: "the log could not be replayed: log-too-long", text: "" });
  });

  it("formatTally is the demo's wording: category, ' x', count", () => {
    expect(formatTally("admitted commit, breached:over-limit", 25)).toBe("admitted commit, breached:over-limit x25");
  });
});
