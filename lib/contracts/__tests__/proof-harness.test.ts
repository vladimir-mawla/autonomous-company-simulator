import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROOF_CONFIGS, checkProofSource } from "./support/proof-harness.js";

/**
 * The harness is only worth having if it fails on a false proof, so each case
 * below feeds it a deliberately bad proof file and asserts the SPECIFIC problem
 * it reports. `checkProofSource` compiles a scratch copy, so these write
 * nothing under `lib/`.
 */
const HERE = import.meta.dirname;
const check = (source: string) => checkProofSource(source, HERE);

describe("proof harness: accepts a sound proof", () => {
  it("passes a line that fails for exactly the stated code and message under both configs", () => {
    const report = check(
      [
        "const a: number = 1;",
        "// @ts-expect-error TS2322 is not assignable to type 'number'",
        'const b: number = "x";',
        "export const used = [a, b];",
      ].join("\n"),
    );
    expect(report.problems).toEqual([]);
    expect(report.directives).toBe(1);
  });

  it("runs under both of the repo's tsconfigs", () => {
    expect(PROOF_CONFIGS).toEqual(["tsconfig.lib.json", "tsconfig.json"]);
  });
});

describe("proof harness: rejects each way a @ts-expect-error can be satisfied for the wrong reason", () => {
  it("a directive over a line that compiles cleanly (the case TS2578 also catches)", () => {
    const report = check(
      ["// @ts-expect-error TS2322 is not assignable", "const ok: number = 1;", "export const used = ok;"].join("\n"),
    );
    expect(report.problems.length).toBeGreaterThan(0);
    expect(report.problems.join("\n")).toMatch(/no diagnostic at all/);
  });

  it("a directive satisfied ONLY by an unused-local error (noUnusedLocals): the case TS2578 cannot catch", () => {
    // `ok` is legal and never read: tsc reports TS6133, which would satisfy a bare @ts-expect-error.
    const report = check(["// @ts-expect-error TS2322 is not assignable", "const ok: number = 1;"].join("\n"));
    expect(report.problems.join("\n")).toMatch(/expected TS2322 containing .* got TS6133/);
  });

  it("a real error PLUS an unused-local error on the same line", () => {
    const report = check(
      ["// @ts-expect-error TS2322 is not assignable", 'const unusedAndWrong: number = "x";'].join("\n"),
    );
    expect(report.problems.join("\n")).toMatch(/unexpected extra diagnostic TS6133/);
  });

  it("a fresh-literal excess-property error where the proof claims an assignability error", () => {
    const report = check(
      [
        "type A = { readonly a: number };",
        "// @ts-expect-error TS2322 is not assignable",
        "export const lit: A = { a: 1, b: 2 };",
      ].join("\n"),
    );
    expect(report.problems.join("\n")).toMatch(/expected TS2322 containing .* got TS2353/);
  });

  it("an error whose message matches but whose code is not the stated one", () => {
    // The message contains the fragment, so only the code check can reject this line.
    const report = check(["// @ts-expect-error TS2345 is not assignable to type 'number'", 'export const wrongCode: number = "x";'].join("\n"));
    expect(report.problems.join("\n")).toMatch(/expected TS2345 containing .* got TS2322/);
  });

  it("an error with the right code but a different message than the stated one", () => {
    const report = check(
      [
        "// @ts-expect-error TS2322 Types of property 'warrant' are incompatible",
        'export const wrongField: number = "x";',
      ].join("\n"),
    );
    expect(report.problems.join("\n")).toMatch(/containing "Types of property 'warrant' are incompatible"/);
  });

  it("an error on a line with no directive", () => {
    const report = check('export const stray: number = "x";');
    expect(report.problems.join("\n")).toMatch(/unexpected diagnostic TS2322 outside any proof line/);
  });

  it("a suppression that is not in the accepted form, including @ts-ignore and a bare @ts-expect-error", () => {
    for (const comment of ["// @ts-ignore", "// @ts-expect-error", "// @ts-expect-error TS2322", "// @ts-nocheck"]) {
      const report = check([comment, 'export const hidden: number = "x";'].join("\n"));
      expect(report.problems.join("\n"), comment).toMatch(/not in the accepted form/);
    }
  });
});

describe("proof harness: the two configs really differ, and both are consulted", () => {
  it("reports a proof that only holds under exactOptionalPropertyTypes, naming the config where it does not", () => {
    // `{ a: undefined }` for `a?: number` is an error only under tsconfig.lib.json.
    const report = check(
      [
        "type O = { readonly a?: number };",
        "// @ts-expect-error TS2375 exactOptionalPropertyTypes",
        "export const o: O = { a: undefined };",
      ].join("\n"),
    );
    expect(report.problems.join("\n")).toMatch(/\[tsconfig\.json\] line 3: expected TS2375/);
    expect(report.problems.join("\n")).not.toMatch(/\[tsconfig\.lib\.json\]/);
  });
});

describe("proof harness: a contract source that stops compiling is reported under its own file, not as a broken proof", () => {
  it("names the imported file and does not blame a proof line", () => {
    const dir = mkdtempSync(join(tmpdir(), "act-proof-harness-import-"));
    try {
      writeFileSync(join(dir, "broken.ts"), 'export const broken: number = "not a number";\n');
      const report = checkProofSource(
        ["import { broken } from \"./broken.js\";", "export const used = broken;"].join("\n"),
        dir,
      );
      expect(report.problems.length).toBeGreaterThan(0);
      for (const problem of report.problems) {
        expect(problem).toMatch(/broken\.ts\(1\): TS2322 in a file the proof imports, not in the proof/);
      }
      expect(report.problems.join("\n")).not.toMatch(/outside any proof line/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
