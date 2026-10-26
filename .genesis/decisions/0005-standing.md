# ADR 0005 — M5 standing: one admission path, a verdict fixed at the act, a standing derived from it, and an heir that is the grantor of the first dead link

- **Date:** 2026-10-25 to 2026-10-26
- **Status:** proposed — written by the builder, not yet verified by an independent L4 pass
- **Phase / milestone:** M5 (BUILD) — `lib/standing/**` (`verdict.ts fold.ts standing.ts append.ts index.ts`, `__tests__/`)

Decisions are in the order of the commits that made them. The falsifiability log and the timings were measured on the tree of
commit `39624cd`; the next commit adds `COVERAGE_TIMEOUT_MS` to `fixtures.ts` and makes the nine coverage tests use it in place of `SEED_LOOP_TIMEOUT_MS` (no source file and no assertion changes), and the ones after change only this ADR. No number below is a count of passing tests: those go stale
whenever a test is added, and the log quotes only "N failed" for a sabotage. The counts in "Coverage" are counts of what a
trace did, not of tests that passed.

## Context

`.genesis/PLAN.md` §5 gives this layer five functions (`fold`, `append`, `mayCommit`, `standings`, `standingOf`) and an internal
`judgeCommit`; §4.2 and §4.3 give the closed standing enum and the admission precedence; §6 (M5) gives what it must refuse and the
test layers it asks for. It composes the three layers below it through their barrels: M3's intake and walkers, M4's headroom,
and M1's `assertStandingWellFormed`. ADRs 0001, 0003 and 0004 describe those layers and are cited, not restated. This is the first
layer in which the whole engine runs, so it is the first place the plan's §7 numbers can be checked against code: all of them
reproduce (`canonical.test.ts`).

## Decision 1 — one admission path: `decide` looks, `apply` writes, and replay, `append` and `mayCommit` all go through `decide`

`fold.ts` splits admission into `decide(charter, ledger, event)`, which says what admitting one already-read event would do or why
it is refused and changes nothing, and `apply(ledger, event, effect, seq)`, which writes that effect. `replay` runs both per
event of a log, in this order: the element is read, M3's `readLogEvent` reads it, its `seq` is compared with its position, then
`decide` and `apply`. `append.ts` calls `replay` on the log it is given, then `admitInput` (one read of the input through
`readEventInput`, one `decide`, one capacity check). `mayCommit` runs the same `admitInput` on `{ kind: "commit", commit }`.
So a grant, a revoke and a commit are judged by one function whether they are being replayed, recorded or only asked about, and
`judgeCommit` has one call site, inside `decide`. Plan D9 says `append` and `mayCommit` "cannot drift"; here they cannot because
there is no second copy to drift, which is a stronger statement than the tests can make, and the sabotage that gives
`mayCommit` its own predicate (P6 below) has to put one there.

- **What is replayed every time.** The log is the only state (plan D3), so each public function reads the charter once through
  `readCharter` and replays the whole log: O(n) per `append`. Measured on the test generator, that replay was 3.1 ms of 3.4 ms
  per seed, which is why the generator has a second engine (Decision 7). Nothing is cached between calls. The tests that would
  notice state kept between calls are `replay.test.ts`'s determinism test (a deep-frozen copy folds the same) and its freshness test; no sabotage that adds
  a cache was run.
