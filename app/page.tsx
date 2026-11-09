import CompanyDemo from "../components/company/CompanyDemo";
import { MILESTONES, currentMilestone } from "./milestones";

/**
 * M8: the interactive demo. This page stays a server component; `CompanyDemo` is the one client boundary, and `components/company/compute-demo-view.ts` is the
 * one place the page calls the engine. Nothing on this page writes a milestone number into prose: the status list below is read from `./milestones`.
 */
export default function Home() {
  const current = currentMilestone();
  return (
    <main>
      <header className="cd-hero">
        <p className="cd-eyebrow">Autonomous Company Simulator</p>
        <h1>Who answers for what the agents did?</h1>
        <p className="cd-lead">
          Meridian Supply Co. is run by six software agents under one human, dana. Authority is <strong>conserved</strong> when it is delegated, a revoke reaches{" "}
          <strong>only the future</strong>, and every commitment is ruled <strong>binding</strong>, <strong>inherited</strong> or <strong>void</strong> against the
          record as it stood when the act was made.
        </p>
        <p className="cd-lead">
          Nothing below is a recording. Every ruling, refusal and number is computed by the real engine, in your browser, from the log on the page, again on every click.
        </p>
        <h2 className="cd-tour-title">A 90-second tour</h2>
        <ol className="cd-tour">
          <li>
            <strong>Read who granted what.</strong> dana gave the cfo the company&rsquo;s authority; the cfo split it between ops and support; ops split its share between two buyers.
          </li>
          <li>
            <strong>Press &ldquo;Spend beyond limit&rdquo;.</strong> The engine records the act and rules it void; the bound meter does not move.
          </li>
          <li>
            <strong>Press &ldquo;Widen scope&rdquo; or &ldquo;Over-delegate&rdquo;.</strong> Each is refused by name, and takes no seq.
          </li>
          <li>
            <strong>Press &ldquo;Revoke Ops-Lead&rdquo;.</strong> The grant and everything under it dies; what was already done is not erased: it becomes inherited, and the cfo answers for it.
          </li>
          <li>
            <strong>Drag the scrubber back to seq 10.</strong> The same four acts are binding again: a revoke did not rewrite the past.
          </li>
          <li>
            <strong>Run an autonomous quarter.</strong> Five policies act, one of them compromised; the bound still holds.
          </li>
        </ol>
      </header>
      <CompanyDemo />
      <footer className="cd-footer">
        <h2>Build status</h2>
        <p>
          {current === undefined
            ? "All nine milestones are done."
            : `Milestone ${current.id}, ${current.title.toLowerCase()}, is ${current.status === "in-progress" ? "in progress" : "next"}.`}{" "}
          <a href="https://github.com/vladimir-mawla/autonomous-company-simulator">Source</a>
        </p>
        <ol className="cd-milestones">
          {MILESTONES.map((milestone) => (
            <li key={milestone.id} className={`cd-ms cd-ms-${milestone.status}`}>
              <span className="cd-ms-id">M{milestone.id}</span> {milestone.title} <span className="cd-ms-status">{milestone.status === "in-progress" ? "in progress" : milestone.status}</span>
            </li>
          ))}
        </ol>
      </footer>
    </main>
  );
}
