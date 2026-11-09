import { computeDemoView, demoReducer, initialDemoState } from "../../compute-demo-view.js";
import type { DemoAction, DemoState, DemoView } from "../../compute-demo-view.js";

/** The state after `actions`, from the page's opening state. */
export function after(...actions: readonly DemoAction[]): DemoState {
  return actions.reduce(demoReducer, initialDemoState());
}

/** The view of a state that must have one. */
export function viewOf(state: DemoState): DemoView {
  const result = computeDemoView(state);
  if (!result.ok) throw new Error(`no view: ${result.error}`);
  return result.view;
}

export const REVOKE: DemoAction = { type: "revoke-ops-lead" };
export const WIDEN: DemoAction = { type: "overreach", preset: "widen-scope" };
export const OVER_DELEGATE: DemoAction = { type: "overreach", preset: "over-delegate" };
export const SPEND: DemoAction = { type: "overreach", preset: "spend-beyond-limit" };
export const QUARTER: DemoAction = { type: "quarter" };
export const REPLAY: DemoAction = { type: "replay-incident" };
export const RESET: DemoAction = { type: "reset" };
export const scrubTo = (to: number | null): DemoAction => ({ type: "scrub", to });
export const seed = (value: number): DemoAction => ({ type: "set-seed", seed: value });
