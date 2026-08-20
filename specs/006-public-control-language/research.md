# Research: Public Control Language

## Decision 1: Add one application-owned control layer

**Decision**: Load `public/ortbtools-controls.css` immediately after the vendored design system in
every localized public shell.

**Rationale**: The design system deliberately stays generic, while Account, About, and SPA routes
need the same product roles and states. A product layer gives those roles one owner without coupling a
standalone page to Inspector CSS.

**Alternatives considered**:

- Continue patching each route independently — rejected because it recreates drift and undefined
  classes.
- Edit the vendored design system — rejected because product-specific semantics do not belong in the
  vendor/base layer.
- Introduce a component framework — rejected because the current DOM/CSS architecture is sufficient.

## Decision 2: Role hierarchy precedes component identity

**Decision**: Primary, secondary, danger, ghost, selected, disclosure-open, disabled, and busy states
share role tokens and state rules; route CSS may refine size or placement but not redefine meaning.

**Rationale**: Users need to identify consequence and priority across surfaces, not memorize each
route's private palette.

**Alternatives considered**:

- Make every action filled for a more visibly “designed” interface — rejected because equal emphasis
  destroys hierarchy.
- Preserve all legacy route colors — rejected because several failed contrast or changed meaning by
  route.

## Decision 3: Use native disclosure/button semantics

**Decision**: Prefer native buttons and `details` disclosures with normal tab order; remove menu roles
where full ARIA menu keyboard behavior is not implemented.

**Rationale**: Native controls provide keyboard activation, focusability, accessibility-tree
exposure, and disabled behavior without parallel event systems.

**Alternatives considered**:

- Add roles/tabindex/key handlers to every clickable `div`/`span` — rejected as more code with more
  opportunities for semantic drift.
- Implement roving ARIA menus everywhere — rejected because these panels contain mixed form controls
  and follow disclosure, not application-menu, interaction.

## Decision 4: Directional More menu by responsive mode

**Decision**: Keep More outside the horizontally scrolling named-tab wrapper; open upward at widths
up to 600 px and downward at 601–1100 px.

**Rationale**: Phones place the tab strip near the bottom of the initial viewport, while compact
desktop/tablet layouts place the payload editor immediately above the results pane. One direction at
all widths either clips the phone menu or paints tablet actions behind the editor.

**Alternatives considered**:

- Raise z-index only — rejected because the tablet failure was also an ancestor overflow/clipping
  boundary.
- Keep the whole tab bar horizontally scrolling — rejected because More's popup cannot escape a
  horizontal scroller with visible vertical overflow.

## Decision 5: Ship as app 1.14.3

**Decision**: Treat the compatible, user-visible control/accessibility correction as an application
patch release; Core 0.35.0 and CLI 0.1.1 remain unchanged.

**Rationale**: The public application contract changes visibly and compatibly, while no package API or
caller requirement changes.

**Alternatives considered**:

- Deploy another SHA under app 1.14.2 — technically supported by SHA-keyed images but rejected because
  it weakens the versioning contract and release communication.
- Minor release — rejected because this repairs and normalizes existing capabilities rather than
  adding a new product workflow.
