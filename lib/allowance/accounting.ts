import { chainOf, firstDeadLink } from "../chain/index.js";
import type { Amount, Charge, Grant, GrantId, GrantTree } from "../contracts/index.js";

/**
 * Conservation accounting over a grant tree and the charges made against it (plan §4.4, §5, §6 M4).
 *
 * Every function is PURE over `(tree, charges)`: it reads them and keeps nothing, so the same arguments always give
 * the same answer and nothing a caller holds is changed. The tree is the one M5 will build; the charges are one
 * per WARRANTED commitment (a commitment the ledger ruled `void` charges nothing, which is M5's rule, not this
 * layer's: this layer adds up whatever charges it is given).
 *
 * THE DEFINITIONS (plan §4.4, the single source of truth for this file). For a grant `g`:
 *
 *   own(g)          the sum of the charges whose `grantId` is `g`.
 *   subtreeOwn(g)   own(g) plus subtreeOwn of each child of g. A child is a grant whose `parent` is g, revoked or not.
 *   chargeToParent(c)
 *                   what a child `c` costs its parent's allowance: `limit(c)` while `c` is not revoked (the
 *                   whole reservation is held back, spent or not), and `subtreeOwn(c)` once `c` is revoked
 *                   (only what was actually spent in its subtree: the rest has been returned).
 *   used(g)         own(g) plus the chargeToParent of each child of g.
 *   headroom(g)     limit(g) - used(g) for a live g; 0 for a dead g; undefined for a grant not in the tree.
 *   live            neither the grant nor any ancestor has a recorded revocation.
 *
 * "Revoked" in `chargeToParent` means the child ITSELF has a recorded revocation. A child that is dead only
 * because an ancestor was revoked is not revoked in this sense and still costs its full `limit`, until it is
 * revoked too; what the ancestor's own revocation releases is accounted one level up, as the ancestor's
 * `subtreeOwn`, which includes everything charged anywhere below it.
 *
 * EXACT RETURN. Revoking `h` (whose parent `p` is live) changes `chargeToParent(h)` from `limit(h)` to
 * `subtreeOwn(h)` and nothing else in the sums above, so `headroom(p)` rises by EXACTLY `limit(h) - subtreeOwn(h)`:
 * the unspent part of the reservation comes back exactly, and the spent part (`subtreeOwn(h)`, which
 * `absorbedBy` reports) stays charged to `p`. Returning less is a liveness defect (authority leaks and never comes
 * back) and returning more is a conservation defect (spent authority is forgiven). A conservation check alone
 * cannot see the first one, because a parent that is too cautious is still within its limit; that is why the
 * tests state the equality and not only the inequality.
 *
 * WHAT THIS FILE DOES NOT CLAMP. `headroomOf` reports `limit(g) - used(g)` as it is, so a live grant that has
 * been charged or reserved past its limit (only a hand-built tree or a defect can do that) shows a NEGATIVE
 * headroom. The conservation theorem says that never happens; clamping at 0 would make the theorem impossible to
 * fail.
 *
 * WHAT IT TRUSTS. The typed values of the tree and the charges (`limit`, `amount`, `parent`): they came through
 * M3's intake, and re-checking their shape here would be a second copy of intake's rules. It does NOT trust the
 * tree's topology: a grant's liveness is decided with M3's `chainOf` and `firstDeadLink`, which fail closed on a
 * cycle, a missing parent or an over-long ancestry, so a grant whose ancestry cannot be completed is treated as
 * not in the tree. A charge naming a grant that is not in the tree adds to nothing.
 */

/** What a request exceeded: the grant asked of, the amount asked for and the headroom there was (0 if dead or unknown). */
export interface Shortfall {
  readonly grantId: GrantId;
  readonly requested: Amount;
  readonly headroom: Amount;
}

export type HeadroomCheck = { readonly ok: true } | { readonly ok: false; readonly shortfall: Shortfall };

/** A child, with the one fact about it that `used` needs, so `used` never has to look the child up again. */
interface Child {
  readonly id: GrantId;
  readonly limit: Amount;
}

/** The two indexes every function here needs, built once per call in one pass over the charges and one over the grants. */
interface Book {
  readonly own: ReadonlyMap<GrantId, Amount>;
  readonly children: ReadonlyMap<GrantId, readonly Child[]>;
}

function bookOf<C extends string>(tree: GrantTree<C>, charges: readonly Charge[]): Book {
  const own = new Map<GrantId, Amount>();
  for (const charge of charges) own.set(charge.grantId, (own.get(charge.grantId) ?? 0) + charge.amount);

  // Keyed by the MAP KEY, not by `grant.id`: a hand-built tree is not required to agree with itself, and the
  // walkers in `lib/chain` also go by key.
  const children = new Map<GrantId, Child[]>();
  for (const [id, grant] of tree.grants) {
    const parent = grant.parent;
    if (parent === null) continue;
    const siblings = children.get(parent);
    if (siblings === undefined) children.set(parent, [{ id, limit: grant.limit }]);
    else siblings.push({ id, limit: grant.limit });
  }
  return { own, children };
}

/**
 * A grant has a recorded revocation. Compared with `undefined`, as `firstDeadLink` does, so the two layers agree on
 * what "recorded" means for any map they are handed.
 */
function isRevoked<C extends string>(tree: GrantTree<C>, id: GrantId): boolean {
  return tree.revokedAt.get(id) !== undefined;
}

/** `grant` is in the tree and its ancestry reaches a root grant; `live` is whether none of the chain is revoked. */
interface Located<C extends string> {
  readonly grant: Grant<C>;
  readonly live: boolean;
}

