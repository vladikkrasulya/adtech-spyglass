# Tasks: Trilingual Output Parity

**Input**: Design documents from `/specs/015-trilingual-output-parity/` and
`docs/i18n-audit-2026-08-27.md`

**Prerequisites**: plan.md, spec.md, quickstart.md

**Tests**: REQUIRED (Constitution Principle VII) — the narrowest existing suite per touched
surface is named in each task; extend it rather than inventing a parallel one.

## Format: `[ID] [P?] [Story] Description`

`[P]` = safe to run in parallel with every other `[P]` task in the same phase — each package
below owns a disjoint file set (verified: no two packages share a file), so **every package task
in this file can run in a separate agent session concurrently with any other package task**,
subject only to the two explicit dependencies called out in Phase 4.

## Phase 1: Setup

- [ ] T001 Baseline: run `node --test tests/i18n-audit.test.js tests/ai-label.test.js tests/email.test.js tests/auth.test.js tests/locale-routes.test.js` and record the pass count as the before-state; confirm by direct read that `server.js:78` still reads `const DEFAULT_LOCALE = 'uk';`, `public/i18n.js`'s `window.t()` (~line 1297) still falls back to `I18N.uk`, and `packages/core/messages/index.js:23` still sets `FALLBACK_LOCALE = 'uk'` — these three before-states are what SC-002/SC-003 measure against.

## Phase 2: Foundational

_(none — the ten packages below have disjoint file ownership and no shared refactor is needed
before they start. The only cross-package ordering is the two dependencies named in Phase 4.)_

## Phase 3: User Story 1 — The dialect-labelling assistant answers in the operator's locale (Priority: P1) 🎯 MVP

- [ ] T002 [US1] **Package F2-bot-chain** — exclusive files: `lib/label-persona.js`,
      `lib/ollama.js`, `modules/ai-label/handler.js`,
      `packages/core/dialects/signal-lexicon.js`, `public/modules/inspector/dialect-label.js`,
      `public/modules/inspector/dialect-label.i18n.js`. Fix, in this file set only:
  - `lib/label-persona.js:84` (P0, en+ru) — `buildPersona(locale)` / per-locale map; every
    non-language line stays byte-identical across locales (FR-001).
  - `packages/core/dialects/signal-lexicon.js:272` and its ~10 sibling `reason:` literals at
    lines 258–259, 286, 303–306, 336, 345, 380–386, 392, 404 (P0, en+ru) — per-locale reason
    table, `resolveSignal({..., locale})` (FR-002).
  - `public/modules/inspector/dialect-label.js:207` (P0, en+ru) — verify only; no code change
    needed once the two items above land (FR-005).
  - `modules/ai-label/handler.js:186` (P1, en+ru) — read `body.locale` (validated against
    `en`/`uk`/`ru`, default `en`), thread into both `resolveSignal()` and
    `ollama.classifySignal()` (FR-003).
  - `lib/ollama.js:166` (P1, en+ru) — structural prompt labels ("Шлях:"/"Значення:" etc.) move
    to the same per-locale table as the persona (FR-004).
  - `public/modules/inspector/dialect-label.js` `askAgent()` (~line 356) — send the active UI
    locale in the POST body.
  - Test: extend `tests/ai-label.test.js` with cases asserting `resolveSignal()` returns a
    localized `reason` per `locale` param (en/uk/ru) and that the label vocabularies still
    agree (existing Assertion 2); assert `buildPersona('en')`/`buildPersona('ru')` differ from
    `buildPersona('uk')` only in the closing sentence.
  - After this task: re-run `scripts/label-calibration.js` once (live-model bench, not a CI
    gate per ADR-012) and record the outcome in Evidence below — the persona's non-language
    lines must be unchanged so the HOLDOUT comparison stays valid.

## Phase 4: User Story 2 — Missing text never silently becomes Ukrainian (Priority: P1)

