# ADR 0007 — M7 failures: eleven cases that each say what the engine does not do or what it does at its edge, and each goes red when the defence they name is removed

- **Date:** 2026-11-09
- **Status:** proposed — written by the builder; not yet approved by an independent L4 pass
- **Phase / milestone:** M7 (BUILD) — `tests/failures/**` (`01-…test.ts` to `11-…test.ts` and `helpers.ts`)

The sabotage ledger and the timings below were measured on the tree of commit `2eba2e7`. The commits after it change this ADR only (`git diff 2eba2e7..HEAD --stat -- tests lib domains app` prints nothing). The rows of the ledger quote "N failed" and the files it was in,
and no count of passing tests, which goes stale whenever a test is added.

## Context

`.genesis/PLAN.md` §6 (M7) and §11 ask for eleven cases, each traced to a design decision and each pinning a real limit; four of them (01, 03, 10, 11) are
PROVES, the others DISCLOSE or are a partial pin. Case 01 is the project's deliberate failure test. M7 owns `tests/failures/**` and nothing else: `git diff origin/main..HEAD --name-only` for this branch lists
`tests/failures/**` and this file. It adds no dependency. M7 tests `lib/*` and `domains/company` through their barrels and edits none of them; the real-source sabotages below
edit `lib/` and were restored with `git checkout` after each (the harness checks `git status` of `lib`, `domains` and `app` after every restore, and it printed nothing). ADRs 0001 to 0006 describe the layers underneath and are cited, not restated.

## Decision 1 — what a failure case is in this repository

