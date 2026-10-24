# ADR 0003 — M3 chain: intake that reads each field once, walkers that cannot loop, and the structural admission check

- **Date:** 2026-10-24
- **Status:** proposed — written by the builder, not yet verified by an independent L4 pass
- **Phase / milestone:** M3 (BUILD) — `lib/chain/**` (`intake.ts chain.ts structure.ts index.ts`, `__tests__/`)

Decisions are in the order of the commits that made them. The falsifiability log near the end is
measured on the tree of commit `1d7ae12` (every source and test file of this milestone; the commit
that adds this ADR changes nothing else). No number below is a count of passing tests: those go stale
whenever a test is added, and the log quotes only "N failed" for a sabotage.

## Context

`.genesis/PLAN.md` §5 and §6 (M3) give this layer eight functions (`readCharter`, `readEventInput`,
`readLogEvent`, `chainOf`, `trailOf`, `firstDeadLink`, `liveAuthorityAbove`, `checkGrantStructure`) and
three test layers: a table in which each rejection's fixture violates only its own rule, an
attenuation-closure property over a seeded generator, and N / N+1 for every invented constant. The plan
says its throwaway model showed that whole-system properties did not reliably catch deleted structural
refusals, which is why the layers are shaped this way. This milestone is the first one that computes
anything, so it is the first place a plan sentence can be wrong; those are collected at the end.

## Decision 1 — every property is read once, in a fixed order, and a throwing read is `hostile`, not an exception

`intake.ts` reads every property of untrusted input through one helper, `read(owner, key, path)`, and
afterwards looks only at the local that holds that read. Nothing spreads, `Object.keys`es or
`JSON.stringify`es the input, and a value that is not a string or a number is never coerced to one
(`intake.test.ts` passes an id whose `toString` records a call and asserts it was never made).
The result is built from the locals, so an input's extra keys, including a `seq` on something that is not
a logged event, are never copied.

- **What counts as a read.** A property of the event or payload, a list's `length`, and each list element
  by index, are each read once. `hostile-input.test.ts` counts reads with accessors and with a Proxy `get`
  trap, and asserts the exact set of keys that were read (so a test that read nothing cannot pass). It
  does this for a grant (plain, logged, and refused for shape), a commit, a revoke, an unknown kind (only
  `kind` is read) and a charter.
- **Flipping getters.** For each of the seven grant fields there are two tests, one where the first read is
  valid and later reads are garbage (the result must carry the first answer) and one where the first read is
  invalid and later reads are valid (the event must be refused). For `kind`, the grant payload,
  `commit.amount`, `commit.capability`, a revoke's two fields, `seq`, a charter's `roots`, a capability
  list element and a charter list element there is the first direction only (valid first, garbage after).
- **`hostile` versus `invalid`.** A read that throws (a throwing getter, a throwing Proxy trap, a revoked
  Proxy, and `Array.isArray` on a revoked Proxy, which itself throws) returns
  `{ kind: "hostile", message: "reading <path> threw" }`. The message names the field and never contains
  the thrown value: the tests throw an `Error`, a string, `undefined`, an object whose `toString` and
  `message` throw, and a null-prototype object, and get the same message for each. Once the event's `kind`
  is known, every field of that kind's payload is read even after an earlier field was found invalid, so a
  throw outranks a shape problem for every field intake reads (tested for a grant, with the throwing field
  before and after the invalid one). An unknown `kind`, or a payload that is not an object, leaves nothing
  to read. Only a `HostileRead` raised by this file is caught; any other exception is a bug here and
  propagates.
- **Only `get` is used.** A Proxy whose `has`, `ownKeys`, `getOwnPropertyDescriptor`, `getPrototypeOf`,
  `isExtensible`, `set`, `defineProperty` and `deleteProperty` all throw is read normally.
- **A charter has no `hostile` outcome.** The plan's `CharterRead` has only `{ ok: false; fields }`, so a
  charter whose getter throws is an invalid charter naming the field it was reading (both fields if the
  charter is not an object).

## Decision 2 — what "well-formed" means, where the plan is silent, and what is refused first

All offending fields are reported at once, deduplicated and sorted, named as the payload names them
(`limit`, not `grant.limit`; `eventKind` says which payload). The rules:

| Field | Accepted | Notes |
|---|---|---|
| any id (`id`, `parent`, `grantor`, `grantee`, a commit's `id` `actor` `actedUnder`, a revoke's `grantId` `by`) | a string of 1 to `MAX_ID_LENGTH` UTF-16 code units | ids are opaque: `" "`, `"__proto__"`, a lone surrogate are accepted unchanged |
| `parent` | `null` or an id | an ABSENT `parent` is invalid, not a root grant |
| `limit`, `amount` | a safe integer in `[0, MAX_AMOUNT]` | `-0` is accepted and returned as `0` |
| `depth` | a safe integer in `[0, MAX_ROOT_DEPTH]` | |
| a grant's `capabilities` | an array (not an array-like, not a typed array) of 1 to `MAX_CHARTER_ENTRIES` distinct strings | a sparse array fails (a hole reads as `undefined`) |
| a commit's `capability` | a string | |
| `seq` (logged events only) | a safe integer of at least 1 | **not in the plan**, see Decision 7 and the plan observations |

Then, only if no field is malformed, the first capability in the event's own order that is outside
`charter.capabilities` is `unknown-capability`. A repeat in the list is a shape problem even when every name
is unknown. A non-object event is `eventKind: "unknown"` with the one field `kind`.

A charter is valid if `roots` and `capabilities` are each an array of 1 to `MAX_CHARTER_ENTRIES` entries,
each a valid id string (a capability NAME follows the id rule). Repeats in a charter are kept as given:
no plan rule asks for them to be refused.

## Decision 3 — `MAX_CHARTER_ENTRIES`: one bound the plan does not name, added because a list's length is input

A Proxy can report `length` as `2 ** 32 - 1` and answer every index. Without a bound, intake would not give a
typed answer: in the sabotage run below it ran for roughly 16 to 18 s and then threw `RangeError: Invalid array
length` from `Array.prototype.push`. `intake.ts` therefore exports `MAX_CHARTER_ENTRIES` (invented, not derived; its value is
in `intake.ts`, and the tests are written in terms of the constant, so nothing pins the literal) and uses
it three times: a charter's `roots`, a charter's `capabilities`, and an event's `capabilities`. A list
outside `[1, MAX_CHARTER_ENTRIES]`, or one whose `length` is not a safe integer, is refused with no element
read (a test counts element reads on a lying Proxy: zero).

**What the bound does, measured.** In the sabotage run below, removing it made the two tests that give a
list a claimed length of `2 ** 32 - 1` take about 16 s and about 18 s each and then fail with
`RangeError: Invalid array length` from `Array.prototype.push`; with it they finish in milliseconds. It
loses no valid event for a charter that went through `readCharter` (an event's capability list must be a
duplicate-free subset of a vocabulary that is itself capped), but a typed charter that did not go through
`readCharter` and has a larger vocabulary could have a valid event refused. `boundaries.test.ts` pins N and
N+1 for all three uses; N entries all outside the vocabulary are an `unknown-capability` and N+1 is
`invalid-event-shape`, so the change at N+1 is the length and nothing else.

## Decision 4 — only intake is hardened; the rest of the layer trusts the typed values it is given, and two tests say so

- `readEventInput` takes its `charter` argument on trust and reads `charter.capabilities` once per call. A
  charter whose own getter throws makes it throw. The route that makes a hostile charter safe is
  `readCharter`, which turns the same object into a typed refusal; one HONEST LIMIT test runs both.
- `checkGrantStructure` and the walkers are specified for a `Grant` and a `GrantTree` whose VALUES came out
  of intake. They distrust the tree's TOPOLOGY (Decision 5), not a grant's field values, and they read a
  grant's `parent` more than once. A second HONEST LIMIT test runs the same grant as plain data (accepted) and
  with an accessor on `parent` that answers `"G2"` then `"g-ghost"` (refused as `unknown-parent` for
  `"g-ghost"`): such a grant is judged on mixed reads.
- Not tested: a `GrantTree` whose `grants` or `revokedAt` is not a real `Map`, for instance one whose
  `get` throws. Nothing in `chain.ts` guards it; this ADR makes no claim about what happens.