function locate<C extends string>(tree: GrantTree<C>, id: GrantId): Located<C> | undefined {
  const grant = tree.grants.get(id);
  if (grant === undefined) return undefined;
  const chain = chainOf(tree, id);
  if (chain === undefined) return undefined;
  return { grant, live: firstDeadLink(tree, chain) === undefined };
}

/**
 * subtreeOwn(root): the charges on `root` and on every grant below it, revoked or not. It walks with an explicit
 * stack, so a deep hand-built tree cannot overflow the call stack, and it has no visited set because it needs none:
 * it is only called on a grant `locate` found, whose parent pointers lead up to a root grant, and a grant below
 * such a grant cannot be its own ancestor (that would put a cycle on the found grant's own chain).
 */
function subtreeOwn(book: Book, root: GrantId): Amount {
  let total = 0;
  const pending: GrantId[] = [root];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    total += book.own.get(next) ?? 0;
    for (const child of book.children.get(next) ?? []) pending.push(child.id);
  }
  return total;
}

/**
 * used(id): own(id) plus, for each child, `limit` if the child is not revoked and `subtreeOwn` if it is. Applied
 * as written to every grant found, live or dead: the plan defines `chargeToParent` only for a child of a live grant,
 * so for a dead grant the plan gives no `used`, and this is the formula carried over unchanged. Nothing but a
 * dead grant's `used` depends on that choice; its headroom is 0 by definition.
 */
function used<C extends string>(tree: GrantTree<C>, book: Book, id: GrantId): Amount {
  let total = book.own.get(id) ?? 0;
  for (const child of book.children.get(id) ?? []) {
    total += isRevoked(tree, child.id) ? subtreeOwn(book, child.id) : child.limit;
  }
  return total;
}

/** limit(g) - used(g) for a grant found live, unclamped (see the file comment). */
function headroomOfLive<C extends string>(tree: GrantTree<C>, charges: readonly Charge[], found: Located<C>, id: GrantId): Amount {
  return found.grant.limit - used(tree, bookOf(tree, charges), id);
}

/**
 * used(id) of the file comment, or `undefined` when `id` is not in the tree (or its ancestry cannot be completed:
 * `lib/chain`'s `chainOf` fails closed, and so does this). Never a number for an id the tree does not hold.
 */
export function usedOf<C extends string>(tree: GrantTree<C>, charges: readonly Charge[], id: GrantId): Amount | undefined {
  if (locate(tree, id) === undefined) return undefined;
  return used(tree, bookOf(tree, charges), id);
}

/**
 * headroom(id) of the file comment: `limit - used` for a live grant (negative if the grant is overspent: not
 * clamped), 0 for a dead one, `undefined` for a grant the tree does not hold. A dead grant has no allowance to
 * spend or to lend, whatever its charges and reservations add up to.
 */
export function headroomOf<C extends string>(tree: GrantTree<C>, charges: readonly Charge[], id: GrantId): Amount | undefined {
  const found = locate(tree, id);
  if (found === undefined) return undefined;
  if (!found.live) return 0;
  return headroomOfLive(tree, charges, found, id);
}

/**
 * What the revocation of `revoked` cost its grantor: subtreeOwn(revoked), the amount actually spent anywhere below
 * it, which stays charged to the parent's allowance (the rest of the reservation, `limit - absorbed`, was returned).
 * `undefined` unless the grant is in the tree AND has a recorded revocation of its own: asking about a live grant
 * gets no number, because nothing has been absorbed yet.
 */
export function absorbedBy<C extends string>(tree: GrantTree<C>, charges: readonly Charge[], revoked: GrantId): Amount | undefined {
  if (locate(tree, revoked) === undefined) return undefined;
  if (!isRevoked(tree, revoked)) return undefined;
  return subtreeOwn(bookOf(tree, charges), revoked);
}

/**
 * May `requested` more be reserved from, or spent under, grant `id`? It is one question for two uses (a child's
 * `limit` is a reservation out of the parent, a commitment's `amount` is a spend under the grant), and the plan has
 * M5 take both `over-allocation` and `over-limit` from this function's shortfall (§4.3, §8 A).
 *
 * `ok` exactly when `id` is live and `requested <= headroom(id)`: a request for the whole of the headroom is
 * allowed and one more is not. A grant that is dead or not in the tree is refused whatever the amount, even 0,
 * with a shortfall that says `headroom: 0` (plan §5: "unknown/dead => shortfall with headroom 0"). Otherwise the
 * shortfall carries the headroom `headroomOf` reports, unclamped.
 *
 * The comparison is written `requested <= headroom` and not "not (requested > headroom)" so that a `requested`
 * that is NaN is refused (every comparison with NaN is false); no plan rule asks for that, it is how the line is
 * written. A negative or fractional `requested` is NOT checked here: intake refuses those (`limit` and `amount` are
 * safe integers in [0, MAX_AMOUNT]), and this layer trusts typed values.
 */
export function checkHeadroom<C extends string>(
  tree: GrantTree<C>,
  charges: readonly Charge[],
  id: GrantId,
  requested: Amount,
): HeadroomCheck {
  const found = locate(tree, id);
  if (found === undefined || !found.live) return { ok: false, shortfall: { grantId: id, requested, headroom: 0 } };
  const headroom = headroomOfLive(tree, charges, found, id);
  if (requested <= headroom) return { ok: true };
  return { ok: false, shortfall: { grantId: id, requested, headroom } };
}
