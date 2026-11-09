import { describe, expect, it } from "vitest";
import { fold } from "../../../lib/standing/index.js";
import { CHARTER, replayScript, runQuarter } from "../../../domains/company/index.js";
import { MAX_SEED, QUARTER_TICKS, computeDemoView, demoReducer, initialDemoState, outcomeCategory } from "../compute-demo-view.js";
import type { DemoAction, DemoState, GrantNode } from "../compute-demo-view.js";
import { OVER_DELEGATE, QUARTER, REPLAY, RESET, REVOKE, SPEND, WIDEN, after, scrubTo, seed, viewOf } from "./support/states.js";

/**
 * The bridge (plan §6 M8): what `computeDemoView` and `demoReducer` give for plan §7's incident, pinned to the numbers §7 states, and the exhaustive
 * check of plan §6 M8 falsifiable check (1).
 *
 * Every number below is §7's (or `npm run demo:company`'s, which `demo-diff.test.ts` compares with the page's views by running it). A test that
 * read its expectation off the code under test would pass whatever the code did.
 */

const flat = (nodes: readonly GrantNode[]): GrantNode[] => nodes.flatMap((node) => [node, ...flat(node.children)]);
const node = (state: DemoState, id: string): GrantNode => {
  const found = flat(viewOf(state).grants).find((entry) => entry.grant.id === id);
  if (found === undefined) throw new Error(`no grant ${id}`);
  return found;
};
const kinds = (state: DemoState): Record<string, string> => Object.fromEntries(viewOf(state).rows.map((row) => [row.standing.commitId, row.standing.kind]));

describe("the page opens on plan §7 as it stood just before the revoke", () => {
  const opening = initialDemoState();
  const view = viewOf(opening);

  it("has the ten admitted events of seq 1 to 10 and the eleven refusals of beat 1, offered one by one (21 calls)", () => {
    expect(view.head).toBe(10);
    expect(view.at).toBe(10);
    expect(opening.attempts).toHaveLength(21);
    expect(opening.attempts.filter((attempt) => attempt.outcome.kind === "admitted")).toHaveLength(10);
    expect(opening.attempts.filter((attempt) => attempt.outcome.kind === "rejected")).toHaveLength(11);
    expect(opening.cursor).toBeNull();
    expect(opening.seed).toBe(1);
  });

  it("names the eleven refusals as plan §7 does, in order", () => {
    const refused = opening.attempts.flatMap((attempt) => (attempt.outcome.kind === "rejected" ? [attempt.outcome.rejection.kind] : []));
    expect(refused).toEqual([
      "capability-widening",
      "over-allocation",
      "depth-exhausted",
      "not-a-root",
      "grantor-not-holder",
      "depth-not-narrowed",
      "principal-cycle",
      "unknown-parent",
      "duplicate-id",
      "revoker-not-authorised",
      "unknown-grant",
    ]);
    const over = opening.attempts.find((attempt) => attempt.outcome.kind === "rejected" && attempt.outcome.rejection.kind === "over-allocation");
    expect(over?.outcome).toEqual({ kind: "rejected", rejection: { kind: "over-allocation", grantId: "G2", requested: 200000, headroom: 50000 } });
  });

  it("shows c1 c2 c3 c4 all binding", () => {
    expect(kinds(opening)).toEqual({ c1: "binding", c2: "binding", c3: "binding", c4: "binding" });
  });

  it("shows plan §7's headrooms: G1 500 000, G2 50 000, G4 70 000, G6 28 000, with used and limit as the engine counts them", () => {
    const at = (id: string) => ({ limit: node(opening, id).grant.limit, used: node(opening, id).used, headroom: node(opening, id).headroom });
    expect(at("G1")).toEqual({ limit: 1_000_000, used: 500_000, headroom: 500_000 });
    expect(at("G2")).toEqual({ limit: 400_000, used: 350_000, headroom: 50_000 });
    expect(at("G4")).toEqual({ limit: 120_000, used: 50_000, headroom: 70_000 });
    expect(at("G6")).toEqual({ limit: 40_000, used: 12_000, headroom: 28_000 });
  });

  it("nests the grants as granted: G1 > G2 (G4, G5) and G3 (G6); one root", () => {
    expect(view.grants.map((root) => root.grant.id)).toEqual(["G1"]);
    const g1 = view.grants[0];
    expect(g1?.children.map((child) => child.grant.id)).toEqual(["G2", "G3"]);
    expect(g1?.children[0]?.children.map((child) => child.grant.id)).toEqual(["G4", "G5"]);
    expect(g1?.children[1]?.children.map((child) => child.grant.id)).toEqual(["G6"]);
    expect(view.grantCount).toBe(6);
    expect(view.roots).toEqual(["dana"]);
  });

  it("has the conservation meter at 232 000 (50 000 + 90 000 + 12 000 + 80 000) of 1 000 000, holding", () => {
    expect(view.meter).toEqual({ bound: 232_000, rootLimit: 1_000_000, holds: true });
  });
});

