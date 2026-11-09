import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isIdentifier, isStringLiteralLikeNode, SyntaxKind, type Node } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { referencesIn } from "../../../../lib/contracts/__tests__/support/module-graph.js";

/**
 * The source scan of the page's own code (plan §6 M8: "a source scan for the banned hooks"; "`compute-demo-view.ts` is the only file under `components/` that
 * imports `lib/**`/`domains/**`").
 *
 * It walks the syntax tree of every `.ts` and `.tsx` file of `components/company/` (not `__tests__/`) and of `app/page.tsx` and `app/milestones.ts`, and reports
 * exactly these, and nothing else:
 *
 *   `banned-hook`      an IDENTIFIER, or a string literal, spelt `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useCallback`, `useMemo`, `setTimeout`,
 *                      `setInterval`, `requestAnimationFrame` or `queueMicrotask`. An identifier is seen wherever it is: a call, an import specifier, the name after a dot
 *                      (`React.useMemo`), a destructuring (`const { useEffect } = React`), an alias (`import { useEffect as e }` has the identifier twice). A string literal
 *                      is seen too, so `React["useMemo"]` is.
 *   `async`            an `async` modifier, an `await` expression, the identifier `Promise`.
 *   `other-hook`       an identifier that looks like a hook (`use` then a capital letter) and is not `useReducer`: the page's one hook is `useReducer`.
 *   `nondeterminism`   the identifiers `Date`, `performance`, `crypto`, `fetch`, `window`, `document`, `navigator`, `localStorage`, `sessionStorage`, `process`, `globalThis`,
 *                      and `Math.random`. The page's markup must be a function of its state alone, so the server and the browser agree.
 *   `engine-import`    a module reference (an import, an export-from, a dynamic `import()`, a `require` call, an import type, a `/// <reference>`) that resolves, by real
 *                      path, into `lib/` or `domains/`, in any file but the bridge (`components/company/compute-demo-view.ts`); and in the bridge, one that is not the
 *                      `index.ts` of `lib/contracts`, `lib/chain`, `lib/allowance`, `lib/standing` or `domains/company`.
 *   `engine-call`      in any file but the bridge, an identifier spelt like one of the engine's or the domain's functions (`append`, `fold`, `standings`, `usedOf`, `offer`, `runQuarter`, ...).
 *                      The import rule above is the real wall; this is a second look for a function that arrived some other way.
 *   `import-other`     a module reference that is not a file of this repository, `react`, `react-dom` or `next`/`next/*`, or whose specifier is not a string literal (it cannot be resolved, so it fails closed).
 *   `inventory`        a file under `components/company/` (not `__tests__/`) that is not a `.ts`/`.tsx` source, is a symlink, or does not parse.
 *
 * WHAT IT DOES NOT SEE, so that nobody reads more into a green result than is there (each is pinned as "not reported" in the test file):
 *   - a name built at run time: `"use" + "Effect"`, a template literal with a substitution, `["use", "Effect"].join("")`;
 *   - a name reached through `Reflect.get`, `Object.getOwnPropertyDescriptor`, a computed key whose value is not a literal (`React[name]`), or a `with` block;
 *   - a hook or timer that arrives from a module this scan allows (a function named something else exported from another file of the directory, that calls `useEffect`:
 *     that file would be scanned and reported, but a file outside the scanned set is not);
 *   - a dynamic `import("react")` followed by a property read with a computed key;
 *   - any file outside the scanned set (a new directory, `app/layout.tsx`, a `.js` file);
 *   - that the code it passes is correct: it reports forms, it does not run anything.
 */

export type Rule = "banned-hook" | "async" | "other-hook" | "nondeterminism" | "engine-import" | "engine-call" | "import-other" | "inventory";

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: Rule;
  readonly detail: string;
}

export interface ScanResult {
  readonly findings: readonly Finding[];
  /** Repo-relative, `/`-separated names of the files that were parsed and scanned. */
  readonly scanned: readonly string[];
  /** The scanned files that import from `lib/` or `domains/`. */
  readonly engineImporters: readonly string[];
}

export const BANNED_HOOKS: readonly string[] = ["useEffect", "useLayoutEffect", "useInsertionEffect", "useCallback", "useMemo", "setTimeout", "setInterval", "requestAnimationFrame", "queueMicrotask"];
export const NONDETERMINISTIC: readonly string[] = ["Date", "performance", "crypto", "fetch", "window", "document", "navigator", "localStorage", "sessionStorage", "process", "globalThis"];
export const ENGINE_NAMES: readonly string[] = [
  "append", "fold", "standings", "standingOf", "mayCommit", "usedOf", "headroomOf", "absorbedBy", "checkHeadroom", "offer", "runQuarter", "replayScript",
  "makeOrgView", "chainOf", "firstDeadLink", "trailOf", "readEventInput", "readLogEvent", "readCharter", "mulberry32",
];
export const BARRELS: readonly string[] = ["lib/contracts/index.ts", "lib/chain/index.ts", "lib/allowance/index.ts", "lib/standing/index.ts", "domains/company/index.ts"];
const BARE_ALLOWED = (specifier: string): boolean => specifier === "react" || specifier === "react-dom" || specifier.startsWith("react-dom/") || specifier === "next" || specifier.startsWith("next/");

function candidatesFor(target: string): string[] {
  if (target.endsWith(".js")) return [target, target.slice(0, -3) + ".ts", target.slice(0, -3) + ".tsx"];
  return [target, target + ".ts", target + ".tsx", join(target, "index.ts")];
}

