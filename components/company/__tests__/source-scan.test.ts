import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scanPageSource, summarise } from "./support/scan.js";

/**
 * The page's own source, scanned (plan §6 M8 falsifiable check 4, and the rule that only the bridge imports `lib/**` and `domains/**`).
 *
 * What the scan reports and what it cannot see is written at the top of `support/scan.ts`. This file has three parts:
 *   1. the real source: no finding, the files really were parsed (not an empty scan passing), and the bridge is the only importer of the engine;
 *   2. TEETH: a synthetic tree with one planted violation per file for each form the scan claims to see, beside controls that look like violations and
 *      must not be reported; exactly the planted file:rule pairs come back;
 *   3. THE BLIND SPOTS, pinned: the idiomatic evasions the scan does not see, planted and shown NOT reported, so that the sentence "it does not see X" is itself a test.
 * Nothing here writes inside the repository: every tree is under the OS temporary directory.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", noEmit: true, skipLibCheck: true },
  include: ["lib/**/*.ts", "domains/**/*.ts", "components/**/*.ts", "components/**/*.tsx", "app/**/*.ts", "app/**/*.tsx"],
});

const ENGINE_STUBS: Readonly<Record<string, string>> = {
  "lib/contracts/index.ts": "export type T = number;\n",
  "lib/standing/index.ts": "export const fold = (): number => 1;\nexport const append = (): number => 2;\n",
  "lib/standing/deep.ts": "export const deep = 3;\n",
  "domains/company/index.ts": "export const offer = (): number => 4;\n",
  "components/company/compute-demo-view.ts": 'import { fold } from "../../lib/standing/index.js";\nexport const view = (): number => fold();\n',
};

function tree(files: Readonly<Record<string, string>>, symlinks: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "act-page-scan-"));
  scratch.push(root);
  const put = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  put("tsconfig.json", TSCONFIG);
  for (const [path, content] of Object.entries({ ...ENGINE_STUBS, ...files })) put(path, content);
  for (const [path, target] of Object.entries(symlinks)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(join(root, target), join(root, path));
  }
  return root;
}

const scan = (files: Readonly<Record<string, string>>, symlinks: Readonly<Record<string, string>> = {}) => {
  const root = tree(files, symlinks);
  return scanPageSource({ root, tsconfig: join(root, "tsconfig.json") });
};

describe("the real page source", () => {
  const result = scanPageSource({ root: REPO_ROOT, tsconfig: join(REPO_ROOT, "tsconfig.json") });

  it("has no finding", () => {
    expect(result.findings).toEqual([]);
  });

  it("really parsed the files it is about (the bridge, the component, the formatters, the page, the milestones)", () => {
    expect(result.scanned).toEqual(
      expect.arrayContaining([
        "components/company/compute-demo-view.ts",
        "components/company/CompanyDemo.tsx",
        "components/company/format-standing.ts",
        "components/company/format-breach.ts",
        "components/company/format-rejection.ts",
        "components/company/format-attempt.ts",
        "app/page.tsx",
        "app/milestones.ts",
      ]),
    );
  });

  it("the bridge is the only scanned file that imports lib/ or domains/", () => {
    expect(result.engineImporters).toEqual(["components/company/compute-demo-view.ts"]);
  });
});

