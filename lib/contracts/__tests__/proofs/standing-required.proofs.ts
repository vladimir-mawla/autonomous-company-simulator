import { commitId, grantId, principalId } from "../../ids.js";
import type { Standing } from "../../standing.js";
import type { DeadLink } from "../../tree.js";
import type { Warrant } from "../../warrant.js";


/**
 * Type-only proofs that an `inherited` standing must carry `severed`, `heir` and `chargedTo`, and
 * that `chargedTo` may be `null` but not `undefined` (see `support/proof-harness.ts`). One value per
 * missing field, so the removal of one requirement cannot hide behind another. The eight routes are the
 * same as in `standing-forbidden.proofs.ts`. Every declaration is exported so `noUnusedLocals` cannot
 * satisfy a directive.
 *
 * Written by a throwaway script; this file, not the script, is the source of truth, so edit it directly.
 */

const cid = commitId("c1");
const at = 11;
const warrant: Warrant = { chain: [grantId("G1"), grantId("G2")], trail: [principalId("dana"), principalId("cfo"), principalId("ops")] };
const severed: DeadLink = { grantId: grantId("G2"), atSeq: 11 };
const heir = principalId("cfo");
const chargedTo = grantId("G1");
/** The "generic helper" route: returns its argument at the argument's own type. */
function identity<T>(value: T): T {
  return value;
}


// ---- an `inherited` standing without `heir` ----
const inheritedWithoutHeir = { kind: "inherited" as const, commitId: cid, committedAt: at, warrant, severed, chargedTo };
// @ts-expect-error TS2322|TS2741 Property 'heir' is missing
export const inheritedWithoutHeir_literal: Standing = { kind: "inherited", commitId: cid, committedAt: at, warrant, severed, chargedTo };
// @ts-expect-error TS2322|TS2741 Property 'heir' is missing
export const inheritedWithoutHeir_binding: Standing = inheritedWithoutHeir;
// @ts-expect-error TS2322|TS2741 Property 'heir' is missing
export const inheritedWithoutHeir_spread: Standing = { ...inheritedWithoutHeir };
export function inheritedWithoutHeir_return(): Standing {
  // @ts-expect-error TS2322|TS2741 Property 'heir' is missing
  return inheritedWithoutHeir;
}
// @ts-expect-error TS1360 Property 'heir' is missing
export const inheritedWithoutHeir_satisfies = inheritedWithoutHeir satisfies Standing;
// @ts-expect-error TS2322|TS2741 Property 'heir' is missing
export const inheritedWithoutHeir_identity: Standing = identity(inheritedWithoutHeir);
// @ts-expect-error TS2322|TS2741 Property 'heir' is missing
export const inheritedWithoutHeir_assign: Standing = Object.assign({}, inheritedWithoutHeir);
// @ts-expect-error TS2322|TS2741 Property 'heir' is missing
export const inheritedWithoutHeir_array: Standing[] = [inheritedWithoutHeir];

// ---- an `inherited` standing without `severed` ----
const inheritedWithoutSevered = { kind: "inherited" as const, commitId: cid, committedAt: at, warrant, heir, chargedTo };
// @ts-expect-error TS2322|TS2741 Property 'severed' is missing
export const inheritedWithoutSevered_literal: Standing = { kind: "inherited", commitId: cid, committedAt: at, warrant, heir, chargedTo };
// @ts-expect-error TS2322|TS2741 Property 'severed' is missing
export const inheritedWithoutSevered_binding: Standing = inheritedWithoutSevered;
// @ts-expect-error TS2322|TS2741 Property 'severed' is missing
export const inheritedWithoutSevered_spread: Standing = { ...inheritedWithoutSevered };
export function inheritedWithoutSevered_return(): Standing {
  // @ts-expect-error TS2322|TS2741 Property 'severed' is missing
  return inheritedWithoutSevered;
}
// @ts-expect-error TS1360 Property 'severed' is missing
export const inheritedWithoutSevered_satisfies = inheritedWithoutSevered satisfies Standing;
// @ts-expect-error TS2322|TS2741 Property 'severed' is missing
export const inheritedWithoutSevered_identity: Standing = identity(inheritedWithoutSevered);
// @ts-expect-error TS2322|TS2741 Property 'severed' is missing
export const inheritedWithoutSevered_assign: Standing = Object.assign({}, inheritedWithoutSevered);
// @ts-expect-error TS2322|TS2741 Property 'severed' is missing
export const inheritedWithoutSevered_array: Standing[] = [inheritedWithoutSevered];

