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

## Decision 3 — `Seq`, `Amount` and `NonEmptyReadonlyArray`, and the four invented bounds

- **`Seq` and `Amount` are bare `number` aliases** (plan §4.1). The plan itself says the type cannot
  carry "a non-negative safe integer at most `MAX_AMOUNT`" and assigns the check to M3's intake, which
  is not built. `limits.test.ts` pins the consequence as an HONEST LIMIT: `-1`, `1.5`, `NaN`,
  `Infinity` and `MAX_AMOUNT + 1` all compile as an `Amount`, and `0` and `-3` as a `Seq`. If `Amount`
  is ever tightened those lines stop compiling and `npm run typecheck` goes red there.
- **The four bounds are invented, not derived:** `MAX_AMOUNT = 2 ** 40`, `MAX_ROOT_DEPTH = 7`,
  `MAX_LOG_EVENTS = 5000`, `MAX_ID_LENGTH = 128`. `limits.test.ts` pins their values (so changing one
  is a deliberate edit that must touch that file) and that two `MAX_AMOUNT`s add to `2 ** 41`, below
  `Number.MAX_SAFE_INTEGER`. That is the one-addition bound the plan's §8 C relies on; it is **not**
  a proof that `used` can never exceed a limit, which is M4/M5's conservation property and has no
  code yet.
- **`NonEmptyReadonlyArray<T> = readonly [T, ...T[]]`.** `proofs/non-empty-array.proofs.ts` has four
  failing routes (an empty literal, a `number[]` that might be empty, `push`, and index assignment)
  and two controls (the first element is `number`, not `number | undefined`, under
  `noUncheckedIndexedAccess`; widening to `readonly number[]` is allowed). It is a compile-time
  statement only: at run time it is an ordinary array, and `map`/`filter`/`slice` return plain arrays,
  so M3/M4/M5 will have to rebuild a tuple where they need the guarantee. M1 provides no helper for
  that (the plan's function-ownership list for M1 names none).

## Decision 4 — `Grant`, `Commitment` and `Charter` carry the capability vocabulary as a type parameter `C`

All three are `interface X<C extends string = string>` exactly as plan §4.1 declares them.
`proofs/capability.proofs.ts` has seven failing routes and five controls.

- **What narrowing `C` refuses, proved:** a misspelt capability in a `Grant<Cap>` by a fresh literal,
  by a separately bound `capabilities` array, and by a separately bound whole grant; in a
  `Commitment<Cap>` by a bound commitment and by a plain `string`; in a `Charter<Cap>` literal; and an
  unparameterised `Grant` handed to a `Grant<Cap>` (so a value built without a domain cannot be
  laundered into one). The fresh-literal route reports `TS2820` ("did you mean") rather than
  `TS2322`, and the proof pins that code; the harness is what caught that my first draft had guessed
  `TS2322`.
- **HONEST LIMIT, as a control that must keep compiling:** with the default `C = string`, an
  unparameterised `Grant`, `Commitment` or `Charter` refuses nothing about capabilities. A misspelling
  is only caught once a domain narrows `C`, which is M6's job (`CompanyCapability`).
- **The type parameter and the run-time vocabulary are not tied together.** `Charter<C>` lists its
  capabilities as data, and nothing here forces that list to match `C`: a `Charter<"a" | "b">` may list
  only `"a"`. The plan has M3's intake check events against `charter.capabilities`; M3 is not built.
- Every field is a claim made by whoever wrote the event; the doc comments say which later milestone the
  plan gives the check to, and none is performed in M1.

## Decision 5 — the event and log types, and what they do not say about `seq`

`GrantEvent`, `RevokeEvent`, `CommitEvent`, `EventInput`, `LogEvent` and `Log` are plan §4.1 as
written. `proofs/event.proofs.ts` has four failing routes (a `LogEvent` literal and an `EventInput`
promoted to a `LogEvent`, both missing `seq`; a payload that does not match its `kind`, by a bound
value; a bare `string` as `by`) and three controls. `events.test.ts` runs one exhaustive consumer
`switch` over the union (adding a fourth variant makes its `never` line stop compiling, which
`npm run typecheck` reports and `npm test` does not).

- **Plan D3 says "a caller cannot choose `seq`". The types do not say that, and cannot with the plan's
  shape.** `EventInput` has no `seq?: never`, so an object carrying a `seq` is assignable to it through
  any non-literal route (a control in the proofs file pins this). The usual fix is unavailable: the plan
  defines `LogEvent` as `EventInput & { seq }`, and `seq?: never` on every input variant would intersect
  with `seq: Seq` to `never`. So that sentence of D3 is a property of M5's `append` (which must build the
  logged event from explicitly read fields and stamp its own `seq`), and M5 does not exist. This is
  recorded as a plan observation in the PR report, not fixed here.
