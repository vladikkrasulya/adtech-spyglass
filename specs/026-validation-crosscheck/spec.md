# Feature Specification: Validation Semantics and Media Crosscheck

**Feature Branch**: `codex/026-validation-crosscheck`

**Created**: 2026-09-08

**Status**: In Progress

**Input**: Accepted maintainer brief: complete fourteen verdict-semantic defect groups in two waves, using reserved package 026 and Core 0.45.0; deliver reviewed branch pushes and green hosted checks while the maintainer owns integration into main.

## User Scenarios & Testing

### User Story 1 - Identify an incompatible bid without rejecting an offered alternative (Priority: P1)

An auction auditor compares a request with its response and needs to know whether the returned creative fits the offered media and buyer-seat restrictions. A valid video bid on mixed inventory must not inherit requirements from an unchosen banner or Native alternative.

**Why this priority**: False compatibility hides delivery failures; false incompatibility rejects otherwise usable inventory. This is the highest-value wave A.

**Independent Test**: The eleven linked wave A scenarios give the normative media/seat verdict at the existing public analysis boundaries, with compatible control pairs free of the corresponding contradictions.

**Acceptance Scenarios**:

1. **Given** a video impression with explicit MIME, duration or protocol limits, **When** the returned VAST contradicts one limit, **Then** the affected bid has a specific incompatibility finding; an allowed alternative does not receive that contradiction.
2. **Given** a banner-only or audio-only impression, **When** the response contains incompatible or unidentifiable inline media, **Then** the auditor receives the corresponding media finding rather than an unsupported claim of compatibility.
3. **Given** an impression offering several media families, **When** a valid video bid selects its video alternative, **Then** unselected banner dimensions and Native assets impose no requirements on that bid.
4. **Given** explicit allowed or blocked buyer seats, **When** a responding identified seat violates the restriction, **Then** the affected seat is diagnosed; an allowed seat remains valid.
5. **Given** an InLine creative carrying valid NonLinearAds without Linear content, **When** the document is validated, **Then** a missing Linear MediaFile is not reported; a Linear creative missing its required media is still diagnosed.

### User Story 2 - Distinguish supported response content from malformed supplied fields (Priority: P2)

An auditor needs equivalent supported creative representations to receive equivalent verdicts, while malformed declarations, duplicate seat identities and unknown reason codes remain visible.

**Why this priority**: Wave B repairs response/request semantics after the more expensive paired-media contradictions; it independently improves fourteen linked cases.

**Independent Test**: The fourteen linked wave B cases satisfy their normative expectations through existing public boundaries. Paired invalid controls retain blocking supplied-type findings where specified.

**Acceptance Scenarios**:

1. **Given** an optional markup-type declaration, **When** it is supplied outside integer values 1–4 or names a family absent from the matched impression, **Then** validation or crosscheck respectively diagnoses it; omission does not invent a declaration.
2. **Given** a supported structured Native response in OpenRTB 2.x or AdCOM 3.0, **When** its required assets are complete, **Then** it is accepted without an additional inline-markup requirement; missing or invalid required asset content remains visible.
3. **Given** two response seat groups, **When** both explicitly name the same seat, **Then** the repeated seat identity is diagnosed; several bids within one seat group remain valid.
4. **Given** blank inline markup or a pop bid with only a valid win-notice URL, **When** response completeness is assessed, **Then** blank text supplies no creative and the supported notice-only form does not receive a pop redirect error merely for omitting inline markup.
5. **Given** a documented EXADS popunder impression, **When** standard media objects are absent but the recognized dialect evidence identifies the supported form, **Then** generic media absence is not reported; an ordinary IAB impression without media remains diagnosed.
6. **Given** a supplied no-bid reason or COPPA flag, **When** its value is unassigned or malformed, **Then** the auditor receives a source-grounded diagnostic while valid omitted optional fields remain valid.

### Edge Cases

- Supplied nulls, strings, booleans, arrays and fractional numbers are distinct from omitted fields; existing invalid-type errors are retained.
- A mixed impression does not mean every offered media family was selected; contradictory declared and actual media remains diagnosable.
- Several VAST media renditions represent alternatives. MIME compatibility requires a usable allowed rendition rather than every rendition matching one requested value.
- Wrapper-only or incomplete markup provides no invented duration or MIME proof; no remote document or creative is fetched for this work.
- Comment, CDATA, attribute text and vendor extension metadata cannot manufacture real VAST media evidence; malformed XML must terminate.
- Missing or malformed seat identifiers do not become invented buyer identities. Explicit restrictions only produce a contradiction supported by the supplied identity.
- A structured Native object is not accepted solely because it is truthy; required asset references and content remain checked.
- Known-gap records can contain independent deviations. Only resolved signatures are retired; independent browser problems remain attributed.

## Requirements

### Functional Requirements

