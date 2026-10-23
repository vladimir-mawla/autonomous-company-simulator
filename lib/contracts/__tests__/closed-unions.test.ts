import { describe, expect, it } from "vitest";
import { assertNeverBreach, type Breach } from "../breach.js";
import { assertNeverFoldFault, type FoldFault } from "../fold-fault.js";
import { grantId, principalId } from "../ids.js";
import { assertNeverRejection, type Rejection } from "../rejection.js";
import { assertNeverStanding, type Standing } from "../standing.js";
import type { Verdict } from "../verdict.js";
import { BREACH_SAMPLES, FOLD_FAULT_SAMPLES, REJECTION_SAMPLES, STANDING_SAMPLES } from "./support/samples.js";

/**
 * The four closed unions of M1 (`Standing`, `Breach`, `Rejection`, `FoldFault`; `.genesis/PLAN.md` §4.2, §4.3, §6 M1(d)): each is closed in the sense that adding a
 * variant must be a compile error at every consumer that switches on it, and a value that the type does
 * not describe must make the `assertNever*` function throw rather than fall through.
 *
 * The COMPILE-TIME halves are reported by `npm run typecheck`, not by `npm test` (which strips types): the
 * sample tables in `support/samples.ts` and the exhaustive switches below stop compiling when a variant is
 * added or renamed, and `proofs/closed-union-gates.proofs.ts` shows each gate firing when a switch misses a
 * variant. What `npm test` itself can see of a changed union is the pinned name lists below failing to match.
 */

/** The names, in the order the plan lists them. A rename or a new variant must be a deliberate edit here. */
const BREACH_KINDS = ["no-such-grant", "wrong-actor", "link-dead", "capability-not-granted", "over-limit"];
const REJECTION_KINDS = [
  "invalid-event-shape",
  "unknown-capability",
  "duplicate-id",
  "not-a-root",
  "unknown-parent",
  "parent-dead",
  "grantor-not-holder",
  "capability-widening",
  "depth-exhausted",
  "depth-not-narrowed",
  "principal-cycle",
  "over-allocation",
  "unknown-grant",
  "already-dead",
  "revoker-not-authorised",
];
const STANDING_KINDS = ["binding", "inherited", "void"];
const FOLD_FAULT_KINDS = ["invalid-charter", "hostile-log-input", "log-too-long", "seq-mismatch", "inadmissible-event"];

/** An exhaustive consumer of the REAL union: a new variant makes the `default` stop compiling. */
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

function labelOfRejection(rejection: Rejection): string {
  switch (rejection.kind) {
    case "invalid-event-shape":
      return `${rejection.eventKind}: ${rejection.fields.join(",")}`;
    case "unknown-capability":
    case "capability-widening":
      return `${rejection.kind}: ${rejection.capability}`;
    case "duplicate-id":
      return `duplicate ${rejection.id}`;
    case "not-a-root":
      return `${rejection.grantor} is not a root`;
    case "unknown-parent":
      return `unknown parent ${rejection.parent}`;
    case "parent-dead":
      return `parent ${rejection.deadGrant} is dead`;
    case "grantor-not-holder":
      return `${rejection.grantor} is not ${rejection.holder}`;
    case "depth-exhausted":
      return `${rejection.parent} cannot delegate`;
    case "depth-not-narrowed":
      return `${rejection.requested} is not below ${rejection.parentDepth}`;
    case "principal-cycle":
      return `${rejection.principal} repeats`;
    case "over-allocation":
      return `${rejection.requested} exceeds ${rejection.headroom}`;
    case "unknown-grant":
    case "already-dead":
      return `${rejection.kind}: ${rejection.grantId}`;
    case "revoker-not-authorised":
      return `${rejection.by} may not revoke ${rejection.grantId}`;
    default:
      return assertNeverRejection(rejection);
  }
}

function labelOfFoldFault(fault: FoldFault): string {
  switch (fault.kind) {
    case "invalid-charter":
      return `charter: ${fault.fields.join(",")}`;
    case "hostile-log-input":
      return fault.message;
    case "log-too-long":
      return `${fault.length} > ${fault.max}`;
    case "seq-mismatch":
      return `event ${fault.index}: expected ${fault.expected}, found ${fault.actual}`;
    case "inadmissible-event":
      return `event ${fault.index}: ${labelOfRejection(fault.rejection)}`;
    default:
      return assertNeverFoldFault(fault);
  }
}

