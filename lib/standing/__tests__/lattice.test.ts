import { describe, expect, it } from "vitest";
import type { CommitId, Standing } from "../../contracts/index.js";
import { standingOf, standings } from "../index.js";
import {
  CHARTER,
  DEEP_LENGTH,
  chunked,
  commit,
  commitEvent,
  cutsOf,
  deepChainEvents,
  deepGrantor,
  deepHolder,
  cid,
  logOf,
  mustAppend,
  mustFold,
  profileOf,
  report,
  revokeEvent,
  revokeSeqs,
  runWorld,
  SEEDS,
  COVERAGE_TIMEOUT_MS,
  SEED_LOOP_TIMEOUT_MS,
  STEPS,
  CHUNKS,
  isExhaustiveSeed,
} from "./fixtures.js";

/**
 * THE STANDING LATTICE (plan §3 D1, §4.2, §6 M5 "Falsifiable check" (3)): "void -> void, binding -> {binding, inherited},
 * inherited -> inherited, never void from binding".
 *
 * `standings` of a log is "now" for that log, so the standing of one commit in a growing log is a sequence, one entry per
 * prefix, and the only moves the plan allows are on this table:
 *
 *                 later is: void    binding    inherited
 *   void                    yes     NEVER      NEVER       (and the standing is the SAME value: absorbing)
 *   binding                 NEVER   yes        yes         (a binding standing is unchanged until it is inherited)
 *   inherited               NEVER   NEVER      yes         (the warrant is unchanged; only the severed link and heir may climb)
 *
 * and a commit is born `binding` or `void`, never `inherited` (no link of its chain can have been cut when it is made).
 *
 * Over the cut points of `cutsOf` (every prefix for every tenth seed, `isExhaustiveSeed`, and a sample of where the tree changes
 * for the rest), for every pair of consecutive cut points, for every commit in both. The relation is transitive, so the pairs checked imply it between any two
 * cut points of a seed; a prefix that is not a cut point is not checked, and a state that broke the lattice only there would not be seen. What else is checked: that the kind of each standing agrees with an
 * independent reading of the log (a breached verdict is `void`; a warranted one is `inherited` exactly when a link of its
 * chain has a revoke in the log, read from the events and not from M3), that `standingOf` agrees with `standings` for the
 * same commit, and that `standings` is in `committedAt` order with one entry per commit.
 *
 * The longest chain gets a hand-worked ladder below: eight commits, one per link, the links cut from the leaf up.
 */


type Kind = Standing["kind"];

interface Scan {
  readonly violations: string[];
  readonly agreement: string[];
  readonly standingOfDisagreements: string[];
  readonly counts: {
    readonly pairs: number;
    readonly transitions: Record<string, number>;
    readonly births: Record<string, number>;
    readonly standingOfChecked: Record<string, number>;
    readonly kindsChecked: number;
  };
}

