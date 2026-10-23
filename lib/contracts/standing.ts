import type { Breach } from "./breach.js";
import type { CommitId, GrantId, PrincipalId } from "./ids.js";
import type { Seq } from "./limits.js";
import type { DeadLink } from "./tree.js";
import { unreachable } from "./unreachable.js";
import type { Warrant } from "./warrant.js";

/**
 * THE CLOSED ENUM AT THE CENTRE: `Standing` is `binding`, `inherited` or `void`
 * (`.genesis/PLAN.md` §4.2). The three are distinguished by WHO ANSWERS for the act:
 * everyone on `warrant.trail` (binding), the heir (inherited), or the actor alone (void).
 *
 * THE VARIANTS ARE MUTUALLY EXCLUSIVE BY ASSIGNABILITY, NOT BY EXCESS-PROPERTY CHECKING.
 * Each variant declares every field that belongs to another variant as `?: never`. That is
 * what makes "a `void` standing carrying a `warrant`, or an `inherited` standing without a
 * `heir`, does not compile" true at EVERY assignment site. The tempting alternative, simply
 * not declaring the field, relies on the excess-property check, which only fires on a fresh
 * object literal; a sibling project made that claim and seven ordinary routes walked past it:
 * an intermediate binding, a spread, a function return, `satisfies`, a generic helper,
 * `Object.assign`, an array element. With `?: never` all seven fail, and so does the fresh
 * literal. They are proved one by one, for every forbidden field and every required one, in
 * `__tests__/proofs/standing-forbidden.proofs.ts` and `standing-required.proofs.ts`, under both
 * of this repo's tsconfigs.
 *
 * WHAT THIS DOES NOT CLOSE, at full strength:
 *  - An explicit assertion through `unknown` (`x as unknown as Standing`), or any other assertion
 *    TypeScript permits from the source type.
 *  - An implicit `any`: a value from `JSON.parse(...)`, or from any library call typed `any`, is
 *    assignable to `Standing` with no cast written, whatever it contains.
 *  - A field the variants do not mention at all. `?: never` closes the fields listed here, not
 *    every possible extra property: an object with an unrelated extra key still reaches `Standing`
 *    through a non-literal route (pinned in `__tests__/standing.test.ts`).
 *  - A typed `undefined` under `tsconfig.json`, which does not set `exactOptionalPropertyTypes`
 *    (`warrant?: never` then accepts `warrant: undefined`; `tsconfig.lib.json` rejects it). No
 *    other value gets through, and a reader cannot tell `undefined` from absent.
 * The plan pairs these types with a run-time check for the residual, `assertStandingWellFormed`
 * (plan §4.2, §5); it is added after this file and its comment states what it does and does not catch.
 *
 * Cross-field facts the plan states are NOT in the types: `severed.atSeq > committedAt`, `heir` is
 * the grantor of the first dead link and never the actor, `chargedTo` names the heir's grant. Those
 * are M5's to produce and to test (its heir invariants).
 */
interface StandingBase {
  readonly commitId: CommitId;
  /** The `seq` of the commit event this standing rules on. */
  readonly committedAt: Seq;
}

/** The act binds the organisation: its chain of grants was live, in scope and funded when it was made, and still is. */
export interface BindingStanding extends StandingBase {
  readonly kind: "binding";
  readonly warrant: Warrant;
  readonly breach?: never;
  readonly severed?: never;
  readonly heir?: never;
  readonly chargedTo?: never;
}

/** The act stands but its chain has since been cut; accountability is re-homed to `heir`. */
export interface InheritedStanding extends StandingBase {
  readonly kind: "inherited";
  readonly warrant: Warrant;
  /** The first revoked link from the root. The plan says `severed.atSeq > committedAt` always; the type does not. */
  readonly severed: DeadLink;
  /** Grantor of that link. The plan says: live, above the break, never the actor; the type does not. */
  readonly heir: PrincipalId;
  /** The heir's grant that absorbs the act; `null` means the heir is a charter root (off-ledger). `undefined` is not allowed. */
  readonly chargedTo: GrantId | null;
  readonly breach?: never;
}

/** The act never bound the organisation: the actor alone answers. */
export interface VoidStanding extends StandingBase {
  readonly kind: "void";
  readonly breach: Breach;
  readonly warrant?: never;
  readonly severed?: never;
  readonly heir?: never;
  readonly chargedTo?: never;
}

export type Standing = BindingStanding | InheritedStanding | VoidStanding;

/** Exhaustiveness gate for a `switch` over `Standing`; see `unreachable.ts`. */
export function assertNeverStanding(value: never): never {
  return unreachable("Standing", value);
}
