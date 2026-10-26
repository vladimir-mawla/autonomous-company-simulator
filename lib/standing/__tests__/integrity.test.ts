import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitRecord } from "../fold.js";
import type { Standing } from "../../contracts/index.js";
import { standingOf, standings } from "../index.js";
import { deriveStanding, sealStanding } from "../standing.js";
import { CANON_ALL, CHARTER, cid, g, logOf, mustFold, p, treeOf, grant, commit } from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * M5 MUST CALL `assertStandingWellFormed` ON EVERY STANDING IT RETURNS, AND MUST FAIL IF IT SAYS NO (plan §5: "M5 must call it
 * on every standing it returns"; §6 M5 "Must refuse": "a standing built without `assertStandingWellFormed` being called on
 * it"; "(4) `integrity.test.ts` mocks `assertStandingWellFormed` to fail and asserts a throw, plus a real un-mocked cast-built
 * contaminated value").
 *
 * The proof has to go both ways, because each half alone can be satisfied by the wrong code:
 *
 *   A. THE GUARD IS MOCKED TO FAIL. A test that only shows the real guard rejects a contaminated value says nothing about
 *      whether M5 asks it. Here the module is replaced by a wrapper that forwards to the real function unless a test
 *      switches it to fail, and records every standing it is handed. With it failing, `standings` and `standingOf` must
 *      throw, for each of the three kinds; and with it forwarding, it must have been handed exactly the standings that were
 *      returned, one call each, the same objects.
 *   B. THE GUARD IS REAL. A mock that always fails would pass A for code that never reads the answer properly. So the real
 *      guard (the wrapper forwarding to it) is given values built by a cast: a `void` carrying a `warrant`, an `inherited`
 *      missing its `heir`, and the rest of the ways `lib/contracts` says it catches, through M5's own seal, and through M5's own
 *      builder given a corrupted record. Each must throw with the real guard's finding in the message.
 *
 * What this does not show: that the guard catches everything (it checks presence, not relations: ADR 0001, Decision 10), or that
 * nothing else in M5 constructs a standing, which is a property of where standings are made (only `deriveStanding`, which
 * returns through `sealStanding`) and not of a scan.
 */

const control = vi.hoisted(() => ({
  /** Kinds the wrapper reports as malformed; empty means it forwards to the real guard. */
  failFor: new Set<string>(),
  calls: [] as unknown[],
}));

vi.mock("../../contracts/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../contracts/index.js")>();
  return {
    ...actual,
    assertStandingWellFormed: (standing: Standing) => {
      control.calls.push(standing);
      if (control.failFor.has(standing.kind)) {
        return { ok: false as const, error: { kind: "unexpected-field" as const, variant: standing.kind, field: "mocked" } };
      }
      return actual.assertStandingWellFormed(standing);
    },
  };
});

beforeEach(() => {
  control.failFor.clear();
  control.calls.length = 0;
});

const CANON = logOf(CHARTER, CANON_ALL);

