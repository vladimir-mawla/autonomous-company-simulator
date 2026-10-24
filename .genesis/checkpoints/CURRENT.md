# CURRENT

- **active_loop:** none. This is the G3 genesis repo only: **genesis only, no engine code.**
  `.genesis/PLAN.md` (G0-G2) is in place, the tooling skeleton is in place, and `app/page.tsx` is a
  placeholder. No engine code exists: M1 (`lib/contracts/**`) has not started. M1 is a separate
  milestone with its own branch, its own PR, and its own independent (L4) verifier.

- **last updated:** 2026-10-24, immediately after genesis (repo scaffold, `.genesis/` ritual, README,
  smoke test, CI workflow), before any milestone build has begun. Recorded now, honestly, rather than
  implying progress that does not exist: a checkpoint that overstates status is worse than no
  checkpoint at all.

## Milestone state, as of this revision

| | Status | Where |
|---|---|---|
| M1 contracts | `todo` | designed only (`.genesis/PLAN.md` §4, §6): no branch, no code |
| M2 deploy | `todo` | designed only |
| M3 chain: intake and structure | `todo` | designed only |
| M4 allowance: conservation | `todo` | designed only |
| M5 standing: fold, verdict, heir | `todo` | designed only |
| M6 domain (Meridian Supply Co.) | `todo` | designed only |
| M7 failure suite | `todo` | designed only |
| M8 interactive demo | `todo` | designed only |
| M9 deliverables | `todo` | designed only |

`main` is the single base history produced by genesis: the plan, tooling config, app shell, one smoke
test, a CI workflow, the README and the `.genesis/` ritual. There is no `lib/`, no `domains/`, no
health route, and no deploy.

## What the scaffold does and does not prove

- **Proves:** a clean clone restores with `npm ci` (all 15 `@rolldown/binding-*` platform bindings are
  in the lockfile), `npm run typecheck` is clean, `npm test` runs one smoke test, and `npm run build`
  succeeds under webpack.
- **The one smoke test** (`tests/smoke.test.ts`) pins that the `dev`/`build` scripts really pass
  `--webpack` and that `next.config.ts` really declares `experimental.extensionAlias` (it imports the
  config and reads the exported object rather than matching source text). It does **not** prove that a
  `.js`-suffixed import resolves in a build: that needs a file under `app/` to import `lib/`. Until one does,
  `npm run build` does not exercise `lib/` (checked once, with a temporary import, during M1's verification).
- **Does not prove anything about the engine.** There is none. Every plan claim is a design, not a result.

## Known gaps in this repository's own record, stated up front rather than discovered later

- No decision record exists yet in `.genesis/decisions/`. The first one (`0001-contracts.md`) is M1's
  own artifact, not genesis's: an ADR is written by the milestone that made the decisions it records.
- This checkpoint has no `model:` field. Which model did this work is not recoverable from the repository
  alone. The `Co-Authored-By` trailer on every commit is a fixed string required by the account's commit
  rule, written regardless of which model did the work, and must not be read as authorship evidence.
- No live URL exists yet. The account's standing rule applies: deploy at milestone 2, never last. M2
  deploys a live skeleton second, not last, so this project does not repeat the previous project's gap.
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
