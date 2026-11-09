import type { Breach } from "./compute-demo-view.js";

/**
 * Words for a `Breach`: the reason the engine gave for ruling a commitment `void` (plan §4.1, five kinds). Pure strings; the engine's own
 * fields are the only input, and each sentence says only what its fields say.
 *
 * `name` is the kind as the engine spells it. `text` is one sentence for a reader. Nothing here rules on anything: a breach reaches this
 * file already decided, by `lib/standing`.
 */

export interface Described {
  readonly name: string;
  readonly text: string;
}

/**
 * An amount with a comma between thousands, written by hand: `toLocaleString` depends on the locale of whoever runs it, so a server and a
 * browser could print two different strings for one number and React would warn about the mismatch.
 */
export function formatAmount(amount: number): string {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Reached only for a kind the compiler does not know (the parameter is `never`), so that adding a kind to `Breach` is a compile error here. */
function unknownBreach(value: never): Described {
  return { name: "unknown", text: `a breach this page does not know: ${JSON.stringify(value)}` };
}

export function formatBreach(breach: Breach): Described {
  switch (breach.kind) {
    case "no-such-grant":
      return { name: breach.kind, text: `the grant ${breach.grantId} does not exist, so there was nothing to act under` };
    case "wrong-actor":
      return { name: breach.kind, text: `the grant ${breach.grantId} was given to ${breach.holder}, and someone else acted under it` };
    case "link-dead":
      return { name: breach.kind, text: `a grant on the chain, ${breach.grantId}, had been revoked at seq ${breach.atSeq} before this act` };
    case "capability-not-granted":
      return { name: breach.kind, text: `the grant ${breach.grantId} does not carry the capability ${breach.capability}` };
    case "over-limit":
      return { name: breach.kind, text: `${formatAmount(breach.requested)} was asked of ${breach.grantId}, which had ${formatAmount(breach.headroom)} left` };
    default:
      return unknownBreach(breach);
  }
}
