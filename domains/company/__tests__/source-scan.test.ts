import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readKindLists, scanCompanySource, summarise } from "./support/source-scan.js";
import type { KindLists } from "./support/source-scan.js";

/**
 * The domain holds no authority rule (plan §6 M6 "Must refuse"), as a scan and as the proof that the scan can fail.
 *
 * What the scan checks, and what it cannot, is written at the top of `support/source-scan.ts`; read that before reading a green
 * result here as more than it says. This file has four parts:
 *   1. the kind lists the scan refuses are the kinds `lib/contracts` declares (read from its source, then compared to the plan's lists);
 *   2. the real `domains/company` source has no finding, and the scan really parsed it (not an empty scan passing);
 *   3. TEETH: a synthetic tree with one planted violation per file, for every pattern of every rule, beside controls that look like
 *      the violations and must not be reported, and exactly these file:rule pairs come back;
 *   4. TEETH ON THE REAL FILES: the real source copied to a scratch tree with one line planted in each of six of its files; exactly those six
 *      are reported, at the lines the plants were put on.
 * Nothing here writes inside the repository: every tree is under the OS temporary directory.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const TSCONFIG = join(REPO_ROOT, "tsconfig.lib.json");

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const SYNTHETIC_TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: true },
  include: ["lib/**/*.ts", "domains/**/*.ts", "app/**/*.ts"],
});

function tree(files: Readonly<Record<string, string>>, symlinks: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "act-company-scan-"));
  scratch.push(root);
  const put = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  put("tsconfig.json", SYNTHETIC_TSCONFIG);
  for (const [path, content] of Object.entries(files)) put(path, content);
  for (const [path, target] of Object.entries(symlinks)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(join(root, target), join(root, path), "dir");
  }
  return root;
}

const KINDS: KindLists = readKindLists(REPO_ROOT, TSCONFIG);

describe("the kinds the scan refuses are the kinds lib/contracts declares", () => {
  it("Standing has these three kinds (plan §4.2), read from lib/contracts/standing.ts", () => {
    expect([...KINDS.standing].sort()).toEqual(["binding", "inherited", "void"]);
  });

  it("Breach, Rejection and FoldFault have these 5 + 15 + 5 kinds (plan §4.1, §4.3), read from their sources", () => {
    expect([...KINDS.ruling].sort()).toEqual(
      [
        // Breach
        "capability-not-granted",
        "link-dead",
        "no-such-grant",
        "over-limit",
        "wrong-actor",
        // Rejection
        "already-dead",
        "capability-widening",
        "depth-exhausted",
        "depth-not-narrowed",
        "duplicate-id",
        "grantor-not-holder",
        "invalid-event-shape",
        "not-a-root",
        "over-allocation",
        "parent-dead",
        "principal-cycle",
        "revoker-not-authorised",
        "unknown-capability",
        "unknown-grant",
        "unknown-parent",
        // FoldFault
        "hostile-log-input",
        "inadmissible-event",
        "invalid-charter",
        "log-too-long",
        "seq-mismatch",
      ].sort(),
    );
  });
});

describe("this repository: domains/company source has no finding", () => {
  const result = scanCompanySource({ root: REPO_ROOT, tsconfig: TSCONFIG, kinds: KINDS });

  it("has no finding", () => {
    expect(result.findings).toEqual([]);
  });

  it("really parsed the six source files of the domain (not an empty scan passing)", () => {
    expect(result.scanned).toEqual(["org", "policies", "script", "simulate", "view", "index"].map((name) => `domains/company/${name}.ts`).sort());
  });
});