## Decision 5 — the walkers visit at most `MAX_ROOT_DEPTH + 1` grants and fail closed

`lib/contracts/tree.ts` says a `GrantTree` can be built by hand, so `chainOf` does not trust its shape. It
looks up at most `MAX_ROOT_DEPTH + 1` grants and returns `undefined` if it has not reached a root grant
(`parent: null`): a self-parent, two grants that are each other's parent, a three-cycle, a missing parent, a
parent that is `undefined` or a number, and an ancestry longer than the bound all give `undefined`. "Never
loops" is a measured bound: a `Map` subclass that counts `get` calls shows exactly `MAX_ROOT_DEPTH + 1`
lookups for a two-cycle and for a self-loop. 600 seeded random graphs (roots, self-parents, cycles, orphans,
long runs) are compared with an oracle that computes each grant's chain length from the roots UP, so the
oracle does not share `chainOf`'s loop. In the sabotage run, removing the bound made the cyclic tests fail with
`RangeError: Invalid array length` from the `push` inside `chainOf` rather than hang.

- **`chainOf`** does not depend on `revokedAt`: a revoked grant is still on its chain.
- **`trailOf`** is the charter root (the first grant's `grantor`) then each `grantee`, so one longer than the
  chain. It returns `undefined` unless the list is a root-first run of grants known to the tree, linked by
  `parent`, of at most `MAX_ROOT_DEPTH + 1` entries, so an out-of-order list, a skipped grant, a grant from
  another branch, a repeat or an empty list (from a cast) cannot produce a trail no delegation made.
- **`firstDeadLink`** returns the revoked link NEAREST THE ROOT, not the first revoked in time (plan D7: the
  heir is the grantor of that link, and it climbs as higher links are cut). A revocation at seq 1 counts: it
  is compared with `undefined`, not tested for truthiness.
- **`liveAuthorityAbove`** returns, root first, the grantor of each link of the chain up to and including the
  first dead link (or every link if none is dead): the grantor of the dead link is the heir and its own
  authority runs through links that are all live; grantors below it are excluded. It never includes the
  grant's own grantee, nor a charter root that is not on this chain, and it returns `[]` for an unknown
  grant or a chain that cannot be completed. On plan §7's tree with G2 revoked at seq 11 it gives `dana, cfo`
  for G4. Whether a revoker is one of these principals is M5's rule (`revoker-not-authorised`); nothing in
  this layer reads a revoke event beyond checking its two fields are well-formed ids.

## Decision 6 — `checkGrantStructure`: nine refusals, the first failing rule wins, and four choices the plan does not make

Order (plan §4.3): `duplicate-id`; then for a root grant `not-a-root`, or for a child `unknown-parent`,
`parent-dead`, `grantor-not-holder`, `capability-widening`, `depth-exhausted`, `depth-not-narrowed`; then
`principal-cycle` for either.

1. **A parent whose ancestry cannot be completed is `unknown-parent`.** The plan's nine
   `StructureRejection` kinds have none for it. It arises only in a hand-built tree. A parent whose chain
   cannot be established cannot be delegated under, and `unknown-parent` is the one kind that says so.
2. **The `principal-cycle` trail includes the charter root.** A grant back to the root of its own chain, and
   a root grant to its own grantor, are `principal-cycle`. A grantee that is some OTHER charter root, not on
   this chain, is accepted: that is what plan §10's rejected `grantee-is-root` rule would have refused.
   Which reading the plan means is not stated; this one follows from `trailOf` and `Warrant.trail` starting
   at the charter root.
3. **`parent-dead` names the dead link nearest the root** (the same link `firstDeadLink` returns).
4. **`limit` is never read.** `over-allocation` is M5's, from M4's headroom. A test gives the grant a `limit`
   accessor that throws and it is still judged, and plan §7's 200 000 over-delegation passes this check.

`capability-widening` means the child's set is not a SUBSET of the parent's; one shared capability is not
enough, and the first capability in the child's own order that is outside the parent's is the one named.
`depth-exhausted` is a parent of depth 0; `depth-not-narrowed` is a child depth that is not strictly below
the parent's.

## Decision 7 — three test layers, and what each does and does not show

**Layer 1, the table (`structure.test.ts`).** Every row carries two scenarios: `violating`, which must be
refused with exactly the expected rejection, and `repaired`, which differs by the ONE change that fixes that
rule and must be accepted. If the violating fixture also broke a later rule, the repaired one would be
refused by it and the row would fail, so a passing row shows its fixture breaks only its own rule. There
are rows for all nine kinds (the key list is tied to `StructureRejection["kind"]` with `satisfies`, so a tenth
kind fails `npm run typecheck`), including five `parent-dead` shapes and two hand-built hostile-tree cases
(a looping ancestry, an over-long one) for `unknown-parent`. A second table pairs each rule with the next one it can hide and shows the second
appearing once the first is repaired. The plan's note that `parent-dead` needs `limit: 0` is about M5 (a dead
grant's headroom is 0, so a positive `limit` would be reported there as `over-allocation` first); this layer
cannot be masked that way because it never reads `limit`. The `parent-dead` fixtures keep `limit: 0` so they
stay isolating once M5 composes this check with M4.

**Layer 2, attenuation closure (`attenuation-closure.test.ts`).** Over 1000 seeds of 100 steps each, grants
(and occasionally a revocation written straight into the tree) go through the real `readEventInput` and
`checkGrantStructure`. Every accepted grant is checked, as data and by an independent walk up the `parent`
pointers, to satisfy: `grantor` is the parent's `grantee`; capabilities are a subset; `depth` is at most the
parent's minus one and the parent's is at least 1; no principal repeats on the trail; the chain has at most
`MAX_ROOT_DEPTH + 1` grants and starts at a root grant granted by a charter root; the id was not already in the
tree; and no link on the chain was revoked at admission. The last clause is not in the plan's list. Every
grant the structure check refuses is checked to be refused for a reason that is true of its data (for
example, a `capability-widening` capability really is one the grant asked for and the parent lacks); the
payloads of intake's two kinds are not checked there, `intake.test.ts` does that. Not checked: that the first
failing rule, in precedence order, is the one reported; the pair table covers that.

- **Coverage.** A test requires every one of the eleven rejection kinds M3 owns (nine structural, two from
  intake) to be produced at least a hundred times in the pool-of-5 run, and nothing else to be produced
  (the generator never provokes `hostile`).
- **Pool of 5 and pool of 12.** The plan has the generator draw principals from a pool of 5 so a repeated
  principal is the common case. A pool of 5 cannot fill the 9 distinct principals a chain of the maximum
  `MAX_ROOT_DEPTH + 1` = 8 grants needs; a test shows the longest accepted chain in that run is at most 4. The
  longest-chain end is therefore run again with a pool of 12 and a generator tilted towards long chains
  (`eager`: parents mostly taken from grants that can still delegate, depths mostly narrowing by exactly one,
  grantors almost always the holder, an unknown parent rare), and a test requires that an accepted chain of 8
  was reached. With the default weights, before the tilt was added, the longest chain reached in the same 1000
  seeds was 7. Even tilted, an accepted chain of 8 occurs in only 3 of the 1000 seeds (seeds 28, 148 and 496).
- **Timeout, and why the work was not cut.** The two tests that check every accepted grant of all 1000 seeds (the
  pool-of-5 closure test and the pool-of-12 longest-chain test) have an explicit 60 s per-test timeout,
  `SEED_LOOP_TIMEOUT_MS`; every other test in the layer runs under vitest's 5 s default. Measured on 2026-10-24,
  pool of 5 then pool of 12: about 0.8 s and 1.4 s on an idle 10-core machine; 3.2 s and 3.6 s on the GitHub
  runner for the pushed branch (CI run 40097885316); with 20 busy `yes` processes on the 10 cores, 4.0 to 5.9 s and
  5.7 to 7.8 s over three full runs, in which the 5 s default failed the pool-of-12 test all three times and the
  pool-of-5 test once. After the change, three full runs under the same load had 0 failed (the two tests took 3.9
  to 4.2 s and 5.3 to 5.5 s), and `--testTimeout=500` on the file gave 2 failed before and 0 after, since a
  per-test timeout overrides the flag. The work was not cut because the longest-chain assertion rests on 3 of the
  1000 seeds: 300 seeds would leave two of them, and the generator's tilt would have to change to leave more. The
  pool-of-5 coverage test could be cut (at 300 seeds the least frequent kind, `depth-exhausted`, was produced 502
  times against the floor of 100) but it is the faster of the two, so cutting it would not remove the problem. A
  timeout is a failure threshold, not a guard against a hang: these tests are synchronous, and a 7.8 s run was
  reported as timed out at 5 s only after it had finished. Raising it to 60 s adds margin for a slow machine and
  no protection against a test that never returns, and none is claimed.
- **What it does not show.** The property is over what this generator produces. It does not build a hand-made
  hostile tree (Decision 5 does), and its "walkers agree with the data" test runs 200 of the seeds.

**Layer 3, boundaries (`boundaries.test.ts`).** N and N+1 for `MAX_AMOUNT` (limit and amount, and 0 / -1),
`MAX_ROOT_DEPTH` (depth, narrowing under every parent depth from 1 to the maximum, and chain length: `chainOf`
and `trailOf` return a chain of `MAX_ROOT_DEPTH + 1` grants and refuse one of `MAX_ROOT_DEPTH + 2`, on a valid
line of grants so the bound is the only reason; and the real intake plus structure check build the
longest chain and refuse the next link), `MAX_ID_LENGTH` for all nine id fields and the charter's names
(counted in UTF-16 code units: a string of half of `MAX_ID_LENGTH` characters that are two units each is
accepted and one with one more such character is refused), `MAX_CHARTER_ENTRIES` (Decision 3), and `seq` (1 and `Number.MAX_SAFE_INTEGER`). `MAX_LOG_EVENTS` is
not here: nothing in `lib/chain` reads it, and the log's length is M5's `log-too-long`.

## Decision 8 — `architecture.test.ts` adds what M1's closed-graph test does not; M1's frozen allowlist did not collide

M1's `architecture.test.ts` already scans `lib/chain` for the layer order and for anything imported from outside
`lib/`. The M1 ADR (Decision 12 and plan observation 6) warned that a later milestone needing a new external
or layer entry would have to edit M1's frozen files. That did not happen: `lib/chain`'s tests import only
externals already on M1's allowlist (`vitest`, `node:fs`, `node:os`, `node:path`, `typescript/unstable/sync`),
and M1's test passes with `lib/chain` present. `git diff main -- lib/contracts` is empty.

This layer's own test adds four things, each with a synthetic fixture that breaks it: library source reaches
`lib/contracts` ONLY through `lib/contracts/index.ts` (a type-only import, a re-export, `export *`, a dynamic
import and a `typeof import` of an internal file all count; the fixture has one violation per file and the
expected set is asserted exactly); no import cycle among this layer's source files; the source files are
exactly the plan's four; and the barrel exports exactly the plan's M3 names plus `MAX_CHARTER_ENTRIES`. It
reuses `referencesIn` from M1's `support/module-graph.ts` rather than writing a second reference collector.
Not checked: that the code is pure (a closed graph says where code comes from, not what it does).

## Falsifiability log

Each row is ONE edit to one shipped source file in `lib/chain/`, then the FULL `npm run typecheck` and the
FULL `vitest run` against it, then `git checkout -- <file>` and an empty `git status --porcelain`: 33 runs,
all restored clean. Measured by a script that applied the edit, ran both commands (vitest with `--reporter=json`)
and parsed the result, on the tree of commit `1d7ae12`. The script is not committed; each edit is described
here so it can be repeated by hand. "Typecheck" says what `npm run typecheck` reported: rows that show `TS6133`
are an unused variable left by the edit, not part of the property. Several tests can go red from one edit; the
files are named so the layer that caught it is visible.

**The plan's ledger (§6 M3):**

| # | Edit | Typecheck | `npm test` | Red in |
|---|---|---|---|---|
| P1 | `⊆` becomes "any overlap": `capability-widening` only when NO capability is shared (`some(...)` instead of `find(!...)`) | passes | 4 failed | attenuation-closure 2, structure 2 |
| P2 | drop `grantor = parent.grantee` (the `grantor-not-holder` condition made unsatisfiable) | passes | 8 failed | attenuation-closure 3, structure 5 |
| P3 | drop depth narrowing (the `depth-not-narrowed` condition made unsatisfiable) | passes | 15 failed | attenuation-closure 3, boundaries 7, structure 5 |
| P4 | drop the cycle check (`principal-cycle`) | passes | 10 failed | attenuation-closure 4, structure 6 |
| P5 | drop the root check (`not-a-root`) | passes | 7 failed | attenuation-closure 3, structure 4 |
| P6 | drop `parent-dead` | passes | 10 failed | attenuation-closure 4, structure 6 |
| P7a | `readId` returns a SECOND read of its field | passes | 9 failed | hostile-input 9 |
| P7b | `readWholeNumber` returns a second read | passes | 8 failed | hostile-input 7, intake 1 |
| P7c | `readParent` returns a second read | passes | 4 failed | hostile-input 4 |
| P7d | `kind` is read twice and the second read is used | passes | 8 failed | hostile-input 8 |
| P7e | each list element is read twice (the first read discarded) | passes | 6 failed | hostile-input 6 |
| P7f | `readCharter` reads a list twice and uses the second | passes | 3 failed | hostile-input 3 |

**Beyond the plan:**

| # | Edit | Typecheck | `npm test` | Red in |
|---|---|---|---|---|
| X1 | drop `duplicate-id` | passes | 9 failed | attenuation-closure 4, structure 5 |
| X2 | drop `capability-widening` entirely | passes | 8 failed | attenuation-closure 3, structure 5 |
| X3 | drop `depth-exhausted` | passes | 8 failed | attenuation-closure 3, boundaries 2, structure 3 |
| X4 | drop `unknown-parent` (the code after it then reads an undefined parent) | TS2345, TS18048, TS2322 | 13 failed | attenuation-closure 6, hostile-input 1, structure 6 |
| X5 | the `principal-cycle` trail leaves out the charter root | passes | 6 failed | attenuation-closure 3, structure 3 |
| X6 | `firstDeadLink` returns the link nearest the leaf | passes | 5 failed | attenuation-closure 2, chain 2, structure 1 |
| X7 | `liveAuthorityAbove` does not stop at the dead link | TS6133 | 3 failed | chain 3 |
| X8 | `trailOf` does not check the chain is parent-linked | passes | 6 failed | chain 5, hostile-input 1 |
| X9 | `chainOf` visits one grant more than `MAX_ROOT_DEPTH + 1` | passes | 2 failed | boundaries 1, hostile-input 1 |
| X10 | `chainOf` has no bound (the loop condition is `true`) | passes | 9 failed | boundaries 1, hostile-input 7, structure 1 |
| X11 | the upper bound of `readWholeNumber` is `< max` instead of `<= max` | passes | 6 failed | attenuation-closure 1, boundaries 4, intake 1 |
| X12 | id length bound `< MAX_ID_LENGTH` instead of `<=` | passes | 11 failed | boundaries 11 |
| X13 | an empty id is accepted | passes | 26 failed | boundaries 10, hostile-input 2, intake 14 |
| X14 | `seq` 0 is accepted | passes | 5 failed | boundaries 1, intake 4 |
| X15 | list length bound is `MAX_CHARTER_ENTRIES + 1` | passes | 4 failed | boundaries 3, hostile-input 1 |
| X16 | no list length bound | passes | 6 failed | boundaries 3, hostile-input 3 |
| X17 | a duplicate capability is accepted | passes | 2 failed | intake 2 |
| X18 | an absent `parent` is read as `null` (a root grant) | passes | 1 failed | intake 1 |
| X19 | a throwing read returns `undefined` instead of being reported | TS6133 | 80 failed | hostile-input 80 |
| X20 | the charter object is not frozen | passes | 1 failed | intake 1 |
| X21 | `-0` is not normalised | passes | 1 failed | intake 1 |

**Read these with care.**
- Every sabotage went red, including the six the plan lists for the table. The plan says deleting
  `parent-dead` is caught ONLY by the table test (on its throwaway model, whose whole-system properties did
  not notice). Here it is also caught by `attenuation-closure.test.ts` (4 failed), because that layer asserts
  "no link on the chain was revoked at admission", a clause the plan's list of closure properties does not
  contain. That is a difference in what was built, not a finding about the plan's model.
- X10 and X16 ran to completion and failed on `RangeError: Invalid array length`; they were set up to be
  killed after 60 s and were not. The 16 s and 18 s in Decision 3 are the durations vitest recorded for the two
  `2 ** 32 - 1` tests in the X16 run.
- A deleted intake rule is usually caught by many tests (X13: 26), so the count says how widely a rule is used,
  not how well it is pinned. P1's four, for example, are two table rows and two property tests.
- P7a to P7f, the edits the mutating-getter tests exist for, are caught by `hostile-input.test.ts` (plus one
  `intake.test.ts` test for P7b); the table, property and boundary layers stay green under them.

## What M3 does not claim

- Nothing about amounts, headroom, standings or verdicts. `over-allocation` is M5's from M4's headroom, and the
  five revoke- and commit-side rejections are M5's. The coverage test asserts nothing outside M3's eleven kinds
  was produced.
- That anything but intake is hardened against accessors (Decision 4), or that a `GrantTree` backed by something
  other than a real `Map` is handled (not tested).
- That the generator covers every possible grant tree: the closure property is over what the seeded generator
  produces, in two configurations.
- That `unknown-parent` is the right name for a parent whose ancestry cannot be completed (Decision 6.1), or that
  `principal-cycle` including the charter root is what the plan means (Decision 6.2).
- That `lib/chain` is pure. The architecture test is about imports.
- That `seq` shape errors are what M5 wants (below).

## Plan observations (found by building; the plan is not edited)

1. **The plan lists "a capability outside `charter.capabilities`" among the shape checks (§6 M3 scope) while §4.3
   and §5 make `unknown-capability` a separate rejection that follows the shape check.** Built as §4.3 and §5
   say: a shape problem anywhere outranks an unknown capability.
2. **`CharterRead` has no `hostile` variant**, so a hostile charter is an invalid charter (Decision 1).
3. **`StructureRejection` has no kind for a parent whose ancestry cannot be completed**; built as
   `unknown-parent` (Decision 6.1).
4. **The plan says nothing about `seq`'s shape.** `readLogEvent` refuses `0`, a negative, a fraction, `NaN`, a
   non-number and anything above `Number.MAX_SAFE_INTEGER` as `invalid-event-shape` with `seq` among the fields.
   For M5 that means an event whose `seq` is merely well-formed and in the wrong place is a `seq-mismatch`, but one
   whose `seq` is `0` arrives as `inadmissible-event` carrying `invalid-event-shape`, not as `seq-mismatch`,
   unless M5 reads `seq` itself first. M5 owns that mapping.
5. **`MAX_CHARTER_ENTRIES` is new** (Decision 3).
6. **Plan §10 rejects a `grantee-is-root` rule; plan §6 asks for "no principal repeats on a chain".** The two
   meet at a grant to a charter root: built so that a grant back to the root of its OWN chain is a
   `principal-cycle` and a grant to another root is not (Decision 6.2).
7. **The plan's pool of 5 cannot reach the chain-length bound it also asks the property to assert** (Decision 7).
8. **The plan's M3 file list has no home for the walkers' own tests**: `chain.test.ts` was added beside the six
   it names. It also names no home for the hostile-tree tests; they are in `hostile-input.test.ts`.
9. **Plan §5 says `chainOf` fails "within MAX_ROOT_DEPTH+1 hops".** Built as at most `MAX_ROOT_DEPTH + 1` GRANTS
   visited, which is `lib/contracts/limits.ts`'s statement of the chain length. Counted as hops it would be one
   fewer; the boundary test pins the grants reading.
10. **`liveAuthorityAbove`'s one-line description in the plan admits two readings at the dead link.** Built so the
    grantor of the first dead link IS included (it is the heir). `chain.test.ts` pins that, with G2's grantor `cfo`
    listed for G2 itself after the revocation.
11. **ADR path**: as in M1, the plan's §6 gives M3 `lib/chain/**` only, while §6 also says each milestone ends with
    its ADR; this file is `.genesis/decisions/0003-chain.md`.
12. **Not edited because it is not M3's:** `README.md`, `.genesis/DONE.html` and `.genesis/checkpoints/CURRENT.md`
    still show M3 as not built; they change in a `chore(genesis): mark M3 done` PR after independent verification.
