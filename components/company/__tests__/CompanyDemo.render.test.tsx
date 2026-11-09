import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { currentMilestone } from "../../../app/milestones";
import Home from "../../../app/page";
import CompanyDemo from "../CompanyDemo";
import { computeDemoView, initialDemoState } from "../compute-demo-view.js";
import type { DemoState } from "../compute-demo-view.js";
import { QUARTER, REPLAY, REVOKE, SPEND, after, scrubTo } from "./support/states.js";

/**
 * Render-smoke tests (plan §6 M8 falsifiable check 3): `renderToStaticMarkup` of the component at several initial logs, no jsdom. They pin the strings a
 * visitor reads (the buttons, the badges, the heir, the meter, the refusals by name) and that the markup is a function of the state alone, which is
 * what lets the server's markup and the browser's first render agree.
 *
 * What these do NOT cover is a click: `vitest` stays `environment: "node"`, so the click-to-re-render path is exercised by hand in a browser against the
 * running build (recorded in ADR 0008 and, for the live URL, in `docs/WALKTHROUGH.md` by M9). The reducer and the view it feeds are what
 * `compute-demo-view.test.ts` exercises, including every sequence of at most four buttons.
 */

const html = (state?: DemoState): string => renderToStaticMarkup(createElement(CompanyDemo, state === undefined ? {} : { initial: state }));
const text = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, (entity) => ({ "&#x27;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">" })[entity] ?? entity).replace(/\s+/g, " ");

describe("the opening log (seq 10)", () => {
  const markup = html();
  const words = text(markup);

  it("has the controls the plan names, with their exact labels", () => {
    for (const label of ["Widen scope", "Over-delegate", "Spend beyond limit", "Revoke Ops-Lead", "Autonomous quarter (seed 1)", "Replay the whole incident", "Reset"]) {
      expect(markup).toContain(`>${label}</button>`);
    }
  });

  it("has the scrubber, labelled, from 0 to 10, standing at 10", () => {
    expect(markup).toContain('<label for="seq-scrubber">Show the log as of seq</label>');
    expect(markup).toContain('<input id="seq-scrubber" type="range" min="0" max="10" step="1" aria-valuetext="seq 10 of 10" value="10"/>');
    expect(words).toContain("Live. 10 events admitted.");
  });

  it("shows c1 c2 c3 c4 as binding and nothing else", () => {
    const rows = [...markup.matchAll(/<tr><th scope="row" class="cd-commit">.*?<\/tr>/g)].map((match) => text(match[0]));
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.trim().split(" ")[0])).toEqual(["c1", "c2", "c3", "c4"]);
    expect(rows.every((row) => row.includes(" binding "))).toBe(true);
    expect(rows[0]).toBe(" c1 buyer-a · purchase · 50,000 · under G4 7 binding dana, cfo, ops, buyer-a answer for it warrant chain G1>G2>G4 trail dana>cfo>ops>buyer-a ");
  });

  it("shows the conservation meter, 232,000 against 1,000,000, holding", () => {
    expect(words).toContain("Σ binding + inherited = 232,000 ≤ Σ root limits = 1,000,000 the bound holds");
  });

  it("shows the grant tree with limit, used and headroom (G2: 400,000 / 350,000 / 50,000)", () => {
    expect(markup).toContain('aria-label="G2: limit 400,000, used 350,000, headroom 50,000, live"');
    expect(markup).toContain('<progress class="cd-bar" value="350000" max="400000"');
    expect(words).toContain("G1 dana grants cfo");
    expect(words).toContain("6 grants at seq 10.");
  });

  it("names the refusals of beat 1 in the transcript, newest first, with the engine's own numbers", () => {
    expect(words).toContain("refused: over-allocation — 200,000 was asked of G2, which has 50,000 left");
    expect(words).toContain("refused: revoker-not-authorised — buyer-a is not allowed to revoke G5");
    expect(words.indexOf("#21")).toBeLessThan(words.indexOf("#20"));
    expect(words).toContain("Latest answer, #21:");
  });

  it("has no per-policy table (no policy has acted yet)", () => {
    expect(markup).not.toContain("What each autonomous policy did");
  });
});

describe("after Revoke Ops-Lead", () => {
  const markup = html(after(REVOKE));
  const words = text(markup);

  it("shows c1 c2 c4 inherited with heir cfo, severed G2@11, chargedTo G1, and c3 binding", () => {
    const rows = [...markup.matchAll(/<tr><th scope="row" class="cd-commit">.*?<\/tr>/g)].map((match) => text(match[0]));
    expect(rows[0]).toBe(" c1 buyer-a · purchase · 50,000 · under G4 7 inherited cfo answers for it, charged to G1 severed G2@11 heir cfo chargedTo G1 chain G1>G2>G4 ");
    expect(rows[2]).toContain(" c3 refunder · refund · 12,000 · under G6 9 binding ");
    expect(rows.filter((row) => row.includes(" inherited "))).toHaveLength(3);
  });

  it("shows G2 revoked at seq 11 with 220,000 absorbed, and G1's headroom at 680,000", () => {
    expect(markup).toContain('aria-label="G2: limit 400,000, used 350,000, headroom 0, revoked at seq 11"');
    expect(words).toContain("absorbed by the revoke 220,000 returned to the parent 180,000");
    expect(markup).toContain('aria-label="G1: limit 1,000,000, used 320,000, headroom 680,000, live"');
    expect(markup).toContain('aria-label="G4: limit 120,000, used 50,000, headroom 0, cut off (a grant above it was revoked)"');
  });

  it("says the latest answer was the revoke, admitted at seq 11", () => {
    expect(words).toContain("Latest answer, #22: revoke G2 by cfo admitted at seq 11");
  });
});