describe("Revoke Ops-Lead on that log (plan §7, seq 11)", () => {
  const revoked = after(REVOKE);
  const view = viewOf(revoked);

  it("is admitted at seq 11, and the head is 11", () => {
    expect(revoked.attempts.at(-1)?.outcome).toMatchObject({ kind: "admitted", event: { kind: "revoke", grantId: "G2", by: "cfo", seq: 11 }, verdict: null });
    expect(view.head).toBe(11);
  });

  it("turns c1 c2 c4 inherited, severed G2@11, heir cfo, chargedTo G1, and leaves c3 binding", () => {
    expect(kinds(revoked)).toEqual({ c1: "inherited", c2: "inherited", c3: "binding", c4: "inherited" });
    for (const row of view.rows) {
      if (row.standing.kind === "inherited") {
        expect(row.standing.severed).toEqual({ grantId: "G2", atSeq: 11 });
        expect(row.standing.heir).toBe("cfo");
        expect(row.standing.chargedTo).toBe("G1");
      }
    }
  });

  it("absorbs 220 000 under G2 and takes G1's headroom from 500 000 to 680 000", () => {
    expect(node(revoked, "G2")).toMatchObject({ live: false, revokedAt: 11, absorbed: 220_000 });
    expect(node(after(), "G1").headroom).toBe(500_000);
    expect(node(revoked, "G1").headroom).toBe(680_000);
  });

  it("marks G2 revoked itself and G4 and G5 cut off (not revoked themselves); G1, G3 and G6 stay live", () => {
    const state = (id: string) => ({ live: node(revoked, id).live, revokedAt: node(revoked, id).revokedAt });
    expect(state("G1")).toEqual({ live: true, revokedAt: null });
    expect(state("G2")).toEqual({ live: false, revokedAt: 11 });
    expect(state("G4")).toEqual({ live: false, revokedAt: null });
    expect(state("G5")).toEqual({ live: false, revokedAt: null });
    expect(state("G3")).toEqual({ live: true, revokedAt: null });
    expect(state("G6")).toEqual({ live: true, revokedAt: null });
  });

  it("the meter does not move (an inherited commitment is still bound), and still holds", () => {
    expect(view.meter).toEqual({ bound: 232_000, rootLimit: 1_000_000, holds: true });
  });

  it("revoking again is refused as already-dead, and takes no seq", () => {
    const twice = after(REVOKE, REVOKE);
    expect(twice.attempts.at(-1)?.outcome).toEqual({ kind: "rejected", rejection: { kind: "already-dead", grantId: "G2" } });
    expect(viewOf(twice).head).toBe(11);
  });
});

