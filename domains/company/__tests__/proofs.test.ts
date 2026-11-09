import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProofFile } from "../../../lib/contracts/__tests__/support/proof-harness.js";

/**
 * Runs M1's proof harness over every file in `proofs/`: each is type-only (it is also compiled by `npm run typecheck`, where each
 * directive must still have an error to suppress), and the harness checks each directive is matched by a diagnostic with the stated
 * code and message fragment under both of this repo's tsconfigs.
 *
 * EXPECTED_DIRECTIVES pins how many proof lines each file has, so deleting a route, or a whole file, turns this red instead of
 * silently shrinking the proof. Adding a route means changing the number here on purpose.
 */
const PROOFS_DIR = join(import.meta.dirname, "proofs");

const EXPECTED_DIRECTIVES: Readonly<Record<string, number>> = {
  "capability.proofs.ts": 11,
};

describe("every proof file fails to compile with exactly the stated codes and message fragments", () => {
  it("the proofs directory holds exactly the proof files this test knows about", () => {
    expect(readdirSync(PROOFS_DIR).filter((name) => name.endsWith(".ts")).sort()).toEqual(Object.keys(EXPECTED_DIRECTIVES).sort());
  });

  for (const name of Object.keys(EXPECTED_DIRECTIVES)) {
    it(`${name}: every directive is matched by its stated diagnostic, and nothing else fails`, () => {
      const report = checkProofFile(join(PROOFS_DIR, name));
      expect(report.problems).toEqual([]);
      expect(report.directives).toBe(EXPECTED_DIRECTIVES[name]);
    });
  }
});
