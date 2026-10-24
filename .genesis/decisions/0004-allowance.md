# ADR 0004 — M4 allowance: accounting that does not clamp, returns exactly what was unspent, and has no answer for a grant it does not hold

- **Date:** 2026-10-24
- **Status:** proposed — written by the builder, not yet verified by an independent L4 pass
- **Phase / milestone:** M4 (BUILD) — `lib/allowance/**` (`accounting.ts index.ts`, `__tests__/`)

Decisions are in the order of the commits that made them. The falsifiability log near the end was measured on the
tree of commit `842f0b0` and again on `03c85a4`, the commit that added a named timeout to the tests that share one
pass; all 23 rows gave the same typecheck result, failed count and files both times (the first measurement's X19 row is the re-run described in "Read these with care"). The commit after `03c85a4` adds this ADR and changes no code. No number below is a count of
passing tests: those go stale whenever a test is added, and the log quotes only "N failed" for a sabotage. The counts
in "Coverage" are counts of what a trace did, not of tests that passed.

## Context

`.genesis/PLAN.md` §4.4 defines the accounting (`own`, `subtreeOwn`, `chargeToParent`, `used`, `headroom`, liveness)
and states the conservation theorem; §5 gives this layer four functions (`usedOf`, `headroomOf`, `absorbedBy`,
`checkHeadroom`); §6 gives four things it must refuse and asks for a test driver that re-implements no predicate,
properties at every prefix including the exact-return equality, and a four-row sabotage ledger. A proof that the
generator reaches what the properties need is asked for in §6 M3 and listed in §13 as a technique, not in the M4 entry,
so the coverage floors below are this milestone's own addition. M3's ADR (`0003-chain.md`) is where the layer below is described; this one
cites it for what `chainOf` and `firstDeadLink` do and does not restate it.

## Decision 1 — `headroomOf` reports `limit - used` as it is; it never clamps

The theorem's first clause is "for every live `g`, `headroom(g) >= 0`". A function that returned `max(0, limit - used)`
could not make that clause fail, so the property would be vacuous on exactly the defect it exists to catch. A live
grant that has been charged or reserved past its limit (only a hand-built tree, or a defect, can produce one) shows a
negative number, and `checkHeadroom` reports that same number in its shortfall. `accounting.test.ts` pins this as an
HONEST LIMIT test (a hand-built overspent grant gives -30).

What this does and does not show. Sabotage X18 below clamps the number, and only that HONEST LIMIT test fails; the
properties in `conservation.test.ts` and `exact-return.test.ts` stay green, because nothing in a correct trace is ever
negative. So a clamp is pinned by one worked example and not by any property.

## Decision 2 — a revoked child costs its parent what was spent in it; `absorbedBy` is that number

`chargeToParent(c)` is `limit(c)` while `c` is not revoked and `subtreeOwn(c)` once it is (§4.4). So revoking `h`
(whose parent `p` is live) changes `chargeToParent(h)` from `limit(h)` to `subtreeOwn(h)` and nothing else in the
sums, and `headroom(p)` rises by exactly `limit(h) - subtreeOwn(h)`. Two wrong answers sit on either side of it: `0`
(forgive what was spent, sabotage P1) and `limit(h)` (never return the unspent part, sabotage P2).

- "Revoked" in `chargeToParent` means the child ITSELF has a recorded revocation. A child that is dead only because an
  ancestor was revoked still costs its full `limit` until it is revoked too; what the ancestor's revocation releases is
  accounted one level up, in the ancestor's `subtreeOwn`, which includes everything charged anywhere below it.
- "Recorded" is `revokedAt.get(id) !== undefined`, the comparison `firstDeadLink` uses, so the two layers agree for any
  map they are handed. Only WHETHER a revocation is recorded matters, never its `seq`: `accounting.test.ts` records a
  revocation again with a different `seq` and no number changes.
- `absorbedBy(id)` is `subtreeOwn(id)` for a grant that is in the tree and has a recorded revocation of its own, and
  `undefined` otherwise (a live grant, a grant dead only through an ancestor, an unknown id).

## Decision 3 — an id the tree does not hold gets no number, and `checkHeadroom` refuses it

`usedOf`, `headroomOf` and `absorbedBy` return `undefined` for an id that is not in `tree.grants`, and also for one
whose ancestry `chainOf` cannot complete (a cycle, a missing parent, more than `MAX_ROOT_DEPTH + 1` grants: M3's ADR,
Decision 5). Fail closed: such a grant is treated as not in the tree. A recorded revocation or a charge that names an
unknown id does not make it known, and a charge naming one adds to nothing (`accounting.test.ts`).

`checkHeadroom` is `ok` exactly when the grant is live and `requested <= headroom`; one request for the whole headroom
is allowed and one more is not. A grant that is dead, or unknown, is refused whatever the amount, even 0, with a
shortfall that says `headroom: 0`. That is the plan's §5 comment ("unknown/dead => shortfall with headroom 0") read
literally. Plan observation 1 says why the other reading was available.

## Decision 4 — `usedOf` of a dead grant is the formula as written, because the plan defines none

§4.4 defines `chargeToParent` for a child "of a live `g`", and `headroom` of a dead grant as 0, so it never needs `used`
of a dead grant and does not give one. This layer applies the formula unchanged to every grant it finds: own spend plus,
per child, `limit` if the child is not revoked and `subtreeOwn` if it is. Nothing but `usedOf` of a dead grant depends
on the choice: a dead grant's headroom is 0 and the parent's sums use `chargeToParent`, not the child's `used`.
`accounting.test.ts` pins numbers for it (a dead grant `M` with a child of limit 100 has `usedOf` 100; on the four-link line a revoked `B` keeps `usedOf` 50) and
`exact-return.test.ts` pins that no grant's `usedOf`, dead ones included, changes at a revoke except the parent's.

## Decision 5 — typed values are trusted, topology is not, and what is therefore NOT checked

Following M3's Decision 4: `limit`, `amount` and `parent` are read as the typed values they are, because they came
through intake, and re-checking their shape here would be a second copy of intake's rules. The tree's topology is not
trusted: liveness is decided with `chainOf` and `firstDeadLink`.

Three HONEST LIMIT tests in `accounting.test.ts` say what follows, and none is a guarantee:

- A negative `requested` is allowed (`checkHeadroom(.., -1)` is `ok`). Intake refuses a negative `limit` or `amount`;
  this layer does not look.
- A NaN `requested` is refused, because `requested <= headroom` is false for NaN. No plan rule asks for that; it is
  how the comparison is written. Sabotage X15 rewrites the line as `!(requested > headroom)` and only that test fails.
- A live grant overspent by hand shows a negative headroom (Decision 1).

Exactness of the sums beyond `MAX_AMOUNT` is not tested. At the top of the range intake admits, one test shows the
arithmetic exact: a root of limit `MAX_AMOUNT`, a child reserving all of it, `MAX_AMOUNT - 1` spent in the child and the
child revoked gives the root a headroom of exactly 1 and an `absorbedBy` of exactly `MAX_AMOUNT - 1`.

## Decision 6 — how the sums walk the tree

`bookOf` builds, once per call, a map of charges per grant and a map of children per parent, keyed by the MAP KEY and
not by `grant.id` (a hand-built tree need not agree with itself; `lib/chain` also goes by key, and a test with a grant
stored under a key different from its `id` field pins this: sabotage X16). `subtreeOwn` walks with an explicit stack, so a deep
hand-built tree cannot overflow the call stack, and has no visited set. It is only called on a grant `locate` found,
whose parent pointers lead up to a root grant, and a grant below such a grant cannot be its own ancestor, since that
would put a cycle on the found grant's own chain. That is a derivation, not a measurement; `accounting.test.ts` has
a tree with two-cycles and a self-parent beside well-formed grants and the sums for the well-formed ones are
unaffected.

One consequence is pinned and disclosed: a descendant deeper than `MAX_ROOT_DEPTH + 1` grants is unanswerable itself
(`headroomOf` is `undefined`, N and N+1 at the 8th and 9th grant), but a charge on it is still summed into a revoked
ancestor's `absorbedBy`, because the sum goes by the child index and not by `chainOf`.

## Decision 7 — four test files, and what each does and does not show

**`accounting.test.ts`: worked examples.** Plan §7's numbers (headroom 500 000 before the revoke of G2 and 680 000
after, absorbed 220 000, returned 180 000, the two shortfalls `{G2, 200 000, 50 000}` and `{G6, 50 000, 28 000}`, G7's
cure), the four must-refuse items on minimal trees, failure case 03's numbers (limit 100, child 60, 50 spent: 40
before, 50 after, not 100 and not 40), a four-link line revoked leaf first, root first and middle first, hostile trees,
purity (the same tree and charges edited between calls give the new answer; no argument is changed; charge order does
not matter), and `MAX_AMOUNT`. It is where the absolute numbers are pinned; the properties pin relations. Sabotages X15, X16 and X18 are caught only here.

