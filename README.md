# Autonomous Company Simulator

Who answers for what an organisation of autonomous agents has done.

The idea, in one paragraph: authority is **conserved** when it is delegated, revocation reaches **only
the future**, and every commitment an agent makes is ruled **binding**, **inherited** or **void**
against the record as it stood when the act was made. So no agent can act past its mandate,
re-delegate more than it holds, or leave an act with no one answerable. The full claim, the closed
vocabulary and the nine-milestone plan are in [`.genesis/PLAN.md`](.genesis/PLAN.md); the locked spec
and the definition of done are in [`.genesis/DONE.html`](.genesis/DONE.html).

## Status: in progress, nothing built yet

**Live:** none yet. Nothing is deployed and there is no URL.

This repository is a **genesis scaffold only**: the tooling skeleton, a placeholder home page, one smoke
test, a CI workflow and the planning documents. There is **no engine code and no domain logic**; all
nine milestones are `todo`. The idea above is a design, not something that runs yet. Each milestone
lands as its own PR and is checked by an independent verifier before it is marked done.

`npm run demo:company` is wired in `package.json` but its script does not exist until milestone M6, so
it fails today.

## Stack

- Next.js 16 (App Router) and React 19, TypeScript 7, Vitest, Node 24
- Built with the **webpack** bundler explicitly (`next dev --webpack`, `next build --webpack`) and
  `experimental.extensionAlias` in `next.config.ts`. Turbopack, Next 16's default, cannot resolve the
  NodeNext-style `.js`-suffixed relative imports the engine will use; the comment in `next.config.ts`
  has the full reasoning, and `tests/smoke.test.ts` pins both facts.
- `vercel.json` pins `npm ci` and `npm run build` so a Vercel deploy cannot fall back to Turbopack.
- No new dependencies beyond that stack, and no credentials are needed to run anything here
  (see `.env.example`).

## Running it

```bash
git clone https://github.com/vladimir-mawla/autonomous-company-simulator.git
cd autonomous-company-simulator
npm ci              # not `npm install`; see the note below
npm run typecheck   # tsc against tsconfig.lib.json, then tsconfig.json
npm test            # vitest
npm run build       # next build --webpack
npm run dev         # local dev server (webpack)
npm run lint        # eslint, JavaScript and config files only; see below
```

**Use `npm ci`, never `npm install`, to restore dependencies.** npm 11.5.1 can silently drop the
platform-specific `@rolldown/binding-*` package that Vitest needs when it reconciles against an
existing lockfile, and `npm test` then fails with a bare "Cannot find native binding" that does not
point at the install. `npm ci` does not do this, and the committed lockfile already lists all 15
rolldown platform bindings.

**`npm run lint` does not check TypeScript.** `typescript-eslint` refuses to load on TypeScript 7, so
`eslint.config.mjs` ignores every `.ts` and `.tsx` file. `npm run typecheck` is the real check for
those, and CI runs it.
