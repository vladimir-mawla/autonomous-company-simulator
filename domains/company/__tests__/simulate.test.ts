import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mulberry32 as referenceMulberry32 } from "../../../lib/chain/__tests__/fixtures.js";
import type { EventInput, Log } from "../../../lib/contracts/index.js";
import { principalId } from "../../../lib/contracts/index.js";
import { append } from "../../../lib/standing/index.js";
import type { AppendFailure, AppendResult } from "../../../lib/standing/index.js";
import { CANON_ALL, logOf } from "../../../lib/standing/__tests__/fixtures.js";
import { CHARTER } from "../org.js";
import type { CompanyCapability } from "../org.js";
import { POLICIES } from "../policies.js";
import { CANON_SCRIPT } from "../script.js";
import { INCIDENT_TICK, MAX_TICKS, mulberry32, offer, outcomeOf, replayScript, runQuarter } from "../simulate.js";
import type { Attempt, AttemptOutcome, OfferMeta } from "../simulate.js";
import { castsInFunction } from "./support/casts.js";

/**
 * `outcomeOf`, `offer`, `mulberry32` and the shape of `runQuarter` (`simulate.ts`). What the policies do inside a quarter, over 200 seeds, is
 * `quarter.test.ts`; plan §7 through `replayScript` is `canon-replay.test.ts`; an object that is hostile is `hostile-input.test.ts`.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const TSCONFIG = join(REPO_ROOT, "tsconfig.lib.json");

/**
 * An explicit timeout for the test that runs a quarter of MAX_TICKS (200) ticks, in place of vitest's 5 s default. The boundary is the point of the test, so its
 * work is not cut: it took 0.9 s in a full-suite run on this machine and 1.8 to 2.3 s in full-suite runs under 20 busy processes (the figures are from this
 * round's runs, which were on a host that was never idle). The timeout is for a slower machine and shortens nothing.
 */
const LONGEST_QUARTER_TIMEOUT_MS = 20_000;

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const META: OfferMeta = { n: 1, tick: 0, source: "canon", label: "a step" };
const grantOne: EventInput<CompanyCapability> = {
  kind: "grant",
  grant: { id: "Ga" as never, parent: null, grantor: principalId("dana"), grantee: principalId("cfo"), capabilities: ["purchase"], limit: 100, depth: 1 },
};

