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

**Revised after the first sabotage run on a contract source.** The harness first counted every
diagnostic in the compiled program against the proof file's line numbers, so a compile error in an
IMPORTED contract file (for example `standing.ts`) turned every proof test red with the message
"unexpected diagnostic outside any proof line", which blames the proofs for a source fault. It now
reports a diagnostic in any file other than the proof under that file's name ("in a file the proof
imports, not in the proof"), and `proof-harness.test.ts` pins that. The blast radius is unchanged
(a broken contract source still turns the proof tests red, which is correct) but the cause is named.

**Revised after the independent L4 round (D1).** The same-line check first reported only a second diagnostic
whose code differed from the directive's own, so a line with two `TS2322` errors, one of them carrying the stated
message, was accepted. It now reports every diagnostic on a proof line other than the one that matched.
`proof-harness.test.ts` has a self-test for it (two `TS2322` on one line).

**What this does not do.** It checks that each route that is written fails with the stated code and a
message naming the stated property or type, under both configs. It does not check WHY the property is
refused: replacing `warrant?: never` on `VoidStanding` with `warrant?: string` leaves all 104 `standing-*`
directives matched, and only the `Assert<Equal<...>>` tie (TS2344 in `standing.ts`) goes red. It does not
show the set of routes is complete, and the message fragments are
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
  `proofs/closed-union-gates.proofs.ts` shows the gate firing: a switch missing `over-limit` fails with
  `TS2345` at the `assertNeverBreach` call, and the same switch with all five handled compiles. The
  runtime part is `closed-unions.test.ts` pinning the five names in the plan's order and checking that
  `assertNeverBreach` throws, naming the union and the value, on a stray value (and still throws on one
  `JSON.stringify` cannot print). `npm test` strips types, so nothing in `closed-unions.test.ts` notices a
  changed union at run time: the pinned name lists are compared with the keys of hand-written sample
  tables, which a type change does not alter (measured: deleting a `Breach` or `Rejection` variant leaves
  that file green). The pinned lists guard the sample tables, not the types. The only `npm test` signal of
  a changed union is indirect, through the proof harness compiling `closed-union-gates.proofs.ts`;
  `npm run typecheck` is the direct gate.
- **The order of the five is not in the type.** The plan says precedence is the listed order; a union has
  no order. It is a property of M5's `judgeCommit`, which is not built.
- **Not mutually exclusive, deliberately and as the plan wrote it.** Plan §4.2 asks for `?: never`
  disjointness on `Standing`. `Breach` and `Verdict` are written without it, so a `no-such-grant` breach
  carrying a `holder`, or a `warranted` verdict carrying a `breach`, compiles through a non-literal route.
  Two controls pin this. The reason not to add it is the one a sibling ADR records: a defensive measure
  past what any plan refusal asks for is a surface for bypasses, and the consumer that matters
  switches on `kind`. The `Standing` a `Verdict` feeds is exclusive and has a runtime guard.

## Decision 8 — `Rejection` (fifteen) and `FoldFault` (five), closed the same way

Both are plan §4.3 as written; `Rejection`'s per-variant comments name the milestone the PLAN assigns
each kind to, worded as the plan's assignment because none of M3, M4 or M5 exists. `assertNeverRejection`
and `assertNeverFoldFault` use the shared `unreachable` helper of Decision 7.

- The same three checks as `Breach`, extended: `support/samples.ts` has a mapped-type sample table per
  union; `closed-unions.test.ts` pins the fifteen and five names in the plan's order and has an exhaustive
  consumer of each real union (the `FoldFault` consumer also recurses into `Rejection`);
  `proofs/closed-union-gates.proofs.ts` has one failing gate per union (`Breach` missing `over-limit`,
  `Rejection` missing `revoker-not-authorised`, `FoldFault` missing `inadmissible-event`) and three controls
  with every variant handled. The runtime test is table-driven over the three gates: each throws on a stray
  value naming its union, and still throws on one `JSON.stringify` cannot print.
