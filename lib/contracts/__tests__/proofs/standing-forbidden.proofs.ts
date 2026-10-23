import type { Breach } from "../../breach.js";
import { commitId, grantId, principalId } from "../../ids.js";
import type { Standing } from "../../standing.js";
import type { DeadLink } from "../../tree.js";
import type { Warrant } from "../../warrant.js";

/**
 * Type-only proofs that no `Standing` variant can carry a field that belongs to another
 * variant (see `support/proof-harness.ts`). One value per (variant, forbidden field): a value carrying
 * several forbidden fields at once would stay an error on the others and so hide the removal of one.
 *
 * Eight routes each: a fresh literal, then the seven that the excess-property check does NOT cover
 * (an intermediate binding, a spread, a function return, `satisfies`, a generic helper,
 * `Object.assign`, an array element). Every `kind` is written `as const` where it is bound, because
 * without it `kind` widens to `string` and the line fails on `kind` rather than on the field under
 * test. Every declaration is exported so `noUnusedLocals` cannot satisfy a directive.
 *
 * Written by a throwaway script; this file, not the script, is the source of truth, so edit it directly.
 */

const cid = commitId("c1");
const at = 11;
const warrant: Warrant = { chain: [grantId("G1"), grantId("G2")], trail: [principalId("dana"), principalId("cfo"), principalId("ops")] };
const breach: Breach = { kind: "link-dead", grantId: grantId("G2"), atSeq: 11 };
const severed: DeadLink = { grantId: grantId("G2"), atSeq: 11 };
const heir = principalId("cfo");
const chargedTo = grantId("G1");
/** The "generic helper" route: returns its argument at the argument's own type. */
function identity<T>(value: T): T {
  return value;
}


// ---- a `void` standing carrying `warrant` ----
const voidWithWarrant = { kind: "void" as const, commitId: cid, committedAt: at, breach, warrant };
// @ts-expect-error TS2322 Types of property 'warrant' are incompatible
export const voidWithWarrant_literal: Standing = { kind: "void", commitId: cid, committedAt: at, breach, warrant };
// @ts-expect-error TS2322 Types of property 'warrant' are incompatible
export const voidWithWarrant_binding: Standing = voidWithWarrant;
// @ts-expect-error TS2322 Types of property 'warrant' are incompatible
export const voidWithWarrant_spread: Standing = { ...voidWithWarrant };
export function voidWithWarrant_return(): Standing {
  // @ts-expect-error TS2322 Types of property 'warrant' are incompatible
  return voidWithWarrant;
}
// @ts-expect-error TS1360 Types of property 'warrant' are incompatible
export const voidWithWarrant_satisfies = voidWithWarrant satisfies Standing;
// @ts-expect-error TS2322 Types of property 'warrant' are incompatible
export const voidWithWarrant_identity: Standing = identity(voidWithWarrant);
// @ts-expect-error TS2322 Types of property 'warrant' are incompatible
export const voidWithWarrant_assign: Standing = Object.assign({}, voidWithWarrant);
// @ts-expect-error TS2322 Types of property 'warrant' are incompatible
export const voidWithWarrant_array: Standing[] = [voidWithWarrant];

// ---- a `void` standing carrying `severed` ----
const voidWithSevered = { kind: "void" as const, commitId: cid, committedAt: at, breach, severed };
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const voidWithSevered_literal: Standing = { kind: "void", commitId: cid, committedAt: at, breach, severed };
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const voidWithSevered_binding: Standing = voidWithSevered;
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const voidWithSevered_spread: Standing = { ...voidWithSevered };
export function voidWithSevered_return(): Standing {
  // @ts-expect-error TS2322 Types of property 'severed' are incompatible
  return voidWithSevered;
}
// @ts-expect-error TS1360 Types of property 'severed' are incompatible
export const voidWithSevered_satisfies = voidWithSevered satisfies Standing;
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const voidWithSevered_identity: Standing = identity(voidWithSevered);
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const voidWithSevered_assign: Standing = Object.assign({}, voidWithSevered);
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const voidWithSevered_array: Standing[] = [voidWithSevered];

// ---- a `void` standing carrying `heir` ----
const voidWithHeir = { kind: "void" as const, commitId: cid, committedAt: at, breach, heir };
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const voidWithHeir_literal: Standing = { kind: "void", commitId: cid, committedAt: at, breach, heir };
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const voidWithHeir_binding: Standing = voidWithHeir;
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const voidWithHeir_spread: Standing = { ...voidWithHeir };
export function voidWithHeir_return(): Standing {
  // @ts-expect-error TS2322 Types of property 'heir' are incompatible
  return voidWithHeir;
}
// @ts-expect-error TS1360 Types of property 'heir' are incompatible
export const voidWithHeir_satisfies = voidWithHeir satisfies Standing;
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const voidWithHeir_identity: Standing = identity(voidWithHeir);
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const voidWithHeir_assign: Standing = Object.assign({}, voidWithHeir);
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const voidWithHeir_array: Standing[] = [voidWithHeir];

