# Feature Specification: Single-Object Push Response Recognition

**Feature Branch**: `main` (direct defect-repair workflow, per the 012 precedent)

**Created**: 2026-08-26

**Status**: Complete

**Input**: Owner report, production `v1.15.0` (engine `v1.15.0`), 2026-08-26: a real DSP response
for a Push integration — a single JSON object carrying `tId`, `title`, `description`, `icon`,
`image`, `link`, `linkTtl`, `cpc`, `crid`, `cid` — pasted into the Inspector's Response tab is
reported as `payload.unknown_type`, a blocking ERROR whose text claims exchanges will reject the
bid. The owner confirms the response is correct and complete for its integration, and rules that
this single-object shape is **how most push auctions respond** — a baseline shape, not a vendor
dialect. No vendor attribution is required for it (owner decision 2026-08-26; the 2026-08-20
dialect-attribution decision is unaffected for genuinely vendor-specific formats).

Reproduced before this package was opened: the engine classifies the reported payload as
`unknown` as a single object, while the identical object wrapped in an array is already
recognized as a push-materials feed response. The false positive is therefore confined to the
single-object form and to field-name aliases the list-form validator does not yet accept.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A normal push response analyzes cleanly (Priority: P1)

An integration operator receives a bid from a push network as a single JSON object (creative
text, icon and image links, a click destination, a cost-per-click price, creative/campaign
identifiers) and pastes it into the Inspector to check it before going live. The Inspector must
recognize it as a push-materials response and analyze its fields, instead of declaring the whole
payload unrecognizable and falsely predicting rejection.

**Why this priority**: This is the reported defect. A blocking "will not reach the auction"
verdict on a valid, mainstream response destroys trust in every other verdict the tool gives.

**Independent Test**: Paste a synthetic replica of the reported payload — the same ten keys with
the same value shapes, synthetic values (Constitution III/VII: no production records in tracked
artifacts or tests) — into the analysis entry point; the result names a push-materials response
type and contains no unknown-type finding.

**Acceptance Scenarios**:

1. **Given** a synthetic replica of the reported single-object push response, **When** it is
   analyzed, **Then**
   the payload type is a push-materials feed response, no `payload.unknown_type` finding is
   produced, and the analysis is not headlined by a blocking error caused solely by type
   detection.
2. **Given** the same material wrapped in an array (the already-supported list form), **When**
   it is analyzed, **Then** the type and the per-material findings are consistent with the
   single-object result — one material, same verdicts.

---

### User Story 2 - Alias field names are understood, not punished (Priority: P2)

The same logical fields arrive under different physical names across push integrations: the
material identifier as `id` or `tId`, the click destination as `click_url` or `link`, the price
as `cpc` or `price`, the large creative as `image_url` or `image`, the icon as `icon_url` or
`icon`. The operator must not see "required field missing" errors for a field that is present
under a documented alias — in either the single-object or the list form.

**Why this priority**: Without alias acceptance, recognition alone would convert one false
positive (`unknown_type`) into several (`id_required`, `image_url_recommended`, …) on the same
valid payload.

**Independent Test**: Analyze materials using each alias pair independently; presence under
either name satisfies the check, absence under both names still produces the existing finding.

**Acceptance Scenarios**:

1. **Given** a push material carrying `tId`/`link`/`cpc`/`image`/`icon`, **When** it is
   validated, **Then** no missing-field finding fires for identifier, click destination, price,
   image, or icon.
2. **Given** a push material with none of the identifier aliases, **When** it is validated,
   **Then** the existing identifier-required finding still fires.
3. **Given** a push material whose price is present but non-numeric, **When** it is validated,
   **Then** the existing wrong-type findings fire exactly as they do for the list form today.

---

### User Story 3 - The response is tagged as push traffic (Priority: P3)

The Inspector's format chips summarize what kind of traffic a payload is (web, push, pops, …).
A recognized single-object push response should carry the push tag, so the quality panel and
downstream consumers see the format, not a generic or empty tag — including when the click
destination uses the `link` alias.

**Why this priority**: Cosmetic relative to P1/P2, but the chip row is the first thing the
operator reads, and "web" on a push response is a small standing lie.

**Independent Test**: Analyze the reported payload and inspect the format tags of the result.

**Acceptance Scenarios**:

1. **Given** the synthetic replica of the reported single-object push response, **When** format
   tags are computed, **Then** the tags include push.
2. **Given** a push material in list form whose click key is `link` (not `click_url`), **When**
   format tags are computed, **Then** the tags include push.

---

### Edge Cases

- A generic JSON object that merely contains `link` (or `title`) must **not** be claimed as a
  push response: recognition requires the co-occurrence of a price key, a click-destination
  key, and at least one creative key (title/description/image/icon). Payloads below that bar
  remain unknown, and genuinely unknown payloads keep today's finding and severity.
