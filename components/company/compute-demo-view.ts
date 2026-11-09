import { absorbedBy, headroomOf, usedOf } from "../../lib/allowance/index.js";
import { commitId } from "../../lib/contracts/index.js";
import type { Commitment, EventInput, Grant, Log, LogEvent, Standing } from "../../lib/contracts/index.js";
import { fold, standings } from "../../lib/standing/index.js";
import { CANON_SCRIPT, CHARTER, INCIDENT_TICK, makeOrgView, offer, replayScript, runQuarter } from "../../domains/company/index.js";
import type { Attempt, CompanyCapability, ScriptStep } from "../../domains/company/index.js";

export type { Breach, Rejection, Standing } from "../../lib/contracts/index.js";
export type { Attempt, AttemptOutcome, CompanyCapability } from "../../domains/company/index.js";

/**
 * `compute-demo-view.ts`: the one bridge between the page and the engine (plan §6 M8).
 *
 * THIS IS THE ONLY FILE UNDER `components/` THAT IMPORTS `lib/**` OR `domains/**`. `CompanyDemo.tsx` and the three formatters take their types
 * from here and call no engine function; `__tests__/source-scan.test.ts` checks that by walking the syntax tree of every file of
 * the directory and of `app/page.tsx` (it reports what it can see, and `support/scan.ts` lists what it cannot).
 *
 * WHAT IT HOLDS. `DemoState` is `{ log, attempts }`, which is what the page is made of, plus two small things that are the page's own: `cursor`,
 * the position of the time-travel scrubber (`null` is the live head), and `seed`, the number in the "Autonomous quarter" box. `demoReducer` is
 * the single reducer the component runs; every event that reaches the log passes through `offer` (`domains/company`), which calls `append`,
 * so nothing the page shows as admitted, refused or ruled was typed here. `computeDemoView` is a pure function of a `DemoState`: it folds the
 * log on screen again, from nothing, on every call, and returns what `lib/standing`, `lib/allowance` and `domains/company` say about it.
 *
 * WHAT IT DOES NOT DO. It decides no standing, no heir, no rejection and no headroom; each of those is read off a value the engine returned.
 * The arithmetic in this file is two things the plan names: `returned` (one subtraction, see `GrantNode`) and `meterOf`, the conservation meter (the sum of the
 * amounts ruled binding or inherited against the sum of the root grants' limits). It is an OBSERVER, as `scripts/demo-company.ts`'s oracle is: nothing reads it to admit or refuse
 * anything, and `__tests__/compute-demo-view.test.ts` compares it with the sum of the engine's own `charges` (one per warranted commit).
 *
 * NEVER THROWS. Each check that can fail returns `{ ok: false, error }`; the `try/catch` in `computeDemoView` is the second layer, for what the first
 * did not foresee. `demoReducer` has no try/catch: it calls `offer`, `replayScript` and `runQuarter` with the constants of this file, and was run on every sequence of at most four
 * buttons without throwing (`__tests__/compute-demo-view.test.ts`); that is evidence for those sequences, not a proof for every state. The one engine answer it does not use, a `fault` from
 * `runQuarter`, is described at that line.
 */

/** The ticks of the "Autonomous quarter" button: the number `npm run demo:company` runs (`DEMO_TICKS` there), so the page shows the same quarter. */
export const QUARTER_TICKS = 60;
/** The seed the page opens with: `DEMO_SEED` in `scripts/demo-company.ts`. */
export const DEFAULT_SEED = 1;
/** The largest seed the box takes. `mulberry32` reduces any number to 32 bits; the box is bounded so that what it shows is what ran. */
export const MAX_SEED = 999_999;

export interface DemoState {
  /** What the engine has admitted, in order: the log of `append`. */
  readonly log: Log<CompanyCapability>;
  /** Every call made to the engine, admitted or refused, with its answer. */
  readonly attempts: readonly Attempt[];
  /** The `seq` the scrubber is at; `null` is the live head. */
  readonly cursor: number | null;
  /** The seed of the next "Autonomous quarter". */
  readonly seed: number;
}

export type OverreachPreset = "widen-scope" | "over-delegate" | "spend-beyond-limit";

export type DemoAction =
  | { readonly type: "revoke-ops-lead" }
  | { readonly type: "overreach"; readonly preset: OverreachPreset }
  | { readonly type: "quarter" }
  | { readonly type: "set-seed"; readonly seed: number }
  | { readonly type: "replay-incident" }
  | { readonly type: "reset" }
  | { readonly type: "scrub"; readonly to: number | null };

// ---- the steps of the canonical script the buttons offer ------------------------------------------------------------