// ---- a `void` standing carrying `chargedTo` ----
const voidWithChargedTo = { kind: "void" as const, commitId: cid, committedAt: at, breach, chargedTo };
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const voidWithChargedTo_literal: Standing = { kind: "void", commitId: cid, committedAt: at, breach, chargedTo };
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const voidWithChargedTo_binding: Standing = voidWithChargedTo;
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const voidWithChargedTo_spread: Standing = { ...voidWithChargedTo };
export function voidWithChargedTo_return(): Standing {
  // @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
  return voidWithChargedTo;
}
// @ts-expect-error TS1360 Types of property 'chargedTo' are incompatible
export const voidWithChargedTo_satisfies = voidWithChargedTo satisfies Standing;
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const voidWithChargedTo_identity: Standing = identity(voidWithChargedTo);
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const voidWithChargedTo_assign: Standing = Object.assign({}, voidWithChargedTo);
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const voidWithChargedTo_array: Standing[] = [voidWithChargedTo];

// ---- a `binding` standing carrying `breach` ----
const bindingWithBreach = { kind: "binding" as const, commitId: cid, committedAt: at, warrant, breach };
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const bindingWithBreach_literal: Standing = { kind: "binding", commitId: cid, committedAt: at, warrant, breach };
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const bindingWithBreach_binding: Standing = bindingWithBreach;
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const bindingWithBreach_spread: Standing = { ...bindingWithBreach };
export function bindingWithBreach_return(): Standing {
  // @ts-expect-error TS2322 Types of property 'breach' are incompatible
  return bindingWithBreach;
}
// @ts-expect-error TS1360 Types of property 'breach' are incompatible
export const bindingWithBreach_satisfies = bindingWithBreach satisfies Standing;
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const bindingWithBreach_identity: Standing = identity(bindingWithBreach);
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const bindingWithBreach_assign: Standing = Object.assign({}, bindingWithBreach);
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const bindingWithBreach_array: Standing[] = [bindingWithBreach];

// ---- a `binding` standing carrying `severed` ----
const bindingWithSevered = { kind: "binding" as const, commitId: cid, committedAt: at, warrant, severed };
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const bindingWithSevered_literal: Standing = { kind: "binding", commitId: cid, committedAt: at, warrant, severed };
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const bindingWithSevered_binding: Standing = bindingWithSevered;
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const bindingWithSevered_spread: Standing = { ...bindingWithSevered };
export function bindingWithSevered_return(): Standing {
  // @ts-expect-error TS2322 Types of property 'severed' are incompatible
  return bindingWithSevered;
}
// @ts-expect-error TS1360 Types of property 'severed' are incompatible
export const bindingWithSevered_satisfies = bindingWithSevered satisfies Standing;
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const bindingWithSevered_identity: Standing = identity(bindingWithSevered);
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const bindingWithSevered_assign: Standing = Object.assign({}, bindingWithSevered);
// @ts-expect-error TS2322 Types of property 'severed' are incompatible
export const bindingWithSevered_array: Standing[] = [bindingWithSevered];

// ---- a `binding` standing carrying `heir` ----
const bindingWithHeir = { kind: "binding" as const, commitId: cid, committedAt: at, warrant, heir };
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const bindingWithHeir_literal: Standing = { kind: "binding", commitId: cid, committedAt: at, warrant, heir };
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const bindingWithHeir_binding: Standing = bindingWithHeir;
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const bindingWithHeir_spread: Standing = { ...bindingWithHeir };
export function bindingWithHeir_return(): Standing {
  // @ts-expect-error TS2322 Types of property 'heir' are incompatible
  return bindingWithHeir;
}
// @ts-expect-error TS1360 Types of property 'heir' are incompatible
export const bindingWithHeir_satisfies = bindingWithHeir satisfies Standing;
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const bindingWithHeir_identity: Standing = identity(bindingWithHeir);
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const bindingWithHeir_assign: Standing = Object.assign({}, bindingWithHeir);
// @ts-expect-error TS2322 Types of property 'heir' are incompatible
export const bindingWithHeir_array: Standing[] = [bindingWithHeir];

