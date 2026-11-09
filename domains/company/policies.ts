import { commitId, grantId } from "../../lib/contracts/index.js";
import type { EventInput, NonEmptyReadonlyArray, PrincipalId } from "../../lib/contracts/index.js";
import { AGENTS, CAPABILITIES, ROOT, agent } from "./org.js";
import type { CompanyCapability } from "./org.js";
import type { GrantView, OrgView } from "./view.js";

/**
 * The company's autonomous agents: five deterministic policies, each `(view, rng) -> EventInput | null` (plan §6 M6, D10).
 *
 * NO LLM, NO NETWORK, NO CLOCK, NO KEY. A policy reads the view it is given and draws from the generator it is given; the
 * same view and the same generator state give the same answer. An LLM-backed agent would replace this file (plan D10) and
 * nothing the engine does would change, which is the point of the engine not depending on which kind of agent calls it.
 *
 * NO POLICY RULES ON ANYTHING. A policy PROPOSES an event; `lib/standing`'s `append` rules on it. Where a policy wants to know
 * whether a proposal would bind it asks the engine (`view.mayCommit`), and where it does not ask, it is ruled on afterwards.
 * So the amounts below are fixed price lists a policy draws from, never a share of a limit or a headroom: a policy that
 * computed with those would be a second copy of the engine's accounting. `__tests__/source-scan.test.ts` refuses
 * arithmetic or an ordering comparison on an identifier or string-keyed property containing `limit`, `amount` or `headroom` (syntactic and file-local; see
 * `support/source-scan.ts`) in this directory, and a string equal to any kind of ruling.
 *
 * WHAT EACH POLICY MODELS (the name of each is the plan's):
 *  - `DelegatorPolicy`: the managers. They hand a part of what they hold to someone below them, and from time to time
 *    withdraw a mandate (plan §10: "time-boxed authority = a scheduled `revoke` event"). They propose only grants whose
 *    parts they can see are sound (a capability the parent has, a depth below the parent's, a grantee not already above
 *    them), and ask the engine by a dry run for the largest size it would admit, so they are not refused for want of a headroom they are
 *    not shown (the view carries none).
 *  - `BuyerPolicy`: a diligent purchaser. It asks `mayCommit` first and only commits what would bind, so its acts are
 *    never ruled `void`.
 *  - `RefunderPolicy`: an agent acting on the last mandate it was given, without asking whether it still holds. After
 *    that mandate is revoked or used up its acts are recorded and ruled `void` (plan §7, c5 and c8).
 *  - `OverreachPolicy`: an agent that acts outside its mandate on purpose, one of eighteen ways (`OVERREACHES`). It is what makes
 *    the engine's refusals fire from inside a running company and not only from a script.
 *  - `CompromisedPolicy`: one agent that, from `COMPROMISE_TICK` on, spends as fast as it can inside what it holds and does
 *    not look (plan §11 case 01: the engine cannot tell compromise from diligence; what it can say is how much was at stake).
 *
 * The generator is consumed in a fixed order, so the order of the five in `POLICIES` and the number of draws each makes are
 * part of what a seed means.
 */

export type Rng = () => number;
export type Policy = (view: OrgView, rng: Rng) => EventInput<CompanyCapability> | null;

// ---- price lists: what the company's agents draw from, in whole currency units ----

/** The size of one purchase order. */
export const ORDER_AMOUNTS = Object.freeze([1_000, 2_500, 5_000, 10_000, 25_000] as const);
/** The size of one refund. */
export const REFUND_AMOUNTS = Object.freeze([500, 1_000, 2_000, 5_000] as const);
/** The size of one act of the compromised agent: large, and not looked at. */
export const DRAIN_AMOUNTS = Object.freeze([10_000, 25_000, 50_000] as const);
/** What a manager hands down. */
export const DELEGATION_LIMITS = Object.freeze([2_000, 5_000, 10_000, 25_000] as const);
/** What a root grant to the cfo is worth. */
export const ROOT_LIMITS = Object.freeze([250_000, 500_000, 1_000_000] as const);
/** The depth a root grant to the cfo allows; the company has six agents, so a chain cannot be longer than six links. */
export const ROOT_DEPTHS = Object.freeze([4, 5, 6] as const);
/** An amount no company in this domain holds, for the acts that are meant to exceed whatever is held. */
export const OVERREACH_AMOUNT = 1_000_000_000;

