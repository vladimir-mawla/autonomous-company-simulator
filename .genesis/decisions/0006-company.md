# ADR 0006 — M6 company: a domain that proposes and never rules, a script of what was offered and never of what was answered, and a demo whose exit code means something

- **Date:** 2026-11-06 to 2026-11-09
- **Status:** proposed — written by the builder; not yet approved by an independent L4 pass
- **Phase / milestone:** M6 (BUILD) — `domains/company/**` (`org.ts view.ts policies.ts script.ts simulate.ts index.ts`, `__tests__/`) and `scripts/demo-company.ts`

The falsifiability log and the timings below were measured on the tree of commit `86f3153`, the last commit of `domains/company` before this ADR was
added (`git diff 86f3153..HEAD --stat` lists this file and nothing under `domains/` or `scripts/`). The rows of the log quote "N failed" and no count of
passing tests, which goes stale whenever a test is added. The counts under "Coverage" are counts of what a trace did.

## Context

`.genesis/PLAN.md` §6 (M6) asks for the org (one human root `dana`, six agents, four capabilities as a closed vocabulary), `CANON_SCRIPT` (plan §7's
incident as the events offered), five autonomous policies of `(OrgView, rng) -> EventInput | null`, `runQuarter(seed, ticks)`, and a demo that exits
non-zero unless every kind of `Standing`, `Breach` and `Rejection` was observed and an independent oracle holds. It must refuse to contribute any
authority rule. ADRs 0001 to 0005 describe the layers underneath it (`lib/contracts`, `lib/chain`, `lib/allowance`, `lib/standing`) and are cited, not
restated. `domains/company` imports `lib/*` only through their barrels.

## Decision 1 — the domain contributes no authority rule, and a scan reads the syntax tree to say so

Plan §6 M6 names the precedent: agent-control-tower ADR 0006, Decision 4c, a load-bearing rule placed in `domains/`, protected only by unit tests and
outside every scan of `lib/`. So `domains/company` decides nothing: whether a grant is admitted, whether a commit binds, who answers for it are
answered by `append`, `mayCommit` and the walkers, and the domain only calls them.

`__tests__/source-scan.test.ts` (with `__tests__/support/source-scan.ts`) is the mechanical form of that. It parses every source file of the domain
(`typescript/unstable/ast`) and reports these: a string literal equal to a kind of `Standing`, `Breach`, `Rejection` or `FoldFault`
(the kind lists are read from `lib/contracts` by the scan, not typed into it, so a kind added there is refused here); arithmetic on `limit`, `amount`
or `headroom`; an import that is not another layer's barrel; and a symlink, a file that is not `.ts` and a file that does not parse. The tests that give it teeth: a synthetic tree with one planted violation per rule and
controls beside it (allowed imports, money only passed along or compared for equality), and one violating line planted in each of six real source
files, each reported on its own line. The scan reads `domains/company` and does not read `__tests__`.

A misspelt capability must not compile: `CompanyCapability` is derived from the runtime list `CAPABILITIES`, so the type and the list cannot disagree, and
`__tests__/proofs/capability.proofs.ts` holds `@ts-expect-error` directives which `proofs.test.ts` checks against the diagnostics the compiler really gives
(an unused directive is itself an error). At run time the same vocabulary is the charter's, and M3's intake refuses a capability that is not in it
(`org.test.ts`: the grant naming a capability outside the charter, and the same grant with a valid one).

## Decision 2 — the view is read off the engine, and carries no headroom