**`conservation.test.ts`: the safety half, at every prefix.** After each step of each seeded trace it checks nine
properties: live headroom >= 0, roots not overspent, a root's `subtreeOwn` non-decreasing, dead headroom exactly 0,
`checkHeadroom` allowing exactly the headroom and refusing one more with the true shortfall (a dead grant refused at 0
and at 1), `absorbedBy` defined exactly for a revoked grant and fixed once it is, unknown ids undefined, each admitted
reservation fitting the parent's headroom, and the oracle's liveness agreeing with `lib/chain`'s. The clause "root
`subtreeOwn` never decreases" is about the raw charges and not about anything the library returns, so the library can
trip it only indirectly (sabotage P3 does: with it applied, 12 of the 1 491 charges in 10 of the 40 traces have a negative amount, because the driver draws inside `[0, headroom]` and the headroom is negative; measured on a scratch copy);
`absorbed` is the library-side counterpart.

**`exact-return.test.ts`: the liveness half, at every revoke.** The equality `headroom(parent) after = before + limit(h)
- subtreeOwn(h)`, with `subtreeOwn(h)` from the raw charges, plus: the amount returned is never negative, `absorbedBy(h)`
equals `subtreeOwn(h)`, `usedOf` changes for no grant but the parent and for it by exactly the amount returned, and no
other live grant's headroom moves. The plan says a revoke "never raises used of any other grant"; what holds, and is
tested, is that it never changes it. It is a separate file so that a sabotage can be shown to trip it and not
`conservation.test.ts` (P2).