describe("the three overreach presets, against the opening log", () => {
  it("Widen scope is refused as capability-widening { hire }", () => {
    expect(after(WIDEN).attempts.at(-1)?.outcome).toEqual({ kind: "rejected", rejection: { kind: "capability-widening", capability: "hire" } });
  });

  it("Over-delegate is refused as over-allocation { G2, 200000, 50000 }", () => {
    expect(after(OVER_DELEGATE).attempts.at(-1)?.outcome).toEqual({
      kind: "rejected",
      rejection: { kind: "over-allocation", grantId: "G2", requested: 200000, headroom: 50000 },
    });
  });

  it("Spend beyond limit is admitted at seq 11 and ruled void: over-limit { G6, 50000, 28000 }; the meter does not move", () => {
    const state = after(SPEND);
    expect(state.attempts.at(-1)?.outcome).toMatchObject({
      kind: "admitted",
      event: { seq: 11 },
      verdict: { kind: "breached", breach: { kind: "over-limit", grantId: "G6", requested: 50000, headroom: 28000 } },
    });
    expect(viewOf(state).rows.at(-1)?.standing).toMatchObject({ kind: "void", breach: { kind: "over-limit", requested: 50000, headroom: 28000 } });
    expect(viewOf(state).meter).toEqual(viewOf(after()).meter);
    expect(node(state, "G6").headroom).toBe(28_000);
  });

  it("pressed twice it is two commits with two ids, both void", () => {
    const state = after(SPEND, SPEND);
    expect(state.log.map((event) => event.kind === "commit" && event.commit.id).slice(-2)).toEqual(["ui-c-22", "ui-c-23"]);
    expect(viewOf(state).counts).toEqual({ binding: 4, inherited: 0, void: 2 });
  });

  it("after the revoke, Widen scope and Over-delegate are refused as parent-dead { G2 } (which masks the rest, as plan §4.3 orders the checks)", () => {
    for (const preset of [WIDEN, OVER_DELEGATE]) {
      expect(after(REVOKE, preset).attempts.at(-1)?.outcome).toEqual({ kind: "rejected", rejection: { kind: "parent-dead", deadGrant: "G2" } });
    }
  });
});

describe("the scrubber on the whole incident (plan §6 M8 falsifiable check 5)", () => {
  const whole = after(REPLAY);

  it("at seq 10 shows c1 c2 c3 c4 all binding: the revoke did not rewrite the past", () => {
    expect(kinds(after(REPLAY, scrubTo(10)))).toEqual({ c1: "binding", c2: "binding", c3: "binding", c4: "binding" });
  });

  it("at seq 11 shows c1 c2 c4 inherited with heir cfo, and c3 binding", () => {
    const view = viewOf(after(REPLAY, scrubTo(11)));
    expect(Object.fromEntries(view.rows.map((row) => [row.standing.commitId, row.standing.kind]))).toEqual({ c1: "inherited", c2: "inherited", c3: "binding", c4: "inherited" });
    expect(view.rows.flatMap((row) => (row.standing.kind === "inherited" ? [row.standing.heir] : []))).toEqual(["cfo", "cfo", "cfo"]);
  });

  it("at seq 18 (the head) c1 c2 c4 are inherited, c3 and c10 binding, c5 to c9 void with their five breaches", () => {
    expect(kinds(whole)).toEqual({ c1: "inherited", c2: "inherited", c3: "binding", c4: "inherited", c5: "void", c6: "void", c7: "void", c8: "void", c9: "void", c10: "binding" });
    expect(viewOf(whole).rows.flatMap((row) => (row.standing.kind === "void" ? [row.standing.breach.kind] : []))).toEqual([
      "link-dead",
      "wrong-actor",
      "capability-not-granted",
      "over-limit",
      "no-such-grant",
    ]);
    expect(viewOf(whole).counts).toEqual({ binding: 2, inherited: 3, void: 5 });
    expect(viewOf(whole).meter).toEqual({ bound: 242_000, rootLimit: 1_000_000, holds: true });
  });

  it("at seq 0 there is nothing: no grant, no commitment, no call shown, and the meter is 0 of 0", () => {
    const view = viewOf(after(REPLAY, scrubTo(0)));
    expect(view.at).toBe(0);
    expect(view.head).toBe(18);
    expect(view.grants).toEqual([]);
    expect(view.rows).toEqual([]);
    expect(view.attempts).toEqual([]);
    expect(view.latest).toBeNull();
    expect(view.atEvent).toBeNull();
    expect(view.meter).toEqual({ bound: 0, rootLimit: 0, holds: true });
  });

  it("shows the calls up to the one the engine admitted at that seq: at seq 11 the 22nd call (the revoke), none of the later ones", () => {
    const view = viewOf(after(REPLAY, scrubTo(11)));
    expect(view.attempts).toHaveLength(22);
    expect(view.latest?.outcome).toMatchObject({ kind: "admitted", event: { seq: 11 } });
    expect(view.atEvent).toMatchObject({ kind: "revoke", grantId: "G2", seq: 11 });
  });

  it("each scrubbed view equals the view of a state whose log stops there (the engine folds the prefix; nothing is carried over from the head)", () => {
    for (let at = 0; at <= 18; at++) {
      const scrubbed = viewOf(after(REPLAY, scrubTo(at)));
      const prefix: DemoState = { log: whole.log.slice(0, at), attempts: whole.attempts.filter((attempt) => attempt.n <= (scrubbed.attempts.at(-1)?.n ?? 0)), cursor: null, seed: 1 };
      const direct = viewOf(prefix);
      expect({ ...scrubbed, head: 0 }).toEqual({ ...direct, head: 0 });
    }
  });

  it("any action returns the page to the live head", () => {
    expect(after(REPLAY, scrubTo(5), WIDEN).cursor).toBeNull();
    expect(after(REPLAY, scrubTo(5), REVOKE).cursor).toBeNull();
    expect(after(REPLAY, scrubTo(5), QUARTER).cursor).toBeNull();
    expect(after(REPLAY, scrubTo(5), RESET).cursor).toBeNull();
    expect(after(REPLAY, scrubTo(5), REPLAY).cursor).toBeNull();
  });
});

