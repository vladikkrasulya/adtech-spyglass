# Feature Specification: Theme Cycle Visible Feedback

**Feature Branch**: `fix/theme-cycle-visible-feedback`

**Created**: 2026-08-20

**Status**: Verification

**Input**: Follow-up recorded during the 1.14.3 release: the shell theme control can be pressed and
leave the page looking identical, and that press is the first one a new visitor makes.

## User Scenarios & Testing

### User Story 1 - The first press does something visible (Priority: P1)

As a visitor whose system prefers light, when I press the theme control for the first time, the page
changes appearance, so I learn what the control does.

**Why this priority**: The theme control has three states — auto, light, dark — but only two possible
appearances. On a fresh session the stored state is auto; if auto already resolves to light, moving
to explicit light repaints nothing. The control's introduction to the user is a press that appears to
do nothing, which reads as a broken button rather than as a state machine.

**Independent Test**: With `prefers-color-scheme: light` and no stored preference, press the control
once and observe `data-theme`.

**Acceptance Scenarios**:

1. **Given** no stored theme and a light-preferring system, **When** the control is pressed once,
   **Then** the resolved theme becomes dark.
2. **Given** no stored theme and a dark-preferring system, **When** the control is pressed once,
   **Then** the resolved theme becomes light.
3. **Given** any starting point, **When** the control is pressed three times, **Then** the stored
   state returns to auto and the resolved theme has taken both values along the way.

---

### User Story 2 - The silent press is the honest one (Priority: P2)

As a user completing the cycle, when the press that returns me to auto does not repaint the page, I
understand why, because the control says so.

**Why this priority**: Three states over two appearances means at least one adjacent pair in the
cycle shares an appearance. This is arithmetic, not a defect: it cannot be removed, only placed. The
only question is which press absorbs it. Returning to auto from the explicit value that already
matches the system is the correct place — the appearance genuinely should not change, because the
user is returning to "follow the system" from a value identical to it.

**Independent Test**: Complete a full cycle and confirm the label and title change on every press,
including the one where `data-theme` does not.

**Acceptance Scenarios**:

1. **Given** the final press of a cycle, **When** it returns the state to auto, **Then** the label
   and title change even though the resolved theme may not.
2. **Given** any press, **When** it completes, **Then** the control's title names the state the next
   press will produce.

### Edge Cases

- The system preference can change while an explicit value is stored; the cycle must remain coherent
  and must not strand the user in a state it cannot leave.
- Blocked/private-mode storage degrades to auto on every read; the control must remain pressable and
  must not throw.
- The Account page exposes the same preference as three explicit radio buttons and has no cycle; it
  must keep writing the same `kt-theme` values and must not be changed by this feature.

## Requirements

### Functional Requirements

- **FR-001**: From auto, the control MUST move to the explicit value opposite the currently resolved
  theme, so the first press always repaints.
- **FR-002**: The cycle MUST remain three states and MUST return to auto after two explicit values.
- **FR-003**: The only press permitted to leave the resolved theme unchanged is the press that
  returns the state to auto.
- **FR-004**: The control's title MUST name the state the next press will produce, and its glyph MUST
  agree with that title.
- **FR-005**: The rail's textual theme label MUST continue to name the stored state, including auto.
- **FR-006**: EN, UK, and RU shells MUST receive the identical cycle; `index.*` and `about.*` are the
  surfaces that carry it.
- **FR-007**: Account preference radios MUST keep their existing behavior and storage contract.
- **FR-008**: Regression coverage MUST assert the cycle from both system preferences, not from the
  one the developer machine happens to have.

## Success Criteria

### Measurable Outcomes

- **SC-001**: With `prefers-color-scheme: light` and no stored preference, one press changes
  `data-theme` from `light` to `dark`.
- **SC-002**: With `prefers-color-scheme: dark` and no stored preference, one press changes
  `data-theme` from `dark` to `light`.
- **SC-003**: Across one three-press cycle from either system preference, the stored state returns to
  auto and the resolved theme takes both values.
- **SC-004**: Exactly one press per cycle leaves `data-theme` unchanged, and it is the press into
  auto.
- **SC-005**: The complete repository gate, package smoke, and Docker production smoke pass for the
  release candidate.

## Assumptions

- The head IIFE in the localized shells remains the owner of the `kt-theme` key; no new theme owner,
  store, or framework is introduced.
- Six files carry the cycle: `public/index.{en,uk,ru}.html` and `public/about.{en,uk,ru}.html`.
  `public/account.*.html` carries a different, radio-based control and is out of scope.
- This is a backward-compatible application correction; stored values keep their existing meanings,
  so a user's saved preference survives the change.
