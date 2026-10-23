import { describe, expect, it } from "vitest";
import { assertNeverBreach, type Breach } from "../breach.js";
import { grantId, principalId } from "../ids.js";
import type { Verdict } from "../verdict.js";
import { BREACH_SAMPLES } from "./support/samples.js";

/**
 * The closed unions of M1 (`.genesis/PLAN.md` §4.3, §6 M1(d)): each is closed in the sense that adding a
 * variant must be a compile error at every consumer that switches on it, and a value that the type does
 * not describe must make the `assertNever*` function throw rather than fall through.
 *
 * The COMPILE-TIME halves (the sample tables in `support/samples.ts` and the exhaustive switches below
 * stop compiling when a variant is added or renamed; `proofs/` shows the gate firing on a grown union)
 * are reported by `npm run typecheck`. `npm test` strips types, so a missing variant shows up there only
 * as the pinned list of names failing to match.
 */

/** The names, in the order the plan lists them. A rename or a new variant must be a deliberate edit here. */
const BREACH_KINDS = ["no-such-grant", "wrong-actor", "link-dead", "capability-not-granted", "over-limit"] as const;

/** An exhaustive consumer of the REAL union: a sixth variant makes the `default` stop compiling. */
function labelOfBreach(breach: Breach): string {
  switch (breach.kind) {
    case "no-such-grant":
      return `no grant ${breach.grantId}`;
    case "wrong-actor":
      return `${breach.grantId} belongs to ${breach.holder}`;
    case "link-dead":
      return `${breach.grantId} was revoked at seq ${breach.atSeq}`;
    case "capability-not-granted":
      return `${breach.capability} not granted by ${breach.grantId}`;
    case "over-limit":
      return `${breach.requested} exceeds headroom ${breach.headroom}`;
    default:
      return assertNeverBreach(breach);
  }
}

describe("Breach: five variants", () => {
  it("has exactly the five kinds the plan lists, in the plan's precedence order", () => {
    expect(Object.keys(BREACH_SAMPLES)).toEqual([...BREACH_KINDS]);
  });

  it("every variant is reachable by the exhaustive consumer and each sample carries its own kind", () => {
    for (const kind of BREACH_KINDS) {
      expect(BREACH_SAMPLES[kind].kind).toBe(kind);
    }
    expect(Object.values(BREACH_SAMPLES).map(labelOfBreach)).toEqual([
      "no grant g-ghost",
      "G4 belongs to buyer-a",
      "G2 was revoked at seq 11",
      "purchase not granted by G6",
      "50000 exceeds headroom 28000",
    ]);
  });

  it("assertNeverBreach throws on a value the type does not describe, naming the union and the value", () => {
    const stray = { kind: "ratified", grantId: grantId("G1") } as unknown as never;
    expect(() => assertNeverBreach(stray)).toThrowError(/unreachable Breach variant: .*"ratified"/);
  });

  it("assertNeverBreach still throws when the value cannot be printed", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertNeverBreach(cyclic as never)).toThrowError(/unreachable Breach variant: \[a value JSON\.stringify cannot print\]/);
  });
});

describe("Verdict: warranted or breached", () => {
  it("an exhaustive consumer of the real union compiles and separates the two", () => {
    const warranted: Verdict = { kind: "warranted", warrant: { chain: [grantId("G1")], trail: [principalId("dana"), principalId("cfo")] } };
    const breached: Verdict = { kind: "breached", breach: BREACH_SAMPLES["no-such-grant"] };
    const label = (verdict: Verdict): string => {
      switch (verdict.kind) {
        case "warranted":
          return `warranted by ${verdict.warrant.chain.join(">")}`;
        case "breached":
          return `breached: ${verdict.breach.kind}`;
        default: {
          const unreachable: never = verdict;
          return unreachable;
        }
      }
    };
    expect([label(warranted), label(breached)]).toEqual(["warranted by G1", "breached: no-such-grant"]);
  });
});
