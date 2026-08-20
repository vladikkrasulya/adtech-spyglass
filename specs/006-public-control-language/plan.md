# Implementation Plan: Public Control Language

**Branch**: `codex/ui-control-cohesion-20260820` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-public-control-language/spec.md`

## Summary

Unify public buttons, disclosure triggers, popup surfaces, and compact responsive layouts through an
application-owned control layer layered after the vendored design system. Migrate route-specific
controls to semantic roles; repair keyboard, focus, label, and touch contracts; retain Inspector's
desktop density while making the same jobs reachable at the 320 px floor; validate with static,
DOM, and serial real-browser regressions in all supported locales.

## Technical Context

**Language/Version**: Browser JavaScript and CSS; Node.js `>=22.13.0` test/runtime baseline

**Primary Dependencies**: Existing vendored design system, vanilla DOM modules, jsdom, node:test,
Puppeteer/Chrome; no new runtime dependency

**Storage**: No schema or persisted-data change; existing browser preferences remain in their current
owners

**Testing**: Prettier, ESLint, `tsc --noEmit`, node:test static/jsdom suites, serial Puppeteer browser
acceptance, npm-pack smoke, isolated Docker production smoke

**Target Platform**: Public web application in evergreen desktop/mobile browsers; immutable Node 22
production image

**Project Type**: Server-rendered localized shells plus a vanilla-JavaScript SPA

**Performance Goals**: No additional request, stream, or runtime dependency; no new layout overflow
or duplicate rendering surface at supported viewport widths

**Constraints**: EN/UK/RU parity; 320 px responsive floor; WCAG-compatible contrast and keyboard
reachability; preserve existing validation, API, persistence, privacy, and desktop-density contracts

**Scale/Scope**: Shared control layer plus Account/About, Inspector, Search, Streams, modal/action
modules, navigation chrome, and regression coverage; Core and CLI excluded

## Constitution Check

_GATE: Passed before design and re-checked after design._

- **I — Spec Kit memory**: The release gate found that implementation had preceded a feature package.
  This package records the miss explicitly, owns the release evidence, and becomes the active package
  before commit; no unrelated assessment is included.
- **II — Evidence-backed truth**: Requirements map to computed-style measurements, DOM contracts,
  real-browser geometry, full CI, package smoke, Docker smoke, and later exact-SHA production smoke.
- **III — Privacy/security**: No collection, retention, auth, payload, or network boundary changes;
  test fixtures remain synthetic.
- **IV — Compatible contracts**: No Core finding, API, route, storage, or CLI semantic change.
- **V — Bounded architecture**: One CSS layer extends the existing design system; no framework,
  component runtime, state store, or build pipeline is added.
- **VI — Locale parity**: Static shells and Inspector templates move together across EN/UK/RU, with
  locale-aware geometry covered at 320 px.
- **VII — Proportional verification**: Static, jsdom, and browser regressions cover each changed
  interaction; complete CI and release smokes gate handoff.
- **VIII — Traceable release**: App patch version moves to 1.14.3 while Core/CLI remain unchanged;
  commit, push, and deployment use the user's explicit authorization and exact-SHA deployment path.

Post-design re-check: passed. The plan introduces no constitution exception or new durable
architectural decision requiring an ADR.

## Project Structure

### Documentation (this feature)

```text
specs/006-public-control-language/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ui-control-language.md
├── checklists/
│   ├── requirements.md
│   └── ux.md
└── tasks.md
```

### Source Code (repository root)

```text
public/
├── ortbtools-controls.css
├── ortbtools-shell.css
├── account.{en,uk,ru}.html
├── about.{en,uk,ru}.html
├── index.{en,uk,ru}.html
├── core/modal-host.css
└── modules/
    ├── inspector/
    ├── search/
    ├── stream/
    ├── topbar/
    ├── nav/
    ├── intel/
    └── other action/route owners

tests/
├── product-controls*.test.js
├── inspector-disclosure-contract.test.js
├── mobile-inspector-browser.test.js
├── account-preferences.test.js
├── lang-menu-disclosure.test.js
├── modal-control-labels.test.js
├── intel-*-accessibility.test.js
└── existing route/module regressions
```

**Structure Decision**: Keep ownership in the existing public shell and module graph. The shared
stylesheet owns only cross-product control tokens/states; each route continues to own its layout and
responsive refinements.

## Complexity Tracking

No constitution violation or additional architectural mechanism is required.