- [ ] T003 [P] [US2] **Package F1-core-catalog** — exclusive file: `public/i18n.js`. Fix:
  - `public/i18n.js:1297` (P1, all) — `window.t()`: requested locale → `en` (if requested ≠
    `en`) → `uk`, with `console.warn` on every fallback (FR-006).
  - `public/i18n.js:99,1015,1194` (P2, uk) — normalize `вдалось` → `вдалося` in the three
    outlier toast keys (`toast.corpus_delete_failed`, `toast.sample_load_failed`,
    `toast.decrypt_failed_with_hint`) (FR-017 register/spelling consistency).
  - `public/i18n.js:143` (P2, uk) — `behavior.empty`: `Відрендер` → `Відрендери` (valid
    imperative), matching the sibling occurrence at
    `public/modules/inspector/template.uk.html:872` (owned by package F6 — coordinate the two
    edits to the same corrected phrase; do not edit the HTML file from this package).
  - `public/i18n.js:689` (P2, ru) — `toast.signed_out`: `'Вы вышли из аккаунта'` → a
    gender-neutral informal rewrite (e.g. `'Сессия завершена'`); mirror the equivalent
    rewrite for the uk sibling in `toast.signed_out` if that key lives in this file too
    (FR-017).
  - `public/i18n.js:1235` (P2, uk+ru) — translate `cabinet.status.warn_pct`/`err_pct` (both
    locales currently byte-identical to `en`).
  - `public/i18n.js:1313` (P2, ru) — `window.tInfo()` gains `keys_ru` (FR-022).
  - Test: `node --test tests/i18n-audit.test.js` plus a manual `window.t()` fallback check
    (delete a key from `I18N.en` only, request it at `lang='en'`, confirm the `en`-preferred
    order and the `console.warn`).

- [ ] T004 [P] [US2] **Package F5-server-core** — exclusive files:
      `packages/core/messages/ru.json`, `packages/core/messages/index.js`, `server.js`,
      `modules/sample/handler.js`, `modules/gists/handler.js`,
      `public/modules/share/index.js`, `public/modules/share/i18n.js`. Fix:
  - `packages/core/messages/index.js:23,38–41` (P1, all) — `resolve()`: requested locale →
    `en` → `uk` (FR-007).
  - `server.js:78` (P1, en) — `DEFAULT_LOCALE`: `'uk'` → `'en'`, per
    [ADR-014](../decisions/ADR-014-default-locale-english.md) (FR-008). `resolveLocale()`
    itself (~line 940) needs no other change.
  - `packages/core/messages/ru.json:104` (P2, ru) — `Сидбід` → `Сидбид` (Russian и); leave
    `uk.json`'s `Сідбід` untouched (FR-021).
  - `modules/gists/handler.js:213` (and 197/208) (P1, all) — map `gist_expired`/`not_found`
    to a locale-resolved string server-side instead of raw English `sendError` prose, OR
    (matching the existing `humanAuthError()`/`humanResetError()` client pattern) leave the
    server code as-is and add the client-side mapping in `public/modules/share/index.js` +
    `public/modules/share/i18n.js` (both owned by this same package — pick one approach and
    apply it consistently).
  - `modules/sample/handler.js:60` (P1, all) — `handleSample`/`handleSampleList` label/note
    derivation gains an `{en, uk, ru}` lookup (fixture-keyed or in
    `packages/core/messages`) resolved against the request locale, mirroring
    `extractAllCategories(payload, locale)`'s existing pattern in
    `modules/analyze/handler.js` (not owned by this package — read-only reference).
  - Test: extend `tests/i18n-audit.test.js`'s Core-catalog checks for the `ru.json` spelling
    fix; add a `resolve()` fallback-order case (requested `en` missing a key → falls to `en`
    dict first, `uk` only as last resort) to the same suite or a narrow new one beside it.

- [ ] T005 [US2] **Package F8-tests** — exclusive file: `tests/i18n-audit.test.js`. **Depends
      on T003 and T004 landing first** (this task tightens the invariant those two packages'
      fixes must already satisfy — running it first would fail on work not yet done). Fix:
  - `tests/i18n-audit.test.js:211` (P2, all) — replace the `if (!(id in CATALOGS[locale]))
continue;` skip with a key-set-parity assertion evaluated across all three Core message
    catalogs _before_ the existing placeholder-drift loop, so a finding id present in one
    locale and absent from another fails the suite (FR-009).
  - Extend the same invariant to every module catalog reachable through
    `registerI18nModule`/`window.kt_i18n_modules` (the mechanism `public/modules/**/i18n.js`
    files already use) — confirmed clean by the audit's `modules-catalog-a`/`-b` groups, so
    this is new coverage, not a new fix.
  - `public/modules/dialects/i18n.js` — **delete this file** (confirmed dead code: imported
    by nothing, its own README already documents the abandonment) so it cannot produce a
    false pass/fail under the new invariant (FR-010). _Note: this file is not listed under
    any other package's exclusive ownership; F8 deletes it as part of closing out the parity
    invariant it is tightening._
  - Run: `node --test tests/i18n-audit.test.js` — must be green with the new assertions
    active, proving T003/T004's fixes and catching any locale still missing a key anywhere
    else in the repo.

