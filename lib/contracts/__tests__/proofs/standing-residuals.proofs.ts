import type { Standing } from "../../standing.js";
import { STANDING_SAMPLES } from "../support/samples.js";

/**
 * DISCLOSURE, NOT A REGRESSION GUARD. Every line below COMPILES (no directive) and each is a way
 * a contaminated `Standing` still reaches the type, because the `?: never` design closes the routes
 * TypeScript checks by assignability and none of these is one (see `support/proof-harness.ts`: the
 * harness requires every directive-free line in a proof file to compile under both tsconfigs).
 * Nothing in this repository could make the first two stop compiling: `as unknown as T` is permitted
 * between any two types, and an `any` is assignable to everything. They are here so the limit is
 * written as code a reader can run, not only as prose. What does catch such values at run time, and
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