describe("the autonomous quarter, seed 1 (what `npm run demo:company` prints in its last block)", () => {
  const state = after(QUARTER);
  const view = viewOf(state);

  it("is runQuarter(1, 60) of the domain: the same log and the same calls", () => {
    const direct = runQuarter(1, QUARTER_TICKS);
    expect(state.log).toEqual(direct.log);
    expect(state.attempts).toEqual(direct.attempts);
  });

  it("has 118 admitted events and standings binding 44, inherited 3, void 39, and 375 500 bound of 1 000 000", () => {
    expect(view.head).toBe(118);
    expect(view.counts).toEqual({ binding: 44, inherited: 3, void: 39 });
    expect(view.meter).toEqual({ bound: 375_500, rootLimit: 1_000_000, holds: true });
  });

  it("tallies the five policies as the demo does (the canonical steps are not counted)", () => {
    expect(view.tally.map((row) => [row.source, row.total])).toEqual([
      ["DelegatorPolicy", 24],
      ["RefunderPolicy", 30],
      ["OverreachPolicy", 29],
      ["BuyerPolicy", 11],
      ["CompromisedPolicy", 28],
    ]);
    const compromised = view.tally.find((row) => row.source === "CompromisedPolicy");
    expect(compromised?.outcomes).toEqual([
      { what: "admitted commit, breached:over-limit", count: 25 },
      { what: "admitted commit, warranted", count: 3 },
    ]);
  });

  it("uses the seed in the box: another seed is another quarter, the same seed the same one", () => {
    const two = after(seed(2), QUARTER);
    expect(two.seed).toBe(2);
    expect(two.log).toEqual(runQuarter(2, QUARTER_TICKS).log);
    expect(two.log).not.toEqual(state.log);
    expect(after(seed(2), QUARTER)).toEqual(two);
  });

  it("is independent of what was on screen before it (the exhaustive test below relies on this)", () => {
    expect(demoReducer(after(REVOKE, SPEND, REPLAY), QUARTER)).toEqual(state);
  });
});

