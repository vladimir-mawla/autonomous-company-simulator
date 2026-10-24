# ADR 0002 — M2 deploy skeleton: what the health endpoint checks, what production serves before and after merge, and what the deploy check does not show

- **Date:** 2026-10-24
- **Status:** proposed — written by the builder, not yet verified by an independent L4 pass
- **Phase / milestone:** M2 (BUILD) — `app/api/health/**`, `vercel.json` (pinned, not rewritten), the `Live:` line in `README.md`

## Context

`.genesis/PLAN.md` §6 (M2) asks for a live deployment from the first milestone after M1, a `GET /api/health`
that "runs a real self-check against `lib/contracts`" and reports the deployed commit, and refuses a 200 on a
bare liveness ping, a fabricated SHA and a deploy from a dirty tree. This ADR records what the endpoint
checks, how it was deployed, what production serves right now and after the merge, and what none of that
proves. Everything stated as observed was run on 2026-10-24; what was not run is listed under "Not shown".

## Decision 1 — three self-checks against the real `assertStandingWellFormed`, compared by name

The route calls `assertStandingWellFormed` three times per request and compares what it returns with what it
must return, written as `ok` or `<error.kind>/<variant>/<field>`:

| # | Standing handed to the guard | How it is built | Must be |
|---|---|---|---|
| 1 | a well-formed `inherited` | a typed literal | `ok` |
| 2 | a `void` carrying a `warrant` | `as unknown as VoidStanding` | `unexpected-field/void/warrant` |
| 3 | an `inherited` with no `heir` | `as unknown as InheritedStanding` | `missing-field/inherited/heir` |

