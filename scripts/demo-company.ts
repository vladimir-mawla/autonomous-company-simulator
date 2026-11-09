import assert from "node:assert/strict";
import { absorbedBy, headroomOf } from "../lib/allowance/index.js";
import { grantId, principalId } from "../lib/contracts/index.js";
import type { Breach, Log, LogEvent, Rejection, Standing } from "../lib/contracts/index.js";
import { fold, standings } from "../lib/standing/index.js";
import { CANON_SCRIPT, CHARTER, replayScript, runQuarter } from "../domains/company/index.js";
import type { Attempt, CompanyCapability, ScriptStep } from "../domains/company/index.js";

/**
 * `npm run demo:company`: plan §7's incident offered to the real engine, step by step, with what the engine said, and two gates on the exit code.
 *
 * PLAN §6 M6, "Falsifiable check": it "prints, per step, the attempt, the engine's typed result, and, at the revoke, the standings before/after
 * with `absorbed`/`returned`; it exits non-zero unless all 3 `Standing` kinds, all 5 `Breach` kinds and all 15 `Rejection` kinds were actually
 * observed in the run, and unless an independent oracle in the script (sum of `binding|inherited` commit amounts per root grant, computed from the
 * raw log without importing `lib/allowance`) is <= that root's limit."
 *
 * EVERY NUMBER PRINTED IS READ OFF A VALUE THE ENGINE RETURNED for the log on screen; none is typed here as output. What is typed here is plan §7's
 * table of ANSWERS (`EXPECT`, and the standings below it), and each step is CHECKED against it: the first step whose answer differs throws, and the
 * script exits 1. So a change to the engine that changes a ruling in §7 is a red demo, not a different story.
 *
 * THE EXIT CODE. 0 only if all of these held, in this order of checking; the first that does not is printed on stderr and the exit code is 1:
 *   1. every one of the 33 steps got the answer §7 gives it, and the standings at seq 10, 11 and 18 are §7's (heir, `severed`, `chargedTo`, breach);
 *   2. at the revoke: the engine's `absorbed` equals what the ORACLE adds up from the raw log and from the standings (the amounts bound under the revoked
 *      grant's subtree), `returned` is the grant's limit less that, and the parent's headroom rose by exactly `returned`;
 *   3. every kind of Standing, Breach and Rejection was observed (lists typed as records over the unions, so a kind added to `lib/contracts` is a compile error here);
 *   4. the ORACLE holds at every prefix of the §7 log and of the autonomous quarter that follows it: for each root grant, what the engine ruled
 *      `binding` or `inherited` under it, added up from the raw log, does not exceed its limit.
 *
 * THE ORACLE (`conservationOracle`, `spentUnder`) reads only the raw log's events (their parent pointers and amounts) and the engine's STANDINGS, to know which
 * commits bind. It calls nothing from `lib/allowance` or `lib/standing`: `domains/company/__tests__/demo.test.ts` walks this file's syntax tree and fails if
 * either function mentions a name this file imports, or the name of a function or of a const, let or var (bound to a plain identifier) this file declares at its top level, which is how a helper that calls the engine would reach the oracle. It does not see a destructured top-level binding, a class, an `import x = ns.y` alias, `globalThis`, or a dynamic `import()`. It trusts the engine's classification (which commit is void), not its accounting.
 *
 * `absorbedBy` and `headroomOf` ARE imported, to print the engine's numbers; the oracle is what they are checked against. Plan §6 M6 says that making
 * `absorbedBy` return 0 "makes the demo exit non-zero on the oracle": the literal oracle (a sum against a root's limit) is blind to that, because nothing in
 * admission reads `absorbedBy`; check 2 above is what sees it, and `__tests__/demo.test.ts` runs the demo on a copy of the tree with exactly that change.
 */

const g = grantId;
const p = principalId;

type Expect =
  | { readonly refused: Rejection }
  | { readonly admitted: number }
  | { readonly admitted: number; readonly warranted: true }
  | { readonly admitted: number; readonly breach: Breach };

