# Tasks: Safe Blog Markdown

**Input**: Design documents from `specs/003-blog-markdown-safety/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, and completed
requirements/content-security checklists

**Tests**: Tests are mandatory. Add each focused regression first, observe the relevant pre-fix
failure where practical, then implement and rerun the focused gate before broader verification.

**Organization**: Tasks are grouped by user story so the inert-content boundary and ordinary
Markdown compatibility remain independently reviewable.

## Execution Evidence

- **Starting state (2026-08-11)**: local branch `assess/browser-markdown-boundary` starts from merged
  dependency/Sentry `main` at `e6f4750`. Before feature work, the worktree contained only the ignored
  Spec Kit feature pointer; `.specify/extensions.yml` had no lifecycle hooks. No production read,
  network fetch, credential, persistent content mutation, commit, push, PR, publish, or deploy was
  performed.
- **Assessment and design**: the five-stage assessment reached `go`; specification clarification
  resolved raw-HTML, image, corpus, SSR, real-browser, and deferred-scope behavior without a user
  question. The implementation plan selected exact Marked/DOMPurify provenance, a source-neutral
  final fragment boundary, closed failure behavior, and an actual-mount offline harness. Requirements
  checklist passed 16/16 and content-security checklist passed 43/43. Prettier, `git diff --check`,
  Spec Kit contract, and docs-truth tests passed after planning.
- **Pre-fix repository baseline**: eight existing Blog/SSR/RSS/governance test files passed with zero
  failures. Exact command:
  `NODE_ENV=test LOG_LEVEL=silent node --test --test-reporter=spec tests/seo.test.js
tests/cp2-indexing.test.js tests/cp2-getpost-clickhouse.test.js tests/cp2-rss-empty.test.js
tests/cp2-rss-pubdate.test.js tests/news-moderator.test.js tests/spec-kit-contract.test.js
tests/docs-truth.test.js`. The Node test runner reported eight tests, eight pass, zero fail, zero
  cancelled, zero skipped, and zero pending cases; duration 357.561122 ms. No sandbox limitation or network access was
  observed. This records stable surrounding behavior only; the new final-DOM and promotion
  regressions do not yet exist and therefore remain intentionally unproven.
- **Pre-implementation analysis**: two independent read-only passes reviewed all 17 FRs and six SCs
  against 37 sequential tasks and the constitution. Remediation closed vendor sequencing/ownership,
  all failure and non-disclosure modes, resource-attempt evidence, full browser/SSR compatibility,
  public handler/search preservation, task traceability, network-gate wording, current status, and
  the external-mutation boundary. The refreshed result is 23/23 requirements covered (100%), 37/37
  tasks mapped, zero unmapped tasks, and zero P0/P1/P2 or constitution findings. Lifecycle hooks were
  empty. After remediation, Spec Kit governance passed 10/10, docs-truth passed 1/1, Prettier and
  `git diff --check` passed, and feature/roadmap status was reconciled to `Ready`.
- **Vendor foundation (T006–T009)**: added exact `marked@15.0.12` and `dompurify@3.4.13`
  development ownership with an ordinary lock update. After package presence was proven, the new
  parity regression failed for the intended missing `public/vendor/marked.es.js` state (zero pass,
  one fail), not for a missing dependency. `node scripts/sync-browser-vendors.js --write` then copied
  both reviewed ESM files and licenses byte-for-byte, generated the deterministic notice, and removed
  the obsolete jsDelivr artifact. Check mode reported `Browser vendor assets are synchronized`;
  `node --test --test-reporter=spec tests/browser-vendor-parity.test.js` passed 1/1, and scoped
  Prettier, ESLint, JSDoc/TypeScript, dependency listing, and `git diff --check` passed. No runtime
  download, install hook, publication, or deployment occurred.
- **Safe-body MVP (T010–T018)**: the first actual-mount run reached the product module graph and
  reported 50 tests, three pass and 47 fail because Blog still imported the removed legacy Marked
  asset; the promotion chain likewise failed 0/1 at that mount boundary, while the two structural
  header checks passed. After the one fragment boundary landed,
  `NODE_ENV=test LOG_LEVEL=silent node tests/blog-markdown-safety.test.js` passed 78/78 on the current
  tree (including the later 23-case compatibility denominator),
  `NODE_ENV=test LOG_LEVEL=silent node tests/blog-promotion-safety.test.js` passed 1/1, and
  `NODE_ENV=test LOG_LEVEL=silent node tests/security-headers.test.js` passed 2/2. The denominator
  contains 20 unique security classes, 14 URL cases, four source states, six independent forced
  failures, pending-request abort, reused-root rejection/404, detached-root states, the DB
  characterization, 20 synthetic compatibility cases, and three tracked localized posts. The
  compatibility assertions pin literal raw-HTML text, scoped `start`/`align`/link attributes, and an
  untruncated 128 KiB body. Every final-DOM/resource observer recorded zero body request capability
  or attempt, every inserted element is in the HTML namespace, and every forced failure recorded an
  exact text-only fallback with zero sentinel-body disclosure through console/reporting. Targeted
  ESLint, full typecheck, Prettier, and `git diff --check` passed.
- **Canonical/version surfaces (T024–T029)**: the Content/SEO contract, security policy, and accepted
  ADR-011 now own the source-neutral fragment invariant, supported grammar, exact vendor ownership,
  and deferred adjacent scope. The app PATCH moved coherently from `1.6.0` to `1.6.1` across the root
  manifest/lock, runtime/static fallbacks, baseline, and changelog while Core `0.31.0` and CLI `0.1.1`
  remained unchanged. `NODE_ENV=test LOG_LEVEL=silent node --test --test-reporter=spec
