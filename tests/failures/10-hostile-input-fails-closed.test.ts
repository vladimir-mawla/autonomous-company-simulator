import { describe, expect, it } from "vitest";
import { MAX_AMOUNT, MAX_ID_LENGTH, MAX_LOG_EVENTS, commitId, grantId, principalId } from "../../lib/contracts/index.js";
import type { FoldFault } from "../../lib/contracts/index.js";
import { append, fold, standings } from "../../lib/standing/index.js";
import { mulberry32, offer, runQuarter } from "../../domains/company/index.js";
import { CHARTER, ENTRY_POINTS, build, commitEv, grantEv, stamped } from "./helpers.js";
import type { CompanyLog, Ev } from "./helpers.js";

/**
 * KIND: PROVES (plan section 11, case 10).
 * TRACES TO: D3 (the log is the only state; every input is re-read and re-validated, and nothing is trusted because it came from
 * the engine's own side of the barrel).
 *
 * THE CLAIM. Hostile input is a typed fault, never a throw, never a smaller log and never a partial result, at every one of the
 * five public entry points, and it leaves nothing behind: the same call on the clean log afterwards gives the same answer.
 *
 * WHAT IS NEW HERE, and what is not. M3 and M5 own the individual guarantees (a getter read once, a Proxy, `seq` gaps,
 * the bounds); their tests are `lib/chain/__tests__/hostile-input.test.ts`, `lib/standing/__tests__/hostile-input.test.ts`,
 * `fold-faults.test.ts` and `lib/chain/__tests__/boundaries.test.ts`, and this file does not repeat them. It adds (1) damage
 * done to REAL company logs, the logs `runQuarter` writes (40 seeds, about 50 events each), with the fault predicted from
 * where the damage was done and not read from the engine; (2) every entry point asked of every damaged log; (3) read-once
 * for an amount buried in a real log element, first answers from nine value classes; (4) the bounds reached through the domain's
 * own `offer`; and (5) that a fault is the whole answer (no partial result) and leaves no state.
 *
 * WHAT WOULD MAKE THIS FAIL: any read that can throw and is not guarded (the element read, a field read, `Array.isArray` on
 * a revoked Proxy); a fault that came back with part of a result; an engine that kept state between calls.
 */

const SEEDS = 40;
const TICKS = 20;

interface Damage {
  readonly name: string;
  /** The damaged log, and the fault every entry point must answer, both derived from `index`, not from the engine. */
  readonly make: (log: CompanyLog, index: number) => { readonly log: unknown; readonly expect: (fault: FoldFault | null) => void };
}

const boom = (): never => {
  throw new Error("hostile");
};

const messageOf = (fault: FoldFault | null): string => (fault !== null && fault.kind === "hostile-log-input" ? fault.message : `not hostile: ${JSON.stringify(fault)}`);

const DAMAGES: readonly Damage[] = [
  {
    name: "an event deleted (a gap in seq)",
    make: (log, index) => ({
      log: [...log.slice(0, index), ...log.slice(index + 1)],
      expect: (fault) => expect(fault).toEqual({ kind: "seq-mismatch", index, expected: index + 1, actual: index + 2 }),
    }),
  },
  {
    name: "an event duplicated (the same seq twice)",
    make: (log, index) => ({
      log: [...log.slice(0, index + 1), log[index], ...log.slice(index + 1)],
      // The copy is read at index + 1 and carries seq index + 1 (the position of the original).
      expect: (fault) => expect(fault).toEqual({ kind: "seq-mismatch", index: index + 1, expected: index + 2, actual: index + 1 }),
    }),
  },
  {
    name: "a seq of 0",
    make: (log, index) => ({
      log: log.map((event, i) => (i === index ? { ...event, seq: 0 } : event)),
      expect: (fault) =>
        expect(fault).toMatchObject({ kind: "inadmissible-event", index, rejection: { kind: "invalid-event-shape", fields: ["seq"] } }),
    }),
  },
  {
    name: "an element whose read throws",
    make: (log, index) => {
      const damaged = log.slice();
      Object.defineProperty(damaged, index, { get: boom });
      return { log: damaged, expect: (fault) => expect(messageOf(fault)).toBe(`reading log[${index}] threw`) };
    },
  },
  {
    name: "a field inside an element whose read throws",
    make: (log, index) => {
      const damaged: unknown[] = log.map((event) => ({ ...event }));
      const target = { ...(log[index] as object) };
      Object.defineProperty(target, "kind", { get: boom, enumerable: true });
      damaged[index] = target;
      return { log: damaged, expect: (fault) => expect(messageOf(fault)).toMatch(new RegExp(`^log\\[${index}\\]: reading .+ threw$`)) };
    },
  },
  {
    name: "an element that is not an event (null)",
    make: (log, index) => ({
      log: log.map((event, i) => (i === index ? null : event)),
      expect: (fault) =>
        expect(fault).toMatchObject({ kind: "inadmissible-event", index, rejection: { kind: "invalid-event-shape", eventKind: "unknown" } }),
    }),
  },
  {
    name: "a Proxy log whose length throws",
    make: (log) => ({
      log: new Proxy(log.slice(), { get: (target, key, receiver) => (key === "length" ? boom() : Reflect.get(target, key, receiver)) }),
      expect: (fault) => expect(messageOf(fault)).toBe("reading log.length threw"),
    }),
  },
  {
    name: "a revoked Proxy as the log",
    make: (log) => {
      const revocable = Proxy.revocable(log.slice(), {});
      revocable.revoke();
      return { log: revocable.proxy, expect: (fault) => expect(messageOf(fault)).toBe("reading log threw") };
    },
  },
  {
    name: "an array-like that is not an array",
    make: (log) => ({
      log: { ...log, length: log.length },
      expect: (fault) => expect(messageOf(fault)).toBe("log is not an array"),
    }),
  },
];

