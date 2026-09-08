# Feature Specification: Format Detection and Feed Dispatch Alignment

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013/021/022/023/024 precedent)

**Created**: 2026-09-08

**Status**: Complete

**Input**: Owner instruction, 2026-09-08: close the format-detection and vendor-dialect recognition
defects recorded by the [020 audit](../020-ad-format-verification-matrix/defects.md). This package
delivers the four defects whose fix is a detection/dispatch alignment inside the engine's own files
(`detect.js`, `format-detect.js`, `rules-feed.js`) and the Inspector's material finder — DEF-160,
DEF-181, DEF-161 and DEF-460. All four are the same class of failure: a payload the engine already
validates or previews under one set of field names is not recognized under an equivalent alias, or an
array element is force-fit through the wrong field contract.

- **DEF-160**: `detectFeedFormat` tested `image`/`icon` for a material's creative slot but not the
  `image_url`/`icon_url` aliases the push-material validator already accepts, so a Kadam material
  cleanly validated under those aliases received no format tag.
- **DEF-181**: the product's own committed in-page card feed sample uses `clickurl`. `format-detect.js`
  already recognized it as a click alias, but `detect.js`'s single-object classifier, the
  `rules-feed.js` push-material click check, and the Inspector's `findPushMaterial` did not — so the
  card was typed `payload.unknown_type` (single) or drew a false `feed.push.click_url_required`
  (array), and never previewed.
- **DEF-161**: a materials array dispatched every element through the push-material validator. A
  RichAds element spelling its price and win-notify `bid_price`/`notification_url` — a documented
  bid-price shape — drew spurious `feed.push.id_required`/`bid_required`/`nurl_recommended`.
- **DEF-460**: a standalone Native 1.x `adm` body was tagged `native` only when the optional 2.6
  `mtype` hint was present, so a Native creative without `mtype` previewed correctly but carried no
  format tag.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A material earns its format tag under every accepted alias (Priority: P1)

An operator pastes a push material that spells its creative slots `image_url`/`icon_url` (the Kadam
contract). The validator already accepts it; the format panel must show the `push` chip too, not an
empty format.

**Why this priority**: A material that validates cleanly but shows no format is an inconsistent
answer about the same payload from two parts of one product.

**Independent Test**: Detect the format of a single object carrying `click_url` + `cpc` +
`image_url`/`icon_url` + `title`: the format set is `[push]`, the same as for the bare
`image`/`icon` spelling.

**Acceptance Scenarios**:

1. **Given** a material using `image_url`/`icon_url`, **When** its format is detected, **Then** the
   `push` tag is present.
2. **Given** the same material, **When** it is validated, **Then** its findings are unchanged.
3. **Given** a material using bare `image`/`icon`, **When** its format is detected, **Then** the
   result is unchanged.

---

### User Story 2 - The `clickurl` alias is recognized everywhere a click key is read (Priority: P1)

An operator pastes the product's own in-page card feed sample, which uses `clickurl`. Whether it
arrives as a single object or a two-card array, it must be typed as a feed, validated without a false
missing-click error, and previewed.

**Why this priority**: The alias is already honoured by format detection; the split recognition made
the product contradict itself about its own committed sample.

**Independent Test**: Classify a single object with `clickurl` + `price` + creative keys: it is a
feed, not `payload.unknown_type`; validate a two-card array of them: no `feed.push.click_url_required`
fires.

**Acceptance Scenarios**:

1. **Given** a single object with `clickurl`, **When** it is classified, **Then** it is a feed shape,
   not `payload.unknown_type`.
2. **Given** an array of `clickurl` cards, **When** it is validated, **Then** no
   `feed.push.click_url_required` fires for any element.
3. **Given** either shape, **When** it is previewed in the Inspector, **Then** its card renders with
   the card title as the on-screen identity.
4. **Given** a card that uses the existing `click_url`/`link` spellings, **When** it is classified or
   validated, **Then** its behaviour is unchanged.

---

### User Story 3 - An array element is validated against the shape it actually is (Priority: P1)

An operator pastes a RichAds bare array whose element spells `bid_price`/`notification_url`. It must be
validated against the bid-price field contract, not the push-material one.

**Why this priority**: Forcing push-material field names onto a different vendor's documented shape
produces three false errors about fields that shape never had.

**Independent Test**: Validate a one-element array `[{title, description, image, notification_url,
link, bid_price}]`: none of `feed.push.id_required`, `feed.push.bid_required`,
`feed.push.nurl_recommended` fires.

**Acceptance Scenarios**:

1. **Given** an array element matching the bid-price shape, **When** the feed is validated, **Then**
   it is checked against the bid-price contract with array-indexed paths.
2. **Given** a generic priced-and-clickable material element, **When** the feed is validated, **Then**
   it stays on the push-material path exactly as before.
3. **Given** the same RichAds element, **When** it is previewed, **Then** its card renders with the
   element title as identity.

