import { describe, expect, it } from "vitest";
import { headroomOf } from "../../../lib/allowance/index.js";
import type { Rejection, Standing } from "../../../lib/contracts/index.js";
import { fold, standings } from "../../../lib/standing/index.js";
import { CHARTER } from "../org.js";
import { POLICIES } from "../policies.js";
import type { PolicyName } from "../policies.js";
import { runQuarter } from "../simulate.js";
import type { Attempt, AttemptSource, QuarterResult } from "../simulate.js";
import { makeOrgView } from "../view.js";
import { oracleOf, violations } from "./support/oracle.js";

/**
 * `runQuarter` over 200 seeds (plan §6 M6: "never throws, always folds, and conserves"), and what those 200 quarters REACH.
 *
 * Seeds 1 to 200, 60 ticks each, in `CHUNKS` chunks so that no test is long. For every seed:
 *   - it does not throw;
 *   - the log it ends with folds (`fold` is `ok`, and the quarter's own `fault` is null);
 *   - the log is exactly the admitted attempts' events, in order, with every `seq` its position;
 *   - it CONSERVES, at every prefix of its log: for every grant, the amount the engine ruled `binding` or `inherited` under that grant or
 *     any grant below it is within the grant's limit (`support/oracle.ts`, an independent oracle that imports nothing from `lib/allowance`),
 *     and no commit is ruled to bind under a grant the log does not hold; and, at the end, the engine's own `headroomOf` is not negative for
 *     any grant.
 *
 * AND WHAT THEY REACH. A property over an empty domain proves nothing, so the last tests of this file add up what the 200 quarters did: how
 * deep the chains went, how many revokes there were and how many of them moved an heir up, which kinds of refusal, breach and standing came
 * from the POLICIES (the script's own attempts are counted apart: they are the same 33 in every quarter and would hide what the policies did).
 * The counts are asserted as lower bounds, and the ADR quotes what they were at the commit it was written on.
 */

const SEEDS = 200;
const TICKS = 60;
const CHUNKS = 50;
const PER_CHUNK = SEEDS / CHUNKS;

/**
 * An explicit timeout for a chunk of seeds, in place of vitest's 5 s default. With 10 seeds a chunk, the slowest chunk took 4.25 s in a full-suite run
 * under 20 busy `yes` processes (85% of 5 s; 0.7 to 1.3 s without them), so the chunks were cut to 4 seeds. The timeout is not the fix for that
 * margin, it is what keeps a machine slower than this one from failing a test that does nothing wrong: it does not shorten any work, and a
 * quarter that hangs would be caught by it only after 20 s.
 */
const SEED_LOOP_TIMEOUT_MS = 20_000;
/** The test that adds up all 200 seeds pays for every chunk only if it is run alone (`-t`); in a full run the chunks above have already been computed and memoised. */
const ALL_SEEDS_TIMEOUT_MS = 90_000;

const REJECTIONS: readonly Rejection["kind"][] = [
  "invalid-event-shape", "unknown-capability", "duplicate-id", "not-a-root", "unknown-parent", "parent-dead", "grantor-not-holder", "capability-widening",
  "depth-exhausted", "depth-not-narrowed", "principal-cycle", "over-allocation", "unknown-grant", "already-dead", "revoker-not-authorised",
];

interface SeedStats {
  readonly seed: number;
  readonly problems: readonly string[];
  readonly attempts: Readonly<Record<string, number>>;
  /** Policy-sourced refusals by `source:kind`. */
  readonly refusals: Readonly<Record<string, number>>;
  /** Policy-sourced void commits by `source:breach kind`. */
  readonly breaches: Readonly<Record<string, number>>;
  /** Policy-sourced commits by the standing they ended with. */
  readonly standingsOfPolicy: Readonly<Record<string, number>>;
  /** Policy-sourced attempts by `source:outcome` where the outcome is admitted-warranted, admitted-breached, admitted-grant, admitted-revoke, rejected, faulty-log. */
  readonly outcomes: Readonly<Record<string, number>>;
  readonly canonRefusals: number;
  readonly maxLinks: number;
  readonly policyRevokes: number;
  readonly revokesByRoot: number;
  readonly rootGrantsByPolicy: number;
  readonly heirClimbs: number;
  readonly heirClimbsToRoot: number;
  readonly events: number;
}

