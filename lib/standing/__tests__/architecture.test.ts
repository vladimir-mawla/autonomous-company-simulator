import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { API } from "typescript/unstable/sync";
import { afterAll, describe, expect, it } from "vitest";
import { referencesIn } from "../../contracts/__tests__/support/module-graph.js";
import * as standing from "../index.js";
import type { AppendFailure, AppendResult, CommitRecord, Folded, FoldResult, MayCommitResult, StandingOfResult, StandingsResult } from "../index.js";

/**
 * What `lib/standing` may depend on, and what it exposes.
 *
 * `lib/contracts/__tests__/architecture.test.ts` (M1) already scans every file under `lib/` for the closed module
 * graph and the layer order, and `lib/standing` is inside that scan: no import from outside `lib/`, none from a higher
 * layer (`domains`, `scripts`, `components`, `app`). This file adds what that scan does not say about this layer, each as a
 * rule with a fixture that breaks it:
 *
 *   1. Library SOURCE here reaches `lib/contracts`, `lib/chain` and `lib/allowance` ONLY through their barrels
 *      (`index.ts`): the surfaces M1, M3 and M4 pin, so this layer uses the lower layers through what they publish and
 *      not through a helper they keep private. That is the only part of "does this layer re-implement a lower layer's rule?"
 *      that an import scan can check; whether it does is a matter of what the code says. A type-only import, a re-export
 *      and a dynamic import of an internal file count the same as a value import.
 *   2. No import cycle among this layer's own source files.
 *   3. The source files are exactly the plan's five (`fold.ts verdict.ts standing.ts append.ts index.ts`), so a new one is a
 *      decision and not an accident.
 *   4. The barrel exports exactly the plan's five M5 functions, and no helper: not `judgeCommit`, `decide`, `apply`,
 *      `replay`, `admitInput`, `deriveStanding` or `sealStanding`, each of which would let a caller judge, record or build a
 *      standing by a path that skips one of the others.
 *
 * Source files here import only each other and those three barrels, so everything else (`node:` built-ins, packages, `app/`,
 * `domains/`) is refused as `outside-allowed` / `external`.
 *
 * NOT CHECKED: that the code is pure (a closed import graph says where code comes from, not what it does), and anything about
 * `__tests__/`: test files may import what the M1 allowlist lets them, and this layer's tests import `lib/chain`'s and
 * `lib/allowance`'s test fixtures and M1's module-graph helper.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const PLAN_SOURCE_FILES = ["append.ts", "fold.ts", "index.ts", "standing.ts", "verdict.ts"];

type Rule = "contracts-internal-import" | "chain-internal-import" | "allowance-internal-import" | "outside-allowed" | "external" | "unresolvable" | "non-literal-specifier" | "imports-test" | "import-cycle";

interface Violation {
  readonly file: string;
  readonly rule: Rule;
  readonly specifier: string;
}

interface Scan {
  readonly violations: readonly Violation[];
  /** Source files under lib/standing (not `__tests__`), repo-relative. */
  readonly files: readonly string[];
  /** For each source file, the repo-relative files it imports (resolved). */
  readonly edges: ReadonlyMap<string, ReadonlySet<string>>;
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...listTs(path));
    else if (name.name.endsWith(".ts") && !name.name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

function candidates(target: string): string[] {
  return target.endsWith(".js") ? [target.slice(0, -3) + ".ts"] : [target + ".ts", join(target, "index.ts")];
}

function scanStanding(rootInput: string, tsconfigInput: string): Scan {
  const root = realpathSync(rootInput);
  const rel = (path: string): string => relative(root, path).split(sep).join("/");
  const standingDir = join(root, "lib", "standing");
  const allowanceDir = join(root, "lib", "allowance");
  const contractsDir = join(root, "lib", "contracts");
  const chainDir = join(root, "lib", "chain");
  const contractsIndex = join(contractsDir, "index.ts");
  const chainIndex = join(chainDir, "index.ts");
  const allowanceIndex = join(allowanceDir, "index.ts");
  const testsDir = join(standingDir, "__tests__");

  const files = listTs(standingDir).filter((path) => !path.startsWith(testsDir + sep));
  const violations: Violation[] = [];
  const edges = new Map<string, Set<string>>();

  const api = new API();
  try {
    const tsconfig = realpathSync(tsconfigInput);
    const snapshot = api.updateSnapshot({ openProjects: [tsconfig] });
    const project = snapshot.getProject(tsconfig);
    if (project === undefined) throw new Error(`the compiler could not open ${tsconfig}`);

    for (const file of files) {
      const name = rel(file);
      const targets = new Set<string>();
      edges.set(name, targets);
      const sf = project.program.getSourceFile(file);
      if (sf === undefined) throw new Error(`the compiler did not parse ${name}`);

      for (const ref of referencesIn(sf)) {
        const flag = (rule: Rule): void => {
          violations.push({ file: name, rule, specifier: ref.specifier ?? ref.raw });
        };
        if (ref.specifier === null) {
          flag("non-literal-specifier");
          continue;
        }
        const spec = ref.specifier;
        if (!spec.startsWith("./") && !spec.startsWith("../")) {
          flag("external");
          continue;
        }
        const found = candidates(resolve(dirname(file), spec)).filter((candidate) => existsSync(candidate)).map((candidate) => realpathSync(candidate));
        if (found.length === 0) {
          flag("unresolvable");
          continue;
        }
        for (const target of found) {
          targets.add(rel(target));
          if (target === contractsIndex || target === chainIndex || target === allowanceIndex) continue;
          if (target.startsWith(testsDir + sep)) flag("imports-test");
          else if (target.startsWith(contractsDir + sep)) flag("contracts-internal-import");
          else if (target.startsWith(chainDir + sep)) flag("chain-internal-import");
          else if (target.startsWith(allowanceDir + sep)) flag("allowance-internal-import");
          else if (target.startsWith(standingDir + sep)) continue;
          else flag("outside-allowed");
        }
      }
    }
  } finally {
    api.close();
  }

  // A file that can reach itself through this layer's imports is in a cycle.
  const reaches = (from: string, goal: string, seen: Set<string> = new Set()): boolean => {
    for (const next of edges.get(from) ?? []) {
      if (next === goal) return true;
      if (!seen.has(next) && edges.has(next)) {
        seen.add(next);
        if (reaches(next, goal, seen)) return true;
      }
    }
    return false;
  };
  for (const name of edges.keys()) {
    if (reaches(name, name)) violations.push({ file: name, rule: "import-cycle", specifier: "" });
  }

  return { violations, files: files.map(rel).sort(), edges };
}

const summarise = (violations: readonly Violation[]): string[] => violations.map((v) => `${v.file}:${v.rule}`).sort();

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: true },
  include: ["lib/**/*.ts"],
});

