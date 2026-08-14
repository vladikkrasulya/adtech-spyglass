# Feature Specification: Silent Failure Detection

**Feature Branch**: `feat/url-search-feed`

**Created**: 2026-08-13

**Status**: Complete

**Input**: Assessment handoff from `.specify/assessments/silent-failure-detection/decision.md`:
report the defects that are destroyed by parsing, never mutate an operator's input without saying
what changed, and give every refusal a reason a human can act on.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Paste a URL the way it was copied (Priority: P1)

As an integration engineer, I can paste a feed URL as it arrived — wrapped in quotes, inside a
markdown link, HTML-escaped, missing its scheme, with a sentence's punctuation stuck to the end —
and the tool works with it, telling me what it changed.

**Why this priority**: it was the entry defect. Of fifteen ways to paste one working URL, one
worked, and three were accepted with the value silently damaged.

**Independent Test**: run the fifteen paste variants and confirm each is recognised, that the
repairs are listed, and that the payload is unchanged.

**Acceptance Scenarios**:

1. **Given** a URL wrapped in quotes, angle brackets, backticks, parentheses or a markdown link,
   **When** it is analysed, **Then** it is recognised and the unwrapping is reported.
2. **Given** a URL with a trailing `)`, `,`, `.` or `;` from surrounding prose, **When** it is
   analysed, **Then** the punctuation is removed and reported — while `?q=(shoes)` keeps its
   balanced parentheses.
3. **Given** an HTML-escaped `&amp;` separator, **When** it is analysed, **Then** it is decoded
   once and reported; a double-escaped sequence is left alone and reported as ambiguous.
4. **Given** the same input analysed twice, **When** the second run completes, **Then** it reports
   no repairs, because the first result was already stable.
5. **Given** a repaired URL, **When** the operator inspects the result, **Then** the original text
   remains recoverable.

---

### User Story 2 - Be told why an input was refused (Priority: P1)

As an operator, when the tool cannot use my input I am told which of the possible reasons applies.

**Why this priority**: every refusal previously produced "expected a JSON object or array",
including for a feed URL with a typo in the host. The reasons were computed and discarded.

**Acceptance Scenarios**:

1. **Given** a string that is not a URL at all, **Then** the answer names that.
2. **Given** `javascript:`, `data:` or `file:`, **Then** the answer names the scheme and that only
   `http`/`https` can be fetched.
3. **Given** a valid URL no decoder recognises, **Then** the answer names the host, path and the
   parameters that were read.
4. **Given** prose, SQL or a JSON fragment, **Then** the JSON answer is kept — a URL answer would
   be wrong.

---

### User Story 3 - See defects the parse destroys (Priority: P1)

As an AdOps engineer, I am told about duplicate keys and unsafe integers in the payload I pasted,
which no validator reading a parsed object can see.

**Why this priority**: a duplicate `bidfloor` is a disagreement about money between two
participants who both believe they agree.

**Acceptance Scenarios**:

1. **Given** a repeated key in one object, **Then** it is reported with every value in order, as
   an error on money and identity fields and a warning elsewhere.
2. **Given** an integer past 2^53-1, **Then** it is reported with the value it reads back as.
3. **Given** a raw control character inside a string, **Then** it is reported without the payload
   being rejected.
4. **Given** the same paste analysed repeatedly, **Then** the findings do not disappear after the
   first run.

---

### User Story 4 - See fields a receiver will ignore (Priority: P2)

As an integration developer, I am told when a field I set will have no effect.

**Acceptance Scenarios**:

1. **Given** a name one edit from a real field, **Then** the correction is offered.
2. **Given** a real field in the wrong object, **Then** the objects it belongs on are named and no
   correction is invented.
3. **Given** unknown keys under `ext`, **Then** nothing is reported — extensions are carried.

---

### User Story 5 - See a consent string that decodes into different consent (Priority: P2)

As a privacy-conscious integrator, I am warned when a TCF string decodes into something
implausible rather than failing to decode.

**Acceptance Scenarios**:

1. **Given** a sound consent string, **Then** nothing is reported.
2. **Given** a damaged one, **Then** the implausible field is named at warning level.
3. **Given** a GPP string, **Then** the TCF reader is not applied to it.

## Requirements _(mandatory)_

- **FR-001**: Input repair runs on every analysis, not only when parsing fails — the damaging
  cases parse successfully.
- **FR-002**: Repair is idempotent. A second run over the first result reports no repairs.
- **FR-003**: Every repair is recorded with its step, the text before and the text after.
- **FR-004**: Recognition is case-insensitive; the input's case is never rewritten. Only closed
  vocabularies a decoder itself defines are case-folded.
- **FR-005**: `_raw` is read from the query string without percent-decoding, and is the source of
  truth for every derived field.
- **FR-006**: Refusals carry a reason: unparseable, unsupported scheme, or no decoder.
- **FR-007**: Raw-byte findings require the caller to supply the text; callers that hold only the
  parsed object behave exactly as before.
- **FR-008**: Severity follows consequence. Plausibility arguments are warnings, never errors.
- **FR-009**: Every rule reports nothing on a clean payload.
- **FR-010**: No rule performs any network access.

## Success Criteria _(mandatory)_

- **SC-001**: All fifteen paste variants are recognised; the one previously accepted-and-damaged
  case reports the repair instead.
- **SC-002**: Zero findings from the new rules across the repository's own OpenRTB fixture corpus.
- **SC-003**: Repeated analysis of one paste yields identical findings.
- **SC-004**: Full CI green, including the source gate that rejects raw control characters.

## Out of Scope

- Any network call, live probe or fetch.
- Standalone validation of ads.txt, sellers.json, SupplyChain or GPP.
- The 56 unverified catalogue hypotheses, each of which needs its own measurement first.
