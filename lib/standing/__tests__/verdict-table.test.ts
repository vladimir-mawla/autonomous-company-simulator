import { describe, expect, it } from "vitest";
import { MAX_ROOT_DEPTH } from "../../contracts/index.js";
import type { Breach, Commitment, EventInput, Verdict } from "../../contracts/index.js";
import { standingOf } from "../index.js";
import { judgeCommit } from "../verdict.js";
import {
  CHARTER,
  DEEP_LENGTH,
  commit,
  commitEvent,
  deepChainEvents,
  deepGrantor,
  deepHolder,
  g,
  grant,
  judge,
  logOf,
  ORG,
  mustFold,
  p,
  revokeEvent,
  treeOf,
} from "./fixtures.js";
import type { Cap } from "./fixtures.js";

/**
 * THE VERDICT TABLE: `judgeCommit`'s five breaches, one row each, then what hides what (plan §4.3, §6 M5 "Falsifiable
 * check" (1)).
 *
 * Every verdict here is asked three ways that must agree (`judge` in fixtures: `mayCommit`, `append`, the record `fold`
 * rebuilds), so the table exercises the shared admission path and not a private entry point. Layers:
 *
 *   1. ONE ROW PER BREACH, MASKING-AWARE. Each row has a `violating` scenario that must be reported as exactly that
 *      breach, and a `repaired` one that differs by the ONE thing that fixes it and must be `warranted`. If the violating
 *      fixture also broke a later rule, repairing the first would leave the second and the repaired scenario would not be
 *      warranted, so a row that passes shows its fixture breaks only its own rule.
 *   2. EVERY COMBINATION. The five breaches are five switches; all 31 non-empty combinations are built, and each must be
 *      reported as the earliest switch set (plan: "a commit that breaches 2 to 3 rules reports only the first"; this is
 *      the pair and the triple of every precedence step, and the rest). Then the breaches are peeled off one at a time
 *      and each reveals the next.
 *   3. THE LONGEST CHAIN. The same questions on a chain of `MAX_ROOT_DEPTH + 1` = 8 grants, with the dead link at every
 *      position.
 *   4. `judgeCommit` ON A TREE THAT NO FOLD BUILT: a hand-built hostile tree fails closed.
 */

// The small org of fixtures.ts (`ORG`, seqs 1 to 4): G1 dana -> cfo, G2 cfo -> ops, G3 ops -> buyer (purchase, 1 000), G4 cfo -> other.
const BASE = ORG;

/** What a scenario does before the commit under test: extra events after `BASE`, and the commit. */
interface Scenario {
  readonly after: readonly EventInput<Cap>[];
  readonly commit: Commitment<Cap>;
}

const verdictOf = (scenario: Scenario): Verdict => judge(CHARTER, [...BASE, ...scenario.after], scenario.commit);

const GOOD = (id = "k"): Commitment<Cap> => commit(id, "buyer", "G3", "purchase", 1_000);
const breachOf = (verdict: Verdict): Breach => {
  if (verdict.kind !== "breached") throw new Error(`expected a breach, got ${JSON.stringify(verdict)}`);
  return verdict.breach;
};

describe("the unbreached commit: warranted, with the whole chain and the whole trail", () => {
  it("acting under G3 as its holder, for a granted capability, for exactly the headroom, is warranted with chain G1 G2 G3 and trail dana cfo ops buyer", () => {
    expect(verdictOf({ after: [], commit: GOOD() })).toStrictEqual({
      kind: "warranted",
      warrant: { chain: [g("G1"), g("G2"), g("G3")], trail: [p("dana"), p("cfo"), p("ops"), p("buyer")] },
    });
  });

  it("a commit of 0 is warranted, even when the headroom is already 0", () => {
    const spendAll: EventInput<Cap> = commitEvent(commit("all", "buyer", "G3", "purchase", 1_000));
    expect(verdictOf({ after: [spendAll], commit: commit("zero", "buyer", "G3", "purchase", 0) }).kind).toBe("warranted");
    expect(breachOf(verdictOf({ after: [spendAll], commit: commit("one", "buyer", "G3", "purchase", 1) }))).toStrictEqual({
      kind: "over-limit",
      grantId: g("G3"),
      requested: 1,
      headroom: 0,
    });
  });
});

