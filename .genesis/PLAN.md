# Autonomous Company Simulator — G0–G2 Plan

Project 7 of 8. Cluster: "who's watching?" (third, after `agent-control-tower` and `adaptive-agent`).
Today: 2026-10-24. This document is a plan, not code — no repo exists, nothing is scaffolded. The next
agent (G3) copies this file to `.genesis/PLAN.md`. **If any later brief disagrees with a path, name or
signature in this file, this file wins; the builder flags the mismatch rather than inferring a rename**
(adaptive-agent's M4 brief said `lib/gate/**`; its plan, its locked DONE.html and its frozen contracts all
said `lib/invariants/**` — its ADR 0004 Decision 0 records the builder resolving it that way).

---

## 0. Sources, and what this plan does not claim

Every sibling claim below was read on `origin/main` (`git archive origin/main` snapshots, never a working
tree). `git rev-parse --abbrev-ref HEAD` was run first on all six: five were on `main`; `adaptive-agent`'s
tree was on `m8-demo` and was **not used**. Local `main` == `origin/main` for all six.

| Repo | `origin/main` | State on main |
|---|---|---|
| agent-trust-layer | `a3ec226` | 9/9 (git log: "mark M9 done"); README still says "M9 in progress" — stale, not relied on |
| decision-engine | `1d10429` | complete; README still says deploy "has not happened yet" — stale, not relied on |
| shadow-run | `cf52fea` | 9/9 |
| memory-ledger | `ca2f3b8` | 9/9 |
| agent-control-tower | `f9a6571` | 9/9 |
| adaptive-agent | `7b7ef2d` | **7/9** — its `.genesis/DONE.html` on main has M8 and M9 `todo`; README on main still says "genesis-only". Nothing about its M8/M9 (demo UI, WALKTHROUGH, ARCHITECTURE) is claimed here. |

**Read in full:** adaptive-agent PLAN, README, DONE.html, ADRs 0001, 0003–0007, ADR 0002 (lines 1–140), all
config/infra files, `app/api/health/route.ts`, `tests/failures` headers; agent-control-tower PLAN, README,
ARCHITECTURE, THESIS, NOTES, WALKTHROUGH, ADRs 0005 (Decisions 3–4), 0006, 0007, 0009, `package.json`,
`vitest.config.ts`, heads of its two M1 architecture tests, head of `scripts/demo-incident.ts`;
agent-trust-layer README, ARCHITECTURE, THESIS, ADRs 0002, 0003, 0004, PLAN (first 80 lines); decision-engine
README, PLAN, THESIS, ADRs 0001 and 0003, ARCHITECTURE (first 120 lines), `app/milestones.{ts,test.ts}`,
`.github/workflows/ci.yml`, `.env.example`; shadow-run README, THESIS, PLAN (first 140 lines), ADRs 0006 and
0002 (first 140 lines); memory-ledger README, THESIS, ARCHITECTURE (first 250 lines), ADRs 0004 and 0006.
**Grepped but not read in full** (no claim below is sourced from them): control-tower ADRs 0001–0004, 0008;
trust-layer ADRs 0001; decision-engine ADRs 0002, 0004 and the rest of ARCHITECTURE; shadow-run ADRs 0001,
0003–0005 and ARCHITECTURE; memory-ledger ADRs 0001–0003, 0005. A grep of all six `main` snapshots for
`delegat|ratif|attenuat|principal|ultra vires|mandate|quorum|separation of duties|accountab` found
agent-trust-layer's `THESIS.md` / `NOTES.md` / `lib/trust/vouch.ts` delegation mentions and incidental prose
elsewhere — no sibling models delegation chains, authority conservation, or the standing of acts.

**From my own knowledge, not verified in this session:** the capability-security lineage (object
capabilities, UCAN-style delegation, Macaroons caveats) already contains *attenuation*. This project does not
claim attenuation as its novelty (§2.2 says what it does claim).

---

## 1. What the six siblings already own (so this project does not repeat them)

| Project | Question | Central closed enum / shape | Read at |
|---|---|---|---|
| agent-trust-layer | Is this presented claim authentic, and does policy permit it *now*? | no outcome enum; identity → claims → verification → policy; `Authority` vs `History` credentials; revocation by W3C Bitstring Status List; vouching is depth-1 | README, ARCHITECTURE, ADRs 0002–0004 |
| decision-engine | May *I* act, given my evidence and the stakes? | `Outcome` = execute · ask · defer · escalate · refuse | README, ADR 0001 |
| shadow-run | What would this write do, and did reality match? | `Reconciliation` = confirmed · drifted · unprojected; rollback = restored · failed · dishonest · unavailable | README, PLAN |
| memory-ledger | What do I believe, and might it be stale or wrong? | `BeliefAnswer` = believed · doubted · disputed · unknown; `ForgetReason` has `source-revoked`; **append-only, "no un-forgetting"** | README, ARCHITECTURE, ADR 0004 |
| agent-control-tower | What may a supervisor do to a running agent it did not start? | `Intervention` = observe · warn · pause · halt(checkpointed\|forced) · quarantine, gated by a `Corroboration` ladder and a wall-clock staleness bound | PLAN, README, ARCHITECTURE |
| adaptive-agent | Has a *single agent's* proposed change to its own behaviour earned the right to stick? | `AdaptationDecision` = adopt · hold · revert · frozen; evidence counted by `distinctContexts`; invariants have no escape lane | PLAN, ADRs 0001–0007 |

Three facts about the neighbours that shaped this plan:

* **adaptive-agent's PLAN §0 explicitly reserves multi-agent, organisational scale for this project** (it says
  its own project never models more than one agent's history). The slot is open and named.
* **agent-trust-layer's THESIS names delegation — "depth limits, scope intersection and cycle handling" — as
  where implementations break; its NOTES lists "no delegation beyond depth-1 vouching" as out of scope; its
  README says "a vouch cannot be revoked, only expire."** This is the nearest conceptual neighbour of the
  mechanism below, not just of the cluster. Section 2 says exactly why this is not that project.
* **memory-ledger revokes retroactively** (`source-revoked` tombstones what was learned from a source — its
  ADR 0006 case 3 tombstones a memory at its freshest) **and refuses resurrection.** This project revokes
  *prospectively* and keeps the same no-resurrection rule. The contrast is deliberate and domain-justified
  (§3, D1): a belief learned from a retracted source is no longer true; a commitment made under since-revoked
  authority is still owed.

---

## 2. Brainstorm (G0.5) and the spine

**A — Multi-agent role-play** (CEO/CFO/Support agents exchanging messages). *Rejected outright:* a prompt
wrapper in a costume; names the automatic disqualifier. The agents in this project are deterministic policy
functions on purpose (D10).

**B — Legitimacy by quorum / approval count / separation of duties.** The obvious answer to "what makes an
org-wide decision legitimate rather than the loudest agent winning." *Rejected as a spine:* it reduces to
counting independent approvers, i.e. adaptive-agent's `distinctContexts` and control-tower's `Corroboration`
under new nouns — the exact duplication this slot is most at risk of. It is also a weak answer: headcount is
still volume. Instead, legitimacy is **position in a conserved grant tree**, and volume cannot buy it (the
locality property, §6 M5).

