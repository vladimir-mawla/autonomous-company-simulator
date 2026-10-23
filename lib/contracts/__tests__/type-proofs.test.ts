import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProofFile } from "./support/proof-harness.js";

/**
 * Runs the proof harness over every file in `proofs/`. A proof file is
 * type-only (it is also compiled by `npm run typecheck`, where each directive
 * must still have an error to suppress); this test is what checks each one
 * fails for the stated reason under both tsconfigs.
 *
 * EXPECTED_DIRECTIVES pins how many proof lines each file has, so deleting a
 * route, or a whole proof file, turns this red instead of silently shrinking
 * the proof. Adding a route means updating the number here, deliberately.
 */
const PROOFS_DIR = join(import.meta.dirname, "proofs");

const EXPECTED_DIRECTIVES: Readonly<Record<string, number>> = {
  "ids.proofs.ts": 7,
  "capability.proofs.ts": 7,
  "event.proofs.ts": 4,
  "non-empty-array.proofs.ts": 4,
};

describe("every proof file fails to compile for exactly the stated reasons", () => {
  const onDisk = readdirSync(PROOFS_DIR).filter((name) => name.endsWith(".ts")).sort();

  it("the proofs directory holds exactly the proof files this test knows about", () => {
    expect(onDisk).toEqual(Object.keys(EXPECTED_DIRECTIVES).sort());
  });

  for (const name of Object.keys(EXPECTED_DIRECTIVES)) {
    it(`${name}: every directive is matched by its stated diagnostic, and nothing else fails`, () => {
      const report = checkProofFile(join(PROOFS_DIR, name));
      expect(report.problems).toEqual([]);
      expect(report.directives).toBe(EXPECTED_DIRECTIVES[name]);
    });
  }
});
