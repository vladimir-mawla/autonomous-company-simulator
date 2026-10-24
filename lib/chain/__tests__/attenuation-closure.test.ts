import { describe, expect, it } from "vitest";
import { MAX_ROOT_DEPTH, grantId, principalId } from "../../contracts/index.js";
import type { Charter, Grant, GrantId, PrincipalId } from "../../contracts/index.js";
import { chainOf, checkGrantStructure, liveAuthorityAbove, readCharter, readEventInput, trailOf } from "../index.js";
import type { IntakeRejection, StructureRejection } from "../index.js";
import { CAPABILITIES, mulberry32 } from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * The attenuation-closure property (plan section 6, M3, layer 2): over a seeded generator of grants, EVERY grant
 * that intake and `checkGrantStructure` accept satisfies, when looked at as plain data:
 *
 *   - `grantor` is the parent's `grantee`;
 *   - `capabilities` are a subset of the parent's;
 *   - `depth` is at most the parent's minus one (and the parent's is at least 1);
 *   - no principal appears twice on the chain's trail (the charter root, then each grantee);
 *   - the chain has at most `MAX_ROOT_DEPTH + 1` grants and ends at a root grant whose grantor is a charter root;
 *   - the id was not already in the tree, and no link on the chain was revoked when it was admitted.
 *
 * and every grant that is REFUSED is refused for a reason that is true of that grant's data. The assertions are
 * written over the data of the grants and the tree, by an independent walk up the `parent` pointers, not by calling
 * the predicates under test: a deleted rule would otherwise delete the check on itself.
 *
 * The generator's reach is itself asserted. A property over a generator that never produces a refusal proves
 * nothing, so a coverage test requires that every rejection kind M3 owns (the nine structural ones and the two from
 * intake) occurred at least once, and that nothing M3 does not own appeared. It draws principals from a pool of 5
 * on purpose, so a repeated principal on a chain is the common case rather than the lucky one (plan section 6). A
 * pool of 5 cannot, however, build a chain of `MAX_ROOT_DEPTH + 1` = 8 grants (the trail needs 9 distinct
 * principals), so the longest-chain end of the property is run again with a pool of 12.
 *
 * To replay a failing case: the failure message carries the seed and the step; `runWorld(seed, pool, ...)` is
 * deterministic.
 */

const SEEDS = 1000;
const STEPS = 100;

type Counts = Map<string, number>;

interface WorldOptions {
  /** How many distinct principals the world draws from. Roots are always the first two. */
  readonly pool: number;
  /**
   * Tilt the generator towards long, well-formed chains: parents are mostly taken from grants that can still
   * delegate, depths mostly narrow by exactly one, grantors are almost always the holder, and an unknown parent
   * is rare. Without it a chain of the maximum length is a seven-step run of luck and is not reached; with it
   * every other kind of refusal is still produced (just less often), and the assertions are the same.
   */
  readonly eager?: boolean;
}

/** Every refusal the pipeline can give, intake's two, the nine structural ones, and `hostile` (which this generator never provokes). */
type Refusal = IntakeRejection | StructureRejection | { readonly kind: "hostile" };

interface Outcome {
  readonly steps: readonly string[];
  readonly counts: Counts;
  /** The longest chain of any grant accepted in this world. */
  readonly longestChain: number;
}

const ROOT_NAMES = ["p0", "p1"] as const;

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("internal error: picked from an empty list");
  return item;
}

/** A non-empty subset of `from`, in a random order. */
function someOf(random: () => number, from: readonly string[]): string[] {
  const chosen = from.filter(() => random() < 0.6);
  if (chosen.length === 0) chosen.push(pick(random, from));
  for (let index = chosen.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const held = chosen[index];
    const other = chosen[swap];
    if (held === undefined || other === undefined) throw new Error("internal error: shuffle");
    chosen[index] = other;
    chosen[swap] = held;
  }
  return chosen;
}

