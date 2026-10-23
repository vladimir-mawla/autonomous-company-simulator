import type { GrantId, PrincipalId } from "./ids.js";
import type { Amount } from "./limits.js";
import type { NonEmptyReadonlyArray } from "./non-empty-array.js";

/**
 * A unit of delegated authority: a closed capability set, ONE conserved `limit`,
 * a `depth`, and a parent (`.genesis/PLAN.md` §4.1, D2, D6).
 *
 * `C` is the capability vocabulary. A domain narrows it (`Grant<"purchase" | "refund">`)
 * and a misspelt capability then does not compile. The default `C = string` refuses
 * nothing: an unparameterised `Grant` accepts any string as a capability, which is
 * pinned as an honest limit in `__tests__/proofs/capability.proofs.ts`. The closed
 * vocabulary that exists at run time is `Charter.capabilities`; the plan has M3 check
 * a grant against it (not built).
 *
 * Every field is a CLAIM made by whoever wrote the event. This file states what a
 * field is for; the checks the plan assigns to later milestones are not performed here.
 */
export interface Grant<C extends string = string> {
  readonly id: GrantId;
  /** `null` marks a root grant, whose grantor the plan requires to be a `Charter` root. */
  readonly parent: GrantId | null;
  /** The principal acting as grantor. A claim: the plan has M3 compare it with `parent.grantee`. */
  readonly grantor: PrincipalId;
  readonly grantee: PrincipalId;
  readonly capabilities: NonEmptyReadonlyArray<C>;
  /** Reserved out of the parent's headroom (plan D2). Intended range: `[0, MAX_AMOUNT]`; the type does not say so. */
  readonly limit: Amount;
  /** Further delegation hops this grant permits; `0` means act, never delegate. Intended range: `[0, MAX_ROOT_DEPTH]`. */
  readonly depth: number;
}