/** An exhaustive consumer of the real `Standing`: a fourth variant makes the `default` stop compiling. */
function labelOfStanding(standing: Standing): string {
  switch (standing.kind) {
    case "binding":
      return `binding under ${standing.warrant.chain.join(">")}`;
    case "inherited":
      return `inherited by ${standing.heir}, severed at ${standing.severed.atSeq}`;
    case "void":
      return `void: ${standing.breach.kind}`;
    default:
      return assertNeverStanding(standing);
  }
}

describe("Standing: three variants", () => {
  it("has exactly the kinds the plan lists, in the plan's order", () => {
    expect(Object.keys(STANDING_SAMPLES)).toEqual(STANDING_KINDS);
  });

  it("each sample carries its own kind, and the exhaustive consumer reaches every variant", () => {
    for (const kind of STANDING_KINDS) {
      expect(STANDING_SAMPLES[kind as Standing["kind"]].kind).toBe(kind);
    }
    expect(Object.values(STANDING_SAMPLES).map(labelOfStanding)).toEqual([
      "binding under G1>G2>G4",
      "inherited by cfo, severed at 11",
      "void: link-dead",
    ]);
  });
});

describe("Breach: five variants", () => {
  it("has exactly the kinds the plan lists, in the plan's order", () => {
    expect(Object.keys(BREACH_SAMPLES)).toEqual(BREACH_KINDS);
  });

  it("each sample carries its own kind, and the exhaustive consumer reaches every variant", () => {
    for (const kind of BREACH_KINDS) {
      expect(BREACH_SAMPLES[kind as Breach["kind"]].kind).toBe(kind);
    }
    expect(Object.values(BREACH_SAMPLES).map(labelOfBreach)).toEqual([
      "no grant g-ghost",
      "G4 belongs to buyer-a",
      "G2 was revoked at seq 11",
      "purchase not granted by G6",
      "50000 exceeds headroom 28000",
    ]);
  });
});

describe("Rejection: fifteen variants", () => {
  it("has exactly the kinds the plan lists, in the plan's order", () => {
    expect(Object.keys(REJECTION_SAMPLES)).toEqual(REJECTION_KINDS);
    expect(REJECTION_KINDS).toHaveLength(15);
  });

  it("each sample carries its own kind, and the exhaustive consumer reaches every variant", () => {
    for (const kind of REJECTION_KINDS) {
      expect(REJECTION_SAMPLES[kind as Rejection["kind"]].kind).toBe(kind);
    }
    const labels = Object.values(REJECTION_SAMPLES).map(labelOfRejection);
    expect(labels).toHaveLength(15);
    expect(new Set(labels).size).toBe(15);
  });
});

describe("FoldFault: five variants", () => {
  it("has exactly the kinds the plan lists, in the plan's order", () => {
    expect(Object.keys(FOLD_FAULT_SAMPLES)).toEqual(FOLD_FAULT_KINDS);
  });

  it("each sample carries its own kind, and the exhaustive consumer reaches every variant", () => {
    for (const kind of FOLD_FAULT_KINDS) {
      expect(FOLD_FAULT_SAMPLES[kind as FoldFault["kind"]].kind).toBe(kind);
    }
    expect(Object.values(FOLD_FAULT_SAMPLES).map(labelOfFoldFault)).toEqual([
      "charter: roots",
      "a getter threw",
      "5001 > 5000",
      "event 3: expected 4, found 7",
      "event 2: capability-widening: hire",
    ]);
  });
});

describe("every assertNever gate throws on a value the type does not describe", () => {
  const gates: readonly (readonly [string, (value: never) => never])[] = [
    ["Breach", assertNeverBreach],
    ["Rejection", assertNeverRejection],
    ["FoldFault", assertNeverFoldFault],
    ["Standing", assertNeverStanding],
  ];

  for (const [union, gate] of gates) {
    it(`assertNever${union} throws, naming the union and the stray value`, () => {
      const stray = { kind: "ratified", grantId: grantId("G1") } as unknown as never;
      expect(() => gate(stray)).toThrowError(new RegExp(`unreachable ${union} variant: .*"ratified"`));
    });

    it(`assertNever${union} still throws when the value cannot be printed`, () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => gate(cyclic as never)).toThrowError(
        new RegExp(`unreachable ${union} variant: \\[a value JSON\\.stringify cannot print\\]`),
      );
    });
  }
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
