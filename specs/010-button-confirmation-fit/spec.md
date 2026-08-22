# Feature Specification: Button Confirmation Fit

**Feature Branch**: `fix/button-flash-overflow`

**Created**: 2026-08-22

**Status**: In Progress

**Input**: Owner report, queued as Q8 in
[the findings intake](../../.specify/assessments/inspector-ui-consistency/intake.md): pressing copy
or format produces a confirmation whose text is overlaid by other content.

> Separate from [009](../009-inspector-defect-repair/spec.md) because that package states it covers
> three defects sharing one release, and 009 has already shipped as `1.14.5`. This is a fourth defect
> and its own release, so it carries its own record and its own rollback.

## User Scenarios & Testing

### User Story 1 - The confirmation stays inside its button (Priority: P1)

As someone who has just copied, formatted or cleared a payload, I see the action confirmed on the
control I pressed, without the confirmation covering the controls beside it.

**Why this priority**: the confirmation is the only feedback these actions give. When it paints over
its neighbours the moment of success is the moment the interface looks broken.

**Independent Test**: press each of copy, format and clear in the widest locale and measure whether
the button's content exceeds the button's box.

**Acceptance Scenarios**:

1. **Given** an icon-only control at its normal size, **When** its action succeeds, **Then** the
   confirmation renders entirely inside the button, horizontally and vertically.
2. **Given** a control with room for a word, **When** its action succeeds, **Then** the word is still
   shown, unchanged from today.
3. **Given** an assistive technology user, **When** an icon-only control confirms, **Then** the
   outcome is announced as the localized word, not as a bare glyph.
4. **Given** a confirmation in progress, **When** it expires, **Then** the control's previous
   accessible name is restored exactly — including having had none.

### Edge Cases

- Two presses in quick succession must not leave a stale confirmation or a stale accessible name; the
  pending restore is cancelled and the second confirmation takes over.
- A control that never carried an `aria-label` must not acquire one permanently.
- Locales differ in width; the guarantee must hold for the widest string the product ships, not for
  the one the developer happens to run.

## Requirements

### Functional Requirements

- **FR-001**: A confirmation MUST render entirely within the bounds of the control that produced it.
- **FR-002**: In-button confirmation MUST be preserved as the feedback mechanism; it MUST NOT be
  replaced by a corner notification, which is missed when the cursor is on the button.
- **FR-003**: Where a control has no room for the word, the outcome MUST still be announced to
  assistive technology as the localized word.
- **FR-004**: The control's prior accessible name MUST be restored when the confirmation expires,
  including the case where it had none.
- **FR-005**: Controls with room for the word MUST keep showing it.
- **FR-006**: A regression MUST measure the control's box, not the string's length, and MUST exercise
  the widest locale the product ships.
- **FR-007**: This release MUST ship as app `1.14.6`; Core and CLI do not move.

## Success Criteria

### Measurable Outcomes

- **SC-001**: For copy, format and clear, the confirmed control's content width and height do not
  exceed its own box by more than one rounding pixel.
- **SC-002**: The regression fails against the previous code with the overflow quoted in its message.
- **SC-003**: `npm run ci`, package smoke, Docker smoke and `git diff --check` all pass with real
  exit codes.

## Assumptions

- Russian carries the widest status string the product ships, so it is the honest worst case for a
  fit guarantee.
- The three affected controls are icon-only by design; widening them or letting them grow during a
  confirmation would shift their neighbours for the confirmation's duration, which trades one visual
  disturbance for another.
