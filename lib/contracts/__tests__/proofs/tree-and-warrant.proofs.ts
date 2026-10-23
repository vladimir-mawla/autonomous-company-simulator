import type { Grant } from "../../grant.js";
import { grantId, principalId } from "../../ids.js";
import type { Charge, DeadLink, GrantTree } from "../../tree.js";
import type { Warrant } from "../../warrant.js";

/**
 * Type-only proofs for the grant-tree view, `Charge`, `DeadLink` and `Warrant`
 * (see `support/proof-harness.ts`). Declarations are exported so
 * `noUnusedLocals` cannot satisfy a directive.
 */
const g1 = grantId("G1");
const dana = principalId("dana");
const grant: Grant = { id: g1, parent: null, grantor: dana, grantee: principalId("cfo"), capabilities: ["purchase"], limit: 10, depth: 1 };
declare const tree: GrantTree;

// The view has no mutators.
// @ts-expect-error TS2339 Property 'set' does not exist on type 'ReadonlyMap<GrantId, Grant<string>>'
export const setGrant = tree.grants.set(g1, grant);
// @ts-expect-error TS2339 Property 'delete' does not exist on type 'ReadonlyMap<GrantId, number>'
export const unRevoke = tree.revokedAt.delete(g1);

// A dead link and a charge are whole facts.
// @ts-expect-error TS2741 Property 'atSeq' is missing in type '{ grantId: GrantId; }' but required in type 'DeadLink'
export const noSeq: DeadLink = { grantId: g1 };
// @ts-expect-error TS2741 Property 'amount' is missing in type '{ grantId: GrantId; }' but required in type 'Charge'
export const noAmount: Charge = { grantId: g1 };

// A warrant cannot be empty on either side.
// @ts-expect-error TS2322 Source has 0 element(s) but target requires 1
export const emptyChain: Warrant = { chain: [], trail: [dana] };
// @ts-expect-error TS2322 Source has 0 element(s) but target requires 1
export const emptyTrail: Warrant = { chain: [g1], trail: [] };

// CONTROLS (no directive, so they must compile). They pin what the types do NOT say:
// a hand-built tree is a GrantTree, and a Warrant's trail is not tied to the length of its chain.
export const handBuilt: GrantTree = { grants: new Map(), revokedAt: new Map() };
export const mismatchedWarrant: Warrant = { chain: [g1], trail: [dana, dana, dana, dana] };
