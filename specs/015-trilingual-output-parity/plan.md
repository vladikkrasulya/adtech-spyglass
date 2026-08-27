# Implementation Plan: Trilingual Output Parity

**Branch**: `main` (direct defect-repair workflow, per the 012/013/014 precedent) | **Date**:
2026-08-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-trilingual-output-parity/spec.md`, grounded in
`docs/i18n-audit-2026-08-27.md`.

## Summary

The audit confirmed key parity is clean (291 keys × 3 locales in `public/i18n.js`, zero
placeholder drift, zero alphabet contamination) — the parity test that already exists proves
that surface is sound. Every one of the 68 confirmed defects lives somewhere that test never
looks: text a server generates at runtime (the dialect-labelling `reason` field, transactional
email bodies), a literal string typed directly into JS instead of routed through the file's
existing localization call, a per-locale static HTML file that drifted from its siblings, or one
of two independent last-resort fallbacks (`public/i18n.js` `window.t()`,
`packages/core/messages/index.js` `resolve()`) that both silently return Ukrainian for **any**
locale, English included, whenever a key is missing.

This plan does not invent a fix mechanism. Every defect is repaired through the localization
pattern already live in its own file — `t()`/`I18N`, a module's `L`/`pick()` table, a module
`i18n.js` catalog, `packages/core/messages/*.json`, or a new locale-branching function living
beside `lib/label-persona.js` — per Constitution Principle V. The 68 findings are grouped into
**ten file-scoped work packages (F1–F10)**, each with an exclusive, non-overlapping file list, so
they can be executed independently and — because no two packages touch the same file — in
parallel, by separate agent sessions in this same shared worktree.

## Technical Context

**Language/Version**: browser JavaScript (vanilla, IIFE modules + the app bundle), CommonJS
Node.js `>=22.13.0` backend, JSON message catalogs; no new runtime or build step

**Primary Dependencies**: none added

**Storage**: no schema change; `users.preferred_locale` (existing column) becomes read for the
first time by the email flow (FR-013)

**Testing**: `tests/i18n-audit.test.js` (strengthened per FR-009/FR-010); existing focused
suites per touched surface (`tests/model-free-contract.test.js` for the bot-chain boundary,
browser suites for any UI-visible string change); `scripts/label-calibration.js` re-run once
after the persona change (FR-001/edge case)

**Target Platform**: production browser app + Node backend; live only after image rebuild +
deploy

**Project Type**: multi-surface defect repair (frontend modules, backend handlers, Core message
catalogs, static HTML shells) — no new subsystem

**Performance Goals**: negligible — locale becomes one more parameter threaded through existing
calls; no new network calls, no new persistence

**Constraints**: no new i18n mechanism (Principle V); all three locales updated in the same edit
for every new/changed key (Principle VI); Core finding IDs, dedup semantics, and ordering
unchanged (Principle IV); no payload bodies or secrets enter tracked artifacts (Principle III) —
this package touches no privacy/security boundary; ADR-012's bounded-model-assist conditions
(provenance shown, suggestion-only, local-only, allowlisted context) are unchanged — only the
persona's answer-language instruction becomes locale-aware, nothing about what travels to the
model or what it is allowed to do

**Scale/Scope**: 10 work packages, ~30 files, 68 confirmed findings (see `tasks.md` for the exact
file lists and finding-to-task binding, taken verbatim from the ten package briefs authored
alongside this spec)

## Constitution Check

- **I — Spec Kit working memory**: PASS — this package exists before any of the F1–F10 source
  edits, per Principle I's explicit ordering ("no requirements, design, source, or task decisions
  may be authored before context is loaded"); constitution, ROADMAP, `specs/README.md`,
  `specs/DECISIONS.md`, and the 014 package were read before drafting. Entered directly (a
  confirmed, evidence-backed defect list, not an uncertain idea needing `speckit.assess`).
- **II — Evidence-backed**: PASS — every requirement cites the audit's file:line findings; the
  audit itself is the product of a 20-agent scan-then-skeptic process plus two deterministic
  scripts (key parity, alphabet contamination), and 2 candidate findings were rejected by the
  skeptic pass as dead code. This plan also surfaces, rather than silently drops, one place the
  fix and the written contract diverge: `specs/000-platform-baseline/contracts/locales-versioning.md`
  documents both fallback chains as Ukrainian-only today, and that contract requires its own
  update in the same feature — out of this package's file ownership, so it is recorded as an
  explicit follow-up task instead.
- **III — Privacy/security**: PASS — no change to what data is collected, retained, or sent to
  the model; the bot-chain change is answer-language only. Email content becomes
  locale-selected, not content-expanded — no new field is read besides the already-existing
  `preferred_locale` column and the already-existing `kt-lang` cookie pattern used elsewhere.
- **IV — Deterministic public contracts**: PASS with one explicit, ADR-recorded exception —
  `server.js`'s `DEFAULT_LOCALE` changes from `uk` to `en` (ADR-014), a deliberate, documented
  breaking change to the un-parameterized `POST /api/analyze` contract, not a silent one. Core
  finding IDs, dedup, and ordering are otherwise untouched; `packages/core/messages/index.js`'s
  fallback-order refinement is an internal resolution-order change, not a shape/ID change (see
  spec.md Assumptions on the Core-bump decision).
- **V — Bounded architecture**: PASS — zero new i18n mechanisms, frameworks, or abstractions.
  Every fix reuses the mechanism already present in its file; the only new "shape" introduced
  anywhere is a locale parameter threaded through existing function signatures
  (`classifySignal()`, `resolveSignal()`, `verifyTemplate()`, etc.) and small locale-keyed lookup
  tables/maps living beside the code they serve, matching the existing `packages/core/messages/*
.json` and module-`i18n.js` conventions.
- **VI — Locales move together**: PASS — this is the whole feature. Every new or changed key adds
  or corrects all three locales in the same edit; informal register (ти/ты) is enforced
  (FR-017); the parity test is strengthened, not merely re-run (FR-009).
- **VII — Proportional verification**: PASS — FR-009 is itself a Principle VII obligation
  (regression test for a behavior class, not one instance); each F-package's task in `tasks.md`
  names its narrowest test; `npm run ci` gates before commit; the calibration bench (a live-model
  bench, not a CI gate, per ADR-012) is re-run once after the persona change, matching that
  ADR's own maintenance rule.
- **VIII — Traceable release**: PASS — app-version bump decided at release, following the
  012–014 precedent; this plan does not pre-decide it. `resolve()`'s fallback-order change and
  `ru.json`'s correction are the only Core-file touches; whether they warrant a Core patch bump
  is a release-time decision (spec.md Assumptions), not blocking this plan.

## Project Structure

```text
specs/015-trilingual-output-parity/
├── spec.md / plan.md / tasks.md
├── checklists/requirements.md
└── quickstart.md

specs/decisions/ADR-014-default-locale-english.md   # server.js DEFAULT_LOCALE: uk -> en

# Ten file-scoped work packages (F1-F10), each independently owned and non-overlapping:
public/i18n.js                                              # F1 core-catalog
lib/label-persona.js, lib/ollama.js,                         # F2 bot-chain
  modules/ai-label/handler.js,
  packages/core/dialects/signal-lexicon.js,
  public/modules/inspector/dialect-label.js,
  public/modules/inspector/dialect-label.i18n.js
lib/intel-rules.js, modules/intel/handler.js,                # F3 simulate-chain
  public/modules/simulate/index.js, public/modules/simulate/i18n.js
email.js, modules/auth/handler.js                             # F4 email-auth
packages/core/messages/ru.json, packages/core/messages/index.js,  # F5 server-core
  server.js, modules/sample/handler.js, modules/gists/handler.js,
  public/modules/share/index.js, public/modules/share/i18n.js
public/index.{en,ru,uk}.html,                                 # F6 html
  public/modules/inspector/template.{en,ru,uk}.html,
  public/about.{en,ru,uk}.html, public/account.{en,ru,uk}.html
public/modules/save-sample/index.js, public/modules/mirror/index.js,  # F7 module-local
  public/modules/library/index.js, public/modules/admin-blog/index.js,
  public/modules/dialects/i18n.js, public/modules/intel/banner.js
tests/i18n-audit.test.js                                       # F8 tests
public/ortbtools.app.js, public/shell-boot.js, public/account.js   # F9 app-shell
public/modules/intel/builder.js                                 # F10 builder
```

**Structure Decision**: no new directories or subsystems. The ten packages are a work-allocation
device (exclusive file ownership so parallel sessions cannot collide), not an architectural
layer — `tasks.md` is their binding record.

## Design decisions (research folded in — every seam cited by line in the audit)

1. **Locale threading, not a new locale service.** Every plumbing fix (FR-001–FR-004, FR-011–
   FR-013) adds a `locale` parameter to an existing function and reads it from an existing input
   (request body, `user.preferred_locale`, `kt-lang` cookie) — never a new global, singleton, or
   service. This mirrors the pattern `/api/analyze?locale=` and `/api/analyze-behavior?locale=`
   already establish elsewhere in the same codebase (cited in the audit's `bot-ai-surfaces`
   finding for `modules/ai-label/handler.js:186`).
2. **Fallback order, not fallback removal.** FR-006/FR-007 do not remove the Ukrainian
   last-resort — they insert `en` ahead of it for non-`en` requests, and make every fallback
   observable (a `console.warn` client-side). A key genuinely absent from every catalog keeps
   today's bracketed-id behavior; nothing regresses to a blank label.
3. **Two independent locale-keyed reason tables, not one shared one.** FR-002's lexicon reasons
   and FR-001's persona instruction are separate tables living beside their own code
   (`signal-lexicon.js`, `label-persona.js`) because they answer to different constraints: the
   lexicon table is free to change at will, while the persona's non-language lines must stay
   byte-identical across locales for `scripts/label-calibration.js`'s holdout comparison
   (ADR-012 condition 2). Collapsing them into one shared catalog would either break that
   invariant or force the lexicon to inherit a constraint it doesn't have.
4. **Email templates gain a parameter, not a new templating layer.** `verifyTemplate()`/
   `resetTemplate()` already build subject/HTML/text as plain template literals; FR-011 makes
   that literal locale-keyed (an `{en, uk, ru}` object indexed once at the top of each function),
   matching the existing `packages/core/messages/*.json` shape convention without adopting JSON
   files for email (email bodies carry HTML structure the JSON message catalogs don't need to).
5. **Dead code is deleted, not localized.** `public/modules/dialects/i18n.js` (FR-010) is
   confirmed unreachable by the audit's skeptic pass (grep across `public/` finds only the file
   and its own README, which already documents the abandonment) — bringing it under the
   strengthened FR-009 parity invariant would either force pointless work on inert code or create
   a permanent carve-out in the test. Deleting it is the smaller, more honest change.
6. **The ten packages are execution-scoped, not user-story-scoped.** A package's file list can
   serve more than one user story (e.g., F1 fixes both a Priority-1 fallback line and three
   Priority-2/3 quality lines in the same file) because the audit's findings are organized by
   _file_, and Constitution Principle V's "use that file's exact pattern" reads most naturally
   file-by-file. `tasks.md` records which user story each finding advances; the package is simply
   who has write access to which files at once.

## Complexity Tracking

No constitution violations requiring justification. One documented, deliberate exception is
already ADR-recorded rather than argued here: [ADR-014](../decisions/ADR-014-default-locale-english.md)
changes a public API default, and Principle IV requires exactly that — an explicit compatibility
decision, not silence.
