import { principalId } from "../../lib/contracts/index.js";
import type { Charter, PrincipalId } from "../../lib/contracts/index.js";

/**
 * Meridian Supply Co.: the one organisation this domain simulates (plan §6 M6, §7).
 *
 * THIS FILE HOLDS NO AUTHORITY RULE. It names who is in the company and what they could ever be authorised to do; whether a
 * given grant is allowed, whether a given act binds, and who answers for it are decided in `lib/` and nowhere here. That is
 * a decision and not an accident: plan §6 M6 lists, as what this milestone must refuse, contributing any authority rule, and
 * the sibling project this one learned it from put a load-bearing safety rule into its `domains/` directory, where only
 * ordinary unit tests protected it and none of the engine's scans reached it (agent-control-tower ADR 0006, Decision 4c, named
 * in plan §6 M6). `__tests__/source-scan.test.ts` is the mechanical form of the refusal.
 *
 * THE CLOSED VOCABULARY, TWICE. `CAPABILITIES` is the runtime list the engine checks every grant and commit against (the
 * charter's `capabilities`; plan D5, "checked at runtime too"); `CompanyCapability` is the same list as a type, so that
 * the compiler refuses a misspelt capability anywhere this domain writes one (`__tests__/proofs/capability.proofs.ts`). The
 * type is derived from the list, so the two cannot disagree.
 */

/** The four things an agent of Meridian can be authorised to do (plan §6 M6: `purchase | refund | hire | sign-contract`). */
export const CAPABILITIES = Object.freeze(["purchase", "refund", "hire", "sign-contract"] as const);
export type CompanyCapability = (typeof CAPABILITIES)[number];

/** The six agents under the one human root (plan §6 M6). */
export const AGENT_NAMES = Object.freeze(["cfo", "ops", "support", "buyer-a", "buyer-b", "refunder"] as const);
export type AgentName = (typeof AGENT_NAMES)[number];

/** The one human principal. Authority originates only here (plan D5: roots are declared, not authenticated). */
export const ROOT: PrincipalId = principalId("dana");

/** An agent's principal id. Taking an `AgentName` and not a `string` is what makes a misspelt agent a compile error. */
export function agent(name: AgentName): PrincipalId {
  return principalId(name);
}

/** The six agents' principal ids, in the order of `AGENT_NAMES`. */
export const AGENTS = Object.freeze([agent("cfo"), agent("ops"), agent("support"), agent("buyer-a"), agent("buyer-b"), agent("refunder")] as const);

/** The charter every log of this domain is read against: roots `[dana]`, the four capabilities. */
export const CHARTER: Charter<CompanyCapability> = Object.freeze({
  roots: Object.freeze([ROOT] as const),
  capabilities: CAPABILITIES,
});
