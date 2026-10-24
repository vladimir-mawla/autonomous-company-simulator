import type { Breach } from "../../breach.js";
import { grantId, principalId } from "../../ids.js";
import type { Verdict } from "../../verdict.js";
import type { Warrant } from "../../warrant.js";

/**
 * Type-only proofs for `Breach` and `Verdict` (see `support/proof-harness.ts`).
 * Declarations are exported so `noUnusedLocals` cannot satisfy a directive.
 */
const g1 = grantId("G1");
const warrant: Warrant = { chain: [g1], trail: [principalId("dana"), principalId("cfo")] };

// A variant is whole: each of these is missing the field that makes it that variant.
// @ts-expect-error TS2322 Property 'atSeq' is missing
export const deadWithoutSeq: Breach = { kind: "link-dead", grantId: g1 };
// @ts-expect-error TS2322 Property 'headroom' is missing
export const overLimitWithoutHeadroom: Breach = { kind: "over-limit", grantId: g1, requested: 5 };
// @ts-expect-error TS2322 Type 'string' is not assignable to type 'PrincipalId'
export const bareHolder: Breach = { kind: "wrong-actor", grantId: g1, holder: "buyer-a" };

// A sixth kind is not a Breach, even when bound first (so this is an assignability error, not an excess-property one).
const ratified = { kind: "ratified" as const, grantId: g1 };
// @ts-expect-error TS2322 Type '{ kind: "ratified"; grantId: GrantId; }' is not assignable to type 'Breach'
export const sixthKind: Breach = ratified;

// HONEST LIMIT: the variants are not mutually exclusive. A `no-such-grant` carrying a `holder`, and a `warranted`
// verdict carrying a `breach`, compile through a non-literal route.
const noSuchGrantWithHolder = { kind: "no-such-grant" as const, grantId: g1, holder: principalId("buyer-a") };
export const looseBreach: Breach = noSuchGrantWithHolder;
const warrantedWithBreach = { kind: "warranted" as const, warrant, breach: { kind: "no-such-grant" as const, grantId: g1 } };
export const looseVerdict: Verdict = warrantedWithBreach;
