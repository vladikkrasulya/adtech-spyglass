# Tasks: Push Creative Preview

**Input**: Design documents from `/specs/014-push-creative-preview/`

**Prerequisites**: plan.md, spec.md, quickstart.md

**Tests**: REQUIRED (FR-008, Constitution VII) — written first, red before implementation.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Record baseline: before-state JSON (`hasIframe:false`, empty-state text) is already captured via the scratchpad harness; run `node --test tests/creative-preview-browser.test.js` and note the green pass count in Evidence (FR-007 baseline)

## Phase 2: Foundational

_(none — the change rides entirely on existing pipeline seams; no shared refactor needed)_

## Phase 3: User Story 1 — The push creative is drawn (Priority: P1) 🎯 MVP

- [x] T002 [US1] Create tests/push-preview-browser.test.js on the creative-preview harness pattern: response-only analyze of the 013 synthetic material → assert iframe mounted with `sandbox="allow-scripts"`, srcdoc contains the icon URL, image URL, title, description, `push · synthetic render` label, and probe channel; empty-state text absent; escaping vector — material with `title: "<img src=x onerror=alert(1)>"` appears in srcdoc only entity-escaped, and the frame document contains no payload-injected element; icon-only and image-only materials still mount the card (FR-001, FR-003, FR-004, FR-005); run — must be red
- [x] T003 [US1] In public/ortbtools.app.js add `findPushMaterial()` (013 signature: price+click+creative key; object → itself, array → first matching element) and `renderPushToHtml()` (self-contained doc, escapeHtml on every material string, icon-first hierarchy per the owner, hero image second, click-URL footer, label `push · synthetic render`), and wire the seam in the adm-selection block after `bid.native`/`findAdm()` with `previewDims` defaulting to 360×300; run T002 to green (FR-001, FR-003, FR-004, FR-005)

## Phase 4: User Story 2 — The list form draws its first material (Priority: P2)

- [x] T004 [US2] Extend tests/push-preview-browser.test.js with the `[material]` array case asserting the same card as the standalone object (FR-002); red → green via the already-wired `findPushMaterial` array branch (adjust if red persists)

## Phase 5: User Story 3 — Price chip (Priority: P3)

- [x] T005 [US3] Extend the suite: material with `cpc: 0.01` → `#mPrice` shows the formatted value, not `BID`/zero (FR-006); implement the chip line in the same seam in public/ortbtools.app.js; green

## Phase 6: Polish & Cross-Cutting

- [x] T006 Re-run existing preview suites: `node --test tests/creative-preview-browser.test.js tests/clear-resets-results-browser.test.js` — unchanged green (FR-007)
- [x] T007 Measure-then-look: capture the after screenshot with the scratchpad harness, OPEN it and look (icon visible first, image second, no clipping); record before/after in Evidence (FR-008)
- [ ] T008 Run `npm run ci`; add the 014 row to specs/ROADMAP.md (In Progress → Complete when done) and a CHANGELOG bullet under the next unreleased app version; commit ONLY authored paths (public/ortbtools.app.js, tests/push-preview-browser.test.js, specs/014-push-creative-preview/, specs/ROADMAP.md, CHANGELOG.md, .specify/feature.json is untracked)
- [ ] T009 Release through the standing path when gates settle (push → hosted CI → fresh backup → exact-SHA deploy → live verification on the production Inspector), then close the 014 rows and report version/tag/SHA/gates

## Dependencies & Execution Order

T001 → T002 (red) → T003 (green) → T004 → T005 → T006 → T007 → T008 → T009. No parallel
tasks — one file and one suite dominate.

## Implementation Strategy

Ship all three stories in one change: US1 without US3 leaves the zero-price lie next to the
new card, and the array case is three lines once `findPushMaterial` exists. MVP checkpoint
after T003 if anything derails.

## Evidence

- T001: creative-preview suite baseline 1/1 green; before-state JSON `{"hasIframe":false,"text":"No renderable creative (adm/iurl) in response"}` (real Chrome, 2026-08-26).
- T002 red first (`expected a preview iframe for the push material`); T003 green: card mounts through `buildProbedSrcdoc` with `sandbox="allow-scripts"`, probe channel present, icon/image/title/description/link in srcdoc, hostile title entity-escaped, icon-only and image-only mount.
- T004 exposed an adjacent defect: `assertJsonRoot` rejected EVERY array root in the response pane, so the list form was never analyzable from the page; fixed by an `allowArrayRoot` parameter scoped to the response pane (request pane unchanged). Array case green.
- T005 green: `#mPrice` shows the material cpc via the push seam (`Number(cpc ?? price)`, USD default).
- Discovered and specced: the frame CSP (`img-src data: blob:`) blocks remote images by design; the card inherits `maybeOfferAssetInlining` from the markup branch — the suite pins the offer with count 2. Spec edge case corrected accordingly (Constitution II).
- T006: creative-preview + clear-resets suites 3/3 green.
- T007 measure-then-look: after.png (safe-demo blur + "Show creative" over the painted card) and after-revealed.png (label, icon top-left, headline, body, hero image, click URL footer) captured and LOOKED AT — hierarchy icon→image per the owner. Suite: push-preview-browser 1/1 green (7 scenarios).
