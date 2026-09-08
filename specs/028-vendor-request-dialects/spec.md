# Feature Specification: Vendor request dialects and Core recognition

**Feature Branch**: `codex/028-vendor-request-dialects`

**Created**: 2026-09-08

**Status**: Verification

**Input**: Accepted Core and backend portion of the vendor decoder brief: SpecKit 028, Core 0.46.0, start after PR #83 reaches main, with public preview owned separately.

## Scope and delivery boundary

The Inspector currently rejects documented proprietary requests or loses their format context. This feature adds deterministic inspection and validation through Core and the existing analysis handlers. It does not certify undocumented vendor behavior or deliver creative rendering changes.

The implementation start gate is satisfied by verified main `d3173a5a7b6bf647564ca5d915685066112f8c7c`, including PR #83. Preliminary source research preceded that landing; product implementation did not. Codex owns `packages/core/` and `modules/`; Opus owns all `public/`. Implementation and measured delivery status are recorded separately in verification.md.

| Group   | Cases | Core/backend deliverable                                                                    | Separate dependency                                                                          |
| ------- | ----: | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| DEF-106 |     6 | EXADS JSON/GET request and outer bid recognition, validation and proprietary pair treatment | Banner preview and any remaining browser-only pairing behavior                               |
| DEF-107 |     7 | PPCmate and Kadam URL decoding                                                              | PPCmate title identity; two unsupported inpage assertions require a separate source decision |
| DEF-180 |     6 | Project inpage format recognition                                                           | Extension-card preview and four contradictory empty-preview expectations                     |
| DEF-108 |     3 | Explicitly provisional, unsupported Adon3 inspection                                        | Any remaining browser preview or visible warning behavior                                    |
| DEF-441 |     2 | Kadam Native carrier and explicit request format                                            | Native partial preview and exact title identity                                              |
| DEF-151 |     5 | Supplemental 026 handoff: nested AdCOM Native format recognition                            | Selected creative extraction and Native preview                                              |

The permanent brief names five groups and 24 cases. The earlier explicit ownership transfer of all Core work also assigns DEF-151's five recognition cases; they are a supplemental 026 dependency, making 29 observed cases without changing the brief's count. Already delivered Native validation and crosscheck semantics remain intact.

## User Scenarios & Testing

### User Story 1 - Inspect documented proprietary requests (Priority: P1)

An operator pastes an EXADS, PPCmate or Kadam example and receives findings about the actual carrier, with its supplied request and response values preserved.

**Why this priority**: An unknown-request error or invented OpenRTB constraint prevents the operator from assessing otherwise documented traffic.

**Independent Test**: Public Core and HTTP replay of the six EXADS, seven PPCmate/Kadam and two Kadam Native cases, plus malformed and unrelated-input controls, establishes the Core capability independently of preview delivery.

**Acceptance Scenarios**:

1. **Given** a documented EXADS request and outer bid, **When** inspected as a pair, **Then** request and response receive vendor-aware findings without fabricated OpenRTB impressions, seats, currency or commercial crosscheck.
2. **Given** a recognized GET family on an arbitrary host, **When** decoded, **Then** field mappings preserve the original URL and raw query evidence and explicit format signals produce the corresponding tags.
3. **Given** an explicit Kadam Native request and `url`/`image`/`cpc` material, **When** inspected, **Then** Native intent is retained and the response does not require an unrelated `click_url` carrier.
4. **Given** malformed supplied fields or a malformed OpenRTB envelope, **When** inspected, **Then** vendor recognition does not hide errors or steal the OpenRTB carrier.

### User Story 2 - Preserve supported creative format meaning (Priority: P1)

An operator sees the format actually declared by an inpage widget/card or nested AdCOM Native placement and bid.

**Why this priority**: Correct validation with an incorrect format tag still misleads the operator and the preview owner.

**Independent Test**: The six DEF-180 and five DEF-151 inputs produce the required Core/HTTP format tags while existing validation, markup precedence and media constraints remain covered by public regressions.

**Acceptance Scenarios**:

