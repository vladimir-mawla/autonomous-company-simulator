import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Do the documents' claims still point at something? (`.genesis/PLAN.md` section 6, M9.)
 *
 * The plan asks that "every backticked `lib/**` / `tests/failures/**` test path in `README.md` and `docs/ARCHITECTURE.md` exists, and every quoted test
 * name occurs as a substring of that file", and that `docs/THESIS.md` is at most 300 words. This file does both, and four things beside them that the
 * M9 brief asks of a document and that a person would otherwise have to remember:
 *
 *   1. CITATION FORM. A citation is a backticked repository path (under `lib/`, `domains/`, `components/`, `app/`, `tests/` or `scripts/`, ending `.ts` or
 *      `.tsx`), optionally followed by ` › "title"`. The path must exist. When a title is given the path must be a test file, the title must occur in the
 *      file, and the occurrence must be on a line that opens an `it(`, `test(` or `describe(` (so a title that only survives in a comment, or in a
 *      string that is not a test name, is reported). A title is matched as a substring, so a cited prefix of a longer test name is allowed.
 *   2. EVERY FAILURE CASE IS LISTED. Each file `tests/failures/NN-*.test.ts` is cited, with a title, in `README.md` (the plan: Honest limits "listing every M7 case").
 *   3. NO LINE NUMBERS. `file.ts:123` goes stale on the next edit; a citation is a file and a title.
 *   4. THE THESIS is at most 300 words, counted as `wc -w` counts (runs of non-whitespace) over the whole file, heading included.
 *   5. THE LOOM NARRATION fits 90 seconds: the lines of `docs/WALKTHROUGH.md` that begin with `> ` are what is said aloud, and they total at most 230 words
 *      (150 words a minute is the rate assumed; the file says so). The number is a bound on the text, not a measurement of anyone's speech.
 *
 * WHAT THIS DOES NOT CHECK. That a cited test asserts what the sentence next to it says: only a person reading both can do that, and the L4 verifier did.
 * That a sentence without a citation is true. That a number in prose matches the code. A title that appears in a test file is not shown to be a test that
 * can fail. The scan reads Markdown by pattern; a citation written in another form (for example a path in a link, not in backticks) is not seen.
 */

const REPO = join(import.meta.dirname, "..", "..");

export interface Citation {
  readonly path: string;
  readonly title: string | null;
  readonly line: number;
}