/** A deterministic position in 1 to length - 2 for the damage of this seed and this kind of damage. */
function positionFor(seed: number, damage: number, length: number): number {
  const rng = mulberry32(seed * 1000 + damage);
  return 1 + Math.floor(rng() * (length - 2));
}

describe("10 hostile input fails closed: damage done to real company logs, every entry point", () => {
  const logs = Array.from({ length: SEEDS }, (_, i) => runQuarter(i + 1, TICKS).log);

  it("the real logs are what the test says they are: 40 of them, each of at least 40 events, each folding clean", () => {
    expect(logs).toHaveLength(SEEDS);
    for (const log of logs) {
      expect(log.length).toBeGreaterThanOrEqual(40);
      expect(fold(CHARTER, log).ok).toBe(true);
    }
  });

  it.each(DAMAGES.map((damage, n) => [damage.name, damage, n] as const))("%s: all five entry points answer the predicted fault, on 40 logs", (_name, damage, n) => {
    let answers = 0;
    logs.forEach((log, i) => {
      const index = positionFor(i + 1, n, log.length);
      const made = damage.make(log, index);
      for (const [entry, run] of ENTRY_POINTS) {
        let fault: FoldFault | null = null;
        try {
          fault = run(CHARTER, made.log);
        } catch (error) {
          throw new Error(`${entry} threw on ${damage.name}, seed ${i + 1}, index ${index}: ${String(error)}`);
        }
        expect(fault, `${entry}, seed ${i + 1}, index ${index}`).not.toBeNull();
        made.expect(fault);
        answers += 1;
      }
    });
    expect(answers).toBe(SEEDS * ENTRY_POINTS.length);
  });

  it("a duplicated commit id, which reads fine and is not admissible, is inadmissible-event { duplicate-id } at the second use, at every entry point", () => {
    let checked = 0;
    for (const log of logs) {
      const commits = log.flatMap((event, index) => (event.kind === "commit" ? [{ event, index }] : []));
      const first = commits[0];
      const last = commits[commits.length - 1];
      if (first === undefined || last === undefined || first.index === last.index) continue;
      const damaged = log.map((event, i) =>
        i === last.index && event.kind === "commit" ? { ...event, commit: { ...event.commit, id: first.event.kind === "commit" ? first.event.commit.id : commitId("") } } : event,
      );
      for (const [, run] of ENTRY_POINTS) {
        expect(run(CHARTER, damaged)).toEqual({
          kind: "inadmissible-event",
          index: last.index,
          rejection: { kind: "duplicate-id", id: first.event.kind === "commit" ? first.event.commit.id : "" },
        });
      }
      checked += 1;
    }
    expect(checked).toBe(SEEDS);
  });
});

