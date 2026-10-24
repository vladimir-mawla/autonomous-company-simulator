import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportExpression,
  isImportTypeNode,
  isLiteralTypeNode,
  isStringLiteralLikeNode,
  type Node,
  type SourceFile,
} from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

/**
 * The closed module graph and the layer table (`.genesis/PLAN.md` §5, §6 M1(e)).
 *
 *   lib/contracts -> lib/chain -> lib/allowance -> lib/standing -> domains -> scripts, components, app
 *
 * An import may go to the same layer or a LOWER one, never higher; a strict order cannot contain a
 * cycle between layers, which is what the DoD gate "zero cycles" asks for at this level.
 *
 * WHAT IS CHECKED, for every `.ts` file under `lib/`:
 *  1. Every module reference TypeScript's grammar has a form for: `import ... from`, `import "x"`,
 *     `export ... from`, `import x = require("x")`, a dynamic `import("x")`, a `require("x")` call, an
 *     import TYPE (`import("x").T`, `typeof import("x")`), and `/// <reference path|types|lib>`.
 *     A specifier that is not a string literal (a computed `import(expr)`) is a violation: it cannot be
 *     resolved, so it fails closed.
 *  2. A relative specifier is resolved to a real file (`.js` -> `.ts`, a directory -> `index.ts`) and
 *     its REAL path must lie inside `lib/`. It is the resolved path that is tested, never the number of
 *     `../` in the specifier, so `../../node_modules/x/index.js` and a symlink pointing out are caught.
 *     A specifier that resolves to nothing is a violation, not a pass.
 *  3. A bare or `node:` specifier is allowed only if it is on the allowlist for the file's role: NONE for
 *     library source, a short list for files under `__tests__/`.
 *  4. The file's own layer and the target's layer obey the order above; a directory under `lib/` that is
 *     not a declared layer, and a `.ts` file directly in `lib/`, are violations. A library SOURCE file
 *     (no `__tests__` segment in its path) may not import a file under `__tests__/` either, because that
 *     file is allowed the test externals and the import would carry them into library code (rule
 *     `source-imports-test`).
 *  5. Inventory: every file under `lib/` is a `.ts` file that is not a declaration file, and none is a
 *     symlink. (A hand-written `.d.ts` plus a `.js` inside `lib/` would otherwise be an import that
 *     resolves inside `lib/` and lies about its type.)
 * and, for `.ts` files under `domains/`, point 4 only: a domain may import a lower layer, never `app/`,
 * `components/` or `scripts/`.
 *
 * WHAT IS NOT CHECKED. This is about IMPORTS. It does not look at what a file DECLARES (an ambient
 * `declare module`, `declare global`), and it does not stop library code from using an ambient global
 * (`fetch`, `process`, `Date.now`, `Math.random`): the closed graph says where code can come from, not
 * that the code is pure. Nor does it scan `.tsx`, `.js` or `.mjs` files outside `lib/`. A file that does
 * not parse is a violation, not a skip.
 */

export type Rule =
  | "outside-lib"
  | "unresolvable"
  | "external-not-allowed"
  | "source-imports-test"
  | "non-literal-specifier"
  | "upward-layer-import"
  | "undeclared-lib-directory"
  | "import-of-undeclared-lib-directory"
  | "non-ts-file"
  | "symlink"
  | "unparseable";

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly rule: Rule;
}

export interface Layer {
  readonly name: string;
  readonly dir: string;
  readonly rank: number;
}

/** The layer table of plan §5. `domains` is one layer: every directory under it has the same rank. */
export const LAYERS: readonly Layer[] = [
  { name: "contracts", dir: "lib/contracts", rank: 0 },
  { name: "chain", dir: "lib/chain", rank: 1 },
  { name: "allowance", dir: "lib/allowance", rank: 2 },
  { name: "standing", dir: "lib/standing", rank: 3 },
  { name: "domains", dir: "domains", rank: 4 },
  { name: "scripts", dir: "scripts", rank: 5 },
  { name: "components", dir: "components", rank: 5 },
  { name: "app", dir: "app", rank: 5 },
];

/** Library SOURCE (outside `__tests__/`) imports nothing outside `lib/`: no Node built-in, no package. */
export const SOURCE_EXTERNALS: ReadonlySet<string> = new Set();

