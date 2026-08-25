# Quickstart: Validating Creative Preview Repair — Wave 1

Runnable checks that prove the completed feature works. Narrowest first, as Principle VII requires.

## Prerequisites

- Node.js `>=22.13.0`, dependencies installed.
- A system Chrome for the browser phase. The suite uses `puppeteer-core` against system Chrome rather
  than downloading Chromium.

## 1. Classification and locale contracts

```bash
node --test tests/creative-preview-classify.test.js tests/i18n-audit.test.js
```

The classifier test covers every normative row, padded and valid unpadded base64, exactly one decode
round, the single Core VAST detector, and fail-closed behavior when Core is absent. The locale audit
loads the Inspector module dictionary and verifies non-empty English, Ukrainian, and Russian values
with identical placeholder sets, including the localized VAST truncation notice.

**Expected**: all pass; no skipped tests.

## 2. Static-analysis source transport

```bash
node --test tests/analyze-behavior-transport.test.js tests/behavior.test.js tests/behavior-audit.test.js
```

This proves that `/api/analyze-behavior`:

- accepts canonical `adm_b64` containing valid UTF-8 up to 1 MiB and exposes `admTruncated` metadata;
- rejects malformed, non-canonical, invalid-UTF-8, and oversized source data;
- preserves legacy `{ events, adm }` callers; and
- can run static rules for the executing source with zero runtime-visible probe events.

**Expected**: all pass. The engine receives the decoded body, not the base64 wrapper that originally
carried the creative.

## 3. The sealed-frame gate

```bash
node --test tests/creative-preview-seal.test.js tests/macro-evaluator-browser.test.js
```

The seal test characterizes the current policy byte for byte and fails if it is widened or narrowed.
The existing browser trap proves a rendered creative makes no advertiser request before the analyst
explicitly invokes the pre-existing banner asset action. Native has no such action in this wave.

**Expected**: policy, sandbox, and zero-creative-network assertions pass unchanged.

## 4. Real-browser preview boundary

```bash
node --test --test-concurrency=1 tests/creative-preview-browser.test.js
```

This is the functional gate that structural source checks cannot replace. It proves:

- `/creative-probe.js` is awaited and requested with a content hash;
- the current-frame source pin and hidden per-render capability reject creative-authored reserved
  messages while genuine probe events still arrive;
- parent validation/deduplication caps the refusal ledger at 200 without evicting behavior events;
- real Chromium `script-src-elem`/`style-src-elem` refusals appear under localized stable kinds;
- URL and VAST bodies are inert and unrevealable, and missing classification fails closed;
- padded and valid unpadded base64 decode once;
- wrapped and unwrapped Native payloads produce the same escaped synthetic frame with no Native
  asset-inlining offer;
- the behavior request contains the macro-resolved/classified/synthetic body that executes rather
  than the encoded/raw wrapper; and
- VAST truncation text is localized.

**Expected**: pass with a real, non-skipped Chrome run.

## 5. Full browser phase

```bash
npm run test:browser
```

Runs every Puppeteer file serially. This preserves all pre-existing Inspector, macro, behavior, and
network assertions beside the focused feature gate.

**Note**: the phase is sensitive to foreign Chrome processes and runs each file once. The complete
`npm run ci` runner retries a failed browser file once to distinguish environmental Chrome noise;
the standalone `npm run test:browser` command itself does not retry.

## 6. Manual spot-check

| Paste                                        | Expected result                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| wrapped or envelope-less Native JSON         | same synthetic card and probe; raw JSON never in `srcdoc`; no Native load-assets button |
| banner with CDN image/script/style           | sealed frame plus localized count, distinct hosts, and image/script/style kinds         |
| bare `https://…` URL                         | inert, unlinked text; no iframe or request                                              |
| padded or valid unpadded base64 banner       | decoded creative, with decoding stated once                                             |
| VAST longer than the display bound           | readable scrollable text, no overlay, localized hidden-character count                  |
| classifier or Core VAST detector unavailable | inert unidentified text; never the old catch-all frame                                  |

Read the preview without developer tools: an analyst must be able to distinguish an empty creative
from a deliberate resource refusal. Then inspect the Behavior tab with a static-only creative; its
findings must appear even when there are zero runtime-visible events.

## 7. Complete repository gate

```bash
npm run ci
npm run test:browser
```

Report exact commands, exit codes, and whether Chrome tests were skipped. An unrun or skipped check is
not a passing check.
