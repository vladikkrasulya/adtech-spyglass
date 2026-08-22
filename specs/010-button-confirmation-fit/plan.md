# Implementation Plan: Button Confirmation Fit

**Branch**: `fix/button-flash-overflow` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

## Summary

Keep the in-button confirmation and make it fit. Where a control has room, the localized word is
unchanged. Where it is an icon-only square, the button shows a check mark and the word moves to
`aria-label` for the confirmation's duration, so the outcome is still announced and the prior
accessible name is restored exactly.

## Technical Context

**Language/Version**: browser JavaScript; Node.js `>=22.13.0` test baseline

**Primary Dependencies**: none added

**Storage**: none touched

**Testing**: serial Puppeteer — the claim is that content fits a box, which jsdom cannot evaluate

**Target Platform**: public web application

**Project Type**: localized shells plus a vanilla-JavaScript SPA

**Constraints**: no locale string added or removed; app version moves, Core and CLI do not

**Scale/Scope**: one function, one new browser test, one version bump

## Constitution Check

_GATE: evaluated before design; re-checked after._

- **I — Spec Kit memory**: package opened before the record was written, from a queued report that
  was reproduced and measured first.
- **II — Evidence-backed truth**: the defect was measured (62px of content in a 26px box) rather than
  described, and the regression quotes that measurement back on failure.
- **III — Privacy/security**: no collection, retention, network or payload change.
- **IV — Compatible contracts**: no Core, CLI, API, route or storage change. Icon-only controls
  change what they display during a confirmation; that is the defect being repaired, specified in
  FR-001 and FR-005 rather than left implicit.
- **V — Bounded architecture**: one existing function, no new module or mechanism.
- **VI — Locale parity**: no string is added, removed or altered; the existing status strings are
  reused, and the regression runs in the widest locale rather than the developer's.
- **VII — Proportional verification**: one browser test, because the guarantee is geometric.
- **VIII — Traceable release**: app `1.14.6` with its CHANGELOG entry. Deployment is a separate
  authorization.

Post-design re-check: passed. No violation, no ADR required.

## Project Structure

```text
specs/010-button-confirmation-fit/
├── spec.md
├── plan.md
├── checklists/requirements.md
└── tasks.md

public/ortbtools.app.js              # flashButtonStatus
tests/button-flash-browser.test.js   # new
```

**Structure Decision**: the change stays inside `flashButtonStatus`, which already owns the
save/restore contract and already carries the reasoning for why the feedback is in-button. Putting
the fit rule anywhere else would split one behaviour across two owners.

## Complexity Tracking

One rejected alternative worth recording: letting the button grow to its content for the
confirmation's duration. It fixes the overflow without a glyph, but it moves every neighbouring
control for 1.5 seconds on every copy — trading a visual disturbance the user reported for one they
would report next. The check mark keeps the layout still.
