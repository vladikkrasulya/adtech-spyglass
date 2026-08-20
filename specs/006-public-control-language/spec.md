# Feature Specification: Public Control Language

**Feature Branch**: `codex/ui-control-cohesion-20260820`

**Created**: 2026-08-20

**Status**: Complete

**Input**: User description: "Make buttons, layouts inside controls, and dropdowns cohesive, tidy, concise, and premium across ortbtools; implement the improved result."

> **Delivery record note**: The implementation and browser audit began before this feature package
> was created because the active Spec Kit pointer still named a completed feature. The release gate
> detected that governance miss. This package records the actual approved scope, acceptance evidence,
> and decisions without pretending the artifacts preceded the work.

## User Scenarios & Testing

### User Story 1 - One clear control hierarchy (Priority: P1)

As a user moving between ortbtools surfaces, I can immediately distinguish the primary action,
secondary actions, destructive actions, selections, and disclosures because they use one restrained
visual language and explicit interaction states.

**Why this priority**: Inconsistent controls make the product look unfinished and make consequential
actions harder to identify.

**Independent Test**: Inspect Account, About, Inspector, Search, Streams, Migrate, and representative
feature modals in light and dark themes; each control role remains visually consistent while the one
primary action retains priority.

**Acceptance Scenarios**:

1. **Given** a surface with primary and secondary actions, **When** the surface is opened, **Then** one
   filled action carries priority and quieter actions retain consistent geometry.
2. **Given** a disclosure is closed or open, **When** its state changes, **Then** the trigger visibly
   reflects that state and the panel remains bounded to the viewport.
3. **Given** an action is disabled, busy, destructive, focused, or hovered, **When** that state is
   present, **Then** the state is distinguishable without changing the action's meaning.

---

### User Story 2 - Complete phone layouts (Priority: P1)

As a phone user, I can reach the same validation settings, search hints, stream outcomes, and result
tabs without clipped actions, hidden decision columns, accidental overlap, or unexplained horizontal
scrolling.

**Why this priority**: A control that exists outside the viewport or behind another surface is
functionally absent.

**Independent Test**: Exercise EN, UK, and RU Inspector layouts at 320 px and common 360–414 px phone
widths, then exercise the compact 800×600 layout and desktop guard.

**Acceptance Scenarios**:

1. **Given** a 320 px viewport in any supported locale, **When** Inspector opens, **Then** all visible
   workbar controls fit without overlap and each popup stays inside 8 px viewport gutters.
2. **Given** a phone viewport, **When** Streams opens, **Then** the decision-bearing Findings value is
   visible without horizontal scrolling.
3. **Given** a phone search disclosure, **When** it opens, **Then** the panel has symmetrical gutters
   and no underlying action leaks around its edge.
4. **Given** the result-tab More disclosure at 800×600, **When** it opens, **Then** its actions receive
   pointer input rather than being painted behind the payload editor.

---

### User Story 3 - Keyboard and touch parity (Priority: P1)

As a keyboard, touch, or assistive-technology user, I can discover and activate every control that is
presented as actionable, and focus returns to a sensible trigger when a disclosure or modal closes.

**Why this priority**: Visual polish cannot compensate for controls that are unavailable to a whole
input mode.

**Independent Test**: Traverse native buttons, disclosures, history/saved actions, language/search
menus, modal fields, and the Intel builder using keyboard-only input and coarse-pointer sizing checks.

**Acceptance Scenarios**:

1. **Given** a visually actionable item, **When** it receives keyboard focus, **Then** it is a native or
   correctly exposed control with a visible focus indicator and expected Enter/Space behavior.
2. **Given** a modal or drawer opened from a control, **When** Escape or its close action is used,
   **Then** the surface closes and focus returns to its opener.
3. **Given** a coarse pointer, **When** contextual history or saved-item actions are exposed, **Then**
   their targets meet the product's minimum touch geometry.

### Edge Cases

- Localized labels can be longer than English and must not push the primary action off a 320 px row.
- Absolute disclosure panels must remain hidden while their native `details` owner is closed.
- A popup opening upward must not cross into a clipping/stacking context where another control wins
  pointer hit-testing; a downward popup must not run beyond its available results pane.