/** Plan §7's table of answers, keyed by the script step's key. */
const EXPECT: Readonly<Record<string, Expect>> = {
  G1: { admitted: 1 },
  G2: { admitted: 2 },
  G3: { admitted: 3 },
  G4: { admitted: 4 },
  G5: { admitted: 5 },
  G6: { admitted: 6 },
  c1: { admitted: 7, warranted: true },
  c2: { admitted: 8, warranted: true },
  c3: { admitted: 9, warranted: true },
  c4: { admitted: 10, warranted: true },
  "widen-scope": { refused: { kind: "capability-widening", capability: "hire" } },
  "over-delegate": { refused: { kind: "over-allocation", grantId: g("G2"), requested: 200000, headroom: 50000 } },
  "delegate-past-depth": { refused: { kind: "depth-exhausted", parent: g("G4") } },
  "mint-root": { refused: { kind: "not-a-root", grantor: p("intern") } },
  "delegate-borrowed": { refused: { kind: "grantor-not-holder", parent: g("G2"), grantor: p("buyer-b"), holder: p("ops") } },
  "keep-depth": { refused: { kind: "depth-not-narrowed", parentDepth: 3, requested: 3 } },
  "delegate-upward": { refused: { kind: "principal-cycle", principal: p("cfo") } },
  "orphan-grant": { refused: { kind: "unknown-parent", parent: g("g-nowhere") } },
  "reuse-grant-id": { refused: { kind: "duplicate-id", id: "G3" } },
  "revoke-own-grant": { refused: { kind: "revoker-not-authorised", grantId: g("G5"), by: p("buyer-a") } },
  "revoke-ghost": { refused: { kind: "unknown-grant", grantId: g("g-unknown") } },
  "revoke-G2": { admitted: 11 },
  "revoke-twice": { refused: { kind: "already-dead", grantId: g("G2") } },
  "delegate-from-dead": { refused: { kind: "parent-dead", deadGrant: g("G2") } },
  c5: { admitted: 12, breach: { kind: "link-dead", grantId: g("G2"), atSeq: 11 } },
  c6: { admitted: 13, breach: { kind: "wrong-actor", grantId: g("G4"), holder: p("buyer-a") } },
  c7: { admitted: 14, breach: { kind: "capability-not-granted", grantId: g("G6"), capability: "purchase" } },
  c8: { admitted: 15, breach: { kind: "over-limit", grantId: g("G6"), requested: 50000, headroom: 28000 } },
  c9: { admitted: 16, breach: { kind: "no-such-grant", grantId: g("g-ghost") } },
  G7: { admitted: 17 },
  c10: { admitted: 18, warranted: true },
  "negative-limit": { refused: { kind: "invalid-event-shape", eventKind: "grant", fields: ["limit"] } },
  "launder-capability": { refused: { kind: "unknown-capability", capability: "launder" } },
};

/** What each standing is, in §7: the three at seq 10, 11 and 18 (c1 c2 c4 inherited from G2 at seq 11, heir cfo, charged to G1; c3 and c10 binding; c5 to c9 void). */
type StandingExpect =
  | { readonly kind: "binding" }
  | { readonly kind: "inherited"; readonly severed: { readonly grantId: ReturnType<typeof g>; readonly atSeq: number }; readonly heir: ReturnType<typeof p>; readonly chargedTo: ReturnType<typeof g> | null }
  | { readonly kind: "void"; readonly breach: Breach };

const INHERITED_FROM_G2: StandingExpect = { kind: "inherited", severed: { grantId: g("G2"), atSeq: 11 }, heir: p("cfo"), chargedTo: g("G1") };
const BINDING: StandingExpect = { kind: "binding" };
const voidOf = (key: string): StandingExpect => {
  const expect = EXPECT[key];
  if (expect === undefined || !("breach" in expect)) throw new Error(`${key} is not a step §7 rules void`);
  return { kind: "void", breach: expect.breach };
};

const AT_SEQ_10: Readonly<Record<string, StandingExpect>> = { c1: BINDING, c2: BINDING, c3: BINDING, c4: BINDING };
const AT_SEQ_11: Readonly<Record<string, StandingExpect>> = { c1: INHERITED_FROM_G2, c2: INHERITED_FROM_G2, c3: BINDING, c4: INHERITED_FROM_G2 };
const AT_SEQ_18: Readonly<Record<string, StandingExpect>> = {
  c1: INHERITED_FROM_G2,
  c2: INHERITED_FROM_G2,
  c3: BINDING,
  c4: INHERITED_FROM_G2,
  c5: voidOf("c5"),
  c6: voidOf("c6"),
  c7: voidOf("c7"),
  c8: voidOf("c8"),
  c9: voidOf("c9"),
  c10: BINDING,
};