export const DELEGATE_CHANCE = 0.5;
export const REVIEW_CHANCE = 0.08;
export const REFUND_CHANCE = 0.5;
export const OVERREACH_CHANCE = 0.5;
export const DRAIN_CHANCE = 0.5;
/** The tick from which the compromised agent spends. */
export const COMPROMISE_TICK = 3;
/** The agent that is compromised from `COMPROMISE_TICK` on: the buyer whose cure-grant plan §7 hands out at seq 17. */
export const COMPROMISED: PrincipalId = agent("buyer-a");

// ---- small helpers over the generator ----

/** An integer in `[0, n)`. */
function below(rng: Rng, n: number): number {
  return Math.min(Math.floor(rng() * n), n - 1);
}

function pickFrom<T>(rng: Rng, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[below(rng, items.length)];
}

function pick<T>(rng: Rng, items: readonly [T, ...T[]]): T {
  return items[below(rng, items.length)] ?? items[0];
}

/** A non-empty subset of `caps`, each kept with probability 0.6 and one chosen if none was. */
function subsetOf(rng: Rng, caps: NonEmptyReadonlyArray<CompanyCapability>): NonEmptyReadonlyArray<CompanyCapability> {
  const [first, ...rest] = caps.filter(() => rng() < 0.6);
  return first === undefined ? [pick(rng, caps)] : [first, ...rest];
}

/** `sizes` from a ceiling drawn at random down to the smallest, largest first: pure index work over a list, no value in it is read. */
function fromCeiling(rng: Rng, sizes: readonly number[]): readonly number[] {
  const ceiling = below(rng, sizes.length);
  return sizes.filter((_, index) => index <= ceiling).reverse();
}

/** A grant or commit id no earlier event of the log carries: the position the event would take. */
function freshId(view: OrgView, prefix: string): string {
  return `${prefix}-${view.head + 1}`;
}

const live = (view: OrgView): readonly GrantView[] => view.grants.filter((entry) => entry.live);
const dead = (view: OrgView): readonly GrantView[] => view.grants.filter((entry) => !entry.live);
const canDelegate = (entry: GrantView): boolean => entry.grant.depth > 0;
const lacking = (entry: GrantView): CompanyCapability | undefined => CAPABILITIES.find((cap) => !entry.grant.capabilities.includes(cap));
const heldBy = (view: OrgView, who: PrincipalId, cap: CompanyCapability): readonly GrantView[] =>
  view.grants.filter((entry) => entry.grant.grantee === who && entry.grant.capabilities.includes(cap));

interface Hand {
  readonly parent: GrantView;
  readonly grantor?: PrincipalId;
  readonly grantee: PrincipalId;
  readonly capabilities: NonEmptyReadonlyArray<CompanyCapability>;
  readonly depth: number;
  readonly limit: number;
}

/** A grant event under `hand.parent`. The grantor is the parent's holder unless the act says otherwise. */
function delegation(view: OrgView, hand: Hand, id: string = freshId(view, "auto-g")): EventInput<CompanyCapability> {
  return {
    kind: "grant",
    grant: {
      id: grantId(id),
      parent: hand.parent.grant.id,
      grantor: hand.grantor ?? hand.parent.grant.grantee,
      grantee: hand.grantee,
      capabilities: hand.capabilities,
      limit: hand.limit,
      depth: hand.depth,
    },
  };
}

function purchase(view: OrgView, who: PrincipalId, under: GrantView, cap: CompanyCapability, amount: number): EventInput<CompanyCapability> {
  return { kind: "commit", commit: { id: commitId(freshId(view, "auto-c")), actor: who, actedUnder: under.grant.id, capability: cap, amount } };
}

