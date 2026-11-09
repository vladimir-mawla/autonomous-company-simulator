import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MILESTONES, currentMilestone } from "./milestones";
import type { Milestone } from "./milestones";

/**
 * The live page must not claim progress `.genesis/DONE.html` does not have (plan §6 M8: "compare claimed-done milestones with `.genesis/DONE.html`").
 *
 * The property: THE SET OF MILESTONES CLAIMED DONE IS THE SAME IN BOTH PLACES. The not-done states are not compared (`todo` and `wip` against
 * `in-progress` and `planned` differ on purpose: see `app/milestones.ts`).
 *
 * HOW THE HTML IS READ. A row of the status table is `<tr><td>M8</td> ... <span class="pill todo">todo</span></td></tr>`; the guard reads, per
 * row, the id and the text of the LAST pill in the row (the status cell is the last). It is a regular expression over a hand-written page: if the table is reshaped the
 * first test below goes red (it asserts the nine ids were found, in order) and a green result cannot be an empty parse.
 *
 * TEETH. `doneIn` takes the HTML as a string, so the cases below feed it pages with one pill flipped and a module with one status flipped, and
 * expect the disagreement to be reported: the check is shown to be able to fail, not only to pass on today's two files.
 */

const DONE_HTML_TEXT = readFileSync(new URL("../.genesis/DONE.html", import.meta.url), "utf8");

interface Pill {
  readonly id: number;
  readonly state: string;
}

function pillsIn(html: string): Pill[] {
  const rows = html.matchAll(/<tr><td>M(\d+)<\/td>((?:(?!<\/tr>)[\s\S])*)<\/tr>/g);
  const out: Pill[] = [];
  for (const row of rows) {
    const pills = [...(row[2] ?? "").matchAll(/<span class="pill[^"]*">([a-z]+)<\/span>/g)];
    const last = pills[pills.length - 1];
    if (last !== undefined) out.push({ id: Number(row[1]), state: last[1] ?? "" });
  }
  return out;
}

const doneIn = (html: string): number[] => pillsIn(html).filter((pill) => pill.state === "done").map((pill) => pill.id);
const claimedDone = (milestones: readonly Milestone[]): number[] => milestones.filter((milestone) => milestone.status === "done").map((milestone) => milestone.id);

/** The ids the two sources disagree on (in either direction). */
function disagreement(milestones: readonly Milestone[], html: string): number[] {
  const mine = new Set(claimedDone(milestones));
  const theirs = new Set(doneIn(html));
  return [...new Set([...mine, ...theirs])].filter((id) => mine.has(id) !== theirs.has(id)).sort((a, b) => a - b);
}

describe("app/milestones.ts agrees with .genesis/DONE.html about which milestones are done", () => {
  it("finds the nine status rows of DONE.html, M1 to M9 in order, each with a pill (an empty parse would make the rest vacuous)", () => {
    expect(pillsIn(DONE_HTML_TEXT).map((pill) => pill.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pillsIn(DONE_HTML_TEXT).every((pill) => ["done", "todo", "wip"].includes(pill.state))).toBe(true);
  });

  it("lists the same nine milestones, M1 to M9 in order", () => {
    expect(MILESTONES.map((milestone) => milestone.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("claims exactly the milestones DONE.html marks done", () => {
    expect(claimedDone(MILESTONES)).toEqual(doneIn(DONE_HTML_TEXT));
    expect(disagreement(MILESTONES, DONE_HTML_TEXT)).toEqual([]);
  });

  it("the page's current milestone is one that is not done, or none when all nine are", () => {
    const current = currentMilestone();
    expect(current === undefined || current.status !== "done").toBe(true);
    if (current === undefined) expect(claimedDone(MILESTONES)).toHaveLength(9);
  });
});

/** DONE.html with milestone `id`'s pill forced to `state`, whatever it is in the real file; the result must differ from the input or the tooth would be vacuous. */
function withPill(html: string, id: number, state: "done" | "todo"): string {
  const forced = html.replace(new RegExp(`(<tr><td>M${id}<\\/td>(?:(?!<\\/tr>)[\\s\\S])*?<span class="pill )[a-z]+(">)[a-z]+(<\\/span>)`), `$1${state === "done" ? "ok" : "todo"}$2${state}$3`);
  if (forced === html) throw new Error(`withPill(${id}, ${state}) changed nothing: the pill is already that or the row was not found`);
  return forced;
}

/** The module's milestones with `id`'s status forced. */
const withStatus = (id: number, status: Milestone["status"]): Milestone[] => MILESTONES.map((milestone) => (milestone.id === id ? { ...milestone, status } : milestone));

// The cases below FORCE the state they test, so they hold at every point of the project (before and after any mark-done pull request) and need no edit when one lands.
// The base is the real pair after the other ids are made to agree: `agreeing(id)` forces both sources to say "not done" for `id`.
const agreeing = (id: number): { milestones: Milestone[]; html: string } => ({
  milestones: withStatus(id, "planned"),
  html: doneIn(DONE_HTML_TEXT).includes(id) ? withPill(DONE_HTML_TEXT, id, "todo") : DONE_HTML_TEXT,
});

describe("TEETH: the guard reports a disagreement in either direction, whatever the real state is", () => {
  it("DONE.html says M9 is done and the module does not: M9 is reported", () => {
    const base = agreeing(9);
    const flipped = withPill(base.html, 9, "done");
    expect(doneIn(flipped)).toContain(9);
    expect(disagreement(base.milestones, base.html)).toEqual([]);
    expect(disagreement(base.milestones, flipped)).toEqual([9]);
  });

  it("the module claims M8 done and DONE.html does not: M8 is reported", () => {
    const base = agreeing(8);
    expect(disagreement(withStatus(8, "done"), base.html)).toEqual([8]);
  });

  it("DONE.html marks M3 not done and the module says done: M3 is reported", () => {
    const html = withPill(DONE_HTML_TEXT, 3, "todo");
    expect(doneIn(html)).not.toContain(3);
    expect(disagreement(withStatus(3, "done"), html)).toEqual([3]);
  });

  it("a page whose table was reshaped parses to no rows, which the first test above turns red", () => {
    expect(pillsIn("<table><tr><th>nothing</th></tr></table>")).toEqual([]);
  });
});