const scans = chunked(SEEDS, CHUNKS, (first, last): Scan => {
  const violations: string[] = [];
  const agreement: string[] = [];
  const standingOfDisagreements: string[] = [];
  const transitions: Record<string, number> = {};
  const births: Record<string, number> = {};
  const standingOfChecked: Record<string, number> = {};
  let pairs = 0;
  let kindsChecked = 0;

  for (let seed = first; seed <= last; seed++) {
    const exhaustive = isExhaustiveSeed(seed);
    const world = runWorld({ seed, steps: STEPS, profile: profileOf(seed) });
    const { charter, log } = world;

    let previous: ReadonlyMap<CommitId, Standing> | undefined;
    let previousCut = 0;
    for (const k of cutsOf(log, exhaustive)) {
      const prefix = log.slice(0, k);
      const result = standings(charter, prefix);
      if (!result.ok) {
        violations.push(`seed ${seed}: prefix ${k} has no standings: ${JSON.stringify(result.fault)}`);
        continue;
      }
      const now = new Map<CommitId, Standing>(result.standings.map((standing) => [standing.commitId, standing]));

      // One entry per commit, in committedAt order, and `head` is the prefix length.
      const folded = mustFold(charter, prefix);
      let last = 0;
      for (const standing of result.standings) {
        if (standing.committedAt <= last) violations.push(`seed ${seed} prefix ${k}: standings are not in committedAt order at ${standing.commitId}`);
        last = standing.committedAt;
        if (folded.commits.get(standing.commitId)?.seq !== standing.committedAt) violations.push(`seed ${seed} prefix ${k}: ${standing.commitId} committedAt is not its seq`);
      }
      if (result.standings.length !== folded.commits.size || result.head !== k) violations.push(`seed ${seed} prefix ${k}: ${result.standings.length} standings for ${folded.commits.size} commits, head ${result.head}`);

      // The kind of each standing, against an independent reading of the log.
      const cuts = revokeSeqs(prefix);
      for (const [id, record] of folded.commits) {
        const standing = now.get(id);
        const expected: Kind = record.verdict.kind === "breached" ? "void" : record.verdict.warrant.chain.some((link) => cuts.has(link)) ? "inherited" : "binding";
        kindsChecked += 1;
        if (standing?.kind !== expected) agreement.push(`seed ${seed} prefix ${k} commit ${id}: standing ${standing?.kind}, an independent reading says ${expected}`);
      }

      // The lattice, between this cut point and the one before it.
      if (previous !== undefined) {
        pairs += 1;
        const consecutive = k === previousCut + 1;
        for (const [id, before] of previous) {
          const after = now.get(id);
          if (after === undefined) {
            violations.push(`seed ${seed} prefix ${k}: ${id} was a ${before.kind} standing and is gone`);
            continue;
          }
          const label = `${before.kind}->${after.kind}`;
          transitions[label] = (transitions[label] ?? 0) + 1;
          if (after.committedAt !== before.committedAt) violations.push(`seed ${seed} prefix ${k} ${id}: committedAt moved`);

          if (before.kind === "void") {
            if (after.kind !== "void" || JSON.stringify(after) !== JSON.stringify(before)) violations.push(`seed ${seed} prefix ${k} ${id}: void became ${JSON.stringify(after)}`);
          } else if (before.kind === "binding") {
            if (after.kind === "void") violations.push(`seed ${seed} prefix ${k} ${id}: binding became void`);
            else if (JSON.stringify(after.warrant) !== JSON.stringify(before.warrant)) violations.push(`seed ${seed} prefix ${k} ${id}: the warrant changed`);
            else if (after.kind === "inherited" && after.severed.atSeq <= previousCut) violations.push(`seed ${seed} prefix ${k} ${id}: inherited by a revoke at ${after.severed.atSeq}, which was already in the prefix of ${previousCut}`);
          } else {
            if (after.kind !== "inherited") violations.push(`seed ${seed} prefix ${k} ${id}: inherited became ${after.kind}`);
            else if (JSON.stringify(after.warrant) !== JSON.stringify(before.warrant)) violations.push(`seed ${seed} prefix ${k} ${id}: the warrant changed`);
            else if (after.severed.grantId !== before.severed.grantId) {
              transitions["inherited->inherited (climbed)"] = (transitions["inherited->inherited (climbed)"] ?? 0) + 1;
            }
          }
        }
        // A commit born in a single step is binding or void, never inherited.
        if (consecutive) {
          for (const [id, born] of now) {
            if (previous.has(id)) continue;
            births[born.kind] = (births[born.kind] ?? 0) + 1;
            if (born.kind === "inherited") violations.push(`seed ${seed} prefix ${k} ${id}: born inherited`);
          }
        }
      }

      // `standingOf` against `standings` (one fold per call, so not at every cut): for the first commit of each kind at the
      // last cut point of every seed, and at the exhaustive seeds' other cut points for a third of those.
      const ofKind = new Map<Kind, CommitId>();
      for (const [id, standing] of now) if (!ofKind.has(standing.kind)) ofKind.set(standing.kind, id);
      let pick = 0;
      for (const [kind, id] of ofKind) {
        pick += 1;
        if (k !== log.length && !(exhaustive && (k + pick) % 3 === 0)) continue;
        const standing = now.get(id);
        const one = standingOf(charter, prefix, id);
        standingOfChecked[kind] = (standingOfChecked[kind] ?? 0) + 1;
        if (standing === undefined || !one.ok || JSON.stringify(one.standing) !== JSON.stringify(standing)) {
          standingOfDisagreements.push(`seed ${seed} prefix ${k} ${id}: standingOf says ${JSON.stringify(one)}, standings says ${JSON.stringify(standing)}`);
        }
      }

      previous = now;
      previousCut = k;
    }
  }
  return { violations, agreement, standingOfDisagreements, counts: { pairs, transitions, births, standingOfChecked, kindsChecked } };
});