// ---- the five policies ----

export const DelegatorPolicy: Policy = (view, rng) => {
  const holders = live(view);
  if (!holders.some((entry) => entry.grant.parent === null)) {
    // Nothing is live at the top: dana issues a new root grant to the cfo. It is the only event this domain writes with the root as grantor.
    return {
      kind: "grant",
      grant: { id: grantId(freshId(view, "auto-g")), parent: null, grantor: ROOT, grantee: agent("cfo"), capabilities: CAPABILITIES, limit: pick(rng, ROOT_LIMITS), depth: pick(rng, ROOT_DEPTHS) },
    };
  }

  const roll = rng();
  if (roll < DELEGATE_CHANCE) {
    const parent = pickFrom(rng, holders.filter(canDelegate));
    if (parent === undefined) return null;
    const grantee = pickFrom(rng, AGENTS.filter((who) => !parent.trail.includes(who)));
    if (grantee === undefined) return null;
    // Usually one link shorter than the parent allows, so that chains reach the depth the plan's heir-climb needs; sometimes shorter still.
    const depth = rng() < 0.6 ? parent.grant.depth - 1 : below(rng, parent.grant.depth);
    const capabilities = subsetOf(rng, parent.grant.capabilities);
    // The size: from a ceiling drawn at random, the largest the engine would admit. It asks by a dry run, so the manager is never refused for
    // want of headroom it was not shown, and it needs no headroom arithmetic of its own; when not even the smallest fits there is nothing to hand down.
    for (const limit of fromCeiling(rng, DELEGATION_LIMITS)) {
      const event = delegation(view, { parent, grantee, capabilities, depth, limit });
      if (view.dryRun(event).ok) return event;
    }
    return null;
  }

  if (roll < DELEGATE_CHANCE + REVIEW_CHANCE) {
    // A review: the grantor of some live grant withdraws it. Who withdraws is the grantor, which is who the engine will accept.
    const target = pickFrom(rng, holders);
    if (target === undefined) return null;
    return { kind: "revoke", grantId: target.grant.id, by: target.grant.grantor };
  }
  return null;
};

const BUYERS: NonEmptyReadonlyArray<PrincipalId> = [agent("ops"), agent("buyer-a"), agent("buyer-b")];

export const BuyerPolicy: Policy = (view, rng) => {
  const who = pick(rng, BUYERS);
  const under = pickFrom(rng, heldBy(view, who, "purchase").filter((entry) => entry.live));
  if (under === undefined) return null;
  const event = purchase(view, who, under, "purchase", pick(rng, ORDER_AMOUNTS));
  if (event.kind !== "commit") return null;
  const asked = view.mayCommit(event.commit);
  return asked.ok && asked.verdict.kind === "warranted" ? event : null;
};

const REFUNDERS: NonEmptyReadonlyArray<PrincipalId> = [agent("support"), agent("refunder")];

export const RefunderPolicy: Policy = (view, rng) => {
  if (rng() >= REFUND_CHANCE) return null;
  const who = pick(rng, REFUNDERS);
  // The newest mandate it was ever given, live or not: it does not ask.
  const mandate = heldBy(view, who, "refund").at(-1);
  if (mandate === undefined) return null;
  return purchase(view, who, mandate, "refund", pick(rng, REFUND_AMOUNTS));
};

export const CompromisedPolicy: Policy = (view, rng) => {
  if (view.tick < COMPROMISE_TICK || rng() >= DRAIN_CHANCE) return null;
  const mandate = heldBy(view, COMPROMISED, "purchase").at(-1);
  if (mandate === undefined) return null;
  return purchase(view, COMPROMISED, mandate, "purchase", pick(rng, DRAIN_AMOUNTS));
};

// ---- overreach: eighteen ways to act outside a mandate ----