tests/docs-truth.test.js tests/version-consistency.test.js tests/browser-vendor-parity.test.js`
  passed all three files; the focused immutable-image smoke-contract guard and `bash -n` also passed.
- **Editorial compatibility (T019–T023)**: the browser compatibility denominator contains 20 fixed
  synthetic constructs/edge cases plus all three tracked EN/UK/RU posts. The same 23 fixtures pass
  the limited SSR readable-text/inert-DOM expectations. Exact public Blog handler and search
  contracts cover list/post JSON, `markdown`/`db` classification, 400/404/500 outcomes, RSS,
  published-news indexing, escaping, URL generation, SPA navigation, and deterministic global
  cleanup. The focused compatibility run reported 55/55 assertions. The current combined command
  `NODE_ENV=test LOG_LEVEL=silent node --test --test-reporter=spec
tests/browser-vendor-parity.test.js tests/blog-markdown-safety.test.js
tests/blog-promotion-safety.test.js tests/security-headers.test.js tests/seo.test.js
tests/blog-handler-contract.test.js tests/blog-search-contract.test.js tests/cp2-indexing.test.js
tests/cp2-getpost-clickhouse.test.js tests/cp2-rss-empty.test.js
tests/cp2-rss-pubdate.test.js tests/news-moderator.test.js tests/docs-truth.test.js
tests/spec-kit-contract.test.js tests/version-consistency.test.js` reported 15 test files, 15 pass,
  zero fail/cancelled/skipped/pending in 4398.852955 ms. It used only tracked/synthetic fixtures,
  temporary storage, and mocked infrastructure; no sandbox limitation or network access occurred.
- **Focused/static verification (T031)**: `node scripts/sync-browser-vendors.js --check` reported
  synchronized assets; `npm run lint`, `npm run typecheck`, `npm run format:check`, `bash -n
