# Autonomous Company Simulator

Who answers for what an organisation of autonomous agents has done.

**The claim.** Authority is conserved when it is delegated (a child's limit is reserved out of its parent's headroom), a revoke reaches only the future, and every commitment an agent makes is ruled `binding`, `inherited` or `void` against the record as it stood when the act was made. A `void` act is recorded and costs nothing; an `inherited` one names the principal who answers for it now. The engine is a pure function of an append-only log, in `lib/`; a company of six agents, five policies and a canonical incident are in `domains/company`; the page below drives that engine in your browser and renders only what it returns. Plan: [`.genesis/PLAN.md`](.genesis/PLAN.md). Definition of done: [`.genesis/DONE.html`](.genesis/DONE.html).

**Live:** https://autonomous-company-simulator.vercel.app

Its `/api/health` reports the commit the deployment was built from, so the page can be compared with `git log` on `main`. On 2026-11-09, before this milestone, it answered `{"status":"ok","commit":"2d906db3ee492b4659d26ba1670a2b4466bf8c8c","checks":{"contracts":{"pass":true,...` (the three assertions of the contracts guard, nothing about the engine; see Honest limits).

## Run it from a clean clone

```bash
git clone https://github.com/vladimir-mawla/autonomous-company-simulator.git
cd autonomous-company-simulator
npm ci                  # not `npm install`; see the note below
npm run typecheck       # tsc against tsconfig.lib.json, then tsconfig.json
npm test                # vitest
npm run build           # next build --webpack
npm run demo:company    # the canonical incident through the real engine; ends with a line starting "demo OK"
npm run lint            # eslint, JavaScript and config files only; see Honest limits
```

Node 24 (`engines.node` in `package.json`). No credentials are read: `.env.example` is there to say so, and CI asserts its workflow names no secret.

**Use `npm ci`, never `npm install`.** npm 11.5.1 can silently drop the platform `@rolldown/binding-*` package that Vitest needs when it reconciles against an existing lockfile, and `npm test` then fails with a bare "Cannot find native binding". `npm ci` restores them from the committed lockfile, and CI checks that the binding loaded.

CI is `.github/workflows/ci.yml`: a fresh checkout, `npm ci`, a check that the binding loaded, `npm run typecheck`, `npm test`, `npm run build`. The PR that added this file's current text records the output of each command above from a fresh clone.

## The deliverables

| Deliverable | Where |
|---|---|
| Public repo that runs from a clean clone, with a README | this file; the commands above |
| Live demo URL | https://autonomous-company-simulator.vercel.app, which auto-deploys `main` |
| 90-second Loom script (the recording is a human step) | [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md), with the record of the by-hand check of the live click path |
| Architecture snapshot | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): stage by stage, what each refuses and why, each tied to a file and a test |
| One deliberate failure test | [`tests/failures/01-compromise-within-mandate-is-invisible.test.ts`](tests/failures/01-compromise-within-mandate-is-invisible.test.ts), listed first below |
| Two-year thesis, at most 300 words | [`docs/THESIS.md`](docs/THESIS.md) |
| Process record | [`docs/NOTES.md`](docs/NOTES.md); the decisions are `.genesis/decisions/0001` to `0009` |

What keeps the documents honest: `tests/docs/citations.test.ts` fails when a backticked source or test path in `README.md` or `docs/ARCHITECTURE.md` does not exist, when a quoted test title is not in the file it is cited against, when a failure case is missing from this README, when the thesis exceeds 300 words, or when the Loom narration exceeds 230 words. It does not check that a cited test asserts what the sentence next to it says, and a sentence with no citation is not covered by it.

## Honest limits

The failure suite is `tests/failures/`: eleven cases, each a file whose header says what the limit is and what edit would make the case fail. Cases marked DISCLOSES state something the engine does not do; their tests pin the limit so that closing it would turn the case red. Cases marked PROVES pin a guarantee. Each bullet below is the limit as that file's header states it, with one test of the file cited.

