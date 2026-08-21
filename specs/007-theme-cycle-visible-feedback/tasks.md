# Tasks: Theme Cycle Visible Feedback

**Input**: Design documents from `specs/007-theme-cycle-visible-feedback/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md)

**Tests**: FR-008 requires coverage pinned to both system preferences. The original defect survived
because the only browser check inherited the developer machine's preference; the new coverage is
written first and is expected to fail until T003 lands.

## Phase 1: Establish the contract

- [x] T001 (FR-008, SC-001, SC-002, SC-003, SC-004) Add `tests/theme-cycle.test.js` covering the
      successor function under both system preferences: first press repaints from either, one full
      cycle returns to auto, the resolved theme takes both values, and exactly one press is silent
- [x] T002 (FR-008) Extend the browser cycle expectation in
      `tests/single-chrome-control-browser.test.js` to the new order and run it under both pinned
      media features rather than light alone

**Checkpoint**: The contract is expressed and red.

---

## Phase 2: User Story 1 - The first press does something visible (Priority: P1)

- [x] T003 [US1] (FR-001, FR-002, FR-003) Replace the successor expression in the head IIFE of
      `public/index.en.html`, `public/index.uk.html`, `public/index.ru.html`,
      `public/about.en.html`, `public/about.uk.html`, and `public/about.ru.html` so auto moves to the
      value opposite the resolved theme and auto is reached from the system-matching value

**Checkpoint**: The first press repaints from either system preference.

---

## Phase 3: User Story 2 - The silent press is the honest one (Priority: P2)

- [x] T004 [US2] (FR-004) Update the control's title and glyph in the same six files so both name the
      state the next press will produce
- [x] T005 [US2] (FR-005, FR-007) Confirm the rail label in `public/modules/nav/index.js` and the
      Account radios in `public/account.js` still agree with the stored state; change them only if
      they disagree

**Checkpoint**: Every press says something, including the one that does not repaint.

---

## Phase 4: Release and Evidence

- [x] T006 (FR-006) Verify the six localized shells carry an identical cycle and diff clean against
      each other
- [x] T007 Bump the app-only release to `1.14.4` across `package.json`, `package-lock.json`,
      `public/version.js`, localized static fallbacks, baseline version contracts, and `CHANGELOG.md`
- [x] T008 (SC-005) Run `npm run ci`, `bash scripts/npm-pack-smoke.sh`, `bash scripts/ci-docker-smoke.sh`,
      and `git diff --check`; record exact results in this file
- [x] T009 Add the feature to `specs/ROADMAP.md` and re-run Spec Kit analysis against this package
- [x] T010 Commit the feature scope, push, and wait for green hosted CI on the exact merge SHA

## Dependencies & Execution Order

- T001–T002 precede T003; the contract is written before the behavior changes.
- T004 depends on T003, because the title can only name a successor that exists.
- Phase 4 depends on all user stories.
- Deployment is **not** in this task list. It is a separate external mutation requiring its own
  authorization under Constitution VIII, and the 2026-08-20 authorization was scoped to `1.14.3`.

## Evidence

### T008 — 2026-08-20, `1.14.4` candidate

Run on a settled tree. The first attempt at this gate is not reported here because it was invalid
twice over: its `EXIT=$?` was captured after a pipe through `tail` and therefore recorded `tail`'s
status rather than the command's, and `specs/ROADMAP.md` was edited while the run was in flight. The
first defect hid a real `format:check` failure on two unformatted files; the second meant even the
passing sections measured a tree that no longer existed. Both were corrected and the gate re-run from
a stopped tree with real exit codes.

- `npm run ci`: **exit 0** — 137 non-browser + 15 browser files, no browser retry on this run.
- Coverage, unit phase, `--experimental-test-coverage`: **87.88% lines, 87.38% branches, 84.40%
  functions** (1.14.3 recorded 87.85 / 87.35 / 84.39).
- `bash scripts/npm-pack-smoke.sh`: **exit 0**.
- `bash scripts/ci-docker-smoke.sh`: **exit 0**, 5 PASS.
- `git diff --check`: **exit 0**.
- Hosted CI on the PR candidate ([#66](https://github.com/vladikkrasulya/adtech-spyglass/pull/66)):
  **success**, 7m59s — longer than 1.14.3's run because the browser cycle check now walks both system
  preferences instead of one.
- Merged as `c608fbb`; hosted CI re-run on that exact merge SHA: **success**.
- Mutation evidence for T001: restoring the old successor in `public/index.en.html` fails four of the
  nine cycle checks; restoring the file returns all nine to green.
- Mutation evidence carried over from the 1.14.3 release: stubbing the head IIFE's `set()` to a no-op
  still fails `single-chrome-control-browser.test.js`, so the liveness guarantee survived the rewrite.

### Production (2026-08-21)

Deployment was authorized separately on 2026-08-21, after the package was already closed — which is
why no task is numbered for it above. The 2026-08-20 authorization named `1.14.3` explicitly and was
not stretched to cover this release.

- Pre-deploy backup gate: `scripts/backup-db.sh` at 09:11; archives `0600 root:root` in a `0700`
  directory; `gzip -t` and `tar -tzf` clean; the SQLite archive was decompressed and
  `PRAGMA integrity_check` returned `ok` across 12 tables. Yesterday's verified backup was not reused
  — the contract asks for a fresh one per deployment.
- `scripts/deploy.sh`: exit 0, `DEPLOY OK: v1.14.4 (bfe754a) is live`. Smoke PASS on health,
  `BUILD_SHA`, `/api/analyze`, SSE, all nine localized pages, all three localized posts, container
  health, `RestartCount=0`.
- Deploy state: `STATUS=ACTIVE`, `ACTIVE_BUILD_SHA=bfe754a`, `PREV_BUILD_SHA=9d1b883` retained.
- Independent verification, not the deploy script's own smoke: container `ortbtools:bfe754a`,
  `restart=always`, `healthy`, 0 restarts; OCI labels `revision=bfe754a26…`, `version=1.14.4`;
  `/api/health` reports `build.sha bfe754a`; public `version.js` reports `v1.14.4`.
- The repair itself was verified in the served production HTML rather than inferred from the version
  number. `https://ortbtools.com/ru/inspector` and `/ru/about` both carry the new successor
  (`s === null ? o : s === o ? a : null`), the Russian state names
  (`{ auto: 'авто', light: 'светлая', dark: 'тёмная' }`) and the Russian `aria-label`
  (`Переключить тему`). A grep for the old successor returns zero occurrences. Shipping the version
  and shipping the fix are different claims; the second one was checked.