Each file opens with a header that states `KIND` (PROVES, DISCLOSES, HONEST PARTIAL PIN, as the plan's table does), `TRACES TO` (the design decision D#) and `WHAT WOULD MAKE THIS FAIL`. The third is not decoration: it is the
edit the sabotage ledger below makes, and a row of the ledger exists for every case.

Two rules came from earlier reviews of this project, and both shape the files:

- **A failure test must fail for the right reason.** For each case there is at least one edit to the shipped source that removes or inverts the defence the case exercises, and the ledger shows the case's own tests going red with the expected
  message (the engine answered with the other kind or the other number). A DISCLOSES case has no defence to remove, so its edit is the "fix": the engine made to do what the case says it does not (a grant that lapses, a second root grant refused). Where a disclosure is only meaningful beside its contrast
  (a forged `actor` passes `wrong-actor`), the contrast is asserted in the same test and has its own edit (M05b).
- **A case asserts a specific result.** Each assertion names the breach, the rejection or the fault kind and its fields (`over-limit { requested 1, headroom 0 }`, `inadmissible-event { index 3, rejection unknown-capability }`), never "throws" or "is not ok".

`helpers.ts` builds events and logs and rules on nothing. It calls `append`, `fold`, `standings` and `standingOf` through `lib/standing/index.js`, against Meridian's charter (`dana` the one root, the four capabilities) so that the cases that
use the plan's §7 incident (02, 06, 11) read the same log `replayScript` writes. `stamped` gives events the seqs 1 to n by hand, without asking the engine to admit them, for the logs a case wants to build itself (07, 10 and the cast-built logs of 05);
`fold` and the entry points rule on those.

## Decision 2 — the eleven cases

Tests are cited by file and title. The control is the edit named in the ledger, and "case N" in a ledger row means the failing tests that sit in that case's own file.

| # | File | KIND | What it asserts (test titles are in the file) | Control rows |
|---|---|---|---|---|
| 01 | `01-compromise-within-mandate-is-invisible.test.ts` | DISCLOSES + PROVES the bound; the deliberate failure test | a compromised and a diligent buyer's five identical commits get standings that are equal once the names are neutral, and a binding standing has exactly four fields (`commitId committedAt kind warrant`); the sixth commit is `void: over-limit { requested 1, headroom 0 }` for 1, 10 000 and `MAX_AMOUNT`; a confederate's delegated 30 000 comes out of the same 50 000; after the revoke the five are `inherited`, heir `cfo`, `chargedTo G1`, and the next act is `void: link-dead`; what was spent is not forgiven (950 000 admitted, 950 001 `over-allocation { headroom 950000 }`) | M01a, M01b, M01c |
| 02 | `02-arrival-is-order.test.ts` | HONEST PARTIAL PIN | on the §7 log `c4` is `binding` at seq 10 and `inherited` (severed `G2@11`, heir `cfo`) after seq 11 with the same warrant; `c5` at seq 12 is `void: link-dead { G2, atSeq 11 }`; the same commit asked one place earlier is warranted; `[commit, revoke]` and `[revoke, commit]` give `inherited` and `void: link-dead { G2, atSeq 3 }`; a commit carrying `initiatedAt` and `seq: 3` is ruled and logged as the one without; exchanging two events' seqs is `seq-mismatch { index 2, expected 3, actual 4 }` | M02, M01c |
| 03 | `03-revoke-and-regrant-cannot-mint-authority.test.ts` | PROVES | limit 100, child 60, spent 50, revoked: re-grant 60 is `over-allocation { G1, requested 60, headroom 50 }`, 50 is admitted; the 50 spent again leaves `over-allocation { 1, 0 }` and 100 held in all; an unspent revoked child returns all of it (100 admitted, 101 `headroom 100`); a grandchild's spend counts under the revoked child, in either revocation order (55 left); 13 cycles of grant 10, spend 7, revoke leave `headroom 100 - 7k` at each step and 91 spent | M03a, M03b |
| 04 | `04-root-reissue-is-unbounded.test.ts` | DISCLOSES | three root grants of 1 000 000 by one root all admitted and 3 000 000 ruled binding; fifty root grants of `MAX_AMOUNT` all admitted; each root grant still `void: over-limit` past its own limit; a spent and revoked root grant leaves the next one its whole limit; a revoked root grant makes its commits `inherited`, heir `dana`, `chargedTo null` | M04 |
| 05 | `05-authorship-is-asserted-not-authenticated.test.ts` | DISCLOSES + PROVES replay re-validates | a revoke claiming `by: ops` is admitted and `by: buyer-a` is `revoker-not-authorised`; a commit claiming the grantee passes and another actor is `void: wrong-actor`; a log of admissible events that never happened folds and equals `append`'s own log; five cast-built logs (widening grant, `over-allocation`, `not-a-root`, `revoker-not-authorised`, `duplicate-id`) are `inadmissible-event { index, rejection }` from each of the five entry points, and the rejection equals what `append` gives for that event alone | M05a, M05b |
| 06 | `06-only-the-first-breach-is-named.test.ts` | DISCLOSES | the §7 `c6` is `wrong-actor`; by the right actor it is `link-dead { G2, atSeq 11 }`; one commit repaired rung by rung names `no-such-grant`, `wrong-actor`, `link-dead`, `capability-not-granted`, `over-limit` and then is warranted; one grant repaired rung by rung names ten rejections in the order of §4.3 (`unknown-capability` to `over-allocation`) and then is admitted; a revoke names `unknown-grant`, `already-dead`, `revoker-not-authorised` | M06a, M06b |
| 07 | `07-grants-never-lapse.test.ts` | DISCLOSES | a hand-built log with 4 000 events that do not touch `G2` folds; `G2` still warrants its whole 100 000 in one commit and over-limit is `{ requested 100001, headroom 100000 }`, as with no events; ten commits of 10 000 in seqs 3 to 12 are warranted and the eleventh `over-limit { 1, 0 }`; a revoke at seq 4003 makes the next commit `link-dead { G2, atSeq 4003 }` | M07a, M07b, M07c |
| 08 | `08-charter-is-part-of-the-logs-meaning.test.ts` | DISCLOSES | the same log under a charter without the root (`not-a-root { dana }` at index 0), without a capability a grant carries (`unknown-capability { hire }` at index 0) and without one only a void commit used (`unknown-capability { refund }` at index 3) is that `inadmissible-event` from each of the five entry points, and `standings` returns only `ok` and `fault`; a `version` and an `id` on the charter change nothing, and a charter that only adds a root and a capability gives equal standings | M08, M05a |
| 09 | `09-admitting-a-void-commit-is-not-refusing-it.test.ts` | DISCLOSES | for each of the five breaches `mayCommit` answers `ok: true` with the breached verdict and the log keeps its length, `append` is `ok: true`, the log is one longer at seq 5 and the standing is `void` with that breach; a grant and a revoke that break a rule are `rejected`; a commit is refused only for `duplicate-id` or `invalid-event-shape`; a void commit charges nothing and a warranted one does | M09a, M09b |
| 10 | `10-hostile-input-fails-closed.test.ts` | PROVES | see Decision 4 | M10a, M10b, M10c |
| 11 | `11-accountability-follows-delegation-not-revocation.test.ts` | PROVES | `G2` revoked by `dana` or by `cfo` gives equal standings (heir `cfo`, `chargedTo G1`, severed `G2@11`); `G4` revoked by `ops`, `cfo` or `dana` gives heir `ops`; cutting `G4`, `G2`, `G1` in turn gives heir `ops`, `cfo`, `dana` at trail places 2, 1, 0; over the six orders of the three cuts, 7 of the 18 cuts are `already-dead` and every inherited standing's heir is on its trail before its actor; cutting `G1` first names `dana` for all four commits and a later cut of `G2` is `already-dead` | M11a, M11b |

## Decision 3 — where the sketch was wrong on contact, and what was done

The plan says its own sketch will be partly wrong and names cases 02 and 09 as the two most exposed (§6 M7, §8 D). No case was replaced. What was found:

- **02.** §11 says "`c4` at seq 10 is `inherited`, `c5` at seq 12 is `void`". On the §7 log `c4` is `binding` at seq 10 (the prefix of ten events) and `inherited` only once the revoke at seq 11 has arrived. The case pins that, with the warrant unchanged between the two, because the plan's sentence taken literally is false.
  It is a partial pin, as the plan says: the engine never sees two things at once, so the case fixes the order and does not show that concurrent submissions would be ordered correctly. "Tests only that the caller behaves" was avoided by asserting outcomes on both sides of the boundary (the same commit asked at seq 11 and at seq 12, and `[commit, revoke]` against `[revoke, commit]`) and by showing that a field the engine does not know (`initiatedAt`, and a `seq` of 3) changes nothing.
- **09.** Kept as the plan words it: the engine's admission behaviour is what is asserted (`append` `ok: true` and one event longer, `mayCommit` the same verdict and writes nothing). No assertion says that any caller consults the pre-check. The consequence side the plan calls "tested elsewhere" is pinned here too (a void commit charges nothing, a warranted one does), because without it a recorded void act could be a log entry that does nothing.
- **06.** §11 suggests `limit: 0` fixtures to expose a masked `Rejection`. A repair ladder does it for every rung without needing one: each rung's event is repaired by one field, and the next rung's reason appears. M5's `admission-order.test.ts` already shows each rule hiding `over-allocation`; the ladder differs in that it shows each masked reason is really there (repairing only the named one admits nothing yet) and that the last rung is then admitted. Its fixtures keep `depth` at 7 or below because `MAX_ROOT_DEPTH` is 7 and a larger depth is `invalid-event-shape`, not the rejection the rung is about.
- **07.** The plan's 4 000 unrelated events are built by hand with `stamped`, not by 4 000 calls to `append`, because `append` replays the whole log on every call (ADR 0005, Decision 1). `fold` rules that the hand-built log is a real one, in the first test of the file.
- **03.** The plan's example (limit 100, child 60, spent 50) is the first test; the cycle test uses 13 cycles of 7, because after 13 the headroom is 9 and a 14th grant of 10 is itself `over-allocation` (the first draft of the test had 14 cycles and its own fixture was refused by the engine).

## Decision 4 — case 10 restates guarantees M3 and M5 own, and says what it adds

§11 lists for case 10 throwing getters, a Proxy log, a mutating accessor read once, `seq` gaps, `MAX_LOG_EVENTS` at N and N+1, `MAX_ID_LENGTH` and `MAX_AMOUNT`. M3 and M5 already test each of these
(`lib/chain/__tests__/hostile-input.test.ts`, `lib/chain/__tests__/boundaries.test.ts`, `lib/standing/__tests__/hostile-input.test.ts`, `lib/standing/__tests__/fold-faults.test.ts`), and the plan also says an M7 case must not restate an M3 to M5 test without new scale or a new layer.
The file therefore says in its header what is new, and the new parts are what it spends its tests on:

1. Damage done to the logs `runQuarter` writes (seeds 1 to 40, 20 ticks), not to the generators' logs: nine kinds of damage, each at a position derived from the seed, and the fault is **predicted from where the damage was done** (`seq-mismatch { index, expected, actual }` from the index) and then compared with what the engine says, for each of the five entry points. That is 40 logs by 5 entry points for each kind of damage.
2. A duplicated commit id, which reads fine and is not admissible, is `inadmissible-event { duplicate-id }` at the later use, at each entry point.
3. Read-once for an `amount` inside a real log element: nine first answers (null, 0, a negative, `MAX_AMOUNT`, `MAX_AMOUNT + 1`, NaN, both infinities, the commit's own valid amount), a different second answer after each, asserting the read count (1 per entry point) and that the outcome equals the plain object's. Three first answers are accepted and six refused, and the test asserts that split so that a table in which every row went one way would fail.
4. A fault is the whole answer (`fold` and `standings` return only `ok` and `fault`), `append` records nothing, the domain's `offer` on a hostile input returns the same array it was given and the next valid offer is admitted at `head + 1`, and the clean log's standings after every damaged call equal the value before them.
5. The bounds, N and N+1, reached through the domain's `offer` for an id, a grantee, a revoke's `by` and an amount, and `MAX_LOG_EVENTS` at every entry point (the log is one grant and commits under a grant that does not exist: void commits charge nothing, so five thousand of them replay cheaply).

This is a restatement at a new layer and with a predicted-fault oracle, not a new guarantee, and it is recorded as such.

## Decision 5 — how long the tests take

`tests/failures` has no explicit timeout anywhere: every test runs under vitest's 5 s default.

The first measurement (three full-suite runs, then one under 20 `yes > /dev/null`, on the tree before the fix below) found one test over the 40% line: the `MAX_LOG_EVENTS` test of case 10 took 1 043 ms, 716 ms and 1 001 ms in the three runs and 4 220 ms (84% of 5 s) under load, because its
log was 5 000 warranted commits and every warranted commit makes each replay cost more than the last. It now uses void commits (a fix of the work, not of a timeout); the test took 17 ms in a single run of `tests/failures` after the change, and it is not among the slowest of any of the runs below. The same measurement had case 07's
authority-ends test at 1 582 ms (32%) under load, which is why that file builds its two logs once at the top.

Measured again on the tree of `2eba2e7`, `vitest run --reporter=json`, the whole suite, on a laptop whose one-minute load average from other jobs was between 20 and 32 throughout (it was not idle). Slowest test of `tests/failures` in each run, and its share of the 5 s default:

| Run | Slowest `tests/failures` test | Slowest test of the whole suite |
|---|---|---|
| full suite, run 1 | 719 ms, `07-grants-never-lapse`, "authority ends only on an explicit revoke" (14%) | 3 385 ms, `replay.test.ts` (M5, 20 s timeout) |
| full suite, run 2 | 1 244 ms, the same test (25%) | 14 822 ms, `attenuation-closure.test.ts` pool of 12 (M3, own 60 s timeout) |
| full suite, run 3 | 323 ms, the same test (6%) | 2 272 ms, the same M3 test |
| full suite under 20 `yes > /dev/null` | 1 264 ms, the same test (25%) | 9 522 ms, the same M3 test |

All four runs passed all their tests; `pgrep -x yes` printed 0 after the kill. The slowest case-10 test in each run was 141, 214 and 34 ms, and 179 ms under load. Nothing in `tests/failures` is above about 25% of its timeout on this host, with or without load; The brief puts CI at about three times a quiet laptop's speed (not measured here); three times the quiet-laptop figure of 323 ms is about 1 s, 19% of 5 s, which is arithmetic and not a CI measurement.

## Falsifiability log

Real source, the whole of `tests/failures` for each row (`vitest run tests/failures`), restored by `git checkout` after each; the harness refuses to continue if `git status` of `lib`, `domains` or `app` shows anything after a restore. The control is the first row. Only "N failed" is quoted, with the cases (the leading
two digits of the file) that failed and how many in each. This ledger runs the failure suite, not the whole repository's, because the question is whether M7 notices the edit; M3 to M6 have their own ledgers.

| | Edit | File | Result |
|---|---|---|---|
| control | none | | 0 failed |
| M01a | `used()`: a grant's own charges are not counted | `lib/allowance/accounting.ts` | 6 failed (cases 01 x3, 04 x1, 07 x1, 09 x1); case 01's own: 3 |
| M01b | `used()`: a revoked child's spend is not counted | `lib/allowance/accounting.ts` | 9 failed (cases 01 x1, 02 x4, 03 x1, 06 x3); case 01's own: 1 |
| M01c | an anomaly rule: buyer-a's commits of exactly 10 000 are void: over-limit | `lib/standing/verdict.ts` | 6 failed (cases 01 x4, 02 x2); case 01's own: 4 |
| M02 | `judgeCommit`: the link-dead check removed | `lib/standing/verdict.ts` | 9 failed (cases 01 x1, 02 x4, 06 x2, 07 x1, 09 x1); case 02's own: 4 |
| M03a | `used()`: a revoked child costs its parent 0 (spent is forgiven) | `lib/allowance/accounting.ts` | 5 failed (cases 01 x1, 03 x4); case 03's own: 4 |
| M03b | `used()`: a revoked child still costs its parent its whole limit (nothing returned) | `lib/allowance/accounting.ts` | 5 failed (cases 03 x5); case 03's own: 5 |
| M04 | `checkGrantStructure`: a second root grant by the same grantor is `not-a-root` | `lib/chain/structure.ts` | 5 failed (cases 04 x4, 10 x1); case 04's own: 4 |
| M05a | `replay`: an inadmissible event is skipped, not a fault | `lib/standing/fold.ts` | 31 failed (cases 05 x25, 08 x5, 10 x1); case 05's own: 25 |
| M05b | `judgeCommit`: the wrong-actor check removed | `lib/standing/verdict.ts` | 4 failed (cases 05 x1, 06 x2, 09 x1); case 05's own: 1 |
| M06a | `judgeCommit`: capability-not-granted checked before link-dead | `lib/standing/verdict.ts` | 1 failed (cases 06 x1); case 06's own: 1 |
| M06b | `checkGrantStructure`: grantor-not-holder checked before parent-dead | `lib/chain/structure.ts` | 1 failed (cases 06 x1); case 06's own: 1 |
| M07a | `judgeCommit`: a grant is dead once 3 000 charges exist (an expiry) | `lib/standing/verdict.ts` | 3 failed (cases 07 x3); case 07's own: 3 |
| M07b | `judgeCommit`: one commit may take at most half a limit | `lib/standing/verdict.ts` | 21 failed (cases 01 x2, 03 x4, 04 x3, 05 x1, 06 x2, 07 x2, 09 x3, 10 x1, 11 x3); case 07's own: 2 |
| M07c | `judgeCommit`: a grant takes at most 5 charges (a rate limit) | `lib/standing/verdict.ts` | 1 failed (cases 07 x1); case 07's own: 1 |
| M08 | `checkGrantStructure`: the not-a-root check removed | `lib/chain/structure.ts` | 18 failed (cases 02 x4, 05 x6, 06 x2, 08 x5, 10 x1); case 08's own: 5 |
| M09a | `append`: a breached commit is rejected (`unknown-grant`) | `lib/standing/append.ts` | 25 failed (cases 01 x4, 02 x6, 03 x1, 04 x1, 05 x1, 06 x1, 07 x1, 09 x7, 10 x3); case 09's own: 7 |
| M09b | `apply`: a void commit charges its grant | `lib/standing/fold.ts` | 1 failed (cases 09 x1); case 09's own: 1 |
| M10a | `read()` in intake: the try/catch removed | `lib/chain/intake.ts` | 3 failed (cases 10 x3); case 10's own: 3 |
| M10b | `replay`: the guarded element read made unguarded | `lib/standing/fold.ts` | 2 failed (cases 10 x2); case 10's own: 2 |
| M10c | `openLog`: the MAX_LOG_EVENTS bound removed | `lib/standing/fold.ts` | 1 failed (cases 10 x1); case 10's own: 1 |
| M11a | `deriveStanding`: heir is the grantee of the first dead link | `lib/standing/standing.ts` | 10 failed (cases 01 x1, 02 x2, 04 x1, 11 x6); case 11's own: 6 |
| M11b | `deriveStanding`: heir is the grantor of the chain's root grant | `lib/standing/standing.ts` | 7 failed (cases 01 x1, 02 x2, 11 x4); case 11's own: 4 |

The control had 0 failed of 141. Each of the 22 edits makes at least one test of its own case fail (the smallest is 1 failed, the largest 31), so no row is a survivor and none needs an equivalence argument. Rows that fail tests of other cases too are listed with their counts: an edit to `judgeCommit` or `used()` is seen by every case that rules on a commit.
M01c is the control for the first test of case 01 (the "same rulings" assertion): an anomaly rule that is written into `judgeCommit` is the only thing that would make that assertion false, and it does. M07b alone does not touch the "ten commits of 10 000" test (each is under half the limit), which is why M07c exists.

## What M7 does not claim

- That the failure suite is a proof. Each case is a handful of fixtures chosen by hand, and case 10's damage is 40 seeds at 9 kinds of damage at one position each.
- That a DISCLOSES case closes its limit. Each states what the engine does not do, so that the README (M9) can list it under Honest limits; nothing here makes the engine do more.
- That the controls in the ledger are the only edits that would turn a case red, or that every test of every case has its own edit. A test that no row of the ledger makes fail is not shown to be able to fail by this ledger.
- That case 02 shows ordering under concurrency. The engine is a function of a log; the case fixes the order of a log and is called a partial pin for that reason.
- That case 10 is new coverage of a guarantee M3 or M5 left open. Decision 4 says what is new.
- That the failure suite shows M1 to M6 correct. No case found a defect in them (every case passed on `main` as it was, `git diff origin/main..HEAD -- lib domains app` is empty); the plan's own sentences that the cases corrected are in Decision 3.

## Plan observations (found by building; the plan is not edited)

- §11 case 02 says "`c4` at seq 10 is `inherited`". It is `binding` at seq 10 and `inherited` from seq 11 (Decision 3).
- §11 case 06 suggests `limit: 0` fixtures for the masked rejection; a repair ladder is used instead (Decision 3).
- §6 M7 says "at least five are sabotaged for real"; the ledger has 22 edits, each against the shipped source.
- `.genesis/checkpoints/CURRENT.md` and `.genesis/DONE.html` are not edited here, as in M1 to M6: the bookkeeping PR that marks the milestone done edits them, after an independent L4 verifier approves.