**`architecture.test.ts`.** M1's closed-graph and layer-table test already scans `lib/allowance` and passes with it,
unedited: M1's frozen allowlist did not collide, and `git diff main -- . ':!lib/allowance' ':!.genesis/decisions/0004-allowance.md'` was empty after every commit of this branch (the tests here import only `vitest`, `node:fs`, `node:os`, `node:path`
and `typescript/unstable/sync`, all already on it). This file adds, each with a fixture that breaks it: source reaches
`lib/contracts` and `lib/chain` only through their `index.ts` (a type-only import, a re-export, `export *`, a dynamic
import and a `typeof import` of an internal file all count), no cycle among this layer's files, the source files are
exactly the plan's two, and the barrel exports exactly the plan's four functions and no helper. It does not show
the code is pure.

### The driver re-implements no predicate, and how that was checked

`fixtures.ts` builds each trace. Every decision about what enters it is an answer from a published function: a grant
enters only if M3's `checkGrantStructure` and then M4's `checkHeadroom` say `ok` (the order of §4.3, over-allocation
last); a charge's amount is drawn inside `[0, headroomOf(grant)]` and never compared; a revoke is applied unless M3's
`firstDeadLink` finds a dead link on the target's chain, and then written once. Three checks, none of which is a claim
about intent:

1. **Every comparison in the driver was listed and read** (`runWorld`, by `grep` for `<`, `<=`, `>=`, `===`, `!==`).
   They are the loop bound; seeded random draws; `.ok` and `=== undefined` on results of the published functions;
   `options.snapshots === true`; and four filters that choose where to PROPOSE (`headroomOf(..) > 0`, `depth >= 1`, and
   two on a parent pointer that is not `null`). No line compares a `limit` or an `amount` with a headroom or a limit.
