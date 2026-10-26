import { describe, expect, it } from "vitest";
import { absorbedBy, headroomOf, usedOf } from "../../allowance/index.js";
import { liveByData, subtreeOwnByData } from "../../allowance/__tests__/fixtures.js";
import { chainOf } from "../../chain/index.js";
import type { EventInput, GrantId, Log, Rejection } from "../../contracts/index.js";
import { append } from "../index.js";
import {
  CHARTER,
  CHARTER2,
  DEEP_LENGTH,
  ORG,
  chunked,
  commit,
  commitEvent,
  deepChainEvents,
  deepGrantor,
  deepHolder,
  g,
  grantsOf,
  logOf,
  mustAppend,
  mustFold,
  p,
  profileOf,
  report,
  revokeEvent,
  revokeSeqs,
  runWorld,
  SEEDS,
  COVERAGE_TIMEOUT_MS,
  SEED_LOOP_TIMEOUT_MS,
  STEPS,
  CHUNKS,
} from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * REVOKE ADMISSION: `unknown-grant`, `already-dead`, `revoker-not-authorised` (plan §4.3, §6 M5 "Falsifiable check" (2)).
 *
 * The plan says `revoker-not-authorised` has no WHOLE-SYSTEM property that catches its removal on its throwaway model, so a
 * table is what guards it here, and this file is that table. It is built the way M3's structure table is:
 *
 *   1. ONE ROW PER REJECTION, MASKING-AWARE: a `violating` scenario that must be refused with exactly that rejection and a
 *      `repaired` one, differing by the one thing that fixes it, that must be admitted. A row that passes shows its
 *      fixture breaks only its own rule.
 *   2. WHAT HIDES WHAT: `unknown-grant` before `already-dead` before `revoker-not-authorised`, each shown to hide the next
 *      and the next to appear once the first is repaired.
 *   3. WHO MAY REVOKE, AT EVERY DEPTH: on the longest chain (8 grants) every principal on the trail (`dana` and the
 *      8 holders) and two outsiders, the other charter root and a stranger, try to revoke every link: 8 x 11 = 88 attempts,
 *      each admitted exactly when the revoker granted a link at or above the target.
 *   4. A PROPERTY over generated logs (1 500 seeds x 100 events): every revoke the generator offered is decided as an
 *      independent reading of the log says, and every admitted revoke returns EXACTLY what was unspent. That second one is
 *      what a deleted `already-dead` breaks.
 */

const revoked = (log: Log<Cap>, id: string): number | undefined => mustFold(CHARTER, log).tree.revokedAt.get(g(id));