describe("outcomeOf: append's answer as an AttemptOutcome, with no cast", () => {
  const real = (input: EventInput<CompanyCapability>, log: Log<CompanyCapability> = []): AppendResult<CompanyCapability> => append(CHARTER, log, input);

  it("an admitted grant: kind admitted, the event the engine stamped, no verdict", () => {
    const result = real(grantOne);
    expect(result.ok).toBe(true);
    const outcome = outcomeOf(result);
    expect(outcome).toEqual({ kind: "admitted", event: { ...grantOne, seq: 1 }, verdict: null });
  });

  it("an admitted commit carries its verdict, breached or not", () => {
    const log = logOf(CHARTER, CANON_ALL.slice(0, 7));
    const warranted = outcomeOf(real({ kind: "commit", commit: { id: "k1" as never, actor: principalId("buyer-a"), actedUnder: "G4" as never, capability: "purchase", amount: 1 } }, log));
    const breached = outcomeOf(real({ kind: "commit", commit: { id: "k2" as never, actor: principalId("buyer-b"), actedUnder: "G4" as never, capability: "purchase", amount: 1 } }, log));
    expect(warranted.kind === "admitted" && warranted.verdict?.kind).toBe("warranted");
    expect(breached.kind === "admitted" && breached.verdict?.kind === "breached" && breached.verdict.breach.kind).toBe("wrong-actor");
  });

  it("a refusal is the engine's own failure, value for value: the very object append returned", () => {
    const result = real({ ...grantOne, grant: { ...(grantOne as { grant: object }).grant, limit: -1 } } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(outcomeOf(result)).toBe(result.failure);
    expect(result.failure).toEqual({ kind: "rejected", rejection: { kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] } });
  });

  it("a faulty log is the engine's own failure too", () => {
    const bad = logOf(CHARTER, CANON_ALL.slice(0, 3)).map((event, index) => (index === 1 ? { ...event, seq: 9 } : event));
    const result = real(grantOne, bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const outcome = outcomeOf(result);
    expect(outcome).toBe(result.failure);
    expect(outcome).toEqual({ kind: "faulty-log", fault: { kind: "seq-mismatch", index: 1, expected: 2, actual: 9 } });
  });

  it("the failure arm of AttemptOutcome is AppendFailure itself (it compiles to assign one to the other, with nothing in between)", () => {
    const failure: AppendFailure = { kind: "rejected", rejection: { kind: "unknown-grant", grantId: "x" as never } };
    const outcome: AttemptOutcome = failure;
    expect(outcome).toBe(failure);
  });

  it("the function holds no type assertion of any form: no `as`, no angle-bracket assertion, no `!`, no `satisfies`", () => {
    expect(castsInFunction(REPO_ROOT, TSCONFIG, "domains/company/simulate.ts", "outcomeOf")).toEqual([]);
  });

  it("and the check can fail: it finds each form of assertion planted in a function of that name, and nothing in a clean one", () => {
    const dir = mkdtempSync(join(tmpdir(), "act-casts-"));
    scratch.push(dir);
    const put = (path: string, text: string): void => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: true }, include: ["*.ts"] }));
    put("as.ts", "declare const r: { ok: boolean };\nexport function outcomeOf(): number { return (r as unknown) as number; }\n");
    put("angle.ts", "declare const r: { ok: boolean };\nexport function outcomeOf(): number { return <number><unknown>r; }\n");
    put("bang.ts", "declare const r: number | undefined;\nexport function outcomeOf(): number { return r!; }\n");
    put("satisfies.ts", "declare const r: number;\nexport function outcomeOf(): number { return r satisfies number; }\n");
    put("const.ts", "export function outcomeOf(): readonly [1] { return [1] as const; }\n");
    put("clean.ts", "declare const r: { ok: boolean; value: number };\nexport function outcomeOf(): number { return r.ok ? r.value : 0; }\n");
    put("elsewhere.ts", "declare const r: { ok: boolean };\nexport function other(): number { return r as unknown as number; }\nexport function outcomeOf(): number { return 1; }\n");
    const found = (file: string): string[] => castsInFunction(dir, join(dir, "tsconfig.json"), file, "outcomeOf");
    expect(found("as.ts")).toEqual(["(r as unknown) as number", "r as unknown"]);
    expect(found("angle.ts")).toEqual(["<number><unknown>r", "<unknown>r"]);
    expect(found("bang.ts")).toEqual(["r!"]);
    expect(found("satisfies.ts")).toEqual(["r satisfies number"]);
    expect(found("const.ts")).toEqual(["[1] as const"]);
    expect(found("clean.ts")).toEqual([]);
    expect(found("elsewhere.ts")).toEqual([]);
    expect(() => castsInFunction(dir, join(dir, "tsconfig.json"), "clean.ts", "missing")).toThrow("no function missing");
  });
});

