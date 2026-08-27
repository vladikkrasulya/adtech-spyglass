# Feature Specification: Trilingual Output Parity

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013/014 precedent)

**Created**: 2026-08-27

**Status**: In Progress

**Input**: `docs/i18n-audit-2026-08-27.md` — a 20-agent audit (10 scanners, 10 skeptics, plus a
deterministic key-parity script and a letter-set-contamination script) of every locale-carrying
surface in the product. Key parity in the shared browser catalog is already clean: 291 keys × 3
locales in `public/i18n.js`, zero `{placeholder}` drift, zero alphabet contamination. **68
defects are confirmed** (P0 23 · P1 18 · P2 27; 2 rejected as dead code) — every one of them in a
place the parity test does not look: model-generated text, hardcoded literals, per-locale HTML
files, and silent Ukrainian fallback. Ukrainian and Russian are contractually informal-singular
(ти/ты) per Constitution Principle VI and the platform's
[locales-and-versioning contract](../000-platform-baseline/contracts/locales-versioning.md); a
handful of confirmed defects are register breaks (ви/вы) against that contract.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The dialect-labelling assistant answers in the operator's locale (Priority: P1)

An operator on the English or Russian interface asks the dialect-labelling assistant to suggest
a meaning for an unrecognized vendor signal. Today the `reason` text that comes back — whichever
of the two paths answers, the deterministic lexicon or the local model — is Ukrainian every time,
regardless of the operator's locale, because no caller in the chain ever reads or forwards one.

**Why this priority**: This is systemic cause (a) from the audit. It is the single largest
concentration of P0 defects (5 of 23) and the most visible: a Ukrainian sentence sitting inside an
otherwise fully localized modal, next to chrome the operator can read.

**Independent Test**: Request `/api/dialects/suggest-label` with `locale: 'en'` and again with
`locale: 'ru'` for a signal the lexicon resolves and for one that reaches the model; the `reason`
field in the response is in the requested language both times, and the client renders it without
a mixed-language sentence.

**Acceptance Scenarios**:

1. **Given** a signal the deterministic lexicon resolves, **When** the request carries
   `locale: 'en'` or `locale: 'ru'`, **Then** the returned `reason` is in that locale, not
   Ukrainian.
2. **Given** a signal that reaches the local model, **When** the request carries a non-Ukrainian
   locale, **Then** the model's system persona instructs it to answer in that locale and the
   returned `reason` is in that locale.
3. **Given** the same modal, **When** any locale's suggestion renders, **Then** the `reason` text
   sits beside chrome that is already localized (`dialect.label.proposal_title`,
   `confidence`, `source....hint`) with no visible language mismatch.

---

### User Story 2 - Missing text never silently becomes Ukrainian (Priority: P1)

A key absent from a locale's table today resolves to the Ukrainian string in both fallback
chains — the browser's `window.t()` and Core's `packages/core/messages/index.js` `resolve()` —
for every locale, including English, the canonical no-prefix locale. Nothing distinguishes a
silent fallback from a legitimate Ukrainian string, so drift is invisible.

**Why this priority**: Systemic cause (b). It is the reason a single missing key can make an
English-locale visitor see Ukrainian text with zero signal that anything went wrong, and it is
what let the browser catalog's actual cleanliness (291/291 keys present) mask that both fallback
mechanisms themselves are still wrong in principle.

**Independent Test**: Delete a key from the `en` table only (browser and Core, one at a time),
request that key at `locale=en`, and confirm the result is the `en`-preferred fallback path (not
silently `uk`) and that a dev-visible warning appears; run `tests/i18n-audit.test.js` and confirm
it now fails — not skips — when a key exists in `en.json` but is missing from `uk.json` or
`ru.json` (or vice versa).

**Acceptance Scenarios**:

1. **Given** a key present in `en` but absent from `uk`/`ru`, **When** `uk` or `ru` is requested,
   **Then** the resolver prefers `en` over `uk` before falling back further, and the fallback is
   observable (console warning client-side; a distinguishable outcome server-side).
2. **Given** a key missing from all three locales, **When** it is requested, **Then** the visible
   result stays a bracketed/identifiable id, never a blank label (existing behavior, unchanged).
3. **Given** `tests/i18n-audit.test.js`, **When** a finding id exists in one locale's catalog and
   not another's, **Then** the suite fails for that gap instead of skipping the comparison.
4. **Given** `POST /api/analyze` with no `?locale=` parameter, **When** the request is resolved,
   **Then** the response is English (see [ADR-014](../decisions/ADR-014-default-locale-english.md)
   for the decision that makes English the server default, matching the app's existing en-canonical
   convention).

