import type { GrantId, PrincipalId } from "./ids.js";
import type { Amount, Seq } from "./limits.js";
import { unreachable } from "./unreachable.js";

/**
 * Why an act is `void`: the FIRST rule a commitment fails, in the order listed
 * (`.genesis/PLAN.md` §4.1, §4.3, D8). Closed: five variants.
 *
 * The order is a property of M5's `judgeCommit` (not built), not of this type:
 * a TypeScript union has no order. Only the first failing rule is reported, so
 * a commitment that breaks two rules shows one (plan case 06, M7).
 *
 * `capability` is a plain `string`, unlike `Commitment<C>["capability"]`: a breach
 * may need to name a capability that is outside the vocabulary.
 *
 * The variants are NOT made mutually exclusive with `?: never` the way the
 * `Standing` variants are (plan §4.2 asks that of `Standing` only). A `no-such-grant`
 * breach carrying a `holder` compiles through a non-literal route; the discriminant
 * `kind` is what a correct consumer switches on. Pinned as a control in
 * `__tests__/proofs/breach-and-verdict.proofs.ts`.
 */
export type Breach =
  | { readonly kind: "no-such-grant"; readonly grantId: GrantId }
  | { readonly kind: "wrong-actor"; readonly grantId: GrantId; readonly holder: PrincipalId }
  | { readonly kind: "link-dead"; readonly grantId: GrantId; readonly atSeq: Seq }
  | { readonly kind: "capability-not-granted"; readonly grantId: GrantId; readonly capability: string }
  | { readonly kind: "over-limit"; readonly grantId: GrantId; readonly requested: Amount; readonly headroom: Amount };

/** Exhaustiveness gate for a `switch` over `Breach`; see `unreachable.ts`. */
export function assertNeverBreach(value: never): never {
  return unreachable("Breach", value);
}
