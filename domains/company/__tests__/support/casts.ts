import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
  isAssertionExpression,
  isFunctionDeclaration,
  isNonNullExpression,
  isSatisfiesExpression,
  type Node,
} from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

/**
 * Does a named function contain a type assertion? (plan §6 M6: "the `AppendResult` -> `AttemptOutcome` mapping needs no cast")
 *
 * Found by walking the function's syntax tree for `x as T`, `<T>x`, `x!` and `x satisfies T` (a `satisfies` does not change a value's type,
 * but a mapping that needs one to compile is the thing being looked for, so it is reported too). `as const` is an `as` and is reported:
 * the function this is pointed at has no reason to use one. Returns the source text of each, so a failure says what it found.
 *
 * It looks at ONE function declaration of ONE file, by name. It does not follow calls out of it: the claim is about the mapping's own text.
 */
export function castsInFunction(root: string, tsconfig: string, file: string, functionName: string): string[] {
  const api = new API();
  try {
    const config = realpathSync(tsconfig);
    const project = api.updateSnapshot({ openProjects: [config] }).getProject(config);
    if (project === undefined) throw new Error(`the compiler could not open ${config}`);
    const path = realpathSync(join(root, file));
    const sf = project.program.getSourceFile(path);
    if (sf === undefined) throw new Error(`the compiler did not parse ${file}`);

    const found: string[] = [];
    let seen = false;
    const inside = (node: Node): void => {
      if (isAssertionExpression(node) || isNonNullExpression(node) || isSatisfiesExpression(node)) found.push(node.getText(sf));
      node.forEachChild(inside);
    };
    const visit = (node: Node): void => {
      if (isFunctionDeclaration(node) && node.name !== undefined && node.name.text === functionName) {
        seen = true;
        inside(node);
      } else node.forEachChild(visit);
    };
    visit(sf);
    if (!seen) throw new Error(`no function ${functionName} in ${file}`);
    return found;
  } finally {
    api.close();
  }
}
