import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isVariableStatement,
  SyntaxKind,
  type Node,
} from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { standings } from "../../../lib/standing/index.js";
import { CHARTER } from "../org.js";
import { replayScript } from "../simulate.js";
import { oracleOf } from "./support/oracle.js";

/**
 * `npm run demo:company` and its exit code (plan §6 M6: it "exits non-zero unless" every kind was observed and the oracle holds).
 *
 * The first block runs the real script on the real tree, as the documented command does, and reads what it printed. The second runs it on COPIES
 * of the tree under the OS temporary directory, each with one change that the demo must not survive, and requires exit code 1 and a message that
 * names the thing that broke. A copy with no change is the control: it must exit 0, so that every non-zero below is the change's doing and not the copy's.
 * Every change is made by a replacement that must match exactly once, so a sabotage that stops applying is a red test and not a silent pass.
 *
 * Nothing here writes inside the repository. The copies hold `lib/`, the domain's source, the three files under `scripts/` and a package.json that says
 * `"type": "module"`; no `node_modules` (the demo imports nothing from a package).
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const COMMAND = ["--import", "./scripts/register-ts-loader.mjs", "scripts/demo-company.ts"];

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(cwd: string): Run {
  // The environment is passed on as it is except that nothing here depends on AI_AGENT or CLAUDECODE: the script prints with console.log through node itself, not through vitest.
  const result = spawnSync(process.execPath, COMMAND, { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function copyOfTree(): string {
  const root = mkdtempSync(join(tmpdir(), "act-demo-copy-"));
  scratch.push(root);
  const skipTests = (source: string): boolean => !source.split(/[\\/]/).includes("__tests__");
  cpSync(join(REPO_ROOT, "lib"), join(root, "lib"), { recursive: true, filter: skipTests });
  cpSync(join(REPO_ROOT, "domains", "company"), join(root, "domains", "company"), { recursive: true, filter: skipTests });
  mkdirSync(join(root, "scripts"));
  for (const file of ["demo-company.ts", "register-ts-loader.mjs", "ts-loader-hooks.mjs"]) cpSync(join(REPO_ROOT, "scripts", file), join(root, "scripts", file));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  return root;
}

/** Replace `from` by `to` in `file` of the copy, and fail unless `from` occurs exactly once. */
function mutate(root: string, file: string, from: string | RegExp, to: string): void {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  const matches = typeof from === "string" ? text.split(from).length - 1 : (text.match(new RegExp(from.source, `${from.flags.replace("g", "")}g`)) ?? []).length;
  if (matches !== 1) throw new Error(`the change to ${file} should match once and matched ${matches} times: ${String(from)}`);
  writeFileSync(path, text.replace(from, to));
}