---

### User Story 4 - A Native creative is tagged native from its own body (Priority: P2)

An operator pastes a response whose bid `adm` is a Native 1.x JSON body and which omits the optional
`mtype`. The format panel must show `native`, matching what the Inspector already renders.

**Why this priority**: A creative the product previews as Native but tags as nothing is an
inconsistent identity for one bid.

**Independent Test**: Detect the format of a response bid whose `adm` is `{"native":{"assets":[…]}}`
and which carries no `mtype`: the format set contains `native`.

**Acceptance Scenarios**:

1. **Given** a bid `adm` carrying a Native `assets` array and no `mtype`, **When** its format is
   detected, **Then** `native` is present.
2. **Given** a bid that declares its `mtype`, **When** its format is detected, **Then** its tags are
   exactly as before (the native sniff is gated on an absent `mtype`).
3. **Given** a bid `adm` that is generic JSON with no native carrier, **When** its format is detected,
   **Then** it stays unclassified.

### Edge Cases

- A material carrying both `image` and `image_url` is tagged once; the alias set is a union, not a
  second pass.
- An array element that matches no vendor-unique key stays on the push-material path; only a
  bid-price-unique key (`bid_price`/`notification_url`) diverts it.
- A bid `adm` that fails JSON parse, or whose root is not an object, is not native.
- The `clickurl` alias only adds recognition; the existing `click_url`/`link` spellings and their
  finding paths are unchanged.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `detectFeedFormat` MUST treat `image_url` and `icon_url` as creative-slot aliases
  alongside `image`/`icon`, so a material validated under those aliases earns the same format tag.
- **FR-002**: The `clickurl` click alias MUST be recognized by the single-object payload classifier,
  the push-material click check, and the Inspector's material finder and card link resolution, so the
  product's own in-page card feed sample is typed, validated and previewed consistently.
- **FR-003**: A materials array MUST dispatch each element by its shape: an element matching the
  documented bid-price shape (`bid_price`/`notification_url`) is validated against the bid-price
  field contract with array-indexed paths, while a generic material stays on the push-material path.
- **FR-004**: A standalone Native 1.x `adm` body (a `native` wrapper or bare native root carrying an
  `assets` array or an `assetsurl` pointer) MUST tag the format `native` when the bid declares no
  `mtype`; a bid that declares its media type keeps exactly its prior tags.
- **FR-005**: No finding id MUST be added, removed or renamed, and no message text MUST change in any
  locale.
- **FR-006**: The 020 corpus MUST be updated in the same change: the six affected cases lose their
  ledger records and pass normatively at their applicable layers, and every other recorded deviation
  keeps its exact signature — including the still-open DEF-107 Kadam cases, whose response-format
  deviation this alias alignment incidentally corrects and whose records are re-pinned to their
  residual request-decoder gap.
- **FR-007**: The Core package MUST take a SemVer minor bump with the CLI dependency range and the
  lock file, because the format-detection and feed-classification public surfaces change; the
  validator and HTTP contracts MUST record the alignment.

### Key Entities _(include if feature involves data)_

- **Creative-slot alias set**: the union of `image`/`icon`/`image_url`/`icon_url` that names a
  material's picture.
- **Click alias set**: the union of `click_url`/`link`/`clickurl` (and the camel/redirect spellings)
  that names a material's click target.
- **Vendor-unique key**: a key that identifies a single-bid vendor shape (`bid_price`/
  `notification_url` for bid-price), used to divert an array element from the push-material default.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The six audit cases recorded under DEF-160, DEF-181, DEF-161 and DEF-460 pass
  normatively on their applicable Core, HTTP and browser corpus layers with their ledger records
  retired; the two-card array retains only the separate browser selection gap DEF-201.
- **SC-002**: Every other corpus case carrying a recorded deviation still reports exactly that
  deviation, with the DEF-107 Kadam cases re-pinned to their residual decoder gap and nothing else
  re-pinned or newly passing.
- **SC-003**: No finding id, level or message changes; the locale-parity and severity-registry suites
  pass unchanged.
- **SC-004**: `npm run ci` exits 0 with zero failures and zero runner retries.

## Assumptions

- The remaining 020 format-detection and vendor-dialect groups that require building new request
  decoders or new validators — DEF-106 (EXADS wrapper), DEF-107 (PPCmate/Kadam URL request decoders),
  DEF-108 (Adon3 provisional references), DEF-180 (in-page OpenRTB carrier format tags) and DEF-441
  (Kadam Native feed) — are out of scope for this package and remain open; this package is the
  alias-and-dispatch alignment they share a detection path with.
- No new decision record is created: the governing policy is unchanged. The durable rules are recorded
  in the [validator contract](../000-platform-baseline/contracts/core-validator.md) and the
  [public-boundary contract](./contracts/format-detection-boundary.md) for this feature.
- Deployment is a separate release decision; this feature ends at the pushed commit with hosted CI.