// ---- an `inherited` standing without `chargedTo` ----
const inheritedWithoutChargedTo = { kind: "inherited" as const, commitId: cid, committedAt: at, warrant, severed, heir };
// @ts-expect-error TS2322|TS2741 Property 'chargedTo' is missing
export const inheritedWithoutChargedTo_literal: Standing = { kind: "inherited", commitId: cid, committedAt: at, warrant, severed, heir };
// @ts-expect-error TS2322|TS2741 Property 'chargedTo' is missing
export const inheritedWithoutChargedTo_binding: Standing = inheritedWithoutChargedTo;
// @ts-expect-error TS2322|TS2741 Property 'chargedTo' is missing
export const inheritedWithoutChargedTo_spread: Standing = { ...inheritedWithoutChargedTo };
export function inheritedWithoutChargedTo_return(): Standing {
  // @ts-expect-error TS2322|TS2741 Property 'chargedTo' is missing
  return inheritedWithoutChargedTo;
}
// @ts-expect-error TS1360 Property 'chargedTo' is missing
export const inheritedWithoutChargedTo_satisfies = inheritedWithoutChargedTo satisfies Standing;
// @ts-expect-error TS2322|TS2741 Property 'chargedTo' is missing
export const inheritedWithoutChargedTo_identity: Standing = identity(inheritedWithoutChargedTo);
// @ts-expect-error TS2322|TS2741 Property 'chargedTo' is missing
export const inheritedWithoutChargedTo_assign: Standing = Object.assign({}, inheritedWithoutChargedTo);
// @ts-expect-error TS2322|TS2741 Property 'chargedTo' is missing
export const inheritedWithoutChargedTo_array: Standing[] = [inheritedWithoutChargedTo];

// ---- an `inherited` standing whose `chargedTo` is `undefined` (`null` is allowed, `undefined` is not) ----
const inheritedChargedToUndefined = { kind: "inherited" as const, commitId: cid, committedAt: at, warrant, severed, heir, chargedTo: undefined };
// @ts-expect-error TS2322|TS2375 Types of property 'chargedTo' are incompatible
export const inheritedChargedToUndefined_literal: Standing = { kind: "inherited", commitId: cid, committedAt: at, warrant, severed, heir, chargedTo: undefined };
// @ts-expect-error TS2322|TS2375 Types of property 'chargedTo' are incompatible
export const inheritedChargedToUndefined_binding: Standing = inheritedChargedToUndefined;
// @ts-expect-error TS2322|TS2375 Types of property 'chargedTo' are incompatible
export const inheritedChargedToUndefined_spread: Standing = { ...inheritedChargedToUndefined };
export function inheritedChargedToUndefined_return(): Standing {
  // @ts-expect-error TS2322|TS2375 Types of property 'chargedTo' are incompatible
  return inheritedChargedToUndefined;
}
// @ts-expect-error TS1360 Types of property 'chargedTo' are incompatible
export const inheritedChargedToUndefined_satisfies = inheritedChargedToUndefined satisfies Standing;
// @ts-expect-error TS2322|TS2375 Types of property 'chargedTo' are incompatible
export const inheritedChargedToUndefined_identity: Standing = identity(inheritedChargedToUndefined);
// @ts-expect-error TS2322|TS2375 Types of property 'chargedTo' are incompatible
export const inheritedChargedToUndefined_assign: Standing = Object.assign({}, inheritedChargedToUndefined);
// @ts-expect-error TS2322|TS2375 Types of property 'chargedTo' are incompatible
export const inheritedChargedToUndefined_array: Standing[] = [inheritedChargedToUndefined];

// CONTROL (no directive, so it must compile): `chargedTo: null` is the allowed way to say "the heir is a charter root".
export const inheritedToARoot: Standing = { kind: "inherited", commitId: cid, committedAt: at, warrant, severed, heir, chargedTo: null };
