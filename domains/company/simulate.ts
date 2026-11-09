import type { FoldFault, EventInput, Log, LogEvent, Verdict } from "../../lib/contracts/index.js";
import { append } from "../../lib/standing/index.js";
import type { AppendFailure, AppendResult } from "../../lib/standing/index.js";
import { CHARTER } from "./org.js";
import type { CompanyCapability } from "./org.js";
import { POLICIES } from "./policies.js";
import type { PolicyName, Rng } from "./policies.js";
import { CANON_SCRIPT } from "./script.js";
import type { ScriptStep } from "./script.js";
import { makeOrgView } from "./view.js";
import type { OrgView } from "./view.js";

/**
 * Running the company: one call to the engine per `Attempt`, either of a script (`replayScript`) or of the five policies over
 * a number of ticks (`runQuarter`) (plan §6 M6).
 *
 * EVERY CALL IS RECORDED, WHATEVER THE ENGINE SAID. An `Attempt` holds the event that was offered and the engine's answer to
 * it: admitted at a `seq` (with the verdict, if it was a commit), or refused with the engine's own `Rejection`, or `faulty-log` with its
 * own `FoldFault`. The log holds only what was admitted (D4); the attempts hold everything, which is what the transcripts of the
 * demo and of M8 are made from. Nothing here decides whether an event is admitted, how a commit is ruled or what a refusal is
 * called.
 *
 * HOSTILE INPUT. `offer` hands the caller's object to `append` as it is. It does not read it first and it does not copy it: `append` reads
 * it once through M3's intake and answers with a typed refusal for anything malformed, a throwing getter included
 * (`__tests__/hostile-input.test.ts`). The policies and the script produce well-formed events; that a hostile one is survived is
 * M3's and M5's doing, and is shown here only because this file is where an object from outside meets the engine.
 */

/** The tick at which §7's incident is offered, before any policy has stepped. See `runQuarter` for why 0. */
export const INCIDENT_TICK = 0;

/** The largest number of ticks `runQuarter` runs. It exists so that a number from outside cannot start an unbounded loop. */
export const MAX_TICKS = 200;

export type AttemptOutcome =
  | { readonly kind: "admitted"; readonly event: LogEvent<CompanyCapability>; readonly verdict: Verdict | null }
  | AppendFailure;

export type AttemptSource = "canon" | PolicyName;

export interface Attempt {
  /** 1-based, in the order the calls were made. */
  readonly n: number;
  readonly tick: number;
  readonly source: AttemptSource;
  /** The narration of a scripted step, `null` for a policy's. */
  readonly label: string | null;
  readonly input: EventInput<CompanyCapability>;
  readonly outcome: AttemptOutcome;
}

/**
 * `append`'s answer as an `AttemptOutcome`. No cast: the failure arm of `AppendResult` already is an `AppendFailure`, and
 * the success arm is renamed to carry the admitted event and verdict without the log (the log is `offer`'s to keep).
 */
export function outcomeOf(result: AppendResult<CompanyCapability>): AttemptOutcome {
  if (result.ok) return { kind: "admitted", event: result.event, verdict: result.verdict };
  return result.failure;
}

export interface Offered {
  /** The log after the call: the one given if the event was not admitted. */
  readonly log: Log<CompanyCapability>;
  readonly attempt: Attempt;
}

export interface OfferMeta {
  readonly n: number;
  readonly tick: number;
  readonly source: AttemptSource;
  readonly label: string | null;
}

/** One call to `append` against the company's charter, recorded. */
export function offer(log: Log<CompanyCapability>, input: EventInput<CompanyCapability>, meta: OfferMeta): Offered {
  const result = append(CHARTER, log, input);
  return { log: result.ok ? result.log : log, attempt: { ...meta, input, outcome: outcomeOf(result) } };
}

export interface Replay {
  readonly log: Log<CompanyCapability>;
  readonly attempts: readonly Attempt[];
}

/** Offer every step of `script` to an empty log, in order, at tick 0. */
export function replayScript(script: readonly ScriptStep[] = CANON_SCRIPT): Replay {
  let log: Log<CompanyCapability> = [];
  const attempts: Attempt[] = [];
  for (const step of script) {
    const offered = offer(log, step.input, { n: attempts.length + 1, tick: INCIDENT_TICK, source: "canon", label: step.label });
    log = offered.log;
    attempts.push(offered.attempt);
  }
  return { log, attempts };
}

/**
 * mulberry32: a small seeded generator returning floats in [0, 1). Hand-rolled because the plan allows no new dependency (plan §12).
 * The same seed gives the same sequence on every run, which is what lets a failing seed be replayed.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface QuarterResult {
  readonly seed: number;
  readonly ticks: number;
  /** What the engine admitted: exactly the admitted attempts' events, in order. */
  readonly log: Log<CompanyCapability>;
  readonly attempts: readonly Attempt[];
  /** `null` unless a log built so far could not be replayed to give a policy its view, which `append` cannot produce. */
  readonly fault: FoldFault | null;
}

/**
 * `ticks` ticks of the company, from `seed`.
 *
 * Each tick, in this order: at `INCIDENT_TICK`, every step of `CANON_SCRIPT` is offered; then each policy of `POLICIES`, in
 * their fixed order, is shown a fresh view of the log as it then stands and draws from the one generator `mulberry32(seed)`;
 * what it proposes, if anything, is offered at once, so the next policy sees it.
 *
 * WHY THE INCIDENT IS AT TICK 0. Plan §7's numbers are absolute: the revoke is at seq 11, and `link-dead` names `atSeq 11`. They hold
 * in a log that begins with the incident, and a log that began with anything else would put every one of them somewhere
 * else (the rulings themselves would be the same, by locality, but the seqs would not). So every quarter opens with §7
 * verbatim, and the policies run on the company it leaves: G1, G3, G6 and G7 live, G2 and everything under it cut.
 *
 * `ticks` must be an integer from 0 to `MAX_TICKS`; anything else is a `RangeError`, because the only alternative to refusing is to
 * run a number of ticks the caller did not ask for. `seed` is any number; `mulberry32` reduces it to 32 bits.
 */
export function runQuarter(seed: number, ticks: number): QuarterResult {
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_TICKS) {
    throw new RangeError(`runQuarter: ticks must be an integer from 0 to ${MAX_TICKS}`);
  }
  const rng = mulberry32(seed);
  let log: Log<CompanyCapability> = [];
  const attempts: Attempt[] = [];
  let view: OrgView | undefined;

  const call = (tick: number, source: AttemptSource, label: string | null, input: EventInput<CompanyCapability>): void => {
    const offered = offer(log, input, { n: attempts.length + 1, tick, source, label });
    log = offered.log;
    attempts.push(offered.attempt);
  };

  for (let tick = 0; tick < ticks; tick++) {
    if (tick === INCIDENT_TICK) {
      for (const step of CANON_SCRIPT) call(tick, "canon", step.label, step.input);
    }
    for (const { name, policy } of POLICIES) {
      if (view === undefined || view.log !== log || view.tick !== tick) {
        const made = makeOrgView(log, tick);
        if (!made.ok) return { seed, ticks, log, attempts, fault: made.fault };
        view = made.view;
      }
      const input = policy(view, rng);
      if (input !== null) call(tick, name, null, input);
    }
  }
  return { seed, ticks, log, attempts, fault: null };
}
