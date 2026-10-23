import type { GrantId, PrincipalId } from "./ids.js";
import type { Amount } from "./limits.js";
import type { NonEmptyReadonlyArray } from "./non-empty-array.js";
import { unreachable } from "./unreachable.js";

/**
 * Why an authority-creating event (a `grant` or `revoke`, or a malformed `commit`)
 * never entered the log (`.genesis/PLAN.md` §4.3, D4, D8). Closed: fifteen variants.
 *
 * Each variant is annotated with the milestone the PLAN assigns it to; that is a
 * statement of the plan, not of the repository: none of M3, M4 or M5 exists, so nothing
 * produces any of these yet. The first failing rule is the one reported, in the
 * admission precedence of plan §4.3; like `Breach`, that order is not in this type.
 *
 * `capability` and `id` are plain `string`s: a rejection may have to name something the
 * vocabulary or the id brands do not admit. Like `Breach`, the variants are not made
 * mutually exclusive with `?: never` (plan §4.2 asks that of `Standing` only).
 */
export type Rejection =
  | { readonly kind: "invalid-event-shape"; readonly eventKind: "grant" | "revoke" | "commit" | "unknown"; readonly fields: NonEmptyReadonlyArray<string> } // plan: M3
  | { readonly kind: "unknown-capability"; readonly capability: string } // plan: M3
  | { readonly kind: "duplicate-id"; readonly id: string } // plan: M3 (grant ids), M5 (commit ids)
  | { readonly kind: "not-a-root"; readonly grantor: PrincipalId } // plan: M3
  | { readonly kind: "unknown-parent"; readonly parent: GrantId } // plan: M3
  | { readonly kind: "parent-dead"; readonly deadGrant: GrantId } // plan: M3
  | { readonly kind: "grantor-not-holder"; readonly parent: GrantId; readonly grantor: PrincipalId; readonly holder: PrincipalId } // plan: M3
  | { readonly kind: "capability-widening"; readonly capability: string } // plan: M3
  | { readonly kind: "depth-exhausted"; readonly parent: GrantId } // plan: M3
  | { readonly kind: "depth-not-narrowed"; readonly parentDepth: number; readonly requested: number } // plan: M3
  | { readonly kind: "principal-cycle"; readonly principal: PrincipalId } // plan: M3
  | { readonly kind: "over-allocation"; readonly grantId: GrantId; readonly requested: Amount; readonly headroom: Amount } // plan: M5, from M4's Shortfall
  | { readonly kind: "unknown-grant"; readonly grantId: GrantId } // plan: M5 (revoke)
  | { readonly kind: "already-dead"; readonly grantId: GrantId } // plan: M5 (revoke)
  | { readonly kind: "revoker-not-authorised"; readonly grantId: GrantId; readonly by: PrincipalId }; // plan: M5 (revoke)

/** Exhaustiveness gate for a `switch` over `Rejection`; see `unreachable.ts`. */
export function assertNeverRejection(value: never): never {
  return unreachable("Rejection", value);
}
