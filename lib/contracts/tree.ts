import type { Grant } from "./grant.js";
import type { GrantId } from "./ids.js";
import type { Amount, Seq } from "./limits.js";

/**
 * A read-only VIEW of the grants admitted so far and when each was revoked
 * (`.genesis/PLAN.md` §4.1). M3's and M4's functions are specified to take one.
 *
 * Two things the plan says about it are NOT guaranteed by this type:
 *  - "built only inside `fold`" (M5): nothing stops a caller building a tree by hand,
 *    and M3's hostile-tree tests (cyclic parent pointers) need exactly that.
 *  - "`revokedAt` is write-once": `ReadonlyMap` is a type-level view, not a freeze.
 *    Whoever holds the underlying `Map` can still overwrite a key, and this view
 *    follows it (pinned in `__tests__/tree.test.ts`).
 * Both would have to be properties of M5's construction; M5 is not built.
 */
export interface GrantTree<C extends string = string> {
  readonly grants: ReadonlyMap<GrantId, Grant<C>>;
  /** The `seq` of the admitted `revoke` event for each revoked grant. */
  readonly revokedAt: ReadonlyMap<GrantId, Seq>;
}

/** The amount one WARRANTED commitment charged to the grant it acted under (plan §4.1, §4.4). */
export interface Charge {
  readonly grantId: GrantId;
  readonly amount: Amount;
}

/** A revoked link on a delegation chain and the `seq` of the revocation that cut it. */
export interface DeadLink {
  readonly grantId: GrantId;
  readonly atSeq: Seq;
}
