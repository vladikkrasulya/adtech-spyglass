# Feature Specification: OpenRTB Shadow Verification

**Feature Branch**: `feat/openrtb-shadow-verification`

**Created**: 2026-08-21

**Status**: Draft

**Input**: Handoff from [assessment decision](../../.specify/assessments/openrtb-compatibility-registry/decision.md)
(verdict: go, scoped to measurement and verification only).

> **Scope note**: This package produces **no user-visible output at all**. It exists to answer three
> questions the surfaced feature depends on — which dialect statements are relevant on real traffic,
> whether the statements we hold are true, and how many we never found. Building the surfaced finding
> before those answers exist would encode a guess.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The maintainer learns which statements matter (Priority: P1)

As the maintainer, I can see which dialect rules actually fire on real traffic, scored only against
the partner each record was really routed to, so that a later ranking is built on measurement rather
than on assumption.

**Why this priority**: Nothing downstream can be designed without it. 190 partners have an applicable
rule on an ordinary request; without evidence of which matter, any selection is a guess.

**Independent Test**: Feed recorded stream traffic through the shadow path and read the aggregates;
no interface, no user-visible change, and the counters alone answer the question.

**Acceptance Scenarios**:

1. **Given** a stream record whose partner route resolves, **When** the shadow path evaluates it,
   **Then** only that partner's rules are scored and the counters advance for that partner alone.
2. **Given** a stream record whose route cannot be resolved or is ambiguous, **When** the shadow path
   sees it, **Then** the record is counted as unresolved and **skipped**, and no rule is scored.
3. **Given** any record at all, **When** it is processed, **Then** the stored aggregates contain no
   payload body, field value, identifier, domain, or request hash.
4. **Given** two consecutive measurement windows, **When** both close, **Then** the top-K ranking of
   each can be compared and its stability computed.

---

### User Story 2 - The maintainer learns whether the statements are true (Priority: P1)

As the maintainer, I can see the measured precision of the dialect corpus, so that no statement is
ever surfaced on the strength of a single unreviewed reading.

**Why this priority**: A false statement about a partner is worse than silence — it sends someone to
change a payload that was already correct.

**Independent Test**: Run the witness suite against a pinned adapter revision and read the pass,
fail and negative-control results per rule.

**Acceptance Scenarios**:

1. **Given** a prioritised rule, **When** its witness input is processed by the pinned adapter,
   **Then** the observed output or error matches the rule's claim, or the rule is marked failing.
2. **Given** the same rule, **When** its negative control is processed, **Then** the claimed
   behaviour does **not** occur, proving the witness tests the rule and not the harness.
3. **Given** a rule whose adapter revision has moved, **When** the suite runs, **Then** the result is
   reported against the recorded revision and the drift is visible.

---

### User Story 3 - The maintainer learns how much was missed (Priority: P2)

As the maintainer, I can see an estimate of how many dialect rules the extraction never produced, so
that the corpus's silence can be interpreted rather than trusted.

**Why this priority**: The likeliest way this work misleads is not a false statement but a missing
one — staying quiet about a partner that would in fact break the payload. Precision is estimable
today; recall is not estimated at all.

**Independent Test**: An independent reader works a stratified sample of whole adapters without sight
of the corpus; the result is diffed against it and the miss rate reported.

**Acceptance Scenarios**:

1. **Given** a sampled adapter, **When** the independent reading is produced, **Then** it is created
   without access to the existing corpus entry for that adapter.
2. **Given** both readings, **When** they are diffed, **Then** rules present only in the independent
   reading are reported as misses with their evidence.
3. **Given** the sample is complete, **When** the miss rate is computed, **Then** it is reported with
   its sample size and stratification, not as a bare percentage.

### Edge Cases

- A record names several partners; each resolved partner is scored separately and never merged.
- A rule cannot be evaluated on a record because its condition is unreachable — this is `eligible`
  failing, not `actionable` failing, and the two must not collapse.
- The corpus is replaced mid-window; counters from different ruleset versions must not be summed.
- Traffic volume is too low for a window to reach its denominator; the window is reported as
  inconclusive rather than ranked.
- The measurement itself exceeds its overhead budget; it must degrade by sampling, never by silently
  dropping records without counting them.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The shadow path MUST evaluate dialect rules **only** against the partner on the
  record's real route, and MUST NOT score a record against the full profile set.