`makeOrgView(log, tick)` returns, for each grant the log admitted, `live` (from `chainOf` then `firstDeadLink`), `trail` (from `trailOf`) and `links`,
plus `mayCommit` (the engine's pre-check, bound to the log) and `dryRun` (`append` called against the log, its answer kept and its log thrown away).
It carries no headroom on purpose: a policy that could see one would be tempted to compute with it, and that computation would be a second copy of
M4's accounting. A policy that wants a grant the engine will admit asks `dryRun`; one that wants a commit that binds asks `mayCommit`; one that asks
nothing is ruled on afterwards (plan D4: acts are facts). The view is a function of `(log, tick)`, so `runQuarter` reuses one while the log has not
changed; a log that cannot be replayed comes back as `{ ok: false, fault }`, not a throw.

`DelegatorPolicy` first drew a size and guessed; a size the engine refused cost it an attempt, so it now asks `dryRun` for the largest of its price
list the engine would admit (commit `7c4323c`). The quarter test pins the consequence: over 200 seeds `DelegatorPolicy` was refused 0 times.

## Decision 3 — the script is what was offered, never what was answered

`CANON_SCRIPT` holds 33 steps, each a key, a line of narration and the event: plan §7's 18 admitted events and its 15 refused attempts, at the places §7
puts them. It holds no seq, no verdict and no rejection, because a table of answers in `domains/` would be a second copy of the engine's rulings. The
table of answers lives in two places that each check it against the engine: `__tests__/canon-replay.test.ts` and `scripts/demo-company.ts`. Every step is
frozen all the way down, because every replay and every quarter hands the engine the same objects and an attempt holds the one it was given.

Every quarter opens with the whole script at tick 0 (`INCIDENT_TICK`). §7's numbers are absolute (the revoke is at seq 11 and `link-dead` names
`atSeq 11`), so a log that began with anything else would put every one of them elsewhere. The policies then run on the company the incident leaves:
G1, G3, G6 and G7 live, G2 and everything beneath it cut.

## Decision 4 — policies propose, in a fixed order, from price lists

The five policies draw from one `mulberry32(seed)` in the fixed order of `POLICIES`; the order and the number of draws each makes are part of what a
seed means, and the tests pin both (a mutant that reorders two policies is in the log below). Amounts are fixed price lists (`ORDER_AMOUNTS`,
`REFUND_AMOUNTS`, `DRAIN_AMOUNTS`, `DELEGATION_LIMITS`, `ROOT_LIMITS`), never a share of a limit; the lists and the chances are pinned literally in
`policies.test.ts`. No LLM, no network, no clock: plan D10 says an LLM-backed agent would replace `policies.ts` and nothing in the engine would change.

- `BuyerPolicy` asks `mayCommit` and commits only what binds, so its commits were ruled `warranted` every time over the 200 seeds.
- `RefunderPolicy` acts on its last mandate without asking whether it still holds: its acts after the revoke come back `void` (plan §7, c5 and c8).
- `OverreachPolicy` acts outside its mandate in one of eighteen ways (`OVERREACHES`): the way the engine's refusals fire from inside a running company.
- `CompromisedPolicy` (`buyer-a`, from `COMPROMISE_TICK` 3) spends without looking (plan §11 case 01: the engine cannot tell compromise from diligence).
- `DelegatorPolicy` hands down a part of what it holds, and from time to time revokes a mandate.

`OverreachPolicy`'s refusals are the only refusals of any policy over the 200 seeds (a test pins that), and the policies reached 14 of the 15 kinds of
`Rejection`: the fifteenth, `unknown-capability`, only the script reaches, because a typed policy cannot name a capability that is not in the type.

## Decision 5 — every call is recorded, and `offer` hands an outsider's object to the engine as it is

