# Tasks: Button Confirmation Fit

**Input**: Design documents from `specs/010-button-confirmation-fit/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md)

**Tests**: FR-006 requires a regression that measures the box. It was written before the fix and its
red state is quoted below.

## Phase 1: Test first, red

- [x] T001 (FR-006, SC-002) Add `tests/button-flash-browser.test.js`: press copy, format and clear in
      the widest locale and assert each control's content fits its own box in both axes

## Phase 2: User Story 1 — the confirmation fits

- [x] T002 [US1] (FR-001, FR-002, FR-005) In `flashButtonStatus` in `public/ortbtools.app.js`, keep
      the word for controls that have room and show a check mark for icon-only controls
- [x] T003 [US1] (FR-003, FR-004) Move the word to `aria-label` for the confirmation's duration and
      restore the prior accessible name exactly, including the case where there was none

## Phase 3: Release

- [x] T004 (FR-007) Bump the app to `1.14.6` across `package.json`, `package-lock.json`,
      `public/version.js`, localized static fallbacks, baseline version contracts, and `CHANGELOG.md`
- [x] T005 (SC-003) Run `npm run ci`, `bash scripts/npm-pack-smoke.sh`, `bash scripts/ci-docker-smoke.sh`
      and `git diff --check` with real exit codes; record results here
- [x] T006 Update `specs/ROADMAP.md` and mark the intake entry resolved
- [ ] T007 Commit the feature scope, push, and wait for green hosted CI on the merge SHA

## Dependencies & Execution Order

T001 precedes T002. T003 completes the same function and is not separable from it in practice; it is
listed apart because it answers a different requirement — the accessibility cost of replacing a word
with a glyph.

## Evidence

### T001 — red state observed

`format-json: confirmation "отформатировано" overflows its button horizontally (62px of content in
26px)` — the measurement, quoted by the test itself rather than described.

### T005 — 2026-08-22, `1.14.6` candidate

Settled tree, exit codes captured directly rather than through a pipeline.

- `npm run ci`: **exit 0** — 137 non-browser + 17 browser files, **no browser retry**.
- Coverage, unit phase: **87.89% lines, 87.38% branches, 84.42% functions**. Branch coverage is
  0.01pp below 1.14.5's 87.39 — the new branch in `flashButtonStatus` (icon-only vs not) is exercised
  in one direction by the browser test and in the other by the existing suite's non-icon callers, but
  the browser phase is not counted in the unit-phase figure. Stated rather than rounded to "unchanged".
- `bash scripts/npm-pack-smoke.sh`: **exit 0**.
- `bash scripts/ci-docker-smoke.sh`: **exit 0**, 5 PASS.
- `git diff --check`: **exit 0**.

- Production evidence is recorded if and when a deployment is separately authorized.
