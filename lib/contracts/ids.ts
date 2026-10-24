/**
 * Opaque identity tokens: `PrincipalId`, `GrantId`, `CommitId`.
 *
 * WHY BRANDED, NOT BARE `string`. The three are all strings, and the engine is
 * full of calls where swapping two of them is a plausible slip that a plain
 * `string` signature would accept (`tree.grants.get(principal)`,
 * `Grant.parent` handed a principal). Each brand makes that a compile error.
 *
 * WHAT A BRAND IS NOT. It exists only at compile time: at run time all three are
 * the same plain string, so `grantId("x") === commitId("x")`. And it is not a
 * trust boundary: anyone can mint any id from any string, by design (plan D5:
 * authorship is asserted, not authenticated). `.genesis/PLAN.md` §4.1 and §6 (M1) say
 * "NO PARSERS (house rule: ids are opaque, not grammars)", so the mint functions
 * below validate nothing: `principalId("")` returns an empty `PrincipalId`. The plan
 * assigns the non-empty and `MAX_ID_LENGTH` checks to M3's intake (not built); until
 * it exists nothing in this repository enforces either.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PrincipalId = Brand<string, "PrincipalId">;
export type GrantId = Brand<string, "GrantId">;
export type CommitId = Brand<string, "CommitId">;

/** Brands a string as a `PrincipalId`. Validates nothing (see the file header). */
export function principalId(value: string): PrincipalId {
  return value as PrincipalId;
}

/** Brands a string as a `GrantId`. Validates nothing (see the file header). */
export function grantId(value: string): GrantId {
  return value as GrantId;
}

/** Brands a string as a `CommitId`. Validates nothing (see the file header). */
export function commitId(value: string): CommitId {
  return value as CommitId;
}
