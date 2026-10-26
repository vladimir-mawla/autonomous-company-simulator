import { describe, expect, it } from "vitest";
import { chainOf } from "../../chain/index.js";
import type { Breach, GrantId, Log, LogEvent, Standing, Verdict } from "../../contracts/index.js";
import { fold, mayCommit, standings } from "../index.js";
import {
  CHARTER,
  SEEDS,
  COVERAGE_TIMEOUT_MS,
  SEED_LOOP_TIMEOUT_MS,
  STEPS,
  chunked,
  commit,
  commitEvent,
  g,
  grantEvent,
  grantsOf,
  logOf,
  mulberry32,
  mustFold,
  profileOf,
  report,
  revokeEvent,
  runWorld,
  CHUNKS,
} from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * LOCALITY (plan §6 M5 "The locality property, and the formulation I rejected").
 *
 * AS SPECIFIED: delete every commit outside `subtree(b)`. The remaining log must still replay admissibly, and every
 * verdict inside `subtree(b)` must be unchanged. In words: a grant's subtree depends only on its own commits and on the
 * grant and revoke structure; what the other agents committed cannot change what it is told. This is how this project
 * answers "the loudest agent winning": a noisy agent can only exhaust the allowance reserved for it.
 *
 * WHAT "THE SAME LOG" MEANS. Deleting events leaves a gap in `seq`, which `fold` refuses, so the survivors are renumbered
 * 1 to m in order. A verdict or standing that carries a `seq` (`link-dead.atSeq`, `committedAt`, `severed.atSeq`) is
 * compared through the map from old seq to new, so "unchanged" means unchanged except that the events moved up.
 *
 * AS FIRST DRAFTED (rejected, and shown to be false below): "deleting every commit under `subtree(a)` leaves verdicts under
 * any non-ancestral grant `b` unchanged". Deleting a commit under `a` can raise an ANCESTOR's headroom once `a` is revoked,
 * which turns an ancestor's `over-limit` commit into a warranted one, which charges the ancestor and leaves a LATER grant
 * with too little to reserve, so the shortened log no longer replays. The hand-worked case below is a log that
 * does this, and the property below tries the first formulation on every grant of every generated log and requires that
 * the generator finds some (it does: 30 of 24 539 deletions, every one an `over-allocation` at a later grant).
 *
 * `subtree(b)` is read from the raw grant events, not from M3.
 */


/** `b` and every grant below it, by repeated passes over the raw grant events until a pass adds nothing. */
function subtreeOf(log: Log<Cap>, root: GrantId): Set<GrantId> {
  const grants = grantsOf(log);
  const members = new Set<GrantId>([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, grant] of grants) {
      if (grant.parent !== null && members.has(grant.parent) && !members.has(id)) {
        members.add(id);
        grew = true;
      }
    }
  }
  return members;
}

interface Restricted {
  readonly log: Log<Cap>;
  /** Old seq to new seq, for every event that was kept. */
  readonly seqMap: ReadonlyMap<number, number>;
  readonly deleted: number;
}

/** Delete every commit for which `drop` says so, and renumber the rest. Grants and revokes are all kept. */
function without(log: Log<Cap>, drop: (actedUnder: GrantId) => boolean): Restricted {
  const seqMap = new Map<number, number>();
  const kept: LogEvent<Cap>[] = [];
  for (const event of log) {
    if (event.kind === "commit" && drop(event.commit.actedUnder)) continue;
    const seq = kept.length + 1;
    seqMap.set(event.seq, seq);
    kept.push({ ...event, seq });
  }
  return { log: kept, seqMap, deleted: log.length - kept.length };
}

const mapBreach = (breach: Breach, seqMap: ReadonlyMap<number, number>): Breach => (breach.kind === "link-dead" ? { ...breach, atSeq: seqMap.get(breach.atSeq) ?? -1 } : breach);
const mapVerdict = (verdict: Verdict, seqMap: ReadonlyMap<number, number>): Verdict => (verdict.kind === "breached" ? { kind: "breached", breach: mapBreach(verdict.breach, seqMap) } : verdict);
function mapStanding(standing: Standing, seqMap: ReadonlyMap<number, number>): Standing {
  const committedAt = seqMap.get(standing.committedAt) ?? -1;
  if (standing.kind === "void") return { ...standing, committedAt, breach: mapBreach(standing.breach, seqMap) };
  if (standing.kind === "inherited") return { ...standing, committedAt, severed: { ...standing.severed, atSeq: seqMap.get(standing.severed.atSeq) ?? -1 } };
  return { ...standing, committedAt };
}

