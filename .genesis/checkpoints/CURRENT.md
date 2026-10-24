# CURRENT

- **active_loop:** none recorded. M1 (contracts, `lib/contracts/**`) and M2 (deploy skeleton,
  `app/api/health/**`) are `done`; M3 to M9 are `todo` in this revision. Each milestone is separate, with
  its own branch, its own PR, and its own independent (L4) verifier. `app/page.tsx` is still the genesis
  placeholder.

- **last updated:** 2026-10-24, in the `chore(genesis): mark M2 done` bookkeeping PR, after M2 passed
  independent L4 verification and merged (PR #4). The previous revision was the `mark M1 done` PR's, and
  the one before it was written immediately after genesis, before any milestone build had begun. Recorded
  honestly rather than implying progress that does not exist: a checkpoint that overstates status is worse
  than no checkpoint at all.

## Milestone state, as of this revision

| | Status | Where |
|---|---|---|
| M1 contracts | `done` | PR #2 → `fc7b4ac` (squash-merged); independent L4 APPROVE in round 3, after three fix rounds |
| M2 deploy | `done` | PR #4 → `167e4e7` (squash-merged); independent L4 APPROVE in round 3, after two fix rounds; live, see "What M2 adds" below |
| M3 chain: intake and structure | `todo` | designed only |
| M4 allowance: conservation | `todo` | designed only |
| M5 standing: fold, verdict, heir | `todo` | designed only |
| M6 domain (Meridian Supply Co.) | `todo` | designed only |
| M7 failure suite | `todo` | designed only |
| M8 interactive demo | `todo` | designed only |
| M9 deliverables | `todo` | designed only |

`main` is the genesis base (the plan, tooling config, app shell, a CI workflow, the README and the
`.genesis/` ritual) plus four merged PRs: #1 (the `next` 16.4.3 security upgrade), #2 (M1:
`lib/contracts/**` and its tests), #3 (`mark M1 done`, which edited only the two `.genesis/` files) and
#4 (M2: `app/api/health/**` with its tests, ADR 0002 and the README's `Live:` line). There is no
`domains/`, and `lib/` holds only `lib/contracts`.

## `main` history was rewritten on 2026-10-24 (SHAs you may see on PR pages)

`main` was rewritten once to correct commit attribution: the earlier commits used an author email that
GitHub attributes to a different account, and every commit now carries
`105279249+vladimir-mawla@users.noreply.github.com` (two squash commits' `Co-authored-by` lines were
corrected the same way). Only commit metadata changed, so the SHAs changed and the content did not:
each of the two merge commits below has the same tree before and after.

GitHub's PR pages still show the pre-rewrite merge SHAs. To match one against `git log`:

| PR | Merge SHA shown on the PR page (pre-rewrite) | SHA on `main` now |
|---|---|---|
| #1 `next` 16.4.3 security upgrade | `fc17afd` | `ab14763` |
| #2 M1 contracts | `6302394` | `fc7b4ac` |

PR #3 and PR #4 show the same merge SHAs as `main` (`2cca53b` and `167e4e7`; read with `gh pr view`), so no
pair is needed for them.

## What the scaffold does and does not prove

- **Proves:** a clean clone restores with `npm ci` (all 15 `@rolldown/binding-*` platform bindings are
  in the lockfile), `npm run typecheck` is clean, `npm test` runs the scaffold's one smoke test (M1
  added 12 more test files and M2 added 2, below), and `npm run build` succeeds under webpack.
- **The one smoke test** (`tests/smoke.test.ts`) pins that the `dev`/`build` scripts really pass
  `--webpack` and that `next.config.ts` really declares `experimental.extensionAlias` (it imports the
  config and reads the exported object rather than matching source text). It does **not** prove that a
  `.js`-suffixed import resolves in a build. Since M2 the build does: `app/api/health/route.ts` imports
  `lib/contracts/index.js`, so `npm run build` exercises `extensionAlias` for real. Checked on this branch:
  with the `experimental.extensionAlias` block removed from `next.config.ts` and `.next` deleted first,
  `npm run build` exited 1 with `Module not found: Can't resolve '../../../lib/contracts/index.js'` at
  `app/api/health/route.ts`; with the block in place it exited 0. The same removal on a warm `.next` cache
  built without error, so run that check with `.next` removed first.
- **Does not prove anything about the engine.** The scaffold has none. The only engine code is M1's
  contracts and the health route that self-checks them (M2), both covered next.

## What M1 adds, and what was run to check it

- When M1 was marked done, `npm ci && npm test` printed `Test Files  13 passed (13)` and
  `Tests  131 passed (131)`: 12 files under `lib/contracts/__tests__/` plus `tests/smoke.test.ts`.
  `npm run typecheck` and `npm run build` also exited 0. That run was on the mark-done branch, which
  differs from `fc7b4ac` only in the two `.genesis/` files that PR edits.
- That is the whole claim. M1 is the contracts only; M3 to M5 are `todo`, so everything about folding
  the log, conserving authority and ruling a verdict is still a design, not a result.

## What M2 adds, and what was run to check it

- **A live deployment:** https://autonomous-company-simulator.vercel.app. `/` is still the genesis
  placeholder; `GET /api/health` is the only endpoint doing real work.
