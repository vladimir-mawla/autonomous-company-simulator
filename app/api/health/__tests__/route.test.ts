import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertStandingWellFormed } from "../../../../lib/contracts/index.js";
import * as route from "../route";

/**
 * `GET` is called directly (no server). The guard the route imports is replaced by a spy that
 * forwards to the REAL `assertStandingWellFormed` by default, so the first test exercises the real
 * contracts and every other test changes only what the guard says, never the route.
 */
vi.mock("../../../../lib/contracts/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/contracts/index.js")>();
  return { ...actual, assertStandingWellFormed: vi.fn(actual.assertStandingWellFormed) };
});

const guard = vi.mocked(assertStandingWellFormed);
let realGuard: typeof assertStandingWellFormed;

interface Report {
  readonly status: string;
  readonly commit: string;
  readonly checks: {
    readonly contracts: {
      readonly pass: boolean;
      readonly detail: string;
      readonly assertions: readonly { readonly name: string; readonly expected: string; readonly actual: string; readonly pass: boolean }[];
    };
  };
}

async function call(): Promise<{ readonly status: number; readonly body: Report }> {
  const response = route.GET();
  return { status: response.status, body: (await response.json()) as Report };
}

beforeEach(async () => {
  realGuard = (await vi.importActual<typeof import("../../../../lib/contracts/index.js")>("../../../../lib/contracts/index.js"))
    .assertStandingWellFormed;
  guard.mockReset();
  guard.mockImplementation(realGuard);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health: the real checks", () => {
  it("answers 200 with status ok and all three self-checks passing", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.contracts.pass).toBe(true);
    expect(body.checks.contracts.assertions.map((a) => [a.expected, a.actual, a.pass])).toEqual([
      ["ok", "ok", true],
      ["unexpected-field/void/warrant", "unexpected-field/void/warrant", true],
      ["missing-field/inherited/heir", "missing-field/inherited/heir", true],
    ]);
  });

  it("really calls the guard, once per self-check, with the three standings the plan names", async () => {
    await call();
    expect(guard).toHaveBeenCalledTimes(3);
    const calls = guard.mock.calls.map(([standing]) => ({
      kind: standing.kind,
      hasWarrant: "warrant" in standing,
      hasHeir: "heir" in standing,
    }));
    expect(calls).toEqual([
      { kind: "inherited", hasWarrant: true, hasHeir: true },
      { kind: "void", hasWarrant: true, hasHeir: false },
      { kind: "inherited", hasWarrant: true, hasHeir: false },
    ]);
  });

  it("runs the checks on every request, not once at import time", async () => {
    await call();
    await call();
    expect(guard).toHaveBeenCalledTimes(6);
  });

  it("exports dynamic = force-dynamic, so Next does not prerender one response at build time", () => {
    expect(route.dynamic).toBe("force-dynamic");
  });
});

describe("GET /api/health: any failed check is 503 degraded, never a 200", () => {
  it("is 503 when the guard rejects the well-formed standing", async () => {
    guard.mockImplementation((standing) =>
      standing.kind === "inherited" && "heir" in standing
        ? { ok: false, error: { kind: "missing-field", variant: "inherited", field: "heir" } }
        : realGuard(standing),
    );
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.contracts.pass).toBe(false);
    expect(body.checks.contracts.assertions.map((a) => a.pass)).toEqual([false, true, true]);
  });

  it("is 503 when the guard stops catching a void carrying a warrant (the guard says ok to everything)", async () => {
    guard.mockReturnValue({ ok: true });
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.contracts.assertions.map((a) => a.pass)).toEqual([true, false, false]);
  });

  it("is 503 when the guard stops catching an inherited with no heir, and only that one fails", async () => {
    // What dropping the `heir` branch of the real guard looks like from the route: the standing
    // that lacks a heir is passed as if it were fine, everything else is judged by the real guard.
    guard.mockImplementation((standing) =>
      standing.kind === "inherited" && !("heir" in standing) ? { ok: true } : realGuard(standing),
    );
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.contracts.assertions.map((a) => [a.name, a.pass])).toEqual([
      ["well-formed inherited standing is accepted", true],
      ["void standing carrying a warrant is caught", true],
      ["inherited standing missing its heir is caught", false],
    ]);
    expect(body.checks.contracts.assertions[2]).toMatchObject({ expected: "missing-field/inherited/heir", actual: "ok" });
  });

  it("is 503 when the guard names the wrong field, not only when it says ok", async () => {
    guard.mockImplementation((standing) =>
      standing.kind === "void" ? { ok: false, error: { kind: "unexpected-field", variant: "void", field: "heir" } } : realGuard(standing),
    );
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.checks.contracts.assertions[1]).toMatchObject({
      expected: "unexpected-field/void/warrant",
      actual: "unexpected-field/void/heir",
      pass: false,
    });
  });

  it("is 503, not an uncaught 500, when the guard throws, and says it threw", async () => {
    guard.mockImplementation(() => {
      throw new Error("guard exploded");
    });
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.contracts.assertions.map((a) => a.actual)).toEqual([
      "threw: guard exploded",
      "threw: guard exploded",
      "threw: guard exploded",
    ]);
  });
});

describe("GET /api/health: the commit is reported, never guessed", () => {
  it("reports VERCEL_GIT_COMMIT_SHA exactly as the environment gives it", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sha);
    const { body } = await call();
    expect(body.commit).toBe(sha);
  });

  it("falls back to the literal 'unknown (local dev)' when the variable is unset", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    expect(process.env["VERCEL_GIT_COMMIT_SHA"]).toBeUndefined();
    const { body } = await call();
    expect(body.commit).toBe("unknown (local dev)");
  });

  it("reports the commit on a degraded response too", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "deadbeef");
    guard.mockReturnValue({ ok: true });
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.commit).toBe("deadbeef");
  });
});
