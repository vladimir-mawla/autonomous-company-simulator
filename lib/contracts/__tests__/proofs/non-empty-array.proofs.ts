import type { NonEmptyReadonlyArray } from "../../non-empty-array.js";

/**
 * Type-only proofs for `NonEmptyReadonlyArray` (see `support/proof-harness.ts`).
 * Declarations are exported so `noUnusedLocals` cannot satisfy a directive.
 */
const one: NonEmptyReadonlyArray<number> = [1];
const maybeEmpty: number[] = [];

// @ts-expect-error TS2322 Source has 0 element(s) but target requires 1
export const emptyLiteral: NonEmptyReadonlyArray<number> = [];

// The non-literal route: a `number[]` might be empty, so it is not assignable.
// @ts-expect-error TS2322 Source provides no match for required element at position 0 in target
export const fromPlainArray: NonEmptyReadonlyArray<number> = maybeEmpty;

// It is readonly: no `push`, and no assignment through an index.
// @ts-expect-error TS2339 Property 'push' does not exist on type 'NonEmptyReadonlyArray<number>'
export const pushed = one.push(2);
// @ts-expect-error TS2540 Cannot assign to '0' because it is a read-only property
one[0] = 2;

// CONTROLS (no directive, so they must compile): the first element is a `number`, not `number | undefined`,
// even with `noUncheckedIndexedAccess` on, and a widening to a plain readonly array is allowed.
export const head: number = one[0];
export const widened: readonly number[] = one;