- A disabled stream row must not retain the same hover invitation as an actionable row.
- Standalone Account/About pages load less route CSS than the SPA and therefore cannot depend on
  Inspector-owned button or language-menu classes.
- Existing payloads, preferences, authentication, validation semantics, and saved data must remain
  unchanged by this presentation feature.

## Requirements

### Functional Requirements

- **FR-001**: Every public shell MUST load one ortbtools-owned control layer after the base design
  system.
- **FR-002**: Primary, secondary, destructive, ghost, selected, and disclosure controls MUST have
  consistent role-specific foreground, background, border, and geometry.
- **FR-003**: Controls MUST expose visually distinct hover, focus-visible, disabled, busy/loading, and
  open states wherever those states apply.
- **FR-004**: Filled control text MUST reach at least 4.5:1 contrast in light and dark themes, and
  control boundaries or indicators MUST remain perceivable against their surrounding surface.
- **FR-005**: Standard controls MUST use a 6 px radius and popup/menu surfaces a 10 px radius unless a
  component has an explicitly tested semantic exception.
- **FR-006**: English, Ukrainian, and Russian controls MUST preserve equivalent meaning, action
  hierarchy, and responsive reachability.
- **FR-007**: Standalone Account and About language, theme, and back controls MUST share one in-flow
  header action group; opening the language panel MUST not cover the page heading.
- **FR-008**: Inspector version and dialect selectors MUST remain available on phones through one
  compact Settings disclosure synchronized with the desktop controls.
- **FR-009**: Inspector's named result tabs MUST remain horizontally reachable while More remains
  visible; More MUST open upward on phone widths and downward where the preceding editor would
  otherwise cover it.
- **FR-010**: Search starter suggestions MUST be real keyboard-reachable buttons, and the mobile
  panel MUST use symmetrical 8 px gutters.
- **FR-011**: Streams MUST present time, kind, and Findings in the initial phone viewport without
  horizontal scrolling while preserving all desktop columns.
- **FR-012**: Shared and feature modals MUST associate labels with their fields, wrap action rows on
  phones, preserve focus containment where modal, and restore the opener on close.
- **FR-013**: History, saved-item, drawer, discovery, and similar button-like surfaces MUST use native
  controls or equivalent semantics without nested/intercepted keyboard actions.
- **FR-014**: The layout MUST have no horizontal page overflow, clipped visible control, or overlapping
  workbar action at 320, 360, 390, and 414 px; existing desktop density MUST remain intact.
- **FR-015**: The release MUST add regression coverage for shared control contracts, localized
  standalone shells, Inspector disclosure geometry, Search, Streams, modal labels, and keyboard
  behavior.
- **FR-016**: This backward-compatible application correction MUST ship as app version `1.14.3`
  without changing Core or CLI versions.

## Success Criteria

### Measurable Outcomes

- **SC-001**: At 320 px in all three locales, 100% of visible Inspector workbar controls are inside the
  viewport and no adjacent controls overlap.
- **SC-002**: At 320, 360, 390, and 414 px, the document width does not exceed the viewport by more than
  one rounding pixel.
- **SC-003**: At 800×600, every More-menu action wins pointer hit-testing over the payload editor; at
  320×568, the menu stays within 8 px gutters and opens above its trigger.
- **SC-004**: Search uses equal 8 px phone gutters and Streams shows Findings without horizontal
  scrolling at 390 px.
- **SC-005**: All covered controls can be reached and activated with keyboard-only input, and every
  tested close path restores focus to an active opener.
- **SC-006**: Light and dark primary control pairs meet or exceed 4.5:1 text contrast.
- **SC-007**: The complete repository gate, every serial browser file, npm package smoke, and isolated
  Docker production smoke complete successfully for the release candidate.

## Assumptions

- Existing vanilla browser modules, design-system tokens, routing, and modal infrastructure remain
  the architectural baseline; this feature does not introduce a framework or build pipeline.
- The supported responsive floor is 320 CSS pixels and the supported product locales remain EN, UK,
  and RU.
- Product control hierarchy is role-based: a route may have one visually dominant action, while
  filters and disclosures remain quieter even when selected/open.
- Validation logic, persistence schema, HTTP behavior, privacy boundaries, Core, CLI, and the
  unrelated OpenRTB compatibility assessment are out of scope.
- The visual audit and implementation evidence are synthetic and contain no production payloads or
  personal data.