An `Attempt` holds the event offered and the engine's answer: `admitted` (with its verdict, if a commit), or the engine's own `Rejection` or `FoldFault`.
`outcomeOf` maps `AppendResult` to `AttemptOutcome` with no cast (a test reads the function's syntax and finds none). The log holds what was admitted;
the attempts hold everything.

`offer` does not read its input first and does not copy it; M3's intake inside `append` reads it once (ADR 0003, ADR 0005 Decision 5). `hostile-input.test.ts`
shows this path reaches that intake and takes nothing away from it: a Proxy whose every read throws and a throwing getter come back as `faulty-log` with
`hostile-log-input`, and for a getter of a grant's `limit` and of a commit's `amount`, a first answer from each value class (null, 0, negative,
`MAX_AMOUNT`, `MAX_AMOUNT + 1`, NaN, either infinity, a valid number) followed by a different second answer: the getter is read once, and the outcome
equals what a plain object holding the first answer gets. The grant table admits 3 of the 9 first answers and refuses 6, and the test asserts that
split, so a table in which every first answer went the same way would fail.

## Decision 6 — the demo's exit code

`npm run demo:company` offers the 33 steps and prints, per step, the attempt, the engine's typed result and what plan §7 says; the first step that
differs throws and the exit code is 1. At the revoke it prints the standings before and after with `absorbed` and `returned`. It then prints the final
standings, the scrub back to seq 10, the kinds observed (Standing 3/3, Breach 5/5, Rejection 15/15, and it exits 1 otherwise), and an oracle: per root grant,
the sum of the amounts ruled `binding` or `inherited`, computed from the raw log and the standings and importing nothing from `lib/allowance`, against
the root's limit, at every prefix. `demo.test.ts` checks that the oracle's functions mention nothing the script imports as a value (a copy of the script
whose oracle calls `headroomOf` is caught). It then runs an autonomous quarter (seed 1, 60 ticks), checks the engine's answers to the script's 33 attempts again, and the
oracle at every prefix of the quarter's log.

`demo.test.ts` runs the real demo on the real tree for the output checks and, for the exit-code checks, on a copy of the tree with one change at a time (the
two sabotages plan §6 M6 names, the heir as the grantee, a standing wrong only at seq 18, a quarter whose view cannot be folded, a kind that never occurs,
a script and a demo that disagree about which steps exist, an engine that lets enormous commits bind), each beside a control copy with no change that exits 0.

## Decision 7 — how long the tests take, and what was done about it

The 200 seeds run in 50 chunks of 4 seeds (they began as 10: the slowest chunk took 4.25 s of the 5 s default in a full run under 20 busy `yes`
processes, so the chunks were cut, which is a fix of the work and not of the timeout). Two tests carry an explicit timeout and a stated reason: a chunk of
seeds (20 s) and the quarter of `MAX_TICKS` ticks (20 s); the test that adds up all 200 seeds has 90 s for the case where it is run alone with `-t`.

## Coverage

Seeds 1 to 200, 60 ticks each, counted with a scratch script that repeats the test's own definitions (the test asserts them as lower bounds):

| What | Reached |
|---|---|
| admitted events over the 200 quarters | 23 259 |
| refusals of the script (15 in each quarter) | 3 000 |
| refusals of the policies, by kind | 14 kinds, 4 614 in all, each of the 14 between 284 and 385 |
| revokes by the policies | 959; in 87 quarters at least one was by `dana` |
| deepest chain | 6 links (the most six agents allow), in 9 quarters; 4 links or more in 197 |
| heir climbs (a commit inherited under one heir and, after a later revoke, under another) | 608, of which 562 climbed to a charter root |
| quarters in which a policy re-issued a root grant | 85 |

A hand-worked case at the maximum: `view.test.ts` builds the six-link chain `dana > cfo > ops > support > buyer-a > buyer-b > refunder` by hand, checks
`links` 1 to 6 and `trail` for each grant, and cuts it at the third link to check that the third to the sixth are dead.

## Timing

Per-test durations from vitest's JSON reporter, on a host whose load average was 15 to 31 from other jobs while these ran (the host was not idle):

| Run | Slowest `domains/company` test | Slowest test of the whole suite |
|---|---|---|
| full suite, run 1 | 776 ms (`quarter.test.ts`, seeds 157 to 160) | 2 679 ms (`lib/chain` attenuation-closure) |
| full suite, run 2 | 745 ms (same) | 2 969 ms (same) |
| full suite, run 3 | 661 ms (same) | 2 645 ms (same) |
| full suite under 20 `yes > /dev/null` | 1 853 ms (`simulate.test.ts`, the quarter of `MAX_TICKS` ticks) | 9 574 ms (`lib/chain` attenuation-closure) |

The slowest M6 test under load took 1 853 ms of the 5 000 ms default: below 40%. The same run shows one M3 test (`lib/chain`, not changed here) at 9 574 ms; that
is M3's and is reported, not touched.

## Falsifiability log

Real source, the full suite for each row, restored by `git checkout` after each (the harness checks that the tree is clean after every restore). The
control (no edit) is the first row. Only "N failed" is quoted, with the files that failed.

| | Edit | File | Result |
|---|---|---|---|
| control | none | | 0 failed of 1511 |
| O1 | CAPABILITIES loses "hire" | `domains/company/org.ts` | 40 failed (canon-replay.test.ts, demo.test.ts, hostile-input.test.ts, org.test.ts, policies.test.ts, proofs.test.ts, script.test.ts, simulate.test.ts, view.test.ts) |
| O2 | ROOT is "dane", not "dana" | `domains/company/org.ts` | 23 failed (canon-replay.test.ts, demo.test.ts, org.test.ts, policies.test.ts, quarter.test.ts, script.test.ts, simulate.test.ts, view.test.ts) |
| O3 | AGENTS loses refunder | `domains/company/org.ts` | 5 failed (org.test.ts, policies.test.ts, quarter.test.ts, script.test.ts, simulate.test.ts) |
| O4 | CHARTER.roots gains cfo | `domains/company/org.ts` | 4 failed (hostile-input.test.ts, org.test.ts, policies.test.ts, simulate.test.ts) |
| V1 | view: every grant is live (the firstDeadLink test is dropped) | `domains/company/view.ts` | 22 failed (policies.test.ts, proofs.test.ts, quarter.test.ts, simulate.test.ts, view.test.ts) |
| V2 | view: links is chain length + 1 | `domains/company/view.ts` | 4 failed (quarter.test.ts, view.test.ts) |
| V3 | view: dryRun against an empty log | `domains/company/view.ts` | 7 failed (policies.test.ts, quarter.test.ts, simulate.test.ts, view.test.ts) |
| V4 | view: head + 1 | `domains/company/view.ts` | 5 failed (policies.test.ts, simulate.test.ts, view.test.ts) |
| V5 | view: mayCommit against an empty log | `domains/company/view.ts` | 6 failed (policies.test.ts, quarter.test.ts, simulate.test.ts, view.test.ts) |
| V6 | view: trail is always empty | `domains/company/view.ts` | 8 failed (policies.test.ts, proofs.test.ts, quarter.test.ts, simulate.test.ts, view.test.ts) |
| V7 | view: a fold fault is not returned as ok:false | `domains/company/view.ts` | 4 failed (demo.test.ts, proofs.test.ts, view.test.ts) |
| S1 | INCIDENT_TICK 0 -> 1 | `domains/company/simulate.ts` | 11 failed (canon-replay.test.ts, demo.test.ts, simulate.test.ts) |
| S2 | MAX_TICKS 200 -> 201 | `domains/company/simulate.ts` | 1 failed (simulate.test.ts) |
| S3 | ticks > MAX_TICKS -> ticks >= MAX_TICKS | `domains/company/simulate.ts` | 1 failed (simulate.test.ts) |
| S4 | runQuarter no longer checks ticks is an integer | `domains/company/simulate.ts` | 1 failed (simulate.test.ts) |
| S5 | runQuarter no longer checks ticks >= 0 | `domains/company/simulate.ts` | 1 failed (simulate.test.ts) |
| S6 | mulberry32 constant 0x6d2b79f5 -> ...f4 | `domains/company/simulate.ts` | 3 failed (demo.test.ts, simulate.test.ts) |
| S7 | offer never advances the log | `domains/company/simulate.ts` | 119 failed (canon-replay.test.ts, demo.test.ts, hostile-input.test.ts, quarter.test.ts, simulate.test.ts) |
| S8 | outcomeOf drops the verdict (null) | `domains/company/simulate.ts` | 20 failed (canon-replay.test.ts, demo.test.ts, quarter.test.ts, simulate.test.ts) |
| S9 | runQuarter reuses a stale view (view.log !== log dropped) | `domains/company/simulate.ts` | 4 failed (quarter.test.ts, simulate.test.ts) |
| S10 | runQuarter seeds its generator with seed + 1 | `domains/company/simulate.ts` | 1 failed (simulate.test.ts) |
| S11 | the script is offered at every tick from 0 on (=== -> >=) | `domains/company/simulate.ts` | 4 failed (quarter.test.ts, simulate.test.ts) |
| S12 | attempt numbers start at 0 (n: attempts.length) | `domains/company/simulate.ts` | 2 failed (simulate.test.ts) |
| S13 | runQuarter runs ticks + 1 ticks (< -> <=) | `domains/company/simulate.ts` | 4 failed (simulate.test.ts) |
| S14 | mulberry32 divides by 2^32 - 1 | `domains/company/simulate.ts` | 1 failed (simulate.test.ts) |
| P1 | COMPROMISE_TICK 3 -> 0 | `domains/company/policies.ts` | 3 failed (policies.test.ts, simulate.test.ts) |
| P2 | BuyerPolicy commits whatever mayCommit admits, not only what it warrants | `domains/company/policies.ts` | 3 failed (policies.test.ts, quarter.test.ts, simulate.test.ts) |
| P3 | RefunderPolicy asks whether its mandate is live | `domains/company/policies.ts` | 3 failed (policies.test.ts, quarter.test.ts, simulate.test.ts) |
| P4 | DelegatorPolicy no longer asks the engine (dryRun) before proposing | `domains/company/policies.ts` | 4 failed (policies.test.ts, quarter.test.ts, simulate.test.ts) |
| P5 | DelegatorPolicy may pick a grantee already above the parent | `domains/company/policies.ts` | 3 failed (policies.test.ts, quarter.test.ts, simulate.test.ts) |
| P6 | DelegatorPolicy's review revokes by the grantee, not the grantor | `domains/company/policies.ts` | 8 failed (policies.test.ts, quarter.test.ts, simulate.test.ts) |
| P7 | OverreachPolicy never acts | `domains/company/policies.ts` | 7 failed (demo.test.ts, policies.test.ts, quarter.test.ts, simulate.test.ts) |
| P8 | revoke-twice aims at a live grant | `domains/company/policies.ts` | 3 failed (policies.test.ts, quarter.test.ts, simulate.test.ts) |
| P9 | OVERREACH_AMOUNT 10^9 -> 1 000 | `domains/company/policies.ts` | 5 failed (demo.test.ts, policies.test.ts, simulate.test.ts) |
| P10 | freshId reuses the head (no +1): duplicate ids | `domains/company/policies.ts` | 2 failed (policies.test.ts, simulate.test.ts) |
| P11 | the ghost id is auto-g-1, which a policy can mint | `domains/company/policies.ts` | 1 failed (policies.test.ts) |
| P12 | subsetOf keeps every capability | `domains/company/policies.ts` | 2 failed (demo.test.ts, simulate.test.ts) |
| P13 | ROOT_DEPTHS gains 9, past MAX_ROOT_DEPTH | `domains/company/policies.ts` | 3 failed (policies.test.ts, quarter.test.ts) |
| P14 | REVIEW_CHANCE 0.08 -> 0 | `domains/company/policies.ts` | 9 failed (policies.test.ts, quarter.test.ts, simulate.test.ts) |
| P15 | COMPROMISED is buyer-b | `domains/company/policies.ts` | 4 failed (policies.test.ts, simulate.test.ts) |
| P16 | POLICIES: BuyerPolicy and RefunderPolicy swapped | `domains/company/policies.ts` | 3 failed (policies.test.ts, public-surface.test.ts, simulate.test.ts) |
| P17 | DELEGATE_CHANCE 0.5 -> 0 | `domains/company/policies.ts` | 7 failed (policies.test.ts, quarter.test.ts, simulate.test.ts) |
| P18 | BUYERS loses ops | `domains/company/policies.ts` | 2 failed (policies.test.ts, simulate.test.ts) |
| P19 | CompromisedPolicy acts only after COMPROMISE_TICK (< -> <=) | `domains/company/policies.ts` | 4 failed (policies.test.ts, simulate.test.ts) |
| C1 | script c1 amount 50 000 -> 50 001 | `domains/company/script.ts` | 18 failed (canon-replay.test.ts, demo.test.ts, script.test.ts) |
| C2 | script G2 limit 400 000 -> 400 001 | `domains/company/script.ts` | 21 failed (canon-replay.test.ts, demo.test.ts, script.test.ts) |
| C3 | script c9 acts under G1, not the ghost grant | `domains/company/script.ts` | 15 failed (canon-replay.test.ts, demo.test.ts, script.test.ts) |
| C4 | script's launder capability becomes "hire" | `domains/company/script.ts` | 19 failed (canon-replay.test.ts, demo.test.ts, quarter.test.ts, script.test.ts, simulate.test.ts) |
| C5 | script c8 amount 50 000 -> 20 000 | `domains/company/script.ts` | 17 failed (canon-replay.test.ts, demo.test.ts, script.test.ts) |
| C6 | freezeDeep does not freeze the step itself | `domains/company/script.ts` | 3 failed (script.test.ts, simulate.test.ts) |
| C7 | script's revoke of G2 is by dana, not cfo | `domains/company/script.ts` | 3 failed (canon-replay.test.ts, script.test.ts) |
| C8 | script c10 amount 10 000 -> 10 001 | `domains/company/script.ts` | 4 failed (canon-replay.test.ts, demo.test.ts, script.test.ts, simulate.test.ts) |
| C9 | script G1 grants three capabilities, not four | `domains/company/script.ts` | 58 failed (canon-replay.test.ts, demo.test.ts, quarter.test.ts, script.test.ts, simulate.test.ts) |
| I1 | barrel drops mulberry32 | `domains/company/index.ts` | 2 failed (public-surface.test.ts) |
| I2 | barrel drops ROOT | `domains/company/index.ts` | 1 failed (public-surface.test.ts) |
| D1 | demo oracle: bound <= limit + 10^12 | `scripts/demo-company.ts` | 1 failed (demo.test.ts) |
| D2 | demo oracle counts void commits | `scripts/demo-company.ts` | 7 failed (demo.test.ts) |
| D3 | demo: kinds never observed is not asserted | `scripts/demo-company.ts` | 1 failed (demo.test.ts) |
| D4 | demo: the oracle runs at seq 1 of the incident only | `scripts/demo-company.ts` | 1 failed (demo.test.ts) |
| D5 | demo: the standings at seq 18 are not checked | `scripts/demo-company.ts` | 1 failed (demo.test.ts) |
| D6 | demo: exitCode 1 -> 0 | `scripts/demo-company.ts` | 8 failed (demo.test.ts) |
| D7 | demo: the quarter's fault is not checked | `scripts/demo-company.ts` | 1 failed (demo.test.ts) |
| L1 | lib/allowance absorbedBy returns 0 (plan §6 M6, first sabotage) | `lib/allowance/accounting.ts` | 51 failed (canon-replay.test.ts, demo.test.ts, proofs.test.ts, accounting.test.ts, exact-return.test.ts, canonical.test.ts, revoke-admission.test.ts) |
| L2 | lib/standing: the link-dead check removed from judgeCommit (plan §6 M6, second sabotage, in the form that compiles) | `lib/standing/verdict.ts` | 48 failed (canon-replay.test.ts, demo.test.ts, policies.test.ts, proofs.test.ts, quarter.test.ts, canonical.test.ts, may-commit-equivalence.test.ts, prefix.test.ts, verdict-table.test.ts) |
| L3 | lib/standing: heir is the grantee of the first dead link | `lib/standing/standing.ts` | 41 failed (canon-replay.test.ts, demo.test.ts, canonical.test.ts, heir.test.ts) |
| P20 | ORDER_AMOUNTS: 25 000 -> 25 001 | `domains/company/policies.ts` | 1 failed (policies.test.ts) |
| P21 | REFUND_CHANCE 0.5 -> 1 | `domains/company/policies.ts` | 2 failed (policies.test.ts, simulate.test.ts) |
| P22 | DRAIN_CHANCE 0.5 -> 1 | `domains/company/policies.ts` | 2 failed (policies.test.ts, simulate.test.ts) |
| P23 | OVERREACH_CHANCE 0.5 -> 0.4 | `domains/company/policies.ts` | 2 failed (policies.test.ts, simulate.test.ts) |
| P24 | ROOT_LIMITS loses 1 000 000 | `domains/company/policies.ts` | 1 failed (policies.test.ts) |
| P25 | pick always returns the first item | `domains/company/policies.ts` | 10 failed (demo.test.ts, policies.test.ts, proofs.test.ts, quarter.test.ts, simulate.test.ts) |
| P26 | DELEGATION_LIMITS: 25 000 -> 26 000 | `domains/company/policies.ts` | 2 failed (policies.test.ts, simulate.test.ts) |
| S15 | offer records a copy of the input, not the input | `domains/company/simulate.ts` | 5 failed (canon-replay.test.ts, hostile-input.test.ts, simulate.test.ts) |
| C10 | freezeDeep freezes the step but not what is inside it | `domains/company/script.ts` | 3 failed (script.test.ts, simulate.test.ts) |

The control had 0 failed of 1511, and every one of the 74 edits went red: the smallest is 1 failed, the largest 119. No row is a survivor, so none needs an equivalence argument. Rows L1 to L3 edit `lib/`, because they are the plan's sabotages and a test of this milestone has to catch them.

The plan's two sabotages (§6 M6) were also run against the demo by hand, and `demo.test.ts` runs both on every `npm test`:
`absorbedBy` returning `0` makes `npm run demo:company` exit 1 with `DEMO FAILED: ORACLE: the engine's absorbed amount is not the amount the raw log shows was bound
under the revoked grant`, and deleting the `link-dead` check from `judgeCommit` makes it exit 1 on the step assertion for c5 (the engine's answer
has `over-limit` where plan §7 has `link-dead`).

## What M6 does not claim

- That a policy is realistic. They are deterministic stand-ins with fixed price lists; an LLM-backed agent would replace `policies.ts`.
- That the 200 seeds are a proof. They show `runQuarter` over those 200 seeds, at 60 ticks, neither threw nor failed to fold nor failed the oracle, and
  what they reached is the table above.
- That `unknown-capability` is reached by a policy: it is reached by the script only.
- That the demo's oracle is independent of everything: it imports nothing from `lib/allowance`, but it reads the standings the engine produced (it checks
  that the engine's standings respect the limits, from the raw log), so a wrong standing can be caught only if it breaks a limit or a plan §7 answer.
- That `domains/company` is safe against every rule that could be hidden in it: the scan refuses the forms named in Decision 1, and nothing else.

## Plan observations (found by building; the plan is not edited)

- Plan §6 M6 says "`npm run demo:company` ... exits non-zero unless ... all 15 `Rejection` kinds were actually observed". The policies reach 14 of 15 and the
  script reaches the fifteenth, so the demo's 15/15 is reached through the script.
- The plan's second sabotage says "flip M5's `link-dead` check". The form that compiles and keeps the rest of `judgeCommit` is to delete the check, which is
  what was run.
- The plan lists `__tests__/*` for M6; the tests also hold `__tests__/support/` (the oracle, the casts reader, the scan) and `__tests__/proofs/`, both under that directory.
- `.genesis/checkpoints/CURRENT.md` and `.genesis/DONE.html` are not edited here, as in M1 to M5: the bookkeeping PR that marks the milestone done edits them, after an independent L4 verifier approves.