describe("one row per breach: the violating scenario is exactly that breach, the repaired one is warranted", () => {
  interface Row {
    readonly name: string;
    readonly violating: Scenario;
    readonly expected: Breach;
    /** The same scenario with the one thing that breaks the rule fixed. */
    readonly repaired: Scenario;
  }

  const rows: readonly Row[] = [
    {
      name: "no-such-grant: the grant acted under does not exist",
      violating: { after: [], commit: commit("k", "buyer", "g-ghost", "purchase", 10) },
      expected: { kind: "no-such-grant", grantId: g("g-ghost") },
      repaired: { after: [], commit: GOOD() },
    },
    {
      name: "wrong-actor: somebody who is not the grantee acts under a live grant (the holder is named)",
      violating: { after: [], commit: commit("k", "ops", "G3", "purchase", 10) },
      expected: { kind: "wrong-actor", grantId: g("G3"), holder: p("buyer") },
      repaired: { after: [], commit: commit("k", "buyer", "G3", "purchase", 10) },
    },
    {
      name: "wrong-actor: the grantor of the grant is not its holder either",
      violating: { after: [], commit: commit("k", "cfo", "G2", "purchase", 10) },
      expected: { kind: "wrong-actor", grantId: g("G2"), holder: p("ops") },
      repaired: { after: [], commit: commit("k", "ops", "G2", "purchase", 10) },
    },
    {
      name: "link-dead: a link above the grant was revoked (the dead link and the seq of its revoke are named, not the grant acted under)",
      violating: { after: [revokeEvent("G2", "cfo")], commit: GOOD() },
      expected: { kind: "link-dead", grantId: g("G2"), atSeq: 5 },
      repaired: { after: [], commit: GOOD() },
    },
    {
      name: "link-dead: the root grant was revoked, by the charter root",
      violating: { after: [revokeEvent("G1", "dana")], commit: GOOD() },
      expected: { kind: "link-dead", grantId: g("G1"), atSeq: 5 },
      repaired: { after: [], commit: GOOD() },
    },
    {
      name: "link-dead: the grant acted under was itself revoked",
      violating: { after: [revokeEvent("G3", "ops")], commit: GOOD() },
      expected: { kind: "link-dead", grantId: g("G3"), atSeq: 5 },
      repaired: { after: [], commit: GOOD() },
    },
    {
      name: "capability-not-granted: the capability is in the charter and in the grants above, but not in this grant",
      violating: { after: [], commit: commit("k", "buyer", "G3", "refund", 10) },
      expected: { kind: "capability-not-granted", grantId: g("G3"), capability: "refund" },
      repaired: { after: [], commit: commit("k", "buyer", "G3", "purchase", 10) },
    },
    {
      name: "capability-not-granted: a capability that no grant on the chain has",
      violating: { after: [], commit: commit("k", "ops", "G2", "hire", 10) },
      expected: { kind: "capability-not-granted", grantId: g("G2"), capability: "hire" },
      repaired: { after: [], commit: commit("k", "ops", "G2", "refund", 10) },
    },
    {
      name: "over-limit: one more than the headroom of a grant with no spend (the headroom is the limit)",
      violating: { after: [], commit: commit("k", "buyer", "G3", "purchase", 1_001) },
      expected: { kind: "over-limit", grantId: g("G3"), requested: 1_001, headroom: 1_000 },
      repaired: { after: [], commit: commit("k", "buyer", "G3", "purchase", 1_000) },
    },
    {
      name: "over-limit: one more than what an earlier commit left",
      violating: { after: [commitEvent(commit("e", "buyer", "G3", "purchase", 600))], commit: commit("k", "buyer", "G3", "purchase", 401) },
      expected: { kind: "over-limit", grantId: g("G3"), requested: 401, headroom: 400 },
      repaired: { after: [commitEvent(commit("e", "buyer", "G3", "purchase", 600))], commit: commit("k", "buyer", "G3", "purchase", 400) },
    },
    {
      name: "over-limit: a grant's own commit competes with what it reserved for its child (G2: 4 000 - 1 000 reserved = 3 000)",
      violating: { after: [], commit: commit("k", "ops", "G2", "purchase", 3_001) },
      expected: { kind: "over-limit", grantId: g("G2"), requested: 3_001, headroom: 3_000 },
      repaired: { after: [], commit: commit("k", "ops", "G2", "purchase", 3_000) },
    },
    {
      name: "over-limit: the root grant (10 000 - 4 000 - 500 reserved = 5 500)",
      violating: { after: [], commit: commit("k", "cfo", "G1", "purchase", 5_501) },
      expected: { kind: "over-limit", grantId: g("G1"), requested: 5_501, headroom: 5_500 },
      repaired: { after: [], commit: commit("k", "cfo", "G1", "purchase", 5_500) },
    },
    {
      name: "over-limit: spend the revoked sibling absorbed still counts against the parent (G3 spends 700 and is revoked: G2 keeps 700 + 0 reserved)",
      violating: {
        after: [commitEvent(commit("e", "buyer", "G3", "purchase", 700)), revokeEvent("G3", "ops")],
        commit: commit("k", "ops", "G2", "purchase", 3_301),
      },
      expected: { kind: "over-limit", grantId: g("G2"), requested: 3_301, headroom: 3_300 },
      repaired: {
        after: [commitEvent(commit("e", "buyer", "G3", "purchase", 700)), revokeEvent("G3", "ops")],
        commit: commit("k", "ops", "G2", "purchase", 3_300),
      },
    },
  ];

  it.each(rows.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(breachOf(verdictOf(row.violating))).toStrictEqual(row.expected);
    expect(verdictOf(row.repaired).kind).toBe("warranted");
  });

  it("a breached commit is recorded, charges nothing and is void; the repaired one charges its amount and is binding", () => {
    for (const row of rows) {
      const log = logOf(CHARTER, [...BASE, ...row.violating.after, commitEvent(row.violating.commit)]);
      const folded = mustFold(CHARTER, log);
      expect(folded.commits.get(row.violating.commit.id)?.verdict.kind, row.name).toBe("breached");
      // The charges are exactly the warranted commits of `after` (the table's own earlier commits), never the breached one.
      const warrantedBefore = row.violating.after.filter((event) => event.kind === "commit");
      expect(folded.charges.length, row.name).toBe(warrantedBefore.length);
      const standing = standingOf(CHARTER, log, row.violating.commit.id);
      expect(standing.ok && standing.standing.kind, row.name).toBe("void");
    }
  });
});

