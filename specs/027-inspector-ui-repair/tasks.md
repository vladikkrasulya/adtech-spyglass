# Tasks: Inspector Repair — Stale Results, Input Provenance and Creative Reach

**Input**: Design documents from `/specs/027-inspector-ui-repair/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/inspector-ui-boundary.md, quickstart.md

**Tests**: REQUIRED — Constitution VII and spec FR-009.

**Organization**: By user story. All product work is under `public/`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Read the constitution, the 020 defect records for DEF-200/201/202/203/205/245/260, the 012 preview contract and the 014 push-preview package; reproduce each defect on the committed engine.
- [x] T002 Work in an isolated worktree, because a peer session held the shared checkout for unrelated work throughout.

---

## Phase 2: User Story 1 — a failed analysis leaves no stale verdict (Priority: P1)

- [x] T003 [US1] `public/ortbtools.app.js`: route the structured-failure branch through the same `clearResultsForError()` the network-throw path already used; leave saved history untouched (FR-001).

## Phase 3: User Story 2 — re-pasting starts a new reading (Priority: P1)

- [x] T004 [US2] `public/ortbtools.app.js`: start new lexical provenance on every explicit and programmatic editor write, while a pretty-print keeps the pre-pretty bytes; cover paste-identical, paste-different, manual edit, example load, history restore, clear and pretty-print-then-analyse (FR-002).

## Phase 4: User Story 3 — every returned creative is reachable (Priority: P2)

- [x] T005 [US3] Extract the inline bid resolution into pure helpers and add `tests/creative-resolution.test.js` covering them at the public boundary (FR-003).
- [x] T006 [US3] Render a labelled, keyboard-operable selector over every seat/bid pair and feed material, resolving from the stored analysis without re-posting; no selector for a single creative (FR-003).

## Phase 5: User Story 4 — documented carriers show what they carry (Priority: P2)

- [x] T007 [US4] Widen destination and material resolution to the documented wrapper shapes, and gate push qualification on a visual asset so a PPCmate pop falls through to its inert destination (FR-004, FR-005).
- [x] T008 [US4] `public/modules/inspector/creative-classify.js`: detect a redirect-script pop additively, leaving `kind` and the sandbox refusal unchanged (FR-007).
- [x] T009 [US4] Give the creative frame a localized accessible name stating kind and dimensions; add all new strings in en/uk/ru (FR-006, FR-008).

## Phase 6: Ledger, verification and delivery

- [x] T010 Retire DEF-200, DEF-201, DEF-202, DEF-203, DEF-205 and DEF-260; keep DEF-245 with an exact signature; re-pin the two PPCmate pairs to the open DEF-107 (FR-009).
- [x] T011 Repoint fifteen private `/tmp` evidence paths in `tests/corpus/known-gaps.json` and `specs/014-push-creative-preview/quickstart.md` to the durable research archive (Constitution III).
- [x] T012 Run the browser layers separately, then `npm run ci`, then commit and push under the standing authorization.
- [x] T013 Write this package. Out of sequence — see plan.md, Constitution I.

## Evidence

- Narrow suites after the change: 94 tests, 94 pass across `creative-resolution`,
  `creative-preview-classify`, `inspector-reentrant` and `push-preview-browser`.
- Corpus non-browser layers: 615 tests, 0 failures, 3 transport skips.
- Corpus browser layers, run alone: 256 cases with an outcome, 0 unexpected failures; the twelve UX
  scenarios pass with no known gap, closing DEF-200 and DEF-205 at that layer.
- Repository gate: `npm run ci` exit 0 — 4057 tests, 3956 passes, 0 failures, 3 skips, 98
  expected-failure markers, no runner retries. Landed as `0f25f73`.

### What the verification caught, and what that cost

Three findings came from running the browser layer separately **before** the gate, and one from the
gate itself. None reached `main`.

1. Six cases had their ledger records retired while still failing. Four were DEF-245 (the display
   half does not work) and two were PPCmate pairs blocked on the open DEF-107. Records restored with
   exact signatures rather than the expectations adjusted.
2. A documented Adon3 material qualified as push through a bare `url` click key, but the card's own
   link chain did not read that alias, so the destination silently became `href="#"`.
3. Two pop fixtures declared a limitation describing a state the fix had already removed.
4. The gate rejected the first push: requiring both a visual asset and text broke 014 FR-005's
   icon-only and image-only materials. The correction is in research.md R2 — the discriminator is
   notification identity, not text.

## Requirement traceability

| Requirement | Tasks            |
| ----------- | ---------------- |
| FR-001      | T003             |
| FR-002      | T004             |
| FR-003      | T005, T006       |
| FR-004      | T007             |
| FR-005      | T007             |
| FR-006      | T009             |
| FR-007      | T008             |
| FR-008      | T009             |
| FR-009      | T005, T010, T012 |