describe(`the standing lattice over ${SEEDS} generated logs of ${STEPS} events`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const [first, last] = scans.range(index);
    it(
      `seeds ${first} to ${last}: only the moves of the lattice happen between cut points, void is the same value forever, and a commit is born binding or void`,
      () => {
        expect(scans.get(index).violations).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
    it(
      `seeds ${first} to ${last}: the kind of every standing agrees with an independent reading of the log`,
      () => {
        expect(scans.get(index).agreement).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
    it(
      `seeds ${first} to ${last}: standingOf of a commit is the entry standings has for it`,
      () => {
        expect(scans.get(index).standingOfDisagreements).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
  }

  it(
    "coverage: every move of the lattice happened, and the moves it forbids had the chance to",
    () => {
      const transitions: Record<string, number> = {};
      const births: Record<string, number> = {};
      const checked: Record<string, number> = {};
      let pairs = 0;
      let kinds = 0;
      for (let index = 0; index < CHUNKS; index++) {
        const counts = scans.get(index).counts;
        pairs += counts.pairs;
        kinds += counts.kindsChecked;
        for (const [key, value] of Object.entries(counts.transitions)) transitions[key] = (transitions[key] ?? 0) + value;
        for (const [key, value] of Object.entries(counts.births)) births[key] = (births[key] ?? 0) + value;
        for (const [key, value] of Object.entries(counts.standingOfChecked)) checked[key] = (checked[key] ?? 0) + value;
      }
      report("lattice", { pairs, kinds, transitions, births, checked });
      expect(pairs).toBeGreaterThanOrEqual(9_000);
      expect(kinds).toBeGreaterThanOrEqual(280_000);
      // The five legal moves, each many times.
      for (const move of ["void->void", "binding->binding", "binding->inherited", "inherited->inherited", "inherited->inherited (climbed)"]) {
        expect(transitions[move] ?? 0, move).toBeGreaterThanOrEqual(2_000);
      }
      // The four forbidden ones never happened (a forbidden move is also a violation in the tests above).
      for (const move of ["void->binding", "void->inherited", "binding->void", "inherited->void", "inherited->binding"]) {
        expect(transitions[move] ?? 0, move).toBe(0);
      }
      expect(births["binding"] ?? 0).toBeGreaterThanOrEqual(2_000);
      expect(births["void"] ?? 0).toBeGreaterThanOrEqual(700);
      for (const kind of ["binding", "inherited", "void"]) expect(checked[kind] ?? 0, `standingOf checked for ${kind}`).toBeGreaterThanOrEqual(1_000);
    },
    COVERAGE_TIMEOUT_MS,
  );
});

describe("void is absorbing on the longest chain: no later revoke at any level turns it into anything", () => {
  const CHAIN = deepChainEvents();
  const leaf = DEEP_LENGTH - 1;

  it("a commit that is void (a borrowed grant, a missing grant, an over-limit amount) is the same value after each of the 8 links is cut, leaf first", () => {
    let log = logOf(CHARTER, [
      ...CHAIN,
      commitEvent(commit("v-actor", deepGrantor(leaf), `D${leaf}`, "purchase", 1)), // wrong-actor: the leaf's grantor is not its holder
      commitEvent(commit("v-ghost", deepHolder(leaf), "g-ghost", "purchase", 1)), // no-such-grant
      commitEvent(commit("v-limit", deepHolder(leaf), `D${leaf}`, "purchase", 10_001)), // over-limit
      commitEvent(commit("ok", deepHolder(leaf), `D${leaf}`, "purchase", 1)), // warranted, for contrast
    ]);
    const voids = ["v-actor", "v-ghost", "v-limit"];
    const read = (): readonly Standing[] => {
      const result = standings(CHARTER, log);
      if (!result.ok) throw new Error("standings");
      return result.standings;
    };
    const first = JSON.stringify(read().filter((standing) => voids.includes(standing.commitId)));
    expect(read().filter((standing) => standing.kind === "void")).toHaveLength(3);

    for (let level = leaf; level >= 0; level--) {
      log = mustAppend(CHARTER, log, revokeEvent(`D${level}`, deepGrantor(level))).log;
      expect(JSON.stringify(read().filter((standing) => voids.includes(standing.commitId))), `after cutting D${level}`).toBe(first);
    }
    // And the one warranted commit went binding -> inherited and stayed inherited, with its heir climbing to the charter root.
    const ok = read().find((standing) => standing.commitId === cid("ok"));
    expect(ok?.kind).toBe("inherited");
  });

  it("a commit that is binding is binding until the first link of its chain is cut, then inherited, and a cut below it changes nothing", () => {
    let log = logOf(CHARTER, [...CHAIN, commitEvent(commit("mid", deepHolder(3), "D3", "purchase", 1))]);
    const kindOf = (): Kind | undefined => {
      const result = standingOf(CHARTER, log, cid("mid"));
      return result.ok ? result.standing.kind : undefined;
    };
    expect(kindOf()).toBe("binding");
    // D4 to D7 are BELOW the grant `mid` acted under, so cutting them is not on its chain.
    for (let level = leaf; level > 3; level--) {
      log = mustAppend(CHARTER, log, revokeEvent(`D${level}`, deepGrantor(level))).log;
      expect(kindOf(), `after cutting D${level}`).toBe("binding");
    }
    log = mustAppend(CHARTER, log, revokeEvent("D3", deepGrantor(3))).log;
    expect(kindOf()).toBe("inherited");
    for (let level = 2; level >= 0; level--) {
      log = mustAppend(CHARTER, log, revokeEvent(`D${level}`, deepGrantor(level))).log;
      expect(kindOf(), `after cutting D${level}`).toBe("inherited");
    }
  });

  it("the three kinds side by side on the same log: c1 binding, c2 inherited, c3 void", () => {
    const log = logOf(CHARTER, [
      ...CHAIN,
      commitEvent(commit("c1", deepHolder(0), "D0", "purchase", 1)),
      commitEvent(commit("c2", deepHolder(5), "D5", "purchase", 1)),
      revokeEvent("D4", deepGrantor(4)),
      commitEvent(commit("c3", deepHolder(5), "D5", "purchase", 1)),
    ]);
    const result = standings(CHARTER, log);
    expect(result.ok && result.standings.map((standing) => [standing.commitId, standing.kind])).toStrictEqual([
      [cid("c1"), "binding"],
      [cid("c2"), "inherited"],
      [cid("c3"), "void"],
    ]);
  });
});