describe("the rejected formulation is false: a log that shows it", () => {
  // G1 dana -> cfo, limit 100.  GA cfo -> ua, 50.  GB cfo -> ub, 30.  G1 has 100 - 50 - 30 = 20 left.
  const LOG = logOf(CHARTER, [
    grantEvent({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 100, depth: 2 }),
    grantEvent({ id: "GA", parent: "G1", grantor: "cfo", grantee: "ua", capabilities: ["purchase"], limit: 50, depth: 0 }),
    grantEvent({ id: "GB", parent: "G1", grantor: "cfo", grantee: "ub", capabilities: ["purchase"], limit: 30, depth: 0 }),
    commitEvent(commit("cA", "ua", "GA", "purchase", 40)), // under subtree(GA): warranted
    commitEvent(commit("cB", "ub", "GB", "purchase", 10)), // under subtree(GB): warranted
    revokeEvent("GA", "cfo"), // GA absorbs 40 and returns 10: G1 has 100 - 40 - 30 = 30 left
    commitEvent(commit("cX", "cfo", "G1", "purchase", 60)), // an ANCESTOR's commit: 60 > 30, so over-limit (void)
    grantEvent({ id: "GD", parent: "G1", grantor: "cfo", grantee: "ud", capabilities: ["purchase"], limit: 20, depth: 0 }), // 20 <= 30: admitted
  ]);

  it("the log as written replays: cX is void over-limit and GD is admitted", () => {
    const folded = mustFold(CHARTER, LOG);
    expect(folded.commits.get(commit("cX", "x", "x", "purchase", 0).id)?.verdict).toStrictEqual({
      kind: "breached",
      breach: { kind: "over-limit", grantId: g("G1"), requested: 60, headroom: 30 },
    });
    expect(folded.tree.grants.has(g("GD"))).toBe(true);
  });

  it("deleting the commits under subtree(GA) flips the ancestor's cX to warranted, and then GD is inadmissible: the first formulation fails", () => {
    const shorter = without(LOG, (actedUnder) => subtreeOf(LOG, g("GA")).has(actedUnder));
    expect(shorter.deleted).toBe(1);
    // The ancestor's commit now fits: asked at its own moment on the shorter log, it is warranted.
    const beforeCx = shorter.log.slice(0, shorter.log.findIndex((event) => event.kind === "commit" && event.commit.id === commit("cX", "x", "x", "purchase", 0).id));
    const asked = mayCommit(CHARTER, beforeCx, commit("cX", "cfo", "G1", "purchase", 60));
    expect(asked.ok && asked.verdict.kind).toBe("warranted");
    // And once it is charged, GD no longer fits: the shorter log does not replay.
    const result = fold(CHARTER, shorter.log);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fault).toStrictEqual({
        kind: "inadmissible-event",
        index: shorter.log.length - 1,
        rejection: { kind: "over-allocation", grantId: g("G1"), requested: 20, headroom: 10 },
      });
    }
  });

  it("the specified formulation holds for the same log: deleting every commit OUTSIDE subtree(GB) replays, and cB's verdict is unchanged", () => {
    const members = subtreeOf(LOG, g("GB"));
    expect([...members]).toStrictEqual(["GB"]);
    const kept = without(LOG, (actedUnder) => !members.has(actedUnder));
    expect(kept.deleted).toBe(2); // cA and cX
    const original = mustFold(CHARTER, LOG).commits.get(commit("cB", "x", "x", "purchase", 0).id);
    const reduced = mustFold(CHARTER, kept.log).commits.get(commit("cB", "x", "x", "purchase", 0).id);
    expect(reduced?.verdict).toStrictEqual(original?.verdict);
    expect(reduced?.verdict.kind).toBe("warranted");
  });

  it("and for subtree(GA): cA is warranted as before, though everything else is gone", () => {
    const members = subtreeOf(LOG, g("GA"));
    const kept = without(LOG, (actedUnder) => !members.has(actedUnder));
    const reduced = mustFold(CHARTER, kept.log).commits.get(commit("cA", "x", "x", "purchase", 0).id);
    expect(reduced?.verdict.kind).toBe("warranted");
    expect(mustFold(CHARTER, kept.log).commits.size).toBe(1);
  });
});

