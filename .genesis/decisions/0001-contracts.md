# ADR 0001 — M1 contracts: disjoint `Standing` variants, how their type-level proofs are checked, and what M1 does not claim

- **Date:** 2026-10-24
- **Status:** proposed — written by the builder, not yet verified by an independent L4 pass
- **Phase / milestone:** M1 (BUILD) — `lib/contracts/**`

This ADR is edited in the same commit as the code each decision describes, and is revised when a
later commit falsifies an earlier decision. Decisions are in the order the commits landed.

## Context

`.genesis/PLAN.md` §4 and §6 (M1) fix the closed vocabulary: `Grant`, `Commitment`, `Standing`
(`binding` / `inherited` / `void`), `Breach`, `Verdict`, `Rejection`, `FoldFault`, the id mint
functions, four constants, four `assertNever*` functions and `assertStandingWellFormed`. M1 is types
and structural invariants only: no `lib/chain`, `lib/allowance` or `lib/standing` logic exists.

The central claim is the DoD gate "a `void` standing carrying a `warrant`, or an `inherited`
standing without a heir, does not compile". A sibling project's M1 made a near-identical claim on
the strength of TypeScript's excess-property check, which fires only on a fresh object literal, and
was rejected after seven ordinary non-literal routes compiled. The design that answers it is a
later decision in this ADR; Decision 1 is about how its proofs are checked, because the proofs
themselves turned out to have a failure mode of their own.

## Decision 1 — a `@ts-expect-error` proof is checked by a harness that compiles it with the directive removed

**Problem, reproduced against this repo's own compiler settings (tsc 7.0.2):** a
`// @ts-expect-error` line proves only that some error occurs on the next line. Three ways for that
to be a false proof were each demonstrated rather than assumed:

1. `noUnusedLocals` is on in both tsconfigs. `const a: Standing = x;` with `a` never read errors
   with `TS6133` whatever `Standing` is, so the directive above it is satisfied by a perfectly legal
   assignment. (A scratch file with exactly this line reported only `TS6133`.)
2. `const x = { kind: "void", ... }` without `as const` widens `kind` to `string`, so
   `const a: Standing = x` fails on `kind` rather than on the field the proof is about. (A scratch
   file reported `Types of property 'kind' are incompatible`.) The seven-route snippet in the M1
   brief has this shape; the proofs here use `as const`.
3. A fresh object literal can fail with `TS2353` (excess property) in a type that does not forbid
   the field by assignability at all, which is the weakness the non-literal routes exist to expose.
   (`proof-harness.test.ts` asserts the harness sees `TS2353` for such a type.)

`npm run typecheck` cannot detect any of these: it reports `TS2578` only when the line has no error.

**Decision.** Every file under `lib/contracts/__tests__/proofs/` is compiled a second time by
`__tests__/support/proof-harness.ts` with every `@ts-expect-error` removed (line numbers preserved).
Each removed directive must be matched by a diagnostic on the next line with the stated code and
carrying the stated message fragment, with no other diagnostic on that line and none anywhere else
in the file. The directive format is
`// @ts-expect-error TS2322 Types of property 'warrant' are incompatible`; TypeScript ignores the
trailing text, so `npm run typecheck` still treats it as an ordinary directive. `@ts-ignore`,
`@ts-nocheck` and any other spelling are reported. Each proof file is compiled under both
`tsconfig.lib.json` and `tsconfig.json`, because they differ in `exactOptionalPropertyTypes` and a
consumer under `app/` compiles under the second.

**What this does not do.** It checks that each route that is written fails for the stated reason
under both configs. It does not show the set of routes is complete, and the message fragments are
tied to TypeScript's wording, so a TypeScript upgrade can require editing them (the version is
pinned at `7.0.2`).

**Falsifiability, run for real.** `proof-harness.test.ts` feeds the harness a bad proof for each case
above plus a directive over a clean line, a wrong code, a wrong message, a stray error, a malformed
or `@ts-ignore` suppression, and a source whose error exists under one config only; each must be
reported with its specific problem. Sabotage run while writing it: disabling the same-line
extra-diagnostic check turned exactly the "real error PLUS an unused-local error" case red
(9 passed, 1 failed), and restoring it turned that case green again.

## Decision 2 — `PrincipalId`, `GrantId`, `CommitId` are branded strings with unvalidated mint functions

`ids.ts` declares each id as `string & { readonly [brand]: "<Name>" }`, where `brand` is a
non-exported `unique symbol`, and exports `principalId`, `grantId` and `commitId` (`string -> id`).
The `Brand` helper itself is not exported: nothing else in M1 needs to mint a brand.

- **What the brands stop, proved:** `proofs/ids.proofs.ts` has seven directives: each id refused for
  each other id (three ordered pairs), a bare `string` refused for each of the three, and
  `Map<GrantId, _>.get(principalId)` refused. Two controls (a `PrincipalId` read as `string`, and a
  `GrantId` lookup) have no directive and must compile. Sabotage run: giving `GrantId` the same
  brand label as `PrincipalId` turned `npm run typecheck` red with `TS2578` at the two proofs that
  depend on the labels differing, and turned the harness test red.
- **What they do not do, stated at full strength:** the brand exists only at compile time. At run
  time the three are the same primitive string, so `grantId("x") === commitId("x")`
  (`ids.test.ts`). A brand is not a trust boundary either: any string can be minted into any id,
  which is the plan's D5 (authorship is asserted, not authenticated), not an oversight.
- **No parsers** (plan §4.1). The mint functions validate nothing: `principalId("")` is a valid
  `PrincipalId`, as is a 10 000-character string. `ids.test.ts` pins this as an HONEST LIMIT. The
  plan assigns the non-empty and `MAX_ID_LENGTH` checks to M3's intake; M3 does not exist, so until
  it does nothing in this repository enforces either.
