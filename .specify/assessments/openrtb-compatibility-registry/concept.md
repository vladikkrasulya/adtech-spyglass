# Concept: OpenRTB Compatibility Registry

**Slug**: openrtb-compatibility-registry · **Date**: 2026-08-21
**Prior**: [problem.md](./problem.md)

The first draft of this concept was corrected at the gate. It claimed shadow counting would measure
_importance_; it measures _prevalence_, and a frequent cosmetic rewrite is worth less than a rare
destructive drop. It also proposed scoring each payload against all profiles, which would have
measured hypothetical compatibility rather than the relevance of the route actually taken. Both are
corrected below rather than quietly rewritten.

## Options

### Option A — Shadow traffic-relevance measurement

Count, per stream record, which rules were evaluable and which actually fired — **scored only against
the partner on the record's real route**, never against all 385 profiles. No interface, no user-facing
output.

Aggregates only: `eligible`, `actionable`, `error`, `shadow_winner` (what the selector would have
surfaced), plus ruleset and adapter versions. **No payload, field values, identifiers, domains, or
request hashes.** Constitution III forbids the first; hashes are excluded because they re-identify.

Ends not on a calendar but when top-K is stable across two consecutive windows, denominators are
sufficient, and runtime overhead stays inside budget.

### Option B — Verification, in two lines that measure different things

**B1 — behavioural fidelity of known rules.** 20–50 prioritised rules, each with a purpose-built
witness input, an expected output or error, a negative control, and the adapter SHA recorded. This
measures **precision**: whether a rule we hold is true.

**B2 — blind re-read for missed rules.** An independent reader works a stratified sample of whole
adapters without sight of the corpus; the result is then diffed against it. This is the only line
that produces evidence about **recall**, because B1 structurally cannot find a rule that is not in
the corpus to begin with.

Neither is a mass pass over the remaining 849, and neither is free; the earlier description of
verification as "free" was wrong.

If B2 does not fit the appetite, dropping it is an honest choice — but then recall stays unmeasured,
and **a stable top-K no longer opens Option C on its own**: C would need a separate recall gate
first.

### Option C — Minimal surfaced finding

One most-critical statement per record plus an explicit "**and N more**", so that ranking never hides
a second serious problem. Depends on A having produced a stable ranking; building it first would
encode a guess.

### Option D — Park

Keep the corpus as research. Costs nothing further, delivers nothing.

## Evidence for the recommendation

Coverage is settled (190 partners, 553 rules on an ordinary request). Correctness is not: 140 rules
reviewed yielded 13 corrections, 1 deletion, 16 omissions. Selection is unsolved.

What each option actually measures, stated precisely because an earlier draft of this section blurred
it — it claimed A and B together attack rank quality and recall, and they do not:

| Line | Measures                                          | Does **not** measure                               |
| ---- | ------------------------------------------------- | -------------------------------------------------- |
| A    | route relevance and prevalence on real traffic    | whether a rule is true; how bad its consequence is |
| B1   | precision — behavioural fidelity of rules we hold | rules absent from the corpus                       |
| B2   | recall — rules the extraction never produced      | anything about traffic                             |

A supplies two of the five priority inputs. Nothing here supplies consequence severity or user
actionability; those must be authored, not measured.

Recommended sequence: **A, B1 and B2 in parallel → run the selector in shadow → only then C.**

## Consequence adopted as a constraint

- **Priority is composite, never frequency alone**: rule provenance strength; severity of consequence;
  whether the user can act on it; relevance to the real partner route; frequency on traffic. A supplies
  the last two only.
- **Message form is attributable**: "the Prebid adapter for X at commit Y rewrites `tagid`", not
  "Xandr rewrites `tagid`". The stand confirms an adapter version, not an exchange.
- **Never an auction participant.** No live partner endpoints; the stand runs against a local mock.
- Dialect statements are additive to IAB findings and may not reorder or suppress them.

## What would overturn this

- Top-K never stabilises across windows — then ranking is not learnable from traffic, and C needs a
  different basis or should not be built.
- Shadow overhead exceeds budget on real stream volume — then measurement must move offline.
- Targeted verification finds a correction rate materially worse than the 140-rule sample — then the
  corpus needs re-derivation before any of it is surfaced.
- A partner grants written permission for its documentation, changing what the registry may cite.