interface Scan {
  readonly failures: string[];
  readonly counts: {
    readonly pairs: number;
    readonly pairsWithKept: number;
    readonly pairsWithDeleted: number;
    readonly pairsDeletedUnderAncestor: number;
    readonly pairsWithInherited: number;
    readonly pairsWithVoid: number;
    readonly verdictsCompared: number;
    readonly standingsCompared: number;
    readonly bAtChainLength: Record<number, number>;
    readonly rejectedFormulationTried: number;
    readonly rejectedFormulationFailed: number;
    readonly rejectedFormulationFaults: Record<string, number>;
  };
}

const scans = chunked(SEEDS, CHUNKS, (first, last): Scan => {
  const failures: string[] = [];
  const bAtChainLength: Record<number, number> = {};
  let pairs = 0;
  let pairsWithKept = 0;
  let pairsWithDeleted = 0;
  let pairsDeletedUnderAncestor = 0;
  let pairsWithInherited = 0;
  let pairsWithVoid = 0;
  let verdictsCompared = 0;
  let standingsCompared = 0;
  let rejectedFormulationTried = 0;
  let rejectedFormulationFailed = 0;
  const rejectedFormulationFaults: Record<string, number> = {};

  for (let seed = first; seed <= last; seed++) {
    const world = runWorld({ seed, steps: STEPS, profile: profileOf(seed) });
    const { charter, log } = world;
    const full = mustFold(charter, log);
    const fullStandings = standings(charter, log);
    if (!fullStandings.ok) throw new Error("standings of a generated log");
    const standingById = new Map(fullStandings.standings.map((standing) => [standing.commitId, standing]));
    const random = mulberry32(seed * 104729 + 17);

    // The roots, the deepest grant, and up to six others drawn by the seed.
    const ids = [...full.tree.grants.keys()];
    if (ids.length === 0) continue;
    const chosen = new Set<GrantId>(ids.filter((id) => full.tree.grants.get(id)?.parent === null));
    const deepest = ids.reduce((best, id) => ((chainOf(full.tree, id)?.length ?? 0) > (chainOf(full.tree, best)?.length ?? 0) ? id : best), ids[0] as GrantId);
    chosen.add(deepest);
    for (let draw = 0; draw < 6; draw++) chosen.add(ids[Math.floor(random() * ids.length)] as GrantId);

    for (const b of chosen) {
      const members = subtreeOf(log, b);
      const restricted = without(log, (actedUnder) => !members.has(actedUnder));
      pairs += 1;
      bAtChainLength[chainOf(full.tree, b)?.length ?? 0] = (bAtChainLength[chainOf(full.tree, b)?.length ?? 0] ?? 0) + 1;
      if (restricted.deleted > 0) pairsWithDeleted += 1;

      const reduced = fold(charter, restricted.log);
      if (!reduced.ok) {
        failures.push(`seed ${seed} b ${b}: the log without the commits outside subtree(b) does not replay: ${JSON.stringify(reduced.fault)}`);
        continue;
      }
      const reducedStandings = standings(charter, restricted.log);
      if (!reducedStandings.ok) {
        failures.push(`seed ${seed} b ${b}: standings of the reduced log failed`);
        continue;
      }
      const reducedStandingById = new Map(reducedStandings.standings.map((standing) => [standing.commitId, standing]));

      // Which commits are inside subtree(b)?
      const inside = [...full.commits.values()].filter((record) => members.has(record.commit.actedUnder));
      if (inside.length > 0) pairsWithKept += 1;
      if (reduced.folded.commits.size !== inside.length) failures.push(`seed ${seed} b ${b}: the reduced log holds ${reduced.folded.commits.size} commits, subtree(b) has ${inside.length}`);

      // A commit deleted from under a strict ancestor of b: the case the rejected formulation got wrong.
      const ancestors = new Set(chainOf(full.tree, b)?.slice(0, -1));
      if ([...full.commits.values()].some((record) => ancestors.has(record.commit.actedUnder))) pairsDeletedUnderAncestor += 1;

      let sawInherited = false;
      let sawVoid = false;
      for (const record of inside) {
        const there = reduced.folded.commits.get(record.commit.id);
        verdictsCompared += 1;
        const expected = JSON.stringify(mapVerdict(record.verdict, restricted.seqMap));
        if (there === undefined || JSON.stringify(there.verdict) !== expected || there.seq !== restricted.seqMap.get(record.seq)) {
          failures.push(`seed ${seed} b ${b} commit ${record.commit.id}: verdict ${JSON.stringify(there?.verdict)} in the reduced log, expected ${expected}`);
        }
        const standing = standingById.get(record.commit.id);
        const kept = reducedStandingById.get(record.commit.id);
        standingsCompared += 1;
        if (standing === undefined || kept === undefined || JSON.stringify(kept) !== JSON.stringify(mapStanding(standing, restricted.seqMap))) {
          failures.push(`seed ${seed} b ${b} commit ${record.commit.id}: standing ${JSON.stringify(kept)} in the reduced log, expected ${JSON.stringify(standing)} through the seq map`);
        }
        if (standing?.kind === "inherited") sawInherited = true;
        if (standing?.kind === "void") sawVoid = true;
      }
      if (sawInherited) pairsWithInherited += 1;
      if (sawVoid) pairsWithVoid += 1;
    }

    // The first formulation, tried for EVERY grant `a` of the log: delete the commits under subtree(a) and replay.
    for (const a of ids) {
      const membersA = subtreeOf(log, a);
      const shorter = without(log, (actedUnder) => membersA.has(actedUnder));
      if (shorter.deleted === 0) continue;
      rejectedFormulationTried += 1;
      const replayed = fold(charter, shorter.log);
      if (!replayed.ok) {
        rejectedFormulationFailed += 1;
        const label = replayed.fault.kind === "inadmissible-event" ? `inadmissible-event:${replayed.fault.rejection.kind}` : replayed.fault.kind;
        rejectedFormulationFaults[label] = (rejectedFormulationFaults[label] ?? 0) + 1;
      }
    }
  }

  return {
    failures,
    counts: {
      pairs,
      pairsWithKept,
      pairsWithDeleted,
      pairsDeletedUnderAncestor,
      pairsWithInherited,
      pairsWithVoid,
      verdictsCompared,
      standingsCompared,
      bAtChainLength,
      rejectedFormulationTried,
      rejectedFormulationFailed,
      rejectedFormulationFaults,
    },
  };
});