1. **Given** project widget hints or explicit inpage format or a recognizable `bid.ext` card, **When** format detection runs, **Then** it includes inpage while retaining actual media tags and baseline IAB findings.
2. **Given** an AdCOM placement with `display.nativefmt` or response `media.ad.display.native`, **When** detected, **Then** Native is recognized without automatically claiming a banner solely because of the enclosing display object.
3. **Given** a bid containing both genuine markup and card extensions, **When** Core reports format evidence, **Then** it does not change public markup selection or pretend the extension preview has been implemented.

### User Story 3 - Inspect provisional evidence honestly (Priority: P2)

An operator can inspect the published provisional Adon3-shaped carrier while seeing an explicit warning that vendor support is unconfirmed.

**Why this priority**: Retaining useful reference material must not manufacture proof of a finalized vendor protocol.

**Independent Test**: The three unchanged documented-reference cases and nearby malformed/unknown controls pass through public Core and HTTP with localized provisional warnings, preserved decimal-string prices and no certification finding.

**Acceptance Scenarios**:

1. **Given** the bounded provisional request or response carrier, **When** recognized, **Then** the result visibly says provisional/unsupported and does not claim vendor conformance.
2. **Given** a decimal-string response price, **When** inspected, **Then** the original string is retained and no CPC-to-CPM, floating-point or currency conversion is invented.
3. **Given** an unrelated URL or JSON object, **When** inspected, **Then** ordinary unknown/malformed behavior remains applicable.

### User Story 4 - Trust the remaining defect ledger (Priority: P1)

The maintainer can distinguish completed Core/backend work from the independently owned browser work.

**Why this priority**: Removing a whole record while its creative remains broken would turn missing coverage into a false success claim.

**Independent Test**: Compare all 256 materialized cases before and after; retain unchanged inputs, assertions and unrelated signatures, then replay any proposed complete case through the browser before retiring it.

**Acceptance Scenarios**:

1. **Given** a case with corrected Core/HTTP findings and a remaining browser deviation, **When** the ledger is updated, **Then** proven Core/HTTP lines and measured repaired Core-derived browser lines are removed, while unresolved preview signatures and the case record remain.
2. **Given** a case that passes all layers, **When** retirement is proposed, **Then** current browser evidence accompanies the removal.
3. **Given** a contradictory expectation or hidden placement assumption, **When** encountered, **Then** it remains explicit until the authorized owner resolves it; the shared oracle is not weakened.

### Edge Cases

- Presence-based recognition must keep omitted fields distinct from supplied blank, null, array, object, wrong-enum or nonfinite values.
- Query duplicates, literal macros, encoded separators, case rules, repairs and damaged decoding retain the existing first-match/raw preservation contract.
- Notification URLs never become click destinations or creative markup; absent response bodies do not imply a vendor no-bid without the documented transport state.
- Ambiguous or conflicting subtype evidence cannot derive inventory from hostnames, opaque feed keys, fixture identifiers, creative text or absence of optional subscription age.
- Generic objects and malformed `imp`, `seatbid` or `openrtb` carriers retain structural precedence over proprietary heuristics.

## Requirements

### Functional Requirements

