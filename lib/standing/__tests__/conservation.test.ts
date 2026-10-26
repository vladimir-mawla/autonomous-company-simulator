import { describe, expect, it } from "vitest";
import { headroomOf } from "../../allowance/index.js";
import { liveByData, subtreeOwnByData } from "../../allowance/__tests__/fixtures.js";
import type { GrantId } from "../../contracts/index.js";
import { standings } from "../index.js";
import {
  CHARTER,
  DEEP_LENGTH,
  ORG,
  SEEDS,
  COVERAGE_TIMEOUT_MS,
  SEED_LOOP_TIMEOUT_MS,
  STEPS,
  chunked,
  commit,
  commitEvent,
  cutsOf,
  g,
  logOf,
  mustAppend,
  mustFold,
  profileOf,
  report,
  revokeEvent,
  runWorld,
  CHUNKS,
  isExhaustiveSeed,
} from "./fixtures.js";

/**
 * CONSERVATION ON THE WHOLE SYSTEM (plan §4.4: "Conservation theorem (what M4/M5 test): at every prefix, for every live g,
 * headroom(g) >= 0; for every root grant R, subtreeOwn(R) <= limit(R)").
 *
 * M4 proves the arithmetic on its own driver. What only M5 can show is that the ENGINE feeds that arithmetic correctly: that
 * a charge exists for exactly the commits ruled `warranted`, and for no commit ruled `void`. So over the cut points of 1 500
 * generated logs, and with M4's functions for headroom and M4's independent oracle for `subtreeOwn` and liveness:
 *
 *   1. every live grant has headroom >= 0, and every root grant's `subtreeOwn` is at most its limit;
 *   2. the charges are EXACTLY the warranted commits, in order, each for the grant acted under and for its amount: a `void`
 *      commit is recorded and charges nothing (plan §4.2, the `void` row, "What it refuses": "to charge any allowance");
 *   3. for each root grant R, the amounts of the `binding` and `inherited` commits whose chain starts at R add up to
 *      exactly `subtreeOwn(R)`, computed from the raw charges by the oracle and from the standings by the engine, so a
 *      spent amount is neither lost when a link is cut nor counted twice (plan §4.1: "spent authority is never forgiven");
 *   4. `subtreeOwn` of each root never decreases from one cut point to the next.
 */


interface Scan {
  readonly failures: string[];
  readonly counts: {
    readonly cuts: number;
    readonly liveGrantsChecked: number;
    readonly liveAtZero: number;
    readonly rootsChecked: number;
    readonly rootsAtLimit: number;
    readonly chargesChecked: number;
    readonly voidCommits: number;
    readonly chargesByChainLength: Record<number, number>;
    readonly rootSumsChecked: number;
    readonly rootSumsNonzero: number;
  };
}

const scans = chunked(SEEDS, CHUNKS, (first, last): Scan => {
  const failures: string[] = [];
  const chargesByChainLength: Record<number, number> = {};
  let cuts = 0;
  let liveGrantsChecked = 0;
  let liveAtZero = 0;
  let rootsChecked = 0;
  let rootsAtLimit = 0;
  let chargesChecked = 0;
  let voidCommits = 0;
  let rootSumsChecked = 0;
  let rootSumsNonzero = 0;

  for (let seed = first; seed <= last; seed++) {
    const world = runWorld({ seed, steps: STEPS, profile: profileOf(seed) });
    const { charter, log } = world;
    const lastRootTotals = new Map<GrantId, number>();

    for (const k of cutsOf(log, isExhaustiveSeed(seed))) {
      const folded = mustFold(charter, log.slice(0, k));
      const view = { tree: folded.tree, charges: folded.charges };
      cuts += 1;

      // 1. The theorem.
      for (const [id, grant] of folded.tree.grants) {
        if (liveByData(view, id)) {
          liveGrantsChecked += 1;
          const headroom = headroomOf(folded.tree, folded.charges, id);
          if (headroom === undefined || headroom < 0) failures.push(`seed ${seed} prefix ${k}: live grant ${id} has headroom ${headroom}`);
          if (headroom === 0) liveAtZero += 1;
        }
        if (grant.parent === null) {
          rootsChecked += 1;
          const owned = subtreeOwnByData(view, id);
          if (owned > grant.limit) failures.push(`seed ${seed} prefix ${k}: root ${id} has subtreeOwn ${owned} over its limit ${grant.limit}`);
          if (owned === grant.limit) rootsAtLimit += 1;
          // 4. Never decreases.
          if (owned < (lastRootTotals.get(id) ?? 0)) failures.push(`seed ${seed} prefix ${k}: root ${id} subtreeOwn went from ${lastRootTotals.get(id)} to ${owned}`);
          lastRootTotals.set(id, owned);
        }
      }

      // 2. The charges are exactly the warranted commits, in order.
      const warranted = [...folded.commits.values()].filter((record) => record.verdict.kind === "warranted");
      voidCommits += folded.commits.size - warranted.length;
      if (warranted.length !== folded.charges.length) failures.push(`seed ${seed} prefix ${k}: ${folded.charges.length} charges for ${warranted.length} warranted commits`);
      warranted.forEach((record, index) => {
        chargesChecked += 1;
        const charge = folded.charges[index];
        if (charge === undefined || charge.grantId !== record.commit.actedUnder || charge.amount !== record.commit.amount) {
          failures.push(`seed ${seed} prefix ${k}: charge ${index} is ${JSON.stringify(charge)}, the ${index}th warranted commit is ${record.commit.id} for ${record.commit.amount} under ${record.commit.actedUnder}`);
        }
        if (record.verdict.kind === "warranted" && k === log.length) {
          const length = record.verdict.warrant.chain.length;
          chargesByChainLength[length] = (chargesByChainLength[length] ?? 0) + 1;
        }
      });

      // 3. Per root grant, what the standings say is spent is what the charges say is spent.
      const result = standings(charter, log.slice(0, k));
      if (!result.ok) {
        failures.push(`seed ${seed} prefix ${k}: no standings`);
        continue;
      }
      const spentByRoot = new Map<GrantId, number>();
      for (const standing of result.standings) {
        if (standing.kind === "void") continue;
        const record = folded.commits.get(standing.commitId);
        const root = standing.warrant.chain[0];
        if (record === undefined || root === undefined) continue;
        spentByRoot.set(root, (spentByRoot.get(root) ?? 0) + record.commit.amount);
      }
      for (const [id, grant] of folded.tree.grants) {
        if (grant.parent !== null) continue;
        rootSumsChecked += 1;
        const fromStandings = spentByRoot.get(id) ?? 0;
        if (fromStandings > 0) rootSumsNonzero += 1;
        const fromCharges = subtreeOwnByData(view, id);
        if (fromStandings !== fromCharges) failures.push(`seed ${seed} prefix ${k}: root ${id}: binding and inherited commits add up to ${fromStandings}, the charges below it to ${fromCharges}`);
      }
    }
  }
  return {
    failures,
    counts: { cuts, liveGrantsChecked, liveAtZero, rootsChecked, rootsAtLimit, chargesChecked, voidCommits, chargesByChainLength, rootSumsChecked, rootSumsNonzero },
  };
});

