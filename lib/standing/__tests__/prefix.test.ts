import { describe, expect, it } from "vitest";
import { fold, mayCommit } from "../index.js";
import type { CommitRecord } from "../index.js";
import { judgeCommit } from "../verdict.js";
import {
  CHARTER,
  ORG,
  chunked,
  cutsOf,
  commit,
  commitEvent,
  g,
  logOf,
  mustAppend,
  mustFold,
  profileOf,
  report,
  revokeEvent,
  runWorld,
  SEEDS,
  COVERAGE_TIMEOUT_MS,
  SEED_LOOP_TIMEOUT_MS,
  STEPS,
  CHUNKS,
  isExhaustiveSeed,
} from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * PREFIX HINDSIGHT-INVARIANCE (plan §6 M5 "Falsifiable check" (3): "a commit's verdict recomputed from any prefix equals its
 * verdict in the full log").
 *
 * What the property says: the verdict on a commit is a function of the log up to the commit's own `seq` and of nothing
 * after it (plan D1: "fixed by the log prefix up to its own seq and never changes"). It is stated here three ways, because
 * each catches a different way of leaking the future into a verdict:
 *
 *   A. THE PREFIXES. For every seed, at a set of cut points, the verdict, the `seq` and the commitment of each commit that
 *      prefix holds are identical to the same commit's record in the full log. The cut points are EVERY prefix for every
 *      tenth seed (`isExhaustiveSeed`, 150 seeds), and for the rest the last prefix, every revoke and the event before it
 *      (the points where the tree changes), and eight evenly spaced ones. That is a sample, chosen for where a verdict could be disturbed; it
 *      is not every prefix of every seed, and the ADR says so.
 *   B. AT ITS OWN MOMENT. For a commit, `mayCommit` asked against the log as it stood just BEFORE the commit (so against
 *      exactly the information the verdict may use) returns the verdict the full log holds. This is the recomputation the
 *      plan names, done with the pre-check, and it shares nothing with `fold`'s own bookkeeping. Every commit of every
 *      tenth seed; for the rest, every commit whose chain was cut later (the ones hindsight could change) and every fifth
 *      of the others.
 *   C. THE LOG GROWS, IT IS NEVER REWRITTEN. Going from one cut point to the next no grant, revocation, charge or commit that
 *      was there changes, and each revocation keeps the `seq` it was written at (a revocation is recorded once: `revokedAt`
 *      is write-once because `already-dead` refuses a second revoke, not because the map is frozen).
 *
 *   D. THE FIRST FOUR RULES AGREE WITH AN INDEPENDENT READING. For every commit of every seed, read straight from the raw
 *      events that came BEFORE it (none of M3's walkers): the grant acted under, its holder, and the first link of its chain
 *      that already had a revoke. A warranted verdict must have none of the three problems; `no-such-grant`, `wrong-actor` and
 *      `link-dead` must each name what the reading finds; and a commit under an existing grant, by its holder, with a link
 *      already cut must be `link-dead` and no other verdict. The same for `capability-not-granted`. This is the one property
 *      over the generated logs that can see a `judgeCommit` that looks at too few links: without it, the hand-worked 8-link
 *      chain in `verdict-table.test.ts` was the only thing that did (ADR 0005, falsifiability log, rows P2 and V2 to V7),
 *      because M4's `checkHeadroom` refuses a dead grant and so a commit that missed a dead link still came out `void`.
 *
 * THE DOMAIN IS NOT EMPTY, shown rather than assumed: the coverage test counts the commits for which judging against the
 * FINAL tree (which is what hindsight would do) gives a different verdict from the one recorded at the commit, so the
 * property would fail for an engine that looked ahead. And a hand-worked pair below shows the mechanism on three events.
 */


interface Scan {
  readonly hindsight: string[];
  readonly atOwnMoment: string[];
  readonly growth: string[];
  readonly liveness: string[];
  readonly counts: {
    readonly seeds: number;
    readonly prefixes: number;
    readonly recordsCompared: number;
    readonly commitsRecomputed: number;
    /** Commits that judging against the final tree would rule differently from how they were ruled at the time. */
    readonly lateJudgementDiffers: number;
    readonly lateJudgementDiffersByKind: Record<string, number>;
    readonly inheritedAtEnd: number;
    readonly revokesChecked: number;
    readonly chargesGrew: number;
    /** link-dead verdicts by the index, along the chain, of the link named. */
    readonly linkDeadAtIndex: Record<number, number>;
    readonly linkDeadByChainLength: Record<number, number>;
    readonly independentChecked: number;
  };
}

/** One string per record that is equal exactly when the record is: the commitment, its seq and the whole verdict. */
function keyOf(record: CommitRecord<Cap>): string {
  const c = record.commit;
  const head = `${record.seq}|${c.id}|${c.actor}|${c.actedUnder}|${c.capability}|${c.amount}|`;
  const v = record.verdict;
  return v.kind === "warranted" ? `${head}W|${v.warrant.chain.join(",")}|${v.warrant.trail.join(",")}` : `${head}B|${JSON.stringify(v.breach)}`;
}

const scans = chunked(SEEDS, CHUNKS, (first, last): Scan => {
  const hindsight: string[] = [];
  const atOwnMoment: string[] = [];
  const growth: string[] = [];
  const liveness: string[] = [];
  const linkDeadAtIndex: Record<number, number> = {};
  const linkDeadByChainLength: Record<number, number> = {};
  let independentChecked = 0;
  const lateByKind: Record<string, number> = {};
  let prefixes = 0;
  let recordsCompared = 0;
  let commitsRecomputed = 0;
  let lateJudgementDiffers = 0;
  let inheritedAtEnd = 0;
  let revokesChecked = 0;
  let chargesGrew = 0;

  for (let seed = first; seed <= last; seed++) {
    const exhaustive = isExhaustiveSeed(seed);
    const world = runWorld({ seed, steps: STEPS, profile: profileOf(seed) });
    const { charter, log } = world;
    const full = mustFold(charter, log);
    const fullKey = new Map([...full.commits].map(([id, record]) => [id, keyOf(record)]));

    // C compares each cut with the one before it; A compares each cut with the full log.
    let previous = mustFold(charter, []);
    for (const k of cutsOf(log, exhaustive)) {
      const result = fold(charter, log.slice(0, k));
      if (!result.ok) {
        growth.push(`seed ${seed}: prefix ${k} does not fold: ${JSON.stringify(result.fault)}`);
        continue;
      }
      const now = result.folded;
      prefixes += 1;

      if (now.head !== k) growth.push(`seed ${seed}: prefix ${k} has head ${now.head}`);

      // A: every commit this prefix holds is, in the full log, the same record.
      for (const [id, record] of now.commits) {
        recordsCompared += 1;
        const here = keyOf(record);
        if (fullKey.get(id) !== here) hindsight.push(`seed ${seed} prefix ${k} commit ${id}: ${here} here, ${fullKey.get(id)} in the full log`);
      }

      // C: nothing that was there has changed.
      for (const [id, seq] of previous.tree.revokedAt) {
        if (now.tree.revokedAt.get(id) !== seq) growth.push(`seed ${seed} prefix ${k}: revokedAt of ${id} was ${seq}, is ${now.tree.revokedAt.get(id)}`);
      }
      for (const [id, grant] of previous.tree.grants) {
        const kept = now.tree.grants.get(id);
        if (kept === undefined || kept.parent !== grant.parent || kept.grantor !== grant.grantor || kept.grantee !== grant.grantee || kept.limit !== grant.limit || kept.depth !== grant.depth) {
          growth.push(`seed ${seed} prefix ${k}: grant ${id} changed`);
        }
      }
      for (let index = 0; index < previous.charges.length; index++) {
        const before = previous.charges[index];
        const after = now.charges[index];
        if (before === undefined || after === undefined || before.grantId !== after.grantId || before.amount !== after.amount) {
          growth.push(`seed ${seed} prefix ${k}: charge ${index} changed`);
          break;
        }
      }
      if (now.charges.length > previous.charges.length) chargesGrew += 1;
      if (now.tree.revokedAt.size !== previous.tree.revokedAt.size) revokesChecked += 1;
      previous = now;
    }

    // B: recompute each commit's verdict from exactly the prefix before it.
    let commitIndex = 0;
    for (const event of log) {
      if (event.kind !== "commit") continue;
      commitIndex += 1;
      const recorded = full.commits.get(event.commit.id);
      const cutLater = recorded?.verdict.kind === "warranted" && recorded.verdict.warrant.chain.some((id) => full.tree.revokedAt.has(id));
      if (!exhaustive && !cutLater && commitIndex % 5 !== 0) continue;
      commitsRecomputed += 1;
      const asked = mayCommit(charter, log.slice(0, event.seq - 1), event.commit);
      if (recorded === undefined || !asked.ok || JSON.stringify(asked.verdict) !== JSON.stringify(recorded.verdict)) {
        atOwnMoment.push(`seed ${seed} commit ${event.commit.id} at seq ${event.seq}: mayCommit on the prefix before says ${JSON.stringify(asked)}, the full log says ${JSON.stringify(recorded?.verdict)}`);
      }
    }

    // D: the first four rules, against an independent reading of the events before each commit.
    const grantsSoFar = new Map<string, { parent: string | null; grantee: string; capabilities: readonly string[] }>();
    const cutsSoFar = new Map<string, number>();
    for (const event of log) {
      if (event.kind === "grant") grantsSoFar.set(event.grant.id, { parent: event.grant.parent, grantee: event.grant.grantee, capabilities: event.grant.capabilities });
      else if (event.kind === "revoke") {
        if (!cutsSoFar.has(event.grantId)) cutsSoFar.set(event.grantId, event.seq);
      } else {
        independentChecked += 1;
        const record = full.commits.get(event.commit.id);
        const verdict = record?.verdict;
        const c = event.commit;
        const where = `seed ${seed} commit ${c.id} at seq ${event.seq}`;
        const grant = grantsSoFar.get(c.actedUnder);
        const chain: string[] = [];
        for (let at: string | null = c.actedUnder, hops = 0; at !== null && hops < 64; hops++) {
          const link = grantsSoFar.get(at);
          if (link === undefined) break;
          chain.unshift(at);
          at = link.parent;
        }
        const deadIndex = chain.findIndex((id) => cutsSoFar.has(id));
        const dead = deadIndex < 0 ? undefined : { grantId: chain[deadIndex], atSeq: cutsSoFar.get(chain[deadIndex] ?? "") };
        const isHolder = grant !== undefined && grant.grantee === c.actor;
        let expected: string;
        if (grant === undefined) expected = "no-such-grant";
        else if (!isHolder) expected = "wrong-actor";
        else if (dead !== undefined) expected = `link-dead ${dead.grantId} ${dead.atSeq}`;
        else if (!grant.capabilities.includes(c.capability)) expected = "capability-not-granted";
        else expected = "later";
        const actual =
          verdict === undefined
            ? "missing"
            : verdict.kind === "warranted"
              ? "later"
              : verdict.breach.kind === "link-dead"
                ? `link-dead ${verdict.breach.grantId} ${verdict.breach.atSeq}`
                : ["no-such-grant", "wrong-actor", "capability-not-granted"].includes(verdict.breach.kind)
                  ? verdict.breach.kind
                  : "later";
        // `over-limit` is the fifth rule and depends on M4's accounting, so it is a "later" verdict here: the first four must
        // each have passed for it, and a warranted verdict is "later" as well.
        if (actual !== expected) liveness.push(`${where}: an independent reading of the log before it says ${expected}, the verdict is ${JSON.stringify(verdict)}`);
        if (expected.startsWith("link-dead") && deadIndex >= 0) {
          linkDeadAtIndex[deadIndex] = (linkDeadAtIndex[deadIndex] ?? 0) + 1;
          linkDeadByChainLength[chain.length] = (linkDeadByChainLength[chain.length] ?? 0) + 1;
        }
      }
    }

    // The domain: how many commits would hindsight rule differently?
    for (const record of full.commits.values()) {
      const late = judgeCommit(full.tree, full.charges, record.commit);
      if (JSON.stringify(late) !== JSON.stringify(record.verdict)) {
        lateJudgementDiffers += 1;
        const label = `${record.verdict.kind}${record.verdict.kind === "breached" ? `:${record.verdict.breach.kind}` : ""} -> ${late.kind}${late.kind === "breached" ? `:${late.breach.kind}` : ""}`;
        lateByKind[label] = (lateByKind[label] ?? 0) + 1;
      }
      if (record.verdict.kind === "warranted" && record.verdict.warrant.chain.some((id) => full.tree.revokedAt.has(id))) inheritedAtEnd += 1;
    }
  }

  return {
    hindsight,
    atOwnMoment,
    growth,
    liveness,
    counts: { seeds: last - first + 1, prefixes, recordsCompared, commitsRecomputed, lateJudgementDiffers, lateJudgementDiffersByKind: lateByKind, inheritedAtEnd, revokesChecked, chargesGrew, linkDeadAtIndex, linkDeadByChainLength, independentChecked },
  };
});

describe("hindsight: three events show the mechanism", () => {
  it("a commit made before a revoke keeps its verdict, and the same commit made after is link-dead", () => {
    const before = logOf(CHARTER, [...ORG, commitEvent(commit("early", "buyer", "G3", "purchase", 10))]);
    const after = mustAppend(CHARTER, before, revokeEvent("G2", "cfo")).log;

    // The revoke is event 6; the early commit is event 5 and is warranted in the log without it and in the log with it.
    const early = (log: typeof after) => mustFold(CHARTER, log).commits.get(commit("early", "buyer", "G3", "purchase", 10).id)?.verdict;
    expect(early(before)?.kind).toBe("warranted");
    expect(early(after)).toStrictEqual(early(before));

    // The same commit, made after the revoke, is void for a link that was cut before it.
    const late = mustAppend(CHARTER, after, commitEvent(commit("late", "buyer", "G3", "purchase", 10)));
    expect(late.verdict).toStrictEqual({ kind: "breached", breach: { kind: "link-dead", grantId: g("G2"), atSeq: 6 } });
  });

  it("judging the early commit against the FINAL tree would rule it void: that is the hindsight the engine does not do", () => {
    const log = logOf(CHARTER, [...ORG, commitEvent(commit("early", "buyer", "G3", "purchase", 10)), revokeEvent("G2", "cfo")]);
    const folded = mustFold(CHARTER, log);
    const record = folded.commits.get(commit("early", "buyer", "G3", "purchase", 10).id);
    expect(record?.verdict.kind).toBe("warranted");
    expect(record === undefined ? undefined : judgeCommit(folded.tree, folded.charges, record.commit).kind).toBe("breached");
  });
});

describe(`prefix hindsight-invariance over ${SEEDS} generated logs of ${STEPS} events`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const [first, last] = scans.range(index);
    it(
      `seeds ${first} to ${last}: A, at each cut point every commit holds the record the full log holds`,
      () => {
        expect(scans.get(index).hindsight).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
    it(
      `seeds ${first} to ${last}: B, mayCommit on the log just before a commit returns the verdict the full log holds`,
      () => {
        expect(scans.get(index).atOwnMoment).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
    it(
      `seeds ${first} to ${last}: C, from one cut point to the next nothing that was there changes, and every prefix folds`,
      () => {
        expect(scans.get(index).growth).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
    it(
      `seeds ${first} to ${last}: D, no-such-grant, wrong-actor, link-dead and capability-not-granted are what an independent reading of the events before each commit says`,
      () => {
        expect(scans.get(index).liveness).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
  }

  it(
    "coverage: the property was not run over an empty domain, and hindsight would have been caught",
    () => {
      const sum = { seeds: 0, prefixes: 0, recordsCompared: 0, commitsRecomputed: 0, lateJudgementDiffers: 0, inheritedAtEnd: 0, revokesChecked: 0, chargesGrew: 0, independentChecked: 0 };
      const byKind: Record<string, number> = {};
      const deadAtIndex: Record<number, number> = {};
      const deadByLength: Record<number, number> = {};
      for (let index = 0; index < CHUNKS; index++) {
        const counts = scans.get(index).counts;
        for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += counts[key];
        for (const [label, value] of Object.entries(counts.lateJudgementDiffersByKind)) byKind[label] = (byKind[label] ?? 0) + value;
        for (const [key, value] of Object.entries(counts.linkDeadAtIndex)) deadAtIndex[Number(key)] = (deadAtIndex[Number(key)] ?? 0) + value;
        for (const [key, value] of Object.entries(counts.linkDeadByChainLength)) deadByLength[Number(key)] = (deadByLength[Number(key)] ?? 0) + value;
      }
      report("prefix", { ...sum, byKind, deadAtIndex, deadByLength });
      expect(sum.seeds).toBe(SEEDS);
      expect(sum.prefixes).toBeGreaterThanOrEqual(10_000);
      expect(sum.recordsCompared).toBeGreaterThanOrEqual(280_000);
      expect(sum.commitsRecomputed).toBeGreaterThanOrEqual(12_000);
      expect(sum.revokesChecked).toBeGreaterThanOrEqual(2_000);
      expect(sum.chargesGrew).toBeGreaterThanOrEqual(6_000);
      // Judging against the final tree would change a good many verdicts, in BOTH directions the plan cares about: a
      // warranted act that becomes void (a link cut later), and an act that was void that would become warranted.
      expect(sum.lateJudgementDiffers).toBeGreaterThanOrEqual(10_000);
      expect(sum.inheritedAtEnd).toBeGreaterThanOrEqual(6_000);
      expect(byKind["warranted -> breached:link-dead"] ?? 0).toBeGreaterThanOrEqual(6_000);
      // D was run over every commit, and the link-dead verdicts it checked named a link at every position of a chain and sat on
      // chains of every length, down to the longest the bound allows.
      expect(sum.independentChecked).toBeGreaterThanOrEqual(26_000);
      // (The leaf, index 7, is the rare one: 3 in the whole run. The hand-worked chain in verdict-table.test.ts pins it exactly.)
      for (let position = 0; position < 8; position++) expect(deadAtIndex[position] ?? 0, `link-dead naming the link at index ${position}`).toBeGreaterThanOrEqual(position === 7 ? 1 : 7);
      for (let length = 1; length <= 8; length++) expect(deadByLength[length] ?? 0, `link-dead on a chain of ${length}`).toBeGreaterThanOrEqual(19);
    },
    COVERAGE_TIMEOUT_MS,
  );
});