function stepOf(key: string): ScriptStep {
  const step = CANON_SCRIPT.find((candidate) => candidate.key === key);
  if (step === undefined) throw new Error(`the canonical script has no step ${key}`);
  return step;
}

/** The step that is the revoke of seq 11: the page opens on the log as it stood just before it. */
const REVOKE_STEP = stepOf("revoke-G2");
const OVERREACH_STEPS: Readonly<Record<OverreachPreset, ScriptStep>> = {
  "widen-scope": stepOf("widen-scope"),
  "over-delegate": stepOf("over-delegate"),
  "spend-beyond-limit": stepOf("c8"),
};

/** What each preset offers, in the words of the script's own narration. */
export function describePreset(preset: OverreachPreset): string {
  return OVERREACH_STEPS[preset].label;
}

/** The narration of the revoke step. */
export const REVOKE_LABEL: string = REVOKE_STEP.label;

// ---- the reducer -----------------------------------------------------------------------------------------------------

/**
 * The page as it opens: §7's log up to the moment before the revoke (its first ten admitted events and the eleven attempts of beat 1 that were
 * refused), offered to the engine one step at a time. "Revoke Ops-Lead" then offers the revoke of seq 11.
 */
export function initialDemoState(): DemoState {
  const upToRevoke = CANON_SCRIPT.slice(0, CANON_SCRIPT.indexOf(REVOKE_STEP));
  const replay = replayScript(upToRevoke);
  return { log: replay.log, attempts: replay.attempts, cursor: null, seed: DEFAULT_SEED };
}

function offered(state: DemoState, input: EventInput<CompanyCapability>, label: string): DemoState {
  const last = state.attempts[state.attempts.length - 1];
  const result = offer(state.log, input, { n: state.attempts.length + 1, tick: last === undefined ? INCIDENT_TICK : last.tick, source: "canon", label });
  return { ...state, log: result.log, attempts: [...state.attempts, result.attempt], cursor: null };
}

/** The "spend beyond limit" step with an id of its own, so that pressing the button twice offers two commits and not the same id twice. */
function spendInput(step: ScriptStep, n: number): EventInput<CompanyCapability> {
  const input = step.input;
  if (input.kind !== "commit") return input;
  const commit: Commitment<CompanyCapability> = { ...input.commit, id: commitId(`ui-c-${n}`) };
  return { kind: "commit", commit };
}

function normaliseSeed(seed: number, previous: number): number {
  if (!Number.isFinite(seed)) return previous;
  return Math.min(Math.max(Math.trunc(seed), 0), MAX_SEED);
}

function normaliseCursor(to: number | null, head: number, previous: number | null): number | null {
  if (to === null) return null;
  if (Number.isNaN(to)) return previous;
  const whole = Math.trunc(to);
  if (whole >= head) return null;
  return whole < 0 ? 0 : whole;
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "scrub":
      return { ...state, cursor: normaliseCursor(action.to, state.log.length, state.cursor) };
    case "set-seed":
      return { ...state, seed: normaliseSeed(action.seed, state.seed) };
    case "reset":
      return initialDemoState();
    case "replay-incident": {
      const replay = replayScript();
      return { log: replay.log, attempts: replay.attempts, cursor: null, seed: state.seed };
    }
    case "quarter": {
      const quarter = runQuarter(state.seed, QUARTER_TICKS);
      // `fault` is non-null only if a log `append` built could not be replayed, which `append` has not produced in the domain's own 200-seed test. This branch is NOT covered by any test.
      // If it ever were taken, the page keeps what it showed rather than show a log the engine could not replay.
      if (quarter.fault !== null) return state;
      return { log: quarter.log, attempts: quarter.attempts, cursor: null, seed: state.seed };
    }
    case "revoke-ops-lead":
      return offered(state, REVOKE_STEP.input, REVOKE_STEP.label);
    case "overreach": {
      const step = OVERREACH_STEPS[action.preset];
      const input = action.preset === "spend-beyond-limit" ? spendInput(step, state.attempts.length + 1) : step.input;
      return offered(state, input, step.label);
    }
  }
}

// ---- the view --------------------------------------------------------------------------------------------------------

