# Cleanup backlog — separate from functional defects found by the corpus

This backlog is the maintenance list the owner asked for. It is split into functional defects, missing capabilities, UI/UX and refactoring. Corpus outcomes live in [defects.md](defects.md) and the merged `tests/corpus/known-gaps.json` / `tests/corpus/known-gaps/*.json` ledger. Maintenance proposals here can overlap those records; they are not additional counted corpus defects. Structural hardening and preliminary architecture proposals are labeled separately from reproduced product failures.

Coverage closure adds regression evidence for the existing format-detection and vendor-carrier cleanup work: `cover-input-push-response-only` (DEF-460, Native body identification) and `cover-vendor-native-kadam-*` (DEF-441, literal Native feed URL/click fields and preview). Any shared detector or alias cleanup must preserve these distinctions. The 23 consolidated items and ten retained proposals below remain the maintenance inventory; the new defect records do not create duplicate cleanup items.

## Method

Six read-only finder passes (Core/UI duplication, scattered format checks and id taxonomy, fallbacks and silent errors, dead and stale code, CSS/DOM workarounds and timers, test infrastructure) produced 52 candidate items. Two independent skeptics per dimension tried to refute each candidate on correctness and on load-bearing behaviour; 33 survived and were synthesized into 23 items after merging duplicates. Every surviving item cites a code location verified against `main` at `a61fc25` (app 1.19.4, Core 0.38.0), states evidence, benefit, proposed change, regression risk with the behaviour test that must exist first, priority (P1 highest), size (S ≤ 2 h, M ≤ 1 day, L > 1 day) and a definition of done. A workaround's existence is never treated as proof that it can be removed. The finder write-ups, skeptic verdicts and the synthesis draft are archived with the session evidence outside the repository. Three items were independently reproduced by the session orchestrator before publication: the false `feed.push.click_url_required` error on the project's own knowledge-base push sample, the missing `aria-live` on the toast container, and the divergent value-feed predicates.

Ten earlier architecture proposals from the first pass (CL-01 to CL-10) are retained in the Refactoring section; CL-08 and CL-09 remain preliminary until concrete affected paths and assertions are identified; they overlap with several verified items and the overlap is noted there.

## Functional defects (9)

