# Feature Specification: Inspector Repair — Stale Results, Input Provenance and Creative Reach

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013/021 precedent)

**Created**: 2026-09-08

**Status**: Complete

**Input**: Owner instruction, 2026-09-08, after the crosscheck and audio packages shipped: close the
Inspector UI cluster recorded by the [020 audit](../020-ad-format-verification-matrix/defects.md) —
DEF-200, DEF-201, DEF-202, DEF-203, DEF-205, DEF-245 and DEF-260.

This package is written **after** the change shipped as `0f25f73`. That ordering is a process
failure, not a style choice: the same session had required a peer to open a governed package for a
change of comparable size hours earlier, then landed this one without. The record is created here so
the shipped behaviour is governed rather than left undocumented; the omission itself is noted in
[plan.md](./plan.md) under Constitution I.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A failed analysis does not leave a stale verdict (Priority: P1)

An operator analyses a pair successfully, edits it, and analyses again. The second attempt fails
with a structured server error. The screen must not keep showing the earlier verdict as if it still
described what is in the editors.

**Why this priority**: A verdict that survives its own failure is the worst class of wrong answer —
it looks authoritative and describes a payload that is no longer there.

**Independent Test**: Analyse successfully, then drive a structured 429 for the same input; the
verdict, the stored analysis and the preview are all cleared and an explanation is shown.

**Acceptance Scenarios**:

1. **Given** a successful analysis on screen, **When** a later analysis of the same input fails with
   a structured error, **Then** the previous verdict, the stored analysis and the preview are
   invalidated and the operator is told why.
2. **Given** the same failure, **When** the operator looks at the history drawer, **Then** earlier
   saved entries are untouched — only the live result is cleared.

---

### User Story 2 - Re-pasting text starts a new reading of it (Priority: P1)

An operator pastes a request, pretty-prints it, notices duplicate-key findings, fixes the source
elsewhere and pastes clean text back. If the clean text happens to equal the pretty-printed form
byte for byte, the Inspector must still read the newly pasted bytes rather than the old ones.

**Why this priority**: Lexical findings (duplicate keys, byte-level provenance) are reported against
bytes the operator can no longer see. Reporting them against superseded bytes makes the tool
untrustworthy exactly where it claims byte-level precision.

**Independent Test**: Paste, pretty-print, then paste the identical clean text; analyse. No
duplicate-key finding survives from the earlier paste.

**Acceptance Scenarios**:

1. **Given** a pretty-printed request, **When** the operator pastes text equal to it, **Then** the
   analysis uses the newly pasted bytes.
2. **Given** any programmatic write (example load, history restore, clear), **When** it happens,
   **Then** provenance for that pane starts fresh.
3. **Given** a pretty-print, **When** it happens, **Then** the pre-pretty bytes remain the
   provenance until the operator supplies new ones.

---

### User Story 3 - Every returned creative can be reached (Priority: P2)

A response carries several bids across several seats, or a feed carries several materials. The
operator must be able to look at each one, not only the first.

**Why this priority**: The audit cannot account for creatives it cannot see; an operator checking a
multi-bid response was silently shown one of them.

**Independent Test**: Analyse a two-bid, two-seat response; select each bid in turn and confirm the
preview and price follow the selection.

**Acceptance Scenarios**:

1. **Given** more than one returned creative, **When** the analysis renders, **Then** a labelled,
   keyboard-operable selector lists them and the first is pre-selected.
2. **Given** exactly one creative, **When** the analysis renders, **Then** no selector appears.
3. **Given** a selection, **When** the operator changes it, **Then** the preview, the identity and
   the price follow it without re-posting the payload.

---

### User Story 4 - A documented vendor carrier shows what it carries (Priority: P2)

An operator pastes a documented vendor response — an EXADS wrapper, an Adon3 feed, a Kadam
clickunder, a PPCmate pop. The Inspector must show either the creative or its inert destination,
never an empty box, and never a pop dressed as a push notification.

**Why this priority**: A blank preview for a payload the product documents as supported reads as a
product failure and hides whether the response is usable at all.

**Independent Test**: Analyse each documented wrapper; each resolves to a visible card or an inert
destination line.

**Acceptance Scenarios**:

1. **Given** a documented vendor response wrapper, **When** it is analysed, **Then** its destination
   or card is visible and inert.
2. **Given** a PPCmate pop material with no visual asset, **When** it is analysed, **Then** it is
   shown as an inert destination, not as a notification card.
3. **Given** a material carrying only an icon or only an image, **When** it is analysed, **Then** it
   still renders as a card.

### Edge Cases

- A creative frame must carry an accessible name describing its contents, not the word "preview".
- A redirect-script pop is refused by the sandbox by design; the refusal is correct and unchanged.
  Showing the operator which creative was refused is a separate, still-open concern (DEF-245).
- Materials the selector newly exposes may carry remote images the sealed frame refuses; that is
  contract behaviour and is declared per creative rather than hidden.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: A structured analysis failure MUST invalidate the previous verdict, the stored
  analysis and the preview, and MUST NOT disturb saved history entries.
- **FR-002**: Any explicit or programmatic write to an editor MUST start new lexical provenance for
  that pane; a pretty-print MUST NOT.
- **FR-003**: When more than one creative is returned, the Inspector MUST offer a labelled,
  keyboard-operable selector over every seat/bid pair or feed material, resolving each from the
  stored analysis without re-posting.
- **FR-004**: A documented vendor response wrapper MUST resolve to a visible card or an inert
  destination.
- **FR-005**: A material qualifies as a push notification only when it carries a visual asset AND
  notification identity (text or a push-material id); a pop with neither MUST fall through to its
  inert destination, and a vendor banner bid MUST NOT be dressed as a card.
- **FR-006**: The rendered creative frame MUST carry a localized accessible name describing its
  contents and dimensions.
- **FR-007**: The sealed preview frame policy MUST be unchanged: nothing new executes, fetches, or
  loosens the CSP or sandbox.
- **FR-008**: Every user-visible string MUST exist in English, Ukrainian and Russian.
- **FR-009**: No corpus expectation MUST be weakened; a case whose deviation persists MUST keep a
  ledger record with an exact signature.

### Key Entities _(include if feature involves data)_

- **Lexical provenance**: the exact bytes an analysis was performed against, distinct from the text
  currently displayed.
- **Creative candidate**: one reachable seat/bid pair or feed material, addressable by index.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: DEF-200, DEF-201, DEF-202, DEF-203, DEF-205 and DEF-260 are retired from the 020
  ledger and their cases pass normatively on Core, HTTP and browser.
- **SC-002**: DEF-245 remains recorded with an exact signature, because only its detection half
  works; no case reports a retired record while still deviating.
- **SC-003**: The twelve locale/theme/viewport UX scenarios pass with no known gap.
- **SC-004**: `npm run ci` exits 0 with no runner retries.

## Assumptions

- The two PPCmate pairs keep a record against DEF-107: their preview is repaired, but their request
  half is a documented URL dialect with no decoder, so they stay blocked there.
- Materials exposed by the new selector whose remote images the frame refuses are declared per
  creative as partial renders; that is the 012 contract, not a defect.
- Shipped in **v1.20.0** (`76570e4`), deployed 2026-09-09 through the standing path: verified pre-deploy backup, readiness, smoke 19/19, container healthy.