/**
 * What files under `__tests__/` may import from outside `lib/`. Exactly what `lib/**` imports today
 * (`architecture.test.ts` also fails on an entry nothing uses), not what a later milestone might want:
 * a milestone that needs another one adds it here on purpose.
 */
export const TEST_EXTERNALS: ReadonlySet<string> = new Set([
  "node:child_process",
  "node:fs",
  "node:os",
  "node:path",
  "typescript/unstable/ast",
  "typescript/unstable/sync",
  "vitest",
]);

export interface Reference {
  readonly specifier: string | null;
  readonly raw: string;
  readonly line: number;
}

/** Every module reference in a parsed file. A non-literal specifier has `specifier: null`. */
export function referencesIn(sf: SourceFile): Reference[] {
  const found: Reference[] = [];
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const record = (node: Node | undefined): void => {
    if (node === undefined) return;
    found.push({
      specifier: isStringLiteralLikeNode(node) ? node.text : null,
      raw: node.getText(sf),
      line: lineOf(node.getStart(sf)),
    });
  };

  const visit = (node: Node): void => {
    if (isImportDeclaration(node) || isExportDeclaration(node)) {
      record(node.moduleSpecifier);
    } else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
      record(node.moduleReference.expression);
    } else if (isImportTypeNode(node)) {
      record(isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument);
    } else if (isCallExpression(node)) {
      if (isImportExpression(node.expression) || (isIdentifier(node.expression) && node.expression.text === "require")) {
        record(node.arguments[0]);
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);

  for (const ref of [...sf.referencedFiles, ...sf.typeReferenceDirectives, ...sf.libReferenceDirectives]) {
    found.push({ specifier: ref.fileName, raw: ref.fileName, line: lineOf(ref.pos) });
  }
  return found;
}

/** Every file below `dir`, with `lstat` so a symlink is seen as one (and not followed). */
function walk(dir: string): { path: string; symlink: boolean; directory: boolean }[] {
  const out: { path: string; symlink: boolean; directory: boolean }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    out.push({ path, symlink: stat.isSymbolicLink(), directory: stat.isDirectory() });
    if (stat.isDirectory()) out.push(...walk(path));
  }
  return out;
}

function candidatesFor(target: string): string[] {
  const list = [target];
  if (target.endsWith(".js")) list.push(target.slice(0, -3) + ".ts", target.slice(0, -3) + ".tsx");
  else if (target.endsWith(".mjs")) list.push(target.slice(0, -4) + ".mts");
  else if (target.endsWith(".cjs")) list.push(target.slice(0, -4) + ".cts");
  else list.push(target + ".ts", target + ".tsx", join(target, "index.ts"));
  return list;
}

export interface ScanOptions {
  /** Absolute path of the repository (or a synthetic copy of its layout). */
  readonly root: string;
  /** Absolute path of a tsconfig whose program includes every `.ts` file under `lib/` and `domains/`. */
  readonly tsconfig: string;
  /** Overridable so the allowlist test can be exercised on a fixture; defaults to this module's lists. */
  readonly sourceExternals?: ReadonlySet<string>;
  readonly testExternals?: ReadonlySet<string>;
}

export interface ScanResult {
  readonly violations: readonly Violation[];
  /** Every `.ts` file that was parsed (repo-relative, `/`-separated). */
  readonly scanned: readonly string[];
  /** Every external specifier that some scanned file imports and that was accepted. */
  readonly externalsUsed: ReadonlySet<string>;
}