| ID                  | Title                                                                                   | Location                                                                            | Priority | Size | Risk if changed blind                                             |
| ------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------- | ---- | ----------------------------------------------------------------- |
| scattered-format-01 | Four impression plugins receive no items through the 3.0 compatibility projection       | `packages/core/index.js:163-172,354-359`                                            | P1       | M    | AdCOM field names differ per-plugin; naive rename breaks silently |
| scattered-format-02 | `redirect_url` tagged `pops` by format-detect but `unknown_type` in validate()          | `packages/core/format-detect.js:214`; `detect.js:184-211`; `rules-feed.js:238-241`  | P1       | S    | Low — additive only                                               |
| scattered-format-07 | Push click-key alias set lacks `clickurl` — false ERROR on the project's own KB samples | `packages/core/rules-feed.js:177-178`; `format-detect.js:210-211`                   | P1       | S    | Low — additive only                                               |
| dom-css-fragile-001 | First-visit onboarding banner never attaches (`.app-header` doesn't exist)              | `public/ortbtools.app.js:6059-6087`, called `:6532`                                 | P1       | S    | Low — anchor swap only; no test exists yet                        |
| fallbacks-silent-01 | `runAnalysis()` paints stale results on a server error, silent on unparseable 2xx       | `public/ortbtools.app.js:4268-4269,4300,4305-4326`                                  | P1       | S    | Must extend `clear-resets-results-browser.test.js` first          |
| scattered-format-06 | Dialect-question pop heuristic diverges from the canonical pop-signal set               | `packages/core/non-iab-formats.js:53,83-85`; `dialects/shape-fingerprint.js:83-107` | P2       | M    | Changes scored candidates for existing fixtures                   |
| fallbacks-silent-04 | `destroySession` swallows a session-DB delete failure (already fixed elsewhere)         | `auth.js:213-228` vs `:365-404`                                                     | P2       | S    | Needs a throwing-`Sessions.destroy` test first                    |
| fallbacks-silent-05 | Finding-catalog cache permanently swallows a JSON parse failure, unlogged               | `modules/findings/handler.js:69-82`                                                 | P3       | S    | None — additive logging only                                      |
| fallbacks-silent-06 | Partners-modal `api()` repeats the `.catch(()=>({}))`+`===false` anti-pattern           | `public/modules/partners/index.js:83-100,133-155,197-226`                           | P3       | S    | No browser test on this path yet                                  |

### scattered-format-01 — Four impression plugins receive no items through the 3.0 compatibility projection

**Category**: functional-coverage candidate; the dispatch difference is verified, but each missing AdCOM behavior still needs a normative fixture · **Location**: `packages/core/index.js:163-172`
(`REQUEST_KEYS_30`, `project30Request`), `:354-359` (`runRulePlugins(view,...)`);
`packages/core/rules/imp-secure/index.js:56`, `rules/pop-request/index.js:141`,
`rules/adpod/index.js:144`, `rules/dialects-questions/index.js:67`.

**Evidence**: `REQUEST_KEYS_30 = ['id','test','at','tmax','cur','source','ext']` plus
`CONTEXT_ROOTS_30=['regs','user']` — no `imp`/`item` key anywhere. Node-verified side by side:
`validate({id,tmax,imp:[{id:'1',secure:5,ext:{totallyUnknownVendorKey:'xyz'},banner:{...}}],...})`
fires `['imp.secure_invalid', ..., 'dialects.question.unknown_ext_signal', ...]`; the
byte-equivalent 3.0 envelope (`openrtb.request.item[0]` with the same `secure:5` and unknown
`ext` key) fires only `['request.30.deep_validation_limited','request.30.context.device.language_missing']`
— neither `imp.secure_invalid` nor `dialects.question.unknown_ext_signal` appear. A second run
adding `ext:{popunder:1}` and video `minduration:60 > maxduration:30` on the 3.0 item confirms
`err-pod-len-mismatch` and every `imp.pop.*` finding are likewise absent.

**Evidence boundary**: copying the 2.x `secure` field onto `item` is not a valid AdCOM-equivalent request. AdCOM security lives at `item.spec.placement.secure`. The example above demonstrates projection/dispatch differences only; follow-up acceptance must exercise the actual AdCOM field paths before claiming which normative checks are missing. This does not establish that all five skipped 2.x plugins apply unchanged to 3.0.

**Why it matters**: the projection's own header comment (`index.js:125-146`) says its purpose
is to close the "3.0 rule blackout" for the 11-plugin registry. It only closes it for the 4
envelope-level plugins (schain/eids/currency/tmax); the 4 plugins that read `req.imp[]`
(imp-secure, pop-request, adpod, dialects-questions) are still completely dark for every 3.0
request, silently, with no acknowledging comment (unlike the deliberate Device omission, which
is explicitly justified in the same comment block).

**Proposed change**: extend `project30Request` to also build `view.imp` by mapping
`req30.item[]` into the 2.x-shaped fields these plugins read, reusing the existing "project,
then reprefixFindings" pattern rather than rewriting the plugins.

**Regression risk**: must validate against real 3.0 fixtures (`tests/ortb30.test.js`) for each
of the 4 plugins before shipping; confirm each 2.x-only concept (e.g. `secure`) actually has a
stable AdCOM equivalent before mapping it. **Verified during review**: `rules-request-30.js`'s
own item-level validator (`validatePlacement30`) already uses AdCOM's real field names
(`mindur`/`maxdur`, `ctype`, `mime`) which differ from the 2.x names the adpod/pop-request/
imp-secure plugins expect (`minduration`/`maxduration`, `protocols`, `mimes`, `secure`) — a
naive item[]→imp[] key rename will **not** make adpod/pop-request fire correctly; each field
needs an explicit per-name mapping (as already done deliberately for `context`, and as skipped
deliberately for `device`), not a blind copy. `maps/core-validate.md` §7 item 13 independently
confirms the same 3.0-blackout gap from the request-validator side.

**Priority**: P1 · **Size**: M.

**Definition of done**: a 3.0 fixture with `secure` out of range, a pop-family `ext` hint, an
inverted AdPod duration range, and an unrecognized `item[].ext` key produces the same 4 finding
families (re-pathed under `openrtb.request.item[N]...`) that the byte-equivalent 2.x payload
produces today.

**Related tests**: `tests/ortb30.test.js` (exists, does not currently cover this — no 3.0 test
case anywhere asserts imp-secure/pop-request/adpod/dialects-questions findings).

---

### scattered-format-02 — `redirect_url` tagged `pops` by format-detect.js but `unknown_type` in validate()

**Category**: functional-defect · **Location**: `packages/core/format-detect.js:214`
(`hasRedirect = 'redirecturl' in o || 'redirect_url' in o`); `packages/core/detect.js:184-211`
(`looksLikeJsonFeedSingle`, only `'redirecturl' in o`); `packages/core/rules-feed.js:238-241`
(`detectSingleBidShape`, same `redirecturl`-only check).

**Evidence**: `core.validate({bid:0.05, redirect_url:'https://land.example/'})` →
`type:'unknown', status:'errors', findings:['payload.unknown_type']`. `detectFormat()` on the
identical object → `{formats:['pops'], confidence:1}`. Two engines in the same package directly
contradict each other on the same input.

**Why it matters**: `format-detect.js` was deliberately written to accept both spellings
because real feeds ship both; an operator pasting a `redirect_url`-spelled bid-redirect response
sees the format chip confidently say "pops" next to a top-level "unrecognized payload — cannot
validate" error, and the shape's actual field checks (`feed.bidredirect.*`) never run at all.

**Proposed change**: add `'redirect_url' in o` as an alternate branch in `detect.js`'s
`looksLikeJsonFeedSingle` (mirroring `format-detect.js`'s `hasRedirect`) and add the same
alternate to `rules-feed.js`'s `detectSingleBidShape` bid-redirect branch.

**Regression risk**: low — only widens what maps to `VENDOR_FEED`/bidredirect; grep confirms
`redirect_url` is not read anywhere else as meaningful today. Add a fixture with `redirect_url`
(not `redirecturl`) before changing the predicate to pin the unknown_type→validated transition.

**Priority**: P1 · **Size**: S.

**Definition of done**: `core.validate({bid:1, redirect_url:'...'})` returns
`type:'Bid-Redirect Feed Response'` (or single-object variant), not `unknown_type`; a new test
asserts detectType/detectFormat/rules-feed agree on both `redirecturl` and `redirect_url`
spellings.

**Related tests**: `tests/format-detect.test.js` (covers `hasRedirect` via `redirecturl` only),
`tests/validator.test.js` (013-era single-object feed cases) — neither has a `redirect_url` case
today.

---

### scattered-format-07 — Push click-key alias set lacks `clickurl` — false ERROR on the project's own KB samples

**Category**: functional-defect · **Location**: `packages/core/rules-feed.js:177-178`
(`validatePushMaterial` click check: `!isStr(m.click_url) && !isStr(m.link)`);
`packages/core/format-detect.js:210-211` (`hasClick` includes `'clickurl' in o`).

**Evidence**: `node -e` run against `packages/core/knowledge_base/jsonfeed/push/push-materials.json`
and `.../jsonfeed/inpage/inpage-card.json`: both validate as `type='Push-Materials Feed
Response'`, `status='errors'`, `findings=['feed.push.click_url_required']` — both use the key
`clickurl` (no separator), which `format-detect.js`'s `hasClick` already accepts but
`rules-feed.js`'s `click_url`/`link` alias pair does not.

**Why it matters**: these are the project's own reference knowledge-base entries for two
different formats (push, in-page) — the canonical "here's what a valid feed looks like"
examples — and both fail the validator they exist to demonstrate passing, with a false-positive
required-field error on their first try.

**Proposed change**: add `'clickurl'` as a third accepted spelling in `validatePushMaterial`'s
click check (`rules-feed.js:177`), matching `format-detect.js`'s `hasClick` set exactly.

**Regression risk**: low and purely additive — widens what counts as present, never narrows;
existing tests asserting `feed.push.click_url_required` fires when none of
`click_url`/`link`/`clickurl` are present are unaffected.

**Priority**: P1 · **Size**: S.

**Definition of done**: both KB samples validate without `feed.push.click_url_required`; a new
test asserts `clickurl` is accepted as a click-key alias.

**Related tests**: `tests/validator.test.js`; no existing KB-corpus smoke test currently catches
this failure on the shipped samples. Note the overlap with **scattered-format-08**: both point
at the same `inpage-card.json` symptom via the same code path; this item is the narrow
"clickurl alias missing" fix, scattered-format-08 is the separate, larger "no dedicated
in-page validator/type exists at all" gap — track as two items, not one.

---

### dom-css-fragile-001 — First-visit onboarding banner never attaches (`.app-header` no longer exists)

**Category**: functional-defect · **Location**: `public/ortbtools.app.js:6059-6087`
(function `maybeShowInspectorOnboarding`), called unconditionally from the Inspector's init
block at `:6532`.

**Evidence** (independently re-verified in this session — confirmed byte-for-byte):

```js
// ortbtools.app.js:6086-6087
const header = root.querySelector('.app-header');
if (header) header.insertAdjacentElement('afterend', banner);
```

`grep -rn "app-header" public/*.html public/modules/**/*.html` returns **zero** matches — the
class does not exist in `public/modules/inspector/template.en.html` (or the uk/ru siblings; the
real header markup is `<header class="workbar">`, confirmed at `template.en.html:22`). It is a
leftover from the pre-shell header layout, before the ROADMAP #18 shell/topbar migration moved
brand+actions into `.kt-topbar`. Because `root.querySelector('.app-header')` always returns
`null`, the `if (header)` guard silently no-ops — the `banner` element (with its dismiss
button) is built in memory and then discarded. Meanwhile, two lines earlier, the **pulse** half
of the same feature _does_ still work, because its target class is real:

```js
// ortbtools.app.js:6068-6069
const exampleMenu = root.querySelector('.kt-example-menu');
if (exampleMenu) exampleMenu.classList.add('kt-onboarding-pulse');
```

So a first-time visitor with both editors empty sees the "Load sample" menu pulse three times
(`inspector.css:773,784-793`) with **no explanatory banner and no dismiss control** — a
half-broken feature that looks like an unexplained UI glitch rather than onboarding. Confirmed
`root.querySelector('.workbar')` resolves (real element, `template.en.html:22`), and the
delegated `dismiss-onboarding` handler (`ortbtools.app.js:6047,6082,6987-6988`) is unaffected by
_where_ the banner lands.

**Why it matters**: this is live, shipped, first-run UX (the one moment a brand-new visitor is
most likely to bounce), silently degraded to "mystery pulsing menu" by an unrelated refactor
months after the feature was written, with nothing anywhere signaling the break — no console
warning, no test failure, no visual difference from "banner correctly declined to show because
the visitor already dismissed it" (both states render nothing).

**Proposed change**: point the insertion at an element that actually exists —
`root.querySelector('.workbar')` with `insertAdjacentElement('beforebegin', banner)`, or (more
robust) add a stable `data-onboarding-anchor` attribute to the current top element and query
that instead of a class name that also carries unrelated layout responsibilities.

**Regression risk**: low — the only consumer of the inserted position is CSS
(`.kt-onboarding-banner` is a simple flex bar, `inspector.css:772-782`) and the dismiss button
wiring goes through the existing delegated handler, unaffected by _where_ the node lands. The
real risk is silent recurrence: whichever anchor is chosen next should be a stable, purpose-built
hook, not a class that also carries unrelated layout responsibilities and could be renamed
again.

**Priority**: P1 · **Size**: S.

**Definition of done**: with `localStorage['themis.inspectorOnboardingDismissed']` unset and
both editors empty, loading `/inspector` shows `.kt-onboarding-banner` in the DOM (not just the
pulse), and clicking its dismiss button removes it and sets the localStorage flag.

**Related tests**: none — `grep -rln "onboarding" tests/*.test.js` returns no results. A new
browser test (following the canonical harness recipe in `maps/harness-and-coverage.md` §1.1)
must exist before changing the anchor, asserting both the pulse AND the banner appear together
on a fresh profile.

---

### fallbacks-silent-01 — `runAnalysis()` paints stale results on a server error, silent on an unparseable 2xx

**Category**: functional-defect · **Location**: `public/ortbtools.app.js:4268-4269, 4300,
4305-4326`.

**Evidence**: `const j = await r.json().catch(() => ({}))` (line 4300) followed by
`if (!r.ok || j.success === false) { ...toast...; return; }` (line 4310-4324, no
`clearResultsForError()` call) and, separately, `if (j.success) { ... }` with no `else` (line
4326). `validation`/`cross` are only initialized to `null` at 4268-4269 and never reset on the
error branch's early return.

**Why it matters**: (a) A 429 rate-limit or `empty_payload` response after a successful analyze
leaves `#tValidation`/`#tCross`/`#slotGrid`/`window.__ortbtoolsLast` showing the **previous**
payload's findings while only a toast+status-dot change — violating the app's own documented "a
result must not outlive its payload" principle (comment at `:3733-3752`) that a sibling test
file already enforces for the other two failure paths. (b) Because `j.success===false` is
strict equality, a 200 response whose body fails to parse (`j={}` from the catch) hits neither
branch: `validation`/`cross` stay `null` and nothing is toasted at all — complete silence, worse
than the documented pre-v0.20.0 bug this code's own comment says was already fixed.

**Proposed change**: call `clearResultsForError(errMsg)` (or equivalent) instead of a bare
`return` inside the `!r.ok||j.success===false` branch; restructure to an exhaustive
`if (!r.ok || j.success !== true) {...error...} else {...success...}` so an unparseable/
shapeless 2xx body takes the error path.

**Regression risk**: `tests/clear-resets-results-browser.test.js` already guards the
cleared-UI contract for the client-throw and network-failure paths but not this
structured-error branch — write a new case (mock a 429 after a successful analyze, assert
`window.__ortbtoolsLast`/`#tValidation` reset) before changing the branch.

**Priority**: P1 · **Size**: S.

**Definition of done**: a rate-limited or shape-less `/api/analyze` response arriving right
after a successful one leaves Findings/Crosscheck/Impressions and `window.__ortbtoolsLast` in
the same "no current analysis" state a fresh load would show, not the prior result.

**Related tests**: `tests/clear-resets-results-browser.test.js` (extend).

---

### scattered-format-06 — Dialect-question pop heuristic diverges from the canonical pop-signal set

**Category**: functional-defect · **Location**: `packages/core/non-iab-formats.js:53`
(`POP_SHAPE_FLAG_KEYS = ['allowMT','allowLayer','allowShock','viewOnClick','directLink']`),
`:83-85` (the "shape signals shared with analyzeShape" JSDoc comment — lives here, in
`non-iab-formats.js`, **not** in `shape-fingerprint.js` as originally miscited);
`packages/core/dialects/shape-fingerprint.js:83-107` (`analyzeShape`'s own pop-family block,
which checks only `allowMT`/`allowLayer`/`allowShock`/banner-zeroed/`sizeID`, omitting
`viewOnClick` and `directLink`, and adding an extra `ext.limit` signal present nowhere else);
consumed at `packages/core/rules/dialects-questions/index.js:101`.

**Evidence**: `node -e` run: `node={ext:{viewOnClick:true}, banner:{w:300,h:250}}`.
`nonIab.scanExtForFormatHints(node.ext,'ext')` → `[{format:'pop', path:'ext.viewOnClick'}]`.
`analyzeShape(node)` → `[{format:'banner', ...}]` — no pop-family candidate at all. The
`non-iab-formats.js:83-85` comment documents that the pop-family block is _supposed_ to mirror
`analyzeShape`'s signal set, but two of the five `POP_SHAPE_FLAG_KEYS` never made it into
`analyzeShape`'s list.

**Why it matters**: `analyzeShape` feeds the candidates/recommended params of
`dialects.question.unknown_ext_signal` — the one place in the product where an operator is
directly asked to label an ambiguous vendor field. For any payload whose only pop tell is
`viewOnClick`/`directLink`, the operator sees a suggestion that omits the exact label three
other parts of the same package (`scanExtForFormatHints`, `pop-request`, format-detect's
`POPS` tag) have already independently converged on for the same signal.

**Proposed change**: have `analyzeShape`'s pop-family block import and iterate
`POP_SHAPE_FLAG_KEYS` from `non-iab-formats.js` directly instead of hand-listing three of the
five keys, removing the divergence structurally. Keep the additive `ext.limit` corroborator
signal.

**Regression risk**: `tests/shape-fingerprint.test.js` asserts specific score/signal lists —
adding `viewOnClick`/`directLink` changes scores for fixtures carrying those keys; review
exact-score assertions before changing the signal list.

**Priority**: P2 · **Size**: M.

**Definition of done**: `analyzeShape({ext:{viewOnClick:true}, banner:{...}})` includes a
pop-family candidate; `tests/shape-fingerprint.test.js` gains `viewOnClick`/`directLink` cases
alongside the existing `allowShock`/`sizeID` cases.

**Related tests**: `tests/shape-fingerprint.test.js`.

---

### fallbacks-silent-04 — `destroySession` swallows a session-DB delete failure (the exact bug already fixed elsewhere)

**Category**: functional-defect · **Location**: `auth.js:213-228` (`destroySession`) vs.
`auth.js:365-404` (`invalidateUserSessions`, including its own doc-comment history).

**Evidence**: `destroySession`: `try { Sessions.destroy(token); } catch (e) {
log.error(...'session DB delete failed'); }` — no rethrow, caller
(`modules/auth/handler.js:203`) never learns anything went wrong. `invalidateUserSessions`'s own
JSDoc explicitly names "Pre-v0.25.0 this swallowed DB-delete failures (session revival)" as a
fixed bug, and its current code clears the in-memory Map unconditionally **then rethrows** the
DB error so the caller can react — the exact pattern `destroySession` lacks. The boot-time
session rehydration is inline code inside `createAuth()` (around `auth.js:71-86`) calling
`Sessions.loadActive()` directly at server start — there is no separately named
`hydrateFromDb()` function; the mechanism is the same, only the naming differs from the
original write-up.

**Why it matters**: `SESSION_TTL_MS` is 30 days (`auth.js:30`). If `Sessions.destroy` throws
during an ordinary logout, the browser cookie/Map entry are cleared locally, but the DB row
survives. Any server restart within that 30-day window reloads it via the boot-time
`loadActive()` call, reviving the token — so a stolen/shared-terminal cookie captured before
logout becomes valid again after a restart, which is precisely the bug class the project already
paid to diagnose and fix on the bulk-invalidation path.

**Proposed change**: mirror `invalidateUserSessions`'s shape in `destroySession`: clear
Map/cookie unconditionally, then surface the DB failure to the caller (return a flag or
rethrow) so `modules/auth/handler.js`'s `handleLogout` can escalate via `notifyAdmin`, matching
the pattern already used for email-send failures in the same file.

**Regression risk**: `tests/auth.test.js:144` covers only the happy path for `destroySession`;
no test forces `Sessions.destroy` to throw for either function. Write that test (inject a
throwing `Sessions.destroy`, assert Map/cookie still cleared, then assert the failure is now
visible to the caller) before changing the function.

**Priority**: P2 · **Size**: S.

**Definition of done**: a `destroySession` call whose DB delete throws still clears the
in-memory Map and cookie (unchanged), and the failure is now observable to the route handler via
a test double, not only a log line.

**Related tests**: `tests/auth.test.js:144` (extend).

---

### fallbacks-silent-05 — Finding-catalog endpoint permanently caches an empty object on a parse failure, unlogged

**Category**: functional-defect · **Location**: `modules/findings/handler.js:69-80`
(`loadJson`), consumed by `handleFindingCatalog` at `:82` (`GET /api/v1/finding-catalog`).

**Evidence**: `try { _cache[filePath] = JSON.parse(fs.readFileSync(...)); } catch (_e) {
_cache[filePath] = {}; }` — no `log.warn`/`log.error` call anywhere in the catch, unlike every
other file-load-failure path read in this audit. The process-lifetime cache means the failure
sticks for the life of the server even after the underlying file is fixed.

**Why it matters**: the endpoint's own header comment names three consumers: `/docs/findings`,
dialect severity tallies, and the site search index. A malformed `packages/core/messages/<lang>.json`
or `spec-refs.json` would silently degrade all three for a given language, forever (until
restart), with the response still a 200 and nothing in server logs to alert anyone.

**Proposed change**: log the parse failure (`log.warn({err:_e, filePath}, 'finding-catalog:
failed to load message file')`) before caching `{}`, and avoid caching the failure itself so a
later request after the file is repaired can self-heal without a restart.

**Regression risk**: none for the added log line; the "don't cache failures" change only affects
performance in the already-degraded failure case.

**Priority**: P3 · **Size**: S.

**Definition of done**: a deliberately malformed `messages/<lang>.json` produces a visible
server log line on first request, and (if included) a later request after the file is repaired
returns the real catalog without a restart.

**Related tests**: none found for this endpoint.

---

### fallbacks-silent-06 — Partners-modal `api()` repeats the "unparseable 200 reads as success" anti-pattern

**Category**: functional-defect · **Location**: `public/modules/partners/index.js:83-100`
(`api()`), consumed by `confirmAddPartner()` `:133-155` and `deletePartner()` `:197-226`.

**Evidence**: `const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) {
throw err; } return j;` — reached even when the body failed to parse, as long as `r.ok`. The
file's own comment says this "mirrors `ortbtools.app.js`'s local `api()` helper" — i.e. the same
bug as `fallbacks-silent-01`. Contrast the correct idiom two files over in
`dialect-label.js:423-425` and `creative-assets.js:95-97`, both of which fall back to `null` and
explicitly test falsiness/shape before treating anything as success.

**Why it matters**: `confirmAddPartner()` unconditionally shows a success toast and refreshes the
list on any non-throwing return from `api()` — if the server ever returns 200 with an
unparseable body (proxy truncation, a future bug), the user is told "Added: X" with no actual
confirmation of what the server did.

**Proposed change**: switch to the `dialect-label.js`/`creative-assets.js` idiom —
`.catch(() => null)` plus an explicit `!j` check ahead of `j.success === false` — in this file
and in `ortbtools.app.js`'s `runAnalysis` (fallbacks-silent-01), landing the fix once so the two
"mirrored" helpers stay mirrored.

**Regression risk**: low, tightens an overly loose check; no legitimate response relies on `j`
being `{}` on a parse failure. No browser test currently drives the Partners modal's error
path — add one before tightening.

**Priority**: P3 · **Size**: S.

**Definition of done**: a mocked 200 response with an unparseable body causes
`confirmAddPartner`/`deletePartner` to show an error toast, not a success toast.

**Related tests**: none found.

---

## Missing capabilities (1)

| ID                  | Title                                                                                              | Location                                                        | Priority | Size |
| ------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- | ---- |
| scattered-format-08 | In-page JSON-feed shape has no dedicated validator — every array routes through the push validator | `packages/core/rules-feed.js:47-49`; `format-detect.js:217-227` | P2       | M    |

### scattered-format-08 — In-page JSON-feed shape has no dedicated validator

**Category**: missing-capability · **Location**: `packages/core/rules-feed.js:47-49`
(`Array.isArray(arrOrObj) => validatePushMaterialsFeed(arrOrObj)`, no `ext.format`/`widget_id`/
`zone_id` branch anywhere in the 5-branch dispatch); contrast
`packages/core/format-detect.js:217-227` (`detectFeedFormat`, which does check exactly those
three `ext` keys to decide INPAGE vs PUSH — corrected line range; `:233-243` falls after this
function ends).

**Evidence**: `inpage-card.json` (`ext:{format:'inpage', widget_id:'widget-12',
zone_id:'zone-3'}`) is typed `'Push-Materials Feed Response'` and validated against push
field-name aliases (`click_url`/`link`) rather than its own in-page keys (`clickurl`, `impurl`,
`advertiser`). `detectFormat` on the same payload correctly returns `formats:['inpage']` — the
format-tagging layer knows this is in-page, the field-validation layer does not.

**Why it matters**: compounds scattered-format-07's false positive: the type string shown to
the operator is wrong for a payload the format chip correctly calls "inpage", and even after
fixing the `clickurl` alias, the in-page card's own distinguishing fields (`impurl`,
`advertiser`) get no validation at all.

**Proposed change**: add an `ext.format==='inpage' || ext.widget_id || ext.zone_id` guard ahead
of the array branch in `validateFeedResponse`, mirroring `detectFeedFormat`'s own three-key check
exactly, routing to a new (or extended) in-page validator instead of falling through to
`validatePushMaterialsFeed` unconditionally.

**Regression risk**: medium — changes the type string and finding-id family for any array
currently mis-typed as push; any consumer (UI copy, saved samples, tests) asserting today's
(wrong) type string needs updating. Write the disambiguation test before changing the dispatch.

**Priority**: P2 · **Size**: M.

**Definition of done**: `inpage-card.json` validates with a type string containing "In-Page",
not "Push-Materials"; at minimum type-string correctness is required, ideally a
`feed.inpage.*` finding family for its own distinguishing fields.

**Related tests**: `tests/validator.test.js`, `tests/format-detect.test.js` (already tests
INPAGE-vs-PUSH tagging; no equivalent on the `rules-feed.js` side). **Scope note**: this item and
scattered-format-07 share the same `inpage-card.json` symptom (spurious
`feed.push.click_url_required`) via the same code path — track separately: 07 is "clickurl
alias missing" (small, fixable by widening one alias set), 08 is "no dedicated in-page
type/validator exists at all" (a materially larger, separate-validator undertaking) — do not
double-count them as one piece of debt.

---

## UI/UX (1)

| ID                  | Title                                                                            | Location                                                 | Priority | Size |
| ------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- | -------- | ---- |
| fallbacks-silent-03 | Every toast — including every error toast — is invisible to assistive technology | `public/core/utils.js:49-65`; `public/index.en.html:282` | P1       | S    |

### fallbacks-silent-03 — Every toast has no `aria-live`/`role`, invisible to assistive technology

**Category**: ui-ux · **Location**: `public/core/utils.js:49-65` (`toast()`);
`public/index.en.html:282` and the uk/ru sibling shells (`#toastContainer`).

**Evidence**: `export function toast(msg,type)` does `const c = $('toastContainer'); if (!c)
return;` then appends a plain `<div class="toast">` with no `aria-live` ancestor, auto-removed
after 2500ms+300ms fade. The container itself, `<div class="toast-container"
id="toastContainer"></div>`, carries no `aria-live`/`role` attribute in any of the three locale
shells. This is the app's entire error-notification channel: "Nothing to analyze", rate-limit
toasts, copy/format failures, asset-inlining outcomes, dialect-agent errors, etc.
**Independently confirmed** via `maps/inspector-flow.md` §9: "No `aria-live` on `#toastContainer`
(`public/index.en.html:282` — a plain unattributed `<div>`) — toast messages are **not**
announced to assistive tech."

**Why it matters**: a screen-reader user gets zero notification that an action failed — not
empty-input, not a rate limit, not a copy failure — and the 2.5s auto-dismiss makes it easy to
miss even visually. Distinct from and not covered by `#verdict`'s own `aria-live` region
(announces analysis results only) or `source-nav.js`'s private `aria-live` region (announces
navigation jumps only) — toast-only failures (e.g. the empty-input guard) never touch either of
those.

