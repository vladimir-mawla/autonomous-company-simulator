import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CompanyDemo from "../CompanyDemo";
import { DEFAULT_SEED, QUARTER_TICKS } from "../compute-demo-view.js";
import type { DemoState } from "../compute-demo-view.js";
import { formatTally } from "../format-attempt.js";
import { QUARTER, REPLAY, REVOKE, after, scrubTo, viewOf } from "./support/states.js";

/**
 * The page against `npm run demo:company` (plan §6 M8 falsifiable check 2: "the same table as the last block of `npm run demo:company`", which the plan says an
 * independent verifier diffs; DONE.html's deliverable gate says the live demo and the script "produce the same standings").
 *
 * THIS TEST DOES THE DIFF. It runs the script (`scripts/demo-company.ts`, as `npm run demo:company` does, through the repository's own TypeScript loader), reads the
 * standings blocks and the quarter's lines it prints, then renders the PAGE (`renderToStaticMarkup`) at the state each block is of, reads the table back out of the
 * markup, and compares line by line. The script's expectations are plan §7's, typed there; the page's numbers come from the engine through the bridge; two
 * programs that share only the engine and the domain agreeing on these lines is the evidence, and a sabotage of `lib/` that changes one of them moves one and not the other.
 *
 * What is compared, exactly: (a) the four standings blocks of the script (before the revoke, after it, at seq 18, and scrubbed back to seq 10) against the
 * rows of the page's "Who answers" table (commit id, seq, standing, and the engine-literal detail, laid out as the script lays them out);
 * (b) the revoke's `absorbed` and G1's headroom before and after; (c) the autonomous quarter's per-policy tally lines, its event and standing counts, and the oracle's
 * `bound of a limit` line, against the page's tally table, counts and conservation meter. The script is run once for the file.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const run = spawnSync(process.execPath, ["--import", "./scripts/register-ts-loader.mjs", "scripts/demo-company.ts"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 });
const lines = run.stdout.split("\n");

/** The lines of the block that follows the line which starts with `title` (up to the first line that is not indented by four spaces). */
function block(title: string): string[] {
  const at = lines.findIndex((line) => line.trimStart().startsWith(title));
  if (at < 0) throw new Error(`the script printed no line starting "${title}"`);
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && /^ {4}\S/.test(lines[i] ?? ""); i++) out.push((lines[i] ?? "").slice(4));
  return out;
}

const unescape = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

/** The page's "Who answers" table, read back out of the markup, one line per row in the script's own layout. */
function tableLines(state: DemoState): string[] {
  const markup = renderToStaticMarkup(createElement(CompanyDemo, { initial: state }));
  const rows = [...markup.matchAll(/<tr><th scope="row" class="cd-commit"><span class="cd-id">(.*?)<\/span>.*?<td class="cd-seq">(\d+)<\/td><td><span class="cd-badge cd-badge-\w+">(\w+)<\/span><\/td>.*?<code class="cd-detail">(.*?)<\/code>/g)];
  return rows.map((row) => `${unescape(row[1] ?? "").padEnd(4)} at seq ${(row[2] ?? "").padStart(2)}  ${(row[3] ?? "").padEnd(9)} ${unescape(row[4] ?? "")}`);
}

describe("the script this page is compared with", () => {
  it("exits 0 and ends with its own OK line", () => {
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("demo OK: every step got the answer plan §7 gives it");
  });

  it("ran the quarter the page's button runs: the seed and ticks are the page's constants", () => {
    expect(run.stdout).toContain(`== an autonomous quarter, seed ${DEFAULT_SEED}, ${QUARTER_TICKS} ticks:`);
  });
});

