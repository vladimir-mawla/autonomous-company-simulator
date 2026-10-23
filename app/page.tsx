/**
 * Placeholder home page: genesis only, no engine code and no domain logic.
 *
 * M2 adds a deployed skeleton with a real health endpoint (app/api/health)
 * backed by M1's frozen contracts. M8 replaces this file with the
 * interactive demo that drives the real engine in the browser. Until then
 * this page exists only so `npm run build` has something real to render.
 */
export default function Home() {
  return (
    <main>
      <h1>Autonomous Company Simulator</h1>
      <p>
        Who answers for what an organisation of autonomous agents has done.
        Authority is conserved when it is delegated, revocation reaches only
        the future, and every commitment is ruled binding, inherited or void
        against the record as it stood when the act was made.
      </p>
      <p>
        This project is in progress. There is no engine and no live demo yet;
        see the README for current status.
      </p>
    </main>
  );
}