**Proposed change**: add `aria-live="polite"` (or `assertive` for `type==='error'`) and
`role="status"` to `#toastContainer` in all three locale shells — no JS change required beyond
that, since the existing `appendChild` sequence already mutates a live-region-eligible node.

**Regression risk**: low, purely additive attribute; only risk is a DOM-snapshot/i18n test
asserting exact shell markup needing its expected HTML updated.

**Priority**: P1 · **Size**: S.

**Definition of done**: a screen reader announces an error toast's text when it appears, without
requiring focus inside the toast container.

**Related tests**: none today — add a browser test asserting the attribute and that appended
toast text lands inside the `aria-live` region.

---

## Refactoring (12)

| ID                  | Title                                                                                                            | Location                                                                          | Priority | Size |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- | ---- |
| dup-core-ui-003     | Dialect allowlist hardcoded in the browser; Core's `listDialects()` never consulted                              | `public/ortbtools.app.js:403-423,573`; `packages/core/index.js:58-63,555-556,649` | P2       | S    |
| dead-stale-04       | `preserve-caught-error`/`no-useless-assignment` disabled repo-wide over a stale "11 findings" count (actual: 18) | `eslint.config.js:40-43`                                                          | P2       | M    |
| scattered-format-03 | Two engines fire on the same missing/non-numeric-price defect, two different id styles                           | `rules-response.js:138`; `rules/price-floor/index.js:160-169`                     | P2       | M    |
| dup-core-ui-005     | `"[response] "` prefix duplicated at 3 sites even though the structured field superseding it already exists      | `modules/analyze/handler.js:248-254,267-270`; `public/ortbtools.app.js:2725-2736` | P2       | S    |
| scattered-format-05 | `detect.js`'s value-feed predicate is narrower than `rules-feed.js`'s — the `value`+`nUrl` shape is unreachable  | `packages/core/detect.js:184-211`; `rules-feed.js:236`                            | P2       | S    |
| dead-stale-01       | Public VAST timeline API has no Inspector integration                                                            | `packages/core/index.js:640,668-673`; `scripts/gen-browser-core.js:17-31`         | P2       | S    |
| dead-stale-03       | `validation.errors` legacy-fallback key has no producer anywhere in Core                                         | `public/ortbtools.app.js:4454`                                                    | P2       | S    |
| dead-stale-02       | Dead CSS selector `.preview-safe img` matches nothing in the live DOM                                            | `public/modules/inspector/inspector.css:1019-1027`                                | P2       | S    |
| dead-stale-06       | Stale illustrative comment in `severity-registry.js` cites two ids that no longer exist                          | `packages/core/severity-registry.js:83-87`                                        | P3       | S    |
| dead-stale-07       | Stale AdPod plugin-registration comment describes checks that don't exist, using fabricated field names          | `packages/core/rules/index.js:58-62`                                              | P3       | S    |
| dead-stale-05       | Four i18n keys defined in all three locales, never read anywhere                                                 | `public/i18n.js:1067-1071,1269-1270,1276`                                         | P3       | S    |
| fallbacks-silent-02 | Inconsistent rule failure containment; structural hardening with no current reproducer                           | `packages/core/rules/index.js:93-116`; `packages/core/index.js:342-413`           | P3       | M    |