2. **Stand-ins change the trace exactly as far as they allow** (`conservation.test.ts`, "the driver re-implements no
   predicate"). With `checkHeadroom` replaced by "always ok", no grant is refused for headroom and grants are admitted
   with `limit` above the parent's headroom; with `checkGrantStructure` replaced by "always ok", none is refused for
   structure and grants are admitted whose `grantor` is not the parent's `grantee`; with `firstDeadLink` replaced by
   "nothing is dead", no revoke is refused and some grant is revoked twice (with the real function none is); with
   `headroomOf` replaced by the constant 7 every charge is in `[0, 7]`, all are recorded and 7 is reached, and by 0
   every charge is 0. A driver with a rule of its own would have refused something the stand-in let through.
3. **A refusal can be re-asked.** Every grant the driver refuses is refused again, with the same answer, by the
   published function in the same state.

What this does not show: that the filters in (1) are the only places the driver could steer the trace toward or away
from a bug, only that none of them is an admission decision.

### The oracle

`fixtures.ts` also holds an oracle for the two definitions the theorem is written in, liveness and `subtreeOwn`, by a
different walk from the library's (passes over the parent pointers until nothing is added; no child index; no use of
`lib/chain`). It does NOT restate `used`, `headroom` or `chargeToParent`: those are what the properties constrain, and
a second copy would share the library's mistakes. The oracle is used in assertions only. Its liveness is checked
against M3's at every grant of every prefix (`oracle-agrees-with-chain`).

### Coverage

`conservation.test.ts` and `exact-return.test.ts` each end with a test that requires a count of what the traces did to
be at least a floor, well under what the run gives. The counts at 40 seeds of 80 steps, measured on `842f0b0` (the floor
is in the tests):

| What the traces did | Count | | What the revokes were | Count |
|---|---|---|---|---|
| revokes applied (root / non-root) | 163 (24 / 139) | | with a live parent | 139 |
| revokes refused as already dead (own revocation / only an ancestor's) | 93 (71 / 22) | | parent is a root / a child | 101 / 38 |
| child grants admitted | 752 | | return something / nothing | 112 / 27 |
| …whose parent is itself a child | 411 | | nothing spent / partly / fully spent | 64 / 58 / 17 |
| …four or more grants deep | 142 | | spend below the revoked grant | 34 |
| …reserving exactly the parent's headroom | 134 | | …and something returned | 28 |
| reservations refused as over-allocation (exactly one over) | 102 (78) | | has descendants | 81 |
| grants refused because the parent is dead | 158 | | an already-revoked descendant | 11 |
| charges (exactly the headroom / below it) | 1 486 (170 / 672) | | …and something returned | 9 |
| live grants checked / at headroom 0 | 27 158 / 9 537 | | | |
| dead grants checked | 12 231 | | | |
| roots checked / at exactly their limit | 9 536 / 1 469 | | | |

Without any sabotage the floors hold at 20 seeds and fail at 10 (the exact-return count of revokes applied is 41
against its floor of 50 at 10 seeds). The generator is a seeded `mulberry32` and one seed replays exactly (a test checks that), so a rerun gives these counts.

## Decision 8 — what the shared pass costs, and why 40 seeds and a named timeout

Each of the two property files runs its seeds once (a memoised pass) and the property tests read it, so the first test
to run carries the whole cost. Both files give every test that reads the pass the same named timeout, 30 s, because a
filtered run (`-t`) may start at any of them.

Measured on 2026-10-24, `--reporter=json`, the slowest test of each file (`conservation.test.ts` / `exact-return.test.ts`):

| Run | Host one-minute load average (10 cores) | conservation / exact-return, ms, three runs |
|---|---|---|
| single file (`vitest run lib/allowance`), no added load | 4.5, then 3.9 after (other jobs) | 161, 160, 172 / 48, 57, 88 |
| full suite, no added load | same set as the row above | 323, 356, 315 / 118, 155, 118 |
| single file, 20 `yes > /dev/null` processes | 3.2 three seconds after starting them, 29.9 after the set | 659, 356, 2 683 / 190, 150, 1 154 |
| full suite, 20 `yes` processes | same set as the row above | 1 684, 2 715, 2 196 / 427, 545, 465 |

The machine was never idle: other jobs were running, and the one-minute load average was between 1.6 and 29.9 at the
moments I read it, so the "no added load" rows are a busy machine and the 20-process rows a very busy one. The tests
of the table ran one set after the other, not in a controlled order. All 20 `yes` processes were
killed after each run (`pgrep -x yes` printed 0). The slowest, 2 715 ms in a full-suite run, is 54% of vitest's 5 s default; the quiet rows times 2.5 (GitHub's runner is
about that much slower than a local idle run) are 8% to 18% of it. That is why the named constant exists: under the heaviest
load measured the default would leave less than a factor of 2.