export interface GrantNode {
  readonly grant: Grant<CompanyCapability>;
  /** Neither this grant nor an ancestor is revoked (`domains/company`'s `makeOrgView`, which reads it off `lib/chain`). */
  readonly live: boolean;
  /** The seq of the revoke of this grant itself, if there is one. */
  readonly revokedAt: number | null;
  /** `lib/allowance`'s `usedOf` and `headroomOf` for this grant, as the engine answers them. */
  readonly used: number;
  readonly headroom: number;
  /** `lib/allowance`'s `absorbedBy`, for a grant that was revoked itself; `null` for any other. */
  readonly absorbed: number | null;
  /** What a revoke gave back to the parent: this grant's limit less `absorbed`, the subtraction `scripts/demo-company.ts` prints as `returned` (plan §8 A: "`absorbedBy` + `grant.limit`"). `null` for a grant that was not revoked itself. */
  readonly returned: number | null;
  readonly children: readonly GrantNode[];
}

/** One commitment: the engine's standing for it, and the facts of the commit it is the standing of, read off the log on screen. */
export interface StandingRow {
  readonly standing: Standing;
  readonly actor: string;
  readonly capability: string;
  readonly amount: number;
  readonly actedUnder: string;
}

export interface Meter {
  /** The amounts of the commits the engine ruled `binding` or `inherited`, added up. */
  readonly bound: number;
  /** The limits of the root grants, added up. */
  readonly rootLimit: number;
  /** `bound` is not more than `rootLimit`. */
  readonly holds: boolean;
}

export interface TallyRow {
  /** Who made the calls: a policy's name (the canonical steps are not counted). */
  readonly source: string;
  readonly total: number;
  /** What the engine answered, in the words of `scripts/demo-company.ts`'s tally, with how many times, in the order of first appearance. */
  readonly outcomes: readonly { readonly what: string; readonly count: number }[];
}

export interface DemoView {
  /** The principals the charter names as roots. */
  readonly roots: readonly string[];
  /** The number of events the engine admitted in the whole log (the live head). */
  readonly head: number;
  /** The `seq` the page is showing; `head` unless the scrubber is back. */
  readonly at: number;
  /** The event the engine admitted at `at` (`null` at 0): what the scrubber is standing on. */
  readonly atEvent: LogEvent<CompanyCapability> | null;
  readonly grants: readonly GrantNode[];
  readonly grantCount: number;
  readonly rows: readonly StandingRow[];
  readonly counts: Readonly<Record<Standing["kind"], number>>;
  readonly meter: Meter;
  /** The calls shown, oldest first: all of them at the live head, and up to the one admitted at `at` when the scrubber is back. */
  readonly attempts: readonly Attempt[];
  readonly latest: Attempt | null;
  readonly tally: readonly TallyRow[];
}

export type DemoResult = { readonly ok: true; readonly view: DemoView } | { readonly ok: false; readonly error: string };

const fail = (error: string): DemoResult => ({ ok: false, error });

/** The category of an answer, as `scripts/demo-company.ts` names it in the tally of the autonomous quarter. */
export function outcomeCategory(attempt: Attempt): string {
  const outcome = attempt.outcome;
  if (outcome.kind === "rejected") return `refused:${outcome.rejection.kind}`;
  if (outcome.kind === "faulty-log") return `faulty-log:${outcome.fault.kind}`;
  if (outcome.verdict === null) return `admitted ${outcome.event.kind}`;
  if (outcome.verdict.kind === "warranted") return "admitted commit, warranted";
  return `admitted commit, breached:${outcome.verdict.breach.kind}`;
}

/** The attempts and the log must be one story: the admitted attempts, in order, are exactly the log's events. */
function disagreement(state: DemoState): string | null {
  const admitted = state.attempts.flatMap((attempt) => (attempt.outcome.kind === "admitted" ? [attempt.outcome.event] : []));
  if (admitted.length !== state.log.length) return `the transcript has ${admitted.length} admitted calls and the log has ${state.log.length} events`;
  for (const [index, event] of admitted.entries()) {
    if (JSON.stringify(event) !== JSON.stringify(state.log[index])) return `the admitted call at position ${index + 1} is not the log's event at that position`;
  }
  return null;
}

function tallyOf(shown: readonly Attempt[]): readonly TallyRow[] {
  const rows = new Map<string, Map<string, number>>();
  for (const attempt of shown) {
    if (attempt.source === "canon") continue;
    const row = rows.get(attempt.source) ?? new Map<string, number>();
    const what = outcomeCategory(attempt);
    row.set(what, (row.get(what) ?? 0) + 1);
    rows.set(attempt.source, row);
  }
  return [...rows].map(([source, row]) => {
    const outcomes = [...row].map(([what, count]) => ({ what, count })).sort((a, b) => (a.what < b.what ? -1 : a.what > b.what ? 1 : 0));
    return { source, total: outcomes.reduce((sum, outcome) => sum + outcome.count, 0), outcomes };
  });
}