- **`Log` is just an array of `LogEvent`.** Nothing in the type says `seq` starts at 1, increases by one
  or is unique; a control pins that `[at(5), at(5), at(1), at(0), at(-2)]` is a `Log`. The plan's
  `seq-mismatch` fault is M5's.

## Decision 6 — `GrantTree`, `Charge`, `DeadLink` and `Warrant`: whole facts, with the plan's construction claims left unmade

Plan §4.1 as written. `proofs/tree-and-warrant.proofs.ts` has six failing routes (no `set` and no
`delete` on the map views; a `DeadLink` without `atSeq` and a `Charge` without `amount`; a `Warrant`
with an empty `chain` and one with an empty `trail`) and two controls.

- **Two plan sentences about `GrantTree` are not properties of the type, and the doc comment says so:**
  "built only inside `fold`" and "`revokedAt` is write-once". `ReadonlyMap` is a type-level view, not a
  freeze. `tree.test.ts` shows that a `revokedAt` view follows its underlying `Map` and that a key can be
  overwritten through it, and a control shows a tree can be built by hand (M3's hostile-tree tests need
  to). Both properties would have to come from M5's construction of the tree, and M5 is not built.
- **`Warrant.trail` is not tied to `Warrant.chain`.** The plan says `trail` is the charter root plus each
  grantee, so one longer than `chain`. The type cannot say that; a control pins that a one-grant chain
  with a four-principal trail compiles. Producing and testing consistent warrants is M5's.

## Decision 7 — `Breach` and `Verdict`, and a shared `unreachable` helper the plan did not list

`Breach` (five variants) and `Verdict` are plan §4.1 as written, and `assertNeverBreach` is the first of
the four `assertNever*` gates.

- **Not named in the plan's M1 file list: `unreachable.ts`.** The plan lists one file per type and no home
  for the body the four `assertNever*` functions share. It is added inside `lib/contracts/**` (which M1
  owns) rather than copied four times, and it is not exported from `index.ts`.
- **What "closed" means here, and where it is enforced.** A switch over `Breach` that ends in
  `assertNeverBreach(breach)` compiles only while every variant is handled. Three checks, all
  compile-time except the last: `support/samples.ts` keys one sample per variant by `kind` as a mapped
  type over the real union (a new variant leaves a key missing, a renamed one leaves an unknown key);
  `closed-unions.test.ts` has an exhaustive consumer of the real `Breach`; and
  `proofs/breach-and-verdict.proofs.ts` shows the gate firing: the same switch missing `over-limit` fails
  with `TS2345` at the `assertNeverBreach` call, and the same switch with all five handled compiles. The
  runtime part is `closed-unions.test.ts` pinning the five names in the plan's order and checking that
  `assertNeverBreach` throws, naming the union and the value, on a stray value (and still throws on one
  `JSON.stringify` cannot print). `npm test` strips types, so a sixth variant shows up there only as the
  pinned name list failing; `npm run typecheck` is what reports the compile errors.
- **The order of the five is not in the type.** The plan says precedence is the listed order; a union has
  no order. It is a property of M5's `judgeCommit`, which is not built.
- **Not mutually exclusive, deliberately and as the plan wrote it.** Plan §4.2 asks for `?: never`
  disjointness on `Standing`. `Breach` and `Verdict` are written without it, so a `no-such-grant` breach
  carrying a `holder`, or a `warranted` verdict carrying a `breach`, compiles through a non-literal route.
  Two controls pin this. The reason not to add it is the one a sibling ADR records: a defensive measure
  past what any plan refusal asks for is a surface for bypasses, and the consumer that matters
  switches on `kind`. The `Standing` a `Verdict` feeds is exclusive and has a runtime guard.
