/**
 * The two numeric domains and the four bounds this project invents.
 *
 * `Seq` and `Amount` are bare `number` aliases, and that is a deliberate limit of
 * M1, not an oversight: a TypeScript type cannot say "a non-negative safe integer
 * no larger than `MAX_AMOUNT`". The plan (`.genesis/PLAN.md` §4.1) assigns that
 * check to M3's intake, which is not built; until it is, nothing in this
 * repository stops `-1`, `1.5`, `NaN` or `Infinity` from being an `Amount`
 * (`limits.test.ts` pins that at the type level).
 *
 * THE FOUR BOUNDS ARE INVENTED. Nothing derives them from the domain; each is a
 * number chosen so a bound exists at all, and each can be changed. They are named
 * here so that M3's boundary tests (N and N+1) and M5's log-length check have one
 * place to read them from.
 */

/** 1-based position of an ADMITTED event in the log; a rejected event consumes none (plan §4.1). */
export type Seq = number;

/** Whole currency units. Intended range: a safe integer in `[0, MAX_AMOUNT]`; the type cannot say so. */
export type Amount = number;

/**
 * Largest permitted `limit` or `amount`, `2 ** 40` (invented). The plan's reasoning for the number
 * (§8 C): if every `limit` and `amount` is at most `2 ** 40`, a sum of one used total and one request is at
 * most `2 ** 41`, far below `Number.MAX_SAFE_INTEGER` (`2 ** 53 - 1`). That reasoning assumes the
 * bound is enforced at intake and that `used` never exceeds a limit; M1 enforces neither.
 */
export const MAX_AMOUNT: number = 2 ** 40;

/** Largest `depth` a root grant may declare, so a delegation chain has at most `MAX_ROOT_DEPTH + 1` grants (invented). */
export const MAX_ROOT_DEPTH: number = 7;

/** Largest number of events a log may hold before replay refuses it (invented). */
export const MAX_LOG_EVENTS: number = 5000;

/** Longest permitted id, in UTF-16 code units as `String.prototype.length` counts them (invented). */
export const MAX_ID_LENGTH: number = 128;
