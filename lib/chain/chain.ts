import { MAX_ROOT_DEPTH } from "../contracts/index.js";
import type { DeadLink, GrantId, GrantTree, NonEmptyReadonlyArray, PrincipalId } from "../contracts/index.js";

/**
 * Walkers over a `GrantTree`: the chain from a root grant down to a grant, the principals along it, the first
 * revoked link on it, and who stands above a grant with their own authority intact (plan §5, §6 M3).
 *
 * THE TREE IS NOT TRUSTED FOR ITS SHAPE. `lib/contracts/tree.ts` says a `GrantTree` can be built by hand, and a
 * hand-built one can have a grant whose `parent` is itself, two grants that are each other's parent, a parent that
 * is not in the tree, or a chain longer than any admitted tree can hold. A tree that was only ever extended by
 * grants that `checkGrantStructure` accepted cannot have any of those (a parent must already be in the tree, a
 * child's `depth` must be strictly less than its parent's, and intake caps a root's at `MAX_ROOT_DEPTH`), so for
 * such a tree the bound below never bites; for any other it is what stops a walk from looping. M5's `fold`, which
 * the plan has building the tree, does not exist yet; that sentence is about those rules, not about it. A walk
 * visits at most `MAX_ROOT_DEPTH + 1` grants and, past that, FAILS CLOSED by returning `undefined` (or an empty
 * list), never a partial answer.
 *
 * What these functions DO trust is the typed VALUES of a grant that is in the tree (`grantor`, `grantee`,
 * `depth`...): those arrived through `readEventInput`, and re-reading each value's shape here would be a second,
 * separate copy of intake's rules. Each visited grant's `parent` is read once per `chainOf` call
 * (`hostile-input.test.ts` counts it). In `trailOf` and `liveAuthorityAbove` each field is read once per visit as
 * written, but no test counts those reads.
 */

/** The most grants a chain can have: a root of depth `MAX_ROOT_DEPTH`, then one grant per remaining depth, ending at depth 0. */
const MAX_CHAIN_LENGTH = MAX_ROOT_DEPTH + 1;

/**
 * The chain of grants from the root grant down to `id`, root first and `id` last, or `undefined`.
 *
 * `undefined` means `id` is not in the tree, OR following `parent` pointers does not reach a root grant
 * (`parent: null`) within `MAX_ROOT_DEPTH + 1` grants: a cycle, a parent that is missing, or an ancestry of more
 * than `MAX_ROOT_DEPTH + 1` grants (see the file comment). It does not depend on `revokedAt`: a revoked grant is still on its chain, and finding
 * which link is dead is `firstDeadLink`'s job.
 */
export function chainOf<C extends string>(tree: GrantTree<C>, id: GrantId): NonEmptyReadonlyArray<GrantId> | undefined {
  const upward: GrantId[] = [];
  let current: GrantId = id;
  for (let visited = 0; visited < MAX_CHAIN_LENGTH; visited++) {
    const grant = tree.grants.get(current);
    if (grant === undefined) return undefined;
    upward.push(current);

    const parent = grant.parent;
    if (parent === null) {
      const [root, ...rest] = upward.reverse();
      // `upward` has at least `current`, so `root` is always set; the check is for the type, and for nothing else.
      if (root === undefined) return undefined;
      return [root, ...rest];
    }
    current = parent;
  }
  return undefined;
}

/**
 * The principals along `chain`: the charter root (the first grant's `grantor`), then each grant's `grantee`, so
 * one longer than the chain. `undefined` unless `chain` is a root-first run of grants that are all in the tree
 * and linked by `parent` (the first has `parent: null`, each next one names the one before), at most
 * `MAX_ROOT_DEPTH + 1` long. A list that is not such a run (the grants out of order, a grant skipped, a grant
 * from another branch, an empty list from a cast) would otherwise produce a trail that no delegation made.
 */
export function trailOf<C extends string>(
  tree: GrantTree<C>,
  chain: NonEmptyReadonlyArray<GrantId>,
): NonEmptyReadonlyArray<PrincipalId> | undefined {
  if (chain.length === 0 || chain.length > MAX_CHAIN_LENGTH) return undefined;

  const trail: PrincipalId[] = [];
  let previous: GrantId | null = null;
  for (const id of chain) {
    const grant = tree.grants.get(id);
    if (grant === undefined) return undefined;
    if (grant.parent !== previous) return undefined;
    if (previous === null) trail.push(grant.grantor);
    trail.push(grant.grantee);
    previous = id;
  }
  const [charterRoot, ...rest] = trail;
  if (charterRoot === undefined) return undefined;
  return [charterRoot, ...rest];
}

/**
 * The link on `chain` nearest the root that has a recorded revocation, with the `seq` of that revocation, or
 * `undefined` if none has. Nearest the root, not nearest the leaf: the heir (plan D7) is the grantor of that
 * link, it always sits above the break, and as higher links are cut it moves up, never sideways or down.
 * Only `tree.revokedAt` is consulted; `chain` is taken as given.
 */
export function firstDeadLink<C extends string>(tree: GrantTree<C>, chain: readonly GrantId[]): DeadLink | undefined {
  for (const id of chain) {
    const atSeq = tree.revokedAt.get(id);
    if (atSeq !== undefined) return { grantId: id, atSeq };
  }
  return undefined;
}

/**
 * The principals who may be said to stand ABOVE the grant `id` with their own authority intact: the grantors
 * on its chain whose own chain-prefix is fully live, root first. Concretely, for a chain `[g1 ... gn]` with no
 * dead link that is the grantor of each of `g1 ... gn`; if `gk` is the first dead link it is the grantors of
 * `g1 ... gk` (the grantor of `gk` is the heir: its own authority runs through `g1 ... g(k-1)`, all live), and
 * the grantors of `g(k+1)` and below are excluded because their authority runs through `gk`.
 *
 * The grantee of `id` is never included (it holds the grant, it is not above it), and neither is a charter root
 * that is not on this chain. Unknown id, or a chain `chainOf` cannot complete: an empty list, so that a caller
 * that asks "is this principal above this grant?" gets "no" rather than a guess. Whether the revoker of a grant
 * is one of these principals is M5's rule (`revoker-not-authorised`); nothing here reads a revoke event.
 */
export function liveAuthorityAbove<C extends string>(tree: GrantTree<C>, id: GrantId): readonly PrincipalId[] {
  const chain = chainOf(tree, id);
  if (chain === undefined) return [];
  const dead = firstDeadLink(tree, chain);

  const above: PrincipalId[] = [];
  for (const linkId of chain) {
    const grant = tree.grants.get(linkId);
    if (grant === undefined) return [];
    above.push(grant.grantor);
    if (dead !== undefined && linkId === dead.grantId) break;
  }
  return above;
}
