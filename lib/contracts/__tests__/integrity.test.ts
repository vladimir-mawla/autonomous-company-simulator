import { describe, expect, it } from "vitest";
import { commitId, grantId, principalId } from "../ids.js";
import { assertStandingWellFormed, type Standing } from "../standing.js";
import { STANDING_SAMPLES, WARRANT_C1 } from "./support/samples.js";

/**
 * `assertStandingWellFormed` is the run-time half of the DoD gate "a `void` standing carrying a
 * `warrant`, or an `inherited` standing without a heir, does not compile": it sees a contaminated value
 * however it got there, including the routes the compiler cannot see (a cast, an `any`).
 *
 * The expectations below come from the plan's §4.2 table, not from the guard's own field tables, so a
 * table that drifts from the plan is caught here and not only by the compile-time `Assert` lines in
 * `standing.ts`. Every contaminated value carries exactly ONE fault, so deleting one field from the
 * guard's tables turns the matching test red and no other.
 */

/** Build a value of the wrong shape on purpose: this is the `as unknown as` residual, so it needs the cast. */
function build(base: Standing, patch: Readonly<Record<string, unknown>>, remove: readonly string[] = []): Standing {
  const copy: Record<string, unknown> = { ...base, ...patch };
  for (const field of remove) delete copy[field];
  return copy as unknown as Standing;
}

const SMUGGLED = {
  warrant: WARRANT_C1,
  breach: { kind: "no-such-grant", grantId: grantId("g-ghost") },
  severed: { grantId: grantId("G2"), atSeq: 11 },
  heir: principalId("cfo"),
  chargedTo: grantId("G1"),
} as const;

/** Plan §4.2: what each variant refuses to carry. */
const FORBIDDEN: readonly (readonly [Standing["kind"], keyof typeof SMUGGLED])[] = [
  ["binding", "breach"],
  ["binding", "severed"],
  ["binding", "heir"],
  ["binding", "chargedTo"],
  ["inherited", "breach"],
  ["void", "warrant"],
  ["void", "severed"],
  ["void", "heir"],
  ["void", "chargedTo"],
];

/** Plan §4.2: what each variant must carry, besides the two common fields. */
const REQUIRED: readonly (readonly [Standing["kind"], string])[] = [
  ["binding", "warrant"],
  ["inherited", "warrant"],
  ["inherited", "severed"],
  ["inherited", "heir"],
  ["inherited", "chargedTo"],
  ["void", "breach"],
];

describe("a well-formed standing of each variant is ok", () => {
  for (const kind of ["binding", "inherited", "void"] as const) {
    it(kind, () => {
      expect(assertStandingWellFormed(STANDING_SAMPLES[kind])).toEqual({ ok: true });
    });
  }

  it("an inherited standing charged to a charter root (chargedTo: null) is ok: null is the allowed value there", () => {
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.inherited, { chargedTo: null }))).toEqual({ ok: true });
  });
});

describe("the three self-check cases plan §6 gives M2's health route", () => {
  it("(1) a well-formed inherited standing is ok", () => {
    expect(assertStandingWellFormed(STANDING_SAMPLES.inherited).ok).toBe(true);
  });

  it("(2) a cast-built void standing carrying a warrant is unexpected-field / void / warrant", () => {
    const result = assertStandingWellFormed(build(STANDING_SAMPLES.void, { warrant: WARRANT_C1 }));
    expect(result).toEqual({ ok: false, error: { kind: "unexpected-field", variant: "void", field: "warrant" } });
  });

  it("(3) a cast-built inherited standing missing its heir is missing-field / inherited / heir", () => {
    const result = assertStandingWellFormed(build(STANDING_SAMPLES.inherited, {}, ["heir"]));
    expect(result).toEqual({ ok: false, error: { kind: "missing-field", variant: "inherited", field: "heir" } });
  });
});

describe("every forbidden field is reported, one test per (variant, field)", () => {
  for (const [variant, field] of FORBIDDEN) {
    it(`${variant} carrying ${field} is unexpected-field`, () => {
      const result = assertStandingWellFormed(build(STANDING_SAMPLES[variant], { [field]: SMUGGLED[field] }));
      expect(result).toEqual({ ok: false, error: { kind: "unexpected-field", variant, field } });
    });
  }

  it("a forbidden field holding null is reported: null is not undefined", () => {
    const result = assertStandingWellFormed(build(STANDING_SAMPLES.void, { warrant: null }));
    expect(result).toEqual({ ok: false, error: { kind: "unexpected-field", variant: "void", field: "warrant" } });
  });

  it("a forbidden field that is inherited from a prototype or non-enumerable is still seen: the guard reads by name", () => {
    const viaPrototype = Object.create({ warrant: WARRANT_C1 }) as Record<string, unknown>;
    Object.assign(viaPrototype, STANDING_SAMPLES.void);
    expect(assertStandingWellFormed(viaPrototype as unknown as Standing)).toEqual({
      ok: false,
      error: { kind: "unexpected-field", variant: "void", field: "warrant" },
    });

    const hidden: Record<string, unknown> = { ...STANDING_SAMPLES.void };
    Object.defineProperty(hidden, "heir", { value: principalId("cfo"), enumerable: false });
    expect(assertStandingWellFormed(hidden as unknown as Standing)).toEqual({
      ok: false,
      error: { kind: "unexpected-field", variant: "void", field: "heir" },
    });
  });
});