On GitHub's runner (the CI run for the pushed branch at `e5447fe`, run 40131944360, full suite) the slowest test of
`conservation.test.ts` took 646 ms (the file 1 175 ms) and `exact-return.test.ts` took 253 ms as a file: 13% of the 5 s
default and 2% of the named 30 s, and about twice what the same test took in the quiet local full-suite runs (315 to 356 ms),
a little under the 2.5 used above.

**It could be cut, and was not cut further.** With the coverage-floor tests not counted, every edit in the ledger is still
caught at 20 seeds and at 10 (checked on a scratch export of `842f0b0`; see "Seeds" below), and the floors hold,
unsabotaged, at 20 seeds and fail at 10. 40 was kept so that the floors sit at about a third of what the run reaches
and not at 60%: the rarest branch the exact-return equality needs, a revoke with an already-revoked descendant that also
returns something, was reached 9 times at 40 seeds, and about 4 to 5 would be expected at 20. A timeout is a failure
threshold, not a guard against a hang: these tests are synchronous and a slow one is reported as timed out only after
it has finished.

**Other files' timeouts on this host.** In several full-suite runs a few tests outside `lib/allowance` failed by timeout: M3's
pool-of-5 closure test at its 60 s limit, M1's `proof-harness`, `standing` and `type-proofs` tests at the 5 s default. In
those runs the files' durations were about 300 s each, while the same files took 1.4 to 3.8 s in runs that were not
interrupted; between two of my commands the host's clock moved on by about 2 h 45 min. I did not establish the
cause. They happened in full-suite runs without any sabotage and without the 20 processes too (1, 3, 4 and 1 tests failed
in four such runs), and none of those failures was in `lib/allowance`: in the 12 runs of the table, none was.

## Falsifiability log

Each row is ONE edit to one file, then `tsc -p tsconfig.lib.json --noEmit` (the lib half of `npm run typecheck`) and the
FULL `vitest run --reporter=json` against it, then `git checkout -- <file>` and an empty `git status --porcelain`: 23 runs,
all restored clean. Measured by a script that applied the edit, ran both commands and parsed the result. The script is
not committed; each edit is described here so it can be repeated by hand. Several tests can go red from one edit; the
files are named so the layer that caught it is visible. "Typecheck" says what `npm run typecheck`'s lib half reported:
`TS6133` is an import left unused by the edit, not part of the property.

**The plan's ledger (§6 M4):**

| # | Edit | Typecheck | `npm test` | Red in |
|---|---|---|---|---|
| P1 | revoked child charges 0 (forgive spent) | passes | 19 failed | accounting 14, conservation 2, exact-return 3 |
| P2 | revoked child keeps its full reservation | passes | 18 failed | accounting 16, exact-return 2 |
| P3 | skip the headroom check at reservation (checkHeadroom is ok for any live grant) | passes | 18 failed (1 of them the coverage-floor test) | accounting 9, conservation 8, exact-return 1 |
| P4 | [driver edit] revoking an already-dead grant re-sets revokedAt (the dead-target refusal is removed) | passes | 4 failed (1 of them the coverage-floor test) | conservation 2, exact-return 2 |

**Beyond the plan:**

