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

describe("TEETH: the guard reports a disagreement in either direction", () => {
  it("DONE.html has M9 flipped to done and the module does not: M9 is reported", () => {
    const flipped = DONE_HTML_TEXT.replace(/(<tr><td>M9<\/td>(?:(?!<\/tr>)[\s\S])*?<span class="pill )todo(">)todo(<\/span>)/, "$1ok$2done$3");
    expect(flipped).not.toBe(DONE_HTML_TEXT);
    expect(doneIn(flipped)).toContain(9);
    expect(disagreement(MILESTONES, flipped)).toEqual([9]);
  });

  it("the module claims M8 done and DONE.html does not: M8 is reported", () => {
    const claimed = MILESTONES.map((milestone) => (milestone.id === 8 ? { ...milestone, status: "done" as const } : milestone));
    expect(disagreement(claimed, DONE_HTML_TEXT)).toEqual([8]);
  });

  it("DONE.html marks M3 not done and the module says done: M3 is reported", () => {
    const unflipped = DONE_HTML_TEXT.replace(/(<tr><td>M3<\/td>(?:(?!<\/tr>)[\s\S])*?<span class="pill )ok(">)done(<\/span>)/, "$1todo$2todo$3");
    expect(unflipped).not.toBe(DONE_HTML_TEXT);
    expect(disagreement(MILESTONES, unflipped)).toEqual([3]);
  });

  it("a page whose table was reshaped parses to no rows, which the first test above turns red", () => {
    expect(pillsIn("<table><tr><th>nothing</th></tr></table>")).toEqual([]);
  });
});