- **Fourteen names are exported inside the layer and not from `index.ts`: `Ledger`, `emptyLedger`, `Effect`, `Decision`, `decide`, `apply`, `Replay`, `replay` and `foldedOf` (`fold.ts`), `Prepared` and `admitInput` (`append.ts`), `deriveStanding` and `sealStanding` (`standing.ts`), and `judgeCommit` (`verdict.ts`)**
  (`architecture.test.ts` pins the barrel at the plan's five names). `admitInput` exists so a test generator can extend one ledger
  a step at a time; the public functions never skip the replay.
- **Admission precedence is the plan's §4.3.** Grant: M3's structure rules, then `over-allocation` from M4's shortfall, which names
  the PARENT (the grant that was asked). Revoke: `unknown-grant`, `already-dead`, `revoker-not-authorised`. Commit: `duplicate-id`,
  then it is recorded whatever `judgeCommit` says. `admission-order.test.ts` shows each of the eight rules a child can break
  hiding `over-allocation`, and `revoke-admission.test.ts` shows the revoke order.

## Decision 2 — the verdict is computed against the tree as it stands at the act, and nothing else

`judgeCommit(tree, charges, commit)` takes the tree and the charges and no log. `replay` builds the tree event by event and calls
it with the tree built so far, so a revocation later in the log is not in the tree when an earlier commit is judged. That is the whole
mechanism of prospective revocation (plan D1). The five breaches are checked in the plan's order: `no-such-grant`, `wrong-actor`,
`link-dead`, `capability-not-granted`, `over-limit`. `link-dead` names the dead link nearest the root (M3's `firstDeadLink`) and
its revoke's `seq`, not the grant acted under; `over-limit` takes `requested` and `headroom` from M4's `Shortfall` and does not
compute headroom.

- **A grant whose chain or trail cannot be completed is `no-such-grant`.** Only a hand-built tree can do that; the plan's five breaches
  have no sixth, and fail-closed is the answer M3 gives for the same case (ADR 0003, Decision 5). `verdict-table.test.ts` has a cycle, a
  missing parent and an ancestry one grant past the chain bound, with the bound's N and N+1.
- **What shows the verdict cannot depend on a later event** (`prefix.test.ts`, A to C here and D in the next bullet): at each cut point of each generated log
  every commit a prefix holds is the record the full log holds; `mayCommit` asked against the log just before a commit returns
  the verdict the full log holds; and from one cut point to the next no grant, revocation, charge or commit changes. The cut points are
  every prefix for every tenth seed (150 of the 1 500; the seeds divisible by ten, which are all `deep`-profile seeds with the one-root charter, so no default-profile log and no two-root log has every prefix checked), and for the others the last prefix, every revoke and the event before it, and eight evenly
  spaced ones. **That is a sample, not every prefix of every seed**: a pass over every prefix of all 1 500 seeds, with the worlds built through the
  public `append`, took 16.4 s for the file in one run (host load not recorded, about 5 s of it building the worlds), and the sample keeps each
  chunk to a fraction of a second. The property is not run over an empty domain: judging against the final tree would rule 35 115 commits differently from how they were
  ruled at the time, and for 20 434 of them the difference is a warranted act becoming `link-dead` (counts in "Coverage").
- **D reads the first four rules again from the raw events.** For every commit of every seed (80 361), `prefix.test.ts` finds the grant acted under, its holder and the first
  link of its chain that already had a revoke by reading the events before the commit and none of M3's walkers, and requires `no-such-grant`, `wrong-actor`, `link-dead` (the same link and
  the same `seq`) and `capability-not-granted` to be exactly what that reading says, and a warranted verdict to have none of the four problems. It was added after the ledger showed the plan's
  second sabotage and a `judgeCommit` that sees only the first K links of a chain caught by hand-worked tests alone (the ledger notes below).

## Decision 3 — standing is the verdict at the act plus whether its chain is intact now; `void` is absorbing because it is built from the breach alone

`deriveStanding(tree, record)` builds a `void` from the breach, a `binding` from the warrant when no link of the chain has a recorded
revocation, and an `inherited` otherwise. Nothing else in the log is read for a `void`, so no later event can change it; that is a
consequence of where its data comes from, and `lattice.test.ts` shows it behaviourally (between cut points a `void` is the same value).

- **The heir is the grantor of the first dead link counting from the root**, read from the link (`grantor`), not from the revoke's
  `by` (plan D7; `heir.test.ts` has `dana` and `cfo` revoking G2 give the same standing). It is above the break, and it is not the
  actor, because a principal does not repeat on a chain and every grantor on it is an earlier principal on the trail.
  `chargedTo` is the PARENT of that link (the heir's own grant) or `null` when the link is a root grant, so the heir is a charter root.
  `severed.atSeq` is the revoke's seq. The heir climbs because cutting a link nearer the root makes it the first dead one, and cannot
  fall because a dead grant is refused a second revoke (`already-dead`).
- **Checked against an independent reading, not against M3.** `heir.test.ts` rebuilds the chain and trail from grant events and the first
  revoked link from revoke events, and checks `severed.atSeq > committedAt`, `heir` is the grantor and the trail principal at the break,
  neither the actor nor below it, and every link above it uncut; `chargedTo` null means the heir is a charter root, otherwise
  `chargedTo` is the link above the break, is live, and its grantee is the heir. The monotone climb is checked across cut points.
- **A ladder on the longest chain** (8 grants, `MAX_ROOT_DEPTH + 1`) cuts the links from the leaf up with a commit at every level and checks
  every standing after every cut exactly: the heir of the leaf's commit is `d6, d5, d4, d3, d2, d1, d0, dana`.
- **Every standing leaves through `sealStanding`**, which calls `assertStandingWellFormed` and throws if it says no (plan §5). Two internal
  throws exist: that one, and one in `deriveStanding` for a warranted commit whose cut link is not in the tree, which only a hand-built
  tree can produce. `integrity.test.ts` reaches both.
- **`standingOf` uses the recorded verdict and does not judge again.** Re-judging against the final tree would count the commit's own charge
  against its own headroom and make a valid act `void`; sabotage P1 does exactly that.

## Decision 4 — revoke admission

`unknown-grant` is a grant that is not in the tree or whose chain cannot be completed. `already-dead` is a grant that is dead, which
means the grant OR ANY ANCESTOR has a recorded revocation (plan §4.4): revoking it again would overwrite `revokedAt`, and a grant dead
only through an ancestor has nothing left to cut. `revoker-not-authorised` is `by` not being in M3's `liveAuthorityAbove`: the grantors
on the chain, root first. For a grant that reaches this check (live), that is every grantor on its chain, so the grantee of the grant, a
principal below it and a charter root that is not on its chain are all refused. `revoke-admission.test.ts` tries all 11 principals against
all 8 links of the longest chain (88 attempts) and each is admitted exactly when the revoker granted a link at or above the target.

## Decision 5 — what M5 reads of a caller's log itself, and the consequences of reading `seq` once

M5 reads two things of a caller's log with its own hands: the array's `length` and each element by index. The bound `MAX_LOG_EVENTS` is
applied before any element is read (a Proxy can claim `2 ** 32 - 1` of them; the reason `MAX_CHARTER_ENTRIES` exists in M3), a non-array
or a length that is not a count is `hostile-log-input`, and a read that throws is `hostile-log-input` naming the index. Everything inside an
element goes through `readLogEvent`; the charter through `readCharter`; an input through `readEventInput`; `standingOf`'s `id` is a
`Map` key and is never read. `hostile-input.test.ts` counts every read on a deep Proxy at all five entry points (each key once) and gives
the two reads M5 owns first reads from every value class.

Two consequences of M3 reading `seq` once, inside intake (ADR 0003, plan observation 4), are built as they fall out and pinned:
a `seq` that is not a safe integer of at least 1 is `inadmissible-event` carrying `invalid-event-shape` with `seq` among the fields, not
`seq-mismatch`; and an event that has both an intake problem and a wrong `seq` is reported for the intake problem, because M5 does not read
`seq` a second time to look. `seq-mismatch` is therefore reported only for a well-formed `seq` in the wrong place, and an event with a wrong
`seq` and a bad admission is reported for the `seq`.

## Decision 6 — edges of `append` and `mayCommit`

- **A hostile INPUT has no `Rejection`, so it is reported as `faulty-log` carrying `hostile-log-input`** with the message `input: reading
  <path> threw`, although the log was fine. The plan's `AppendFailure` has only those two members and `FoldFault` is the only closed type
  with a "a read threw" variant.
- **A full log.** The plan does not say what `append` does at `MAX_LOG_EVENTS`. An admitted event that would make the log longer is
  `faulty-log` carrying `log-too-long` with `length` the length the log would have (5 001), and the check is LAST: a bad event on a full log
  is refused for being bad.
- **`mayCommit`'s `ok: true` does not mean the commit is allowed.** It means the log and the commit could be judged; a commit that breaches a
  rule comes back `ok: true` with a `breached` verdict, because `append` would record it as exactly that (plan D4). Where `append` would
  refuse the commit, `mayCommit` answers `ok: false` with the identical failure; `may-commit-equivalence.test.ts` compares them over every
  commit the generator offered.
- **`append` gives back new objects:** the returned `log` is a new array of events read through intake, and nothing in it is the caller's.
- **A commit id and a grant id are different namespaces** (ids are opaque, plan §4.1); `admission-order.test.ts` pins that a commit may
  carry a grant's id and the grant is still there.
- **One branch is unreachable by construction and untested:** `mayCommit` throws an internal error if a commit input is admitted as
  something other than a commit.


## Decision 7 — the generator drives the real engine and decides nothing about admission

`fixtures.ts`'s `runWorld(seed, steps, profile, engine)` builds a log by OFFERING one proposal per step to the engine and keeping what
it admits. Whether a proposal is admitted, its verdict, and what it is rejected for are the engine's answers. What the generator decides is
what to PROPOSE, and it is wrong on purpose a good part of the time (a widened capability, a borrowed grant, a limit one over the headroom,
a revoke by the wrong principal, a re-revoke of a dead grant, a malformed shape, a smuggled `seq`), because a generator that only proposed
valid events could not show a refusal fires. To propose sensibly it keeps a MIRROR (a tree and a list of charges built from the engine's own
answers) and reads it with M3's and M4's published functions, the way `lib/allowance/__tests__/fixtures.ts` does. The mirror steers
and nothing else: `replay.test.ts` checks it equals what `fold` rebuilds.

- **Two engines, one world.** `"incremental"` keeps one ledger and offers each proposal to `admitInput`; `"append"` calls the public `append`
  with the whole log every time. Over 400 seeds they gave byte-identical logs and attempts at 0.3 ms and 3.4 ms per seed, and
  `replay.test.ts` asserts it for all 1 500. Every other file uses the cheap engine; that licence rests on `replay.test.ts`, and a defect in
  `append`'s own replay that `admitInput` does not share would reach the other files only through `replay.test.ts` and the files that call
  `fold` on prefixes.
- **Two profiles.** Every fifth seed is `deep`: a root of depth 7, children under the deepest live grant, few revokes until late. Odd seeds use
  a two-root charter, so a charter root that is not on a chain exists. A chain of 8 grants has 9 principals on its trail (the charter root and the 8 grantees), so a pool of 12 leaves three off it.
- **The comparisons in the generator.** `grep -nE '(<=|>=|===|!==| < | > )'` over the lines of `runWorld`, comment lines removed, gives 46
  lines. Grouped by what they choose: which engine, profile and loop bound (5); whether a lookup found something, a list is empty or a pointer
  is null, which picks where to propose (`=== undefined`, `.size > 0`, `.length > 0`, `!== null`, `!== grantor`, and the liveness question
  answered by M3's `firstDeadLink`: 19); `entry.depth >= 1` and the chain-length tie-break, which steer a proposal to the deepest grant that can
  still delegate (3); which random draw selects which value to propose and which kind of proposal (`roll <` against constants, including the
  step weights: 5); which field of a proposal to break (`inner !== undefined`, `"limit" in inner`: 10); and reading the engine's answer into
  the mirror (`kind ===`, `verdict?.kind === "warranted"`: 4). Two lines do arithmetic on a headroom to build a proposal at N and N + 1
  (`room + 1` for a limit and for an amount); no line compares a proposed `limit` or `amount` with a headroom or a limit. The grep sees `in`,
  `.includes`, `Math.max` and `??` only when they share a line with one of its six tokens: `Math.max(room, 0)` is on a listed line (the amount
  draw) and `trail.includes` (principals already on the chain are left out of the grantee draw) is not. That is the output of one pattern, not a
  proof that nothing else in the file decides.

## Decision 8 — the test files, what each one guards, and the one place the plan's file list was extended

The plan's list is `verdict-table revoke-admission fold-faults lattice heir prefix locality replay may-commit-equivalence integrity
architecture` and `fixtures.ts`. All are here. Four files are added, each because the plan's list has no home for what it holds:

| File | What it guards | Layers it has |
|---|---|---|
| `verdict-table.test.ts` | the five breaches and their precedence | one row per breach (violating and repaired); all 32 combinations of five switches; the longest chain with the dead link at every position and every pair; `judgeCommit` on hand-built hostile trees |
| `revoke-admission.test.ts` | `unknown-grant`, `already-dead`, `revoker-not-authorised`, and exact return | table; what hides what; 8 targets by 11 principals on the longest chain; two properties over 1 500 seeds |
| `admission-order.test.ts` (added) | M3's structure rules and M4's headroom in the plan's order; commit ids | `over-allocation` at N and N+1; each of the eight rules a child can break hiding it; duplicates and namespaces |
| `fold-faults.test.ts` | the five `FoldFault`s | table per fault; what is looked at first; `MAX_LOG_EVENTS` at N and N+1 for `fold`, `append`, `mayCommit`; a corruption property over 1 500 seeds |
| `hostile-input.test.ts` (added) | read once, typed result, at all five entry points | counting Proxies; first reads from every value class; every value class in every position |
| `prefix.test.ts` | a verdict never depends on a later event | A, B, C at cut points; D, the first four rules against an independent reading |
| `lattice.test.ts` | `void` absorbing, the legal moves, `standingOf` agreeing with `standings` | cut points of 1 500 seeds; ladder on the longest chain |
| `heir.test.ts` | the heir, `chargedTo`, `severed`, the climb | ladder on the longest chain; who revoked is irrelevant; invariants and climb over 1 500 seeds against an independent reading |
| `locality.test.ts` | locality as specified; the rejected formulation is false | an eight-event log; 13 081 (seed, b) pairs; the first formulation tried on every grant |
| `replay.test.ts` | determinism; append-built equals incremental equals fold; a caller cannot choose `seq`; fresh maps | 1 500 seeds; every value class as a `seq` |
| `may-commit-equivalence.test.ts` | `mayCommit` gives `append`'s result | every commit the generator offered; the boundary; every whole-log failure |
| `conservation.test.ts` (added) | the §4.4 theorem on the whole system; void commits charge nothing | cut points of 1 500 seeds, with M4's functions and M4's oracle |
| `canonical.test.ts` (added) | plan §7, number for number | the 18 events, the 15 rejections, the standings, the scrub, a later cut of G1 |
| `integrity.test.ts` | `assertStandingWellFormed` is asked and obeyed | mocked to fail; real guard on cast-built values; the builder's two internal throws |
| `architecture.test.ts` | the layer's imports and its barrel | three barrels only; no cycle; five source files; five exports |

**Chunks.** Every property over generated logs runs its 1 500 seeds in fifteen chunks of 100, each chunk its own test, computed lazily
and once per file, so no test carries the whole run and a failure names the seeds. A coverage test at the end of each file sums
what the chunks did and requires floors. The floors sit below what a run reaches (the tables under "Coverage" give the measured numbers and the floor beside them), are deterministic
(a seeded `mulberry32`), and are printed by `ACS_REPORT=1`, which is how those numbers were read.

## Decision 9 — chunks, two named timeouts, and what the timings were measured on

`SEEDS` 1 500, `STEPS` 100, `CHUNKS` 15, `SEED_LOOP_TIMEOUT_MS` 20 000 and `COVERAGE_TIMEOUT_MS` 90 000 are each defined once, in `fixtures.ts`.
The chunk tests (and nothing else) have the 20 s timeout; the coverage test of each file, which reads every chunk, has the 90 s one; every other
test in the layer (the worked examples, the tables, the ladders, `hostile-input`, `canonical`, `integrity`, `architecture`) runs under vitest's 5 s default; the slowest of those
over the timing runs below, loaded ones included, took 153 ms (the first test of `integrity.test.ts`, which pays for the module mock).

**The work is cut where the plan allows and not elsewhere.** 1 500 seeds by 100 events is the plan's number and every property keeps it. What was cut
is the prefix cut points and the `standingOf` comparisons (Decision 2 and the observation on samples). A timeout is a failure threshold, not a guard
against a hang: these tests are synchronous, and a slow one is reported as timed out only after it has finished. Neither number is claimed to protect against
a test that never returns.

**What the first measurement found, and what changed.** With the first 150 seeds as the exhaustive ones, in the first chunk, and ten chunks, the slowest M5 test
was 5.8 s in a full-suite run and 14.3 s in a full-suite run under 20 busy processes (lattice, first chunk), 71% of its 20 s. The exhaustive seeds are now every
tenth and there are fifteen chunks; the same measurement is below.

**Timings measured on 2026-10-25, `vitest run --reporter=json`, tree of `39624cd`, on a 10-core laptop that was never idle: other jobs kept its one-minute
load average between 9 and 28 in the runs below (and at 41 to 60 during the ledger).** "No added load" means no processes of mine beyond the run; it does not
mean a quiet machine. The slowest M5 test of each run, in ms, and as a share of the 20 s chunk timeout where the test has it:

| Run | Slowest M5 test, ms | Host one-minute load average, start to end | Share of 20 s |
|---|---|---|---|
| `replay.test.ts` alone, no added load, 3 runs | 1378, 1469, 589 | 13.55→13.76; 13.50→13.26; 10.62→9.22 | up to 7% |
| `prefix.test.ts` alone, 3 runs | 682, 305, 653 | 13.31→14.97; 13.26→12.28; 9.22→9.04 | up to 3% |
| `lattice.test.ts` alone, 3 runs | 757, 346, 782 | 14.97→14.40; 12.28→11.37; 9.04→12.16 | up to 4% |
| `locality.test.ts` alone, 3 runs | 808, 340, 313 | 14.20→13.55; 11.37→10.62; 12.16→11.43 | up to 4% |
| `conservation`, `fold-faults`, `may-commit-equivalence`, `heir`, `revoke-admission`, once each | 1342, 412, 648, 364, 114 | 14.42→13.50 and others | up to 7% |
| full suite, no added load, 3 runs (wall 22.41, 21.25, 12.58 s) | 4459, 2895, 1271 | 11.43→16.63; 16.63→19.84; 19.84→18.70 | up to 22% |
| full suite, 20 `yes > /dev/null`, 3 runs (wall 51.08, 57.79, 43.72 s) | 5449, 5370, 4715 | 17.60→22.81; 22.81→28.17; 28.17→26.49 | up to 27% |
| `replay.test.ts` alone, 20 `yes`, 3 runs (wall 32.03, 50.83, 50.91 s) | 2407, 6761, 6192 | 26.49→23.08; 20.29→24.88; 24.22→26.44 | up to 34% |
| `prefix.test.ts` alone, 20 `yes`, 3 runs (wall 16.81, 17.33, 15.87 s) | 1227, 1430, 1213 | 23.08→20.29; 24.88→24.22; 26.44→24.93 | up to 7% |
| each file's coverage test run alone (`-t coverage`), no added load, 9 files | 2 219 to 8 404 (replay the largest) | 27 to 41 | 42% of 20 s, which is why it has its own 90 s |

All 20 `yes` processes were killed after the runs and `pgrep -x yes` printed 0, before and after. Every run had 0 failed. In every row the slowest test is a chunk test, and in every full-suite run it is
`replay.test.ts`'s, which builds each world twice (the incremental engine and the public `append`). The same file under load is the largest share: 34%
of 20 s on this host, under the 40% the tests are meant to stay under. The runs under load are a stress test of this host and are not a prediction for GitHub's runner;
the GitHub runner's numbers are in the next paragraph.

**On GitHub's runner.** The pull request's first CI run (run 40288725574, `ubuntu-26.04`, the whole suite: 41 files, 1 254 tests, all passed) took 58.45 s for `vitest run`, against 12.58 s to 22.41 s (wall time, three runs) for the same
suite on the laptop above with no added load, which is 2.6 to 4.6 times as long (the runner's figure is vitest's own Duration and the laptop's is wall time, which also counts start-up, so the ratios are slightly higher than these); the runner's core count was not recorded, and its files ran alongside each other. **The slowest M5 test on the
runner was 2 644 ms** (`replay.test.ts`, the determinism test of seeds 801 to 900), 13% of its 20 s; the next five were 1 991 to 2 305 ms, all of them `replay.test.ts`'s. The runner prints
a test's duration only when it is over 300 ms, so "slowest" is read from those lines (129 M5 tests were listed); a test under 300 ms is not in them. File durations: `replay` 27.1 s,
`lattice` 21.7, `locality` 18.1, `may-commit-equivalence` 16.7, `conservation` 16.4, `prefix` 15.8, `heir` 9.9, `fold-faults` 9.6, `revoke-admission` 4.7, and the other six M5 files each under 130 ms.
Those are wall times of files that shared the runner's CPUs with each other, so they are not what each file costs alone.

## Coverage

What each file's coverage test requires, with what a run reaches beside it. The floors are well below the measurement so that they fail on a generator that stopped
reaching a case and not on noise; the run is a seeded `mulberry32`, so a rerun gives these counts. Counts that are totals over cut points count one commit once for each
cut point that holds it. **Depth**, which M4's floors lacked (no charge landed on a chain longer than five): charges landed on chains of every length 1 to 8 (1 829 at 8,
`conservation.test.ts`); revokes were applied at every chain length 1 to 8 (161 at 8); the heir climbed up to 7 levels (3 times) and 6 levels (33 times); a `link-dead` verdict
named a link at every index 0 to 7 (3 at index 7); and a grant `b` on a chain of 8 was the subject of locality 753 times.

| File | What the traces did | Measured | Floor |
|---|---|---|---|
| `revoke-admission` | decisions: admitted / unknown-grant / already-dead (own revocation) / already-dead (through an ancestor) / revoker-not-authorised | 5 069 / 407 / 409 / 271 / 646 | each of the four refusals 100, admitted 1 000 |
| | revokes applied by chain length 1 to 8 | 850, 1 707, 1 018, 613, 340, 217, 163, 161 | 50 each |
| | exact-return checks (and those with something returned) | 4 219 (2 584) | 800 (400) |
| `fold-faults` | faults: seq-mismatch / hostile-log-input / log-too-long / invalid-charter / inadmissible-event | 4 500 / 1 500 / 1 500 / 1 500 / 35 132 | 500 each |
| | the fifteen rejections inside inadmissible-event, least and most | 407 (unknown-grant) to 5 914 (invalid-event-shape) | 130 each |
| | element reads on a log claiming too many events | 0 | 0 |
| `prefix` | cut points / commit records compared / commits recomputed by `mayCommit` | 30 790 / 827 539 / 36 187 | 10 000 / 280 000 / 12 000 |
| | commits that judging against the final tree would rule differently | 35 115: 20 434 warranted to link-dead, 11 354 warranted to over-limit, 1 576 capability-not-granted to link-dead, 839 over-limit to link-dead, 671 over-limit to over-limit with another headroom, 185 link-dead to link-dead naming another link and seq, 56 over-limit to warranted | 10 000 (6 000 for link-dead) |
| | commits checked by property D | 80 361 | 26 000 |
| | link-dead named at chain index 0 to 7 | 2 968, 242, 117, 72, 23, 21, 21, 3 | 7 each, 1 at index 7 |
| | link-dead on a chain of length 1 to 8 | 1 555, 653, 477, 327, 200, 78, 59, 118 | 19 each |
| `lattice` | consecutive cut-point pairs / standing checks | 29 290 / 827 539 | 9 000 / 280 000 |
| | moves: binding to binding / void to void / binding to inherited / inherited to inherited / inherited climbing | 406 510 / 198 210 / 20 434 / 122 024 / 6 618 | 2 000 each |
| | the five forbidden moves | 0 | 0 |
| | births: binding / void; `standingOf` checks: binding / inherited / void | 6 272 / 2 068; 5 151 / 2 798 / 5 210 | 2 000 / 700; 1 000 each |
| `heir` | inherited standings checked | 142 458 | 50 000 |
| | severed at chain index 0 to 7 | 10 257, 5 797, 2 318, 969, 406, 377, 268, 42 | 100 each, 10 at index 7 |
| | inherited standings by chain length 1 to 8 | 3 645, 5 275, 4 208, 2 852, 1 678, 976, 685, 1 115 | 300 each |
| | chargedTo null / revoker was the heir / revoker above the heir / commits whose heir climbed | 10 257 / 14 507 / 5 927 / 5 356 | 3 000 / 4 000 / 1 500 / 1 700 |
| | climb distance 1 to 7 | 3 863, 903, 339, 183, 32, 33, 3 | 50 each for 1 to 4; the maximum at least 6 |
| `locality` | (seed, b) pairs / with commits kept / with commits deleted / with a deletion under an ancestor of b | 13 081 / 10 571 / 13 059 / 7 421 | 4 000 / 3 500 / 4 000 / 2 400 |
| | verdicts compared, standings compared | 109 819, 109 819 | 36 000 each |
| | b on a chain of length 1 to 8 | 5 631, 1 686, 1 604, 1 319, 970, 698, 420, 753 | 140 each |
| | first formulation: deletions tried / not replaying | 24 539 / 30 (all `over-allocation`) | 8 000 / 10 |
| `replay` | events / attempts (150 000 by construction: 1 500 seeds by 100) / admitted commits / rejected attempts | 117 481 / 150 000 / 80 361 / 32 519 | 40 000 / 150 000 / 26 000 / 10 000 |
| `may-commit-equivalence` | commits compared: warranted / wrong-actor / no-such-grant / capability-not-granted / link-dead / over-limit | 83 848: 58 423 / 8 575 / 3 280 / 4 163 / 3 467 / 2 453 | 28 000: 19 000 / 800 each |
| | refused: duplicate-id / invalid-event-shape / unknown-capability | 1 604 / 1 587 / 296 | 100 each |
| `conservation` | cut points / live grants checked (at headroom 0) / root checks (at the limit) | 30 790 / 333 789 (146 410) / 76 695 (12 994) | 10 000 / 100 000 (40 000) / n.a. (5 000) |
| | charge checks / void commits seen / root sums non-zero | 607 391 / 220 148 / 57 766 | 200 000 / 70 000 / 20 000 |
| | charges by chain length 1 to 8, in the final logs | 19 946, 14 387, 9 675, 6 014, 3 385, 2 017, 1 170, 1 829 | 300 each |

## Falsifiability log

Each row is ONE edit to the shipped source (P1 and P6 add an import to the file they edit), then `tsc -p tsconfig.lib.json --noEmit` (the lib half of `npm run typecheck`) and the
FULL `vitest run --reporter=json` against it, then `git checkout -- <file>` and an empty `git status --porcelain`: 42 edits and one unedited control, every one restored clean.
Measured by a script (kept outside the repository) that applied the edit, ran both commands and parsed the result, on the tree of commit `39624cd`; the commit after it adds `COVERAGE_TIMEOUT_MS` to
`fixtures.ts` and makes the nine coverage tests use it in place of `SEED_LOOP_TIMEOUT_MS` (no source file and no assertion changes), and the commits after that change only this ADR. The control, with no edit, had 0 failed of 1254. Each edit is described here so that it can be repeated by hand. The plan's six
are P1 to P6; the rest are mine. Several tests can go red from one edit; the files are named so the layer that caught it is visible. A "chunk" test counts once per chunk of 100 seeds, so a property
that catches an edit in every chunk shows 15.

**The plan's ledger (§6 M5):**

| # | Edit | Typecheck | `npm test` | Red in |
|---|---|---|---|---|
| P1 | judge against the final tree in standingOf | passes | 18 failed | lattice 16, architecture 1, integrity 1 |
| P2 | judgeCommit checks only the acted-under grant's own revocation | passes | 27 failed | prefix 16, verdict-table 9, canonical 2 |
| P3 | heir = grantee instead of grantor | passes | 24 failed | heir 21, canonical 3 |
| P4 | delete revoker-not-authorised | TS2339 | 30 failed | revoke-admission 26, fold-faults 3, canonical 1 |
| P5 | delete already-dead | TS2339, TS2345 | 101 failed | revoke-admission 37, heir 30, prefix 30, fold-faults 3, canonical 1 |
| P6 | append and mayCommit use different predicates (mayCommit ignores revocations) | passes | 46 failed | may-commit-equivalence 17, prefix 15, verdict-table 11, architecture 1, hostile-input 1, locality 1 |

**Beyond the plan:**

| # | Edit | Typecheck | `npm test` | Red in |
|---|---|---|---|---|
| X1 | standings are built without calling assertStandingWellFormed | TS2339 | 23 failed | integrity 23 |
| X2 | append takes seq from the caller when the input has a numeric one | passes | 250 failed | prefix 61, replay 50, heir 31, revoke-admission 31, conservation 16, locality 16, fold-faults 15, lattice 15, may-commit-equivalence 15 |
| X3 | duplicate commit ids are admitted | TS2339 | 121 failed | prefix 45, lattice 16, conservation 15, locality 15, replay 15, heir 7, fold-faults 3, may-commit-equivalence 3, admission-order 2 |
| X4 | judgeCommit checks link-dead before wrong-actor | passes | 21 failed | prefix 15, verdict-table 4, canonical 2 |
| X5 | over-limit reports the requested amount as the headroom | passes | 9 failed | verdict-table 7, canonical 1, locality 1 |
| X6 | fold judges every commit against the final tree (hindsight in fold) | passes | 132 failed | prefix 48, lattice 19, conservation 15, replay 15, verdict-table 15, canonical 7, heir 7, integrity 3, locality 3 |
| X7 | the severed link is the one nearest the leaf, not the root | passes | 20 failed | heir 18, canonical 1, lattice 1 |
| X8 | chargedTo names the dead link itself, not its parent | passes | 23 failed | heir 21, canonical 2 |
| X9 | a void commit charges its grant | passes | 35 failed | conservation 16, replay 15, admission-order 1, canonical 1, lattice 1, verdict-table 1, locality suite failed to run |
| X10 | a revoke of an unknown grant is reported as already-dead | passes | 23 failed | revoke-admission 19, fold-faults 3, canonical 1 |
| X11 | the grantee may revoke its own grant | passes | 21 failed | revoke-admission 19, fold-faults 2 |
| X12 | log-too-long is off by one (>= instead of >) | passes | 6 failed | fold-faults 5, may-commit-equivalence 1 |
| X13 | seq-mismatch is not checked | TS2339 | 27 failed | fold-faults 26, hostile-input 1 |
| X14 | the log's length is read twice | passes | 16 failed | hostile-input 16 |
| X15 | each log element is read twice | passes | 8 failed | hostile-input 8 |
| X16 | append reads the charter twice | passes | 4 failed | hostile-input 4 |
| X17 | append returns the caller's own event objects in the log it gives back | passes | 4 failed | hostile-input 3, replay 1 |
| X18 | the capacity check on append is removed | passes | 4 failed | fold-faults 3, may-commit-equivalence 1 |
| X19 | over-allocation is checked before the structure rules | passes | 16 failed | admission-order 8, fold-faults 6, canonical 2 |
| X20 | over-allocation is not checked at all | TS2339, TS2345 | 33 failed | conservation 15, admission-order 12, fold-faults 3, locality 2, canonical 1 |
| X21 | wrong-actor compares with the grantor | passes | 108 failed | verdict-table 27, heir 22, prefix 18, canonical 11, may-commit-equivalence 10, locality 5, admission-order 4, integrity 4, lattice 4, conservation 3 |
| X22 | link-dead names the grant acted under, not the dead link | passes | 23 failed | prefix 16, verdict-table 6, canonical 1 |
| X23 | standings come back in reverse order | passes | 22 failed | lattice 16, canonical 4, heir 1, integrity 1 |
| X24 | the heir is the actor's grantor (the link below the break) | passes | 23 failed | heir 20, canonical 3 |
| D2 | the standing's dead-link search sees only the first 2 links of the chain | passes | 21 failed | lattice 17, heir 4 |
| D3 | the standing's dead-link search sees only the first 3 links of the chain | passes | 20 failed | lattice 17, heir 3 |
| D4 | the standing's dead-link search sees only the first 4 links of the chain | passes | 19 failed | lattice 16, heir 3 |
| D5 | the standing's dead-link search sees only the first 5 links of the chain | passes | 18 failed | lattice 15, heir 3 |
| D6 | the standing's dead-link search sees only the first 6 links of the chain | passes | 18 failed | lattice 15, heir 3 |
| D7 | the standing's dead-link search sees only the first 7 links of the chain | passes | 18 failed | lattice 15, heir 3 |
| V2 | judgeCommit's link-dead search sees only the first 2 links of the chain | passes | 19 failed | prefix 15, verdict-table 4 |
| V3 | judgeCommit's link-dead search sees only the first 3 links of the chain | passes | 18 failed | prefix 15, verdict-table 3 |
| V4 | judgeCommit's link-dead search sees only the first 4 links of the chain | passes | 17 failed | prefix 15, verdict-table 2 |
| V5 | judgeCommit's link-dead search sees only the first 5 links of the chain | passes | 17 failed | prefix 15, verdict-table 2 |
| V6 | judgeCommit's link-dead search sees only the first 6 links of the chain | passes | 15 failed | prefix 13, verdict-table 2 |
| V7 | judgeCommit's link-dead search sees only the first 7 links of the chain | passes | 4 failed | prefix 3, verdict-table 1 |

**Read these with care.**

- **The `TS2339` and `TS2345` rows (P4, P5, X1, X3, X13, X20) are narrowing side effects of how the edit was written**, not findings about the property: code after an `if (false && ...)` is
  unreachable, so a variable in it narrows to `never` and `tsc` says so. Every one of those rows is red under `npm test` on its own. The two `architecture` failures in P1 and P6 are the
  edge assertion tripping on the import the edit added.
- **P4, delete `revoker-not-authorised`, is guarded by the table and by more than the table.** In `revoke-admission.test.ts` it is red in the six table rows for that rejection, in five worked
  tests, and in every one of the 15 chunks of the independent-reading property (26 failed in all); also in `fold-faults.test.ts` and `canonical.test.ts`. The plan says no property
  catches it; here one does (observation 1).
- **P5, delete `already-dead`, is caught by the exact-return property in all 15 chunks**, as the plan says, and also by four table rows and three worked tests, by the independent-reading
  property in `revoke-admission.test.ts`, by the heir invariants, and in `prefix.test.ts` by property C and property D: a second revoke overwrites `revokedAt`, so the revoke's `seq` moves.
- **P2 is not caught by the heir invariants** (observation 2). It is caught by the verdict table (9), `canonical.test.ts` (2) and, over the generated logs, by property D in `prefix.test.ts`
  (15 chunks, plus a three-event worked test): before D existed it was caught by hand-worked tests alone.
- **The depth families.** D2 to D7 cut the standing's dead-link search to the first K links of the chain, and are caught by the heir invariants (3 to 4) and the lattice (15 to 17), at every K.
  V2 to V7 cut `judgeCommit`'s link-dead search the same way: V2 to V5 are red in all 15 chunks of D and in the verdict table's hand-worked 8-link chain; V6 in 13 chunks; **V7, a search that misses
  only the leaf, in 3 chunks of 15**: in the unmutated run a `link-dead` verdict that names the leaf occurs 3 times in the 1 500 seeds (the "Coverage" table), and the hand-worked chain is what pins that position.
- **X5, a wrong number inside an over-limit breach, is caught only by worked examples** (verdict table 7, `canonical.test.ts` 1, and the three-event locality case 1). Property D reads only
  which of `no-such-grant`, `wrong-actor`, `link-dead` and `capability-not-granted` a verdict is, and `over-limit` depends on M4's accounting, so no property constrains the numbers inside it.
- **X9, void commits charging their grant,** leaves `locality.test.ts` unable to load at all (its hand-worked log is built when the file is collected, and the engine refuses it), so that file's 20
  tests did not run (1 234 of 1 254 ran). The 35 failed are in other files; the locality file is red as a file and its row says so.
- **V2 was run twice.** In the first pass of this final ledger the row coincided with a clock jump on the host (the script's own timer read 113 399 s for it) and showed one stray failure in
  each of four unrelated files; the row above is a re-run on its own, with the control, on the same tree.
- **A deleted rule is usually caught by many tests** (X2: 250; X21: 108; X6: 132), because every property reads verdicts, charges or seqs. The count says how widely a rule is used, not how well it is
  pinned; the rows with a count under ten (X5, X12, X16, X17, X18, V7) are the narrowly pinned ones.
- **Earlier trees.** An earlier measurement of the same ledger, on the tree before property D and before the chunking changed (10 chunks of 150, first 150 seeds exhaustive), had every row red
  as well; its counts are not quoted because they describe tests that no longer exist.

## What M5 does not claim

- That the properties hold for every log: they hold at the cut points of the logs this seeded generator produces, in the branches the coverage
  tables list, and the worked cases hold on the logs they build. In particular the prefix, lattice, heir and conservation checks are at the cut
  points of Decision 2, not at every prefix of every seed, and `standingOf` is compared with `standings` for a sample of commits, not for all.
- That the verdict cannot depend on a later event for a caller who builds a `Folded` by hand: `judgeCommit` is internal, and what it is given is
  what it judges.
- That `Folded`'s maps cannot be written: they are typed read-only, fresh for every call, and not frozen (`lib/contracts/tree.ts` says a
  `ReadonlyMap` is a type). `replay.test.ts` shows writing through a cast changes only the copy that was written. That `revokedAt` is write-once is
  a consequence of `already-dead`, which `prefix.test.ts` checks (a recorded revocation keeps its seq between cut points), not a property of the map.
- That `lib/standing` is pure. The architecture test is about imports.
- That `assertStandingWellFormed` catches everything (ADR 0001, Decision 10: presence, not relations).
- That `npm run build` exercises this layer: nothing under `app/` imports `lib/standing`, so `next build --webpack` does not compile it. `tsc` and
  `vitest` do.
- That a caller cannot choose `seq` in a log it builds itself: `fold` refuses a log whose `seq` is wrong, and `append` never takes one from its
  input, but nothing stops a caller writing a log with any events whose `seq` happens to be consecutive and whose content is invented (plan failure
  case 05: authorship is asserted).
- That `fold` is fast on every log at the bound. One measurement, on the host described under Decision 9: a log of one grant and 4 999 warranted commits under it folds in about 106 ms
  (its `standings` in about 105 ms, an `append` onto a log of 4 999 in about 100 ms) and one of void commits in about 5 ms, because M4 rebuilds its book of the charges for every headroom
  check. A log whose commits are spread over many grants was not measured.
- Anything about M6's policies, M7's failure cases or M8's page.

## Plan observations (found by building; the plan is not edited)

1. **§6 M5 says `revoker-not-authorised` "has no property that catches its removal ... so this table is its only guard."** Built, the table does
   guard it (row P4: six table rows, five worked tests and all 15 chunks of the independent-reading property in `revoke-admission.test.ts`), and so do other tests: the property in the same
   file that decides every revoke the generator offered by an independent reading of the log, `fold-faults.test.ts` and `canonical.test.ts`.
   The plan's sentence is about the properties on its throwaway model, which had no such reading, and is not contradicted; it is just not
   the whole picture here, and the ledger is what shows it.
2. **§6 M5's second sabotage ("`judgeCommit` checks only the acted-under grant's own revocation") is expected to turn
   `severed.atSeq > committedAt` red. It does not in this build.** M4's `checkHeadroom` refuses a dead grant ("unknown/dead => shortfall with
   headroom 0", §5), so a commit whose dead link is above the grant it acted under still comes out `void`, as `over-limit` with headroom 0,
   and nothing reaches the heir. What catches P2 is the verdict table, `canonical.test.ts` and property D in `prefix.test.ts`, which was added
   for this: before it, P2 and the truncated-search rows V2 to V7 were caught by hand-worked tests alone.
3. **§5's `AppendFailure` has no member for an input whose read throws.** A hostile INPUT is reported as `faulty-log` carrying `hostile-log-input`,
   the only typed place the plan has for "a read threw", although the log was fine (Decision 6).
4. **§5 does not say what `append` does at `MAX_LOG_EVENTS`.** Built as `faulty-log` carrying `log-too-long` with the length the log would have,
   checked last (Decision 6).
5. **A malformed `seq` is `inadmissible-event`, not `seq-mismatch`, and intake outranks `seq`.** This is ADR 0003's plan observation 4 made
   concrete: `seq` is read once, by intake (Decision 5).
6. **§6 case 09 says "only the optional `mayCommit` would have said no."** In the plan's own types `MayCommitResult` is `ok: true` with a verdict for
   a breached commit too; "no" is `verdict.kind === "breached"`, which is how it is built (Decision 6).
7. **§5 says `fold` "mutates local `Map`s that never escape; the returned views are read-only".** The returned views ARE those maps, fresh for every
   call, typed read-only and not frozen. Two sentences ADR 0001 (Decision 6) left for M5, that a `GrantTree` is "built only inside `fold`" and that
   `revokedAt` is "write-once", hold in this sense: `fold` builds a new tree per call, and no key of `revokedAt` is written twice because `already-dead`
   refuses the second revoke; a caller who casts can still write to the copy it holds.
8. **The plan's file list for M5 has no home for four things:** reading hostile input at the entry points (`hostile-input.test.ts`), the §4.4 conservation
   theorem on the whole system (`conservation.test.ts`), §7 replayed through the engine (`canonical.test.ts`), and the composition of M3's structure
   rules with M4's headroom for a grant (`admission-order.test.ts`). Added.
9. **The plan's "≥ 1 500 seeds × 100 events" is met by every property, with three samples:** the prefix cut points (every prefix for 150 seeds, a
   sample of where the tree changes for the other 1 350), the commits `mayCommit` is asked about in `prefix.test.ts`'s B (every commit for the 150
   seeds, the ones cut later and every fifth of the rest), and the commits `standingOf` is compared on (the first of each kind, at the last cut point
   and at a third of the cut points of the 150). Decision 2 says why.
10. **The first formulation of locality is false in the generator too:** 30 of 24 539 deletions of one grant's subtree's commits did not replay, every one an
    `over-allocation` at a later grant. The plan says 2 of 4 000 seeds; this is the same mechanism at a similar rarity (Decision 8, `locality.test.ts`).
11. **§7's numbers reproduce on the real engine,** every one (`canonical.test.ts`).
12. **ADR path:** as in M1, M3 and M4, §6 gives M5 `lib/standing/**` only, while §6 also says each milestone ends with its ADR; this file is
    `.genesis/decisions/0005-standing.md`.
13. **Not edited because it is not M5's:** `README.md`, `.genesis/DONE.html` and `.genesis/checkpoints/CURRENT.md` still show M5 as not built; they change in a
    `chore(genesis): mark M5 done` PR after independent verification.
