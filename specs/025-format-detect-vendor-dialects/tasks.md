# Tasks: Format Detection and Feed Dispatch Alignment

**Input**: Design documents from `/specs/025-format-detect-vendor-dialects/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/format-detection-boundary.md, quickstart.md

**Tests**: REQUIRED — Constitution VII and spec FR-006 demand the changed behaviour be pinned at the
public boundary in the same change. The 020 corpus already recorded each defect as an expected-failure
marker on the committed engine; those markers are the reproduction, retired only once the product
meets the spec expectation.

**Organization**: By user story. Work spans `packages/core`, the Inspector bundle, the 020 corpus and
the validator contract.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Read the constitution, specs/ROADMAP.md, the validator contract and the 020 records for DEF-160/DEF-181/DEF-161/DEF-460; confirm all four as recorded expected-failure markers on the committed engine.
- [x] T002 Map the three alias tables (detect.js, format-detect.js, rules-feed.js) and the Inspector material finder, the array dispatch in validateFeedResponse, and the mtype-only Native tagging; record the asymmetries and the DEF-107 coupling in research.md.

---

## Phase 2: User Story 1 — a material earns its tag under every accepted alias (Priority: P1)

- [x] T003 [US1] packages/core/format-detect.js: add `image_url`/`icon_url` to detectFeedFormat's image predicate so a material validated under those aliases earns the same push/inpage tag (FR-001).

**Checkpoint**: push-x-kadam-material-single and push-x-numeric-string-cpc tag `push`.

---

## Phase 3: User Story 2 — the clickurl alias is recognized everywhere (Priority: P1)

- [x] T004 [US2] Add `clickurl` to packages/core/detect.js looksLikeJsonFeedSingle, the packages/core/rules-feed.js validatePushMaterial click check, and the Inspector's findPushMaterial isMat and card link resolution in public/ortbtools.app.js, so the product's own in-page card feed sample is typed, validated and previewed consistently (FR-002).

**Checkpoint**: inpage-x-card-feed-single is typed and previews; inpage-x-card-feed-array draws no false click_url_required.

---

## Phase 4: User Story 3 — an array element is validated against its own shape (Priority: P1)

- [x] T005 [US3] packages/core/rules-feed.js: extract validateBidPriceMaterial(o, fp, findings) shared by the standalone bid-price object and the array path, and in validatePushMaterialsFeed dispatch an element whose detectSingleBidShape is `bidprice` to it with array-indexed paths, leaving generic materials on the push-material path (FR-003).

**Checkpoint**: push-x-richads-bare-array draws none of feed.push.id_required/bid_required/nurl_recommended.

---

## Phase 5: User Story 4 — a Native creative is tagged from its own body (Priority: P2)

- [x] T006 [US4] packages/core/format-detect.js: add admLooksLikeNative(adm) and, in the BidResponse path, tag `native` when a bid declares no mtype and its adm is a Native 1.x body; leave mtype-declared bids unchanged (FR-004).

**Checkpoint**: cover-input-push-response-only tags `native`.

---

## Phase 6: Ledger, versions and delivery

- [x] T007 Retire DEF-160, DEF-181, DEF-161 and DEF-460 from the ledger and remove the knownGap block from their six case files; pin the two-card array's residual DEF-201 selection gap that the DEF-181 record had masked; re-pin the three coupled DEF-107 Kadam cases to their residual request.url.no_decoder deviation; remove the two emptied ledger shards; survey every remaining recorded deviation with deviationVerdict() and confirm each still matches exactly (FR-006).
- [x] T008 Bump packages/core to 0.44.0 with the CLI dependency range and package-lock.json (0.43.0 reserved by 024; coordinated at merge); record the alias-and-dispatch alignment in specs/000-platform-baseline/contracts/core-validator.md and a Resolutions entry in the 020 defect report (FR-005, FR-007).
- [x] T009 Run the corpus layers (core, http, browser), the no-change guards (spec-refs, i18n-audit, format-detect, validator), prettier, eslint and tsc; then run `npm run ci`, commit the authored paths and push under the standing authorization; wait for the hosted run (FR-006, FR-007).

## Evidence

- Reproduction before the change (T001): the six cases were recorded expected-failure markers on the
  committed engine at their applicable layers.
- After the change: the six cases pass normatively — core+http report 0 failures over the closed
  cases, and the browser layer passes in real Chrome (the two-card array keeps only DEF-201).
- Coupling: the three DEF-107 Kadam cases were re-pinned to their residual decoder deviation and pass
  as known gaps at core, http and browser.
- Broad regression: corpus-lib, corpus-fixture-contract, full corpus-core and corpus-http run with 0
  failures; every other recorded deviation keeps its exact signature.
- No-change guards: spec-refs, i18n-audit, format-detect and validator suites pass; no finding id,
  level or message changed.
- Repository gate and hosted CI: recorded on the pull request.

## Requirement traceability

| Requirement | Tasks      |
| ----------- | ---------- |
| FR-001      | T003       |
| FR-002      | T004       |
| FR-003      | T005       |
| FR-004      | T006       |
| FR-005      | T008       |
| FR-006      | T007, T009 |
| FR-007      | T008, T009 |
