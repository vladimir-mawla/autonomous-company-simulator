# Architecture: what each stage refuses, and why

This is the architecture as it is on `main` after M8 (commit `2d906db`), with each refusal tied to the file that makes it and a test that pins it. A citation is a file and a test title, in the form checked by `tests/docs/citations.test.ts`: the file must exist and the title must be a test in it. That test does not check that the sentence beside a citation is what the cited test asserts; it checks that the citation points at something real. Design decisions are cited as D1 to D9, the numbering of `.genesis/PLAN.md` section 3.

## The shape: one log, five layers, imports that go down

```
lib/contracts  ->  lib/chain  ->  lib/allowance  ->  lib/standing  ->  domains/company
  types, ids       intake,         headroom,          fold, append,      Meridian Supply Co.:
  limits,          structure,      absorbed,          verdict,           the org, the script,
  guards           chain walks     exact return       standing           five policies, a view

        then, importing from the lib/ and domains/ barrels (each layer's index.ts):
        components/company/compute-demo-view.ts  (the one bridge)  ->  CompanyDemo.tsx  ->  app/page.tsx
        scripts/demo-company.ts                                       (npm run demo:company)
        app/api/health/route.ts                                       (imports lib/contracts only)
```

The arrows are the imports found in the source files on `main` after M8 (checked by reading every `from "..."` of the non-test sources). A layer imports its own layer and layers to its left. The scans below pin this for `lib/` and say what each covers; for `domains/`, `components/` and `app/` they pin a narrower set of rules, which are listed with them.

What enforces it, and how far:

- `lib/` as a whole: `lib/contracts/__tests__/architecture.test.ts` › "this repository: lib/ is a closed module graph and obeys the layer table" scans every `.ts` file under `lib/`, resolves relative specifiers to real files, allows no package import in library source, and fails on an upward import. It is about imports, not purity: the same file's header says it does not stop library code from using an ambient global such as `Date.now`.
- Each of the three engine layers above `contracts` has its own scan, and the barrel's run-time exports are pinned: `lib/chain/__tests__/architecture.test.ts` › "the barrel: exactly the plan's M3 names", `lib/allowance/__tests__/architecture.test.ts` › "the barrel: exactly the plan's four M4 functions", `lib/standing/__tests__/architecture.test.ts` › "the barrel: exactly the plan's five M5 functions".
- `domains/company`: `domains/company/__tests__/source-scan.test.ts` › "this repository: domains/company source has no finding". The scan reports a string literal equal to a kind of `Standing`, `Breach`, `Rejection` or `FoldFault`, and arithmetic or ordering comparisons on something named for money, in the domain's source. Its blind spots are pinned in the same file's "TEETH" blocks, not claimed away.
- The page: `components/company/__tests__/source-scan.test.ts` › "the real page source" scans the page's source for the banned hooks and for engine imports outside the bridge; the next test there, "the bridge is the only scanned file that imports lib/ or domains/", is the one-bridge rule. The same file's "THE BLIND SPOTS" block lists evasions the scan does not see.

## The one path an event takes

Everything that changes the log goes through `append` in `lib/standing/append.ts`; `fold` and `mayCommit` replay the log through the same code (D3, D9). The log is the only state: no caller hands the engine a tree, a list of charges or an earlier result.

1. The charter and the log are read as untrusted input, each property once (Stage 1).
2. The log is replayed from empty, re-running every admission rule on every event (Stage 4).
3. The new event is read through intake, then judged: a grant by structure and then by headroom (Stages 2 and 3), a revoke by three rules, a commit by `judgeCommit` (Stage 4).
4. If it is admitted it is stamped `head + 1` by the engine and returned as a new log. A refused event takes no seq.

## Stage by stage

Each row says what the stage refuses, why, where, and a test that pins it. "Refuses" in this repository means "refuses to let it bind or create authority"; it does not mean "stops the agent from acting" (`tests/failures/09-admitting-a-void-commit-is-not-refusing-it.test.ts` › "09 admitting a void commit is not refusing it: append records an unauthorised act").

### Stage 0 — contracts (`lib/contracts`)