// The three closed lists the gate is checked against. A record over the union is exhaustive at compile time: a kind added to or removed from
// `lib/contracts` makes this file fail `npm run typecheck`, so the gate cannot go on checking a stale list.
const STANDING_KINDS: Readonly<Record<Standing["kind"], true>> = { binding: true, inherited: true, void: true };
const BREACH_KINDS: Readonly<Record<Breach["kind"], true>> = {
  "no-such-grant": true,
  "wrong-actor": true,
  "link-dead": true,
  "capability-not-granted": true,
  "over-limit": true,
};
const REJECTION_KINDS: Readonly<Record<Rejection["kind"], true>> = {
  "invalid-event-shape": true,
  "unknown-capability": true,
  "duplicate-id": true,
  "not-a-root": true,
  "unknown-parent": true,
  "parent-dead": true,
  "grantor-not-holder": true,
  "capability-widening": true,
  "depth-exhausted": true,
  "depth-not-narrowed": true,
  "principal-cycle": true,
  "over-allocation": true,
  "unknown-grant": true,
  "already-dead": true,
  "revoker-not-authorised": true,
};

const DEMO_SEED = 1;
const DEMO_TICKS = 60;

// ---------------------------------------------------------------------------------------------------
// the oracle: raw log + standings in, nothing from lib/allowance and nothing called from the engine
// ---------------------------------------------------------------------------------------------------

interface RootBound {
  readonly root: string;
  readonly limit: number;
  readonly bound: number;
}

/** Per root grant: the sum of the amounts of the commits ruled `binding` or `inherited` that were acted under it or anything below it. */
function conservationOracle(log: Log<CompanyCapability>, list: readonly Standing[]): readonly RootBound[] {
  const parentOf = new Map<string, string | null>();
  const limitOf = new Map<string, number>();
  const roots: string[] = [];
  for (const event of log) {
    if (event.kind !== "grant") continue;
    parentOf.set(event.grant.id, event.grant.parent);
    limitOf.set(event.grant.id, event.grant.limit);
    if (event.grant.parent === null) roots.push(event.grant.id);
  }
  const rootOf = (start: string): string | undefined => {
    let id: string | null | undefined = start;
    for (let hops = 0; hops < 64 && id !== undefined; hops++) {
      const parent: string | null | undefined = parentOf.get(id);
      if (parent === null) return id;
      id = parent;
    }
    return undefined;
  };
  const kindOf = new Map(list.map((standing) => [standing.commitId as string, standing.kind]));
  const sums = new Map<string, number>(roots.map((id) => [id, 0]));
  for (const event of log) {
    if (event.kind !== "commit") continue;
    const kind = kindOf.get(event.commit.id);
    if (kind === undefined || kind === "void") continue;
    const root = rootOf(event.commit.actedUnder);
    if (root === undefined) throw new Error(`oracle: ${event.commit.id} is ruled ${kind} under ${event.commit.actedUnder}, a grant the raw log does not hold`);
    sums.set(root, (sums.get(root) ?? 0) + event.commit.amount);
  }
  return roots.map((root) => ({ root, limit: limitOf.get(root) ?? 0, bound: sums.get(root) ?? 0 }));
}

/** The amount ruled `binding` under `grant` or anything below it, in `log`, by the same reading. (What a revoke of `grant` absorbs, if all of it is binding.) */
function spentUnder(log: Log<CompanyCapability>, list: readonly Standing[], grant: string): number {
  const parentOf = new Map<string, string | null>();
  for (const event of log) if (event.kind === "grant") parentOf.set(event.grant.id, event.grant.parent);
  const below = (start: string): boolean => {
    let id: string | null | undefined = start;
    for (let hops = 0; hops < 64 && id !== null && id !== undefined; hops++) {
      if (id === grant) return true;
      id = parentOf.get(id);
    }
    return false;
  };
  const kindOf = new Map(list.map((standing) => [standing.commitId as string, standing.kind]));
  let total = 0;
  for (const event of log) {
    if (event.kind !== "commit" || kindOf.get(event.commit.id) !== "binding") continue;
    if (below(event.commit.actedUnder)) total += event.commit.amount;
  }
  return total;
}