describe("a void commit charges nothing and a revoke returns what was unspent: worked on plan section 7's org", () => {
  it("a breached commit is recorded and the grant's headroom is exactly what it was", () => {
    const base = logOf(CHARTER, ORG);
    const before = mustFold(CHARTER, base);
    const after = mustFold(CHARTER, mustAppend(CHARTER, base, commitEvent(commit("v", "ops", "G3", "purchase", 999))).log);
    expect(after.commits.get(commit("v", "x", "x", "purchase", 0).id)?.verdict.kind).toBe("breached");
    expect(after.charges).toHaveLength(0);
    for (const id of ["G1", "G2", "G3", "G4"]) {
      expect(headroomOf(after.tree, after.charges, g(id)), id).toBe(headroomOf(before.tree, before.charges, g(id)));
    }
  });

  it("revoking a grant that spent 700 of 1 000 returns exactly 300 to its parent and keeps 700 charged to it", () => {
    const base = logOf(CHARTER, [...ORG, commitEvent(commit("s", "buyer", "G3", "purchase", 700))]);
    const before = mustFold(CHARTER, base);
    const after = mustFold(CHARTER, mustAppend(CHARTER, base, revokeEvent("G3", "ops")).log);
    expect(headroomOf(before.tree, before.charges, g("G2"))).toBe(3_000); // 4 000 - 1 000 reserved
    expect(headroomOf(after.tree, after.charges, g("G2"))).toBe(3_300); // 4 000 - 700 spent
  });
});

describe(`conservation over ${SEEDS} generated logs of ${STEPS} events`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const [first, last] = scans.range(index);
    it(
      `seeds ${first} to ${last}: headroom is never negative, roots are never overspent, void commits charge nothing, and what the standings count is what was charged`,
      () => {
        expect(scans.get(index).failures).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
  }

  it(
    "coverage: the property was not run over an empty domain, and charges landed at every chain length",
    () => {
      const sum = { cuts: 0, liveGrantsChecked: 0, liveAtZero: 0, rootsChecked: 0, rootsAtLimit: 0, chargesChecked: 0, voidCommits: 0, rootSumsChecked: 0, rootSumsNonzero: 0 };
      const byLength: Record<number, number> = {};
      for (let index = 0; index < CHUNKS; index++) {
        const counts = scans.get(index).counts;
        for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += counts[key];
        for (const [key, value] of Object.entries(counts.chargesByChainLength)) byLength[Number(key)] = (byLength[Number(key)] ?? 0) + value;
      }
      report("conservation", { ...sum, byLength });
      expect(sum.cuts).toBeGreaterThanOrEqual(10_000);
      expect(sum.liveGrantsChecked).toBeGreaterThanOrEqual(100_000);
      expect(sum.liveAtZero).toBeGreaterThanOrEqual(40_000);
      expect(sum.rootsAtLimit).toBeGreaterThanOrEqual(5_000);
      expect(sum.voidCommits).toBeGreaterThanOrEqual(70_000);
      expect(sum.chargesChecked).toBeGreaterThanOrEqual(200_000);
      expect(sum.rootSumsNonzero).toBeGreaterThanOrEqual(20_000);
      // A charge landed on a chain of every length, down to the longest the bound allows (ADR 0004: on seeds 1 to 40 of M4's driver no charge above 0 landed on a line longer than five grants).
      for (let length = 1; length <= DEEP_LENGTH; length++) expect(byLength[length] ?? 0, `charges on a chain of ${length}`).toBeGreaterThanOrEqual(300);
    },
    COVERAGE_TIMEOUT_MS,
  );
});