describe("every combination of breaches reports only the first, in the precedence of plan 4.3", () => {
  // The five switches, in precedence order. A switch set makes the commit breach that rule; the others stay clean.
  const SWITCHES = ["no-such-grant", "wrong-actor", "link-dead", "capability-not-granted", "over-limit"] as const;
  type Switch = (typeof SWITCHES)[number];

  /** G3 is `buyer`'s, purchase only, limit 1 000; G2 is revoked at seq 5 when `link-dead` is switched on. */
  function build(on: ReadonlySet<Switch>): Scenario {
    return {
      after: on.has("link-dead") ? [revokeEvent("G2", "cfo")] : [],
      commit: commit(
        "k",
        on.has("wrong-actor") ? "ops" : "buyer",
        on.has("no-such-grant") ? "g-ghost" : "G3",
        on.has("capability-not-granted") ? "refund" : "purchase",
        on.has("over-limit") ? 1_001 : 1_000,
      ),
    };
  }

  const expectedFor = (on: ReadonlySet<Switch>): Breach["kind"] | "warranted" => SWITCHES.find((name) => on.has(name)) ?? "warranted";

  const subsets: Switch[][] = [];
  for (let mask = 0; mask < 1 << SWITCHES.length; mask++) subsets.push(SWITCHES.filter((_, bit) => (mask & (1 << bit)) !== 0));

  it("there are 32 combinations (the empty one plus the 31 that breach something), and each is reported as its earliest switch", () => {
    expect(subsets).toHaveLength(32);
    const seen = new Map<string, number>();
    for (const subset of subsets) {
      const on = new Set(subset);
      const verdict = verdictOf(build(on));
      const reported = verdict.kind === "warranted" ? "warranted" : verdict.breach.kind;
      expect(reported, `switches ${JSON.stringify(subset)}`).toBe(expectedFor(on));
      seen.set(reported, (seen.get(reported) ?? 0) + 1);
    }
    // 16 combinations contain no-such-grant, 8 have wrong-actor as the first, 4, 2, 1, and the empty one is warranted.
    expect([...seen].sort()).toStrictEqual(
      [
        ["capability-not-granted", 2],
        ["link-dead", 4],
        ["no-such-grant", 16],
        ["over-limit", 1],
        ["warranted", 1],
        ["wrong-actor", 8],
      ].sort(),
    );
  });

  it("peeling the breaches off one at a time, each reveals the next, and the last repair is warranted", () => {
    const on = new Set<Switch>(SWITCHES);
    const reported: string[] = [];
    for (const name of SWITCHES) {
      const verdict = verdictOf(build(on));
      reported.push(verdict.kind === "warranted" ? "warranted" : verdict.breach.kind);
      on.delete(name);
    }
    const last = verdictOf(build(on));
    reported.push(last.kind === "warranted" ? "warranted" : last.breach.kind);
    expect(reported).toStrictEqual(["no-such-grant", "wrong-actor", "link-dead", "capability-not-granted", "over-limit", "warranted"]);
  });

  it("the plan's own pair, c6 of section 7: borrowed AND dead is reported as borrowed, and repairing the actor reveals the dead link", () => {
    const dead = [revokeEvent("G2", "cfo")];
    expect(breachOf(verdictOf({ after: dead, commit: commit("c6", "ops", "G3", "purchase", 5) }))).toStrictEqual({ kind: "wrong-actor", grantId: g("G3"), holder: p("buyer") });
    expect(breachOf(verdictOf({ after: dead, commit: commit("c6", "buyer", "G3", "purchase", 5) }))).toStrictEqual({ kind: "link-dead", grantId: g("G2"), atSeq: 5 });
  });

  it("two dead links on one chain: the one nearest the root is named, whichever was revoked first", () => {
    // G3 cut first (seq 5), then G1 (seq 6): both are on G3's chain.
    const leafFirst = [revokeEvent("G3", "ops"), revokeEvent("G1", "dana")];
    expect(breachOf(verdictOf({ after: leafFirst, commit: GOOD() }))).toStrictEqual({ kind: "link-dead", grantId: g("G1"), atSeq: 6 });
    // G1 cut first (seq 5): G3 can no longer be revoked (it is dead through G1), so there is one dead link, G1.
    const rootFirst = [revokeEvent("G1", "dana")];
    expect(breachOf(verdictOf({ after: rootFirst, commit: GOOD() }))).toStrictEqual({ kind: "link-dead", grantId: g("G1"), atSeq: 5 });
  });
});