### dup-core-ui-003 — Dialect allowlist hardcoded in the browser while Core exports the authoritative registry

**Category**: refactoring · **Location**: `public/ortbtools.app.js:403-423,573`
(`KNOWN_DIALECTS`, `activeDialect`, `setActiveDialect`) vs. `packages/core/index.js:58-63,555-556,649`
(`DIALECTS`, `listDialects`) and `server.js:688` (the correct server-side consumer).

**Evidence**: Core: `const DIALECTS = { iab: dialectIab, 'ext-rtb': dialectExtRtb,
'inpage-push': dialectInPagePush };` with `function listDialects() { return
Object.keys(DIALECTS); }`, exported and correctly used server-side: `if (want &&
listDialects().includes(want)) return want;` (`server.js:688`). The browser never calls this —
it hardcodes its own literal: `const KNOWN_DIALECTS = new Set(['iab', 'ext-rtb',
'inpage-push']);` (`app.js:404`), consulted at five separate call sites. `grep -rn
"KNOWN_DIALECTS" tests/*.js` returns zero hits — no test asserts the two lists agree.

**Why it matters**: adding/renaming/retiring a dialect requires a manual, untested edit to this
one literal. If missed, `?dialect=<new-name>` silently resolves to `'iab'` client-side even
though the server would accept and apply the real dialect — the UI would show plain-IAB results
for a URL that promised, and the server delivered, a vendor-dialect analysis. That is exactly
the silent-clean-verdict failure mode this product exists to catch in other payloads.

**Proposed change**: expose `listDialects()` to the client (via `/api/analyze`'s meta, or a
small endpoint) and have `activeDialect()`/`setActiveDialect()`/the URL-param check consult it
instead of the local Set literal; at minimum add a test asserting `KNOWN_DIALECTS` (stringified)
equals `listDialects()`'s output so drift fails loudly.

**Regression risk**: `isTempDialect()` (client-only `temp:` dialects, never known to
Core/server) must keep working independently of whichever list backs the known-dialect half of
the `KNOWN_DIALECTS.has(x) || isTempDialect(x)` gate — any fix must preserve that two-part
structure, not just swap the left operand's source.

**Priority**: P2 · **Size**: S.

**Definition of done**: a test (or a shared constant reachable from both server and client)
fails the moment Core's `DIALECTS` registry and the UI's dialect allowlist disagree.

**Related tests**: `tests/dialects.test.js:26-27` (Core `listDialects()` only, in isolation); no
test covers the UI's `?dialect=` acceptance list.

---

### dead-stale-04 — Two ESLint rules disabled repo-wide over a stale "11 findings" count — actual count today is 18

**Category**: refactoring · **Location**: `eslint.config.js:40-43`.

**Evidence**: comment: "keep pre-v10 behavior until a dedicated cleanup PR addresses the 11
existing findings." Re-enabling both rules for a single lint pass (no files modified) surfaces
**18** findings across `auth.js`, `lib/event-log.js`, `modules/health/handler.js`,
`packages/core/decoders/index.js`, `packages/core/decoders/request/index.js`,
`packages/core/finding-location.js:55`, `packages/core/index.js:315`, `public/core/session.js`,
`public/modules/dialects/index.js`, `public/modules/inspector/dialect-label.js`,
`public/modules/inspector/source-nav.js` (×2), `public/ortbtools.app.js` (×2),
`tests/corpus/lib/http-run.js`, `tests/corpus/lib/load.js`, `tests/finding-location-corpus.test.js`,
`tests/single-chrome-control-browser.test.js`. Example dead store confirmed by direct read:
`packages/core/index.js:315` `let findings = [];` is unconditionally overwritten at line
348/363/379/401 in every branch before ever being read; `packages/core/finding-location.js:55`
`let i = 0;` is overwritten at line 60 before being read; `packages/core/decoders/index.js:58`
`let claimed = false;` is overwritten at line 60 or discarded via `continue` at line 64, never
read as `false`. This is the most rigorously reproduced item in the whole backlog — count, file
list, and all worked examples independently reproduced exactly.

**Why it matters**: disabling the rule repo-wide (rather than suppressing only the known sites)
means every new dead-store assignment or cause-less rethrow added anywhere in the repo since the
rules were turned off has gone unflagged by CI — the gate meant to bound this debt has itself
silently drifted from 11 to 18 without the comment being updated, which is exactly the kind of
invisible backlog growth this review was asked to catch.