// ---- a `binding` standing carrying `chargedTo` ----
const bindingWithChargedTo = { kind: "binding" as const, commitId: cid, committedAt: at, warrant, chargedTo };
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const bindingWithChargedTo_literal: Standing = { kind: "binding", commitId: cid, committedAt: at, warrant, chargedTo };
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const bindingWithChargedTo_binding: Standing = bindingWithChargedTo;
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const bindingWithChargedTo_spread: Standing = { ...bindingWithChargedTo };
export function bindingWithChargedTo_return(): Standing {
  // @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
  return bindingWithChargedTo;
}
// @ts-expect-error TS1360 Types of property 'chargedTo' are incompatible
export const bindingWithChargedTo_satisfies = bindingWithChargedTo satisfies Standing;
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const bindingWithChargedTo_identity: Standing = identity(bindingWithChargedTo);
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const bindingWithChargedTo_assign: Standing = Object.assign({}, bindingWithChargedTo);
// @ts-expect-error TS2322 Types of property 'chargedTo' are incompatible
export const bindingWithChargedTo_array: Standing[] = [bindingWithChargedTo];

// ---- a `inherited` standing carrying `breach` ----
const inheritedWithBreach = { kind: "inherited" as const, commitId: cid, committedAt: at, warrant, severed, heir, chargedTo, breach };
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const inheritedWithBreach_literal: Standing = { kind: "inherited", commitId: cid, committedAt: at, warrant, severed, heir, chargedTo, breach };
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const inheritedWithBreach_binding: Standing = inheritedWithBreach;
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const inheritedWithBreach_spread: Standing = { ...inheritedWithBreach };
export function inheritedWithBreach_return(): Standing {
  // @ts-expect-error TS2322 Types of property 'breach' are incompatible
  return inheritedWithBreach;
}
// @ts-expect-error TS1360 Types of property 'breach' are incompatible
export const inheritedWithBreach_satisfies = inheritedWithBreach satisfies Standing;
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const inheritedWithBreach_identity: Standing = identity(inheritedWithBreach);
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const inheritedWithBreach_assign: Standing = Object.assign({}, inheritedWithBreach);
// @ts-expect-error TS2322 Types of property 'breach' are incompatible
export const inheritedWithBreach_array: Standing[] = [inheritedWithBreach];

// CONTROLS (no directive, so they must compile): the same eight routes over a CLEAN value of each variant.
// They show the routes above are legal code paths, so each error above is about the forbidden field.
const cleanBinding = { kind: "binding" as const, commitId: cid, committedAt: at, warrant };
export const cleanBinding_literal: Standing = { kind: "binding", commitId: cid, committedAt: at, warrant };
export const cleanBinding_binding: Standing = cleanBinding;
export const cleanBinding_spread: Standing = { ...cleanBinding };
export function cleanBinding_return(): Standing { return cleanBinding; }
export const cleanBinding_satisfies = cleanBinding satisfies Standing;
export const cleanBinding_identity: Standing = identity(cleanBinding);
export const cleanBinding_assign: Standing = Object.assign({}, cleanBinding);
export const cleanBinding_array: Standing[] = [cleanBinding];
const cleanInherited = { kind: "inherited" as const, commitId: cid, committedAt: at, warrant, severed, heir, chargedTo };
export const cleanInherited_literal: Standing = { kind: "inherited", commitId: cid, committedAt: at, warrant, severed, heir, chargedTo };
export const cleanInherited_binding: Standing = cleanInherited;
export const cleanInherited_spread: Standing = { ...cleanInherited };
export function cleanInherited_return(): Standing { return cleanInherited; }
export const cleanInherited_satisfies = cleanInherited satisfies Standing;
export const cleanInherited_identity: Standing = identity(cleanInherited);
export const cleanInherited_assign: Standing = Object.assign({}, cleanInherited);
export const cleanInherited_array: Standing[] = [cleanInherited];
const cleanVoid = { kind: "void" as const, commitId: cid, committedAt: at, breach };
export const cleanVoid_literal: Standing = { kind: "void", commitId: cid, committedAt: at, breach };
export const cleanVoid_binding: Standing = cleanVoid;
export const cleanVoid_spread: Standing = { ...cleanVoid };
export function cleanVoid_return(): Standing { return cleanVoid; }
export const cleanVoid_satisfies = cleanVoid satisfies Standing;
export const cleanVoid_identity: Standing = identity(cleanVoid);
export const cleanVoid_assign: Standing = Object.assign({}, cleanVoid);
export const cleanVoid_array: Standing[] = [cleanVoid];