describe("the standings blocks of the script are the rows of the page's table", () => {
  it("before the revoke: the page as it opens (seq 10)", () => {
    const expected = block("standings before (log of seq 1 to 10)");
    expect(expected).toHaveLength(4);
    expect(tableLines(after())).toEqual(expected);
  });

  it("after the revoke: the page after pressing Revoke Ops-Lead (seq 11)", () => {
    const expected = block("standings after  (log of seq 1 to 11)");
    expect(expected).toHaveLength(4);
    expect(expected.filter((line) => line.includes(" inherited ")).every((line) => line.includes("heir cfo  chargedTo G1"))).toBe(true);
    expect(tableLines(after(REVOKE))).toEqual(expected);
  });

  it("at seq 18: the page after replaying the whole incident", () => {
    const expected = block("final standings");
    expect(expected).toHaveLength(10);
    expect(tableLines(after(REPLAY))).toEqual(expected);
  });

  it("scrubbed back to seq 10 on the whole incident: the script's own scrub block", () => {
    const expected = block("standings (revocation did not rewrite the past)");
    expect(expected).toHaveLength(4);
    expect(tableLines(after(REPLAY, scrubTo(10)))).toEqual(expected);
  });
});

describe("the revoke's numbers", () => {
  it("absorbed 220000 and G1's headroom 500000 -> 680000 are what the page shows", () => {
    expect(run.stdout).toContain("absorbed (engine: lib/allowance absorbedBy G2) = 220000");
    expect(run.stdout).toContain("returned = limit(G2) 400000 - absorbed = 180000");
    expect(run.stdout).toContain("G1 headroom: 500000 -> 680000");
    const flat = (nodes: ReturnType<typeof viewOf>["grants"]): ReturnType<typeof viewOf>["grants"][number][] => nodes.flatMap((n) => [n, ...flat(n.children)]);
    const g = (state: DemoState, id: string) => flat(viewOf(state).grants).find((n) => n.grant.id === id);
    expect(g(after(REVOKE), "G2")?.absorbed).toBe(220000);
    expect(g(after(REVOKE), "G2")?.returned).toBe(180000);
    expect([g(after(), "G1")?.headroom, g(after(REVOKE), "G1")?.headroom]).toEqual([500000, 680000]);
  });
});

describe("the last block of the script, the autonomous quarter, is what the page shows after Autonomous quarter (seed 1)", () => {
  const view = viewOf(after(QUARTER));

  it("every per-policy line of the script is a row of the page's tally, in the same order, with the same wording", () => {
    const tallyLines = view.tally.map((row) => `${row.source.padEnd(18)} ${String(row.total).padStart(3)} attempts   ${row.outcomes.map((o) => formatTally(o.what, o.count)).join("; ")}`);
    expect(tallyLines).toHaveLength(5);
    for (const line of tallyLines) expect(run.stdout).toContain(`  ${line}\n`);
    // and the script prints no other per-policy line: the five it printed are the five on the page
    const printed = lines.filter((line) => / attempts {3}/.test(line) && /Policy/.test(line));
    expect(printed.map((line) => line.trim())).toEqual(tallyLines.map((line) => line.trim()));
  });

  it("the event count and the standings counts", () => {
    const counts = Object.entries(view.counts).sort().map(([kind, count]) => `${kind} x${count}`).join(" ");
    expect(run.stdout).toContain(`the quarter's log: ${view.head} admitted events; standings ${counts}\n`);
  });

  it("the oracle's line: the amount bound against the root's limit (the quarter has one root, G1)", () => {
    expect(view.grants.map((root) => root.grant.id)).toEqual(["G1"]);
    expect(run.stdout).toContain(`  oracle: root G1: ${view.meter.bound} bound of a limit of ${view.meter.rootLimit}\n`);
  });

  it("the same for the whole incident: root G1, 242000 bound of 1000000", () => {
    const whole = viewOf(after(REPLAY));
    expect(run.stdout).toContain(`  root G1: ${whole.meter.bound} bound of a limit of ${whole.meter.rootLimit}   (checked at every prefix, seq 1 to 18: 18 prefixes)`);
  });
});
