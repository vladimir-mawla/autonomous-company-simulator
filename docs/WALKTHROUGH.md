# Walkthrough: the live click path, and the 90-second Loom script

Two things live here. The first is the record of the one part of the demo no test covers: pressing the buttons on the deployed page. The second is the script for the Loom, written against what that record and the page's own text say is on screen. The Loom itself is recorded by a person; nothing in this repository records it.

## 1. The live click path: what was checked by hand, and what was not

The plan (`.genesis/PLAN.md`, M8) says the click-to-re-render path is verified by hand against the live URL and recorded here, and `.genesis/decisions/0008-demo.md` (Not verified) says no automated test covers it.

**Who, when, against what.** On 2026-11-09 the orchestrating agent of this project, not the builder of this milestone and not a test, pressed the buttons below in a browser: the Claude desktop app's built-in browser pane (Chromium), viewport 1440 x 900, against https://autonomous-company-simulator.vercel.app/, whose `/api/health` reported commit `2d906db` at the time. The builder of M9 did not click anything; this section is that check's own notes, copied here.

Fresh load, then these, in this order:

| Step | Pressed | What the page showed |
|---|---|---|
| 1 | Spend beyond limit | transcript: `#22 ... commit ui-c-22: refunder refund 50000 under G6 — admitted at seq 11, void: over-limit — 50,000 was asked of G6, which had 28,000 left`. The bound meter stayed `Σ binding + inherited = 232,000 ≤ Σ root limits = 1,000,000 — the bound holds` |
| 2 | Widen scope | `#23 ... grant Gw: ops -> buyer-a [hire] ... refused: capability-widening — the parent grant does not carry the capability hire` (no seq taken) |
| 3 | Revoke Ops-Lead | `#24 ... revoke G2 by cfo — admitted at seq 12`. Standings at seq 12: c1 inherited (heir cfo, chargedTo G1, severed G2@12), c2 inherited, c3 binding, c4 inherited, ui-c-22 void. G2 "revoked at seq 12", absorbed 220,000, returned 180,000; G1 headroom 680,000. G4 and G5 "cut off" |
| 4 | Back one, twice (scrubber to seq 10) | `Ruled by the engine for the log as it stood at seq 10: 4 binding, 0 inherited, 0 void.` |
| 5 | Autonomous quarter (seed 1) | `Live. 118 events admitted`; meter `Σ binding + inherited = 375,500 ≤ Σ root limits = 1,000,000 — the bound holds` |

**Not checked in that session:** phone width, dark theme, keyboard-only use, other browsers. A different verifier checked a 375 px width on the M8 preview build, per the orchestrator's note; that is not a check of the live URL. **Also not in the by-hand check:** the Over-delegate button, the Replay the whole incident button, the Reset button and Forward one, Back to live. The numbers `#22`, `seq 11` and `seq 12` above follow from pressing Spend beyond limit first: the spend takes seq 11, so the revoke lands at seq 12. Pressing Revoke Ops-Lead first lands it at seq 11, which is the case `components/company/__tests__/compute-demo-view.test.ts` › "is admitted at seq 11, and the head is 11" pins, and the page's text before any click (fetched with curl on 2026-11-09) is the opening log at seq 10.

What the tests pin about the same page, without any browser: the page the buttons render at each state equals the matching block of `npm run demo:company` (`components/company/__tests__/demo-diff.test.tsx` › "the standings blocks of the script are the rows of the page's table"), and every sequence of up to four buttons gives a conserving view (`components/company/__tests__/compute-demo-view.test.ts` › "EXHAUSTIVE: every sequence of at most 4 buttons yields a view, and the view conserves"). What neither covers is that a button's click handler dispatches the action its label names; ADR 0008 lists that as unpinned.

## 2. The 90-second Loom script

Lines that begin with `> ` are said aloud; `tests/docs/citations.test.ts` bounds their total at 230 words (about 150 words a minute for 90 seconds; the bound is on the text, not a measurement of anyone's speech). Everything else is stage direction. Times are targets.

**Before recording:** open the URL, reload so the page is at its opening log, and do not press anything yet. Press the buttons in the order below: the transcript numbers in the stage directions follow from that order (section 1).

**0:00 - 0:12. The claim.** On screen: the heading "Who answers for what the agents did?" and the sentence "Nothing below is a recording. Every ruling, refusal and number is computed by the real engine, in your browser, from the log on the page, again on every click."

> Six software agents run a company under one human. When an agent acts, who answers for it? This page is the real engine running in your browser. Nothing on it is a recording.

**0:12 - 0:26. The org and the bound.** On screen: "Who granted what" (G1 dana grants cfo, G2 cfo grants ops, G4 and G5 ops grants the buyers, G3 and G6 on the support side) and the commitments c1 to c4, all binding; the bound meter reading 232,000 against 1,000,000.

> Dana gave the cfo the company's authority. The cfo split it, and ops split its share again. Four commitments stand, all binding, and the bound meter adds them up against what the roots granted.

**0:26 - 0:40. A spend past the limit.** Press "Spend beyond limit". On screen: the transcript line `#22 ... refunder refund 50000 under G6 — admitted at seq 11, void: over-limit — 50,000 was asked of G6, which had 28,000 left`; the meter still says "the bound holds".

> An agent asks for fifty thousand with twenty-eight thousand left. The engine records the act and rules it void. The bound does not move.

**0:40 - 0:50. A widening refused.** Press "Widen scope". On screen: `refused: capability-widening — the parent grant does not carry the capability hire`, and no seq taken.

> Handing on a capability you were never given is refused, by name, and takes no place in the log.

**0:50 - 1:12. The revoke.** Press "Revoke Ops-Lead". On screen: `revoke G2 by cfo — admitted at seq 12`; c1, c2 and c4 inherited with heir cfo, c3 still binding; G2 "revoked at seq 12", absorbed 220,000, returned 180,000; G4 and G5 "cut off".

> Now revoke the ops lead. Its grant, and the grants under it, are cut off. But what was already done is not erased. Three commitments become inherited, and the cfo answers for them. Two hundred twenty thousand was spent; a hundred eighty thousand goes back up the chain.

**1:12 - 1:24. Time travel.** Press "Back one" twice. On screen: `Ruled by the engine for the log as it stood at seq 10: 4 binding, 0 inherited, 0 void.`

> Step back to sequence ten. The same four commitments are binding again. A revoke reaches only the future; it does not rewrite the past.

**1:24 - 1:30. The quarter, and the close.** Press "Autonomous quarter (seed 1)". On screen: `Live. 118 events admitted` and the meter at 375,500 of 1,000,000, "the bound holds".

> Run a quarter of five policies, one of them compromised: a hundred eighteen events, and the bound still holds. The engine cannot spot the compromise. It limits the loss.

## 3. What the script leaves out, and why

- The plan's outline (`.genesis/PLAN.md` section 15) has a beat where the revoked agent's next act is `void: link-dead` and the cfo's cure is a new grant. On this page that sequence comes from "Replay the whole incident", which the by-hand check did not press. Its result is pinned by tests (the "at seq 18: the page after replaying the whole incident" block of `components/company/__tests__/demo-diff.test.tsx`), not seen in a browser by the orchestrator, so the script does not rely on it. If it is added to a take, press the button once before recording and look.
- The closing sentence about not spotting the compromise is not shown on the page. It is the claim of `tests/failures/01-compromise-within-mandate-is-invisible.test.ts` › "a compromised buyer's five commits and a diligent buyer's five identical commits get the same five rulings".
- The tour list on the page ("A 90-second tour") is the page's own prose; ADR 0008 (Not verified) says its sentences are not tests.