describe("offer: one recorded call to append against the company's charter", () => {
  it("an admitted event returns the new log and an attempt holding the meta, the very input object, and the outcome", () => {
    const offered = offer([], grantOne, META);
    expect(offered.log).toEqual([{ ...grantOne, seq: 1 }]);
    expect(offered.attempt).toEqual({ ...META, input: grantOne, outcome: { kind: "admitted", event: { ...grantOne, seq: 1 }, verdict: null } });
    expect(offered.attempt.input).toBe(grantOne);
  });

  it("a refused event returns the log it was given, the same array, and the engine's refusal", () => {
    const log = logOf(CHARTER, CANON_ALL.slice(0, 2));
    const byIntern: EventInput<CompanyCapability> = { kind: "grant", grant: { ...(grantOne as { grant: object }).grant, grantor: principalId("intern") } as never };
    const refused = offer(log, byIntern, { ...META, n: 3 });
    expect(refused.log).toBe(log);
    expect(refused.attempt.outcome).toEqual({ kind: "rejected", rejection: { kind: "not-a-root", grantor: principalId("intern") } });
  });

  it("a log the engine cannot replay is an attempt with outcome faulty-log, and the log is returned as it came", () => {
    const bad = logOf(CHARTER, CANON_ALL.slice(0, 3)).map((event, index) => (index === 2 ? { ...event, seq: 7 } : event));
    const offered = offer(bad, grantOne, META);
    expect(offered.log).toBe(bad);
    expect(offered.attempt.outcome).toEqual({ kind: "faulty-log", fault: { kind: "seq-mismatch", index: 2, expected: 3, actual: 7 } });
  });
});

describe("mulberry32", () => {
  it("is the same generator as M3's test fixture, output for output, for ten seeds (so the copies agree)", () => {
    for (const seed of [0, 1, 2, 3, 7, 42, 1000, 2 ** 31, 2 ** 32 - 1, 123456789]) {
      const ours = mulberry32(seed);
      const reference = referenceMulberry32(seed);
      for (let i = 0; i < 1000; i++) expect(ours(), `seed ${seed} draw ${i}`).toBe(reference());
    }
  });

  it("returns floats in [0, 1), is repeatable from its seed, and different seeds give different streams", () => {
    const a = mulberry32(5);
    const draws = Array.from({ length: 2000 }, () => a());
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
    const b = mulberry32(5);
    expect(Array.from({ length: 2000 }, () => b())).toEqual(draws);
    const c = mulberry32(6);
    expect(Array.from({ length: 20 }, () => c())).not.toEqual(draws.slice(0, 20));
  });
});

describe("runQuarter: what it accepts", () => {
  it("refuses a number of ticks that is not an integer from 0 to MAX_TICKS, with a RangeError, before anything runs", () => {
    for (const ticks of [Number.NaN, -1, 0.5, 1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, MAX_TICKS + 1, 2 ** 53]) {
      expect(() => runQuarter(1, ticks), String(ticks)).toThrow(RangeError);
    }
  });

  it("accepts 0 and MAX_TICKS (the boundary, N and N+1 for the upper end above)", () => {
    expect(MAX_TICKS).toBe(200);
    const none = runQuarter(1, 0);
    expect([none.log, none.attempts, none.fault]).toEqual([[], [], null]);
    const longest = runQuarter(1, MAX_TICKS);
    expect(longest.fault).toBeNull();
    expect(longest.attempts.at(-1)?.tick).toBeLessThan(MAX_TICKS);
  }, LONGEST_QUARTER_TIMEOUT_MS);

  it("accepts any number as a seed: it is reduced to 32 bits by the generator, and the same reduced seed gives the same quarter", () => {
    expect(JSON.stringify(runQuarter(2 ** 32 + 5, 12))).toBe(JSON.stringify({ ...runQuarter(5, 12), seed: 2 ** 32 + 5 }));
    for (const seed of [Number.NaN, -1, 0.5, Number.POSITIVE_INFINITY]) expect(runQuarter(seed, 5).fault, String(seed)).toBeNull();
  });
});

describe("runQuarter: the view it hands the policies", () => {
  it("runQuarter's view carries the current tick: seed 26 at 60 ticks (a view reused across a tick with no admitted event would shift CompromisedPolicy's draws)", () => {
    const q = runQuarter(26, 60);
    expect(q.attempts.length).toBe(125);
    expect(q.attempts.filter((a) => a.source === "CompromisedPolicy").slice(0, 2).map((a) => a.tick)).toEqual([6, 10]);
  });
});

