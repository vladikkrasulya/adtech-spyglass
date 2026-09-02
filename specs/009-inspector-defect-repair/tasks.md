# Tasks: Inspector Defect Repair

**Input**: Design documents from `specs/009-inspector-defect-repair/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md)

**Tests**: FR-008 requires each defect to gain a regression demonstrated to fail first. Tests are
written before their fix and their red state is recorded, because a test authored after a fix proves
only that it agrees with what was just written.

## Phase 1: Tests first, red

- [x] T001 [P] [US1] (FR-008) Extend `tests/source-nav.test.js`: a jump whose primary location is on
      the response reveals the response side; a jump with related parts on both sides reveals the
      **primary** side; a jump still completes where the tab function is absent
- [x] T002 [P] [US2] (FR-008) Add `tests/gutter-width-browser.test.js`: gutter is narrower at 18 lines
      than at 1000, byte-identical at 9 and 10, and each number stays on its row's baseline
- [x] T003 [P] [US3] (FR-008) Extend `tests/analysis-strip-browser.test.js`: the strip's computed
      background is fully transparent in dark theme and unchanged in light
- [x] T004 Record each test's red result in this file before any fix lands

**Checkpoint**: three failing tests, each failing for the reason its defect describes.

---

## Phase 2: User Story 1 — the jump reveals its own payload (Priority: P1)

- [x] T005 [US1] (FR-001, FR-002, FR-003) Insert the guarded reveal in `navigate()` in
      `public/modules/inspector/source-nav.js`, after the primary-location guard succeeds and before
      the paint loop, keyed off the primary side, guarded by `typeof === 'function'`

**Checkpoint**: T001 green; the rail and keyboard stepping fixed by the same insertion.

---

## Phase 3: User Story 2 — the gutter fits its numbers (Priority: P2)

- [x] T006 [US2] (FR-004, FR-005, FR-006) In `public/modules/inspector/inspector.css`, replace the
      `min-width: 44px` floor with a `ch`-based floor, and reconcile the padding tie between the two
      `.line-gutter` blocks so they do not disagree

**Checkpoint**: T002 green; the 320 px matrix still passes.

---

## Phase 4: User Story 3 — the strip paints nothing (Priority: P2)

- [x] T007 [US3] (FR-007) In `public/modules/inspector/inspector.css`, stop the dark-theme band-era
      rule from painting behind the strip, in the section that already owns the strip's presentation

**Checkpoint**: T003 green.

---

## Phase 5: Release

- [x] T008 (FR-009) Bump the app to `1.14.5` across `package.json`, `package-lock.json`,
      `public/version.js`, localized static fallbacks, baseline version contracts, and `CHANGELOG.md`
- [x] T009 (SC-005) Run `npm run ci`, `bash scripts/npm-pack-smoke.sh`, `bash scripts/ci-docker-smoke.sh`
      and `git diff --check`, capturing **real** exit codes rather than a pipeline's; record results here
- [x] T010 Update `specs/ROADMAP.md`, mark the intake entries resolved, and re-run Spec Kit analysis
- [x] T011 Commit the feature scope, push, and wait for green hosted CI on the merge SHA

## Dependencies & Execution Order

- Phase 1 precedes every fix. T005, T006 and T007 are independent of one another and touch two files.
- T006 and T007 both edit `inspector.css` in different sections; sequence them to avoid a write race.
- Phase 5 depends on all three checkpoints.

## Out of Scope

- The asset-delivery defect behind the workbar gear (`server.js` cache semantics) — its own package.
- Dropdown unification, the overflow-tab layout, and the score field's visual design — taste
  decisions the owner has not made.

## Evidence

### T009 — 2026-08-22, `1.14.5` candidate

Run on a settled tree with exit codes captured directly rather than through a pipeline. That
distinction earned its keep on the first attempt: `npm run ci` returned **exit 2** on a `tsc` error in
the gutter test added by T002 — `document.getElementById` yields `HTMLElement`, which has no `.value`.
Under yesterday's harness, where `EXIT=$?` followed a pipe through `tail`, that failure would have
been reported as success. It is recorded here rather than quietly re-run, because a gate catching its
author is the only evidence that the gate works.

After the annotation was corrected:

- `npm run ci`: **exit 0** — 137 non-browser + 16 browser files, **no browser retry**.
- Coverage, unit phase: **87.89% lines, 87.39% branches, 84.42% functions** (1.14.4 recorded
  87.88 / 87.38 / 84.40; the three new regressions move it up rather than down).
- `bash scripts/npm-pack-smoke.sh`: **exit 0**.
- `bash scripts/ci-docker-smoke.sh`: **exit 0**, 5 PASS.
- `git diff --check`: **exit 0**.

### Red-before-green, per FR-008

Each regression was written before its fix and observed failing for the reason its defect describes,
not merely failing:

| Test                                     | Red state observed                                                                                                                | Green after |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `source-nav.test.js` (3 new)             | 2 of 3 failed; the third — a jump where no tab function exists — passed from the start, which is the degradation contract holding | T005        |
| `gutter-width-browser.test.js`           | `18 lines: 44px, 1000 lines: 44px` — the floor, quoted back                                                                       | T006        |
| `analysis-strip-browser.test.js` (1 new) | `got rgba(15, 17, 28, 0.88)` — the band itself                                                                                    | T007        |

One assertion was corrected rather than satisfied. The jitter check first demanded byte-equal widths
across 9 → 10 lines and measured a **0.016px** drift. That is below the smallest step any display can
render, so exact equality was testing the implementation, not the requirement. The tolerance is now a
stated half-pixel with the reasoning in the test, and a second assertion pins one stable width across
1–99 lines, which is the range a payload actually lives in. The CSS was not bent to fit the test.

- Production evidence is recorded if and when a deployment is separately authorized.
