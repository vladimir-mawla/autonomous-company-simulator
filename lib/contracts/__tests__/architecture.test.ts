import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LAYERS, TEST_EXTERNALS, scanModuleGraph, summarise } from "./support/module-graph.js";

/**
 * The closed module graph and the layer table (`.genesis/PLAN.md` §5, §6 M1(e)). The rules and what they
 * do NOT cover are written out at the top of `support/module-graph.ts`.
 *
 * Two kinds of test. The first scans THIS repository and must find nothing. The second builds a synthetic
 * tree under the OS temp directory (this milestone's tests never write inside `lib/`), puts exactly one
 * violation in each file, and requires the scan to report that file and that rule and nothing else, so a
 * rule that stopped firing, or fired on the wrong file, shows up as a specific mismatch.
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: true },
  include: ["lib/**/*.ts", "domains/**/*.ts"],
});

function tree(files: Readonly<Record<string, string>>, symlinks: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "act-architecture-"));
  scratch.push(root);
  const put = (relPath: string, content: string): void => {
    const path = join(root, relPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  put("tsconfig.json", TSCONFIG);
  for (const [path, content] of Object.entries(files)) put(path, content);
  for (const [path, target] of Object.entries(symlinks)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(join(root, target), join(root, path), "dir");
  }
  return root;
}

describe("this repository: lib/ is a closed module graph and obeys the layer table", () => {
  const result = scanModuleGraph({ root: REPO_ROOT, tsconfig: join(REPO_ROOT, "tsconfig.lib.json") });

  it("has no violation", () => {
    expect(summarise(result.violations)).toEqual([]);
  });

  it("really parsed the contract sources and its own tests (not an empty scan passing)", () => {
    expect(result.scanned.length).toBeGreaterThanOrEqual(30);
    for (const expected of [
      "lib/contracts/ids.ts",
      "lib/contracts/standing.ts",
      "lib/contracts/index.ts",
      "lib/contracts/__tests__/architecture.test.ts",
      "lib/contracts/__tests__/support/module-graph.ts",
    ]) {
      expect(result.scanned, expected).toContain(expected);
    }
  });

  it("every allowlisted external for tests is imported by some file, so no allowance is speculative", () => {
    expect([...result.externalsUsed].sort()).toEqual([...TEST_EXTERNALS].sort());
  });

  it("the layer table lists the layers of plan section 5 in order", () => {
    expect(LAYERS.map((l) => l.dir)).toEqual([
      "lib/contracts",
      "lib/chain",
      "lib/allowance",
      "lib/standing",
      "domains",
      "scripts",
      "components",
      "app",
    ]);
    expect(LAYERS.map((l) => l.rank)).toEqual([0, 1, 2, 3, 4, 5, 5, 5]);
  });
});

describe("a synthetic tree with one violation per file: each is reported, and the valid imports beside them are not", () => {
  const files: Record<string, string> = {
    // ---- valid, so the scan has something to wrongly flag ----
    "lib/contracts/base.ts": "export const base = 1;\n",
    "lib/chain/cycle-a.ts": 'import { base } from "../contracts/base.js";\nexport const a = base;\n',
    "lib/standing/back.ts": 'import { a } from "../chain/cycle-a.js";\nexport const b = a;\n',
    "domains/company/ok.ts": 'import { b } from "../../lib/standing/back.js";\nexport const c = b;\n',
    "lib/contracts/__tests__/t-ok.ts": 'import "vitest";\nimport "node:fs";\nimport { base } from "../base.js";\nexport const t = base;\n',
    "lib/contracts/__tests__/t-chain.ts": 'import { t } from "./t-ok.js";\nexport const tc = t;\n', // test -> test is fine
    // ---- one violation each ----
    "lib/contracts/cycle-b.ts": 'import { a } from "../chain/cycle-a.js";\nexport const x = a;\n', // contracts -> chain, closing a cycle
    "lib/chain/up.ts": 'import { b } from "../standing/back.js";\nexport const y = b;\n', // chain -> standing
    "domains/company/up.ts": 'import { p } from "../../app/p.js";\nexport const z = p;\n', // domains -> app
    "app/p.ts": "export const p = 1;\n",
    "scripts/x.ts": "export const X = 1;\n",
    "scripts/x.d.ts": "export declare const X: number;\n",
    "node_modules/pkg/index.ts": "export const pkg = 1;\n",
    "lib/contracts/outside.ts": 'import { X } from "../../scripts/x.js";\nexport const o = X;\n',
    "lib/contracts/nm.ts": 'import { pkg } from "../../node_modules/pkg/index.js";\nexport const n = pkg;\n', // relative AND resolves out
    "lib/contracts/exportfrom.ts": 'export * from "../../scripts/x.js";\n',
    "lib/contracts/typeimport.ts": 'export type T = import("../../scripts/x.js").X;\n',
    "lib/contracts/typeof-import.ts": 'export type U = typeof import("../../scripts/x.js");\n',
    "lib/contracts/ref.ts": '/// <reference path="../../scripts/x.d.ts" />\nexport {};\n',
    "lib/contracts/bare.ts": 'import "node:fs";\n',
    "lib/contracts/pkg-import.ts": 'import "react";\n',
    "lib/contracts/req.ts": 'declare const require: (id: string) => unknown;\nexport const r = require("node:fs");\n',
    "lib/contracts/dyn.ts": "declare const id: string;\nexport const d = import(id);\n",
    "lib/contracts/dyn-literal.ts": 'export const d2 = import("node:os");\n',
    "lib/contracts/unresolved.ts": 'import "./nope.js";\n',
    "lib/contracts/uses-test.ts": 'import { t } from "./__tests__/t-ok.js";\nexport const ut = t;\n', // SOURCE -> a test file that imports node:fs
    "lib/contracts/uses-shared.ts": 'import { h } from "../shared/helper.js";\nexport const s = h;\n',
    "lib/shared/helper.ts": "export const h = 1;\n",
    "lib/loose.ts": "export const loose = 1;\n",
    "lib/contracts/data.json": "{}\n",
    "lib/contracts/decl.d.ts": "export declare const decl: number;\n",
    "lib/contracts/script.js": "export const script = 1;\n",
    "lib/contracts/viasym.ts": 'import { evil } from "./linkdir/evil.js";\nexport const v = evil;\n',
    "lib/contracts/__tests__/t-react.ts": 'import "react";\n',
    "external/evil.ts": "export const evil = 1;\n",
  };
  const root = tree(files, { "lib/contracts/linkdir": "external" });
  const result = scanModuleGraph({ root, tsconfig: join(root, "tsconfig.json") });

  it("reports exactly these file:rule pairs", () => {
    expect(summarise(result.violations)).toEqual(
      [
        "domains/company/up.ts:upward-layer-import",
        "lib/chain/up.ts:upward-layer-import",
        "lib/contracts/__tests__/t-react.ts:external-not-allowed",
        "lib/contracts/bare.ts:external-not-allowed",
        "lib/contracts/cycle-b.ts:upward-layer-import",
        "lib/contracts/data.json:non-ts-file",
        "lib/contracts/decl.d.ts:non-ts-file",
        "lib/contracts/dyn-literal.ts:external-not-allowed",
        "lib/contracts/dyn.ts:non-literal-specifier",
        "lib/contracts/exportfrom.ts:outside-lib",
        "lib/contracts/linkdir:symlink",
        "lib/contracts/nm.ts:outside-lib",
        "lib/contracts/outside.ts:outside-lib",
        "lib/contracts/pkg-import.ts:external-not-allowed",
        "lib/contracts/ref.ts:outside-lib",
        "lib/contracts/req.ts:external-not-allowed",
        "lib/contracts/script.js:non-ts-file",
        "lib/contracts/typeimport.ts:outside-lib",
        "lib/contracts/typeof-import.ts:outside-lib",
        "lib/contracts/unresolved.ts:unresolvable",
        "lib/contracts/uses-test.ts:source-imports-test",
        "lib/contracts/uses-shared.ts:import-of-undeclared-lib-directory",
        "lib/contracts/viasym.ts:outside-lib",
        "lib/loose.ts:undeclared-lib-directory",
        "lib/shared/helper.ts:undeclared-lib-directory",
      ].sort(),
    );
  });

  it("names the offending specifier and line", () => {
    const nm = result.violations.find((v) => v.file === "lib/contracts/nm.ts");
    expect(nm).toMatchObject({ line: 1, specifier: "../../node_modules/pkg/index.js", rule: "outside-lib" });
    const ref = result.violations.find((v) => v.file === "lib/contracts/ref.ts");
    expect(ref).toMatchObject({ line: 1, specifier: "../../scripts/x.d.ts" });
  });

  it("does not flag a library test file that imports vitest and a Node built-in, nor any downward import", () => {
    const flagged = new Set(result.violations.map((v) => v.file));
    for (const clean of ["lib/contracts/__tests__/t-ok.ts", "lib/contracts/__tests__/t-chain.ts", "lib/chain/cycle-a.ts", "lib/standing/back.ts", "domains/company/ok.ts"]) {
      expect(flagged.has(clean), clean).toBe(false);
    }
  });
});

describe("a clean synthetic tree has no violation", () => {
  it("layers importing only downward, a test using the allowlist, and nothing else", () => {
    const root = tree({
      "lib/contracts/a.ts": "export const a = 1;\n",
      "lib/chain/b.ts": 'import { a } from "../contracts/a.js";\nexport const b = a;\n',
      "lib/allowance/c.ts": 'import { b } from "../chain/b.js";\nimport { a } from "../contracts/a.js";\nexport const c = a + b;\n',
      "lib/standing/d.ts": 'import { c } from "../allowance/c.js";\nexport const d = c;\n',
      "domains/company/e.ts": 'import { d } from "../../lib/standing/d.js";\nexport const e = d;\n',
      "lib/contracts/__tests__/a.test.ts": 'import { expect } from "vitest";\nimport { a } from "../a.js";\nexpect(a).toBe(1);\n',
    });
    const result = scanModuleGraph({ root, tsconfig: join(root, "tsconfig.json") });
    expect(summarise(result.violations)).toEqual([]);
    expect(result.scanned).toHaveLength(6);
  });

  it("a file that does not parse is a violation, not a skip", () => {
    const root = tree({ "lib/contracts/broken.ts": "export const = ;\n" });
    const result = scanModuleGraph({ root, tsconfig: join(root, "tsconfig.json") });
    expect(summarise(result.violations)).toEqual(["lib/contracts/broken.ts:unparseable"]);
  });
});