1. **Compromise inside a mandate is invisible (the deliberate failure test).** The engine rules a compromised agent's in-mandate acts the same as a diligent agent's; it bounds the loss and does not detect it. `tests/failures/01-compromise-within-mandate-is-invisible.test.ts` › "a compromised buyer's five commits and a diligent buyer's five identical commits get the same five rulings, and none is flagged". What is proved beside it: › "the bound: after 5 x 10 000 under a limit of 50 000, a sixth commit of 1 is recorded void: over-limit { requested 1, headroom 0 }, and the binding amounts sum to the limit".
2. **Arrival is order (a partial pin).** A commit "initiated before" a revoke but appended after it is `void: link-dead`; the engine has no clock and no `initiatedAt`. The case fixes the order of a log, not the behaviour of concurrent submissions, which a function of a log never sees. `tests/failures/02-arrival-is-order.test.ts` › "c5, which arrived at seq 12, is void: link-dead { G2, atSeq 11 }".
3. **Revoke-and-regrant cannot mint authority (PROVES).** After a child spends, a revoke returns only the unspent part. `tests/failures/03-revoke-and-regrant-cannot-mint-authority.test.ts` › "limit 100, child granted 60 and spent 50, revoked: re-granting 60 is over-allocation { G1, 60, 50 }; re-granting 50 is admitted".
4. **Root re-issue is unbounded.** Conservation is per root grant, not per human: the charter's root can issue many root grants and nothing bounds their sum. `tests/failures/04-root-reissue-is-unbounded.test.ts` › "fifty root grants of MAX_AMOUNT are all admitted: no aggregate bound exists".
5. **Authorship is asserted, not authenticated.** A `by` or `actor` that fits the grants is accepted whoever sent it; the engine checks consistency, not truth. Replay re-validates every event (PROVES). `tests/failures/05-authorship-is-asserted-not-authenticated.test.ts` › "a log of admissible events that never happened folds clean, and is indistinguishable from the log append built".
6. **Only the first breach is named.** A commit that breaks several rules is told about one; repairing it shows the next. `tests/failures/06-only-the-first-breach-is-named.test.ts` › "c6 is by buyer-b under G4 (buyer-a's, and cut): void: wrong-actor { holder buyer-a }, which hides link-dead".
7. **Grants never lapse.** There is no expiry and no rate limit; authority ends on an explicit `revoke`. `tests/failures/07-grants-never-lapse.test.ts` › "there is no rate limit: the whole limit goes in consecutive seqs".
8. **The charter is part of the log's meaning.** A log does not carry its charter and the charter has no version; the wrong charter yields a fault with no indication of why. `tests/failures/08-charter-is-part-of-the-logs-meaning.test.ts` › "a charter with a `version` (and an `id`) is read as the charter without them: the same fold, to the value".
9. **Admitting a void commit is not refusing it.** `append` of an unauthorised commit succeeds and records it as `void`; the optional `mayCommit` says what the verdict would be and writes nothing. The test asserts the engine's behaviour at admission, not that a caller consults the pre-check. `tests/failures/09-admitting-a-void-commit-is-not-refusing-it.test.ts` › "a void commit charges nothing: 150 under G2 (limit 100) is void: over-limit, and 100 after it is still warranted".
10. **Hostile input fails closed (PROVES).** A typed fault, not a throw, at each of the five entry points, for the kinds of damage the case enumerates. `tests/failures/10-hostile-input-fails-closed.test.ts` › "10 hostile input fails closed: a fault is the whole answer, and leaves nothing behind".
11. **Accountability follows delegation, not revocation (PROVES).** The heir is the grantor of the first dead link, whoever pressed revoke. `tests/failures/11-accountability-follows-delegation-not-revocation.test.ts` › "revoking G2 by dana and by cfo gives equal standings for c1, c2 and c4: heir cfo, chargedTo G1, severed G2 at seq 11".

Limits of the rest of the repository, each with where it is stated (a limit with no test cited is stated, not pinned by a test):