describe("A. the guard is mocked to fail: M5 throws, for each of the three kinds", () => {
  it("the canonical log has all three kinds, so every kind is exercised below", () => {
    const result = standings(CHARTER, CANON);
    expect(result.ok && new Set(result.standings.map((standing) => standing.kind))).toStrictEqual(new Set(["binding", "inherited", "void"]));
  });

  for (const kind of ["binding", "inherited", "void"] as const) {
    it(`standings throws when the guard says no to a ${kind} standing, naming the guard's finding and nothing from the input`, () => {
      control.failFor.add(kind);
      expect(() => standings(CHARTER, CANON)).toThrow(`internal error: a standing M5 built is not well-formed (unexpected-field ${kind}.mocked)`);
    });
  }

  it("standingOf throws too, for a commit of each kind (c3 binding, c1 inherited, c5 void)", () => {
    for (const [id, kind] of [["c3", "binding"], ["c1", "inherited"], ["c5", "void"]] as const) {
      control.failFor.clear();
      control.failFor.add(kind);
      expect(() => standingOf(CHARTER, CANON, cid(id)), id).toThrow("internal error: a standing M5 built is not well-formed");
      // The same call with the guard forwarding to the real one returns the standing.
      control.failFor.clear();
      const result = standingOf(CHARTER, CANON, cid(id));
      expect(result.ok && result.standing.kind, id).toBe(kind);
    }
  });

  it("with the guard forwarding, it is handed exactly the standings standings returns: one call each, the same objects, in order", () => {
    const result = standings(CHARTER, CANON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(control.calls).toHaveLength(result.standings.length);
    result.standings.forEach((standing, index) => expect(control.calls[index]).toBe(standing));
    expect(result.standings.length).toBeGreaterThan(5);
  });

  it("standingOf hands the guard the one standing it returns", () => {
    const result = standingOf(CHARTER, CANON, cid("c4"));
    expect(control.calls).toHaveLength(1);
    expect(result.ok && control.calls[0] === result.standing).toBe(true);
  });

  it("the error is a plain Error whose message carries the guard's finding and nothing from the log (no id from it appears)", () => {
    control.failFor.add("void");
    let thrown: unknown;
    try {
      standings(CHARTER, CANON);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain("g-ghost");
    expect((thrown as Error).message).not.toContain("c5");
  });
});

describe("B. the guard is real: cast-built contaminated values are refused by M5's own seal, with the guard's finding", () => {
  const warrant = { chain: [g("G1")], trail: [p("dana"), p("cfo")] } as const;
  const severed = { grantId: g("G1"), atSeq: 9 };
  const base = { commitId: cid("c"), committedAt: 3 };
  const clean: Record<string, Standing> = {
    binding: { ...base, kind: "binding", warrant },
    inherited: { ...base, kind: "inherited", warrant, severed, heir: p("dana"), chargedTo: null },
    void: { ...base, kind: "void", breach: { kind: "no-such-grant", grantId: g("x") } },
  };

  /** A standing built through a double cast, which TypeScript cannot see through. */
  const cast = (value: object): Standing => value as unknown as Standing;

  it("the three clean standings pass through the seal unchanged: the same object comes back", () => {
    for (const standing of Object.values(clean)) expect(sealStanding(standing)).toBe(standing);
  });

  const contaminated: readonly [string, Standing, string][] = [
    ["a void carrying a warrant", cast({ ...clean["void"], warrant }), "unexpected-field void.warrant"],
    ["a void carrying a heir", cast({ ...clean["void"], heir: p("dana") }), "unexpected-field void.heir"],
    ["a void carrying a severed link", cast({ ...clean["void"], severed }), "unexpected-field void.severed"],
    ["a void carrying chargedTo", cast({ ...clean["void"], chargedTo: g("G1") }), "unexpected-field void.chargedTo"],
    ["a binding carrying a breach", cast({ ...clean["binding"], breach: { kind: "no-such-grant", grantId: g("x") } }), "unexpected-field binding.breach"],
    ["a binding carrying a heir", cast({ ...clean["binding"], heir: p("dana") }), "unexpected-field binding.heir"],
    ["an inherited carrying a breach", cast({ ...clean["inherited"], breach: { kind: "no-such-grant", grantId: g("x") } }), "unexpected-field inherited.breach"],
    ["an inherited with no heir", cast({ ...clean["inherited"], heir: undefined }), "missing-field inherited.heir"],
    ["an inherited with no severed link", cast({ ...clean["inherited"], severed: undefined }), "missing-field inherited.severed"],
    ["an inherited with chargedTo undefined (null is allowed, undefined is not)", cast({ ...clean["inherited"], chargedTo: undefined }), "missing-field inherited.chargedTo"],
    ["a void with no breach", cast({ ...clean["void"], breach: undefined }), "missing-field void.breach"],
    ["a binding with no warrant", cast({ ...clean["binding"], warrant: undefined }), "missing-field binding.warrant"],
    ["a standing with no commitId", cast({ ...clean["void"], commitId: undefined }), "missing-field void.commitId"],
    ["a fourth kind", cast({ ...base, kind: "ratified" }), "unknown-variant"],
  ];

  it.each(contaminated.map((row) => [row[0], row] as const))("%s", (_name, row) => {
    expect(() => sealStanding(row[1])).toThrow(`internal error: a standing M5 built is not well-formed (${row[2]})`);
  });

  it("the same contamination reaches the seal through M5's own builder: deriveStanding given a corrupted record throws", () => {
    const tree = treeOf([grant({ id: "G1", grantor: "dana", grantee: "cfo", limit: 100, depth: 1 })]);
    const record = (verdict: unknown): CommitRecord<Cap> => ({ commit: commit("c", "cfo", "G1", "purchase", 1), seq: 3, verdict: verdict as CommitRecord<Cap>["verdict"] });
    // A breached verdict whose breach is gone: the void standing it builds has no breach.
    expect(() => deriveStanding(tree, record({ kind: "breached", breach: undefined }))).toThrow("missing-field void.breach");
    // A well-formed record builds and passes.
    expect(deriveStanding(tree, record({ kind: "warranted", warrant })).kind).toBe("binding");
  });

  it("the one other throw in the builder: a warranted record whose cut link is not in the tree is an internal error, not a standing", () => {
    // Only a hand-built tree can do this (a fold never records a revocation for a grant it does not hold).
    const tree = { grants: new Map(), revokedAt: new Map([[g("G1"), 5]]) };
    const record = { commit: commit("c", "cfo", "G1", "purchase", 1), seq: 3, verdict: { kind: "warranted", warrant } } as unknown as CommitRecord<Cap>;
    expect(() => deriveStanding(tree, record)).toThrow("internal error: a warranted commit's chain names a grant that is not in the tree");
  });

  it("the real guard is on the path of an ordinary call: every standing of the canonical log came back through the wrapper that forwards to it", () => {
    control.calls.length = 0;
    const folded = mustFold(CHARTER, CANON);
    const result = standings(CHARTER, CANON);
    expect(result.ok && result.standings.length).toBe(folded.commits.size);
    expect(control.calls).toHaveLength(folded.commits.size);
  });
});