## Phase 5: User Story 3 — Account email matches the account's language (Priority: P1)

- [ ] T006 [US3] **Package F4-email-auth** — exclusive files: `email.js`,
      `modules/auth/handler.js`. Fix:
  - `email.js:95–129` (P0, all) — `verifyTemplate()`/`resetTemplate()` accept a `locale`
    parameter; subject/HTML/text come from an `{en, uk, ru}` dictionary matching
    `packages/core/messages/*.json`'s shape, replacing the hardcoded Ukrainian literals
    (FR-011).
  - `email.js:160–176` — `sendVerifyEmail()`/`sendResetEmail()` accept and forward `locale`
    (FR-012).
  - `modules/auth/handler.js:58` (P1, all) — `EMAIL_UNSENT_PUBLIC_MSG` moves into a localized
    lookup, resolved by request locale before being set as `email_error` (FR-014).
  - `modules/auth/handler.js` lines ~123, ~277 (verify) and ~339 (reset) — resolve locale from
    `user.preferred_locale` first, then the `kt-lang` cookie for anonymous-adjacent flows,
    then English, and pass it to the email calls (FR-013).
  - Test: extend `tests/email.test.js` with cases for each locale asserting the mocked
    `https.request` body's subject/HTML/text match; extend `tests/auth.test.js` for the
    locale-resolution order at the three call sites (`preferred_locale` present → used;
    absent + `kt-lang` cookie present → used; neither → `en`).
  - **Follow-up landed 2026-08-27 (outside F4's two exclusive files).** The `email.js` and
    `modules/auth/handler.js` fixes left two loose ends this package could not reach, both
    now done:
    - `tests/email.test.js` — not listed under any package's exclusive files even though
      this task assigns the test work. Its `prod-mode posts to api.resend.com/emails` case
      encoded the old bug (asserting a Ukrainian subject for a locale-less call) and was the
      single post-fix failure; it now passes `'uk'` explicitly (4th arg) so it still proves
      the uk template renders. Added 8 locale-selection cases: en/uk/ru × verify/reset assert
      subject/HTML-heading/text, plus an omitted-and-invalid-locale case per sender asserting
      the English fallback. `node --test tests/email.test.js` → 14/14.
    - `server.js` (F5-owned, listed under T004) — `createAuthRoutesModule({...})`'s deps
      literal was missing `readLocaleCookie`, which `resolveEmailLocale()` needs for the
      cookie step of FR-013. Neither T004 nor T006 listed this thread. One line added beside
      the existing `setLocaleCookie`; the existing `server.js:284` parser is reused, no new
      cookie parsing (Principle V), and the handler's JSDoc already declared the dep.
      Verified by driving `/api/auth/forgot-password` with the real `readLocaleCookie`:
      dep wired + `kt-lang=ru` → `ru`; dep missing → `en` (the silent degradation this
      closes); `preferred_locale=uk` outranks the cookie → `uk`; no signal → `en`.
    - Still open for F4: the `tests/auth.test.js` extension named above.

## Phase 6: User Story 4 — Every screen shows real, localized text (Priority: P2)

- [ ] T007 [P] [US4] **Package F3-simulate-chain** — exclusive files: `lib/intel-rules.js`,
      `modules/intel/handler.js`, `public/modules/simulate/index.js`,
      `public/modules/simulate/i18n.js`. Fix:
  - `public/modules/simulate/index.js:90` (P0, all) — `j.error || 'simulation_failed'` → a
    localized `modal.simbids.failed_generic` key, keeping the existing `ollama_unavailable`
    special case (FR-015).
  - `public/modules/simulate/index.js:130` (P1, uk+ru) — `escapeHtml(s.reason || '')`:
    thread a `locale` from `modules/intel/handler.js`'s `handleIntelSimulateBids` into
    `intel-rules.js`'s `simulateBids(parsed, locale)`, and localize the six hardcoded-English
    `reason:` templates at lines 495, 504, 516, 525, 540, 549 in `lib/intel-rules.js` (FR-015).
  - Test: any existing intel-simulate suite covering these two files, extended per-locale; if
    none exists, add a narrow one beside `tests/rules-dialects-questions.test.js`.

- [ ] T008 [P] [US4] **Package F6-html** — exclusive files: `public/index.{en,ru,uk}.html`,
      `public/modules/inspector/template.{en,ru,uk}.html`, `public/about.{en,ru,uk}.html`,
      `public/account.{en,ru,uk}.html`. Fix all 21 confirmed findings in this file set:
  - `public/index.ru.html:239`, `public/index.uk.html:244` (P1) — drop or per-locale-fix the
    hardcoded `aria-label="Sections"` on `#kt-nav-root` (FR-015).
  - `public/modules/inspector/template.ru.html:332` (P1, ru) — `aria-label="Toggle theme"` →
    `"Переключить тему"` (FR-015).
  - `public/modules/inspector/template.uk.html:872` — correct `Відрендер` → `Відрендери`
    (coordinate with F1's `public/i18n.js:143` fix — same phrase, same corrected wording).
  - `public/about.{en,ru,uk}.html` `<head>` — add the missing `og:locale:alternate` (both
    other locales on every page), localize the JSON-LD `description` on the ru/uk index
    pages, add the missing RU row to the Version & format support matrix on `about.en.html`
    and `about.ru.html` (FR-018, FR-020).
  - `public/index.{en,ru,uk}.html` — same `og:locale:alternate` completion; localize the
    JSON-LD `description` on `index.ru.html`/`index.uk.html`; reword
    `index.en.html:257`'s `"🔒 Explicit retention"` to match its own body copy and its ru/uk
    counterparts (e.g. `"🔒 Transparent handling"`) (FR-015, FR-018).
  - `public/about.ru.html:41` / `about.uk.html:40` — resolve the informal/formal register
    clash between `og:image:alt` and `twitter:description` in the same `<head>`, in favor of
    the dominant informal register.
  - `public/about.ru.html:489` / `about.uk.html:488` — drop or de-formalize `ваших`/`ваших`.
  - `public/about.ru.html:614` / `about.uk.html:613` — restore the literal `{date}` token
    (was mistranslated to `{дата}`) (FR-019).
  - `public/account.ru.html:607` — `aria-label="Навигация кабинетом"` →
    `"Навигация по кабинету"` (and the uk equivalent to `"Навігація по кабінету"` if present).
  - `public/account.ru.html:912` / `account.uk.html:909` — de-formalize the one ви/вы
    sentence in each page body.
  - `public/modules/inspector/template.en.html:982` — align the static seed value
    (`"custom ▾"` → `"IAB ▾"`, matching `ru.html`/`uk.html` and `paintFooterDialect()`'s real
    output) (FR-015).
  - Test: no dedicated suite exists for static HTML parity beyond the audit's own structural
    diff method; re-run the audit's programmatic checks (tag-skeleton diff, attribute
    inventory) as a manual verification pass, and run any existing SEO/hreflang test
    (`tests/locale-routes.test.js` or equivalent) unchanged.

- [ ] T009 [P] [US4] **Package F7-module-local** — exclusive files:
      `public/modules/save-sample/index.js`, `public/modules/mirror/index.js`,
      `public/modules/library/index.js`, `public/modules/admin-blog/index.js`,
      `public/modules/intel/banner.js`. `public/modules/dialects/i18n.js` sits in this
      module family but is T005's (F8's) exclusive file to delete, not F7's — see below. Fix:
  - `public/modules/admin-blog/index.js:203,218,243,197` (P0×3, P1×1, all) — route the
    `confirm()`/`alert()`/error-prefix strings through this module's existing `L`/`pick()`
    table (FR-015).
  - `public/modules/library/index.js:433,467` (P0, P1, all) — `(no title)` → the existing
    `cabinet.untitled` key (or a new `library.no_title`); store/display a localized generic
    reason instead of the raw `catalogError`/`Error.message` (FR-015).
  - `public/modules/save-sample/index.js:92,99,313` (P0×3, all) — all three `'sample'`
    fallbacks route through a new `t('sample.default_title')` key (FR-015).
  - `public/modules/mirror/index.js:206` (P1, all) — `'mirror_failed'` → a localized
    `modal.mirror.failed_generic` key (FR-015).
  - `public/modules/dialects/i18n.js` — **do not touch**; this file is deleted by T005 (F8),
    not edited here, to avoid a two-package collision on the same file. _(If T005 has not yet
    landed when this task starts, leave the file as-is and let T005 remove it.)_
  - `public/modules/intel/banner.js:114` (P2, all) — mount the Discovery chip inside the
    registry-managed section root (or add a `kt:lang-change` listener that re-calls
    `refresh()`), mirroring `nav/index.js`/`topbar/index.js`.
  - Test: any existing suite covering admin-blog, library, save-sample, or mirror modules,
    extended per-locale; otherwise a manual per-locale walkthrough recorded in Evidence.

