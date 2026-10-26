import { describe, expect, it } from "vitest";
import type { EventInput, Log } from "../../../lib/contracts/index.js";
import { append, standings } from "../../../lib/standing/index.js";
import { mulberry32 } from "../../../lib/chain/__tests__/fixtures.js";
import { CANON_ALL, logOf, revokeEvent } from "../../../lib/standing/__tests__/fixtures.js";
import { AGENTS, CHARTER, ROOT, agent } from "../org.js";
import type { CompanyCapability } from "../org.js";
import {
  BuyerPolicy,
  COMPROMISE_TICK,
  COMPROMISED,
  CompromisedPolicy,
  DELEGATE_CHANCE,
  DRAIN_AMOUNTS,
  DelegatorPolicy,
  OVERREACHES,
  OVERREACH_CHANCE,
  OverreachPolicy,
  POLICIES,
  RefunderPolicy,
  REFUND_AMOUNTS,
  ROOT_DEPTHS,
  ROOT_LIMITS,
  ORDER_AMOUNTS,
} from "../policies.js";
import type { OverreachName, Policy } from "../policies.js";
import { makeOrgView } from "../view.js";
import type { OrgView } from "../view.js";

/**
 * The five policies (`policies.ts`), each against worlds this file builds from plan §7's incident with M5's fixtures, and each driven by
 * `mulberry32` from M3's fixtures (an independent copy of the generator `simulate.ts` carries; `simulate.test.ts` shows the two agree).
 *
 * What a policy PROPOSES is checked against what the engine RULES, never against a rule written here: a diligent buyer's proposals are
 * all ruled warranted by the engine's own `append`, and each overreach is ruled the way its name says by the engine's own `append`.
 * Every property below also says how many cases it looked at, because a property over an empty domain proves nothing.
 */

const canon = (seq: number): Log<CompanyCapability> => logOf(CHARTER, CANON_ALL.slice(0, seq));
const afterG3Revoked = (): Log<CompanyCapability> => logOf(CHARTER, [...CANON_ALL, revokeEvent("G3", "cfo")]);
const afterG1Revoked = (): Log<CompanyCapability> => logOf(CHARTER, [...CANON_ALL, revokeEvent("G1", "dana")]);

function viewOf(log: Log<CompanyCapability>, tick = 10): OrgView {
  const made = makeOrgView(log, tick);
  if (!made.ok) throw new Error(`no view: ${JSON.stringify(made.fault)}`);
  return made.view;
}

const SEEDS = 300;

/** What the engine says to `event` against `log`, as a short string; throws on anything that is not admitted or rejected. */
function ruling(log: Log<CompanyCapability>, event: EventInput<CompanyCapability>): string {
  const result = append(CHARTER, log, event);
  if (result.ok) return result.verdict === null ? `admitted ${event.kind}` : result.verdict.kind === "warranted" ? "admitted commit warranted" : `admitted commit breached ${result.verdict.breach.kind}`;
  if (result.failure.kind === "rejected") return `rejected ${result.failure.rejection.kind}`;
  throw new Error(`faulty log: ${JSON.stringify(result.failure.fault)}`);
}

describe("the order the policies are stepped in", () => {
  it("is the plan's five, in this order, and the list is frozen", () => {
    expect(POLICIES.map((entry) => entry.name)).toEqual(["DelegatorPolicy", "BuyerPolicy", "RefunderPolicy", "OverreachPolicy", "CompromisedPolicy"]);
    expect(POLICIES.map((entry) => entry.policy)).toEqual([DelegatorPolicy, BuyerPolicy, RefunderPolicy, OverreachPolicy, CompromisedPolicy]);
    expect(Object.isFrozen(POLICIES)).toBe(true);
  });
});