scripts/ci-docker-smoke.sh`, and `git diff --check` all exited zero on the current tree. The focused
  15-file command above remained 15/15 green, and the post-format governance/version rerun remained
  3/3 green. Prettier initially identified only mechanical wrapping in this evidence file and the
  current roadmap; those two files were formatted and the full formatting gate then passed. No
  sandbox limitation or external network was involved in these gates.
- **Dependency verification (T032)**: `npm ci` completed from the committed lock in 1 minute and
  installed 210 packages; its only message was the existing non-blocking `prebuild-install@7.1.3`
  deprecation warning. `npm ls --all marked dompurify` resolved exact `marked@15.0.12` and
  `dompurify@3.4.13`. Both audit commands first failed inside the restricted sandbox solely with DNS
  `EAI_AGAIN`; their approved network reruns, `npm audit --audit-level=low` and
  `npm audit --omit=dev --audit-level=low`, each exited zero with `found 0 vulnerabilities`.
- **Image and complete-repository gate (T030/T034)**: the smoke-contract regression first exposed an
  exact NOTICE-text mismatch, and the first disposable image run then exposed that uppercase `.txt`
  paths canonicalize through a redirect. The final smoke inspects notices/licenses inside the image
  while continuing to fetch the public content-hashed Blog→renderer→Marked/DOMPurify graph. The
  current approved `bash scripts/ci-docker-smoke.sh` run passed health, analyze, hashed imports,
  notice/license presence, obsolete-asset 404, Node `v22.22.3`, `better-sqlite3`, and `bcrypt`; its
  trap removed the disposable container, volume, and image, confirmed by empty exact-name filters.
  It never targeted production. The current approved `npm run ci` exited zero: 1,753 tests, 1,743
  pass, zero fail/cancelled/pending, and 10 intentional skips; aggregate coverage was 86.15% lines,
  84.67% branches, and 81.61% functions. A restricted-sandbox attempt was not used as evidence: its
  child-process suites could not complete there and the tree received review fixes, so it was
  stopped before the final approved rerun.
- **Post-implementation analysis (T035)**: non-destructive `speckit.analyze` reloaded the current
  constitution plus feature spec/plan/tasks after the complete gates. All 17 functional requirements
  and six success criteria have implementation/test/document/governance coverage (23/23, 100%); all
  37 tasks map to a requirement, story, contract, or mandatory lifecycle gate. It reported zero
  ambiguity, duplication, unmapped work, constitution conflict, or critical/high/medium finding.
  Lifecycle hooks remained empty, so no analysis hook executed.
- **Independent drift review (T033)**: the final read-only pass reported no residual P0/P1/P2.
  Runtime changes stay inside the planned Blog seam; only exact Marked/DOMPurify development pins
  change the dependency graph; App `1.6.1`, Core `0.31.0`, CLI `0.1.1`, and EN/UK/RU version
  fallbacks are coherent. Secret scanning found only the explicitly synthetic local test token. No
  server/database/crawler/admin/CSP/deploy/rollback/Dockerfile behavior, production data, external
  runtime fetch, publication, commit, push, PR, or deployment drift was present. The reviewer also
  independently repeated safety 78/78, vendor 8/8, vendor check, bash syntax, and diff-check gates.
- **Convergence (T036)**: `speckit.converge` checked 17 functional requirements, six success
  criteria, eight acceptance scenarios, eight plan decisions, and eight constitution principles.
  Missing/partial/contradicting/unrequested findings were all zero, so it appended no task and left
  `tasks.md` byte-for-byte unchanged during the command (SHA-256
  `0c12910afcdd5e58edf693788c159f0e11a1426f77987debd2c3b3ac602f7ba2`). Hooks remained empty.
- **Final current-tree verification (T037)**: after convergence, the exact 15-file focused command
  recorded above passed 15/15 in 5909.530961 ms; vendor check, `npm run lint`, `npm run typecheck`,
  `npm run format:check`, Docker-smoke shell syntax, and `git diff --check` all exited zero. Approved
  advisory-registry runs of `npm audit --audit-level=low` and
  `npm audit --omit=dev --audit-level=low` each reported `found 0 vulnerabilities`. The approved
  unsandboxed `npm run ci` exited zero with 1,753 tests, 1,743 pass, 10 intentional skips, and zero
  failures; the final post-recording rerun reported 86.14% lines, 84.65% branches, and 81.61%
  functions. The
  approved disposable `bash scripts/ci-docker-smoke.sh` passed health, analyze, the content-hashed
  Blog/vendor graph, notices/licenses, obsolete-asset absence, Node `v22.22.3`, and native module
  loading. Empty exact-name Docker filters confirmed its container, volume, and image were removed.
  Registry audits required approved network access and full CI required unsandboxed child-process
  execution; neither gate accessed production. No commit, push, PR, publication, or deployment was
  performed.
- **Separately authorized deployment and reconciliation (T038)**: on 2026-08-12, after explicit
  authorization outside the local implementation boundary, the canonical immutable-image pipeline
  activated app `v1.6.1` from merge SHA
  `d6c873d44cffde9b4f34e5fb8fca9472b9ec2d83`. A fresh SQLite/content backup was verified before the
  transition. State readback reported `STATUS=ACTIVE`, `ACTIVE_TAG=ACTIVE_BUILD_SHA=d6c873d`,
  `ACTIVE_VERSION=v1.6.1`, `PREV_TAG=PREV_BUILD_SHA=f6bead9`, and
  `ROLLBACK_TAG=rollback-pre-f6bead9`. The container was healthy with restart policy `always` and
  zero restarts; OCI version/revision labels were `1.6.1` and the full merge SHA. Local and public
  health/smoke passed with build `d6c873d`; no rollback was required. `sentry.ready=false` remained
  the documented non-gate and makes no upstream-delivery claim. After the truth reconciliation,
  `NODE_ENV=test LOG_LEVEL=silent node --test --test-reporter=spec tests/docs-truth.test.js