---

### User Story 3 - Account email matches the account's language (Priority: P1)

A user whose account (or session) locale is Russian or English registers, or requests a password
reset. The email that arrives — subject, HTML, and text body — is Ukrainian regardless, because
`email.js`'s templates take no locale argument and their only callers never read
`user.preferred_locale`, a column that already exists on the row.

**Why this priority**: Systemic cause (c). Transactional email is the one surface in this audit
that leaves the product entirely — it lands in an inbox the operator may show to someone else —
so a wrong-language email is a visible, standalone artifact of the defect, not a screen the user
can just navigate away from.

**Independent Test**: Register (or request a reset for) an account whose `preferred_locale` is
`en`, then `ru`; read the delivered email in each case and confirm subject/HTML/text match that
locale.

**Acceptance Scenarios**:

1. **Given** a user row with `preferred_locale = 'en'`, **When** the verification email is sent,
   **Then** its subject, HTML, and text are English.
2. **Given** a user row with `preferred_locale = 'ru'`, **When** the password-reset email is sent,
   **Then** its subject, HTML, and text are Russian.
3. **Given** an anonymous-adjacent flow with no `preferred_locale` yet on the row, **When** an
   email is sent, **Then** the `kt-lang` cookie (if present) selects the locale, falling back to
   English.

---

### User Story 4 - Every screen shows real, localized text (Priority: P2)

Across the app shell, module UIs, the HTML page shells, and backend error/label text, ~50
confirmed defects put a raw English literal, an English technical token, or (in three flagged
HTML/aria spots) a leftover mismatched-locale phrase on screen instead of the localized string
the surrounding UI already uses. Each is a small, independent gap — a `confirm()` dialog, a
tooltip, a default title, a fallback error message — in code that otherwise routes every sibling
string through that file's existing localization pattern (`t()`/`I18N`, a module's own `L`/
`pick()` table, or a module `i18n.js` catalog).

**Why this priority**: No single one of these blocks a task the way US1–US3 do, but collectively
they are the majority of the confirmed defects (F1, F3's remaining item, F5's remaining items,
F6, F7, F9, F10 — see `docs/i18n-audit-2026-08-27.md` for the full itemized list, and `tasks.md`
for the file-scoped breakdown of exactly which findings land in which package).

**Independent Test**: For each flagged file:line in the audit, exercise the code path in all
three locales and confirm the string now renders through that file's existing i18n pattern with
correct en/uk/ru text, and that no raw English literal remains for a ru/uk-locale user (or, for
the three `en`/`ru`/`uk` HTML/aria mismatches, that the string now matches its own locale).

**Acceptance Scenarios**:

1. **Given** any flagged confirm/alert/tooltip/default-value string, **When** the active locale
   is `uk` or `ru`, **Then** the rendered text is real Ukrainian/Russian, not English.
2. **Given** the SPA shell's 404 and module-activation-failure fallbacks, **When** either fires in
   `uk` or `ru`, **Then** the heading/body text is localized via the same
   `document.documentElement.lang` lookup `updateSectionTitle()` already uses.
3. **Given** a server-produced error code or filename-derived label (share-link expiry, sample
   catalog label, mirror/simulation failure), **When** it reaches a locale-aware toast, **Then**
   the visible text is fully localized, not a raw code or filename fragment appended after a
   localized prefix.

---

### User Story 5 - Translation register and locale metadata stay consistent (Priority: P3)

A handful of confirmed defects are not wrong-language but wrong-register (formal ви/вы where the
document is informal ти/ты throughout, per Constitution VI and the locales contract) or
locale-metadata gaps (a missing `og:locale:alternate`, an untranslated JSON-LD description, a
mistranslated `{date}` placeholder, a support-matrix table missing its own page's locale, a debug
helper that omits `ru` from its key count).

**Why this priority**: Quality and consistency, not breakage — nothing here shows the wrong
language, but several are genuine defects against a written contract (the informal-register rule)
or against reality (a placeholder token that no longer matches the real generated filename).

**Independent Test**: Read each flagged file end to end in the target locale; confirm register is
uniform, `{date}`/`{6-hex}` placeholders are untranslated literal tokens, and locale-metadata rows
(alternates, support matrices, `tInfo()`) list all three live locales.

**Acceptance Scenarios**:

1. **Given** `public/account.{ru,uk}.html` and `public/about.{ru,uk}.html`, **When** read in
   full, **Then** every second-person reference uses the informal register already dominant in
   that document.
