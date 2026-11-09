import { describe, expect, it } from "vitest";
import * as company from "../index.js";
import type {
  AgentName,
  Attempt,
  AttemptOutcome,
  AttemptSource,
  CompanyCapability,
  GrantView,
  OfferMeta,
  Offered,
  OrgView,
  OrgViewResult,
  Overreach,
  OverreachName,
  Policy,
  PolicyName,
  QuarterResult,
  Replay,
  Rng,
  ScriptStep,
} from "../index.js";

/**
 * What `domains/company/index.ts` exports. A later layer (M8's bridge, the demo) imports this barrel and nothing deeper, so the barrel is
 * the surface to pin: the run-time names exactly, and the type names by importing every one of them (dropping one from the barrel is a compile
 * error, which `npm run typecheck` reports and `npm test` does not, since it strips types).
 *
 * Not exported on purpose, and shown not to be: the price lists and chances of `policies.ts` (a caller that could read or change them would be
 * choosing what a policy draws from), the helpers of `policies.ts` and `script.ts`, and `freezeDeep`.
 */

describe("the barrel", () => {
  it("exports exactly these run-time names", () => {
    expect(Object.keys(company).sort()).toEqual(
      [
        "AGENTS",
        "AGENT_NAMES",
        "BuyerPolicy",
        "CANON_SCRIPT",
        "CAPABILITIES",
        "CHARTER",
        "COMPROMISED",
        "COMPROMISE_TICK",
        "CompromisedPolicy",
        "DelegatorPolicy",
        "INCIDENT_TICK",
        "MAX_TICKS",
        "OVERREACHES",
        "OverreachPolicy",
        "POLICIES",
        "ROOT",
        "RefunderPolicy",
        "agent",
        "makeOrgView",
        "mulberry32",
        "offer",
        "outcomeOf",
        "replayScript",
        "runQuarter",
      ].sort(),
    );
  });

  it("the functions are functions and the five policies are the ones POLICIES holds", () => {
    for (const name of ["agent", "makeOrgView", "mulberry32", "offer", "outcomeOf", "replayScript", "runQuarter", "BuyerPolicy", "CompromisedPolicy", "DelegatorPolicy", "OverreachPolicy", "RefunderPolicy"] as const) {
      expect(typeof company[name], name).toBe("function");
    }
    expect(company.POLICIES.map((entry) => entry.policy)).toEqual([company.DelegatorPolicy, company.BuyerPolicy, company.RefunderPolicy, company.OverreachPolicy, company.CompromisedPolicy]);
  });

  it("no helper and no price list leaks", () => {
    for (const name of ["pick", "pickFrom", "below", "subsetOf", "freshId", "delegation", "purchase", "aimed", "freezeDeep", "ORDER_AMOUNTS", "REFUND_AMOUNTS", "DRAIN_AMOUNTS", "DELEGATION_LIMITS", "ROOT_LIMITS", "OVERREACH_AMOUNT", "DELEGATE_CHANCE", "grant", "commit", "revoke"]) {
      expect(Object.keys(company), name).not.toContain(name);
    }
  });
});

/** Every type the barrel names, so that dropping one is a compile error. */
export type PublicTypes = readonly [AgentName, Attempt, AttemptOutcome, AttemptSource, CompanyCapability, GrantView, OfferMeta, Offered, OrgView, OrgViewResult, Overreach, OverreachName, Policy, PolicyName, QuarterResult, Replay, Rng, ScriptStep];