function bump(into: Record<string, number>, key: string): void {
  into[key] = (into[key] ?? 0) + 1;
}

function statsOfSeed(seed: number): SeedStats {
  const problems: string[] = [];
  const attempts: Record<string, number> = {};
  const refusals: Record<string, number> = {};
  const breaches: Record<string, number> = {};
  const standingsOfPolicy: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const empty = { seed, problems, attempts, refusals, breaches, standingsOfPolicy, outcomes, canonRefusals: 0, maxLinks: 0, policyRevokes: 0, revokesByRoot: 0, rootGrantsByPolicy: 0, heirClimbs: 0, heirClimbsToRoot: 0, events: 0 } satisfies SeedStats;

  let quarter: QuarterResult;
  try {
    quarter = runQuarter(seed, TICKS);
  } catch (error) {
    return { ...empty, problems: [`seed ${seed}: runQuarter threw ${String(error)}`] };
  }
  const { log } = quarter;

  if (quarter.fault !== null) problems.push(`seed ${seed}: the quarter ended with a fault ${JSON.stringify(quarter.fault)}`);
  const folded = fold(CHARTER, log);
  if (!folded.ok) problems.push(`seed ${seed}: the log does not fold ${JSON.stringify(folded.fault)}`);

  const admitted = quarter.attempts.flatMap((attempt) => (attempt.outcome.kind === "admitted" ? [attempt.outcome.event] : []));
  if (JSON.stringify(admitted) !== JSON.stringify(log)) problems.push(`seed ${seed}: the log is not the admitted attempts' events`);
  log.forEach((event, index) => {
    if (event.seq !== index + 1) problems.push(`seed ${seed}: event ${index} has seq ${event.seq}`);
  });

  // Conservation at every prefix, and the standings at each revoke for the heir climb.
  const revokeStandings: (readonly Standing[])[] = [];
  let finalStandings: readonly Standing[] = [];
  for (let k = 1; k <= log.length; k++) {
    const prefix = log.slice(0, k);
    const list = standings(CHARTER, prefix);
    if (!list.ok) {
      problems.push(`seed ${seed}: standings failed at prefix ${k}`);
      break;
    }
    for (const line of violations(oracleOf(prefix, list.standings))) problems.push(`seed ${seed}, prefix ${k}: ${line}`);
    if (log[k - 1]?.kind === "revoke") revokeStandings.push(list.standings);
    finalStandings = list.standings;
  }

  // The engine's own accounting at the end: no grant has negative headroom.
  if (folded.ok) {
    for (const event of log) {
      if (event.kind !== "grant") continue;
      const room = headroomOf(folded.folded.tree, folded.folded.charges, event.grant.id);
      if (room === undefined || room < 0) problems.push(`seed ${seed}: headroom of ${event.grant.id} is ${String(room)}`);
    }
  }

  // The heir climbs: a commit that is inherited at one revoke and inherited again at a later one under a different heir.
  let heirClimbs = 0;
  let heirClimbsToRoot = 0;
  const heirOf = new Map<string, string>();
  for (const list of revokeStandings) {
    for (const standing of list) {
      if (standing.kind !== "inherited") continue;
      const before = heirOf.get(standing.commitId);
      if (before !== undefined && before !== standing.heir) {
        heirClimbs++;
        if (standing.chargedTo === null) heirClimbsToRoot++;
      }
      heirOf.set(standing.commitId, standing.heir);
    }
  }

  // Which commits the policies made, and what became of them.
  const sourceOfCommit = new Map<string, AttemptSource>();
  let canonRefusals = 0;
  let policyRevokes = 0;
  let revokesByRoot = 0;
  let rootGrantsByPolicy = 0;
  for (const attempt of quarter.attempts as readonly Attempt[]) {
    bump(attempts, attempt.source);
    const outcome = attempt.outcome;
    if (attempt.source === "canon") {
      if (outcome.kind === "rejected") canonRefusals++;
      continue;
    }
    if (outcome.kind === "rejected") {
      bump(refusals, `${attempt.source}:${outcome.rejection.kind}`);
      bump(outcomes, `${attempt.source}:rejected`);
    } else if (outcome.kind === "faulty-log") {
      bump(outcomes, `${attempt.source}:faulty-log`);
    } else {
      const event = outcome.event;
      if (event.kind === "commit") {
        sourceOfCommit.set(event.commit.id, attempt.source);
        if (outcome.verdict?.kind === "breached") {
          bump(breaches, `${attempt.source}:${outcome.verdict.breach.kind}`);
          bump(outcomes, `${attempt.source}:admitted-breached`);
        } else bump(outcomes, `${attempt.source}:admitted-warranted`);
      } else if (event.kind === "revoke") {
        policyRevokes++;
        if (event.by === "dana") revokesByRoot++;
        bump(outcomes, `${attempt.source}:admitted-revoke`);
      } else {
        if (event.grant.parent === null) rootGrantsByPolicy++;
        bump(outcomes, `${attempt.source}:admitted-grant`);
      }
    }
  }
  for (const standing of finalStandings) if (sourceOfCommit.has(standing.commitId)) bump(standingsOfPolicy, standing.kind);

  let maxLinks = 0;
  const made = makeOrgView(log, TICKS);
  if (made.ok) for (const entry of made.view.grants) maxLinks = Math.max(maxLinks, entry.links);

  return { seed, problems, attempts, refusals, breaches, standingsOfPolicy, outcomes, canonRefusals, maxLinks, policyRevokes, revokesByRoot, rootGrantsByPolicy, heirClimbs, heirClimbsToRoot, events: log.length };
}

