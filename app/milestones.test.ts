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

/** DONE.html with milestone `id`'s pill set to `state` (unchanged if it already is). */
const setPill = (html: string, id: number, state: "done" | "todo"): string =>
  html.replace(new RegExp(`(<tr><td>M${id}<\\/td>(?:(?!<\\/tr>)[\\s\\S])*?<span class="pill )[a-z]+(">)[a-z]+(<\\/span>)`), `$1${state === "done" ? "ok" : "todo"}$2${state}$3`);

/** The same, but the result must differ from the input, or the tooth that uses it would be vacuous. */
function flipPill(html: string, id: number, state: "done" | "todo"): string {
  const flipped = setPill(html, id, state);
  if (flipped === html) throw new Error(`flipPill(${id}, ${state}) changed nothing: the pill is already that or the row was not found`);
  return flipped;
}

/**
 * A pair that agrees by construction: `done` are the milestones both sources call done, whatever the real files say. Every tooth starts from one, so a tooth
 * holds at every point of the project (before and after any mark-done pull request) and a real disagreement elsewhere cannot add an id to its expected answer.
 */
function agreeing(done: readonly number[]): { milestones: Milestone[]; html: string } {
  let html = DONE_HTML_TEXT;
  for (let id = 1; id <= 9; id++) html = setPill(html, id, done.includes(id) ? "done" : "todo");
  return { milestones: MILESTONES.map((milestone) => ({ ...milestone, status: done.includes(milestone.id) ? "done" : "planned" })), html };
}

const withStatus = (milestones: readonly Milestone[], id: number, status: Milestone["status"]): Milestone[] =>
  milestones.map((milestone) => (milestone.id === id ? { ...milestone, status } : milestone));

describe("TEETH: the guard reports a disagreement in either direction, whatever the real state is", () => {
  const base = agreeing([1, 2, 3, 4, 5, 6, 7]);

  it("the constructed pair agrees, and its parse is what it was built to be", () => {
    expect(doneIn(base.html)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(claimedDone(base.milestones)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(disagreement(base.milestones, base.html)).toEqual([]);
  });

  it("DONE.html says M9 is done and the module does not: M9 is reported", () => {
    const html = flipPill(base.html, 9, "done");
    expect(doneIn(html)).toContain(9);
    expect(disagreement(base.milestones, html)).toEqual([9]);
  });

  it("the module claims M8 done and DONE.html does not: M8 is reported", () => {
    expect(disagreement(withStatus(base.milestones, 8, "done"), base.html)).toEqual([8]);
  });

  it("DONE.html marks M3 not done and the module says done: M3 is reported", () => {
    const html = flipPill(base.html, 3, "todo");
    expect(doneIn(html)).not.toContain(3);
    expect(disagreement(base.milestones, html)).toEqual([3]);
  });

  it("both sources moved together (a mark-done pull request) is not a disagreement", () => {
    const both = agreeing([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(disagreement(both.milestones, both.html)).toEqual([]);
    expect(disagreement(withStatus(base.milestones, 8, "done"), both.html)).toEqual([]);
  });

  it("a page whose table was reshaped parses to no rows, which the first test above turns red", () => {
    expect(pillsIn("<table><tr><th>nothing</th></tr></table>")).toEqual([]);
  });
});
