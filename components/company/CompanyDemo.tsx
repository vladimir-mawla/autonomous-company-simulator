"use client";

import { useReducer } from "react";
import { QUARTER_TICKS, MAX_SEED, REVOKE_LABEL, computeDemoView, demoReducer, describePreset, initialDemoState } from "./compute-demo-view.js";
import type { DemoAction, DemoState, DemoView, GrantNode, OverreachPreset, StandingRow } from "./compute-demo-view.js";
import { formatAmount, formatOffered, formatOutcome, formatTally } from "./format-attempt.js";
import { commitLine, formatStanding } from "./format-standing.js";

/**
 * `CompanyDemo.tsx`: the whole of the interactive page (plan §6 M8).
 *
 * ONE REDUCER, NO EFFECTS. The component holds one piece of state, `useReducer(demoReducer, ...)`, whose value is the log on screen and the calls
 * that made it. It calls `computeDemoView(state)` in its render body, so every box below is the engine's answer for the state that is on
 * screen at that moment, folded again from the log; there is no second copy of anything the engine said that could go stale.
 * Neither `useEffect`, `useCallback`, `useMemo`, `setTimeout` nor `async` appears in this directory (`__tests__/source-scan.test.ts` checks the
 * forms it can see, and says which it cannot), and nothing here reads the clock or a random number, so the server's markup and the
 * browser's first render are the same string (`__tests__/CompanyDemo.render.test.tsx`).
 *
 * THE COMPONENT RENDERS; IT RULES ON NOTHING. It calls no engine function: the heir, the breach, the refusal and every number come from `computeDemoView`
 * (the one bridge) and are turned into words by the `format-*` files, which only read the fields the engine put there.
 */

interface CompanyDemoProps {
  /** Only for tests: the state the page opens on, so a render test can look at more than the opening log without clicking. Not read again after mount. */
  readonly initial?: DemoState;
}

const PRESETS: readonly { readonly preset: OverreachPreset; readonly label: string }[] = [
  { preset: "widen-scope", label: "Widen scope" },
  { preset: "over-delegate", label: "Over-delegate" },
  { preset: "spend-beyond-limit", label: "Spend beyond limit" },
];

function Badge({ kind }: { readonly kind: "binding" | "inherited" | "void" }) {
  return <span className={`cd-badge cd-badge-${kind}`}>{kind}</span>;
}

