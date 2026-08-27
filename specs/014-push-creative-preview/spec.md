# Feature Specification: Push Creative Preview

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013 precedent)

**Created**: 2026-08-26

**Status**: Complete

**Input**: Owner report, production `v1.16.0`, 2026-08-26, immediately after 013 shipped: «на
пушах 1 головне це іконка, а друге головне це картика … зараз помилок немає, але креатив все
ще не малюється, скільки можна вже це виправляти!?» — a push response now analyzes cleanly,
but the creative preview panel still answers "No renderable creative (adm/iurl) in response".
Reproduced in a real browser before this package was opened: the preview source selection
knows only OpenRTB shapes (winning bid, its markup, its structured native object, the sample
image fallback); a push material has none of those fields, so the panel falls into the empty
state even though the material's icon, image, title, description, and click destination — the
whole creative — sit right there in the payload. For push traffic, the icon is the #1 creative
element and the large image is #2 (owner's ranking); a preview that shows neither is not a
preview.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The push creative is drawn, icon and image first (Priority: P1)

An integration operator analyzes a single-object push response and opens the creative panel.
Instead of "no renderable creative", they see a synthetic push-notification card built from
the material itself: the icon, the headline, the description text, the large image, and the
click destination spelled out — the same way the panel already draws a synthetic card for
structured native creatives.

**Why this priority**: This is the reported defect and the whole value of the panel for push
traffic. The two elements the owner ranks first — icon, then image — must be visible.

**Independent Test**: In a real browser, paste a synthetic push material into the response
editor, analyze, and inspect the preview panel: a sandboxed frame is mounted, its document
contains the icon and image addresses from the material, and the empty-state message is gone.

**Acceptance Scenarios**:

1. **Given** a single push material carrying icon, image, title, description, and a click
   link, **When** it is analyzed, **Then** the creative panel mounts the synthetic
   notification card showing that icon and image with the title and description, labeled as a
   synthetic push render, and the empty-state message does not appear.
2. **Given** the same material, **When** the card is rendered, **Then** it travels the same
   sandboxed, probed, statically-scanned path as banner and native creatives — the frame
   policy and its sandbox attributes are byte-identical to today's.
3. **Given** the same material, **When** the card renders, **Then** the click destination is
   visible on the card, and interacting with the card is measured exactly as a click on a
   native synthetic card is.

---

### User Story 2 - The list form draws its first material (Priority: P2)

The operator analyzes a push-materials array. The preview draws the first material of the
list, mirroring how the panel already previews the first bid of an OpenRTB response.

**Why this priority**: The list form is the other wire shape of the same traffic; leaving it
on the empty state would re-create the 013 asymmetry inside the preview.

**Independent Test**: Analyze `[material]` and assert the same card appears as for the
standalone object.

**Acceptance Scenarios**:

1. **Given** a push-materials array whose first element carries icon/image/title/link,
   **When** it is analyzed, **Then** the preview shows the same synthetic card the standalone
   object gets.

---

### User Story 3 - The price chip tells the truth for push (Priority: P3)

The preview's price chip currently derives from the OpenRTB winning bid, so a push response
shows a zero/placeholder price. When a push material is what's being previewed, the chip
shows the material's own cost-per-click value.

**Why this priority**: Cosmetic next to US1, but the chip sits beside the creative and a
zero price on a priced material is a small standing lie (same class as the 013 format chip).

**Independent Test**: Analyze a material with a numeric cpc and read the chip text.

**Acceptance Scenarios**:

1. **Given** a push material with `cpc: 0.01`, **When** it is analyzed, **Then** the price
   chip shows that value (formatted as money) instead of a zero or placeholder.

---

### Edge Cases

- Material with icon but no image (or image but no icon): the card renders with what exists;
  a missing optional slot collapses, and the panel never regresses to the empty state while
  at least one creative element (icon, image, title, or description) is present.
- Material whose image URL is unreachable or returns non-image bytes: the frame shows the
  browser's normal broken-image behavior, exactly as a banner creative with a dead asset does
  today; no new fetch path or retry machinery is introduced.