tests/immutable-image.test.js tests/spec-kit-contract.test.js` passed 88/88 in 3190.066167 ms;
  `bash -n scripts/deploy.sh scripts/rollback.sh`, formatting, lint, typecheck, and
  `git diff --check` all exited zero. The subsequent full `npm run ci` exited zero with 1,754 tests,
  1,744 pass, 10 intentional skips, and zero failures; aggregate coverage was 86.15% lines, 84.64%
  branches, and 81.61% functions. The reconciliation changed only tracked documentation, host-only
  script comments, Spec Kit evidence/status, and an offline regression; it did not require another
  image build, production transition, or rollback.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and has no incomplete dependency
- **[Story]**: Maps the task to one feature user story
- Every task names its owning repository path or evidence file

**Requirement coverage**: FR-001 → T012/T015/T016; FR-002 → T010/T012/T015/T016; FR-003 →
T010/T012/T015; FR-004 → T010/T012/T015/T019/T022; FR-005 → T019/T022/T023; FR-006 →
T010/T012/T015/T019/T022; FR-007 → T019/T020/T022/T023; FR-008 → T012/T013/T016/T017; FR-009 →
T013/T017/T018; FR-010 → T011/T012/T015/T016/T018; FR-011 → T019–T023; FR-012 →
T009–T013/T017/T018/T031; FR-013 → T010/T012/T018; FR-014 → T019/T022/T023; FR-015 →
T024/T025/T027/T029; FR-016 → T028/T029; FR-017 → T004/T005/T024/T027/T033/T038. SC-001 →
T010/T012/T015/T016/T018; SC-002 → T011/T012/T016/T018; SC-003 → T013/T017/T018; SC-004 →
T019–T023; SC-005 → T018/T023/T031/T032/T034/T037; SC-006 →
T024/T025/T027/T029/T036/T038.

## Phase 1: Setup and Pre-Implementation Gate

**Purpose**: Pin the approved scope, reproducible starting evidence, and complete Spec Kit design
before any runtime or dependency edit.

- [x] T001 Record the branch/base, ignored feature pointer, empty lifecycle hooks, starting worktree,
      and external-mutation boundary in `specs/003-blog-markdown-safety/tasks.md`
- [x] T002 [P] Preserve the approved assessment, clarified specification, plan, contracts, and both
      completed requirements checklists under `.specify/assessments/browser-markdown-boundary/` and
      `specs/003-blog-markdown-safety/`
- [x] T003 [P] Run the current Blog/SSR/RSS/governance baseline tests and record exact pre-fix evidence
      in `specs/003-blog-markdown-safety/tasks.md`
- [x] T004 Reconcile the current planned/analysis-remediation status in
      `specs/003-blog-markdown-safety/spec.md` and `specs/ROADMAP.md` before claiming a clean analysis
- [x] T005 Re-run non-destructive `speckit.analyze`, resolve every critical/high/medium contradiction
      across `specs/003-blog-markdown-safety/`, then record the clean result and ready-for-implementation
      status in `tasks.md`, `spec.md`, and `specs/ROADMAP.md`

**Checkpoint**: No runtime work begins until T005 reports a clean pre-implementation analysis.

---

## Phase 2: Foundational Vendor and Test Infrastructure

**Purpose**: Establish exact reviewed browser-library ownership and a deterministic actual-module
test harness shared by both user stories.

**⚠️ CRITICAL**: Author the vendor parity regression first, add the exact package dependencies, then
run it and record the intended old/missing-asset mismatch before checked-in browser libraries are
replaced. A missing npm package is not the accepted red reason.

- [x] T006 Author an exact package/lock/asset/license/notice/obsolete-file parity regression without
      running it yet in
      `tests/browser-vendor-parity.test.js`
- [x] T007 Add exact `marked@15.0.12` and `dompurify@3.4.13` development ownership in `package.json`,
      regenerate only the resulting reviewed `package-lock.json` graph, then run T006 and record that
      it fails for the intended old/missing public-asset state rather than missing packages
- [x] T008 Implement deterministic `--check`/`--write` behavior in
      `scripts/sync-browser-vendors.js`; delete `public/vendor/marked.esm.min.js`; and install the two
      reviewed browser modules, copied licenses, and provenance notice in
      `public/vendor/marked.es.js`, `public/vendor/dompurify.es.js`,
      `public/vendor/licenses/Marked-MIT.txt`, `public/vendor/licenses/DOMPurify-Apache-2.0.txt`, and
      `public/vendor/NOTICE.txt`
- [x] T009 Add exact upstream-module formatting exclusions in `.prettierignore` and prove the vendor
      regression fails on any byte/version/license/notice drift in
      `tests/browser-vendor-parity.test.js`
- [x] T010 [P] Build the fixed unique security/URL fixture denominator, closed final-DOM assertions,
      and a zero-attempt resource/fetch observer in `tests/blog-markdown-fixtures.js` and
      `tests/blog-dom-assertions.js`
- [x] T011 [P] Build a repository-confined root-absolute ESM-to-data-URL loader with deterministic
      per-jsdom-realm cache salt plus dependency/parser/sanitizer/policy/fragment failure substitution
      in `tests/browser-esm-loader.js`

**Checkpoint**: Both reviewed ESM assets are reproducible from exact installed packages, and tests
can execute the real Blog browser module without a runtime-only test seam.

---

## Phase 3: User Story 1 - Read Any Blog Post Safely (Priority: P1) 🎯 MVP

**Goal**: Every Blog body and failure state reaches one inert final document boundary regardless of
source, age, approval, or storage origin.

**Independent Test**: Execute the actual Blog mount in jsdom for every fixed FR-013 class, source
mode, unknown/missing source, dependency/parser/sanitizer/policy/fragment-construction/insertion
failure, abort, and stale-root state; the final `.blog-post__body` contains readable text, zero
prohibited capabilities/resource attempts, and no body disclosure through logs or reporters.

### Tests for User Story 1

- [x] T012 [P] [US1] Add the failing actual-mount security/source/resource/lifecycle matrix, including
      separate dependency-load, parser, sanitizer, policy, fragment-construction, insertion, abort,
      and stale-root outcomes plus sentinel-body console/reporting spies in
      `tests/blog-markdown-safety.test.js` using `tests/browser-esm-loader.js` and a scoped DOM
      prototype stub
- [x] T013 [P] [US1] Add the failing offline encoded-feed → authorized promotion → temporary
      `CONTENT_DIR` → public handler → actual Blog mount regression in
      `tests/blog-promotion-safety.test.js`
- [x] T014 [P] [US1] Add a structural application security-header regression that preserves the
      current response policy without treating CSP as the body sanitizer in
      `tests/security-headers.test.js`

### Implementation for User Story 1

- [x] T015 [US1] Implement the immutable element/attribute/link policy, raw-HTML/image/control
      overrides, DOMPurify fragment output, and text fallback in
      `public/modules/blog/markdown-renderer.js`
- [x] T016 [US1] Replace body interpolation with placeholder-first dynamic renderer loading,
      `replaceChildren`, closed text fallback, and post-await abort/root-ownership guards in
      `public/modules/blog/index.js`
- [x] T017 [US1] Complete the mocked promotion/public-handler path in
      `tests/blog-promotion-safety.test.js` using the existing exported parser and public route
      factories only; if the chain is not reachable, stop and amend the plan/tasks before any runtime
      handler edit
- [x] T018 [US1] Run the vendor, security matrix, promotion-chain, and header suites; record exact
      fixture/source/failure/resource-attempt/non-disclosure denominators and results in
      `specs/003-blog-markdown-safety/tasks.md`

**Checkpoint**: User Story 1 is independently complete when every source and failure class is inert
in the final mounted body and the synthetic promotion chain cannot create active behavior.

---

## Phase 4: User Story 2 - Preserve Ordinary Editorial Markdown (Priority: P2)

**Goal**: Retain the supported editorial semantics and readable EN/UK/RU corpus while raw HTML and
image resources remain unsupported.

**Independent Test**: Render every tracked `content/posts/**/*.md` body plus each fixed supported
construct through the browser boundary and existing SSR; browser semantics match maintained
expectations, both views retain readable text, and DB/firehose remains escape-first.

### Tests for User Story 2

- [x] T019 [P] [US2] Add tracked-corpus and exact supported Markdown semantics characterization for
      empty bodies, paragraphs, headings, emphasis, strong, lists, blockquotes, inline/fenced code,
      tables, line/thematic breaks, strikethrough, inert task-list markers, safe links, raw-HTML text,
      image alt text, the fixed 128 KiB body, and lone-surrogate text in
      `tests/blog-markdown-safety.test.js`
- [x] T020 [P] [US2] Reuse the complete T019 compatibility corpus for SSR readable-text expectations,
      including every synthetic construct/edge and tracked localized post, in `tests/seo.test.js`
- [x] T021 [P] [US2] Add exact public list/post JSON shape, status, markdown/db source-classification,
      missing-slug/not-found/error outcomes, unchanged RSS/published-news behavior, and Blog search
      indexing/navigation in `tests/blog-handler-contract.test.js` and
      `tests/blog-search-contract.test.js` while retaining the existing `tests/cp2-*.test.js` suites

### Implementation for User Story 2

- [x] T022 [US2] Reconcile the renderer's headings, emphasis, strong, lists, blockquotes, code,
      tables, breaks, strikethrough, and safe editorial links with the fixed compatibility corpus in
      `public/modules/blog/markdown-renderer.js`
- [x] T023 [US2] Run the tracked-corpus, SSR/SEO, Blog API, search, RSS, and published-news suites and
      record exact current evidence in `specs/003-blog-markdown-safety/tasks.md`

**Checkpoint**: User Story 2 is independently complete when all supported constructs and tracked
localized posts retain expected browser semantics/readability without weakening User Story 1.

---

## Phase 5: Canonical Truth, Versioning, and Production-Shaped Evidence

**Purpose**: Align durable ownership and prove the reviewed browser assets survive the immutable
image path without expanding production authorization.

- [x] T024 [P] Update the current Content/SEO invariant, exact supported content, known exclusions,
      and explicitly deferred adjacent findings in
      `specs/000-platform-baseline/contracts/content-seo.md` and `SECURITY.md`
- [x] T025 [P] Record the durable sanitizer/provenance decision and index it in
      `specs/decisions/ADR-011-browser-markdown-sanitization.md` and `specs/DECISIONS.md`
- [x] T026 [P] Update current app-version truth from `1.6.0` to `1.6.1` while leaving Core/CLI
      unchanged in `specs/000-platform-baseline/spec.md`, `specs/000-platform-baseline/plan.md`, and
      `specs/000-platform-baseline/contracts/locales-versioning.md`
- [x] T027 [P] Add the app PATCH changelog entry, current feature status, and separately deferred
      follow-ups in `CHANGELOG.md` and `specs/ROADMAP.md`
- [x] T028 Bump every guarded app version surface in `package.json`, `package-lock.json`,
      `public/version.js`, `public/about.en.html`, `public/about.uk.html`, `public/about.ru.html`, and
      `public/modules/inspector/template.{en,uk,ru}.html`; keep workspace versions unchanged
- [x] T029 [P] Correct only the app-version maintenance instruction in `design-system.vendor.json`
      while preserving its historical `vendored_for`, and add focused truth/version/provenance guards
      in `tests/docs-truth.test.js` and `tests/version-consistency.test.js`
- [x] T030 Extend `scripts/ci-docker-smoke.sh` to fetch the production-served Blog module and both
      content-hashed vendor imports, assert the obsolete Marked asset is absent, then prove the
      disposable image contains the `.txt` notices and licenses without targeting production

---

## Phase 6: Verification, Analysis, and Convergence

**Purpose**: Close the full repository gate, reconcile artifacts against implementation, and stop
before any external mutation.

- [x] T031 Run exact vendor check, all focused Blog/promotion/SSR/RSS/header/governance/version tests,
      targeted ESLint, type checking, Prettier, and `git diff --check`; record exact current-run
      evidence and any sandbox limitation in `specs/003-blog-markdown-safety/tasks.md`
- [x] T032 Run `npm ci`, `npm ls --all marked dompurify`, full npm audit, and production-only npm
      audit using approved registry/advisory access; record exact evidence and leave the task
      incomplete if that external service is unavailable in `specs/003-blog-markdown-safety/tasks.md`
- [x] T033 Review the complete diff for unplanned source, dependency, locale, version, secret,
      production-content, network, package/publication, and deployment drift; record the result in
      `specs/003-blog-markdown-safety/tasks.md`
- [x] T034 Run full `npm run ci` and the disposable `bash scripts/ci-docker-smoke.sh`; confirm
      cleanup/no production mutation and record exact evidence in
      `specs/003-blog-markdown-safety/tasks.md`
- [x] T035 Re-run non-destructive `speckit.analyze` against the implemented artifacts, resolve every
      critical/high/medium inconsistency, and record the clean result in `tasks.md`
- [x] T036 Run `speckit.converge`; implement and verify any appended work until convergence is clean,
      then reconcile `spec.md`, `tasks.md`, and `specs/ROADMAP.md`
- [x] T037 Re-run final focused/static/audit/full-CI/Docker gates after the last convergence edit and
      record only current-tree evidence in `specs/003-blog-markdown-safety/tasks.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: begins with the completed assessment/design and blocks runtime work until the
  pre-implementation analysis is clean.
