import type { Breach } from "../../breach.js";
import type { FoldFault } from "../../fold-fault.js";
import { grantId, principalId } from "../../ids.js";
import type { Rejection } from "../../rejection.js";

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

export const REJECTION_SAMPLES: { [K in Rejection["kind"]]: Extract<Rejection, { kind: K }> } = {
  "invalid-event-shape": { kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] },
  "unknown-capability": { kind: "unknown-capability", capability: "launder" },
  "duplicate-id": { kind: "duplicate-id", id: "G3" },
  "not-a-root": { kind: "not-a-root", grantor: principalId("intern") },
  "unknown-parent": { kind: "unknown-parent", parent: grantId("g-ghost") },
  "parent-dead": { kind: "parent-dead", deadGrant: grantId("G2") },
  "grantor-not-holder": { kind: "grantor-not-holder", parent: grantId("G2"), grantor: principalId("buyer-b"), holder: principalId("ops") },
  "capability-widening": { kind: "capability-widening", capability: "hire" },
  "depth-exhausted": { kind: "depth-exhausted", parent: grantId("G4") },
  "depth-not-narrowed": { kind: "depth-not-narrowed", parentDepth: 3, requested: 3 },
  "principal-cycle": { kind: "principal-cycle", principal: principalId("cfo") },
  "over-allocation": { kind: "over-allocation", grantId: grantId("G2"), requested: 200_000, headroom: 50_000 },
  "unknown-grant": { kind: "unknown-grant", grantId: grantId("g-ghost") },
  "already-dead": { kind: "already-dead", grantId: grantId("G2") },
  "revoker-not-authorised": { kind: "revoker-not-authorised", grantId: grantId("G5"), by: principalId("buyer-a") },
};

export const FOLD_FAULT_SAMPLES: { [K in FoldFault["kind"]]: Extract<FoldFault, { kind: K }> } = {
  "invalid-charter": { kind: "invalid-charter", fields: ["roots"] },
  "hostile-log-input": { kind: "hostile-log-input", message: "a getter threw" },
  "log-too-long": { kind: "log-too-long", length: 5001, max: 5000 },
  "seq-mismatch": { kind: "seq-mismatch", index: 3, expected: 4, actual: 7 },
  "inadmissible-event": { kind: "inadmissible-event", index: 2, rejection: { kind: "capability-widening", capability: "hire" } },
};
