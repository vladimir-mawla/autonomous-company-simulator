import { checkHeadroom } from "../allowance/index.js";
import { chainOf, firstDeadLink, trailOf } from "../chain/index.js";
import type { Breach, Charge, Commitment, GrantTree, Verdict } from "../contracts/index.js";

/**
 * The verdict on one commitment, against the ledger AS IT STANDS AT THE MOMENT OF THE ACT (plan §4.3, D1, D8, D9).
 *
 * THIS IS THE ONLY PLACE A COMMITMENT IS JUDGED. `fold` calls it for every commit in a log, `append` for the one it
 * is asked to record and `mayCommit` for the one it is asked about, through the same admission path (`fold.ts`), so
 * the pre-check and the record use one predicate and there is no second copy of it (plan D9; contrast the duplicated literal
 * that plan §3 cites from a sibling's ADR 0005 Decision 1).
 *
 * WHY THE VERDICT CANNOT DEPEND ON A LATER EVENT. The function takes the tree and the charges as they are when the
 * commit arrives and nothing else: no log, no final state. `fold` builds the tree event by event and calls this with
 * the tree it has built so far, so a revocation that comes LATER in the log is not in the tree yet. That is how the
 * verdict is fixed at the act (plan D1): at the commit's own `seq`, and never revisited,
 * and what a later revoke changes is the STANDING (`standing.ts`), which is derived from this verdict plus liveness
 * now. A caller that passed a tree built from the whole log would get hindsight; `prefix.test.ts` is what shows the
 * engine does not.
 *
 * PRECEDENCE. Five breaches, the first failing rule wins, in this order (plan §4.3; the order is the whole of the
 * precedence, and each earlier rule can hide a later one, so a commit that breaches two rules is reported for the
 * first and is `warranted` only once every rule holds):
 *
 *  1. `no-such-grant`: `actedUnder` is not in the tree, or its ancestry cannot be completed (`chainOf` and `trailOf`
 *     are `undefined`: the tests reach this with hand-built trees, and the fail-closed answer is "no such grant").
 *  2. `wrong-actor`: `actor` is not the grant's `grantee`. A grant is not lendable: acting under someone else's grant is
 *     a breach even when the grant is fine, so this is checked before liveness (plan §7, c6: borrowed AND dead is
 *     reported as borrowed).
 *  3. `link-dead`: some link on the chain, nearest the root first, has a recorded revocation; `grantId` is that link,
 *     not the grant acted under (plan §7: c5 under G4 names G2).
 *  4. `capability-not-granted`: the commit's capability is not one of the grant's.
 *  5. `over-limit`: the amount does not fit the grant's headroom (M4's `checkHeadroom`; one request for exactly the
 *     headroom fits). `headroom` is the number M4 reports, which for a live grant is `limit - used`.
 *
 * A commit is NOT refused here, and not refused anywhere: plan D4 says an act is a fact, so a breached commit is still
 * recorded, as `void` (`standing.ts`) and charging nothing. Only a `warranted` one gets a charge (`fold.ts`).
 *
 * WHAT THIS DOES NOT CHECK: that the commit's fields are well-formed or its capability is in the charter's vocabulary
 * (M3's intake, before this is called), and that its id is new (`duplicate-id`, in `fold.ts`'s admission, because it is
 * a fact about the log and not about the tree).
 */
export function judgeCommit<C extends string>(tree: GrantTree<C>, charges: readonly Charge[], commit: Commitment<C>): Verdict {
  const grant = tree.grants.get(commit.actedUnder);
  const chain = grant === undefined ? undefined : chainOf(tree, commit.actedUnder);
  const trail = chain === undefined ? undefined : trailOf(tree, chain);
  if (grant === undefined || chain === undefined || trail === undefined) {
    return breached({ kind: "no-such-grant", grantId: commit.actedUnder });
  }

  if (commit.actor !== grant.grantee) {
    return breached({ kind: "wrong-actor", grantId: commit.actedUnder, holder: grant.grantee });
  }

  const dead = firstDeadLink(tree, chain);
  if (dead !== undefined) return breached({ kind: "link-dead", grantId: dead.grantId, atSeq: dead.atSeq });

  if (!grant.capabilities.includes(commit.capability)) {
    return breached({ kind: "capability-not-granted", grantId: commit.actedUnder, capability: commit.capability });
  }

  const fit = checkHeadroom(tree, charges, commit.actedUnder, commit.amount);
  if (!fit.ok) {
    return breached({
      kind: "over-limit",
      grantId: commit.actedUnder,
      requested: fit.shortfall.requested,
      headroom: fit.shortfall.headroom,
    });
  }

  return { kind: "warranted", warrant: { chain, trail } };
}

function breached(breach: Breach): Verdict {
  return { kind: "breached", breach };
}
