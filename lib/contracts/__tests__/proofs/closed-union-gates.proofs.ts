import { assertNeverBreach, type Breach } from "../../breach.js";
import { assertNeverFoldFault, type FoldFault } from "../../fold-fault.js";
import { assertNeverRejection, type Rejection } from "../../rejection.js";

/**
 * Type-only proofs that each `assertNever*` gate fires when a `switch` over a real
 * closed union misses a variant, and that the same switch compiles when it does not
 * (see `support/proof-harness.ts`). Declarations are exported so `noUnusedLocals`
 * cannot satisfy a directive.
 *
 * What a grown union would do is the same as what a missing `case` does: the
 * `default` branch then receives a non-`never` value. A variant added to the real
 * union therefore breaks every existing switch that ends in the gate, and the
 * consumer switches in `closed-unions.test.ts` are such switches.
 */

// ---- Breach ----
export function breachMissingOverLimit(breach: Breach): string {
  switch (breach.kind) {
    case "no-such-grant":
    case "wrong-actor":
    case "link-dead":
    case "capability-not-granted":
      return breach.kind;
    default:
      // @ts-expect-error TS2345 Argument of type '{ readonly kind: "over-limit"; readonly grantId: GrantId; readonly requested: number; readonly headroom: number; }' is not assignable to parameter of type 'never'
      return assertNeverBreach(breach);
  }
}

// ---- Rejection: the last of the fifteen is missing ----
export function rejectionMissingRevokerNotAuthorised(rejection: Rejection): string {
  switch (rejection.kind) {
    case "invalid-event-shape":
    case "unknown-capability":
    case "duplicate-id":
    case "not-a-root":
    case "unknown-parent":
    case "parent-dead":
    case "grantor-not-holder":
    case "capability-widening":
    case "depth-exhausted":
    case "depth-not-narrowed":
    case "principal-cycle":
    case "over-allocation":
    case "unknown-grant":
    case "already-dead":
      return rejection.kind;
    default:
      // @ts-expect-error TS2345 Argument of type '{ readonly kind: "revoker-not-authorised"; readonly grantId: GrantId; readonly by: PrincipalId; }' is not assignable to parameter of type 'never'
      return assertNeverRejection(rejection);
  }
}

// ---- FoldFault: the last of the five is missing ----
export function foldFaultMissingInadmissibleEvent(fault: FoldFault): string {
  switch (fault.kind) {
    case "invalid-charter":
    case "hostile-log-input":
    case "log-too-long":
    case "seq-mismatch":
      return fault.kind;
    default:
      // @ts-expect-error TS2345 Argument of type '{ readonly kind: "inadmissible-event"; readonly index: number; readonly rejection: Rejection; }' is not assignable to parameter of type 'never'
      return assertNeverFoldFault(fault);
  }
}

// CONTROLS (no directive, so they must compile): the same three switches with every variant handled.
// They show each error above is about the missing variant and not about the gate's own signature.
export function breachHandlesAll(breach: Breach): string {
  switch (breach.kind) {
    case "no-such-grant":
    case "wrong-actor":
    case "link-dead":
    case "capability-not-granted":
    case "over-limit":
      return breach.kind;
    default:
      return assertNeverBreach(breach);
  }
}
export function rejectionHandlesAll(rejection: Rejection): string {
  switch (rejection.kind) {
    case "invalid-event-shape":
    case "unknown-capability":
    case "duplicate-id":
    case "not-a-root":
    case "unknown-parent":
    case "parent-dead":
    case "grantor-not-holder":
    case "capability-widening":
    case "depth-exhausted":
    case "depth-not-narrowed":
    case "principal-cycle":
    case "over-allocation":
    case "unknown-grant":
    case "already-dead":
    case "revoker-not-authorised":
      return rejection.kind;
    default:
      return assertNeverRejection(rejection);
  }
}
export function foldFaultHandlesAll(fault: FoldFault): string {
  switch (fault.kind) {
    case "invalid-charter":
    case "hostile-log-input":
    case "log-too-long":
    case "seq-mismatch":
    case "inadmissible-event":
      return fault.kind;
    default:
      return assertNeverFoldFault(fault);
  }
}
