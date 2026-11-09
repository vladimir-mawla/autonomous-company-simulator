import type { Log, Standing } from "../../../../lib/contracts/index.js";
import type { CompanyCapability } from "../../org.js";

/**
 * An independent conservation oracle for the tests of this domain: for EVERY grant, how much of what the engine ruled `binding` or
 * `inherited` was done under it or under anything below it, next to its limit.
 *
 * Independent means it imports nothing from `lib/allowance`, and does not use the engine's tree, charges or headroom. It takes the RAW log
 * (the events, whose parent pointers and amounts are plain data) and the engine's standings (only to learn which commits bind), and adds
 * up. A commit that binds is a charge to its own grant and, by the delegation being a loan, to every grant above it; so for every grant `g`,
 * live or revoked, the amount bound under `g`'s subtree cannot exceed `g`'s limit (plan §4.4: `subtreeOwn(g) <= limit(g)` for a grant
 * that was live, and a revoked grant takes no new charge). The oracle states that, from outside.
 *
 * What it trusts is the engine's CLASSIFICATION (which commit is `void`), not its ACCOUNTING. A void act is never summed.
 */

export interface Bound {
  readonly grant: string;
  readonly isRoot: boolean;
  readonly limit: number;
  /** The sum of the amounts of the `binding` and `inherited` commits acted under this grant or one below it. */
  readonly bound: number;
}

export interface OracleReport {
  readonly bounds: readonly Bound[];
  /** Commits ruled `binding` or `inherited` whose grant the raw log does not hold: the engine ruled a commit to bind under a grant that does not exist. */
  readonly orphans: readonly string[];
}

const MAX_CHAIN = 64;

export function oracleOf(log: Log<CompanyCapability>, standings: readonly Standing[]): OracleReport {
  const grants = new Map<string, { parent: string | null; limit: number }>();
  const order: string[] = [];
  for (const event of log) {
    if (event.kind !== "grant") continue;
    grants.set(event.grant.id, { parent: event.grant.parent, limit: event.grant.limit });
    order.push(event.grant.id);
  }
  const kindOf = new Map(standings.map((standing) => [standing.commitId as string, standing.kind]));

  const bound = new Map<string, number>(order.map((id) => [id, 0]));
  const orphans: string[] = [];
  for (const event of log) {
    if (event.kind !== "commit") continue;
    const kind = kindOf.get(event.commit.id);
    if (kind === undefined || kind === "void") continue;
    let id: string | null = event.commit.actedUnder;
    if (!grants.has(id)) {
      orphans.push(event.commit.id);
      continue;
    }
    for (let hops = 0; id !== null && hops < MAX_CHAIN; hops++) {
      bound.set(id, (bound.get(id) ?? 0) + event.commit.amount);
      id = grants.get(id)?.parent ?? null;
    }
  }

  return {
    bounds: order.map((id) => ({ grant: id, isRoot: grants.get(id)?.parent === null, limit: grants.get(id)?.limit ?? 0, bound: bound.get(id) ?? 0 })),
    orphans,
  };
}

/** The grants whose bound exceeds their limit, as sentences. Empty means the log conserves. */
export function violations(report: OracleReport): string[] {
  return [
    ...report.bounds.filter((entry) => entry.bound > entry.limit).map((entry) => `${entry.grant}: ${entry.bound} bound against a limit of ${entry.limit}`),
    ...report.orphans.map((id) => `${id}: ruled to bind under a grant the log does not hold`),
  ];
}
