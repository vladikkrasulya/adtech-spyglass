# Tasks: Crosscheck Tells the Truth About Price and Floor

**Input**: Design documents from `/specs/022-crosscheck-price-floor/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/price-floor-resolution.md, quickstart.md

**Tests**: REQUIRED — Constitution VII and spec FR-009 demand regression tests in the same change,
written before the product code and recorded failing first.

**Organization**: By user story. All work is inside `packages/core`, the top-level suites, the 020
corpus and the governing documents.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Read the constitution, specs/ROADMAP.md, the platform validator contract and the 020 records for DEF-104/DEF-105/DEF-110; confirm all three on the committed engine (they report as known gaps in tests/corpus-core.test.js at 82c0426).
- [x] T002 Pin the normative basis: OpenRTB 2.6 at 403cbba (§3.2.4 Imp, §3.2.12 Deal, §4.2.3 Bid, §6.2.5 example), OpenRTB 3.0 FINAL (Item and Deal flr/flrcur at lines 517 and 586) and AdCOM 1.0; record the quotes and the derived rules in research.md.
- [x] T003 Because a peer session held the main checkout for unrelated work throughout, create an isolated git worktree at 82c0426 with its own node_modules and do every step below there; integrate afterwards.

---

## Phase 2: User Story 1 — a malformed price gets no floor verdict (Priority: P1)

- [x] T004 [US1] Write tests/crosscheck-price-floor.test.js first, covering the price predicate through the public boundary for [], [1], true, false, '', '1.25', -1, -0.0001, NaN, Infinity, null, undefined and 0, in both protocol families, and asserting that validate() and crosscheck() agree; record it failing for the named reasons (FR-001, FR-002).
- [x] T005 [US1] packages/core/crosscheck.js: replace `Number.isFinite(Number(priceRaw))` with `typeof priceRaw === 'number' && Number.isFinite(priceRaw) && priceRaw >= 0`, remove the coercion from both downstream price reads, and state the reason in the comment (FR-001, FR-002).

**Checkpoint**: the six DEF-110 mutation cases pass normatively; the auction summary counts only real bids.

---

## Phase 3: User Story 2 — the deal a bid names governs its floor (Priority: P1)

- [x] T006 [US2] packages/core/rules/price-floor/index.js: extract the PMP-deal match out of resolveFloor() into an exported resolveDealFloor(bid, imp) with the SPEC_DEFAULT_CUR constant hoisted, and have resolveFloor() call it first; prove the extraction is behaviour-preserving by running tests/rules-etap-b-2.test.js and tests/floor-audit.test.js unchanged (FR-004, FR-005).
- [x] T007 [US2] packages/core/crosscheck.js: resolve the deal floor through the shared function before the impression-floor logic, treat a matched deal's floor as explicit at any value including 0, and read its currency from the deal rather than the impression (FR-003, FR-004, FR-005).

**Checkpoint**: both DEF-104 cases pass normatively and both engines name the same effective floor.

---

## Phase 4: User Story 3 — an OpenRTB 3.0 pair is read from its real fields (Priority: P2)

- [x] T008 [US3] packages/core/crosscheck.js: projectItem30() reads `item.flrcur`; correct the stale field name in the projection's own doc comment and in the tests/crosscheck-audit.test.js fixture that had matched the typo (FR-006).
- [x] T009 [US3] packages/core/index.js: project a paired 3.0 request to `{cur}` for the ORTB_RESPONSE plugin pass so the currency rule reads the request's accepted list; carry nothing else, and leave the 2.x path untouched (FR-007).

**Checkpoint**: bn-banner-30-adcom passes normatively; a genuinely disallowed currency still fires.

---

## Phase 5: Ledger, versions and delivery

- [x] T010 Retire DEF-104, DEF-105 and DEF-110 from tests/corpus/known-gaps.json and remove the knownGap block from their nine case files; survey every remaining recorded deviation with deviationVerdict() and confirm all seventy-two still match exactly, with nothing re-pinned (FR-009).
- [x] T011 Bump packages/core to 0.41.0 with the CLI dependency range and package-lock.json; record the floor and price rules in specs/000-platform-baseline/contracts/core-validator.md and a Resolutions entry in the 020 defect report; add the negative-floor observation to the 020 cleanup backlog (FR-008, FR-010).
- [x] T012 Run the focused suites, the corpus layers, prettier, eslint and tsc; then integrate onto main, run `npm run ci`, commit the authored paths and push under the standing authorization; wait for the hosted run (FR-009, FR-010).

## Evidence

- Reproduction before the change (T004): the new suite failed 19 of 30 assertions, every failure
  matching a named DEF-110, DEF-104 or DEF-105 symptom.
- Extraction proof (T006): tests/rules-etap-b-2.test.js and tests/floor-audit.test.js, 78 of 78 pass
  with the extraction in place and no other change.
- Focused suites after the change: 405 tests, 405 pass, 0 fail across the new file plus validator,
  crosscheck-audit, rules-etap-b-2, rules-plugins, ortb30, spec-refs, i18n-audit, cli and floor-audit.
- Corpus non-browser layers: 731 tests, 580 pass, 0 fail, 3 skipped, 148 expected-failure markers
  (eighteen fewer than before, exactly the nine retired cases across the Core and HTTP layers).
- Guard survey: all seventy-two remaining recorded deviations still match their exact signatures;
  none drifted, none started passing, nothing was re-pinned.
- Independent verification: three read-only agents reproduced all three defects as closed against the
  changed engine, re-ran every claimed suite and confirmed the counts, and found no finding id, level,
  message or ordering change. The orchestrating session then re-probed thirteen price shapes and
  twelve deal-floor edge cases itself, plus the auction summary and both protocol paths.
- Repository gate and hosted CI: recorded in the delivery receipt beside this feature's evidence.

## Requirement traceability

| Requirement | Tasks            |
| ----------- | ---------------- |
| FR-001      | T004, T005       |
| FR-002      | T004, T005       |
| FR-003      | T007             |
| FR-004      | T006, T007       |
| FR-005      | T006, T007       |
| FR-006      | T008             |
| FR-007      | T009             |
| FR-008      | T011             |
| FR-009      | T004, T010, T012 |
| FR-010      | T011, T012       |