describe("every policy is a function of the view and the generator it is given", () => {
  const worlds: readonly [string, Log<CompanyCapability>][] = [
    ["an empty log", []],
    ["plan §7 at seq 10", canon(10)],
    ["plan §7 at seq 18", canon(18)],
    ["plan §7 after G3 is revoked", afterG3Revoked()],
    ["plan §7 after G1 is revoked", afterG1Revoked()],
  ];

  it("the same view and the same generator state give the same proposal, on every world, for every policy (and the views were built twice)", () => {
    let proposals = 0;
    for (const [name, log] of worlds) {
      for (const { name: policyName, policy } of POLICIES) {
        for (let seed = 1; seed <= 40; seed++) {
          const a = policy(viewOf(log), mulberry32(seed));
          const b = policy(viewOf(log), mulberry32(seed));
          expect(JSON.stringify(a), `${policyName} on ${name} seed ${seed}`).toBe(JSON.stringify(b));
          if (a !== null) proposals++;
        }
      }
    }
    expect(proposals).toBeGreaterThan(300);
  });

  it("a generator stuck at either end of its range makes no policy throw, and whatever it proposes is an event of one of the three kinds", () => {
    let proposals = 0;
    for (const [, log] of worlds) {
      for (const { policy } of POLICIES) {
        for (const rng of [() => 0, () => 0.9999999999]) {
          const proposed = policy(viewOf(log), rng);
          if (proposed !== null) {
            expect(["grant", "revoke", "commit"]).toContain(proposed.kind);
            proposals++;
          }
        }
      }
    }
    expect(proposals).toBeGreaterThan(10);
  });

  it("a policy does not change the view or the log it is given", () => {
    const log = canon(18);
    const before = JSON.stringify(log);
    for (const { policy } of POLICIES) {
      const view = viewOf(log);
      const shown = JSON.stringify(view.grants);
      for (let seed = 1; seed <= 20; seed++) policy(view, mulberry32(seed));
      expect(JSON.stringify(view.grants)).toBe(shown);
    }
    expect(JSON.stringify(log)).toBe(before);
  });
});

describe("DelegatorPolicy: the managers", () => {
  it("with nothing live at the top it proposes dana's root grant to the cfo: all four capabilities, a limit and a depth from the lists, the next position as its id", () => {
    for (const [log, id] of [[[], "auto-g-1"], [afterG1Revoked(), "auto-g-20"]] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const proposed = DelegatorPolicy(viewOf(log), mulberry32(seed));
        expect(proposed?.kind).toBe("grant");
        if (proposed?.kind !== "grant") continue;
        const { grant } = proposed;
        expect([grant.id, grant.parent, grant.grantor, grant.grantee]).toEqual([id, null, ROOT, agent("cfo")]);
        expect([...grant.capabilities]).toEqual(["purchase", "refund", "hire", "sign-contract"]);
        expect(ROOT_LIMITS).toContain(grant.limit);
        expect(ROOT_DEPTHS).toContain(grant.depth);
        expect(ruling(log, proposed)).toBe("admitted grant");
      }
    }
  });

  it("with a live root it proposes only a grant it can see is sound, or the revoke of a live grant by that grant's own grantor, and the engine refuses the grants only for want of headroom", () => {
    const log = canon(18);
    const view = viewOf(log);
    const byId = new Map(view.grants.map((entry) => [entry.grant.id as string, entry]));
    const rulings = new Map<string, number>();
    let delegations = 0;
    let reviews = 0;
    let silent = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const proposed = DelegatorPolicy(view, mulberry32(seed));
      if (proposed === null) {
        silent++;
        continue;
      }
      if (proposed.kind === "grant") {
        delegations++;
        const parent = byId.get(proposed.grant.parent as string);
        expect(parent?.live, `seed ${seed}: the parent is live`).toBe(true);
        if (parent === undefined) continue;
        expect(proposed.grant.grantor, `seed ${seed}`).toBe(parent.grant.grantee);
        expect(proposed.grant.capabilities.every((cap) => parent.grant.capabilities.includes(cap)), `seed ${seed}: capabilities are a subset`).toBe(true);
        expect(proposed.grant.depth, `seed ${seed}: depth is below the parent's`).toBeLessThan(parent.grant.depth);
        expect(parent.trail, `seed ${seed}: the grantee is not already above`).not.toContain(proposed.grant.grantee);
      } else if (proposed.kind === "revoke") {
        reviews++;
        const target = byId.get(proposed.grantId as string);
        expect(target?.live, `seed ${seed}: the target is live`).toBe(true);
        expect(proposed.by).toBe(target?.grant.grantor);
      } else {
        throw new Error(`seed ${seed}: a delegator proposed a ${proposed.kind}`);
      }
      const verdict = ruling(log, proposed);
      rulings.set(verdict, (rulings.get(verdict) ?? 0) + 1);
    }
    expect(delegations).toBeGreaterThan(100);
    expect(reviews).toBeGreaterThan(5);
    expect(silent).toBeGreaterThan(50);
    expect([...rulings.keys()].sort()).toEqual(["admitted grant", "admitted revoke", "rejected over-allocation"]);
    // The share of seeds that propose a grant is DELEGATE_CHANCE less the seeds that find nothing to aim at; it must be near it.
    expect(Math.abs(delegations / SEEDS - DELEGATE_CHANCE)).toBeLessThan(0.1);
  });
});

