import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STANDING_SAMPLES } from "./support/samples.js";
import { checkProofSource } from "./support/proof-harness.js";

/**
 * The compile-time half of `Standing` (every forbidden field refused by eight routes, every required
 * field required, and what still gets through) is in `proofs/standing-*.proofs.ts`, checked by
 * `type-proofs.test.ts`. The exhaustive consumer and the gate are in `closed-unions.test.ts`. This
 * file pins the two limits of the `?: never` design that need a statement about BOTH tsconfigs.
 */
const PROOFS_DIR = join(import.meta.dirname, "proofs");

describe("HONEST LIMIT: `?: never` forbids every value except an explicit `undefined`, and only under exactOptionalPropertyTypes", () => {
  it("an explicit `warrant: undefined` on a void standing is an error under tsconfig.lib.json and ACCEPTED under tsconfig.json", () => {
    // tsconfig.json (used for app/ and components/) does not set exactOptionalPropertyTypes, so `warrant?: never`
    // there means `warrant?: undefined`. The harness is asked to expect the error under BOTH configs; the only
    // problem it must report is that tsconfig.json has none. A reader cannot tell `undefined` from absent, and
    // JSON drops it, so this is not a way to carry a warrant.
    const source = [
      'import type { VoidStanding } from "../../standing.js";',
      "declare const clean: VoidStanding;",
      "// @ts-expect-error TS2375 exactOptionalPropertyTypes",
      "export const withUndefinedWarrant: VoidStanding = { ...clean, warrant: undefined };",
    ].join("\n");
    const report = checkProofSource(source, PROOFS_DIR);
    expect(report.problems).toEqual([
      '[tsconfig.json] line 4: expected TS2375 containing "exactOptionalPropertyTypes", got no diagnostic at all',
    ]);
  });

  it("a real warrant is refused under BOTH configs (the proofs files above check this for every forbidden field)", () => {
    const source = [
      'import type { VoidStanding } from "../../standing.js";',
      'import type { Warrant } from "../../warrant.js";',
      "declare const clean: VoidStanding;",
      "declare const warrant: Warrant;",
      "// @ts-expect-error TS2322 Type 'Warrant' is not assignable to type",
      "export const withWarrant: VoidStanding = { ...clean, warrant };",
    ].join("\n");
    expect(checkProofSource(source, PROOFS_DIR).problems).toEqual([]);
  });
});

describe("the sample standings are well-typed values of each variant", () => {
  it("binding carries a warrant and nothing of the other families", () => {
    const s = STANDING_SAMPLES.binding;
    expect(Object.keys(s).sort()).toEqual(["commitId", "committedAt", "kind", "warrant"]);
  });

  it("inherited carries a warrant, a severed link, an heir and a chargedTo", () => {
    const s = STANDING_SAMPLES.inherited;
    expect(Object.keys(s).sort()).toEqual(["chargedTo", "commitId", "committedAt", "heir", "kind", "severed", "warrant"]);
  });

  it("void carries a breach and nothing of the other families", () => {
    const s = STANDING_SAMPLES.void;
    expect(Object.keys(s).sort()).toEqual(["breach", "commitId", "committedAt", "kind"]);
  });
});
