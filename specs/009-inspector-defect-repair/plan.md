# Implementation Plan: Inspector Defect Repair

**Branch**: `fix/inspector-defects-1145` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

## Summary

Three reproduced defects, each with a verified cause and a small change: reveal the owning payload
tab at the one function every jump passes through; lower a gutter width floor that sat above every
realistic digit count; and stop a band-era theme rule from painting a background the current layout
does not want. Each ships with a regression test demonstrated to fail first.

## Technical Context

**Language/Version**: Browser JavaScript and CSS; Node.js `>=22.13.0` test baseline

**Primary Dependencies**: none added

**Storage**: none touched

**Testing**: `node:test` with jsdom for the jump contract; serial Puppeteer for gutter geometry and
the strip's computed background — both are measurements a DOM test cannot make

**Target Platform**: public web application

**Project Type**: localized shells plus a vanilla-JavaScript SPA

**Constraints**: 320 px responsive floor; no locale strings change; the app version moves, Core and
CLI do not

**Scale/Scope**: one JS insertion, three CSS declarations, three new tests, one version bump

## Constitution Check

_GATE: evaluated before design; re-checked after._

- **I — Spec Kit memory**: package opened before the edits, from a queue whose entries were each
  reproduced and adversarially verified first.
- **II — Evidence-backed truth**: every cause here was reproduced in a browser, not inferred; each
  fix arrives with a test that fails first, which is the claim being checkable rather than asserted.
- **III — Privacy/security**: no collection, retention, network or payload change.
- **IV — Compatible contracts**: no Core, CLI, API, route or storage change. One deliberate
  behavioural change is user-visible and specified: the payload tab now moves when a jump lands on
  the other side. That is the requested contract, stated in FR-001 rather than slipped in.
- **V — Bounded architecture**: source-nav gains a guarded call to an app global it already reaches
  for in the same style; no new module, layer or dependency.
- **VI — Locale parity**: no user-visible string is added, removed or altered.
- **VII — Proportional verification**: narrowest test per defect — jsdom where behaviour is logical,
  a real browser where the claim is geometric.
- **VIII — Traceable release**: app `1.14.5` with its CHANGELOG entry, which the changelog gate
  enforces. Deployment is a separate authorization and is not implied by this plan.

Post-design re-check: passed. No violation, no ADR needed.

## Project Structure

```text
specs/009-inspector-defect-repair/
├── spec.md
├── plan.md
├── checklists/requirements.md
└── tasks.md

public/modules/inspector/
├── source-nav.js        # FR-001..003 — one guarded insertion in navigate()
└── inspector.css        # FR-004..007 — gutter floor, padding tie, strip background

tests/
├── source-nav.test.js               # extended: the jump reveals the owning side
├── gutter-width-browser.test.js     # new: width tracks digits, stable across 9→10
└── analysis-strip-browser.test.js   # extended: strip paints no background in dark
```

**Structure Decision**: each fix lands in the file that already owns the behaviour. The jump fix goes
in `navigate()` rather than in the dispatcher because the rail and keyboard stepping reach the same
function by different routes, and fixing the dispatcher would leave those two still jumping into a
hidden pane.

## Complexity Tracking

One asymmetry worth naming: the gutter and strip claims are geometric and theme-scoped, so their
tests need a real browser and cannot run in the fast jsdom tier. That puts two of the three
regressions in the serial browser phase, which is slower and historically flakier. It is the correct
trade — a jsdom assertion about computed width would prove nothing, since jsdom does not lay out.