**Proposed change**: either fix all 18 current findings (each is a small, mechanical dead-store
removal or a `{ cause: e }` addition to a rethrow) and flip both rules back to `'error'`, or at
minimum update the stale "11" in the comment to the current count and file a tracked follow-up
so it stops drifting invisibly.

**Regression risk**: low per-site — these are dead-store removals/missing-cause additions, not
logic changes; each site's runtime behavior is unchanged. Before fixing the 3 `tests/` hits,
confirm no test asserts on the thrown Error object's exact enumerable shape in a way a new
`cause` property would break (none currently do).

**Priority**: P2 · **Size**: M.

**Definition of done**: `eslint.config.js` either has both rules at `'error'` with zero
remaining findings, or its comment states the current, freshly-verified count instead of the
stale 11.

**Related tests**: none directly; `npm run lint` is the enforcement surface once re-enabled.

---

### scattered-format-03 — Two engines fire on the same missing/non-numeric-price defect

**Category**: refactoring · **Location**: `packages/core/rules-response.js:138`
(`response.bid.price_required`, fires on `!isNum(b.price)`); `packages/core/rules/price-floor/index.js:160-169`
(`err-bid-price-negative`, fires on `typeof!=='number' || !Number.isFinite || <0` — a strict
superset).

**Evidence**: node-verified: `validate({id:'res1', seatbid:[{bid:[{id:'b1', impid:'1',
adm:'<div>x</div>'}]}]}, {pairReq: req}).findings` filtered on `'price'` →
`['err-bid-price-negative', 'response.bid.price_required']` — both ERROR, same path
`seatbid[0].bid[0].price`, same root cause (price absent), two different ids/message
strings/specRefs. `dedupFindings` only collapses same-(id,path) repeats so nothing merges them.

**Why it matters**: two independently-maintained engines (the legacy baseline validator and the
modular plugin surface) validate the same field with no coordination and disagree on id style
(dotted vs. flat); any consumer counting distinct problems double-counts one defect as two.

**Proposed change**: consolidate price classification behind a shared helper while preserving each caller's existing finding IDs, levels, paths and trigger conditions. The legacy rule rejects missing/non-numeric/non-finite prices; the plugin additionally rejects negative numbers and already runs without a paired request. Keep both public findings where both currently apply. Removing one ID requires a separate explicit compatibility decision; it is not part of this refactor.

**Regression risk**: a single boolean helper could accidentally widen the legacy rule to negative numbers or remove an existing finding. Return enough price-state information to preserve the distinct predicates. Finding IDs are public contract under `specs/000-platform-baseline/contracts/core-validator.md` (Finding identifiers).

**Priority**: P2 · **Size**: M.

**Definition of done**: paired and response-only validation retain the same finding IDs, levels and paths for missing, non-numeric, non-finite, negative and zero prices. Both rules use the shared classification; the existing assertions for `response.bid.price_required` remain intact. Consolidation does not by itself claim to remove the duplicate user-visible diagnostic.

**Related tests**: `tests/floor-audit.test.js`, `tests/rules-etap-b-2.test.js:287-290`, `tests/validator.test.js:393-397`; exercise both public validation entry scenarios before changing the implementation.

---

### dup-core-ui-005 — `"[response] "` message-prefix duplicated at 3 sites even though the structured field superseding it already exists

**Category**: refactoring · **Location**: `modules/analyze/handler.js:248-254` and `:267-270`
(two identical `Object.assign` concatenations) vs. `public/ortbtools.app.js:2725-2736` (`sideTag`
regex inside `buildFindingHtml`).

**Evidence**: `handler.js` does `Object.assign({}, f, { msg: '[response] ' + f.msg })` verbatim
in two separate branches (paired-request path and response-only path), both **after**
`attachLocations(...,{side:'response',...})` has already stamped the authoritative side on the
same finding objects. The client then regex-parses this back out: `const sideTag =
msg.match(/^\[(request|response)\]\s+/);` with its own comment calling the prefix "the backend's
display hack for the old flat list" and explaining the regex is only a fallback for findings
that never got the structured contract (client-injected temp-dialect findings from
`OrtbtoolsIntel.applyToFindings`).

**Why it matters**: the same trivial string-tagging operation is hand-typed twice server-side
instead of factored into one helper, while the client carries a permanent regex solely to
reverse an operation the server's own comment already calls legacy — for a population
(client-injected findings) that could instead be given `location.primary.side` directly at
injection time, letting the prefix, both server call sites, and the client regex all be retired
together.

**Proposed change**: (a) factor the two identical `handler.js` call sites into one
`tagResponseSide(findings)` helper — pure DRY, no behavior change; (b) as a follow-up, have
`OrtbtoolsIntel.applyToFindings` stamp `location.primary.side` on client-injected findings, then
drop the `'[response] '` prefix from both server sites and delete the client regex.

**Regression risk**: the client regex is currently the ONLY thing setting `side` for
temp-dialect-injected findings; removing the prefix before giving `applyToFindings` its own
location stamp would silently regress those findings to unlabeled/no side-badge. **Corrected
coverage note**: `applyTempDialect` (the function `applyToFindings` calls internally to build
the injected findings) IS exercised extensively for finding _content_ in `tests/intel.test.js`
(~435-479) and `tests/intel-audit.test.js` (~225-270) — though neither tests `applyToFindings`
itself, the side badge, or the prefix/regex round-trip. Also, `tests/ui-audit.test.js:202-219`
("the side reaches the detail body through the markup, not through a second guess") is a literal
source-regex match against the exact `const locSide = ...`/`data-finding-side` code text, not a
behavior test — any refactor under part (a) that extracts this logic into a shared helper will
need this test's regex updated even though behavior is unchanged; include that in the DoD. A
behavior test asserting a temp-dialect-injected finding still shows a side badge must exist and
pass before touching step (b).

**Priority**: P2 · **Size**: S.

**Definition of done**: (a) one shared helper used at both `handler.js` call sites with
identical output, with `tests/ui-audit.test.js:202-219`'s source-regex updated to match; (b) no
finding's rendered side badge depends on `'[response] '` textual parsing, confirmed by a test
that strips the prefix from a fixture message and asserts the badge is unchanged.

**Related tests**: `tests/intel.test.js` (~435-479), `tests/intel-audit.test.js` (~225-270),
`tests/ui-audit.test.js:202-219`.

---

### scattered-format-05 — `detect.js`'s value-feed predicate is narrower than `rules-feed.js`'s, making the `value`+`nUrl` shape permanently unreachable

**Category**: refactoring · **Location**: `packages/core/detect.js:184-211`
(`looksLikeJsonFeedSingle` — only `'clickUrl' in o`); `packages/core/rules-feed.js:236`
(`detectSingleBidShape` — `'clickUrl' in o || ('value' in o && 'nUrl' in o)`; corrected line
number — 236, not 238).

**Evidence**: `core.validate({id:1, value:0.05, nUrl:'https://notify.example/win'})` →
`type:'unknown', findings:['payload.unknown_type']`. `rules-feed.js` explicitly codes the
`value`+`nUrl` alternate but `detectType()` (the gate deciding whether `rules-feed.js` runs at
all) only consults `detect.js`'s narrower `clickUrl`-only predicate, so an object matching the
second predicate and not the first never reaches `VENDOR_FEED` and never reaches `rules-feed.js`.

**Why it matters**: this reads as intentional, live coverage for a real shape variant but is
unreachable through either real entry point (`core.validate()`/`crosscheck()` and the CLI's
JSON-object gate) — anyone reading `rules-feed.js` in isolation would reasonably believe this
shape is supported. `maps/formats-feeds.md`'s gap section independently flags the same
divergence.

**Proposed change**: add the same `('value' in o && 'nUrl' in o)` alternate to `detect.js`'s
`looksLikeJsonFeedSingle`, mirroring `rules-feed.js`'s predicate exactly.

**Regression risk**: low, same reasoning as scattered-format-02 — only widens what becomes
`VENDOR_FEED`; add the fixture first to pin the `unknown_type`→Value-Feed transition.

**Priority**: P2 · **Size**: S.

**Definition of done**: `core.validate({value:0.05, nUrl:'https://...'})` (no `clickUrl`)
returns `type:'Value-Feed Response'`, not `unknown_type`.

**Related tests**: `tests/validator.test.js` (value-feed cases exist for `clickUrl` shape only).

---

### dead-stale-01 — Public VAST timeline API has no Inspector integration

**Category**: refactoring · **Location**: `packages/core/index.js:640,668-673`; `packages/core/package.json`; `scripts/gen-browser-core.js:17-31`; `packages/core/vast-timeline/index.js`.

**Evidence**: the published Core package root exports `parseVastTimeline` and `VAST_DIAGNOSTICS`. `scripts/gen-browser-core.js` does not copy the module into the browser bundle, and no caller was found under `public/`, `modules/` or `server.js`. The existing `tests/vast-timeline.test.js` imports the module directly, so it does not guard the package-root export. Repository usage does not establish whether external package consumers use those exports.

**Why it matters**: package support and Inspector integration are different capabilities. Describing the public API as dead would invite a breaking removal; describing it as browser-integrated would overstate current product behavior.

**Proposed change**: retain and document the package-root API and its current lack of Inspector integration. Add a package-boundary assertion for the root exports and their relationship to the direct module export. Wiring a static timeline into the Inspector is a separate product proposal; removal requires an explicit deprecation and compatibility plan.

**Regression risk**: removing either root export can break external consumers even if repository tests still pass. Direct-import tests are insufficient evidence of compatibility. Browser integration additionally requires its own UI, CSP and static-preview acceptance work.

**Priority**: P2 · **Size**: S for documentation and package-boundary coverage. Inspector integration is not estimated in this cleanup item.

**Definition of done**: both existing root exports remain available with their existing types and behavior, and are documented; a consumer test imports them through the package root and verifies the expected API against the direct module. Documentation states that Inspector does not currently consume the timeline.