- **Which of the fifteen are producible is not M1's question.** The plan's §8 B notes its own throwaway model
  reached eleven of the fifteen and that four (`invalid-event-shape`, `unknown-capability`, `duplicate-id`,
  `unknown-parent`) need hand-built input. That concerns M3/M5 tests; M1 only fixes the shapes.
- `seq-mismatch.actual` is a plain `number` rather than a `Seq`, as the plan writes it, since it records a
  value found in input the engine does not trust. Nothing else here depends on that.

## Decision 9 — `Standing`: the variants are exclusive by assignability (`?: never`), proved for every field by eight routes

`standing.ts` is plan §4.2 as written: `BindingStanding`, `InheritedStanding`, `VoidStanding`, and
`Standing` as their union; `assertNeverStanding` is the fourth `assertNever*` gate.

**The mechanism.** Each variant declares every field that belongs to another variant as `?: never`:
`binding` forbids `breach`, `severed`, `heir`, `chargedTo`; `inherited` forbids `breach`; `void` forbids
`warrant`, `severed`, `heir`, `chargedTo`. The check is then ordinary assignability, made at every site
where a value meets `Standing`, not the excess-property check, which fires only on a fresh object
literal. That is the difference between this design and the rejected sibling's.

**What is proved, and how.** `proofs/standing-forbidden.proofs.ts` has 72 directives: nine
(variant, forbidden field) pairs times eight routes (a fresh literal, then an intermediate binding, a
spread, a function return, `satisfies`, a generic helper, `Object.assign`, an array element). Each pair
has its own bound value carrying exactly one forbidden field, so removing `?: never` from one field
cannot be masked by another. `proofs/standing-required.proofs.ts` has 32: `inherited` without `heir`,
without `severed`, without `chargedTo`, and with `chargedTo: undefined` (`null` is a control that
compiles), times the same eight routes. Controls in the forbidden file push a clean value of each
variant through the same eight routes and must compile, so each error is about the field and not about
a route being illegal code. The harness (Decision 1) checks each line under BOTH tsconfigs and by code
and message, so the proofs cannot be satisfied by `noUnusedLocals`, by `kind` widening to `string`
(every bound `kind` is `as const`; the seven-route snippet in the M1 brief, written without `as const`,
would fail on `kind`), or by an excess-property error.

Two observations from writing them, stated because they are not what one expects:
- The last line of the elaboration differs between configs and routes. Under `tsconfig.json` every route
  ends "Type 'Warrant' is not assignable to type 'undefined'". Under `tsconfig.lib.json` the non-literal
  routes end "... to type 'never'" and the fresh literal ends "... to type 'undefined'". The proofs
  therefore match the line all of them share, "Types of property 'warrant' are incompatible".
- An explicit `chargedTo: undefined` reports `TS2375` under `tsconfig.lib.json` (the
  `exactOptionalPropertyTypes` form of the same assignability error) and `TS2322` under
  `tsconfig.json`; the directive lists both.

**What it does not close, at full strength** (each is a comment in `standing.ts`):
1. **A value whose static type no longer names the forbidden field.** Found by probing beyond the seven routes
   after the proofs were written, and not one of them. `?: never` refuses every value whose static type carries
   a forbidden field, by every route. It cannot refuse an object that was first assigned to a supertype that
   mentions fewer fields, which TypeScript allows for any non-fresh object: through an annotated variable
   (`const lax: WithoutWarrant = contaminated; const s: Standing = lax`), through a function parameter and
   return type, or through an explicit type argument; nor one whose type the compiler reduces to such a
   supertype: the branches of a conditional expression and the elements of an array literal are reduced by
   subtype reduction, so `flag ? contaminated : plain` has type `WithoutWarrant`. The field is still on the
   object at run time. This is the same class as 2 and 3, reached with fully typed code and no cast.
2. An explicit assertion through `unknown`, or any assertion TypeScript permits from the source type. A plain
   `x as Standing` (no `unknown`) of a contaminated object compiles under `tsconfig.lib.json` and is an error
   (`TS2352`) under `tsconfig.json`; `standing.test.ts` pins that by asking the harness to expect the error
   under both configs and requiring that its only complaint is that `tsconfig.lib.json` has none.
