import type { Breach } from "../../breach.js";
import { grantId, principalId } from "../../ids.js";

/**
 * One well-formed value per variant of each closed union, as an object KEYED BY
 * `kind` and typed as a mapped type over the real union. Both directions fail to
 * compile: a new variant leaves a key missing, and a removed or renamed one leaves
 * an unknown key. That is a compile-time guard, so `npm run typecheck` reports it
 * and `npm test` does not.
 */
export const BREACH_SAMPLES: { [K in Breach["kind"]]: Extract<Breach, { kind: K }> } = {
  "no-such-grant": { kind: "no-such-grant", grantId: grantId("g-ghost") },
  "wrong-actor": { kind: "wrong-actor", grantId: grantId("G4"), holder: principalId("buyer-a") },
  "link-dead": { kind: "link-dead", grantId: grantId("G2"), atSeq: 11 },
  "capability-not-granted": { kind: "capability-not-granted", grantId: grantId("G6"), capability: "purchase" },
  "over-limit": { kind: "over-limit", grantId: grantId("G6"), requested: 50_000, headroom: 28_000 },
};
