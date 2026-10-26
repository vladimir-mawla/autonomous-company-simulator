import { describe, expect, it } from "vitest";
import type { Charter, CommitId, InheritedStanding, Log, Standing } from "../../contracts/index.js";
import { standings } from "../index.js";
import {
  CHARTER,
  CHARTER2,
  DEEP_LENGTH,
  ORG,
  SEEDS,
  COVERAGE_TIMEOUT_MS,
  SEED_LOOP_TIMEOUT_MS,
  STEPS,
  chunked,
  cid,
  commit,
  commitEvent,
  commitsOf,
  cutsOf,
  deepChainEvents,
  deepGrantor,
  deepHolder,
  g,
  grantsOf,
  logOf,
  mustAppend,
  p,
  profileOf,
  report,
  revokeEvent,
  revokeSeqs,
  runWorld,
  CHUNKS,
  isExhaustiveSeed,
} from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * THE HEIR (plan §3 D7, §4.2, §6 M5 "Falsifiable check" (3): "heir invariants: `severed.atSeq > committedAt`; `chargedTo`
 * null => heir in `charter.roots`, else `chargedTo` is live and `heir = grantee(chargedTo)`; and monotone climb (the severed
 * link's index along the chain never increases as the prefix grows)").
 *
 * Three layers, because each answers a different doubt:
 *
 *   1. A HAND-WORKED LADDER on the longest chain M3 admits (8 grants, MAX_ROOT_DEPTH + 1): eight commits, one per link, and
 *      the links cut from the leaf up. After each cut every standing is checked EXACTLY (severed link, heir, chargedTo,
 *      the revoke's seq), so a defect that only shows at a depth the generator rarely reaches shows here. The heir of the
 *      leaf's commit climbs seven levels, from the holder of link 6 to the charter root.
 *   2. WHO REVOKED IS IRRELEVANT (plan D7, failure case 11): the same cut by the charter root and by the grantor gives the
 *      same standings.
 *   3. THE INVARIANTS over the cut points of 1 500 generated logs, against an INDEPENDENT reading of the raw events: the
 *      first revoked link of the commit's chain is read from the revoke events, the chain and the trail from the grant
 *      events, so none of M3's walkers is trusted to check M5's use of them. Then the monotone climb across the cut points of
 *      each log.
 *
 * `severed.atSeq > committedAt` is checked against the commit's seq as the LOG gives it, and `heir` is checked three ways: it
 * is the grantor of the severed link, it is the trail principal at that link's index, and it is neither the actor nor
 * anyone below the break. That the heir's own authority is live (every link above the break is uncut) is checked too.
 */


const inheritedOf = (log: Log<Cap>): InheritedStanding[] => {
  const result = standings(CHARTER, log);
  if (!result.ok) throw new Error("standings");
  return result.standings.filter((standing): standing is InheritedStanding => standing.kind === "inherited");
};

const allStandings = (charter: Charter<Cap>, log: Log<Cap>): readonly Standing[] => {
  const result = standings(charter, log);
  if (!result.ok) throw new Error("standings");
  return result.standings;
};

describe("the ladder: cut the 8 links from the leaf up, and the heir of the leaf's commit climbs from d6 to dana", () => {
  const CHAIN = deepChainEvents();
  // c_i is made by the holder of D_i, under D_i, for 1.
  const COMMITS = Array.from({ length: DEEP_LENGTH }, (_, index) => commitEvent(commit(`c${index}`, deepHolder(index), `D${index}`, "purchase", 1)));

  it("after cutting D_j (leaf first), the commits at levels j to 7 are inherited with severed D_j, heir the grantor of D_j, chargedTo D_(j-1) or null, and the commits above are still binding", () => {
    let log = logOf(CHARTER, [...CHAIN, ...COMMITS]);
    const heirs: string[] = [];
    for (let cut = DEEP_LENGTH - 1; cut >= 0; cut--) {
      const revoke = mustAppend(CHARTER, log, revokeEvent(`D${cut}`, deepGrantor(cut)));
      log = revoke.log;
      const result = allStandings(CHARTER, log);
      expect(result).toHaveLength(DEEP_LENGTH);
      for (let level = 0; level < DEEP_LENGTH; level++) {
        const standing = result[level];
        const where = `D${cut} cut, commit c${level}`;
        expect(standing?.commitId, where).toBe(cid(`c${level}`));
        if (level < cut) {
          expect(standing?.kind, where).toBe("binding");
          continue;
        }
        expect(standing, where).toStrictEqual({
          kind: "inherited",
          commitId: cid(`c${level}`),
          committedAt: DEEP_LENGTH + level + 1,
          warrant: {
            chain: Array.from({ length: level + 1 }, (_, index) => g(`D${index}`)),
            trail: [p("dana"), ...Array.from({ length: level + 1 }, (_, index) => p(deepHolder(index)))],
          },
          severed: { grantId: g(`D${cut}`), atSeq: revoke.event.seq },
          heir: p(deepGrantor(cut)),
          chargedTo: cut === 0 ? null : g(`D${cut - 1}`),
        });
      }
      const leafStanding = result[DEEP_LENGTH - 1];
      heirs.push(leafStanding?.kind === "inherited" ? leafStanding.heir : "?");
    }
    // The heir of the leaf's commit, after each cut from the leaf up: the grantor of that link, one level higher every time.
    expect(heirs).toStrictEqual(["d6", "d5", "d4", "d3", "d2", "d1", "d0", "dana"]);
  });

  it("cut from the top first: every commit is inherited at once with heir dana and chargedTo null, and nothing below can be cut again", () => {
    const log = mustAppend(CHARTER, logOf(CHARTER, [...CHAIN, ...COMMITS]), revokeEvent("D0", "dana")).log;
    const inherited = inheritedOf(log);
    expect(inherited).toHaveLength(DEEP_LENGTH);
    for (const standing of inherited) {
      expect([standing.severed.grantId, standing.heir, standing.chargedTo]).toStrictEqual([g("D0"), p("dana"), null]);
    }
  });

  it("cut from the leaf up, then from the middle: the severed link moves up a link at a time and never down", () => {
    let log = logOf(CHARTER, [...CHAIN, ...COMMITS]);
    const seen: string[] = [];
    for (const cut of [7, 5, 3, 1]) {
      log = mustAppend(CHARTER, log, revokeEvent(`D${cut}`, deepGrantor(cut))).log;
      const leaf = inheritedOf(log).find((standing) => standing.commitId === cid("c7"));
      seen.push(leaf?.severed.grantId ?? "?");
    }
    expect(seen).toStrictEqual(["D7", "D5", "D3", "D1"]);
  });
});

describe("who revoked is irrelevant to who answers (plan D7, failure case 11)", () => {
  const BASE = [...ORG, commitEvent(commit("c", "buyer", "G3", "purchase", 100))];

  it("dana revoking G2 and cfo revoking G2 give the same standing, with heir cfo, the grantor of G2", () => {
    const byDana = inheritedOf(mustAppend(CHARTER, logOf(CHARTER, BASE), revokeEvent("G2", "dana")).log);
    const byCfo = inheritedOf(mustAppend(CHARTER, logOf(CHARTER, BASE), revokeEvent("G2", "cfo")).log);
    expect(byDana).toStrictEqual(byCfo);
    expect(byDana).toHaveLength(1);
    expect(byDana[0]?.heir).toBe("cfo");
    expect(byDana[0]?.chargedTo).toBe("G1");
  });

  it("the grantor of a link and every principal above it can cut it, and the heir is the grantor of the link each time, never the revoker", () => {
    for (const by of ["dana", "cfo"]) {
      const standing = inheritedOf(mustAppend(CHARTER, logOf(CHARTER, BASE), revokeEvent("G2", by)).log)[0];
      expect(standing?.heir, `revoked by ${by}`).toBe("cfo");
    }
    // Cutting the grant the commit acted under (G3, granted by ops): ops answers, whether ops or dana or cfo cut it.
    for (const by of ["dana", "cfo", "ops"]) {
      const standing = inheritedOf(mustAppend(CHARTER, logOf(CHARTER, BASE), revokeEvent("G3", by)).log)[0];
      expect([standing?.heir, standing?.chargedTo], `G3 revoked by ${by}`).toStrictEqual(["ops", "G2"]);
    }
  });

  it("a root grant is cut by its grantor, the charter root: that root answers, off the ledger (chargedTo null), and in a two-root charter the other root cannot cut it", () => {
    const standing = inheritedOf(mustAppend(CHARTER, logOf(CHARTER, BASE), revokeEvent("G1", "dana")).log)[0];
    expect([standing?.severed.grantId, standing?.heir, standing?.chargedTo]).toStrictEqual(["G1", "dana", null]);
    expect(mustAppend(CHARTER2, logOf(CHARTER2, BASE), revokeEvent("G1", "dana")).event.kind).toBe("revoke");
  });
});

// ---------------------------------------------------------------------------------------------------
// The invariants over generated logs
// ---------------------------------------------------------------------------------------------------

/** What an independent reading of the raw events of `prefix` says is wrong with an inherited standing, if anything. */
function problemsWith(charter: Charter<Cap>, prefix: Log<Cap>, standing: InheritedStanding): string[] {
  const problems: string[] = [];
  const grants = grantsOf(prefix);
  const cuts = revokeSeqs(prefix);
  const made = commitsOf(prefix).get(standing.commitId);
  if (made === undefined) return ["the commit is not in the log"];

  // The chain and the trail, rebuilt from the grant events.
  const chain: string[] = [];
  const grantors: string[] = [];
  const grantees: string[] = [];
  for (let current = grants.get(made.commit.actedUnder), hops = 0; current !== undefined && hops < 64; hops++) {
    chain.unshift(current.id);
    grantors.unshift(current.grantor);
    grantees.unshift(current.grantee);
    current = current.parent === null ? undefined : grants.get(current.parent);
  }
  if (JSON.stringify(chain) !== JSON.stringify(standing.warrant.chain)) problems.push(`the warrant's chain ${JSON.stringify(standing.warrant.chain)} is not the ancestry ${JSON.stringify(chain)}`);
  const trail = [grantors[0], ...grantees];
  if (JSON.stringify(trail) !== JSON.stringify(standing.warrant.trail)) problems.push(`the warrant's trail ${JSON.stringify(standing.warrant.trail)} is not ${JSON.stringify(trail)}`);

  // The first revoked link counting from the root.
  const index = chain.findIndex((link) => cuts.has(g(link)));
  if (index < 0) return [...problems, "no link of the chain is revoked in the log"];
  if (standing.severed.grantId !== chain[index]) problems.push(`severed ${standing.severed.grantId}, the first revoked link is ${chain[index]}`);
  if (standing.severed.atSeq !== cuts.get(g(chain[index] ?? ""))) problems.push(`severed.atSeq ${standing.severed.atSeq}, the revoke is at ${cuts.get(g(chain[index] ?? ""))}`);
  if (!(standing.severed.atSeq > standing.committedAt)) problems.push(`severed.atSeq ${standing.severed.atSeq} is not after committedAt ${standing.committedAt}`);
  if (standing.committedAt !== made.seq) problems.push("committedAt is not the commit's seq");

  // The heir: the grantor of that link, above the break, never the actor.
  if (standing.heir !== grantors[index]) problems.push(`heir ${standing.heir} is not the grantor ${grantors[index]} of ${chain[index]}`);
  if (standing.heir !== trail[index]) problems.push(`heir ${standing.heir} is not the trail principal ${trail[index]} at the break`);
  if (standing.heir === made.commit.actor) problems.push("the heir is the actor");
  if (trail.slice(index + 1).includes(standing.heir)) problems.push("the heir is below the break");
  if (chain.slice(0, index).some((link) => cuts.has(g(link)))) problems.push("a link above the break is revoked, so the heir's own authority is not live");

  // chargedTo.
  if (standing.chargedTo === null) {
    if (!charter.roots.includes(standing.heir)) problems.push(`chargedTo is null but the heir ${standing.heir} is not a charter root`);
    if (index !== 0) problems.push(`chargedTo is null but the break is at index ${index}`);
  } else {
    if (standing.chargedTo !== chain[index - 1]) problems.push(`chargedTo ${standing.chargedTo} is not the link above the break ${chain[index - 1]}`);
    if (cuts.has(standing.chargedTo) || chain.slice(0, index).some((link) => cuts.has(g(link)))) problems.push(`chargedTo ${standing.chargedTo} is not live`);
    if (grants.get(standing.chargedTo)?.grantee !== standing.heir) problems.push(`heir ${standing.heir} is not the grantee of chargedTo ${standing.chargedTo}`);
  }
  return problems;
}

interface Scan {
  readonly invariants: string[];
  readonly climb: string[];
  readonly counts: {
    readonly inheritedChecked: number;
    readonly severedAtIndex: Record<number, number>;
    readonly chainLength: Record<number, number>;
    readonly chargedToNull: number;
    readonly revokerIsHeir: number;
    readonly revokerAboveHeir: number;
    readonly climbDistance: Record<number, number>;
    readonly climbs: number;
  };
}

const scans = chunked(SEEDS, CHUNKS, (first, last): Scan => {
  const invariants: string[] = [];
  const climb: string[] = [];
  const severedAtIndex: Record<number, number> = {};
  const chainLength: Record<number, number> = {};
  const climbDistance: Record<number, number> = {};
  let inheritedChecked = 0;
  let chargedToNull = 0;
  let revokerIsHeir = 0;
  let revokerAboveHeir = 0;
  let climbs = 0;

  for (let seed = first; seed <= last; seed++) {
    const world = runWorld({ seed, steps: STEPS, profile: profileOf(seed) });
    const { charter, log } = world;
    const lastSeen = new Map<CommitId, { readonly index: number; readonly atSeq: number; readonly severed: string }>();
    const firstIndex = new Map<CommitId, number>();
    const lowest = new Map<CommitId, number>();

    for (const k of cutsOf(log, isExhaustiveSeed(seed))) {
      const prefix = log.slice(0, k);
      for (const standing of allStandings(charter, prefix)) {
        if (standing.kind !== "inherited") continue;
        inheritedChecked += 1;
        const found = problemsWith(charter, prefix, standing);
        for (const problem of found) invariants.push(`seed ${seed} prefix ${k} ${standing.commitId}: ${problem}`);

        const index = standing.warrant.chain.indexOf(standing.severed.grantId);
        if (k === log.length) {
          severedAtIndex[index] = (severedAtIndex[index] ?? 0) + 1;
          chainLength[standing.warrant.chain.length] = (chainLength[standing.warrant.chain.length] ?? 0) + 1;
          if (standing.chargedTo === null) chargedToNull += 1;
          const revoke = log.find((event) => event.kind === "revoke" && event.grantId === standing.severed.grantId);
          if (revoke?.kind === "revoke") {
            if (revoke.by === standing.heir) revokerIsHeir += 1;
            else if (standing.warrant.trail.indexOf(revoke.by) >= 0 && standing.warrant.trail.indexOf(revoke.by) < index) revokerAboveHeir += 1;
          }
        }

        // The monotone climb: the index never increases, the revoke's seq never decreases, and a change is a strict climb.
        const before = lastSeen.get(standing.commitId);
        if (before !== undefined) {
          if (index > before.index) climb.push(`seed ${seed} prefix ${k} ${standing.commitId}: severed index went from ${before.index} down to ${index}`);
          if (standing.severed.atSeq < before.atSeq) climb.push(`seed ${seed} prefix ${k} ${standing.commitId}: severed.atSeq went from ${before.atSeq} back to ${standing.severed.atSeq}`);
          if (standing.severed.grantId !== before.severed && !(index < before.index && standing.severed.atSeq > before.atSeq)) {
            climb.push(`seed ${seed} prefix ${k} ${standing.commitId}: the severed link changed from ${before.severed} to ${standing.severed.grantId} without a strict climb`);
          }
          if (standing.severed.grantId === before.severed && (index !== before.index || standing.severed.atSeq !== before.atSeq)) {
            climb.push(`seed ${seed} prefix ${k} ${standing.commitId}: the same severed link moved`);
          }
        } else {
          firstIndex.set(standing.commitId, index);
        }
        lastSeen.set(standing.commitId, { index, atSeq: standing.severed.atSeq, severed: standing.severed.grantId });
        lowest.set(standing.commitId, Math.min(lowest.get(standing.commitId) ?? index, index));
      }
    }
    for (const [id, first] of firstIndex) {
      const distance = first - (lowest.get(id) ?? first);
      climbDistance[distance] = (climbDistance[distance] ?? 0) + 1;
      if (distance > 0) climbs += 1;
    }
  }
  return { invariants, climb, counts: { inheritedChecked, severedAtIndex, chainLength, chargedToNull, revokerIsHeir, revokerAboveHeir, climbDistance, climbs } };
});

describe(`heir invariants over ${SEEDS} generated logs of ${STEPS} events`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const [first, last] = scans.range(index);
    it(
      `seeds ${first} to ${last}: every inherited standing at every cut point is what an independent reading of the log says`,
      () => {
        expect(scans.get(index).invariants).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
    it(
      `seeds ${first} to ${last}: monotone climb, the severed link only moves up the chain, and the revoke's seq only moves forward`,
      () => {
        expect(scans.get(index).climb).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
  }

  it(
    "coverage, with depth: the invariants were checked at every position of the chain, on the longest chain, and across climbs of up to 7 levels",
    () => {
      const severed: Record<number, number> = {};
      const lengths: Record<number, number> = {};
      const distances: Record<number, number> = {};
      let checked = 0;
      let nulls = 0;
      let revokerIsHeir = 0;
      let revokerAbove = 0;
      let climbs = 0;
      for (let index = 0; index < CHUNKS; index++) {
        const counts = scans.get(index).counts;
        checked += counts.inheritedChecked;
        nulls += counts.chargedToNull;
        revokerIsHeir += counts.revokerIsHeir;
        revokerAbove += counts.revokerAboveHeir;
        climbs += counts.climbs;
        for (const [key, value] of Object.entries(counts.severedAtIndex)) severed[Number(key)] = (severed[Number(key)] ?? 0) + value;
        for (const [key, value] of Object.entries(counts.chainLength)) lengths[Number(key)] = (lengths[Number(key)] ?? 0) + value;
        for (const [key, value] of Object.entries(counts.climbDistance)) distances[Number(key)] = (distances[Number(key)] ?? 0) + value;
      }
      report("heir", { checked, nulls, revokerIsHeir, revokerAbove, climbs, severed, lengths, distances });
      expect(checked).toBeGreaterThanOrEqual(50_000);
      // Severed at every position 0 to 7 of a chain, in the final log of some seed, many times each.
      // (The leaf, index 7, is the rare one: a commit under the leaf and nothing above it cut. The ladder above pins it exactly.)
      for (let position = 0; position < DEEP_LENGTH; position++) expect(severed[position] ?? 0, `severed at index ${position}`).toBeGreaterThanOrEqual(position === DEEP_LENGTH - 1 ? 10 : 100);
      // Inherited standings on chains of every length, down to the longest the bound allows.
      for (let length = 1; length <= DEEP_LENGTH; length++) expect(lengths[length] ?? 0, `inherited on a chain of ${length}`).toBeGreaterThanOrEqual(300);
      expect(nulls).toBeGreaterThanOrEqual(3_000);
      // The revoker was the heir, and was somebody above the heir, both many times: the heir does not depend on who revoked.
      expect(revokerIsHeir).toBeGreaterThanOrEqual(4_000);
      expect(revokerAbove).toBeGreaterThanOrEqual(1_500);
      // The heir climbed, and by how much: distances 1 to at least 5 levels were seen.
      expect(climbs).toBeGreaterThanOrEqual(1_700);
      for (let distance = 1; distance <= 4; distance++) expect(distances[distance] ?? 0, `climbed ${distance}`).toBeGreaterThanOrEqual(50);
      expect(Math.max(...Object.keys(distances).map(Number))).toBeGreaterThanOrEqual(6);
    },
    COVERAGE_TIMEOUT_MS,
  );
});
