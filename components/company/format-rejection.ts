import type { Rejection } from "./compute-demo-view.js";
import { formatAmount } from "./format-breach.js";
import type { Described } from "./format-breach.js";

/**
 * Words for a `Rejection`: the reason the engine refused a grant or a revoke (plan §4.3, fifteen kinds). A refused event is not in the log and
 * takes no seq; the page shows it in the transcript with the kind by name and one sentence built from the engine's fields.
 */

function unknownRejection(value: never): Described {
  return { name: "unknown", text: `a refusal this page does not know: ${JSON.stringify(value)}` };
}

export function formatRejection(rejection: Rejection): Described {
  switch (rejection.kind) {
    case "invalid-event-shape":
      return { name: rejection.kind, text: `the ${rejection.eventKind} event is malformed in: ${rejection.fields.join(", ")}` };
    case "unknown-capability":
      return { name: rejection.kind, text: `"${rejection.capability}" is not one of the company's capabilities` };
    case "duplicate-id":
      return { name: rejection.kind, text: `the id ${rejection.id} is already taken` };
    case "not-a-root":
      return { name: rejection.kind, text: `${rejection.grantor} is not a root of the charter, so it cannot start a grant with no parent` };
    case "unknown-parent":
      return { name: rejection.kind, text: `the parent grant ${rejection.parent} does not exist` };
    case "parent-dead":
      return { name: rejection.kind, text: `the parent grant ${rejection.deadGrant} has been revoked` };
    case "grantor-not-holder":
      return { name: rejection.kind, text: `${rejection.grantor} does not hold ${rejection.parent}; ${rejection.holder} does` };
    case "capability-widening":
      return { name: rejection.kind, text: `the parent grant does not carry the capability ${rejection.capability}` };
    case "depth-exhausted":
      return { name: rejection.kind, text: `${rejection.parent} has no depth left, so it cannot be delegated further` };
    case "depth-not-narrowed":
      return { name: rejection.kind, text: `a grant of depth ${rejection.requested} under a parent of depth ${rejection.parentDepth} does not narrow it` };
    case "principal-cycle":
      return { name: rejection.kind, text: `${rejection.principal} is already on the chain above, so it cannot be granted authority again` };
    case "over-allocation":
      return { name: rejection.kind, text: `${formatAmount(rejection.requested)} was asked of ${rejection.grantId}, which has ${formatAmount(rejection.headroom)} left` };
    case "unknown-grant":
      return { name: rejection.kind, text: `there is no grant ${rejection.grantId} to revoke` };
    case "already-dead":
      return { name: rejection.kind, text: `${rejection.grantId} has already been revoked` };
    case "revoker-not-authorised":
      return { name: rejection.kind, text: `${rejection.by} is not allowed to revoke ${rejection.grantId}` };
    default:
      return unknownRejection(rejection);
  }
}
