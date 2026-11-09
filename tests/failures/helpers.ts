import { commitId, grantId, principalId } from "../../lib/contracts/index.js";
import type { Commitment, EventInput, FoldFault, Grant, Log, Standing } from "../../lib/contracts/index.js";
import { append, fold, mayCommit, standingOf, standings } from "../../lib/standing/index.js";
import type { AppendResult } from "../../lib/standing/index.js";
import { CHARTER } from "../../domains/company/index.js";
import type { CompanyCapability } from "../../domains/company/index.js";

/**
 * Shared builders for the failure suite (plan section 6, M7). Nothing here rules on anything: every ruling in a case comes
 * from `lib/standing`, called through its barrel, against Meridian's charter (`dana` is the one root; the four capabilities).
 * A case that wants an answer asks `append`, `fold`, `standings` or `standingOf` and asserts what the engine says.
 */

export type Ev = EventInput<CompanyCapability>;
export type CompanyLog = Log<CompanyCapability>;

export { CHARTER };

export interface GrantSpec {
  readonly id: string;
  readonly parent?: string;
  readonly grantor: string;
  readonly grantee: string;
  readonly capabilities: readonly [CompanyCapability, ...CompanyCapability[]];
  readonly limit: number;
  readonly depth: number;
}

export function grantEv(spec: GrantSpec): Ev {
  const grant: Grant<CompanyCapability> = {
    id: grantId(spec.id),
    parent: spec.parent === undefined ? null : grantId(spec.parent),
    grantor: principalId(spec.grantor),
    grantee: principalId(spec.grantee),
    capabilities: spec.capabilities,
    limit: spec.limit,
    depth: spec.depth,
  };
  return { kind: "grant", grant };
}

export function commitEv(id: string, actor: string, under: string, capability: CompanyCapability, amount: number): Ev {
  const commit: Commitment<CompanyCapability> = {
    id: commitId(id),
    actor: principalId(actor),
    actedUnder: grantId(under),
    capability,
    amount,
  };
  return { kind: "commit", commit };
}

export function revokeEv(grant: string, by: string): Ev {
  return { kind: "revoke", grantId: grantId(grant), by: principalId(by) };
}

/** Append one event, or throw with the engine's own answer if it was not admitted (a fixture bug, not a finding). */
export function admit(log: CompanyLog, input: Ev): { readonly log: CompanyLog; readonly result: Extract<AppendResult<CompanyCapability>, { ok: true }> } {
  const result = append(CHARTER, log, input);
  if (!result.ok) throw new Error(`fixture: the engine did not admit ${JSON.stringify(input)}: ${JSON.stringify(result.failure)}`);
  return { log: result.log, result };
}

/** Admit the events in order from an empty log. */
export function build(events: readonly Ev[], from: CompanyLog = []): CompanyLog {
  let log = from;
  for (const event of events) log = admit(log, event).log;
  return log;
}

/**
 * Stamp `seq` 1..n on events by hand and return the log WITHOUT asking the engine to admit them: for logs too long to build
 * by `append` (which replays the log for every call) and for logs a test wants to hand-build. `fold` is what rules on them.
 */
export function stamped(events: readonly Ev[]): CompanyLog {
  return events.map((event, index) => ({ ...event, seq: index + 1 })) as CompanyLog;
}

export function standingFor(log: CompanyLog, id: string): Standing {
  const result = standingOf(CHARTER, log, commitId(id));
  if (!result.ok) throw new Error(`fixture: no standing for ${id}: ${JSON.stringify(result.failure)}`);
  return result.standing;
}

/** Standing kind by commit id, for every commit of the log. */
export function kindsOf(log: CompanyLog): Record<string, Standing["kind"]> {
  const result = standings(CHARTER, log);
  if (!result.ok) throw new Error(`fixture: the log does not fold: ${JSON.stringify(result.fault)}`);
  return Object.fromEntries(result.standings.map((standing) => [standing.commitId, standing.kind]));
}

/** What `mayCommit` says for a commit built from the same arguments as `commitEv`. */
export function askCommit(log: CompanyLog, id: string, actor: string, under: string, capability: CompanyCapability, amount: number) {
  const ev = commitEv(id, actor, under, capability, amount);
  if (ev.kind !== "commit") throw new Error("unreachable");
  return mayCommit(CHARTER, log, ev.commit);
}

/** The five public entry points of the engine, each reduced to the typed fault it answered with (or `null` for none). */
export type Entry = readonly [name: string, run: (charter: unknown, log: unknown) => FoldFault | null];

const probeCommit = commitEv("probe", "buyer-a", "no-such-grant", "purchase", 1);

export const ENTRY_POINTS: readonly Entry[] = [
  ["fold", (charter, log) => {
    const r = fold(charter as typeof CHARTER, log as CompanyLog);
    return r.ok ? null : r.fault;
  }],
  ["standings", (charter, log) => {
    const r = standings(charter as typeof CHARTER, log as CompanyLog);
    return r.ok ? null : r.fault;
  }],
  ["standingOf", (charter, log) => {
    const r = standingOf(charter as typeof CHARTER, log as CompanyLog, commitId("whatever"));
    if (r.ok) return null;
    return r.failure.kind === "faulty-log" ? r.failure.fault : null;
  }],
  ["append", (charter, log) => {
    const r = append(charter as typeof CHARTER, log as CompanyLog, probeCommit);
    return r.ok || r.failure.kind !== "faulty-log" ? null : r.failure.fault;
  }],
  ["mayCommit", (charter, log) => {
    if (probeCommit.kind !== "commit") throw new Error("unreachable");
    const r = mayCommit(charter as typeof CHARTER, log as CompanyLog, probeCommit.commit);
    return r.ok || r.failure.kind !== "faulty-log" ? null : r.failure.fault;
  }],
];