describe("one row per rejection: the violating scenario is refused as exactly that, the repaired one is admitted", () => {
  interface Row {
    readonly name: string;
    readonly charter?: typeof CHARTER;
    readonly violating: { readonly after: readonly EventInput<Cap>[]; readonly revoke: { readonly id: string; readonly by: string } };
    readonly expected: Rejection;
    readonly repaired: { readonly after: readonly EventInput<Cap>[]; readonly revoke: { readonly id: string; readonly by: string } };
  }

  const rows: readonly Row[] = [
    {
      name: "unknown-grant: there is no such grant",
      violating: { after: [], revoke: { id: "g-ghost", by: "cfo" } },
      expected: { kind: "unknown-grant", grantId: g("g-ghost") },
      repaired: { after: [], revoke: { id: "G2", by: "cfo" } },
    },
    {
      name: "already-dead: the same grant revoked a second time (by the same revoker)",
      violating: { after: [revokeEvent("G2", "cfo")], revoke: { id: "G2", by: "cfo" } },
      expected: { kind: "already-dead", grantId: g("G2") },
      repaired: { after: [], revoke: { id: "G2", by: "cfo" } },
    },
    {
      name: "already-dead: a grant that is dead only because its PARENT was revoked",
      violating: { after: [revokeEvent("G2", "cfo")], revoke: { id: "G3", by: "ops" } },
      expected: { kind: "already-dead", grantId: g("G3") },
      repaired: { after: [], revoke: { id: "G3", by: "ops" } },
    },
    {
      name: "already-dead: a grant that is dead because its GRANDPARENT, the root grant, was revoked",
      violating: { after: [revokeEvent("G1", "dana")], revoke: { id: "G3", by: "ops" } },
      expected: { kind: "already-dead", grantId: g("G3") },
      repaired: { after: [], revoke: { id: "G3", by: "ops" } },
    },
    {
      name: "already-dead: a grant revoked at its own level and then asked to be revoked by a different authorised principal",
      violating: { after: [revokeEvent("G3", "ops")], revoke: { id: "G3", by: "dana" } },
      expected: { kind: "already-dead", grantId: g("G3") },
      repaired: { after: [], revoke: { id: "G3", by: "dana" } },
    },
    {
      name: "revoker-not-authorised: the holder of a sibling grant (plan section 7: buyer-a revokes G5)",
      violating: { after: [], revoke: { id: "G3", by: "other" } },
      expected: { kind: "revoker-not-authorised", grantId: g("G3"), by: p("other") },
      repaired: { after: [], revoke: { id: "G3", by: "ops" } },
    },
    {
      name: "revoker-not-authorised: the holder of a grant may not revoke it",
      violating: { after: [], revoke: { id: "G3", by: "buyer" } },
      expected: { kind: "revoker-not-authorised", grantId: g("G3"), by: p("buyer") },
      repaired: { after: [], revoke: { id: "G3", by: "ops" } },
    },
    {
      name: "revoker-not-authorised: a principal BELOW the grant may not revoke it",
      violating: { after: [], revoke: { id: "G2", by: "buyer" } },
      expected: { kind: "revoker-not-authorised", grantId: g("G2"), by: p("buyer") },
      repaired: { after: [], revoke: { id: "G2", by: "cfo" } },
    },
    {
      name: "revoker-not-authorised: the root grant's holder may not revoke it, only its grantor, the charter root",
      violating: { after: [], revoke: { id: "G1", by: "cfo" } },
      expected: { kind: "revoker-not-authorised", grantId: g("G1"), by: p("cfo") },
      repaired: { after: [], revoke: { id: "G1", by: "dana" } },
    },
    {
      name: "revoker-not-authorised: a name that is on no chain at all",
      violating: { after: [], revoke: { id: "G2", by: "mallory" } },
      expected: { kind: "revoker-not-authorised", grantId: g("G2"), by: p("mallory") },
      repaired: { after: [], revoke: { id: "G2", by: "cfo" } },
    },
    {
      name: "revoker-not-authorised: a charter root that is NOT on this chain (erin, in a two-root charter)",
      charter: CHARTER2,
      violating: { after: [], revoke: { id: "G2", by: "erin" } },
      expected: { kind: "revoker-not-authorised", grantId: g("G2"), by: p("erin") },
      repaired: { after: [], revoke: { id: "G2", by: "dana" } },
    },
  ];

  it.each(rows.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    const charter = row.charter ?? CHARTER;
    const violating = append(charter, logOf(charter, [...ORG, ...row.violating.after]), revokeEvent(row.violating.revoke.id, row.violating.revoke.by));
    expect(violating.ok).toBe(false);
    if (!violating.ok) expect(violating.failure).toStrictEqual({ kind: "rejected", rejection: row.expected });

    const repaired = append(charter, logOf(charter, [...ORG, ...row.repaired.after]), revokeEvent(row.repaired.revoke.id, row.repaired.revoke.by));
    expect(repaired.ok).toBe(true);
  });

  it("an authorised revoke is admitted at every level above the target, including the charter root over a deep grant", () => {
    for (const by of ["dana", "cfo", "ops"]) {
      const log = mustAppend(CHARTER, logOf(CHARTER, ORG), revokeEvent("G3", by)).log;
      expect(revoked(log, "G3"), `${by} revokes G3`).toBe(ORG.length + 1);
    }
  });

  it("a rejected revoke leaves nothing behind: the next admitted event takes the next seq with no gap", () => {
    const base = logOf(CHARTER, ORG);
    const refused = append(CHARTER, base, revokeEvent("G3", "other"));
    expect(refused.ok).toBe(false);
    const next = mustAppend(CHARTER, base, revokeEvent("G3", "ops"));
    expect(next.event.seq).toBe(ORG.length + 1);
    expect(next.log).toHaveLength(ORG.length + 1);
  });

  it("an admitted revoke is recorded once, at its own seq, and a revoke consumes a seq like any event", () => {
    const log = mustAppend(CHARTER, mustAppend(CHARTER, logOf(CHARTER, ORG), commitEvent(commit("c", "buyer", "G3", "purchase", 5))).log, revokeEvent("G2", "cfo")).log;
    expect(log.map((event) => event.seq)).toStrictEqual([1, 2, 3, 4, 5, 6]);
    expect(revoked(log, "G2")).toBe(6);
    expect(revoked(log, "G3")).toBeUndefined();
  });
});

