# Tasks: Close the remaining product questions

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, ADR-019 and `contracts/`.
**Status**: In Progress. Check a task only after its stated output exists and is verified.

## Phase 1 — Contract and evidence foundation

- [x] T001 Record the eight accepted residuals, source-backed boundaries and compatibility consequences in `spec.md`, `inventory.md` and `specs/decisions/ADR-019-residual-product-boundaries.md` (FR-001, FR-016).
- [x] T002 Define ownership, storage entities, HTTP/pure inspection and session recovery contracts in `plan.md`, `data-model.md` and `contracts/` (FR-002, FR-008, FR-012, FR-015).
- [x] T003 Freeze the nineteen witness IDs and exact browser/journey matrix in `witness-manifest.json` and `matrix-manifest.json` before executions (FR-006, FR-007, FR-014, FR-017).
- [x] T004 Complete requirements-quality checklists and read-only cross-artifact analysis; resolve blocking findings and pass `tests/spec-kit-contract.test.js` before product edits (FR-016, FR-018).

## Phase 2 — US1: Durable session revocation

Owner: desktop_matrix. Root owns integration outside the auth composition/shutdown sections of `server.js`. UI owner edits only the separate DialectMappings section of `db.js`.

- [x] T005 [US1] Add actual child-process restart/crash regressions for logout deletion failure, including legitimate second-user continuity, in `tests/session-recovery.test.js` (FR-002, FR-003, SC-001).
- [x] T006 [US1] Implement bounded private versioned recovery state, atomic file/directory fsync, exclusive ownership, dirty-start fencing and uncertain-state invalidation in `lib/session-recovery.js` (FR-002, FR-003).
- [x] T007 [US1] Integrate versioned keyed lookup identities and durable known-session revocations into `auth.js` and the Sessions section of `db.js`; preserve hot denial and cookie/DEK cleanup on failures (FR-002).
- [x] T008 [US1] Integrate account invalidation/reset and reject stale pre-reset login proofs at mint; gate/drain authentication before clean shutdown in `auth.js`, `modules/auth/handler.js` and the auth shutdown section of `server.js` (FR-002, FR-003).
- [x] T009 [US1] Cover DB/journal/fsync/read failures, corrupt/unknown state, missing key, concurrent owner, anonymous unknown-cookie growth, oversized-state/cap exhaustion, controlled login→reset→mint, in-flight shutdown/checkpoint order, expiry, clean continuity and old-image hydration in focused auth tests (FR-002, FR-003, SC-001).
- [x] T010 [US1] Independently review the final auth diff for bypasses and regression, reproduce the original trigger and controls, and record security/backup/restore consequences in `verification.md` (FR-016, FR-017).

## Phase 3 — US2: Observable sample readiness

- [x] T011 [US2] Replace both fixed sample pauses with response-and-editor readiness after the actual menu action in `tests/clear-resets-results-browser.test.js` (FR-004).
- [x] T012 [US2] Add a held-response regression and bounded failure diagnostics; run the unchanged clear/error assertions without retries and record the result in `verification.md` (FR-004, SC-002).

## Phase 4 — US3: Edge configuration consistency

- [x] T013 [US3] With the owner's Cloudflare browser session, inspect and disable automatic Web Analytics injection for ortbtools.com only; retain saved-setting readback in the external evidence bundle (FR-005).
- [x] T014 [US3] Verify fresh actual browser response and console, unchanged application CSP and first-party telemetry; record any missing access as open in `inventory.md` (FR-005, FR-017, SC-003).

## Phase 5 — US4: Complete interface execution matrix

- [x] T015 [P] [US4] Prepare isolated synthetic accounts/records and native Chromium/Firefox/Safari harnesses plus an available-device inventory under the external evidence bundle (FR-006, FR-007).
- [x] T016 [US4] Add meaningful saved-library/Inspector-drawer cases for empty, locked/unlocked, legacy, long title, filters, failure, load/edit/delete/navigation and account isolation in `tests/saved-history-journeys-browser.test.js` (FR-006).
- [x] T017 [US4] Add history ring-50, format/context, reload, two-tab, quota and clear-versus-server-record controls in the same focused harness (FR-006).
- [x] T018 [US4] Execute the frozen desktop viewport/browser/locale/theme matrix, inspect screenshots and repair measured interface defects in the responsible existing modules/styles (FR-006, FR-007).
- [ ] T019 [US4] Execute actual browser zoom, keyboard and screen-reader journeys and available physical-device journeys; preserve actual observations and exact unavailable prerequisites in `matrix-results.json` and `verification.md` (FR-007, FR-017, SC-006).

## Phase 6 — US5: Value-independent mapping lifecycle

Owner: ui_consistency_audit. Coordinate mapping-related Core files with linux_gate; no edits to the Sessions section of `db.js`.

- [x] T020 [US5] Add explicit scope/version validation and account-scoped create/read/edit/delete/default/cache behavior in `modules/dialects/handler.js` and DialectMappings sections of `db.js` (FR-008, FR-009).
- [x] T021 [US5] Implement exact-first normalized-path fallback for nine roles, unknown-version safety and legacy semantics in `packages/core/dialects/user-dialect-runtime.js` and its consumers (FR-008, FR-009).
- [x] T022 [US5] Implement atomic schema1/schema2 import/export with explicit scope and duplicate-path conflict handling in the existing dialect handler (FR-009).
- [x] T023 [US5] Expose scope and complete read/edit/remove/activation flows in `public/modules/inspector/dialect-label.js`, `public/account.js` and locale resources; field-scope writes omit observed values (FR-008, FR-009, FR-016).
- [x] T024 [US5] Add real SQLite API→runtime regressions covering two accounts/two dialects, legacy/null/literal-wildcard/metadata rows, precedence, conversion, cache and malformed atomic import (FR-008, FR-009).
- [x] T025 [US5] Execute browser mapping lifecycle in EN/UK/RU with multiple values, exact override and account/format controls; record results in `verification.md` (FR-006, SC-004).

