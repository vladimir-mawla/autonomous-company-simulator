import type { GrantId, PrincipalId } from "./ids.js";
import type { NonEmptyReadonlyArray } from "./non-empty-array.js";

/**
 * The proof a `binding` or `inherited` standing carries that an act had authority
 * behind it (`.genesis/PLAN.md` §4.1, §4.2): the chain of grants from a charter root
 * down to the grant acted under, and the principals along it.
 *
 * The plan's relationship between the two arrays (`trail` is the charter root, then
 * each grantee down to the actor, so one longer than `chain`) is NOT expressed by
 * this type: a `Warrant` whose `trail` is any non-empty length compiles. Whether a
 * given warrant is consistent with a grant tree is for M5 (not built) to produce
 * and to test.
 */
export interface Warrant {
  /** Root grant first, the grant acted under last. */
  readonly chain: NonEmptyReadonlyArray<GrantId>;
  /** The charter root first, then each grantee down to the actor. */
  readonly trail: NonEmptyReadonlyArray<PrincipalId>;
}
