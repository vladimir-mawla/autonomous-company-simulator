import { describe, expect, it } from "vitest";
import { grantId } from "../../lib/contracts/index.js";
import { append, standings } from "../../lib/standing/index.js";
import { CHARTER, admit, build, commitEv, grantEv, revokeEv } from "./helpers.js";
import type { CompanyLog } from "./helpers.js";

/**
 * KIND: PROVES (plan section 11, case 03).
 * TRACES TO: D2 (authority is conserved: revoking converts a reservation into what was spent and returns only the rest).
 *
 * THE CLAIM. A revoke followed by a re-grant cannot be used to mint authority. When a parent of limit 100 delegates 60,
 * the child spends 50 and the grant is revoked, the parent's headroom is 50, not 100: the 50 that was spent stays spent.
 * Re-granting 60 is `over-allocation { G1, requested 60, headroom 50 }`; re-granting 50 is admitted; and the total that was ever
 * ruled `binding` or `inherited` under the parent never exceeds 100, however many times the cycle is run.
 *
 * WHAT WOULD MAKE THIS FAIL: a revoke that forgave what was spent (the parent's headroom back to 100: the re-grant of 60 is
 * admitted), or one that returned nothing (headroom stays 40 after an unspent child is revoked: the re-grant of 100 is refused).
 * Plan section 6 M5 names the first as a sabotage.
 */

const G1 = "G1";
const caps = ["purchase"] as const;

const root = (limit: number) =>
  grantEv({ id: G1, grantor: "dana", grantee: "cfo", capabilities: caps, limit, depth: 3 });

describe("03 revoke-and-regrant cannot mint authority", () => {
  it("limit 100, child granted 60 and spent 50, revoked: re-granting 60 is over-allocation { G1, 60, 50 }; re-granting 50 is admitted", () => {
    const log = build([
      root(100),
      grantEv({ id: "G2", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 60, depth: 1 }),
      commitEv("c1", "ops", "G2", "purchase", 50),
      revokeEv("G2", "cfo"),
    ]);

    const sixty = append(CHARTER, log, grantEv({ id: "G3", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 60, depth: 1 }));
    expect(sixty).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "over-allocation", grantId: grantId(G1), requested: 60, headroom: 50 } },
    });

    const fifty = append(CHARTER, log, grantEv({ id: "G3", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 50, depth: 1 }));
    expect(fifty.ok).toBe(true);
  });

  it("and the 50 can be spent again under the new grant, after which nothing more can be delegated or spent under G1: 100 in all", () => {
    let log = build([
      root(100),
      grantEv({ id: "G2", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 60, depth: 1 }),
      commitEv("c1", "ops", "G2", "purchase", 50),
      revokeEv("G2", "cfo"),
      grantEv({ id: "G3", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 50, depth: 1 }),
    ]);
    log = admit(log, commitEv("c2", "ops", "G3", "purchase", 50)).log;

    const more = append(CHARTER, log, grantEv({ id: "G4", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 1, depth: 1 }));
    expect(more).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "over-allocation", grantId: grantId(G1), requested: 1, headroom: 0 } },
    });
    const own = admit(log, commitEv("c3", "cfo", G1, "purchase", 1));
    expect(own.result.verdict).toEqual({
      kind: "breached",
      breach: { kind: "over-limit", grantId: grantId(G1), requested: 1, headroom: 0 },
    });

    const result = standings(CHARTER, own.log);
    if (!result.ok) throw new Error("the log must fold");
    const amounts: Readonly<Record<string, number>> = { c1: 50, c2: 50, c3: 1 };
    const held = result.standings.filter((s) => s.kind !== "void").reduce((sum, s) => sum + (amounts[s.commitId] ?? 0), 0);
    expect(held).toBe(100);
  });

  it("a child revoked with nothing spent returns the whole reservation: the parent can delegate its full 100 again", () => {
    const log = build([
      root(100),
      grantEv({ id: "G2", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 60, depth: 1 }),
      revokeEv("G2", "cfo"),
    ]);
    expect(append(CHARTER, log, grantEv({ id: "G3", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 100, depth: 1 })).ok).toBe(true);
    expect(append(CHARTER, log, grantEv({ id: "G3", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 101, depth: 1 }))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "over-allocation", grantId: grantId(G1), requested: 101, headroom: 100 } },
    });
  });

  it("what a grandchild spent counts as spent under the revoked child: 30 by the child and 15 by its own delegate leave G1 with 55, whichever is revoked first", () => {
    const setup = build([
      root(100),
      grantEv({ id: "G2", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 60, depth: 1 }),
      grantEv({ id: "G4", parent: "G2", grantor: "ops", grantee: "buyer-a", capabilities: caps, limit: 20, depth: 0 }),
      commitEv("c1", "ops", "G2", "purchase", 30),
      commitEv("c2", "buyer-a", "G4", "purchase", 15),
    ]);
    const orders: readonly (readonly [string, string][])[] = [
      [["G2", "cfo"]],
      [["G4", "ops"], ["G2", "cfo"]],
    ];
    for (const order of orders) {
      const log = build(order.map(([grant, by]) => revokeEv(grant, by)), setup);
      const over = append(CHARTER, log, grantEv({ id: "G9", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 56, depth: 1 }));
      expect(over).toEqual({
        ok: false,
        failure: { kind: "rejected", rejection: { kind: "over-allocation", grantId: grantId(G1), requested: 56, headroom: 55 } },
      });
      expect(append(CHARTER, log, grantEv({ id: "G9", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 55, depth: 1 })).ok).toBe(true);
    }
  });

  it("13 cycles of grant 10, spend 7, revoke: the headroom is 100 - 7k after k cycles, the next grant of 10 is over-allocation { requested 10, headroom 9 }, and 91 is all that was ever spent", () => {
    let log: CompanyLog = build([root(100)]);
    let spent = 0;
    for (let k = 1; k <= 13; k++) {
      log = build(
        [
          grantEv({ id: `H${k}`, parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 10, depth: 1 }),
          commitEv(`k${k}`, "ops", `H${k}`, "purchase", 7),
          revokeEv(`H${k}`, "cfo"),
        ],
        log,
      );
      spent += 7;
      // Exactly the remaining headroom is admitted and one more is not: asked of the engine, not computed here.
      const headroom = 100 - spent;
      const tooMuch = append(CHARTER, log, grantEv({ id: "probe", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: headroom + 1, depth: 1 }));
      expect(tooMuch).toEqual({
        ok: false,
        failure: { kind: "rejected", rejection: { kind: "over-allocation", grantId: grantId(G1), requested: headroom + 1, headroom } },
      });
    }
    expect(append(CHARTER, log, grantEv({ id: "probe", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 10, depth: 1 }))).toEqual({
      ok: false,
      failure: { kind: "rejected", rejection: { kind: "over-allocation", grantId: grantId(G1), requested: 10, headroom: 9 } },
    });
    expect(append(CHARTER, log, grantEv({ id: "probe", parent: G1, grantor: "cfo", grantee: "ops", capabilities: caps, limit: 9, depth: 1 })).ok).toBe(true);

    const result = standings(CHARTER, log);
    if (!result.ok) throw new Error("the log must fold");
    expect(result.standings).toHaveLength(13);
    expect(result.standings.every((s) => s.kind === "inherited")).toBe(true);
    expect(spent).toBe(91);
  });
});
