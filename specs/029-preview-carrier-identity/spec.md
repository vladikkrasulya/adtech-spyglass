# Feature Specification: Preview Identity for Redirect Pops and In-Page Push Carriers

**Feature Branch**: `fable/029-preview-identity`

**Created**: 2026-09-08

**Status**: Complete

**Input**: Owner instruction, 2026-09-08: close the remaining [020 audit](../020-ad-format-verification-matrix/defects.md)
ledger to zero. Two of the open records are creative-preview records that no peer package covers —
DEF-245 (script-shaped pop creatives), and the preview half of DEF-180 (In-Page Push bids whose
creative travels in `bid.ext`). The format-tagging half of DEF-180 is Core work and stays out of
this package.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A redirect pop shows where it would have sent the visitor (Priority: P1)

An analyst opens a pop or clickunder response whose creative is a redirect script —
`window.open(...)`, `location.href = ...`, `top.location.replace(...)`. The script must never run,
but the analyst's actual question is "where does this go?". The Inspector already refuses the
navigation and already extracts the destination into an inert note. That note must be readable.

**Why this priority**: the destination is the only fact such a creative carries. A preview that
refuses the navigation and then shows nothing has answered no question at all, and the analyst falls
back to reading raw JSON in another pane — which is exactly what the Inspector exists to avoid.

**Independent Test**: analyse a pop pair whose `adm` is a redirect script; the destination URL is
visible on screen as inert text, and the sandbox still records a refused popup or navigation.

**Acceptance Scenarios**:

1. **Given** a redirect-script pop creative, **When** it is previewed, **Then** the destination it
   would have opened is visible as inert text.
2. **Given** the same creative, **When** the frame loads, **Then** the popup/navigation refusal is
   recorded exactly as before and no navigation occurs.
3. **Given** a request declaring a placeholder `1x1` banner, **When** the redirect note is shown,
   **Then** those declared dimensions do not collapse the note out of view.

---

### User Story 2 - An In-Page Push bid shows the card the SSP would assemble (Priority: P1)

An analyst opens an OpenRTB response whose winning bid carries neither `adm` nor a Native object,
because the creative travels in `bid.ext` under the product's own In-Page Push dialect. The engine
already claims and validates that bid. The preview must show the same creative the engine is
talking about.

**Why this priority**: the validator and the preview disagreeing about whether a bid has a creative
is the tool contradicting itself. `packages/core/dialects/inpage-push.js` states in its own header
that rendering this carrier "belongs to the frontend preview pipeline"; until now nothing did it.

**Independent Test**: analyse an In-Page Push pair; a push card with the bid's headline, body, icon
and hero appears, its click target is the dialect's click role, and remote assets stay blocked by
the frame policy with the blocking explained on screen.

**Acceptance Scenarios**:

1. **Given** a bid whose `bid.ext` carries a title-shaped or image-shaped field, **When** it is
   previewed, **Then** a push card is rendered instead of the generic empty state.
2. **Given** a bid that carries the roles under the dialect's alias names (`text`, `desc`,
   `picture`, `favicon`, `click`, `body`, `image_url`, `href`), **When** it is previewed, **Then**
   each role lands in its own slot — a headline carried as `text` is a headline, not a body line.
3. **Given** a flat vendor material feed, **When** it is previewed, **Then** its qualification is
   unchanged — no banner-shaped or pop-shaped wrapper becomes a push card as a side effect.
4. **Given** an In-Page Push bid that also carries `adm`, **When** it is previewed, **Then** the
   markup creative still wins.

---

### Edge Cases

- A `bid.ext` carrying only unrelated extension fields must not be claimed as a creative.
- A `bid.ext` with a title but no click URL renders with an inert link target; the missing click is
  the engine's finding to raise, not a reason to hide the card.
- A `bid.ext` supplied as an array or a string is not an object carrier and is ignored.
- A redirect pop whose request declares real banner dimensions keeps a readable note as well; the
  branch does not depend on the declared size being small.

## Requirements _(mandatory)_

- **FR-001**: When the preview resolves a redirect-script creative, the inert destination note MUST
  occupy a readable box regardless of the creative dimensions declared by the bid or the request.
- **FR-002**: The redirect-script branch MUST leave the frame's own zero-footprint style, the frame
  policy and the recorded sandbox refusals byte-identical to their previous behaviour.
- **FR-003**: An OpenRTB bid with no `adm` and no Native object, whose `bid.ext` carries a
  title-shaped or image-shaped field, MUST render as a push card — the same predicate
  `packages/core/dialects/inpage-push.js` uses to claim the bid for validation.
- **FR-004**: The In-Page Push roles MUST be resolved through that dialect's own alias table before
  rendering, so that a role name meaning one thing in the dialect and another in the flat-feed
  renderer cannot be misplaced.
- **FR-005**: The qualification gate for flat vendor materials MUST NOT be widened; a nested carrier
  is recognised by its own path, leaving banner-shaped and pop-shaped wrappers excluded as before.
- **FR-006**: Corpus expectations for the affected cases MUST state the specification-grounded
  target state, and their ledger records MUST list only the deviations that remain.
- **FR-007**: Where correcting an expectation vacates an axis cell the corpus previously covered,
  the cell MUST be re-covered by a case, never by reclassifying the cell as inapplicable.

### Success Criteria

- **SC-001**: All four DEF-245 pop cases pass the browser layer normatively, including their
  sandbox-refusal assertion, and the DEF-245 ledger record is removed.
- **SC-002**: The five In-Page Push carrier cases measure `kind=push`, `rendered=partial` and a
  visible headline marker; DEF-180 retains only its format-tagging deviation.
- **SC-003**: No other corpus case changes verdict at any layer.
- **SC-004**: The full repository gate passes, including type checking and lint.
- **SC-005**: Every axis cell the corpus covered before this feature is still covered by a case.

## Assumptions

- The In-Page Push carrier is the product's own documented dialect, not a third-party wire format;
  its field contract is `packages/core/dialects/inpage-push.js` and that module is the single source
  of the alias table this feature mirrors.
- The format-tagging half of DEF-180 (`format.formats: expected [inpage], got []` for an OpenRTB
  envelope carrying the widget/zone placement signal) is Core detection work and remains open.

## Out of Scope

- Any change to `packages/core/`, including In-Page Push format detection.
- Automatic inlining of remote push assets; the frame policy continues to block them, and the
  blocking continues to be explained on screen.