- **Foundational (Phase 2)**: depends on T005 and blocks both user stories.
- **User Story 1 (Phase 3)**: depends on exact vendor ownership and the test harness; it is the MVP.
- **User Story 2 (Phase 4)**: depends on the inert renderer from User Story 1 and adds compatibility
  constraints without reopening the boundary.
- **Truth/version/image evidence (Phase 5)**: depends on both story checkpoints.
- **Verification/convergence (Phase 6)**: depends on every implementation/document task and stops at
  the verified local handoff boundary.
- **Authorized deployment reconciliation (Phase 7)**: begins only after separate production
  authorization and records the verified outcome without retroactively broadening the feature's
  implementation authority.

### User Story Dependencies

- **User Story 1 (P1)**: no dependency on User Story 2; it delivers the complete safety invariant.
- **User Story 2 (P2)**: depends on the safe fragment renderer but remains independently testable via
  its complete tracked/synthetic compatibility corpus.

### Within Each User Story

- Write and run focused tests before the implementation they protect; record the expected pre-fix
  failure where practical.
- Keep every fixture synthetic or tracked and every filesystem/database effect temporary/mocked.
- Run focused final-DOM tests before broader SSR/RSS/CI/Docker gates.
- Do not mark evidence tasks complete until the exact command has run against the current tree.

