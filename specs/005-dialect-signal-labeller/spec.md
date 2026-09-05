# Feature Specification: Dialect Signal Labeller

**Feature Branch**: `main` (no feature branch; see Record Order below)

**Created**: 2026-08-20

**Status**: Complete

**Input**: Retroactive specification for work already in production. The feature answers one
question inside the Inspector: "this vendor `ext` signal is unknown to the engine — what does it
most likely mean?" It resolves the majority from a deterministic table and asks a local model only
about the remainder, returning a suggestion the operator may accept or ignore.

## Record Order _(read first)_

This package was written **after** the feature shipped, and says so rather than carrying a date
that implies otherwise. The same was true of
[004 Silent failure detection](../004-silent-failure-detection/spec.md), and the roadmap records
that case in the same terms.

What shipped before this specification existed:

| Commit    | Date       | What landed                                                                        |
| --------- | ---------- | ---------------------------------------------------------------------------------- |
| `cd609b3` | 2026-08-18 | The feature itself: endpoint, deterministic lexicon, model fallback, browser entry |
| `650f071` | 2026-08-20 | Repaired unreachable model wiring; privacy contract section; regression tests      |
| `5323537` | 2026-08-20 | Confidence calibration and its measurement bench                                   |
| `84cc6ea` | 2026-08-20 | Finding-card layout repair (adjacent surface, not this feature's logic)            |

`cd609b3` shipped with no feature package, no decision record, no privacy-contract update, and no
release note. It was also unreachable in production from the day it shipped until `650f071`: the
container resolved the model host to itself, so every request answered "unavailable" and the
feature looked implemented without ever having run for a user.

## Constitution and ADR Exceptions _(mandatory — Governance)_

The project constitution permits an exception only when the feature spec **names the violated rule,
documents evidence and a bounded alternative, and obtains explicit maintainer approval**. Named
here:

### Violated: ADR-003 — Deterministic Interactive Intelligence

[ADR-003](../decisions/ADR-003-deterministic-interactive-intel.md) (Accepted, 2026-07-22) states
that external model use "is not available to Inspector validation, interactive Intel, behavior
analysis, Core, or CLI paths," and lists "Keep local Ollama on interactive paths" among the
**rejected** alternatives — rejected because it couples product availability and latency to host
model infrastructure. This feature places a local model on an Inspector interactive path. That is
the rejected alternative, and the coupling ADR-003 predicted is exactly the failure that kept the
feature dead for two days.

ADR-003 also requires that any expansion of model scope carry a new specification, an ADR, a
documentation update, and regression tests. The documentation update and regression tests landed in
`650f071`; this specification and [ADR-012](../decisions/ADR-012-bounded-model-assist-on-dialect-labelling.md)
are the remaining two.

**Bounded alternative** — the exception is scoped, not general. The model is reachable only from
this one endpoint, only for signals the deterministic table abstains on, only for a signed-in
operator, only as a suggestion that is never persisted, and only from the host. Every other
interactive path named by ADR-003 remains deterministic, and the regression test that enforces that
still runs.

### Violated: Constitution Principle II — Truth Is Evidence-Backed

"When a canonical artifact conflicts with implementation evidence, work stops until the
contradiction is resolved or recorded as an explicit decision." On 2026-08-20 the conflict was
visible — a regression test blocked the repair — and work did not stop. The test was relaxed and
the change was deployed. The contradiction is being recorded now instead of then, and the delay is
part of this record.

### Constitution Principle I — Spec Kit Is the Working Memory

Not waived, simply unmet at the time: the feature had no active package. This package is the
remedy, not a retroactive claim that the rule was followed.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Name an unknown vendor signal without guessing alone (Priority: P1)

As an integration engineer reading a partner's bid request, I meet a vendor `ext` key the engine
does not recognise. Instead of leaving it unexplained or inventing a meaning, I ask for a proposal,
see what it is and where it came from, and decide whether to keep it.

**Why this priority**: it is the whole feature. An unknown signal is the point at which the
Inspector stops being able to help, and the operator either does the vendor archaeology by hand or
moves on and loses the finding.

**Independent Test**: analyse a payload carrying an unrecognised `ext` key, request a proposal, and
confirm a label, a confidence value, a stated reason, and a visible provenance badge come back, and
that nothing is stored until the operator saves it.

**Acceptance Scenarios**:

1. **Given** a signal whose value names a format and whose impression corroborates it, **When** a
   proposal is requested, **Then** the answer arrives from the deterministic table, is marked as
   coming from the table, and no model is consulted.
2. **Given** a signal the deterministic table abstains on, **When** a proposal is requested,
   **Then** the model answers, and the answer is marked as a model suggestion rather than a lookup.
3. **Given** any proposal, **When** it is shown, **Then** the operator can accept it, edit it, or
   dismiss it, and the dialect is unchanged until an explicit save.
4. **Given** a numeric vendor code with no corroborating context, **When** a proposal is requested,
   **Then** the answer is an explicit "cannot be established from this evidence" rather than a
   plausible format name.

---

### User Story 2 - Trust the number beside the answer (Priority: P1)

As the same engineer, I read the confidence value to decide whether to check the claim myself. It
has to mean something: high where the evidence names itself, low where there is no ground.

**Why this priority**: equal to Story 1, because a saved label is not a note. Once saved, a mapping
silently re-applies to every future payload the operator analyses. A confident wrong answer is
therefore more damaging than no answer, and confidence is the only thing standing between the two.

**Independent Test**: run a fixed set of signals spanning strong evidence, weak evidence, and no
evidence, and confirm confidence tracks the evidence rather than sitting at a constant.

**Acceptance Scenarios**:

1. **Given** a signal whose value names a format and whose impression agrees, **When** the model
   answers, **Then** confidence sits in the top band.
2. **Given** an empty, null, or unreadable value, **When** the model answers, **Then** confidence
   sits in the bottom band regardless of which label was chosen.
3. **Given** a generic key name that could plausibly mean several unrelated things, **When** the
   model answers, **Then** confidence does not exceed the middle of the scale.
4. **Given** any answer at all, **When** it is returned, **Then** confidence is never absolute
   certainty, because a vendor extension can always be misread.

---

### User Story 3 - Keep working when the model is not there (Priority: P2)

As the same engineer, when the local model is unavailable I am told so plainly and can still label
the signal by hand.

**Why this priority**: below the first two because it is a fallback, not the value — but it is the
scenario that actually occurred for two days, so it is not hypothetical.

**Independent Test**: make the model unreachable, request a proposal, and confirm the interface
reports unavailability and offers the manual route without losing the operator's place.

**Acceptance Scenarios**:

1. **Given** an unreachable model, **When** a proposal is requested, **Then** the operator sees a
   plain statement that the local model is unavailable and that manual labelling still works.
2. **Given** an unreachable model, **When** the operator proceeds manually, **Then** the manual
   builder opens on the same signal with nothing lost.
3. **Given** a model that answers too slowly, **When** the wait exceeds the allowed ceiling,
   **Then** the request ends with a stated timeout rather than an indefinite wait.

---

### Edge Cases

- A signal whose value is an empty string, an empty array, an empty object, or whitespace: no
  ground exists, and the answer must say so at low confidence rather than treating the key name as
  proof.
- A signal the deterministic table can answer: the model is not consulted at all, and no
  payload-derived data leaves the process.
- An operator who is not signed in: the proposal is refused, because a suggestion that cannot be
  saved is a dead end and the gate matches the save route.
- An operator requesting proposals in a rapid loop: requests are limited, because the model call is
  a contended shared resource.
- A model that returns a label outside the accepted set: the answer is rejected rather than shown.
- A payload edited after analysis: the proposal is made about the signal that was analysed, not a
  re-derived one, so a stale request is not labelled as if it were current.
- Two proposals requested for different signals in the same session: each is independent; nothing
  from one is carried into the other.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST resolve an unknown vendor signal from a deterministic table before
  consulting any model, and MUST consult the model only for signals the table abstains on.
- **FR-002**: The system MUST label every answer with its provenance, and the interface MUST show
  which of the two produced it. A table lookup and a model's guess MUST NOT be presented alike.
- **FR-003**: The system MUST return a suggestion only. It MUST NOT write to the operator's dialect;
  persisting a label MUST remain a separate, explicit operator action.
- **FR-004**: The system MUST restrict what leaves the process to an allowlist: the signal's own
  path and value, a structural sketch of the impression, and the names of sibling extension keys.
  Sibling values, publisher strings, and any field not named on the allowlist MUST NOT travel.
- **FR-005**: The system MUST return a confidence value with every answer, and that value MUST
  reflect the evidence available rather than a constant.
- **FR-006**: The system MUST cap confidence when there is no ground — an empty value, an
  unreadable code, or a numeric vendor code without corroboration — irrespective of which label was
  chosen.
- **FR-007**: The system MUST NOT return absolute certainty for any answer.
- **FR-008**: The system MUST require an authenticated operator and MUST limit request rate per
  operator.
- **FR-009**: The system MUST answer with a stated, distinguishable reason when the model is
  unreachable, when it times out, and when it returns an unusable answer, and the interface MUST
  offer the manual route in each case.
- **FR-010**: The system MUST reject any label outside the accepted set, including one the model
  returns, before it reaches the operator.
- **FR-011**: The system MUST NOT log payload contents on failure; only the shape of the failure and
  the signal path may be recorded.
- **FR-012**: The model MUST be reachable only from the host running the application; the answer
  MUST NOT be obtained from a third-party service.
- **FR-013**: Every user-visible string introduced by this feature MUST exist in English,
  Ukrainian, and Russian.

### Key Entities

- **Signal**: one unrecognised vendor extension key observed in an analysed payload — its path, its
  value, and the impression it sits on. Not stored by this feature.
- **Proposal**: a label drawn from the accepted set, a confidence value, a human-readable reason,
  and a provenance marker. Transient; exists only until the operator accepts or dismisses it.
- **Redacted context**: the bounded subset of the impression that may accompany a Signal when a
  model is consulted — structure and sibling key names, never publisher content.
- **Dialect mapping**: the durable record an operator may create from a Proposal. Owned by the
  existing dialects feature, not by this one; named here only to state that this feature does not
  write it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An operator meeting an unknown vendor signal can obtain a proposal without leaving the
  Inspector or consulting an external document.
- **SC-002**: A signal the deterministic table can answer is never sent to a model. For those
  signals no payload-derived data leaves the process at all.
- **SC-003**: Across a fixed evaluation set of ambiguous signals, every returned label is one a
  reviewer accepts as correct or as an honest refusal.
- **SC-004**: Across the same set, no answer is returned at absolute certainty, and answers with no
  supporting evidence stay in the lowest confidence band.
- **SC-005**: Every request ends in a stated outcome — a proposal, an unavailability notice, or a
  timeout. No request waits indefinitely, and no request fails without a reason the operator can
  act on.
- **SC-006**: No proposal changes the operator's dialect. Every stored mapping is traceable to an
  explicit human action.
- **SC-007**: When the model is unavailable, the operator can still complete the labelling task by
  hand, with no loss of the signal they were working on.

## Assumptions

- The operator is a technical user reading a real bid request; they can judge a proposal and are
  better served by an honest refusal than by a fluent guess.
- A model runs on the same host as the application. Availability of that model is an operational
  property outside this feature's control, which is why unavailability is a first-class outcome
  rather than an error state.
- The model is a shared resource used by other work on the same host; this feature must not degrade
  it, and its own latency may include waiting behind another caller.
- The accepted label set is owned by the dialects feature. This feature consumes it and must not
  widen it.
- The deterministic table is expected to grow over time, which moves signals out of the model's
  scope rather than into it. That direction is intended.
- Evaluation of answer quality requires a live model, so it is a bench run by hand rather than a
  gate in continuous integration.

## Dependencies

- The existing dialects feature owns the accepted label set, the save route, and the manual builder
  this feature falls back to.
- The existing authentication and rate-limiting surfaces gate the endpoint.
- The privacy contract in `docs/PRIVACY.md` states field by field what may accompany a signal to the
  model; a change to the allowlist is a change to that contract.
- [ADR-012](../decisions/ADR-012-bounded-model-assist-on-dialect-labelling.md) records why this
  bounded exception to ADR-003 was accepted.
