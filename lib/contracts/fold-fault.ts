import type { Rejection } from "./rejection.js";
import type { Seq } from "./limits.js";
import type { NonEmptyReadonlyArray } from "./non-empty-array.js";
import { unreachable } from "./unreachable.js";

/**
 * Why a log or charter could not be replayed at all (`.genesis/PLAN.md` §4.3, §5).
 * Closed: five variants. M5's `fold` (not built) is the plan's producer of every one.
 *
 * `seq-mismatch.actual` is a plain `number`, not a `Seq`, because it records a value
 * found in hostile or corrupt input; `index` is a position in the log array.
 */
export type FoldFault =
  | { readonly kind: "invalid-charter"; readonly fields: NonEmptyReadonlyArray<string> }
  | { readonly kind: "hostile-log-input"; readonly message: string }
  | { readonly kind: "log-too-long"; readonly length: number; readonly max: number }
  | { readonly kind: "seq-mismatch"; readonly index: number; readonly expected: Seq; readonly actual: number }
  | { readonly kind: "inadmissible-event"; readonly index: number; readonly rejection: Rejection };

/** Exhaustiveness gate for a `switch` over `FoldFault`; see `unreachable.ts`. */
export function assertNeverFoldFault(value: never): never {
  return unreachable("FoldFault", value);
}
