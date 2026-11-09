import type { Standing } from "./compute-demo-view.js";
import { formatAmount, formatBreach } from "./format-breach.js";

/**
 * Words for a `Standing`: what the engine ruled a commitment, and who answers for it (plan §4.2).
 *
 *   binding    the chain is intact; everyone on `warrant.trail` answers
 *   inherited  a link of the chain was cut after the act; the heir answers, personally and through `chargedTo`
 *   void       the act breached the record as it stood; the actor alone answers
 *
 * `detail` is the text `scripts/demo-company.ts` prints after the kind in its standings blocks, character for character (the engine's own
 * fields, not prose), so that the table on the page can be set beside that output and compared; `__tests__/demo-diff.test.ts` does it by running the
 * script. `answers` is the sentence a reader gets, built only from the same fields.
 */

export interface DescribedStanding {
  readonly kind: Standing["kind"];
  readonly detail: string;
  readonly answers: string;
}

function unknownStanding(value: never): DescribedStanding {
  return { kind: "void", detail: JSON.stringify(value), answers: "a standing this page does not know" };
}

export function formatStanding(standing: Standing): DescribedStanding {
  switch (standing.kind) {
    case "binding":
      return {
        kind: "binding",
        detail: `warrant chain ${standing.warrant.chain.join(">")}  trail ${standing.warrant.trail.join(">")}`,
        answers: `${standing.warrant.trail.join(", ")} answer for it`,
      };
    case "inherited":
      return {
        kind: "inherited",
        detail: `severed ${standing.severed.grantId}@${standing.severed.atSeq}  heir ${standing.heir}  chargedTo ${standing.chargedTo ?? "null (heir is a charter root)"}  chain ${standing.warrant.chain.join(">")}`,
        answers: `${standing.heir} answers for it${standing.chargedTo === null ? ", off the ledger" : `, charged to ${standing.chargedTo}`}`,
      };
    case "void":
      return {
        kind: "void",
        detail: `breach ${JSON.stringify(standing.breach)}`,
        answers: `the actor alone answers: ${formatBreach(standing.breach).text}`,
      };
    default:
      return unknownStanding(standing);
  }
}

/** One line of a standings block, in the layout `scripts/demo-company.ts`'s `printStandings` uses (without its four leading spaces). */
export function standingLine(standing: Standing): string {
  return `${standing.commitId.padEnd(4)} at seq ${String(standing.committedAt).padStart(2)}  ${standing.kind.padEnd(9)} ${formatStanding(standing).detail}`;
}

/** The commit a row is about, in one line: who, what, how much, under which grant. */
export function commitLine(actor: string, capability: string, amount: number, actedUnder: string): string {
  return `${actor} · ${capability} · ${formatAmount(amount)} · under ${actedUnder}`;
}
