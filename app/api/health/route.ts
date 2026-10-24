import {
  assertStandingWellFormed,
  commitId,
  grantId,
  principalId,
  type InheritedStanding,
  type Standing,
  type StandingIntegrity,
  type VoidStanding,
} from "../../../lib/contracts/index.js";

/**
 * `force-dynamic`: plan §6 M2 requires it, and it makes the opt-out of static rendering explicit, so a
 * prerendered response (the checks run once, during the build, and `commit` frozen at whatever the build
 * saw) cannot happen. It is not what makes this handler dynamic on Next 16.4.3: with the line removed (and
 * the test's `route.dynamic` assertion neutralised, since `next build` type-checks the tests and otherwise stops
 * with TS2339), a scratch build still lists `/api/health` as `ƒ (Dynamic)` and a started server still read
 * `VERCEL_GIT_COMMIT_SHA` at request time. A health endpoint has to run its checks on every request, so the
 * declaration stays.
 */
export const dynamic = "force-dynamic";

/**
 * Why this is a self-check and not a liveness ping (`.genesis/PLAN.md` M2: the endpoint must
 * refuse "200 on a bare liveness ping"). Each assertion calls the real `assertStandingWellFormed`
 * from `lib/contracts` and compares what it says with what it must say, in BOTH directions: a
 * well-formed standing must be accepted, and two standings that can only exist through an
 * `as unknown as` cast must be caught, by name.
 *
 * Those two casts are the point. `lib/contracts` closes `void`-with-a-`warrant` and
 * `inherited`-without-a-`heir` at compile time, but ADR 0001 records that a cast, an implicit
 * `any` or parsed JSON gets past the types, which is why the run-time guard exists. The types
 * cannot be probed from a running server; the guard can. If someone weakens the guard (drops the
 * `heir` branch, say), the matching assertion flips and the endpoint goes 503 without anyone
 * having to notice in review.
 *
 * Scope is deliberately `lib/contracts` only, the one layer that exists at M2. `lib/chain`,
 * `lib/allowance` and `lib/standing` are not built, so nothing here pretends to exercise them.
 */
interface Assertion {
  readonly name: string;
  /** What the guard must say, as `ok` or `<error.kind>/<variant>/<field>`. */
  readonly expected: string;
  /** The standing to hand the guard, built lazily so that a throw while building is also caught. */
  readonly build: () => Standing;
}

/** The one-line form of a guard result, matching how `Assertion.expected` is written. */
function verdictOf(result: StandingIntegrity): string {
  if (result.ok) return "ok";
  const error = result.error;
  if (error.kind === "unknown-variant") return `unknown-variant/${error.found}`;
  return `${error.kind}/${error.variant}/${error.field}`;
}

const ASSERTIONS: readonly Assertion[] = [
  {
    name: "well-formed inherited standing is accepted",
    expected: "ok",
    build: (): InheritedStanding => ({
      kind: "inherited",
      commitId: commitId("health-c1"),
      committedAt: 7,
      warrant: {
        chain: [grantId("health-g1"), grantId("health-g2")],
        trail: [principalId("health-cfo"), principalId("health-ops")],
      },
      severed: { grantId: grantId("health-g2"), atSeq: 11 },
      heir: principalId("health-cfo"),
      chargedTo: grantId("health-g1"),
    }),
  },
  {
    // `as unknown as`: the type refuses `warrant` on a void standing, so only a cast can build this.
    name: "void standing carrying a warrant is caught",
    expected: "unexpected-field/void/warrant",
    build: () =>
      ({
        kind: "void",
        commitId: commitId("health-c5"),
        committedAt: 12,
        breach: { kind: "link-dead", grantId: grantId("health-g2"), atSeq: 11 },
        warrant: {
          chain: [grantId("health-g1")],
          trail: [principalId("health-cfo")],
        },
      }) as unknown as VoidStanding,
  },
  {
    // `as unknown as`: the type requires `heir` on an inherited standing, so only a cast can omit it.
    name: "inherited standing missing its heir is caught",
    expected: "missing-field/inherited/heir",
    build: () =>
      ({
        kind: "inherited",
        commitId: commitId("health-c1"),
        committedAt: 7,
        warrant: {
          chain: [grantId("health-g1"), grantId("health-g2")],
          trail: [principalId("health-cfo"), principalId("health-ops")],
        },
        severed: { grantId: grantId("health-g2"), atSeq: 11 },
        chargedTo: grantId("health-g1"),
      }) as unknown as InheritedStanding,
  },
];

interface AssertionReport {
  readonly name: string;
  readonly expected: string;
  readonly actual: string;
  readonly pass: boolean;
}

function runAssertion(assertion: Assertion): AssertionReport {
  try {
    const actual = verdictOf(assertStandingWellFormed(assertion.build()));
    return { name: assertion.name, expected: assertion.expected, actual, pass: actual === assertion.expected };
  } catch (error) {
    // The guard (or the code building its input) threw. That is a failed check, reported as one:
    // letting it escape would turn a degraded service into an opaque 500 with no explanation.
    const message = error instanceof Error ? error.message : "unknown error";
    return { name: assertion.name, expected: assertion.expected, actual: `threw: ${message}`, pass: false };
  }
}

export function GET(): Response {
  const assertions = ASSERTIONS.map(runAssertion);
  const pass = assertions.every((a) => a.pass);

  const body = {
    status: pass ? "ok" : "degraded",
    // Vercel sets this on every deployment; it is unset in local dev, where the honest answer is
    // "unknown". The SHA is never guessed, hardcoded or read from `git`: an endpoint whose job is
    // to show which commit is live would defeat itself by inventing one when it does not know.
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown (local dev)",
    checks: {
      contracts: {
        pass,
        detail: pass
          ? "assertStandingWellFormed: a well-formed inherited is accepted; a cast-built void with a warrant and a cast-built inherited without a heir are both caught"
          : `assertStandingWellFormed: ${assertions.filter((a) => !a.pass).length} of ${assertions.length} self-checks failed`,
        assertions,
      },
    },
  };

  // 503, not 200, when any self-check fails: a health endpoint that answers 200 while the one thing
  // it verifies is broken is worse than none, because whatever polls it trusts the status code.
  return Response.json(body, { status: pass ? 200 : 503 });
}
