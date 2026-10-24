/**
 * The public surface of `lib/allowance` (M4): conservation accounting over a grant tree and its charges.
 *
 * Everything a later layer may import is named here; a later layer imports `lib/allowance/index.js` and nothing
 * deeper. The private helpers in `accounting.ts` (`bookOf`, `locate`, `subtreeOwn`, `used`) are deliberately not
 * exported: `usedOf`, `headroomOf` and `absorbedBy` answer for a grant the tree holds and are `undefined` for one it
 * does not, and the helpers would answer for anything.
 */
export { absorbedBy, checkHeadroom, headroomOf, usedOf } from "./accounting.js";
export type { HeadroomCheck, Shortfall } from "./accounting.js";