describe("the real demo, on the real tree", () => {
  const first = run(REPO_ROOT);

  it("exits 0, prints no error, and ends with its own verdict", () => {
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout.trimEnd().split("\n").at(-1)).toMatch(/^demo OK: /);
  });

  it("prints the attempt, the engine's typed result and plan §7's answer for each of the 33 steps, in order", () => {
    const steps = first.stdout.split("\n").filter((line) => /^\[\d\d\] /.test(line));
    expect(steps).toHaveLength(33);
    expect(steps.map((line) => line.slice(1, 3))).toEqual(Array.from({ length: 33 }, (_, index) => String(index + 1).padStart(2, "0")));
    expect(first.stdout.split("\n").filter((line) => line.startsWith("     offered  "))).toHaveLength(33);
    expect(first.stdout.split("\n").filter((line) => line.startsWith("     engine   "))).toHaveLength(33);
    expect(first.stdout.split("\n").filter((line) => line.startsWith("     plan §7  "))).toHaveLength(33);
  });

  it("prints the engine's result as typed JSON: one admitted commit with its warrant, one refusal with its numbers, one void with its breach", () => {
    expect(first.stdout).toContain('engine   {"kind":"admitted","seq":7,"verdict":{"kind":"warranted","warrant":{"chain":["G1","G2","G4"],"trail":["dana","cfo","ops","buyer-a"]}}}');
    expect(first.stdout).toContain('engine   {"kind":"rejected","rejection":{"kind":"over-allocation","grantId":"G2","requested":200000,"headroom":50000}}');
    expect(first.stdout).toContain('engine   {"kind":"admitted","seq":15,"verdict":{"kind":"breached","breach":{"kind":"over-limit","grantId":"G6","requested":50000,"headroom":28000}}}');
  });

  it("at the revoke it prints the standings before and after, and absorbed 220000, returned 180000, G1's headroom 500000 to 680000 (plan §7)", () => {
    const out = first.stdout;
    for (const line of [
      "standings before (log of seq 1 to 10)",
      "standings after  (log of seq 1 to 11)",
      "absorbed (engine: lib/allowance absorbedBy G2) = 220000",
      "absorbed (oracle: raw log and standings, the binding amounts under G2's subtree) = 220000",
      "returned = limit(G2) 400000 - absorbed = 180000",
      "G1 headroom: 500000 -> 680000",
    ]) {
      expect(out, line).toContain(line);
    }
    expect(out).toContain("c1   at seq  7  inherited severed G2@11  heir cfo  chargedTo G1");
    expect(out).toContain("c1   at seq  7  binding   warrant chain G1>G2>G4");
  });

  it("reports every kind observed: Standing 3/3, Breach 5/5, Rejection 15/15", () => {
    expect(first.stdout).toContain("Standing  3/3");
    expect(first.stdout).toContain("Breach    5/5");
    expect(first.stdout).toContain("Rejection 15/15");
  });

  it("its oracle's number for the §7 log is the number this file's own, separate oracle computes from the same log: 242000 bound of 1000000 under G1", () => {
    const log = replayScript().log;
    const list = standings(CHARTER, log);
    if (!list.ok) throw new Error("standings");
    const mine = oracleOf(log, list.standings).bounds.find((entry) => entry.grant === "G1");
    expect([mine?.bound, mine?.limit]).toEqual([242_000, 1_000_000]);
    expect(first.stdout).toContain("root G1: 242000 bound of a limit of 1000000");
  });

  it("says how many prefixes its oracle checked, and it is every prefix: 18 for §7, and as many as the quarter's log has events", () => {
    expect(first.stdout).toContain("(checked at every prefix, seq 1 to 18: 18 prefixes)");
    expect(first.stdout).toMatch(/the oracle held at every prefix of the quarter's log, seq 1 to (\d+) \(\1 prefixes\)/);
  });

  it("prints the same transcript every time it is run", () => {
    expect(run(REPO_ROOT).stdout).toBe(first.stdout);
  });

  it("runs the autonomous quarter too, and the oracle held at every prefix of its log", () => {
    expect(first.stdout).toMatch(/the oracle held at every prefix of the quarter's log, seq 1 to \d+ \(\d+ prefixes\)/);
    expect(first.stdout).toContain("the quarter opens with the 33 steps above, and the engine gave every one of them the same answer");
  });
});

describe("the exit code: non-zero when the engine, or the script's own list, stops saying what plan §7 says", () => {
  it("CONTROL: a copy of the tree with no change exits 0 (so what follows is the change's doing)", () => {
    const copy = copyOfTree();
    const result = run(copy);
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toMatch(/^demo OK: /);
  });

  it("absorbedBy returns 0 (plan §6 M6's first sabotage): exit 1, because the engine's absorbed no longer matches what the raw log shows was bound under G2", () => {
    const copy = copyOfTree();
    mutate(copy, "lib/allowance/accounting.ts", "  return subtreeOwn(bookOf(tree, charges), revoked);", "  return 0;");
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DEMO FAILED: ORACLE: the engine's absorbed amount is not the amount the raw log shows was bound under the revoked grant");
    expect(result.stdout).toContain("absorbed (engine: lib/allowance absorbedBy G2) = 0");
    expect(result.stdout).not.toContain("demo OK");
  });

  it("the link-dead check is removed from judgeCommit (plan §6 M6's second sabotage, in the form that compiles): exit 1, on the step assertion for c5", () => {
    const copy = copyOfTree();
    mutate(copy, "lib/standing/verdict.ts", '  if (dead !== undefined) return breached({ kind: "link-dead", grantId: dead.grantId, atSeq: dead.atSeq });\n', "");
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DEMO FAILED: step c5: §7 says breached as link-dead");
    expect(result.stdout).not.toContain("demo OK");
  });

  it("the heir is the grantee of the first dead link instead of its grantor: exit 1, on the standings at seq 11", () => {
    const copy = copyOfTree();
    mutate(copy, "lib/standing/standing.ts", "    heir: link.grantor,", "    heir: link.grantee,");
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DEMO FAILED: at seq 11: standing of c1");
  });

  it("a standing that is wrong only at the end (an over-limit void whose standing carries other numbers than the verdict did, so every step's answer is still right): exit 1, on the standings at seq 18", () => {
    const copy = copyOfTree();
    mutate(copy, "lib/standing/standing.ts", '    return sealStanding({ ...base, kind: "void", breach: verdict.breach });', '    return sealStanding({ ...base, kind: "void", breach: verdict.breach.kind === "over-limit" ? { ...verdict.breach, requested: 1 } : verdict.breach });');
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DEMO FAILED: at seq 18: standing of c8");
    expect(result.stdout).toContain("[33] launder-capability");
    expect(result.stdout).not.toContain("demo OK");
  });

  it("a quarter whose view cannot be built (the domain's makeOrgView folds a log that has a repeated event, which the engine faults): exit 1, because the quarter ended with a fault", () => {
    const copy = copyOfTree();
    mutate(copy, "domains/company/view.ts", "const result = fold(CHARTER, log);", "const result = fold(CHARTER, log.length > 17 ? [...log, ...log.slice(0, 1)] : log);");
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DEMO FAILED: the quarter ended with a fault");
    expect(result.stdout).not.toContain("demo OK");
  });

  it("a kind of Rejection that never occurs in the run (the script drops the launder step and the demo drops its answer): exit 1, naming unknown-capability", () => {
    const copy = copyOfTree();
    mutate(copy, "domains/company/script.ts", /^ {2}grant\("launder-capability".*\n/m, "");
    mutate(copy, "scripts/demo-company.ts", /^ {2}"launder-capability": \{.*\n/m, "");
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DEMO FAILED: kinds never observed in the run: Rejection unknown-capability");
    expect(result.stdout).toContain("Rejection 14/15");
  });

  it("a kind of Breach that never occurs (the script drops c9, the demo drops its answer, and the commits after it are renumbered by the engine): exit 1 on the step assertions, not silently green", () => {
    const copy = copyOfTree();
    mutate(copy, "domains/company/script.ts", /^ {2}commit\("c9".*\n/m, "");
    mutate(copy, "scripts/demo-company.ts", /^ {2}c9: \{.*\n/m, "");
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("demo OK");
  });

  it("the script and the demo disagree about which steps exist (the script gains a step the demo has no answer for): exit 1, before anything is offered", () => {
    const copy = copyOfTree();
    mutate(copy, "scripts/demo-company.ts", /^ {2}G1: \{ admitted: 1 \},\n/m, "");
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DEMO FAILED: the script's steps and §7's answers (EXPECT) are not the same set of keys");
    expect(result.stdout).not.toContain("[01]");
  });

  it("the ORACLE catches an engine that lets enormous commits bind (while every answer §7 gives is still right): exit 1 on the oracle, in the quarter, after all 33 steps passed", () => {
    const copy = copyOfTree();
    mutate(copy, "lib/allowance/accounting.ts", "  if (requested <= headroom) return { ok: true };", "  if (requested <= headroom || requested >= 1_000_000_000) return { ok: true };");
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/DEMO FAILED: ORACLE: the quarter's log at seq \d+: root grant \S+ has \d+ ruled binding or inherited under it, over its limit of \d+/);
    expect(result.stdout).toContain("kinds observed in the run");
    expect(result.stdout).toContain("the quarter opens with the 33 steps above");
    expect(result.stdout).not.toContain("demo OK");
  });
});

describe("the oracle in the demo reads the raw log and the standings and calls nothing from the engine", () => {
  /**
   * The identifiers inside the named functions of `file` that are also a local name some value import of `file` introduced, or the name of any other
   * function or variable declared at the top level of `file` (a helper declared there can call the engine for the oracle, so the oracle may not call one).
   * Types are not collected: an interface or a type alias cannot call anything.
   */
  function importedNamesUsedIn(root: string, tsconfig: string, file: string, functions: readonly string[]): { used: string[]; found: string[] } {
    const api = new API();
    try {
      const config = realpathSync(join(root, tsconfig));
      const project = api.updateSnapshot({ openProjects: [config] }).getProject(config);
      if (project === undefined) throw new Error("no project");
      const sf = project.program.getSourceFile(realpathSync(join(root, file)));
      if (sf === undefined) throw new Error(`no source file ${file}`);

      const valueImports = new Set<string>();
      const collect = (node: Node): void => {
        if (isImportDeclaration(node) && node.importClause !== undefined && node.importClause.phaseModifier !== SyntaxKind.TypeKeyword) {
          const bindings = node.importClause.namedBindings;
          if (node.importClause.name !== undefined) valueImports.add(node.importClause.name.text);
          if (bindings !== undefined && isNamedImports(bindings)) {
            for (const element of bindings.elements) if (!element.isTypeOnly) valueImports.add(element.name.text);
          } else if (bindings !== undefined) valueImports.add((bindings as unknown as { name: { text: string } }).name.text);
        }
        node.forEachChild(collect);
      };
      collect(sf);
      for (const statement of sf.statements) {
        if (isFunctionDeclaration(statement) && statement.name !== undefined && !functions.includes(statement.name.text)) valueImports.add(statement.name.text);
        if (isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) if (isIdentifier(declaration.name)) valueImports.add(declaration.name.text);
        }
      }

      const used = new Set<string>();
      const found: string[] = [];
      const inside = (node: Node): void => {
        if (isIdentifier(node) && valueImports.has(node.text)) used.add(node.text);
        node.forEachChild(inside);
      };
      const visit = (node: Node): void => {
        if (isFunctionDeclaration(node) && node.name !== undefined && functions.includes(node.name.text)) {
          found.push(node.name.text);
          inside(node);
        } else node.forEachChild(visit);
      };
      visit(sf);
      return { used: [...used].sort(), found: found.sort() };
    } finally {
      api.close();
    }
  }

  it("neither conservationOracle nor spentUnder mentions anything the script imports as a value (absorbedBy, headroomOf, fold, standings, assert, the domain's functions ...)", () => {
    const result = importedNamesUsedIn(REPO_ROOT, "tsconfig.lib.json", "scripts/demo-company.ts", ["conservationOracle", "spentUnder"]);
    expect(result.found).toEqual(["conservationOracle", "spentUnder"]);
    expect(result.used).toEqual([]);
  });

  it("and the check can fail: a copy of the script whose oracle calls headroomOf, or whose spentUnder calls fold, or whose oracle calls a helper (a function or a const) declared in the file that calls fold, is caught, naming it", () => {
    const dir = mkdtempSync(join(tmpdir(), "act-demo-oracle-"));
    scratch.push(dir);
    const put = (path: string, text: string): void => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: true }, include: ["*.ts"] }));
    put("lib.ts", "export function headroomOf(): number { return 1; }\nexport function fold(): number { return 2; }\nexport type T = string;\n");
    put(
      "clean.ts",
      'import { headroomOf, type T } from "./lib.js";\nexport const kept = headroomOf;\nfunction conservationOracle(list: readonly T[]): number { return list.length; }\nfunction spentUnder(): number { return 0; }\nexport { conservationOracle, spentUnder };\n',
    );
    put(
      "dirty.ts",
      'import { headroomOf, fold } from "./lib.js";\nfunction conservationOracle(): number { return headroomOf(); }\nfunction spentUnder(): number { return fold(); }\nexport { conservationOracle, spentUnder };\n',
    );
    put(
      "dirty2.ts",
      'import { fold } from "./lib.js";\nfunction helper(): number { return fold(); }\nconst viaConst = (): number => fold();\nfunction conservationOracle(): number { return helper(); }\nfunction spentUnder(): number { return viaConst(); }\nexport { conservationOracle, spentUnder };\n',
    );
    expect(importedNamesUsedIn(dir, "tsconfig.json", "clean.ts", ["conservationOracle", "spentUnder"])).toEqual({ used: [], found: ["conservationOracle", "spentUnder"] });
    expect(importedNamesUsedIn(dir, "tsconfig.json", "dirty.ts", ["conservationOracle", "spentUnder"])).toEqual({ used: ["fold", "headroomOf"], found: ["conservationOracle", "spentUnder"] });
    expect(importedNamesUsedIn(dir, "tsconfig.json", "dirty2.ts", ["conservationOracle", "spentUnder"])).toEqual({ used: ["helper", "viaConst"], found: ["conservationOracle", "spentUnder"] });
  });
});
