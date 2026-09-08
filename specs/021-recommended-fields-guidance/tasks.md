# Tasks: Recommended Fields Are Guidance, Not Errors

**Input**: Design documents from `/specs/021-recommended-fields-guidance/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/finding-levels.md, quickstart.md

**Tests**: REQUIRED — Constitution VII and spec FR-008 demand regression tests in the same change;
the 020 corpus is the second net and must be updated in the same change.

**Organization**: By user story. All work is inside `packages/core`, the existing top-level suites,
the 020 corpus and the governing documents; no scaffolding phase is needed.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Read constitution v2.1.0, specs/ROADMAP.md, specs/000-platform-baseline/contracts/core-validator.md and the 020 package (defects.md, the four ledger records, the 21 cases); confirm the class on the committed tree with `node --test tests/corpus-core.test.js` (the four groups report as known gaps) — 2026-09-08.
- [x] T002 Pin the normative basis: fetch OpenRTB 2.6 at commit 403cbba, AdCOM 1.0 at df8ba06 and OpenRTB 3.0 FINAL; record the quoted rows and line numbers in research.md (R1) and the level mapping (R2).

---

## Phase 2: User Story 1 — a spec-valid request is not rejected (Priority: P1)

- [x] T003 [US1] Update the tests that pinned the old levels and add boundary regressions in tests/validator.test.js and tests/rules-25-audit.test.js: absent device is one warning (FR-002), device without ip/ua is warning on site/app and info on dooh-only (FR-003), no channel is a warning with status warnings (FR-001); make the tests/cli.test.js fixture carry a real error so the exit-1 path stays deterministic.
- [x] T004 [US1] packages/core/rules-request.js: `request.no_site_or_app` → warning; the device block fires `request.device_required` alone (warning) for an absent object and the ip/ua findings at warning (info on dooh-only) for a present one (FR-001, FR-002, FR-003).
- [x] T005 [US1] packages/core/rules-request-30.js: `request.30.context.no_site_or_app` and `request.30.context.device_required` → warning, ip/ua → warning with a dooh-only info grade, `device_invalid` stays error; regressions appended to tests/ortb30.test.js (FR-004).
- [x] T006 [US1] Rewrite the eight request-side texts in packages/core/messages/{en,uk,ru}.json to name the basis and the consequence without calling the omission required; `node --test tests/i18n-audit.test.js` green (FR-007).

**Checkpoint**: `node --test tests/validator.test.js tests/rules-25-audit.test.js tests/ortb30.test.js tests/cli.test.js tests/crosscheck-audit.test.js tests/i18n-audit.test.js tests/rules-plugins.test.js tests/detection-mechanism.test.js tests/rules-etap-b-2.test.js` — 384 tests, 384 pass, 0 fail (2026-09-08).

---

## Phase 3: User Story 2 — an empty-seatbid no-bid is a no-bid (Priority: P2)

- [x] T007 [US2] Regressions in tests/validator.test.js and tests/ortb30.test.js: empty seatbid without nbr is info and clean, crosscheck yields only the id check, wrong id is still a mismatch, neither seatbid nor nbr keeps the error and `crosscheck.no_response`; the old test that pinned the crit is rewritten (FR-005, FR-006).
- [x] T008 [US2] packages/core/rules-response.js and rules-response-30.js: `seatbid_empty_no_nbr` → info; packages/core/crosscheck.js: an empty seatbid array early-returns the id finding, `crosscheck.no_response` only when neither a seatbid array nor nbr exists; the two response texts rewritten in three locales (FR-005, FR-006, FR-007).

---

## Phase 4: User Story 3 — the ledger tells the truth (Priority: P3)

- [x] T009 [US3] Remove DEF-100, DEF-103, DEF-114 from tests/corpus/known-gaps.json and DEF-302 from tests/corpus/known-gaps/mut-field-shape.json; strip `knownGap` from their 21 cases (FR-008).
- [x] T010 [US3] Run the Core guard survey (research.md R5): exactly eight guards lose only the device pattern (seven DEF-101, one DEF-151); remove that pattern from their core/http/browser signatures and retitle DEF-101 (FR-008).
- [x] T011 [US3] Corpus layers: `node --test tests/corpus-lib.test.js tests/corpus-report.test.js tests/corpus-axes.test.js tests/corpus-fixture-contract.test.js tests/corpus-core.test.js tests/corpus-http.test.js` — 749 tests, 580 pass, 0 fail, 3 skipped (transport probes), 166 expected-failure markers (known gaps); browser layer over the 29 affected cases with `CORPUS_CASE` — outcome recorded in T014 (FR-008).

---

## Phase 5: Contract, decision, versions and delivery

- [x] T012 Record the level policy: specs/000-platform-baseline/contracts/core-validator.md section "Recommended-Field Levels (021, ADR-016; Core 0.39.0)", specs/decisions/ADR-016-recommended-fields-are-guidance.md with its DECISIONS.md row, a ROADMAP row and a README route, and a "Resolutions" section in specs/020-ad-format-verification-matrix/defects.md naming the four groups (FR-009).
- [x] T013 Bump packages/core/package.json to 0.39.0, packages/cli/package.json to `^0.39.0` and package-lock.json accordingly; `npm ls @ortbtools/core` resolves the workspace link (FR-009).
- [x] T014 Run `npm run ci` on the settled tree, record the runner totals and any retry here, then commit the authored paths and push to `main`; wait for the hosted run and record its result (FR-008, FR-009). Outcome: `npm run ci` exit 0 on 2026-09-08 — 4025 tests, 3856 pass, 0 fail, 0 cancelled, 3 skipped (Core transport probes), 166 expected-failure markers, no runner retries; committed and pushed under the standing authorization; the hosted run for that commit is recorded in the delivery receipt next to the CI log in the private research archive (`ortbtools-research/2026-09-08-021-recommended-fields/`).

## Evidence

- Narrow suites (T003–T008): 384 tests, 384 pass, 0 fail.
- Corpus non-browser layers (T011): 749 tests, 580 pass, 0 fail, 3 skipped, 166 expected-failure
  markers.
- Browser layer over the 29 affected cases (T011): 28 of 29 passed on the first run; the one
  failure was the two-bid case `video-ctv-26-dynamic-pod`, whose later-bid selection gap
  (DEF-201) had been recorded inside its DEF-100 record — re-attached to DEF-201 and green on
  re-run; the full browser layer then ran inside `npm run ci`.
- Independent review (three read-only lenses: normative grounding, code and consumers,
  governance and locales): one major finding (research.md misstated the 2.x wrong-type device
  level) and one major consumer finding (`docs/api-v1.md` example showed the retired error
  level), both corrected before the gate; nits (fixture notes, a test comment, the "seven
  formats" count, the FR-007 wording, section citations in the 3.0 texts) corrected as well.
- Repository gate (T014): `npm run ci` exit 0 — 4025 tests, 3856 pass, 0 fail, 0 cancelled, 3
  skipped, 166 expected-failure markers, no runner retries.

## Requirement traceability

| Requirement | Tasks                  |
| ----------- | ---------------------- |
| FR-001      | T003, T004             |
| FR-002      | T003, T004             |
| FR-003      | T003, T004             |
| FR-004      | T005                   |
| FR-005      | T007, T008             |
| FR-006      | T007, T008             |
| FR-007      | T006, T008             |
| FR-008      | T009, T010, T011, T014 |
| FR-009      | T012, T013, T014       |
