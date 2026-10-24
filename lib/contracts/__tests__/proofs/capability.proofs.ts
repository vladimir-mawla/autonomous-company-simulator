import type { Charter } from "../../charter.js";
import type { Commitment } from "../../commitment.js";
import type { Grant } from "../../grant.js";
import { commitId, grantId, principalId } from "../../ids.js";

/**
 * Type-only proofs that a domain which narrows `C` cannot misspell a capability,
 * and that it cannot launder an unparameterised value into the narrowed domain
 * (see `support/proof-harness.ts`). Declarations are exported so `noUnusedLocals`
 * cannot satisfy a directive.
 */
type Cap = "purchase" | "refund";

const dana = principalId("dana");
const cfo = principalId("cfo");
const base = { id: grantId("G1"), parent: null, grantor: dana, grantee: cfo, limit: 100, depth: 1 } as const;

// ---- a misspelt capability, by a fresh literal and by three non-literal routes ----
// @ts-expect-error TS2820 Type '"purchas"' is not assignable to type 'Cap'
export const grantLiteral: Grant<Cap> = { ...base, capabilities: ["purchas"] };

const misspeltCaps = ["purchas"] as const;
// @ts-expect-error TS2322 Type '"purchas"' is not assignable to type 'Cap'
export const grantViaBinding: Grant<Cap> = { ...base, capabilities: misspeltCaps };

const misspeltGrant = { ...base, capabilities: ["purchas"] as const };
// @ts-expect-error TS2322 Type '"purchas"' is not assignable to type 'Cap'
export const grantViaWholeBinding: Grant<Cap> = misspeltGrant;

const misspeltCommit = { id: commitId("c1"), actor: cfo, actedUnder: grantId("G1"), capability: "purchas", amount: 1 } as const;
// @ts-expect-error TS2322 Type '"purchas"' is not assignable to type 'Cap'
export const commitViaBinding: Commitment<Cap> = misspeltCommit;

// @ts-expect-error TS2322 Type '"purchas"' is not assignable to type 'Cap'
export const charterLiteral: Charter<Cap> = { roots: [dana], capabilities: ["purchase", "purchas"] };

// ---- a plain `string` capability is not a `Cap` ----
declare const someString: string;
// @ts-expect-error TS2322 Type 'string' is not assignable to type 'Cap'
export const commitFromString: Commitment<Cap> = { ...misspeltCommit, capability: someString };

// ---- an unparameterised Grant cannot be handed to a domain that narrowed `C` ----
const wide: Grant = { ...base, capabilities: ["purchase"] };
// @ts-expect-error TS2322 Type 'string' is not assignable to type 'Cap'
export const wideIntoNarrow: Grant<Cap> = wide;

// CONTROLS (no directive, so they must compile).
// A correctly spelt capability is accepted, and a narrowed value widens to the default.
export const goodGrant: Grant<Cap> = { ...base, capabilities: ["purchase", "refund"] };
export const narrowIntoWide: Grant = goodGrant;
// HONEST LIMIT: with the default `C = string`, an unparameterised Grant, Commitment or Charter refuses NOTHING
// about capabilities. A misspelling is only caught once a domain narrows `C`.
export const anythingGoes: Grant = { ...base, capabilities: ["purchas", "any string at all"] };
export const anythingCommit: Commitment = { ...misspeltCommit };
export const anythingCharter: Charter = { roots: [dana], capabilities: ["purchas"] };
