import type { Attempt, AttemptOutcome } from "./compute-demo-view.js";
import { formatAmount, formatBreach } from "./format-breach.js";
import { formatRejection } from "./format-rejection.js";

/**
 * Words for one call to the engine: what was offered, and what the engine answered. The answer is read off the `Attempt`'s own
 * `outcome`; this file names it and never decides it.
 */

type Offered = Attempt["input"];

/** What was offered, as `scripts/demo-company.ts` prints it on its `offered` lines. */
export function formatOffered(input: Offered): string {
  if (input.kind === "grant") {
    const { grant } = input;
    return `grant ${grant.id}: ${grant.grantor} -> ${grant.grantee} [${grant.capabilities.join(",")}] limit ${grant.limit} depth ${grant.depth} parent ${grant.parent ?? "(root)"}`;
  }
  if (input.kind === "revoke") return `revoke ${input.grantId} by ${input.by}`;
  return `commit ${input.commit.id}: ${input.commit.actor} ${input.commit.capability} ${input.commit.amount} under ${input.commit.actedUnder}`;
}

export type Tone = "admitted" | "breached" | "refused" | "fault";

export interface DescribedOutcome {
  readonly tone: Tone;
  /** The first words: `admitted at seq 7`, `refused: over-allocation`. */
  readonly headline: string;
  /** The rest, one sentence, or an empty string when the headline says it all. */
  readonly text: string;
}

function unknownOutcome(value: never): DescribedOutcome {
  return { tone: "fault", headline: "unknown answer", text: JSON.stringify(value) };
}

export function formatOutcome(outcome: AttemptOutcome): DescribedOutcome {
  switch (outcome.kind) {
    case "admitted": {
      const where = `admitted at seq ${outcome.event.seq}`;
      if (outcome.verdict === null) return { tone: "admitted", headline: where, text: "" };
      if (outcome.verdict.kind === "warranted") return { tone: "admitted", headline: `${where}, warranted`, text: `the chain ${outcome.verdict.warrant.chain.join(">")} held at that moment` };
      const breach = formatBreach(outcome.verdict.breach);
      return { tone: "breached", headline: `${where}, void: ${breach.name}`, text: breach.text };
    }
    case "rejected": {
      const rejection = formatRejection(outcome.rejection);
      return { tone: "refused", headline: `refused: ${rejection.name}`, text: rejection.text };
    }
    case "faulty-log":
      return { tone: "fault", headline: `the log could not be replayed: ${outcome.fault.kind}`, text: "" };
    default:
      return unknownOutcome(outcome);
  }
}

/** The page's own caption for a `TallyRow` outcome category, e.g. `admitted commit, breached:over-limit` (the engine's wording, unchanged). */
export function formatTally(what: string, count: number): string {
  return `${what} x${count}`;
}

/** `50 000`-style amount for the bars: re-exported so that the component imports one formatter file for text. */
export { formatAmount };
