# ADR 0009 — M9 deliverables: documents whose citations are checked by a test, a Loom script bounded by words, and a click-path record that says who clicked

- **Date:** 2026-11-09
- **Status:** proposed — written by the builder; not yet approved by an independent L4 pass
- **Phase / milestone:** M9 (BUILD) — `README.md`, `docs/ARCHITECTURE.md`, `docs/THESIS.md`, `docs/WALKTHROUGH.md`, `docs/NOTES.md`, `tests/docs/citations.test.ts`

## Context

`.genesis/PLAN.md` section 6 (M9) asks for five documents and one test, and says the milestone must refuse "a doc claim no test pins", a thesis over 300 words, and a milestone marked done that `DONE.html` disagrees with. Every earlier milestone's review found defects in prose rather than in code, so the decisions below are about making a sentence's evidence something a reader or a test can open. Command outputs for this milestone are in the pull request description, not here, so that no number in this file goes stale.

## Decision 1 — a citation is a file and a title, and a test checks the form

A citation is a backticked path under `lib/`, `domains/`, `components/`, `app/`, `tests/` or `scripts/` ending `.ts` or `.tsx`, optionally followed by ` › "title"`. `tests/docs/citations.test.ts` reads `README.md` and `docs/ARCHITECTURE.md` (and `NOTES.md` and `WALKTHROUGH.md`) and fails when a path does not exist, when a title is cited against a file that is not a test, when the title is not in the file, or when it occurs only on a line that does not open an `it`, `test` or `describe`. The plan words the check as "occurs as a substring of that file"; the last clause is stricter, so that a title surviving only in a comment does not count. Line numbers are not used anywhere: a second test fails on `file.ts:123`.

What this does not do is stated at the head of the test file: it does not check that a cited test asserts what the sentence beside it says. That is a reading, and the L4 pass is where it happens. Titles are cited as prefixes where the full title carries a template placeholder.

## Decision 2 — the README lists every failure case, and a test says so

The plan: "Honest limits listing every M7 case". A test fails if a `tests/failures/NN-*.test.ts` file is not cited with a title in the README. Each limit is worded from that file's own header, not stronger, with a DISCLOSES or PROVES label as the header gives it.

## Decision 3 — the Loom narration is bounded by words, and it is a bound on text

The plan's outline (section 15) is a timed beat list. The script's spoken lines are the ones that begin with `> `; the test bounds them at 230 words, which is 90 seconds at 150 words a minute with a little slack. That does not measure anyone's speech, and the file says so. Each beat's on-screen strings come from the click-path record (Decision 4) or from the page's own server-rendered text, which was fetched with `curl` on 2026-11-09. A beat the by-hand check did not cover is left out of the script: the plan's outline has the revoked agent's next act ruled `void: link-dead` and the cfo's cure, which on this page needs the "Replay the whole incident" button; that result is pinned by `components/company/__tests__/demo-diff.test.tsx` but was not seen by the orchestrator in a browser. The script says so in its section 3 rather than depending on it.

## Decision 4 — the live click path is recorded with who did it

The plan says the click-to-re-render path is verified by hand against the live URL and recorded in `docs/WALKTHROUGH.md`. The orchestrating agent did the check by hand on 2026-11-09 against the deployment at commit `2d906db`; `docs/WALKTHROUGH.md` copies its record and says which steps were and were not pressed (Over-delegate, Replay, Reset and the scrubber's other buttons were not; phone width, dark theme, keyboard use and other browsers were not). The builder of M9 did not click anything and the document says so. A different pressing order gives different transcript numbers, and the document says why.

## Decision 5 — the thesis is a prediction, and the word count is the whole file

`docs/THESIS.md` argues a two-year future in the plan's terms (section 14: the dispute is retroactivity). It states a claim that can be wrong and what would falsify it, and what the repository does and does not show. The test counts words as `wc -w` does over the whole file, heading included, so the number reported in the pull request is the number the test checks.

## Decision 6 — frozen files stay stale, and the README says which and why

Earlier milestones' files contain forward-looking text that was true when written ("not built", `Status: proposed`). The plan gives each milestone its own paths and the brief for this milestone forbids editing them. The README states the classes (ADR Status lines of 0001 to 0008, ADR bodies about later milestones, source comments in `lib/contracts` and two other files, and the M9 `todo` in the bookkeeping files) from `git grep -nE "not built|not yet|does not exist|nothing built|todo|proposed"` and a narrower second pattern, at the fixed commit `2d906db`, and says the list is what the searches returned and not a proof that no other line is stale. This ADR is written in the same form, so its own Status line will be in the first class.

## Decision 7 — the architecture document is a table of refusals, each with a file and a test

`docs/ARCHITECTURE.md` follows an event through the stages in the order the engine runs them and gives, for each stage, what it refuses, why (the plan's decisions D1 to D9), the file and a test. The module graph in it was read from the `from "..."` lines of the non-test sources on `main` after M8; the scans that enforce each part of it are named, with what each does not see.

## Falsifiability log

Each edit was made in the working tree, `npx vitest run tests/docs --reporter=verbose` was run, the failing tests were recorded, and the edit was reverted (`git status` clean after each).

| Edit | Result |
|---|---|
| `git mv tests/failures/03-revoke-and-regrant-cannot-mint-authority.test.ts tests/failures/03-renamed.test.ts` (a cited test file renamed) | 2 failed: `README.md has no citation problem`, `each is cited in README.md with a title` |
| in `README.md`, `child granted 60 and spent 50, revoked` changed to `child granted 61 ...` in a cited title | 1 failed: `README.md has no citation problem` |
| ten extra words appended to `docs/THESIS.md` (308 words) | 1 failed: `docs/THESIS.md is at most 300 words` |

The checker's own teeth, on a synthetic tree under the OS temporary directory, are the `TEETH` block of the test file: a missing file, a title not in the file, a title held only by a comment, a title cited on a source file, and the rename case.

## Not verified, and what is stated and not pinned by a test

- That any sentence of the documents is what the test beside it asserts: read by the builder, not checked by a program.
- That a sentence without a citation is true. The README's Stack paragraph and the first paragraph of the claim are not cited sentence by sentence.
- The Loom: not recorded. The narration bound is on text.
- The deployed page after this pull request merges: the health commit will change; the README quotes the earlier one and dates it.
- The architecture document's module graph is not tested as a whole; `lib/` is (the closed-graph scan), the rest is the two source scans' narrower rules plus the builder's reading.