- **FR-001**: Diagnose returned VAST MIME, duration and protocol contradictions against the selected video impression constraints, at the affected bid (DEF-113).
- **FR-002**: Diagnose incompatible inline content for banner and audio impressions using actual media evidence; unidentifiable content must not be claimed compatible (DEF-194).
- **FR-003**: Apply only the chosen media family's constraints on a mixed impression, retaining evidence of declaration/content contradictions (DEF-111).
- **FR-004**: Enforce explicit buyer-seat allow and block restrictions against identified response seats (DEF-192).
- **FR-005**: Accept valid NonLinearAds-only InLine VAST without requiring Linear MediaFile content, while retaining the Linear requirement (DEF-130).
- **FR-006**: Diagnose supplied invalid markup-type declarations and valid declarations incompatible with the matched impression; supported values are integers 1–4 (DEF-195).
- **FR-007**: Accept and crosscheck complete structured AdCOM Native response assets without requiring an additional display markup or creative URL field (DEF-151).
- **FR-008**: Include supported OpenRTB 2.x structured bid Native content in completeness and paired asset checks, with the same asset requirements as its inline counterpart (DEF-150).
- **FR-009**: Diagnose an explicit seat identifier repeated across separate seat groups without rejecting several bids in one group (DEF-190).
- **FR-010**: Treat whitespace-only inline markup as absent creative content; retain independent diagnostics for supplied invalid types (DEF-198).
- **FR-011**: Accept the documented EXADS popunder impression form when recognized dialect evidence supports it, preserving ordinary IAB media requirements elsewhere (DEF-109).
- **FR-012**: Accept a supported pop notice-only bid without requiring absent inline content to be a redirect; supplied non-redirect inline content remains diagnosed (DEF-170).
- **FR-013**: Distinguish supplied no-bid reasons outside 0–17 and the integer exchange-specific range 500 and above from recognized values, retaining errors for supplied invalid types (DEF-301).
- **FR-014**: Diagnose a supplied COPPA flag outside integer values 0 or 1 while retaining valid omission (DEF-197).
- **FR-015**: Preserve existing public finding identifiers, ordering, deduplication, result shapes and CLI exit policy, together with the established noncoercing price, shared deal-floor and 3.0 currency contracts.
- **FR-016**: Retire only the fourteen resolved groups and their proven signatures; preserve independent deviations and unrelated normative corpus expectations.
- **FR-017**: Supply equivalent English, Ukrainian and Russian messages and authoritative references for every added finding, with reproducible public-boundary evidence and an accurately versioned delivery.

### Key Entities

- **Offered impression**: Identity, offered media families, applicable media constraints and buyer-seat context.
- **Returned bid**: Referenced impression, seat identity, optional markup type and one supported creative representation.
- **Creative evidence**: Observable media family, inline document kind, available media renditions, duration/protocol facts or structured Native assets.
- **Finding**: Stable identifier, severity, affected path, parameters, provenance reference and localized meaning.
- **Known deviation**: A reviewed group and its exact case/layer signature, independent of the normative expectation.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All fourteen scoped groups are retired after their twenty-five linked cases satisfy the corresponding normative semantic expectations; independent nonsemantic deviations remain visible.
- **SC-002**: No unrelated case expectation or unresolved deviation signature changes across the complete existing 256-case corpus; the selected-media and supplied-type negative controls remain effective.
- **SC-003**: Every added finding has the same structured meaning in all three supported locales, and repeated analysis produces identical structured verdicts.
- **SC-004**: Both ordered waves have reviewable committed branch delivery; the settled final branch has passing local, package, container and hosted verification with the reserved Core release identified, without claiming main integration or production deployment.

## Assumptions

- The accepted starting main revision is `340ffd3`, with Core 0.42.0 and 34 unresolved groups. The maintainer has integrated audio feature 023. Cursor independently owns Core 0.43.0 and crash repairs; this feature owns Core 0.45.0.
- The maintainer explicitly authorizes branch pushes after each wave and owns merging into main. Assigned semantic implementation can proceed independently; full DEF-151 retirement also requires the peer-owned recognition and preview observations.
- Product ownership is limited to the listed Core semantic files and their necessary messages, references, regression tests, version metadata and project records. General recognition changes, UI redesign, crashes assigned elsewhere, registry publication and deployment are excluded.
- The existing evidence-backed corpus defines the cases; supported SSP Native conventions are labeled as conventions rather than silently promoted to IAB wire requirements.

## Expectation identity binding and peer-owned observations

Existing fixture IDs prefixed `expected.` are unbound semantic symbols, not shipped finding IDs. Bind only the selected affected symbols to implemented public IDs, retaining every payload, severity, path and parameter assertion. The corpus harness/oracle stays unchanged; the real 256-case loader comparison proves the bounded impact. DEF-151 additionally has recognition/preview expectations owned by another agent; those observations must pass before its record is retired. Assigned-file implementation can proceed while that ownership coordination remains explicit.