describe("BuyerPolicy: a diligent purchaser", () => {
  it("proposes only purchases by ops, buyer-a or buyer-b under a live grant of theirs with the capability, of a size from the price list, and the engine rules every one of them warranted", () => {
    let proposals = 0;
    const actors = new Set<string>();
    for (const [name, log] of [["seq 10", canon(10)], ["seq 18", canon(18)]] as const) {
      const view = viewOf(log);
      for (let seed = 1; seed <= SEEDS; seed++) {
        const proposed = BuyerPolicy(view, mulberry32(seed));
        if (proposed === null) continue;
        proposals++;
        expect(proposed.kind).toBe("commit");
        if (proposed.kind !== "commit") continue;
        const { commit } = proposed;
        const grant = view.grants.find((entry) => entry.grant.id === commit.actedUnder);
        expect([commit.capability, grant?.live, grant?.grant.grantee]).toEqual(["purchase", true, commit.actor]);
        expect(ORDER_AMOUNTS).toContain(commit.amount);
        expect(ruling(log, proposed), `${name} seed ${seed}`).toBe("admitted commit warranted");
        actors.add(commit.actor);
      }
    }
    expect(proposals).toBeGreaterThan(100);
    expect([...actors].sort()).toEqual(["buyer-a", "buyer-b", "ops"]);
  });

  it("proposes nothing when none of its buyers holds a live purchase grant (seq 11: G2, G4 and G5 are all cut), and nothing on an empty log", () => {
    for (const log of [canon(11), []]) {
      for (let seed = 1; seed <= 50; seed++) expect(BuyerPolicy(viewOf(log), mulberry32(seed))).toBeNull();
    }
  });

  it("proposes nothing for a commit the engine would not warrant, however many times it is asked: a grant whose headroom is spent is skipped, not tried", () => {
    // G6 and G3 are refund grants, so buyers have only G2, G4 and G5 before the revoke. Spend G4 down to nothing, then ask.
    const spent = logOf(CHARTER, [
      ...CANON_ALL.slice(0, 10),
      { kind: "commit", commit: { id: "spend" as never, actor: agent("buyer-a"), actedUnder: "G4" as never, capability: "purchase", amount: 70_000 } },
    ]);
    const view = viewOf(spent);
    let proposals = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const proposed = BuyerPolicy(view, mulberry32(seed));
      if (proposed?.kind === "commit") {
        proposals++;
        expect(proposed.commit.actedUnder, `seed ${seed}`).not.toBe("G4");
      }
    }
    expect(proposals).toBeGreaterThan(50);
  });
});

describe("RefunderPolicy: an agent acting on the last mandate it was given, without asking", () => {
  it("proposes refunds by support or the refunder under the NEWEST refund grant each holds, live or not, of a size from the price list", () => {
    let proposals = 0;
    const actors = new Set<string>();
    const log = canon(18);
    const view = viewOf(log);
    for (let seed = 1; seed <= SEEDS; seed++) {
      const proposed = RefunderPolicy(view, mulberry32(seed));
      if (proposed === null) continue;
      proposals++;
      expect(proposed.kind).toBe("commit");
      if (proposed.kind !== "commit") continue;
      expect(proposed.commit.capability).toBe("refund");
      expect(REFUND_AMOUNTS).toContain(proposed.commit.amount);
      expect(proposed.commit.actedUnder).toBe(proposed.commit.actor === agent("support") ? "G3" : "G6");
      actors.add(proposed.commit.actor);
    }
    expect(proposals).toBeGreaterThan(50);
    expect([...actors].sort()).toEqual(["refunder", "support"]);
  });

  it("after the mandate is cut it goes on, and the engine records each act and rules it void: link-dead, naming the revoke's seq", () => {
    const log = afterG3Revoked();
    const view = viewOf(log);
    const rulings = new Set<string>();
    let proposals = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const proposed = RefunderPolicy(view, mulberry32(seed));
      if (proposed === null) continue;
      proposals++;
      rulings.add(ruling(log, proposed));
    }
    expect(proposals).toBeGreaterThan(50);
    expect([...rulings]).toEqual(["admitted commit breached link-dead"]);
  });

  it("proposes nothing when it was never given a refund mandate", () => {
    for (let seed = 1; seed <= 50; seed++) expect(RefunderPolicy(viewOf(canon(2)), mulberry32(seed))).toBeNull();
  });
});

