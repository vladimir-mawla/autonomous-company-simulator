import { chainOf, firstDeadLink, trailOf } from "../../lib/chain/index.js";
import type { Commitment, FoldFault, Grant, Log, PrincipalId, Seq } from "../../lib/contracts/index.js";
import { fold, mayCommit } from "../../lib/standing/index.js";
import type { MayCommitResult } from "../../lib/standing/index.js";
import { CHARTER } from "./org.js";
import type { CompanyCapability } from "./org.js";

/**
 * What a policy is allowed to see of the company (plan §6 M6: policies are `(OrgView, rng) -> EventInput | null`).
 *
 * THE VIEW IS READ OFF THE ENGINE, NOT COMPUTED HERE. Whether a grant is still live comes from `lib/chain`'s walkers
 * (`chainOf` then `firstDeadLink`); the trail of principals above it from `trailOf`; and whether a commitment would bind
 * from `lib/standing`'s `mayCommit`, the pre-check plan D9 gives a runtime that wants prevention. Nothing in this file
 * decides a rule, and nothing in it does arithmetic on a limit, an amount or a headroom: a policy that wants to know whether
 * an act would be allowed asks the engine, and a policy that does not ask is simply ruled on afterwards (plan D4: acts are
 * facts). That is also why the view carries no headroom: a policy that could see one would be tempted to compute with it.
 *
 * The view is a function of `(log, tick)` and of nothing else, so two views of the same log at the same tick are the same
 * view, which is what lets `runQuarter` reuse one while the log has not changed.
 */

export interface GrantView {
  readonly grant: Grant<CompanyCapability>;
  /** Neither this grant nor any ancestor has been revoked (`lib/chain`: `firstDeadLink` finds none). */
  readonly live: boolean;
  /** The principals on this grant's chain: the charter root, then each grantee down to this grant's (`lib/chain`: `trailOf`). */
  readonly trail: readonly PrincipalId[];
  /** How many grants the chain from the root grant to this one has, this one included (`lib/chain`: `chainOf`). */
  readonly links: number;
}

export interface OrgView {
  /** The tick the policy is being stepped at. */
  readonly tick: number;
  /** The number of admitted events: the `seq` of the last one, and 0 for an empty log. */
  readonly head: Seq;
  readonly log: Log<CompanyCapability>;
  /** Every grant the log admitted, in the order it admitted them, live or not. */
  readonly grants: readonly GrantView[];
  /** The engine's pre-check for a commitment against this log (`lib/standing`: `mayCommit`). */
  readonly mayCommit: (commit: Commitment<CompanyCapability>) => MayCommitResult;
}

export type OrgViewResult = { readonly ok: true; readonly view: OrgView } | { readonly ok: false; readonly fault: FoldFault };

/**
 * The view of `log` at `tick`, or the engine's own account of why the log cannot be replayed. A log built by `append` always
 * replays (M5's replay property), so `runQuarter` never sees the second branch; it is typed because this function takes any
 * log its caller has.
 */
export function makeOrgView(log: Log<CompanyCapability>, tick: number): OrgViewResult {
  const result = fold(CHARTER, log);
  if (!result.ok) return { ok: false, fault: result.fault };
  const { tree } = result.folded;

  const grants: GrantView[] = [];
  for (const event of log) {
    if (event.kind !== "grant") continue;
    const recorded = tree.grants.get(event.grant.id);
    if (recorded === undefined) continue;
    const chain = chainOf(tree, recorded.id);
    const trail = chain === undefined ? undefined : trailOf(tree, chain);
    grants.push({
      grant: recorded,
      live: chain !== undefined && firstDeadLink(tree, chain) === undefined,
      trail: trail ?? [],
      links: chain === undefined ? 0 : chain.length,
    });
  }

  return {
    ok: true,
    view: {
      tick,
      head: result.folded.head,
      log,
      grants,
      mayCommit: (commit) => mayCommit(CHARTER, log, commit),
    },
  };
}
