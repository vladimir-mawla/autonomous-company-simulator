/**
 * The public surface of `domains/company` (M6): Meridian Supply Co., its policies, the canonical incident and the simulation.
 *
 * Everything a later layer may import is named here; a later layer imports `domains/company/index.js` and nothing deeper.
 * `__tests__/public-surface.test.ts` pins the run-time names. Deliberately not exported: the helpers in `policies.ts` (`pick`,
 * `pickFrom`, `below`, `subsetOf`, `freshId`, `delegation`, `purchase`, `aimed`, the grant filters) and `freezeDeep` and the
 * builders in `script.ts`, none of which a caller needs and each of which would let a caller build an event by a path
 * that skips the policies' or the script's own.
 */
export { AGENT_NAMES, AGENTS, CAPABILITIES, CHARTER, ROOT, agent } from "./org.js";
export type { AgentName, CompanyCapability } from "./org.js";

export { makeOrgView } from "./view.js";
export type { GrantView, OrgView, OrgViewResult } from "./view.js";

export {
  BuyerPolicy,
  COMPROMISE_TICK,
  COMPROMISED,
  CompromisedPolicy,
  DelegatorPolicy,
  OVERREACHES,
  OverreachPolicy,
  POLICIES,
  RefunderPolicy,
} from "./policies.js";
export type { Overreach, OverreachName, Policy, PolicyName, Rng } from "./policies.js";

export { CANON_SCRIPT } from "./script.js";
export type { ScriptStep } from "./script.js";

export { INCIDENT_TICK, MAX_TICKS, mulberry32, offer, outcomeOf, replayScript, runQuarter } from "./simulate.js";
export type { Attempt, AttemptOutcome, AttemptSource, OfferMeta, Offered, QuarterResult, Replay } from "./simulate.js";