function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "act-standing-architecture-"));
  scratch.push(root);
  writeFileSync(join(root, "tsconfig.json"), TSCONFIG);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("this repository: lib/standing source depends only on itself and the barrels of lib/contracts, lib/chain and lib/allowance", () => {
  const result = scanStanding(REPO_ROOT, join(REPO_ROOT, "tsconfig.lib.json"));

  it("has no violation", () => {
    expect(summarise(result.violations)).toEqual([]);
  });

  it("the source files are exactly the plan's five (M5's `fold.ts verdict.ts standing.ts append.ts index.ts`)", () => {
    expect(result.files).toEqual(PLAN_SOURCE_FILES.map((name) => `lib/standing/${name}`));
  });

  it("the scan really saw the imports (not an empty scan passing): the edges of each file are exactly these", () => {
    const edges = (file: string): string[] => [...(result.edges.get(`lib/standing/${file}`) ?? [])].sort();
    expect(edges("verdict.ts")).toEqual(["lib/allowance/index.ts", "lib/chain/index.ts", "lib/contracts/index.ts"]);
    expect(edges("fold.ts")).toEqual(["lib/allowance/index.ts", "lib/chain/index.ts", "lib/contracts/index.ts", "lib/standing/verdict.ts"]);
    expect(edges("standing.ts")).toEqual(["lib/chain/index.ts", "lib/contracts/index.ts", "lib/standing/fold.ts"]);
    expect(edges("append.ts")).toEqual(["lib/chain/index.ts", "lib/contracts/index.ts", "lib/standing/fold.ts"]);
    expect(edges("index.ts")).toEqual(["lib/standing/append.ts", "lib/standing/fold.ts", "lib/standing/standing.ts"]);
  });
});

