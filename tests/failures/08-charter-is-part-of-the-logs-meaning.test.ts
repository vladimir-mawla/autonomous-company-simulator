import { describe, expect, it } from "vitest";
import { principalId } from "../../lib/contracts/index.js";
import { append, fold, standings } from "../../lib/standing/index.js";
import { CHARTER, ENTRY_POINTS, build, commitEv, grantEv, revokeEv } from "./helpers.js";
import type { CompanyLog } from "./helpers.js";

/**
 * KIND: DISCLOSES (plan section 11, case 08).
 * TRACES TO: D3 (the log is the only state), D5 (the charter is configuration the caller supplies).
 *
 * THE LIMIT. A log does not carry the charter that gave it meaning, and the charter has no version. The same log read under a
 * charter that drops a root or a capability is not reclassified (a grant by a root that is no longer a root does not quietly
 * become something else); it FAILS CLOSED at the first event the charter cannot account for: `inadmissible-event { index, rejection }`
 * from every entry point. The other half of the limit stands beside it: nothing names which charter a log was written
 * under, so a caller who supplies the wrong one gets a fault and no indication why, and a charter that only ADDS (a root, a
 * capability) reads the same log to the same standings.
 *
 * WHAT WOULD MAKE THIS FAIL: a replay that skipped what the charter could not account for (history reclassified silently, the
 * fold returning ok on a smaller log); or a charter version that changed a result.
 */

const log: CompanyLog = build([
  grantEv({ id: "G1", grantor: "dana", grantee: "cfo", capabilities: ["purchase", "hire"], limit: 1_000_000, depth: 2 }),
  grantEv({ id: "G2", parent: "G1", grantor: "cfo", grantee: "ops", capabilities: ["purchase"], limit: 100_000, depth: 0 }),
  commitEv("c1", "ops", "G2", "purchase", 5_000),
  commitEv("c2", "ops", "G2", "refund", 1), // void: capability-not-granted, a fact the original charter recorded
  revokeEv("G2", "cfo"),
]);

const charterWith = (roots: readonly string[], capabilities: readonly string[], extra: object = {}) => ({
  roots: roots.map(principalId),
  capabilities,
  ...extra,
});

describe("08 the charter is part of the log's meaning: the control, under the charter the log was written under", () => {
  it("the log folds, and the commit that used a capability G2 does not carry is void: capability-not-granted { G2, refund }", () => {
    expect(fold(CHARTER, log).ok).toBe(true);
    const result = standings(CHARTER, log);
    if (!result.ok) throw new Error("the log must fold");
    expect(result.standings.map((s) => [s.commitId, s.kind])).toEqual([
      ["c1", "inherited"],
      ["c2", "void"],
    ]);
    expect(result.standings[1]).toMatchObject({ breach: { kind: "capability-not-granted", grantId: "G2", capability: "refund" } });
  });
});

describe("08 a charter that drops something the log needs fails closed, from every entry point", () => {
  const dropped: readonly (readonly [string, object, object])[] = [
    [
      "the root: roots [erin] instead of [dana]; G1 was granted by dana",
      charterWith(["erin"], ["purchase", "refund", "hire", "sign-contract"]),
      { kind: "inadmissible-event", index: 0, rejection: { kind: "not-a-root", grantor: "dana" } },
    ],
    [
      "a capability a grant carries: no `hire`; G1 carries it",
      charterWith(["dana"], ["purchase", "refund", "sign-contract"]),
      { kind: "inadmissible-event", index: 0, rejection: { kind: "unknown-capability", capability: "hire" } },
    ],
    [
      "a capability only a void commit used: no `refund`; c2 (index 3) is the only event that names it",
      charterWith(["dana"], ["purchase", "hire", "sign-contract"]),
      { kind: "inadmissible-event", index: 3, rejection: { kind: "unknown-capability", capability: "refund" } },
    ],
  ];

  describe.each(dropped)("%s", (_name, charter, fault) => {
    it.each(ENTRY_POINTS)("%s: the fault, not a smaller log and not a reclassified one", (_entry, run) => {
      expect(run(charter, log)).toEqual(fault);
    });
  });

  it("a fault is all there is: append on that log does not record the new event, and standings gives no standing for the commits it could read", () => {
    const charter = charterWith(["dana"], ["purchase", "hire", "sign-contract"]);
    const attempt = append(charter as never, log, commitEv("later", "ops", "G2", "purchase", 1));
    expect(attempt).toEqual({
      ok: false,
      failure: { kind: "faulty-log", fault: { kind: "inadmissible-event", index: 3, rejection: { kind: "unknown-capability", capability: "refund" } } },
    });
    const result = standings(charter as never, log);
    expect(result.ok).toBe(false);
    expect(Object.keys(result).sort()).toEqual(["fault", "ok"]);
  });
});

describe("08 there is no charter versioning: what a charter does not name is not read, and a charter that only adds reads the same log the same way", () => {
  it("a charter with a `version` (and an `id`) is read as the charter without them: the same fold, to the value", () => {
    const plain = fold(CHARTER, log);
    const labelled = fold(charterWith(["dana"], [...CHARTER.capabilities], { version: 2, id: "meridian-2027" }) as never, log);
    expect(labelled).toEqual(plain);
  });

  it("adding a root and a capability the log never uses: the same standings", () => {
    const wider = charterWith(["dana", "erin"], [...CHARTER.capabilities, "audit"]);
    expect(standings(wider as never, log)).toEqual(standings(CHARTER, log));
  });
});