describe("10 hostile input fails closed: a fault is the whole answer, and leaves nothing behind", () => {
  const log = runQuarter(7, TICKS).log;

  it("fold and standings on a damaged log answer { ok: false, fault } and nothing else: no tree, no standings, no head", () => {
    const damaged = [...log.slice(0, 10), ...log.slice(11)];
    const folded = fold(CHARTER, damaged as CompanyLog);
    const ranked = standings(CHARTER, damaged as CompanyLog);
    for (const result of [folded, ranked]) {
      expect(Object.keys(result).sort()).toEqual(["fault", "ok"]);
      expect(result).toEqual({ ok: false, fault: { kind: "seq-mismatch", index: 10, expected: 11, actual: 12 } });
    }
  });

  it("append on a damaged log records nothing: faulty-log, and no log in the answer", () => {
    const damaged = [...log.slice(0, 10), ...log.slice(11)] as CompanyLog;
    const result = append(CHARTER, damaged, commitEv("late", "buyer-a", "G7", "purchase", 1));
    expect(result).toEqual({ ok: false, failure: { kind: "faulty-log", fault: { kind: "seq-mismatch", index: 10, expected: 11, actual: 12 } } });
  });

  it("the domain's offer on a hostile input gives back the log it was given, the same array, and a faulty-log attempt; the next valid offer is admitted at head + 1", () => {
    const hostileInput = new Proxy({}, { get: boom, has: boom, ownKeys: boom, getOwnPropertyDescriptor: boom });
    const offered = offer(log, hostileInput as never, { n: 1, tick: 0, source: "canon", label: null });
    expect(offered.log).toBe(log);
    expect(offered.attempt.outcome.kind).toBe("faulty-log");
    expect(offered.attempt.outcome).toMatchObject({ kind: "faulty-log", fault: { kind: "hostile-log-input" } });

    const next = offer(offered.log, commitEv("after-the-hostile-one", "buyer-a", "G7", "purchase", 1), { n: 2, tick: 0, source: "canon", label: null });
    expect(next.attempt.outcome).toMatchObject({ kind: "admitted", event: { seq: log.length + 1 } });
  });

  it("no state is kept between calls: the clean log's standings are equal to the value before every damaged call above was made", () => {
    const before = standings(CHARTER, log);
    for (const damage of DAMAGES) {
      const made = damage.make(log, 20);
      for (const [, run] of ENTRY_POINTS) run(CHARTER, made.log);
    }
    expect(standings(CHARTER, log)).toEqual(before);
    expect(before.ok).toBe(true);
  });
});

describe("10 hostile input fails closed: a hostile charter is an invalid-charter fault at every entry point", () => {
  const log = runQuarter(3, TICKS).log;
  const valid = { roots: [...CHARTER.roots], capabilities: [...CHARTER.capabilities] };
  const revoked = (): unknown => {
    const revocable = Proxy.revocable({ ...valid }, {});
    revocable.revoke();
    return revocable.proxy;
  };
  const rows: readonly (readonly [string, () => unknown, readonly string[]])[] = [
    ["a roots getter that throws", () => ({ ...valid, get roots(): never { return boom(); } }), ["roots"]],
    ["a capabilities getter that throws", () => ({ ...valid, get capabilities(): never { return boom(); } }), ["capabilities"]],
    ["a revoked Proxy as the charter", revoked, ["capabilities", "roots"]],
  ];

  it.each(rows)("%s: every entry point answers invalid-charter with the named fields, and none throws", (_name, make, fields) => {
    for (const [entry, run] of ENTRY_POINTS) {
      let fault: FoldFault | null = null;
      try {
        fault = run(make(), log);
      } catch (error) {
        throw new Error(`${entry} threw: ${String(error)}`);
      }
      expect(fault, entry).toEqual({ kind: "invalid-charter", fields });
    }
  });
});

describe("10 hostile input fails closed: an amount read once, inside a real log element, from nine first-answer classes", () => {
  const log = runQuarter(5, TICKS).log;
  const at = log.findIndex((event) => event.kind === "commit");
  const found = log[at];
  if (found === undefined || found.kind !== "commit") throw new Error("the seed's log must hold a commit");
  const original = found;

  const classes: readonly (readonly [string, number, boolean])[] = [
    ["null", null as unknown as number, false],
    ["0", 0, true],
    ["a negative", -1, false],
    ["MAX_AMOUNT", MAX_AMOUNT, true],
    ["MAX_AMOUNT + 1", MAX_AMOUNT + 1, false],
    ["NaN", Number.NaN, false],
    ["Infinity", Number.POSITIVE_INFINITY, false],
    ["-Infinity", Number.NEGATIVE_INFINITY, false],
    ["the valid amount the commit had", original.commit.amount, true],
  ];

  /** The log with element `at` read through a getter on `amount` that answers `first`, then `later`, and counts its reads. */
  function withGetter(first: number, later: unknown): { readonly log: unknown; readonly reads: () => number } {
    let reads = 0;
    const commit = { ...original.commit };
    Object.defineProperty(commit, "amount", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? first : later;
      },
    });
    const damaged: unknown[] = log.slice();
    damaged[at] = { ...original, commit };
    return { log: damaged, reads: () => reads };
  }

  function plain(first: number): CompanyLog {
    const damaged = log.slice();
    damaged[at] = { ...original, commit: { ...original.commit, amount: first } };
    return damaged as CompanyLog;
  }

  it.each(classes)("a first answer of %s, a different one after: read once by each entry point, and the outcome is the plain object's", (_name, first, accepted) => {
    for (const [entry, run] of ENTRY_POINTS) {
      const hostile = withGetter(first, accepted ? -7 : 5);
      const outcome = run(CHARTER, hostile.log);
      expect(hostile.reads(), entry).toBe(1);
      expect(outcome, entry).toEqual(run(CHARTER, plain(first)));
      if (!accepted) {
        expect(outcome, entry).toMatchObject({ kind: "inadmissible-event", index: at, rejection: { kind: "invalid-event-shape", eventKind: "commit", fields: ["amount"] } });
      }
    }
    // standings, whole: the verdict the engine gives under a first answer that was accepted is the one a plain object of that amount gets.
    const hostile = withGetter(first, accepted ? -7 : 5);
    expect(standings(CHARTER, hostile.log as CompanyLog)).toEqual(standings(CHARTER, plain(first)));
    expect(hostile.reads()).toBe(1);
  });

  it("three of the nine first answers are accepted and six are refused: the table is not one-sided", () => {
    expect(classes.filter(([, , accepted]) => accepted)).toHaveLength(3);
    expect(classes.filter(([, , accepted]) => !accepted)).toHaveLength(6);
  });
});

