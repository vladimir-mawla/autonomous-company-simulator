/**
 * A readonly array with at least one element, as a tuple type.
 *
 * Used where emptiness would be a malformed fact rather than an edge case: a
 * grant with no capabilities, a warrant with no chain, a charter with no roots.
 *
 * WHAT IT GUARANTEES. A value of this type cannot be built from `[]`, nor from a
 * `T[]` that might be empty, without a cast, and its first element has type `T`
 * rather than `T | undefined`. It is `readonly`, so `push` and index assignment
 * do not compile (all proved in `__tests__/proofs/non-empty-array.proofs.ts`).
 *
 * WHAT IT DOES NOT. It is a compile-time statement only: at run time this is an
 * ordinary array, so a value that arrives through a cast or from `JSON.parse` can
 * be empty. The plan assigns re-checking such input to M3's intake (not built).
 * Operations that return a plain array (`map`, `filter`, `slice`) lose the
 * guarantee; nothing here provides helpers to keep it.
 */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];