describe("runQuarter: the incident at its scripted tick", () => {
  it("INCIDENT_TICK is 0: so plan §7's absolute numbers (the revoke at seq 11, link-dead at seq 11) hold in every quarter", () => {
    expect(INCIDENT_TICK).toBe(0);
  });

  it("ticks = INCIDENT_TICK runs no tick and so no incident; ticks = INCIDENT_TICK + 1 runs exactly one tick and puts the whole script in it", () => {
    expect(runQuarter(3, INCIDENT_TICK).attempts).toEqual([]);
    const one = runQuarter(3, INCIDENT_TICK + 1);
    const canon = one.attempts.filter((attempt) => attempt.source === "canon");
    expect(canon).toHaveLength(CANON_SCRIPT.length);
    expect(new Set(canon.map((attempt) => attempt.tick))).toEqual(new Set([INCIDENT_TICK]));
  });

  it("the canon attempts are the first thirty-three, the same events with the same outcomes as replayScript, and no policy attempt comes before them", () => {
    const replay = replayScript();
    for (const seed of [1, 2, 3, 4, 5]) {
      const quarter = runQuarter(seed, 20);
      expect(JSON.stringify(quarter.attempts.slice(0, 33))).toBe(JSON.stringify(replay.attempts));
      expect(quarter.attempts.slice(33).every((attempt) => attempt.source !== "canon")).toBe(true);
      expect(JSON.stringify(quarter.log.slice(0, 18))).toBe(JSON.stringify(replay.log));
    }
  });

  it("the canon attempts hold the script's own objects, frozen, so a quarter cannot be used to change what a later one is offered", () => {
    const quarter = runQuarter(1, 3);
    for (const [index, step] of CANON_SCRIPT.entries()) {
      expect(quarter.attempts[index]?.input).toBe(step.input);
      expect(Object.isFrozen(quarter.attempts[index]?.input)).toBe(true);
    }
  });
});

