# Feature Specification: OpenRTB Dialect Verification

**Feature Branch**: `feat/openrtb-shadow-verification`

> Renamed from `008-openrtb-shadow-verification` at clarification: "shadow" named the one line this
> package no longer contains.

**Created**: 2026-08-21

**Status**: Verification

**Input**: Handoff from [assessment decision](../../.specify/assessments/openrtb-compatibility-registry/decision.md)
(verdict: go). Narrowed at clarification on 2026-08-21: the shadow-measurement line was removed
after review established that no route-bearing record source exists.

> **Scope note**: This package produces **no user-visible output at all**. It records outcomes for a
> frozen purposive sample of dialect statements and adjudicated omissions found by a blind reader in
> a separate frozen adapter sample. Neither result is extrapolated beyond its named sample.
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
- Q: FR-006 freezes the samples. When execution reveals that a frozen input is broken — an adapter
  that never ran, a contrast that compares a generated UUID — may it be repaired? → A: **Yes, before
  the first canonical result is reported, and only with the whole history retained.** The _manifest_
  generation freezes sample membership and never changes. The _execution bundle_ — cases, controls,
  runner, endpoint map, lab config — may be repaired and re-frozen while no canonical result stands
  on it, provided every superseded attempt keeps its outcomes, its journal, its bundle bytes and a
  written reason. A repair that changes membership, an assertion or an expected value is out of
  scope for this clause; it invalidates the sample, not just the run.

- Q: How does B1 prove a witness fired because of the rule's stated condition rather than harness
  accident? → A: **Same-adapter minimal pair plus a positive execution control.** Each case pairs a
  triggering input with a minimally changed contrast on the _same_ pinned adapter, and a separate
  control proves the harness executed that adapter at all. For conditional behaviour the contrast is
  a non-triggering input. For an unconditional projection/drop/rewrite, it adds or removes one
  source-valid standard field and proves that the two outbound observations collapse to the same
  value because that field cannot survive. If neither contrast is honest and executable, the case is
  pre-registered as `inconclusive-oracle`. A mismatched-adapter check is not a valid oracle — two
  adapters may legitimately share behaviour — and is optional colour only.

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
2. **Given** the same rule and the same pinned adapter, **When** the minimal-pair input — differing
   by exactly the pre-registered causal field — is processed, **Then** either the conditional
   behaviour is absent or an unconditional projection produces the pre-registered collapsed output,
   isolating the claim rather than assuming behaviour is unique across adapters.
3. **Given** any adapter in the run, **When** the positive execution control is checked, **Then**
   there is direct evidence the pinned adapter executed; a vacuous pass is impossible to record as a
   pass.
4. **Given** a rule whose adapter revision has moved, **When** the suite runs, **Then** the result is
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
4. **Given** the readings are complete, **When** the corpus is first exposed for diffing, **Then**
   every reading has already been schema-checked, hashed and made immutable.

### Edge Cases

- A sibling adapter legitimately shares the tested behaviour; the case's validity rests on its
  same-adapter minimal pair, so shared behaviour across adapters neither passes nor fails anything.
- The adapter revision has moved since the rule was recorded; the result is reported against the
  recorded revision and the drift is named, never silently re-baselined.
- The blind reader and the corpus disagree on a rule's disposition rather than its existence; that is
  a precision finding surfacing inside an omission exercise. It enters a named follow-up queue and
  does not mutate the already-frozen B1 cohort.
- A sampled adapter yields no rules in either reading; the audit records that no omission was found
  for that adapter. It does not infer that the adapter is a passthrough.
- The lab leaves any route capable of egress or produces an outgoing URI outside the
  mock allowlist; the run aborts before a behavioral outcome is recorded.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The witness suite MUST cover 20–50 prioritised rules. Each case MUST comprise, against
  the same pinned adapter revision: a triggering input with its expected output or error, and a
  **minimal-pair** input with exactly the pre-registered causal delta. For conditional behaviour the
  delta MUST make the stated condition false and the claimed behaviour MUST not occur. For an
  unconditional projection/drop/rewrite, the delta MUST add or remove one source-valid field and the
  expected outbound observations MUST collapse, proving that field cannot survive the claimed
  transformation. A case without either honest executable contrast MUST be pre-registered as
  `inconclusive-oracle` and MUST NOT produce a pass.
- **FR-010**: Each run MUST include a positive execution control per adapter, proving the harness
  actually executed the pinned adapter; a minimal pair on an unexecuted adapter passes vacuously.
