import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/**
 * WHY THIS FILE EXISTS: a `// @ts-expect-error` line proves only that SOME
 * error occurs on the next line. Three ordinary ways for that to be a false
 * proof, each reproduced against this repo's own compiler settings before this
 * harness was written:
 *
 *  1. `noUnusedLocals` is on in both tsconfigs. `const a: Standing = x;` with
 *     `a` never read errors with TS6133 whatever `Standing` looks like, so the
 *     directive above it is satisfied even if the assignment is perfectly legal.
 *  2. `const x = { kind: "void", ... }` (no `as const`) widens `kind` to
 *     `string`, so `const a: Standing = x` fails on `kind`, not on the field the
 *     proof is about.
 *  3. A fresh object literal can fail on EXCESS-PROPERTY grounds (TS2353) even
 *     when the field is not forbidden by assignability at all, which is the very
 *     weakness the seven non-literal routes exist to expose.
 *
 * `npm run typecheck` cannot see any of this: it reports TS2578 only when the
 * line has NO error. So every proof file under `__tests__/proofs/` is ALSO
 * compiled by this harness with every `@ts-expect-error` removed, and each
 * removed directive must now be matched by a diagnostic that has the stated
 * code and carries the stated message fragment, with nothing else on that line
 * and no diagnostic anywhere else in the file.
 *
 * DIRECTIVE FORMAT (the only form accepted; anything else in a proof file is a
 * problem, including `@ts-ignore` and `@ts-nocheck`):
 *
 *     // @ts-expect-error TS2322 Types of property 'warrant' are incompatible
 *     // @ts-expect-error TS2322|TS2741 Property 'heir' is missing
 *
 * `TS<code>` is one or more `|`-separated codes; the rest of the line is a
 * message fragment that must occur verbatim in the diagnostic's text (the
 * message and its elaboration chain, joined). TypeScript ignores trailing text
 * on a `@ts-expect-error`, so the same line still works for `npm run typecheck`.
 *
 * Each proof file is compiled under BOTH of this repo's tsconfigs
 * (`tsconfig.lib.json`, which has `exactOptionalPropertyTypes`, and
 * `tsconfig.json`, which does not and is what `app/` and `components/` use),
 * because the claim "this does not compile" is only worth making for the
 * settings a consumer actually compiles under.
 *
 * WHAT THIS DOES NOT DO: it does not prove a proof file's routes are the right
 * routes, or that a route list is complete. It checks that each route that IS
 * written fails for the stated reason under both configs.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const TSC = join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

/** The two compile settings every proof is checked under. */
export const PROOF_CONFIGS = ["tsconfig.lib.json", "tsconfig.json"] as const;

const PROOF_FILE = "proof.ts";
const DIRECTIVE = /^\s*\/\/ @ts-expect-error (TS\d+(?:\|TS\d+)*) (\S.*)$/;
const ANY_SUPPRESSION = /@ts-(?:expect-error|ignore|nocheck)/;

interface Directive {
  readonly line: number;
  readonly codes: readonly number[];
  readonly fragment: string;
}

interface Diag {
  /** The path as tsc prints it (relative, and spelled differently on macOS where the temp dir is a symlink). */
  readonly file: string;
  readonly line: number;
  readonly code: number;
  readonly text: string;
}

/** Everything the harness found wrong, as sentences; empty means the proof file is sound. */
export interface ProofReport {
  readonly directives: number;
  readonly problems: readonly string[];
}

function parseDirectives(lines: readonly string[], problems: string[]): Directive[] {
  const directives: Directive[] = [];
  lines.forEach((text, index) => {
    const line = index + 1;
    if (!ANY_SUPPRESSION.test(text)) return;
    const match = DIRECTIVE.exec(text);
    if (match === null) {
      problems.push(
        `line ${line}: suppression comment is not in the accepted form ` +
          "`// @ts-expect-error TS<code>[|TS<code>] <message fragment>`: " +
          text.trim(),
      );
      return;
    }
    directives.push({
      line,
      codes: (match[1] as string).split("|").map((c) => Number(c.slice(2))),
      fragment: match[2] as string,
    });
  });
  return directives;
}

const DIAGNOSTIC_HEADER = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/;