function GrantItem({ node }: { readonly node: GrantNode }) {
  const { grant } = node;
  const status = node.revokedAt !== null ? `revoked at seq ${node.revokedAt}` : node.live ? "live" : "cut off (a grant above it was revoked)";
  const summary = `${grant.id}: limit ${formatAmount(grant.limit)}, used ${formatAmount(node.used)}, headroom ${formatAmount(node.headroom)}, ${status}`;
  return (
    <li>
      <div className={node.live ? "cd-grant" : "cd-grant cd-grant-dead"}>
        <p className="cd-grant-head">
          <strong>{grant.id}</strong> <span className="cd-who">{grant.grantor} grants {grant.grantee}</span>
          <span className={node.live ? "cd-pill cd-pill-live" : "cd-pill cd-pill-dead"}>{status}</span>
        </p>
        <p className="cd-caps">
          {grant.capabilities.join(", ")} · depth {grant.depth}
        </p>
        <progress className="cd-bar" value={node.used} max={grant.limit} aria-label={summary} />
        <dl className="cd-nums">
          <div>
            <dt>limit</dt>
            <dd>{formatAmount(grant.limit)}</dd>
          </div>
          <div>
            <dt>used</dt>
            <dd>{formatAmount(node.used)}</dd>
          </div>
          <div>
            <dt>headroom</dt>
            <dd>{formatAmount(node.headroom)}</dd>
          </div>
          {node.absorbed !== null ? (
            <div>
              <dt>absorbed by the revoke</dt>
              <dd>{formatAmount(node.absorbed)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {node.children.length > 0 ? (
        <ul className="cd-tree">
          {node.children.map((child) => (
            <GrantItem key={child.grant.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function StandingRowView({ row }: { readonly row: StandingRow }) {
  const described = formatStanding(row.standing);
  return (
    <tr>
      <th scope="row" className="cd-commit">
        <span className="cd-id">{row.standing.commitId}</span>
        <span className="cd-sub">{commitLine(row.actor, row.capability, row.amount, row.actedUnder)}</span>
      </th>
      <td className="cd-seq">{row.standing.committedAt}</td>
      <td>
        <Badge kind={row.standing.kind} />
      </td>
      <td className="cd-answers">
        <span>{described.answers}</span>
        <code className="cd-detail">{described.detail}</code>
      </td>
    </tr>
  );
}

function Standings({ view }: { readonly view: DemoView }) {
  return (
    <section aria-labelledby="h-standings" className="cd-card">
      <h2 id="h-standings">Who answers for each commitment</h2>
      <p className="cd-note">
        Ruled by the engine for the log as it stood at seq {view.at}: {view.counts.binding} binding, {view.counts.inherited} inherited, {view.counts.void} void.
        A commitment is ruled once, against the record when the act was made; a later revoke can only turn a binding one into an inherited one.
      </p>
      {view.rows.length === 0 ? (
        <p className="cd-empty">No commitment has been recorded at this point of the log.</p>
      ) : (
        <div className="cd-scroll" role="region" aria-label="Commitments and their standings" tabIndex={0}>
          <table className="cd-table">
            <caption className="cd-sr">Commitments, the standing the engine ruled each, and who answers for it</caption>
            <thead>
              <tr>
                <th scope="col">Commit</th>
                <th scope="col">Seq</th>
                <th scope="col">Standing</th>
                <th scope="col">Who answers</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <StandingRowView key={row.standing.commitId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Transcript({ view }: { readonly view: DemoView }) {
  const newestFirst = [...view.attempts].reverse();
  return (
    <section aria-labelledby="h-transcript" className="cd-card">
      <h2 id="h-transcript">Everything that was offered to the engine, and what it said</h2>
      <p className="cd-note">Newest first. A refused attempt is named and is not in the log; it takes no seq.</p>
      <div className="cd-scroll cd-scroll-tall" role="region" aria-label="Attempt transcript" tabIndex={0}>
        <ol className="cd-transcript">
          {newestFirst.map((attempt) => {
            const answer = formatOutcome(attempt.outcome);
            return (
              <li key={attempt.n} className={`cd-attempt cd-tone-${answer.tone}`}>
                <p className="cd-attempt-head">
                  <span className="cd-n">#{attempt.n}</span> <span className="cd-source">{attempt.source === "canon" ? "canonical step" : `${attempt.source}, tick ${attempt.tick}`}</span>
                </p>
                {attempt.label !== null ? <p className="cd-label">{attempt.label}</p> : null}
                <code className="cd-offered">{formatOffered(attempt.input)}</code>
                <p className="cd-answer">
                  <strong>{answer.headline}</strong>
                  {answer.text === "" ? null : <span> — {answer.text}</span>}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function Quarter({ view }: { readonly view: DemoView }) {
  if (view.tally.length === 0) return null;
  return (
    <section aria-labelledby="h-quarter" className="cd-card">
      <h2 id="h-quarter">What each autonomous policy did</h2>
      <p className="cd-note">
        The five policies act on the company the incident leaves. The compromised one spends as fast as it can inside what it holds; the engine
        cannot tell it from a diligent buyer, and what it can say is how much was at stake and who answers.
      </p>
      <div className="cd-scroll" role="region" aria-label="Autonomous policies and the engine's answers" tabIndex={0}>
        <table className="cd-table">
          <caption className="cd-sr">Calls per policy, grouped by the engine's answer</caption>
          <thead>
            <tr>
              <th scope="col">Policy</th>
              <th scope="col">Calls</th>
              <th scope="col">What the engine answered</th>
            </tr>
          </thead>
          <tbody>
            {view.tally.map((row) => (
              <tr key={row.source}>
                <th scope="row">{row.source}</th>
                <td className="cd-seq">{row.total}</td>
                <td>
                  <ul className="cd-outcomes">
                    {row.outcomes.map((outcome) => (
                      <li key={outcome.what}>{formatTally(outcome.what, outcome.count)}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Demo({ state, view, dispatch }: { readonly state: DemoState; readonly view: DemoView; readonly dispatch: (action: DemoAction) => void }) {
  const latest = view.latest;
  const answer = latest === null ? null : formatOutcome(latest.outcome);
  const past = view.at < view.head;
  const atWords = view.atEvent === null ? "the empty log, before anything was admitted" : formatOffered(view.atEvent);
  return (
    <>
      <section aria-labelledby="h-try" className="cd-card">
        <h2 id="h-try">Try to break it</h2>
        <p className="cd-note">Each button offers one event to the real engine. It answers with a seq, a ruling or a named refusal.</p>
        <div className="cd-buttons" role="group" aria-label="Overreach presets">
          {PRESETS.map(({ preset, label }) => (
            <button
              key={preset}
              type="button"
              className="cd-btn"
              title={describePreset(preset)}
              onClick={() => {
                dispatch({ type: "overreach", preset });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="cd-buttons" role="group" aria-label="Revoke">
          <button
            type="button"
            className="cd-btn cd-btn-primary"
            title={REVOKE_LABEL}
            onClick={() => {
              dispatch({ type: "revoke-ops-lead" });
            }}
          >
            Revoke Ops-Lead
          </button>
        </div>
        <div className="cd-buttons" role="group" aria-label="Autonomous quarter">
          <button
            type="button"
            className="cd-btn"
            onClick={() => {
              dispatch({ type: "quarter" });
            }}
          >
            Autonomous quarter (seed {state.seed})
          </button>
          <label className="cd-seed">
            <span>Seed</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_SEED}
              step={1}
              value={state.seed}
              onChange={(event) => {
                dispatch({ type: "set-seed", seed: Number(event.target.value) });
              }}
            />
          </label>
          <button
            type="button"
            className="cd-btn"
            onClick={() => {
              dispatch({ type: "replay-incident" });
            }}
          >
            Replay the whole incident
          </button>
          <button
            type="button"
            className="cd-btn"
            onClick={() => {
              dispatch({ type: "reset" });
            }}
          >
            Reset
          </button>
        </div>
        <p className="cd-note">
          The quarter runs {QUARTER_TICKS} ticks of the five policies after the incident, and replaces the log on screen. The seed fixes what they do.
        </p>
        <div className="cd-latest" role="status" aria-live="polite">
          {latest === null || answer === null ? (
            <p>Nothing has been offered to the engine yet.</p>
          ) : (
            <p>
              <span className="cd-label-strong">Latest answer, #{latest.n}:</span> <code>{formatOffered(latest.input)}</code> <span className={`cd-tone-text cd-tone-${answer.tone}`}>{answer.headline}</span>
              {answer.text === "" ? null : <span> ({answer.text})</span>}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="h-time" className="cd-card">
        <h2 id="h-time">Time travel</h2>
        <p className="cd-note">Drag back to see the company as the log stood then. Everything on this page is folded again from the events up to that seq.</p>
        <div className="cd-scrubber">
          <label htmlFor="seq-scrubber">Show the log as of seq</label>
          <input
            id="seq-scrubber"
            type="range"
            min={0}
            max={view.head}
            step={1}
            value={view.at}
            aria-valuetext={`seq ${view.at} of ${view.head}`}
            onChange={(event) => {
              dispatch({ type: "scrub", to: Number(event.target.value) });
            }}
          />
          <output htmlFor="seq-scrubber" className="cd-out">
            {view.at} / {view.head}
          </output>
        </div>
        <div className="cd-buttons" role="group" aria-label="Step through the log">
          <button
            type="button"
            className="cd-btn"
            disabled={view.at === 0}
            onClick={() => {
              dispatch({ type: "scrub", to: view.at - 1 });
            }}
          >
            Back one
          </button>
          <button
            type="button"
            className="cd-btn"
            disabled={!past}
            onClick={() => {
              dispatch({ type: "scrub", to: view.at + 1 });
            }}
          >
            Forward one
          </button>
          <button
            type="button"
            className="cd-btn"
            disabled={!past}
            onClick={() => {
              dispatch({ type: "scrub", to: null });
            }}
          >
            Back to live
          </button>
        </div>
        <p className={past ? "cd-when cd-when-past" : "cd-when"} role="status" aria-live="polite">
          {past ? (
            <>
              <strong>Viewing the past.</strong> {view.at} of {view.head} events admitted. The buttons above act on the live log, and pressing one returns you to it.{" "}
            </>
          ) : (
            <>
              <strong>Live.</strong> {view.head} events admitted.{" "}
            </>
          )}
          Last event shown: <code>{atWords}</code>
        </p>
      </section>

      <section aria-labelledby="h-bound" className="cd-card">
        <h2 id="h-bound">The bound</h2>
        <p className="cd-note">
          What the engine ruled binding or inherited, added up, against what the roots granted. The engine refuses a grant that over-allocates and
          rules a spend past a limit void, so the first number cannot pass the second.
        </p>
        <progress className={view.meter.holds ? "cd-bar cd-bar-wide" : "cd-bar cd-bar-wide cd-bar-broken"} value={view.meter.bound} max={view.meter.rootLimit} aria-label={`Bound ${formatAmount(view.meter.bound)} of ${formatAmount(view.meter.rootLimit)} granted by the roots`} />
        <p className="cd-meter" data-testid="conservation-meter">
          <span>
            Σ binding + inherited = <strong>{formatAmount(view.meter.bound)}</strong>
          </span>
          <span className="cd-leq">{view.meter.holds ? "≤" : ">"}</span>
          <span>
            Σ root limits = <strong>{formatAmount(view.meter.rootLimit)}</strong>
          </span>
          <span className={view.meter.holds ? "cd-pill cd-pill-live" : "cd-pill cd-pill-dead"}>{view.meter.holds ? "the bound holds" : "the bound is broken"}</span>
        </p>
      </section>

      <section aria-labelledby="h-tree" className="cd-card">
        <h2 id="h-tree">Who granted what</h2>
        <p className="cd-note">
          {view.roots.join(", ")} {view.roots.length === 1 ? "is" : "are"} the only human root{view.roots.length === 1 ? "" : "s"}; every grant below is a share of one above it. Bars show used against limit as the
          engine counts them: what a grant has spent, plus what it has handed down. {view.grantCount} grant{view.grantCount === 1 ? "" : "s"} at seq {view.at}.
        </p>
        {view.grants.length === 0 ? (
          <p className="cd-empty">No grant has been admitted at this point of the log.</p>
        ) : (
          <div className="cd-scroll cd-scroll-tall" role="region" aria-label="Grant tree" tabIndex={0}>
            <ul className="cd-tree cd-tree-root">
              {view.grants.map((node) => (
                <GrantItem key={node.grant.id} node={node} />
              ))}
            </ul>
          </div>
        )}
      </section>

      <Standings view={view} />
      <Quarter view={view} />
      <Transcript view={view} />
    </>
  );
}

export default function CompanyDemo({ initial }: CompanyDemoProps) {
  const [state, dispatch] = useReducer(demoReducer, initial, (given: DemoState | undefined) => given ?? initialDemoState());
  const result = computeDemoView(state);

  if (!result.ok) {
    return (
      <section className="cd-card cd-error" role="alert" aria-labelledby="h-error">
        <h2 id="h-error">The demo could not compute a view</h2>
        <p>{result.error}</p>
        <button
          type="button"
          className="cd-btn cd-btn-primary"
          onClick={() => {
            dispatch({ type: "reset" });
          }}
        >
          Reset
        </button>
      </section>
    );
  }
  return <Demo state={state} view={result.view} dispatch={dispatch} />;
}