**Related tests**: `tests/vast-timeline.test.js`, plus a package-root consumer assertion. Public compatibility requirements: `specs/000-platform-baseline/contracts/core-validator.md` and `.specify/memory/constitution.md`, Principle IV.

---

### dead-stale-03 — `validation.errors` legacy-fallback key has no producer anywhere in Core

**Category**: refactoring · **Location**: `public/ortbtools.app.js:4454`.

**Evidence**: `const findings = validation && (validation.findings || validation.errors); //
graceful migration`. `packages/core/index.js`'s own header contract states `validate(payload,
...) -> { type, status, findings }`. Every `findings:` object-literal in
`packages/core/index.js` (lines 225, 266, 285, 304, 427, and the assembled `validate()` result)
uses the key `findings`; a repo-wide grep for any `errors:`-shaped validation result across
`packages/core/*.js` and `packages/core/rules*.js` returns zero matches. `validation.errors` is
therefore always undefined on every reachable code path — `/api/analyze`'s response body is
produced entirely by `packages/core`.

**Why it matters**: dead defensive code presented as a "graceful migration" for a shape that
hasn't existed on the wire for as long as the current Core contract has been in force; a future
refactor of the findings pipeline could mistakenly treat this as protecting something real and
keep propagating it.

**Proposed change**: simplify to `const findings = validation && validation.findings;`

**Regression risk**: low — behaviorally a no-op since the `||` second operand can never be
truthy on any current path; confirmed `window.__ortbtoolsLast` and `loadFromHistory()` both
always source `validation` from the same `/api/analyze` JSON body, never a hand-built object
carrying `.errors`.

**Priority**: P2 · **Size**: S.

**Definition of done**: line reads `validation && validation.findings`;
`tests/clear-resets-results-browser.test.js` and any inspector-flow browser test asserting on
`#tValidation` content pass unmodified.

**Related tests**: none exercises this exact fallback branch directly; safety is established by
static reasoning (no producer of `.errors` exists).

---

### dead-stale-02 — Dead CSS selector `.preview-safe img` matches nothing in the live creative-preview DOM

**Category**: refactoring · **Location**: `public/modules/inspector/inspector.css:1019-1027`
(corrected range — the closing brace of the `.is-revealed` rule is at line 1027).

**Evidence**: `.preview-safe iframe, .preview-safe img { filter: blur(22px); ... }` and the
matching `.is-revealed` un-blur rule both pair `iframe` with `img`. Every branch of
`setAdPreview()` (`public/ortbtools.app.js:1464-1671`, confirmed against `maps/preview-ui.md` §2)
mounts either an `<iframe>` or a text node (`renderInertText`) as the child of
`#creativePreviewSafe`/`#creativePreview` — none ever appends a bare `<img>`. The one
`iurl`→`"<img src=...>"` fallback in `findAdm()` (`ortbtools.app.js:1055`) is assigned to `adm`
and re-enters `classify()`, ending up inside an iframe's `srcdoc` (a separate, CSS-unreachable
document), not as a parent-DOM child. This same finding was independently produced by a second
finder pass (`find-dom-css-fragile.md` item 5) at the identical lines with the identical fix —
tracked once, here.

**Why it matters**: two inert style rules that will mislead a future maintainer editing the
blur/reveal mechanism into thinking a bare-`<img>` mount path exists; wastes review time and
risks being "fixed" for a case that can't occur.

**Proposed change**: delete the `img` half of both selectors, leaving `.preview-safe iframe {
filter: blur(22px); ... }` and `.preview-safe.is-revealed iframe { filter: none; }`.

**Regression risk**: very low — no test targets the `.preview-safe img` selector specifically;
removal doesn't affect any currently-matching element. `tests/creative-preview-browser.test.js`
and `tests/push-preview-browser.test.js` already cover blur/reveal on the two real mount kinds
(native iframe, banner/push iframe) and should be re-run, not rewritten.

**Priority**: P2 (downgraded from the originally-proposed P1 — purely cosmetic/dead-selector
cleanup with zero behavioral impact, matching the profile of the P3-rated dead-stale-06/
dead-stale-07 comment-cleanup items rather than a functional P1) · **Size**: S.

**Definition of done**: `.preview-safe img` no longer appears in `inspector.css`;
`tests/creative-preview-browser.test.js` and `tests/push-preview-browser.test.js` pass
unmodified.

**Related tests**: `tests/creative-preview-browser.test.js`, `tests/push-preview-browser.test.js`.

---

### dead-stale-06 — Stale illustrative comment in `severity-registry.js` cites two ids that no longer exist anywhere

**Category**: refactoring · **Location**: `packages/core/severity-registry.js:83-87`
(corrected range).

**Evidence**: comment: "UNKNOWN — an id present in `messages/*.json` that no call site emits.
Today: `response.seatbid_required` and `request.30.item.placement_invalid` — message text and a
spec-refs.json entry, no emitter." Neither id exists anywhere in the current tree: grep across
`packages/core/messages/en.json`, `packages/core/spec-refs.json`, every `*.js` and
`rules*/*.js` file returns zero hits outside the comment itself. Running the registry's own
`describe()`/`severityOf()` logic against all 345 current `messages/en.json` ids confirms the
`UNKNOWN` family is empty today (verified live in this session, not just by grep). Independently
confirmed twice more: `maps/core-validate.md` §7 item 12, and a second finder pass
(`find-scattered-format.md` item 11, "scattered-format-11") — tracked once, here.

**Why it matters**: this is the file's own worked example of its central `UNKNOWN` mechanism,
directly above the contract section — a maintainer following it to add a test case or verify the
mechanism will find nothing, or wrongly conclude the `UNKNOWN` path is dead, when it's simply
that the illustrative ids were removed from the message catalog without the comment being
updated.

**Proposed change**: either restate the example with a currently-`UNKNOWN` id (there are none
today, so state that explicitly and note the two named ids are historical), or drop the specific
"Today:" ids and describe the mechanism in purely structural terms.

**Regression risk**: none — comment-only change.

**Priority**: P3 · **Size**: S.

**Definition of done**: the comment's example (if kept) names a real, currently-`UNKNOWN` id, or
is explicitly reframed as historical.

**Related tests**: `tests/spec-refs.test.js` (gates the mechanism generally, not this specific
comment).

---

### dead-stale-07 — Stale AdPod plugin-registration comment describes checks that don't exist, using fabricated field names

**Category**: refactoring · **Location**: `packages/core/rules/index.js:58-62` (compare
`packages/core/rules/adpod/index.js:85-89,143` and `packages/core/unknown-fields.js:85-90`).

**Evidence**: comment claims the AdPod plugin validates "podid/podseq must appear together,
podseq >= 0, minadlen <= maxadlen." None of that is true: no co-occurrence check for
podid/podseq exists anywhere in `adpod/index.js` (each field is validated independently); the
real `podseq` rule requires membership in the sentinel set `{-1,0,1}` (`adpod/index.js:85-89`),
so "podseq >= 0" would wrongly reject the valid value `-1`; "minadlen"/"maxadlen" are not real
oRTB fields anywhere in the spec or codebase — the only other place they appear is
`packages/core/unknown-fields.js:85-90`, which states outright they are "the invented minadlen /
maxadlen in samples/synthetic-adpod-malformed.json — a true positive," i.e. a deliberately
fabricated pair of fake field names used to test the unknown-field detector. The plugin's own
accurate docstring one file over (`adpod/index.js:143`) correctly states: "minduration >= 0,
maxduration/poddur/maxseq positive integers, podseq in {-1,0,1}, rqddurs array."

**Why it matters**: this one-line comment sits exactly where a maintainer scans the 11-plugin
registry to understand what each plugin does before diving into one — it currently teaches three
wrong things at once (a nonexistent co-occurrence rule, an inverted range check, two field names
that were never real, sourced from a fixture built specifically to name non-existent fields).

**Proposed change**: replace lines 58-60 with the plugin's own accurate summary: "AdPod —
validates AdPod timing fields on `imp.video`/`imp.audio`: minduration/maxduration/poddur/maxseq
range and consistency, podseq in {-1,0,1}, rqddurs array (oRTB 2.6 §3.2.7 / §3.2.8)."

**Regression risk**: none — comment-only change.

**Priority**: P3 · **Size**: S.

**Definition of done**: the `rules/index.js` comment for the AdPod plugin matches
`adpod/index.js:143`'s own accurate description; no fabricated field name remains.

**Related tests**: none directly (comment-only); existing adpod-focused tests already exercise
the real (correct) behavior this comment currently misdescribes.

---

### dead-stale-05 — Four i18n keys defined in all three locales, never read by any `t()`/`T()` call anywhere

**Category**: refactoring · **Location**: `public/i18n.js:1067-1071, 1269-1270, 1276`.

**Evidence**: `'error.generic'` (en:'Error', uk:'Помилка', ru:'Ошибка', `:1067-1071`) is distinct
from the actively-used `'toast.error_generic'` and is referenced nowhere else in the repo
(repo-wide grep, not just `public/`). `'cabinet.pill.items'` (`:1269`), `'cabinet.pill.empty'`
(`:1270`), and `'cabinet.recent.loading'` (`:1276`) sit inside a `cab` object whose sibling keys
(verified, not_verified, enabled, configured, not_configured, encrypted, plain, recent.empty)
ARE all consumed by `public/account.js:399-454` — but these three specific keys are not
referenced anywhere. Checked for dynamic-key construction (the pattern that legitimately
explains other apparent-unused keys like `'repair.step.*'`, confirmed live via
`t('repair.step.' + r.step)` at `ortbtools.app.js:4732`) — no such pattern exists for any of
these four.

**Why it matters**: three fully-translated strings maintained across three locales for a
"recent items" pill/counter UI element that doesn't currently exist in the account/cabinet page
(drafted-and-abandoned, or built-then-removed leaving strings behind); `'error.generic'` looks
like an earlier generic-error string superseded by `'toast.error_generic'`'s
`{error}`-interpolating version, never cleaned up.

**Proposed change**: delete `'error.generic'` and the three `'cabinet.*'` keys from
`public/i18n.js`.

**Regression risk**: very low — deleting a key nothing reads has no behavioral effect; `t()`'s
missing-key fallback (visible `[key]` placeholder + console warning) already exists as a safety
net for any missed dynamic reference, and none was found for these four.

**Priority**: P3 · **Size**: S.

**Definition of done**: the four keys are gone from `public/i18n.js`; `tests/i18n-audit.test.js`
(locale key-set parity, with the caveat that its primary purpose is catching interpolation/
placeholder-drop defects and lexical calques, not enforcing a fixed key inventory) still passes.

**Related tests**: `tests/i18n-audit.test.js`.

---

### fallbacks-silent-02 — Two contradictory error-containment policies inside `validate()` (structural hardening, no current reproducer)

**Category**: refactoring (structural hardening; no reproducer of a user-visible failure exists today) · **Location**: `packages/core/rules/index.js:93-116`;
`packages/core/index.js:342-413`; `packages/core/rules-request.js:332-347`.

**Evidence**: `runRulePlugins` wraps each plugin call in try/catch and only
`logger.error({pluginId, err}, '[rules] plugin threw')` on failure — no finding, no meta flag,
no test anywhere asserts this path (grep for `'plugin threw'`/`pluginId` in `tests/` is empty).
Meanwhile `validateRequest`/`validateResponse`/`validateRequest30`/`validateResponse30` are
called with zero surrounding try/catch anywhere between `packages/core/index.js` and
`modules/analyze/handler.js`'s generic `.catch(...)=>sendError(res,400,...)`. **Corrected on
verification**: `rules-request.js:332-343`'s comment documents an **already-fixed historical**
repro (the fix is on line 347 of the same comment block), not a live/currently-reproducible
crash — no other concrete unguarded-throw site inside the legacy validators was found, so this
is a structural hardening gap rather than a demonstrated live bug today.

**Why it matters**: the same underlying risk (a bug in one rule) is handled in opposite, both
structurally-weak directions: the plugin path would return a false-clean/lower-severity 200 with
zero observability to the analyst if a plugin ever threw, while the legacy path could lose the
entire analysis (bare 400, no verdict) for a single bad field — a real, previously-hit
production outcome per the repo's own (now-historical) code comment, even though it is not
reproducible against current code.

**Proposed change**: wrap the four legacy validator calls in the same try/catch shape
`runRulePlugins` already has, and in **both** catch blocks push one new observable finding
(e.g. `internal.rule_family_failed`, level warning, `params:{family}`) instead of only logging —
preserves crash-proofing on both sides while closing the silence on both sides.

**Regression risk**: changes `validate()`'s return shape (new finding id) and changes the
legacy-validator failure mode from "throws → caller returns 400" to "returns 200 with a
degraded-marker finding" — none of `validator.test.js`/`native-request.test.js`/`vast.test.js`/
`ortb30.test.js` currently construct a throwing fixture, so this path is genuinely unguarded
today and needs a new test before the change. **Additionally**: this flips a documented public
route-semantics contract (400→200 for a malformed-internals case) — Constitution Principle IV
("Public Contracts Stay Deterministic and Compatible") requires "an explicit compatibility
decision" for exactly this kind of change, so an ADR/spec-kit decision is needed alongside the
new tests, not a code change alone.

**Priority**: P3 (downgraded from the originally-proposed P2: the cited incident is historical/
already-fixed, not a live reproducible bug, and the fix itself now requires a governance step,
raising the size/coordination bar relative to a pure code change) · **Size**: M.

**Definition of done**: a payload engineered to throw inside one plugin, and a payload
engineered to throw inside `validateRequest`, both return `{success:true}` with the other
findings intact plus one `internal.rule_family_failed` finding — neither a false-clean 200 nor a
bare 400 — backed by an explicit compatibility decision for the 400→200 change.

**Related tests**: none today; new fixtures required (see evidence).

---

### Earlier architecture proposals (first pass, retained)

CL-01 and CL-03 overlap with `scattered-format-03` and the price/currency defects DEF-104/DEF-105/DEF-110; CL-04 overlaps with `fallbacks-silent-01` and DEF-200/DEF-205; CL-06 overlaps with the test-infrastructure findings that were not carried into the verified batch.

| ID    | Priority / effort                                                                            | Evidence and affected paths                                                                                                                                                                 | Proposed work                                                                                                                                                             | Acceptance / regression guard                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CL-01 | P1 / M                                                                                       | `packages/core/crosscheck.js` coerces prices with `Number(...)`; `packages/core/rules/price-floor/index.js` checks finite numeric types and resolves deal floors separately                 | Extract a pure shared effective-price/floor/currency resolver, including explicit incomparable and invalid states; keep caller-specific finding IDs and levels            | Existing public findings remain compatible; corpus boolean/array/string prices and PMP floors stop producing contradictory outcomes; no live FX lookup                                                                       |
| CL-02 | P1 / L                                                                                       | `packages/core/crosscheck.js` has its own 3.0 projections; `packages/core/index.js` separately projects plugin input; `public/ortbtools.app.js` reads first 2.x bid and impression directly | Introduce a documented normalized auction/bid view with original source paths, version/context semantics and complete iteration; adopt incrementally                      | 2.x/3.0 IDs, `flrcur`, media, Native/audio/deals and source navigation remain correct; exact original-bid identity tests cover reordering and multiple seats                                                                 |
| CL-03 | P1 / M                                                                                       | `packages/core/format-detect.js` contains separate protocol-family tables with inconsistent enum mappings                                                                                   | Centralize authoritative media subtype data, record its IAB revision and use the same mapping across detection and preview                                                | Explicit tests for every supported inline/wrapper subtype, including DAAST 9/10 and later VAST revisions; unknown codes remain unknown                                                                                       |
| CL-04 | P2 / L                                                                                       | `public/ortbtools.app.js` combines parsing, local preview rendering, HTTP completion, result state and history in `runAnalysis()`                                                           | Extract an explicit analysis state machine with generation/cancellation identity and one result reset path; expose stable accessible state from product behavior          | Success → edit → loading → success/error/reset cannot display an earlier payload's verdict or creative; duplicate-key → clean-paste must send the new lexical bytes (DEF-205); late response and structured-error tests pass |
| CL-05 | P2 / M                                                                                       | `modules/analyze/handler.js` merges both sides and prefixes response messages; tests must reconstruct per-side severity and cannot observe response type/version for pairs                  | Consider an additive structured per-side result contract; migrate UI consumers before deprecating any legacy envelope                                                     | API compatibility tests keep existing fields; Core/HTTP/browser compare identical side/path/severity without message-prefix dependence                                                                                       |
| CL-06 | P2 / M                                                                                       | `scripts/run-tests.js` kills all processes matching a shared browser-profile pattern and labels any successful retry an environment flake                                                   | Track owned browser process lifetimes; preserve the first failure and label retries as retries until evidence establishes a cause; document missing-browser prerequisites | Two isolated browser runs do not kill one another; first-attempt failure is retained; unavailable browser is explicit. The dedicated `test:corpus` already runs serially without retries                                     |
| CL-07 | P3 / S                                                                                       | `packages/core/rules/price-floor/index.js` and other plugins use legacy hyphenated IDs alongside dotted IDs; IDs are public compatibility keys                                              | Document the existing naming policy and use canonical naming only for new IDs; review stale explanatory comments during related edits                                     | No cosmetic renaming of public IDs; locale/spec-reference checks and downstream fixtures remain compatible                                                                                                                   |
| CL-08 | P2 / M (preliminary proposal — needs concrete file and assertion evidence before scheduling) | Core, HTTP and browser maintain format/preview interpretations at different boundaries; source fixtures include unsupported vendor envelopes                                                | Introduce shared explicit capability metadata (recognized, validated, rendered, playable, unsupported), with vendor provenance separate from IAB version                  | A recognized format cannot imply validated pairing or playback; unknown/provisional vendor shapes remain clearly labeled; blocked resources have understandable UI state                                                     |
| CL-09 | P3 / M (preliminary proposal — needs concrete file and assertion evidence before scheduling) | Broader existing tests cover behavior, custom dialects, Mirror/Migrate, history and source navigation, but the new source corpus does not exercise every feature/format combination         | Maintain an inventory linking capability and scenario to actual assertion, while adding combinations based on risk and observed use                                       | Inventory marks unit-only/browser-tested/uncovered distinctly; additions include independent oracles and avoid counting fixture variants as new behavior                                                                     |
| CL-10 | P1 / M                                                                                       | `tests/crosscheck-audit.test.js` calls older 3.0 inputs valid while using `Item.flrcu` and direct `bid.media.display`; new attributed corpus uses normative `flrcur` and `bid.media.ad`     | Review older test-oracle claims; preserve legacy compatibility cases with accurate labels and add authoritative examples separately                                       | Existing compatibility behavior remains tested without presenting permissive inputs as spec conformance; new 3.0 semantic and preview defects remain visible                                                                 |

## Harness cleanup completed within this audit

The corpus harness now treats missing signatures, unexpected failures and retired gaps as hard errors; records nonapplicable execution separately; forwards lexical raw JSON to the real API; preserves original source provenance and local assets; and produces fresh per-run reports. Focused self-tests protect these behaviors. Browser-specific completion and rendering hardening are recorded with the final verification evidence.

## Ordering

First address reproduced incorrect verdicts (CL-01/CL-03) and the product defects they explain. Shape CL-02/CL-04 as separate bounded feature work because they touch public source paths and UI state. CL-05 is an additive contract decision. CL-06 improves repository test reliability without changing product behavior. Do not combine these into a broad rewrite or treat this document as evidence that every proposed refactor has already been implemented.

## Dropped in verification

Every finder write-up was checked against the given verified-item list. Items below did **not**
carry forward into Sections 1-4. Most were not factually wrong — they were superseded by a
duplicate that did survive, judged out of scope/lower-value for this batch, or (in two cases)
found to be inaccurate as originally framed. None should be silently lost: several (marked
**valid, recommend follow-up**) are real, verified findings worth a future pass.

### From `debt/find-dup-core-ui.md`

| Dropped id (informal)                                                                                      | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dup-core-ui-001 — native envelope shape detected 3 ways                                                    | **Partially refuted.** The specific claimed regression — "a bare-shape native bid (`bid.assets`, no `.native` wrapper) co-present with `bid.nurl` reproduces the P0 nurl-vs-native bug by rendering the nurl tracking pixel" — is factually wrong. Independently verified: `findAdm()` (`ortbtools.app.js:1044-1049`) explicitly never falls back to `.nurl` as a creative source ("We deliberately DO NOT fall back to nurl/burl … A nurl-only bid → no renderable creative"), and its `for…in` recursion skips string-valued `nurl` entirely, finding nothing inside a bare `assets[]` array (native assets have no `.adm`/`.iurl`). So `findAdm(res)` returns `null` for this case, landing on the empty/no-renderable-creative state, not the nurl pixel. A real but smaller-severity gap remains (bare `bid.assets` isn't recognized by the adm-priority check at `:4036`, so such a bid shows "no renderable creative" instead of the native card) — worth re-filing at the correct (lower) severity, not carried forward as originally framed (P1, "reproduces the exact P0 bug"). |
| dup-core-ui-002 — `samples/creative-picker.js` reimplements format/VAST detection                          | Valid as verified, not selected — scoped to decorative/demo code under `samples/` (chooses an SVG for a stream view), not the product's validation engine; lower priority than this batch's product-facing items.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| dup-core-ui-004 — locale fallback chain implemented twice, double-brace placeholder escape divergence      | Valid, not selected — self-rated P3 by its own author, explicitly "no observed live bug"; the escape-syntax gap is real but narrow/dormant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| dup-core-ui-006 — JSON-path parsing implemented twice; isomorphic module never shipped to the browser      | Valid, not selected — self-rated P3, explicitly "no observed live bug — both parsers agree on every path shape actually produced by the validator today." Same root-cause shape as dead-stale-01 (a browser-contract Core module `gen-browser-core.js` never mirrors).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| dup-core-ui-007 — severity ranking implemented 3 ways, inconsistent vocabulary AND inverted sort direction | **Valid, recommend follow-up — not refuted.** Independently reproduced: `severityFromFindings` (`public/core/utils.js:98-105`) has no `'question'` branch and falls through to `return null`; `setTabBadge` (`:91`, `if (o.severity) el.classList.add(o.severity)`) then adds no severity class at all. A payload whose only findings are `question`-level (a real, common case once a vendor dialect is active — `dialects.question.unknown_ext_signal`) shows the correct finding **count** but a neutral, uncolored badge, even though `findings.js`'s `SEV_RANK` already ranks `question` correctly. This is a real, demonstrable, user-visible bug (originally rated P1 for the concrete fix) that simply did not make this batch's cut — flagged here rather than silently dropped.                                                                                                                                                                                                                                                                                                 |

### From `debt/find-scattered-format.md`

| Dropped id                                                                                                          | Reason                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| scattered-format-04 — id-taxonomy split (flat vs. dotted plugin ids)                                                | Valid, not selected — not a functional bug (both styles resolve correctly); the only safe fix is documentation-only (freeze the split, don't rename), which the finder itself already scoped as the sole recommendation. |
| scattered-format-09 — `detectNonStandardFormats` never threads `userDialect` through                                | Valid, not selected — narrow blast radius (only affects users with a saved dialect mapping touching an ambiguous format-hint key), self-rated P3.                                                                        |
| scattered-format-10 — VAST validator vs. VAST-timeline parser, two independent engines, one unreachable             | **Duplicate of dead-stale-01** (same vast-timeline-unreachable root cause, same proposed fix shape) — superseded by dead-stale-01, retained above instead.                                                               |
| scattered-format-11 — stale `severity-registry.js` comment citing nonexistent ids                                   | **Duplicate of dead-stale-06** (identical two ids, identical file/lines) — superseded by dead-stale-06, retained above instead.                                                                                          |
| scattered-format-12 — empty push-materials array validates "clean" while `detectFormat([])` reports zero confidence | Valid, not selected — self-rated by its own author as "the smallest, lowest-confidence item in this list."                                                                                                               |

### From `debt/find-fallbacks-silent.md`

| Dropped id                                                                | Reason                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| item 7 — optional-`require` for the Insights logger has no failure signal | Valid, not selected — self-flagged by its own author as minor ("Flagging only because the task explicitly named this exact pattern; not proposing urgent work"), no user-visible impact today (`lib/validation-log.js` always exists). |

### From `debt/find-dom-css-fragile.md`

| Dropped item                                                                         | Reason                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 — ~90 lines of dead `.app-header`/`.sb-toggle` CSS                                 | Valid P3, not selected — pure cosmetic CSS cleanup; the live-code half of the same root cause is tracked above as dom-css-fragile-001.                                                                                                                  |
| 3 — two independently-maintained dismissal handlers race for `.kt-lang-menu`         | Valid P3, not selected — "correctness today is fine (both lists happen to agree)"; a structural-drift risk, not a live bug.                                                                                                                             |
| 4 — `!important` used to defeat source order in `inspector.css`'s mobile block       | Valid P2, not selected under this batch's cap — no factual issue found; a real fix pattern already exists elsewhere in the same file (`:3136-3144`) that this item could copy.                                                                          |
| 5 — dead selector `.preview-safe img`                                                | **Duplicate of dead-stale-02** (identical lines, identical fix) — superseded, retained above instead.                                                                                                                                                   |
| 6 — shared `design-system.css` floating-button defaults fought with 9+ `!important`s | Valid P2, not selected — real, but touches the cross-project vendored-hash-guarded shared stylesheet (per the user's own project memory on `design-system.css`), raising the coordination/size bar above this batch's chosen set.                       |
| 7 — a third parallel header/nav implementation (`.kt-topnav`)                        | Valid, not selected — explicitly self-labeled "observation" by its own author, with no independent action proposed beyond item 6's scope.                                                                                                               |
| 8 — breakpoint literals (720/1023/1100px) duplicated across 9+ stylesheets           | Valid, not selected — pure documentation/process suggestion, no code defect, no test to write.                                                                                                                                                          |
| 9 — no documented z-index scale                                                      | Valid, not selected — pure documentation suggestion; the author's own analysis shows no live visual bug today (the current safety is an incidental side effect of unrelated dismissal logic, not a designed contract, but nothing is currently broken). |

### From `debt/find-dead-stale.md`

| Dropped id                                                                                                    | Reason                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dead-stale-08 — `humanStatus()` dead branches for a capitalized status vocabulary                             | Not refuted — explicitly flagged by its own author as requiring a **maintainer decision** before any change (whether real users' persisted `localStorage` history can still contain the old capitalized shape is unconfirmed either way); reported informationally rather than as ready-to-action debt, consistent with the brief's "a workaround's existence does not prove it can be removed" rule. |
| dead-stale-09 — orphaned maintainer script `build-routing-matrix.js` has no regeneration-contract doc pointer | Valid, not selected — pure documentation debt (self-rated P3/S), no functional impact; its frozen output is already guarded by `tests/key-role-routing-matrix.test.js`/`tests/key-role-manifests.test.js`.                                                                                                                                                                                            |

### From `debt/find-test-infra.md` — entire category not carried into this batch

None of this file's 8 items were selected. On spot review none were found inaccurate — several
are high-confidence, well-evidenced findings that plausibly belong in a test-infrastructure-
focused follow-up rather than this product-code-focused batch:

| Dropped id     | One-line claim                                                                                                                                                                                                                                                                                                        | Priority/size as submitted |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| test-infra-001 | ~23 browser-test files hand-roll the same server/port/Chrome harness, with real drift (13-file CDP-timeout comment, 4-way SIGKILL-grace duplication)                                                                                                                                                                  | P2/L                       |
| test-infra-002 | The documented `clear-resets-results` flake (`map/harness-and-coverage.md` §6 item 3) is attributed to "environment noise," but every Analyze-completion wait in that file is a fixed `delay(N)` sleep, not a poll on the real condition — a plausible alternate root cause the existing mitigation doc does not name | P1/S-M                     |
| test-infra-003 | 2 of 24 browser-test files hard-crash (bare stack trace) instead of skipping when `puppeteer-core` is absent, unlike the other 22                                                                                                                                                                                     | P2/S                       |
| test-infra-004 | 2 of 7 rate limiters have no env override, forcing a header-spoofing (`X-Forwarded-For` rotation) workaround in `tests/corpus/lib/http-run.js`                                                                                                                                                                        | P2/S                       |
| test-infra-005 | 7 of 24 browser-test files spawn the real server without disabling the news-crawler/FX background timers — live outbound network calls during test runs                                                                                                                                                               | P1/S                       |
| test-infra-006 | `privacy-floor.test.js` hardcodes two commit SHAs and hard-fails indistinguishably from a real defect on any shallow clone                                                                                                                                                                                            | P3/S                       |
| test-infra-007 | Coverage is measured for less than half the suite (unit phase only) and gates nothing (`npm run ci` reads no threshold)                                                                                                                                                                                               | P3/M                       |
| test-infra-008 | Two divergent ways to run the browser phase (`npm run test:browser` vs. `scripts/run-tests.js`); only one has the retry/orphan-Chrome-sweep mitigations, yet several `specs/*/quickstart.md` files direct people to the unhardened one                                                                                | P3/S                       |

**Caveat**: this session did not independently re-verify every test-infra claim to the same
depth as the 23 items carried forward (time-boxed to a lighter spot-check); treat the table above
as "worth a dedicated verification pass," not as pre-verified backlog-ready items.
