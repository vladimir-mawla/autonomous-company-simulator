import { describe, expect, it } from "vitest";
import { readCharter } from "../../../lib/chain/index.js";
import { principalId } from "../../../lib/contracts/index.js";
import type { EventInput } from "../../../lib/contracts/index.js";
import { append } from "../../../lib/standing/index.js";
import { AGENT_NAMES, AGENTS, CAPABILITIES, CHARTER, ROOT, agent } from "../org.js";
import type { CompanyCapability } from "../org.js";

/**
 * The org of plan §6 M6: one human root `dana`; agents `cfo ops support buyer-a buyer-b refunder`; capabilities
 * `purchase | refund | hire | sign-contract` as `type CompanyCapability`, with the same list at run time in `CHARTER`.
 * What does NOT compile is `__tests__/proofs/capability.proofs.ts`; what the engine refuses at run time is shown here.
 */

describe("the org", () => {
  it("the capabilities are the plan's four, in the plan's order", () => {
    expect([...CAPABILITIES]).toEqual(["purchase", "refund", "hire", "sign-contract"]);
  });

  it("the type and the list are the same set: a record keyed by the type has exactly the list's keys (a missing or an extra key is a compile error)", () => {
    const every: Record<CompanyCapability, true> = { purchase: true, refund: true, hire: true, "sign-contract": true };
    expect(Object.keys(every).sort()).toEqual([...CAPABILITIES].sort());
  });

  it("the agents are the plan's six, in the plan's order, and AGENTS holds their principal ids in that order", () => {
    expect([...AGENT_NAMES]).toEqual(["cfo", "ops", "support", "buyer-a", "buyer-b", "refunder"]);
    expect([...AGENTS]).toEqual(AGENT_NAMES.map((name) => principalId(name)));
    expect(AGENT_NAMES.map(agent)).toEqual([...AGENTS]);
  });

  it("the root is dana, and dana is not one of the agents", () => {
    expect(ROOT).toBe("dana");
    expect(AGENTS).not.toContain(ROOT);
  });

  it("the charter is roots [dana] and the four capabilities, and the engine's own charter reader accepts it unchanged", () => {
    expect(CHARTER).toEqual({ roots: ["dana"], capabilities: ["purchase", "refund", "hire", "sign-contract"] });
    const read = readCharter(CHARTER);
    expect(read.ok && read.charter).toEqual(CHARTER);
  });

  it("the shared constants are frozen, so a caller cannot widen the vocabulary or add a root for everyone else", () => {
    for (const value of [CAPABILITIES, AGENT_NAMES, AGENTS, CHARTER, CHARTER.roots, CHARTER.capabilities]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => (CAPABILITIES as unknown as string[]).push("launder")).toThrow(TypeError);
    expect(() => (CHARTER.roots as unknown as string[]).push("intern")).toThrow(TypeError);
  });
});

describe("the vocabulary is closed at run time as well: the engine refuses what the compiler cannot (M3's intake, plan D5)", () => {
  const launder = (capability: string): EventInput<CompanyCapability> =>
    ({ kind: "grant", grant: { id: "Gx", parent: null, grantor: ROOT, grantee: agent("cfo"), capabilities: [capability], limit: 1, depth: 0 } }) as unknown as EventInput<CompanyCapability>;

  it("a grant naming a capability that is not in the charter is refused with the capability named, against an empty log", () => {
    const refused = append(CHARTER, [], launder("launder"));
    expect(refused).toEqual({ ok: false, failure: { kind: "rejected", rejection: { kind: "unknown-capability", capability: "launder" } } });
  });

  it("the same grant with a capability that is in the charter is admitted at seq 1 (so the refusal above is about the capability and nothing else)", () => {
    const admitted = append(CHARTER, [], launder("purchase"));
    expect(admitted.ok && admitted.event.seq).toBe(1);
  });
});
