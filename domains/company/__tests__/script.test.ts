import { describe, expect, it } from "vitest";
import { CANON_ALL } from "../../../lib/standing/__tests__/fixtures.js";
import { AGENTS, CAPABILITIES, ROOT } from "../org.js";
import { CANON_SCRIPT } from "../script.js";
import type { ScriptStep } from "../script.js";

/**
 * `CANON_SCRIPT` as DATA (`script.ts`): what is offered, in what order, and that it is the same event list as plan §7's. What the engine
 * ANSWERS to each step is `canon-replay.test.ts`'s business, not this file's: nothing here runs the engine.
 *
 * The cross-check that matters is the first one: the eighteen admitted events are compared with `CANON_ALL`, the list M5 wrote for itself in
 * `lib/standing/__tests__/fixtures.ts` and replays in `canonical.test.ts`. They were written by different hands from the same table, so
 * agreement is evidence that §7 was read the same way twice, and the failure of either list to compile or replay is caught in its own place.
 */

/** §7's order, as keys: seq 1 to 10, beat 1 (eleven refusals), seq 11, two refusals, seq 12 to 18, the two intake lines. */
const ORDER = [
  "G1", "G2", "G3", "G4", "G5", "G6",
  "c1", "c2", "c3", "c4",
  "widen-scope", "over-delegate", "delegate-past-depth", "mint-root", "delegate-borrowed", "keep-depth", "delegate-upward", "orphan-grant", "reuse-grant-id", "revoke-own-grant", "revoke-ghost",
  "revoke-G2",
  "revoke-twice", "delegate-from-dead",
  "c5", "c6", "c7", "c8", "c9",
  "G7", "c10",
  "negative-limit", "launder-capability",
] as const;

const ADMITTED = ["G1", "G2", "G3", "G4", "G5", "G6", "c1", "c2", "c3", "c4", "revoke-G2", "c5", "c6", "c7", "c8", "c9", "G7", "c10"] as const;
const REFUSED = ORDER.filter((key) => !(ADMITTED as readonly string[]).includes(key));

const stepOf = (key: string): ScriptStep => {
  const step = CANON_SCRIPT.find((candidate) => candidate.key === key);
  if (step === undefined) throw new Error(`no step ${key}`);
  return step;
};

describe("CANON_SCRIPT is plan section 7's event list", () => {
  it("has thirty-three steps in the order §7 gives them: 18 that are admitted and 15 that are refused", () => {
    expect(CANON_SCRIPT.map((step) => step.key)).toEqual([...ORDER]);
    expect(ADMITTED).toHaveLength(18);
    expect(REFUSED).toHaveLength(15);
  });

  it("every key and every label is unique and not empty", () => {
    expect(new Set(CANON_SCRIPT.map((step) => step.key)).size).toBe(CANON_SCRIPT.length);
    expect(new Set(CANON_SCRIPT.map((step) => step.label)).size).toBe(CANON_SCRIPT.length);
    for (const step of CANON_SCRIPT) expect(step.label.length, step.key).toBeGreaterThan(10);
  });

  it("the eighteen admitted steps are, event for event and in order, the eighteen events of M5's CANON_ALL (the list canonical.test.ts replays)", () => {
    expect(ADMITTED.map((key) => stepOf(key).input)).toEqual([...CANON_ALL]);
  });

  it("the fifteen refused steps are 11 + 2 + 2: eleven before the revoke, two straight after it, and the two intake lines last", () => {
    const at = (key: string): number => ORDER.indexOf(key as (typeof ORDER)[number]);
    const before = REFUSED.filter((key) => at(key) < at("revoke-G2"));
    const after = REFUSED.filter((key) => at(key) > at("revoke-G2"));
    expect(before).toHaveLength(11);
    expect(after).toEqual(["revoke-twice", "delegate-from-dead", "negative-limit", "launder-capability"]);
    expect(at("negative-limit")).toBe(CANON_SCRIPT.length - 2);
  });

  it("the events are of the three kinds in these numbers: 7 grants, 10 commits and 1 revoke among the admitted; 12 grants and 3 revokes among the refused", () => {
    const count = (keys: readonly string[], kind: string): number => keys.filter((key) => stepOf(key).input.kind === kind).length;
    expect([count(ADMITTED, "grant"), count(ADMITTED, "commit"), count(ADMITTED, "revoke")]).toEqual([7, 10, 1]);
    expect([count(REFUSED, "grant"), count(REFUSED, "commit"), count(REFUSED, "revoke")]).toEqual([12, 0, 3]);
  });
});

describe("what the steps name", () => {
  it("every principal is dana, one of the six agents, or the intern (who appears once, minting a root)", () => {
    const named = new Map<string, string[]>();
    const note = (who: string, key: string): void => {
      named.set(who, [...(named.get(who) ?? []), key]);
    };
    for (const step of CANON_SCRIPT) {
      const event = step.input;
      if (event.kind === "grant") {
        note(event.grant.grantor, step.key);
        note(event.grant.grantee, step.key);
      } else if (event.kind === "revoke") note(event.by, step.key);
      else note(event.commit.actor, step.key);
    }
    const roster = new Set<string>([...AGENTS, ROOT, "intern"]);
    expect([...named.keys()].filter((who) => !roster.has(who))).toEqual([]);
    expect(named.get("intern")).toEqual(["mint-root"]);
    expect(named.get("dana")).toEqual(["G1"]);
  });

  it("every capability named is in the closed list, except the one step that names `launder` on purpose", () => {
    const outside: string[] = [];
    for (const step of CANON_SCRIPT) {
      const event = step.input;
      const caps = event.kind === "grant" ? event.grant.capabilities : event.kind === "commit" ? [event.commit.capability] : [];
      for (const cap of caps) if (!(CAPABILITIES as readonly string[]).includes(cap)) outside.push(`${step.key}:${cap}`);
    }
    expect(outside).toEqual(["launder-capability:launder"]);
  });
});

describe("the steps are frozen all the way down, because every replay and every quarter hands the same objects to the engine and an attempt holds the one it was given", () => {
  it("the list, each step, each event and everything inside it", () => {
    const loose: string[] = [];
    const visit = (value: unknown, path: string): void => {
      if (typeof value !== "object" || value === null) return;
      if (!Object.isFrozen(value)) loose.push(path);
      for (const [key, inner] of Object.entries(value)) visit(inner, `${path}.${key}`);
    };
    visit(CANON_SCRIPT, "CANON_SCRIPT");
    expect(loose).toEqual([]);
  });

  it("writing to a step throws", () => {
    const step = CANON_SCRIPT[0] as unknown as { label: string };
    expect(() => {
      step.label = "changed";
    }).toThrow(TypeError);
    expect(() => (CANON_SCRIPT as unknown as ScriptStep[]).push(CANON_SCRIPT[0] as ScriptStep)).toThrow(TypeError);
  });
});
