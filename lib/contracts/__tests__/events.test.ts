import { describe, expect, it } from "vitest";
import type { EventInput, Log, LogEvent } from "../event.js";
import { commitId, grantId, principalId } from "../ids.js";

/**
 * The compile-time half (a `LogEvent` needs a `seq`; a payload must match its
 * kind; and what `EventInput` and `Log` do NOT refuse) is in
 * `proofs/event.proofs.ts`. This file runs one real consumer of the union.
 */
const dana = principalId("dana");
const grantEvent: LogEvent = {
  kind: "grant",
  seq: 1,
  grant: { id: grantId("G1"), parent: null, grantor: dana, grantee: principalId("cfo"), capabilities: ["purchase"], limit: 100, depth: 1 },
};
const commitEvent: LogEvent = {
  kind: "commit",
  seq: 2,
  commit: { id: commitId("c1"), actor: principalId("cfo"), actedUnder: grantId("G1"), capability: "purchase", amount: 10 },
};
const revokeEvent: LogEvent = { kind: "revoke", seq: 3, grantId: grantId("G1"), by: dana };

/**
 * An exhaustive switch over the event union. Adding a fourth variant to `EventInput`
 * makes `unreachable` stop compiling, so `npm run typecheck` (not `npm test`, which
 * strips types) is what goes red.
 */
function describeEvent(event: EventInput): string {
  switch (event.kind) {
    case "grant":
      return `grant ${event.grant.id} to ${event.grant.grantee}`;
    case "revoke":
      return `revoke ${event.grantId} by ${event.by}`;
    case "commit":
      return `commit ${event.commit.id} for ${event.commit.amount}`;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

describe("EventInput and LogEvent are discriminated unions a consumer can switch over", () => {
  it("narrows each kind to its own payload", () => {
    const log: Log = [grantEvent, commitEvent, revokeEvent];
    expect(log.map(describeEvent)).toEqual(["grant G1 to cfo", "commit c1 for 10", "revoke G1 by dana"]);
  });

  it("a LogEvent is an EventInput plus a seq", () => {
    expect(commitEvent.seq).toBe(2);
    expect(describeEvent(commitEvent)).toBe("commit c1 for 10");
  });
});
