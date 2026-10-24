import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT,
  MAX_ID_LENGTH,
  MAX_LOG_EVENTS,
  MAX_ROOT_DEPTH,
  type Amount,
  type Seq,
} from "../limits.js";

describe("the four invented bounds keep the values the plan names", () => {
  // They are invented (see limits.ts), so these pins do not say the numbers are RIGHT; they make
  // changing one a deliberate edit that has to touch this file, because M3's boundary tests (N / N+1)
  // and M5's log-length check are specified against these values.
  it("MAX_AMOUNT is 2 ** 40, MAX_ROOT_DEPTH 7, MAX_LOG_EVENTS 5000, MAX_ID_LENGTH 128", () => {
    expect(MAX_AMOUNT).toBe(1_099_511_627_776);
    expect(MAX_AMOUNT).toBe(2 ** 40);
    expect(MAX_ROOT_DEPTH).toBe(7);
    expect(MAX_LOG_EVENTS).toBe(5000);
    expect(MAX_ID_LENGTH).toBe(128);
  });

  it("each bound is a positive safe integer", () => {
    for (const bound of [MAX_AMOUNT, MAX_ROOT_DEPTH, MAX_LOG_EVENTS, MAX_ID_LENGTH]) {
      expect(Number.isSafeInteger(bound)).toBe(true);
      expect(bound).toBeGreaterThan(0);
    }
  });

  it("two maximum amounts add exactly and stay safe integers (the single-step bound plan §8 C relies on)", () => {
    // This is ONLY the one-addition bound. Whether `used` can ever exceed a limit is M4/M5's
    // conservation property, which does not exist yet, and nothing here proves it.
    expect(Number.isSafeInteger(MAX_AMOUNT + MAX_AMOUNT)).toBe(true);
    expect(MAX_AMOUNT + MAX_AMOUNT).toBe(2 ** 41);
    expect(MAX_AMOUNT + MAX_AMOUNT).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("HONEST LIMIT: Amount and Seq are bare numbers, so the type refuses nothing about their range", () => {
  it("Amount admits -1, a fraction, NaN, Infinity and a value above MAX_AMOUNT at the type level", () => {
    // Each line compiles today. If `Amount` is ever tightened (a brand, a smart constructor), these
    // stop compiling and `npm run typecheck` goes red here: that is the pin. The plan assigns the
    // range check to M3's intake, which does not exist yet.
    const negative: Amount = -1;
    const fraction: Amount = 1.5;
    const notANumber: Amount = Number.NaN;
    const unbounded: Amount = Number.POSITIVE_INFINITY;
    const aboveMax: Amount = MAX_AMOUNT + 1;
    expect([negative, fraction, notANumber, unbounded, aboveMax].length).toBe(5);
    expect(Number.isSafeInteger(negative) && negative >= 0).toBe(false);
  });

  it("Seq admits 0 and a negative number at the type level, although the plan says it is 1-based", () => {
    const zero: Seq = 0;
    const negative: Seq = -3;
    expect([zero, negative]).toEqual([0, -3]);
  });
});
