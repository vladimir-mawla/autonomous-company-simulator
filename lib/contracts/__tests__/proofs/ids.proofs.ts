import { type CommitId, type GrantId, type PrincipalId, commitId, grantId, principalId } from "../../ids.js";

/**
 * Type-only proofs for the three id brands; checked by `type-proofs.test.ts`
 * (see `support/proof-harness.ts` for why a bare expect-error directive is
 * not enough, and for why this comment must not spell the directive out).
 * Every declaration below is exported so `noUnusedLocals` cannot satisfy a
 * directive with an unused-variable error.
 */
const principal: PrincipalId = principalId("dana");
const grant: GrantId = grantId("G1");
const commit: CommitId = commitId("c1");

// Each brand refuses the other two (one proof per ordered pair that matters).
// @ts-expect-error TS2322 Type 'PrincipalId' is not assignable to type 'GrantId'
export const principalAsGrant: GrantId = principal;
// @ts-expect-error TS2322 Type 'GrantId' is not assignable to type 'CommitId'
export const grantAsCommit: CommitId = grant;
// @ts-expect-error TS2322 Type 'CommitId' is not assignable to type 'PrincipalId'
export const commitAsPrincipal: PrincipalId = commit;

// A bare string is not an id; only a mint function produces one.
// @ts-expect-error TS2322 Type 'string' is not assignable to type 'PrincipalId'
export const bareAsPrincipal: PrincipalId = "dana";
// @ts-expect-error TS2322 Type 'string' is not assignable to type 'GrantId'
export const bareAsGrant: GrantId = "G1";
// @ts-expect-error TS2322 Type 'string' is not assignable to type 'CommitId'
export const bareAsCommit: CommitId = "c1";

// The slip the brands exist to stop: looking a grant up by a principal.
const grantsById = new Map<GrantId, number>();
// @ts-expect-error TS2345 Argument of type 'PrincipalId' is not assignable to parameter of type 'GrantId'
export const wrongLookup = grantsById.get(principal);

// CONTROLS (no directive, so they must compile): the brand narrows, it does not wall off.
export const principalIsAString: string = principal;
export const rightLookup = grantsById.get(grant);