**C — A ledger of conserved, attenuating, revocable authority, where the engine rules on the *standing of
acts*.** *Chosen.* The mechanism an organisation of agents must get right is not "who may act" (trust-layer's
and decision-engine's question) but **"when something has been done, does it bind the organisation, and who
answers for it — including after the delegation that licensed it has been cut."**

### 2.1 The one-sentence claim

> An organisation of autonomous agents must always be able to say who answers for what was done: authority is
> **conserved** when delegated, revocation reaches **only the future**, and every commitment is ruled
> **binding, inherited, or void** against the record as it stood when the act was made — so no agent can act
> past its mandate, re-delegate more than it holds, or leave an act with no one answerable.

### 2.2 The counterclaim a judge may reasonably make

1. "Prospective-only revocation is wrong under compromise: a runaway agent's recent in-mandate acts should be
   voidable the moment you notice. And strict conservation (never over-subscribing a parent's budget) is
   rigid; real firms extend more credit than they hold. And attenuating delegation is just capability
   security with a log."
2. *The honest answer, not a rhetorical one:* (a) revocation must be prospective for acts that were validly
   authorised, otherwise revocation becomes a repudiation weapon against every counterparty — the project's
   response to compromise is a **bound** (a compromised agent can never lose the org more than its grant's
   headroom; failure case 01 pins exactly this) not a detector; (b) rigidity is the price of "no race, no
   crowding-out" (a noisy agent can only exhaust its *own* allowance); (c) attenuation is classical — the
   claim is conservation across revocation, the standing of acts after a break, and prospective-only
   revocation as an explicit, testable semantic. Whether that trade is calibrated right is the thing a judge is
   entitled to disagree with; §9 names it as the riskiest decision.

### 2.3 How it differs from each neighbour, concretely

| | agent-control-tower | adaptive-agent | agent-trust-layer (nearest conceptually) | **this project** |
|---|---|---|---|---|
| **Subject of the ruling** | what to *do to* a running agent (an `Intervention`) | whether an agent's *own future behaviour* may change | whether a *presented credential* permits a request | the **standing of a completed act** (`binding` / `inherited` / `void`) and who answers for it |
| **Time** | point-in-time arbitration; wall-clock freshness (`STALENESS_BOUND_MS`, `declaredAt`) | accumulation over occasions | per-request; credentials expire by clock, revocation by network list | **no wall clock at all**; the only time is the log's sequence; order *matters* — the headline property is prefix-determinism, where control-tower's M3 property is order-independence |
| **What licenses force / change** | a `Corroboration` ladder; a per-conflict human token unlocks forced halt | `distinctContexts` + a majority; frozen invariants | signatures, anchors, status list, policy envelope | no evidence axis, no threshold of that kind; authority is *structural* (position in the tree) and *quantitative* (a conserved allowance); humans are the **roots** of the grant forest, not a lane that unlocks anything |
| **Multi-agent** | arbitrates *between* agents' conflicting claims | explicitly single-agent | bilateral | agents **cannot conflict over budget**: reservations are disjoint at delegation time (locality property); there is nothing to arbitrate |
| **State** | claims and heartbeats supplied by the caller | `arbitrate` trusts a caller-supplied `priorState` (ADR 0005 Decision 3; failure case 10 pins the consequence) | stateless per request, apart from a per-instance nonce cache | **no caller-supplied derived state anywhere**: every query replays the log and re-validates every event |
| **Crypto** | none (`HumanId` is forgeable; its README says so) | none | the whole point (`did:key`, JWS, VC) | none — authorship is asserted (case 05); the two compose |

**The different-nouns test, run both ways.** Delete the vocabulary: control-tower is "pick the weakest
sufficient rung of a force ladder given how well-corroborated a claim is"; adaptive-agent is "adopt a change
once enough independent occasions agree." Neither sentence describes anything here: no ladder, no evidence
grade, no occasion counting, no threshold on agreement. Here: "refuse to let authority be copied; classify each
act by the ledger as it stood; revoke only forward; re-home accountability up the chain."

**Where it does overlap, stated rather than hidden.** (1) *Technique reuse, not claim reuse:* `?: never`
disjoint families plus a runtime guard for the cast residual (adaptive-agent ADR 0001); typed failure instead
of a throw on hostile input (adaptive-agent ADR 0003; control-tower's `DetectionResult`, ARCHITECTURE Stage 2); closed module graph
(control-tower). (2) *Vocabulary adjacency with trust-layer:* "scoped, delegable, revocable authority" is its
vocabulary. The difference is the question: trust-layer verifies authenticity of a presented claim at a
boundary; this ledger takes authorship as asserted (case 05) and decides what the *act* binds. The two
**compose** (a grant could ride in a credential) — that is the thesis, not a shared engine.

### 2.4 The brief's questions → where this project answers them

| Question | Answer in this design |
|---|---|
| What is *authority* in an organisation of agents? | A `Grant`: a closed capability set, one conserved `limit`, a `depth`, a parent. Authority originates only at `Charter.roots` and exists only as a tree of grants (D2, D6). |
| How is it delegated and scoped? | Only the holder may delegate (`grantor-not-holder`); capabilities may only narrow (`capability-widening`); depth strictly decreases (`depth-exhausted`, `depth-not-narrowed`); no principal repeats on a chain (`principal-cycle`); the child's `limit` is *reserved* from the parent's headroom (`over-allocation`). |
| How is it revoked? | A `revoke` event by a live principal above the grant (`revoker-not-authorised`); descendants die by *derivation*, not by writing a cascade; the unspent reservation returns, the spent amount is absorbed by the grantor (D2). |
| What stops an agent acting outside its mandate? | `judgeCommit` — five named `Breach`es; the act is recorded as a fact and ruled `void` (D4). Prevention is `mayCommit`, the same predicate (D9), which a runtime may choose to call first. |
| What stops re-delegating more than it was given? | The rejections above — and conservation: `Σ reservations + own spend ≤ limit` at every prefix (§4.4). |
| What happens to in-flight commitments when a chain breaks? | They become `inherited`: still owed, re-homed to the **heir** (the grantor of the first dead link), the spent amount stays charged to the heir's allowance; the actor's *next* act is `void: link-dead` (D1, D7). |
| What makes a decision legitimate rather than the loudest agent winning? | Standing is a function of position in the grant tree and of the log prefix — nothing in the engine reads volume or agreement. A noisy agent can exhaust only its own reserved allowance (locality property, M5). |
| How is accountability preserved across several agents? | Every `binding`/`inherited` standing carries a `Warrant{chain, trail}`; accountability climbs monotonically as higher links are cut (D7); who performed the revocation is irrelevant (case 11). |

---

## 3. Design decisions (the numbered spine every failure case traces to)

* **D1 — Standing is derived: verdict-at-commit ⊕ liveness-now. Revocation is prospective; `void` is
  absorbing.** A commit's *verdict* (warranted or breached) is fixed by the log prefix up to its own `seq` and
  never changes. Its *standing* adds only whether its chain is still intact. The only transition in the whole
  system is `binding → inherited` (driven by a later revoke). Nothing turns `void` into anything. A cure for a
  void act is a **new** commit by someone who holds authority now. (Ratification — retroactively authorising a
  past act — was designed, traced through the lattice, and **rejected**: §10.)
* **D2 — Authority is conserved.** Delegating reserves the child's `limit` out of the parent's headroom; the
  parent cannot spend what it delegated. Revoking a grant converts its reservation into the amount *already
  spent in its subtree* (absorbed by the grantor) and returns the rest. Spent authority is never forgiven.
* **D3 — The log is the only state.** There is no caller-supplied derived state. `fold` replays the log and
  re-runs every admission rule; `append` stamps `seq` (a caller cannot choose, and cannot back-date). **`seq` is
  arrival order, not occurrence order.**
* **D4 — Acts are facts; authority-creating events are admitted or rejected.** A `grant`/`revoke` that
  breaks a rule is **rejected** and never enters the log. A `commit` is **always recorded** (the world cannot
  un-act) and is *classified*. "Refuses" in this project means "refuses to let it bind or create authority,"
  never "prevents the agent from acting" — prevention is the caller's choice to use the pre-check (D9).
* **D5 — Roots are declared, not authenticated.** `Charter.roots` and the closed capability vocabulary are
  caller-supplied configuration. `grantor`, `by`, `actor` fields are *claims*. No cryptography in `lib/`.
* **D6 — One conserved scalar.** A grant carries a closed capability set, one non-negative integer `limit`,
  and a `depth` (further delegation hops). No expiry, no rate limit, no per-vendor sub-scopes.
* **D7 — Accountability climbs.** For an `inherited` commit the **heir** is the grantor of the first revoked
  link counting from the root; it is therefore always above the break and always live. As higher links are
  later cut, the first dead link moves up and so does the heir — never sideways or down. Who *performed* the
  revocation is irrelevant to who answers.
* **D8 — Single-reason enums.** `Breach` and `Rejection` each name the *first* failing rule in a documented
  precedence. (Shape problems report *all* offending fields, like adaptive-agent's `invalid-episode-shape`.)
* **D9 — One predicate, two call sites.** `append` (record) and `mayCommit` (pre-check) both call the same
  `judgeCommit`. They cannot drift (contrast adaptive-agent ADR 0005 Decision 1's duplicated
  `invariant.knob === delta.knob` literal).
* **D10 — Deterministic agents.** The simulated company's agents are pure policy functions of
  `(OrgView, seeded PRNG)`. No LLM, no network, no key. An LLM-backed agent would replace one file
  (`domains/company/policies.ts`); the engine's correctness must not depend on which.

---

## 4. The closed domain vocabulary

### 4.1 Types (compiled, see §8 and Appendix A)

The four ```` ```ts ```` blocks in this document (§4.1, §4.2, §4.3, §5) were **extracted from this markdown file, concatenated
with a two-line `Brand` prelude, and compiled** with `tsc 7.0.2` under `tsconfig.lib.json`-equivalent flags (`strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`): every type they name is defined, and deleting one definition
(`DeadLink`) makes the compile fail with `TS2304`. They are declarations only. (`principalId`/`grantId`/`commitId` are the
three M1 mint functions; they take a `string` and return the brand.)

```ts
// ---------- lib/contracts (M1) ----------
export type PrincipalId = Brand<string, "PrincipalId">;   // opaque tokens, minted by principalId()/grantId()/commitId()
export type GrantId = Brand<string, "GrantId">;           // NO PARSERS (house rule: ids are opaque, not grammars)
export type CommitId = Brand<string, "CommitId">;
export type Seq = number;      // 1-based position of an ADMITTED event in the log; rejected events consume none
export type Amount = number;   // non-negative safe integer <= MAX_AMOUNT (whole currency units). The TYPE cannot say so;
                               // enforcement is M3 intake. M1 pins that limit as an HONEST LIMIT test (adaptive-agent's case 17).
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];
export declare const MAX_AMOUNT: number;      // 2**40  — invented, disclosed
export declare const MAX_ROOT_DEPTH: number;  // 7      — invented, disclosed
export declare const MAX_LOG_EVENTS: number;  // 5000   — invented, disclosed
export declare const MAX_ID_LENGTH: number;   // 128    — invented, disclosed

export interface Grant<C extends string = string> {
  readonly id: GrantId;
  readonly parent: GrantId | null;           // null ⇒ root grant (grantor must be a Charter root)
  readonly grantor: PrincipalId;             // the acting principal; verified against parent.grantee, not trusted
  readonly grantee: PrincipalId;
  readonly capabilities: NonEmptyReadonlyArray<C>;
  readonly limit: Amount;                    // reserved out of the parent's headroom
  readonly depth: number;                    // further delegation hops this grant permits (0 = act, never delegate)
}
export interface Commitment<C extends string = string> {
  readonly id: CommitId;
  readonly actor: PrincipalId;               // a claim; checked against grant.grantee
  readonly actedUnder: GrantId;              // the grant the actor claims to act under
  readonly capability: C;
  readonly amount: Amount;
}
export type GrantEvent<C extends string = string> = { readonly kind: "grant"; readonly grant: Grant<C> };
export type RevokeEvent = { readonly kind: "revoke"; readonly grantId: GrantId; readonly by: PrincipalId };
export type CommitEvent<C extends string = string> = { readonly kind: "commit"; readonly commit: Commitment<C> };
export type EventInput<C extends string = string> = GrantEvent<C> | RevokeEvent | CommitEvent<C>;
export type LogEvent<C extends string = string> = EventInput<C> & { readonly seq: Seq };
export type Log<C extends string = string> = readonly LogEvent<C>[];

export interface Charter<C extends string = string> {
  readonly roots: NonEmptyReadonlyArray<PrincipalId>;        // human principals; authority originates only here
  readonly capabilities: NonEmptyReadonlyArray<C>;           // the closed vocabulary; checked at runtime too
}
export interface GrantTree<C extends string = string> {      // read-only VIEW used by M3/M4; built only inside fold
  readonly grants: ReadonlyMap<GrantId, Grant<C>>;
  readonly revokedAt: ReadonlyMap<GrantId, Seq>;             // write-once
}
export interface Charge { readonly grantId: GrantId; readonly amount: Amount }   // one per WARRANTED commit
export interface DeadLink { readonly grantId: GrantId; readonly atSeq: Seq }

export interface Warrant {
  readonly chain: NonEmptyReadonlyArray<GrantId>;            // root grant … grant acted under
  readonly trail: NonEmptyReadonlyArray<PrincipalId>;        // charter root, then each grantee down to the actor
}
export type Breach =                                          // closed; precedence = this order
  | { readonly kind: "no-such-grant"; readonly grantId: GrantId }
  | { readonly kind: "wrong-actor"; readonly grantId: GrantId; readonly holder: PrincipalId }
  | { readonly kind: "link-dead"; readonly grantId: GrantId; readonly atSeq: Seq }
  | { readonly kind: "capability-not-granted"; readonly grantId: GrantId; readonly capability: string }
  | { readonly kind: "over-limit"; readonly grantId: GrantId; readonly requested: Amount; readonly headroom: Amount };
export type Verdict =
  | { readonly kind: "warranted"; readonly warrant: Warrant }
  | { readonly kind: "breached"; readonly breach: Breach };
```

### 4.2 The closed enum at the centre: `Standing`

```ts
interface StandingBase { readonly commitId: CommitId; readonly committedAt: Seq }
export interface BindingStanding extends StandingBase {
  readonly kind: "binding"; readonly warrant: Warrant;
  readonly breach?: never; readonly severed?: never; readonly heir?: never; readonly chargedTo?: never;
}
export interface InheritedStanding extends StandingBase {
  readonly kind: "inherited"; readonly warrant: Warrant;
  readonly severed: DeadLink;                 // the first revoked link from the root; severed.atSeq > committedAt, always
  readonly heir: PrincipalId;                 // grantor of that link: live, above the break, never the actor
  readonly chargedTo: GrantId | null;         // the heir's grant that absorbs it; null ⇒ heir is a Charter root (off-ledger)
  readonly breach?: never;
}
export interface VoidStanding extends StandingBase {
  readonly kind: "void"; readonly breach: Breach;
  readonly warrant?: never; readonly severed?: never; readonly heir?: never; readonly chargedTo?: never;
}
export type Standing = BindingStanding | InheritedStanding | VoidStanding;
export declare function assertNeverStanding(value: never): never;           // + assertNeverBreach / Rejection / FoldFault
export type StandingIntegrity = { readonly ok: true } | { readonly ok: false; readonly error: StandingIntegrityError };
export type StandingIntegrityError =
  | { readonly kind: "unexpected-field"; readonly variant: Standing["kind"]; readonly field: string }
  | { readonly kind: "missing-field"; readonly variant: Standing["kind"]; readonly field: string };
export declare function assertStandingWellFormed(standing: Standing): StandingIntegrity;   // the runtime guard M2's health check runs
```

The variants are distinguished the way decision-engine's outcomes are — by **who answers**:

| Variant | Who answers | **What it refuses** |
|---|---|---|
| `binding` | everyone on `warrant.trail`; the actor's delegators, root-first | to exist without a complete chain from a Charter root that was live, in scope and funded at the commit's `seq` and **still is**; to carry a `breach` (the two families are disjoint, §4.2); to be created by agreement or volume — nothing in the engine reads how many agents endorse an act |
| `inherited` | the **heir** (grantor of the first dead link), personally and through `chargedTo`'s allowance | to be voided by the revocation that created it (revocation is prospective); to name an heir who is the actor or below the break; to hand its spent amount back to the pool (spent is absorbed, only the unspent returns); to exist without a named heir (type-required) |
| `void` | the actor alone; the organisation is **not** bound | to charge any allowance; to carry a `warrant`/`heir`; to ever change — no later event can turn it into `binding` or `inherited` (absorbing; proven by the lattice property, not by name-scanning for "override") |

### 4.3 Supporting closed vocabularies

* **`Breach`** (5, above) — *why an act is void.* Precedence is the listed order; only the first is reported (D8,
  pinned by failure case 06).
* **`Rejection`** (15) — *why an authority event never entered the log.* Owned by layer in §5.
* **`FoldFault`** (5) — *why a log or charter could not be replayed at all.*

```ts
export type Rejection =
  | { readonly kind: "invalid-event-shape"; readonly eventKind: "grant" | "revoke" | "commit" | "unknown"; readonly fields: NonEmptyReadonlyArray<string> }  // M3 (all offending fields, deduped+sorted)
  | { readonly kind: "unknown-capability"; readonly capability: string }                                                                                    // M3
  | { readonly kind: "duplicate-id"; readonly id: string }                                                          // M3 (grant ids) · M5 (commit ids)
  | { readonly kind: "not-a-root"; readonly grantor: PrincipalId }                                                  // M3
  | { readonly kind: "unknown-parent"; readonly parent: GrantId }                                                   // M3
  | { readonly kind: "parent-dead"; readonly deadGrant: GrantId }                                                   // M3
  | { readonly kind: "grantor-not-holder"; readonly parent: GrantId; readonly grantor: PrincipalId; readonly holder: PrincipalId } // M3
  | { readonly kind: "capability-widening"; readonly capability: string }                                           // M3
  | { readonly kind: "depth-exhausted"; readonly parent: GrantId }                                                  // M3
  | { readonly kind: "depth-not-narrowed"; readonly parentDepth: number; readonly requested: number }               // M3
  | { readonly kind: "principal-cycle"; readonly principal: PrincipalId }                                           // M3
  | { readonly kind: "over-allocation"; readonly grantId: GrantId; readonly requested: Amount; readonly headroom: Amount } // M5, from M4's Shortfall
  | { readonly kind: "unknown-grant"; readonly grantId: GrantId }                                                   // M5 (revoke)
  | { readonly kind: "already-dead"; readonly grantId: GrantId }                                                    // M5 (revoke)
  | { readonly kind: "revoker-not-authorised"; readonly grantId: GrantId; readonly by: PrincipalId };               // M5 (revoke)
export type FoldFault =
  | { readonly kind: "invalid-charter"; readonly fields: NonEmptyReadonlyArray<string> }
  | { readonly kind: "hostile-log-input"; readonly message: string }
  | { readonly kind: "log-too-long"; readonly length: number; readonly max: number }
  | { readonly kind: "seq-mismatch"; readonly index: number; readonly expected: Seq; readonly actual: number }
  | { readonly kind: "inadmissible-event"; readonly index: number; readonly rejection: Rejection };
```

Admission precedence (first failing rule wins):
*grant* — invalid-event-shape → unknown-capability → duplicate-id → (root: not-a-root | child: unknown-parent →
parent-dead → grantor-not-holder → capability-widening → depth-exhausted → depth-not-narrowed) → principal-cycle →
over-allocation. *revoke* — invalid-event-shape → unknown-grant → already-dead → revoker-not-authorised.
*commit* — invalid-event-shape → unknown-capability → duplicate-id → (always recorded; classified by `judgeCommit`).
*`judgeCommit`* — no-such-grant → wrong-actor → link-dead → capability-not-granted → over-limit.

### 4.4 Accounting definitions (M4's single source of truth)

For a grant `g`: `own(g)` = Σ charges with `grantId = g`. `subtreeOwn(g)` = `own(g)` + Σ `subtreeOwn(child)`.
For a child `c` of a live `g`: `chargeToParent(c)` = `limit(c)` if `c` is not revoked, else `subtreeOwn(c)`.
`used(g)` = `own(g)` + Σ `chargeToParent(child)`. `headroom(g)` = `limit(g) − used(g)` for a live `g`, **0 for a
dead `g`**, `undefined` for an unknown one. A grant is *live* iff neither it nor any ancestor has a `revokedAt`.

**Conservation theorem (what M4/M5 test):** at every prefix, for every live `g`, `headroom(g) ≥ 0`; for every
root grant `R`, `subtreeOwn(R) ≤ limit(R)`; revoking `h` (parent `p` live) raises `headroom(p)` by **exactly**
`limit(h) − subtreeOwn(h)` and never raises `used` of any other grant; `subtreeOwn` never decreases.

---

## 5. Engine layers, signatures, and who owns what

`lib/contracts` → `lib/chain` → `lib/allowance` → `lib/standing` → `domains/company` → `scripts/`, `components/`,
`app/`. One direction, no cycle, enforced by a layer table (M1).

**Names are deliberate.** This project's M3/M4/M5 directories are `lib/chain`, `lib/allowance`, `lib/standing`
— **not** `lib/conflict|gate|arbitrate|evidence|invariants`. A brief written from a house template that says
"M4 = lib/gate" is wrong for this project.

```ts
// ---------- lib/chain (M3) — intake and structure ----------
export type CharterRead<C extends string> =
  | { readonly ok: true; readonly charter: Charter<C> }                      // a fresh, read-once, frozen copy
  | { readonly ok: false; readonly fields: NonEmptyReadonlyArray<string> };
export declare function readCharter<C extends string>(charter: Charter<C>): CharterRead<C>;
export type IntakeRejection = Extract<Rejection, { kind: "invalid-event-shape" | "unknown-capability" }>;
export type IntakeFailure =
  | { readonly kind: "invalid"; readonly rejection: IntakeRejection }
  | { readonly kind: "hostile"; readonly message: string };                  // a throwing getter / Proxy trap
export type IntakeResult<E> = { readonly ok: true; readonly event: E } | { readonly ok: false; readonly failure: IntakeFailure };
export declare function readEventInput<C extends string>(charter: Charter<C>, raw: unknown): IntakeResult<EventInput<C>>;
export declare function readLogEvent<C extends string>(charter: Charter<C>, raw: unknown): IntakeResult<LogEvent<C>>;
export declare function chainOf<C extends string>(tree: GrantTree<C>, id: GrantId): NonEmptyReadonlyArray<GrantId> | undefined;     // undefined: unknown id OR ancestry not completable within MAX_ROOT_DEPTH+1 hops (fail closed)
export declare function trailOf<C extends string>(tree: GrantTree<C>, chain: NonEmptyReadonlyArray<GrantId>): NonEmptyReadonlyArray<PrincipalId> | undefined;
export declare function firstDeadLink<C extends string>(tree: GrantTree<C>, chain: readonly GrantId[]): DeadLink | undefined;
export declare function liveAuthorityAbove<C extends string>(tree: GrantTree<C>, id: GrantId): readonly PrincipalId[];     // grantors on id's chain whose own chain-prefix is fully live
export type StructureRejection = Extract<Rejection, { kind: "duplicate-id" | "not-a-root" | "unknown-parent" | "parent-dead"
  | "grantor-not-holder" | "capability-widening" | "depth-exhausted" | "depth-not-narrowed" | "principal-cycle" }>;
export type StructureCheck = { readonly ok: true } | { readonly ok: false; readonly rejection: StructureRejection };
export declare function checkGrantStructure<C extends string>(charter: Charter<C>, tree: GrantTree<C>, grant: Grant<C>): StructureCheck;

// ---------- lib/allowance (M4) — conservation ----------
export interface Shortfall { readonly grantId: GrantId; readonly requested: Amount; readonly headroom: Amount }
export type HeadroomCheck = { readonly ok: true } | { readonly ok: false; readonly shortfall: Shortfall };
export declare function usedOf<C extends string>(tree: GrantTree<C>, charges: readonly Charge[], id: GrantId): Amount | undefined;
export declare function headroomOf<C extends string>(tree: GrantTree<C>, charges: readonly Charge[], id: GrantId): Amount | undefined;
export declare function absorbedBy<C extends string>(tree: GrantTree<C>, charges: readonly Charge[], revoked: GrantId): Amount | undefined; // undefined unless the grant is recorded revoked
export declare function checkHeadroom<C extends string>(tree: GrantTree<C>, charges: readonly Charge[], id: GrantId, requested: Amount): HeadroomCheck; // unknown/dead ⇒ shortfall with headroom 0

// ---------- lib/standing (M5) — the ledger fold, the verdict, the derived standing ----------
export interface CommitRecord<C extends string = string> { readonly commit: Commitment<C>; readonly seq: Seq; readonly verdict: Verdict }
export interface Folded<C extends string = string> {
  readonly tree: GrantTree<C>; readonly charges: readonly Charge[];
  readonly commits: ReadonlyMap<CommitId, CommitRecord<C>>; readonly head: Seq;
}
export type FoldResult<C extends string = string> =
  | { readonly ok: true; readonly folded: Folded<C> } | { readonly ok: false; readonly fault: FoldFault };
export declare function fold<C extends string>(charter: Charter<C>, log: Log<C>): FoldResult<C>;
export type AppendFailure =
  | { readonly kind: "rejected"; readonly rejection: Rejection } | { readonly kind: "faulty-log"; readonly fault: FoldFault };
export type AppendResult<C extends string = string> =
  | { readonly ok: true; readonly log: Log<C>; readonly event: LogEvent<C>; readonly verdict: Verdict | null }   // verdict non-null iff a commit
  | { readonly ok: false; readonly failure: AppendFailure };
export declare function append<C extends string>(charter: Charter<C>, log: Log<C>, input: EventInput<C>): AppendResult<C>;
export type MayCommitResult = { readonly ok: true; readonly verdict: Verdict } | { readonly ok: false; readonly failure: AppendFailure };
export declare function mayCommit<C extends string>(charter: Charter<C>, log: Log<C>, commit: Commitment<C>): MayCommitResult;
export type StandingsResult =
  | { readonly ok: true; readonly standings: readonly Standing[]; readonly head: Seq } | { readonly ok: false; readonly fault: FoldFault };
export declare function standings<C extends string>(charter: Charter<C>, log: Log<C>): StandingsResult;       // sorted by committedAt
export type StandingOfResult =
  | { readonly ok: true; readonly standing: Standing }
  | { readonly ok: false; readonly failure: { readonly kind: "unknown-commit"; readonly commitId: CommitId } | { readonly kind: "faulty-log"; readonly fault: FoldFault } };
export declare function standingOf<C extends string>(charter: Charter<C>, log: Log<C>, id: CommitId): StandingOfResult;
```

**Behavioural notes the signatures cannot carry.** `append`/`fold`/`standings` never throw on any *input*
(hostile accessors, `Proxy`, malformed charter/log become typed values); they throw only on an internal
invariant violation (e.g. `assertStandingWellFormed` failing on a standing M5 itself built — M5 *must* call it
on every standing it returns; build requirement recorded from adaptive-agent ADR 0001/0005). `append` always
re-reads its `input` through `readEventInput` even though it is typed. `fold` and `append` share **one**
admission path (a property test asserts `fold(append-built log)` ≡ incremental). Internally `fold` mutates local
`Map`s that never escape; the returned views are read-only.

**Function ownership (every function the plan names has exactly one owner — control-tower's "a function the plan
names but no milestone ever builds" defect):** M1 `principalId grantId commitId assertNever* assertStandingWellFormed`
· M3 `readCharter readEventInput readLogEvent chainOf trailOf firstDeadLink liveAuthorityAbove checkGrantStructure`
· M4 `usedOf headroomOf absorbedBy checkHeadroom` · M5 `fold append mayCommit standings standingOf` (+ internal
`judgeCommit`) · M6 `makeOrgView`, the policies, `runQuarter`, `CANON_SCRIPT`, `replayScript` · M8 `computeDemoView`
and the three formatters · M9 the citations test.

---

## 6. Nine milestones

House shape (M1 contracts, M2 deploy, M3–M5 engine layers, M6 domain, M7 failure suite, M8 demo, M9 deliverables). **One deviation:** M3 also owns hostile-input intake,
because it is the same untrusted surface as structural validation. Each milestone is one PR on branch `mN-<slug>`, ends
with its own ADR (`.genesis/decisions/000N-<slug>.md`, written by the milestone that made the decisions),
and is verified by an independent L4 pass before its `chore(genesis): mark MN done` bookkeeping PR. Token budget:
9 × 150 000 (house). **Every sabotage listed below is "must go red" for the independent verifier; those marked
†† were reproduced on the throwaway model of §8 — the builder must re-run them on the real code.**

### Directory ownership — the single source of truth

| Owner | Exact paths | Frozen after |
|---|---|---|
| **G3 scaffold** (not a milestone) | `package.json` `package-lock.json` `tsconfig.json` `tsconfig.lib.json` `vitest.config.ts` `eslint.config.mjs` `next.config.ts` `.gitignore` `.env.example` `.github/workflows/ci.yml` `scripts/register-ts-loader.mjs` `scripts/ts-loader-hooks.mjs` `app/layout.tsx` `app/page.tsx` (placeholder) `app/globals.css` `tests/smoke.test.ts` `README.md` (stub) `.genesis/{PLAN.md,DONE.html,checkpoints/CURRENT.md,decisions/.gitkeep}` | G3 |
| **M1** | `lib/contracts/**` (sources + `__tests__/`) | M1 |
| **M2** | `app/api/health/**` (route + `__tests__/`), `vercel.json`, the single `Live:` line in `README.md` | M2 |
| **M3** | `lib/chain/**` | M3 |
| **M4** | `lib/allowance/**` | M4 |
| **M5** | `lib/standing/**` | M5 |
| **M6** | `domains/company/**`, `scripts/demo-company.ts` | M6 |
| **M7** | `tests/failures/**` | M7 |
| **M8** | `app/page.tsx`, `app/globals.css`, `app/milestones.ts`, `app/milestones.test.ts`, `components/company/**` | M8 |
| **M9** | `docs/**`, `README.md` (rewrite), `tests/docs/**` | M9 |
| **Bookkeeping exception** | `.genesis/DONE.html`, `.genesis/checkpoints/CURRENT.md`, status lines in `app/milestones.ts` — edited **only** by `chore(genesis): mark MN done` PRs after independent L4 APPROVE; never part of a milestone's freeze boundary (resolves the hazard that a "frozen" `app/**` must still flip M9 to done) | — |

A milestone may not edit another's paths. `git diff main -- <earlier paths>` must be empty on every milestone
branch (checked after every file, not only at the end — adaptive-agent ADR 0007's practice).

### M1 — Contracts: `Grant`, `Commitment`, `Standing`, `Breach`, `Rejection`
* **Scope:** every type in §4, the id mint functions (**no parsers**), constants, `assertNever{Standing,Breach,Rejection,FoldFault}`,
  `assertStandingWellFormed`. No engine logic.
* **Owns:** `lib/contracts/**` — `ids.ts limits.ts non-empty-array.ts grant.ts commitment.ts event.ts charter.ts
  tree.ts warrant.ts breach.ts verdict.ts standing.ts rejection.ts fold-fault.ts index.ts __tests__/`.
* **Must refuse:** (a) a `void` standing carrying `warrant|heir|severed|chargedTo`, and a `binding`/`inherited`
  carrying `breach`, via **every** non-literal route — fresh literal, intermediate binding, spread, function
  return, `satisfies`, generic helper, `Object.assign`, array element. *Written in round 1:* adaptive-agent's M1
  shipped an excess-property-only claim and L4 reproduced seven bypasses (its ADR 0001 Decision 1). (b) an
  `inherited` literal missing `heir`, `severed` or `chargedTo` (`null` allowed, `undefined` not). (c) once a domain
  narrows `C`, a misspelt capability — and **HONEST LIMIT tests** that unparameterised `C = string` refuses nothing
  and that `Amount = number` admits `-1` at the type level (pre-empts adaptive-agent's case 17). (d) a fifth
  variant of any of the four closed unions compiling silently. (e) any import in `lib/**` resolving outside
  `lib/**` or an explicit allowlist (**closed module graph**, technique from control-tower's
  `import-containment.test.ts`; resolve by real path, not by `../` syntax) plus the layer table of §5.
  **Not built, on purpose:** a name-scan for "override"/"forced" or any scan of how a `Standing` is *constructed* —
  control-tower's M1 took five rounds on that class of scanner; absorbing-ness is proven behaviourally in M5.
* **Falsifiable check:** `npm test -- lib/contracts` and `npm run typecheck`. Sabotage: make `breach` optional on
  `binding` → typecheck fails `TS2578` at the proof; make `heir` optional on `inherited` → likewise; add a fourth
  `Standing` variant to the stand-in union → every `assertNeverStanding` site fails to compile (proof is on a
  **local stand-in**, not the real union); drop one field from `assertStandingWellFormed`'s forbidden list → its
  named test goes red; insert `import "node:fs"` into a `lib/contracts` source → containment test names the file.

### M2 — Deploy skeleton (deployed now, never last)
* **Scope:** `GET /api/health` runs a real self-check against `lib/contracts`: `assertStandingWellFormed` on (1) a
  well-formed `inherited` → must be `ok`, (2) a cast-built `void` carrying a `warrant` → must be
  `unexpected-field/void/warrant`, (3) a cast-built `inherited` missing `heir` → must be `missing-field/inherited/heir`;
  reports `VERCEL_GIT_COMMIT_SHA` or the literal `"unknown (local dev)"` — never a guessed SHA. `export const dynamic = "force-dynamic"`.
  `vercel.json` pins `installCommand: "npm ci"` and `buildCommand: "npm run build"` (Vercel's zero-config preset
  runs plain `next build`, i.e. Turbopack, which cannot resolve `lib/`'s `.js`-suffixed imports — adaptive-agent
  ADR 0002 Decision 3 verified this against the build log).
* **Owns:** `app/api/health/**`, `vercel.json`, README `Live:` line. **Needs a Vercel account — a human step.**
* **Must refuse:** `200` on a bare liveness ping; a fabricated SHA; deploying from a dirty tree (the CLI uploads
  the working tree while `VERCEL_GIT_COMMIT_SHA` reads `HEAD` — a sibling M8 was rejected for exactly this; rule: commit
  everything, `git status --short` empty, `vercel deploy`, then diff the live `commit` against `git rev-parse HEAD`,
  **every** deploy); the framework preset's default build.
* **Falsifiable check:** `curl -sf <live>/api/health` → 200, body `commit` equals `git rev-parse HEAD` of the
  deployed clean tree, `checks.contracts.pass: true`. Sabotage (local `next dev`, reverted): disable the `heir`
  branch of `assertStandingWellFormed` → `503` with `status: "degraded"`. A route test calls `GET` directly and
  asserts both branches (mocking the guard to fail → 503). The independent verifier confirms webpack by finding no
  `turbopack` string in the served runtime chunk (the build log itself is not reproducible without the CLI).

### M3 — Chain: intake and structure (`lib/chain/**`)
* **Scope:** every §5 M3 function. Intake reads each field **exactly once** into plain data (a getter that returns
  different values on successive reads must not be able to contaminate a result — adaptive-agent ADR 0003 Decision 4).
  Shape validation reports **all** offending fields, deduped and sorted: non-string / empty / over-`MAX_ID_LENGTH`
  ids, `limit`/`amount` not a safe non-negative integer ≤ `MAX_AMOUNT`, `depth` not an integer in `[0, MAX_ROOT_DEPTH]`,
  empty or **duplicate** `capabilities`, a capability outside `charter.capabilities`.
* **Owns:** `lib/chain/**` — `intake.ts chain.ts structure.ts index.ts __tests__/{intake,hostile-input,structure,attenuation-closure,boundaries,architecture}.test.ts + fixtures.ts`.
* **Must refuse:** each of the nine `StructureRejection`s; a hostile `GrantTree` (hand-built cyclic parent pointers)
  must make `chainOf` return `undefined`, never loop; a `revoker`-style claim is never read here (M5).
* **Falsifiable check:** `npm test -- lib/chain`. Three layers, because **whole-system properties do not reliably catch deleted structural refusals** (§8: on the throwaway model, deleting
  `parent-dead`, depth narrowing or the cycle check — and M5's revoker rule — tripped **no** whole-system property; deleting `⊆`, `grantor = parent.grantee` or the root check
  tripped one only incidentally, via an unrelated heir-consistency check): (1) **table-driven, masking-aware** — each rejection's fixture
  violates *only* that rule (e.g. the `parent-dead` fixture uses `limit: 0`: a dead grant's headroom is 0, so any positive limit is reported as `over-allocation` instead — the masking
  that hid the deletion). (2) **Attenuation-closure property** over a seeded
  generator (hand-rolled `mulberry32`, as adaptive-agent's evidence tests use; no new dependency): for every accepted
  grant, `grantor = parent.grantee`, `capabilities ⊆ parent`, `depth ≤ parent.depth − 1`, no principal repeats on a chain,
  chain length ≤ `MAX_ROOT_DEPTH + 1`, root grantor ∈ `charter.roots`. The generator must be **proven able to reach** every
  rejection kind (a coverage assertion, adaptive-agent ADR 0003 Decision 2's pool-size lesson; it deliberately draws
  principals from a pool of 5 so collisions are the common case). (3) **Boundaries N / N+1** for every invented constant.
  Sabotage ledger (each must go red): `⊆` → "any overlap" ††; drop `grantor = parent.grantee` ††; drop depth narrowing ††;
  drop the cycle check ††; drop the root check ††; drop `parent-dead` ††(only the table test catches it); read a field twice
  in intake (a mutating-getter test must catch it).

### M4 — Allowance: conservation (`lib/allowance/**`)
* **Scope:** §5 M4 functions, definitions of §4.4. Pure over `(tree, charges)`.
* **Owns:** `lib/allowance/**` — `accounting.ts index.ts __tests__/{accounting,conservation,exact-return,architecture}.test.ts + fixtures.ts`.
* **Must refuse:** reserving more than the parent's headroom; returning *spent* authority on revoke; a dead grant having non-zero
  headroom; `usedOf`/`headroomOf` on an unknown id returning a number.
* **Falsifiable check:** `npm test -- lib/allowance`. The test driver builds charges **only** by choosing `amount ≤ headroomOf(…)`
  and grants only through M3's `checkGrantStructure` + M4's `checkHeadroom` — it re-implements **no** predicate
  (adaptive-agent ADR 0005's duplicated-predicate coupling risk, avoided by construction). Properties at every prefix: the
  conservation theorem of §4.4, including the **exact-return equality** (`+ limit(h) − subtreeOwn(h)`). Sabotage ledger: revoked
  child charges 0 ("forgive spent") ⇒ "root over-spent" ††; revoked child keeps its full reservation ⇒ **only** the exact-return
  property catches it (safety properties alone pass — a liveness defect) ††; skip the headroom check at reservation ⇒ negative
  headroom ††; revoking an already-dead grant re-sets `revokedAt` ⇒ exact-return fails ††.

### M5 — Standing: the ledger fold, the verdict, the heir (`lib/standing/**`)
* **Scope:** §5 M5 functions. `judgeCommit` (internal, called by both `append` and `mayCommit`); standing derivation of §4.2;
  revoke admission (`liveAuthorityAbove`); duplicate commit ids; `MAX_LOG_EVENTS`; `seq` stamping.
* **Owns:** `lib/standing/**` — `fold.ts verdict.ts standing.ts append.ts index.ts __tests__/{verdict-table,revoke-admission,fold-faults,lattice,heir,prefix,locality,replay,may-commit-equivalence,integrity,architecture}.test.ts + fixtures.ts`.
* **Must refuse:** an over-limit/over-scope/dead-chain/borrowed-grant commit **binding** the org; an unauthorised revoker; a duplicate commit id;
  hindsight (a verdict that depends on any later event); a caller choosing `seq`; a standing built without
  `assertStandingWellFormed` being called on it.
* **Falsifiable check:** `npm test -- lib/standing`. (1) **Verdict table** with masking-aware fixtures *and* a multi-breach pair per
  precedence step (a commit that breaches 2–3 rules reports only the first). (2) **Revoke-admission table** — `revoker-not-authorised`
  has **no** property that catches its removal (††: with it deleted every property still passed), so this table is its only guard.
  (3) **Properties over a whole-system generator**, ≥ 1 500 seeds × 100 events: replay determinism; `append`-built ≡ `fold`;
  **prefix hindsight-invariance** (a commit's verdict recomputed from any prefix equals its verdict in the full log); the **standing
  lattice** (void→void, binding→{binding,inherited}, inherited→inherited, never void from binding) ††; **heir invariants** —
  `severed.atSeq > committedAt` ††, `chargedTo` null ⇒ heir ∈ `charter.roots`, else `chargedTo` is live and `heir = grantee(chargedTo)` ††,
  and **monotone climb** (the severed link's index along the chain never increases as the prefix grows); **locality** (below);
  `mayCommit(c)` verdict ≡ the verdict `append(c)` records. (4) `integrity.test.ts` mocks `assertStandingWellFormed` to fail and
  asserts a throw, *plus* a real un-mocked cast-built contaminated value (the adaptive-agent ADR 0005 Decision 7 two-way proof).
  Sabotage ledger: judge against the final tree in `standingOf` ⇒ lattice red ††; `judgeCommit` checks only the acted-under grant's own
  revocation ⇒ "severed.atSeq > committedAt" red ††; heir = grantee instead of grantor ⇒ heir invariant red ††; delete `revoker-not-authorised` ⇒
  table red (only); delete `already-dead` ⇒ exact-return red ††; make `append` and `mayCommit` use different predicates ⇒ equivalence red.
* **The locality property — and the formulation I rejected.** *As first drafted* ("deleting every commit under subtree(a) leaves
  verdicts under any non-ancestral grant `b` unchanged") **is false**: deleting commits can flip an *ancestor's* verdict (headroom
  rises), which then admits a new charge, which makes a later grant inadmissible — reproduced in 2 of 4 000 seeds on the
  correct model (§8). *As specified:* **delete every commit outside `subtree(b)`; the remaining log must still replay admissibly and
  every verdict inside `subtree(b)` must be unchanged.** This also states the project's answer to "the loudest agent winning": a noisy
  agent can only exhaust the allowance reserved for it; a grant's subtree depends only on its own commits and the grant/revoke structure.
  (An ancestor *is* affected by a revoked descendant's spend — delegation is a loan whose repayment, on revocation, is what was spent.)

### M6 — Domain: Meridian Supply Co. (`domains/company/**`, `scripts/demo-company.ts`)
* **Scope:** the org (one human root `dana`; agents `cfo ops support buyer-a buyer-b refunder`; capabilities
  `purchase | refund | hire | sign-contract` as `type CompanyCapability`, with the **closed runtime vocabulary** in `CHARTER`);
  `CANON_SCRIPT` — the exact event list of §7 (18 admitted events, 15+ attempted rejections); deterministic **autonomous policies**
  (`BuyerPolicy`, `RefunderPolicy`, `DelegatorPolicy`, `OverreachPolicy`, `CompromisedPolicy`) of `(OrgView, rng) → EventInput | null`;
  `runQuarter(seed, ticks)` stepping them in fixed order with a seeded `mulberry32`, injecting the §7 incident at a scripted tick, recording
  an `Attempt` per call (`admitted | rejected | faulty-log`; the `AppendResult` → `AttemptOutcome` mapping needs no cast — checked in §8).
* **Owns:** `domains/company/**` — `org.ts script.ts policies.ts view.ts simulate.ts index.ts __tests__/*`, and `scripts/demo-company.ts`.
* **Must refuse:** to contribute **any** authority rule — `domains/company/**` must not construct a `Standing`, compute headroom, or
  re-implement a rejection (source scan: no `kind: "binding"|"inherited"|"void"` literal; no arithmetic on `limit`/`amount`/`headroom`;
  imports only from `lib/*/index`). Control-tower's ADR 0006 Decision 4c is the cautionary precedent: a load-bearing rule placed in `domains/`
  is protected only by unit tests and escapes `lib/`'s scans. A misspelt capability must not compile (`@ts-expect-error`).
* **Falsifiable check:** `npm run demo:company` prints, per step, the attempt, the engine's typed result, and — at the revoke — the standings
  before/after with `absorbed`/`returned`; it **exits non-zero unless all 3 `Standing` kinds, all 5 `Breach` kinds and all 15 `Rejection` kinds
  were actually observed in the run**, and unless an **independent oracle in the script** (sum of `binding|inherited` commit amounts per root grant, computed
  from the raw log without importing `lib/allowance`) is ≤ that root's limit. Also `npm test -- domains/company`: `runQuarter` over 200 seeds never
  throws, always folds, and conserves. Sabotage (reverted): `absorbedBy` → `0` makes the demo exit non-zero on the oracle; flip M5's `link-dead` check → the demo's
  step assertion throws. The §7 numbers are **verified against the throwaway model**, not asserted from memory.

### M7 — The failure suite (`tests/failures/**`) — 11 cases
See §11. Each file's header states `KIND: PROVES | DISCLOSES | HONEST PARTIAL PIN`, the design decision (D#) it traces to, and **what would make it
fail**. Case **01 is the project's deliberate failure test.** At least five are sabotaged for real against the *shipped* source and restored
byte-for-byte. `git diff main -- lib domains app` stays empty throughout.
* **Owns:** `tests/failures/**` — `01-…test.ts` … `11-…test.ts`, `helpers.ts`.
* **Must refuse:** to claim a limit is closed when it is not; a case that passes without exercising its own stated limit; restating an M3–M5 test without new scale or a new layer; any edit under `lib/**`, `domains/**`, `app/**`.
* **Falsifiable check:** `npm test -- failures`; every case asserts a specific typed result, never "did not throw." Sketch risk, stated up front: every sibling found its own M7 sketch partly wrong on contact (a described mechanism that did not exist; a case that, taken literally, only tested that the caller behaves) — cases 02 and 09 are the two most exposed here; the builder replaces a case rather than bending it, and records which.

### M8 — Interactive demo (`app/`, `components/company/`)
* **Scope:** one page driving the real engine in the browser. **One pure bridge** (`components/company/compute-demo-view.ts`) is the only file
  under `components/` that imports `lib/**`/`domains/**`; the component renders exactly what it returns. State is a single `useReducer` over
  `{ log, attempts }`; **no `useEffect`, `useCallback`, `useMemo`, `setTimeout` or `async` anywhere** (control-tower ADR 0009 Decision 2; memory-ledger
  ADR 0006 Decision 6 checked this by grep). Controls: a **seq scrubber**; "Revoke Ops-Lead"; three preset overreach buttons (widen scope · over-delegate ·
  spend beyond limit); "Autonomous quarter (seed N)". The page shows the org tree with `limit / used / headroom` bars, the commitments table with `Standing`
  badges (heir and `chargedTo` shown for `inherited`; the cited `Breach` for `void`), the attempt transcript with named rejections, and a conservation
  meter (`Σ binding+inherited ≤ Σ root limits`). `app/milestones.ts` + `app/milestones.test.ts` (drift guard, decision-engine pattern) compare claimed-done
  milestones with `.genesis/DONE.html`.
* **Owns:** `app/page.tsx`, `app/globals.css`, `app/milestones.ts`, `app/milestones.test.ts`, `components/company/**`
  (`compute-demo-view.ts`, `format-standing.ts`, `format-breach.ts`, `format-rejection.ts`, `CompanyDemo.tsx`, `__tests__/`).
* **Must refuse:** to render a standing, heir or rejection the engine did not just produce for the log on screen (no pre-baked transcript); to throw
  (`computeDemoView` returns `{ok}|{ok:false,error}` with a `try/catch` as *second* layer); to show a different number from `npm run demo:company`.
* **Falsifiable check:** (1) **exhaustive**: every sequence of length ≤ 4 over the demo's ~8-button alphabet (≈ 4 096) yields `ok: true` and a conserving
  view — the finite-state analogue of control-tower's 54-state cross-product, since the log is unbounded; (2) on the deployed URL, clicking "Revoke Ops-Lead" on
  the canonical log renders the same table as the last block of `npm run demo:company` (**an independent verifier diffs the two**); (3) `renderToStaticMarkup`
  render-smoke tests at several initial logs (no jsdom; `vitest` stays `environment: "node"`); (4) a source scan for the banned hooks; (5) scrubber at seq 10
  shows `c1 c2 c3 c4` all `binding`, at seq 11 shows `c1 c2 c4` `inherited` with heir `cfo`. The click-to-re-render path itself is verified by hand against the live URL
  and recorded in `docs/WALKTHROUGH.md` (control-tower's disclosed gap, kept disclosed).

### M9 — Deliverables
* **Scope:** `README.md` (one-paragraph claim, live URL, clean-clone command, **Honest limits** listing every M7 case), `docs/ARCHITECTURE.md` (stage-by-stage
  "what it refuses and why", each refusal cited to a real file **and test name**), `docs/THESIS.md` (≤ 300 words), `docs/WALKTHROUGH.md` (90-second Loom script),
  `docs/NOTES.md` (process record), `tests/docs/citations.test.ts`.
* **Owns:** `docs/**`, `README.md`, `tests/docs/**`.
* **Must refuse:** a doc claim no test pins (control-tower's README admits "nothing in this repository's own tooling currently checks that a doc file's claims still
  match the code" — this milestone closes that for citations); a thesis over 300 words; a milestone marked done that `DONE.html` disagrees with.
* **Falsifiable check:** `cd "$(mktemp -d)" && git clone <repo> . && npm ci && npm run typecheck && npm test && npm run build`, **output pasted verbatim**, plus
  CI green on a fresh runner. `tests/docs/citations.test.ts`: every backticked `lib/**` / `tests/failures/**` test path in `README.md` and `docs/ARCHITECTURE.md`
  exists, and every quoted test name occurs as a substring of that file; `docs/THESIS.md` word count ≤ 300. Sabotage: rename a cited test file → red.
  The **Loom recording itself is a human step**; the plan delivers its script.

---

## 7. The canonical incident (M6's `CANON_SCRIPT`, M8's headline) — numbers verified by execution of the throwaway model

Charter: roots `[dana]`; capabilities `purchase refund hire sign-contract`. `seq` is the admitted-event position; rejected attempts consume none.

| seq | Event | Result |
|---|---|---|
| 1 | grant **G1** dana→cfo, all four caps, limit 1 000 000, depth 4 | admitted |
| 2 | grant **G2** G1: cfo→ops, `purchase sign-contract`, 400 000, depth 3 | admitted |
| 3 | grant **G3** G1: cfo→support, `refund`, 100 000, depth 2 | admitted |
| 4 | grant **G4** G2: ops→buyer-a, `purchase`, 120 000, depth 0 | admitted |
| 5 | grant **G5** G2: ops→buyer-b, `purchase`, 150 000, depth 0 | admitted |
| 6 | grant **G6** G3: support→refunder, `refund`, 40 000, depth 0 | admitted |
| 7–10 | commits **c1** buyer-a 50 000 (G4) · **c2** buyer-b 90 000 (G5) · **c3** refunder 12 000 refund (G6) · **c4** ops 80 000 `sign-contract` (G2) | all warranted; headroom now G1 500 000 · G2 50 000 · G4 70 000 · G6 28 000 |
| — | *beat 1, before the revoke (rejected, no seq):* widen scope (`hire` under G2) · over-delegate 200 000 (headroom 50 000) · buyer-a (depth 0) delegates · `intern` mints a root · buyer-b delegates under ops' G2 · child depth 3 under a depth-3 parent · cfo as grantee under G2 · unknown parent · duplicate id `G3` · buyer-a revokes G5 · revoke unknown grant | `capability-widening` · `over-allocation{200000, 50000}` · `depth-exhausted` · `not-a-root` · `grantor-not-holder` · `depth-not-narrowed` · `principal-cycle` · `unknown-parent` · `duplicate-id` · `revoker-not-authorised` · `unknown-grant` |
| 11 | **revoke G2 by cfo** | admitted. **absorbed(G2) = 220 000** (80 000 + 50 000 + 90 000), **returned 180 000**; G1 headroom 500 000 → **680 000**. c1, c2, c4 → `inherited`, severed `G2@11`, **heir `cfo`**, `chargedTo G1`; c3 stays `binding` |
| — | cfo revokes G2 again · ops grants under dead G2 with limit 0 | `already-dead` · `parent-dead` (limit 0 so `over-allocation` cannot mask it) |
| 12 | c5 buyer-a 10 000 under G4 | `void: link-dead{G2, atSeq 11}` |
| 13 | c6 buyer-b 5 000 under **G4** (borrowed, and dead) | `void: wrong-actor{holder buyer-a}` — **masks `link-dead`** (precedence; failure case 06) |
| 14 | c7 refunder `purchase` 3 000 under G6 | `void: capability-not-granted` |
| 15 | c8 refunder refund 50 000 under G6 | `void: over-limit{requested 50000, headroom 28000}` |
| 16 | c9 buyer-a 1 000 under `g-ghost` | `void: no-such-grant` |
| 17 | grant **G7** G1: cfo→buyer-a `purchase` 60 000 depth 0 | admitted — the **cure is a new grant, not a relabelling** |
| 18 | c10 buyer-a 10 000 under G7 | warranted → `binding` |
| — | *intake rejections to complete the 15:* a grant with `limit: -1`; a grant naming capability `"launder"` | `invalid-event-shape{fields:["limit"]}` · `unknown-capability` |

Scrub back to seq 10: `c1 c2 c3 c4` all `binding` — revocation did not rewrite the past. Final standings: c1 c2 c4 `inherited`/cfo, c3 c10 `binding`, c5–c9 `void`.

---

## 8. Plan-internal consistency check — what I ran and what it found

**A. Mechanical type trace — two compiles.** (i) The plan's own four `ts` blocks, extracted from this file and compiled together (§4.1): passes; deleting a definition fails (`TS2304`).
(ii) A scratch file (`…/scratchpad/trace/plan-types.ts`, ≈ 430 lines, the same declarations plus 14 tiny *probe* bodies) was compiled
with the sibling `tsc 7.0.2` under `tsconfig.lib.json`-equivalent flags. It passes. The probes make `tsc` check that **every required field of every cross-layer
type has a source in what the layer below returns**: `Verdict`/`Breach` fields ← `chainOf`, `firstDeadLink` (returns `{grantId, atSeq}`, which `link-dead` needs), `checkHeadroom`
(returns `Shortfall{requested, headroom}`, which `over-limit` and `over-allocation` need); `Warrant.trail` ← `trailOf`; `InheritedStanding.{severed, heir, chargedTo}` ← the `DeadLink`
plus `tree.grants.get(dead).{grantor, parent}`; `committedAt` ← `CommitRecord.seq`; `AppendResult` → `AttemptOutcome` with no cast; `FoldFault.inadmissible-event.rejection` ←
`Rejection`; `FoldFault.invalid-charter.fields` ← `CharterRead`; `FoldFault.hostile-log-input` ← `IntakeFailure{kind:"hostile"}`; the UI-needed `absorbed`/`returned` ← `absorbedBy` + `grant.limit`.
Proof it is not vacuous — four sabotage runs each failed `tsc` with the predicted error: dropping `chargedTo` from the inherited probe (TS2322, missing property); `severed` built
without `atSeq` (TS2741); `firstDeadLink` returning a bare `GrantId` (TS2339 at five sites); `checkHeadroom` returning `{ok:boolean}` (TS2339 `shortfall`). The `@ts-expect-error` proofs for
void⊥warrant, inherited-needs-heir, binding⊥breach, a misspelt capability, and the intermediate-binding and spread routes **all fire** (an unused directive would be an error).

**B. Semantic model.** A throwaway Node model of §4 (`…/trace/model-check4.mjs`, ≈ 200 lines) was fuzzed: 1 500 seeds × 100 events (and 4 000 × 120 for one property), small principal/capability
pools so collisions are common, checking at every prefix the conservation theorem (incl. exact-return), the standing lattice, the heir invariants and monotone climb, replay determinism, prefix hindsight-invariance
and locality. **0 violations of the properties as specified** (the naive deletion form of defect 1 below is not one of them). The generator reached 11 of 15 `Rejection` kinds (the four it cannot — `invalid-event-shape`, `unknown-capability`, `duplicate-id`, `unknown-parent` —
need hand-built hostile input, so M3 must test them directly), all 5 `Breach` kinds and all 3 `Standing` kinds. Mutants confirmed the checks can fail (††-marked in §6).

**Defects the check found in my own draft (each changed the plan):**
1. **The non-interference property as first written was false** (2 / 4 000 seeds). Replaced by *locality* (§6 M5).
2. **Safety properties alone do not detect several deleted refusals.** With `parent-dead`, `revoker-not-authorised`, `depth-not-narrowed`, or `principal-cycle` deleted, **no whole-system property failed**. Hence the
   table-driven, masking-aware fixtures and the attenuation-closure property in M3/M5; the sabotage ledgers; and the explicit `limit: 0` fixture so `over-allocation` cannot mask `parent-dead`.
3. **A liveness defect is invisible to safety properties:** a revoke that keeps the *full* reservation (never returning unspent authority) passes conservation. Hence the **exact-return equality** in M4.
4. **Ratification did not survive tracing.** I designed `ratify` (a live ancestor retroactively authorising a void act). Tracing a ratified commit through the lattice forced a fourth state
   (ratified-then-severed) and a second, retroactive way to create authority — contradicting D1. **Dropped** (§10).
5. **Demo numbers** are executed, not hand-computed: G2 headroom 50 000, absorbed 220 000, returned 180 000, G1 500 000 → 680 000, seqs 1–18, revoke at seq 11 — all from the model run.

**C. Contradictions and gaps checked by reading, not execution.** *No two refusals contradict* (control-tower's "never exceed the gate" vs "may produce `forced`"): "refuses to bind" (commits) and
"refuses to admit" (grants/revokes) are separated by D4 and never claimed for the same event. *No parallel index-paired arrays* (control-tower's singular-severity defect): every function takes one `log`, one `charter`.
*No caller-supplied derived state* (adaptive-agent's `priorState`): the only caller-supplied structures are the charter (configuration) and the log (re-validated). *Every contract field has a reader* (control-tower's
`Heartbeat.at`, collected and never read): `Grant.depth` ← depth rules; `Warrant.trail` ← UI + trail test; `Commitment.actor` ← `wrong-actor`; `RevokeEvent.by` ← `revoker-not-authorised` + transcript; `Standing.committedAt`
← sorting, scrubber, lattice property; `chargedTo` ← UI + heir invariant. *Constants are named and bounded:* `MAX_AMOUNT 2**40` keeps `used + requested < 2**41 < 2**53`.

**D. Not verified.** Nothing is built; the model is not the build and will have bugs the build will find; the M7 sketch will be partly wrong on contact, like every predecessor's. The two sketches at highest risk of being
"a test that only checks the caller behaves" or "a mechanism that doesn't exist" are flagged in §11 (cases 02, 09).

---

## 9. The single riskiest design decision

**Revocation is prospective-only, and `void` is absorbing (D1).** A security-minded judge watching the headline moment sees "revoke the compromised agent" and then sees its earlier commitments *still stand*
(`inherited`) — which can read as a containment failure rather than a principle. *Why it is made anyway:* the alternative lets revocation be used to repudiate every counterparty (the commitments of every revoked
manager would evaporate), and it is the symmetric half of "no retroactive authority" — the same rule that keeps `void` from being cured by hindsight. *The mitigation is in the demo, not the prose:* the 55–72 s beat
(the same agent's *next* act is `void: link-dead`) and the scrubber (seq 10 vs 11) are on screen in the same 90 seconds, so the contrast "past stands, future is cut, someone named answers" is visible
rather than argued. *What would falsify the decision:* a judge or user producing a domain where voiding in-mandate acts on revocation is the correct default — then D1 is a domain parameter, not a principle,
and the thesis weakens. *Second-order risk:* vocabulary load (3 standings + 5 breaches + 15 rejections + 5 faults) in a 90-second demo; the Loom uses only the three standings and three named rejections.

---

## 10. Considered and rejected

* **Multi-agent role-play** — prompt wrapper; disqualifier.
* **Quorum / voting / separation-of-duties as the spine** — counting independent approvers is adaptive-agent's `distinctContexts` / control-tower's `Corroboration` in new nouns, and headcount is volume. *Out of scope, disclosed:* k-of-n joint grants.
* **Ratification (a live ancestor retroactively authorising a void act)** — a second, retroactive path to authority; forced a fourth, ratified-then-severed state; contradicts D1. A cure is a new commit/grant. Cost: a counterparty relationship needs an out-of-band new act.
* **Retroactive revocation** (void everything a revoked agent did) — correct for memory-ledger's *beliefs* (a retracted source makes what it taught untrue); wrong for *commitments*; makes revocation a repudiation weapon.
* **Cryptographic grants (VCs / UCAN / `did:key`)** — agent-trust-layer's territory; here authorship is *asserted* (D5, case 05). The two compose later.
* **Wall-clock expiry / TTL / rate limits on grants** — drags in clocks (control-tower's staleness/skew class). Time-boxed authority = a scheduled `revoke` event. Disclosed in case 07.
* **Over-subscription ("credit lines")** — breaks conservation; this is the counterclaim, answered in §2.2.
* **A commitment lifecycle** (fulfil / cancel / expire) — a second state machine; standing is about *who answers*, not completion. A `void` act is not unwound here (that is shadow-run's problem).
* **A `ratified` or `pending` Standing variant; a `Principal.kind: human|agent` in the log** — roots live in the charter; fewer states.
* **Multi-dimensional scope (per-vendor, per-day)** — one conserved scalar by design (D6); a second dimension would need a second conservation law.
* **Per-human aggregate budget across root grants** — a root can issue many root grants; roots are trusted (case 04). The model protects the org from its agents, not from its humans.
* **A `grantee-is-root` rejection** — harmless (a root's own authority does not derive from grants); a rule nobody asked for is where this series' bypasses came from.
* **Name-scans for `override` / `forced` / how a `Standing` is constructed** — the scanner-chasing trap (control-tower M1: five rounds). Absorbing-ness is proven by behaviour.
* **An external supervisor / "who is watching" loop in this repo** — that is control-tower. Composition: the tower detects → someone revokes → this ledger rules on the consequence.
* **LLM-driven agents** — nondeterministic demo, a key, and exactly the disqualifier risk. Policies are pure; an LLM adapter replaces one file (D10).
* **A mutable `LedgerState` passed by callers** — the `priorState` trust gap (adaptive-agent case 10). The log is the only state.
* **Persistence / a database** — in-memory; the demo holds the log in React state. Disclosed.

---

## 11. The failure suite sketch (11 cases, each traced to a design decision, each pinning a real limit)

Each file header: `KIND`, `TRACES TO D#`, `WHAT WOULD MAKE THIS FAIL`. Cases 01, 03, 10, 11 are PROVES; the rest DISCLOSE.

| # | File | KIND | Traces to | Pins |
|---|---|---|---|---|
| 01 | `01-compromise-within-mandate-is-invisible` | DISCLOSES + PROVES the bound — **the deliberate failure test** | D1, D2 | A compromised buyer holding a grant of limit 50 000 commits 10 000 five times: **all five are `binding`**; the engine cannot tell compromise from diligence. What *is* proven: worst-case loss = the grant's limit (a sixth commit of 1 is `void: over-limit{headroom 0}`), and after the revoke the five are `inherited` (heir = the grantor), not undone. |
| 02 | `02-arrival-is-order` | HONEST PARTIAL PIN | D3 | A commit "initiated before" a revoke but appended after it is `void: link-dead`; the engine has no `initiatedAt`. Pinned as N/N+1 on the §7 log: `c4` at seq 10 is `inherited`, `c5` at seq 12 is `void`, around the revoke at seq 11. *Partial* because a single-threaded engine cannot interleave (memory-ledger's Case 1 precedent): the case fixes the order. **Risk of being "tests only that the caller behaves":** assert the *outcomes* at both sides of the boundary, not the absence of a field. |
| 03 | `03-revoke-and-regrant-cannot-mint-authority` | PROVES | D2 | Parent limit 100; child granted 60, spends 50, is revoked ⇒ parent headroom is 50 (not 100), so re-granting 60 is `over-allocation{requested 60, headroom 50}` while re-granting 50 is admitted; total ever spendable under the parent ≤ 100. Sabotage "forgive spent" turns it red. |
| 04 | `04-root-reissue-is-unbounded` | DISCLOSES | D5 | The charter's root can issue many root grants; conservation is per root grant, not per human; revoking a root grant yields `inherited` with `chargedTo: null` (off-ledger). |
| 05 | `05-authorship-is-asserted-not-authenticated` | DISCLOSES (+ PROVES replay re-validation) | D5, D3 | A forged `by` naming a real above-principal is accepted; a forged `actor` naming the right grantee passes `wrong-actor`; a hand-built log of only admissible events that never happened folds clean. **PROVES:** a cast-built log containing an *inadmissible* event (a widening grant) is caught on fold as `inadmissible-event{index}` — no brand to forge. |
| 06 | `06-only-the-first-breach-is-named` | DISCLOSES | D8 | The §7 `c6`: borrowed *and* dead ⇒ only `wrong-actor`; fixing it would reveal `link-dead`. Same for `Rejection` precedence (`limit: 0` fixtures expose the masked reason). |
| 07 | `07-grants-never-lapse` | DISCLOSES | D6 | A grant is still live after 4 000 unrelated events; there is no expiry and no rate limit; the whole limit can be spent in consecutive seqs. Authority ends only on an explicit `revoke`. |
| 08 | `08-charter-is-part-of-the-logs-meaning` | DISCLOSES | D3, D5 | Folding the same log with a charter that drops a root or a capability fails closed (`inadmissible-event`), rather than silently reclassifying history; there is no charter versioning. |
| 09 | `09-admitting-a-void-commit-is-not-refusing-it` | DISCLOSES | D4, D9 | `append` of an unauthorised commit **succeeds** and records `void` (a fact); only the optional `mayCommit` would have said no. **Risk (case "gate never consulted", shadow-run's README):** assert the engine's *admission* behaviour, not that callers skip the pre-check. The consequence side is tested elsewhere: standing feeds accounting, so it is not a dashboard. |
| 10 | `10-hostile-input-fails-closed` | PROVES | D3 | Throwing getters, `Proxy` log/charter, a mutating accessor read exactly once, `seq` gaps, `MAX_LOG_EVENTS` N/N+1, `MAX_ID_LENGTH`/`MAX_AMOUNT` boundaries: all typed `FoldFault`/`Rejection`, never a throw. |
| 11 | `11-accountability-follows-delegation-not-revocation` | PROVES | D7 | The heir is the grantor of the first dead link regardless of who revoked (`dana` revoking G2 still names `cfo`); when G1 is later cut, the same commits' heir climbs to `dana`; it is never the actor or below. |

Four sketches from the siblings' history were checked against this list: none depends on a field nothing reads (control-tower's heartbeat-clock case), none restates an M3–M5 test (adaptive-agent's cases 1–4 were
re-proofs at scale), and 01/04/09 are limits found by tracing the design, not generic input validation.

---

## 12. The stack

Next.js 16 + React 19 on Vercel, TypeScript, vitest. **Copied, not reinvented, from `adaptive-agent` on `main` (`7b7ef2d`), read via `git show`/`git archive origin/main`** (I read each file): `next.config.ts`,
`tsconfig.json`, `tsconfig.lib.json`, `vitest.config.ts`, `eslint.config.mjs`, `vercel.json`, `package.json`, `package-lock.json`, `.gitignore`, `scripts/register-ts-loader.mjs`, `scripts/ts-loader-hooks.mjs`,
`tests/smoke.test.ts`, `app/layout.tsx`. Pinned versions as found: `next 16.3.5`, `react/react-dom 19.3.0`, `typescript 7.0.2`, `vitest 5.0.1`, `eslint 10.11.0`, `@eslint/js 10.0.1`, `@types/node 24.13.5`, `@types/react(-dom) 19.3.0`, `engines.node 24.x`.

* **Build with `next build --webpack` plus `experimental.extensionAlias: { ".js": [".ts", ".tsx", ".js"] }`** (and `next dev --webpack`). Turbopack cannot resolve NodeNext `.js`-suffixed imports; the full reasoning is the comment block in `next.config.ts` — copy it verbatim.
* **`npm ci` only, never `npm install`.** npm 11.5.1 silently drops `@rolldown/binding-*` when reconciling against an existing lockfile; `npm test` then fails with a bare "Cannot find native binding." The copied lockfile already lists all 15 rolldown platform bindings.
* **`typescript-eslint` hard-throws on TypeScript 7**, so `eslint.config.mjs` ignores `**/*.ts(x)`; `npm run lint` is real only for plain JS/config files and **`npm run typecheck` is the backstop** (`tsc -p tsconfig.lib.json --noEmit && tsc -p tsconfig.json --noEmit`). M9's Honest limits say so.
* **Vercel's zero-config preset defaults to Turbopack**, so `vercel.json` must pin `{"installCommand":"npm ci","buildCommand":"npm run build"}` (M2).

**Deviations from the copy — G3 must do these, and each is a trap if skipped:**
1. **`vitest.config.ts` lacks the `components/**` globs.** adaptive-agent's `main` includes only `lib/ app/ domains/ tests/`; agent-control-tower's `main` additionally includes `components/**/*.test.ts` and `components/**/*.test.tsx`. Copying adaptive-agent verbatim would make M8's tests **silently never run**. Add both globs at G3 (the "pre-added-ahead-of-need" precedent).
2. **`package.json`**: `name`, `description`, and the script `"demo:company": "node --import ./scripts/register-ts-loader.mjs scripts/demo-company.ts"` replacing `demo:triage`. **`package-lock.json`**: change the two `"name"` fields (root and `packages[""]`) from `adaptive-agent`; do not regenerate it.
3. **`.github/workflows/ci.yml` and `.env.example` from `decision-engine`** (four siblings have CI; adaptive-agent and control-tower have none): `npm ci` → assert the rolldown binding loaded → typecheck → test → build, with a step asserting the workflow reads no secrets.
4. **`fileParallelism`:** control-tower needs `fileParallelism: false` only because its architecture tests write scratch files *inside `lib/`*. M1's tests are specified read-only on `lib/` (synthetic fixtures live under `os.tmpdir()`), so adaptive-agent's config is copied unchanged; if M1 chooses scratch-in-repo exploit regressions, add the option then (control-tower `vitest.config.ts` comment explains why).
5. `typescript/unstable/{ast,sync}` — the AST API control-tower's containment test imports — ships with `typescript@7.0.2`; copy the **technique** from `import-containment.test.ts`, not its `HumanId`-specific scans.
* **No new dependencies.** Property tests use a hand-rolled seeded `mulberry32` (adaptive-agent's evidence tests do).

**Operational notes for the coordinator (from standing memory, not from siblings):** repos live under `vladimir-mawla` (sibling READMEs clone from `github.com/vladimir-mawla/<repo>`); the active `gh` account flips to `vldmr-mawla` and 403s the push — run `gh auth status` before every push; M2 deploys from a clean committed tree; do not git-operate on an occupied worktree while a subagent works in it.

---

## 13. Infrastructure to copy vs. the core to invent

**Copy (shared, not conceptual):** `next.config.ts`, both `tsconfig*.json`, `vitest.config.ts`, `eslint.config.mjs`, `vercel.json`, the `package.json` scripts; `scripts/*.mjs` loader; the deploy-at-M2 discipline and a health endpoint that runs a *real* check and returns 503 on failure with the commit SHA;
the closed-module-graph test technique; the `tests/failures/**` discipline (header states PROVES vs DISCLOSES, what would make it fail); sabotage-and-restore falsifiability logs; the README / ARCHITECTURE / THESIS /
WALKTHROUGH / NOTES shape with an unsoftened **Honest limits** section; the `app/milestones.ts` drift guard (decision-engine); the `compute-demo-view` pure-bridge + `renderToStaticMarkup` pattern (control-tower); CI; the ADR template;
`@ts-expect-error` proofs; hostile-input typed failures; seeded PRNG property tests with proven-reachable generators.

**Invent, never share:** `Grant`, `Commitment`, `Charter`, `Warrant`, `Breach`, **`Standing`**, `Rejection`, `FoldFault`, the conservation law and absorbed-spend accounting, the heir rule, the log-only fold, prospective-only
revocation, the company domain and its policies. Reusing `Corroboration`, `distinctContexts`, an `Intervention` ladder, an `Invariant` registry, `BeliefAnswer`, `Outcome` or `Reconciliation` here, even in spirit, would be the
failure the brief names: eight repos wearing one mechanic in eight hats.

---

## 14. Thesis seed (M9 expands to ≤ 300 words)

*Two years out: the dispute is retroactivity.* Delegation tokens and revocation lists are converging on attenuation and expiry, and the industry will treat "revoked" as a property of a *credential*. The first widely discussed
multi-agent incident will instead turn on a property of an *act*: was it authorised when it was made, and who answers now that the chain behind it is gone? **The claim, stated so it can be wrong:** within two years a public
post-mortem or standards discussion will hinge on whether a revoked delegation voided what the agent had already done, and the workable answer will be prospective revocation with accountability re-homed to a named live principal —
what this ledger calls `inherited` — not retroactive voiding. **What would falsify it:** a delegation standard ships first-class, queryable commitment standing; or agent actions stay so small and reversible that authority bounds never bind
(then reversibility, not authority, is the lever — decision-engine's thesis). **What it does not claim:** it cannot detect misuse inside a mandate (case 01); it bounds the damage. Detection is control-tower's job; authentication is trust-layer's;
this ledger decides what the act binds.

## 15. Loom outline (≈ 90 s; M9 writes the script and measures it)

0–8 s claim ("who answers for what was done; every number is a real engine call") · 8–28 s the org tree, six commitments `binding`, three named rejections (widen · over-delegate · borrow) · 28–55 s **Revoke Ops-Lead**: three grants go dark,
c1/c2/c4 flip `binding → inherited`, heir `cfo`, "absorbed 220 000 / returned 180 000", conservation meter unmoved · 55–72 s buyer-a's next act is `void: link-dead`; cfo's cure is a *new* grant, a new binding commit · 72–86 s drag the scrubber to seq 10 —
they are `binding` again: revocation never rewrote the past · 86–90 s close.

## 16. Handoff to G3 (the scaffold agent)

1. Create the repo (`autonomous-company-simulator`, public). Do **not** start M1.
2. Copy the files of §12 from `adaptive-agent` `origin/main` (`7b7ef2d`) — via `git show`/`git archive origin/main`, **not** a working tree — and apply deviations 1–5 of §12.
3. Prove the scaffold from a clean clone before anything else: `git clone … && npm ci && npm run typecheck && npm test && npm run build` (the smoke test pins `--webpack` and the `extensionAlias`).
4. Write `.genesis/PLAN.md` = this file; `.genesis/DONE.html` = the milestone table of §6 (every status `todo`) plus the locked spec below; `.genesis/checkpoints/CURRENT.md` = honest "genesis only, no engine code."
5. **Locked spec seed (DONE.html §1).** *Cognitive job:* given an append-only log of grants, revocations and commitments, decide for every commitment whether it **binds** the organisation, and who answers for it — against the record as it stood when the act was made.
   *Inputs → outputs:* typed events → a closed `Standing` (`binding · inherited · void`), always with its `Warrant` or its `Breach`, or a typed `Rejection`/`FoldFault`; never a boolean, never a score.
   *Autonomy:* fully autonomous end to end — admission, verdict and standing involve no human; humans appear only as **roots** of authority (the charter). *Failure tolerance:* fail toward the weaker standing — an unprovable act is `void`, an unreadable log is a `FoldFault`; a revocation never voids a validly-made commitment and never returns spent authority.
6. **DoD gates for DONE.html §2** (binary, checked by the verifier, never the builder): dependency direction `contracts → chain → allowance → standing → domains/company`, zero cycles; `typecheck` clean and `test` green; independent L4 pass per milestone; no earlier freeze boundary touched; a `void` standing carrying a `warrant` (or an `inherited` without a heir) does not compile; conservation holds at every prefix of every generated log; a commit's verdict never depends on a later event (prefix-determinism); `void` is absorbing (lattice); the live demo and `npm run demo:company` produce the same standings (diffed by the verifier); clean clone + `npm ci` + typecheck + test passes with no credentials.

## Appendix A — verification artifacts (scratch; not for the repo)

`…/scratchpad/trace/plan-types.ts` (type trace, passes `tsc 7.0.2`), `…/trace/model-check4.mjs` and `canon.mjs` (throwaway semantic model and the §7 scenario), `…/trace/sab/` and `v*.mjs w*.mjs s*.mjs` (mutants),
`…/scratchpad/main/<repo>/` (the six `origin/main` snapshots read). Reproduce: `~/Desktop/adaptive-agent/node_modules/.bin/tsc -p tsconfig.json` in `trace/`; `node trace/canon.mjs`; `node trace/model-check4.mjs`.
