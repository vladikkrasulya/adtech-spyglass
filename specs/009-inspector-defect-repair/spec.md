# Feature Specification: Inspector Defect Repair

**Feature Branch**: `fix/inspector-defects-1145`

**Created**: 2026-08-22

**Status**: In Progress

**Input**: Owner testing production `v1.14.4`, reporting defects with screenshots. Queue kept in
[the intake](../../.specify/assessments/inspector-ui-consistency/intake.md); each entry here was
reproduced and adversarially verified before this package was opened.

> **Scope**: three reproduced defects that share a release. The asset-delivery defect behind the
> broken workbar gear is deliberately **not** here — it changes `server.js` cache semantics and
> carries a different blast radius, so it gets its own package and its own rollback.

## User Scenarios & Testing

### User Story 1 - A response finding takes me to the response (Priority: P1)

As someone reading a request payload, when I act on a finding that belongs to the response, the
editor shows me the response with the finding highlighted, rather than leaving me on a payload where
nothing is wrong.

**Why this priority**: the action silently does nothing visible. The user concludes the tool cannot
locate its own findings.

**Independent Test**: with the request tab active, trigger a jump to a response-side location by any
of the three routes — the finding's action, the source rail, keyboard stepping — and observe the tab.

**Acceptance Scenarios**:

1. **Given** the request tab is active and a finding's primary location is in the response, **When**
   the jump runs, **Then** the response tab becomes active and the location is highlighted.
2. **Given** a finding whose related parts span both payloads, **When** the jump runs, **Then** the
   tab that owns the **primary** location is shown, not whichever part is processed last.
3. **Given** the jump arrives, **When** geometry is measured, **Then** it is measured on a visible
   pane, so the highlight lands where the text is.

---

### User Story 2 - The line gutter is as wide as its numbers (Priority: P2)

As someone reading a payload, the line-number column takes the width its numbers need, so short
documents do not carry a wide empty indent.

**Why this priority**: cosmetic but constant — it is present on every payload the product renders.

**Independent Test**: measure the gutter's width at 1, 18, 99, 100 and 1000 lines.

**Acceptance Scenarios**:

1. **Given** a document of 18 lines, **When** it renders, **Then** the gutter is narrower than at
   1000 lines and the numbers keep their right alignment.
2. **Given** typing that crosses 9 → 10 lines, **When** the count changes, **Then** the width does
   not move, so the text does not jitter under the cursor.
3. **Given** any line count, **When** the gutter renders, **Then** each number stays on the baseline
   of its own text row.

---

### User Story 3 - The verdict strip shows no empty slab (Priority: P2)

As someone reading the verdict, the area beside the context chip is not a dark rectangle that looks
like a control that failed to load.

**Why this priority**: it reads as a defect in the data — the owner asked what was **supposed** to be
there, which is the cost of an unexplained empty box.

**Independent Test**: render a verdict in dark theme whose chips do not fill the strip, and inspect
the strip's computed background.

**Acceptance Scenarios**:

1. **Given** dark theme and a strip narrower than its container, **When** the verdict renders,
   **Then** no band is painted behind or beside the chips.
2. **Given** light theme, **When** the verdict renders, **Then** nothing changes from today.

### Edge Cases

- A jump whose target side cannot be resolved must leave the tab alone rather than guessing.
- The source-nav module runs under jsdom in tests, where the app's tab function does not exist; the
  jump must still complete.
- A document past 999 lines legitimately needs a wider gutter; the width may grow, but it must not
  overflow the editor at the 320 px floor.

## Requirements

### Functional Requirements

- **FR-001**: A jump MUST reveal the payload that owns its **primary** location before any geometry
  is measured or focus is moved.
- **FR-002**: The reveal MUST happen at the single choke point every jump passes through, so the
  finding action, the source rail and keyboard stepping all behave identically.
- **FR-003**: A jump MUST remain functional where the tab function is unavailable, degrading to
  today's behaviour rather than throwing.
- **FR-004**: The line gutter's width MUST follow the digit count of its highest line number.
- **FR-005**: The gutter MUST NOT change width across the 9 → 10 transition, so ordinary typing does
  not shift the text.
- **FR-006**: The gutter MUST keep each number on its text row's baseline, unchanged from today.
- **FR-007**: The verdict strip MUST paint no background of its own in either theme; the surface
  behind it belongs to its parent.
- **FR-008**: Each defect MUST gain a regression test that fails against the current code and passes
  after the change.
- **FR-009**: This release MUST ship as app `1.14.5`; Core and CLI do not move.

## Success Criteria

### Measurable Outcomes

- **SC-001**: With the request tab active, a response-side jump leaves the response tab active in
  100% of the three entry routes.
- **SC-002**: The gutter is measurably narrower at 18 lines than at 1000, and byte-identical in width
  at 9 and 10 lines.
- **SC-003**: The verdict strip's computed background is fully transparent in dark theme.
- **SC-004**: Three regression tests exist, each demonstrated to fail before its fix.
- **SC-005**: `npm run ci`, package smoke, Docker smoke and `git diff --check` all pass, with real
  exit codes captured rather than a pipeline's.

## Assumptions

- The workbar gear defect is a stale-stylesheet artifact of an open tab across a deploy, not a rule
  error; its repair belongs to the asset-delivery package and is out of scope here.
- The overflow-tab ("Ещё") layout and the score field's visual design are taste decisions the owner
  has not made yet; nothing here changes them.
- Locale parity is unaffected: none of the three changes touches a user-visible string.