describe("TEETH: a synthetic tree with one planted violation per file, and controls beside them", () => {
  const barrels = ["contracts", "chain", "allowance", "standing"].flatMap((layer) => [[`lib/${layer}/index.ts`, "export const b = 1;\nexport type T = string;\n"]] as const);
  const files: Record<string, string> = {
    ...Object.fromEntries(barrels),
    "lib/chain/chain.ts": "export const x = 1;\n",
    "lib/chain/intake.ts": "export const y = 1;\n",
    "lib/contracts/ids.ts": "export type T = string;\n",
    "lib/allowance/accounting.ts": "export const x = 1;\n",
    "lib/standing/append.ts": "export const x = 1;\n",
    "lib/standing/fold.ts": "export const x = 1;\n",
    "app/p.ts": "export const p = 1;\n",
    "domains/other/o.ts": "export const o = 1;\n",
    "domains/company/__tests__/t.ts": "export const t = 1;\n",
    "external/evil.ts": "export const evil = 1;\n",

    // ---- controls: every one of these must come back clean ----
    "domains/company/ok-sibling.ts": "export const sib = 1;\n",
    "domains/company/ok-barrels.ts":
      'import { b } from "../../lib/contracts/index.js";\nimport { b as c } from "../../lib/chain/index.js";\nimport { b as d } from "../../lib/allowance/index.js";\n' +
      'import { b as e } from "../../lib/standing/index.js";\nimport type { T } from "../../lib/contracts/index.js";\nimport { sib } from "./ok-sibling.js";\n' +
      'export { sib as again } from "./ok-sibling.js";\nexport const all = [b, c, d, e, sib];\nexport type U = T;\n',
    "domains/company/ok-money-passed-through.ts":
      'declare const g: { limit: number; amount: number };\nexport const same = g.amount === g.limit;\nexport const copy = { limit: g.limit, amount: g.amount };\nexport const text = `${g.amount} of ${g.limit}`;\n',
    "domains/company/ok-arithmetic-elsewhere.ts":
      "declare const g: { depth: number; head: number };\ndeclare const items: readonly number[];\nexport const a = g.depth - 1;\nexport const b = items.length + 1;\nexport const c = g.head + 1;\nexport const d = Math.min(g.depth, 3);\nexport const e = g.depth < 4;\n",
    "domains/company/ok-words.ts":
      'export const text = "the grant was revoked, the limit is somebody else\'s, the amount is theirs";\nexport const verdict = { kind: "warranted" };\nexport const events = ["grant", "revoke", "commit"];\nexport const outcome = { kind: "admitted" };\n',
    "domains/company/ok-property-named-like-a-global.ts": "declare const o: { Date: number; process: number };\nexport const a = o.Date;\nexport const b = { process: 1, Date: 2 };\n",

    // ---- standing-kind ----
    "domains/company/sk-value.ts": 'export const s = { kind: "void" };\n',
    "domains/company/sk-type.ts": 'export type T = { readonly kind: "binding" };\n',
    "domains/company/sk-compare.ts": 'declare const s: { kind: string };\nexport const b = s.kind === "inherited";\n',
    "domains/company/sk-template.ts": "export const s = `void`;\n",

    // ---- ruling-kind ----
    "domains/company/rk-breach.ts": 'export const r = { kind: "over-limit" };\n',
    "domains/company/rk-rejection.ts": 'export const r = { kind: "capability-widening" };\n',
    "domains/company/rk-fault.ts": 'export const r = "seq-mismatch";\n',
    "domains/company/rk-type.ts": 'export type R = { kind: "parent-dead" };\n',

    // ---- money-arithmetic ----
    "domains/company/m-binary.ts": "declare const g: { limit: number };\nexport const x = g.limit - 1;\n",
    "domains/company/m-multiply.ts": "declare const headroom: number;\nexport const x = headroom * 0.5;\n",
    "domains/company/m-compound.ts": "export let amount = 0;\namount += 5;\n",
    "domains/company/m-increment.ts": "export let amount = 0;\namount++;\n",
    "domains/company/m-negate.ts": "declare const limit: number;\nexport const n = -limit;\n",
    "domains/company/m-compare.ts": "declare const amount: number;\ndeclare const room: number;\nexport const ok = amount <= room;\n",
    "domains/company/m-less.ts": "declare const amount: number;\ndeclare const room: number;\nexport const ok = amount < room;\n",
    "domains/company/m-two-hop.ts": "declare const g: { limit: number };\nlet b = 0;\nlet a = 0;\nb = a;\na = g.limit;\nexport const x = b + 1;\n",
    "domains/company/m-math.ts": "declare const g: { limit: number };\nexport const x = Math.min(g.limit, 5);\n",
    "domains/company/m-alias.ts": "declare const g: { limit: number };\nconst l = g.limit;\nexport const x = l - 1;\n",
    "domains/company/m-alias-chain.ts": "declare const g: { limit: number };\nconst a = g.limit;\nconst b = a;\nexport const x = b + 1;\n",
    "domains/company/m-destructure.ts": "declare const g: { limit: number };\nconst { limit: cap } = g;\nexport const x = cap * 2;\n",
    "domains/company/m-assign.ts": "declare const g: { limit: number };\nlet v = 0;\nv = g.limit;\nexport const x = v / 2;\n",
    "domains/company/m-element.ts": 'declare const g: Record<string, number>;\nexport const x = g["limit"] + 1;\n',
    "domains/company/m-price-list.ts": "const ORDER_AMOUNTS = [1, 2] as const;\nexport const x = ORDER_AMOUNTS[0] * 2;\n",
    "domains/company/m-two.ts": "declare const g: { limit: number; amount: number };\nexport const a = g.limit + 1;\nexport const b = g.amount * 2;\n",

    // ---- import-not-allowed ----
    "domains/company/i-deep.ts": 'import { x } from "../../lib/chain/chain.js";\nexport const d = x;\n',
    "domains/company/i-deep-type.ts": 'import type { T } from "../../lib/contracts/ids.js";\nexport type U = T;\n',
    "domains/company/i-deep-reexport.ts": 'export { x } from "../../lib/allowance/accounting.js";\n',
    "domains/company/i-deep-star.ts": 'export * from "../../lib/standing/fold.js";\n',
    "domains/company/i-deep-dynamic.ts": 'export const d = import("../../lib/standing/append.js");\n',
    "domains/company/i-deep-typeof.ts": 'export type T = typeof import("../../lib/chain/intake.js");\n',
    "domains/company/i-node.ts": 'import "node:fs";\n',
    "domains/company/i-package.ts": 'import "react";\n',
    "domains/company/i-app.ts": 'import { p } from "../../app/p.js";\nexport const q = p;\n',
    "domains/company/i-other-domain.ts": 'import { o } from "../other/o.js";\nexport const q = o;\n',
    "domains/company/i-test-file.ts": 'import { t } from "./__tests__/t.js";\nexport const q = t;\n',
    "domains/company/i-non-literal.ts": "declare const spec: string;\nexport const d = import(spec);\n",
    "domains/company/i-require.ts": 'declare const require: (id: string) => unknown;\nexport const r = require("node:fs");\n',
    "domains/company/i-missing.ts": 'import "./nope.js";\n',
    "domains/company/i-reference.ts": '/// <reference path="../../lib/chain/chain.ts" />\nexport {};\n',
    "domains/company/i-through-symlink.ts": 'import { evil } from "./linkdir/evil.js";\nexport const v = evil;\n',

    // ---- nondeterminism ----
    "domains/company/n-random.ts": "export const r = Math.random();\n",
    "domains/company/n-date.ts": "export const r = Date.now();\n",
    "domains/company/n-new-date.ts": "export const r = new Date();\n",
    "domains/company/n-performance.ts": "export const r = performance.now();\n",
    "domains/company/n-crypto.ts": "export const r = crypto.randomUUID();\n",
    "domains/company/n-microtask.ts": "export const r = queueMicrotask(() => 0);\n",
    "domains/company/n-timeout.ts": "export const r = setTimeout(() => 0, 1);\n",
    "domains/company/n-process.ts": "export const r = process.env;\n",
    "domains/company/n-global-this.ts": "export const r = globalThis;\n",
    "domains/company/n-fetch.ts": 'export const r = fetch("x");\n',
    "domains/company/n-eval.ts": 'export const r = eval("1");\n',
    "domains/company/n-shorthand.ts": "declare const process: number;\nexport const r = { process };\n",

    // ---- inventory ----
    "domains/company/broken.ts": "export const = ;\n",
    "domains/company/script.js": "export const script = 1;\n",
    "domains/company/types.d.ts": "export declare const decl: number;\n",
    "domains/company/data.json": "{}\n",
  };
  const root = tree(files, { "domains/company/linkdir": "external" });
  const result = scanCompanySource({ root, tsconfig: join(root, "tsconfig.json"), kinds: KINDS });

  it("reports exactly these file:rule pairs", () => {
    expect(summarise(result.findings)).toEqual(
      [
        "domains/company/sk-value.ts:standing-kind",
        "domains/company/sk-type.ts:standing-kind",
        "domains/company/sk-compare.ts:standing-kind",
        "domains/company/sk-template.ts:standing-kind",

        "domains/company/rk-breach.ts:ruling-kind",
        "domains/company/rk-rejection.ts:ruling-kind",
        "domains/company/rk-fault.ts:ruling-kind",
        "domains/company/rk-type.ts:ruling-kind",

        "domains/company/m-binary.ts:money-arithmetic",
        "domains/company/m-multiply.ts:money-arithmetic",
        "domains/company/m-compound.ts:money-arithmetic",
        "domains/company/m-increment.ts:money-arithmetic",
        "domains/company/m-negate.ts:money-arithmetic",
        "domains/company/m-compare.ts:money-arithmetic",
        "domains/company/m-less.ts:money-arithmetic",
        "domains/company/m-two-hop.ts:money-arithmetic",
        "domains/company/m-math.ts:money-arithmetic",
        "domains/company/m-alias.ts:money-arithmetic",
        "domains/company/m-alias-chain.ts:money-arithmetic",
        "domains/company/m-destructure.ts:money-arithmetic",
        "domains/company/m-assign.ts:money-arithmetic",
        "domains/company/m-element.ts:money-arithmetic",
        "domains/company/m-price-list.ts:money-arithmetic",
        "domains/company/m-two.ts:money-arithmetic",
        "domains/company/m-two.ts:money-arithmetic",

        "domains/company/i-deep.ts:import-not-allowed",
        "domains/company/i-deep-type.ts:import-not-allowed",
        "domains/company/i-deep-reexport.ts:import-not-allowed",
        "domains/company/i-deep-star.ts:import-not-allowed",
        "domains/company/i-deep-dynamic.ts:import-not-allowed",
        "domains/company/i-deep-typeof.ts:import-not-allowed",
        "domains/company/i-node.ts:import-not-allowed",
        "domains/company/i-package.ts:import-not-allowed",
        "domains/company/i-app.ts:import-not-allowed",
        "domains/company/i-other-domain.ts:import-not-allowed",
        "domains/company/i-test-file.ts:import-not-allowed",
        "domains/company/i-non-literal.ts:import-not-allowed",
        "domains/company/i-require.ts:import-not-allowed",
        "domains/company/i-missing.ts:import-not-allowed",
        "domains/company/i-reference.ts:import-not-allowed",
        "domains/company/i-through-symlink.ts:import-not-allowed",

        "domains/company/n-random.ts:nondeterminism",
        "domains/company/n-date.ts:nondeterminism",
        "domains/company/n-new-date.ts:nondeterminism",
        "domains/company/n-performance.ts:nondeterminism",
        "domains/company/n-crypto.ts:nondeterminism",
        "domains/company/n-microtask.ts:nondeterminism",
        "domains/company/n-timeout.ts:nondeterminism",
        "domains/company/n-process.ts:nondeterminism",
        "domains/company/n-global-this.ts:nondeterminism",
        "domains/company/n-fetch.ts:nondeterminism",
        "domains/company/n-eval.ts:nondeterminism",
        "domains/company/n-shorthand.ts:nondeterminism", // the declaration of a local called `process`, and the shorthand that reads it: both are reported
        "domains/company/n-shorthand.ts:nondeterminism",

        "domains/company/broken.ts:unparseable",
        "domains/company/script.js:non-ts-file",
        "domains/company/types.d.ts:non-ts-file",
        "domains/company/data.json:non-ts-file",
        "domains/company/linkdir:symlink",
      ].sort(),
    );
  });

  it("names the line and the text of what it found", () => {
    const at = (file: string): { line: number; detail: string }[] => result.findings.filter((f) => f.file === `domains/company/${file}`).map((f) => ({ line: f.line, detail: f.detail }));
    expect(at("m-two.ts")).toEqual([
      { line: 2, detail: "g.limit + 1" },
      { line: 3, detail: "g.amount * 2" },
    ]);
    expect(at("sk-compare.ts")).toEqual([{ line: 2, detail: "inherited" }]);
    expect(at("i-deep-reexport.ts")).toEqual([{ line: 1, detail: "../../lib/allowance/accounting.js" }]);
    expect(at("n-random.ts")).toEqual([{ line: 1, detail: "Math.random" }]);
  });

  it("does not report any control: the allowed imports, money that is only passed along or compared for equality, arithmetic on other things, plain words, a property that shares a name with a global", () => {
    const flagged = new Set(result.findings.map((f) => f.file));
    for (const clean of ["ok-sibling", "ok-barrels", "ok-money-passed-through", "ok-arithmetic-elsewhere", "ok-words", "ok-property-named-like-a-global"]) {
      expect(flagged.has(`domains/company/${clean}.ts`), clean).toBe(false);
      expect(result.scanned, clean).toContain(`domains/company/${clean}.ts`);
    }
  });

  it("does not look inside __tests__ (which imports vitest and the other layers' fixtures on purpose)", () => {
    expect(result.scanned).not.toContain("domains/company/__tests__/t.ts");
  });
});

