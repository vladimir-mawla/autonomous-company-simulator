import { describe, expect, it } from "vitest";
import * as contracts from "../index.js";

/**
 * The run-time half of the public surface: exactly the names the plan gives M1 (`.genesis/PLAN.md` §5,
 * "Function ownership": `principalId grantId commitId assertNever* assertStandingWellFormed`, plus the
 * four constants of §4.1). The type names are pinned in `proofs/public-surface.proofs.ts`.
 *
 * A name added here must be a deliberate edit: this is what stops the internal `unreachable` helper from
 * leaking into the barrel.
 */
describe("the barrel exports exactly the run-time names the plan gives M1", () => {
  it("lists them", () => {
    expect(Object.keys(contracts).sort()).toEqual(
      [
        "MAX_AMOUNT",
        "MAX_ID_LENGTH",
        "MAX_LOG_EVENTS",
        "MAX_ROOT_DEPTH",
        "assertNeverBreach",
        "assertNeverFoldFault",
        "assertNeverRejection",
        "assertNeverStanding",
        "assertStandingWellFormed",
        "commitId",
        "grantId",
        "principalId",
      ].sort(),
    );
  });

  it("does not leak the shared helper", () => {
    expect("unreachable" in contracts).toBe(false);
  });

  it("the three mint functions and the four gates are functions, the four bounds numbers", () => {
    for (const name of ["commitId", "grantId", "principalId", "assertNeverBreach", "assertNeverFoldFault", "assertNeverRejection", "assertNeverStanding", "assertStandingWellFormed"] as const) {
      expect(typeof contracts[name], name).toBe("function");
    }
    for (const name of ["MAX_AMOUNT", "MAX_ID_LENGTH", "MAX_LOG_EVENTS", "MAX_ROOT_DEPTH"] as const) {
      expect(typeof contracts[name], name).toBe("number");
    }
  });
});
