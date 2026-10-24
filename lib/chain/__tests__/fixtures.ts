import { grantId, principalId } from "../../contracts/index.js";
import type { Charter, Grant, GrantId, GrantTree, PrincipalId, Seq } from "../../contracts/index.js";

/**
 * Shared test data for `lib/chain`. This file is not a test (vitest includes only `*.test.ts`).
 *
 * The vocabulary and the charter are plan §7's: one human root `dana`, four capabilities.
 */
export const CAPABILITIES = ["purchase", "refund", "hire", "sign-contract"] as const;
export type Cap = (typeof CAPABILITIES)[number];

export const CHARTER: Charter<Cap> = {
  roots: [principalId("dana")],
  capabilities: CAPABILITIES,
};

/** A plain object that is a well-formed grant payload, as it would arrive untyped. `overrides` replaces fields. */
export function rawGrant(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "G1",
    parent: null,
    grantor: "dana",
    grantee: "cfo",
    capabilities: ["purchase", "refund"],
    limit: 1000,
    depth: 3,
    ...overrides,
  };
}

export function rawGrantEvent(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { kind: "grant", grant: rawGrant(overrides) };
}

export function rawCommit(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { id: "c1", actor: "buyer-a", actedUnder: "G4", capability: "purchase", amount: 50, ...overrides };
}

export function rawCommitEvent(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { kind: "commit", commit: rawCommit(overrides) };
}

export function rawRevokeEvent(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { kind: "revoke", grantId: "G2", by: "cfo", ...overrides };
}

/** A copy of `record` without `key`: an ABSENT field, which `{ ...record, key: undefined }` is not. */
export function without(record: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...record };
  delete copy[key];
  return copy;
}

// ---------------------------------------------------------------------------------------------------
// Typed grants and hand-built trees
// ---------------------------------------------------------------------------------------------------

export const p = (name: string): PrincipalId => principalId(name);
export const g = (name: string): GrantId => grantId(name);

export interface GrantSpec {
  readonly id: string;
  readonly parent?: string | null;
  readonly grantor: string;
  readonly grantee: string;
  readonly capabilities?: readonly [Cap, ...Cap[]];
  readonly limit?: number;
  readonly depth?: number;
}

/** A typed grant. `parent` defaults to `null` (a root grant), `capabilities` to `["purchase"]`, `limit` to 0, `depth` to 0. */
export function grant(spec: GrantSpec): Grant<Cap> {
  return {
    id: g(spec.id),
    parent: spec.parent === undefined || spec.parent === null ? null : g(spec.parent),
    grantor: p(spec.grantor),
    grantee: p(spec.grantee),
    capabilities: spec.capabilities ?? ["purchase"],
    limit: spec.limit ?? 0,
    depth: spec.depth ?? 0,
  };
}

/** A tree built by hand from `grants` (in any order, with any parent pointers, as the hostile tests need) and a map of revocations. */
export function treeOf(grants: readonly Grant<Cap>[], revoked: Readonly<Record<string, Seq>> = {}): GrantTree<Cap> {
  return {
    grants: new Map(grants.map((entry) => [entry.id, entry])),
    revokedAt: new Map(Object.entries(revoked).map(([id, seq]) => [g(id), seq])),
  };
}

/**
 * Plan section 7's grants G1 to G7. G7 is the cure admitted at seq 17, after G2 was revoked at seq 11, so it is
 * kept apart: `canonBefore()` is G1 to G6, which is the tree at seq 6 and still at seq 10.
 *
 *   G1  dana -> cfo       all four capabilities    limit 1 000 000  depth 4  (root)
 *   G2  cfo  -> ops       purchase, sign-contract    400 000        depth 3  (under G1)
 *   G3  cfo  -> support   refund                     100 000        depth 2  (under G1)
 *   G4  ops  -> buyer-a   purchase                   120 000        depth 0  (under G2)
 *   G5  ops  -> buyer-b   purchase                   150 000        depth 0  (under G2)
 *   G6  support -> refunder  refund                   40 000        depth 0  (under G3)
 *   G7  cfo  -> buyer-a   purchase                    60 000        depth 0  (under G1)
 */
export const CANON = {
  G1: grant({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase", "refund", "hire", "sign-contract"], limit: 1_000_000, depth: 4 }),
  G2: grant({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase", "sign-contract"], limit: 400_000, depth: 3 }),
  G3: grant({ id: "G3", parent: "G1", grantor: "cfo", grantee: "support", capabilities: ["refund"], limit: 100_000, depth: 2 }),
  G4: grant({ id: "G4", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 120_000, depth: 0 }),
  G5: grant({ id: "G5", parent: "G2", grantor: "ops", grantee: "buyer-b", capabilities: ["purchase"], limit: 150_000, depth: 0 }),
  G6: grant({ id: "G6", parent: "G3", grantor: "support", grantee: "refunder", capabilities: ["refund"], limit: 40_000, depth: 0 }),
  G7: grant({ id: "G7", parent: "G1", grantor: "cfo", grantee: "buyer-a", capabilities: ["purchase"], limit: 60_000, depth: 0 }),
} as const;

const BEFORE = [CANON.G1, CANON.G2, CANON.G3, CANON.G4, CANON.G5, CANON.G6] as const;

/** G1 to G6, nothing revoked: the tree at seq 6, and at seq 10. */
export const canonBefore = (): GrantTree<Cap> => treeOf(BEFORE);
/** G1 to G6 with G2 revoked at seq 11. */
export const canonAfterRevokingG2 = (): GrantTree<Cap> => treeOf(BEFORE, { G2: 11 });

// ---------------------------------------------------------------------------------------------------
// A seeded generator
// ---------------------------------------------------------------------------------------------------

/**
 * mulberry32: a small seeded generator returning floats in [0, 1). Hand-rolled because the plan allows no new
 * dependency. The same seed always gives the same sequence, which is what lets a failing seed be replayed.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