| # | Edit | Typecheck | `npm test` | Red in |
|---|---|---|---|---|
| X1 | a dead grant reports limit - used instead of 0 | passes | 15 failed | accounting 10, conservation 5 |
| X2 | usedOf of an unknown id is 0 | passes | 5 failed | accounting 4, conservation 1 |
| X3 | headroomOf of an unknown id is 0 | passes | 5 failed | accounting 4, conservation 1 |
| X4 | absorbedBy of an unknown id is 0 | passes | 5 failed | accounting 4, conservation 1 |
| X5 | off by one at the boundary: requested < headroom | passes | 10 failed (1 of them the coverage-floor test) | accounting 7, conservation 3 |
| X6 | off by one the other way: requested <= headroom + 1 | passes | 15 failed (1 of them the coverage-floor test) | accounting 6, conservation 8, exact-return 1 |
| X7 | wrong subtree aggregation: subtreeOwn does not descend past the root's own children | passes | 8 failed | accounting 4, conservation 1, exact-return 3 |
| X8 | a revoked child costs its OWN spend only (descendants' spend dropped) | passes | 11 failed | accounting 6, conservation 2, exact-return 3 |
| X9 | absorbedBy returns what was returned (limit - subtreeOwn) instead of what was absorbed | passes | 11 failed | accounting 10, exact-return 1 |
| X10 | absorbedBy gives a number for a grant with no recorded revocation | passes | 2 failed | accounting 1, conservation 1 |
| X11 | liveness looks only at the grant's own revocation, not its ancestors' | TS6133 | 12 failed | accounting 6, conservation 6 |
| X12 | a dead or unknown grant is allowed a request of 0 (the lenient reading of the plan) | passes | 6 failed | accounting 4, conservation 2 |
| X13 | the shortfall reports the requested amount as the headroom | passes | 9 failed | accounting 7, conservation 2 |
| X14 | used ignores the grant's own charges | passes | 24 failed (1 of them the coverage-floor test) | accounting 18, conservation 5, exact-return 1 |
| X15 | NaN fails open: `requested <= headroom` written as `!(requested > headroom)` | passes | 1 failed | accounting 1 |
| X16 | the child index is keyed by grant.id, not by the map key | passes | 1 failed | accounting 1 |
| X17 | the book is memoised by tree identity (state kept between calls) | passes | 11 failed (1 of them the coverage-floor test) | accounting 5, conservation 2, exact-return 4 |
| X18 | headroomOf clamps a live grant's headroom at 0 | passes | 1 failed | accounting 1 |
| X19 | [driver edit] a charge is drawn from [0, headroom + 1] (the driver overshoots by one) | passes | 7 failed | conservation 6, exact-return 1 |

**Read these with care.**

- **P4 and X19 edit `fixtures.ts`, not a library file.** `lib/allowance` has no revoke operation: it reads whether a
  revocation is recorded and nothing else (Decision 2). The plan's fourth sabotage, "revoking an already-dead grant
  re-sets `revokedAt`", can therefore only be applied to the thing that records revocations in these tests, the driver.
  P4 removes the driver's refusal of a dead target (`if (dead)` becomes `if (dead && seq < 0)`), so a revoke of a grant
  that is already revoked is written again; `exact-return.test.ts` fails on the equality, because the parent's headroom
  does not rise a second time. The real counterpart is M5's `already-dead` rejection, which M5's ledger carries. X19
  makes the driver draw a charge of up to `headroom + 1`.
- **P2 is caught by the exact-return property and by no safety property, as the plan says, but not "only" by it.**
  `conservation.test.ts`, the safety properties, has 0 failed; `exact-return.test.ts` has 2 failed (the equality and
  `usedOf` moving only at the parent); `accounting.test.ts`, the worked examples with absolute numbers, has 16 failed.
  The plan's sentence is about properties.
- **P1 trips "root over-spent"** (`every root grant has subtreeOwn <= its limit`) in `conservation.test.ts`, as the plan
  says, together with the `absorbed` property and three tests in `exact-return.test.ts`.
- **P3's "negative headroom"** is `every live grant has headroom >= 0` in `conservation.test.ts`.
- **Coverage-floor failures** are counted in the totals where a row has one, because an edit that shifts the trace can
  stop it reaching a floor; P4 is the case where that is the point (no refusal of a dead target, so the "refused as
  already dead" floor is missed). Each such row also fails a property or a worked example.
- **X15, X16 and X18 are caught only by `accounting.test.ts`.** The NaN comparison, a child index keyed by `grant.id`,
  and a clamp: no property sees them. X16 was first NOT caught by anything; the test with a grant stored under a key
  different from its `id` field then charged and revoked nothing, so it could not tell the two keyings apart. It now
  does both (Decision 6).
- **X12 is the lenient reading** of "unknown/dead => shortfall" (a request of 0 is allowed for a dead or unknown
  grant): caught, in `accounting.test.ts` and by the dead-grant boundary property.
- **Seeds.** The two tables above were run at 40 seeds. On a scratch export of `842f0b0`, with the coverage-floor tests not
  counted, every one of the 23 edits still failed at least one test at 20 seeds and at 10 seeds. At 10 seeds some edits
  stop failing in `conservation.test.ts` and are caught in another file (X7: only in `accounting.test.ts` and
  `exact-return.test.ts`).
- **Outside `lib/allowance`.** In two earlier runs of the X19 row, tests in M1 and M3 timed out (the host stalls described
  in Decision 8); the row in the table is a run in which every failed test is in `lib/allowance`.

## What M4 does not claim

- That a negative, fractional or non-finite amount is refused (Decision 5), or that the sums are exact beyond
  `MAX_AMOUNT`.
- That `lib/allowance` is pure. The architecture test is about imports; purity is exercised by calling with edited
  arguments (`accounting.test.ts`), not proved.
- That the four properties of a trace hold for every tree: they hold at every prefix of the traces this seeded driver
  builds, in the branches the coverage table lists, and the worked examples hold on the trees they name.
- That the seeded traces reach deep lines. In the 40 seeds the longest line that carries a charge above 0 has five
  grants (the chain limit is eight), and the deepest spend below a revoked grant is three levels below it, once. The
  eight-link line in `accounting.test.ts` is what pins the sums at the depths the traces do not reach.
- That the theorem's clause "`subtreeOwn` never decreases" is checked on the library: it is checked on the raw charges
  for root grants (Decision 7).
- Anything about `standing`, verdicts or the heir: that is M5's. `over-allocation` and `over-limit` are M5's, from this
  layer's `Shortfall`; whether M5 runs `checkGrantStructure` before `checkHeadroom` (§4.3's order) is M5's to do and
  to test.
- That the driver's filters (Decision 7) cannot steer a trace away from some bug.

## Plan observations (found by building; the plan is not edited)

1. **§5's comment on `checkHeadroom` ("unknown/dead => shortfall with headroom 0") and §6 M3's note that the `parent-dead`
   fixture uses `limit: 0` so `over-allocation` cannot mask it point different ways for a request of 0 against a dead
   grant.** Built literally: refused, with headroom 0 (Decision 3). M5 gets the plan's order from §4.3 (structure rules,
   `parent-dead` among them, before `over-allocation`), so the choice changes no reachable outcome there, only what this
   function says when asked directly.
