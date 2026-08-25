# Quickstart: Validating Creative Preview Repair — Wave 1

Runnable checks that prove the feature works. Narrowest first, as Principle VII requires.

## Prerequisites

- Node.js `>=22.13.0`, dependencies installed.
- A system Chrome for the browser phase. The suite uses `puppeteer-core` against system Chrome rather
  than downloading Chromium.

## 1. Classification table — no browser, fast

```bash
node --test tests/creative-preview-classify.test.js
```

Asserts the normative order in [contracts/creative-preview.md](./contracts/creative-preview.md) §1
over one fixture per row, plus the invariants: exactly one base64 decode round, `markup` as the only
kind that may reach a frame, and classification leaving the body unchanged.

**Expected**: all pass. A failure here names the row that disagreed with the contract.

## 2. The seal gate

```bash
node --test tests/creative-preview-seal.test.js
```

Characterises the current rendering outcome for a creative carrying an `https:` image and fails if the
frame policy is widened **or** narrowed. To confirm the gate actually bites, temporarily add `https:`
to the `img-src` directive in `buildProbedSrcdoc` (`public/ortbtools.app.js`) and re-run — it must
fail. Revert before continuing.

**Expected**: passes as shipped; fails on any edit to the policy in either direction.

## 3. Behaviour findings are provably unchanged

```bash
node --test tests/behavior.test.js tests/behavior-audit.test.js tests/creative-preview-classify.test.js
```

FR-009 is the requirement most easily broken by accident, because the refusal ledger shares a message
channel with behaviour instrumentation. The check that matters: a creative emitting more refusals than
the behaviour buffer holds must not change the behaviour findings that creative produces.

**Expected**: finding count and content identical to the pre-change baseline for the same payload.

## 4. Browser phase

```bash
npm run test:browser
```

Covers what only a real browser can show: that violations are actually raised inside the frame and
counted, that the reveal overlay is absent over text-mode previews, and that
`tests/macro-evaluator-browser.test.js`'s existing `trapRequests === 0` assertion still holds — the
creative still reaches no network.

**Note**: this phase is sensitive to other Chrome instances on the same machine. If it fails in a way
unrelated to the change, check for a foreign Chrome before believing the result.

## 5. By hand, in the running app

The forensic evidence for each of these is in [research.md](./research.md) §3.

| Paste                                            | Before                                                  | Expected after                                                                         |
| ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `adm` = `{"assets":[…],"link":{…}}` (no wrapper) | pretty JSON painted as markup, nothing in the console   | native card renders, probe mounted                                                     |
| `adm` = banner referencing CDN images            | blurred residue of alt text and macro literals          | the creative's own markup, plus a stated count of refused resources and distinct hosts |
| `adm` = a bare `https://…` URL                   | one line of text, unexplained                           | named as a URL; not fetched, not linked                                                |
| `adm` = base64 of a banner                       | wall of `A-Za-z0-9+/=`                                  | decoded creative renders, with decoding stated                                         |
| `adm` = VAST                                     | XML under an overlay promising a creative, unscrollable | readable, scrollable, no overlay                                                       |

Read the preview column without opening developer tools — SC-002 is precisely that an analyst can tell
"empty creative" from "we refused to fetch it" from the interface alone.

## 6. Locale parity

```bash
node --test tests/i18n-audit.test.js
```

Every string added in this wave exists in all three locales, with informal singular address in
Ukrainian and Russian (Principle VI).

## 7. Before merge

```bash
npm run ci
```

Format check, lint, typecheck, and the full suite with coverage. Report the exact command and outcome;
an unrun check is not a passing check.
