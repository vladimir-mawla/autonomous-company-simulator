import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  isBindingElement,
  isCallExpression,
  isElementAccessExpression,
  isIdentifier,
  isInterfaceDeclaration,
  isLiteralTypeNode,
  isObjectBindingPattern,
  isArrayBindingPattern,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertySignatureDeclaration,
  isStringLiteralLikeNode,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  isBinaryExpression,
  isPrefixUnaryExpression,
  isPostfixUnaryExpression,
  SyntaxKind,
  type Node,
  type SourceFile,
} from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { referencesIn } from "../../../../lib/contracts/__tests__/support/module-graph.js";

/**
 * The source scan of `domains/company/**` (plan §6 M6 "Must refuse": the domain contributes no authority rule).
 *
 * WHAT IT IS FOR. `lib/` is protected by scans of its own (M1's closed module graph, each layer's architecture test); `domains/` was
 * not, and plan §6 M6 names the cost of that (agent-control-tower ADR 0006, Decision 4c: a load-bearing rule placed in `domains/` is
 * protected only by unit tests). This scan is the mechanical form of "the domain holds no rule": it walks the syntax tree of every
 * source file of the domain and reports each of these, and nothing else:
 *
 *   `standing-kind`      a string literal equal to a kind of `Standing` (`binding`, `inherited`, `void`), anywhere, in a value or in a
 *                        type: a domain that wrote one could be constructing a standing.
 *   `ruling-kind`        a string literal equal to a kind of `Breach`, `Rejection` or `FoldFault`: a domain that wrote one could be
 *                        re-implementing a rejection or a breach. These and the three above are READ FROM `lib/contracts` by this file
 *                        (`readKindLists`), not typed in here, so a kind added there is a kind refused here.
 *   `money-arithmetic`   an arithmetic operator (`+ - * / % **`, the compound assignments, `++ --`, unary `-` and `+`), an ordering
 *                        comparison (`< <= > >=`), or a call of a `Math` function, one of whose operands MENTIONS money: an identifier or
 *                        a string-keyed property whose name contains `limit`, `amount` or `headroom` (any case), or a variable that was
 *                        initialised, destructured or assigned from an expression that does (followed to a fixed point within the
 *                        file). Equality (`===`) is not flagged.
 *   `import-not-allowed` a module reference (an import, an export-from, a dynamic `import()`, a `require` call, an import type, a
 *                        `/// <reference>`) to anything but a source file of this directory or one of `lib/contracts`, `lib/chain`,
 *                        `lib/allowance` or `lib/standing` THROUGH ITS `index.ts`. Resolved by real path, as M1's scan does, so a
 *                        symlink does not hide a deep import. A specifier that is not a string literal, and one that resolves to nothing, count too.
 *   `nondeterminism`     the identifiers `Date`, `performance`, `crypto`, `setTimeout`, `setInterval`, `queueMicrotask`, `process`,
 *                        `globalThis`, `fetch` and `eval`, and `Math.random`. Plan D10: the policies are pure functions of a view
 *                        and a seeded generator.
 *   `non-ts-file`, `symlink`, `unparseable`   the inventory: everything under the directory but `__tests__/` is a `.ts` file that is not a
 *                        declaration, is not a symlink and parses.
 *
 * WHAT IT DOES NOT DO, so that nobody reads more into a green result than is there:
 *   - It is SYNTACTIC and FILE-LOCAL. Money that reaches arithmetic through a name that does not contain one of the three words, through a
 *     function argument (`f(grant.limit)` where `f` subtracts), a return value, an array element or a property of another object is not
 *     seen. Two further holes: a string assembled at run time (`"vo" + "id"`) is not a literal, and the kind lists are of kinds, so a domain
 *     can still build a value of one of these types out of a kind it was handed.
 *   - It does not say a policy is GOOD, or that an event it proposes is sound: the engine rules on those.
 *   - It reads `.ts` files of this directory only (not `__tests__/`, not `scripts/demo-company.ts`, which holds the oracle and so does arithmetic on amounts on purpose).
 */

export type Rule =
  | "standing-kind"
  | "ruling-kind"
  | "money-arithmetic"
  | "import-not-allowed"
  | "nondeterminism"
  | "non-ts-file"
  | "symlink"
  | "unparseable";

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: Rule;
  readonly detail: string;
}

export interface KindLists {
  /** The kinds of `Standing`. */
  readonly standing: readonly string[];
  /** The kinds of `Breach`, `Rejection` and `FoldFault` together. */
  readonly ruling: readonly string[];
}

export interface ScanOptions {
  /** Absolute path of the repository, or of a synthetic copy of its layout. */
  readonly root: string;
  /** Absolute path of a tsconfig whose program includes every `.ts` file under `domains/company/` and `lib/contracts/`. */
  readonly tsconfig: string;
  readonly kinds: KindLists;
}

export interface ScanResult {
  readonly findings: readonly Finding[];
  /** Every source file that was parsed (repo-relative, `/`-separated). */
  readonly scanned: readonly string[];
}