/** Scans with a FRESH `API`: a project opened earlier does not see files created after it. */
export function scanModuleGraph(options: ScanOptions): ScanResult {
  const root = realpathSync(options.root);
  const rel = (path: string): string => relative(root, path).split(sep).join("/");
  const sourceExternals = options.sourceExternals ?? SOURCE_EXTERNALS;
  const testExternals = options.testExternals ?? TEST_EXTERNALS;
  const violations: Violation[] = [];
  const scanned: string[] = [];
  const externalsUsed = new Set<string>();

  const realLayers = LAYERS.map((layer) => ({ ...layer, real: join(root, ...layer.dir.split("/")) }));
  const layerOf = (realPath: string): Layer | undefined =>
    realLayers.find((layer) => realPath === layer.real || realPath.startsWith(layer.real + sep));
  const libRoot = join(root, "lib");
  const inLib = (realPath: string): boolean => realPath === libRoot || realPath.startsWith(libRoot + sep);

  // ---- 5. inventory of lib/ ----
  if (existsSync(libRoot)) {
    for (const entry of walk(libRoot)) {
      if (entry.symlink) {
        violations.push({ file: rel(entry.path), line: 0, specifier: "", rule: "symlink" });
      } else if (!entry.directory && (!entry.path.endsWith(".ts") || entry.path.endsWith(".d.ts"))) {
        violations.push({ file: rel(entry.path), line: 0, specifier: "", rule: "non-ts-file" });
      }
    }
  }

  // ---- the files to parse: every .ts under lib/ and domains/ ----
  const toParse: string[] = [];
  for (const top of ["lib", "domains"]) {
    const dir = join(root, top);
    if (!existsSync(dir)) continue;
    for (const entry of walk(dir)) {
      if (!entry.directory && !entry.symlink && entry.path.endsWith(".ts") && !entry.path.endsWith(".d.ts")) toParse.push(entry.path);
    }
  }

  // Real paths throughout: on macOS the temp directory is reached through a symlink, and the compiler
  // returns a source file only under the spelling it opened the project with.
  const tsconfig = realpathSync(options.tsconfig);
  const api = new API();
  try {
    const snapshot = api.updateSnapshot({ openProjects: [tsconfig] });
    const project = snapshot.getProject(tsconfig);
    if (project === undefined) throw new Error(`the compiler could not open ${tsconfig}`);

    for (const file of toParse) {
      const name = rel(file);
      const sf = project.program.getSourceFile(file);
      if (sf === undefined || project.program.getSyntacticDiagnostics(file).length > 0) {
        violations.push({ file: name, line: 0, specifier: "", rule: "unparseable" });
        continue;
      }
      scanned.push(name);

      const isLib = inLib(file);
      const importerLayer = layerOf(file);
      if (isLib && importerLayer === undefined) {
        violations.push({ file: name, line: 0, specifier: "", rule: "undeclared-lib-directory" });
      }
      const role = name.split("/").includes("__tests__") ? "test" : "source";

      for (const ref of referencesIn(sf)) {
        const violation = (rule: Rule): void => {
          violations.push({ file: name, line: ref.line, specifier: ref.specifier ?? ref.raw, rule });
        };
        if (ref.specifier === null) {
          if (isLib) violation("non-literal-specifier");
          continue;
        }
        const spec = ref.specifier;

        if (!spec.startsWith("./") && !spec.startsWith("../")) {
          // A bare name, a `node:` built-in, or an absolute path. Only library files are held to the allowlist.
          if (!isLib) continue;
          const allowed = role === "test" ? testExternals : sourceExternals;
          if (!spec.startsWith("/") && allowed.has(spec)) externalsUsed.add(spec);
          else violation("external-not-allowed");
          continue;
        }

        const target = resolve(dirname(file), spec);
        const real = candidatesFor(target)
          .filter((candidate) => existsSync(candidate))
          .map((candidate) => realpathSync(candidate));
        if (real.length === 0) {
          if (isLib) violation("unresolvable");
          continue;
        }
        // Every file the specifier could mean must be inside lib/ (for a library file) and in a lower or equal layer.
        for (const path of real) {
          if (isLib && !inLib(path)) {
            violation("outside-lib");
            break;
          }
          if (isLib && role === "source" && rel(path).split("/").includes("__tests__")) {
            violation("source-imports-test");
            break;
          }
          const targetLayer = layerOf(path);
          if (isLib && targetLayer === undefined) {
            violation("import-of-undeclared-lib-directory");
            break;
          }
          if (importerLayer !== undefined && targetLayer !== undefined && targetLayer.rank > importerLayer.rank) {
            violation("upward-layer-import");
            break;
          }
        }
      }
    }
  } finally {
    api.close();
  }

  return { violations, scanned, externalsUsed };
}

/** `file:rule` pairs, sorted, for compact assertions. */
export function summarise(violations: readonly Violation[]): string[] {
  return violations.map((v) => `${v.file}:${v.rule}`).sort();
}