- All creative text (title, description) and URLs are payload-controlled input and MUST be
  escaped in the synthetic card — a material whose title contains markup must render it as
  text, not execute it (same discipline as the native synthetic renderer).
- OpenRTB responses, clickunder/link-feed/value-feed/bid-price/bid-redirect responses, and
  genuinely unrenderable payloads keep today's preview behavior unchanged, including the
  wording of the empty state.
- Discovered during implementation (belongs to the list-form story): the response editor
  rejected ANY array root at the door with "root is not an object", while the engine behind
  it has validated array feeds since before 013 — so the list form could never be analyzed
  from the page at all. The response pane MUST accept an array root; the request pane stays
  strict (no known request shape has an array root, and its error wording is unchanged).
- The safe-demo blur/reveal flow applies to the push card the same way it applies to native
  and banner creatives.
- Corrected during implementation (Constitution II): the preview frame's policy blocks ALL
  remote images by design — banner art from a CDN renders empty too, and the page says so
  ("External resources are blocked"). Remote creative bytes become visible only through the
  existing explicit "load assets" action, which fetches them server-side (guarded proxy,
  allowlists and limits unchanged) and re-renders the frame with inlined data. The push card
  MUST inherit that standing action (its icon and image counted and fetchable in one click),
  and the card's layout, text, and click destination MUST be visible immediately. No new
  fetch path, no automatic fetching, no frame-policy change of any kind.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: When the analyzed response is a recognized push material (the 013 baseline
  shape), the creative panel MUST render a synthetic push-notification card containing the
  material's icon, title, description, large image, and click destination, visibly labeled
  as a synthetic push render; the card MUST inherit the existing explicit "load assets"
  action so the icon and image become visible with one click, exactly as remote banner art
  does.
- **FR-002**: The list form MUST preview its first material with the same card the
  standalone object gets.
- **FR-003**: The card MUST travel the existing sandboxed/probed/statically-scanned creative
  pipeline; the frame's sandbox attributes and policy MUST remain byte-identical, and no
  server-side asset fetching may be introduced.
- **FR-004**: Every material-sourced string placed into the card MUST be escaped; no field
  of the payload may inject markup or script into the synthetic document.
- **FR-005**: A material missing optional creative parts MUST render with the parts it has;
  the empty state MUST NOT appear while at least one creative element is present.
- **FR-006**: The preview's price chip MUST show the material's cpc/price for push results.
- **FR-007**: Preview behavior for every non-push payload MUST remain unchanged.
- **FR-008**: A browser regression test MUST cover the standalone and list forms and the
  escaping requirement, and the change MUST be verified visually (before/after screenshots
  actually looked at) per the measure-then-look rule.

### Key Entities

- **Push material** (from spec 013): the creative payload itself — icon, image, title,
  description, click destination, price, identifiers.
- **Synthetic creative card**: a self-contained document generated from a structured
  creative (precedent: the native synthetic render), fed to the same frame pipeline as
  markup creatives.
- **Preview pipeline**: classification → synthetic document → probed sandboxed frame →
  behavior/static analysis; unchanged by this feature except for the new source.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Analyzing a push material with icon and image shows both in the creative panel
  in the same analysis flow, with zero occurrences of the empty-state message.
- **SC-002**: The browser regression suites for the creative preview pass unchanged for
  OpenRTB creatives, and the new push cases pass in the same real-browser harness.
- **SC-003**: The price chip shows the material's price for 100% of push analyses with a
  numeric cpc/price.
- **SC-004**: Before/after screenshots demonstrate the panel going from the empty state to
  the rendered card for the same payload.

## Assumptions

- The owner's ranking (icon first, image second) governs the card's visual hierarchy; the
  layout is otherwise a typical push-notification card and its exact styling is a technical
  decision recorded in the plan.
- First-material preview for the list form mirrors the existing first-bid precedent; a
  material selector for multi-material arrays is out of scope until asked for.
- The synthetic card's internal label (mirroring "native · synthetic render") lives inside
  the creative frame and follows that precedent in language and casing; no localized UI
  strings are added or changed.
- Scope is the browser application and its browser tests only: no engine, API, message-key,
  or storage surface changes; Core stays at 0.36.0.
