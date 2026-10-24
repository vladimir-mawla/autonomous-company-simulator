import type { Charter, Grant, GrantTree, PrincipalId, Rejection } from "../contracts/index.js";
import { chainOf, firstDeadLink, trailOf } from "./chain.js";

/**
 * The structural admission check for a grant (plan §4.3, §5, §6 M3): is this grant, as a link in a delegation
 * tree, allowed to exist? Nine refusals, none of which looks at amounts (`over-allocation` is M5's, from M4's
 * headroom) and none of which looks at the input's shape (that is intake: `invalid-event-shape`,
 * `unknown-capability`).
 */

export type StructureRejection = Extract<
  Rejection,
  {
    kind:
      | "duplicate-id"
      | "not-a-root"
      | "unknown-parent"
      | "parent-dead"
      | "grantor-not-holder"
      | "capability-widening"
      | "depth-exhausted"
      | "depth-not-narrowed"
      | "principal-cycle";
  }
>;
export type StructureCheck = { readonly ok: true } | { readonly ok: false; readonly rejection: StructureRejection };

function reject(rejection: StructureRejection): StructureCheck {
  return { ok: false, rejection };
}

/**
 * Decide whether `grant` may be added to `tree` under `charter`. It reports the FIRST failing rule, in this
 * order (plan §4.3; the order is the whole of the precedence, and each earlier rule can hide a later one):
 *
 *  1. `duplicate-id`: a grant with this id is already in the tree, live or revoked. Ids are never reused.
 *  then, for a root grant (`parent: null`):
 *  2. `not-a-root`: its `grantor` is not one of `charter.roots`.
 *  or, for a child:
 *  2. `unknown-parent`: `parent` is not in the tree, or its chain cannot be completed (`chainOf` is `undefined`:
 *     only a hand-built tree can do that; it is reported as an unknown parent because a parent whose ancestry
 *     cannot be established cannot be delegated under, and the plan has no tenth structure rejection for it).
 *  3. `parent-dead`: the parent or any ancestor is revoked; `deadGrant` is the link nearest the root.
 *  4. `grantor-not-holder`: `grantor` is not the parent's `grantee`. Only the holder of a grant may delegate it.
 *  5. `capability-widening`: some capability of the child is not one of the parent's (the child's set must be a
 *     SUBSET of the parent's; sharing one capability with the parent is not enough). `capability` names the
 *     first such capability in the child's own order.
 *  6. `depth-exhausted`: the parent's `depth` is 0, so it permits no further delegation.
 *  7. `depth-not-narrowed`: the child's `depth` is not strictly less than the parent's.
 *  then, for either kind:
 *  8. `principal-cycle`: the child's `grantee` is already on the chain's trail (the charter root, then each
 *     grantee down to the grantor), or, for a root grant, is the grantor itself. `principal` is the first
 *     principal in trail order that appears a second time.
 *
 * The trail includes the charter root, so a grant BACK to the root of its own chain (or a root granting to
 * itself) is a `principal-cycle`. A grantee that is some OTHER charter root, one not on this chain, is not.
 *
 * This function trusts the typed values of `grant` (they come from `readEventInput`) and does not trust the
 * tree's topology (`chain.ts`). It reads neither `limit` nor any revoke event.
 */
export function checkGrantStructure<C extends string>(charter: Charter<C>, tree: GrantTree<C>, grant: Grant<C>): StructureCheck {
  if (tree.grants.has(grant.id)) return reject({ kind: "duplicate-id", id: grant.id });

  // The principals already on the chain this grant would extend, in trail order.
  let trailAbove: readonly PrincipalId[];

  if (grant.parent === null) {
    if (!charter.roots.includes(grant.grantor)) return reject({ kind: "not-a-root", grantor: grant.grantor });
    trailAbove = [grant.grantor];
  } else {
    const parent = tree.grants.get(grant.parent);
    const chain = parent === undefined ? undefined : chainOf(tree, grant.parent);
    const trail = chain === undefined ? undefined : trailOf(tree, chain);
    if (parent === undefined || chain === undefined || trail === undefined) {
      return reject({ kind: "unknown-parent", parent: grant.parent });
    }

    const dead = firstDeadLink(tree, chain);
    if (dead !== undefined) return reject({ kind: "parent-dead", deadGrant: dead.grantId });

    if (grant.grantor !== parent.grantee) {
      return reject({ kind: "grantor-not-holder", parent: grant.parent, grantor: grant.grantor, holder: parent.grantee });
    }

    const allowed = new Set<string>(parent.capabilities);
    const widened = grant.capabilities.find((capability) => !allowed.has(capability));
    if (widened !== undefined) return reject({ kind: "capability-widening", capability: widened });

    if (parent.depth <= 0) return reject({ kind: "depth-exhausted", parent: grant.parent });
    if (grant.depth >= parent.depth) {
      return reject({ kind: "depth-not-narrowed", parentDepth: parent.depth, requested: grant.depth });
    }

    trailAbove = trail;
  }

  const seen = new Set<PrincipalId>();
  for (const principal of [...trailAbove, grant.grantee]) {
    if (seen.has(principal)) return reject({ kind: "principal-cycle", principal });
    seen.add(principal);
  }
  return { ok: true };
}
