# Feature Specification: Complete the Audio Repair

**Feature Branch**: `codex/023-audio-repair`
**Created**: 2026-09-08
**Status**: Complete
**Input**: The owner authorized finishing Gemini's audio work while preserving separate Claude Code and Cursor work.

## User Scenarios & Testing

### User Story 1 — Recognize the actual audio creative (Priority: P1)

As an Inspector user, I can distinguish audio from video and identify VAST or DAAST without false signals from descriptive XML text.

**Why this priority**: Incorrect format labels undermine request/response comparisons and creative inspection.
**Independent Test**: Run audio/video/DAAST detection cases, including mixed evidence and malformed XML, through the public detector and actual analysis endpoint.

**Acceptance Scenarios**:

1. **Given** an audio request or audio-only OpenRTB 2.x VAST response, **when** analyzed, **then** it has the audio signal without an invented video signal or an unsupported-MIME warning for a supported audio media type.
2. **Given** OpenRTB 2.x bid.mtype says audio but an actual MediaFile says video, **when** analyzed, **then** the video evidence remains visible.
3. **Given** comments, CDATA, a DOCTYPE subset, or a quoted descriptive attribute containing apparent audio markup, **when** analyzed, **then** that text does not become creative media evidence.
4. **Given** malformed or truncated XML attributes, **when** analyzed, **then** analysis terminates without a crash, unbounded allocation or false evidence from a malformed attribute.
5. **Given** a protocol-bearing request or an AdCOM Audio/Video response, **when** analyzed, **then** protocol families follow the applicable numeric field contract; a response array is not treated as a scalar creative type.

### User Story 2 — Receive useful audio validation and preview (Priority: P1)

As a user, I see an error for missing or malformed required audio MIME data and can inspect DAAST as a document.

**Why this priority**: Required-field omissions currently escape validation, while unsupported preview routing misrepresents the creative.
**Independent Test**: Validate missing, malformed and valid audio MIME values across locales; inspect DAAST in the browser without executing or fetching the creative.

**Acceptance Scenarios**:

1. **Given** an audio impression with absent, non-array or empty MIME data, **when** validated, **then** a stable required-MIME error identifies the field.
2. **Given** a nonempty MIME array containing a blank or non-string element, **when** validated, **then** a stable invalid-MIME error identifies the field; valid nonempty strings produce neither new error.
3. **Given** real DAAST XML, including supported namespace/prolog forms, **when** previewed, **then** its content is shown as inert document text; a different root whose prefix is DAAST is not mistaken for DAAST.
4. **Given** any new audio finding, **when** English, Ukrainian or Russian is selected, **then** the localized message and specification reference explain the same finding.

### User Story 3 — Accept a bounded, reproducible repair (Priority: P2)

As a maintainer, I can verify and adopt the audio work without overwriting concurrent changes or claiming unrelated defects are closed.

**Why this priority**: A passing original corpus alone missed regressions introduced by the repair.
**Independent Test**: Reproduce review controls plus the affected corpus, inspect exact ledger changes, and run the complete repository gate in an isolated checkout and process environment.

**Acceptance Scenarios**:

1. **Given** the 17 cases associated with DEF-101/112/102, **when** all applicable layers run, **then** 16 are fully normative and the remaining browser selection defect remains DEF-201; unrelated expectations and known-gap guards remain intact.
2. **Given** the adopted Gemini patch and this repair, **when** reviewed for delivery, **then** exact scope, versions, commands, outcomes and remaining integration work are recorded without claiming unrun hosted or production checks passed.
3. **Given** Claude Code and Cursor are active separately, **when** this feature is implemented or tested, **then** their working files, Git state and browser processes are preserved.

### Edge Cases

- Missing, null, scalar, empty, mixed-type and whitespace-only audio MIME values.
- Audio/video MediaFiles together; wrapper metadata; misleading metadata versus actual video.
- Attribute values containing apparent type/adType attributes; comments, CDATA and DOCTYPE comments/processing instructions containing apparent MediaFiles.
- Nonprogressing tokens, incomplete equals/value pairs, unterminated quotes, truncated tags and declarations.
- Namespaced DAAST roots versus a DAAST namespace prefix on another root.
- Valid scalar response creative type versus array, string, null or unknown numeric types.

