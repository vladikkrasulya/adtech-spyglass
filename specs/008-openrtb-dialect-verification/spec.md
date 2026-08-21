# Feature Specification: OpenRTB Dialect Verification

**Feature Branch**: `feat/openrtb-shadow-verification`

> Renamed from `008-openrtb-shadow-verification` at clarification: "shadow" named the one line this
> package no longer contains.

**Created**: 2026-08-21

**Status**: Draft

**Input**: Handoff from [assessment decision](../../.specify/assessments/openrtb-compatibility-registry/decision.md)
(verdict: go). Narrowed at clarification on 2026-08-21: the shadow-measurement line was removed
after review established that no route-bearing record source exists.

> **Scope note**: This package produces **no user-visible output at all**. It answers the two
> questions that can be answered today — whether the dialect statements we hold are true, and how
> many we never found.
>
> A third line, shadow measurement of route relevance on live traffic, was specified here and then
> **removed at clarification**. See [Deferred: route relevance](#deferred-route-relevance).

## Clarifications

### Session 2026-08-21

- Q: What authoritative route-bearing record source should 008 use? → A: None exists; park route-relevance measurement and keep 008 scoped to B1/B2 verification.
- Q: Must 008 produce statistically generalisable corpus-wide precision/recall estimates, or verify
  pre-registered bounded samples? → A: **Bounded audit.** Both lines verify frozen, pre-registered
  samples; every case resolves to pass, fail or inconclusive; omissions are adjudicated observations.
  No corpus-wide precision or recall claim is permitted from these samples: B1's sample is
  deliberately purposive (most destructive, most frequent), which no reweighting turns into an
  unbiased estimator, and B2's single blind reader is a second opinion whose own recall is unknown,
  not a reference standard.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The maintainer learns whether the statements are true (Priority: P1)

As the maintainer, I can see pass/fail/inconclusive outcomes for a frozen, pre-registered sample of
the most consequential rules, so that no statement from that sample is ever surfaced on the strength
of a single unreviewed reading.

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

### User Story 2 - The maintainer learns what a blind reading finds that the corpus lacks (Priority: P1)

As the maintainer, I can see the adjudicated omissions that an independent blind reading surfaces on
a frozen sample of adapters, so that the corpus's silence on those adapters is checked rather than
trusted — while knowing this audits the sample, not the corpus.

**Why this priority**: The likeliest way this work misleads is not a false statement but a missing
one — staying quiet about a partner that would in fact break the payload. A bounded audit cannot
price that risk corpus-wide, but it can catch it where it looks, and every adjudicated omission is a
real defect fixed. It shares P1 with precision because a surfaced finding is gated on both.

**Independent Test**: An independent reader works a frozen stratified sample of whole adapters
without sight of the corpus; the diff is adjudicated and confirmed omissions are reported as counts
against the named sample.

**Acceptance Scenarios**:

1. **Given** a sampled adapter, **When** the independent reading is produced, **Then** it is created
   without access to the existing corpus entry for that adapter.
2. **Given** both readings, **When** they are diffed, **Then** rules present only in the independent
   reading are reported as misses with their evidence.
3. **Given** the sample is complete, **When** results are reported, **Then** omissions are reported
   as adjudicated counts against the named sample — never extrapolated to the corpus.

### Edge Cases

- A witness input exercises a rule that a sibling adapter also implements; the case must fail if run
  against the sibling, or it is testing the harness rather than the rule.
- The adapter revision has moved since the rule was recorded; the result is reported against the
  recorded revision and the drift is named, never silently re-baselined.
- The blind reader and the corpus disagree on a rule's disposition rather than its existence; that is
  a precision finding surfacing inside a recall exercise and must be routed to B1, not counted as a
  miss.
- A sampled adapter yields no rules in either reading; this confirms a thin passthrough rather than
  indicating a failed sample.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The witness suite MUST cover 20–50 prioritised rules, each with an expected output or
  error, a negative control, and a pinned adapter revision.
- **FR-002**: The blind re-read MUST be produced without sight of the corpus and MUST report misses
  with evidence, sample size and stratification.
- **FR-006**: Both samples MUST be frozen and recorded before any case is executed; a sample changed
  after first execution invalidates the run.
- **FR-007**: Every executed case MUST resolve to exactly one of pass, fail or inconclusive;
  inconclusive is a recorded outcome, not an excuse to re-run until green.
- **FR-008**: Each candidate omission from the blind re-read MUST be adjudicated against the adapter
  source before being counted; disagreements of disposition route to B1 as precision findings.
- **FR-009**: No produced artifact may state or imply a corpus-wide precision or recall figure;
  results are statements about the frozen samples only.
- **FR-003**: Every recorded statement MUST be attributable to a named adapter at a named commit; a
  statement phrased at exchange or partner level is a defect.
- **FR-004**: The existing IAB validation path MUST be unchanged in behaviour, output and ordering.
- **FR-005**: The quarantined documentation set MUST NOT be read, referenced, or derived from.

### Key Entities

- **Dialect rule** — a field, a disposition, a claim, a citation to a source line, a verification
  status, and the ruleset version that contains it.
- **Witness case** — a prioritised rule, a crafted input, an expected result, a negative control, and
  the adapter revision the expectation was recorded against.
- **Blind reading** — an independent extraction over one sampled adapter, produced without the
  corpus, retained for diffing.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: At least 20 and no more than 50 rules carry a passing witness case with a passing
  negative control, each recorded against a named adapter revision.
- **SC-002**: Every witness case fails when run against a deliberately mismatched adapter, proving
  the case tests the rule rather than the harness.
- **SC-003**: The blind re-read covers a stratified sample of at least 15 adapters, drawn across the
  size and disposition strata of the corpus rather than from its head.
- **SC-004**: Every omission report names the frozen sample, the adjudication outcome of each
  candidate, and the count of confirmed omissions; it contains no extrapolated rate.
- **SC-005**: Every rule whose witness case fails is marked in the corpus within the same change that
  discovered it; a failing rule never remains indistinguishable from a passing one.
- **SC-006**: No user-visible output changes; existing IAB findings for a corpus of payloads are
  byte-identical before and after.
- **SC-007**: The quarantined documentation set is not read at any point, verified by the absence of
  any citation to it in the produced artifacts.

## Assumptions

- The dialect corpus is the Apache-2.0 prebid-server extraction at commit
  `0ba352315253f6692af6497d553cfb12909a1b8b`: 1188 rules from **270 adapters read**, of which **232
  produced at least one rule** and 38 returned none; 336 confirmed by a second reader; four confirmed
  at runtime, three of which had been unverified.
- Consequence severity, user actionability, route relevance and traffic prevalence are outside this
  package. It produces verification evidence about the extracted corpus, not a priority ranking.
- Corpus-wide recall remains unmeasured **by design** under the bounded audit; the blind re-read
  produces adjudicated omissions on its sample, which is evidence of defect presence, not a recall
  estimate. Opening any surfaced finding still requires a separate recall decision.
- Route relevance is **not** measured by this package; see below.

## Deferred: route relevance

A third line was specified here — shadow measurement of which dialect statements matter on real
traffic — and removed before planning. It assumed a source of records whose partner route is
authoritatively known as adapter/profile, direction and revision. **No such source exists.**

| Candidate              | Why it does not serve                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/stream`   | A synthetic generator. `modules/stream/handler.js` emits one synthetic specimen per cadence tick; the baseline contract calls it "cached synthetic permalinks". Measuring it would measure our own generator. |
| `POST /api/analyze`    | Accepts a `dialect`, but that is this product's own overlay — no partner, no direction, no adapter revision.                                                                                                  |
| Account partner labels | Free-text labels a user attaches to saved samples. Self-declared, unmapped to any adapter, and drawn from a self-selected population.                                                                         |

Running the measurement against any of these would have produced numbers that look like evidence of
relevance while measuring something else. That is precisely the failure this project has spent its
effort removing elsewhere, so the line is parked rather than approximated.

**What partly substitutes today**: an offline pass over 3103 canonical adapter fixtures found that
**65% of rules manifest** on inputs the adapters themselves ship. That is real evidence about the
corpus; it is not evidence about anyone's traffic, and it is not a ranking.

**What would unpark it**: a record-bearing source whose route is authoritative rather than declared.
If instead the caller declares an intended profile, the line returns under an honest name —
_declared-route relevance_ — and needs its own decision, because a declared route measures what users
believe, not where a payload went.

## Out of Scope

- Any surfaced finding, interface, badge, column, alert or notification.
- Any measurement of traffic relevance, on synthetic or declared routes alike — see Deferred above.
- Becoming a participant in any auction; contacting partner endpoints; holding partner credentials.
- Any use of the quarantined documentation set.
- Any statement phrased at exchange or partner level rather than adapter-and-commit level.
- Changes to IAB validation behaviour, output or ordering.