export type OverreachName =
  | "widen-scope"
  | "over-delegate"
  | "delegate-past-depth"
  | "mint-root"
  | "delegate-borrowed"
  | "keep-depth"
  | "delegate-upward"
  | "orphan-grant"
  | "reuse-grant-id"
  | "negative-limit"
  | "delegate-from-dead"
  | "revoke-own-grant"
  | "revoke-ghost"
  | "revoke-twice"
  | "borrowed-commit"
  | "out-of-scope-commit"
  | "oversized-commit"
  | "phantom-commit";

export interface Overreach {
  readonly name: OverreachName;
  /** The proposal, or `null` when the company holds nothing this act could be aimed at. It is never checked here. */
  readonly build: Policy;
}

/** An id that no event of any log of this domain carries: every policy id is `auto-g-<n>` or `auto-c-<n>` with `<n>` a number. */
const NOWHERE = "auto-g-nowhere";

function aimed(rng: Rng, from: readonly GrantView[], make: (entry: GrantView) => EventInput<CompanyCapability> | null): EventInput<CompanyCapability> | null {
  const entry = pickFrom(rng, from);
  return entry === undefined ? null : make(entry);
}

export const OVERREACHES: readonly [Overreach, ...Overreach[]] = [
  {
    name: "widen-scope",
    build: (view, rng) =>
      aimed(rng, live(view).filter(canDelegate).filter((entry) => lacking(entry) !== undefined), (parent) => {
        const missing = lacking(parent);
        return missing === undefined ? null : delegation(view, { parent, grantee: pick(rng, AGENTS), capabilities: [missing], depth: 0, limit: pick(rng, DELEGATION_LIMITS) });
      }),
  },
  {
    name: "over-delegate",
    build: (view, rng) =>
      aimed(rng, live(view).filter(canDelegate), (parent) => {
        const grantee = pickFrom(rng, AGENTS.filter((who) => !parent.trail.includes(who)));
        return grantee === undefined ? null : delegation(view, { parent, grantee, capabilities: parent.grant.capabilities, depth: parent.grant.depth - 1, limit: OVERREACH_AMOUNT });
      }),
  },
  {
    name: "delegate-past-depth",
    build: (view, rng) =>
      aimed(rng, live(view).filter((entry) => !canDelegate(entry)), (parent) =>
        delegation(view, { parent, grantee: pick(rng, AGENTS), capabilities: parent.grant.capabilities, depth: 0, limit: pick(rng, DELEGATION_LIMITS) }),
      ),
  },
  {
    name: "mint-root",
    build: (view, rng) => ({
      kind: "grant",
      grant: { id: grantId(freshId(view, "auto-g")), parent: null, grantor: pick(rng, AGENTS), grantee: pick(rng, AGENTS), capabilities: CAPABILITIES, limit: pick(rng, DELEGATION_LIMITS), depth: 0 },
    }),
  },
  {
    name: "delegate-borrowed",
    build: (view, rng) =>
      aimed(rng, live(view).filter(canDelegate), (parent) => {
        const grantor = pickFrom(rng, AGENTS.filter((who) => who !== parent.grant.grantee));
        return grantor === undefined ? null : delegation(view, { parent, grantor, grantee: pick(rng, AGENTS), capabilities: parent.grant.capabilities, depth: parent.grant.depth - 1, limit: pick(rng, DELEGATION_LIMITS) });
      }),
  },
  {
    name: "keep-depth",
    build: (view, rng) =>
      aimed(rng, live(view).filter(canDelegate), (parent) => {
        const grantee = pickFrom(rng, AGENTS.filter((who) => !parent.trail.includes(who)));
        return grantee === undefined ? null : delegation(view, { parent, grantee, capabilities: parent.grant.capabilities, depth: parent.grant.depth, limit: pick(rng, DELEGATION_LIMITS) });
      }),
  },
  {
    name: "delegate-upward",
    build: (view, rng) =>
      aimed(rng, live(view).filter(canDelegate), (parent) =>
        delegation(view, { parent, grantee: parent.grant.grantee, capabilities: parent.grant.capabilities, depth: parent.grant.depth - 1, limit: pick(rng, DELEGATION_LIMITS) }),
      ),
  },
  {
    name: "orphan-grant",
    build: (view, rng) => ({
      kind: "grant",
      grant: { id: grantId(freshId(view, "auto-g")), parent: grantId(NOWHERE), grantor: pick(rng, AGENTS), grantee: pick(rng, AGENTS), capabilities: CAPABILITIES, limit: pick(rng, DELEGATION_LIMITS), depth: 0 },
    }),
  },
  {
    name: "reuse-grant-id",
    build: (view, rng) =>
      aimed(rng, view.grants, (taken) =>
        aimed(rng, live(view).filter(canDelegate), (parent) =>
          delegation(view, { parent, grantee: pick(rng, AGENTS), capabilities: parent.grant.capabilities, depth: parent.grant.depth - 1, limit: pick(rng, DELEGATION_LIMITS) }, taken.grant.id),
        ),
      ),
  },
  {
    name: "negative-limit",
    build: (view, rng) =>
      aimed(rng, live(view).filter(canDelegate), (parent) =>
        delegation(view, { parent, grantee: pick(rng, AGENTS), capabilities: parent.grant.capabilities, depth: 0, limit: -1 }),
      ),
  },
  {
    name: "delegate-from-dead",
    build: (view, rng) =>
      aimed(rng, dead(view), (parent) => delegation(view, { parent, grantee: pick(rng, AGENTS), capabilities: parent.grant.capabilities, depth: 0, limit: 0 })),
  },
  {
    name: "revoke-own-grant",
    build: (view, rng) => aimed(rng, live(view), (target) => ({ kind: "revoke", grantId: target.grant.id, by: target.grant.grantee })),
  },
  {
    name: "revoke-ghost",
    build: (_view, rng) => ({ kind: "revoke", grantId: grantId(NOWHERE), by: pick(rng, AGENTS) }),
  },
  {
    name: "revoke-twice",
    build: (view, rng) => aimed(rng, dead(view), (target) => ({ kind: "revoke", grantId: target.grant.id, by: target.grant.grantor })),
  },
  {
    name: "borrowed-commit",
    build: (view, rng) =>
      aimed(rng, view.grants, (under) => {
        const actor = pickFrom(rng, AGENTS.filter((who) => who !== under.grant.grantee));
        return actor === undefined ? null : purchase(view, actor, under, under.grant.capabilities[0], pick(rng, ORDER_AMOUNTS));
      }),
  },
  {
    name: "out-of-scope-commit",
    build: (view, rng) =>
      aimed(rng, live(view).filter((entry) => lacking(entry) !== undefined), (under) => {
        const missing = lacking(under);
        return missing === undefined ? null : purchase(view, under.grant.grantee, under, missing, pick(rng, ORDER_AMOUNTS));
      }),
  },
  {
    name: "oversized-commit",
    build: (view, rng) => aimed(rng, live(view), (under) => purchase(view, under.grant.grantee, under, under.grant.capabilities[0], OVERREACH_AMOUNT)),
  },
  {
    name: "phantom-commit",
    build: (view, rng) => ({
      kind: "commit",
      commit: { id: commitId(freshId(view, "auto-c")), actor: pick(rng, AGENTS), actedUnder: grantId(NOWHERE), capability: pick(rng, CAPABILITIES), amount: pick(rng, ORDER_AMOUNTS) },
    }),
  },
];

export const OverreachPolicy: Policy = (view, rng) => {
  if (rng() >= OVERREACH_CHANCE) return null;
  return pick(rng, OVERREACHES).build(view, rng);
};

// ---- the order they are stepped in ----

/** The fixed order `runQuarter` steps the policies in, once per tick. */
export const POLICIES = Object.freeze([
  { name: "DelegatorPolicy", policy: DelegatorPolicy },
  { name: "BuyerPolicy", policy: BuyerPolicy },
  { name: "RefunderPolicy", policy: RefunderPolicy },
  { name: "OverreachPolicy", policy: OverreachPolicy },
  { name: "CompromisedPolicy", policy: CompromisedPolicy },
] as const);
export type PolicyName = (typeof POLICIES)[number]["name"];