describe("TEETH: every form the scan claims to see is reported, in exactly the planted file", () => {
  const planted: Readonly<Record<string, string>> = {
    "components/company/a-effect.tsx": 'import { useEffect } from "react";\nexport const A = () => { useEffect(() => {}, []); return null; };\n',
    "components/company/b-dot.tsx": 'import * as React from "react";\nexport const B = () => React.useMemo(() => 1, []);\n',
    "components/company/c-string.tsx": 'import * as React from "react";\nexport const C = () => React["useCallback"](() => 1, []);\n',
    "components/company/d-destructure.tsx": 'import * as React from "react";\nconst { useLayoutEffect: e } = React;\nexport const D = e;\n',
    "components/company/e-timer.ts": "export const E = () => setTimeout(() => 1, 0);\n",
    "components/company/f-interval.ts": "export const F = () => setInterval(() => 1, 0);\n",
    "components/company/g-async.ts": "export async function G() { return 1; }\n",
    "components/company/h-await.ts": "export const H = async () => { await 1; };\n",
    "components/company/i-promise.ts": "export const I = new Promise(() => {});\n",
    "components/company/j-state.tsx": 'import { useState } from "react";\nexport const J = () => useState(1);\n',
    "components/company/k-date.ts": "export const K = Date.now();\n",
    "components/company/l-random.ts": "export const L = Math.random();\n",
    "components/company/m-window.ts": "export const M = typeof window;\n",
    "components/company/n-import.ts": 'import { deep } from "../../lib/standing/deep.js";\nexport const N = deep;\n',
    "components/company/o-barrel.ts": 'import { append } from "../../lib/standing/index.js";\nexport const O = 1;\nexport { append };\n',
    "components/company/p-export-from.ts": 'export { offer } from "../../domains/company/index.js";\n',
    "components/company/q-dynamic.ts": 'export const Q = () => import("../../lib/standing/index.js");\n',
    "components/company/r-require.ts": 'declare const require: (s: string) => unknown;\nexport const R = require("../../lib/standing/index.js");\n',
    "components/company/s-importtype.ts": 'export type S = import("../../lib/contracts/index.js").T;\n',
    "components/company/t-computed.ts": "declare const name: string;\nexport const T = () => import(name);\n",
    "components/company/u-bare.ts": 'import { readFileSync } from "node:fs";\nexport const U = readFileSync;\n',
    "components/company/v-unresolved.ts": 'import { x } from "./nowhere.js";\nexport const V = x;\n',
    "components/company/w-call.ts": "declare const fold: () => number;\nexport const W = fold();\n",
    "components/company/x-fetch.ts": 'export const X = () => fetch("/x");\n',
    "components/company/y.json": "{}\n",
    "app/page.tsx": 'import { useMemo } from "react";\nexport default function Home() { return useMemo(() => null, []); }\n',
  };

  const result = scan(planted);

  it("reports exactly the planted file and rule pairs", () => {
    expect(summarise(result.findings)).toEqual(
      [
        "components/company/a-effect.tsx:banned-hook",
        "components/company/b-dot.tsx:banned-hook",
        "components/company/c-string.tsx:banned-hook",
        "components/company/d-destructure.tsx:banned-hook",
        "components/company/e-timer.ts:banned-hook",
        "components/company/f-interval.ts:banned-hook",
        "components/company/g-async.ts:async",
        "components/company/h-await.ts:async",
        "components/company/i-promise.ts:async",
        "components/company/j-state.tsx:other-hook",
        "components/company/k-date.ts:nondeterminism",
        "components/company/l-random.ts:nondeterminism",
        "components/company/m-window.ts:nondeterminism",
        "components/company/n-import.ts:engine-import",
        "components/company/o-barrel.ts:engine-call",
        "components/company/o-barrel.ts:engine-import",
        "components/company/p-export-from.ts:engine-call",
        "components/company/p-export-from.ts:engine-import",
        "components/company/q-dynamic.ts:engine-import",
        "components/company/r-require.ts:engine-import",
        "components/company/s-importtype.ts:engine-import",
        "components/company/t-computed.ts:import-other",
        "components/company/u-bare.ts:import-other",
        "components/company/v-unresolved.ts:import-other",
        "components/company/w-call.ts:engine-call",
        "components/company/x-fetch.ts:nondeterminism",
        "components/company/y.json:inventory",
        "app/page.tsx:banned-hook",
      ].sort(),
    );
  });

  it("does not report the bridge, which imports the engine barrels it is allowed to and nothing else", () => {
    expect(result.findings.filter((finding) => finding.file === "components/company/compute-demo-view.ts")).toEqual([]);
    expect(result.engineImporters).toContain("components/company/compute-demo-view.ts");
  });

  it("reports line numbers (the second line of a-effect.tsx for the call, the first for the import)", () => {
    const lines = result.findings.filter((finding) => finding.file === "components/company/a-effect.tsx").map((finding) => finding.line).sort();
    expect(lines).toEqual([1, 2]);
  });

  it("the bridge importing a file under lib/ that is not a barrel is reported", () => {
    const bad = scan({ "components/company/compute-demo-view.ts": 'import { deep } from "../../lib/standing/deep.js";\nexport const v = deep;\n' });
    expect(summarise(bad.findings)).toEqual(["components/company/compute-demo-view.ts:engine-import"]);
  });

  it("a symlink in the directory is reported", () => {
    const linked = scan({ "components/company/real.ts": "export const r = 1;\n" }, { "components/company/link.ts": "components/company/real.ts" });
    expect(summarise(linked.findings)).toEqual(["components/company/link.ts:inventory"]);
  });

  it("a file that does not parse is reported, not skipped", () => {
    const broken = scan({ "components/company/broken.ts": "export const = ;\n" });
    expect(summarise(broken.findings)).toEqual(["components/company/broken.ts:inventory"]);
  });
});