- **`npm run lint` does not check TypeScript.** `typescript-eslint` does not load on TypeScript 7, so `eslint.config.mjs` ignores `.ts` and `.tsx`; `npm run typecheck` is the check for those. Stated in `eslint.config.mjs`; not pinned by a test.
- **A green `/api/health` is not a statement about the engine.** It runs the contracts guard's three assertions (`app/api/health/__tests__/route.test.ts` › "answers 200 with status ok and all three self-checks passing"). Stated in `.genesis/decisions/0002-deploy.md`.
- **The click path on the deployed page has no automated test.** It was checked by hand once, by the orchestrating agent, on 2026-11-09; what was and was not covered is in `docs/WALKTHROUGH.md`. The wiring of each button's click handler is listed as unpinned in `.genesis/decisions/0008-demo.md` (Not verified).
- **The demo keeps its log in the browser's React state; there is no persistence or database.** Stated in `.genesis/PLAN.md` section 10; not pinned by a test.
- **The sabotage ledgers are not run by CI.** Each of the ADRs 0001 to 0008 records edits made by hand to the shipped source and which tests then failed; CI runs the suite on the unedited source only. ADR 0007 says of its own ledger that a test no row names is not shown to be able to fail (`.genesis/decisions/0007-failures.md`, What M7 does not claim).
- **The thesis is a prediction.** `docs/THESIS.md` says what would falsify it.

## Files that keep the wording of the day they were written

Each milestone froze its files when it merged, and later milestones did not edit them. Some of those files therefore still contain forward-looking text that was true when written and is not now. Those lines are historical. They are not corrected, and the current state is what this README, `docs/ARCHITECTURE.md` and `.genesis/checkpoints/CURRENT.md` say. The classes, as found at commit `2d906db` by `git grep -nE "not built|not yet|does not exist|nothing built|todo|proposed"` and a narrower second pattern (the list is what those searches returned, not a proof that no other frozen line is stale):

- **ADR Status lines.** ADRs `0001` to `0008` in `.genesis/decisions/` read `Status: proposed — written by the builder; not yet approved by an independent L4 pass` (the wording differs slightly between them). Each of those milestones was later approved and merged, as `.genesis/checkpoints/CURRENT.md` records. The statuses were not updated after approval. ADR `0009` is written in the same form and will read the same way once approved.
- **ADR bodies that speak of a later milestone as unbuilt.** For example ADR `0001-contracts.md` says of M3, M4 and M5 that they are "not built", ADR `0002` says the engine does not exist yet, and ADRs `0003` to `0005` say the README, `DONE.html` or `CURRENT.md` still show their milestone as not built or `todo`. All of M1 to M8 are on `main`.
- **Source comments in `lib/contracts/*.ts`** (`breach.ts`, `commitment.ts`, `event.ts`, `fold-fault.ts`, `grant.ts`, `ids.ts`, `limits.ts`, `non-empty-array.ts`, `tree.ts`, `verdict.ts`, `warrant.ts`) that say M3's intake, M5's `judgeCommit` or `fold` are "not built". `lib/chain/chain.ts` says M5's `fold` "does not exist yet". `app/api/health/route.ts` says `lib/allowance` and `lib/standing` are not built. Two test files in `lib/contracts/__tests__/` (`ids.test.ts`, `limits.test.ts`) have comments of the same kind.
- **The status pill and table row for M9** in `.genesis/DONE.html`, `.genesis/checkpoints/CURRENT.md` and `app/milestones.ts` read `todo` or `planned` until the bookkeeping PR that marks M9 done lands; `app/milestones.test.ts` checks the two files agree with each other.

Most other hits of that grep are not stale: a grant that "does not exist" is a case the engine handles, and `todo` is the name of a style class in `DONE.html`.

## Stack

Next.js 16 (App Router) and React 19, TypeScript 7, Vitest, Node 24; built with the webpack bundler (`next build --webpack`) and `experimental.extensionAlias` in `next.config.ts`, because Turbopack cannot resolve the NodeNext-style `.js`-suffixed imports the engine uses (the comment in `next.config.ts` has the reasoning, and `tests/smoke.test.ts` pins both facts). `vercel.json` pins `npm ci` and `npm run build`. There are no dependencies beyond those. Library source under `lib/` may import no package (`lib/contracts/__tests__/architecture.test.ts` › "this repository: lib/ is a closed module graph and obeys the layer table").