## Phase 7 — US6: Explicit raster preview completion

- [x] T026 [US6] Extend `public/modules/inspector/creative-assets.js` to a deduplicated bounded resource manifest for image/poster, responsive and inline/embedded CSS image references; preserve full-document head/styles/doctype (FR-010, FR-011).
- [x] T027 [US6] Integrate Native/push/banner actions, resource inventory and per-resource success/error/retry in the creative-render lifecycle of `public/ortbtools.app.js` with locale parity (FR-010, FR-011, FR-016).
- [x] T028 [US6] Bind batch cancellation and late-result suppression to current creative generation/AbortSignal while preserving probe, static-analysis and reveal identity (FR-011).
- [x] T029 [US6] Add real rendered-image/style, selected-second-creative, dedup/cap/partial/retry/cancel and no-advertiser-browser-network regressions; retain HTTP SSRF/raster limits and authentication tests (FR-010, FR-011, SC-004).
- [x] T030 [US6] Update explicit resource-request privacy disclosure in current privacy/about documentation in all supported locales (FR-011, FR-016).

## Phase 8 — US7: Grounded SChain inspection

Owner: linux_gate for pure Core/rules; root for HTTP and public inspection action, coordinated with the creative lifecycle owner.

- [x] T031 [US7] Add pure bounded structured/serialized/query parsing and inspection in `packages/core/inspection/`, with explicit decoding, source locations and malformed/duplicate outcomes (FR-012).
- [x] T032 [US7] Implement repeated seller identity, semantic valid-copy conflict, typed declared-sender comparison and grounded optional-field guidance in existing SChain rules; preserve IDs and factual video/CTV node counts (FR-012, FR-013).
- [x] T033 [US7] Cover current/legacy/OpenRTB3 paths, encoding, key/node order, account case, malformed copies, complete single node, optional metadata and node-count controls in focused Core tests (FR-012, FR-013, SC-005).
- [x] T034 [US7] Finalize executable Core/HTTP response contracts; add bounded public inspection routes and typed analysis context validation in `modules/inspection/handler.js` and `server.js` (FR-012, FR-015).
- [x] T035 [US7] Add operator-visible serialized inspection and explicit sender controls using existing modal/lifecycle patterns, localized unknown/source/count/finding presentation and browser regressions (FR-012, FR-013, FR-016).

## Phase 9 — US8: Nineteen witnesses and declared-route relevance

- [x] T036 [US8] Generate synthetic direct MakeRequests harness cases for every frozen ID, with cloned inputs, isolated triggers, controls and declared transformation/fanout oracles; store owned harness/manifest without copied third-party trees (FR-014).
- [x] T037 [US8] Execute all nineteen cases in the verified pinned-source/toolchain network-none environment; retain command, hashes, outputs and unsuccessful attempts (FR-014, FR-017, SC-005).
- [x] T038 [US8] Apply only supported corpus dispositions, preserve the old audit generation and record per-ID before/after evidence in `witness-results.json` (FR-014).
- [x] T039 [US8] Add pure declared-route applicability and bounded pinned profile catalog in `packages/core/inspection/`, with absent/unsupported/incompatible context controls and source provenance (FR-015).
- [x] T040 [US8] Integrate typed declared-route selection/readback in analysis HTTP and public UI; test that payload labels/endpoints never imply actual routing and unknown remains visible (FR-015, FR-016).

## Phase 10 — Integrated convergence and delivery

- [x] T041 Update affected baseline contracts, README/CHANGELOG/ROADMAP and current about/privacy/API documentation in EN/UK/RU; bump independent app/Core/CLI versions and lockfile consistently (FR-016, FR-018).
- [x] T042 Run combined focused tests, lint, format, typecheck and Spec Kit contract checks; resolve failures without peer reverts or hidden retries (FR-017, FR-018).
- [x] T043 Run full required Linux CI, normative corpus across Core/HTTP/browser plus UX/a11y, package and immutable-image checks; retain exact revision/results (FR-018).
- [x] T044 Conduct independent convergence for auth, mapping/assets, SChain/route/witnesses and cross-browser evidence; resolve reportable defects and rerun affected gates (FR-016, FR-018).
- [ ] T045 Commit the integrated reviewed patch and pass exact hosted required checks, retaining any first-attempt failures (FR-017, FR-018).
- [ ] T046 Verify a fresh canonical backup, deploy via `scripts/deploy.sh`, inspect health/revision, public/local smoke and affected public UI behavior; use canonical rollback on regression (FR-018, SC-007).
- [ ] T047 Reconcile every inventory/matrix/witness row and current release records to actual evidence; publish a truthful final report, leaving real missing prerequisites open (FR-001, FR-017, SC-006, SC-007).

## Dependencies and parallel execution

T001–T004 are the product-edit gate. Afterwards US1/US2, US5/US6 and US7/US8 run in parallel with root browser preparation and Cloudflare access. Within a story, tests/contract precede integration; the list is not permission to race writes in a shared file. T034 precedes public inspection consumption; T039 and T034 precede T040. T025 and final US4 executions require the integrated UI. T010 and T044 require completed patches. T041–T047 follow integration in order, with focused fixes reopening only affected gates. External access never blocks unrelated work and never counts as a pass.