describe("every required field is reported when absent, one test per (variant, field)", () => {
  for (const [variant, field] of REQUIRED) {
    it(`${variant} without ${field} is missing-field`, () => {
      const result = assertStandingWellFormed(build(STANDING_SAMPLES[variant], {}, [field]));
      expect(result).toEqual({ ok: false, error: { kind: "missing-field", variant, field } });
    });
  }

  for (const variant of ["binding", "inherited", "void"] as const) {
    for (const field of ["commitId", "committedAt"]) {
      it(`${variant} without the common field ${field} is missing-field`, () => {
        const result = assertStandingWellFormed(build(STANDING_SAMPLES[variant], {}, [field]));
        expect(result).toEqual({ ok: false, error: { kind: "missing-field", variant, field } });
      });
    }
  }

  it("a required field holding undefined is missing, as is one holding null (except chargedTo, where null is allowed)", () => {
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.inherited, { chargedTo: undefined }))).toEqual({
      ok: false,
      error: { kind: "missing-field", variant: "inherited", field: "chargedTo" },
    });
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.inherited, { heir: null }))).toEqual({
      ok: false,
      error: { kind: "missing-field", variant: "inherited", field: "heir" },
    });
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.void, { breach: null }))).toEqual({
      ok: false,
      error: { kind: "missing-field", variant: "void", field: "breach" },
    });
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.void, { commitId: null }))).toEqual({
      ok: false,
      error: { kind: "missing-field", variant: "void", field: "commitId" },
    });
  });

  it("committedAt of 0 is present: only undefined and null count as absent", () => {
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.void, { committedAt: 0 }))).toEqual({ ok: true });
  });
});

describe("the same contaminated value is caught whichever way it reached the type", () => {
  const contaminated = { ...STANDING_SAMPLES.void, warrant: WARRANT_C1 };

  it("by an explicit as-unknown-as cast", () => {
    const standing = contaminated as unknown as Standing;
    expect(assertStandingWellFormed(standing)).toEqual({
      ok: false,
      error: { kind: "unexpected-field", variant: "void", field: "warrant" },
    });
  });

  it("by an implicit any (JSON.parse), with no cast written", () => {
    const standing: Standing = JSON.parse(JSON.stringify(contaminated));
    expect(assertStandingWellFormed(standing)).toEqual({
      ok: false,
      error: { kind: "unexpected-field", variant: "void", field: "warrant" },
    });
  });

  it("an explicit undefined on a forbidden field is NOT reported: it is the same as absent to a reader and to JSON", () => {
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.void, { warrant: undefined }))).toEqual({ ok: true });
    expect(Object.keys(JSON.parse(JSON.stringify(build(STANDING_SAMPLES.void, { warrant: undefined }))))).not.toContain("warrant");
  });
});

describe("a value whose kind is not one of the three is reported as unknown-variant, not passed and not thrown", () => {
  const cases: readonly (readonly [string, unknown, string])[] = [
    ["a fourth kind", { ...STANDING_SAMPLES.void, kind: "ratified" }, "ratified"],
    ["a missing kind", { commitId: commitId("c1"), committedAt: 1 }, "undefined"],
    ["a numeric kind", { ...STANDING_SAMPLES.void, kind: 3 }, "number"],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["a string", "binding", "string"],
    ["a number", 7, "number"],
  ];
  for (const [label, value, found] of cases) {
    it(label, () => {
      expect(assertStandingWellFormed(value as unknown as Standing)).toEqual({ ok: false, error: { kind: "unknown-variant", found } });
    });
  }
});

describe("only the first problem is reported, in the documented order", () => {
  it("a missing common field comes before a missing variant field", () => {
    const standing = build(STANDING_SAMPLES.inherited, {}, ["committedAt", "heir"]);
    expect(assertStandingWellFormed(standing)).toEqual({
      ok: false,
      error: { kind: "missing-field", variant: "inherited", field: "committedAt" },
    });
  });

  it("a missing variant field comes before a forbidden field", () => {
    // A void standing that carries a warrant and has lost its breach: the missing breach is the report.
    const standing = build(STANDING_SAMPLES.void, { warrant: WARRANT_C1 }, ["breach"]);
    expect(assertStandingWellFormed(standing)).toEqual({
      ok: false,
      error: { kind: "missing-field", variant: "void", field: "breach" },
    });
  });

  it("two forbidden fields are reported in the order the variant declares them (warrant before heir)", () => {
    const standing = build(STANDING_SAMPLES.void, { heir: SMUGGLED.heir, warrant: SMUGGLED.warrant });
    expect(assertStandingWellFormed(standing)).toEqual({
      ok: false,
      error: { kind: "unexpected-field", variant: "void", field: "warrant" },
    });
  });
});

describe("HONEST LIMITS: what the guard does not catch", () => {
  it("an unrelated extra field passes: only the fields the variants name are checked", () => {
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.void, { note: "not a Standing field", verdict: "leaked" }))).toEqual({ ok: true });
  });

  it("a present field of the wrong kind passes: the guard checks presence, not value", () => {
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.inherited, { heir: 42, severed: "not a link" }))).toEqual({ ok: true });
    expect(assertStandingWellFormed(build(STANDING_SAMPLES.binding, { warrant: { chain: [], trail: [] } }))).toEqual({ ok: true });
  });

  it("a relation between fields passes: a severed link that is not after the commit, and an heir that is the actor", () => {
    const beforeTheCommit = build(STANDING_SAMPLES.inherited, { committedAt: 50, severed: { grantId: grantId("G2"), atSeq: 3 } });
    expect(assertStandingWellFormed(beforeTheCommit)).toEqual({ ok: true });
  });

  it("a hostile accessor makes the guard throw rather than return: hostile input is not its job", () => {
    const hostile = { ...STANDING_SAMPLES.void };
    Object.defineProperty(hostile, "warrant", {
      enumerable: true,
      get() {
        throw new Error("a getter that throws");
      },
    });
    expect(() => assertStandingWellFormed(hostile as unknown as Standing)).toThrowError("a getter that throws");
  });
});
