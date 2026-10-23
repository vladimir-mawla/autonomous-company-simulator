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
 *    through a non-literal route (a directive-free line in `__tests__/proofs/standing-residuals.proofs.ts`).
 *  - A typed `undefined` under `tsconfig.json`, which does not set `exactOptionalPropertyTypes`
 *    (`warrant?: never` then accepts `warrant: undefined`; `tsconfig.lib.json` rejects it; pinned in
 *    `__tests__/standing.test.ts`). No other value gets through, and a reader cannot tell `undefined`
 *    from absent.
 * The plan pairs these types with a run-time check, `assertStandingWellFormed` (below, plan §4.2, §5).
 * It sees a contaminated value however it got there, but only the fields it is told about: its own
 * comment states what it does and does not catch.
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

// ---------------------------------------------------------------------------------------------
// The run-time guard
// ---------------------------------------------------------------------------------------------

/**
 * Why a value is not a well-formed `Standing`. The first two are the plan's (§4.2). `unknown-variant`
 * is NOT in the plan: its type fixes `variant: Standing["kind"]`, which has no way to describe a value
 * whose `kind` is none of the three (a cast-built fourth variant, parsed JSON, `null`). Rather than
 * let such a value pass or make the guard throw from a function whose job is to return a verdict, a
 * third member reports it. `found` is the offending `kind` when it is a string, otherwise the `typeof`
 * of the value (or of its `kind`), with `null` reported as "null".
 */
export type StandingIntegrityError =
  | { readonly kind: "unexpected-field"; readonly variant: Standing["kind"]; readonly field: string }
  | { readonly kind: "missing-field"; readonly variant: Standing["kind"]; readonly field: string }
  | { readonly kind: "unknown-variant"; readonly found: string };

export type StandingIntegrity =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: StandingIntegrityError };

/**
 * The per-variant field tables the guard reads. They are the run-time mirror of the `?: never` and
 * required declarations above, and the three `Assert` lines below make `npm run typecheck` fail if
 * the two drift: a table that omits a forbidden or required field, lists one the type does not
 * declare so, or a common field added to `StandingBase` that the guard was not told about.
 */
const BASE_REQUIRED = ["commitId", "committedAt"] as const;
const SHAPE = {
  binding: { required: ["warrant"], forbidden: ["breach", "severed", "heir", "chargedTo"] },
  inherited: { required: ["warrant", "severed", "heir", "chargedTo"], forbidden: ["breach"] },
  void: { required: ["breach"], forbidden: ["warrant", "severed", "heir", "chargedTo"] },
} as const;

/** The one field whose declared type admits `null`, so the guard treats `null` there as present. */
const NULLABLE = "chargedTo";

type VariantField = "warrant" | "breach" | "severed" | "heir" | "chargedTo";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
/** Fields the variant declares as `?: never`. A field it does not declare at all does not count. */
type ForbiddenOf<S> = { [K in VariantField]: K extends keyof S ? (S extends { readonly [P in K]?: never } ? K : never) : never }[VariantField];
/** Fields the variant declares and does not make optional. */
type RequiredOf<S> = { [K in VariantField]: K extends keyof S ? ({} extends Pick<S, K> ? never : K) : never }[VariantField];

export type StandingTablesMatchTypes = [
  Assert<Equal<(typeof SHAPE)["binding"]["required"][number], RequiredOf<BindingStanding>>>,
  Assert<Equal<(typeof SHAPE)["binding"]["forbidden"][number], ForbiddenOf<BindingStanding>>>,
  Assert<Equal<(typeof SHAPE)["inherited"]["required"][number], RequiredOf<InheritedStanding>>>,
  Assert<Equal<(typeof SHAPE)["inherited"]["forbidden"][number], ForbiddenOf<InheritedStanding>>>,
  Assert<Equal<(typeof SHAPE)["void"]["required"][number], RequiredOf<VoidStanding>>>,
  Assert<Equal<(typeof SHAPE)["void"]["forbidden"][number], ForbiddenOf<VoidStanding>>>,
  Assert<Equal<(typeof BASE_REQUIRED)[number], Exclude<keyof Standing, "kind" | VariantField>>>,
];

function isPresent(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  return value !== null || field === NULLABLE;
}

/**
 * The run-time check for what the types cannot close (an `as unknown as` cast, an implicit `any` such
 * as `JSON.parse`): given something claimed to be a `Standing`, it reports the FIRST problem found, in
 * this order: a missing common field, a missing field of the variant, a field the variant forbids.
 *
 * WHAT IT CATCHES. By reading each field by name (so an own, inherited, non-enumerable or accessor-
 * defined property is seen alike): a `kind` that is not one of the three, or a non-object; a required
 * field that is `undefined`, or `null` unless it is `chargedTo` (the one field whose type admits `null`);
 * and a forbidden field that is anything but `undefined` (`null` counts). An explicit `undefined` on a
 * forbidden field is NOT reported: it is indistinguishable from absent to any reader and to JSON, and
 * the type already treats the two alike under `tsconfig.json`.
 *
 * WHAT IT DOES NOT, at full strength:
 *  - It checks PRESENCE only. A present field holding the wrong kind of value (`heir: 42`, an empty
 *    `warrant.chain`, a `severed` that is not a `DeadLink`) passes.
 *  - It checks no relation between fields: not `severed.atSeq > committedAt`, not that `heir` differs
 *    from the actor, not that `chargedTo` names the heir's grant. The plan assigns those to M5's heir
 *    invariants.
 *  - It flags only the fields named in the tables above, not an arbitrary extra key: a standing with an
 *    unrelated `note` field passes (pinned in `__tests__/integrity.test.ts`).
 *  - It does not defend against a hostile object: a getter that throws makes it throw. The plan puts
 *    hostile input at M3's intake; a standing is built by M5 from its own data.
 *
 * `.genesis/PLAN.md` §5 has M5 call this on every standing it returns and throw on `ok: false`; M5 is not
 * built, so nothing calls it yet.
 */
export function assertStandingWellFormed(standing: Standing): StandingIntegrity {
  const value: unknown = standing;
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: { kind: "unknown-variant", found: value === null ? "null" : typeof value } };
  }
  const record = value as Readonly<Record<string, unknown>>;
  const kind = record["kind"];
  if (kind !== "binding" && kind !== "inherited" && kind !== "void") {
    return { ok: false, error: { kind: "unknown-variant", found: typeof kind === "string" ? kind : typeof kind } };
  }
  const shape = SHAPE[kind];
  for (const field of [...BASE_REQUIRED, ...shape.required]) {
    if (!isPresent(record[field], field)) {
      return { ok: false, error: { kind: "missing-field", variant: kind, field } };
    }
  }
  for (const field of shape.forbidden) {
    if (record[field] !== undefined) {
      return { ok: false, error: { kind: "unexpected-field", variant: kind, field } };
    }
  }
  return { ok: true };
}