2. **Given** `public/index.*.html`, `public/about.*.html`, **When** the `<head>` is inspected,
   **Then** `og:locale:alternate` lists both other live locales and the JSON-LD `description`
   matches the page's own `og:description` language.
3. **Given** `packages/core/messages/ru.json:104`, **When** compared against the other 33
   `Сидбид` occurrences in the same file, **Then** the spelling uses Russian и, not Ukrainian і.

### Edge Cases

- A locale param outside `en`/`uk`/`ru` (or absent) must resolve the same way it does today after
  the ADR-014 default change: `en`, not `uk` (server), and the browser's existing
  `<html lang>`/`localStorage` resolution (unchanged by this feature).
- The `lib/label-persona.js` locale variants MUST stay byte-identical to each other except the
  closing "answer in {locale}" sentence, because `scripts/label-calibration.js`'s holdout
  comparison depends on persona stability (ADR-012 condition 2, "deterministic first" and its
  calibration-bench obligation); the calibration bench MUST be re-run once after the persona
  change lands, per the audit's proposed fix.
- The deterministic lexicon's per-locale reason tables are NOT constrained by the calibration
  bench (it benches the model's label/confidence choice, not the lexicon's fixed wording) and may
  be localized freely.
- An anonymous-adjacent email flow (no `preferred_locale` on the row yet) falls back to the
  `kt-lang` cookie, then English — never silently Ukrainian.
- `packages/core/messages/index.js`'s fallback order changes from "always uk" to "requested
  locale → en → uk". This is documented today in the platform's
  [locales-and-versioning baseline contract](../000-platform-baseline/contracts/locales-versioning.md)
  (lines 44–47, "Core's missing-message fallback is Ukrainian... `public/i18n.js`... falls back to
  Ukrainian for a missing key") as the current, contracted behavior. That contract's own **Change
  Rule** requires it to be updated in the same feature as a fallback-order change — but
  `specs/000-platform-baseline/**` is outside this package's file ownership (see Assumptions).
  This gap is recorded as an explicit follow-up task in `tasks.md` rather than silently left for
  someone to notice later.
- The three-locale key-parity invariant tightened by User Story 2 (Acceptance Scenario 3) applies
  to every catalog registered through the existing per-module mechanisms (`public/i18n.js`'s
  `I18N` table and `public/modules/**/i18n.js` catalogs that call `registerI18nModule`/push onto
  `window.kt_i18n_modules`), not to `public/modules/dialects/i18n.js`, which is confirmed dead
  code (imported by nothing, per its own README) and is deleted rather than wired in or tested.

## Requirements _(mandatory)_

### Functional Requirements

**Systemic cause (a) — locale-aware AI-assisted labelling**

- **FR-001**: `lib/label-persona.js`'s `PERSONA` MUST become locale-parameterized (a
  `buildPersona(locale)` function or a per-locale map) so its closing instruction tells the model
  to answer in the requested locale (en/uk/ru), with every other line byte-identical across
  locales.
- **FR-002**: `packages/core/dialects/signal-lexicon.js`'s `resolveSignal()` MUST accept a
  `locale` parameter and return every `reason:` string (all ~10 hardcoded occurrences) from a
  per-locale table instead of a fixed Ukrainian template literal.
- **FR-003**: The request chain — `public/modules/inspector/dialect-label.js` `askAgent()` →
  `modules/ai-label/handler.js` `handleSuggest()` → `lib/ollama.js` `classifySignal()` — MUST
  thread a `locale` value end to end (defaulting to `en` only when the request supplies nothing
  usable, mirroring the existing `/api/analyze?locale=` pattern), reaching both `resolveSignal()`
  and the persona builder.
- **FR-004**: `lib/ollama.js`'s structural prompt labels ("Шлях:", "Значення:", etc.) SHOULD move
  to the same per-locale table as FR-001, for consistency, though they are not independently
  user-visible.
- **FR-005**: `public/modules/inspector/dialect-label.js:207`'s render site
  (`esc(suggestion.reason || '')`) requires no code change — once FR-001–FR-003 land, it already
  renders whatever locale-correct `reason` the server returns.

**Systemic cause (b) — fallback chains stop defaulting to Ukrainian**

- **FR-006**: `public/i18n.js`'s `window.t()` (around line 1297) MUST try the requested locale,
  then `en` (when the requested locale is not `en`), then `uk` as the last resort, and MUST emit a
  `console.warn` on every fallback so drift is visible in development.
- **FR-007**: `packages/core/messages/index.js`'s `resolve()` (around lines 23/38–41) MUST apply
  the same requested → `en` → `uk` order.