describe("what hides what: unknown-grant, then already-dead, then revoker-not-authorised", () => {
  const dead = (): Log<Cap> => logOf(CHARTER, [...ORG, revokeEvent("G2", "cfo")]);
  const reasonOf = (log: Log<Cap>, id: string, by: string): string => {
    const result = append(CHARTER, log, revokeEvent(id, by));
    if (result.ok) return "admitted";
    if (result.failure.kind !== "rejected") return `faulty-log ${result.failure.fault.kind}`;
    return result.failure.rejection.kind;
  };

  it("a grant that does not exist is unknown-grant whoever asks, and the revoker is never looked at", () => {
    expect(reasonOf(logOf(CHARTER, ORG), "g-ghost", "mallory")).toBe("unknown-grant");
    expect(reasonOf(logOf(CHARTER, ORG), "g-ghost", "cfo")).toBe("unknown-grant");
  });

  it("a dead grant is already-dead before the revoker is looked at, and the revoker rule appears once the grant is live", () => {
    expect(reasonOf(dead(), "G3", "mallory")).toBe("already-dead");
    expect(reasonOf(dead(), "G2", "mallory")).toBe("already-dead");
    expect(reasonOf(logOf(CHARTER, ORG), "G3", "mallory")).toBe("revoker-not-authorised");
  });

  it("the three, peeled in order: unknown-grant, already-dead, revoker-not-authorised, admitted", () => {
    const steps: [Log<Cap>, string, string][] = [
      [dead(), "g-ghost", "mallory"],
      [dead(), "G3", "mallory"],
      [logOf(CHARTER, ORG), "G3", "mallory"],
      [logOf(CHARTER, ORG), "G3", "ops"],
    ];
    expect(steps.map(([log, id, by]) => reasonOf(log, id, by))).toStrictEqual(["unknown-grant", "already-dead", "revoker-not-authorised", "admitted"]);
  });

  it("a commit's id and a grant's id are different namespaces: revoking a commit's id is unknown-grant", () => {
    const log = logOf(CHARTER, [...ORG, commitEvent(commit("c-as-grant", "buyer", "G3", "purchase", 1))]);
    expect(reasonOf(log, "c-as-grant", "ops")).toBe("unknown-grant");
  });
});

