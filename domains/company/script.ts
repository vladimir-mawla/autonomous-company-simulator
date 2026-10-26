import { commitId, grantId, principalId } from "../../lib/contracts/index.js";
import type { EventInput, NonEmptyReadonlyArray } from "../../lib/contracts/index.js";
import { CAPABILITIES, ROOT, agent } from "./org.js";
import type { AgentName, CompanyCapability } from "./org.js";

/**
 * `CANON_SCRIPT`: the canonical incident of plan §7 as the list of events offered to the engine, in the order §7 lists them.
 *
 * THIS FILE HOLDS WHAT WAS OFFERED, NEVER WHAT THE ENGINE ANSWERED. A step is a key, a line of narration and the event; the
 * seq it was admitted at, the verdict it got and the rejection it met are not written down here, because a table of
 * answers in `domains/` would be a second copy of the engine's rulings. `__tests__/canon-script.test.ts` and
 * `scripts/demo-company.ts` each hold §7's table of answers and check it against what the engine says when this list is offered
 * to it. `lib/standing/__tests__/canonical.test.ts` (M5) did the same for the same events, held there as its own fixtures;
 * `__tests__/canon-script.test.ts` shows this list's admitted events equal those.
 *
 * The 33 steps are §7's 18 admitted events and its 15 attempts that were refused (§7 beat 1 before the revoke: eleven; after
 * it: two; and the two intake lines at the end), at the places §7's table puts them. A refused attempt takes no seq, so where
 * it stands in this list changes no number: it matters only for the state of the log it is offered against, which is what §7
 * says about it (`over-delegate` is refused against G2's headroom of 50 000 at seq 10, and `delegate-from-dead` against a G2 that has
 * been revoked, with limit 0, "so `over-allocation` cannot mask" `parent-dead`).
 *
 * Every step is deeply frozen: the same objects are offered by every `replayScript` and every `runQuarter`, and an attempt holds
 * the object it was given.
 */

export interface ScriptStep {
  /** Unique within the script; the demo and the tests key what they expect of a step by it. */
  readonly key: string;
  readonly label: string;
  readonly input: EventInput<CompanyCapability>;
}

function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freezeDeep(inner);
  }
  return value;
}

interface GrantSpec {
  readonly id: string;
  readonly parent?: string;
  readonly grantor: AgentName | "dana" | "intern";
  readonly grantee: AgentName;
  readonly capabilities: NonEmptyReadonlyArray<CompanyCapability>;
  readonly limit: number;
  readonly depth: number;
}

const who = (name: AgentName | "dana" | "intern") => (name === "dana" ? ROOT : name === "intern" ? principalId("intern") : agent(name));

function grant(key: string, label: string, spec: GrantSpec): ScriptStep {
  return {
    key,
    label,
    input: {
      kind: "grant",
      grant: {
        id: grantId(spec.id),
        parent: spec.parent === undefined ? null : grantId(spec.parent),
        grantor: who(spec.grantor),
        grantee: agent(spec.grantee),
        capabilities: spec.capabilities,
        limit: spec.limit,
        depth: spec.depth,
      },
    },
  };
}

function commit(id: string, actor: AgentName, actedUnder: string, capability: CompanyCapability, amount: number, label: string): ScriptStep {
  return { key: id, label, input: { kind: "commit", commit: { id: commitId(id), actor: agent(actor), actedUnder: grantId(actedUnder), capability, amount } } };
}

function revoke(key: string, id: string, by: AgentName | "dana", label: string): ScriptStep {
  return { key, label, input: { kind: "revoke", grantId: grantId(id), by: who(by) } };
}

/**
 * The one event of §7 that cannot be written without going around the type: a grant naming the capability `launder`. The
 * compiler refuses it (`__tests__/proofs/capability.proofs.ts` shows that it does); this is the single place the domain
 * deliberately goes around that refusal, to show that the engine's runtime check refuses it too (M3's intake, plan D5: "checked
 * at runtime too"). `never` is assignable to every type, so this is not a cast of the whole event.
 */
const LAUNDER: CompanyCapability = "launder" as never;

const ALL_FOUR = CAPABILITIES;

