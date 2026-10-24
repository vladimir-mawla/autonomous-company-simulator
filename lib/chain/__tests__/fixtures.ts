import { principalId } from "../../contracts/index.js";
import type { Charter } from "../../contracts/index.js";

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
