import type {
  Amount,
  BindingStanding,
  Breach,
  Charge,
  Charter,
  CommitEvent,
  CommitId,
  Commitment,
  DeadLink,
  EventInput,
  FoldFault,
  Grant,
  GrantEvent,
  GrantId,
  GrantTree,
  InheritedStanding,
  Log,
  LogEvent,
  NonEmptyReadonlyArray,
  PrincipalId,
  Rejection,
  RevokeEvent,
  Seq,
  Standing,
  StandingIntegrity,
  StandingIntegrityError,
  Verdict,
  VoidStanding,
  Warrant,
} from "../../index.js";
// @ts-expect-error TS2305|TS2724 has no exported member
import type { StandingBase } from "../../index.js";
// @ts-expect-error TS2305|TS2724 has no exported member
import type { StandingTablesMatchTypes } from "../../index.js";

/**
 * Every TYPE the barrel must export (a name missing from `index.ts` is an error on its import line,
 * which the harness reports because this file has no directive there), and two internal names it must
 * not. The run-time names are pinned in `public-surface.test.ts`.
 */
export type ExportedTypes = [
  Amount,
  BindingStanding,
  Breach,
  Charge,
  Charter,
  CommitEvent,
  CommitId,
  Commitment,
  DeadLink,
  EventInput,
  FoldFault,
  Grant,
  GrantEvent,
  GrantId,
  GrantTree,
  InheritedStanding,
  Log,
  LogEvent,
  NonEmptyReadonlyArray<unknown>,
  PrincipalId,
  Rejection,
  RevokeEvent,
  Seq,
  Standing,
  StandingIntegrity,
  StandingIntegrityError,
  Verdict,
  VoidStanding,
  Warrant,
];
export type NotExported = [StandingBase, StandingTablesMatchTypes];