const LIB_LAYERS = ["contracts", "chain", "allowance", "standing"] as const;
const MONEY = /limit|amount|headroom/i;
export const NONDETERMINISTIC: readonly string[] = ["Date", "performance", "crypto", "setTimeout", "setInterval", "queueMicrotask", "process", "globalThis", "fetch", "eval"];

const ARITHMETIC = new Set<SyntaxKind>([
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken,
  SyntaxKind.AsteriskAsteriskToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
]);
const UNARY_ARITHMETIC = new Set<SyntaxKind>([SyntaxKind.PlusToken, SyntaxKind.MinusToken, SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken]);

// ---------------------------------------------------------------------------------------------------
// The kind lists, read from lib/contracts
// ---------------------------------------------------------------------------------------------------

/** The string `kind` literals declared inside one named interface or type alias of `sf`. */
function kindsDeclaredIn(sf: SourceFile, names: readonly string[]): string[] {
  const found: string[] = [];
  const inside = (node: Node): void => {
    if (isPropertySignatureDeclaration(node) && isIdentifier(node.name) && node.name.text === "kind" && node.type !== undefined && isLiteralTypeNode(node.type) && isStringLiteralLikeNode(node.type.literal)) {
      found.push(node.type.literal.text);
    }
    node.forEachChild(inside);
  };
  const visit = (node: Node): void => {
    if ((isInterfaceDeclaration(node) || isTypeAliasDeclaration(node)) && names.includes(node.name.text)) inside(node);
    else node.forEachChild(visit);
  };
  visit(sf);
  return found;
}

/**
 * The kinds of `Standing`, and of `Breach`, `Rejection` and `FoldFault`, as `lib/contracts/{standing,breach,rejection,fold-fault}.ts`
 * declare them. Read by walking those files, so the lists cannot disagree with the types (a hand-typed list of fifteen names is a list
 * nothing checks).
 */
export function readKindLists(root: string, tsconfig: string): KindLists {
  const api = new API();
  try {
    const config = realpathSync(tsconfig);
    const project = api.updateSnapshot({ openProjects: [config] }).getProject(config);
    if (project === undefined) throw new Error(`the compiler could not open ${config}`);
    const read = (file: string, names: readonly string[]): string[] => {
      const sf = project.program.getSourceFile(realpathSync(join(root, "lib", "contracts", file)));
      if (sf === undefined) throw new Error(`the compiler did not parse lib/contracts/${file}`);
      return kindsDeclaredIn(sf, names);
    };
    return {
      standing: read("standing.ts", ["BindingStanding", "InheritedStanding", "VoidStanding"]),
      ruling: [...read("breach.ts", ["Breach"]), ...read("rejection.ts", ["Rejection"]), ...read("fold-fault.ts", ["FoldFault"])],
    };
  } finally {
    api.close();
  }
}

// ---------------------------------------------------------------------------------------------------
// money
// ---------------------------------------------------------------------------------------------------

/** Does `node` or anything inside it mention money, given the names found to carry it so far? */
function mentions(node: Node, carriers: ReadonlySet<string>): boolean {
  if (isIdentifier(node) && (MONEY.test(node.text) || carriers.has(node.text))) return true;
  if (isElementAccessExpression(node) && isStringLiteralLikeNode(node.argumentExpression) && MONEY.test(node.argumentExpression.text)) return true;
  let found = false;
  node.forEachChild((child) => {
    if (!found && mentions(child, carriers)) found = true;
  });
  return found;
}

/** Every identifier a binding pattern (or a plain name) introduces. */
function namesIn(node: Node | undefined, out: string[]): void {
  if (node === undefined) return;
  if (isIdentifier(node)) out.push(node.text);
  else if (isObjectBindingPattern(node) || isArrayBindingPattern(node)) node.forEachChild((child) => namesIn(child, out));
  else if (isBindingElement(node)) namesIn(node.name, out);
}