- [ ] T010 [P] [US4] **Package F9-app-shell** — exclusive files: `public/ortbtools.app.js`,
      `public/shell-boot.js`, `public/account.js`. Fix:
  - `public/ortbtools.app.js:2779,2791` (P0, all) — the JSON-path jump button's `title` and
    the spec-reference link's `title`/label route through new `finding.jump_to_path`/
    `finding.spec_tooltip`/`finding.spec_label` keys in `public/i18n.js` (coordinate the key
    additions with F1's ownership of that file, or add them here if F1 has not yet claimed
    those exact lines — the keys are new, not edits to F1's flagged lines, so no collision)
    (FR-015).
  - `public/ortbtools.app.js:4406` (P0, all) — `'backend offline'` → `t('status.backend_offline')`
    (FR-015).
  - `public/shell-boot.js:153,165` (P0×2, all) — localize the inline 404 and
    module-activation-failure fallbacks via the same `document.documentElement.lang` lookup
    `updateSectionTitle()` (~line 184) already uses (FR-016).
  - `public/account.js:853` (P1, all) — the four TP/FP/FN/TN matrix-cell tooltips route
    through new i18n keys (FR-015).
  - New `public/i18n.js` keys added by this task: `finding.jump_to_path`,
    `finding.spec_tooltip`, `finding.spec_label`, `status.backend_offline`, plus the two
    `shell-boot.js` fallback keys and four matrix tooltip keys — all with en/uk/ru values in
    the same edit (Constitution VI). _`public/i18n.js` itself is F1's exclusive file; this
    task adds brand-new keys there, which is additive and does not conflict with F1's
    line-scoped edits, but land T003 first if both are in flight to avoid a merge collision
    on the same file._
  - Test: any existing suite covering the finding-card/status-pill/shell-boot fallbacks,
    extended per-locale.

- [ ] T011 [P] [US4] **Package F10-builder** — exclusive file:
      `public/modules/intel/builder.js`. Fix:
  - `builder.js:472` (P0, all) — `' fields · score '` → `t('builder.cluster_meta', {n, score})`.
  - `builder.js:524` (P0, all) — `' total</span>'` → `t('builder.field_total', {n})`.
  - `builder.js:646` (P0, all) — the rule-based-purpose tooltip → `t('builder.field_purpose_tooltip', {purpose, confidence})`.
  - `builder.js:676` (P0, all) — the `'Custom '` default-name prefix →
    `t('builder.default_name_prefix')`.
  - `builder.js:298` (P1, all) — `aria-label="Close"` → `t('builder.close_aria')`.
  - New `public/i18n.js` keys: `builder.cluster_meta`, `builder.field_total`,
    `builder.field_purpose_tooltip`, `builder.default_name_prefix`, `builder.close_aria` — all
    en/uk/ru (same file-ownership note as T010: additive keys in F1's file, land T003 first
    if concurrent).
  - Test: any existing Discovery Builder suite, extended per-locale; otherwise a manual
    per-locale walkthrough recorded in Evidence.

## Phase 7: Polish & Cross-Cutting

- [ ] T012 Re-run every narrowed test named in T002–T011 together:
      `node --test tests/i18n-audit.test.js tests/ai-label.test.js tests/email.test.js tests/auth.test.js tests/locale-routes.test.js tests/model-free-contract.test.js` —
      all green.
- [ ] T013 Re-run `scripts/label-calibration.js` (if not already done as part of T002) and
      record the outcome — the persona's non-language lines must be unchanged from before this
      package.
- [x] T014 **Documented gap, out of this package's file ownership**: open a follow-up (issue,
      task, or the next agent's scope) to update
      `specs/000-platform-baseline/contracts/locales-versioning.md` lines 44–47, which
      currently document both fallback chains as Ukrainian-only — stale the moment T003/T004
      land. That contract's own Change Rule requires the update to happen "in the same
      feature"; it cannot happen inside this package because `specs/000-platform-baseline/**`
      is not in any of the ten packages' file lists. Do not silently leave this contract
      wrong (Constitution Principle II). **Closed 2026-08-27** by the feature's closing pass
      (outside F1-F10, same feature): both fallback-chain sentences now state the requested →
      `en` → `uk` order and reference [ADR-014](../decisions/ADR-014-default-locale-english.md).
- [ ] T015 Decide, at this point with the full diff visible, whether the aggregate Core-file
      changes (`packages/core/messages/ru.json` correction,
      `packages/core/messages/index.js` fallback-order change) warrant a Core patch bump per
      Constitution Principle IV/VIII; record the decision (bump or explicit no-bump rationale)
      in this file's Evidence.
- [ ] T016 Run `npm run ci`; add the 015 row to `specs/ROADMAP.md` (In Progress → Complete when
      done) and a CHANGELOG bullet under the next unreleased app version; commit ONLY authored
      paths per package (never `git add -A` in this shared worktree — stage each package's
      exact file list plus this feature's own `specs/`/`docs/` paths).
- [ ] T017 Release through the standing path when gates settle (push → hosted CI → fresh
      backup → exact-SHA deploy → live verification), then close the 015 rows and report
      version/tag/SHA/gates.

## Dependencies & Execution Order

T001 (baseline) → { T002 (F2, US1) ‖ T003 (F1, US2) ‖ T004 (F5, US2) ‖ T006 (F4, US3) ‖ T007
(F3, US4) ‖ T008 (F6, US4) ‖ T009 (F7, US4) ‖ T010 (F9, US4) ‖ T011 (F10, US4) } — nine packages
with fully disjoint file ownership; all may run in parallel, in separate sessions, once T001's
baseline is recorded.

Two explicit orderings inside that parallel set:

- **T005 (F8) after T003 (F1) and T004 (F5)** — F8 tightens the parity test to an invariant
  those two packages' fixes must satisfy; running it first would fail on work not yet done.
- **T009's deletion of `public/modules/dialects/i18n.js` is owned by T005, not T009** — if both
  are in flight, T009 must leave that one file untouched and let T005 remove it, to avoid two
  packages editing/deleting the same file.
- **T010 and T011 add brand-new keys to `public/i18n.js`, which is T003's (F1's) exclusive
  file.** These are additive (new keys, not edits to F1's flagged lines) and do not semantically
  conflict, but land T003 first when running concurrently to avoid a raw merge collision in the
  same file.

T012 → T013 → T014 → T015 → T016 → T017 close out the package once every parallel task lands.

## Implementation Strategy

MVP checkpoint: T002 (US1) alone closes the audit's single largest P0 concentration (5 of 23) and
is independently shippable. T003+T004+T005 (US2) close the systemic silent-fallback defect and
are the prerequisite for trusting any other package's "all three locales present" claim going
forward. T006 (US3) is a fully independent, single-package story. T007–T011 (US4) are nine
smaller, fully parallel, fully independent packages with no cross-dependency among themselves.
Ship in any order; the two explicit ordering notes above are the only real constraints.

## Evidence

_(Filled in as each task lands — do not backfill from memory once work has started; update at
the material checkpoint per Constitution Principle I.)_

- T001:
- T002:
- T003:
- T004:
- T005:
- T006:
- T007:
- T008:
- T009:
- T010:
- T011:
- T012:
- T013:
- T014: Closed 2026-08-27 (docs/spec-consistency closing pass, outside F1-F10). Updated
  `specs/000-platform-baseline/contracts/locales-versioning.md`'s Text Ownership section:
  both the Core `resolve()` and browser `window.t()` fallback sentences now state the
  requested → `en` → `uk` order (matching FR-006/FR-007's landed behavior) and reference
  [ADR-014](../decisions/ADR-014-default-locale-english.md) for the server's `en` default.
  Verified via direct read of the contract file before and after.
- T015:
- T016:
- T017:
