import { readCharter, readEventInput } from "../chain/index.js";
import { MAX_LOG_EVENTS } from "../contracts/index.js";
import type { Charter, Commitment, EventInput, FoldFault, Log, LogEvent, Rejection, Verdict } from "../contracts/index.js";
import { apply, decide, replay } from "./fold.js";
import type { Effect, Ledger } from "./fold.js";

/**
 * Recording an event (`append`) and asking about a commit without recording it (`mayCommit`) (plan §3 D3, D4, D9; §5).
 *
 * BOTH REPLAY THE LOG FIRST. The log is the only state (D3): neither function is handed a tree or a charge list, each
 * replays the log it is given through `fold.ts`'s `replay`, and a log that cannot be replayed is `faulty-log` whichever
 * function asked. Then both run the SAME `prepare`: one read of the input through M3's intake, one `decide` (the
 * admission path `fold` also uses), one capacity check. They cannot drift (D9); `may-commit-equivalence.test.ts`
 * compares them over generated logs.
 *
 * PRECEDENCE, first failing step wins: a charter that cannot be read; a log that cannot be replayed; an input that
 * cannot be read (`hostile`) or is malformed (`rejected`); an input the ledger refuses (`rejected`); and finally an
 * admitted event that would make the log longer than `MAX_LOG_EVENTS`. The capacity check is last on purpose: an
 * event that would be refused anyway adds nothing, so a full log still answers `rejected` for a bad event and only a
 * good one is stopped by the bound.
 *
 * WHAT `append` NEVER DOES: take `seq` from the caller. The input is read through `readEventInput`, which builds the
 * event from the fields it names and copies nothing else, so a `seq` on the input (or any other key) is not in the
 * logged event; the engine stamps `head + 1` (D3: "a caller cannot choose, and cannot back-date").
 * It never gives the caller's own objects back either: the returned `log` is a new array of events read through intake.
 */

export type AppendFailure =
  | { readonly kind: "rejected"; readonly rejection: Rejection }
  | { readonly kind: "faulty-log"; readonly fault: FoldFault };

export type AppendResult<C extends string = string> =
  | { readonly ok: true; readonly log: Log<C>; readonly event: LogEvent<C>; readonly verdict: Verdict | null }
  | { readonly ok: false; readonly failure: AppendFailure };

export type MayCommitResult =
  | { readonly ok: true; readonly verdict: Verdict }
  | { readonly ok: false; readonly failure: AppendFailure };

type Prepared<C extends string> =
  | {
      readonly ok: true;
      readonly ledger: Ledger<C>;
      readonly event: EventInput<C>;
      readonly effect: Effect<C>;
      readonly seq: number;
    }
  | { readonly ok: false; readonly failure: AppendFailure };

function faultyLog(fault: FoldFault): { readonly ok: false; readonly failure: AppendFailure } {
  return { ok: false, failure: { kind: "faulty-log", fault } };
}

function rejected(rejection: Rejection): { readonly ok: false; readonly failure: AppendFailure } {
  return { ok: false, failure: { kind: "rejected", rejection } };
}

/** The shared front half of `append` and `mayCommit`: everything up to, and not including, writing anything. */
function prepare<C extends string>(charter: Charter<C>, log: Log<C>, input: unknown): Prepared<C> {
  const read = readCharter(charter);
  if (!read.ok) return faultyLog({ kind: "invalid-charter", fields: read.fields });

  const replayed = replay(read.charter, log);
  if (!replayed.ok) return faultyLog(replayed.fault);

  const intake = readEventInput(read.charter, input);
  if (!intake.ok) {
    // A throwing read on the INPUT has no `Rejection` (the plan has none); the only typed place for "a read threw" is
    // the fault below, so the log is reported faulty although the log itself was fine. The message says which input.
    if (intake.failure.kind === "hostile") return faultyLog({ kind: "hostile-log-input", message: `input: ${intake.failure.message}` });
    return rejected(intake.failure.rejection);
  }

  const decision = decide(read.charter, replayed.ledger, intake.event);
  if (!decision.ok) return rejected(decision.rejection);

  const seq = replayed.ledger.events.length + 1;
  if (seq > MAX_LOG_EVENTS) return faultyLog({ kind: "log-too-long", length: seq, max: MAX_LOG_EVENTS });
  return { ok: true, ledger: replayed.ledger, event: intake.event, effect: decision.effect, seq };
}

/**
 * Record `input` at the end of `log`, or say why not (plan §5). On success `log` is the old events followed by the new
 * one, which carries `seq = head + 1`, and `verdict` is the verdict of a commit and `null` for a grant or a revoke.
 * A commit that breaches a rule is NOT refused: it is recorded and its verdict says so (plan D4). Never throws on any
 * input; `rejected` is an event the ledger refuses, `faulty-log` is a charter, log or input that could not be read, or
 * a log that is full.
 */
export function append<C extends string>(charter: Charter<C>, log: Log<C>, input: EventInput<C>): AppendResult<C> {
  const prepared = prepare(charter, log, input);
  if (!prepared.ok) return prepared;
  const event = apply(prepared.ledger, prepared.event, prepared.effect, prepared.seq);
  return {
    ok: true,
    log: prepared.ledger.events,
    event,
    verdict: prepared.effect.kind === "commit" ? prepared.effect.verdict : null,
  };
}

/**
 * What `append` would record for this commit, without recording it (plan D9: prevention is the caller's choice, and
 * this is the pre-check). The verdict it returns is the verdict `append` would store; where `append` would refuse the
 * commit (a malformed one, a duplicate id, a faulty log, a full log) it answers `ok: false` with the same failure.
 */
export function mayCommit<C extends string>(charter: Charter<C>, log: Log<C>, commit: Commitment<C>): MayCommitResult {
  const prepared = prepare(charter, log, { kind: "commit", commit });
  if (!prepared.ok) return prepared;
  if (prepared.effect.kind !== "commit") throw new Error("internal error: a commit input was admitted as something else");
  return { ok: true, verdict: prepared.effect.verdict };
}