- **FR-008**: `server.js:78`'s `DEFAULT_LOCALE` MUST change from `'uk'` to `'en'`, per
  [ADR-014](../decisions/ADR-014-default-locale-english.md); `resolveLocale()`'s behavior for a
  present, valid `?locale=` param is unchanged.
- **FR-009**: `tests/i18n-audit.test.js` MUST gain a key-set-parity assertion across all three
  Core message catalogs, evaluated before the existing placeholder-drift loop, so that a finding
  id present in one locale's catalog and absent from another's **fails** the suite rather than
  being skipped by the current `if (!(id in CATALOGS[locale])) continue;` guard (line ~211). The
  same invariant MUST cover every catalog registered by a module's `i18n.js` through the existing
  `registerI18nModule`/`window.kt_i18n_modules` mechanism.
- **FR-010**: `public/modules/dialects/i18n.js` MUST be deleted (confirmed dead code, imported by
  nothing, its own README already documents the abandonment) rather than wired in, so it cannot
  produce a false pass or false fail under FR-009's tightened invariant.

**Systemic cause (c) — transactional email follows account locale**

- **FR-011**: `email.js`'s `verifyTemplate()`/`resetTemplate()` MUST accept a `locale` parameter
  and select subject/HTML/text from an `{en, uk, ru}` dictionary matching
  `packages/core/messages/*.json`'s pattern, instead of the current hardcoded-Ukrainian literals.
- **FR-012**: `sendVerifyEmail()`/`sendResetEmail()` MUST accept and forward that `locale`.
- **FR-013**: `modules/auth/handler.js`'s three call sites (verify at line ~123/277, reset at line
  ~339) MUST resolve locale from `user.preferred_locale` first, falling back to the `kt-lang`
  cookie for anonymous-adjacent flows, then English.
- **FR-014**: `modules/auth/handler.js:58`'s `EMAIL_UNSENT_PUBLIC_MSG` MUST move into a localized
  catalog and be resolved by request locale before it is set as `email_error`, so the client
  toast (`toast.send_failed`) is not a localized prefix followed by a raw English fragment.

**Hardcoded literals and wrong-language text across surfaces (User Story 4)**

- **FR-015**: Every confirmed hardcoded-literal and wrong-language finding listed in
  `docs/i18n-audit-2026-08-27.md` under `hardcoded-frontend-a`, `hardcoded-frontend-b`,
  `modules-catalog-a`, `html-shell`, `backend-output` (the `modules/gists/handler.js`,
  `modules/sample/handler.js`, `modules/auth/handler.js:58` items are covered by FR-014's sibling
  scope), and the `public/modules/simulate/index.js`/`lib/intel-rules.js` pair MUST be fixed
  through that file's existing localization mechanism — never a new one (Constitution Principle
  V) — with all three locales added or corrected in the same edit (Constitution Principle VI).
  `tasks.md` binds each finding to the file-scoped package (F1, F3, F5, F6, F7, F9, F10) that owns
  it, with the exact lines cited.
- **FR-016**: `public/shell-boot.js`'s inline 404 and module-activation-failure fallbacks MUST
  localize via the same `document.documentElement.lang` lookup `updateSectionTitle()` already
  uses in that file, with new `en`/`uk`/`ru` values for both messages.

**Register and locale-metadata quality (User Story 5)**

- **FR-017**: Every confirmed formal-register (ви/вы) string in a document whose surrounding
  register is informal (ти/ты) MUST be rewritten informal, per Constitution Principle VI and the
  locales-and-versioning contract — except where the audit records a plausible gender-avoidance
  rationale (`toast.signed_out`, ru; the equivalent uk string), where a gender-neutral informal
  rewrite is preferred over reverting to formal.
- **FR-018**: `public/index.*.html` and `public/about.*.html` `<head>` blocks MUST each declare
  both other live locales via `og:locale:alternate`, and every JSON-LD `description` MUST match
  that page's own `og:description` language.
- **FR-019**: The `{date}`/`{6-hex}` filename-pattern placeholder in `public/about.ru.html:614`
  and `public/about.uk.html:613` MUST stay untranslated literal tokens, matching the real
  generator in `public/export.js`.
- **FR-020**: `public/about.en.html`'s and `public/about.ru.html`'s Version & format support
  matrix MUST list all three locales (adding the missing RU row).
- **FR-021**: `packages/core/messages/ru.json:104`'s `Сидбід` MUST become `Сидбид` (Russian и),
  matching the other 33 occurrences in that file; `uk.json`'s `Сідбід` is correct and untouched.
