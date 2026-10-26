import { firstDeadLink } from "../chain/index.js";
import { assertStandingWellFormed } from "../contracts/index.js";
import type { CommitId, FoldFault, GrantTree, Log, Standing, Charter, Seq } from "../contracts/index.js";
import { fold } from "./fold.js";
import type { CommitRecord } from "./fold.js";

/**
 * Standing: what a recorded commit binds NOW (plan §3 D1, D7; §4.2).
 *
 *     standing  =  the verdict fixed at the commit's own `seq`  (+)  whether its chain is still intact
 *
 * The verdict half never changes (`verdict.ts`). The liveness half is read off the tree as the log built it, which
 * is the only place a later event can show. Three outcomes, and the only change of kind over time is `binding`
 * to `inherited` (`lattice.test.ts` asserts that none of the other moves happens at the cut points of the generated logs):
 *
 *   breached verdict                    -> `void`.      The actor alone answers. Nothing turns it into anything else.
 *   warranted, no link of the chain cut -> `binding`.   Everyone on `warrant.trail` answers.
 *   warranted, some link has been cut   -> `inherited`. The heir answers, personally and through `chargedTo`.
 *
 * WHY `void` IS ABSORBING. The standing of a breached commit is built from the breach alone, and a breach is a
 * property of the verdict, which is a property of the prefix up to the commit's `seq` (`verdict.ts`). Nothing later
 * in the log is consulted for it, so no later event can change it; that is a consequence of where the data comes
 * from, not of a rule that checks it. (`lattice.test.ts` shows it behaviourally: between the cut points of the generated
 * logs, a `void` standing is the same value at every later cut point. The cut points are every prefix for 150 of the
 * 1 500 seeds and a sample for the rest; they are not every prefix of every log.)
 *
 * WHY THE HEIR IS THE GRANTOR OF THE FIRST DEAD LINK. Counting from the root, the first revoked link is the break;
 * every link above it is live, so the principal who GRANTED it still holds authority through a live chain, and is the
 * nearest such principal to the act. That principal is above the break, and is not the actor: the actor is the last
 * grantee, a principal does not repeat on a chain (`principal-cycle`), and every grantor on the chain is an earlier
 * principal on the trail. (`heir.test.ts` checks both, and that the heir is the trail principal at the break, on every
 * inherited standing it generates.) It is read from the link itself (`grantor`), NOT from whoever performed the
 * revocation (plan D7, case 11: `dana` revoking G2 still names `cfo`), and not from the link's `grantee`, who is the
 * principal the break cut off.
 *
 * WHY THE HEIR CLIMBS. Cutting a link NEARER THE ROOT later makes that link the first dead one, so `severed` moves up
 * the chain and the heir with it. `heir.test.ts` checks that across the cut points of the generated logs the severed
 * link's index never increases.
 *
 * `chargedTo` is the PARENT of the first dead link: the heir's own grant, the one that absorbs what was spent (M4's
 * `absorbedBy`). A root grant has no parent, its grantor is a charter root, and the amount is off the ledger, so
 * `chargedTo` is `null`. `severed.atSeq` is the seq of the revoke; the commit was warranted before that revoke was in
 * the log, so it is later than `committedAt` (`heir.test.ts` checks that on every inherited standing it generates).
 */
export function deriveStanding<C extends string>(tree: GrantTree<C>, record: CommitRecord<C>): Standing {
  const { commit, seq, verdict } = record;
  const base = { commitId: commit.id, committedAt: seq };

  if (verdict.kind === "breached") {
    return sealStanding({ ...base, kind: "void", breach: verdict.breach });
  }

  const dead = firstDeadLink(tree, verdict.warrant.chain);
  if (dead === undefined) {
    return sealStanding({ ...base, kind: "binding", warrant: verdict.warrant });
  }

  const link = tree.grants.get(dead.grantId);
  // A link of a warranted commit's own chain is in the tree for any tree a fold built; this is the internal-invariant
  // throw the plan allows (never for an input).
  if (link === undefined) throw new Error("internal error: a warranted commit's chain names a grant that is not in the tree");
  return sealStanding({
    ...base,
    kind: "inherited",
    warrant: verdict.warrant,
    severed: dead,
    heir: link.grantor,
    chargedTo: link.parent,
  });
}

/**
 * The only way a `Standing` leaves this file: through `assertStandingWellFormed`, which throws here if the guard says
 * no (plan §5: M5 MUST call it on every standing it returns). The types already refuse a contaminated literal where
 * the compiler can see the field; the guard is for what they cannot see (ADR 0001, Decisions 9 and 10), which here
 * means a record whose `verdict` was built by a cast. The error names the guard's finding and nothing else.
 */
export function sealStanding(standing: Standing): Standing {
  const check = assertStandingWellFormed(standing);
  if (!check.ok) {
    const error = check.error;
    const detail = error.kind === "unknown-variant" ? error.kind : `${error.kind} ${error.variant}.${error.field}`;
    throw new Error(`internal error: a standing M5 built is not well-formed (${detail})`);
  }
  return standing;
}

export type StandingsResult =
  | { readonly ok: true; readonly standings: readonly Standing[]; readonly head: Seq }
  | { readonly ok: false; readonly fault: FoldFault };

/**
 * The standing of every commit in the log, in the order of `committedAt` (the commits map is filled in `seq` order, so
 * its iteration order is that order and nothing here sorts; `lattice.test.ts` asserts it is strictly ascending), and the log's
 * `head`. Standing is derived against the tree of the WHOLE log: it is "now" for the log you give it, so folding a
 * shorter log gives the standings as they stood at that point.
 */
export function standings<C extends string>(charter: Charter<C>, log: Log<C>): StandingsResult {
  const folded = fold(charter, log);
  if (!folded.ok) return folded;
  const out: Standing[] = [];
  for (const record of folded.folded.commits.values()) out.push(deriveStanding(folded.folded.tree, record));
  return { ok: true, standings: out, head: folded.folded.head };
}

export type StandingOfResult =
  | { readonly ok: true; readonly standing: Standing }
  | {
      readonly ok: false;
      readonly failure:
        | { readonly kind: "unknown-commit"; readonly commitId: CommitId }
        | { readonly kind: "faulty-log"; readonly fault: FoldFault };
    };

/**
 * The standing of one commit, against the tree of the whole log given. It uses the verdict recorded when the commit
 * was made and does not judge the commit again: re-judging against the final tree would be hindsight (the commit's
 * own charge would be counted against its own headroom, and a link cut later would make a valid act `void`).
 */
export function standingOf<C extends string>(charter: Charter<C>, log: Log<C>, id: CommitId): StandingOfResult {
  const folded = fold(charter, log);
  if (!folded.ok) return { ok: false, failure: { kind: "faulty-log", fault: folded.fault } };
  const record = folded.folded.commits.get(id);
  if (record === undefined) return { ok: false, failure: { kind: "unknown-commit", commitId: id } };
  return { ok: true, standing: deriveStanding(folded.folded.tree, record) };
}