2. **§4.4 defines `chargeToParent` only for a child of a live grant, so it defines no `used` of a dead grant** (Decision 4).
3. **§6 M4's fourth sabotage has no counterpart in `lib/allowance`.** The layer has no revoke operation (Decision 2); the
   edit is to the test driver, and the library-side rule it stands for is M5's `already-dead`.
4. **§6 M4 says only the exact-return property catches "keeps its full reservation".** True of the properties; the worked
   examples also catch it (P2 above).
5. **The theorem says a revoke "never raises used of any other grant".** It never changes it; the test asserts equality.
6. **"`subtreeOwn` never decreases" cannot be checked through the four functions**, which expose `subtreeOwn` only for a
   revoked grant (`absorbedBy`); it is checked for root grants on the raw charges.
7. **The test driver needs a liveness decision to refuse a revoke of a dead grant, and §6 M4 names none.** It takes it from
   M3's `firstDeadLink` (with `chainOf`), the function the plan assigns to the layer below, and does not compute it.
8. **M4's tests import `lib/chain`'s test fixtures** (plan §7's grants, `mulberry32`), which are frozen with M3. M1's
   scan allows a test file to import a file of a lower layer; no library source does.
9. **ADR path**: as in M1 and M3, §6 gives M4 `lib/allowance/**` only, while §6 also says each milestone ends with its ADR;
   this file is `.genesis/decisions/0004-allowance.md`.
10. **Not edited because it is not M4's:** `README.md`, `.genesis/DONE.html` and `.genesis/checkpoints/CURRENT.md` still show
    M4 as not built; they change in a `chore(genesis): mark M4 done` PR after independent verification.
