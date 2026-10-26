import type { Charter, Commitment, EventInput, Grant } from "../../../../lib/contracts/index.js";
import { commitId, grantId, principalId } from "../../../../lib/contracts/index.js";
import { AGENT_NAMES, CAPABILITIES, agent } from "../../org.js";
import type { CompanyCapability } from "../../org.js";
import type { Policy } from "../../policies.js";

/**
 * Type-only proofs that Meridian's capability vocabulary is closed AT COMPILE TIME (plan §6 M6: "A misspelt capability must not compile").
 * The harness `lib/contracts/__tests__/support/proof-harness.ts` compiles this file with every directive removed and requires each
 * removed directive to be matched by a diagnostic with the stated code and message fragment, under both of this repo's tsconfigs,
 * so a line cannot pass by failing for some other reason (an unused variable, a widened literal). Declarations are exported so
 * `noUnusedLocals` cannot satisfy a directive.
 *
 * The routes: a fresh literal in a grant, a commit, an event and a charter; a non-literal route (a binding, then the whole event as a
 * binding); a plain `string`; a misspelt agent; a policy that returns a misspelt capability; and the list itself cannot be extended.
 *
 * HONEST LIMIT, as a control below: the type refuses a misspelling only where the domain's own `CompanyCapability` is in play. The
 * engine's functions are generic in `C`, and a caller who instantiates them with `string` gets no help from the compiler (M1 pins that
 * in its own proofs). That is why the vocabulary is ALSO a runtime list in the charter, which M3's intake checks every event against:
 * `__tests__/org.test.ts` shows an event naming `launder` refused at run time (the case §7 itself uses).
 */

const dana = principalId("dana");
const cfo = agent("cfo");
const base = { id: grantId("G1"), parent: null, grantor: dana, grantee: cfo, limit: 100, depth: 1 } as const;

// ---- a misspelt capability: fresh literals ----
// @ts-expect-error TS2820|TS2322 Type '"purchas"' is not assignable to type '"hire" | "purchase" | "refund" | "sign-contract"'
export const grantLiteral: Grant<CompanyCapability> = { ...base, capabilities: ["purchas"] };

// @ts-expect-error TS2820|TS2322 Type '"purchas"' is not assignable to type '"hire" | "purchase" | "refund" | "sign-contract"'
export const eventLiteral: EventInput<CompanyCapability> = { kind: "grant", grant: { ...base, capabilities: ["purchase", "purchas"] } };

// @ts-expect-error TS2820|TS2322 Type '"refnd"' is not assignable to type '"hire" | "purchase" | "refund" | "sign-contract"'
export const commitLiteral: Commitment<CompanyCapability> = { id: commitId("c1"), actor: cfo, actedUnder: grantId("G1"), capability: "refnd", amount: 1 };

// @ts-expect-error TS2820|TS2322 Type '"hires"' is not assignable to type '"hire" | "purchase" | "refund" | "sign-contract"'
export const charterLiteral: Charter<CompanyCapability> = { roots: [dana], capabilities: ["purchase", "hires"] };

// ---- a misspelt capability: through a binding ----
const misspelt = ["purchas"] as const;
// @ts-expect-error TS2322 Type '"purchas"' is not assignable to type '"hire" | "purchase" | "refund" | "sign-contract"'
export const grantViaBinding: Grant<CompanyCapability> = { ...base, capabilities: misspelt };

const misspeltEvent = { kind: "grant", grant: { ...base, capabilities: ["sign-contrac"] as const } } as const;
// @ts-expect-error TS2322 Type '"sign-contrac"' is not assignable to type '"hire" | "purchase" | "refund" | "sign-contract"'
export const eventViaBinding: EventInput<CompanyCapability> = misspeltEvent;

// ---- a plain string is not a capability ----
declare const someString: string;
// @ts-expect-error TS2322 Type 'string' is not assignable to type '"hire" | "purchase" | "refund" | "sign-contract"'
export const fromString: CompanyCapability = someString;

// ---- a misspelt agent ----
// @ts-expect-error TS2345 Argument of type '"cfoo"' is not assignable to parameter of type '"buyer-a" | "buyer-b" | "cfo" | "ops" | "refunder" | "support"'
export const misspeltAgent = agent("cfoo");

// ---- a policy that returns a misspelt capability ----
// @ts-expect-error TS2820|TS2322 Type '"purchas"' is not assignable to type '"hire" | "purchase" | "refund" | "sign-contract"'
export const misspeltPolicy: Policy = () => ({ kind: "commit", commit: { id: commitId("c1"), actor: cfo, actedUnder: grantId("G1"), capability: "purchas", amount: 1 } });

// ---- the closed list cannot be extended (it is a readonly tuple) ----
// @ts-expect-error TS2339 Property 'push' does not exist on type 'readonly ["purchase", "refund", "hire", "sign-contract"]'
export const pushed = CAPABILITIES.push("launder");

// @ts-expect-error TS2339 Property 'push' does not exist on type 'readonly ["cfo", "ops", "support", "buyer-a", "buyer-b", "refunder"]'
export const pushedAgent = AGENT_NAMES.push("intern");

// CONTROLS (no directive, so they must compile): right spellings are accepted, and every capability of the list is a `CompanyCapability`.
export const goodGrant: Grant<CompanyCapability> = { ...base, capabilities: ["purchase", "refund", "hire", "sign-contract"] };
export const goodEvent: EventInput<CompanyCapability> = { kind: "grant", grant: goodGrant };
export const goodAgent = agent("buyer-a");
export const fromList: CompanyCapability = CAPABILITIES[3];
export const goodPolicy: Policy = () => null;

// HONEST LIMIT: with `C = string` the compiler refuses nothing about capabilities. A domain that forgot to narrow would get no help.
export const anythingGoes: Grant = { ...base, capabilities: ["purchas", "any string at all"] };