// ---------------------------------------------------------------------------------------------------
// reading the engine
// ---------------------------------------------------------------------------------------------------

function standingsOf(log: Log<CompanyCapability>): readonly Standing[] {
  const result = standings(CHARTER, log);
  if (!result.ok) throw new Error(`the engine could not give standings: ${JSON.stringify(result.fault)}`);
  return result.standings;
}

function foldedOf(log: Log<CompanyCapability>) {
  const result = fold(CHARTER, log);
  if (!result.ok) throw new Error(`the engine could not fold the log: ${JSON.stringify(result.fault)}`);
  return result.folded;
}

const json = (value: unknown): string => JSON.stringify(value);

function describeEvent(event: ScriptStep["input"]): string {
  if (event.kind === "grant") {
    const { grant } = event;
    return `grant ${grant.id}: ${grant.grantor} -> ${grant.grantee} [${grant.capabilities.join(",")}] limit ${grant.limit} depth ${grant.depth} parent ${grant.parent ?? "(root)"}`;
  }
  if (event.kind === "revoke") return `revoke ${event.grantId} by ${event.by}`;
  return `commit ${event.commit.id}: ${event.commit.actor} ${event.commit.capability} ${event.commit.amount} under ${event.commit.actedUnder}`;
}

/** The engine's typed result for an attempt, as one line: admitted with the seq and verdict, or the engine's own refusal. */
function typedResult(attempt: Attempt): string {
  const outcome = attempt.outcome;
  if (outcome.kind === "admitted") return json({ kind: outcome.kind, seq: outcome.event.seq, verdict: outcome.verdict });
  return json(outcome);
}

/** Check one attempt against §7's answer for its step, and say what the answer is. Throws on the first difference. */
function checkAttempt(step: ScriptStep, attempt: Attempt): string {
  const expect = EXPECT[step.key];
  if (expect === undefined) throw new Error(`step ${step.key} has no answer in EXPECT`);
  const outcome = attempt.outcome;
  if ("refused" in expect) {
    assert.deepStrictEqual(outcome, { kind: "rejected", rejection: expect.refused }, `step ${step.key}: §7 says refused as ${expect.refused.kind}`);
    return `refused as ${expect.refused.kind}`;
  }
  assert.equal(outcome.kind, "admitted", `step ${step.key}: §7 says admitted at seq ${expect.admitted}, the engine said ${json(outcome)}`);
  if (outcome.kind !== "admitted") throw new Error("unreachable");
  assert.equal(outcome.event.seq, expect.admitted, `step ${step.key}: §7 says seq ${expect.admitted}`);
  if ("warranted" in expect) {
    assert.equal(outcome.verdict?.kind, "warranted", `step ${step.key}: §7 says warranted, the engine said ${json(outcome.verdict)}`);
    return `admitted at seq ${expect.admitted}, warranted`;
  }
  if ("breach" in expect) {
    assert.deepStrictEqual(
      outcome.verdict,
      { kind: "breached", breach: expect.breach },
      `step ${step.key}: §7 says breached as ${expect.breach.kind}, the engine said ${json(outcome.verdict)}`,
    );
    return `admitted at seq ${expect.admitted}, breached as ${expect.breach.kind}`;
  }
  assert.equal(outcome.verdict, null, `step ${step.key}: a grant or revoke has no verdict`);
  return `admitted at seq ${expect.admitted}`;
}

function checkStandings(where: string, list: readonly Standing[], expected: Readonly<Record<string, StandingExpect>>): void {
  assert.deepStrictEqual(list.map((standing) => standing.commitId as string), Object.keys(expected), `${where}: the commits that have a standing`);
  for (const standing of list) {
    const want = expected[standing.commitId];
    if (want === undefined) throw new Error(`${where}: ${standing.commitId} is not in §7`);
    const got: StandingExpect =
      standing.kind === "binding"
        ? { kind: "binding" }
        : standing.kind === "inherited"
          ? { kind: "inherited", severed: standing.severed, heir: standing.heir, chargedTo: standing.chargedTo }
          : { kind: "void", breach: standing.breach };
    assert.deepStrictEqual(got, want, `${where}: standing of ${standing.commitId}`);
  }
}

