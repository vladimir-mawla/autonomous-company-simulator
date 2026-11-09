# Thesis: in two years the dispute is retroactivity

Delegation tokens and revocation lists are converging on attenuation and expiry. Today "revoked" is a property of a credential; my bet is that it becomes a property of an act.

**The claim, stated so it can be wrong.** Within two years, the first widely discussed multi-agent incident will hinge on one question: did revoking an agent's delegation void what it had already done? The workable answer will be prospective revocation. What the agent did while authorised stands, and someone named and still authorised answers. This repository calls that standing `inherited`; its heir is the grantor of the first revoked link. The rejected alternative, voiding everything a revoked agent did, gives every counterparty a reason to doubt any deal with an agent that might later be cut.

**Why believe it.** Agents will deal with outsiders, who need an answer to "who is on the hook" that does not change later. Accountability that climbs the delegation chain gives one. Authority that is conserved, so a child's limit is reserved out of its parent's headroom, gives a ceiling on loss that does not depend on noticing misuse.

**What would falsify it.** A delegation standard ships first-class, queryable commitment standing before this converges. Or agent actions stay small and reversible enough that authority bounds never bind, and reversibility becomes the lever instead.

**What this repository shows.** A working model of one rule set, its limits pinned by a failure suite. It does not show the model is right about the world. It rules a compromised agent's in-mandate acts the same as a diligent agent's (case 01 in `tests/failures`): it bounds the damage and does not detect it. Detection and authentication belong to other systems; this ledger rules only on what an act binds.
