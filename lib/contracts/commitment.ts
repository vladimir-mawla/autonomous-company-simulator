import type { CommitId, GrantId, PrincipalId } from "./ids.js";
import type { Amount } from "./limits.js";

/**
 * An act an actor claims to have done under a grant (plan §4.1). A commitment is
 * always recorded as a fact and then classified (plan D4); this type says nothing
 * about whether it binds.
 *
 * `capability` is `C`, so a domain that narrows `C` cannot misspell it. It is not
 * the same as `Breach["capability-not-granted"].capability`, which is a plain
 * `string` because a breach can name a capability outside the vocabulary.
 */
export interface Commitment<C extends string = string> {
  readonly id: CommitId;
  /** A claim; the plan has `judgeCommit` (M5, not built) compare it with the grant's grantee. */
  readonly actor: PrincipalId;
  /** The grant the actor claims to act under. */
  readonly actedUnder: GrantId;
  readonly capability: C;
  /** Intended range: `[0, MAX_AMOUNT]`; the type does not say so. */
  readonly amount: Amount;
}