describe("a synthetic tree with one violation per file: each is reported, and the valid imports beside them are not", () => {
  const root = tree({
    "lib/contracts/index.ts": "export const base = 1;\n",
    "lib/contracts/ids.ts": "export const id = 2;\nexport type Id = string;\n",
    "lib/chain/index.ts": "export const walk = 3;\n",
    "lib/chain/chain.ts": "export const inner = 4;\nexport type Inner = string;\n",
    "lib/allowance/index.ts": "export const sum = 5;\n",
    "lib/allowance/accounting.ts": "export const deep = 6;\nexport type Deep = string;\n",
    "domains/company/index.ts": "export const d = 7;\n",
    // ---- valid ----
    "lib/standing/ok-contracts.ts": 'import { base } from "../contracts/index.js";\nexport const x = base;\n',
    "lib/standing/ok-chain.ts": 'import { walk } from "../chain/index.js";\nexport const w = walk;\n',
    "lib/standing/ok-allowance.ts": 'import { sum } from "../allowance/index.js";\nexport const a = sum;\n',
    "lib/standing/ok-sibling.ts": 'import { x } from "./ok-contracts.js";\nexport const y = x;\n',
    "lib/standing/ok-type.ts": 'import type { Id } from "../contracts/index.js";\nexport type T = Id;\n',
    // ---- one violation each ----
    "lib/standing/deep.ts": 'import { id } from "../contracts/ids.js";\nexport const d1 = id;\n',
    "lib/standing/deep-type.ts": 'import type { Id } from "../contracts/ids.js";\nexport type D = Id;\n',
    "lib/standing/deep-reexport.ts": 'export { id } from "../contracts/ids.js";\n',
    "lib/standing/deep-star.ts": 'export * from "../contracts/ids.js";\n',
    "lib/standing/deep-dynamic.ts": 'export const dd = import("../contracts/ids.js");\n',
    "lib/standing/deep-typeof.ts": 'export type DT = typeof import("../contracts/ids.js");\n',
    "lib/standing/chain-deep.ts": 'import { inner } from "../chain/chain.js";\nexport const c = inner;\n',
    "lib/standing/chain-deep-type.ts": 'import type { Inner } from "../chain/chain.js";\nexport type C = Inner;\n',
    "lib/standing/chain-deep-reexport.ts": 'export { inner } from "../chain/chain.js";\n',
    "lib/standing/chain-deep-dynamic.ts": 'export const cd = import("../chain/chain.js");\n',
    "lib/standing/allowance-deep.ts": 'import { deep } from "../allowance/accounting.js";\nexport const ad = deep;\n',
    "lib/standing/allowance-deep-type.ts": 'import type { Deep } from "../allowance/accounting.js";\nexport type AD = Deep;\n',
    "lib/standing/allowance-deep-reexport.ts": 'export { deep } from "../allowance/accounting.js";\n',
    "lib/standing/allowance-deep-dynamic.ts": 'export const add = import("../allowance/accounting.js");\n',
    "lib/standing/up.ts": 'import { d } from "../../domains/company/index.js";\nexport const u = d;\n',
    "lib/standing/ext-node.ts": 'import "node:fs";\n',
    "lib/standing/ext-package.ts": 'import "react";\n',
    "lib/standing/missing.ts": 'import "./nope.js";\n',
    "lib/standing/dyn.ts": "declare const spec: string;\nexport const dy = import(spec);\n",
    "lib/standing/cyc-a.ts": 'import { b } from "./cyc-b.js";\nexport const a1 = b;\n',
    "lib/standing/cyc-b.ts": 'import { a1 } from "./cyc-a.js";\nexport const b = a1;\n',
    "lib/standing/uses-test.ts": 'import { t } from "./__tests__/t.js";\nexport const ut = t;\n',
    // A test file may import another layer's internals; the rule is about source.
    "lib/standing/__tests__/t.ts": 'import { id } from "../../contracts/ids.js";\nexport const t = id;\n',
  });
  const result = scanStanding(root, join(root, "tsconfig.json"));

  it("reports exactly these file:rule pairs", () => {
    expect(summarise(result.violations)).toEqual(
      [
        "lib/standing/allowance-deep-dynamic.ts:allowance-internal-import",
        "lib/standing/allowance-deep-reexport.ts:allowance-internal-import",
        "lib/standing/allowance-deep-type.ts:allowance-internal-import",
        "lib/standing/allowance-deep.ts:allowance-internal-import",
        "lib/standing/chain-deep-dynamic.ts:chain-internal-import",
        "lib/standing/chain-deep-reexport.ts:chain-internal-import",
        "lib/standing/chain-deep-type.ts:chain-internal-import",
        "lib/standing/chain-deep.ts:chain-internal-import",
        "lib/standing/cyc-a.ts:import-cycle",
        "lib/standing/cyc-b.ts:import-cycle",
        "lib/standing/deep-dynamic.ts:contracts-internal-import",
        "lib/standing/deep-reexport.ts:contracts-internal-import",
        "lib/standing/deep-star.ts:contracts-internal-import",
        "lib/standing/deep-type.ts:contracts-internal-import",
        "lib/standing/deep-typeof.ts:contracts-internal-import",
        "lib/standing/deep.ts:contracts-internal-import",
        "lib/standing/dyn.ts:non-literal-specifier",
        "lib/standing/ext-node.ts:external",
        "lib/standing/ext-package.ts:external",
        "lib/standing/missing.ts:unresolvable",
        "lib/standing/up.ts:outside-allowed",
        "lib/standing/uses-test.ts:imports-test",
      ].sort(),
    );
  });

  it("does not flag any of the three barrel imports, a sibling import, a type-only import of a barrel, or a test file's deep import", () => {
    const flagged = new Set(result.violations.map((v) => v.file));
    for (const clean of ["lib/standing/ok-contracts.ts", "lib/standing/ok-chain.ts", "lib/standing/ok-allowance.ts", "lib/standing/ok-sibling.ts", "lib/standing/ok-type.ts"]) {
      expect(flagged.has(clean), clean).toBe(false);
    }
    expect(result.files).not.toContain("lib/standing/__tests__/t.ts");
  });
});

describe("the barrel: exactly the plan's five M5 functions", () => {
  it("exports these run-time names and no others (so no private helper, and nothing another milestone owns)", () => {
    expect(Object.keys(standing).sort()).toEqual(["append", "fold", "mayCommit", "standingOf", "standings"]);
  });

  it("they are functions", () => {
    for (const name of ["append", "fold", "mayCommit", "standingOf", "standings"] as const) expect(typeof standing[name], name).toBe("function");
  });
});

/**
 * The plan's eight M5 types, imported by name above: dropping one from the barrel is a compile error, which
 * `npm run typecheck` reports (and `npm test` does not, since it strips types).
 */
export type PublicTypes = readonly [AppendFailure, AppendResult, CommitRecord, Folded, FoldResult, MayCommitResult, StandingOfResult, StandingsResult];
