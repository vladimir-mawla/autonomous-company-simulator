import type { Breach } from "./breach.js";
import type { Warrant } from "./warrant.js";

/**
 * The outcome of judging a commitment against the log as it stood at its own `seq`
 * (`.genesis/PLAN.md` §4.1, D1): warranted by a chain of grants, or breached by a
 * named rule. M5's `judgeCommit` (not built) is what produces one.
 *
 * Like `Breach`, and unlike `Standing`, the two variants are not made mutually
 * exclusive with `?: never`: a `warranted` verdict carrying a `breach` compiles
 * through a non-literal route (pinned in `__tests__/proofs/breach-and-verdict.proofs.ts`).
 * The `Standing` a verdict feeds IS exclusive, and its runtime guard
 * (`assertStandingWellFormed`) is what the plan has M5 call on every standing it builds.
 */
export type Verdict =
  | { readonly kind: "warranted"; readonly warrant: Warrant }
  | { readonly kind: "breached"; readonly breach: Breach };