describe("10 hostile input fails closed: the bounds, N and N + 1, through the domain's offer and the log's length", () => {
  const log = build([grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: MAX_AMOUNT, depth: 2 })]);
  const meta = { n: 1, tick: 0, source: "canon" as const, label: null };
  const invalid = (eventKind: string, field: string) => ({ kind: "rejected", rejection: { kind: "invalid-event-shape", eventKind, fields: [field] } });

  it("MAX_ID_LENGTH: a commit id of N is admitted, one of N + 1 is invalid-event-shape { commit, [id] }", () => {
    expect(offer(log, commitEv("x".repeat(MAX_ID_LENGTH), "cfo", "G1", "purchase", 1), meta).attempt.outcome.kind).toBe("admitted");
    expect(offer(log, commitEv("x".repeat(MAX_ID_LENGTH + 1), "cfo", "G1", "purchase", 1), meta).attempt.outcome).toEqual(invalid("commit", "id"));
  });

  it("MAX_ID_LENGTH on a grant's grantee and a revoke's by: N + 1 names the field", () => {
    const long = "y".repeat(MAX_ID_LENGTH + 1);
    const grant = grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: long, capabilities: ["purchase"], limit: 1, depth: 1 });
    expect(offer(log, grant, meta).attempt.outcome).toEqual(invalid("grant", "grantee"));
    expect(offer(log, { kind: "revoke", grantId: grantId("G1"), by: principalId(long) }, meta).attempt.outcome).toEqual(invalid("revoke", "by"));
  });

  it("MAX_AMOUNT: a commit of N is admitted (and void: over-limit, or warranted as the grant allows), one of N + 1 is invalid-event-shape { commit, [amount] }", () => {
    const atMax = offer(log, commitEv("m", "cfo", "G1", "purchase", MAX_AMOUNT), meta).attempt.outcome;
    expect(atMax).toMatchObject({ kind: "admitted", verdict: { kind: "warranted" } });
    expect(offer(log, commitEv("m", "cfo", "G1", "purchase", MAX_AMOUNT + 1), meta).attempt.outcome).toEqual(invalid("commit", "amount"));
  });

  it("MAX_LOG_EVENTS: a log of N folds and N + 1 is log-too-long { N + 1, N } at every entry point; an append to N - 1 is admitted, to N is faulty-log log-too-long", () => {
    // One grant, then commits under a grant that does not exist: each is recorded and ruled void, and a void commit charges
    // nothing, so replaying 5 000 of them stays cheap (warranted ones would make every replay quadratic in the log's length).
    const events = (count: number): Ev[] => [
      grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase"], limit: MAX_AMOUNT, depth: 2 }),
      ...Array.from({ length: count - 1 }, (_, n) => commitEv(`k${n}`, "cfo", "g-ghost", "purchase", 1)),
    ];
    const full = stamped(events(MAX_LOG_EVENTS));
    expect(fold(CHARTER, full)).toMatchObject({ ok: true, folded: { head: MAX_LOG_EVENTS } });
    const over = stamped(events(MAX_LOG_EVENTS + 1));
    for (const [entry, run] of ENTRY_POINTS) {
      expect(run(CHARTER, over), entry).toEqual({ kind: "log-too-long", length: MAX_LOG_EVENTS + 1, max: MAX_LOG_EVENTS });
    }

    const almost = stamped(events(MAX_LOG_EVENTS - 1));
    expect(append(CHARTER, almost, commitEv("last", "cfo", "g-ghost", "purchase", 1)).ok).toBe(true);
    expect(append(CHARTER, full, commitEv("one-too-many", "cfo", "g-ghost", "purchase", 1))).toEqual({
      ok: false,
      failure: { kind: "faulty-log", fault: { kind: "log-too-long", length: MAX_LOG_EVENTS + 1, max: MAX_LOG_EVENTS } },
    });
  });
});