Two of the three are cast-built on purpose. The M1 types refuse both at compile time for a value whose static
type still shows the fault (ADR 0001), but that is not every route: a cast, an implicit `any` or parsed JSON gets
a contaminated value past them, and so does a route with no cast and no `any` (widening the static type to a
supertype first, `lib/contracts/__tests__/proofs/standing-residuals.proofs.ts` routes 4 to 7; or writing to the
object through a writable-optional alias type after it was built, `lib/contracts/standing.ts`, "WHAT THIS DOES NOT
CLOSE"). That is the case the run-time guard is for; a running server can probe the guard but not the types. Matching on the full name, not on `ok: false`,
means a guard that starts failing for the wrong reason (right verdict, wrong field) is also reported.

**Scope is `lib/contracts` only**, the one layer that exists at M2. Nothing here exercises `lib/chain`,
`lib/allowance` or `lib/standing`, and the response does not suggest it does. The guard itself checks
**presence only** (ADR 0001, Decision 10 and the guard's own comment): a present field of the wrong kind, or
two fields that contradict each other, passes it, so a green `/api/health` says nothing about those.

## Decision 2 — 503 with `status: "degraded"` on any failed check; a throw is a failed check

Any assertion that does not match, and any assertion that throws (in the guard or while building its input),
gives HTTP 503 and `status: "degraded"`; the response names which assertion failed and what it got. 200 and
`status: "ok"` happen only when all three match. There is no code path that answers 200 without running the
three checks. `export const dynamic = "force-dynamic"` is set because plan §6 M2 requires it, so that Next cannot prerender
one response at build time (which would run the checks once during the build and freeze `commit`);
`route.test.ts` asserts the exported value. It is not what makes the route dynamic on this Next version: a
scratch `next build --webpack` (Next 16.4.3, this config, `.next` removed first) with the export deleted still
lists `/api/health` as `ƒ (Dynamic)`, and `next start` of that build read `VERCEL_GIT_COMMIT_SHA` at request
time. So the `ƒ (Dynamic)` line in the build output does not show what the export does, and the test pins the
declaration, not an effect.

## Decision 3 — the commit is `VERCEL_GIT_COMMIT_SHA` or the literal `"unknown (local dev)"`, never guessed

`commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown (local dev)"`. It is never hardcoded or read from `git`.
The tests set the variable and read it back, and unset it and read the literal back. The value is whatever
the platform sets, passed through unchanged; the endpoint does not validate that it looks like a SHA.

## Decision 4 — `vercel.json` already existed; M2 pins it with a test and does not rewrite it

**Plan/repo mismatch.** The plan gives `vercel.json` to M2 as if M2 creates it. The genesis scaffold had already
committed `{"installCommand":"npm ci","buildCommand":"npm run build"}`, which is what the plan asks for, so
`git diff main -- vercel.json` is empty. M2 adds `app/api/health/__tests__/vercel-config.test.ts`, which parses
the file and compares it whole with `toEqual`, so a changed command or an added key (`framework`,
`outputDirectory`, ...) fails. Run against two scratch edits (`buildCommand: "next build"`; an added
`framework`), the test went red both times; `vercel.json` was restored with `git checkout` each time.

What that test does not show is that Vercel honours the file; see Decision 6.

## Decision 5 — how it was deployed, and two things the Vercel CLI did to the working tree

- **Scope.** `npx vercel whoami` printed `vladimir-mawla`. `npx vercel project ls` listed the six sibling
  projects (`adaptive-agent`, `memory-ledger`, `agent-trust-layer`, `shadow-run`, `agent-control-tower`,
  `decision-engine`) under `vladimirs-projects-dd81f456`, so this project was created there:
  `vercel link --yes --project autonomous-company-simulator --scope vladimirs-projects-dd81f456`.
- **Git connection.** `vercel link` itself printed `Connecting GitHub repository: ... Connected`. A later
  `vercel git connect <repo> --yes --scope ...` printed `vladimir-mawla/autonomous-company-simulator is already
  connected to your project.` Observed consequences: the push of `827ff30` to `m2-deploy` (after the
  link) produced a Preview deployment and a GitHub commit status "Vercel / Deployment has completed", whereas
  `7929e94`, pushed before the project existed, has no Vercel status; and a push to `main` produced a Production
  deployment (Decision 7).
- **Side effects of `vercel link`, both reverted and never committed.** It appended a bare `.env*` line to the
  tracked `.gitignore` (which would silently stop `.env.example` being committed, the exact trap that file's own
  comment describes) and wrote `.env.local` holding a `VERCEL_OIDC_TOKEN`. `.gitignore` was restored with
  `git checkout -- .gitignore`; `.env.local` was deleted. `git status --short` was empty afterwards, and `.vercel/`
  is ignored (`git check-ignore -v .vercel/project.json` names `.gitignore:45`). Anyone re-running `vercel link`
  should expect both again.
- **Every production deploy from a clean full clone**, never the working tree and never a `git worktree`:
  `git clone -b m2-deploy <repo> <tmp>/deploy`, copy `.vercel/project.json` in, `git status --short` empty,
  `npx vercel deploy --prod --yes`. After each, `curl` the production alias and compare `commit` with
  `git rev-parse HEAD` of that clone. Observed: at `7929e94` and at `827ff30` the live `commit` equalled the
  clone's HEAD, `status` was `ok` and `checks.contracts.pass` was `true`.

## Decision 6 — webpack was confirmed from the served chunks; the Turbopack control is under "Not shown"

The build log is not reproducible without the CLI, so the check is on what is served. The home page references
five scripts, of which the runtime chunk is `/_next/static/chunks/webpack-<hash>.js`. All five were fetched
(HTTP 200) and `grep -ic turbopack` printed 0 for each, and 0 for the HTML. `vercel project inspect` prints
Install Command `npm ci` and Build Command `npm run build`; whether those values come from `vercel.json` or from
project settings was not separated. The local
`npm run build` banner reads `▲ Next.js 16.4.3 (webpack)` and lists `extensionAlias`; that build now compiles
`app/api/health`, which imports `lib/contracts/index.js`, so the alias is exercised for real.

## Decision 7 — what production serves: the branch head by CLI now, `main` after merge, and a race between them

**Production currently serves a branch head that was deployed by the CLI, not `main`.** `main` has no
`/api/health` until this PR merges. Because the GitHub integration is connected, a push to `main` also
triggers a Production deployment, and the production alias goes to whichever finishes last.

This was observed, not predicted. After the clean-clone deploy at `827ff30` returned the matching SHA, the
bookkeeping PR (#3) merged, `main` auto-deployed (`2cca53b`) and the same alias then answered
`GET /api/health` with **HTTP 404**. The branch head had to be deployed again, after waiting for that build to
reach `Ready` (`vercel inspect <url>` shows `status`). That build was `main`'s: the deployment id `vercel inspect`
printed for it is the one the GitHub commit status "Vercel / Deployment has completed" on `2cca53b` points to. Rule for any later deploy while `main` and the branch
differ: wait until the `main` build is `Ready`, deploy, and re-check `commit` a minute later.

**After merge** the integration redeploys `main`, so the live `commit` should equal the merge commit on `main`.
That has not happened yet and nothing here shows it.

**Who can reach what, as observed.** The production alias answered `/api/health` and `/` with HTTP 200 and no
login page (no `sso`/`vercel authentication` text in the HTML). The per-deployment URL of the `main` build
(`autonomous-company-simulator-<id>.vercel.app`) answered `/api/health` with HTTP 302, so only the alias, not
the unique deployment URLs, is public; use the alias.

## Not shown, stated at full strength

- **A green `/api/health` is not a statement about the engine.** The engine does not exist yet; the check
  covers `lib/contracts` only, and only for presence-shaped faults.
- **The no-`turbopack` check was one-sided when this ADR was first written.** No Turbopack build had been made
  to confirm the string would appear in one. A control was run afterwards in scratch copies of this branch
  (2026-10-24). `next build --turbopack` and plain `next build` (what the plan says the preset runs) both fail on
  this tree with `Module not found: Can't resolve '../../../lib/contracts/index.js'` at
  `app/api/health/route.ts:1:1`; that was run locally, not on Vercel. The same tree with `app/api` deleted builds
  under `next build --turbopack` (`▲ Next.js 16.4.3 (Turbopack)`), writes a `turbopack-<hash>.js` chunk, and the
  string appears in five files under `.next/static`; so the grep can come out positive, and the five served
  chunks lacking it means something.
- **The SHA comparison shows the deployed commit, not an unchanged tree.** It matches because each deploy was
  from a clean clone whose `git status --short` was empty. It would not catch a dirty deploy by itself, and
  the empty-SHA behaviour of a `git worktree` deploy, which an earlier project recorded, was not reproduced
  here and is not claimed.
- **The live endpoint cannot be sabotaged.** The sabotage was run locally (below), on a scratch clone.

## Falsifiability, run for real

- **Sabotage of the `heir` branch** in a scratch clone of this branch (`npm ci`, then `next dev --webpack -p 3457`):
  `lib/contracts/standing.ts` has no `if (heir)` branch; the guard reads the `SHAPE` table, so "disabling the
  heir branch" was removing `"heir"` from `SHAPE.inherited.required`. `GET /api/health` returned
  `HTTP/1.1 503 Service Unavailable`, `"status":"degraded"`, `"1 of 3 self-checks failed"`, with assertion 3 at
  `"expected":"missing-field/inherited/heir","actual":"ok","pass":false` and the other two `true`. After
  `git checkout -- lib/contracts/standing.ts` in the scratch clone the same server returned `200` and
  `"status":"ok"`. The dev server was killed and port 3457 checked free. The same sabotage also turned
  `npm run typecheck` red (`TS2344` at `standing.ts(156,10)`, the `Assert<Equal<...>>` that ties the table to the
  types) and `npm test` red (13 failed, 131 passed, in `route.test.ts`, `integrity.test.ts`, `standing.test.ts`
  and `type-proofs.test.ts`), so the heir field is guarded by several layers, not only by this route.
  The sabotage was never made in the checkout this branch lives in; `git diff main -- lib` is empty.
- **Mutations of `route.ts`** (each reverted with `git checkout`): always-200, a guessed fallback SHA, no
  `force-dynamic`, `status` always `"ok"`, and the guard never called each turned specific route tests red.

## Plan notes found while building

1. The plan names a "heir branch" of `assertStandingWellFormed`; the guard is table-driven, so the sabotage is
   a table edit, and it fails `typecheck` as well as the route (above).
2. Plan §6 M2 assigns `vercel.json` to M2 without saying the scaffold already shipped it (Decision 4).
3. The plan does not say that once the GitHub integration is connected every push to `main` deploys production,
   so until M2 merges, `main`'s own production build has no health route and overwrites the CLI deploy
   (Decision 7).