export const CANON_SCRIPT: readonly ScriptStep[] = freezeDeep([
  // seq 1 to 6: who holds what
  grant("G1", "dana grants cfo all four capabilities, limit 1 000 000, depth 4", { id: "G1", grantor: "dana", grantee: "cfo", capabilities: ALL_FOUR, limit: 1_000_000, depth: 4 }),
  grant("G2", "cfo grants ops purchase and sign-contract under G1, limit 400 000, depth 3", { id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase", "sign-contract"], limit: 400_000, depth: 3 }),
  grant("G3", "cfo grants support refund under G1, limit 100 000, depth 2", { id: "G3", parent: "G1", grantor: "cfo", grantee: "support", capabilities: ["refund"], limit: 100_000, depth: 2 }),
  grant("G4", "ops grants buyer-a purchase under G2, limit 120 000, depth 0", { id: "G4", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 120_000, depth: 0 }),
  grant("G5", "ops grants buyer-b purchase under G2, limit 150 000, depth 0", { id: "G5", parent: "G2", grantor: "ops", grantee: "buyer-b", capabilities: ["purchase"], limit: 150_000, depth: 0 }),
  grant("G6", "support grants refunder refund under G3, limit 40 000, depth 0", { id: "G6", parent: "G3", grantor: "support", grantee: "refunder", capabilities: ["refund"], limit: 40_000, depth: 0 }),

  // seq 7 to 10: four acts inside their mandates
  commit("c1", "buyer-a", "G4", "purchase", 50_000, "buyer-a buys 50 000 under G4"),
  commit("c2", "buyer-b", "G5", "purchase", 90_000, "buyer-b buys 90 000 under G5"),
  commit("c3", "refunder", "G6", "refund", 12_000, "refunder refunds 12 000 under G6"),
  commit("c4", "ops", "G2", "sign-contract", 80_000, "ops signs a contract for 80 000 under G2"),

  // beat 1, before the revoke: eleven attempts that are refused
  grant("widen-scope", "ops tries to grant hire, which G2 does not carry", { id: "Gw", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: ["hire"], limit: 1, depth: 2 }),
  grant("over-delegate", "ops tries to hand down 200 000 when G2 has 50 000 left", { id: "Go", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 200_000, depth: 2 }),
  grant("delegate-past-depth", "buyer-a, whose grant has depth 0, tries to delegate", { id: "Gd", parent: "G4", grantor: "buyer-a", grantee: "buyer-b", capabilities: ["purchase"], limit: 1, depth: 0 }),
  grant("mint-root", "the intern tries to mint a root grant", { id: "Gr", grantor: "intern", grantee: "buyer-a", capabilities: ["purchase"], limit: 1, depth: 0 }),
  grant("delegate-borrowed", "buyer-b tries to delegate under ops' G2", { id: "Gh", parent: "G2", grantor: "buyer-b", grantee: "support", capabilities: ["purchase"], limit: 1, depth: 2 }),
  grant("keep-depth", "ops tries to grant at depth 3 under G2, which is itself depth 3", { id: "Gn", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 1, depth: 3 }),
  grant("delegate-upward", "ops tries to grant the cfo, who is already above it", { id: "Gc", parent: "G2", grantor: "ops", grantee: "cfo", capabilities: ["purchase"], limit: 1, depth: 2 }),
  grant("orphan-grant", "ops tries to grant under a parent that does not exist", { id: "Gu", parent: "g-nowhere", grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 1, depth: 2 }),
  grant("reuse-grant-id", "cfo tries to grant under the id G3, which is taken", { id: "G3", parent: "G1", grantor: "cfo", grantee: "buyer-b", capabilities: ["refund"], limit: 1, depth: 1 }),
  revoke("revoke-own-grant", "G5", "buyer-a", "buyer-a tries to revoke G5, which is buyer-b's"),
  revoke("revoke-ghost", "g-unknown", "cfo", "cfo tries to revoke a grant that does not exist"),

  // seq 11
  revoke("revoke-G2", "G2", "cfo", "cfo revokes G2"),

  // after the revoke: two more attempts that are refused
  revoke("revoke-twice", "G2", "cfo", "cfo tries to revoke G2 again"),
  grant("delegate-from-dead", "ops tries to grant under the revoked G2, with limit 0", { id: "Gz", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: ["purchase"], limit: 0, depth: 2 }),

  // seq 12 to 16: five acts that are recorded and ruled void, one of each breach
  commit("c5", "buyer-a", "G4", "purchase", 10_000, "buyer-a buys 10 000 under G4, whose chain has been cut"),
  commit("c6", "buyer-b", "G4", "purchase", 5_000, "buyer-b buys 5 000 under G4, which is buyer-a's and cut"),
  commit("c7", "refunder", "G6", "purchase", 3_000, "refunder buys 3 000 under G6, which grants refund only"),
  commit("c8", "refunder", "G6", "refund", 50_000, "refunder refunds 50 000 under G6, which has 28 000 left"),
  commit("c9", "buyer-a", "g-ghost", "purchase", 1_000, "buyer-a buys 1 000 under a grant that does not exist"),

  // seq 17 and 18: the cure is a new grant and a new act
  grant("G7", "cfo grants buyer-a purchase under G1, limit 60 000, depth 0", { id: "G7", parent: "G1", grantor: "cfo", grantee: "buyer-a", capabilities: ["purchase"], limit: 60_000, depth: 0 }),
  commit("c10", "buyer-a", "G7", "purchase", 10_000, "buyer-a buys 10 000 under G7"),

  // the two intake lines that complete the fifteen
  grant("negative-limit", "cfo tries to grant with limit -1", { id: "Gi", parent: "G1", grantor: "cfo", grantee: "buyer-a", capabilities: ["purchase"], limit: -1, depth: 1 }),
  grant("launder-capability", "cfo tries to grant a capability called launder", { id: "Gl", parent: "G1", grantor: "cfo", grantee: "buyer-a", capabilities: [LAUNDER], limit: 1, depth: 1 }),
]);
