/**
 * The nine milestones as the landing page shows them: one array, read by `app/page.tsx` and by nothing that writes a milestone number into
 * prose. `.genesis/PLAN.md` §6 is the plan and `.genesis/DONE.html` is the checked list; this is the mirror a stranger reads on the live page, and
 * `app/milestones.test.ts` is what keeps it from claiming progress the project has not made (the decision-engine drift guard, ported).
 *
 * WHAT A `chore(genesis): mark MN done` PULL REQUEST MUST DO, in the same pull request (the bookkeeping exception of PLAN.md §6, "status lines in
 * `app/milestones.ts`"): flip MN's `status` to `"done"` here AND flip MN's pill in `.genesis/DONE.html` to `done`. `app/milestones.test.ts` compares
 * the SET of milestones claimed done in the two places and is red if only one was edited. Nothing else in this file changes: `currentMilestone`
 * and the page follow from the statuses, so no prose has to be found and edited.
 *
 * What the guard does not compare: the not-done states. `.genesis/DONE.html` has `todo` and `wip`; this file has `in-progress` and `planned`; they
 * describe a build state and what a visitor is told, and are allowed to differ.
 */
export interface Milestone {
  readonly id: number;
  readonly title: string;
  readonly status: "done" | "in-progress" | "planned";
}

export const MILESTONES: readonly Milestone[] = [
  { id: 1, title: "Contracts: grants, commitments, standings, breaches, rejections", status: "done" },
  { id: 2, title: "A live skeleton on Vercel", status: "done" },
  { id: 3, title: "Chain: intake and structure", status: "done" },
  { id: 4, title: "Allowance: conservation", status: "done" },
  { id: 5, title: "Standing: the ledger fold, the verdict, the heir", status: "done" },
  { id: 6, title: "Domain: Meridian Supply Co.", status: "done" },
  { id: 7, title: "The failure suite: eleven cases", status: "done" },
  { id: 8, title: "Interactive demo", status: "in-progress" },
  { id: 9, title: "Deliverables", status: "planned" },
];

/** The milestone the page calls current: the first in progress, else the first planned, else none (every milestone done). */
export function currentMilestone(): Milestone | undefined {
  return MILESTONES.find((milestone) => milestone.status === "in-progress") ?? MILESTONES.find((milestone) => milestone.status === "planned");
}
