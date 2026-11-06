import { describe, expect, it } from "vitest";
import type { EventInput } from "../../../lib/contracts/index.js";
import { MAX_AMOUNT, principalId } from "../../../lib/contracts/index.js";
import { AGENTS, CAPABILITIES, CHARTER, ROOT, agent } from "../org.js";
import type { CompanyCapability } from "../org.js";
import { offer } from "../simulate.js";
import type { OfferMeta } from "../simulate.js";

/**
 * The one place in this domain where an object from OUTSIDE meets the engine is `offer`, which hands what it is given to `append` as it is: it
 * does not read it first and does not copy it. What protects the engine from a hostile object is M3's intake inside `append` (plan §5: "`append`
 * always re-reads its `input` through `readEventInput` even though it is typed"; ADR 0003, ADR 0005 Decision 5 and 6). This domain adds nothing
 * to that, and these tests are here to show that it takes nothing away: each hostile input goes through `offer` and comes back as a typed
 * attempt, never a throw, and the engine reads each field once.
 *
 * What is NOT shown here is intake's whole behaviour (that is `lib/chain/__tests__/hostile-input.test.ts` and `lib/standing/__tests__/hostile-input.test.ts`):
 * only that this path reaches it.
 */

const META: OfferMeta = { n: 1, tick: 0, source: "canon", label: null };
const cfo = agent("cfo");

const asEvent = (value: unknown): EventInput<CompanyCapability> => value as EventInput<CompanyCapability>;

function grantWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { id: "Gh", parent: null, grantor: ROOT, grantee: cfo, capabilities: [CAPABILITIES[0]], limit: 100, depth: 1, ...overrides };
}

/** A copy of `base` whose `key` is an accessor (a spread would call the getter once and keep its answer as plain data). */
function withAccessor(base: Record<string, unknown>, key: string, get: () => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  delete out[key];
  Object.defineProperty(out, key, { get, enumerable: true, configurable: true });
  return out;
}