- **FR-001**: Implementation MUST start from the verified main landing and remain within Core/backend ownership; all public rendering changes remain with Opus.
- **FR-002**: EXADS JSON and GET requests MUST use source-backed field roles and required-field validation, including banner-only size requirements and documented inpage support.
- **FR-003**: EXADS outer bids MUST preserve their carrier, distinguish creative/click/notice roles and CPM/CPC semantics, reject supplied invalid values without numeric coercion, and avoid inventing response-required fields or body-only no-bid semantics.
- **FR-004**: Recognized proprietary inputs MUST NOT become fabricated OpenRTB pairs; Core and HTTP MUST agree on narrowly scoped commercial-crosscheck exclusion while malformed and unrelated OpenRTB inputs retain their baseline findings.
- **FR-005**: PPCmate GET decoding MUST preserve its documented common fields and distinguish explicit subscription/pop signals from serialization selectors and ambiguous requests.
- **FR-006**: Kadam GET decoding and material validation MUST support documented optional-key variants, address families, Native/pop declarations and the `url`/`image`/`cpc` carrier without requiring an unrelated click field.
- **FR-007**: New decoders MUST reuse the existing canonical request/raw-query/repair contracts and registry precedence, without network calls or field reconstruction that loses source evidence.
- **FR-008**: Adon3-shaped inspection MUST always communicate provisional/unsupported status in en/uk/ru, retain documented-reference provenance and decimal-string prices, and emit no vendor certification or commercial crosscheck success.
- **FR-009**: Every new validator MUST distinguish omitted from supplied-invalid values, keep diagnostic paths tied to the original input and remain finite on malformed public inputs.
- **FR-010**: Format detection MUST use observable field roles and explicit declarations; it MUST NOT infer hidden placement from fixture metadata, hostnames, keys, text or absence of optional fields.
- **FR-011**: Project inpage recognition MUST reuse its owning field-role definitions, retain actual media tags, preserve `imp.format_required` and the IAB control's `response.bid.payload_missing`, and leave preview expectations to their owner.
- **FR-012**: The supplemental DEF-151 work MUST recognize nested AdCOM Native request/response structures without regressing 026 Native validation, asset crosscheck or genuine banner alternatives.
- **FR-013**: Existing finding IDs, deterministic order, deduplication, API shapes and CLI exit policy MUST remain compatible; new public meaning MUST have additive IDs, inline severity, en/uk/ru messages and specification references.
- **FR-014**: Price/floor/currency semantics from 022 and supplied Native/media semantics from 023/026 MUST remain unchanged; vendor values MUST NOT be coerced into OpenRTB bid prices.
- **FR-015**: The feature MUST retain transient processing, existing authentication and network boundaries, sandbox restrictions and selected-creative ownership without introducing persistence, external execution or asset fetching.
- **FR-016**: The complete 256-case corpus MUST preserve materialized inputs, normative expectations and unrelated signatures. Only two Kadam inpage format assertions may be source-corrected after explicit owner approval; no shared oracle/harness or DEF-180 preview assertion changes are authorized here.
- **FR-017**: Ledger updates MUST remove only measured repaired deviations. A repaired Core-derived browser signature may be removed after current browser proof, while each unresolved preview signature stays intact. An individual record may be retired only when every layer, including the current browser run, passes.
- **FR-018**: Delivery MUST include the 028 package, public-boundary regressions, Core 0.46.0 with CLI 0.1.3 dependency `^0.46.0` and aligned lock metadata, unchanged app version, green local CI, a pushed branch and green hosted CI.

### Key Entities

- **Recognized carrier**: Original vendor-shaped input plus bounded identity evidence; recognition does not certify validity.
- **Canonical URL request**: Existing GET projection retaining endpoint, format evidence, device/site/user mappings, encoded raw fields and repair warnings.
- **Contract status**: Explicit provisional-unsupported state for Adon3-shaped inspection, independent of parsing and format tags.
- **Layer deviation**: A case's exact Core, HTTP or browser signature; whole-record retirement requires all applicable layers.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Core/backend deviations assigned by the five-group brief are eliminated across its 24 cases, except the explicitly gated two Kadam assertions until a decision; all five supplemental DEF-151 Core/HTTP recognition cases pass.
- **SC-002**: All 256 materialized payloads and all unrelated normative expectations/signatures remain unchanged; every permitted expectation change and every retired signature has an exact receipt.
- **SC-003**: No browser-dependent case is reported closed without current browser proof, and all three Adon3 references remain explicitly provisional rather than vendor-valid.
- **SC-004**: Focused public-boundary, package/version, governance and required browser checks pass before one push per completed delivery wave; local `npm run ci` and hosted CI pass for the delivered revision.

## Assumptions and explicit decisions

- Source research caches and raw evidence remain machine-local; tracked artifacts contain source URLs, synthetic case identifiers and concise findings only.
- The two Kadam inpage format assertions are awaiting explicit approval for source correction. Until then, their exact residual signatures remain. This blocks only those assertions, not independent implementation.
- Four contradictory DEF-180 empty-preview assertions and all creative rendering fixes remain assigned to Opus. Exact title identity, assets and IAB checks remain unchanged in this feature.
- Adon3 inspection with an unconditional provisional warning is an accepted product decision; it is not evidence of a finalized vendor contract.
- This package describes repository delivery, not npm publication, deployment or acceptance of the peer's preview implementation.
