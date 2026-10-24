import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { API } from "typescript/unstable/sync";
import { afterAll, describe, expect, it } from "vitest";
import { referencesIn } from "../../contracts/__tests__/support/module-graph.js";
import * as chain from "../index.js";
import type { CharterRead, IntakeFailure, IntakeRejection, IntakeResult, StructureCheck, StructureRejection } from "../index.js";

/**
 * What `lib/chain` may depend on, and what it exposes.
 *
 * `lib/contracts/__tests__/architecture.test.ts` (M1) already scans every file under `lib/` for the closed module
 * graph and the layer order, and `lib/chain` is inside that scan: no import from outside `lib/`, none from a higher
 * layer. This file adds what that scan does not say about this layer, each as a rule with a fixture that breaks it:
 *
 *   1. Library SOURCE here reaches `lib/contracts` ONLY through its barrel, `lib/contracts/index.ts`, which is the
 *      surface M1 pins (`public-surface.test.ts`) and which keeps `unreachable` and the other internals private. A
 *      type-only import, a re-export and a dynamic import of an internal file count the same as a value import.
 *   2. No import cycle among this layer's own source files (M1's scan orders layers; it does not look inside one).
 *   3. The source files are exactly the plan's four, so a new one is a decision and not an accident.
 *   4. The barrel exports exactly the names in the plan's M3 list (and the one constant this layer adds).
 *
 * Source files here import only each other and the contracts barrel, so everything else (`node:` built-ins, packages,
 * `lib/allowance`, `app/`) is refused as `outside-chain-and-contracts-barrel` / `external`.
 *
 * NOT CHECKED: that the code is pure (a closed import graph says where code comes from, not what it does), and
 * anything about `__tests__/`: test files may import what the M1 allowlist lets them, and this layer's tests
 * import M1's module-graph helper.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const PLAN_SOURCE_FILES = ["chain.ts", "index.ts", "intake.ts", "structure.ts"];

type Rule = "contracts-internal-import" | "outside-chain-and-contracts-barrel" | "external" | "unresolvable" | "non-literal-specifier" | "imports-test" | "import-cycle";

interface Violation {
  readonly file: string;
  readonly rule: Rule;
  readonly specifier: string;
}

interface Scan {
  readonly violations: readonly Violation[];
  /** Source files under lib/chain (not `__tests__`), repo-relative. */
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

function scanChain(rootInput: string, tsconfigInput: string): Scan {
  const root = realpathSync(rootInput);
  const rel = (path: string): string => relative(root, path).split(sep).join("/");
  const chainDir = join(root, "lib", "chain");
  const contractsIndex = join(root, "lib", "contracts", "index.ts");
  const testsDir = join(chainDir, "__tests__");

  const files = listTs(chainDir).filter((path) => !path.startsWith(testsDir + sep));
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
          if (target === contractsIndex) continue;
          if (target.startsWith(testsDir + sep)) flag("imports-test");
          else if (target.startsWith(join(root, "lib", "contracts") + sep)) flag("contracts-internal-import");
          else if (target.startsWith(chainDir + sep)) continue;
          else flag("outside-chain-and-contracts-barrel");
        }
      }
    }
  } finally {
    api.close();
  }

  // A file that can reach itself through chain imports is in a cycle.
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
  const root = mkdtempSync(join(tmpdir(), "act-chain-architecture-"));
  scratch.push(root);
  writeFileSync(join(root, "tsconfig.json"), TSCONFIG);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("this repository: lib/chain source depends only on itself and the contracts barrel", () => {
  const result = scanChain(REPO_ROOT, join(REPO_ROOT, "tsconfig.lib.json"));

  it("has no violation", () => {
    expect(summarise(result.violations)).toEqual([]);
  });

  it("the source files are exactly the plan's four (M3's `intake.ts chain.ts structure.ts index.ts`)", () => {
    expect(result.files).toEqual(PLAN_SOURCE_FILES.map((name) => `lib/chain/${name}`));
  });

  it("the scan really saw the imports (not an empty scan passing): every file but the barrel imports the contracts barrel, and structure.ts imports chain.ts", () => {
    for (const name of ["chain.ts", "intake.ts", "structure.ts"]) {
      expect(result.edges.get(`lib/chain/${name}`), name).toContain("lib/contracts/index.ts");
    }
    expect(result.edges.get("lib/chain/structure.ts")).toContain("lib/chain/chain.ts");
    expect([...(result.edges.get("lib/chain/index.ts") ?? [])].sort()).toEqual(["lib/chain/chain.ts", "lib/chain/intake.ts", "lib/chain/structure.ts"]);
  });
});