describe("TEETH ON THE REAL FILES: one line planted in each of six real source files is reported, on its own line", () => {
  const real = join(REPO_ROOT, "domains", "company");
  const sources = readdirSync(real).filter((name) => name.endsWith(".ts"));

  // [file, line planted at the end of it, the rule it must come back with]
  const planted: readonly (readonly [string, string, string])[] = [
    ["org.ts", 'export const plantedStanding = { kind: "inherited" };', "standing-kind"],
    ["view.ts", "export const plantedHeadroom = (g: { limit: number }): number => g.limit - 1;", "money-arithmetic"],
    ["policies.ts", "export const plantedShare = DELEGATION_LIMITS[0] / 2;", "money-arithmetic"],
    ["script.ts", 'import { chainOf } from "../../lib/chain/chain.js";\nexport const plantedWalk = chainOf;', "import-not-allowed"],
    ["simulate.ts", 'export const plantedRejection = { kind: "over-allocation" };', "ruling-kind"],
    ["index.ts", "export const plantedSeed = Math.random();", "nondeterminism"],
  ];

  const stubs: Record<string, string> = {};
  for (const layer of ["contracts", "chain", "allowance", "standing"]) stubs[`lib/${layer}/index.ts`] = "export {};\n";
  stubs["lib/chain/chain.ts"] = "export const chainOf = 1;\n";
  const root = tree(stubs);
  const lengths = new Map<string, number>();
  for (const name of sources) {
    const extra = planted.find((row) => row[0] === name);
    const text = readFileSync(join(real, name), "utf8");
    const withPlant = extra === undefined ? text : `${text}${text.endsWith("\n") ? "" : "\n"}${extra[1]}\n`;
    lengths.set(name, text.split("\n").length);
    mkdirSync(join(root, "domains", "company"), { recursive: true });
    writeFileSync(join(root, "domains", "company", name), withPlant);
  }
  const result = scanCompanySource({ root, tsconfig: join(root, "tsconfig.json"), kinds: KINDS });

  it("the six real source files were all copied, and each plant is in one of them", () => {
    expect([...sources].sort()).toEqual(["index.ts", "org.ts", "policies.ts", "script.ts", "simulate.ts", "view.ts"]);
    expect(planted.map((row) => row[0]).sort()).toEqual([...sources].sort());
  });

  it("reports exactly the six planted lines and nothing in the real text around them", () => {
    expect(summarise(result.findings)).toEqual(planted.map((row) => `domains/company/${row[0]}:${row[2]}`).sort());
  });

  it("each is on the line it was planted at (the first line after the real text)", () => {
    for (const [name, , rule] of planted) {
      const finding = result.findings.find((f) => f.file === `domains/company/${name}` && f.rule === rule);
      // `split` counts the empty string after the final newline, so the real text has `length - 1` lines and the plant starts on the next one.
      expect(finding?.line, name).toBe(lengths.get(name));
    }
  });
});