3. An implicit `any`, such as `JSON.parse(...)`: assignable to `Standing` with no cast written.
4. A field the variants do not mention. `?: never` closes the fields the plan names, not every possible
   extra key: `{ ...clean, note: "x" }`, bound first, is a `Standing`.
5. An explicit `undefined` under `tsconfig.json` only (`standing.test.ts` pins it, by asking the harness to
   expect the error under both configs and requiring that its only complaint is that `tsconfig.json` has
   none). `app/` and `components/` compile under that config. No value other than `undefined` gets
   through, and `undefined` is indistinguishable from absent to a reader and to JSON.

Items 1 (four routes), 2 (`as unknown as`), 3 and 4 are seven directive-free lines in
`proofs/standing-residuals.proofs.ts` (zero directives, checked by the harness to compile under both configs).
That file is a disclosure, not a regression guard: nothing in this repository could make the cast and `any`
lines stop compiling, and the supertype lines stop compiling only if `Standing` stopped being structural.

**The guarantee, at the strength the probing supports.** For a value whose static type includes a forbidden
field with a value other than `undefined`, every ASSIGNMENT route tried refuses it: the eight proved per
field, and sixteen more probed once and not committed, each refused under both configs (a conditional spread,
a function argument, a generic with a constraint, an `async` return, `push`, `Map.set`, a nested property, a
default parameter, `new`, a union target, `as const satisfies`, a tuple, `Promise.resolve`, `Object.assign`
onto a clean object, a spread inside a literal, `.flat()`), plus `structuredClone` under `tsconfig.json` only
(the `lib` of `tsconfig.lib.json` has no `structuredClone`, so it did not exercise that route there). An
assertion is not an assignment and is item 2. For an `inherited` standing missing a required field the
refusal is the same, because an absent field cannot be hidden by a supertype. For a `void` or `binding`
standing carrying a forbidden field whose static type has been widened, or that arrives by cast or `any`,
nothing in the types refuses it, and `assertStandingWellFormed` (Decision 10) is the check that does. The
probe list is not a proof of completeness.

**Cross-field facts the plan states are not in the types:** `severed.atSeq > committedAt`; `heir` is the
grantor of the first dead link and never the actor; `chargedTo` names the heir's own grant. They are M5's
to produce and to test.

**The closed enum itself.** `closed-unions.test.ts` pins `binding`, `inherited`, `void` in the plan's
order, has an exhaustive consumer over the real `Standing`, and `proofs/closed-union-gates.proofs.ts` shows
`assertNeverStanding` failing to compile in a switch that misses `void` and compiling in one that
does not.

## Decision 10 — `assertStandingWellFormed`: the run-time guard for what `?: never` cannot close

`assertStandingWellFormed(standing: Standing): StandingIntegrity` lives in `standing.ts`. It reads each field
by name and returns the FIRST problem it finds: a missing common field (`commitId`, `committedAt`), then a
missing field of the variant, then a forbidden field.

- **One deviation from the plan's types: a third error, `unknown-variant`.** Plan §4.2 gives
  `StandingIntegrityError` two members, both carrying `variant: Standing["kind"]`. A value whose `kind` is
  none of the three (a cast-built fourth variant, parsed JSON, `null`, a string) cannot be described by
  either. Letting it pass would make the guard a hole; making it throw would turn a function that returns a
  verdict into one that sometimes throws. `{ kind: "unknown-variant"; found: string }` reports it. The
  plan's two members and the three cases it gives M2's health route are unchanged and pinned in
  `integrity.test.ts`. M2 and M5 were written against a two-member union and will need a third arm in any
  exhaustive switch over the error.