| Refuses | Why | Where | Pinned by |
|---|---|---|---|
| a `void` standing that carries a warrant, an `inherited` standing without an heir, a `binding` standing that carries a breach: they do not compile | a standing's fields are decided by its kind, so a wrong combination is a type error rather than a runtime surprise (D8) | `lib/contracts/standing.ts` | `lib/contracts/__tests__/type-proofs.test.ts` › "every proof file fails to compile with exactly the stated codes and message fragments" |
| the same combinations, when a value is built by a cast and the compiler cannot help | a cast defeats the type, so a run-time guard names the field | `lib/contracts/standing.ts` (`assertStandingWellFormed`) | `lib/contracts/__tests__/integrity.test.ts` › "(2) a cast-built void standing carrying a warrant is unexpected-field / void / warrant" |
| a fifth kind of any of the four closed unions slipping in silently | the vocabulary is closed, so a `switch` over it can be checked for exhaustiveness | `lib/contracts/unreachable.ts` and the four unions | `lib/contracts/__tests__/closed-unions.test.ts` › "Rejection: fifteen variants" |

The types have limits the tests state. `?: never` forbids every value except an explicit `undefined`, and a plain cast of a contaminated object compiles under one of the two tsconfigs: `lib/contracts/__tests__/standing.test.ts` › "an explicit `warrant: undefined` on a void standing is an error under tsconfig.lib.json and ACCEPTED under tsconfig.json". The health route (`app/api/health/route.ts`) runs the three self-checks of `assertStandingWellFormed` and answers 503 when one fails: `app/api/health/__tests__/route.test.ts` › "is 503 when the guard rejects the well-formed standing". It checks the contracts guard, not the engine.

### Stage 1 — chain, intake (`lib/chain/intake.ts`)

| Refuses | Why | Where | Pinned by |
|---|---|---|---|
| a malformed event or charter (`invalid-event-shape`, naming the field), and a capability outside the charter's vocabulary (`unknown-capability`) | an event is untrusted until it is read into plain data | `lib/chain/intake.ts` | `lib/chain/__tests__/intake.test.ts` › "readEventInput: invalid-event-shape names the offending field, one at a time" |
| trusting a value because it looked valid when it was checked: a getter or Proxy that answers differently the second time | each property is read once and only that read is used (D3) | `lib/chain/intake.ts` | `lib/chain/__tests__/hostile-input.test.ts` › "a getter that changes its answer after the first read cannot contaminate a result" |
| copying anything the event was not asked for: an extra key, a caller's `seq` | the engine stamps `seq`; a caller cannot choose or back-date it (D3) | `lib/chain/intake.ts` and `lib/standing/append.ts` | `lib/chain/__tests__/intake.test.ts` › "extra keys are never copied: not on the envelope, not on the payload, not a `seq`" and `lib/standing/__tests__/replay.test.ts` › "a caller cannot choose seq, and no other key of an input reaches the log" |

### Stage 2 — chain, structure (`lib/chain/structure.ts`)

Nine refusals, none of which looks at amounts: `duplicate-id`, `not-a-root`, `unknown-parent`, `parent-dead`, `grantor-not-holder`, `capability-widening`, `depth-exhausted`, `depth-not-narrowed`, `principal-cycle`. Why: authority may only be passed on by its holder, only narrowed, and only down a finite, acyclic chain (D2, D5).

| Refuses | Why | Where | Pinned by |
|---|---|---|---|
| each of the nine, for that rule alone, with the grant accepted once that rule is repaired | a refusal that is really a different rule's refusal would hide a hole | `lib/chain/structure.ts` | `lib/chain/__tests__/structure.test.ts` › "each structural refusal: its fixture is refused for that rule alone, and accepted once that rule is repaired" |
| naming two reasons at once | one reason is reported, the first failing rule in a fixed order (D8) | `lib/chain/structure.ts` | `lib/chain/__tests__/structure.test.ts` › "precedence: a grant that breaks two rules is refused for the first, and the second shows once the first is repaired" |
| an accepted grant that is not an attenuation of its parent | the chain's narrowing is a property of every accepted grant, not of chosen examples | `lib/chain/chain.ts` | `lib/chain/__tests__/attenuation-closure.test.ts` › "attenuation closure: every accepted grant is attenuated, every refusal is true" |