describe("the reducer is total and pure", () => {
  it("scrub: past the head is live, below 0 is 0, a fraction is truncated, NaN changes nothing", () => {
    const whole = after(REPLAY);
    expect(demoReducer(whole, scrubTo(18)).cursor).toBeNull();
    expect(demoReducer(whole, scrubTo(99)).cursor).toBeNull();
    expect(demoReducer(whole, scrubTo(-4)).cursor).toBe(0);
    expect(demoReducer(whole, scrubTo(10.9)).cursor).toBe(10);
    expect(demoReducer(demoReducer(whole, scrubTo(7)), scrubTo(Number.NaN)).cursor).toBe(7);
    expect(demoReducer(whole, scrubTo(Number.POSITIVE_INFINITY)).cursor).toBeNull();
    expect(demoReducer(whole, scrubTo(Number.NEGATIVE_INFINITY)).cursor).toBe(0);
    expect(demoReducer(whole, scrubTo(null)).cursor).toBeNull();
  });

  it("set-seed: a whole number in 0 to MAX_SEED; anything else is clamped or ignored", () => {
    const start = initialDemoState();
    expect(MAX_SEED).toBe(999_999);
    expect(demoReducer(start, seed(7)).seed).toBe(7);
    expect(demoReducer(start, seed(3.9)).seed).toBe(3);
    expect(demoReducer(start, seed(-5)).seed).toBe(0);
    expect(demoReducer(start, seed(1e12)).seed).toBe(MAX_SEED);
    expect(demoReducer(start, seed(Number.NaN)).seed).toBe(1);
    expect(demoReducer(start, seed(Number.POSITIVE_INFINITY)).seed).toBe(1);
  });

  it("does not change the state it is given, and gives equal states for equal actions", () => {
    const actions: DemoAction[] = [REVOKE, SPEND, WIDEN, OVER_DELEGATE, QUARTER, seed(9), REPLAY, scrubTo(3), RESET];
    for (const action of actions) {
      const given = after(REPLAY);
      const before = JSON.stringify(given);
      const first = demoReducer(given, action);
      expect(JSON.stringify(given)).toBe(before);
      expect(demoReducer(after(REPLAY), action)).toEqual(first);
    }
    expect(initialDemoState()).toEqual(initialDemoState());
  });

  it("reset gives the opening state, whatever came before", () => {
    expect(demoReducer(after(REVOKE, QUARTER, seed(5), scrubTo(2)), RESET)).toEqual(initialDemoState());
  });

  it("replay-incident is replayScript(): 33 calls, 18 admitted, and the seed in the box is kept", () => {
    const state = after(seed(4), REPLAY);
    const direct = replayScript();
    expect(state.log).toEqual(direct.log);
    expect(state.attempts).toEqual(direct.attempts);
    expect(state.attempts).toHaveLength(33);
    expect(state.log).toHaveLength(18);
    expect(state.seed).toBe(4);
  });

  it("a call made after a quarter carries the tick the quarter ended on, and the next n", () => {
    const state = after(QUARTER, WIDEN);
    const before = after(QUARTER);
    expect(state.attempts.at(-1)?.n).toBe(before.attempts.length + 1);
    expect(state.attempts.at(-1)?.tick).toBe(before.attempts.at(-1)?.tick);
  });
});

