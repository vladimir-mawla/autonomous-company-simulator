import { describe, expect, it } from "vitest";
import type { Commitment, EventInput, Log } from "../../contracts/index.js";
import { MAX_LOG_EVENTS } from "../../contracts/index.js";
import { append, mayCommit } from "../index.js";
import {
  CHARTER,
  ORG,
  SEEDS,
  SEED_LOOP_TIMEOUT_MS,
  STEPS,
  chunked,
  commit,
  commitEvent,
  logOf,
  mustAppend,
  profileOf,
  report,
  revokeEvent,
  runWorld,
} from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * `mayCommit` AGREES WITH `append` (plan D9: "one predicate, two call sites", §6 M5 "Falsifiable check" (3): "`mayCommit(c)`
 * verdict == the verdict `append(c)` records").
 *
 * The strongest statement is the one tested: for every commit offered to `append` in a generated log, `mayCommit` asked of the
 * log as it stood at that moment gives the SAME RESULT, not just the same verdict. If `append` recorded the commit the result
 * is `ok` with the verdict `append` returned (a breached verdict included: `ok` means the commit could be judged, and the
 * answer is in the verdict); if `append` refused it, the result is `ok: false` with the identical failure (a malformed commit,
 * a duplicate id, an unknown capability).
 *
 * The cases the generator might not hit squarely are tabled below: the exact boundary (a commit of exactly the headroom and
 * one more), and every way the whole log can be unusable (an invalid charter, a log with a gap, a hostile commit, a log at
 * `MAX_LOG_EVENTS`), where `mayCommit` must give the failure `append` gives.
 */

const CHUNKS = 10;

interface Scan {
  readonly disagreements: string[];
  readonly counts: {
    readonly compared: number;
    readonly byResult: Record<string, number>;
  };
}

const scans = chunked(SEEDS, CHUNKS, (first, last): Scan => {
  const disagreements: string[] = [];
  const byResult: Record<string, number> = {};
  let compared = 0;

  for (let seed = first; seed <= last; seed++) {
    const world = runWorld({ seed, steps: STEPS, profile: profileOf(seed) });
    for (const attempt of world.attempts) {
      const input = attempt.input as { kind?: unknown; commit?: unknown };
      if (input.kind !== "commit" || typeof input.commit !== "object" || input.commit === null) continue;

      const prefix = world.log.slice(0, attempt.logLength);
      const asked = mayCommit(world.charter, prefix, input.commit as Commitment<Cap>);
      compared += 1;

      const label = attempt.outcome.ok
        ? attempt.outcome.verdict?.kind === "breached"
          ? `breached:${attempt.outcome.verdict.breach.kind}`
          : "warranted"
        : attempt.outcome.failure.kind === "rejected"
          ? `rejected:${attempt.outcome.failure.rejection.kind}`
          : `faulty-log:${attempt.outcome.failure.fault.kind}`;
      byResult[label] = (byResult[label] ?? 0) + 1;

      const same = attempt.outcome.ok
        ? asked.ok && JSON.stringify(asked.verdict) === JSON.stringify(attempt.outcome.verdict)
        : !asked.ok && JSON.stringify(asked.failure) === JSON.stringify(attempt.outcome.failure);
      if (!same) disagreements.push(`seed ${seed} step ${attempt.step}: append said ${JSON.stringify(attempt.outcome)}, mayCommit said ${JSON.stringify(asked)}`);
    }
  }
  return { disagreements, counts: { compared, byResult } };
});

describe(`mayCommit and append over ${SEEDS} generated logs of ${STEPS} events`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const [first, last] = scans.range(index);
    it(
      `seeds ${first} to ${last}: for every commit offered, mayCommit on the log at that moment gives the result append gave`,
      () => {
        expect(scans.get(index).disagreements).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
  }

  it(
    "coverage: every verdict, every breach and every way to be refused was compared",
    () => {
      const total: Record<string, number> = {};
      let compared = 0;
      for (let index = 0; index < CHUNKS; index++) {
        const counts = scans.get(index).counts;
        compared += counts.compared;
        for (const [key, value] of Object.entries(counts.byResult)) total[key] = (total[key] ?? 0) + value;
      }
      report("may-commit-equivalence", { compared, total });
      expect(compared).toBeGreaterThanOrEqual(28_000);
      expect(total["warranted"] ?? 0).toBeGreaterThanOrEqual(19_000);
      for (const breach of ["no-such-grant", "wrong-actor", "link-dead", "capability-not-granted", "over-limit"]) {
        expect(total[`breached:${breach}`] ?? 0, breach).toBeGreaterThanOrEqual(800);
      }
      for (const kind of ["rejected:duplicate-id", "rejected:invalid-event-shape", "rejected:unknown-capability"]) {
        expect(total[kind] ?? 0, kind).toBeGreaterThanOrEqual(100);
      }
    },
    SEED_LOOP_TIMEOUT_MS,
  );
});

describe("the boundary, asked of both: exactly the headroom is warranted and one more is over-limit", () => {
  const cases: readonly [string, readonly EventInput<Cap>[], Commitment<Cap>, "warranted" | "over-limit"][] = [
    ["a fresh grant: its limit", [], commit("k", "buyer", "G3", "purchase", 1_000), "warranted"],
    ["a fresh grant: one more than its limit", [], commit("k", "buyer", "G3", "purchase", 1_001), "over-limit"],
    ["after a commit: what is left", [commitEvent(commit("e", "buyer", "G3", "purchase", 600))], commit("k", "buyer", "G3", "purchase", 400), "warranted"],
    ["after a commit: one more than what is left", [commitEvent(commit("e", "buyer", "G3", "purchase", 600))], commit("k", "buyer", "G3", "purchase", 401), "over-limit"],
    ["a grant that has reserved for its child: limit less the reservation", [], commit("k", "ops", "G2", "purchase", 3_000), "warranted"],
    ["a grant that has reserved for its child: one more", [], commit("k", "ops", "G2", "purchase", 3_001), "over-limit"],
    ["a child revoked unspent returns its whole reservation: G2 may use all 4 000", [revokeEvent("G3", "ops")], commit("k", "ops", "G2", "purchase", 4_000), "warranted"],
    ["a child revoked unspent returns its whole reservation: and not one more", [revokeEvent("G3", "ops")], commit("k", "ops", "G2", "purchase", 4_001), "over-limit"],
  ];

  it.each(cases.map((row) => [row[0], row] as const))("%s", (_name, row) => {
    const [, after, c, expected] = row;
    const log = logOf(CHARTER, [...ORG, ...after]);
    const asked = mayCommit(CHARTER, log, c);
    const appended = append(CHARTER, log, commitEvent(c));
    expect(asked.ok && appended.ok).toBe(true);
    if (!asked.ok || !appended.ok) return;
    expect(asked.verdict).toStrictEqual(appended.verdict);
    // The comparison above is the point; this pins that each row sits on the side of the boundary its name says.
    expect(asked.verdict.kind === "warranted" ? "warranted" : asked.verdict.breach.kind).toBe(expected);
  });
});

describe("where the log or the commit cannot be used, mayCommit gives the failure append gives", () => {
  const GOOD = commit("k", "buyer", "G3", "purchase", 1);

  const same = (log: Log<Cap>, c: Commitment<Cap>, charter = CHARTER): void => {
    const asked = mayCommit(charter, log, c);
    const appended = append(charter, log, commitEvent(c));
    expect(asked.ok).toBe(false);
    expect(appended.ok).toBe(false);
    if (!asked.ok && !appended.ok) expect(asked.failure).toStrictEqual(appended.failure);
  };

  it("an invalid charter", () => {
    same(logOf(CHARTER, ORG), GOOD, { roots: [], capabilities: [] } as unknown as typeof CHARTER);
  });

  it("a log with a gap in seq", () => {
    const base = logOf(CHARTER, ORG);
    same([base[0], base[2]] as unknown as Log<Cap>, GOOD);
  });

  it("a duplicate commit id: refused as duplicate-id by both, and the first record is not replaced", () => {
    const log = mustAppend(CHARTER, logOf(CHARTER, ORG), commitEvent(GOOD)).log;
    same(log, GOOD);
    const asked = mayCommit(CHARTER, log, GOOD);
    expect(!asked.ok && asked.failure).toStrictEqual({ kind: "rejected", rejection: { kind: "duplicate-id", id: "k" } });
  });

  it("a malformed commit, and a commit naming a capability outside the charter", () => {
    const log = logOf(CHARTER, ORG);
    same(log, { ...GOOD, amount: -1 });
    same(log, { ...GOOD, capability: "launder" as Cap });
  });

  it("a commit whose getter throws: a typed failure from both, naming the field", () => {
    const log = logOf(CHARTER, ORG);
    const hostile = {
      id: "k",
      actor: "buyer",
      actedUnder: "G3",
      capability: "purchase",
      get amount(): number {
        throw new Error("no");
      },
    } as unknown as Commitment<Cap>;
    same(log, hostile);
    const asked = mayCommit(CHARTER, log, hostile);
    expect(!asked.ok && asked.failure).toStrictEqual({ kind: "faulty-log", fault: { kind: "hostile-log-input", message: "input: reading commit.amount threw" } });
  });

  it("a log at MAX_LOG_EVENTS: a good commit is stopped by the bound, by both, with the same fault", () => {
    const events: unknown[] = [{ kind: "grant", seq: 1, grant: { id: "G1", parent: null, grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: 10, depth: 0 } }];
    for (let index = 1; index < MAX_LOG_EVENTS; index++) {
      events.push({ kind: "commit", seq: index + 1, commit: { id: `v${index}`, actor: "x", actedUnder: "g-ghost", capability: "purchase", amount: 0 } });
    }
    const full = events as unknown as Log<Cap>;
    expect(full).toHaveLength(MAX_LOG_EVENTS);
    same(full, commit("k", "cfo", "G1", "purchase", 1));
    const asked = mayCommit(CHARTER, full, commit("k", "cfo", "G1", "purchase", 1));
    expect(!asked.ok && asked.failure).toStrictEqual({ kind: "faulty-log", fault: { kind: "log-too-long", length: MAX_LOG_EVENTS + 1, max: MAX_LOG_EVENTS } });
    // A bad commit on the full log is refused for being bad, not for the bound: the bound is checked last.
    const bad = mayCommit(CHARTER, full, commit("v1", "cfo", "G1", "purchase", 1));
    expect(!bad.ok && bad.failure).toStrictEqual({ kind: "rejected", rejection: { kind: "duplicate-id", id: "v1" } });
  });
});

describe("mayCommit changes nothing", () => {
  it("asking leaves the log as it was, and the same question gets the same answer, and append then records what was said", () => {
    const log = logOf(CHARTER, ORG);
    const c = commit("k", "buyer", "G3", "purchase", 700);
    const snapshot = JSON.stringify(log);
    const first = mayCommit(CHARTER, log, c);
    const second = mayCommit(CHARTER, log, c);
    expect(JSON.stringify(log)).toBe(snapshot);
    expect(first).toStrictEqual(second);
    const recorded = mustAppend(CHARTER, log, commitEvent(c));
    expect(recorded.event.seq).toBe(ORG.length + 1);
    expect(first.ok && first.verdict).toStrictEqual(recorded.verdict);
  });

  it("a breached commit is ok: true with the breach in the verdict, which is exactly what append would record", () => {
    const log = logOf(CHARTER, ORG);
    const c = commit("k", "ops", "G3", "purchase", 1);
    const asked = mayCommit(CHARTER, log, c);
    expect(asked.ok && asked.verdict.kind).toBe("breached");
    expect(mustAppend(CHARTER, log, commitEvent(c)).verdict).toStrictEqual(asked.ok ? asked.verdict : undefined);
  });
});