/** The conservation meter: the one arithmetic in this file, an observer that nothing reads to decide anything. */
function meterOf(rows: readonly StandingRow[], grants: readonly Grant<CompanyCapability>[]): Meter {
  let bound = 0;
  for (const row of rows) if (row.standing.kind !== "void") bound += row.amount;
  let rootLimit = 0;
  for (const grant of grants) if (grant.parent === null) rootLimit += grant.limit;
  return { bound, rootLimit, holds: bound <= rootLimit };
}

function build(state: DemoState): DemoResult {
  const head = state.log.length;
  const at = state.cursor === null ? head : state.cursor;
  if (!Number.isInteger(at) || at < 0 || at > head) return fail(`the time-travel position ${String(at)} is outside 0 to ${head}`);
  const split = disagreement(state);
  if (split !== null) return fail(split);

  const prefix = state.log.slice(0, at);
  const folded = fold(CHARTER, prefix);
  if (!folded.ok) return fail(`the engine could not replay the log to seq ${at}: ${JSON.stringify(folded.fault)}`);
  const ruled = standings(CHARTER, prefix);
  if (!ruled.ok) return fail(`the engine could not give the standings at seq ${at}: ${JSON.stringify(ruled.fault)}`);
  const last = state.attempts[state.attempts.length - 1];
  const org = makeOrgView(prefix, last === undefined ? INCIDENT_TICK : last.tick);
  if (!org.ok) return fail(`the engine could not read the company at seq ${at}: ${JSON.stringify(org.fault)}`);
  const { tree, charges } = folded.folded;

  // the grant tree, in the order the engine admitted the grants
  const nodes = new Map<string, { node: Omit<GrantNode, "children">; children: string[] }>();
  const rootIds: string[] = [];
  for (const entry of org.view.grants) {
    const id = entry.grant.id;
    const used = usedOf(tree, charges, id);
    const headroom = headroomOf(tree, charges, id);
    if (used === undefined || headroom === undefined) return fail(`the engine does not know the grant ${id} that its own log admitted`);
    const revokedAt = tree.revokedAt.get(id) ?? null;
    const absorbed = revokedAt === null ? null : (absorbedBy(tree, charges, id) ?? null);
    nodes.set(id, {
      node: { grant: entry.grant, live: entry.live, revokedAt, used, headroom, absorbed, returned: absorbed === null ? null : entry.grant.limit - absorbed },
      children: [],
    });
    if (entry.grant.parent === null) rootIds.push(id);
    else nodes.get(entry.grant.parent)?.children.push(id);
  }
  const nodeOf = (id: string): GrantNode => {
    const entry = nodes.get(id);
    if (entry === undefined) throw new Error(`the grant ${id} is not in the tree`);
    return { ...entry.node, children: entry.children.map(nodeOf) };
  };

  // the standings, with the commit each is the standing of
  const commits = new Map<string, Commitment<CompanyCapability>>();
  for (const event of prefix) if (event.kind === "commit") commits.set(event.commit.id, event.commit);
  const rows: StandingRow[] = [];
  const counts: Record<Standing["kind"], number> = { binding: 0, inherited: 0, void: 0 };
  for (const standing of ruled.standings) {
    const commit = commits.get(standing.commitId);
    if (commit === undefined) return fail(`the engine gave a standing for ${standing.commitId}, which is not in the log on screen`);
    rows.push({ standing, actor: commit.actor, capability: commit.capability, amount: commit.amount, actedUnder: commit.actedUnder });
    counts[standing.kind] += 1;
  }

  // the calls shown: up to and including the one the engine admitted at `at`
  let shown: readonly Attempt[] = state.attempts;
  if (at < head) {
    const cutoff = at === 0 ? 0 : (state.attempts.find((attempt) => attempt.outcome.kind === "admitted" && attempt.outcome.event.seq === at)?.n ?? 0);
    shown = state.attempts.filter((attempt) => attempt.n <= cutoff);
  }

  return {
    ok: true,
    view: {
      roots: CHARTER.roots,
      head,
      at,
      atEvent: prefix[at - 1] ?? null,
      grants: rootIds.map(nodeOf),
      grantCount: org.view.grants.length,
      rows,
      counts,
      meter: meterOf(rows, org.view.grants.map((entry) => entry.grant)),
      attempts: shown,
      latest: shown[shown.length - 1] ?? null,
      tally: tallyOf(shown),
    },
  };
}

/** The view of `state`, or why there is none. Pure: the same state gives the same answer, computed from the log on every call. */
export function computeDemoView(state: DemoState): DemoResult {
  try {
    return build(state);
  } catch (error) {
    return fail(`the demo could not compute a view: ${error instanceof Error ? error.message : String(error)}`);
  }
}
