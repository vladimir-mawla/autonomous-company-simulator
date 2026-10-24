import type { Breach } from "../../breach.js";
import type { CommitId } from "../../ids.js";
import type { Seq } from "../../limits.js";
import type { Standing } from "../../standing.js";
import { STANDING_SAMPLES } from "../support/samples.js";

/**
 * DISCLOSURE, NOT A REGRESSION GUARD. Every line below COMPILES (no directive) and each is a way
 * a contaminated `Standing` still reaches the type, because the `?: never` design closes the routes
 * TypeScript checks by assignability and none of these is one (see `support/proof-harness.ts`: the
 * harness requires every directive-free line in a proof file to compile under both tsconfigs).
 * Nothing in this repository could make the first two stop compiling: `as unknown as T` is permitted
 * between any two types, and an `any` is assignable to everything. The next group (4 to 7) is the same
 * class reached without any cast: the value's static type has been widened to a supertype that does not
 * mention the field before it meets `Standing`, so there is nothing for `?: never` to refuse. They are
 * here so the limits are written as code a reader can run, not only as prose. What does catch such values at run time, and
 * what it cannot, is stated on `assertStandingWellFormed`.
 */
const clean = STANDING_SAMPLES.void;
const contaminated = { ...clean, warrant: STANDING_SAMPLES.binding.warrant };

// 1. An explicit assertion through `unknown`.
export const viaCast: Standing = contaminated as unknown as Standing;

// 2. An implicit `any`: no assertion is written. `JSON.parse` returns `any`.
export const viaAny: Standing = JSON.parse(JSON.stringify(contaminated));

// 3. A field the variants do not mention. `?: never` closes the fields the plan names, not every extra key.
const withUnrelatedKey = { ...clean, note: "not a Standing field" };
export const viaUnrelatedKey: Standing = withUnrelatedKey;

// 4 to 7. The static type is widened to a supertype that does not mention `warrant` BEFORE it meets `Standing`.
// TypeScript allows this for any non-fresh object. The value is unchanged at run time; only what the compiler
// knows about it is.
type WithoutWarrant = { readonly kind: "void"; readonly commitId: CommitId; readonly committedAt: Seq; readonly breach: Breach };
declare const flag: boolean;
const plain: WithoutWarrant = clean;
function widen(value: WithoutWarrant): WithoutWarrant {
  return value;
}

// 4. An annotated variable.
const lax: WithoutWarrant = contaminated;
export const viaSupertype: Standing = lax;

// 5. A function parameter and return type.
export const viaFunction: Standing = widen(contaminated);

// 6. A conditional expression: its type is the common supertype of its branches.
export const viaConditional: Standing = flag ? contaminated : plain;

// 7. An array literal: its element type is reduced the same way.
export const viaArray: Standing[] = [contaminated, plain];
