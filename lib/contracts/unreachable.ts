/**
 * Shared body of the four `assertNever*` functions (`assertNeverStanding`,
 * `assertNeverBreach`, `assertNeverRejection`, `assertNeverFoldFault`).
 *
 * NOT NAMED IN THE PLAN'S M1 FILE LIST (`.genesis/PLAN.md` §6, M1), which names one file per
 * type and no home for a helper the four share. It is added here rather than copied four times;
 * it lives under `lib/contracts/**`, which M1 owns, and it is not exported from `index.ts`.
 *
 * WHAT THE `assertNever*` FUNCTIONS ARE FOR. Called in the `default` of a `switch` over a closed
 * union, `assertNeverX(value)` compiles only while every variant has been handled, because
 * `value` is then `never`. Adding a variant to the union makes every such call site fail to
 * COMPILE (`npm run typecheck` reports it; `npm test` strips types and does not). At run time the
 * call is unreachable unless a value arrived that the type does not describe (a cast, `any`,
 * parsed JSON), and then it throws rather than silently falling through.
 */
export function unreachable(union: string, value: never): never {
  throw new Error(`unreachable ${union} variant: ${describe(value)}`);
}

function describe(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? typeof value : json;
  } catch {
    return "[a value JSON.stringify cannot print]";
  }
}
