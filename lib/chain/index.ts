/**
 * The public surface of `lib/chain` (M3): intake of untrusted charters and events, the grant-tree walkers, and
 * (added by the commit that builds it) the structural admission check.
 *
 * Everything a later layer may import is named here; a later layer imports `lib/chain/index.js` and nothing
 * deeper. The private helpers in `intake.ts` (`read`, `HostileRead`, the field readers) are deliberately
 * not exported.
 */
export { MAX_CHARTER_ENTRIES, readCharter, readEventInput, readLogEvent } from "./intake.js";
export type { CharterRead, IntakeFailure, IntakeRejection, IntakeResult } from "./intake.js";

export { chainOf, firstDeadLink, liveAuthorityAbove, trailOf } from "./chain.js";