describe("computeDemoView never throws, and says why when it has no view", () => {
  const good = after(REVOKE);

  it("a position outside the log is an error, not a throw", () => {
    const result = computeDemoView({ ...good, cursor: 99 });
    expect(result).toEqual({ ok: false, error: "the time-travel position 99 is outside 0 to 11" });
    expect(computeDemoView({ ...good, cursor: -1 }).ok).toBe(false);
    expect(computeDemoView({ ...good, cursor: 2.5 }).ok).toBe(false);
  });

  it("a transcript that is not the log's story is an error", () => {
    const result = computeDemoView({ ...good, attempts: good.attempts.slice(1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^the transcript has \d+ admitted calls and the log has 11 events$/);
    const swapped = { ...good, attempts: [...good.attempts.slice(0, 2), ...good.attempts.slice(2)].map((attempt, index) => (index === 0 ? good.attempts[2] ?? attempt : attempt)) };
    expect(computeDemoView(swapped).ok).toBe(false);
  });

  it("a log the engine cannot replay is the engine's own FoldFault, as an error", () => {
    // the transcript is forged to agree with the log, so that the first check passes and the engine's own fold is what refuses
    const gappy = {
      ...good,
      log: good.log.map((event, index) => (index === 3 ? { ...event, seq: 9 } : event)),
      attempts: good.attempts.map((attempt) =>
        attempt.outcome.kind === "admitted" && attempt.outcome.event.seq === 4 ? { ...attempt, outcome: { ...attempt.outcome, event: { ...attempt.outcome.event, seq: 9 } } } : attempt,
      ),
    };
    const result = computeDemoView(gappy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seq-mismatch/);
  });

  it("anything the checks did not foresee is caught by the second layer (a log that throws when read)", () => {
    const hostile = new Proxy([...good.log], {
      get(target, key, receiver) {
        if (key === "slice") throw new Error("boom");
        return Reflect.get(target, key, receiver);
      },
    });
    const result = computeDemoView({ ...good, log: hostile });
    expect(result).toEqual({ ok: false, error: "the demo could not compute a view: boom" });
  });

  it("an error is a result that the same state gives every time", () => {
    expect(computeDemoView({ ...good, cursor: 99 })).toEqual(computeDemoView({ ...good, cursor: 99 }));
  });
});

describe("outcomeCategory names the answers as scripts/demo-company.ts does", () => {
  it("covers a refusal, a grant, a warranted commit and a breached commit", () => {
    const whole = after(REPLAY);
    const categories = new Set(whole.attempts.map(outcomeCategory));
    expect(categories.has("refused:capability-widening")).toBe(true);
    expect(categories.has("admitted grant")).toBe(true);
    expect(categories.has("admitted revoke")).toBe(true);
    expect(categories.has("admitted commit, warranted")).toBe(true);
    expect(categories.has("admitted commit, breached:link-dead")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// plan §6 M8 falsifiable check (1): every sequence of length <= 4 over the demo's eight-button alphabet
// ---------------------------------------------------------------------------------------------------------------------------------

/** The eight buttons. "Set seed 2" stands for the seed box; "Autonomous quarter" then runs seed 2 when it follows it. */
const ALPHABET: readonly { readonly name: string; readonly action: DemoAction }[] = [
  { name: "revoke", action: REVOKE },
  { name: "widen", action: WIDEN },
  { name: "over-delegate", action: OVER_DELEGATE },
  { name: "spend", action: SPEND },
  { name: "quarter", action: QUARTER },
  { name: "seed 2", action: seed(2) },
  { name: "replay", action: REPLAY },
  { name: "reset", action: RESET },
];

/** The oracle of this check, from the raw log and the engine's own charges: nothing of the view's meter is reused. */
function independentBound(state: DemoState, upTo: number): { readonly rootLimit: number; readonly bound: number; readonly charged: number } {
  const prefix = state.log.slice(0, upTo);
  let rootLimit = 0;
  for (const event of prefix) if (event.kind === "grant" && event.grant.parent === null) rootLimit += event.grant.limit;
  const folded = fold(CHARTER, prefix);
  if (!folded.ok) throw new Error("the log on screen did not fold");
  let charged = 0;
  for (const charge of folded.folded.charges) charged += charge.amount;
  let bound = 0;
  for (const record of folded.folded.commits.values()) if (record.verdict.kind === "warranted") bound += record.commit.amount;
  return { rootLimit, bound, charged };
}

/**
 * `quarter` ignores the log on screen (the test "is independent of what was on screen before it" above), so its result depends on the seed alone. It is computed
 * once per seed through the real reducer and reused: it takes about 26 ms a call, and 585 of the 4680 sequences end in one.
 */
const quarters = new Map<number, DemoState>();
function step(state: DemoState, action: DemoAction): DemoState {
  if (action.type !== "quarter") return demoReducer(state, action);
  const known = quarters.get(state.seed);
  if (known !== undefined) return { ...known, seed: state.seed };
  const made = demoReducer(state, action);
  quarters.set(state.seed, made);
  return made;
}

function check(state: DemoState, path: string): void {
  const result = computeDemoView(state);
  if (!result.ok) throw new Error(`${path}: no view: ${result.error}`);
  const { view } = result;
  const oracle = independentBound(state, view.at);
  if (!view.meter.holds) throw new Error(`${path}: the meter says the bound is broken`);
  if (view.meter.bound > view.meter.rootLimit) throw new Error(`${path}: bound ${view.meter.bound} > root limit ${view.meter.rootLimit}`);
  if (view.meter.bound !== oracle.bound || view.meter.rootLimit !== oracle.rootLimit) {
    throw new Error(`${path}: the meter disagrees with the raw log (${JSON.stringify(view.meter)} against ${JSON.stringify(oracle)})`);
  }
  if (oracle.bound !== oracle.charged) throw new Error(`${path}: warranted amounts ${oracle.bound} are not the engine's charges ${oracle.charged}`);
  if (view.head !== state.log.length) throw new Error(`${path}: head ${view.head} is not the log's length`);
  const commits = state.log.slice(0, view.at).filter((event) => event.kind === "commit").length;
  if (view.rows.length !== commits) throw new Error(`${path}: ${view.rows.length} standings for ${commits} commits`);
  if (view.counts.binding + view.counts.inherited + view.counts.void !== view.rows.length) throw new Error(`${path}: the counts are not the rows`);
  for (const grant of flat(view.grants)) {
    if (grant.live && grant.used > grant.grant.limit) throw new Error(`${path}: live grant ${grant.grant.id} has used ${grant.used} over its limit ${grant.grant.limit}`);
    if (grant.headroom < 0) throw new Error(`${path}: grant ${grant.grant.id} has negative headroom`);
  }
  if (view.at === view.head && view.attempts.length !== state.attempts.length) throw new Error(`${path}: the live view hides calls`);
}

interface Counts {
  nodes: number;
  scrubbed: number;
}

function visit(state: DemoState, names: readonly string[], counts: Counts): void {
  if (names.length > 0) {
    check(state, names.join(" > "));
    counts.nodes++;
    const head = state.log.length;
    // one step back from the head on every sequence; the start and the middle too on the shorter ones (the longer ones are most of the 4680)
    const points = names.length <= 3 ? [0, Math.floor(head / 2), head - 1] : [head - 1];
    for (const at of new Set(points)) {
      if (at < 0 || at >= head) continue;
      check({ ...state, cursor: at }, `${names.join(" > ")} @ ${at}`);
      counts.scrubbed++;
    }
  }
  if (names.length === 4) return;
  for (const { name, action } of ALPHABET) visit(step(state, action), [...names, name], counts);
}

describe("EXHAUSTIVE: every sequence of at most 4 buttons yields a view, and the view conserves", () => {
  it("the alphabet has eight buttons, and eight subtrees of 585 sequences are the 8 + 64 + 512 + 4096 = 4680 sequences of length 1 to 4", () => {
    expect(ALPHABET).toHaveLength(8);
    expect(ALPHABET.length * 585).toBe(8 + 64 + 512 + 4096);
  });

  // 8 subtrees, one per first button, of 1 + 8 + 64 + 512 = 585 sequences each: 4680 in all, each with a live view and one scrubbed back from the head
  for (const first of ALPHABET) {
    it(`every sequence of at most 4 buttons that begins with "${first.name}" (585 of them)`, () => {
      const counts: Counts = { nodes: 0, scrubbed: 0 };
      visit(step(initialDemoState(), first.action), [first.name], counts);
      expect(counts.nodes).toBe(585);
      expect(counts.scrubbed).toBeGreaterThan(500);
    });
  }
});
