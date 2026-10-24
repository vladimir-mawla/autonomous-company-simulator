import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `vercel.json` pins the install and build commands. Vercel's zero-config Next.js preset would run
 * plain `next build`, which is Turbopack in Next 16, and Turbopack cannot resolve `lib/`'s
 * `.js`-suffixed imports; the build only works through `npm run build` (`next build --webpack`).
 * So the file must say exactly this, and nothing that could re-select a preset or another command.
 *
 * It is compared whole, with `toEqual`, so an added key (`framework`, `outputDirectory`, a
 * `functions` block, a `devCommand`) fails as surely as a changed one. Parsed from disk, not matched
 * as text, so reformatting the file does not matter and a duplicated or malformed key does.
 *
 * What this does NOT show: that Vercel honours the file. That is checked by the deploy itself, whose
 * served runtime chunk must contain no `turbopack` string (ADR 0002).
 */
const VERCEL_JSON = join(import.meta.dirname, "..", "..", "..", "..", "vercel.json");

describe("vercel.json", () => {
  it("is exactly installCommand 'npm ci' and buildCommand 'npm run build', and nothing else", () => {
    const config: unknown = JSON.parse(readFileSync(VERCEL_JSON, "utf-8"));
    expect(config).toEqual({
      installCommand: "npm ci",
      buildCommand: "npm run build",
    });
  });
});