- **FR-022**: `public/i18n.js`'s `window.tInfo()` MUST report `keys_ru` alongside its existing
  `keys_uk`/`keys_en` counts.

### Key Entities

- **Locale**: one of `en` (canonical, no URL prefix), `uk` (`/uk`), `ru` (`/ru`) — the platform's
  three supported product locales (locales-and-versioning contract).
- **Fallback chain**: the two independent last-resort lookups that resolve a missing key —
  `public/i18n.js`'s `window.t()` and `packages/core/messages/index.js`'s `resolve()` — both
  currently `uk`-only, both changed by this feature to prefer the requested locale, then `en`,
  then `uk`.
- **Persona**: `lib/label-persona.js`'s system prompt sent to the local model on every dialect
  labelling request; becomes locale-parameterized under FR-001.
- **`reason` field**: the free-text explanation attached to a dialect-labelling suggestion,
  produced by either the deterministic lexicon or the model, rendered raw (no `t()` wrapping) at
  the one confirmed render site.
- **`preferred_locale`**: the existing user-row column that email locale resolution reads
  (FR-013); previously unread by any email call site.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All 68 confirmed defects from `docs/i18n-audit-2026-08-27.md` are fixed; `tasks.md`
  records, per finding, which task closed it.
- **SC-002**: `tests/i18n-audit.test.js` fails (not skips) when a finding id exists in one Core
  message catalog and not another; 0 gaps found across `en`/`uk`/`ru` on the tightened invariant.
- **SC-003**: A `POST /api/analyze` request with no `?locale=` returns English finding text
  (ADR-014); a request with `?locale=ru` or `?locale=uk` is unaffected.
- **SC-004**: A dialect-labelling suggestion's `reason` field matches the requesting locale for
  both the lexicon path and the model path, verified for `en`, `uk`, and `ru`.
- **SC-005**: A verification or reset email sent to a user with `preferred_locale = 'en'` (or
  `'ru'`) arrives in that language — subject, HTML, and text — 100% of the time.
- **SC-006**: Zero raw-English literals remain at any of the flagged `hardcoded`/
  `runtime-locale-ignored`/`wrong-language` file:line sites for a `uk`- or `ru`-locale user,
  spot-checked against the audit's own citations.
- **SC-007**: `npm run ci` is green after every package (F1–F10) lands.

## Assumptions

- Ukrainian and Russian remain informal singular address (ти/ты) throughout every new or changed
  string in this package, per Constitution Principle VI; no formal ви/вы is introduced.
- **No new i18n mechanism is introduced anywhere in this package** (Constitution Principle V).
  Each touched file keeps using its existing pattern: `window.t()`/`I18N` tables for
  `public/i18n.js` consumers, a module's own `L`/`pick()` table for IIFE-style modules, a module
  `i18n.js` catalog with `registerI18nModule`/`window.kt_i18n_modules` where that convention
  already exists, `packages/core/messages/*.json` + `resolve()` for Core finding text, and
  locale-branching functions living beside `lib/label-persona.js`/`signal-lexicon.js` for the
  bot chain.
- The email locale fix reads `user.preferred_locale` first, then the `kt-lang` cookie for
  anonymous-adjacent flows (a token issued before login), then English — per the audit's proposed
  fix, matching the resolution order already established for browser UI locale.
- `specs/000-platform-baseline/contracts/locales-versioning.md` is **not** in this package's file
  ownership. Its description of both fallback chains as Ukrainian-only (lines 44–47) becomes
  stale the moment FR-006/FR-007 land, and that contract's own Change Rule requires it to be
  updated in the same feature. `tasks.md` records this as an explicit, separately-owned follow-up
  task rather than silently leaving the contract to drift (Constitution Principle II).
  `server.js`'s `DEFAULT_LOCALE` is not currently documented in that contract by value, only the
  fallback chains are — so ADR-014 alone (a durable decisions record) is this package's complete,
  in-scope answer for that specific change.
- `packages/core/messages/index.js`'s fallback-order change is a refinement of `resolve()`'s
  internal behavior, not a finding-id/shape/provenance change; per Constitution Principle IV it
  does not by itself require a Core SemVer bump, but the maintainer decides at release time
  whether the aggregate of this package's Core-file changes (`ru.json` correction,
  `index.js` fallback order) warrants one — recorded in `plan.md`, not pre-decided here.
- Scope is `en`/`uk`/`ru` text, the fallback/default-locale mechanisms, and the AI-labelling and
  email locale plumbing named above. No new locale is added, no UI layout changes, no new API
  route, and no change to Core finding IDs, dedup semantics, or ordering (Constitution Principle
  IV).