describe("the longest chain M3 admits: MAX_ROOT_DEPTH + 1 = 8 grants", () => {
  const CHAIN = deepChainEvents();
  const leaf = DEEP_LENGTH - 1;
  const deepVerdict = (after: readonly EventInput<Cap>[], c: Commitment<Cap>): Verdict => judge(CHARTER, [...CHAIN, ...after], c);
  const ids = Array.from({ length: DEEP_LENGTH }, (_, index) => g(`D${index}`));

  it("the chain really has 8 links and a 9-principal trail", () => {
    expect(DEEP_LENGTH).toBe(MAX_ROOT_DEPTH + 1);
    expect(CHAIN).toHaveLength(8);
  });

  it("a commit at the leaf is warranted with a chain of 8 grants and a trail of 9 principals, root first", () => {
    const verdict = deepVerdict([], commit("k", deepHolder(leaf), `D${leaf}`, "purchase", 10_000));
    expect(verdict).toStrictEqual({
      kind: "warranted",
      warrant: {
        chain: ids,
        trail: [p("dana"), ...Array.from({ length: DEEP_LENGTH }, (_, index) => p(deepHolder(index)))],
      },
    });
  });

  it("the dead link is named at every position 0 to 7, with the seq of its revoke, for a commit at the leaf", () => {
    for (let dead = 0; dead < DEEP_LENGTH; dead++) {
      const revokeSeq = DEEP_LENGTH + 1;
      const verdict = deepVerdict([revokeEvent(`D${dead}`, deepGrantor(dead))], commit("k", deepHolder(leaf), `D${leaf}`, "purchase", 1));
      expect(breachOf(verdict), `dead link ${dead}`).toStrictEqual({ kind: "link-dead", grantId: ids[dead], atSeq: revokeSeq });
    }
  });

  it("with two dead links, the nearer the root is named: every pair (i, j) with i < j, the lower revoked first", () => {
    for (let near = 0; near < DEEP_LENGTH - 1; near++) {
      for (let far = near + 1; far < DEEP_LENGTH; far++) {
        const after = [revokeEvent(`D${far}`, deepGrantor(far)), revokeEvent(`D${near}`, deepGrantor(near))];
        const verdict = deepVerdict(after, commit("k", deepHolder(leaf), `D${leaf}`, "purchase", 1));
        expect(breachOf(verdict), `pair ${near},${far}`).toStrictEqual({ kind: "link-dead", grantId: ids[near], atSeq: DEEP_LENGTH + 2 });
      }
    }
  });

  it("wrong-actor at the leaf names the leaf's holder, and the grantor of the leaf (the holder of link 6) is not that holder", () => {
    expect(breachOf(deepVerdict([], commit("k", deepHolder(leaf - 1), `D${leaf}`, "purchase", 1)))).toStrictEqual({
      kind: "wrong-actor",
      grantId: ids[leaf],
      holder: p(deepHolder(leaf)),
    });
  });

  it("over-limit at the leaf and at every link above it, at exactly the headroom (10 000) and one more", () => {
    for (let index = 0; index < DEEP_LENGTH; index++) {
      const fits = deepVerdict([], commit("k", deepHolder(index), `D${index}`, "purchase", 10_000));
      expect(fits.kind, `link ${index} fits 10 000`).toBe("warranted");
      expect(breachOf(deepVerdict([], commit("k", deepHolder(index), `D${index}`, "purchase", 10_001))), `link ${index}`).toStrictEqual({
        kind: "over-limit",
        grantId: ids[index],
        requested: 10_001,
        headroom: 10_000,
      });
    }
  });

  it("every combination of the five breaches at the leaf is reported as its earliest, as on the small tree", () => {
    const SWITCHES = ["no-such-grant", "wrong-actor", "link-dead", "capability-not-granted", "over-limit"] as const;
    for (let mask = 0; mask < 1 << SWITCHES.length; mask++) {
      const on = new Set(SWITCHES.filter((_, bit) => (mask & (1 << bit)) !== 0));
      const after = on.has("link-dead") ? [revokeEvent("D3", deepGrantor(3))] : [];
      const verdict = deepVerdict(
        after,
        commit(
          "k",
          on.has("wrong-actor") ? deepHolder(leaf - 1) : deepHolder(leaf),
          on.has("no-such-grant") ? "g-ghost" : `D${leaf}`,
          on.has("capability-not-granted") ? "hire" : "purchase",
          on.has("over-limit") ? 10_001 : 10_000,
        ),
      );
      const reported = verdict.kind === "warranted" ? "warranted" : verdict.breach.kind;
      expect(reported, `switches ${JSON.stringify([...on])}`).toBe(SWITCHES.find((name) => on.has(name)) ?? "warranted");
    }
  });
});