function parseTscOutput(output: string): { diags: Diag[]; unparsed: string[] } {
  const diags: Diag[] = [];
  const unparsed: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    const header = DIAGNOSTIC_HEADER.exec(raw);
    if (header !== null) {
      diags.push({ file: header[1] as string, line: Number(header[2]), code: Number(header[4]), text: header[5] as string });
    } else if (/^\s/.test(raw) && diags.length > 0) {
      const last = diags[diags.length - 1] as Diag;
      diags[diags.length - 1] = { ...last, text: `${last.text}\n${raw.trim()}` };
    } else {
      unparsed.push(raw);
    }
  }
  return { diags, unparsed };
}

function compile(config: string, scratch: string): { diags: Diag[]; unparsed: string[] } {
  const project = join(scratch, `${config.replace(/\.json$/, "")}.project.json`);
  writeFileSync(
    project,
    JSON.stringify({
      extends: join(REPO_ROOT, config),
      compilerOptions: { noEmit: true, incremental: false },
      include: ["./proof.ts"],
      exclude: [],
    }),
  );
  let output = "";
  try {
    output = execFileSync(process.execPath, [TSC, "-p", project, "--pretty", "false"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // tsc exits 1 when it reports diagnostics; its report is on stdout.
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
  return parseTscOutput(output);
}

/**
 * Check one proof file's text. `baseDir` is the directory its RELATIVE imports
 * are written against; they are rewritten to absolute paths because the
 * stripped copy is compiled from a scratch directory (this repo's tests do not
 * write scratch files inside `lib/`).
 */
export function checkProofSource(source: string, baseDir: string): ProofReport {
  const problems: string[] = [];
  const lines = source.split("\n");
  const directives = parseDirectives(lines, problems);
  const targetLines = new Set(directives.map((d) => d.line + 1));

  const stripped = lines
    .map((text) => (DIRECTIVE.test(text) ? "// (directive removed by the proof harness)" : text))
    .join("\n")
    .replace(/(\bfrom\s+)"(\.{1,2}\/[^"]*)"/g, (_all, lead: string, spec: string) => {
      return `${lead}${JSON.stringify(resolve(baseDir, spec))}`;
    });

  const scratch = mkdtempSync(join(tmpdir(), "act-proof-harness-"));
  try {
    writeFileSync(join(scratch, PROOF_FILE), stripped);
    for (const config of PROOF_CONFIGS) {
      const { diags, unparsed } = compile(config, scratch);
      for (const line of unparsed) {
        problems.push(`[${config}] tsc printed something that is not a diagnostic: ${line}`);
      }
      // A diagnostic in a file the proof IMPORTS (a contract source that no longer compiles) is not a proof
      // line; it is reported under its own file name so the cause is not mistaken for a broken proof.
      const isProof = (d: Diag): boolean => basename(d.file) === PROOF_FILE;
      const inProof = diags.filter(isProof);
      for (const other of diags.filter((d) => !isProof(d))) {
        problems.push(`[${config}] ${other.file}(${other.line}): TS${other.code} in a file the proof imports, not in the proof`);
      }
      for (const directive of directives) {
        const target = directive.line + 1;
        const here = inProof.filter((d) => d.line === target);
        const matching = here.find(
          (d) => directive.codes.includes(d.code) && d.text.includes(directive.fragment),
        );
        if (matching === undefined) {
          const seen = here.length === 0 ? "no diagnostic at all" : here.map((d) => `TS${d.code}`).join(", ");
          problems.push(
            `[${config}] line ${target}: expected TS${directive.codes.join("|TS")} containing ` +
              `${JSON.stringify(directive.fragment)}, got ${seen}`,
          );
        }
        for (const extra of here) {
          if (extra !== matching) {
            problems.push(
              `[${config}] line ${target}: unexpected extra diagnostic TS${extra.code} ` +
                "(a proof line must fail for exactly the stated reason, and a variable it declares must be used elsewhere)",
            );
          }
        }
      }
      for (const diag of inProof) {
        if (!targetLines.has(diag.line)) {
          problems.push(`[${config}] line ${diag.line}: unexpected diagnostic TS${diag.code} outside any proof line`);
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { directives: directives.length, problems };
}

export function checkProofFile(file: string): ProofReport {
  return checkProofSource(readFileSync(file, "utf8"), dirname(file));
}