- **`/api/health` runs real self-checks against `lib/contracts`; it is not a liveness ping.** On every
  request it calls the real `assertStandingWellFormed` three times and compares each answer by name: a
  well-formed `inherited` standing must be accepted, and a cast-built `void` carrying a `warrant` and a
  cast-built `inherited` missing its `heir` must each be caught (`unexpected-field/void/warrant` and
  `missing-field/inherited/heir`). All three matching gives HTTP 200 and `"status":"ok"`; any mismatch, or
  a throw, gives HTTP 503 and `"status":"degraded"`. `commit` is `VERCEL_GIT_COMMIT_SHA` as Vercel sets it,
  or the literal `unknown (local dev)`.
- **`main` auto-deploys** to production through Vercel's GitHub integration. So the commit the live
  endpoint reports is the current `main`, and merging any PR, this one included, redeploys it. To check,
  compare `commit` in the response with `git rev-parse origin/main`.
- **Observed 2026-10-24 at 12:48 UTC, before this PR:** `curl https://autonomous-company-simulator.vercel.app/api/health`
  answered HTTP 200 with `"status":"ok"`, a `commit` equal to the tip of `main` at that moment (`167e4e7`,
  M2's own merge commit), and `checks.contracts.pass` true with all three assertions at `"pass":true`.
- **Tests:** `npm ci && npm test` printed `Test Files  15 passed (15)` and `Tests  145 passed (145)`: 12
  files under `lib/contracts/__tests__/`, 2 under `app/api/health/__tests__/` (`route.test.ts` and
  `vercel-config.test.ts`) and `tests/smoke.test.ts`. `npm run typecheck` and `npm run build` also exited
  0. That run was on the mark-done branch, which differs from `167e4e7` only in the two `.genesis/` files
  this PR edits.
- **What the fix rounds changed.** Read from PR #4's commit list: the first five commits are the route, its
  tests, the `vercel.json` pin, the README line and ADR 0002. The seven after them (fixes D1 to D6 and one
  test commit) changed ADR text, comments in `route.ts` and in a test file, and one test title, and added
  one test (a throw while building a check's input is a failed check, not an uncaught error). The
  executable lines of `route.ts` are the same as in the PR's first commit: `git diff 373dee3 167e4e7 --
  app/api/health/route.ts` shows only comment lines (`373dee3` is on the PR's head ref, `refs/pull/4/head`,
  not on `main`, because the PR was squash-merged).
- **What this does not show.** One `curl` is one request at one time: it shows which commit Vercel built
  and that the three self-checks passed then, not that the deployment is unchanged since. `lib/chain`,
  `lib/allowance` and `lib/standing` do not exist yet, so a green `/api/health` says nothing about them.
  The guard checks presence only (ADR 0001, ADR 0002): a field that is present but of the wrong kind, or
  two fields that contradict each other, pass it.

## Known gaps in this repository's own record, stated up front rather than discovered later

- `.genesis/decisions/` holds two decision records, `0001-contracts.md` (M1) and `0002-deploy.md` (M2),
  each written by the milestone that made the decisions it records. M3 to M9 have none yet. Both records'
  Status line still reads `proposed`, and ADR 0002's Decision 7 still says production serves a branch head
  deployed by the CLI and that the post-merge redeploy "has not happened yet". Each was true when written;
  neither record was edited here (this PR touches only `DONE.html` and this file). "What M2 adds" above
  has the state after the merge.
- This checkpoint has no `model:` field. Which model did this work is not recoverable from the repository
  alone. The `Co-Authored-By` trailer on every commit is a fixed string required by the account's commit
  rule, written regardless of which model did the work, and must not be read as authorship evidence.
- The live URL (M2, above) serves a skeleton: `/` is the genesis placeholder and `/api/health` self-checks
  `lib/contracts` only. The interactive demo is M8 and is `todo`. The account's standing rule was deploy at
  milestone 2, never last; M2 did that.
- **Dependency versions were copied unchanged from adaptive-agent `origin/main` (`7b7ef2d`) and had known
  advisories; `next` has since been upgraded and the rest remain.** At genesis `npm audit` reported 6
  findings (1 critical, 3 high, 2 moderate): the critical one was `next@16.3.5` (11 advisories, two of
  them unauthenticated remote code execution), the rest were `vitest@5.0.1`, `vite`, `sharp` and
  `source-map-js`. They were not addressed at genesis because plan §12 says to copy the lockfile rather
  than regenerate it, and a version bump is a stack decision for the coordinator, not for genesis.
  `next` is now `16.4.3` (branch `security/next-16.4.3`). `sharp` moved with it, because `next@16.4.3`
  requires `sharp ^0.35.5`, so that finding is gone too. `npm audit` now reports 4 findings (2 high, 2
  moderate), none of them addressed: `source-map-js` (high; reachable through `next` -> `postcss`, so it
  is in the production tree), `vite` (high) and `vitest`/`@vitest/mocker` (moderate), the last two
  dev-only. No assessment was made of whether any advisory is exploitable against this scaffold or
  against Vercel's runtime.
- **The lockfile must not be rewritten with this machine's npm 11.5.1.** Measured on copies of this
  lockfile, `npm install` under npm 11.5.1 removed 27 entries (all 15 `@rolldown/binding-*`, `fsevents`
  and all 11 `lightningcss-*`), after which `npm ci` still exited 0 and `npm test` failed with "Cannot
  find native binding". `npx npm@10.9.9 install ...` changed only the entries that had to change. After
  any lockfile change, compare the count of `@rolldown/binding-*` entries (15) before and after.