describe(`locality over ${SEEDS} generated logs of ${STEPS} events`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const [first, last] = scans.range(index);
    it(
      `seeds ${first} to ${last}: deleting every commit outside subtree(b) leaves a log that replays and the verdicts and standings inside subtree(b) unchanged`,
      () => {
        expect(scans.get(index).failures).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
  }

  it(
    "coverage: the property was not run over an empty domain",
    () => {
      const sum = { pairs: 0, pairsWithKept: 0, pairsWithDeleted: 0, pairsDeletedUnderAncestor: 0, pairsWithInherited: 0, pairsWithVoid: 0, verdictsCompared: 0, standingsCompared: 0, rejectedFormulationTried: 0, rejectedFormulationFailed: 0 };
      const byLength: Record<number, number> = {};
      const faults: Record<string, number> = {};
      for (let index = 0; index < CHUNKS; index++) {
        const counts = scans.get(index).counts;
        for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += counts[key];
        for (const [key, value] of Object.entries(counts.rejectedFormulationFaults)) faults[key] = (faults[key] ?? 0) + value;
        for (const [key, value] of Object.entries(counts.bAtChainLength)) byLength[Number(key)] = (byLength[Number(key)] ?? 0) + value;
      }
      report("locality", { ...sum, byLength, faults });
      expect(sum.pairs).toBeGreaterThanOrEqual(4_000);
      expect(sum.pairsWithKept).toBeGreaterThanOrEqual(3_500);
      expect(sum.pairsWithDeleted).toBeGreaterThanOrEqual(4_000);
      // The interesting cases: something under an ancestor of b was deleted, and b's subtree has inherited and void standings.
      expect(sum.pairsDeletedUnderAncestor).toBeGreaterThanOrEqual(2_400);
      expect(sum.pairsWithInherited).toBeGreaterThanOrEqual(1_600);
      expect(sum.pairsWithVoid).toBeGreaterThanOrEqual(2_200);
      expect(sum.verdictsCompared).toBeGreaterThanOrEqual(36_000);
      expect(sum.standingsCompared).toBeGreaterThanOrEqual(36_000);
      // The first formulation is false in this generator too, by the mechanism the plan names: a later grant becomes
      // inadmissible (`over-allocation`) because a deleted commit had been keeping an ancestor's headroom down.
      expect(sum.rejectedFormulationTried).toBeGreaterThanOrEqual(8_000);
      expect(sum.rejectedFormulationFailed).toBeGreaterThanOrEqual(10);
      expect(faults["inadmissible-event:over-allocation"] ?? 0).toBe(sum.rejectedFormulationFailed);
      // b at every chain length, down to the longest the bound allows.
      for (let length = 1; length <= 8; length++) expect(byLength[length] ?? 0, `b on a chain of ${length}`).toBeGreaterThanOrEqual(140);
    },
    COVERAGE_TIMEOUT_MS,
  );
});
