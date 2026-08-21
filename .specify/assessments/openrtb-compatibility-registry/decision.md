# Decision: OpenRTB Compatibility Registry

- **Slug**: openrtb-compatibility-registry
- **Decided**: 2026-08-21
- **Verdict**: go — scoped to shadow measurement and targeted verification only
- **Artifacts reviewed**: intake.md · research.md · problem.md · concept.md

## Scorecard

| Criterion              | Rating       | Justification                                                                                                                                                                                                                                      |
| ---------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem validity       | **strong**   | Observed, not argued: one request through a local exchange produced four materially different outgoing requests, including a silently overwritten `imp.tagid`. The sender's own validator calls all four inputs valid.                             |
| Evidence strength      | **adequate** | 1188 rules across 232 adapters, each with a `file.go:LINE` citation; 1186 resolve at a pinned commit; 336 confirmed by a second reader; four confirmed at runtime. Held back from `strong` by unknown recall — see Risk posture.                   |
| Value vs. inaction     | **strong**   | Inaction keeps the product reporting success on payloads that arrive altered. The gap is currently invisible and is exactly what integration debugging costs days on.                                                                              |
| Feasibility / appetite | **adequate** | Option A adds counters to an existing endpoint; Option B is bounded to 20–50 rules. No new service, no new dependency, no auction participation. Held back because the selection problem the feature ultimately depends on is genuinely unsolved.  |
| Strategic fit          | **strong**   | Additive to the IAB baseline as Constitution IV and ADR-003 require, and squarely the project's stated direction — depth on one transaction, raw bytes as truth.                                                                                   |
| Risk posture           | **adequate** | Licence risk is closed by sourcing from Apache-2.0 adapters with the prohibited set quarantined; privacy by an aggregate-only schema; over-claiming by fixing the message form to the adapter and commit. Recall risk is real and only partly met. |

## Verdict & Rationale

**Go**, but only for shadow traffic-relevance measurement (A) and verification (B), and B is two
lines because they measure different things. Coverage is settled and is not the problem — 190
partners have an applicable rule on an ordinary request.

An earlier draft of this rationale claimed A and B attack rank quality and recall. They do not, and
the correction matters more than the wording:

| Line                                                                 | Measures                       | Does **not** measure                                  |
| -------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------- |
| A                                                                    | route relevance and prevalence | whether a rule is true, or how bad its consequence is |
| B1 — witness inputs, negative controls, pinned SHAs                  | precision on rules we hold     | rules absent from the corpus                          |
| B2 — blind re-read of whole adapters, then diffed against the corpus | recall                         | anything about traffic                                |

**B1 cannot measure recall**, because it can only test rules that already exist. Only B2 can, and
if B2 falls outside appetite, that is an honest choice with a consequence: recall stays unmeasured,
and a stable top-K no longer opens Option C by itself — C would need its own recall gate.

Rank quality remains **unaddressed by measurement**. A supplies two of the five priority inputs;
consequence severity and user actionability have to be authored.

The surfaced finding (concept Option C) is **explicitly out of this go**. Building it now would
encode a guess about ranking that A exists to replace. It returns for its own decision once top-K is
stable.

Two claims from the first draft of this assessment were withdrawn at the gate rather than softened:
that shadow counting measures _importance_ (it measures prevalence), and that mass verification of
the remaining 849 rules is free (it is not, which is why B is a prioritised sample). Both corrections
came from review, and the record says so.

The `adequate` on evidence strength is not a formality. 140 rules reviewed produced 13 substantive
corrections, one deletion, and 16 rules the first pass never saw. Precision is defensible; **recall
is unmeasured**, and that is the single most likely way this feature would mislead someone — not by
stating something false, but by staying silent about a partner that would in fact break the payload.

## If go — Handoff to `/speckit-specify`

- **Problem**: a payload valid per IAB reaches a partner materially altered, and nothing says so.
- **Chosen approach**: one package covering shadow traffic-relevance measurement on the stream path
  (A), witness-based precision verification of 20–50 prioritised rules (B1), and a blind stratified
  re-read of whole adapters diffed against the corpus (B2). No user-facing output in this scope.
- **In scope**: aggregate counters (`eligible`, `actionable`, `error`, `shadow_winner`) scored only
  against the partner on the record's real route; ruleset and adapter versions recorded; the selector
  run in shadow; witness-input verification with negative controls and pinned adapter SHAs.
- **Out of scope**: any surfaced finding or interface; scoring a payload against all profiles;
  becoming an auction participant; any use of the quarantined documentation set.
- **Success metrics**: top-K stable across two consecutive windows; sufficient denominators; runtime
  overhead inside budget. Downstream, the measure of the feature is that a user fixes a payload and
  the statement disappears on re-check — never clicks.
- **Carried-forward open questions**:
  - What composite priority function ranks a rule? Provenance strength, consequence severity, user
    actionability and route relevance are required alongside frequency; their weighting is unknown.
  - What is the true recall of the extraction? B2 is scoped to answer this; if it is dropped, C
    requires a separate recall gate and a stable top-K is not sufficient to open it.
  - How is the partner route on a stream record determined, and what happens when it is absent?
  - Does the divergence between a Prebid adapter and the partner's own exchange matter enough to
    measure where licensed documentation exists to compare against (Google, Xandr)?
