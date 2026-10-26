import { describe, expect, it } from "vitest";
import type { EventInput, Log } from "../../contracts/index.js";
import { append, standings } from "../index.js";
import {
  CHARTER,
  ORG,
  SEEDS,
  COVERAGE_TIMEOUT_MS,
  SEED_LOOP_TIMEOUT_MS,
  STEPS,
  chunked,
  cloneJson,
  commit,
  commitEvent,
  deepFreeze,
  grant,
  logOf,
  mustAppend,
  mustFold,
  profileOf,
  report,
  revokeEvent,
  runWorld,
  snapshotOf,
  CHUNKS,
} from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * REPLAY: the log is the only state (plan §3 D3, §5, §6 M5 "Falsifiable check" (3): "replay determinism; `append`-built ==
 * `fold`").
 *
 *   1. DETERMINISM. Over 1 500 generated logs: folding twice, folding a JSON copy of the log and the charter (so none of the
 *      original's objects), and folding a deep-frozen copy (so a fold that writes to its input throws) all give the same
 *      state, including the ORDER of the maps. `standings` twice gives the same list.
 *   2. APPEND-BUILT == INCREMENTAL == FOLD. The same proposals are offered to the public `append` (which replays the whole log
 *      for every event) and to the incremental engine the other files use; the logs and every attempt's outcome must be
 *      identical for every seed, which is what licenses the other files' use of the cheap engine. Then `fold` of the log
 *      `append` built must succeed and give, for every admitted commit, the verdict `append` returned, and a tree and
 *      charges equal to what the generator saw admitted.
 *   3. A CALLER CANNOT CHOOSE `seq` (plan D3, §6 M5 "Must refuse"): whatever is in an input's `seq`, from every value class,
 *      the event is stamped `head + 1`, and no other key of the input reaches the log.
 *   4. `append` GIVES BACK NEW OBJECTS: no event of the returned log is an event of the log passed in, and changing the
 *      input's `commit` or emptying the old log after the call does not change the returned log.
 */


interface Scan {
  readonly determinism: string[];
  readonly engines: string[];
  readonly fold: string[];
  readonly counts: {
    readonly seeds: number;
    readonly events: number;
    readonly attempts: number;
    readonly admittedCommits: number;
    readonly frozenFolds: number;
    readonly rejectedAttempts: number;
  };
}

const scans = chunked(SEEDS, CHUNKS, (first, last): Scan => {
  const determinism: string[] = [];
  const engines: string[] = [];
  const foldProblems: string[] = [];
  let events = 0;
  let attempts = 0;
  let admittedCommits = 0;
  let frozenFolds = 0;
  let rejectedAttempts = 0;

  for (let seed = first; seed <= last; seed++) {
    const profile = profileOf(seed);
    const world = runWorld({ seed, steps: STEPS, profile });
    const { charter, log } = world;
    events += log.length;
    attempts += world.attempts.length;

    // 1. Determinism.
    const folded = mustFold(charter, log);
    const snapshot = JSON.stringify(snapshotOf(folded));
    if (JSON.stringify(snapshotOf(mustFold(charter, log))) !== snapshot) determinism.push(`seed ${seed}: two folds of the same log differ`);
    const copy = cloneJson({ charter, log });
    if (JSON.stringify(snapshotOf(mustFold(copy.charter, copy.log))) !== snapshot) determinism.push(`seed ${seed}: a JSON copy of the log and charter folds differently`);
    const frozen = deepFreeze(cloneJson({ charter, log }));
    frozenFolds += 1;
    if (JSON.stringify(snapshotOf(mustFold(frozen.charter, frozen.log))) !== snapshot) determinism.push(`seed ${seed}: a frozen copy folds differently`);
    const first1 = standings(charter, log);
    const second = standings(charter, log);
    if (JSON.stringify(first1) !== JSON.stringify(second)) determinism.push(`seed ${seed}: standings of the same log differ`);

    // 2. The public append builds the same world as the incremental engine, outcome for outcome.
    const viaAppend = runWorld({ seed, steps: STEPS, profile, engine: "append" });
    if (JSON.stringify(viaAppend.log) !== JSON.stringify(log)) engines.push(`seed ${seed}: the log append built differs from the incremental one`);
    if (viaAppend.attempts.length !== world.attempts.length) engines.push(`seed ${seed}: ${viaAppend.attempts.length} attempts against ${world.attempts.length}`);
    for (let index = 0; index < world.attempts.length; index++) {
      const a = world.attempts[index];
      const b = viaAppend.attempts[index];
      if (a === undefined || b === undefined || JSON.stringify(a.outcome) !== JSON.stringify(b.outcome) || a.logLength !== b.logLength) {
        engines.push(`seed ${seed} step ${index}: ${JSON.stringify(a?.outcome)} incremental, ${JSON.stringify(b?.outcome)} through append`);
        break;
      }
      if (!a.outcome.ok) rejectedAttempts += 1;
    }

    // ... and fold of that log agrees with what append said and with what the generator saw admitted.
    log.forEach((event, index) => {
      if (event.seq !== index + 1) foldProblems.push(`seed ${seed}: event ${index} has seq ${event.seq}`);
    });
    if (folded.head !== log.length) foldProblems.push(`seed ${seed}: head ${folded.head} for a log of ${log.length}`);
    for (const attempt of world.attempts) {
      if (!attempt.outcome.ok || attempt.outcome.event.kind !== "commit") continue;
      admittedCommits += 1;
      const record = folded.commits.get(attempt.outcome.event.commit.id);
      if (record === undefined || JSON.stringify(record.verdict) !== JSON.stringify(attempt.outcome.verdict) || record.seq !== attempt.outcome.event.seq) {
        foldProblems.push(`seed ${seed} step ${attempt.step}: append returned ${JSON.stringify(attempt.outcome.verdict)} at ${attempt.outcome.event.seq}, fold has ${JSON.stringify(record)}`);
      }
    }
    if (JSON.stringify([...folded.tree.grants]) !== JSON.stringify([...world.mirror.grants])) foldProblems.push(`seed ${seed}: the grants fold rebuilt differ from the admitted ones`);
    if (JSON.stringify([...folded.tree.revokedAt]) !== JSON.stringify([...world.mirror.revokedAt])) foldProblems.push(`seed ${seed}: the revocations fold rebuilt differ from the admitted ones`);
    if (JSON.stringify(folded.charges) !== JSON.stringify(world.mirror.charges)) foldProblems.push(`seed ${seed}: the charges fold rebuilt differ from the admitted ones`);
  }
  return { determinism, engines, fold: foldProblems, counts: { seeds: last - first + 1, events, attempts, admittedCommits, frozenFolds, rejectedAttempts } };
});

describe(`replay over ${SEEDS} generated logs of ${STEPS} events`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const [first, last] = scans.range(index);
    it(
      `seeds ${first} to ${last}: folding is deterministic, on a copy, and on a frozen copy that it cannot write to`,
      () => {
        expect(scans.get(index).determinism).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
    it(
      `seeds ${first} to ${last}: the log the public append builds is the one the incremental engine builds, outcome for outcome`,
      () => {
        expect(scans.get(index).engines).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
    it(
      `seeds ${first} to ${last}: fold of the append-built log agrees with every verdict append returned, with its seqs, and with the admitted tree and charges`,
      () => {
        expect(scans.get(index).fold).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
  }

  it(
    "coverage: the property was not run over an empty domain",
    () => {
      const sum = { seeds: 0, events: 0, attempts: 0, admittedCommits: 0, frozenFolds: 0, rejectedAttempts: 0 };
      for (let index = 0; index < CHUNKS; index++) {
        const counts = scans.get(index).counts;
        for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += counts[key];
      }
      report("replay", sum);
      expect(sum.seeds).toBe(SEEDS);
      expect(sum.attempts).toBe(SEEDS * STEPS);
      expect(sum.events).toBeGreaterThanOrEqual(40_000);
      expect(sum.admittedCommits).toBeGreaterThanOrEqual(26_000);
      expect(sum.rejectedAttempts).toBeGreaterThanOrEqual(10_000);
      expect(sum.frozenFolds).toBe(SEEDS);
    },
    COVERAGE_TIMEOUT_MS,
  );
});

describe("a caller cannot choose seq, and no other key of an input reaches the log", () => {
  const BASE = logOf(CHARTER, ORG);
  const head = BASE.length;

  // `seq` taken from every value class, as a first read: null, 0, a negative, the largest, NaN, both infinities, a valid-looking
  // value (the real next seq, and one that is not), a boolean, a bigint, a symbol and a function.
  const SEQS: readonly [string, unknown][] = [
    ["null", null],
    ["0", 0],
    ["a negative", -3],
    ["the largest safe integer", Number.MAX_SAFE_INTEGER],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["the right next seq", head + 1],
    ["a seq in the past", 2],
    ["a seq far ahead", head + 50],
    ["a boolean", true],
    ["a bigint", 5n],
    ["a symbol", Symbol("seq")],
    ["a function", () => 7],
    ["a string", "5"],
    ["an object", { valueOf: () => 5 }],
  ];

  const INPUTS: readonly [string, EventInput<Cap>][] = [
    ["a grant", { kind: "grant", grant: grant({ id: "G9", parent: "G1", grantor: "cfo", grantee: "newhire", capabilities: ["purchase"], limit: 10, depth: 0 }) }],
    ["a commit", commitEvent(commit("k", "buyer", "G3", "purchase", 10))],
    ["a revoke", revokeEvent("G4", "cfo")],
  ];

  for (const [what, input] of INPUTS) {
    it(`${what} with a seq of any kind is stamped head + 1 and the logged event has no other key than its own`, () => {
      const expectedKeys = (event: object): string[] => Object.keys(event).sort();
      const clean = mustAppend(CHARTER, BASE, input);
      expect(clean.event.seq).toBe(head + 1);
      for (const [name, seq] of SEQS) {
        // Keys that belong to no event of this kind, and a `seq`; the input's own fields come after them so they win.
        const junk = {
          smuggled: "yes",
          ...(input.kind !== "grant" ? { grant: { id: "smuggled" } } : {}),
          ...(input.kind !== "commit" ? { commit: { id: "smuggled" } } : {}),
        };
        const offered = { ...junk, ...input, seq } as unknown as EventInput<Cap>;
        const result = append(CHARTER, BASE, offered);
        expect(result.ok, `seq ${name}`).toBe(true);
        if (!result.ok) continue;
        expect(result.event.seq, `seq ${name}`).toBe(head + 1);
        expect(result.log, `seq ${name}`).toHaveLength(head + 1);
        expect(result.log[head], `seq ${name}`).toStrictEqual(clean.event);
        expect(expectedKeys(result.event), `seq ${name}`).toStrictEqual(expectedKeys(clean.event));
      }
    });
  }

  it("a seq cannot back-date either: an event offered with a seq of 1 is still stamped at the end, and the old event 1 is untouched", () => {
    const result = mustAppend(CHARTER, BASE, { ...commitEvent(commit("k", "buyer", "G3", "purchase", 1)), seq: 1 } as unknown as EventInput<Cap>);
    expect(result.log[0]).toStrictEqual(BASE[0]);
    expect(result.log.map((event) => event.seq)).toStrictEqual([1, 2, 3, 4, 5]);
  });
});

describe("a fold's maps are its own: fresh for every call, and writing to one changes nothing else", () => {
  it("two folds of the same log return different Map objects, and writing through a cast to the first leaves the second and a third untouched", () => {
    const log = logOf(CHARTER, ORG);
    const first = mustFold(CHARTER, log);
    const second = mustFold(CHARTER, log);
    expect(first.tree.grants).not.toBe(second.tree.grants);
    expect(first.tree.revokedAt).not.toBe(second.tree.revokedAt);
    expect(first.commits).not.toBe(second.commits);
    expect(first.charges).not.toBe(second.charges);

    const before = JSON.stringify(snapshotOf(second));
    (first.tree.grants as Map<unknown, unknown>).clear();
    (first.tree.revokedAt as Map<unknown, unknown>).set("G1", 99);
    (first.charges as unknown[]).push({ grantId: "G1", amount: 1 });
    (first.commits as Map<unknown, unknown>).set("x", {});
    expect(JSON.stringify(snapshotOf(second))).toBe(before);
    expect(JSON.stringify(snapshotOf(mustFold(CHARTER, log)))).toBe(before);
  });
});

describe("append gives back new objects", () => {
  it("the returned log shares no event object with the log passed in, and the events are equal in content", () => {
    const base = logOf(CHARTER, ORG);
    const result = mustAppend(CHARTER, base, commitEvent(commit("k", "buyer", "G3", "purchase", 1)));
    expect(result.log).not.toBe(base);
    base.forEach((event, index) => {
      expect(result.log[index]).not.toBe(event);
      expect(result.log[index]).toStrictEqual(event);
    });
  });

  it("changing the input after the call, or the old log, does not change what append returned", () => {
    const base: Log<Cap>[number][] = [...logOf(CHARTER, ORG)];
    const input = { kind: "commit", commit: { id: "k", actor: "buyer", actedUnder: "G3", capability: "purchase", amount: 1 } };
    const result = append(CHARTER, base, input as unknown as EventInput<Cap>);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = JSON.stringify(result.log);
    input.commit.amount = 999;
    input.commit.actor = "someone-else";
    base.length = 0;
    expect(JSON.stringify(result.log)).toBe(before);
    expect(mustFold(CHARTER, result.log).commits.get(commit("k", "x", "x", "purchase", 0).id)?.commit.amount).toBe(1);
  });

  it("appending to the same log twice with the same input gives equal results (a log is a value, not a place)", () => {
    const base = logOf(CHARTER, ORG);
    const input = commitEvent(commit("k", "buyer", "G3", "purchase", 1));
    expect(append(CHARTER, base, input)).toStrictEqual(append(CHARTER, base, input));
    expect(base).toHaveLength(ORG.length);
  });
});
