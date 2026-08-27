# Quickstart Validation: Trilingual Output Parity

All commands from the repository root. No production records or payload bodies are used —
synthetic fixtures and the repo's own test doubles only (Constitution III/VII).

## 1. Narrowest suites per package (run as each lands)

```bash
node --test tests/ai-label.test.js              # F2 — bot-chain locale threading
node --test tests/i18n-audit.test.js             # F1, F5, F8 — catalogs + strengthened parity
node --test tests/email.test.js tests/auth.test.js  # F4 — email locale resolution
node --test tests/model-free-contract.test.js    # F2 — ADR-012 boundary unchanged
node --test tests/locale-routes.test.js          # F5 — DEFAULT_LOCALE / route locale
```

## 2. Full narrowed sweep (Phase 7, T012)

```bash
node --test tests/i18n-audit.test.js tests/ai-label.test.js tests/email.test.js \
  tests/auth.test.js tests/locale-routes.test.js tests/model-free-contract.test.js
```

## 3. Calibration bench (T002/T013 — live model, not a CI gate)

```bash
node scripts/label-calibration.js
```

Expected: identical or improved HOLDOUT numbers versus the pre-change baseline recorded in T001;
the persona's non-language lines must be byte-identical across locales for this comparison to
mean anything (ADR-012 condition 2).

## 4. Manual per-locale spot checks (surfaces with no dedicated automated suite)

- `public/index.{en,ru,uk}.html`, `public/about.{en,ru,uk}.html`,
  `public/account.{en,ru,uk}.html`, `public/modules/inspector/template.{en,ru,uk}.html`: open
  each in a browser at its own route, switch `<html lang>`/locale, and read end to end.
- `public/modules/intel/builder.js`, `public/modules/admin-blog/index.js`,
  `public/modules/library/index.js`, `public/modules/save-sample/index.js`,
  `public/modules/mirror/index.js`, `public/modules/simulate/index.js`: exercise each flagged
  action (close button, confirm dialog, error toast, default title, failure message) in all
  three locales.

## 5. Fallback-order proof (US2)

```js
// In a Node REPL or a throwaway script, with public/i18n.js loaded/stubbed as
// tests/i18n-audit.test.js already does:
delete I18N.en['toast.copy_failed']; // pick any real key
window.t('toast.copy_failed'); // lang='en' active
// Expect: falls through en (missing) -> uk, WITH a console.warn — not a silent uk hit.
```

```bash
curl -s -X POST http://localhost:3000/api/analyze -d '{"id":"x"}' | jq '.meta.locale // empty'
# Expect: "en" with no ?locale= param (ADR-014), was "uk" before this package.
```

## 6. Full gate

```bash
npm run ci
```

## Requirement → proof map

| Requirement    | Proof                                                                            |
| -------------- | -------------------------------------------------------------------------------- |
| FR-001–FR-005  | `tests/ai-label.test.js` extensions; §3 calibration bench                        |
| FR-006, FR-009 | `tests/i18n-audit.test.js` (strengthened); §5 fallback-order proof               |
| FR-007, FR-008 | `tests/i18n-audit.test.js`; §5 `/api/analyze` no-`?locale=` curl check           |
| FR-010         | `tests/i18n-audit.test.js` passes with `public/modules/dialects/i18n.js` deleted |
| FR-011–FR-014  | `tests/email.test.js`, `tests/auth.test.js` extensions                           |
| FR-015, FR-016 | §4 manual per-locale spot checks; any extended module-local suite                |
| FR-017–FR-022  | §4 manual per-locale spot checks (HTML/register/metadata)                        |
| SC-007         | §6 `npm run ci`                                                                  |
