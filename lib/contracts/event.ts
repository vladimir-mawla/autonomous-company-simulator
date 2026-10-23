import type { Commitment } from "./commitment.js";
import type { Grant } from "./grant.js";
import type { GrantId, PrincipalId } from "./ids.js";
import type { Seq } from "./limits.js";

/**
 * The three kinds of event an append-only log holds (`.genesis/PLAN.md` §4.1).
 *
 * `EventInput` is what a caller offers; `LogEvent` is what the log holds, the
 * same event stamped with a `seq`. The plan's D3 says the engine stamps `seq`
 * ("a caller cannot choose, and cannot back-date"). That is a property of M5's
 * `append`, which is not built. It is NOT a property of these types:
 *
 *  - `EventInput` has no `seq?: never`, so an object that carries a `seq` is
 *    assignable to it through any non-literal route. The plan's own `LogEvent`
 *    (`EventInput & { seq }`) makes the usual fix impossible: `seq?: never` on
 *    every input variant would intersect with `seq: Seq` to `never`.
 *  - `Log` is an array of events; nothing in the type says `seq` starts at 1,
 *    increases by one, or is unique. (The plan's `seq-mismatch` fault is M5's.)
 *
 * Both are pinned as controls in `__tests__/proofs/event.proofs.ts`.
 *
 * `RevokeEvent` is not generic: it names a grant and a principal, no capability.
 */
export type GrantEvent<C extends string = string> = { readonly kind: "grant"; readonly grant: Grant<C> };
export type RevokeEvent = { readonly kind: "revoke"; readonly grantId: GrantId; readonly by: PrincipalId };
export type CommitEvent<C extends string = string> = { readonly kind: "commit"; readonly commit: Commitment<C> };
export type EventInput<C extends string = string> = GrantEvent<C> | RevokeEvent | CommitEvent<C>;

/** An admitted event with its position in the log (plan §4.1: `seq` is arrival order, not occurrence order). */
export type LogEvent<C extends string = string> = EventInput<C> & { readonly seq: Seq };
export type Log<C extends string = string> = readonly LogEvent<C>[];