### Stage 3 — allowance (`lib/allowance/accounting.ts`)

Authority is conserved (D2): a child grant's `limit` is reserved out of its parent's headroom, spent or not, and a revoke returns only what was not spent.

| Refuses | Why | Where | Pinned by |
|---|---|---|---|
| a reservation larger than the parent's headroom (`over-allocation`, with the exact shortfall) | delegating must not create authority | `lib/allowance/accounting.ts` (`checkHeadroom`) | `lib/allowance/__tests__/conservation.test.ts` › "a child grant is admitted only with limit <= the parent's headroom, and a refusal carries the exact shortfall" |
| returning spent authority on a revoke, and returning less than the unspent part | a revoke that forgave spending would let revoke-and-regrant mint authority; one that returned nothing would strand it | `lib/allowance/accounting.ts` (`absorbedBy`) | `lib/allowance/__tests__/exact-return.test.ts` › "revoking h raises its live parent's headroom by exactly limit(h) - subtreeOwn(h)" |
| a live grant with negative headroom, and a dead grant with non-zero headroom | the conservation invariants | `lib/allowance/accounting.ts` | `lib/allowance/__tests__/conservation.test.ts` › "every live grant has headroom >= 0" and › "every dead grant has headroom exactly 0" |
| the canonical numbers being anything else | G2 absorbs 220 000 and returns 180 000, and G1's headroom goes from 500 000 to 680 000 | `lib/allowance/accounting.ts` | `lib/allowance/__tests__/accounting.test.ts` › "revoking G2 at seq 11: absorbed 220 000 (80 000 + 50 000 + 90 000), returned 180 000, G1's headroom 500 000 -> 680 000" |

The conservation tests are properties over generated logs from a seeded generator; the files say how many seeds and steps, and that a generator that does not reach an edge is itself tested (`lib/allowance/__tests__/conservation.test.ts` › "each count is at least its floor, so each property above was evaluated over many prefixes, at the edges the floors name").

### Stage 4 — standing (`lib/standing`)

| Refuses | Why | Where | Pinned by |
|---|---|---|---|
| a revoke by someone not above the grant (`revoker-not-authorised`), of a dead grant (`already-dead`), of a grant that is not there (`unknown-grant`) | authority to cut a grant belongs to the principals above it; a revoke is recorded once | `lib/standing/fold.ts` (`decide`) | `lib/standing/__tests__/revoke-admission.test.ts` › "one row per rejection: the violating scenario is refused as exactly that, the repaired one is admitted" |
| a structure rule being hidden by an over-allocation, or the reverse | admission precedence is fixed: structure first, then headroom | `lib/standing/fold.ts` | `lib/standing/__tests__/admission-order.test.ts` › "every structure rule hides over-allocation, and over-allocation appears once the structure is repaired" |
| ruling a commit by anything but the first failing breach, and calling it `warranted` before every rule holds | one reason, in a documented order (D8) | `lib/standing/verdict.ts` (`judgeCommit`) | `lib/standing/__tests__/verdict-table.test.ts` › "one row per breach: the violating scenario is exactly that breach, the repaired one is warranted" and "every combination of breaches reports only the first, in the precedence of plan 4.3" |
| judging a commit with hindsight | the verdict is fixed at the act, from the log up to it (D1) | `lib/standing/verdict.ts` | `lib/standing/__tests__/prefix.test.ts` › "judging the early commit against the FINAL tree would rule it void: that is the hindsight the engine does not do" |
| a `void` act becoming anything else later | a breach is a property of the prefix up to the act, so no later event reads it (D1) | `lib/standing/standing.ts` (`deriveStanding`) | `lib/standing/__tests__/lattice.test.ts` › "void is absorbing on the longest chain: no later revoke at any level turns it into anything" |
| naming the revoker as the one who answers | accountability follows the delegation chain: the heir is the grantor of the first dead link (D7) | `lib/standing/standing.ts` | `lib/standing/__tests__/heir.test.ts` › "who revoked is irrelevant to who answers (plan D7, failure case 11)" |
| a pre-check that differs from the record | `mayCommit` and `append` go through one predicate (D9) | `lib/standing/append.ts` | `lib/standing/__tests__/may-commit-equivalence.test.ts` › "the boundary, asked of both: exactly the headroom is warranted and one more is over-limit" |
| charging the allowance for a void commit | a void act is recorded, and costs nothing | `lib/standing/fold.ts` (`apply`) | `lib/standing/__tests__/conservation.test.ts` › "a breached commit is recorded and the grant's headroom is exactly what it was" |
| a log or charter it cannot replay: a gap in `seq`, an inadmissible event, a hostile read, a log over `MAX_LOG_EVENTS` | the answer is a typed `FoldFault`, not a throw and not a smaller log | `lib/standing/fold.ts` (`replay`) | `tests/failures/02-arrival-is-order.test.ts` › "a hand-built log in which the seqs of the revoke and the commit are exchanged does not fold: seq must be the position (seq-mismatch)"; `tests/failures/05-authorship-is-asserted-not-authenticated.test.ts` › "05 replay re-validates: a cast-built log with an event that could not have been admitted fails closed at its index"; `lib/standing/__tests__/hostile-input.test.ts` › "a revoked Proxy as the log, as an element and as a nested list is a typed fault, not a throw"; `tests/failures/10-hostile-input-fails-closed.test.ts` › "10 hostile input fails closed: the bounds, N and N + 1, through the domain's offer and the log's length" |
| an engine that does not reproduce the canonical incident | the numbers in the plan are the engine's, event by event | `lib/standing/fold.ts` | `lib/standing/__tests__/canonical.test.ts` › "the eighteen admitted events of plan section 7, offered to append one at a time" and › "the fifteen rejections of plan section 7, each at the point the table places it" |