- Structural OpenRTB shapes keep precedence: an object with `imp[]`, `seatbid[]`, or a 3.0
  envelope is never re-classified by the new signature, even if it also carries push-like keys.
- The existing single-object signatures (value-feed, bid-price, bid-redirect) keep their
  classification: their unique keys (`clickUrl`, `notification_url`, `bid_price`,
  `redirecturl`) win over the generic push signature, so a bid-price response carrying `link`
  still validates as a bid-price feed.
- JSON Feed 1.1 (`version` + `items`) and the `result`-wrapped clickunder/link-feed families
  are unaffected.
- Alias precedence within one material: if both names of a pair are present, the canonical name
  is validated and no duplicate finding fires for the alias.
- `linkTtl` is recognized as a known push-material field (it must not surface as an unknown or
  suspicious key); interpreting its value (expiry semantics) is out of scope for this feature.
- An empty object, or a material where every field fails its check, produces the same findings
  in single-object form as it would as the sole element of a list.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST classify a single JSON object that carries a price key (`cpc` or
  `price`), a click-destination key (`click_url` or `link`), and at least one creative key
  (`title`, `description`, `image`/`image_url`, `icon`/`icon_url`) as a push-materials feed
  response.
- **FR-002**: The system MUST NOT change the classification of payloads recognized today:
  OpenRTB request/response (2.x structural markers and 3.0 envelopes), URL requests,
  clickunder/link-feed wrappers, JSON Feed 1.1, the existing value-feed / bid-price /
  bid-redirect single-object signatures, and array-form feeds all keep their current results.
- **FR-003**: Push-material validation MUST accept the alias pairs `id`/`tId`,
  `click_url`/`link`, `cpc`/`price`, `image_url`/`image`, `icon_url`/`icon` as satisfying the
  corresponding presence checks, identically in the single-object and list forms, while a field
  absent under both names keeps its existing finding.
- **FR-004**: The single-object form MUST produce the same per-material findings as the same
  material analyzed as the sole element of a list (type name may differ to reflect the shape).
- **FR-005**: Format tagging MUST tag recognized push materials as push when the click
  destination uses either `click_url` or `link`, in both shapes.
- **FR-006**: Every new or changed operator-facing message MUST exist in all three locales
  (en/ru/uk) with locale parity preserved.
- **FR-007**: A regression test MUST reproduce the reported payload as a synthetic replica
  (identical key set and value shapes, synthetic values — never the production record) and
  assert: the type is a push-materials feed response, no `payload.unknown_type` finding is
  present, and no missing-field finding fires for any field present under a documented alias.
- **FR-008**: `linkTtl` MUST be treated as a known field of a push material (no unknown-field
  noise); no expiry semantics are introduced.

### Key Entities

- **Push material**: one advertised item — creative text (`title`, `description`), creative
  images (icon, large image), a click destination, a price (cost-per-click), identity
  (`id`/`tId`, `crid`, `cid`), and freshness metadata (`linkTtl`). Appears either as one
  standalone object (this feature) or as an element of the already-supported materials list.
- **Payload type verdict**: the engine's four-way classification (request / response / feed /
  unknown) that gates which rule set runs; the defect lives in the gate, not the rules.
- **Format tags**: the flat tag union (banner/video/…/push/pops) consumed by the UI chips and
  downstream consumers.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The reported production payload, re-analyzed, yields a recognized push response
  with zero blocking findings attributable to type detection — the operator sees field-level
  analysis instead of "this bid will not spin".
- **SC-002**: 100% of the existing detection and feed regression suites pass unchanged —
  no previously recognized payload changes classification.
- **SC-003**: For every documented alias pair, presence under either name produces zero
  missing-field findings, and absence under both names produces exactly the finding produced
  today (verified per pair, both shapes).
- **SC-004**: All operator-facing texts introduced or touched by this feature render in en, ru,
  and uk with no locale falling back to another language.

## Assumptions

- Owner decision 2026-08-26: the single-object push response is a baseline mainstream shape; no
  vendor attribution or partner labeling is attached to it. The 2026-08-20 vendor-dialect
  attribution decision continues to apply to genuinely vendor-specific formats and is not
  weakened by this feature.
- The alias set is fixed to what the mainstream shape demonstrably uses (`tId`, `link`,
  `image`, `icon`, `price`); speculative aliases are out of scope until observed.
- The severity and text of `payload.unknown_type` for genuinely unrecognizable payloads are
  unchanged; this feature narrows when it fires, not what it says.
- No new network, storage, or model surface is touched; the change is confined to the
  detection/validation engine, its messages, and tests — the privacy posture is unchanged.
- Recognition thresholds (which key combinations claim the shape) are a technical decision
  recorded in the plan; the product decision is only that the shape itself is baseline.