const memo = new Map<number, SeedStats[]>();
function chunk(index: number): SeedStats[] {
  const known = memo.get(index);
  if (known !== undefined) return known;
  const first = index * PER_CHUNK + 1;
  const stats = Array.from({ length: PER_CHUNK }, (_, offset) => statsOfSeed(first + offset));
  memo.set(index, stats);
  return stats;
}

describe(`runQuarter over ${SEEDS} seeds of ${TICKS} ticks: never throws, always folds, conserves at every prefix`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const first = index * PER_CHUNK + 1;
    it(`seeds ${first} to ${first + PER_CHUNK - 1}`, () => {
      const stats = chunk(index);
      expect(stats.flatMap((entry) => entry.problems)).toEqual([]);
      expect(stats.reduce((sum, entry) => sum + entry.events, 0), "the quarters were not empty").toBeGreaterThan(PER_CHUNK * 50);
    }, SEED_LOOP_TIMEOUT_MS);
  }
});

describe("what the 200 quarters reached", () => {
  const all = (): SeedStats[] => Array.from({ length: CHUNKS }, (_, index) => chunk(index)).flat();
  const total = (pick: (entry: SeedStats) => Readonly<Record<string, number>>): Map<string, number> => {
    const sum = new Map<string, number>();
    for (const entry of all()) for (const [key, count] of Object.entries(pick(entry))) sum.set(key, (sum.get(key) ?? 0) + count);
    return sum;
  };
  const byKind = (map: Map<string, number>): Map<string, number> => {
    const kinds = new Map<string, number>();
    for (const [key, count] of map) {
      const kind = key.slice(key.indexOf(":") + 1);
      kinds.set(kind, (kinds.get(kind) ?? 0) + count);
    }
    return kinds;
  };
  const sumOf = (pick: (entry: SeedStats) => number): number => all().reduce((sum, entry) => sum + pick(entry), 0);

  it("covered all 200 seeds, and each seed ran: 200 quarters, none empty", () => {
    expect(all()).toHaveLength(SEEDS);
    expect(all().map((entry) => entry.seed)).toEqual(Array.from({ length: SEEDS }, (_, index) => index + 1));
    expect(all().every((entry) => entry.events >= 18)).toBe(true);
  }, ALL_SEEDS_TIMEOUT_MS);

  it("every policy made attempts: four of them in every one of the 200 quarters, and BuyerPolicy (which only proposes what the engine would warrant, and so is silent when nothing it holds is live) in at least 190", () => {
    const names: readonly PolicyName[] = POLICIES.map((entry) => entry.name);
    for (const name of names) {
      const quarters = all().filter((entry) => (entry.attempts[name] ?? 0) > 0).length;
      if (name === "BuyerPolicy") expect(quarters, name).toBeGreaterThanOrEqual(190);
      else expect(quarters, name).toBe(SEEDS);
      expect(sumOf((entry) => entry.attempts[name] ?? 0), name).toBeGreaterThan(1000);
    }
    expect(all().every((entry) => entry.attempts["canon"] === 33)).toBe(true);
  });

  it("the policies reached 14 of the 15 kinds of Rejection; the fifteenth, unknown-capability, only the script reaches (a typed policy cannot name a capability that is not in the type)", () => {
    const reached = new Set(byKind(total((entry) => entry.refusals)).keys());
    expect([...reached].sort()).toEqual(REJECTIONS.filter((kind) => kind !== "unknown-capability").sort());
    expect(sumOf((entry) => entry.canonRefusals), "the script's own fifteen, in each of the 200").toBe(15 * SEEDS);
  });

  it("every kind of Rejection the policies reached, they reached more than once", () => {
    for (const [kind, count] of byKind(total((entry) => entry.refusals))) expect(count, kind).toBeGreaterThan(50);
  });

  it("the policies reached all five kinds of Breach, and the commits they made ended in all three standings", () => {
    expect([...byKind(total((entry) => entry.breaches)).keys()].sort()).toEqual(["capability-not-granted", "link-dead", "no-such-grant", "over-limit", "wrong-actor"]);
    expect([...total((entry) => entry.standingsOfPolicy).keys()].sort()).toEqual(["binding", "inherited", "void"]);
    for (const [kind, count] of total((entry) => entry.standingsOfPolicy)) expect(count, kind).toBeGreaterThan(100);
  });

  it("the deepest chain the policies built has six grants, the most the company can have (six agents), in at least three of the 200 quarters", () => {
    const deepest = Math.max(...all().map((entry) => entry.maxLinks));
    expect(deepest, "the deepest the company allows was reached: six links, with six agents and one root").toBe(6);
    expect(all().filter((entry) => entry.maxLinks === 6).length).toBeGreaterThanOrEqual(3);
    expect(all().filter((entry) => entry.maxLinks >= 4).length).toBeGreaterThan(20);
  });

  it("there were revokes, by the policies and not only by the script: more than 100 admitted, and at least one root revoke (dana cutting a root grant) in more than 10 quarters", () => {
    expect(sumOf((entry) => entry.policyRevokes)).toBeGreaterThan(100);
    expect(all().filter((entry) => entry.revokesByRoot > 0).length).toBeGreaterThan(10);
  });

  it("some revokes moved an heir up: commits that were inherited under one heir and, after a later revoke, under another; and some of those climbed to a charter root (chargedTo null)", () => {
    expect(sumOf((entry) => entry.heirClimbs)).toBeGreaterThan(50);
    expect(sumOf((entry) => entry.heirClimbsToRoot)).toBeGreaterThan(5);
  });

  it("the policies re-issued a root grant when none was live, in at least one quarter", () => {
    expect(all().filter((entry) => entry.rootGrantsByPolicy > 0).length).toBeGreaterThan(5);
  });

  it("BuyerPolicy's commits were ruled warranted every time, in numbers (it asks before it acts); and no policy attempt of the 200 quarters was a faulty log", () => {
    const outcomes = total((entry) => entry.outcomes);
    expect(outcomes.get("BuyerPolicy:admitted-warranted") ?? 0).toBeGreaterThan(500);
    expect(outcomes.get("BuyerPolicy:admitted-breached") ?? 0).toBe(0);
    expect(outcomes.get("BuyerPolicy:rejected") ?? 0).toBe(0);
    expect([...outcomes.keys()].filter((key) => key.endsWith(":faulty-log"))).toEqual([]);
  });

  it("DelegatorPolicy was never refused, in numbers (it asks the engine by a dry run), and nor were RefunderPolicy, CompromisedPolicy or BuyerPolicy: only OverreachPolicy's acts were refused", () => {
    const outcomes = total((entry) => entry.outcomes);
    expect(outcomes.get("DelegatorPolicy:admitted-grant") ?? 0).toBeGreaterThan(1000);
    expect(outcomes.get("DelegatorPolicy:rejected") ?? 0).toBe(0);
    const refusals = total((entry) => entry.refusals);
    expect([...new Set([...refusals.keys()].map((key) => key.slice(0, key.indexOf(":"))))]).toEqual(["OverreachPolicy"]);
  });
});