describe("runQuarter: the shape of every quarter", () => {
  const seeds = [1, 2, 3, 11, 12, 13, 100, 101];

  it("is deterministic: the same seed and ticks give the same quarter, byte for byte", () => {
    // Every other seed of the list: each is run twice for 40 ticks, and with all eight this test took 2.8 s of the 5 s default in a full-suite run under 20 busy processes.
    for (const seed of seeds.filter((_, index) => index % 2 === 0)) expect(JSON.stringify(runQuarter(seed, 40))).toBe(JSON.stringify(runQuarter(seed, 40)));
  });

  it("a seed means one quarter, across changes to this domain: seeds 1 and 2 at 60 ticks and seed 7 at 30 pin how many attempts each source made and how long the log is", () => {
    const tally = (seed: number, ticks: number): { attempts: number; log: number; by: Record<string, number> } => {
      const quarter = runQuarter(seed, ticks);
      const by: Record<string, number> = {};
      for (const attempt of quarter.attempts) by[attempt.source] = (by[attempt.source] ?? 0) + 1;
      return { attempts: quarter.attempts.length, log: quarter.log.length, by };
    };
    // Written from this branch's own output (`runQuarter(1, 60)` is also the quarter `npm run demo:company` prints). A change to a policy, to the order or number of its
    // draws, or to the generator's seeding changes these numbers on purpose: that is what "the order and the draws are part of what a seed means" says, and why this is pinned.
    expect(tally(1, 60)).toEqual({ attempts: 155, log: 118, by: { canon: 33, DelegatorPolicy: 24, RefunderPolicy: 30, OverreachPolicy: 29, BuyerPolicy: 11, CompromisedPolicy: 28 } });
    expect(tally(2, 60)).toEqual({ attempts: 148, log: 104, by: { canon: 33, RefunderPolicy: 30, DelegatorPolicy: 28, OverreachPolicy: 34, CompromisedPolicy: 22, BuyerPolicy: 1 } });
    expect(tally(7, 30)).toEqual({ attempts: 77, log: 51, by: { canon: 33, DelegatorPolicy: 6, RefunderPolicy: 13, OverreachPolicy: 13, BuyerPolicy: 3, CompromisedPolicy: 9 } });
  });

  it("different seeds give different quarters (the generator reaches the policies)", () => {
    const logs = new Set(seeds.map((seed) => JSON.stringify(runQuarter(seed, 40).log)));
    expect(logs.size).toBe(seeds.length);
  });

  it("a longer quarter extends a shorter one: the attempts of ticks k are a prefix of the attempts of ticks k + 1 (one generator, one fixed order)", () => {
    for (const seed of [1, 2, 3]) {
      let before = runQuarter(seed, 0).attempts;
      for (let ticks = 1; ticks <= 12; ticks++) {
        const next = runQuarter(seed, ticks).attempts;
        expect(JSON.stringify(next.slice(0, before.length)), `seed ${seed} ticks ${ticks}`).toBe(JSON.stringify(before));
        expect(next.length).toBeGreaterThanOrEqual(before.length);
        before = next;
      }
    }
  });

  it("the log is exactly the admitted attempts' events, in order; a refused attempt leaves nothing; every seq is its position", () => {
    for (const seed of seeds) {
      const quarter = runQuarter(seed, 40);
      const admitted = quarter.attempts.flatMap((attempt) => (attempt.outcome.kind === "admitted" ? [attempt.outcome.event] : []));
      expect(admitted, `seed ${seed}`).toEqual([...quarter.log]);
      expect(quarter.log.map((event) => event.seq), `seed ${seed}`).toEqual(quarter.log.map((_, index) => index + 1));
    }
  });

  it("attempts are numbered 1, 2, 3 ... with no gap, ticks never go backwards and stay below ticks, and within a tick the policies come in POLICIES' order", () => {
    const order = POLICIES.map((entry) => entry.name as string);
    for (const seed of seeds) {
      const quarter = runQuarter(seed, 40);
      expect(quarter.attempts.map((attempt) => attempt.n)).toEqual(quarter.attempts.map((_, index) => index + 1));
      let tick = -1;
      let last = -1;
      for (const attempt of quarter.attempts) {
        expect(attempt.tick).toBeGreaterThanOrEqual(tick);
        expect(attempt.tick).toBeLessThan(40);
        if (attempt.tick !== tick) last = -1;
        tick = attempt.tick;
        if (attempt.source === "canon") continue;
        const place = order.indexOf(attempt.source);
        expect(place, `seed ${seed} attempt ${attempt.n}`).toBeGreaterThanOrEqual(last);
        last = place;
      }
    }
  });

  it("every id a policy minted is `auto-g-<seq>` or `auto-c-<seq>` for the seq the event was admitted at (so no two policies can have chosen the same one)", () => {
    let minted = 0;
    for (const seed of seeds) {
      for (const attempt of runQuarter(seed, 40).attempts) {
        if (attempt.source === "canon" || attempt.outcome.kind !== "admitted") continue;
        const event = attempt.outcome.event;
        if (event.kind === "grant") {
          expect(event.grant.id).toBe(`auto-g-${event.seq}`);
          minted++;
        } else if (event.kind === "commit") {
          expect(event.commit.id).toBe(`auto-c-${event.seq}`);
          minted++;
        }
      }
    }
    expect(minted).toBeGreaterThan(200);
  });

  it("no attempt of a quarter is a faulty log, and a quarter never ends with a fault, for any of these seeds", () => {
    for (const seed of seeds) {
      const quarter = runQuarter(seed, 40);
      expect(quarter.fault).toBeNull();
      expect(quarter.attempts.filter((attempt: Attempt) => attempt.outcome.kind === "faulty-log")).toEqual([]);
    }
  });
});