### Parallel Opportunities

- T003 can run while T004 reconciles current status; T005 remains the implementation gate.
- T006, T010, and T011 touch independent test/provenance surfaces after T005.
- T012–T014 are independent failing regression files once the shared fixtures/loader exist.
- T019–T021 cover separate compatibility/SSR/API surfaces after User Story 1.
- T024–T027 and T029 touch distinct canonical owners before the coordinated version bump.
- T031 and T033 are read-only but should not overlap commands that rewrite/install the tree; T032,
  T034, and T037 run sequentially.

## Parallel Example: User Story 1

```text
Task T012: actual Blog mount security/source/failure matrix in tests/blog-markdown-safety.test.js
Task T013: synthetic promotion-to-render chain in tests/blog-promotion-safety.test.js
Task T014: structural response-policy regression in tests/security-headers.test.js

After the three regressions fail for the intended reasons:
Task T015: source-neutral sanitizer/fragment implementation
Task T016: placeholder-first dynamic load and lifecycle-safe insertion
```

## Implementation Strategy

### MVP First (User Story 1)

1. Complete pre-implementation analysis.
2. Establish exact vendor ownership and the actual-module test harness.
3. Add the complete failing final-DOM and promotion regressions.
4. Implement the one fragment boundary and lifecycle-safe fallback.
5. Stop and independently validate every source/failure/security class before compatibility polish.

### Incremental Delivery

1. User Story 1 closes the active-content boundary for every Blog body.
2. User Story 2 locks supported Markdown and tracked localized-content compatibility.
3. Canonical truth/versioning and production-shaped image evidence make the change reviewable.
4. Full analysis and convergence close specification drift before external handoff.

### External Mutation Boundary

Local implementation and verification do not authorize commit, push, PR creation, merge, package
publication, production content access, data migration, cache purge, or deployment. After T037, report
the exact local candidate and ask for separate authorization before any Git/PR or production action;
that handoff is deliberately not an executable feature checkbox. The later authorizations and their
verified results are recorded in T038; they do not authorize any future external mutation.

## Phase 7: Convergence

- [x] T038 Reconcile the separately authorized `v1.6.1` production deployment evidence in
      `specs/003-blog-markdown-safety/tasks.md` and `specs/ROADMAP.md`; correct the backup-preflight,
      candidate-state, persistent-content, and transition restart-policy truth gaps in
      `specs/000-platform-baseline/contracts/release-deploy.md`, `docs/OPERATIONS.md`,
      `scripts/deploy.sh`, and `scripts/rollback.sh`; and add focused regression coverage per
      Constitution II