## Requirements

### Functional Requirements

- **FR-001**: Recognize audio request and OpenRTB 2.x actual audio creative evidence; preserve independent video evidence alongside 2.x bid.mtype, and accept supported audio MediaFile MIME types without the false video-only warning.
- **FR-002**: Map OpenRTB 2.x audio/video protocol codes and scalar AdCOM Audio/Video response creative types to the correct supported families; malformed response arrays MUST NOT add scalar protocol evidence.
- **FR-003**: Only actual XML element attributes may contribute media/ad-type evidence. Comments, CDATA, declarations, vendor extension subtrees and text embedded inside another attribute MUST NOT contribute that evidence.
- **FR-004**: Every finite malformed XML input within existing input limits MUST terminate without an unbounded parsing loop or allocation. Invalid/incomplete attribute tokens MUST NOT manufacture recognized media evidence; unrelated valid evidence may remain.
- **FR-005**: Require a nonempty audio MIME array, distinguishing absent/non-array/empty data from non-string or blank entries with stable error identifiers.
- **FR-006**: Recognize actual DAAST root documents and display them as inert XML text. Existing sandbox, fetch and playback restrictions remain in force.
- **FR-007**: Preserve deterministic public result shapes, existing finding IDs, ordering/deduplication and CLI exit-code policy; provide all new finding messages in en/uk/ru with specification references and an explicit compatibility/version decision.
- **FR-008**: Preserve original fixture payloads and normative expectations. Retire only DEF-101/112/102 when proven, retain the independent DEF-201 case, and preserve all unrelated known-gap guards and the separate cleanup backlog.
- **FR-009**: Add repeatable regressions for all independent review controls and malformed input termination, verify actual public boundaries and browser preview, and complete mandatory local gates before calling the repair verified.
- **FR-010**: Preserve concurrent work through an isolated checkout, narrowly owned edits and isolated test processes; record adopted patch provenance and exact local delivery state.

### Key Entities

- **Audio impression**: Request media declaration with required MIME values and optional protocol codes.
- **Creative evidence**: Actual MediaFiles, ad-type attributes and numeric protocol metadata; distinct from descriptive or malformed XML text.
- **Validation finding**: Stable identifier, severity, path, parameters, localized message and reference.
- **Corpus outcome**: Case/layer result with either normative success or an explicit unrelated known gap.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All 12 previously independent review controls and added malformed-input controls pass; each isolated malformed-input probe finishes successfully within its documented watchdog limit.
- **SC-002**: The 17 affected audio cases have complete applicable layer outcomes: 16 fully normative, one retaining only independent browser DEF-201, and zero unexpected failures.
- **SC-003**: Each of the two new audio finding identifiers has meaningful, equivalent output in all three supported locales and a specification reference.
- **SC-004**: Required local verification has zero unexpected failures, and its command, outcome and limitations are recorded against the settled scope.
- **SC-005**: The completed repair leaves peer-owned work and processes intact; the delivery receipt distinguishes the isolated local result from future integration, hosted checks and deployment.

## Assumptions

This is the bounded audio follow-up to feature 020; crosscheck repair reserved as 022 and other defect groups, vendor support, Native support and cleanup proposals remain separate. Audio/video playback, remote wrapper resolution, a general XML conformance validator and new preview controls are outside scope. Synthetic offline fixtures remain the only test input source.

## Traceability Recovery

Gemini implemented the adopted 35-file audio patch before this feature package existed. Independent review reproduced R1–R4, then R5 (nonterminating malformed-attribute parsing) and R6 (incorrect JSDoc/typecheck). The owner's 2026-09-08 instruction explicitly adopts that work for completion. This package recovers its intent and compatibility record and precedes the newly authored R5/R6 repair; it does not claim planning preceded Gemini's code. The preserved external `completion.patch` and snapshot identify the adopted changes from baseline `82c04260f8e18f226cf8dea782ae8863f95a47ca`.