function bump(counts: Counts, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * Play one world: `STEPS` random proposals (a grant, or occasionally a revocation recorded directly in the tree,
 * since revoking is M5's and this layer only has to see its effect). Each proposal goes through the real
 * `readEventInput` and `checkGrantStructure`; an accepted grant is added to the tree. `check` is called for each
 * outcome so a test can assert on it with the seed and step in hand.
 */
function runWorld(
  seed: number,
  options: WorldOptions,
  check: (info: { seed: number; step: number; charter: Charter<Cap>; grants: Map<GrantId, Grant<Cap>>; revokedAt: Map<GrantId, number>; outcome: string; grant: Grant<Cap> | undefined; rejection: Refusal | undefined; hadId: boolean }) => void,
): Outcome {
  const random = mulberry32(seed);
  const names = Array.from({ length: options.pool }, (_, index) => `p${index}`);
  const charterRead = readCharter<Cap>({ roots: [principalId("p0"), principalId("p1")], capabilities: CAPABILITIES });
  if (!charterRead.ok) throw new Error("internal error: the test charter was refused");
  const charter = charterRead.charter;

  const grants = new Map<GrantId, Grant<Cap>>();
  const revokedAt = new Map<GrantId, number>();
  const tree = { grants, revokedAt };
  const counts: Counts = new Map();
  const steps: string[] = [];
  let seq = 0;
  let counter = 0;
  let longestChain = 0;

  for (let step = 1; step <= STEPS; step++) {
    const ids = [...grants.keys()];

    if (ids.length > 0 && random() < 0.07) {
      const target = pick(random, ids);
      if (!revokedAt.has(target)) revokedAt.set(target, ++seq);
      steps.push(`revoke:${target}`);
      bump(counts, "revoked");
      continue;
    }

    // ---- build a proposal that is usually close to valid and sometimes wrong in exactly one way ----
    const asRoot = ids.length === 0 || random() < 0.2;
    const eager = options.eager === true;
    const deep = ids.filter((id) => (grants.get(id)?.depth ?? 0) >= 1);
    const parentGrant = asRoot ? undefined : grants.get(random() < (eager ? 0.85 : 0.5) && deep.length > 0 ? pick(random, deep) : pick(random, ids));
    counter += 1;

    const id = ids.length > 0 && random() < 0.06 ? pick(random, ids) : `g${counter}`;
    const parent = parentGrant === undefined ? null : random() < (eager ? 0.02 : 0.08) ? `ghost${counter}` : parentGrant.id;
    const grantor =
      parentGrant === undefined
        ? random() < 0.65
          ? pick(random, ROOT_NAMES)
          : pick(random, names)
        : random() < (eager ? 0.95 : 0.8)
          ? parentGrant.grantee
          : pick(random, names);
    const grantee = pick(random, names);
    const vocabulary: readonly string[] = parentGrant !== undefined && random() < 0.85 ? parentGrant.capabilities : CAPABILITIES;
    const capabilities = someOf(random, vocabulary);
    if (random() < 0.03) capabilities.push("bogus-capability");
    const depth = parentGrant !== undefined && random() < (eager ? 0.9 : 0.65) ? Math.max(parentGrant.depth - 1, 0) : parentGrant === undefined && random() < 0.4 ? MAX_ROOT_DEPTH : Math.floor(random() * (MAX_ROOT_DEPTH + 1));

    const payload: Record<string, unknown> = { id, parent, grantor, grantee, capabilities, limit: Math.floor(random() * 1000), depth };
    const spoil = random();
    if (spoil < 0.02) payload["limit"] = -1;
    else if (spoil < 0.03) payload["id"] = "";
    else if (spoil < 0.04) payload["capabilities"] = [capabilities[0] ?? "purchase", capabilities[0] ?? "purchase"];

    const hadId = grants.has(grantId(typeof payload["id"] === "string" ? payload["id"] : ""));

    // ---- the real pipeline ----
    const read = readEventInput(charter, { kind: "grant", grant: payload });
    if (!read.ok) {
      const refusal: Refusal = read.failure.kind === "invalid" ? read.failure.rejection : { kind: "hostile" };
      steps.push(refusal.kind);
      bump(counts, refusal.kind);
      check({ seed, step, charter, grants, revokedAt, outcome: refusal.kind, grant: undefined, rejection: refusal, hadId });
      continue;
    }
    if (read.event.kind !== "grant") throw new Error("internal error: a grant came back as another kind");
    const candidate = read.event.grant;

    const structure = checkGrantStructure(charter, tree, candidate);
    if (!structure.ok) {
      steps.push(structure.rejection.kind);
      bump(counts, structure.rejection.kind);
      check({ seed, step, charter, grants, revokedAt, outcome: structure.rejection.kind, grant: candidate, rejection: structure.rejection, hadId });
      continue;
    }

    // Checked BEFORE the grant is added, so "no link was revoked" and "the id was free" mean what they say.
    check({ seed, step, charter, grants, revokedAt, outcome: "accepted", grant: candidate, rejection: undefined, hadId });
    grants.set(candidate.id, candidate);
    steps.push(`accepted:${candidate.id}`);
    bump(counts, "accepted");
    const length = chainOf(tree, candidate.id)?.length ?? 0;
    longestChain = Math.max(longestChain, length);
  }

  return { steps, counts, longestChain };
}

/** The chain of grants from the root grant to `grant` by walking `parent` pointers, or `undefined` if it does not end. */
function walkUp(grants: ReadonlyMap<GrantId, Grant<Cap>>, grant: Grant<Cap>): Grant<Cap>[] | undefined {
  const chain: Grant<Cap>[] = [];
  let current: Grant<Cap> | undefined = grant;
  for (let hops = 0; hops < 50 && current !== undefined; hops++) {
    chain.unshift(current);
    if (current.parent === null) return chain;
    current = grants.get(current.parent);
  }
  return undefined;
}

const MESSAGE = (seed: number, step: number, what: string) => `seed ${seed}, step ${step}: ${what}`;

type Info = Parameters<Parameters<typeof runWorld>[2]>[0];

/** What must be true of every accepted grant, looked at as data. `grants` does not yet contain it. */
function assertAcceptedGrantIsAttenuated(info: Info): void {
  const { seed, step, charter, grants, revokedAt, hadId } = info;
  const grant = info.grant;
  if (grant === undefined) throw new Error("internal error: no grant to check");
  const said = (what: string) => MESSAGE(seed, step, what);

  expect(hadId, said("the id was already in the tree")).toBe(false);

  const parentChain = grant.parent === null ? [] : walkUp(grants, grants.get(grant.parent) ?? grant);
  if (grant.parent !== null) {
    expect(grants.has(grant.parent), said("the parent is in the tree")).toBe(true);
    expect(parentChain, said("the parent's ancestry reaches a root grant")).toBeDefined();
  }
  const chain = [...(parentChain ?? []), grant];

  expect(chain.length, said("chain length")).toBeLessThanOrEqual(MAX_ROOT_DEPTH + 1);
  const first = chain[0];
  expect(first?.parent, said("the chain starts at a root grant")).toBeNull();
  expect(charter.roots.includes((first as Grant<Cap>).grantor), said("the root grant's grantor is a charter root")).toBe(true);

  for (let index = 1; index < chain.length; index++) {
    const child = chain[index] as Grant<Cap>;
    const above = chain[index - 1] as Grant<Cap>;
    expect(child.grantor, said(`grantor of ${child.id} is the grantee of ${above.id}`)).toBe(above.grantee);
    for (const capability of child.capabilities) {
      expect(above.capabilities, said(`capability ${capability} of ${child.id} is a capability of ${above.id}`)).toContain(capability);
    }
    expect(above.depth, said(`${above.id} permits further delegation`)).toBeGreaterThanOrEqual(1);
    expect(child.depth, said(`depth of ${child.id} is below ${above.id}'s`)).toBeLessThanOrEqual(above.depth - 1);
  }

  const principals: PrincipalId[] = [(first as Grant<Cap>).grantor, ...chain.map((link) => link.grantee)];
  expect(new Set(principals).size, said(`no principal repeats on the trail ${principals.join(" > ")}`)).toBe(principals.length);

  for (const link of parentChain ?? []) {
    expect(revokedAt.has(link.id), said(`${link.id} on the chain was revoked when the grant was admitted`)).toBe(false);
  }
}

/** What the refusal said must be true of the data it was given. */
function assertRefusalIsTrue(info: Info): void {
  const { seed, step, charter, grants, revokedAt, hadId } = info;
  const grant = info.grant;
  const rejection = info.rejection;
  if (rejection === undefined) return;
  const said = (what: string) => MESSAGE(seed, step, `${rejection.kind}: ${what}`);
  const parent = grant === undefined || grant.parent === null ? undefined : grants.get(grant.parent);
  const parentChain = parent === undefined ? undefined : walkUp(grants, parent);

  switch (rejection.kind) {
    case "invalid-event-shape":
    case "unknown-capability":
      // Intake's two kinds are produced before there is a grant to look at; their payloads are tested in intake.test.ts.
      return;
    case "duplicate-id":
      expect(hadId, said("the id was in the tree")).toBe(true);
      return;
    case "not-a-root":
      expect(grant?.parent, said("it was a root grant")).toBeNull();
      expect(charter.roots.includes((grant as Grant<Cap>).grantor), said("its grantor is a charter root")).toBe(false);
      return;
    case "unknown-parent":
      // The generator never builds a hand-made hostile tree, so here the only way is a parent that is not in the tree.
      expect(grant?.parent, said("it had a parent")).not.toBeNull();
      expect(grants.has((grant as Grant<Cap>).parent as GrantId), said("the parent was not in the tree")).toBe(false);
      return;
    case "parent-dead": {
      const dead = rejection.deadGrant;
      const nearest = (parentChain ?? []).find((link) => revokedAt.has(link.id));
      expect(nearest?.id, said("the dead grant is the revoked link nearest the root")).toBe(dead);
      return;
    }
    case "grantor-not-holder": {
      expect(rejection.holder, said("the holder named is the parent's grantee")).toBe(parent?.grantee);
      expect(rejection.grantor, said("the grantor named is the grant's")).toBe(grant?.grantor);
      expect(grant?.grantor, said("grantor differs from the holder")).not.toBe(parent?.grantee);
      return;
    }
    case "capability-widening": {
      const capability = rejection.capability;
      expect(grant?.capabilities, said("the capability is one the grant asked for")).toContain(capability);
      expect(parent?.capabilities, said("the parent does not have it")).not.toContain(capability);
      return;
    }
    case "depth-exhausted":
      expect(parent?.depth, said("the parent's depth is 0")).toBe(0);
      return;
    case "depth-not-narrowed": {
      expect(rejection.parentDepth, said("parentDepth is the parent's")).toBe(parent?.depth);
      expect(rejection.requested, said("requested is the grant's")).toBe(grant?.depth);
      expect(rejection.requested, said("not below the parent's")).toBeGreaterThanOrEqual(rejection.parentDepth);
      expect(rejection.parentDepth, said("the parent could still delegate")).toBeGreaterThanOrEqual(1);
      return;
    }
    case "principal-cycle": {
      const principal = rejection.principal;
      const above: PrincipalId[] =
        grant?.parent === null
          ? [(grant as Grant<Cap>).grantor]
          : [(parentChain?.[0] as Grant<Cap>).grantor, ...(parentChain ?? []).map((link) => link.grantee)];
      const trail = [...above, (grant as Grant<Cap>).grantee];
      expect(trail.filter((candidate) => candidate === principal).length, said(`${principal} appears twice on ${trail.join(" > ")}`)).toBeGreaterThanOrEqual(2);
      return;
    }
    case "hostile":
      throw new Error("this generator never provokes a hostile read");
  }
}

const OWNED_KINDS = [
  "invalid-event-shape",
  "unknown-capability",
  "duplicate-id",
  "not-a-root",
  "unknown-parent",
  "parent-dead",
  "grantor-not-holder",
  "capability-widening",
  "depth-exhausted",
  "depth-not-narrowed",
  "principal-cycle",
] as const;

describe("attenuation closure: every accepted grant is attenuated, every refusal is true", () => {
  it(`${SEEDS} seeds x ${STEPS} steps, principal pool of 5: accepted grants satisfy the closure, refusals are sound`, () => {
    const totals: Counts = new Map();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const outcome = runWorld(seed, { pool: 5 }, (info) => {
        if (info.outcome === "accepted") assertAcceptedGrantIsAttenuated(info);
        else assertRefusalIsTrue(info);
      });
      for (const [key, count] of outcome.counts) totals.set(key, (totals.get(key) ?? 0) + count);
    }
    expect(totals.get("accepted") ?? 0).toBeGreaterThan(1000);
  });

  it("COVERAGE: the generator reaches every rejection kind M3 owns, and no other", () => {
    const totals: Counts = new Map();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { counts } = runWorld(seed, { pool: 5 }, () => undefined);
      for (const [key, count] of counts) totals.set(key, (totals.get(key) ?? 0) + count);
    }
    const reached = OWNED_KINDS.filter((kind) => (totals.get(kind) ?? 0) > 0);
    const missing = OWNED_KINDS.filter((kind) => (totals.get(kind) ?? 0) === 0);
    expect(missing, `never produced: ${missing.join(", ")}; counts ${JSON.stringify([...totals])}`).toEqual([]);
    expect(reached).toHaveLength(11);

    // Nothing but those eleven refusals, plus the two bookkeeping keys of this test, was ever counted.
    expect([...totals.keys()].filter((key) => !(OWNED_KINDS as readonly string[]).includes(key)).sort()).toEqual(["accepted", "revoked"]);

    // Reaching a kind once could be luck; each is reached many times (the floor is far below what the seeds give).
    for (const kind of OWNED_KINDS) expect(totals.get(kind), kind).toBeGreaterThanOrEqual(100);
  });

  it("with a pool of 12 principals, tilted towards long chains, the closure still holds and an accepted chain of the maximum length MAX_ROOT_DEPTH + 1 is reached", () => {
    let longest = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const outcome = runWorld(seed, { pool: 12, eager: true }, (info) => {
        if (info.outcome === "accepted") assertAcceptedGrantIsAttenuated(info);
        else assertRefusalIsTrue(info);
      });
      longest = Math.max(longest, outcome.longestChain);
    }
    expect(longest).toBe(MAX_ROOT_DEPTH + 1);
  });

  it("with a pool of 5 the longest accepted chain is at most 4 grants: a trail of 5 principals is all the pool can fill", () => {
    let longest = 0;
    for (let seed = 1; seed <= SEEDS; seed++) longest = Math.max(longest, runWorld(seed, { pool: 5 }, () => undefined).longestChain);
    expect(longest).toBeLessThanOrEqual(4);
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it("the walkers agree with the data for every accepted grant: chain, trail and the principals above it", () => {
    for (let seed = 1; seed <= 200; seed++) {
      runWorld(seed, { pool: 12, eager: true }, (info) => {
        if (info.outcome !== "accepted" || info.grant === undefined) return;
        const tree = { grants: new Map([...info.grants, [info.grant.id, info.grant]]), revokedAt: info.revokedAt };
        const walked = walkUp(tree.grants, info.grant);
        const found = chainOf(tree, info.grant.id);
        expect(found, MESSAGE(info.seed, info.step, "chainOf is defined for an accepted grant")).toBeDefined();
        expect(found, MESSAGE(info.seed, info.step, "chainOf equals the independent walk")).toEqual(walked?.map((link) => link.id));
        const trail = trailOf(tree, found as NonNullable<typeof found>);
        expect(trail, MESSAGE(info.seed, info.step, "trailOf")).toEqual([(walked?.[0] as Grant<Cap>).grantor, ...(walked ?? []).map((link) => link.grantee)]);
        // Nothing on its chain was revoked at admission, so everyone who granted along it is above it.
        expect(liveAuthorityAbove(tree, info.grant.id), MESSAGE(info.seed, info.step, "liveAuthorityAbove")).toEqual((walked ?? []).map((link) => link.grantor));
      });
    }
  });

  it("the generator is deterministic: one seed replays exactly, and different seeds differ", () => {
    const first = runWorld(7, { pool: 5 }, () => undefined);
    const again = runWorld(7, { pool: 5 }, () => undefined);
    const other = runWorld(8, { pool: 5 }, () => undefined);
    expect(again.steps).toEqual(first.steps);
    expect(other.steps).not.toEqual(first.steps);
    expect(first.steps).toHaveLength(STEPS);
  });

  it("mulberry32 is a function of its seed alone and stays inside [0, 1)", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const values = Array.from({ length: 1000 }, () => a());
    expect(values).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(new Set(values).size).toBeGreaterThan(990);
  });
});