const CITATION = /`((?:lib|domains|components|app|tests|scripts)\/[^`\s*]+\.tsx?)`(?: › "([^"]+)")?/g;
const TEST_FILE = /\.test\.tsx?$/;
const TEST_OPENER = /\b(?:it|test|describe)(?:\.each\b.*?)?\(/;

export function findCitations(markdown: string): Citation[] {
  const found: Citation[] = [];
  markdown.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(CITATION)) {
      found.push({ path: match[1] ?? "", title: match[2] ?? null, line: index + 1 });
    }
  });
  return found;
}

/** The problems with `markdown`'s citations, read against the tree at `root`; empty when there are none. */
export function citationProblems(markdown: string, root: string, name: string): string[] {
  const problems: string[] = [];
  for (const { path, title, line } of findCitations(markdown)) {
    const where = `${name} line ${line}: ${path}`;
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      problems.push(`${where}: no such file`);
      continue;
    }
    if (title === null) continue;
    if (!TEST_FILE.test(path)) {
      problems.push(`${where}: a title is cited, but this is not a test file`);
      continue;
    }
    const source = readFileSync(absolute, "utf8");
    if (!source.includes(title)) {
      problems.push(`${where}: the title is not in the file: "${title}"`);
      continue;
    }
    const onATestLine = source.split("\n").some((sourceLine) => sourceLine.includes(title) && TEST_OPENER.test(sourceLine));
    if (!onATestLine) problems.push(`${where}: the title occurs, but not on a line that opens an it, test or describe: "${title}"`);
  }
  return problems;
}

export function lineNumberCitations(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => /\.(?:tsx?|mjs|json|md):\d+/.test(text))
    .map(({ text, line }) => `line ${line}: ${text.trim().slice(0, 80)}`);
}

export const wordCount = (text: string): number => text.split(/\s+/).filter((word) => word.length > 0).length;

/** The words spoken in the walkthrough: every line that begins with `> `, without the marker. */
export function narrationOf(markdown: string): string {
  return markdown
    .split("\n")
    .filter((text) => text.startsWith("> "))
    .map((text) => text.slice(2))
    .join("\n");
}

const read = (relative: string): string => readFileSync(join(REPO, relative), "utf8");

const README = read("README.md");
const ARCHITECTURE = read("docs/ARCHITECTURE.md");
const THESIS = read("docs/THESIS.md");
const WALKTHROUGH = read("docs/WALKTHROUGH.md");
const NOTES = read("docs/NOTES.md");

describe("this repository: README.md and docs/ARCHITECTURE.md cite files and tests that exist", () => {
  it("README.md has no citation problem", () => {
    expect(citationProblems(README, REPO, "README.md")).toEqual([]);
  });

  it("docs/ARCHITECTURE.md has no citation problem", () => {
    expect(citationProblems(ARCHITECTURE, REPO, "docs/ARCHITECTURE.md")).toEqual([]);
  });

  it("the scan really saw citations (an empty scan would pass the two tests above): each document cites at least its floor of files, and of those with a title", () => {
    // Floors, not counts: they are set below what each document has, so that deleting most of a document's citations fails and adding one does not.
    for (const [name, text, all, titled] of [["README.md", README, 15, 12], ["docs/ARCHITECTURE.md", ARCHITECTURE, 40, 25]] as const) {
      const citations = findCitations(text);
      expect(citations.length, name).toBeGreaterThanOrEqual(all);
      expect(citations.filter((citation) => citation.title !== null).length, name).toBeGreaterThanOrEqual(titled);
    }
  });

  it("docs/NOTES.md and docs/WALKTHROUGH.md have no citation problem either", () => {
    expect(citationProblems(NOTES, REPO, "docs/NOTES.md")).toEqual([]);
    expect(citationProblems(WALKTHROUGH, REPO, "docs/WALKTHROUGH.md")).toEqual([]);
  });
});

describe("every failure case of tests/failures is listed in README.md, with a title", () => {
  const cases = readdirSync(join(REPO, "tests", "failures")).filter((file) => /^\d\d-.*\.test\.ts$/.test(file));

  it("there are failure case files to check (an empty directory would pass the test below)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(11);
  });

  it("each is cited in README.md with a title", () => {
    const cited = new Set(findCitations(README).filter((citation) => citation.title !== null).map((citation) => citation.path));
    expect(cases.filter((file) => !cited.has(`tests/failures/${file}`))).toEqual([]);
  });
});

describe("no document cites a line number", () => {
  it("README.md and docs/*.md have no `file:123` form", () => {
    expect([...lineNumberCitations(README), ...lineNumberCitations(ARCHITECTURE), ...lineNumberCitations(THESIS), ...lineNumberCitations(WALKTHROUGH), ...lineNumberCitations(NOTES)]).toEqual([]);
  });
});

describe("docs/THESIS.md is at most 300 words", () => {
  it("counts as wc -w counts, the heading included", () => {
    expect(wordCount(THESIS)).toBeLessThanOrEqual(300);
  });

  it("and is not trivially empty", () => {
    expect(wordCount(THESIS)).toBeGreaterThanOrEqual(150);
  });
});

describe("docs/WALKTHROUGH.md: the narration is what a 90-second take can say", () => {
  it("the lines beginning with `> ` total at most 230 words (150 words a minute for 90 seconds is 225)", () => {
    const words = wordCount(narrationOf(WALKTHROUGH));
    expect(words).toBeLessThanOrEqual(230);
    expect(words).toBeGreaterThanOrEqual(120);
  });
});

describe("README.md carries the deliverables the plan names", () => {
  it("states the live URL", () => {
    expect(README).toContain("https://autonomous-company-simulator.vercel.app");
  });

  it("gives the clean-clone commands in the plan's order", () => {
    const order = ["git clone", "npm ci", "npm run typecheck", "npm test", "npm run build"].map((command) => README.indexOf(command));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("has an Honest limits section", () => {
    expect(README).toMatch(/^## Honest limits$/m);
  });
});

describe("TEETH: the checker reports what it claims to, on a synthetic tree", () => {
  const SOURCE = [
    'import { describe, it } from "vitest";',
    '// "a title that only a comment holds"',
    'describe("the suite", () => {',
    '  it("a real title that is a test", () => {});',
    '  it.each([1])("a table title: %s", () => {});',
    "});",
    "",
  ].join("\n");

  function tree(): { root: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "acs-docs-citations-"));
    for (const [path, text] of [["lib/x/__tests__/a.test.ts", SOURCE], ["lib/x/a.ts", "export const a = 1;\n"]] as const) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  const cite = (path: string, title?: string): string => (title === undefined ? `see \`${path}\`` : `see \`${path}\` › "${title}"`);

  it("accepts a file, a test title, a prefix of a test title, a describe title and a table title", () => {
    const { root, cleanup } = tree();
    try {
      for (const text of [
        cite("lib/x/a.ts"),
        cite("lib/x/__tests__/a.test.ts", "a real title that is a test"),
        cite("lib/x/__tests__/a.test.ts", "a real title"),
        cite("lib/x/__tests__/a.test.ts", "the suite"),
        cite("lib/x/__tests__/a.test.ts", "a table title"),
      ]) {
        expect(citationProblems(text, root, "doc")).toEqual([]);
      }
    } finally {
      cleanup();
    }
  });

  it("reports a missing file, a title that is not in the file, a title only a comment holds, and a title cited on a source file", () => {
    const { root, cleanup } = tree();
    try {
      expect(citationProblems(cite("lib/x/__tests__/gone.test.ts"), root, "doc")).toEqual(["doc line 1: lib/x/__tests__/gone.test.ts: no such file"]);
      expect(citationProblems(cite("lib/x/__tests__/a.test.ts", "not a title here"), root, "doc")).toEqual([
        'doc line 1: lib/x/__tests__/a.test.ts: the title is not in the file: "not a title here"',
      ]);
      expect(citationProblems(cite("lib/x/__tests__/a.test.ts", "a title that only a comment holds"), root, "doc")).toEqual([
        'doc line 1: lib/x/__tests__/a.test.ts: the title occurs, but not on a line that opens an it, test or describe: "a title that only a comment holds"',
      ]);
      expect(citationProblems(cite("lib/x/a.ts", "export"), root, "doc")).toEqual(["doc line 1: lib/x/a.ts: a title is cited, but this is not a test file"]);
    } finally {
      cleanup();
    }
  });

  it("SABOTAGE: renaming a cited test file turns a passing citation into a reported one", () => {
    const { root, cleanup } = tree();
    try {
      const text = cite("lib/x/__tests__/a.test.ts", "a real title that is a test");
      expect(citationProblems(text, root, "doc")).toEqual([]);
      renameSync(join(root, "lib/x/__tests__/a.test.ts"), join(root, "lib/x/__tests__/b.test.ts"));
      expect(citationProblems(text, root, "doc")).toEqual(["doc line 1: lib/x/__tests__/a.test.ts: no such file"]);
    } finally {
      cleanup();
    }
  });

  it("reads the line of each citation, sees two on one line, and ignores a path outside the six roots or without a backtick", () => {
    const text = ["nothing", "`lib/a.ts` and `tests/b.test.ts` › \"t\"", "docs/x.ts without backticks", "`docs/x.ts` is not under a root"].join("\n");
    expect(findCitations(text)).toEqual([
      { path: "lib/a.ts", title: null, line: 2 },
      { path: "tests/b.test.ts", title: "t", line: 2 },
    ]);
  });

  it("finds line-number citations, and only those", () => {
    expect(lineNumberCitations("see lib/a.ts:12 here\nsee lib/a.ts there\nport localhost:3000")).toEqual(["line 1: see lib/a.ts:12 here"]);
  });

  it("counts words as wc -w does, and takes only the `> ` lines as narration", () => {
    expect(wordCount("  one two\nthree\t four  ")).toBe(4);
    expect(narrationOf("# head\n> said one\nnot said\n> said two")).toBe("said one\nsaid two");
    expect(wordCount(narrationOf("> a b c\n> d e"))).toBe(5);
  });
});