function printStandings(title: string, list: readonly Standing[]): void {
  console.log(`  ${title}`);
  for (const standing of list) {
    const detail =
      standing.kind === "binding"
        ? `warrant chain ${standing.warrant.chain.join(">")}  trail ${standing.warrant.trail.join(">")}`
        : standing.kind === "inherited"
          ? `severed ${standing.severed.grantId}@${standing.severed.atSeq}  heir ${standing.heir}  chargedTo ${standing.chargedTo ?? "null (heir is a charter root)"}  chain ${standing.warrant.chain.join(">")}`
          : `breach ${json(standing.breach)}`;
    console.log(`    ${standing.commitId.padEnd(4)} at seq ${String(standing.committedAt).padStart(2)}  ${standing.kind.padEnd(9)} ${detail}`);
  }
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

// ---------------------------------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------------------------------

function main(): void {
  const stepOfLabel = new Map(CANON_SCRIPT.map((step) => [step.label, step]));
  assert.equal(stepOfLabel.size, CANON_SCRIPT.length, "the script's labels are not unique");
  assert.deepStrictEqual(
    new Set(CANON_SCRIPT.map((step) => step.key)),
    new Set(Object.keys(EXPECT)),
    "the script's steps and §7's answers (EXPECT) are not the same set of keys",
  );

  const seenStandings = new Set<string>();
  const seenBreaches = new Set<string>();
  const seenRejections = new Set<string>();
  const seeAttempt = (attempt: Attempt): void => {
    const outcome = attempt.outcome;
    if (outcome.kind === "rejected") seenRejections.add(outcome.rejection.kind);
    if (outcome.kind === "admitted" && outcome.verdict?.kind === "breached") seenBreaches.add(outcome.verdict.breach.kind);
  };
  const seeStandings = (list: readonly Standing[]): void => {
    for (const standing of list) {
      seenStandings.add(standing.kind);
      if (standing.kind === "void") seenBreaches.add(standing.breach.kind);
    }
  };
  const oracleRuns: string[] = [];
  const runOracle = (where: string, log: Log<CompanyCapability>, list: readonly Standing[]): readonly RootBound[] => {
    const bounds = conservationOracle(log, list);
    for (const entry of bounds) {
      assert.ok(entry.bound <= entry.limit, `ORACLE: ${where}: root grant ${entry.root} has ${entry.bound} ruled binding or inherited under it, over its limit of ${entry.limit}`);
    }
    return bounds;
  };

  // ---- part 1: plan §7, offered one step at a time, each checked against §7's answer ----
  console.log(`== Meridian Supply Co., the canonical incident of plan §7: ${CANON_SCRIPT.length} steps offered to the engine, from an empty log ==`);
  console.log("   (each line: the step, what was offered, the engine's typed result, and what plan §7 says; the first step that differs throws and the exit code is 1)\n");

  let log: Log<CompanyCapability> = [];
  const replay = replayScript();
  let beforeRevoke: { log: Log<CompanyCapability>; list: readonly Standing[] } | undefined;
  const logAfter = new Map<number, Log<CompanyCapability>>();
  for (const [index, step] of CANON_SCRIPT.entries()) {
    const attempt = replay.attempts[index];
    if (attempt === undefined) throw new Error(`no attempt for step ${step.key}`);
    assert.equal(attempt.label, step.label, `attempt ${index + 1} is not for step ${step.key}`);
    seeAttempt(attempt);

    if (step.key === "revoke-G2") beforeRevoke = { log, list: standingsOf(log) };
    const answer = checkAttempt(step, attempt);
    if (attempt.outcome.kind === "admitted") {
      log = replay.log.slice(0, attempt.outcome.event.seq);
      logAfter.set(attempt.outcome.event.seq, log);
    }

    console.log(`[${pad(attempt.n)}] ${step.key.padEnd(18)} ${step.label}`);
    console.log(`     offered  ${describeEvent(step.input)}`);
    console.log(`     engine   ${typedResult(attempt)}`);
    console.log(`     plan §7  ${answer}`);

    if (step.key === "revoke-G2") {
      if (beforeRevoke === undefined) throw new Error("no log before the revoke");
      const afterList = standingsOf(log);
      seeStandings(beforeRevoke.list);
      seeStandings(afterList);
      checkStandings("at seq 10", beforeRevoke.list, AT_SEQ_10);
      checkStandings("at seq 11", afterList, AT_SEQ_11);

      const before = foldedOf(beforeRevoke.log);
      const after = foldedOf(log);
      const absorbed = absorbedBy(after.tree, after.charges, g("G2"));
      const limitOfG2 = beforeRevoke.log.flatMap((event: LogEvent<CompanyCapability>) => (event.kind === "grant" && event.grant.id === "G2" ? [event.grant.limit] : []))[0];
      assert.notEqual(limitOfG2, undefined, "G2 is not in the log");
      const returned = (limitOfG2 ?? 0) - (absorbed ?? 0);
      const headroomBefore = headroomOf(before.tree, before.charges, g("G1"));
      const headroomAfter = headroomOf(after.tree, after.charges, g("G1"));
      const oracleAbsorbed = spentUnder(beforeRevoke.log, beforeRevoke.list, "G2");

      console.log("     --- the revoke, before and after ---");
      printStandings("standings before (log of seq 1 to 10)", beforeRevoke.list);
      printStandings("standings after  (log of seq 1 to 11)", afterList);
      console.log(`  absorbed (engine: lib/allowance absorbedBy G2) = ${String(absorbed)}`);
      console.log(`  absorbed (oracle: raw log and standings, the binding amounts under G2's subtree) = ${oracleAbsorbed}`);
      console.log(`  returned = limit(G2) ${String(limitOfG2)} - absorbed = ${returned}`);
      console.log(`  G1 headroom: ${String(headroomBefore)} -> ${String(headroomAfter)}`);
      assert.equal(absorbed, oracleAbsorbed, "ORACLE: the engine's absorbed amount is not the amount the raw log shows was bound under the revoked grant");
      assert.equal((headroomAfter ?? 0) - (headroomBefore ?? 0), returned, "ORACLE: the parent's headroom did not rise by exactly what was returned");
      assert.equal(absorbed, 220000, "§7: absorbed is 220000 (80000 + 50000 + 90000)");
      assert.equal(returned, 180000, "§7: returned is 180000");
      assert.deepStrictEqual([headroomBefore, headroomAfter], [500000, 680000], "§7: G1's headroom goes from 500000 to 680000");
    }
    console.log("");
  }
  assert.equal(log.length, 18, "§7 has eighteen admitted events");
  assert.deepStrictEqual(JSON.parse(json(log)), JSON.parse(json(replay.log)), "the log built step by step is not the log replayScript returned");

  const finalList = standingsOf(replay.log);
  seeStandings(finalList);
  checkStandings("at seq 18", finalList, AT_SEQ_18);
  console.log("== the standings at seq 18 (plan §7: c1 c2 c4 inherited by cfo, c3 and c10 binding, c5 to c9 void) ==");
  printStandings("final standings", finalList);

  const scrubbed = standingsOf(replay.log.slice(0, 10));
  assert.deepStrictEqual(JSON.parse(json(scrubbed)), JSON.parse(json(beforeRevoke?.list)), "scrubbing back to seq 10 did not give the standings the log that stopped at seq 10 gave");
  console.log("\n== scrub back to seq 10: the first ten events of the final log, folded again ==");
  printStandings("standings (revocation did not rewrite the past)", scrubbed);

  // ---- observed kinds ----
  const missing = (label: string, required: Readonly<Record<string, true>>, seen: ReadonlySet<string>): string[] =>
    Object.keys(required)
      .filter((kind) => !seen.has(kind))
      .map((kind) => `${label} ${kind}`);
  console.log("\n== kinds observed in the run ==");
  console.log(`  Standing  ${seenStandings.size}/${Object.keys(STANDING_KINDS).length}   ${[...seenStandings].sort().join(" ")}`);
  console.log(`  Breach    ${seenBreaches.size}/${Object.keys(BREACH_KINDS).length}   ${[...seenBreaches].sort().join(" ")}`);
  console.log(`  Rejection ${seenRejections.size}/${Object.keys(REJECTION_KINDS).length}  ${[...seenRejections].sort().join(" ")}`);
  const never = [...missing("Standing", STANDING_KINDS, seenStandings), ...missing("Breach", BREACH_KINDS, seenBreaches), ...missing("Rejection", REJECTION_KINDS, seenRejections)];
  assert.deepStrictEqual(never, [], `kinds never observed in the run: ${never.join(", ")}`);

  // ---- the oracle over §7 ----
  console.log("\n== the oracle, independent of lib/allowance: per root grant, the amount ruled binding or inherited, from the raw log, against its limit ==");
  let canonRuns = 0;
  for (let seq = 1; seq <= replay.log.length; seq++) {
    const prefix = replay.log.slice(0, seq);
    runOracle(`the §7 log at seq ${seq}`, prefix, standingsOf(prefix));
    canonRuns++;
  }
  for (const entry of runOracle("the §7 log at seq 18", replay.log, finalList)) {
    console.log(`  root ${entry.root}: ${entry.bound} bound of a limit of ${entry.limit}   (checked at every prefix, seq 1 to 18: ${canonRuns} prefixes)`);
    oracleRuns.push(entry.root);
  }
  assert.ok(oracleRuns.length > 0, "the oracle saw no root grant");

  // ---- part 2: the autonomous quarter that follows the incident ----
  console.log(`\n== an autonomous quarter, seed ${DEMO_SEED}, ${DEMO_TICKS} ticks: the five policies run on the company the incident leaves ==`);
  const quarter = runQuarter(DEMO_SEED, DEMO_TICKS);
  assert.equal(quarter.fault, null, "the quarter ended with a fault");
  const canonPart = quarter.attempts.slice(0, CANON_SCRIPT.length);
  for (const attempt of canonPart) {
    const step = attempt.label === null ? undefined : stepOfLabel.get(attempt.label);
    if (step === undefined) throw new Error(`attempt ${attempt.n} of the quarter is not a step of the script`);
    checkAttempt(step, attempt);
  }
  console.log(`  the quarter opens with the 33 steps above, and the engine gave every one of them the same answer (tick 0, attempts 1 to ${CANON_SCRIPT.length})`);
  const tally = new Map<string, Map<string, number>>();
  for (const attempt of quarter.attempts.slice(CANON_SCRIPT.length)) {
    const outcome = attempt.outcome;
    const what =
      outcome.kind === "rejected"
        ? `refused:${outcome.rejection.kind}`
        : outcome.kind === "faulty-log"
          ? `faulty-log:${outcome.fault.kind}`
          : outcome.verdict === null
            ? `admitted ${outcome.event.kind}`
            : outcome.verdict.kind === "warranted"
              ? "admitted commit, warranted"
              : `admitted commit, breached:${outcome.verdict.breach.kind}`;
    const row = tally.get(attempt.source) ?? new Map<string, number>();
    row.set(what, (row.get(what) ?? 0) + 1);
    tally.set(attempt.source, row);
  }
  for (const [source, row] of tally) {
    const total = [...row.values()].reduce((sum, count) => sum + count, 0);
    console.log(`  ${source.padEnd(18)} ${String(total).padStart(3)} attempts   ${[...row].sort().map(([what, count]) => `${what} x${count}`).join("; ")}`);
  }
  let prefixes = 0;
  let last: readonly RootBound[] = [];
  for (let seq = 1; seq <= quarter.log.length; seq++) {
    const prefix = quarter.log.slice(0, seq);
    last = runOracle(`the quarter's log at seq ${seq}`, prefix, standingsOf(prefix));
    prefixes++;
  }
  const quarterStandings = standingsOf(quarter.log);
  const counts = new Map<string, number>();
  for (const standing of quarterStandings) counts.set(standing.kind, (counts.get(standing.kind) ?? 0) + 1);
  console.log(`  the quarter's log: ${quarter.log.length} admitted events; standings ${[...counts].sort().map(([kind, count]) => `${kind} x${count}`).join(" ")}`);
  for (const entry of last) console.log(`  oracle: root ${entry.root}: ${entry.bound} bound of a limit of ${entry.limit}`);
  console.log(`  the oracle held at every prefix of the quarter's log, seq 1 to ${quarter.log.length} (${prefixes} prefixes)`);

  console.log("\ndemo OK: every step got the answer plan §7 gives it, every kind of Standing, Breach and Rejection was observed, and the oracle held.");
}

try {
  main();
} catch (error) {
  const text = error instanceof Error ? error.message : String(error);
  console.error(`\nDEMO FAILED: ${text}`);
  process.exitCode = 1;
}
