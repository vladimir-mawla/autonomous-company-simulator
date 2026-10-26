/**
 * The public surface of `lib/standing` (M5): the ledger fold, the verdict on a commitment, and the standing derived
 * from it.
 *
 * Everything a later layer may import is named here; a later layer imports `lib/standing/index.js` and nothing
 * deeper. The internals are deliberately not exported: `Ledger`, `emptyLedger`, `Effect`, `Decision`, `decide`, `apply`,
 * `Replay`, `replay` and `foldedOf` (fold.ts), `Prepared` and `admitInput` (append.ts), `deriveStanding` and `sealStanding`
 * (standing.ts), and `judgeCommit` (verdict.ts). Each would let a caller judge, record or
 * build a standing by a path that skips one of the others.
 */
export { fold } from "./fold.js";
export type { CommitRecord, Folded, FoldResult } from "./fold.js";

export { append, mayCommit } from "./append.js";
export type { AppendFailure, AppendResult, MayCommitResult } from "./append.js";

export { standingOf, standings } from "./standing.js";
export type { StandingOfResult, StandingsResult } from "./standing.js";