### Stage 5 — the domain (`domains/company`)

Meridian Supply Co.: the charter, the canonical incident script, five policies and a view. The domain contributes no authority rule (plan section 6, M6), which is a claim about what the source contains, checked by the scan above.

| Refuses | Why | Where | Pinned by |
|---|---|---|---|
| answering the incident script with anything other than what plan section 7 gives for each of its 33 steps | the demo is the engine's answer, step by step; the script's own header says it throws at the first step that differs | `scripts/demo-company.ts` | `domains/company/__tests__/demo.test.ts` › "prints the attempt, the engine's typed result and plan §7's answer for each of the 33 steps, in order" |
| a policy driving a quarter into a log the engine cannot fold, or one that breaks conservation | the five policies are pure functions of a view and a seeded generator | `domains/company/simulate.ts` | `domains/company/__tests__/quarter.test.ts` › "never throws, always folds, conserves at every prefix" |

### Stage 6 — the demo (`components/company`, `app/page.tsx`)

| Refuses | Why | Where | Pinned by |
|---|---|---|---|
| rendering a ruling the engine did not just produce for the log on screen | one bridge calls the engine; the component renders what it returns | `components/company/compute-demo-view.ts` | `components/company/__tests__/compute-demo-view.test.ts` › "a transcript that is not the log's story is an error" |
| showing a different table from `npm run demo:company` | the test runs the script and diffs it against the rendered page | `components/company/CompanyDemo.tsx` | `components/company/__tests__/demo-diff.test.tsx` › "the standings blocks of the script are the rows of the page's table" |
| a button sequence that throws or breaks conservation | the reducer is total over the page's eight buttons, for sequences of up to four | `components/company/compute-demo-view.ts` | `components/company/__tests__/compute-demo-view.test.ts` › "EXHAUSTIVE: every sequence of at most 4 buttons yields a view, and the view conserves" |
| claiming a milestone done that `.genesis/DONE.html` does not | the page's milestone list and the definition-of-done file are compared | `app/milestones.ts` | `app/milestones.test.ts` › "claims exactly the milestones DONE.html marks done" |

What no test here covers is a button's click handler. See `docs/WALKTHROUGH.md` for what was checked by hand, by whom, and on what date.

## What this document does not cover

The limits of the whole system, with their tests, are in the README's Honest limits. Which of this document's sentences a test pins is exactly the set that carries a citation; a sentence without one is prose.