- **FR-002**: An unresolved or ambiguous route MUST cause the record to be skipped and counted; the
  route MUST NOT be inferred or guessed.
- **FR-003**: The system MUST record `records_seen`, `route_resolved` and
  `route_unresolved_ambiguous`, so that selection bias in the measured population is visible.
- **FR-004**: The system MUST record, per rule, `eligible` (the rule could be correctly evaluated),
  `actionable` (a real change or violation occurred) and `error`.
- **FR-005**: The system MUST record `shadow_winner` — the statement the selector would have
  surfaced — alongside `selector_version`.
- **FR-006**: The system MUST record `ruleset_version` and `adapter_version` with every aggregate.
- **FR-007**: The system MUST NOT persist payload bodies, field values, identifiers, domains, or
  request hashes. Hashes are excluded because they re-identify.
- **FR-008**: The measurement MUST end on stated numeric criteria — top-K stability across two
  consecutive windows, a minimum denominator, and an overhead and error budget — and not on elapsed
  time.
- **FR-009**: The witness suite MUST cover 20–50 prioritised rules, each with an expected output or
  error, a negative control, and a pinned adapter revision.
- **FR-010**: The blind re-read MUST be produced without sight of the corpus and MUST report misses
  with evidence, sample size and stratification.
- **FR-011**: Every recorded statement MUST be attributable to a named adapter at a named commit; a
  statement phrased at exchange or partner level is a defect.
- **FR-012**: The existing IAB validation path MUST be unchanged in behaviour, output and ordering.
- **FR-013**: The quarantined documentation set MUST NOT be read, referenced, or derived from.

### Key Entities

- **Dialect rule** — a field, a disposition, a claim, a citation to a source line, a verification
  status, and the ruleset version that contains it.
- **Shadow observation** — a per-window, per-partner, per-rule tuple of counters. Carries versions;
  carries nothing about the payload that produced it.
- **Witness case** — a prioritised rule, a crafted input, an expected result, a negative control, and
  the adapter revision the expectation was recorded against.
- **Blind reading** — an independent extraction over one sampled adapter, produced without the
  corpus, retained for diffing.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Every record processed is accounted for as resolved or unresolved; the two counts plus
  skips equal `records_seen` exactly, with no unexplained remainder.
- **SC-002**: Across two consecutive closed windows, the top-K statements agree on at least 80% of
  their membership, or the ranking is declared unstable and reported as such.
- **SC-003**: A window is ranked only when every counted rule has at least 100 eligible observations;
  below that the window is reported inconclusive.
- **SC-004**: Shadow measurement adds no more than 5% to the processing time of a stream record at
  the 95th percentile, and its own error rate stays below 0.5% of records processed.
- **SC-005**: At least 20 and no more than 50 rules carry a passing witness case with a passing
  negative control, each against a recorded adapter revision.
- **SC-006**: The blind re-read covers a stratified sample of at least 15 adapters and yields a miss
  rate reported with its sample size, stratification and confidence.
- **SC-007**: Zero payload bodies, field values, identifiers, domains or request hashes appear in any
  stored aggregate, verified by an automated check over the stored records.
- **SC-008**: No user-visible output changes; the existing IAB findings for a corpus of payloads are
  byte-identical before and after.

## Assumptions

- The stream record carries, or can be joined to, the partner it was routed to. Where it cannot, the
  record is unresolved by definition, and FR-002 governs.
- The dialect corpus is the Apache-2.0 prebid-server extraction at commit
  `0ba352315253f6692af6497d553cfb12909a1b8b`: 1188 rules from **270 adapters read**, of which **232
  produced at least one rule** and 38 returned none; 336 confirmed by a second reader; four confirmed
  at runtime, three of which had been unverified.
- Consequence severity and user actionability — two of the five priority inputs — are authored
  judgements, not measurements, and are out of scope here. This package supplies route relevance and
  prevalence only.
- If the blind re-read is dropped from scope, recall stays unmeasured and a stable top-K does **not**
  by itself open the surfaced finding; a separate recall gate would be required first.

## Out of Scope

- Any surfaced finding, interface, badge, column, alert or notification.
- Scoring a payload against all profiles.
- Becoming a participant in any auction; contacting partner endpoints; holding partner credentials.
- Any use of the quarantined documentation set.
- Any statement phrased at exchange or partner level rather than adapter-and-commit level.
- Changes to IAB validation behaviour, output or ordering.