describe("judgeCommit on a tree that no fold built: it fails closed as no-such-grant", () => {
  const ghostCommit = commit("k", "ops", "A", "purchase", 1);

  it("a grant whose parent pointers loop is no grant at all", () => {
    const tree = treeOf([grant({ id: "A", parent: "B", grantor: "x", grantee: "ops" }), grant({ id: "B", parent: "A", grantor: "y", grantee: "z" })]);
    expect(judgeCommit(tree, [], ghostCommit)).toStrictEqual({ kind: "breached", breach: { kind: "no-such-grant", grantId: g("A") } });
  });

  it("a grant whose parent is not in the tree is no grant at all", () => {
    const tree = treeOf([grant({ id: "A", parent: "missing", grantor: "x", grantee: "ops" })]);
    expect(judgeCommit(tree, [], ghostCommit)).toStrictEqual({ kind: "breached", breach: { kind: "no-such-grant", grantId: g("A") } });
  });

  it("a grant below an ancestry longer than the chain bound is no grant at all, and the same line one grant shorter is judged", () => {
    const line = (length: number) => {
      const grants = Array.from({ length }, (_, index) => grant({ id: `L${index}`, parent: index === 0 ? null : `L${index - 1}`, grantor: index === 0 ? "dana" : `h${index - 1}`, grantee: `h${index}`, limit: 100, depth: 0 }));
      return treeOf(grants);
    };
    const atBound = line(DEEP_LENGTH);
    const pastBound = line(DEEP_LENGTH + 1);
    expect(judgeCommit(atBound, [], commit("k", `h${DEEP_LENGTH - 1}`, `L${DEEP_LENGTH - 1}`, "purchase", 1)).kind).toBe("warranted");
    expect(judgeCommit(pastBound, [], commit("k", `h${DEEP_LENGTH}`, `L${DEEP_LENGTH}`, "purchase", 1))).toStrictEqual({
      kind: "breached",
      breach: { kind: "no-such-grant", grantId: g(`L${DEEP_LENGTH}`) },
    });
  });
});
