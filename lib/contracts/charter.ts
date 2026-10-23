import type { PrincipalId } from "./ids.js";
import type { NonEmptyReadonlyArray } from "./non-empty-array.js";

/**
 * Caller-supplied configuration: who may originate authority, and the closed
 * capability vocabulary (plan D5). Both are declared, not authenticated: nothing
 * in this repository verifies that a root is who it claims to be.
 *
 * `capabilities` is the vocabulary as DATA, available at run time. The type
 * parameter `C` is the same vocabulary as a TYPE. Nothing here ties the two
 * together: a `Charter<"a" | "b">` is free to list only `"a"` at run time.
 */
export interface Charter<C extends string = string> {
  /** Human principals; authority originates only here (plan D5). */
  readonly roots: NonEmptyReadonlyArray<PrincipalId>;
  readonly capabilities: NonEmptyReadonlyArray<C>;
}