- **FR-011**: Cross-adapter comparison MAY be recorded as observational colour but MUST NOT gate a
  case: distinct adapters may legitimately share the same behaviour.
- **FR-002**: The blind re-read MUST be produced without sight of the corpus and MUST report misses
  with evidence, sample size and stratification. An enforced access boundary MUST expose only the
  copied adapter subtree, extraction taxonomy and that reader's output.
- **FR-006**: Both samples MUST be frozen and recorded before any case is executed. Before the first
  valid B1 run, its complete case bundle, runner, endpoint map, lab configuration and execution
  controls MUST also be hashed and frozen. A changed frozen input invalidates that run generation:
  every attempt standing on the superseded bytes MUST be retained with its outcomes, its journal, the
  bundle bytes it cited and a written reason, and MUST NOT be reported. Manifest membership is not
  repairable under this clause — changing it invalidates the sample itself.
- **FR-007**: Every executed case MUST resolve to exactly one of pass, fail or inconclusive;
  inconclusive is a recorded outcome, not an excuse to re-run until green.
- **FR-008**: Each candidate omission from the blind re-read MUST be adjudicated against the adapter
  source before being counted; disposition disagreements enter a named precision follow-up queue and
  remain open unless separately resolved.
- **FR-009**: No produced artifact may state or imply a corpus-wide precision or recall figure;
  results are statements about the frozen samples only.
- **FR-003**: Every recorded statement MUST be attributable to a named adapter at a named commit; a
  statement phrased at exchange or partner level is a defect.
- **FR-004**: The existing IAB validation path MUST be unchanged in behaviour, output and ordering.
- **FR-005**: The quarantined documentation set MUST NOT be read, referenced, or derived from.
- **FR-012**: All blind readings MUST be present, schema-valid, citation-allowlisted, indexed by hash
  and made immutable before the corpus is exposed for diffing or adjudication.
- **FR-013**: B1 MUST run with egress structurally denied. Every sampled adapter route and every
  accepted execution control MUST resolve to the pinned mock; a preflight or URI-allowlist failure
  aborts the run.
- **FR-014**: Aborted or invalidated attempts MUST be retained under immutable run identifiers with
  their reason. A canonical result MUST never overwrite an earlier attempt.

### Key Entities

- **Dialect rule** — a field, a disposition, a claim, a citation to a source line, a verification
  status, and the ruleset version that contains it.
- **Witness case** — a prioritised rule, a triggering input with its expected result, a same-adapter
  minimal-pair input, and the adapter revision both expectations were recorded against.
- **Blind reading** — an independent extraction over one sampled adapter, produced without the
  corpus, retained for diffing.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The frozen B1 sample contains 20–50 rules; **every** sampled case is executed and
  resolves to pass, fail or inconclusive, and the three counts are reported per adapter revision —
  where a single pinned image digest covers every adapter in the run, the run states that collapse
  explicitly rather than leaving an aggregate to be read as a per-revision figure. A target pass
  count is not a success criterion — a fail honestly recorded satisfies the audit.
- **SC-002**: Every pass is backed by its same-adapter minimal pair (conditional behaviour absent, or
  an unconditional transformation isolated by the pre-registered collapsed-output contrast) and by
  the adapter's positive execution control; a pass lacking either is reclassified inconclusive.
- **SC-003**: The blind re-read covers a stratified sample of at least 15 adapters, drawn across the
  size and disposition strata of the corpus rather than from its head.
- **SC-004**: Every omission report names the frozen sample, the adjudication outcome of each
  candidate, and the count of confirmed omissions; it contains no extrapolated rate.
- **SC-005**: Every rule whose witness case fails is marked in the corpus within the same change that
  discovered it; a failing rule never remains indistinguishable from a passing one.
- **SC-006**: No user-visible output changes; existing IAB findings for a corpus of payloads are
  byte-identical before and after.
- **SC-007**: The quarantined documentation set is not read at any point, verified by the enforced
  reader access boundary and by recursively validating every produced source citation against the
  pinned adapter-source allowlist.
- **SC-008**: The retained B1 run proves direct egress is denied, no lab port is published to the
  host, a one-shot client on the internal bridge can reach PBS and the mock, and every observed
  outgoing URI uses the mock host.
- **SC-009**: The tracked evidence summary names content hashes for the retained audit bundle and
  corpus before/after states, and the bundle is retrievable from the recorded local path.

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
