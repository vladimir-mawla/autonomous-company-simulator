import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The one passing test in a genesis repo that has no engine code yet (M1 has
 * its own PR and its own verifier). It is deliberately not
 * `expect(true).toBe(true)`: it pins the two build-tooling facts that the
 * README and next.config.ts both claim and that nothing else in the repo can
 * catch until lib/ exists.
 *
 *  1. package.json's `dev` and `build` scripts really run Next with the
 *     `--webpack` flag, and do not opt back into Turbopack. Turbopack (Next
 *     16's default) cannot resolve the NodeNext-style `.js`-suffixed imports
 *     lib/ will use from M1 onward, so a build script that loses the flag
 *     builds green until the first lib/ import and then fails.
 *  2. next.config.ts really DECLARES `experimental.extensionAlias`, the webpack
 *     option that makes those `.js` imports resolve at all.
 *
 * WHY THIS IS NOT VACUOUS. Fact 2 is checked by importing next.config.ts and
 * reading the value of the exported config object, not by pattern-matching
 * its source text. The distinction matters here: next.config.ts carries a
 * long comment block that itself says "extensionAlias" and ".js", so a
 * source-text match passes with the real setting deleted, or moved into a
 * variable the config never uses. Reading the exported object fails in both
 * cases, and also fails if the alias is declared but with the wrong targets.
 * Fact 1 is checked on whole whitespace-separated tokens of the real script
 * strings, so `--webpack` appearing only in some other script (or a longer
 * flag that merely contains it) does not count, and `--turbopack` / `--turbo`
 * in the same command fails it.
 *
 * What it does NOT prove: that a `.js` import actually resolves in a build.
 * That needs lib/ to exist; `npm run build` is the check from M1 onward.
 */
describe("build tooling matches the documented Turbopack workaround", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf-8"),
  ) as { scripts: Record<string, string> };

  for (const name of ["dev", "build"] as const) {
    it(`runs \`${name}\` through next with --webpack and not Turbopack`, () => {
      const script = pkg.scripts[name];
      expect(script, `package.json is missing the "${name}" script`).toBeTypeOf(
        "string",
      );
      const tokens = (script as string).split(/\s+/);
      expect(tokens[0]).toBe("next");
      expect(tokens[1]).toBe(name);
      expect(tokens).toContain("--webpack");
      expect(tokens).not.toContain("--turbopack");
      expect(tokens).not.toContain("--turbo");
    });
  }

  it("declares experimental.extensionAlias mapping .js to .ts/.tsx/.js", async () => {
    const mod = await import("../next.config");
    const alias = mod.default.experimental?.extensionAlias;
    expect(alias).toEqual({ ".js": [".ts", ".tsx", ".js"] });
  });
});
