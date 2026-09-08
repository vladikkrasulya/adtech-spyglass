# Feature Specification: Preview Identity for Vendor and AdCOM Carriers

**Feature Branch**: `fable/030-vendor-preview`

**Created**: 2026-09-09

**Status**: Complete

**Input**: Owner instruction, 2026-09-08: close the [020 audit](../020-ad-format-verification-matrix/defects.md)
ledger to zero. After [028](../028-vendor-request-dialects/spec.md) closed the engine half and
[029](../029-preview-carrier-identity/spec.md) closed the In-Page Push carrier, four records remain,
and every one of them is the same sentence: the response carries a creative the Inspector does not
know how to show.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A structured Native creative under OpenRTB 3.0 is shown (Priority: P1)

An analyst opens an OpenRTB 3.0 pair whose bid carries a complete AdCOM Native creative. The engine
validates it. The preview must show it.

**Why this priority**: 3.0 is one of the three protocols the product claims to inspect. A preview
that silently shows nothing for a complete, valid creative reads as "there is no creative here",
which is the opposite of what the response says.

**Independent Test**: analyse a 3.0 pair whose bid carries `media.ad.display.native`; the native
card appears with its headline, its image decoded, and its landing link.

**Acceptance Scenarios**:

1. **Given** a 3.0 bid with an AdCOM Native creative, **When** it is previewed, **Then** the native
   card is rendered with the creative's own title, image and link.
2. **Given** the same creative, **When** its assets are named by AdCOM (`asset`, `image`) rather
   than by oRTB Native 1.x (`assets`, `img`), **Then** each asset still lands in its own slot.
3. **Given** a 2.x bid with `bid.native`, **When** it is previewed, **Then** nothing about its
   existing render changes.

---

### User Story 2 - A documented vendor material that is not a push card still shows its creative (Priority: P1)

An analyst opens a vendor response whose material carries a headline, a picture and a landing link
but none of the fields that make it a push notification. The material is a creative. The preview
must show it as the kind it is.

**Why this priority**: these materials were dropped into the generic empty state precisely because
an earlier fix (DEF-203) correctly refused to dress them as push notifications. Refusing the wrong
card is right; showing nothing instead of the right one is not.

**Independent Test**: analyse the documented Kadam Native and EXADS banner responses; the first
shows a native card with its headline, the second shows its artwork and destination as ordinary
markup inside the sealed frame.

**Acceptance Scenarios**:

1. **Given** a vendor material with a headline, a picture, a landing link and a price and no push
   click alias, **When** it is previewed, **Then** a native card is rendered.
2. **Given** a vendor bid wrapper with a price, a click and a picture but no notification text,
   **When** it is previewed, **Then** its markup is rendered through the sealed frame and its
   remote artwork is blocked and explained exactly as any banner's would be.
3. **Given** any material that already qualifies as a push card, **When** it is previewed, **Then**
   it is still a push card — the qualification gate is untouched.

---

### User Story 3 - A bare destination says which material it belongs to (Priority: P2)

An analyst opens a pop response whose materials carry a title, a description and a link but no
artwork. The preview correctly shows the destination as inert text. With several materials in one
response, the destination alone does not say which one is on screen.

**Why this priority**: the per-material selector exists so an analyst can step through every
returned material. Stepping through a list where each entry shows only a URL makes the selector
almost useless for telling the entries apart.

**Independent Test**: analyse a multi-material pop response and step through the materials; each
shows its own title and description above its own destination.

**Acceptance Scenarios**:

1. **Given** a material with a title and a description whose creative resolves to a bare
   destination, **When** it is previewed, **Then** the title, the description and the destination
   are all readable.
2. **Given** the same material, **When** the creative is classified, **Then** the classification and
   everything derived from the creative bytes are unchanged — the identity text is shown beside the
   body, never merged into it.

---

### Edge Cases

- A 3.0 envelope with no `openrtb.response` object is left exactly as it is.
- An AdCOM Native with an empty asset list renders the renderer's own placeholders, not an error.
- A vendor material missing any one of headline, picture, link or price is not claimed as a native
  card; guessing would put a creative in front of an analyst that the vendor never described.
- A material carrying notification text is a push card and never reaches the banner path.

## Requirements _(mandatory)_

- **FR-001**: Creative resolution MUST unwrap the OpenRTB 3.0 envelope before looking for a bid, in
  both the primary analysis path and the per-bid selector.
- **FR-002**: An AdCOM `media.ad.display.native` creative MUST render through the same native
  renderer as oRTB Native 1.x, with AdCOM's differing field names mapped onto it rather than a
  second renderer added.
- **FR-003**: A documented vendor Native material — headline, landing link, picture and price, with
  no push click alias — MUST render as a native card.
- **FR-004**: A documented vendor banner wrapper — price, click and picture, with no notification
  text — MUST render as markup through the sealed preview.
- **FR-005**: Neither addition may widen the push qualification gate; each carrier is reached by its
  own path.
- **FR-006**: When a creative resolves to a bare destination and its material carries a title or a
  description, those MUST be shown with it, and MUST NOT enter the bytes the classifier, the
  behaviour engine or the static scanner read.
- **FR-007**: A corpus expectation that the wire cannot support MUST be corrected, with the reason
  recorded in a decision record rather than left as a standing defect.

### Success Criteria

- **SC-001**: All five OpenRTB 3.0 Native cases render a native card with the image decoded and the
  headline visible.
- **SC-002**: Both documented vendor Native cases render a native card with the headline visible and
  their remote artwork blocked and explained.
- **SC-003**: The documented vendor banner case renders as markup.
- **SC-004**: Both documented pop material cases show their own title and description with their
  destination.
- **SC-005**: No other corpus case changes verdict at any layer.
- **SC-006**: The 020 ledger holds no records, and the full repository gate passes.

## Assumptions

- The AdCOM Native object and the oRTB Native 1.x response object differ only in the two field names
  mapped here; every sub-object the renderer reads has the same shape in both.
- The vendor field names accepted for each carrier come from the corpus fixtures' recorded
  provenance, not from guesswork about what a vendor might send.

## Out of Scope

- Any change to `packages/core/`.
- Automatic inlining of remote vendor artwork; the frame policy continues to block it, and the
  blocking continues to be explained on screen.
