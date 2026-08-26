# Tasks: Single-Object Push Response Recognition

**Input**: Design documents from `/specs/013-single-push-recognition/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/feed-push-single.md, quickstart.md

**Tests**: REQUIRED — the spec (FR-007) and Constitution VII demand regression tests in the same
change; test tasks precede implementation within each story and must fail first.

**Organization**: By user story, per spec priorities. All work is inside `packages/core` plus the
two existing top-level suites; no scaffolding phase is needed.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Record the green baseline: run `node --test tests/detection-mechanism.test.js tests/validator.test.js tests/i18n-audit.test.js` on the untouched tree and note the pass counts in this file's Evidence section (Constitution II/VII: the count authority is the runner, and a pre-existing red must be reported, not inherited)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shape-neutral refactor both stories build on; behavior must not change here.

- [x] T002 Extract the per-material body of `validatePushMaterialsFeed()` in packages/core/rules-feed.js into a shared helper `validatePushMaterial(m, num, pathPrefix, findings)`; array path calls it per element with prefix `[i]`/`num=i+1`; re-run `node --test tests/validator.test.js` to prove zero behavior change (same findings, same paths)

**Checkpoint**: refactor invisible at the public boundary; user stories can begin.

---

## Phase 3: User Story 1 — A normal push response analyzes cleanly (Priority: P1) 🎯 MVP

**Goal**: the single-object push material is claimed as a push-materials feed response; no
`payload.unknown_type` on the mainstream shape.

**Independent Test**: quickstart §1 — synthetic replica through public `validate()`; type is
`Push-Materials Feed Response (single)`, no unknown-type finding.

### Tests for User Story 1 (write first, must fail)

- [x] T003 [P] [US1] Add detectType matrix cases to tests/detection-mechanism.test.js: (a) synthetic replica object → `Vendor Feed Response`; (b) non-claims stay `unknown`: `{link}` alone, `{title,link}` (no price key), `{cpc,link}` (no creative key); (c) precedence non-regressions: bid-price object with `link`+`title` still routes via its unique key, `{imp:[...]}` / `{seatbid:[...]}` / `{result:{listing:{...}}}` / `{version,items}` payloads carrying stray push-like keys keep their current types (FR-001, FR-002)
- [x] T004 [P] [US1] Add end-to-end case to tests/validator.test.js: synthetic replica (quickstart §1 key set) through `validate()` → `result.type === 'Push-Materials Feed Response (single)'`, no `payload.unknown_type`; same material as `[replica]` → `Push-Materials Feed Response` with equivalent findings modulo path prefix (FR-004 parity pin; FR-007 synthetic-replica regression)

### Implementation for User Story 1

- [x] T005 [US1] Extend `looksLikeJsonFeedSingle()` in packages/core/detect.js with the push-material predicate (price key `cpc|price` AND click key `click_url|link` AND creative key `title|description|image|image_url|icon|icon_url`), placed after the four unique-key checks, with a comment stating the owner's 2026-08-26 baseline ruling (FR-001)
- [x] T006 [US1] In packages/core/rules-feed.js add the `'push'` branch to `detectSingleBidShape()` (checked after valuefeed/bidprice/bidredirect unique keys) and a `validatePushSingle()` path that calls the shared `validatePushMaterial()` once with root-relative paths and `num=1`, returning type `'Push-Materials Feed Response (single)'`; run T003/T004 tests to green

**Checkpoint**: US1 independently shippable — the reported defect is gone.

---

## Phase 4: User Story 2 — Alias field names are understood (Priority: P2)

**Goal**: `tId`/`image`/`icon` satisfy the identifier/image/icon presence checks in both shapes;
absent-under-all-names keeps existing findings; price type tiers unchanged.

**Independent Test**: alias matrix through `validate()` per pair, single and array shapes.

### Tests for User Story 2 (write first, must fail)

- [x] T007 [P] [US2] Add alias matrix to tests/validator.test.js: for each pair (`id`/`tId`, `image_url`/`image`, `icon_url`/`icon`/`nurl`) × both shapes: present-under-alias → no corresponding finding; absent under all names → existing finding fires; both names present → single finding stream, no duplicate; alias present with non-string value → existing finding fires (FR-003)
- [x] T008 [US2] Add single-shape price-tier cases to tests/validator.test.js: `cpc:"0.01"` → `feed.push.bid_string_type`; `cpc:"abc"` → `feed.push.bid_not_numeric`; no `cpc`/`price` → `feed.push.bid_required` (parity with the existing array cases at validator.test.js:1099+); plus FR-008 pin: no finding in any US1/US2 case references `linkTtl`

### Implementation for User Story 2

- [x] T009 [US2] In `validatePushMaterial()` in packages/core/rules-feed.js accept the aliases: id check becomes `!isStr(m.id) && !isStr(m.tId)`; image check becomes `!isStr(m.image_url) && !isStr(m.image)`; icon/nurl check becomes `!isStr(m.icon_url) && !isStr(m.icon) && !isStr(m.nurl)`; run T007/T008 to green

**Checkpoint**: US1+US2 together clear the synthetic replica of every false finding.

---

## Phase 5: User Story 3 — The response is tagged as push traffic (Priority: P3)

**Goal**: format tags include `push` for the recognized single object and for array items whose
click key is `link`.

**Independent Test**: `detectFormat()` (via the public boundary used in validator.test.js) on the
synthetic replica and on a `link`-keyed array item.

### Tests for User Story 3 (write first, must fail)

- [x] T010 [P] [US3] Add format-tag cases at the public boundary — first locate where tags are already asserted (grep tests/ for `detectFormat`/`tags`); if nowhere, import `detectFormat` from packages/core/format-detect.js directly in tests/validator.test.js (analyze finding C1): synthetic replica object → tags include `push`; `[{title, image, link, cpc}]` array item → tags include `push`; bid-price single object (`bid_price`+`link`, no title/image) → tags unchanged (no `push`); inpage discrimination via `ext.widget_id` unchanged (FR-005)

### Implementation for User Story 3

- [x] T011 [US3] In packages/core/format-detect.js: add `'link' in o` to `hasClick` in `detectFeedFormat()`; in `detectFormat()`'s object branch, pass plain objects that matched none of the oRTB/3.0/URL-request paths through `detectFeedFormat(p, formats)` (mirroring the array-item call); run T010 to green

**Checkpoint**: all three stories independently verified.

---

## Phase 6: Polish & Cross-Cutting

- [x] T012 [P] Verify the browser app needs no mapping change for the new type string: grep public/ortbtools.app.js for result-type handling (the existing `Link-Feed Response (single)` precedent should already flow through); record the evidence here
- [x] T013 [P] Bump packages/core/package.json minor version per the contract's Versioning section (ADR-008 independent lines); do not touch app/CLI versions in this change
- [x] T014 Run the full gate `npm run ci` from the repo root; if a peer's in-progress file breaks an unrelated suite, stop and report per the constitution — do not work around; the green i18n-audit in this gate is the FR-006 locale-parity evidence (zero message keys changed)
- [x] T015 Update specs/ROADMAP.md: add the 013 row (P1, in progress → complete state as reached) with links to this package; reconcile the header date
- [x] T016 Update this file's checkboxes and Evidence section, then commit ONLY authored paths (packages/core/detect.js, packages/core/rules-feed.js, packages/core/format-detect.js, packages/core/package.json, tests/detection-mechanism.test.js, tests/validator.test.js, specs/013-single-push-recognition/, specs/ROADMAP.md, .specify/feature.json) — never `git add -A`; peer-owned dirty paths (docker-compose.yml, docs/OPERATIONS.md, specs/011-*, tests/model-free-contract.test.js) stay untouched
- [x] T017 Report the release stop condition: push/deploy remain blocked while the shared worktree carries peer-session modifications; when the tree settles, follow the standing path (green gates → non-force push → hosted gates → fresh backup → exact-SHA deploy) — deployment is NOT part of this task list

---

## Dependencies & Execution Order

- Phase 1 (T001) → Phase 2 (T002) → stories.
- US1 (T003-T006) blocks nothing else structurally, but US2's alias tests target the shared
  helper (T002) and read clearest after US1's claim exists; execute in priority order.
- US3 (T010-T011) is independent of US2; depends only on T005 (the claim) for the
  single-object tag case.
- Polish (T012-T017) after all stories; T014 before T016 (commit only on green).

### Parallel Opportunities

- T003 ∥ T004 (different files); T007 ∥ T008 (same file — sequence in one editor pass or
  merge as one edit); T010 after T005; T012 ∥ T013 during polish.
- Single-session execution: the practical order is T001→T002→T003+T004→T005→T006→T007+T008→
  T009→T010→T011→T012+T013→T014→T015→T016→T017.

## Implementation Strategy

MVP = Phase 1-3 (US1): the reported payload stops being rejected. US2 removes the residual
false findings; US3 fixes the chip. All three are small; deliver in one change with the
commit at T016, since partial delivery would ship a recognized-but-mislabeled state (US1
without US2 re-introduces `feed.push.id_required` on the same payload — worse than honest
`unknown` from the operator's chair; the spec's stories are independently _testable_, but
product-wise this ships as one unit).

## Evidence

- T001 baseline (untouched tree): `node --test tests/detection-mechanism.test.js tests/validator.test.js tests/i18n-audit.test.js` → 141 tests, 141 pass, 0 fail.
- T002 refactor: `node --test tests/validator.test.js` → 112/112 (zero behavior change).
- T003/T004 written first and red: 2 detection cases + 2 validator cases failed before implementation (claim + unknown_type + parity), non-claim/precedence cases green from the start as required.
- T005/T006 (US1): `node --test tests/detection-mechanism.test.js tests/validator.test.js` → 133/133.
- T007/T008 red first (1 failing alias case; absence/duplicate/price-tier cases already-green as designed); T009 → 139/139.
- T010 red first in tests/format-detect.test.js (3 failing `link` cases; C1 resolved: `detectFormat` is a public core export with its own suite — tests placed there, not in validator.test.js); T011 → all four suites 186/186. Second half of T011 (plain-object routing into `detectFeedFormat`) was already present at format-detect.js:439 — only the `link` click-key edit was needed.
- T012: public/ortbtools.app.js:870 maps any `/Feed Response/i` type to the feed family — `Push-Materials Feed Response (single)` is covered; no UI change.
- T013: @ortbtools/core 0.35.0 → 0.36.0 (additive contract change per contracts/feed-push-single.md).
- T014: first `npm run ci` run caught prettier formatting on authored files (fixed with prettier --write on authored paths only) and two spec-kit governance failures: a literal clarification-marker string in checklists/requirements.md (reworded) and missing 013 ROADMAP owner row / FR coverage markers (added — T015, FR tags in task descriptions). `node --test tests/spec-kit-contract.test.js` → 10/10 after fixes; full-gate rerun recorded below.
- T015: 013 row added to specs/ROADMAP.md Active Queue; "Last reconciled" moved to 2026-08-26.
- T014 rerun: `npm run ci` → exit 0, 0 failures («усе зелено — 141 + 18 файлів»).
- T016: authored paths committed from the shared dirty worktree; peer-owned modifications left untouched.
- T017: stop condition reported to the owner and recorded durably in the 013 ROADMAP row — push/deploy stay blocked while the worktree carries peer-owned modifications (docker-compose.yml, docs/OPERATIONS.md, specs/011-*, tests/model-free-contract.test.js); once it settles, release follows the standing path (green gates → non-force push → hosted gates → fresh backup → exact-SHA deploy).
- Release 2026-08-26: hosted CI first failed at `npm ci` (CLI range `^0.35.0` + stale lock left
  behind by the Core bump — fixed at `17945d6`, range/lock convention per `79a5ad0`); hosted CI
  green on `17945d6` (run 33000130063); fresh verified backups (db 3173304 B + content-posts,
  gunzip/tar-tested); `deploy.sh` → DEPLOY OK `v1.16.0` (`17945d6`), full smoke PASS,
  RestartCount=0; live `/api/analyze` on the synthetic replica → `Push-Materials Feed Response
(single)`, no `payload.unknown_type`.