describe("controls: things that look like violations and are not reported", () => {
  const controls: Readonly<Record<string, string>> = {
    "components/company/ok-reducer.tsx": 'import { useReducer } from "react";\nexport const Ok = () => useReducer((s: number) => s, 0);\n',
    "components/company/ok-types.ts": 'import type { T } from "../../lib/contracts/index.js";\nexport type U = T;\n',
    "components/company/ok-local.ts": 'import { view } from "./compute-demo-view.js";\nexport const ok = view;\n',
    "components/company/ok-names.ts": 'export const useless = 1;\nexport const timeout = 2;\nexport const dated = 3;\nexport const formatOffered = 4;\nexport const standingLine = 5;\nexport const Standings = 6;\n',
    "components/company/ok-math.ts": "export const m = Math.trunc(1.5) + Math.min(1, 2);\n",
    "components/company/ok-string.ts": 'export const s = "use the effect hook is banned";\nexport const t = "append";\n',
  };

  it("a useReducer, a relative import of the bridge, look-alike names, Math.trunc and plain strings are not reported; a type-only import of lib outside the bridge is", () => {
    // ok-types.ts imports a type from lib in a non-bridge file: that IS an engine import (a type import is a module reference), so it is the one control that is reported.
    expect(summarise(scan(controls).findings)).toEqual(["components/company/ok-types.ts:engine-import"]);
    const { ["components/company/ok-types.ts"]: _dropped, ...rest } = controls;
    void _dropped;
    expect(scan(rest).findings).toEqual([]);
  });
});

describe("THE BLIND SPOTS: evasions the scan does not see, planted and shown not reported", () => {
  const evasions: Readonly<Record<string, string>> = {
    "components/company/concat.tsx": 'import * as React from "react";\nconst key = "use" + "Effect";\nexport const C = (React as unknown as Record<string, () => void>)[key];\n',
    "components/company/template.ts": 'const part = "Timeout";\nexport const T = (self as unknown as Record<string, unknown>)[`set${part}`];\n',
    "components/company/join.tsx": 'import * as React from "react";\nexport const J = (React as unknown as Record<string, unknown>)[["use", "Memo"].join("")];\n',
    "components/company/reflect.tsx": 'import * as React from "react";\nexport const R = Reflect.get(React, ["use", "Callback"].join(""));\n',
    "components/company/computed.tsx": 'import * as React from "react";\ndeclare const hook: string;\nexport const K = (React as unknown as Record<string, unknown>)[hook];\n',
    "components/company/dyn-react.ts": 'declare const k: string;\nexport const D = import("react").then((m) => (m as unknown as Record<string, unknown>)[k]);\n',
  };

  it("none of these is reported (a green scan says nothing about them)", () => {
    expect(scan(evasions).findings).toEqual([]);
  });

  it("a file outside the scanned set is not looked at (app/layout.tsx here)", () => {
    expect(scan({ "app/layout.tsx": 'import { useEffect } from "react";\nexport default function L() { useEffect(() => {}, []); return null; }\n' }).findings).toEqual([]);
  });
});
