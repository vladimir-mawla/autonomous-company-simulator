/**
 * The public surface of `lib/contracts` (M1): every name later milestones may import.
 *
 * Deliberately NOT exported: `unreachable` (the shared body of the `assertNever*` gates) and
 * `StandingTablesMatchTypes` (a compile-time assertion), neither of which is part of the contract;
 * and `StandingBase`, which the plan declares without `export`. `__tests__/public-surface.test.ts`
 * pins the run-time names and `__tests__/proofs/public-surface.proofs.ts` the type names.
 */
export { MAX_AMOUNT, MAX_ID_LENGTH, MAX_LOG_EVENTS, MAX_ROOT_DEPTH } from "./limits.js";
export type { Amount, Seq } from "./limits.js";

export { commitId, grantId, principalId } from "./ids.js";
export type { CommitId, GrantId, PrincipalId } from "./ids.js";

export type { NonEmptyReadonlyArray } from "./non-empty-array.js";

export type { Grant } from "./grant.js";
export type { Commitment } from "./commitment.js";
export type { Charter } from "./charter.js";
export type { CommitEvent, EventInput, GrantEvent, Log, LogEvent, RevokeEvent } from "./event.js";
export type { Charge, DeadLink, GrantTree } from "./tree.js";
export type { Warrant } from "./warrant.js";
export type { Verdict } from "./verdict.js";

export { assertNeverBreach } from "./breach.js";
export type { Breach } from "./breach.js";

export { assertNeverRejection } from "./rejection.js";
export type { Rejection } from "./rejection.js";

export { assertNeverFoldFault } from "./fold-fault.js";
export type { FoldFault } from "./fold-fault.js";

export { assertNeverStanding, assertStandingWellFormed } from "./standing.js";
export type {
  BindingStanding,
  InheritedStanding,
  Standing,
  StandingIntegrity,
  StandingIntegrityError,
  VoidStanding,
} from "./standing.js";
