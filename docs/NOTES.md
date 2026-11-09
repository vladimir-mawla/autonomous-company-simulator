# Process record

How this repository was built, as the project's own records state it. Where a sentence is about a milestone's review history it is taken from `.genesis/checkpoints/CURRENT.md` as of the `mark M8 done` PR (#17, merge commit `2d906db`) and is that file's account, not something re-measured here. Where it is about M9, it was done in the M9 pull request, whose description holds the command output.

## How the work was organised

The plan, `.genesis/PLAN.md`, divides the work into nine milestones, each one pull request on its own branch, each with its own ADR in `.genesis/decisions/`, and each reviewed by a verifier (L4) that is not the builder (L1) before a separate `chore(genesis): mark MN done` bookkeeping pull request. Directory ownership is the plan's table; a milestone may not edit another's paths, and the bookkeeping PRs edit only `.genesis/DONE.html`, `.genesis/checkpoints/CURRENT.md` and a status line in `app/milestones.ts`. `app/milestones.test.ts` fails when the page's list of done milestones and `DONE.html` disagree.

## The milestones

| | What | PR | Review, per `CURRENT.md` |
|---|---|---|---|
| M1 | contracts (`lib/contracts`) | #2 | APPROVE in round 3, after three fix rounds |
| M2 | deploy skeleton, `/api/health` | #4 | APPROVE in round 3, after two fix rounds |
| M3 | chain: intake and structure | #6 | APPROVE in round 2, after one fix round |
| M4 | allowance: conservation | #8 | APPROVE in round 2, after one fix round |
| M5 | standing: fold, verdict, heir | #10 | APPROVE in round 5, after four fix rounds |
| M6 | domain: Meridian Supply Co. | #12 | one full pass and one targeted close, each REQUEST CHANGES, then two fix rounds; the last was approved by the orchestrator's mechanical check on the verifier's statement, not by a third independent pass |
| M7 | the failure suite | #14 | APPROVE at the first full pass with three non-blocking items, three fix commits, a targeted close APPROVE |
| M8 | the interactive demo | #16 | REQUEST CHANGES at the first full pass (one high defect in the mark-done wiring and three smaller items), a fix round, a targeted close APPROVE |
| M9 | deliverables | the pull request that carries this file | reviewed after it is opened; not stated here |

`main` was rewritten once on 2026-10-24 to correct commit attribution; only metadata changed, and `CURRENT.md` has the table of pre-rewrite and current SHAs.

## What the review history shows, and does not

The rounds were not spread evenly: M5 took five and M1 three, while M3 and M4 took two each. By the records, the documents and comments that make a claim about the code were a recurring place for defects. That is an observation about one project's records, not a rate. It is the reason M9's checks are mechanical where they can be: `tests/docs/citations.test.ts` fails when a cited file is missing or a cited test title is not in its file, and bounds the thesis and the Loom narration by word count.

## What M9 did

- Rewrote `README.md` (the claim, the live URL, the clean-clone commands, the honest limits listing each of the eleven failure cases, and a note on the frozen files whose text has gone stale).
- Wrote `docs/ARCHITECTURE.md`, `docs/THESIS.md`, `docs/WALKTHROUGH.md` and this file, and `tests/docs/citations.test.ts`.
- Wrote ADR `0009-deliverables.md`.
- Edited no other file. Nothing under `lib/`, `domains/`, `scripts/`, `components/` or `app/` was touched, and `.genesis/PLAN.md`, `.genesis/DONE.html` and `app/milestones.ts` were left to the mark-done pull request.
- Ran every command the README gives from a fresh clone and pasted the output into the pull request description.

## Deviations and gaps, stated

- **The Loom is not recorded.** The script is `docs/WALKTHROUGH.md`; recording it is a human step, as the plan says.
- **The live click path was checked once, by hand, by the orchestrating agent, on 2026-11-09,** against the deployment at commit `2d906db`. The M9 builder clicked nothing. What the check did not cover is listed in `docs/WALKTHROUGH.md`. The plan's outline for the Loom (section 15) has a beat that depends on the "Replay the whole incident" button, which that check did not press; the script leaves the beat out and says why.
- **The deployment's health commit will change** when this pull request is merged and Vercel redeploys `main`. The README quotes what it answered on 2026-11-09, dated.
- **Frozen files are not corrected.** The README names the classes of stale text. The plan's rule is that a milestone may not edit another's paths.
