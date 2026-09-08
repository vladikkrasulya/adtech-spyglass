# Quickstart Validation: Inspector UI Repair

Prerequisites: repo checkout, Node.js >= 22.13.0, `npm ci` run, a local Chromium for the browser
suites. Commands run from the repository root.

## 1. The pure resolution helpers

```bash
node --test tests/creative-resolution.test.js
```

Covers push qualification from both sides (a PPCmate pop and a vendor banner bid must not qualify;
icon-only and image-only materials must), destination resolution for every documented wrapper, and
candidate enumeration across seats and materials.

## 2. The three bugs, in a real browser

```bash
node --test --test-concurrency=1 tests/clear-resets-results-browser.test.js tests/push-preview-browser.test.js
```

## 3. The corpus, non-browser layers

```bash
node --test tests/corpus-lib.test.js tests/corpus-report.test.js tests/corpus-core.test.js tests/corpus-http.test.js
```

## 4. The corpus, browser layers

Run these alone — Chrome is contended on a shared machine and a loaded run flakes:

```bash
CORPUS_REQUIRE_BROWSER=1 node --test --test-concurrency=1 tests/corpus-browser.test.js tests/corpus-ux-browser.test.js tests/corpus-ux-a11y-browser.test.js
```

## 5. Repository gate

```bash
npm run ci
```