describe("a synthetic tree with one violation per file: each is reported, and the valid imports beside them are not", () => {
  const root = tree({
    "lib/contracts/index.ts": "export const base = 1;\n",
    "lib/contracts/ids.ts": "export const id = 2;\nexport type Id = string;\n",
    "lib/allowance/index.ts": "export const a = 3;\n",
    // ---- valid ----
    "lib/chain/ok-barrel.ts": 'import { base } from "../contracts/index.js";\nexport const x = base;\n',
    "lib/chain/ok-sibling.ts": 'import { x } from "./ok-barrel.js";\nexport const y = x;\n',
    "lib/chain/ok-type.ts": 'import type { Id } from "../contracts/index.js";\nexport type T = Id;\n',
    // ---- one violation each ----
    "lib/chain/deep.ts": 'import { id } from "../contracts/ids.js";\nexport const d = id;\n',
    "lib/chain/deep-type.ts": 'import type { Id } from "../contracts/ids.js";\nexport type D = Id;\n',
    "lib/chain/deep-reexport.ts": 'export { id } from "../contracts/ids.js";\n',
    "lib/chain/deep-star.ts": 'export * from "../contracts/ids.js";\n',
    "lib/chain/deep-dynamic.ts": 'export const dd = import("../contracts/ids.js");\n',
    "lib/chain/deep-typeof.ts": 'export type DT = typeof import("../contracts/ids.js");\n',
    "lib/chain/up.ts": 'import { a } from "../allowance/index.js";\nexport const u = a;\n',
    "lib/chain/ext-node.ts": 'import "node:fs";\n',
    "lib/chain/ext-package.ts": 'import "react";\n',
    "lib/chain/missing.ts": 'import "./nope.js";\n',
    "lib/chain/dyn.ts": "declare const spec: string;\nexport const dy = import(spec);\n",
    "lib/chain/cyc-a.ts": 'import { b } from "./cyc-b.js";\nexport const a = b;\n',
    "lib/chain/cyc-b.ts": 'import { a } from "./cyc-a.js";\nexport const b = a;\n',
    "lib/chain/uses-test.ts": 'import { t } from "./__tests__/t.js";\nexport const ut = t;\n',
    // A test file may import contracts internals; the rule is about source.
    "lib/chain/__tests__/t.ts": 'import { id } from "../../contracts/ids.js";\nexport const t = id;\n',
  });
  const result = scanChain(root, join(root, "tsconfig.json"));

  it("reports exactly these file:rule pairs", () => {
    expect(summarise(result.violations)).toEqual(
      [
        "lib/chain/cyc-a.ts:import-cycle",
        "lib/chain/cyc-b.ts:import-cycle",
        "lib/chain/deep-dynamic.ts:contracts-internal-import",
        "lib/chain/deep-reexport.ts:contracts-internal-import",
        "lib/chain/deep-star.ts:contracts-internal-import",
        "lib/chain/deep-type.ts:contracts-internal-import",
        "lib/chain/deep-typeof.ts:contracts-internal-import",
        "lib/chain/deep.ts:contracts-internal-import",
        "lib/chain/dyn.ts:non-literal-specifier",
        "lib/chain/ext-node.ts:external",
        "lib/chain/ext-package.ts:external",
        "lib/chain/missing.ts:unresolvable",
        "lib/chain/up.ts:outside-chain-and-contracts-barrel",
        "lib/chain/uses-test.ts:imports-test",
      ].sort(),
    );
  });

  it("does not flag the barrel import, a sibling import, a type-only import of the barrel, or a test file's deep import", () => {
    const flagged = new Set(result.violations.map((v) => v.file));
    for (const clean of ["lib/chain/ok-barrel.ts", "lib/chain/ok-sibling.ts", "lib/chain/ok-type.ts"]) expect(flagged.has(clean), clean).toBe(false);
    expect(result.files).not.toContain("lib/chain/__tests__/t.ts");
  });
});

describe("the barrel: exactly the plan's M3 names, plus the one bound this layer adds", () => {
  it("exports these run-time names and no others (so no private helper and nothing M4 or M5 owns)", () => {
    expect(Object.keys(chain).sort()).toEqual(
      [
        "MAX_CHARTER_ENTRIES",
        "chainOf",
        "checkGrantStructure",
        "firstDeadLink",
        "liveAuthorityAbove",
        "readCharter",
        "readEventInput",
        "readLogEvent",
        "trailOf",
      ].sort(),
    );
  });

  it("the functions are functions and the bound is a number", () => {
    for (const name of ["chainOf", "checkGrantStructure", "firstDeadLink", "liveAuthorityAbove", "readCharter", "readEventInput", "readLogEvent", "trailOf"] as const) {
      expect(typeof chain[name], name).toBe("function");
    }
    expect(typeof chain.MAX_CHARTER_ENTRIES).toBe("number");
  });
});

/**
 * The plan's M3 types, imported by name above: dropping one from the barrel is a compile error, which
 * `npm run typecheck` reports (and `npm test` does not, since it strips types).
 */
export type PublicTypes = readonly [CharterRead<string>, IntakeFailure, IntakeRejection, IntakeResult<unknown>, StructureCheck, StructureRejection];
