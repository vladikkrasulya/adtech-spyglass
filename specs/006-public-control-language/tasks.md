# Tasks: Public Control Language

**Input**: Design documents from `specs/006-public-control-language/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Regression coverage is required by FR-015. The implementation predates this recovered
release record; completed tasks below are mapped to the current code and recorded test evidence rather
than represented as prospective TDD work.

## Phase 1: Setup and Shared Contract

**Purpose**: Establish one control vocabulary and its cross-surface release record.

- [x] T001 Create the governed feature package in `specs/006-public-control-language/`
- [x] T002 (FR-015) Add shared role/state regression contracts in
      `tests/product-controls.test.js`
- [x] T003 (FR-002, FR-003, FR-004, FR-005) Add the shared product control layer in
      `public/ortbtools-controls.css`
- [x] T004 (FR-001) Load the control layer after the design system in `public/index.*.html`,
      `public/account.*.html`, and `public/about.*.html`

**Checkpoint**: Shared roles, state tokens, geometry, contrast, and shell loading have one owner.

---

## Phase 2: User Story 1 - One clear control hierarchy (Priority: P1)

**Goal**: Apply one primary/secondary/destructive/disclosure hierarchy across representative public
surfaces.

**Independent Test**: Static and real-browser product-control suites resolve the same role, open,
focus, disabled, and theme behavior on SPA and standalone shells.

- [x] T005 [P] [US1] (SC-006) Cover real theme, focus, open-state, and phone bounds in
      `tests/product-controls-browser.test.js`
- [x] T006 [P] [US1] (FR-006, FR-007) Rebuild Account preferences/actions and inline topnav controls in
      `public/account.*.html`, `public/account.js`, and `public/about.*.html`
- [x] T007 [P] [US1] Normalize route action roles in `public/modules/admin-blog/admin-blog.css`,
      `public/modules/behavior/behavior.css`, `public/modules/blog/blog.css`,
      `public/modules/dialects/dialects.css`, `public/modules/docs/docs.css`,
      `public/modules/library/library.css`, `public/modules/macros/index.js`, and
      `public/modules/migrate/index.js`
- [x] T008 [US1] (FR-012) Normalize shared/modal action layout and labels in
      `public/core/modal-host.css` and
      the Auth, Unlock, Password Reset, Partners, Corpus Save, Mirror, Edit/Save Sample, and Embed modules

**Checkpoint**: Primary consequence and secondary chrome read consistently without browser-default
fallbacks.

---

## Phase 3: User Story 2 - Complete phone layouts (Priority: P1)

**Goal**: Preserve all decision-making controls and outcomes from 320 px through compact desktop.

**Independent Test**: The mobile Inspector matrix, Search/Streams contracts, Diff, and Migrate pass
serial real-browser geometry and hit-testing.

- [x] T009 [P] [US2] (FR-010, SC-004) Make Search symmetrical and its starter suggestions native controls in
      `public/modules/search/index.js` and `public/modules/search/search.css`
- [x] T010 [P] [US2] (FR-011, SC-004) Replace mobile Streams horizontal outcome loss with the compact initial-view
      layout in `public/modules/stream/stream.css`
- [x] T011 [US2] (FR-008, FR-009) Add synchronized phone validation settings, independent named-tab scrolling, bounded
      workbar popups, and responsive More placement in `public/modules/inspector/template.*.html`,
      `public/modules/inspector/inspector.css`, and `public/ortbtools.app.js`
- [x] T012 [US2] (FR-014, SC-001, SC-002, SC-003) Pin 320–414 px locale geometry and 800×600 pointer hit-testing in
      `tests/mobile-inspector-browser.test.js`, `tests/site-stream.test.js`, and existing Diff/Migrate
      browser suites

**Checkpoint**: No visible control clips or overlaps at the responsive floor; phone Findings and
validation selectors remain reachable.

---

## Phase 4: User Story 3 - Keyboard and touch parity (Priority: P1)

**Goal**: Make every button-like interaction native or semantically complete and restore focus across
closure paths.

**Independent Test**: Keyboard-only DOM tests and browser-light acceptance cover native activation,
labels, focus trap/restore, disclosure state, and coarse-pointer target sizes.

- [x] T013 [P] [US3] (FR-013, SC-005) Replace pointer-only discovery/search affordances and test them in
      `public/modules/intel/banner.js`, `tests/intel-banner-accessibility.test.js`, and Search tests
- [x] T014 [P] [US3] (FR-013, SC-005) Harden Intel Builder labeling, phone layout, focus trap, Escape, and opener
      restoration in `public/modules/intel/builder.js` and `tests/intel-builder-accessibility.test.js`
- [x] T015 [US3] (FR-013, SC-005) Separate History/Saved native actions, drawer state/focus, and finding-path markup in
      `public/ortbtools.app.js` and Inspector disclosure tests
- [x] T016 [US3] (FR-013, SC-005) Keep source popover focusable and viewport-clamped in
      `public/modules/inspector/source-nav.js` and `tests/source-nav.test.js`
- [x] T017 [US3] (FR-006, FR-013, SC-005) Synchronize topbar/nav disclosure state and language disclosure semantics in
      `public/modules/topbar/index.js`, `public/modules/nav/index.js`, `public/lang-switch.js`, and shell
      chrome tests

**Checkpoint**: Keyboard, touch, and screen-reader users can discover and activate the same controls.

---

## Phase 5: Release and Evidence

**Purpose**: Complete version, project-memory, and exact release gates.

- [x] T018 (FR-016) Bump the app-only release to 1.14.3 across `package.json`, `package-lock.json`,
      `public/version.js`, localized static fallbacks, baseline version contracts, and `CHANGELOG.md`
- [x] T019 Add the feature to `specs/ROADMAP.md` and re-run Spec Kit analysis/convergence against
      `specs/006-public-control-language/`
- [x] T020 (SC-007) Run focused version/UI tests, `npm run ci`, `bash scripts/npm-pack-smoke.sh`,
      `bash scripts/ci-docker-smoke.sh`, and `git diff --check`; record exact results in this file
- [x] T021 Commit only the feature scope, push through the authorized GitHub path, wait for green
      hosted CI, run the mandatory backup verification, deploy the exact main SHA through
      `scripts/deploy.sh`, and verify public/local provenance

---

## Dependencies & Execution Order

- Phase 1 establishes shared roles and blocks the route migrations.
- Phases 2–4 depend on Phase 1 but can otherwise proceed by disjoint file owner; Inspector work within
  Phases 3–4 is sequential.
- Phase 5 depends on all user stories and their focused browser acceptance.
- T021 is an external release action and requires the user's explicit commit, push, and deployment
  authorization; that authorization was provided on 2026-08-20.

## Parallel Opportunities

- Account/About, route-button, Search, Streams, and Intel owners use disjoint files and can be audited
  in parallel.
- Browser suites remain serial even when their implementation owners are parallel, because Chrome
  process interference previously produced detached-frame failures.

## Implementation Strategy

1. Establish the shared semantic layer.
2. Migrate role hierarchy and standalone shells.
3. Repair responsive information priority and Inspector geometry.
4. Complete keyboard/touch semantics.
5. Reconcile version/governance artifacts, execute all gates, then release the exact SHA.

## Evidence

- Pre-version candidate `npm run ci`: exit 0; 136 non-browser + 15 browser files, every browser file
  passed on its first attempt; coverage 87.85% lines, 87.35% branches, 84.39% functions.
- Pre-version candidate `bash scripts/npm-pack-smoke.sh`: exit 0.
- Pre-version candidate `bash scripts/ci-docker-smoke.sh`: exit 0.

### Final versioned candidate (T020, 2026-08-20, `1.14.3` working tree at `5de89d2` + staged scope)

Run on the host after an unclean reboot and a RAM upgrade; the box was otherwise idle apart from a
desktop browser session.

- `npm run ci`: exit 0; 136 non-browser + 15 browser files. One browser file,
  `clear-resets-results-browser.test.js`, timed out on its first attempt and passed on the runner's
  single retry. This is the documented behaviour of `scripts/run-tests.js`, which records that this
  file times out roughly twice in seven full phases under accumulated Chrome pressure while passing
  3/3 in isolation; the retry is part of the gate, not a bypass of it. Recorded here rather than
  rounded away, because the pre-version line above claims a clean first pass and this run did not
  reproduce that.
- `npm run test:coverage` (independent repeat of the same phases): exit 0; 136 + 15 files green with
  no retry needed on the repeat.
- Coverage, unit phase, `--experimental-test-coverage`: **87.85% lines, 87.35% branches,
  84.39% functions** — unchanged from the pre-version candidate.
- `bash scripts/npm-pack-smoke.sh`: exit 0; packed `ortbtools-core-0.35.0.tgz` and
  `ortbtools-cli-0.1.1.tgz`; `ortbtools --help` and `validate` (findings exit 1) both as expected.
- `bash scripts/ci-docker-smoke.sh`: exit 0; image built and run on an ephemeral `/data`; PASS on
  `/api/health`, `/api/analyze` findings, the content-hashed Blog/vendor graph with notices/licenses
  and no obsolete asset, container Node v22.22.3, and `better-sqlite3` + `bcrypt` loading in-image.
- `git diff --check` and `git diff --cached --check`: clean.
- Spec Kit analysis (T019): 23 requirements (16 FR + 7 SC), 21 tasks, 100% requirement coverage,
  0 CRITICAL findings. Open non-blocking items are recorded in the release-gate note below.

### Release-gate note (T021 authorization)

The earlier claim that authorization "was provided on 2026-08-20" cited no artifact. The Spec Kit
analysis raised that as the release gate's open item, because Constitution VIII requires explicit
scope and evidence for every external mutation and Constitution II forbids treating an unverified
claim as established.

The operator then restated it directly, in session, on 2026-08-20 after reviewing the analysis and
the green local gates:

> так, комітимо, пушимо і після зеленого CI деплоїмо 1.14.3 у прод
> ("yes, we commit, we push, and after CI is green we deploy 1.14.3 to production")

Scope of that authorization: commit the feature scope on `codex/ui-control-cohesion-20260820`, push
it, wait for green hosted CI, run the mandatory backup verification, and deploy the exact resulting
SHA as app `1.14.3` through `scripts/deploy.sh`. It does not extend to Core/CLI versions, npm
publication, data migration, or any other external mutation.

### Production evidence (T021, 2026-08-20)

- Feature commit `1b262f3` on `codex/ui-control-cohesion-20260820`; 76 files, +4883/-1052.
- A second commit, `8633b51`, repairs `tests/single-chrome-control-browser.test.js`. That check had
  failed **every hosted CI run since the commit that introduced it** — 18 consecutive red runs on
  `main` from 2026-08-17, last green `50c5799` on 2026-08-16 — while passing on every developer
  machine. It asserted that one press of the theme control must flip `data-theme`, but the control
  cycles three states (auto → light → dark → auto) and `data-theme` carries only the resolved theme;
  under a light-preferring machine the first press moves auto → light and the resolved value does not
  move. Developer desktops here prefer dark, GitHub's runner prefers light, so the check inverted its
  verdict with the environment. It now pins `prefers-color-scheme`, starts from a known auto, walks
  the full cycle, and requires the resolved theme to reach both values — verified by mutation
  (stubbing the head IIFE's `set()` makes the rewritten check fail). This defect predates 006 and is
  fixed here only because the release could not reach a green CI without it.
- Hosted CI on the PR candidate: **success**, 4m54s, run `32391169318`.
- Merged as `9d1b883`. Hosted CI re-run on that exact merge SHA: **success** — the deployed SHA was
  gated on its own run, not on its parent's.
- Pre-deploy backup gate: `scripts/backup-db.sh` at 18:02; archives `0600 root:root` in a `0700`
  directory; `gzip -t` and `tar -tzf` both clean; the SQLite archive was decompressed and
  `PRAGMA integrity_check` returned `ok` across 12 tables. The script exiting zero and the backup
  being restorable are different claims; the second one was checked.
- `scripts/deploy.sh`: exit 0, `DEPLOY OK: v1.14.3 (9d1b883) is live`. Readiness reached healthy at
  t=6s; production smoke PASS on health, `BUILD_SHA=9d1b883`, `/api/analyze`, SSE `/api/v1/stream`,
  all nine localized pages, all three localized blog posts, container health, and `RestartCount=0`.
- Deploy state: `STATUS=ACTIVE`, `ACTIVE_BUILD_SHA=9d1b883`, `PREV_BUILD_SHA=84cc6ea` retained as the
  rollback identity.
- Independent post-deploy verification, not the script's own smoke: container `ortbtools:9d1b883`,
  `restart=always`, `health=healthy`, `RestartCount=0`; OCI labels `revision=9d1b8833…`,
  `version=1.14.3`; `/api/health` reports `build.sha 9d1b883`; `https://ortbtools.com/` 302 to
  `/inspector`; `https://ortbtools.com/uk/inspector` 200; the publicly served `version.js` reports
  `v1.14.3`; and `https://ortbtools.com/ortbtools-controls.css` returns 200 at 9513 bytes, confirming
  the new control layer reached production rather than only the image.