describe("CompromisedPolicy: one agent that spends as fast as it can inside what it holds, from COMPROMISE_TICK on", () => {
  it("is buyer-a, and is silent before COMPROMISE_TICK whatever the generator says", () => {
    expect(COMPROMISED).toBe(agent("buyer-a"));
    for (let tick = 0; tick < COMPROMISE_TICK; tick++) {
      for (let seed = 1; seed <= 30; seed++) expect(CompromisedPolicy(viewOf(canon(18), tick), mulberry32(seed))).toBeNull();
    }
  });

  it("from the tick on it proposes only purchases by buyer-a under its newest purchase grant (G7 at seq 18), of a size from the drain list", () => {
    let proposals = 0;
    const view = viewOf(canon(18), COMPROMISE_TICK);
    for (let seed = 1; seed <= SEEDS; seed++) {
      const proposed = CompromisedPolicy(view, mulberry32(seed));
      if (proposed === null) continue;
      proposals++;
      expect(proposed.kind).toBe("commit");
      if (proposed.kind !== "commit") continue;
      expect([proposed.commit.actor, proposed.commit.actedUnder, proposed.commit.capability]).toEqual([COMPROMISED, "G7", "purchase"]);
      expect(DRAIN_AMOUNTS).toContain(proposed.commit.amount);
    }
    expect(proposals).toBeGreaterThan(50);
  });

  it("proposes nothing when buyer-a holds no purchase grant at all", () => {
    for (let seed = 1; seed <= 30; seed++) expect(CompromisedPolicy(viewOf(canon(3), COMPROMISE_TICK), mulberry32(seed))).toBeNull();
  });

  it("plan §11 case 01 in the large: left to run, far more is attempted under G7 than its limit, every act the engine ruled warranted fits inside the limit, and the rest are void over-limit", () => {
    let log = canon(18);
    let warranted = 0;
    let overLimit = 0;
    const other: string[] = [];
    const rng = mulberry32(7);
    for (let step = 0; step < 60; step++) {
      const proposed = CompromisedPolicy(viewOf(log, COMPROMISE_TICK), rng);
      if (proposed === null) continue;
      const result = append(CHARTER, log, proposed);
      if (!result.ok) throw new Error("a commit is always recorded");
      log = result.log;
      const verdict = result.verdict;
      if (verdict?.kind === "warranted") warranted++;
      else if (verdict?.kind === "breached" && verdict.breach.kind === "over-limit") overLimit++;
      else other.push(JSON.stringify(verdict));
    }
    expect(other).toEqual([]);
    expect(warranted).toBeGreaterThan(0);
    expect(overLimit).toBeGreaterThan(0);

    // Test-side sums, from the raw log and the engine's own standings: G7's limit is 60 000 (plan §7, seq 17).
    const list = standings(CHARTER, log);
    if (!list.ok) throw new Error("standings");
    const kindOf = new Map(list.standings.map((standing) => [standing.commitId as string, standing.kind]));
    let attempted = 0;
    let bound = 0;
    for (const event of log) {
      if (event.kind !== "commit" || event.commit.actedUnder !== "G7") continue;
      attempted += event.commit.amount;
      if (kindOf.get(event.commit.id) !== "void") bound += event.commit.amount;
    }
    expect(attempted).toBeGreaterThan(60_000);
    expect(bound).toBeLessThanOrEqual(60_000);
    expect(bound).toBeGreaterThan(10_000); // c10's 10 000, and something the compromised agent bound
  });
});