describe("the whole incident, scrubbed", () => {
  it("at seq 10 the four commitments are binding again, and the page says it is showing the past", () => {
    const words = text(html(after(REPLAY, scrubTo(10))));
    expect(words).toContain("Viewing the past. 10 of 18 events admitted.");
    expect(words).toContain("0 inherited, 0 void");
    expect(words).toContain("4 binding");
    expect(words).toContain("Σ binding + inherited = 232,000");
  });

  it("at seq 11 three are inherited; at the head there are five void with their breaches named in the transcript", () => {
    expect(text(html(after(REPLAY, scrubTo(11))))).toContain("1 binding, 3 inherited, 0 void");
    const head = text(html(after(REPLAY)));
    expect(head).toContain("2 binding, 3 inherited, 5 void");
    expect(head).toContain("admitted at seq 15, void: over-limit — 50,000 was asked of G6, which had 28,000 left");
    expect(head).toContain("admitted at seq 13, void: wrong-actor — the grant G4 was given to buyer-a, and someone else acted under it");
    expect(head).toContain("Live. 18 events admitted.");
  });

  it("at seq 0 the empty log says so and the scrubber's back button is disabled", () => {
    const markup = html(after(REPLAY, scrubTo(0)));
    expect(text(markup)).toContain("No grant has been admitted at this point of the log.");
    expect(text(markup)).toContain("No commitment has been recorded at this point of the log.");
    expect(markup).toMatch(/<button type="button" class="cd-btn" disabled="">Back one<\/button>/);
  });
});

describe("the autonomous quarter, seed 1", () => {
  const markup = html(after(QUARTER));
  const words = text(markup);

  it("shows the per-policy table with the demo's numbers, the compromised policy among them", () => {
    expect(words).toContain("What each autonomous policy did");
    expect(words).toContain("CompromisedPolicy 28 admitted commit, breached:over-limit x25 admitted commit, warranted x3");
    expect(words).toContain("DelegatorPolicy 24");
  });

  it("shows 118 events, 44 binding, 3 inherited, 39 void and the meter at 375,500", () => {
    expect(words).toContain("Live. 118 events admitted.");
    expect(words).toContain("44 binding, 3 inherited, 39 void");
    expect(words).toContain("Σ binding + inherited = 375,500 ≤ Σ root limits = 1,000,000");
  });

  it("puts the seed in the box", () => {
    expect(markup).toContain('value="1"');
  });
});

describe("the page as a whole, and the error path", () => {
  it("app/page.tsx has one h1, the 90-second tour, the demo and the milestone list read from app/milestones.ts", () => {
    const page = renderToStaticMarkup(createElement(Home));
    expect(page.match(/<h1[ >]/g)).toHaveLength(1);
    expect(text(page)).toContain("A 90-second tour");
    expect(text(page)).toContain("Revoke Ops-Lead");
    const current = currentMilestone();
    expect(text(page)).toContain(current === undefined ? "All nine milestones are done." : `Milestone ${current.id}, ${current.title.toLowerCase()}, is ${current.status === "in-progress" ? "in progress" : "next"}.`);
    expect(page.match(/<li class="cd-ms /g)).toHaveLength(9);
  });

  it("a state the engine cannot show renders the alert with a Reset button, and does not throw", () => {
    const broken: DemoState = { ...initialDemoState(), cursor: 99 };
    expect(computeDemoView(broken).ok).toBe(false);
    const markup = html(broken);
    expect(markup).toContain('role="alert"');
    expect(text(markup)).toContain("The demo could not compute a view the time-travel position 99 is outside 0 to 10");
    expect(markup).toContain(">Reset</button>");
  });

  it("every section has a heading and every control has a name: 6 h2 in the component's opening state, a label on the seed and scrubber, no empty button, a caption on every table", () => {
    const markup = html();
    expect(markup.match(/<h2 /g)).toHaveLength(6);
    expect(markup).toContain('<label for="seq-scrubber">');
    for (const button of markup.matchAll(/<button[^>]*>(.*?)<\/button>/g)) expect(text(button[1] ?? "").trim()).not.toBe("");
    expect(markup).toContain('<label class="cd-seed"><span>Seed</span><input type="number"');
    expect(markup.match(/<table/g)?.length).toBe(markup.match(/<caption/g)?.length);
  });
});

describe("determinism: the markup is a function of the state alone", () => {
  const states: readonly [string, DemoState][] = [
    ["opening", initialDemoState()],
    ["revoked", after(REVOKE)],
    ["whole, scrubbed to 7", after(REPLAY, scrubTo(7))],
    ["a void spend", after(SPEND)],
    ["quarter", after(QUARTER)],
    ["empty log", { log: [], attempts: [], cursor: null, seed: 1 }],
  ];

  for (const [name, state] of states) {
    it(`${name}: rendering twice, from two independently built states, gives the same string (static and server markup)`, () => {
      expect(html(state)).toBe(html(structuredClone(state)));
      expect(renderToString(createElement(CompanyDemo, { initial: state }))).toBe(renderToString(createElement(CompanyDemo, { initial: structuredClone(state) })));
    });
  }

  it("two pages built separately are the same string", () => {
    expect(renderToStaticMarkup(createElement(Home))).toBe(renderToStaticMarkup(createElement(Home)));
  });
});