/** The names, in this file, of variables that hold money by having been set from something that mentions it. Iterated to a fixed point. */
function carriersIn(sf: SourceFile): Set<string> {
  const carriers = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    const add = (names: readonly string[]): void => {
      for (const name of names) {
        if (!carriers.has(name)) {
          carriers.add(name);
          grew = true;
        }
      }
    };
    const visit = (node: Node): void => {
      if (isVariableDeclaration(node) && node.initializer !== undefined && mentions(node.initializer, carriers)) {
        const names: string[] = [];
        namesIn(node.name, names);
        add(names);
      }
      if (isBindingElement(node) && node.propertyName !== undefined && isIdentifier(node.propertyName) && MONEY.test(node.propertyName.text)) {
        const names: string[] = [];
        namesIn(node.name, names);
        add(names);
      }
      if (isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.EqualsToken && isIdentifier(node.left) && mentions(node.right, carriers)) {
        add([node.left.text]);
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }
  return carriers;
}

function moneyFindings(sf: SourceFile, report: (node: Node, detail: string) => void): void {
  const carriers = carriersIn(sf);
  const visit = (node: Node): void => {
    if (isBinaryExpression(node) && ARITHMETIC.has(node.operatorToken.kind) && (mentions(node.left, carriers) || mentions(node.right, carriers))) {
      report(node, node.getText(sf));
    } else if (isPrefixUnaryExpression(node) && UNARY_ARITHMETIC.has(node.operator) && mentions(node.operand, carriers)) {
      report(node, node.getText(sf));
    } else if (isPostfixUnaryExpression(node) && UNARY_ARITHMETIC.has(node.operator) && mentions(node.operand, carriers)) {
      report(node, node.getText(sf));
    } else if (
      isCallExpression(node) &&
      isPropertyAccessExpression(node.expression) &&
      isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Math" &&
      node.arguments.some((argument) => mentions(argument, carriers))
    ) {
      report(node, node.getText(sf));
    }
    node.forEachChild(visit);
  };
  visit(sf);
}

// ---------------------------------------------------------------------------------------------------
// the scan
// ---------------------------------------------------------------------------------------------------

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

function candidatesFor(target: string): string[] {
  if (target.endsWith(".js")) return [target, target.slice(0, -3) + ".ts"];
  return [target, target + ".ts", join(target, "index.ts")];
}

const isPropertyName = (node: Node): boolean => {
  const parent = node.parent;
  return (
    (isPropertyAccessExpression(parent) && parent.name === node) ||
    (isPropertyAssignment(parent) && parent.name === node) ||
    (isPropertySignatureDeclaration(parent) && parent.name === node)
  );
};

export function scanCompanySource(options: ScanOptions): ScanResult {
  const root = realpathSync(options.root);
  const rel = (path: string): string => relative(root, path).split(sep).join("/");
  const companyDir = join(root, "domains", "company");
  const testsDir = join(companyDir, "__tests__");
  const barrels = new Set(LIB_LAYERS.map((layer) => join(root, "lib", layer, "index.ts")));
  const standingKinds = new Set(options.kinds.standing);
  const rulingKinds = new Set(options.kinds.ruling);
  const findings: Finding[] = [];
  const scanned: string[] = [];

  const sources: string[] = [];
  for (const entry of walk(companyDir)) {
    if (entry.path === testsDir || entry.path.startsWith(testsDir + sep)) continue;
    if (entry.symlink) findings.push({ file: rel(entry.path), line: 0, rule: "symlink", detail: "" });
    else if (!entry.directory && (!entry.path.endsWith(".ts") || entry.path.endsWith(".d.ts"))) findings.push({ file: rel(entry.path), line: 0, rule: "non-ts-file", detail: "" });
    else if (!entry.directory) sources.push(entry.path);
  }

  const tsconfig = realpathSync(options.tsconfig);
  const api = new API();
  try {
    const project = api.updateSnapshot({ openProjects: [tsconfig] }).getProject(tsconfig);
    if (project === undefined) throw new Error(`the compiler could not open ${tsconfig}`);

    for (const file of sources) {
      const name = rel(file);
      const sf = project.program.getSourceFile(file);
      if (sf === undefined || project.program.getSyntacticDiagnostics(file).length > 0) {
        findings.push({ file: name, line: 0, rule: "unparseable", detail: "" });
        continue;
      }
      scanned.push(name);
      const lineOf = (node: Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const report = (rule: Rule) => (node: Node, detail: string): void => {
        findings.push({ file: name, line: lineOf(node), rule, detail });
      };

      // imports
      for (const ref of referencesIn(sf)) {
        const flag = (): void => {
          findings.push({ file: name, line: ref.line, rule: "import-not-allowed", detail: ref.specifier ?? ref.raw });
        };
        if (ref.specifier === null || !(ref.specifier.startsWith("./") || ref.specifier.startsWith("../"))) {
          flag();
          continue;
        }
        const found = candidatesFor(resolve(dirname(file), ref.specifier))
          .filter((candidate) => existsSync(candidate))
          .map((candidate) => realpathSync(candidate));
        if (found.length === 0) {
          flag();
          continue;
        }
        const inside = (path: string): boolean => path.startsWith(companyDir + sep) && !(path === testsDir || path.startsWith(testsDir + sep));
        if (!found.every((path) => inside(path) || barrels.has(path))) flag();
      }

      // string literals that are a kind of ruling, and the nondeterministic names
      const visit = (node: Node): void => {
        if (isStringLiteralLikeNode(node)) {
          if (standingKinds.has(node.text)) report("standing-kind")(node, node.text);
          else if (rulingKinds.has(node.text)) report("ruling-kind")(node, node.text);
        }
        if (isIdentifier(node) && !isPropertyName(node) && NONDETERMINISTIC.includes(node.text)) report("nondeterminism")(node, node.text);
        if (isPropertyAccessExpression(node) && isIdentifier(node.expression) && node.expression.text === "Math" && node.name.text === "random") {
          report("nondeterminism")(node, "Math.random");
        }
        node.forEachChild(visit);
      };
      visit(sf);

      moneyFindings(sf, report("money-arithmetic"));
    }
  } finally {
    api.close();
  }

  return { findings, scanned: scanned.sort() };
}

/** `file:rule` pairs, sorted, for compact assertions. */
export function summarise(findings: readonly Finding[]): string[] {
  return findings.map((finding) => `${finding.file}:${finding.rule}`).sort();
}