- **Presence semantics, chosen and pinned.** A required field counts as absent when it is `undefined`, or
  `null` unless it is `chargedTo` (the one field whose type admits `null`; the plan says "null allowed,
  undefined not"). A forbidden field counts as present when it is anything but `undefined`, so `null` is
  reported but an explicit `undefined` is not: it is the same as absent to every reader and to JSON, and
  `tsconfig.json` already treats the two alike (Decision 9). Because the field is read by name, an
  inherited, non-enumerable or accessor-defined property is seen as well.
- **The tables are tied to the types for the five variant fields, and only those.** The guard's per-variant
  tables are mirrored by seven `Assert<Equal<...>>` lines that derive the required and forbidden fields from
  the `?: never` and required declarations of the real interfaces (a field a variant does not declare at all
  does not count as forbidden) and the common fields from `StandingBase`. A table that omits one of the five
  names in `VariantField`, lists one the type does not declare, or a new common field the guard was not told
  about, fails `npm run typecheck`. A new field outside those five is not seen: adding `readonly verdict?: never`
  to `BindingStanding` or `readonly note?: string` to `InheritedStanding` leaves typecheck and all 131 tests
  green. Nor is a new variant (the guard's three literal `kind` checks are not derived from `Standing["kind"]`);
  a fourth variant is caught only by the exhaustive consumers.
- **What it catches and what it does not, at full strength** (the same text is on the function):
  it catches a contaminated value however it arrived, including `as unknown as` and an implicit `any`
  (`integrity.test.ts` builds the same contaminated value both ways and the guard reports it both times).
  It checks presence only: a present field of the wrong kind (`heir: 42`, an empty `warrant.chain`) passes;
  no relation between fields is checked (`severed.atSeq > committedAt`, the heir not being the actor); an
  arbitrary extra key, such as `note` or a leaked `verdict`, passes because only the fields the tables name
  are read; and a hostile accessor makes it throw. Each of these is a passing HONEST LIMIT test. Closing the
  extra-key case would be a short `Object.keys` check; it was not built because the plan describes the guard
  in terms of named fields (`unexpected-field` / `missing-field`) and does not ask for it. It is a candidate
  for M5 if M5 builds standings by spreading a `CommitRecord`.
- **Nothing calls it yet.** Plan §5 has M5 call it on every standing it builds and plan §6 has M2's health
  route run three cases against it. Neither milestone exists.

## Decision 11 — the barrel `index.ts`, and what it keeps private

`index.ts` re-exports exactly the names plan §5's "Function ownership" and §4.1 give M1: `principalId`,
`grantId`, `commitId`, `assertNeverStanding`, `assertNeverBreach`, `assertNeverRejection`,
`assertNeverFoldFault`, `assertStandingWellFormed`, the four `MAX_*` bounds, and every type of §4.1 to §4.3.
`public-surface.test.ts` pins the twelve run-time names exactly, so a leaked internal fails it. Two internal
type names are kept out and proved so (`proofs/public-surface.proofs.ts`, two directives):
`StandingBase`, which the plan declares without `export`, and `StandingTablesMatchTypes`, the compile-time
assertion of Decision 10. The same file imports every exported type by name, so a name dropped from the
barrel is a compile error. `unreachable` is internal and is pinned absent at run time.

The name `StandingIntegrityError` gained a member (Decision 10) and is exported with it. `Verdict`,
`Charge`, `DeadLink` and `GrantTree` are exported even though no M1 function takes them, because plan §5
has M3 to M5 import them from `lib/contracts`.

## Decision 12 — `lib/**` is a closed module graph, and the layer table of plan §5 is enforced from M1

`__tests__/architecture.test.ts` (with `support/module-graph.ts`) is the plan's M1(e). For every `.ts` file under
`lib/` it parses the file with the compiler API the plan names (`typescript/unstable/{ast,sync}`, which ships
with `typescript@7.0.2`; `ts.createSourceFile` does not exist there) and checks every module reference the
grammar has a form for: `import`, `export ... from`, `import x = require()`, dynamic `import()`, a `require()`
call, an import TYPE (`import("x").T`, `typeof import("x")`) and the `/// <reference>` directives. A specifier
that is not a string literal is a violation. A relative specifier is resolved to a real file and its REAL path
must lie inside `lib/`; the test never counts `../`.

- **Rules and their fixtures.** One synthetic tree under the OS temp directory has a single violation per file
  (25 `file:rule` pairs, asserted as an exact set) beside valid files that must not be flagged: an upward
  import between layers (contracts to chain, chain to standing, domains to app), a cycle (the offending edge is
  the upward one), a relative specifier that resolves out through `../../node_modules`, one through a symlink,
  `export * from`, an import type, `typeof import`, a reference directive, a bare and a `node:` import in library
  source, a `require`, a computed `import(expr)`, a literal `import("node:os")`, an unresolvable specifier, an
  import of an undeclared directory under `lib/`, a library source file importing a file under `__tests__/`, a `.ts` file directly in `lib/`, a `.json`, a `.d.ts`, a `.js`
  and a symlink. A second tree is clean, and a third tree holds a file that does not parse, which must be a violation, not a skip.
- **Allowlist.** Library SOURCE may import nothing from outside `lib/`. No SOURCE file may import a file under `__tests__/` (rule `source-imports-test`), because that file may import the test externals. Files under `__tests__/` may import the
  seven externals the tests use today, and the test fails if an allowlisted external is imported by no file, so
  no allowance is speculative.
- **Layer table.** `lib/contracts` < `lib/chain` < `lib/allowance` < `lib/standing` < `domains` < `scripts`,
  `components`, `app`; an import may go to the same or a lower layer. Strict ordering between layers cannot
  contain a cycle between layers, which is what the "zero cycles" gate asks for at that level; a cycle between
  two files inside one layer is NOT checked. The plan names `domains/company`; the table uses `domains`, so any
  directory under it shares that rank.
- **Beyond the plan:** the file inventory (only non-declaration `.ts` files, no symlinks, under `lib/`), because
  a `.d.ts` plus a `.js` inside `lib/` is an import that resolves inside `lib/` and lies about its type.
- **What is not covered, stated at full strength.** This is about imports. It does not look at what a file
  declares (an ambient `declare module` or `declare global`), and it does not stop library code using an ambient
  global (`fetch`, `process`, `Date.now`, `Math.random`): a closed graph says where code can come from, not that
  it is pure. It scans `.ts` files under `lib/` and `domains/` only. Files under `domains/` get the layer rule
  and nothing else.
- **This test is frozen with M1 yet polices M3 to M5.** A later milestone that needs a new external in a test, or
  a layer directory the table does not list, has to edit this milestone's files, which plan §6 forbids ("a
  milestone may not edit another's paths"). That is deliberate for the tripwire and awkward for the milestone;
  the plan does not say who owns such an edit.

## Decision 13 — plan §7's canonical incident is typed against the real contracts, as an expressibility check only

`canonical-incident.test.ts` writes every value of `.genesis/PLAN.md` §7 as a value of the real types: the
charter, grants G1 to G7 as `Grant<Cap>` (`Cap` = the four company capabilities), commits c1 to c10, the 18
admitted events as a `Log<Cap>` with `seq` 1 to 18, the fifteen attempted rejections (one of each `Rejection`
kind), and the final standings (c1, c2, c4 inherited by `cfo` severed at `G2@11` charged to `G1`; c3 and c10
binding; c5 to c9 void with one of each of the five `Breach` kinds). It is the plan's own §8.A "type trace"
re-run against the real types, and it found nothing the types cannot express.

It is NOT evidence about behaviour. The numbers are copied from §7, which says they were executed on a
throwaway model; no engine exists to compute them, `CANON_SCRIPT` is M6's, and nothing here is imported by
anything. Each final standing is passed through `assertStandingWellFormed` and accepted, which says only that
the standings have the right fields.

## Falsifiability log

Each run is ONE edit to the shipped source (or, for the harness and scanner runs, to their own source); a row that says "each" or lists several edits groups runs of the same kind. For each run, the
FULL `npm run typecheck` and the FULL `npm test` run against it, then `git checkout` of the edited file and a
clean `git status`: 48 runs, all restored clean (one of them, "guard treats `null` as present for required
fields", left an unused variable and is superseded by its `heir`-only version, but is kept in the count).
Measured on the tree of commit `9d2404a` (13 test files, 129 tests, typecheck clean), by a script that applied
the edit, ran both commands and parsed their output. The edits are mine, not a
verifier's; the list is not exhaustive.

**Read the red counts with care.** A compile error in a contract source that proofs import turns every harness
test over a proof importing it red (Decision 1), so a one-line edit to `standing.ts` routinely reds 7 to 12
tests while only one or two are about the property. The last column names the tests that ARE about it. Rows
whose `typecheck` cell shows an unrelated code (`TS6196`, `TS2367`, `TS2339`) are artifacts of how the edit
was made (an unused type parameter, a type-narrowing side effect), not of the property.

| Edit | `npm run typecheck` | `npm test`, red of 129 | Tests about the property |
|---|---|---|---|
| `breach?: never` to `breach?: Breach` on `binding` (plan ledger) | 8 x `TS2578` at the eight `binding`+`breach` proofs, 1 x `TS2344` (table assertion) | 8 | `standing-forbidden.proofs.ts` |
| `heir` optional on `inherited` (plan ledger) | 8 x `TS2578` at the eight `inherited`-without-`heir` proofs, 1 x `TS2344` | 8 | `standing-required.proofs.ts` |
| a fourth member added to the REAL `Standing` union (the plan's ledger does this on a stand-in) | 2 x `TS2345` (`assertNeverStanding` in `closed-unions.test.ts` and in `closed-union-gates.proofs.ts`), 1 x `TS2741` (`samples.ts`) | 4 | the proof-harness tests over the proofs that import `Standing` |
| drop `chargedTo` from the guard's `void.forbidden` (plan ledger) | 1 x `TS2344` | 9 | "void carrying chargedTo is unexpected-field" |
| insert `import "node:fs"` into `ids.ts` (plan ledger) | passes | 14 | architecture "has no violation", which names `lib/contracts/ids.ts:external-not-allowed`; 13 harness tests also fail because the harness's scratch project has no `@types/node` |
| delete ONE `?: never`, each of the nine forbidden fields in turn | 7 x `TS2578` (the seven non-literal routes of that field) + 1 x `TS2344`, every time | 8, every time | `standing-forbidden.proofs.ts` |
| `warrant?: never` to `warrant?: Warrant` on `void` | 8 x `TS2578`, 1 x `TS2344` | 8 | `standing-forbidden.proofs.ts` |
| `NonEmptyReadonlyArray` to `readonly T[]` | 4 x `TS2578` | 3 | the three proof files that use it |
| `GrantId` given `PrincipalId`'s brand label | 2 x `TS2578` | 1 | `ids.proofs.ts` |
| `Grant.capabilities` ignores `C` | 4 x `TS2578`, 1 x `TS6196` | 11 | `capability.proofs.ts` |
| `Amount` made a branded number | 23 x `TS2322` (the honest-limit lines in `limits.test.ts` and every literal amount) | 6 | `limits.test.ts` fails to COMPILE; the 6 red are harness tests |
| `GrantTree.revokedAt` a mutable `Map` | 1 x `TS2578` | 1 | `tree-and-warrant.proofs.ts` |
| `Warrant.chain` allowed empty | 1 x `TS2578` | 1 | `tree-and-warrant.proofs.ts` |
| `LogEvent.seq` optional | 2 x `TS2578` | 1 | `event.proofs.ts` |
| delete the `over-limit` variant of `Breach` | 8 errors across `breach.ts`, the samples, the consumers and the gate proofs | 9 | harness tests only; `closed-unions.test.ts` stays green under `npm test` |
| delete the `already-dead` variant of `Rejection` | 5 errors (`TS2678` x 3, `TS2322`, `TS2353`) | 2 | harness tests only; same |
| add a sixteenth variant to `Rejection` | 2 x `TS2345`, 1 x `TS2741` | 2 | harness tests only; same |
| `unreachable` returns instead of throwing | passes | 8 | the eight `assertNever*` throw tests |
| guard treats `null` as present for `heir` | passes | 1 | "a required field holding undefined is missing, as is one holding null" |
| guard drops `commitId` from its common fields | 1 x `TS2344` | 12 | the three "without the common field commitId" tests and the null/undefined test |
| guard reports a forbidden field before a missing one | passes | 1 | "a missing variant field comes before a forbidden field" |
| barrel also exports `unreachable` | passes | 2 | `public-surface.test.ts` |
| barrel drops `assertNeverFoldFault` | 1 x `TS7053` | 2 | `public-surface.test.ts` |
| `contracts` imports `../chain/x.js` (a new file) | passes | 1 | architecture "has no violation" |
| harness: same-line extra-diagnostic check off | passes | 1 | "a real error PLUS an unused-local error on the same line" |
| harness: diagnostic-code comparison off | passes | 1 | "an error whose message matches but whose code is not the stated one" |
| harness: message-fragment comparison off | passes | 1 | "an error with the right code but a different message" |
| harness: directives not removed before compiling | passes | 19 | every proof file (11), the three harness-based tests in `standing.test.ts`, five harness self-tests |
| harness: only `tsconfig.lib.json` | passes | 3 | "runs under both of the repo's tsconfigs", the exactOptional self-test, the `undefined` pin |
| scanner: import types / `require()` / `/// <reference>` / dynamic `import()` not collected | passes (two artifacts: `TS2367`, `TS2339`) | 1, 1, 2, 1 | the synthetic-tree test, each |
| scanner: `.d.ts` not an inventory violation / symlinks not / unresolvable passes / layer order off | passes | 1 each | the synthetic-tree test |
| scanner: a relative specifier leaving `lib/` unchecked | passes | 2 | the synthetic-tree test and the named-specifier test |
| scanner: an unused allowlisted external (`node:crypto`) added | passes | 1 | "every allowlisted external for tests is imported by some file" |

**A finding the harness itself needed.** A sabotage run on `standing.ts` showed one compile error in a contract
source reds every harness test; that is Decision 1's revision. A run on the harness itself showed that
dropping its code comparison left every self-test green (each bad proof there also failed the message
comparison); the "message matches but code does not" self-test was added for that.

**A finding about this ADR's own earlier text.** Sabotaging `Breach` and `Rejection` showed `npm test` does not
notice a deleted variant through `closed-unions.test.ts` at all (Decision 7 was corrected), and probing beyond
the seven routes found the supertype residual (Decision 9 was corrected).

### Addendum: runs after the independent L4 round

Same method as above (one edit, the full typecheck, the full suite, restore, clean `git status`), measured on the
working tree that the commit adding each bullet leaves, not on `9d2404a`.

- **D1, harness: revert only the `if (extra !== matching) {` line to its old form
  (`... && !directive.codes.includes(extra.code)`).** `npm run typecheck` passes; `npm test`: 1 failed, 129 passed
  (130): "a real error PLUS a second error with the SAME code on the same line", and no other test.
- **D6, scanner: the new `source-imports-test` rule.** Rule block deleted, fixture kept: `npm run typecheck`
  passes; `npm test`: 1 failed, 129 passed (130), "reports exactly these file:rule pairs", whose diff shows
  `- "lib/contracts/uses-test.ts:source-imports-test"`. Rule in place and `import "./__tests__/support/module-graph.js";`
  prepended to `lib/contracts/ids.ts`: typecheck passes; 14 failed, 116 passed (130): "has no violation", whose
  diff shows `+ "lib/contracts/ids.ts:source-imports-test"`, and 13 harness tests (their scratch projects import `ids.ts` and,
  through it, `module-graph.ts`). With the rule deleted AND that import
  prepended, "has no violation" passes: the earlier scan accepted a library source file importing a test file.
  Both edits restored; 130 passed.
- **Harness, optional L4 item: the "tsc printed something that is not a diagnostic" check.** `checkProofSource` takes an
  optional `tsc` script (default: this repo's) so a test can hand it a stub that prints `error TS5110: stub, no location`
  and exits 1; the report for a file with no directives must contain that line. Replacing the `problems.push(...)` for
  that case with `void line;`: `npm run typecheck` passes; `npm test`: 1 failed, 130 passed (131), only the new test.
  Without the check, a zero-directive proof file (`standing-residuals.proofs.ts`) would pass when the compiler cannot run.
  Restored; 131 passed.

## What M1 does not claim

- No engine behaviour. Nothing here computes a verdict, a standing, a headroom or a rejection; `lib/chain`,
  `lib/allowance` and `lib/standing` do not exist. Every comment that names M3, M4 or M5 is the plan's
  assignment, not a statement about code.
- That the eight routes per field are all the routes. They are the eight the series' history names; sixteen
  more were probed once; one further class (a widened static type) was found by probing and is disclosed.
- That a `Standing` carrying a forbidden field cannot exist. It can, by a cast, an `any`, or a widened static
  type; `assertStandingWellFormed` reports it only if something calls it, and nothing does yet.
- That ids, amounts, `seq` or `depth` are valid, or that a caller cannot choose `seq`: those are M3's intake and
  M5's `append`, and they do not exist.
- That the library is pure. The closed module graph is about imports, not ambient globals.
- That `npm run build` exercises `lib/`: see the next section.

## Plan observations (found by building; none edited in the plan, which is frozen)

1. **D3's "a caller cannot choose `seq`" is not a property the plan's types can have** (Decision 5): `LogEvent =
   EventInput & { seq }` makes `seq?: never` on the inputs collapse the whole `LogEvent` to `never`. Checked in a
   scratch file. It must be M5's `append` building the logged event from explicitly read fields.
2. **`StandingIntegrityError` has no member for a value whose kind is not one of the three** (Decision 10). Added
   `unknown-variant`.
3. **The plan's M1 file list has no home for the shared `assertNever` body** (Decision 7, `unreachable.ts`), and
   **no path for the ADR** (`.genesis/decisions/0001-contracts.md` is outside `lib/contracts/**`, the one path
   §6 gives M1, though §6 also says each milestone ends with its ADR).
4. **`npm run build` does not exercise `lib/` until something under `app/` imports it.** `app/page.tsx` is a
   placeholder, so the `.js`-suffixed imports M1 writes are checked by `tsc` and `vitest` but not by webpack.
   `.genesis/checkpoints/CURRENT.md` and the smoke test's comment say `npm run build` covers this "from M1";
   for M1 that is not so. Checked once, by hand and not pinned by any test: `app/page.tsx` temporarily imported
   `../lib/contracts/index.js`, `npm run build` ("next build --webpack") compiled, type-checked under
   `tsconfig.json` and prerendered, and the change was reverted. M2's health route is the first real check.
5. **`?: never` behaves differently under the repo's two tsconfigs** (Decision 9): `tsconfig.json` (for `app/` and
   `components/`) has no `exactOptionalPropertyTypes`, so an explicit `undefined` is accepted there. A consumer in
   `components/` (M8) compiles `lib/contracts` under that config. Setting `exactOptionalPropertyTypes` in
   `tsconfig.json` is a scaffold change, outside M1's paths.
6. **M1's frozen architecture test polices M3 to M5 and lists their allowed externals** (Decision 12); a milestone
   that needs a new external or a new layer directory has to edit M1's files, which plan §6 forbids.
7. **The brief's seven-route snippet fails for the wrong reason as written.** `const x = { kind: "void", ... }` without
   `as const` widens `kind` to `string`, and `noUnusedLocals` is on in both tsconfigs, so a bare
   `// @ts-expect-error` over `const a: Standing = x;` is satisfied by `TS6133` or by the `kind` mismatch whatever
   `Standing` looks like (Decision 1). The proofs here use `as const`, export every binding and are checked by the
   harness.
8. **Not edited because it is not M1's:** `README.md` still says there is "one smoke test"; `.genesis/DONE.html`
   and `.genesis/checkpoints/CURRENT.md` still show M1 `todo` (they change only in a `chore(genesis): mark M1 done`
   PR after independent verification).