describe("who may revoke, at every depth of the longest chain", () => {
  const CHAIN = deepChainEvents();
  const base = logOf(CHARTER2, CHAIN);
  // `dana` (the charter root and the root grant's grantor), the 8 holders, the other charter root and a stranger: 11 principals.
  // The trail is dana d0 ... d7 (9 principals); `erin` and `stranger` are outsiders.
  const principals = ["dana", ...Array.from({ length: DEEP_LENGTH }, (_, index) => deepHolder(index)), "erin", "stranger"];

  it("there are 8 targets and 11 principals, and the table has 88 attempts", () => {
    expect(principals).toHaveLength(DEEP_LENGTH + 3);
    expect(base).toHaveLength(DEEP_LENGTH);
  });

  it("revoking link j is admitted exactly for the grantors of links 0 to j: dana and d0 ... d(j-1); never the holder dj, anyone below, or an outsider", () => {
    let admitted = 0;
    let refused = 0;
    for (let target = 0; target < DEEP_LENGTH; target++) {
      const authorised = new Set([deepGrantor(0), ...Array.from({ length: target }, (_, index) => deepHolder(index))]);
      for (const by of principals) {
        const result = append(CHARTER2, base, revokeEvent(`D${target}`, by));
        if (authorised.has(by)) {
          expect(result.ok, `${by} revokes D${target}`).toBe(true);
          admitted += 1;
        } else {
          expect(result.ok, `${by} revokes D${target}`).toBe(false);
          if (!result.ok) {
            expect(result.failure, `${by} revokes D${target}`).toStrictEqual({ kind: "rejected", rejection: { kind: "revoker-not-authorised", grantId: g(`D${target}`), by: p(by) } });
          }
          refused += 1;
        }
      }
    }
    // Link j has j + 1 authorised revokers (dana and the j holders above it): 1 + 2 + ... + 8 = 36 of the 88 attempts.
    expect([admitted, refused]).toStrictEqual([36, 52]);
  });

  it("the leaf's own holder, who has the grant, and the holder of the link above it, who granted it, are told apart", () => {
    const leaf = `D${DEEP_LENGTH - 1}`;
    expect(append(CHARTER2, base, revokeEvent(leaf, deepHolder(DEEP_LENGTH - 1))).ok).toBe(false);
    expect(append(CHARTER2, base, revokeEvent(leaf, deepHolder(DEEP_LENGTH - 2))).ok).toBe(true);
  });

  it("with the middle link already cut, every link below it is already-dead for every revoker, and the links above it are still revocable", () => {
    const cut = mustAppend(CHARTER2, base, revokeEvent("D3", "d2")).log;
    for (let target = 3; target < DEEP_LENGTH; target++) {
      for (const by of principals) {
        const result = append(CHARTER2, cut, revokeEvent(`D${target}`, by));
        expect(result.ok, `${by} revokes D${target}`).toBe(false);
        if (!result.ok) expect(result.failure, `${by} revokes D${target}`).toStrictEqual({ kind: "rejected", rejection: { kind: "already-dead", grantId: g(`D${target}`) } });
      }
    }
    for (let target = 0; target < 3; target++) {
      expect(append(CHARTER2, cut, revokeEvent(`D${target}`, deepGrantor(target))).ok, `D${target}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// The property over generated logs
// ---------------------------------------------------------------------------------------------------


/** How an independent reading of the log (events only; none of M3's or M4's functions) says a revoke should be decided. */
function oracleRevoke(prefix: Log<Cap>, grantId: GrantId, by: string): "unknown-grant" | "already-dead-self" | "already-dead-ancestor" | "revoker-not-authorised" | "admitted" {
  const grants = grantsOf(prefix);
  const cuts = revokeSeqs(prefix);
  const target = grants.get(grantId);
  if (target === undefined) return "unknown-grant";

  const grantors: string[] = [];
  let deadSelf = false;
  let deadAbove = false;
  for (let current = target, hops = 0; hops < 64; hops++) {
    if (cuts.has(current.id)) {
      if (current.id === grantId) deadSelf = true;
      else deadAbove = true;
    }
    grantors.push(current.grantor);
    if (current.parent === null) break;
    const parent = grants.get(current.parent);
    if (parent === undefined) throw new Error("oracle: a grant's parent is not in the log");
    current = parent;
  }
  if (deadSelf) return "already-dead-self";
  if (deadAbove) return "already-dead-ancestor";
  return grantors.includes(by) ? "admitted" : "revoker-not-authorised";
}

interface Scan {
  readonly disagreements: string[];
  readonly exactReturnFailures: string[];
  readonly counts: {
    readonly byOracle: Record<string, number>;
    readonly admittedRevokes: number;
    readonly exactReturnChecked: number;
    readonly exactReturnNonzero: number;
    readonly revokeByChainLength: Record<number, number>;
    readonly deadTargetsAdmitted: number;
  };
}

const scans = chunked(SEEDS, CHUNKS, (first, last): Scan => {
  const disagreements: string[] = [];
  const exactReturnFailures: string[] = [];
  const byOracle: Record<string, number> = {};
  const revokeByChainLength: Record<number, number> = {};
  let admittedRevokes = 0;
  let exactReturnChecked = 0;
  let exactReturnNonzero = 0;

  for (let seed = first; seed <= last; seed++) {
    const world = runWorld({ seed, steps: STEPS, profile: profileOf(seed) });

    // (1) Every revoke the generator offered, admitted or refused, against an independent reading of the log it was offered to.
    for (const attempt of world.attempts) {
      const input = attempt.input as { kind?: unknown; grantId?: unknown; by?: unknown };
      if (input.kind !== "revoke" || typeof input.grantId !== "string" || typeof input.by !== "string") continue;
      if (!attempt.outcome.ok && attempt.outcome.failure.kind === "rejected" && attempt.outcome.failure.rejection.kind === "invalid-event-shape") continue;
      const prefix = world.log.slice(0, attempt.logLength);
      const expected = oracleRevoke(prefix, g(input.grantId), input.by);
      byOracle[expected] = (byOracle[expected] ?? 0) + 1;
      const actual = attempt.outcome.ok
        ? "admitted"
        : attempt.outcome.failure.kind === "rejected"
          ? attempt.outcome.failure.rejection.kind
          : "faulty-log";
      const expectedKind = expected === "already-dead-self" || expected === "already-dead-ancestor" ? "already-dead" : expected;
      if (actual !== expectedKind) disagreements.push(`seed ${seed} step ${attempt.step}: oracle says ${expected}, engine says ${actual}`);
    }

    // (2) Every admitted revoke returns exactly what was unspent, and changes nobody else's usage.
    for (const event of world.log) {
      if (event.kind !== "revoke") continue;
      admittedRevokes += 1;
      const before = mustFold(world.charter, world.log.slice(0, event.seq - 1));
      const after = mustFold(world.charter, world.log.slice(0, event.seq));
      const length = chainOf(after.tree, event.grantId)?.length ?? 0;
      revokeByChainLength[length] = (revokeByChainLength[length] ?? 0) + 1;

      const target = before.tree.grants.get(event.grantId);
      if (target === undefined) {
        exactReturnFailures.push(`seed ${seed} seq ${event.seq}: the revoked grant is not in the tree before`);
        continue;
      }
      const spent = subtreeOwnByData({ tree: before.tree, charges: before.charges }, event.grantId);
      if (absorbedBy(after.tree, after.charges, event.grantId) !== spent) {
        exactReturnFailures.push(`seed ${seed} seq ${event.seq}: absorbedBy is not subtreeOwn`);
      }
      // A revoke adds no charge, so `before` and `after` share their charges.
      if (after.charges.length !== before.charges.length) exactReturnFailures.push(`seed ${seed} seq ${event.seq}: a revoke changed the charges`);

      const parentId = target.parent;
      if (parentId !== null && liveByData({ tree: before.tree, charges: before.charges }, parentId)) {
        exactReturnChecked += 1;
        const returned = target.limit - spent;
        if (returned > 0) exactReturnNonzero += 1;
        const headroomBefore = headroomOf(before.tree, before.charges, parentId);
        const headroomAfter = headroomOf(after.tree, after.charges, parentId);
        if (headroomBefore === undefined || headroomAfter === undefined || headroomAfter - headroomBefore !== returned) {
          exactReturnFailures.push(`seed ${seed} seq ${event.seq}: parent headroom ${headroomBefore} -> ${headroomAfter}, expected +${returned}`);
        }
        // No grant's `used` changes except the parent's, and the parent's changes by exactly what was returned.
        for (const id of before.tree.grants.keys()) {
          const usedBefore = usedOf(before.tree, before.charges, id);
          const usedAfter = usedOf(after.tree, after.charges, id);
          const expectedChange = id === parentId ? -returned : 0;
          if (usedBefore === undefined || usedAfter === undefined || usedAfter - usedBefore !== expectedChange) {
            exactReturnFailures.push(`seed ${seed} seq ${event.seq}: used of ${id} changed by ${usedBefore === undefined || usedAfter === undefined ? "?" : usedAfter - usedBefore}, expected ${expectedChange}`);
            break;
          }
        }
      }
    }
  }
  return {
    disagreements,
    exactReturnFailures,
    counts: { byOracle, admittedRevokes, exactReturnChecked, exactReturnNonzero, revokeByChainLength, deadTargetsAdmitted: 0 },
  };
});

describe(`revoke admission over ${SEEDS} generated logs of ${STEPS} events`, () => {
  for (let index = 0; index < CHUNKS; index++) {
    const [first, last] = scans.range(index);
    it(
      `seeds ${first} to ${last}: every revoke offered is decided as an independent reading of the log says`,
      () => {
        expect(scans.get(index).disagreements).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
    it(
      `seeds ${first} to ${last}: every admitted revoke returns exactly limit - spent to a live parent and moves no other grant's usage`,
      () => {
        expect(scans.get(index).exactReturnFailures).toStrictEqual([]);
      },
      SEED_LOOP_TIMEOUT_MS,
    );
  }

  it(
    "coverage: the property was not run over an empty domain",
    () => {
      const total: Record<string, number> = {};
      const byLength: Record<number, number> = {};
      let admittedRevokes = 0;
      let checked = 0;
      let nonzero = 0;
      for (let index = 0; index < CHUNKS; index++) {
        const counts = scans.get(index).counts;
        for (const [key, value] of Object.entries(counts.byOracle)) total[key] = (total[key] ?? 0) + value;
        for (const [key, value] of Object.entries(counts.revokeByChainLength)) byLength[Number(key)] = (byLength[Number(key)] ?? 0) + value;
        admittedRevokes += counts.admittedRevokes;
        checked += counts.exactReturnChecked;
        nonzero += counts.exactReturnNonzero;
      }
      report("revoke-admission", { total, byLength, admittedRevokes, checked, nonzero });
      // Each class of decision was seen many times.
      for (const kind of ["unknown-grant", "already-dead-self", "already-dead-ancestor", "revoker-not-authorised", "admitted"]) {
        expect(total[kind] ?? 0, kind).toBeGreaterThanOrEqual(100);
      }
      // Revokes were applied at EVERY chain length, down to the longest the chain bound allows.
      for (let length = 1; length <= DEEP_LENGTH; length++) expect(byLength[length] ?? 0, `revokes at chain length ${length}`).toBeGreaterThanOrEqual(50);
      expect(admittedRevokes).toBeGreaterThanOrEqual(1000);
      // The exact-return equality was evaluated, and for a good part of them there was something to return.
      expect(checked).toBeGreaterThanOrEqual(800);
      expect(nonzero).toBeGreaterThanOrEqual(400);
    },
    COVERAGE_TIMEOUT_MS,
  );
});