function walk(dir: string): { path: string; symlink: boolean; directory: boolean }[] {
  const out: { path: string; symlink: boolean; directory: boolean }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    out.push({ path, symlink: stat.isSymbolicLink(), directory: stat.isDirectory() });
    if (stat.isDirectory() && !stat.isSymbolicLink()) out.push(...walk(path));
  }
  return out;
}

export interface ScanOptions {
  /** Absolute path of the repository (or a synthetic copy of its layout). */
  readonly root: string;
  /** Absolute path of a tsconfig whose program includes the scanned files. */
  readonly tsconfig: string;
  /** Repo-relative paths of single files to scan besides everything under `components/company/` (default: the page and the milestones module). */
  readonly extraFiles?: readonly string[];
}

export function scanPageSource(options: ScanOptions): ScanResult {
  const root = realpathSync(options.root);
  const companyDir = join(root, "components", "company");
  const testsDir = join(companyDir, "__tests__");
  const bridge = join(companyDir, "compute-demo-view.ts");
  const rel = (path: string): string => relative(root, path).split(sep).join("/");
  const findings: Finding[] = [];
  const scanned: string[] = [];
  const engineImporters: string[] = [];

  const sources: string[] = [];
  if (existsSync(companyDir)) {
    for (const entry of walk(companyDir)) {
      if (entry.path === testsDir || entry.path.startsWith(testsDir + sep)) continue;
      if (entry.symlink) findings.push({ file: rel(entry.path), line: 0, rule: "inventory", detail: "symlink" });
      else if (!entry.directory && (!/\.tsx?$/.test(entry.path) || entry.path.endsWith(".d.ts"))) findings.push({ file: rel(entry.path), line: 0, rule: "inventory", detail: "not a .ts or .tsx source" });
      else if (!entry.directory) sources.push(entry.path);
    }
  }
  for (const extra of options.extraFiles ?? ["app/page.tsx", "app/milestones.ts"]) {
    const path = join(root, extra);
    if (existsSync(path)) sources.push(path);
  }

  const tsconfig = realpathSync(options.tsconfig);
  const api = new API();
  try {
    const project = api.updateSnapshot({ openProjects: [tsconfig] }).getProject(tsconfig);
    if (project === undefined) throw new Error(`the compiler could not open ${tsconfig}`);
    for (const file of sources) {
      const name = rel(file);
      const isBridge = file === bridge;
      const sf = project.program.getSourceFile(file);
      if (sf === undefined || project.program.getSyntacticDiagnostics(file).length > 0) {
        findings.push({ file: name, line: 0, rule: "inventory", detail: "does not parse" });
        continue;
      }
      scanned.push(name);
      const lineOf = (node: Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const report = (rule: Rule, node: Node, detail: string): void => {
        findings.push({ file: name, line: lineOf(node), rule, detail });
      };

      // module references
      let importsEngine = false;
      for (const ref of referencesIn(sf)) {
        const at = (rule: Rule): void => {
          findings.push({ file: name, line: ref.line, rule, detail: ref.specifier ?? ref.raw });
        };
        const specifier = ref.specifier;
        if (specifier === null) {
          at("import-other");
          continue;
        }
        if (!(specifier.startsWith("./") || specifier.startsWith("../"))) {
          if (!BARE_ALLOWED(specifier)) at("import-other");
          continue;
        }
        const found = candidatesFor(resolve(dirname(file), specifier)).filter((candidate) => existsSync(candidate)).map((candidate) => realpathSync(candidate));
        if (found.length === 0) {
          at("import-other");
          continue;
        }
        const engine = found.filter((path) => path.startsWith(join(root, "lib") + sep) || path.startsWith(join(root, "domains") + sep));
        if (engine.length > 0) {
          importsEngine = true;
          if (!isBridge) at("engine-import");
          else if (!engine.every((path) => BARRELS.includes(rel(path)))) at("engine-import");
        } else if (!found.every((path) => path.startsWith(root + sep) && !path.includes(`${sep}node_modules${sep}`))) {
          at("import-other");
        }
      }
      if (importsEngine) engineImporters.push(name);

      const visit = (node: Node): void => {
        if (isIdentifier(node)) {
          const text = node.text;
          if (BANNED_HOOKS.includes(text)) report("banned-hook", node, text);
          else if (/^use[A-Z]/.test(text) && text !== "useReducer") report("other-hook", node, text);
          if (text === "Promise") report("async", node, text);
          if (NONDETERMINISTIC.includes(text)) report("nondeterminism", node, text);
          if (!isBridge && ENGINE_NAMES.includes(text)) report("engine-call", node, text);
          if (text === "random" && node.parent !== undefined && node.parent.kind === SyntaxKind.PropertyAccessExpression && node.parent.getText(sf) === "Math.random") report("nondeterminism", node, "Math.random");
        } else if (isStringLiteralLikeNode(node) && BANNED_HOOKS.includes(node.text)) {
          report("banned-hook", node, `"${node.text}"`);
        } else if (node.kind === SyntaxKind.AsyncKeyword) {
          report("async", node, "async");
        } else if (node.kind === SyntaxKind.AwaitExpression) {
          report("async", node, "await");
        }
        node.forEachChild(visit);
      };
      visit(sf);
    }
  } finally {
    api.close();
  }
  return { findings, scanned, engineImporters };
}

/** `file:rule` pairs, sorted and de-duplicated, for comparing a scan with what was planted. */
export function summarise(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map((finding) => `${finding.file}:${finding.rule}`))].sort();
}