describe("a hostile object handed to offer comes back as an attempt", () => {
  it("a Proxy whose every read throws: faulty-log carrying hostile-log-input, naming the input; the log is untouched and nothing is thrown", () => {
    const proxy = new Proxy({}, { get: () => { throw new Error("no"); }, has: () => { throw new Error("no"); }, ownKeys: () => { throw new Error("no"); } });
    const offered = offer([], asEvent(proxy), META);
    expect(offered.log).toEqual([]);
    expect(offered.attempt.outcome.kind).toBe("faulty-log");
    const outcome = offered.attempt.outcome;
    expect(outcome.kind === "faulty-log" && outcome.fault.kind).toBe("hostile-log-input");
    expect(outcome.kind === "faulty-log" && outcome.fault.kind === "hostile-log-input" && outcome.fault.message.startsWith("input: ")).toBe(true);
  });

  it("a getter that throws deep inside the grant: the same", () => {
    const hostile = {
      kind: "grant",
      grant: withAccessor(grantWith({}), "limit", () => {
        throw new Error("no");
      }),
    };
    const outcome = offer([], asEvent(hostile), META).attempt.outcome;
    expect(outcome.kind === "faulty-log" && outcome.fault.kind).toBe("hostile-log-input");
  });

  it("a getter that answers differently every time it is read: the engine reads it once, so the admitted limit is the first answer and the getter ran once", () => {
    let reads = 0;
    const hostile = {
      kind: "grant",
      grant: withAccessor(grantWith({}), "limit", () => {
        reads++;
        return reads === 1 ? 10 : -5;
      }),
    };
    const offered = offer([], asEvent(hostile), META);
    expect(reads).toBe(1);
    const outcome = offered.attempt.outcome;
    expect(outcome.kind === "admitted" && outcome.event.kind === "grant" && outcome.event.grant.limit).toBe(10);
  });

  it("read once, whatever the first read is: for a first answer of each class (null, 0, negative, MAX_AMOUNT and one past it, NaN, either infinity, a valid number) and a different second answer, a limit getter is read once and the engine's answer is what a plain object holding the first answer gets", () => {
    const FIRST: readonly [string, unknown, unknown][] = [
      ["null", null, 10],
      ["zero", 0, -5],
      ["negative", -1, 10],
      ["MAX_AMOUNT, the largest the engine takes", MAX_AMOUNT, -5],
      ["one past MAX_AMOUNT", MAX_AMOUNT + 1, 10],
      ["NaN", Number.NaN, 10],
      ["+Infinity", Number.POSITIVE_INFINITY, 10],
      ["-Infinity", Number.NEGATIVE_INFINITY, 10],
      ["a valid number", 10, Number.NaN],
    ];
    let admitted = 0;
    let refused = 0;
    for (const [name, first, second] of FIRST) {
      let reads = 0;
      const hostile = { kind: "grant", grant: withAccessor(grantWith({}), "limit", () => (++reads === 1 ? first : second)) };
      const got = offer([], asEvent(hostile), META).attempt.outcome;
      expect(reads, name).toBe(1);
      const control = offer([], asEvent({ kind: "grant", grant: grantWith({ limit: first }) }), META).attempt.outcome;
      expect(got.kind, name).toBe(control.kind);
      if (got.kind === "admitted") {
        admitted++;
        expect(got.event.kind === "grant" && got.event.grant.limit, name).toBe(first);
      } else {
        refused++;
        expect(got, name).toEqual(control);
      }
    }
    // The table reached both outcomes: a table in which every first answer was refused (or every one admitted) would prove nothing about which answer was read.
    expect([admitted, refused]).toEqual([3, 6]);
  });

  it("read once, for a commit's amount, the same way: each first answer is the only one read, and the outcome is the plain object's with that answer", () => {
    const first = offer([], asEvent({ kind: "grant", grant: grantWith({ limit: 1_000 }) }), META);
    expect(first.attempt.outcome.kind).toBe("admitted");
    const commitWith = (amount: unknown) => ({ kind: "commit", commit: { id: "ch", actor: cfo, actedUnder: "Gh", capability: CAPABILITIES[0], amount } });
    const FIRST: readonly [string, unknown, unknown][] = [
      ["null", null, 10],
      ["zero", 0, 10],
      ["negative", -1, 10],
      ["MAX_AMOUNT, the largest the engine takes", MAX_AMOUNT, 10],
      ["one past MAX_AMOUNT", MAX_AMOUNT + 1, 10],
      ["NaN", Number.NaN, 10],
      ["+Infinity", Number.POSITIVE_INFINITY, 10],
      ["-Infinity", Number.NEGATIVE_INFINITY, 10],
      ["a valid number", 10, Number.NaN],
    ];
    for (const [name, firstAnswer, second] of FIRST) {
      let reads = 0;
      const live = commitWith(firstAnswer);
      const hostile = { kind: "commit", commit: withAccessor(live.commit, "amount", () => (++reads === 1 ? firstAnswer : second)) };
      const got = offer(first.log, asEvent(hostile), META).attempt.outcome;
      expect(reads, name).toBe(1);
      expect(got, name).toEqual(offer(first.log, asEvent(commitWith(firstAnswer)), META).attempt.outcome);
    }
  });

  it("what is logged is a copy: neither the event in the log nor the one in the attempt is the caller's object, and changing the caller's object afterwards changes neither", () => {
    const mine = { kind: "grant", grant: grantWith({}) } as { kind: string; grant: Record<string, unknown> };
    const offered = offer([], asEvent(mine), META);
    const outcome = offered.attempt.outcome;
    expect(outcome.kind).toBe("admitted");
    if (outcome.kind !== "admitted") return;
    expect(outcome.event).not.toBe(mine);
    expect(offered.log[0]).not.toBe(mine);
    mine.grant["limit"] = 999;
    expect(outcome.event.kind === "grant" && outcome.event.grant.limit).toBe(100);
    expect(offered.log[0]?.kind === "grant" && offered.log[0].grant.limit).toBe(100);
  });

  it("the attempt holds the object it was given (so a caller that wants the record not to move hands over a frozen one, as the script does)", () => {
    const mine = { kind: "grant", grant: grantWith({}) };
    expect(offer([], asEvent(mine), META).attempt.input).toBe(mine);
  });

  it("a seq on the input is not taken: the engine stamps its own (D3: a caller cannot choose, and cannot back-date)", () => {
    const outcome = offer([], asEvent({ kind: "grant", grant: grantWith({}), seq: 99 }), META).attempt.outcome;
    expect(outcome.kind === "admitted" && outcome.event.seq).toBe(1);
  });

  it("things that are not events at all are refused as an unknown kind of event, each with the fields that are wrong, never thrown at", () => {
    for (const value of [null, undefined, 7, "grant", [], () => 0, Symbol("x"), 1n, { kind: "launder" }, {}]) {
      const offered = offer([], asEvent(value), META);
      expect(offered.log, String(typeof value)).toEqual([]);
      expect(offered.attempt.outcome.kind, String(typeof value)).toBe("rejected");
    }
  });

  it("a grant naming a capability that is not in the charter, and a grant with a limit that is not a whole number of units: refused with what is wrong named", () => {
    const launder = offer([], asEvent({ kind: "grant", grant: grantWith({ capabilities: ["launder"] }) }), META).attempt.outcome;
    expect(launder).toEqual({ kind: "rejected", rejection: { kind: "unknown-capability", capability: "launder" } });
    for (const limit of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "100"]) {
      const outcome = offer([], asEvent({ kind: "grant", grant: grantWith({ limit }) }), META).attempt.outcome;
      expect(outcome, String(limit)).toEqual({ kind: "rejected", rejection: { kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] } });
    }
  });

  it("an id that is not a string, is empty, or is longer than MAX_ID_LENGTH: refused naming `id`", () => {
    for (const id of [1, "", "x".repeat(129), null]) {
      const outcome = offer([], asEvent({ kind: "grant", grant: grantWith({ id }) }), META).attempt.outcome;
      expect(outcome, String(id).slice(0, 8)).toEqual({ kind: "rejected", rejection: { kind: "invalid-event-shape", eventKind: "grant", fields: ["id"] } });
    }
  });
});

describe("the domain's own constants are what it hands the engine, and the engine reads them as copies", () => {
  it("offering a grant that holds the frozen CAPABILITIES list does not freeze, share or change it, and logs a copy of it", () => {
    const hand = { kind: "grant", grant: grantWith({ capabilities: CAPABILITIES }) };
    const offered = offer([], asEvent(hand), META);
    const outcome = offered.attempt.outcome;
    expect(outcome.kind).toBe("admitted");
    if (outcome.kind !== "admitted" || outcome.event.kind !== "grant") return;
    expect(outcome.event.grant.capabilities).toEqual([...CAPABILITIES]);
    expect(outcome.event.grant.capabilities).not.toBe(CAPABILITIES);
    expect([...CAPABILITIES]).toEqual(["purchase", "refund", "hire", "sign-contract"]);
  });

  it("the charter every offer is judged against is the company's own: a grant by a principal that is not CHARTER's root is refused as not-a-root", () => {
    expect(CHARTER.roots).toEqual([ROOT]);
    const outcome = offer([], asEvent({ kind: "grant", grant: grantWith({ grantor: AGENTS[0] }) }), META).attempt.outcome;
    expect(outcome).toEqual({ kind: "rejected", rejection: { kind: "not-a-root", grantor: principalId("cfo") } });
  });
});
