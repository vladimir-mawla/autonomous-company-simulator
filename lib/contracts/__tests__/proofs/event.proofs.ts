import type { Commitment } from "../../commitment.js";
import type { EventInput, Log, LogEvent } from "../../event.js";
import { commitId, grantId, principalId } from "../../ids.js";

/**
 * Type-only proofs for the event and log types (see `support/proof-harness.ts`).
 * Declarations are exported so `noUnusedLocals` cannot satisfy a directive.
 */
const dana = principalId("dana");
const commit: Commitment = { id: commitId("c1"), actor: dana, actedUnder: grantId("G1"), capability: "purchase", amount: 1 };
const revokeInput: EventInput = { kind: "revoke", grantId: grantId("G1"), by: dana };

// A LogEvent needs a seq, whether built as a literal or promoted from an EventInput.
// @ts-expect-error TS2322 Property 'seq' is missing
export const unstampedLiteral: LogEvent = { kind: "revoke", grantId: grantId("G1"), by: dana };
// @ts-expect-error TS2322 Property 'seq' is missing
export const unstamped: LogEvent = revokeInput;

// An event's payload must match its kind, by a bound value as well as by a literal.
const grantKindWithCommit = { kind: "grant" as const, commit };
// @ts-expect-error TS2322 Property 'grant' is missing
export const wrongPayload: EventInput = grantKindWithCommit;

// A bare string is not a principal.
// @ts-expect-error TS2322 Type 'string' is not assignable to type 'PrincipalId'
export const bareRevoker: EventInput = { kind: "revoke", grantId: grantId("G1"), by: "dana" };

// CONTROLS (no directive, so they must compile). They pin two things the types do NOT say, which the plan's D3
// leaves to M5's `append`:
// 1. a caller-chosen `seq` is accepted by `EventInput` through a non-literal route (it carries a `seq` the engine is
//    supposed to ignore), and
// 2. a `Log` may repeat, skip or reverse `seq`.
const carriesASeq = { kind: "commit" as const, commit, seq: 99 };
export const inputWithASeq: EventInput = carriesASeq;
const at = (seq: number): LogEvent => ({ ...revokeInput, seq });
export const unorderedLog: Log = [at(5), at(5), at(1), at(0), at(-2)];