describe("OverreachPolicy: eighteen ways to act outside a mandate, each ruled by the engine the way its name says", () => {
  const EXPECTED: Readonly<Record<OverreachName, string>> = {
    "widen-scope": "rejected capability-widening",
    "over-delegate": "rejected over-allocation",
    "delegate-past-depth": "rejected depth-exhausted",
    "mint-root": "rejected not-a-root",
    "delegate-borrowed": "rejected grantor-not-holder",
    "keep-depth": "rejected depth-not-narrowed",
    "delegate-upward": "rejected principal-cycle",
    "orphan-grant": "rejected unknown-parent",
    "reuse-grant-id": "rejected duplicate-id",
    "negative-limit": "rejected invalid-event-shape",
    "delegate-from-dead": "rejected parent-dead",
    "revoke-own-grant": "rejected revoker-not-authorised",
    "revoke-ghost": "rejected unknown-grant",
    "revoke-twice": "rejected already-dead",
    "borrowed-commit": "admitted commit breached wrong-actor",
    "out-of-scope-commit": "admitted commit breached capability-not-granted",
    "oversized-commit": "admitted commit breached over-limit",
    "phantom-commit": "admitted commit breached no-such-grant",
  };

  it("the table has the eighteen names of the type, each once, and eighteen distinct rulings: fourteen refusals and four breaches", () => {
    expect(OVERREACHES.map((entry) => entry.name).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(new Set(Object.values(EXPECTED)).size).toBe(18);
    expect(Object.values(EXPECTED).filter((value) => value.startsWith("rejected"))).toHaveLength(14);
    expect(Object.values(EXPECTED).filter((value) => value.startsWith("admitted commit breached"))).toHaveLength(4);
  });

  for (const overreach of OVERREACHES) {
    it(`${overreach.name}: every proposal, in every world and seed, gets the ruling "${EXPECTED[overreach.name]}"`, () => {
      let proposals = 0;
      for (const [name, log] of [["seq 10", canon(10)], ["seq 11", canon(11)], ["seq 18", canon(18)], ["G3 revoked", afterG3Revoked()]] as const) {
        const view = viewOf(log);
        for (let seed = 1; seed <= 60; seed++) {
          const proposed = overreach.build(view, mulberry32(seed));
          if (proposed === null) continue;
          proposals++;
          expect(ruling(log, proposed), `${name} seed ${seed}`).toBe(EXPECTED[overreach.name]);
        }
      }
      expect(proposals, "the act was aimed at something in at least one world").toBeGreaterThan(20);
    });
  }

  it("proposes nothing when the generator's first draw is at or above OVERREACH_CHANCE, and otherwise exactly what a table entry builds from the draws that follow", () => {
    const view = viewOf(canon(18));
    let acted = 0;
    let idle = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const proposed = OverreachPolicy(view, mulberry32(seed));
      const probe = mulberry32(seed);
      if (probe() >= OVERREACH_CHANCE) {
        expect(proposed, `seed ${seed}`).toBeNull();
        idle++;
        continue;
      }
      const entry = OVERREACHES[Math.min(Math.floor(probe() * OVERREACHES.length), OVERREACHES.length - 1)];
      expect(JSON.stringify(proposed), `seed ${seed}`).toBe(JSON.stringify(entry?.build(view, probe) ?? null));
      acted++;
    }
    expect(acted).toBeGreaterThan(100);
    expect(idle).toBeGreaterThan(100);
  });

  it("every agent is somebody OverreachPolicy can name, and the principals it names are the company's six and nobody else (no invented identity)", () => {
    const named = new Set<string>();
    const view = viewOf(canon(18));
    for (const overreach of OVERREACHES) {
      for (let seed = 1; seed <= 80; seed++) {
        const proposed = overreach.build(view, mulberry32(seed));
        if (proposed?.kind === "grant") {
          named.add(proposed.grant.grantor);
          named.add(proposed.grant.grantee);
        } else if (proposed?.kind === "revoke") named.add(proposed.by);
        else if (proposed?.kind === "commit") named.add(proposed.commit.actor);
      }
    }
    const roster = new Set<string>([...AGENTS, ROOT]);
    expect([...named].filter((who) => !roster.has(who))).toEqual([]);
    expect(named.size).toBeGreaterThanOrEqual(6);
  });
});

/** Compile-time: the five policies are `Policy`s. */
export const _policies: readonly Policy[] = [DelegatorPolicy, BuyerPolicy, RefunderPolicy, OverreachPolicy, CompromisedPolicy];
