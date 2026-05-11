# Changelog

All notable changes to Spyglass are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning is
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### v0.38.1 — /api/proxy SSRF hardening (Gemini Pro 3.1 audit, 2026-05-11)

Focused SSRF review of the /api/proxy harness by Gemini Pro 3.1 (CLI,
plan mode, read-only). Returned 3 findings, all verified real:

- **F-1 HIGH — Unbounded response buffering + missing timeout.**
  `proxyRes.on('data')` concatenated chunks into a string with no cap;
  `proxyReq` had no socket timeout. An authed user could request
  `httpbin.org/bytes/N` for arbitrary N and OOM the Node process, or
  hit `/drip` and exhaust file descriptors.
  Fix: 1 MB response cap (`MAX_PROXY_RESPONSE_BYTES`) — destroy
  upstream socket on overflow, return 502 `response_too_large`.
  10s socket timeout (`PROXY_TIMEOUT_MS`) — destroy on fire, return
  504 `upstream_timeout`. Both guarded with `!res.headersSent` so the
  error path doesn't try to double-write.

- **F-2 MEDIUM — Port verification bypass.**
  The allow-list checked `targetUrl.hostname` but `client.request(url)`
  honoured the port in the original URL. `http://httpbin.org:22/` slipped
  through and the proxy attempted to connect — leaking ECONNREFUSED vs
  timeout side-channels (port-scan amplifier on the allowed hosts).
  Fix: `ALLOWED_PORTS = {'', '80', '443'}` strict allow-list. Non-default
  ports return 403 `port_not_allowed`.

- **F-3 INFO — Subdomain wildcard.**
  `hostname.endsWith('.' + h)` admitted any subdomain of the allowed
  roots. Theoretical SSRF amplifier if httpbin.org or postman-echo.com
  ever permitted user-registered subdomains (or via DNS rebinding /
  wildcard misconfig). The allow-list is two specific hosts; subdomain
  acceptance was unnecessary by design.
  Fix: strict equality (`hostname === h`). Same 403 `host_not_allowed`
  message; allow-list still echoed for UI rendering.

Tests: new `tests/proxy.test.js` covering all three vectors plus auth
gate, protocol smuggling, malformed URL — 7 tests. 554/554 pass overall,
0 lint errors.

This audit was the first run of the new gemini-CLI direct workflow:
`gemini --skip-trust --approval-mode plan -m gemini-3.1-pro-preview -p
"<prompt>"` from a Claude-side Bash. Gemini reads the source via its
file-access tools, verifies its own claims, returns structured findings.
Claude verifies each claim against the actual code (file:line + grep),
then writes the fix. Gemini never gets write/edit/commit access — that
boundary is captured in `feedback_gemini_audit_not_writer.md`.

### v0.38.0 — Version Pinning (2026-05-11)

Closes the circular-detection loophole that Round 1 of the audit
surfaced: `detectVersion()` infers the oRTB version from field presence,
but `validateRequest` then validates fields against that inferred
version. If a payload meant for 2.5 accidentally includes a 2.6-only
field (`imp[].rwdd`, `device.sua`, `regs.gpp`, ...), detection silently
flips to 2.6 and the rogue field passes unflagged — even though the
developer's intent was 2.5.

**New API:** `validate(payload, { expectedVersion: '2.5' | '2.6' | '3.0' })`

When the caller declares an expected version and detection lands
elsewhere, a `version.mismatch` (WARNING) finding is emitted with:

- `expected` — what the caller pinned to
- `detected` — what `detectVersion` returned
- `confidence` — the detector's confidence score
- `signals` — JSON-stringified list of field paths that triggered the
  detected version

The dev then either removes the rogue fields (pin was right) or updates
their pin (traffic moved on). Either way the silent flip is gone.

**Behavior:**

- Backwards-compatible: `opts.expectedVersion` is opt-in. Validators
  called without it behave exactly as before.
- Garbage-in safety: unknown values (e.g. `expectedVersion: 'banana'`)
  are silently ignored rather than throwing or producing noise.
- Scope: only emitted for oRTB BidRequest / BidResponse types. Other
  formats (Kadam feed, JSON feed) don't carry an IAB version axis;
  pinning is silent there.

**HTTP API:** `POST /api/analyze` accepts `opts.expectedVersion` in the
request body and forwards it to `validate()`. Not yet exposed in the
UI — that's a follow-up (requires preview gate per the
no-default-state-changes rule).

Core 0.17.0 → 0.18.0 (MINOR — feat in core); app 0.37.2 → 0.38.0
(lockstep). Messages in 3 locales. +6 tests covering 2.5↔2.6 both
directions, matching pins, missing pins, garbage pins, and non-oRTB
shapes. 547/547 pass, 0 lint errors.

### v0.37.2 — Invisible-scan FP tuning (Playwright smoke catch, 2026-05-11)

End-to-end Playwright smoke against a crafted 4× transparent-overlay
creative confirmed the v0.37.1 scan-on-click fix actually fires — but
also revealed an over-counting issue: HTML defaults to transparent
background and spans the full viewport, so the classifier flagged it
as "invisible" too. The test creative reported `contributorCount=11`
and `aggregateCoverage=236%`. Worse, every legit creative without an
explicit `<html>` background would trip the aggregate rule.

Fix: skip HTML, BODY, IFRAME tags in `classifyInvisible`. They're
structural roots, not click traps:

- **HTML/BODY**: clicks "on body" fall through to whatever is
  underneath, so these elements aren't intentional click surface.
- **IFRAME**: nested iframes have their own probe; double-counting
  their viewport area as our own would inflate the aggregate.

Post-fix on the same test creative: `contributorCount=10`,
`aggregateCoverage=153.8%`, top `tagName=H2` (a real content
element, not a trivial root). The attack pattern still fires; the
trivial-root false positive is gone.

Caught by Playwright smoke, not by unit tests — synthesized aggregate
events in the test suite bypass the scan logic entirely. Future
tuning candidate (deferred): require `cursor: pointer` or a clickable
tag (anchor / button / `onclick` handler) to count toward the
aggregate. That would filter text wrappers like `h2` / `p` further;
holding off until we have a corpus of legit creatives to measure
real-world FP rate.

541/541 tests pass, 0 lint errors. Tiny 12-LOC patch.

### v0.37.1 — Post-audit fixes (Gemini Pro 3.1 review, 2026-05-11)

Independent code review of the v0.37.0 branch by Gemini Pro 3.1 surfaced
4 real findings (verified all 4, 0 hallucinations — much higher accuracy
than the Flash baseline used for the earlier 6-round audit). Calibrated
severity downward on one (CRITICAL→HIGH on P1-001 since it requires a
DB-malfunction trigger), kept the others as reported.

**P1-001 (HIGH) — Session Map desync on DB throw**
The v0.37.0 fix made `invalidateUserSessions` propagate DB errors so the
caller could return 500 instead of minting a session against partial
state. But that throw happened BEFORE the in-memory Map cleanup loop —
so on a SQLITE_BUSY between the password commit and the session-delete,
the Map kept stale entries pointing to the user. A stolen cookie that
already resolved through the Map stayed live until container restart.

Fix:

- `Users.updatePasswordAndCrypto` now does `DELETE FROM sessions
WHERE user_id = ?` INSIDE its transaction. Password rotation and
  session invalidation land atomically; the follow-up `invalidate`
  call's DB delete is a no-op double-check on the happy path.
- `invalidateUserSessions` runs its Map cleanup unconditionally in a
  finally-shaped path (Map.delete cannot throw), then rethrows the DB
  error so the caller still sees 500. Map is guaranteed cleared even
  when DB throws — the stolen-cookie attack window is closed.

**P1-002 (HIGH) — Aggregate invisible-overlay never fired end-to-end**
The v0.37.0 fix populated a per-click `_invisibleEls` Map and summed
its values. But the Map only ever contained ONE entry — click traps
redirect on the first click, so the user never came back to populate
entries 2-N. The detection passed unit tests (which synthesized the
aggregate event directly) but would never fire on a real attack.

Fix: replaced Map-driven logic with viewport-wide scan-on-click. On
every click (capture phase, before author redirect handlers), iterate
`document.querySelectorAll('*')` up to AGGREGATE_SCAN_CAP, classify
each element's in-viewport coverage + opacity/bgAlpha, sum coverage
across invisibles. If sum > 50% across ≥2 contributors, emit the
aggregate event right away — before the trap can navigate.

**P1-003 (HIGH) — Events flood evasion via tail-clipping**
The v0.37.0 cap took the head of the events array (`events.slice(0,
MAX_EVENTS)`). A malicious creative could pad with 1000 benign
mousemove events up front and place the real fraud signal
(auto_redirect, frame_bust) at index 1001 — server cuts the tail,
returns status:clean.

Fix: head + tail sample. `slice(0, 500).concat(slice(-500))`
preserves the probe_ready handshake at index 0 AND the most recent
events (where fraud actions concentrate). Same MAX_EVENTS=1000
ceiling, but both ends of the timeline exercised.

**P1-004 (LOW) — Underscore stripped from Android bundle IDs**
The v0.37.0 addDomain regex `/[^a-z0-9.-]/g` stripped underscores.
Android `app.bundle` IDs commonly contain `_` (com.example.my_app);
pre-fix this mutated to com.example.myapp, degrading LLM
partner-inference precision for mobile traffic.

Fix: include `_` in the allowed set: `/[^a-z0-9._-]/g`. Newline and
control-char defense remains intact.

Tests: 541/541 pass, +3 over v0.37.0 — atomicity of session-clear in
updatePasswordAndCrypto, Map cleanup on DB throw, underscore
preservation in bundle ID. 0 lint errors.

### v0.37.0 — P1 hardening sprint (audit 6-round outcome, 2026-05-11)

Six-round adversarial audit (Gemini + Claude calibration loop) surfaced
~32 candidate findings; verification against actual code accepted ~12 as
real (38% net) and rejected the rest as confident hallucinations or
trade-offs. This release lands the P1 subset — five separate commits
addressing correctness across DB, auth, validator, behavior, and intel
layers. Core bumps to 0.17.0 (new findings = feat); app bumps to
0.37.0 (lockstep with core).

**DB hardening (db.js)**

- `init()` wraps `migrate(db, cur)` + `user_version` pragma bump in a
  single `db.transaction()`. A crash mid-migration previously left
  schema_version stale; on next boot the same blocks re-ran and crashed
  loop on "table already exists" (CREATE without IF NOT EXISTS).
- Added `IF NOT EXISTS` to every CREATE TABLE / CREATE INDEX in
  v4→v5, v5→v6, v6→v7 blocks (belt-and-suspenders over the transaction).
- `busy_timeout = 5000` pragma — 5s headroom for SQLITE_BUSY during
  the daily backup window (03:30 UA, `sqlite3 .backup` holds reader
  briefly). Pre-fix a coincident analyze call returned BUSY immediately.
- `wipeUserData` now sweeps `analyze_log`, `behavior_corpus`, and
  `sessions` too — previously only samples + partners. Stolen cookies
  issued before a wipe stop working at the wipe boundary, not at the
  next container restart.

**Auth atomicity + session revival (auth.js, modules/auth/handler.js)**

- New `Users.updatePasswordAndCrypto(id, hash, state)` and
  `Users.updatePasswordAndWipe(id, hash)` helpers wrap the multi-write
  reset flows in `db.transaction`. Used by reset-password modes
  `rotate`, `recover`, and `wipe`. Pre-fix a crash between the password
  update and the crypto-state update permanently locked the user out
  (new password → new KEK → can't unwrap old DEK). All three modes
  now land all writes or none.
  - Recovery wrap (recovery_dek_wrapped + recovery_salt) is preserved
    by both `rotate` and `recover` — key-on-paper remains valid.
- `invalidateUserSessions` no longer swallows DB-side delete failures.
  Pre-fix: `try/catch` around `Sessions.destroyForUser` meant a
  SQLITE_BUSY left DB rows intact while in-memory Map was cleared;
  next container restart re-hydrated the "dropped" sessions and stolen
  cookies silently revived. Now DB-side runs first, errors propagate,
  in-memory Map only mutates if DB succeeded.
- `handleResetPassword` catches the propagated error and returns 500
  with code `sessions_invalidate_failed` rather than minting a new
  session against partially-invalidated state.

**Validator + crosscheck (`packages/core/`)**

- New finding `request.site_and_app_both` (WARNING). oRTB §3.2.1
  requires exactly one of `site` or `app`. Pre-fix we only flagged
  the case where neither was present; a request with both passed
  silently. Messages in 3 locales.
- `crosscheck.bid.cat_blocked` now does hierarchical match. IAB
  Content Taxonomy organizes IDs as parent–child via hyphen
  (`IAB7` parent, `IAB7-39` child; or `1` and `1-7` in Taxonomy
  2.x). A `bcat` listing the parent must reject any child. Pre-fix
  was exact-string match only — bid with `cat=["IAB7-39"]` cleared
  `bcat=["IAB7"]`, a false-clean verdict. Strict `${parent}-` prefix
  ensures siblings like `IAB10` are correctly NOT blocked by `IAB1`.

**Behavior engine (`packages/core/behavior/`, `public/creative-probe.js`)**

- New finding `behavior.trap.invisible_overlay_aggregate` (ERROR).
  The Phase 1 rule catches a single click target covering >50% of
  viewport while invisible. Audit surfaced an evasion: ship 10
  transparent divs at ~12% each — no single trip, but collectively
  a full-screen click trap. Probe now maintains `_invisibleEls`
  Map<HTMLElement, ratio> populated on every invisible click target;
  on each click, sum coverage across live tracked elements; if >50%
  AND ≥2 contributors, emit aggregate event. Messages in 3 locales.
- Server-side events cap (`/api/analyze-behavior`): 1000-event
  ceiling, head-truncate with `truncated: true` flag in response
  meta. Probe-side already emits summarised events; this caps the
  flood-of-events vector for callers bypassing the probe.

**Intel (intel-llm.js, malicious.js)**

- `addDomain` (server-side, partner inference): now strips anything
  not `[a-z0-9.-]` before adding to the prompt's domain list. Pre-fix
  explicit-field domains went through with only `toLowerCase + trim`,
  so a `bid_req.site.domain` of `"x.com\n\nIMPORTANT: ..."` could
  bleed past the bullet-list boundary and risk steering the LLM.
  Output is still bounced by `PARTNER_NAME_RE` in
  `validatePartnerSuggestion`, but cleaning the input boundary is
  the right belt-and-suspenders posture.
- `malicious.js:260` docstring updated to say
  `FROZEN_THRESHOLD_MS = 6000` (was stale at "3.5s"; constant was
  bumped to 6s in v0.24.0 but rule comment lagged).

**Tests**: +14 over the sprint (524 → 538). All 538 pass. 0 lint errors.

### v0.36.2 — Favicon resilience (2026-05-10)

User reported the browser tab showing a generic globe icon despite the
SVG favicon serving 200 OK. Three small fixes layered together:

- **Explicit `width="32" height="32"` on the `<svg>` root.** The file
  had only `viewBox`, which is enough for _most_ renderers but Safari
  (and a few mobile Chromes) want intrinsic dimensions before they
  rasterize a favicon. Adding the attrs costs nothing and removes one
  failure mode.
- **`sizes="any"` on the `<link rel="icon">`.** Signals to Chrome that
  this SVG can scale to any resolution the OS asks for — without the
  hint, Chrome occasionally falls back to the legacy `/favicon.ico`
  request and ignores the SVG.
- **`/favicon.ico` route serves the SVG bytes.** Chrome / Slack /
  Discord / link-preview bots all request `/favicon.ico` by default
  regardless of the link tag. The 404 we returned was getting cached
  by CF (and by browsers) and could poison the tab. Now: same SVG,
  served under `image/svg+xml` — browsers sniff the magic and render
  it correctly.
- Bumped query-string from `?v=4` to `?v=5` across all 9 HTML shells
  to force fresh fetch past any browser cache holding a stale empty.

### v0.36.1 — Overlap + reality audit fixes (2026-05-10)

Two parallel audit agents (functional overlap + claims-vs-reality)
returned ~30 findings between them. Triaged with verification per
`feedback_audit_false_positives.md`. Filtered ~25 borderline /
false-positive cases; applied 5 verified fixes.

**Fix — `escapeHtml` deduplicated in `account.js`**

- account.js declared `escapeHtml` TWICE (lines 21 + 589). Function-
  declaration hoisting meant the SECOND one (DOM-textContent based)
  shadowed the first (regex-based) — and the DOM version is _less_
  safe (it doesn't escape `"`, which matters for HTML-attribute
  context). Latent XSS risk when user data lands in attributes.
- Removed second declaration; first one (with `&<>"` coverage) wins.

**Fix — `#layers` section now navigable**

- All 3 about pages have `<h2 id="layers">` (the "Three layers of
  analysis" section) but no nav link pointed at it. Added "Як
  працює / How it works / Как работает" link to the topnav between
  "Що вміє" and "Чого не робить" in all 3 locales.

**Fix — stale counts in roadmap docs**

- `docs/next-chapters-2026-05-09.md`:
  - "12 detection patterns" → "16 detection patterns" (verified by
    counting unique `behavior.*` keys in `messages/en.json`: 12
    runtime + 4 static creative scan = 16).
  - "5 dialects" → "3 oRTB dialects (iab / kadam / kadam-inpage-push)
    - 4 JsonFeed handlers (kadam / exoclick / richads / zeropark)"
      (the "5" was wrong both ways — 3 oRTB or 7 if counting JsonFeed).
  - "402 tests" → "463 tests" (count refreshed 2026-05-10).
- `docs/ARCHMAP.md` corpus-matrix consumer description: "all 12
  detection patterns" → "all 16 detection patterns (12 runtime +
  4 static creative scan)".

**Word cleanup — replaced "шипнули" everywhere**

User feedback: «слово шипнули, не піде, якось шляпно звучить.
Запушили, викатили, зробили, впровадили, але точно не шипнули».
Replaced in `about.uk.html` ("шипнули → викатили", "шипнуті →
викочені") and `about.ru.html` ("шипнули → выкатили", "шипнуты →
выкачены"). Saved feedback memory at `feedback_word_shipnuly.md`
so future sessions don't repeat the slang.

**Triage skipped (NOT fixed — borderline / risky):**

- `escapeHtml` defined in `embed.js`, `shortcuts.js` — each is a
  self-contained IIFE without ES module imports. Adding imports
  would change the script type, breaking other things. Acceptable
  duplication for IIFE-script modules; refactor only if migrating
  to ES modules.
- Modal boilerplate × 4 (save / mirror / live / simbids) — agent
  flagged the repetition. Real but refactor risk > value; all 4
  modals work, would need careful test pass to consolidate.
- Rate limiter factory × 2 — purely cosmetic; the 2 implementations
  diverge in window size + max threshold. Extracting a factory
  would save ~30 LOC.
- "Version divergence app vs core" (0.36.x vs 0.16.x) — intentional
  per CHANGELOG; documented as deliberate ("honest divergence when
  core spec coverage didn't shift").

**False positives** (agents wrong):

- "5 escapeHtml definitions, all should import from /core/utils.js"
  — verified: `core/utils.js` is an ES module imported by
  `spyglass.app.js`; the others are classic `<script>` IIFEs that
  _cannot_ import. Honest minimal fix dropped 1 dup, kept the rest.
- "/api/v1/sample vs /api/v1/stream" — different delivery semantics
  (one-shot static vs continuous SSE), not duplication.
- "Behavior corpus vs sample corpus" — different purposes (user-
  labelled DB rows vs static fixtures), not duplication.

463/463 tests still green. Lockstep PATCH bump 0.36.0 → 0.36.1 +
cache-bust account.js ?v=5→6.

NOT pushed — local commit awaits user review.

### v0.36.0 — Docs catch-up + perf polish (2026-05-10)

Two parallel agents audited (a) site performance and (b) /about
docs. Triaged with verification per `feedback_audit_false_positives.md`.
Net: 1 verified perf win + 4 verified docs gaps + new feature
documentation across 3 locales.

**Perf — `runAnalysis` AbortController**

- Pre-fix the `_analyzeReqSeq` counter prevented stale responses from
  overwriting the UI but the actual fetch still ran to completion,
  wasting server CPU and the user's bandwidth on results we'd discard.
  Now each `runAnalysis()` aborts the previous in-flight fetch on the
  wire. AbortError caught and silenced (it's expected when a newer
  request supersedes an older one — no toast, no console noise).

**Docs — stale facts fixed (UK)**

- `about.uk.html` locale-support table: "EN locale: Phase 3 (en.json
  — stub)" → "EN: Підтримується" + new "RU: Підтримується" row.
- "Що Spyglass не робить" table: removed "Не підтримує English UI"
  row (English about + UI shipped in v0.32).
- "messages/uk.json — 71 локалізована повідомлення" →
  "messages/{uk,en,ru}.json — локалізовані повідомлення".
- `about.ru.html`: Cyrillic typo `detectВерсия` (mid-word
  English/Cyrillic mix) → `detectVersion`.
- `about.en.html`: `messages/{uk,en}.json` → `messages/{uk,en,ru}.json`.

**Docs — new section "Що нового · 2026-05-10" × 3 locales**

Single section near the top of each /about page, with 8 subsections
covering today's shipped features:

1. 🪞 Mirror generator + best-practice mode + diff view + share permalink
2. 📡 Live RTB stream UI
3. 👁 Finding details panel (path / value / severity / spec)
4. 🛡 Behavior corpus + Confusion matrix
5. 🤖 Bid simulator (gemma 3-strategy)
6. 📦 Specimen replay endpoint (`POST /api/v1/replay`)
7. 👤 Cabinet redesign (7 sections + sticky sidebar + scroll-spy)
8. Localization shipping (EN + RU first-class)

Topnav of each /about page also gets a new "Що нового / What's new
/ Что нового" link to jump straight to the section. Authored
natively in each locale, not machine-translated.

**Audit triage notes** (false positives NOT fixed):

- "i18n.js 92KB monolithic — split per locale" — would need a build
  step the project doesn't have; brotli gets it to ~15KB on wire.
- "inspector.css 60KB — PurgeCSS" — same constraint; runtime parse
  is ~5ms on warm cache.
- "Live modal 60FPS dropped at 50 events/sec" — synthetic stream is
  1Hz (`STREAM_RATE_MS=1000`), agent assumed unrealistic rate.
- "Asset version hash on every render" — already cached at
  `server.js:229`.
- "8 new full-section content × 3 locales" was the agent's
  recommendation; we shipped 1 condensed "What's new" section per
  locale instead — covers all 8 features readably without doubling
  the doc length.

463/463 tests still green. Lockstep MINOR bump 0.35.0 → 0.36.0 +
cache-bust ?v=18→19 (inspector). Smoke at /uk/about: 7 nav items,
new section renders, 0 console errors.

NOT pushed — local commit awaits user review.

### v0.35.0 — Bug-bounty patch round (2026-05-10)

5 parallel audit agents (server / validator / client / new-sprints /
i18n+cabinet) returned ~125 findings. Triaged with `Read`/grep
verification per `feedback_audit_false_positives.md`; ~20% false
positive rate (notably "missing 15 cabinet keys" — agent didn't see
the merge loop at i18n.js:1274; "getJsonAtPath falsy trap" — code
already uses === undefined correctly). Six verified bugs fixed:

**Cabinet — hardcoded English in non-EN locales**

- `account.uk.html` and `account.ru.html` had "Behavior corpus" and
  "Danger zone" hardcoded English in the sidebar nav AND section
  h2s, breaking locale consistency. Now: UK "Корпус поведінки" /
  "Небезпечна зона", RU "Корпус поведения" / "Опасная зона".
- UK confusion matrix h2 also slightly tidied: "precision и recall"
  → "precision і recall".

**Cabinet — duplicate CSS block**

- All 3 cabinet HTML files had `corpus-*` + `matrix-*` CSS defined
  twice — once during the v0.29 / v0.30 builds, then again during
  v0.31 layout pass. ~1.9KB × 3 = ~5.7KB wasted bytes per page load.
  Second occurrence removed by Python script.

**Cabinet — aria-current sync (a11y)**

- Scroll-spy in `account.js` toggled `.is-active` class but never
  updated `aria-current` attribute. Screen readers stayed on stale
  section after user scrolled. WCAG 2.1 AA #4.1.3 violation. Now
  `setActive()` writes `aria-current="true"` on match and removes
  on others.

**Validator — `isVastShape` SVG false-positive**

- Regex `/^\s*(<\?xml|<VAST)/i` matched any `<?xml`-prefixed string
  including SVG creatives, which would then incorrectly drop into
  `validateVast` and emit "version*missing" / "inline_or_wrapper*
  required" findings. Tightened to require an actual `<VAST` tag,
  with optional XML declaration prefix: `/^\s*(?:<\?xml[^?]*\?>\s*)?
<VAST\b/i`. SVG and other XML-shaped creatives no longer
  misclassified.

**Crosscheck — `Math.max(0, ...arr)` stack overflow on large bid arrays**

- Spread operator pushes each array element as a function argument.
  Browsers / V8 cap argument count around 65k; responses with 10k+
  bids would `RangeError`. Replaced with `for...of` loop tracking
  max manually. No spec change, just a more robust impl.

**Behavior — `injectCorpusBar` re-rendered on every probe heartbeat**

- The corpus-save bar was removed and re-injected on every probe
  heartbeat (~10×/sec under active probe). Caused layout thrash and
  occasional flash. Now stamps `data-event-count` on the bar; if
  re-render arrives with the same count, the existing bar stays.

**False positives** (NOT fixed — agents wrong):

- "getJsonAtPath falsy trap (0/false treated as missing)" —
  `=== undefined` already handles falsy correctly (Agent C-1, C-9).
- "15 missing cabinet i18n keys" — keys exist via the `cab` merge
  loop at `i18n.js:1274-1278` that distributes per-locale values
  into `I18N.{en,uk,ru}` (Agent E-1).
- Several CRITICAL "auth bypass" claims around mass-assignment in
  Partners CRUD — verified `db.js` validates fields explicitly.
- Multiple race-condition / stack-overflow claims that require
  unrealistic load to trigger.

**Verify**: 463/463 tests still green. Cabinet `/uk/account` shows
all 7 sidebar items + 11 h2s in the matching locale; aria-current
flips correctly with scroll position.

### v0.34.0 — Bid simulator demo (gemma 3-strategy, 2026-05-10)

The AI-bridge graduates from cluster-naming and field-purpose to a
demo-worthy "what would 3 different DSPs do with this request?"
panel. Local gemma3:4b runs three strategies in parallel and emits
bid-yes/no + price + plain-language rationale per strategy.

**Three strategies**

- 🔥 **aggressive · max scale** — bids 30-50% above floor on every
  fillable imp
- 🛡 **conservative · ROAS guard** — bids only when ROI obvious,
  5-15% over floor
- ✨ **quality · premium only** — filters for brand-safe domain,
  modern device, complete metadata; 50-80% over floor or skip

**Privacy**

- Pre-flight `summarizeRequestForSim()` strips the BidRequest to a
  metadata-only summary: imp count, formats, sizes, geo country,
  surface (app vs site), bundle/domain, currency, average floor,
  device type, auction type. **Bid VALUES never reach the LLM.**
- gemma sees only this 8-field summary plus the strategy hint.

**Module — `intel-llm.js`**

- New `simulateBids(bidReq)` runs 3 strategies via `Promise.all`
  with isolated try/catch — one strategy's parse failure or LLM
  hiccup doesn't drop the other two. Failed strategy returns
  `{ bid: false, reason: 'simulation_failed' }` so the UI still
  renders 3 cards.
- `summarizeRequestForSim`, `buildBidSimPrompt`, `validateBidSim`
  exported for tests.
- Gemma response constraints: `temperature: 0.4` (some creativity
  for strategy-flavored reasoning), `numPredict: 200`,
  `format: 'json'` for structured output.

**Endpoint — `POST /api/intel/simulate-bids`**

- Body: `{ bid_req: <string-JSON or object> }`. Public, rate-limited
  via the shared intel limiter (30/min/IP).
- Returns: `{ success: true, strategies: [...] }`. Failures map to
  503 (Ollama unreachable) or 502 (LLM unparseable).

**UI — `🤖 simulate` button + modal**

- New header button between live and mirror in all 3 locales.
- Modal renders 3 strategy cards: label, verdict (✓ bids / ✗ passes),
  price (or em-dash), one-sentence rationale. Bid cards left-bordered
  green; pass cards muted.
- Modal hint reminds users gemma sees metadata only.

**Tests — `tests/intel.test.js` +7**

- summarizeRequestForSim metadata extraction (no values leaked)
- validateBidSim happy path / bad price / pass-through / 200-char
  truncation / unparseable input
- buildBidSimPrompt contains strategy + metadata, no `bidfloor` token
- 70 → 77 in intel.test.js. Full suite 456 → 463.

**Smoke** (live POST to prod): banner-imp request → aggressive bids
$0.35 (35% over $0.10 floor with rationale "Aggressive strategy
demands maximizing scale, so I'm bidding 35% above the floor"),
quality bids $0.75 (75% over, brand-safe domain rationale),
conservative occasionally falls back to `simulation_failed`
(graceful — JSON parse hiccups happen ~5% on gemma3:4b under load).
0 console errors.

**Lockstep** MINOR bump 0.33.0 → 0.34.0 + cache-bust ?v=29→30 (i18n)

- ?v=16→17 (inspector / app.js).

### v0.33.0 — Specimen replay endpoint (Chapter A foundation, 2026-05-10)

The first piece of Chapter A from `next-chapters-2026-05-09.md`:
a single-call bulk pipeline runner that takes an array of samples
and returns per-sample results + aggregate summary. Foundation for
the Stream Pivot platform — any external pipeline (CI test fixtures,
specimen archive replay, partner audits, batch grading) gets one
endpoint instead of stitching N round-trips to /api/analyze + N to
/api/analyze-behavior.

**Module — `lib/replay.js`**

- `replay(samples, deps)` — pure DI, takes `validate / crosscheck /
analyzeBehavior` as deps. Fully testable without HTTP.
- Per-sample envelope: `{ bidReq?, bidRes?, behaviorEvents?, adm?,
label? }`. At least one of req/res/events must be present;
  empty samples are skipped with `reason: 'empty_sample'`.
- Per-sample result: `{ index, label, status, validation,
crosscheck, behavior, errorCount, warningCount, infoCount,
critCount }`. Status rolled up to worst across all three engines.
- Summary: `{ total, accepted, skipped, statusCounts,
totalFindings, topFindings, locale, dialect }`. topK=10 by default
  (clamp 1-50). Hard cap of 100 samples per call server-side.

**Endpoint — `POST /api/v1/replay`**

- Body: `{ samples: [...], opts?: { topK } }`. Response:
  `{ success: true, results, summary }`.
- Reuses analyze rate-limiter (60/min/IP). Public — no auth — to
  match `/api/analyze`.
- Hard cap of 100 samples per call regardless of opts (server-side
  belt-and-braces against malicious bulk).

**Tests — `tests/replay.test.js`**

- 16 cases: shape validation (non-array, empty samples, invalid
  entries), pipeline routing (req-only / req+res / events-only /
  adm passthrough), status rollup (validation × crosscheck ×
  behavior worst-of), per-sample severity counts, aggregate
  totalFindings, topFindings sort + topK, statusCounts histogram,
  maxSamples cap, label echo, empty-array behavior.
- Full suite 440 → 456. All green.

**Smoke** (live POST to prod): single banner-imp sample returns
`status: clean`, validation populated with type/version/findings,
summary aggregates correctly. 0 console errors.

### v0.32.0 — i18n consolidation (Chapter D, 2026-05-10)

Closing the i18n debt to a single source of truth. The originally-
estimated "~30 hardcoded UK strings in spyglass.app.js" turned out
to already be done (Tier-2 batch in v0.15.0). What was left:

- **`sign out` button** in inspector header rendered English on
  Ukrainian/Russian pages because the text was hardcoded in three
  template files. Fixed: each locale's template now has the
  matching word ("вийти" / "sign out" / "выйти"). Plus a new
  central `btn.signout` i18n key (uk/en/ru) for any future modal
  or dynamic surface that wants the localized label.
- **`intel/builder.js` STRINGS** — module-local 50-line dictionary
  with three branches (uk / ru / else en) covering 14 keys.
  Consolidated into `public/i18n.js` under `builder.*` namespace
  (14 keys × 3 locales = 42 entries). `localised()` now reads
  via `window.t()` with a tiny shim fallback.
- **`intel/banner.js` localised summary** — 1 string in 3-branch
  inline. Same pattern: moved to `banner.new_patterns` central
  key with `{n}` interpolation.

**Things deliberately left as English jargon**

- `sim price` label (AdTech term, like CPM)
- `powered by` embed footer (brand attribution)
- `#tRef` Reference tab content (vendor docs, intentionally English)
- `inspector/index.js` manifest title/description (already 3-locale
  inline; pattern is fine)

**Verify**: real-browser smoke on uk/en/ru — sign out button shows
in matching locale; `t('builder.title')` returns
"Конструктор тимчасового діалекту" / "Temporary Dialect Builder" /
"Конструктор временного диалекта"; `t('banner.new_patterns', { n })`
interpolates correctly. 0 console errors. 440/440 tests still green
(no test surface change — i18n keys are a UI-layer concern).

### v0.31.0 — Cabinet redesign: sidebar nav + scroll-spy (2026-05-10)

The cabinet was an 11-card vertical wall. Now it's a 7-section
workspace with a sticky left sidebar, anchor links, and scroll-spy
active state. URL hash updates on click and on scroll so a deep
link to `/uk/account#corpus` lands you straight in the corpus view.

**7 sections**

| #   | Section            | Cards                                     |
| --- | ------------------ | ----------------------------------------- |
| 1   | 👤 Профіль         | Profile                                   |
| 2   | 📚 Бібліотека      | Library stats · Insights · Recent samples |
| 3   | 📊 Активність      | Heatmap+stats · Privacy footnote          |
| 4   | 🛡 Behavior corpus | Corpus list · Confusion matrix            |
| 5   | ⚙ Налаштування     | Theme · Locale · Dialect                  |
| 6   | 🔐 Безпека         | Encryption & Recovery                     |
| 7   | ⚠ Danger zone      | Account actions                           |

**Layout**

- 220px sticky sidebar + 1fr content, gap 24px. Container max-width
  bumped to 1180px so the sidebar doesn't squeeze cards.
- Mobile (≤880px) collapses to a horizontal tab-chip bar at the top —
  scrollable, sticky to nothing, just a navigator. CSS-only switch.
- Each `<section>` gets `scroll-margin-top` so anchor jumps don't
  hide the heading under the sticky sidebar's shadow.

**Scroll-spy**

- IntersectionObserver with `rootMargin: '-20% 0px -70% 0px'` —
  section becomes "active" once its top crosses 20% from viewport
  top. Felt right for a tall cabinet with mid-screen reading focus.
- Click on a sidebar link → preventDefault → smooth-scroll →
  history.replaceState(`#section`). Native anchor would've worked
  for navigation but we want hash + smooth scroll + active update
  in one go.
- Initial hash honored on load (deep-link from share / refresh).

**Restructuring**

- Cards reordered so each section's children are adjacent. Done via
  one-shot Python script that parsed h2 tags and rewrote `<section
class="cab-card">` blocks under `<section id="X" class="cab-section">`
  wrappers. Same script ran across uk/en/ru with locale-specific h2
  lookups — kept verbose translations honest.

**Favicon**

- Bumped `?v=3` → `?v=4` across all HTML shells. Server-side SVG
  was always served correctly; user-side browser cached a stale
  null/404 from earlier build cycles. Cache-bust forces re-fetch.

**Verify**

- Real-browser smoke at 1470×956: sidebar 220px + content 856px,
  cabBody display flips on auth, scroll-spy correctly highlights
  the section in view, click on `#preferences` smooth-scrolls and
  updates URL hash, 0 console errors.

### v0.30.0 — Confusion matrix runner (Chapter B v1, 2026-05-10)

The corpus we shipped in v0.29.0 finally has a consumer. Click "оновити"
in the new cabinet card and Spyglass tells you, on YOUR labelled corpus,
how each of the 12 detection patterns actually performs: precision,
recall, F1, with TP / FP / FN / TN broken out per row.

**Runner — `lib/corpus-matrix.js`**

- `computeCorpusMatrix({BehaviorCorpus, analyzeBehavior}, userId)` —
  reads all corpus rows, parses events, runs `behavior.analyze` on
  each, aggregates per finding-id.
- For each pattern, treats it as a fraud-detector:
  - TP — fired AND entry labelled fraud
  - FP — fired AND entry labelled legitimate
  - FN — didn't fire AND entry labelled fraud
  - TN — didn't fire AND entry labelled legitimate
  - Precision = TP / (TP+FP); Recall = TP / fraud-total; F1 harmonic
- Ambiguous entries excluded from math (counted in totals for
  awareness). Within-entry repeated firings of the same id collapse
  to a single TP/FP — noise rules don't get inflated counts.
- Sort: F1 desc → TP desc → id asc, with nulls (no recall on empty
  fraud cohort, no precision on never-fired) last.
- Pure DI module — no DB / network coupling. Tested standalone
  with stub corpus + stub analyzer.

**Endpoint — `GET /api/behavior/corpus/matrix`**

- Auth-required, per-user. On-demand computed (no caching) — corpora
  are small and `analyze()` is fast.
- Returns `{ totals: {fraud, legitimate, ambiguous, patterns}, patterns: [...] }`.

**Cabinet card — "Confusion matrix · precision / recall"**

- New section under "Behavior corpus" in `/account` (3 locales). One
  row per pattern with id / TP / FP / FN / TN / P / R / F1. Rows
  colour-graded by precision: ≥90% green, ≥60% amber, <60% red.
- "оновити" / "refresh" button refreshes without full re-init.
- Empty state explains what to capture to fill in. "No pattern fired"
  state catches thin-corpus or mislabelled cases.

**Cabinet dispatcher hardening (bonus fix)**

The `data-action="corpus-delete"` button shipped in v0.29.0 had no
matching handler in `account.js` (it was added to `spyglass.app.js`
but the cabinet doesn't load that). The button looked clickable but
was a no-op on the cabinet page. Fixed in this commit — `account.js`
dispatcher now handles `corpus-delete` and `corpus-matrix-refresh`.

**Tests**

- `tests/corpus-matrix.test.js` — 9 cases: perfect P+R, 50% precision,
  missed-fraud, ambiguous-skip, within-entry dedup, sort tiebreak,
  zero-fraud-no-divbyzero, corrupt-JSON-skip, empty-corpus.
- 431 → 440. All green.

**i18n**

- 7 new strings × 3 locales (matrix headers, empty/no-patterns
  states, summary).

Smoke (Playwright unauthenticated): cabinet renders cabMatrix +
matrixSummary + matrixTable slots; window.refreshMatrix is a
function; endpoint correctly returns 401 to anonymous GET.
0 console errors. Live auth-gated path needs manual verification
(login → save 2-3 fraud + 2-3 legit corpus entries → matrix card
populates).

### v0.29.2 — Lang switch on inspector pages was broken (2026-05-10)

Two-bug stack reported by user: clicking any locale in the language
menu kept the page Ukrainian. Took an extended trace to find both.

**Bug A — handler never bound**

`bindLangLinks()` ran on `DOMContentLoaded`, but the inspector mounts
its template ASYNC (`mountInspector` fetches template and injects
into `#app-root`). At DOMContentLoaded time `.kt-lang-menu-list a`
elements don't exist yet, so the click handler was never attached.
Browser followed the bare `href` directly. Fixed by also binding on
`kt:inspector-ready` (the event the inspector module emits once
template is in DOM) — same pattern share.js already uses.

**Bug B — server bounce, even after handler binds**

Once the handler bound, `switchLang(targetUrl)` did `fetch(targetUrl,
{ credentials: 'same-origin' })` carrying the OLD `kt-lang` cookie.
The server's locale-redirect table 302's `/` → `/uk` for any UK-cookie
user, so the fetch came back with UK content instead of EN. JS then
morphed an already-UK page with UK content — visible result: lang
switch did nothing. Fixed by deriving `newLangFromUrl` from the
target URL and writing the cookie BEFORE the fetch, so the server
reads the new locale and serves the matching file.

**Bug C — even with fresh content, morph aborts**

The fetched HTML carries an EMPTY `#app-root` (server-side template),
while the live DOM has the FULLY-MOUNTED workbench (post-async-mount).
`langMorph` aborts on the resulting child-count mismatch at the top
level, leaving the page in the previous locale. Fixed by detecting
`#app-root.workbench` and falling back to a full `location.assign()`
navigation in that case — the new page boots its own module mount in
the correct locale, no morph game required. Lightweight surfaces
(/about) without `.workbench` continue using the in-place morph.

**Smoke-tested all six transitions**: UK↔EN ✓, UK↔RU ✓, EN↔RU ✓.
0 console errors. Cookie persists across the navigation; on return
visit the user lands in the locale they last picked.

### v0.29.1 — Polish bonus (2026-05-10)

Two small wins after v0.29.0 corpus shipped — done in the same
autonomous run.

**Empty-state hint in the textareas**

- `bidReq` placeholder used to be a single tip line. Now a 7-line
  hint mentions the three fastest paths to start: 🎲 example
  dropdown, 📡 live stream, M (mirror). 3 locales.
- `bidRes` placeholder mentions that pasting both panes unlocks the
  diff view in the mirror modal.

**Mirror result → share permalink**

- New "🔗 share-лінк з парою" button in the mirror modal (next to
  "copy" and "load into other editor"). Click bundles the user's
  source pane + the generated counterpart into a fragment-encoded
  permalink (reuses existing `window.buildShareUrl` from share.js)
  and copies it to clipboard.
- Recipient opens the link, both panes populate, validation auto-
  runs. Useful for "look what spyglass thinks about my RTB" links
  in Telegram / Slack / email.
- 3 locales for the button + 2 toasts.

### v0.29.0 — Behavior corpus capture (Chapter B foundation, 2026-05-10)

First piece of Chapter B (Behavior v2 — real corpus + tuning) from
`docs/next-chapters-2026-05-09.md`. Captures runtime probe event
streams labelled by the user as legitimate / fraud / ambiguous so a
follow-up sprint can run all 12 detection patterns over the corpus
and emit a confusion matrix (precision/recall per id).

**Schema v7**

- New table `behavior_corpus(id, user_id, label, events_json,
source_sample_id, notes, created_at)`. Per-user, FK CASCADE on user
  delete. Label CHECK constrains values to {legitimate, fraud,
  ambiguous}. Indexed on user_id, label, created_at DESC.
- `events_json` capped at 1 MB per row, `notes` at 4 kB. Listing
  query derives `eventCount` via SQLite's `json_array_length` and
  `eventBytes` via `length()` so the cabinet card shows row size
  without sending the full payload.

**API — `/api/behavior/corpus`**

- `POST /api/behavior/corpus { events, label, sourceSampleId?, notes? }`
  — auth-required, validates label whitelist + non-empty events.
- `GET /api/behavior/corpus[?label=...]` — auth-required, returns
  metadata-only listing + label counts (`{ entries, counts }`).
- `GET /api/behavior/corpus/:id` — full row including `events_json`
  for replay (matrix runner consumer in next sprint).
- `DELETE /api/behavior/corpus/:id` — per-user scoped, 404 if not
  yours or not found.

**UI — capture bar on the behavior tab**

- When the behavior tab has events AND the user is signed in, a
  green strip appears at the top: "{N} events in this probe — save
  them as a labelled example…" plus a "💾 save as corpus" button.
- Click → modal with three radios (legitimate / fraud / ambiguous,
  default fraud since that's the most common reason to capture)
  plus a notes textarea. Saves via the new endpoint.

**UI — cabinet card**

- New "Behavior corpus" card in `/account` (3 locales) shows totals
  per label and a list of entries. Each row: label pill (red/green/
  amber), timestamp, event count, optional source sample tag,
  notes, delete button. Empty state explains where to capture from.
- Cabinet `init()` parallel-loads corpus alongside samples /
  partners / insights; new `setCorpus(data)` renderer + delete
  handler in `account.js`.

**Tests**

- `tests/db.test.js` grows 22 → 30: 8 new BehaviorCorpus cases —
  create + list scoping, label whitelist enforcement, empty-events
  rejection, label filter, full-row getById scoping, per-user
  destroy, and FK cascade on user delete. Full suite 423 → 431,
  all green.

**i18n + CSS**

- 23 new strings × 3 locales: bar copy + 4 toasts + modal labels +
  cabinet labels + delete confirm.
- Cabinet inline-style block extended with corpus pills + row grid
  - counts strip.

**Why this lands now**

Chapter B is the recommended next strategic step per
`next-chapters-2026-05-09.md`. v0 ships storage + capture UI

- listing — the consumer (confusion-matrix runner over the corpus)
  is a separate follow-up. Foundation in place means future sprints
  just need to add the runner + display, no schema/UI groundwork.

Smoke-tested via Playwright (unauth path): cabinet `/uk/account`
renders `cabCorpus` DOM + `corpusCounts` + `corpusList` slots;
window-exposed `openCorpusSaveModal`, `confirmCorpusSave`,
`injectCorpusBar` all functions; endpoint correctly returns
`auth_required` 401 to anonymous POST. 0 console errors.
Live auth-gated path needs manual verification — see /account
when signed in.

### v0.28.0 — Finding details panel (2026-05-10)

Every validator finding becomes self-explanatory. Click the chevron
on any finding row, panel expands inline showing path / your value
at that path / severity meaning / spec link. No need to remember
"what does request.at_required mean" or "where exactly is that
field missing in my JSON".

**The expand**

- Each finding row in the validation list is now wrapped in
  `<details class="finding-detail">`. Closed state mimics the prior
  flat row exactly, so the rollout is invisible to anyone who
  doesn't click. Chevron `▾` rotates to `▴` when open.
- Native `<details>` gives free keyboard support (Enter/Space) and
  ARIA semantics; lazy-rendered via a `toggle`-event listener at
  capture so we don't pay the build cost for findings nobody opens.

**The body**

Five rows per finding when expanded:

1. **JSON path** — copy-friendly code chip (`imp[0].banner.w` etc.).
2. **Current value** — extracted from the parsed bidReq/bidRes via
   a path-walker (`getJsonAtPath`), pretty-printed in a fixed-height
   pre. When the field is absent (which is exactly why required-field
   findings fire), shows "Поле відсутнє у вставленому JSON (тому й
   знахідка)" instead of nothing.
3. **Severity** — error / warning / info label + plain-language
   consequence: "Біржі відхилять запит" / "Толерують, але fill
   знизиться" / "Best-practice примітка".
4. **Spec reference** — full spec URL as a prominent link (existed
   only as a tiny "spec ↗" before; now front-and-centre).
5. **Rule id** — the canonical id like `request.at_required` for
   anyone debugging via API or referencing in a bug report.

**Path resolution**

`window.__spyglassLast` now also stashes `req` and `res` (the parsed
inputs) so the detail panel can resolve a finding's path back to the
user's actual value. Path-walker handles dotted keys and array
indices: `seatbid[0].bid[1].price`, `regs.gpp_sid` etc.

**Outside-click closer scope tightened**

The v0.26.1 outside-click handler closed any `details[open]` whose
subtree didn't contain the click target. Would have closed
finding-details too. Scope narrowed to `.kt-example-menu[open],
.kt-lang-menu[open]` — popover-style menus only. Content
disclosures stay open until the user folds them.

**Bonus fix — `analyze stream` ghost label**

Pre-existing tech debt: the `runAnalysis` finally block restored
`analyzeBtn.innerHTML = 'analyze stream'` regardless of locale, so
once a user analyzed something the button was stuck in English on
Ukrainian/Russian pages (and was wrong copy anyway — it's not a
"stream" feature). Now captures the original innerHTML before the
spinner and restores that, plus uses a new
`button.status.analyzing` i18n key for the spinner caption.

**i18n**

- 12 new strings × 3 locales: 5 detail labels (path / value /
  severity / spec / rule_id) + value-missing copy + 3 severity
  meanings + analyzing caption.

Smoke-tested via Playwright MCP: broken request with
`{ banner: { w: 300 } }` produced 8 findings; expanding the
`imp.banner.size_required` finding correctly shows path
`imp[0].banner` and current value `{ "w": 300 }`; analyze button
remains "аналізувати" (uk) after analysis instead of switching to
"analyze stream"; tab title "⚠ 6 errors". 423/423 tests, 0 console
errors.

### v0.27.0 — Live stream UI (2026-05-10)

The SSE endpoint `/api/v1/stream` has been emitting synthetic RTB
specimens at 1-second cadence since the Stream Pivot foundation
shipped, but with no UI to watch it. Now there is one.

**📡 live button + modal**

- New "📡 live" button next to mirror in the inspector header.
  Opens a modal that subscribes to `/api/v1/stream` (EventSource).
- Newest envelopes enter at the top with a fade-in highlight.
  Each row: timestamp · kind chip (REQ / RES / ?) · source filename ·
  optional banner-size hint.
- Capped at 50 rows in the DOM (matches server replay window) so the
  list can run indefinitely without growing.
- Status pulse: connecting / live / paused / connection lost. Green
  dot when actively receiving.

**Pause / resume**

- Toggle button keeps the EventSource open but gates DOM appends.
  Avoids reconnect lag when the user wants to read what's currently
  on screen without losing the stream.

**Click-to-load**

- Click any row → loads that specimen into bidReq (or bidRes if
  it's a response shape) and closes the modal. One click from "I
  saw something interesting in the stream" to "let me analyze it".

**Cleanup hygiene**

- closeModal is patched on open and restored on tearDownLive — any
  close path (Esc, backdrop, button, follow-up modal) closes the
  EventSource and clears the in-memory specimens map. No leaked
  connections after the modal goes away.

**Behind the scenes — attribute-safe row payloads**

- First take stuffed JSON-stringified specimens into `data-specimen=
"..."`, but `core/utils.escapeHtml` uses text-node serialisation
  which only escapes `&<>` (not `"`), so the first internal quote
  closed the attribute. Refactored to keep specimens in a `Map<id,
spec>` keyed by row sequence; row carries `data-row-id="N"` and
  the dispatcher resolves the spec from the map. Map is cleared on
  cap-trim and on modal teardown.

**i18n**

- 11 new strings × 3 locales: modal title / status / pause-resume /
  empty-state hint / click-hint / 2 toasts.

Smoke-tested via Playwright MCP: button opens modal, EventSource
hits 'live' status within ~1s, ~21 rows visible after replay window;
pause holds count constant, resume continues; click on a row fills
bidReq with 932-char pretty-printed JSON and closes the modal;
0 console errors.

### v0.26.1 — UX polish from v0.26.0 review (2026-05-10)

Three issues caught on the v0.26.0 walkthrough.

**Fix — mirror modal radio layout**

- Mode-toggle radios were rendering with the radio circle far from
  the text (uppercased + dim + tiny font). Root cause: `.modal-row
label` rule (defined later in `inspector.css`) won source-order over
  `.kt-mirror-modes label` despite same specificity, applying its
  uppercase + 10px + dim styling to my radio wrappers. `.modal-row
input` also added text-field padding to the radio. Fixed by
  prefixing the rule with `.modal-row .kt-mirror-modes label` so
  the chain has higher specificity, and explicit reset on
  `input[type='radio']` (margin/padding/border/bg/width).

**Fix — header dropdowns staying open**

- Native `<details>` doesn't close on outside click — clicking the
  example picker, then bidRes, left the menu hanging until you
  clicked the summary again. Surprising for popover-style menus.
  Added one document-level click handler in `mountInspector` that
  closes any `details[open]` whose subtree doesn't contain the click
  target. Covers the example menu, lang switcher, and any future
  `kt-*-menu` group.

**Fix — collapse-button tooltip clarity**

- The `▾` button next to bidReq / bidRes had a terse "Згорнути /
  розгорнути панель" title that didn't explain _why_ you'd want to.
  Improved to spell out the use case ("звільнити місце, коли
  працюєш тільки з другою стороною") and added `aria-label` for the
  short version. 3 locales.

### v0.26.0 — Mirror++ sprint (2026-05-10)

Compounding the v0.25.0 mirror release into something pedagogical:
the canonical pair stops being a side-toy and becomes a teaching
surface for "your response vs how it should look".

**core@0.16.0 — best-practice mode**

- `mirror(input, { mode: 'best-practice' })` — additive enrichers that
  fill recommended-not-required IAB fields on top of minimal-mode output.
- Response side: per-bid `crid`, `cid`, `cattax` (IAB Taxonomy 3.0),
  `cat`, `lurl`, `nurl`, `ext.dsa` (EU Digital Services Act
  transparency). Top-level `bidid` and seatbid `seat`.
- Request side: `source.ext.schain` (sellers.json + ads.txt
  enforcement, ver 1.0 with one-node placeholder), `regs.coppa`,
  `regs.ext.gdpr`, `user.ext.consent` placeholder, `device.sua`
  (Structured User-Agent for the post-Chrome-UA-freeze world).
- Enrichers are strictly additive — they never overwrite a value
  the minimal pass already set.
- Two new notes (`mirror.note.bestpractice_response_enriched` /
  `..._request_enriched`) explain what the mode added.

**UI — mirror modal mode toggle**

- Radio between "minimal" and "best-practice" inside the modal.
  Switching re-fetches without closing — diff view, notes, and
  output update live.

**UI — diff view (the headline of this release)**

- When both `bidReq` and `bidRes` are filled, the modal now renders a
  third panel: top-level JSON diff between the user's actual
  counterpart and the canonical mirror output. Three change kinds —
  `≠ different`, `+ canonical added`, `− user has, canonical doesn't` —
  colour-coded (orange for yours, green for canonical). Mirror stops
  being a one-way generator and becomes "ось як мало бути, поряд з
  тим, як у тебе".

**UI — tab title status**

- After every analysis, `document.title` reflects the verdict:
  `Spyglass · ⚠ N errors` / `Spyglass · ! N warns` /
  `Spyglass · ✓ clean`. Resets to baseline as soon as the user
  starts editing either textarea (the verdict is stale once you
  type). Solves the "which of my 7 tabs has the broken request"
  problem.

**UI — hotkey `M`**

- Bare `M` (no modifier) opens the mirror modal. Skipped while
  typing into a textarea (so users can type "m" inside JSON
  without hijack) and while another modal is open. New cheat-sheet
  row in 3 locales.

**Tests + i18n**

- `tests/mirror.test.js` grows 16 → 21: 5 best-practice cases.
  Full suite 418 → 423.
- New i18n keys: 15 modal copy strings (mode_label, mode.minimal,
  mode.best_practice, diff_label, diff_legend, diff_no_changes ×3 locales)
  - 2 mirror notes ×3 locales + 1 shortcut row ×3 locales.

Smoke-tested via real browser (Playwright MCP): hotkey M, modal
opening with both editors filled, mode toggle, best-practice DSA +
crid + bidid present, diff rendering 2 changed rows
(cur EUR→USD, seatbid different), tab title flipping to "! 1 warn"
post-analyze, reset on input. 0 console errors.

### v0.25.0 — Mirror generator (2026-05-10)

New public surface that turns the validator inside-out: instead of only
saying "your paste violates rules X, Y, Z", Spyglass can now generate
the _canonical counterpart_ that satisfies every rule. Paste a
BidRequest → get a minimal-valid BidResponse. Paste a BidResponse →
get a BidRequest the response would fit. Self-tested against the
existing `validate()` + `crosscheck()` so the output is guaranteed
clean — if generation can't satisfy a rule, the failure is surfaced
in the result rather than shipped as broken data.

**core@0.15.0 — `mirror()` API**

- `packages/core/mirror.js` — rule-based generator. 2.5/2.6 only in v0;
  3.0 envelope returns an explicit `mirror.note.ortb_30_not_supported`
  refusal instead of a half-baked output (Chapter C / AdCOM territory).
- `index.js` `mirror(input, opts)` wrapper — runs the generator, then
  pipes the output through `validate()` (counterpart shape) and
  `crosscheck(req, res)` (semantic alignment). Returns rolled-up
  counts in `result.selfTest` so callers see the contract was met.
- Per-decision `notes[]` (i18n-neutral id + params, decorated with
  localized `msg` by the wrapper). Every choice — currency inferred
  from request, price set above floor, banner size copied, VAST template
  emitted, native asset back-reference — is explained.

**Generator coverage (request → response)**

- Banner imp → `bid.{w,h,adm}` matching declared size or `format[0]`
- Video / audio imp → VAST 4.0 InLine template with duration capped
  to `video.maxduration`
- Native imp → JSON adm built from declared assets (title/img/data/video
  with matching ids)
- Multi-imp → one bid per imp, all under one seatbid
- Currency inherited from `req.cur[0]`, fallback USD
- `bid.price = bidfloor + 0.10` so crosscheck's above-floor check
  is always green

**Generator coverage (response → request)**

- VAST adm → `imp.video` with protocols `[3, 7]` and MP4
- Native JSON adm → `imp.native` with the same asset ids reversed back
  to request shape
- Banner adm or `bid.{w,h}` → `imp.banner`
- `imp.bidfloor = max(0.01, bid.price * 0.5)` so the synthesized
  request would always accept its own response
- Default site / device / geo / lang to keep envelope rules clean
- No-bid (`{id, nbr}`) → emits a default 300×250 banner imp so the
  output is at least structurally valid

**Server**

- `POST /api/v1/mirror` — accepts `{ input }`, returns the wrapper
  result. Reuses the analyze rate-limiter (60/min/IP).

**UI**

- New "дзеркало ↔ / mirror ↔ / зеркало ↔" button in the inspector
  header next to Analyze. Opens a modal showing direction, self-test
  chip (clean / dirty), the generated JSON in a read-only textarea,
  and the per-decision notes. Two buttons: copy to clipboard, load
  into the empty editor.
- 3-locale i18n (uk/en/ru) for all notes and modal copy.

**Tests**

- `tests/mirror.test.js` — 16 cases covering both directions, banner
  / video / native / no-bid / multi-imp / round-trip. Full suite
  402 → 418.

### v0.24.0 — Final hardening pass (2026-05-09)

Mopping up the last 5 deferred items from earlier audits. None blocking;
collectively close the door on "we know about that bug but haven't
fixed it" notes. Last release of the day.

**Crypto/auth hardening**

- **`/api/auth/setup-encryption` replay protection** — endpoint was
  idempotent (overwrote existing crypto state on every call). An
  authenticated client retrying a partial failure or a hostile session
  could swap the wrapped DEK out from under the legitimate user. Now
  rejects with `409 crypto_already_setup` if state already exists.
  Password rotation correctly stays in the `/reset-password` flow
  which has its own re-wrap path.
- **Recovery key F5-survival** — pre-fix, single accidental refresh
  before clicking "I saved it" lost the key forever (server stores
  only the wrap, not the key). Now mirrored to `sessionStorage`
  (`spyglass_recovery_pending_v1` key) on show, cleared on explicit
  acknowledgment. Boot path checks for a pending key when authed and
  re-shows the modal. Closing the tab still drops it (per-tab
  storage), matching the design intent of "once and only once".

**Behavior tuning**

- **Frozen-thread watchdog threshold raised 3.5s → 6s** — pre-fix,
  legitimate heavy-compute creatives (image processing, wasm decode,
  physics sims) tripped `behavior.malicious.frozen_thread` as
  false-positives. New threshold (~5 missed heartbeats) still catches
  genuine `while(true){}` and similar deadlocks within ~6s, but
  brief blocking from heavy-but-recovering creatives no longer pages.
  Real fraud freezes don't recover — the signal stays.

**Cabinet UX**

- **Locale picker actually switches the page** — pre-fix, picking RU
  in the cabinet wrote cookie + localStorage + POSTed preferences,
  but the cabinet itself stayed in the old language with no UI
  feedback. Now a `location.href` navigation to the localized
  `/account` path triggers a clean reload in the new locale.
  No-op when picked locale matches current.

**History merge atomicity**

- **Per-success removal from `historyStore`** — pre-fix, mid-merge
  tab close left the user re-importing the same entries on next
  visit (no idempotency key on `/api/samples` POST → server-side
  duplicates). Now each successful import is removed from the
  in-memory store + persisted before the next entry starts. A
  tab close at any point bounds the duplicate damage to whatever
  was in flight at that exact moment. Failed entries stay in the
  history for a retry pass.

**Versions**

- App: `v0.23.0 → v0.24.0` (`package.json` 0.23.0 → 0.24.0)
- Core engine: stays `0.14.1`

### v0.23.0 — End-of-day cleanup: QA-A false positive verified, LOW/MEDIUM bundle (2026-05-09)

Final close-of-day. The deferred QA-A "post-register demo breaks
editors + session" was reproduced manually in a real browser and
confirmed FALSE POSITIVE — Playwright artifact, not real bug. Plus
4 deferred LOW/MEDIUM fixes landed in one batch.

**QA-A FALSE POSITIVE — confirmed**

Reproduced the exact journey by hand via Playwright MCP tools (clean
storage → register → recovery key bypass via window.confirm shim →
click 🎲 demo): editors filled with 575 + 1164 chars of JSON, auth
widget stayed authed, 0 console errors. The original QA agent's
"session collapsed" was browser_evaluate / browser_snapshot
interfering with modal handlers between steps. Real browser does
the right thing. Closing as not-a-bug.

**LOW/MEDIUM fixes**

- **Decryption error gives actionable hint** — old generic
  `toast.decrypt_failed` ("decryption failed") replaced with
  `toast.decrypt_failed_with_hint` ("Most likely your session
  expired — sign out and back in to refresh") × 3 locales.
  AES-GCM doesn't tell us tamper vs wrong-key (indistinguishable
  by design), but the actionable hint covers both legitimate
  causes (rotated DEK, stale session DEK) without needing the
  user to know cryptography.
- **History entry validation on load** — old loader trusted any
  array; now per-entry guards (object shape + numeric `ts` +
  string `req`/`res`) so a single corrupted row from manual
  tinkering / incomplete write / schema drift doesn't poison
  the whole list. The `_v1` suffix on the localStorage key
  remains the schema-version marker.
- **History cross-tab sync** — `storage` event listener pulls
  the new value into the in-memory mirror + re-renders the
  sidebar. Pre-fix, tab A's analyses were invisible in tab B
  until F5.
- **Whitespace-only partner name now rejected server-side** —
  `Partners.create()` trims early + throws coded
  `partner_name_required` if blank post-trim. Pre-fix the
  endpoint accepted `"   "` and inserted an empty-string row
  that rendered awkwardly in the picker.

**Verified-not-broken (closing audit findings)**

- **Watchdog 403** (yesterday's alert) — already fixed in v0.21.0
  hot-fix (Basic auth via `CLICKHOUSE_ADMIN_PASSWORD` env from
  vault). Verified n8n now schedules cleanly.

**Closing this audit cycle**

Today we ran 9 audit-agents (3 code-review + 6 deep-dive) + 4
QA-automator agents = ~13 agent passes. Found ~40 issues. Shipped
fixes for ~22 confirmed real bugs across CRITICAL/HIGH. Rejected
~5 false positives after manual verification. ~13 LOW/MEDIUM
deferred to follow-up sprints (each documented with file:line).

The Spyglass codebase is now substantially harder to break in
expected user flows. Next session can focus on FEATURE work
(Chapter A: specimen replay, Chapter B: behavior tuning) rather
than firefighting.

**Versions**

- App: `v0.22.0 → v0.23.0` (`package.json` 0.22.0 → 0.23.0)
- Core engine: stays `0.14.1`

### v0.22.0 — UX papercut bundle: lang switcher path, version pill, heatmap empty (2026-05-09)

Continuing the deferred-bucket cleanup. Three small UX issues that
each have been bothering "real interaction" since they were introduced.
Plus first verification pass against agents' code-only audit findings:
two of them turned out to be false positives (already fixed in earlier
releases) — explicitly confirming closure for the next-session record.

**Fixed**

- **QA-D: lang switcher loses path context** — pre-fix, clicking "UK"
  from `/about` always landed at `/uk/` (locale root) instead of
  `/uk/about`. Same for `/account`. Added `localizePath()` to
  `lang-switch.js` that maps the current pathname into the equivalent
  in another locale; `bindLangLinks()` now refreshes hrefs on each
  bind + the click handler re-resolves at click time so deep
  pushState navigation stays in sync.
- **UX-4: empty `{}` payload showed fake "oRTB 2.5 (?)" pill** — when
  the type detection produces `unknown`, the version-detection still
  defaults to 2.5 with low confidence (its purpose is "best guess for
  near-baseline payloads"). The findings panel rendered both,
  creating the impression "we identified this as 2.5 but somehow
  also unknown_type". Now: version pill suppressed entirely when
  `validation.type === 'unknown'`. The same gate already existed on
  the format-bar version pill — now the findings-panel version pill
  is consistent.
- **UX-7: 30-day heatmap empty state** — pre-fix, a brand-new user
  saw 30 grey squares. Now shows "No activity in the last 30 days
  yet — run an analysis to see your dots fill in" (× 3 locales) when
  `last30 === 0`. Falls back cleanly to the colored grid as soon as
  any analysis lands.

**Verified-not-broken (false-positive findings from earlier audits)**

- UX-2 "crosscheck panel empty when only bidRes pasted" — already
  shows `crosscheck.need_response` message; the `else if (cross)`
  branch handles empty-array case. No change needed.
- UX-3 "format chips overflow without flex-wrap" — `inspector.css:846`
  `.format-summary__chips { display: flex; flex-wrap: wrap; gap: 4px; }`
  has been there from the start. No change needed.
- UX-5 "Cabinet has no loading state" — recent samples list HTML
  already contains "Loading…" / "Завантаження…" / "Загрузка…" placeholder
  per locale; replaced once data lands. Works as designed.

**Deferred (still need real-browser triage)**

- QA-A (CRITICAL) — post-register demo button doesn't fill editors +
  auth widget collapses to anon. Code analysis didn't reveal a clear
  cause. Likely Playwright artifact (browser_evaluate dismissed
  modals) or a real race we can't see without dev-tools console
  logs. Will need a manual repro session.

**Versions**

- App: `v0.21.0 → v0.22.0` (`package.json` 0.21.0 → 0.22.0)
- Core engine: stays `0.14.1` (no `packages/core/` changes)

### v0.21.0 — Live-user QA bundle: cabinet crash + partners entry point (2026-05-09)

Spawned 4 Playwright-based QA-automator agents to walk real user
journeys end-to-end. All 4 returned with FAILs — confirming that
static audits miss what only emerges from real interaction. This
release ships fixes for the 2 CRITICAL bugs uncovered (cabinet crash,
hidden partners-CRUD entry). 2 other QA issues deferred (need browser
repro / are cosmetic).

**Plus**: out-of-band, fixed `Daily Digest Watchdog` ClickHouse 403 —
the workflow assumed anon CH access; CH now requires auth. Patched
the n8n workflow to use Basic auth via `CLICKHOUSE_ADMIN_PASSWORD`
env var (already in n8n's vault).

**CRITICAL fixes**

- **Cabinet crash on init** — `account.js:395` was setting
  `$('profLibrary').innerHTML` but the `profLibrary` ID had been removed
  from the HTML in an earlier refactor. `getElementById` returned null,
  the entire `init()` aborted, and Activity / Insights / Recent samples
  cards stayed at "—" placeholders even though `/api/account/insights`
  returned correct data. Removed the dead reference; added a
  `setText()` defensive helper that probes presence before mutating.
  Side-benefit: future ID drift won't kill the whole cabinet.
- **Partners management UI was inaccessible** — `openPartnerModal`
  exists in code; `data-action="open-partners"` handler is wired; but
  no HTML element invokes it anywhere in the inspector or cabinet.
  Comment in spyglass.app.js:4007 reveals it was deliberately removed
  in Phase 9 ("Dialect Builder is the new public-facing entry point,
  replaces the Kadam-branded partner button"). But partners as a
  feature stayed alive (save modal still uses them). Net result: users
  could only manage partners by saving a sample first (chicken-and-egg
  for rename/delete). Now: cabinet's Library card has a "Manage
  partners" button that deep-links to `/?open=partners`. Inspector
  reads the URL param after `bootAuth` and opens the modal.

**Deferred QA findings**

| Severity | Journey                | Issue                                                                                                                              | Status                                                                                                                                                                                                         |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL | A (post-register demo) | Clicking 🎲 example after register doesn't fill editors + auth widget collapses to anon                                            | DEFERRED — couldn't reproduce in static audit; needs interactive browser tracing. May be Playwright artifact (browser_evaluate dismissed modals); may be real race. Re-test in next session with manual repro. |
| HIGH     | D (locale switching)   | Lang switcher href always points to language root (`/uk/`, `/ru/`) — clicking from `/about` lands at `/uk/` instead of `/uk/about` | DEFERRED — lang-switch.js hrefs are static; needs per-page rewriting based on current pathname. ~30 min fix; not blocking.                                                                                     |

**Watchdog hot-fix**

- `Daily Digest Watchdog` n8n workflow patched: CH probe now uses Basic
  auth (user from `CLICKHOUSE_ADMIN_USER`, password from
  `CLICKHOUSE_ADMIN_PASSWORD`, both in vault).
- Backup: `database.sqlite.bak-watchdog-auth-20260509-203743`.
- Will fire correctly on next 23:00 Kyiv schedule.

**Versions**

- App: `v0.20.0 → v0.21.0` (`package.json` 0.20.0 → 0.21.0)
- Core engine: stays `0.14.1` (no `packages/core/` changes)

### v0.20.0 — Six-agent bug-bounty bundle (2026-05-09)

Spawned 6 parallel auditor agents covering: auth/sessions, crypto/KEK,
inspector pipeline, behavior probe, history/share/embed, cabinet/i18n.
Returned ~25 findings; verified each against current code; ship the
3 confirmed-real CRITICAL + 6 HIGH. Remaining MEDIUM/LOW deferred to a
follow-up bundle (none are actively breaking flows).

**3 CRITICAL — confirmed and fixed**

- **Sessions: invalidateUserSessions only cleared in-memory Map, not DB**
  ([auth.js:331](../auth.js)). Pre-fix: password reset would drop active
  sessions until container restart, after which DB rows re-hydrated and
  stolen cookies came back to life. Now writes through to
  `Sessions.destroyForUser(userId)` (added to db.js earlier in v0.18).
- **Pipeline: server 4xx/5xx silently swallowed** in
  `runAnalysis()`. Server returned `{success:false, error:..., code:...}`
  with status 429/400, the client checked `if (j.success)` and fell
  through with no toast, no error indicator — user staring at stale UI
  wondering. Now: explicit `if (!r.ok || j.success === false)` branch
  surfacing the server error via `toast.error_generic` + status dot.
- **Cabinet: status mix percentages summed to 99% or 101%** because
  three Math.round calls compounded rounding error. Bar segments left
  visual gap. Fixed: compute first three normally, force last
  ("other") segment to absorb the delta so total is always 100%.

**6 HIGH — confirmed and fixed**

- **Pipeline: race when user re-clicks Analyze before previous fetch
  returns** — older response could overwrite newer findings.
  Monotonic `_analyzeReqSeq` counter; stale completions drop silently.
- **History: out-of-bounds `_currentHistoryIdx` after QuotaExceeded
  truncate** — truncating `historyStore` to half didn't clamp the
  active-entry pointer. Could render phantom selection. Now clamped.
- **Auth: missing rate limit on `/api/auth/verify-email/request`** —
  logged-in attacker could spam the email endpoint, burning Resend
  quota. New `verifyEmailLimiter` (5 / hour / IP).
- **Auth: missing rate limit on `/api/auth/reset-password/state`** —
  attacker holding reset token could probe the endpoint without limit.
  New `resetStateLimiter` (10 / 15 min / IP).
- **Behavior probe: `<base target="_top">` frame-bust bypass** —
  per-anchor check `closest('a[target=_top]')` ignored the page-level
  base-tag fallback. Probe now resolves target via anchor-attr OR
  first `<base target>`, matching browser precedence. Closes a real
  attack pattern.
- **Behavior endpoint: `/api/analyze-behavior` shared the loose 60/min
  analyze limiter** — attractive surface for fuzzers since it's
  unauthenticated and accepts arbitrary event arrays. New separate
  `behaviorLimiter` (20 / min / IP). Real users — even with 1Hz
  heartbeat from probe + UI debounce — never approach this.

**Findings deferred (Tier-2 + Tier-3, will track separately)**

| Severity | Issue                                                                            | File              | Status                               |
| -------- | -------------------------------------------------------------------------------- | ----------------- | ------------------------------------ |
| MEDIUM   | client-side unlock has no rate-limit (UX self-DoS)                               | spyglass.app.js   | deferred                             |
| MEDIUM   | recovery key shown once — no F5 survival                                         | spyglass.app.js   | deferred (UX nicety)                 |
| MEDIUM   | decryption error doesn't distinguish tamper vs wrong-DEK                         | spyglass.app.js   | deferred                             |
| MEDIUM   | empty `{}` payload version pill says "2.5 (?)" instead of "unknown"              | detect.js         | deferred                             |
| MEDIUM   | crosscheck panel empty when only bidRes pasted (no UX message)                   | spyglass.app.js   | deferred                             |
| MEDIUM   | watchdog false-positive on legitimate CPU-bound creatives                        | creative-probe.js | deferred (rare; tuning needs corpus) |
| MEDIUM   | history merge non-atomic on partial failure                                      | spyglass.app.js   | deferred                             |
| MEDIUM   | cabinet locale picker stores preference but doesn't re-render page               | account.js        | deferred (DOM morph integration)     |
| MEDIUM   | behavior module load race (probe fires before window.SpyglassBehavior installed) | index.html        | deferred (rare; first-render only)   |
| LOW      | format pill overflow with many formats                                           | spyglass.app.js   | deferred (CSS)                       |
| LOW      | sim-price ignores currency mismatch                                              | spyglass.app.js   | deferred                             |
| LOW      | history no schema version                                                        | spyglass.app.js   | deferred (proactive only)            |
| LOW      | history no cross-tab sync                                                        | spyglass.app.js   | deferred                             |
| LOW      | session not pinned to IP/UA                                                      | auth.js           | intentional (mobile UX)              |
| LOW      | setup-encryption replay-able                                                     | server.js         | low risk, auth-gated                 |

**Versions**

- App: `v0.19.0 → v0.20.0` (`package.json` 0.19.0 → 0.20.0)
- Core engine: stays `0.14.1` (no `packages/core/` changes — this
  release is auth/server/UI hardening only)

### v0.19.0 — Audit fix bundle: dialect / partner / sample correctness (2026-05-09)

Three parallel auditor agents combed the inspect / save / partner flows
the user worried about. Found 14 issues across 3 severity tiers; this
release ships the 3 CRITICAL and 5 HIGH fixes. Tier-3 (4 LOW/MEDIUM)
are documented in CHANGELOG below for follow-up.

**CRITICAL — silent-wrong-behavior fixes**

- **#1 dialect not forwarded to crosscheck()** — `server.js:916` was
  calling `crosscheck(req, res, { locale, disabledRules })` without
  `dialect`. The current `packages/core/crosscheck.js` is dialect-
  agnostic so user-visible findings haven't shifted, but the wiring
  was a future-correctness landmine. Added forwarding through
  `crosscheck(req, res, { locale, dialect, disabledRules })` →
  `index.js crosscheck()` → `doCrosscheck(req, res, { dialect })`.
  Future Kadam-specific crosscheck rules now have a clean entry point.
- **#2 `is_encrypted` flag missing from sample list queries** —
  `db.js:209-210 sampleCols` returned `req_len` / `res_len` but never
  derived `is_encrypted` from `req_iv` presence. The cabinet's Recent
  Samples list and "Encrypted" stat tile both showed wrong values
  (every sample read as plain). Now derived as `(req_iv IS NOT NULL)
AS is_encrypted` in the SELECT.
- **#3 Cabinet "Default dialect" / "Default findings locale"
  preferences were dead code** — `account.js` wrote to
  `kt-default-dialect` and `kt-default-findings-locale` keys that
  the main app NEVER read (it reads `spyglass_dialect_v1` and
  `kt-lang`). Cabinet preferences were UI theatre. Re-pointed:
  - locale picker now writes to `kt-lang` + cookie + POSTs
    `/api/auth/preferences` (same path as the lang menu)
  - dialect picker now writes to `spyglass_dialect_v1`

**HIGH — broken UX / fragile correctness**

- **#4 "Save as new" — title now auto-suffixed `(copy)`** when the
  user didn't change the title. Without this, identical title +
  same partner → two visually-identical rows in the library list,
  "where did my new save go?" confusion.
- **#5 partner dropdown pre-fill `===` strict-equality fail** —
  `partnerOptionsHtml(selectedId)` did `p.id === selectedId`. JSON
  serialization could surface `partner_id` as a string, strict-eq
  silently fails, edit modal opened with "no partner" selected
  instead of the assigned one. Now coerces to `Number()`.
- **#6 partner delete now shows sample count in confirm dialog** —
  schema cascades samples → unassigned on partner delete (correct),
  but the confirm dialog never told the user how many would lose
  their partner attribution. New endpoint
  `GET /api/partners/:id/samples-count` + new i18n key
  `confirm.delete_partner_with_count` × 3 locales.
- **#7 race save toast now actionable** — when user picks a partner,
  another tab deletes it, then user submits, server now tags the
  error with `code: 'partner_not_found'` so the client shows
  "The partner you picked was deleted in another tab. Picker
  refreshed — pick again." (new i18n key) AND auto-refreshes
  `_partnerCache` so the dead row is gone from the dropdown.
- **#8 sample create wrapped in transaction** — `Samples.create()`
  did INSERT then a separate `Samples.get()` for the response shape.
  An exception between them would leave a row in DB without the
  client knowing → next save creates a duplicate. Now atomic via
  `db.transaction()`. Same path covers update similarly via the
  existing single-statement UPDATE.

**Audit findings deferred (Tier-3, follow-up bundle)**

- MEDIUM: save modal opens with locked DEK; error only on Submit
  after meta is filled
- MEDIUM: empty `bid_req` + `bid_res` accepted server-side (UI
  blocks but API allows it)
- LOW: empty/whitespace-only partner name accepted post-trim
- LOW: "unassigned" filter has no clear-filter affordance in empty
  state

**Schema**

- No new columns. `db.js:209` SELECT shape changed (added derived
  `is_encrypted`); old clients ignore the new field; new clients
  finally see truth.

**Versions**

- App: `v0.18.0 → v0.19.0` (`package.json` 0.18.0 → 0.19.0)
- Core engine: `0.14.0 → 0.14.1` (PATCH — `index.js crosscheck()`
  - `crosscheck.js` accept dialect param; behavior unchanged today,
    surface evolved for future rules)

### v0.18.0 — Persistent sessions + sticky locale (2026-05-09)

Two UX papercuts closed at once:

1. **Sessions survive container restarts.** Previously every `compose
up --build` wiped the in-memory `sessions` Map and kicked all
   logged-in users out — even though their cookie was still valid for
   30 days. Now sessions are persisted to SQLite with write-through
   semantics; the in-memory Map stays as the hot read path and gets
   hydrated from the table on boot.
2. **Locale preference sticks across devices.** Picking UK / RU from
   the language menu now (a) sets a cookie that the server reads to
   redirect bare URLs (`/`, `/about`, `/account`) to the localized
   variant, and (b) when logged in, persists to a new
   `users.preferred_locale` column so the same account on a different
   device lands in the right language without re-picking.

**Schema migration v5 → v6**

```
CREATE TABLE sessions (
  token PRIMARY KEY, user_id (FK CASCADE),
  expires_at, ip, ua, created_at
);
CREATE INDEX idx_sessions_user, idx_sessions_expires.

ALTER TABLE users ADD COLUMN preferred_locale TEXT;
```

**Auth (`auth.js`)**

- `createAuth({ Users, Sessions })` — `Sessions` model now optional
  but enabled in production
- Boot-time hydration: `Sessions.loadActive()` populates the in-memory
  Map. Expired rows pruned in the same pass.
- `createSession()` writes through to DB
- `destroySession()` deletes from DB
- Sweep timer also calls `Sessions.pruneExpired()` hourly
- Test path stays in-memory only (Sessions param undefined → skip DB writes)

**Server (`server.js`)**

- New endpoint `POST /api/auth/preferences { locale }` (auth-only, 401
  for anon). Writes `users.preferred_locale` and mirrors to cookie.
- `publicUser()` now exposes `preferred_locale` so client can sync.
- New helper `setLocaleCookie()` — `Path=/, Max-Age=1y, SameSite=Lax,
not HttpOnly` (JS reads it for fast first-paint decisions).
- New helper `readLocaleCookie()` — reads + validates against the
  `en|uk|ru` allowlist.
- New table `LOCALE_REDIRECT_TABLE` covering only the canonical
  landing routes (`/`, `/about`, `/account`). Deep app paths and
  asset URLs are NEVER redirected.
- `serveStaticFile()` checks the cookie BEFORE `resolveLocaleRoute`
  resolution — bare URL + cookie="uk" → 302 to `/uk/...`. Sets
  `Vary: Cookie` so CDNs cache properly.

**Client**

- `lang-switch.js` — when the user picks a locale, also writes
  `kt-lang` cookie and best-effort POSTs to `/api/auth/preferences`
  (silent on failure for anon)
- `spyglass.app.js bootAuth()` — on `/api/auth/me` returning
  `preferred_locale` that mismatches the URL, soft-redirect via
  `location.replace()` to the equivalent path in the right locale.
  Only fires for the 3 landing routes (`/`, `/about`, `/account`).
  Catches: returning user on a new device, bookmarked bare URL,
  fresh-login redirect.

**Versions**

- App: `v0.17.0 → v0.18.0` (`package.json` 0.17.0 → 0.18.0)
- Core engine: stays `0.14.0` (still no `packages/core/` changes)

### v0.17.0 — Personal cabinet wired (2026-05-09)

The personal cabinet is now LIVE at `/account` (en), `/uk/account`,
`/ru/account`. The drafted-but-not-routed shell from v0.16.0 has been
localized × 3 and the routing uncommented in `server.js`.

**What's new for users**

- Header gets an **"account"** / **"кабінет"** / **"кабинет"** button
  next to "sign out" (visible only when logged in)
- Direct URL access: `https://spyglass.kyivtech.com.ua/account` (or
  `/uk/account`, `/ru/account`)
- Anonymous visitor → soft gate with "Go to Spyglass and sign in" CTA
- Authed user → 7 cards: Profile, Library, Activity (with 30-day
  heatmap), Library Insights, Recent samples, Preferences, Encryption
  & recovery, Privacy footnote, Account actions

**Localization**

- 3 full HTML files (`account.{en,uk,ru}.html`) — section labels,
  table rows, lead text, CTA buttons all per-locale
- 17 new dynamic-string keys in `public/i18n.js` under `cabinet.*`
  namespace × 3 locales = 51 entries
- `public/account.js` uses `t()` for all dynamic strings (pills,
  empty states, status mix percentages, heatmap tooltips)

**Routing**

- `server.js resolveLocaleRoute()`: 6 new entries (3 file routes + 3
  redirects from `/account.html` / `/en/account` shapes)
- The `/about` pattern was the model — same shape applied to `/account`

**Header link**

- Added to all 3 `template.{en,uk,ru}.html` files inside `authUserBlock`
- Visible only when `_currentUser` is set (existing widget gating)
- Order: `[email] [account] [sign out]` — account button between the
  identity badge and the destructive action

**Versions**

- App: `v0.16.0 → v0.17.0` (`package.json` 0.16.0 → 0.17.0)
- Core engine: stays `0.14.0` (still no `packages/core/` changes —
  cabinet is auth/UI shell only)

### v0.16.0 — Per-user analytics + cabinet draft expanded (2026-05-09)

The personal cabinet (still un-wired draft) now has real analytics
backed by a per-user usage log. Schema migrated v4→v5; existing data
unaffected. Cabinet content drafted to operator's spec — review pending
before connecting `/account` routing.

**Schema migration v4 → v5: `analyze_log` table**

```
CREATE TABLE analyze_log (
  id, user_id (FK CASCADE), ts (unix-ms),
  payload_type ('request' | 'response' | 'both'),
  version ('2.5' | '2.6' | '3.0' | null),
  status ('clean' | 'warnings' | 'errors' | 'invalid'),
  format ('banner' | 'video' | 'native' | 'multi' | ...),
  finding_count, error_count, warning_count
);
CREATE INDEX idx_analyze_log_user_ts ON analyze_log(user_id, ts DESC);
```

**METADATA-ONLY by design** — payload bodies never enter this log.
Anonymous calls aren't tracked. CASCADE on user delete = log
auto-cleans. The `cab-card#privacy` section in the cabinet draft
documents this contract verbatim for the user.

**`AnalyzeLog` model in `db.js`**

- `record(entry)` — single insert, ~50-byte row
- `insights(userId)` — aggregator returning total / last7 / last30 /
  byStatus / byVersion / byFormat / activity (30-day daily) /
  first_at / last_at / sums (errors+warnings+findings).
  One round-trip; SQLite handles math on indexed scans even at 100k+
  rows.

**Server: tracking + new endpoint**

- `handleAnalyze` now calls `AnalyzeLog.record()` after each successful
  validate (in a try/catch — tracking failure must never break the
  response). Anonymous → skipped.
- New `/api/account/insights` (GET, auth-required) returns the
  insights aggregate. Anon → 401.

**Personal cabinet draft (still NOT wired to /account routing)**

- New "Activity" card with 4 stat tiles (total / last7 / last30 /
  total findings surfaced)
- First/last analyze dates
- Status mix as colored bar (clean / warn / err) + percentage pills
- oRTB version distribution (compact "2.6·142 / 2.5·38 / 3.0·5")
- Format distribution (same shape)
- 30-day daily heatmap (GitHub-contribution style, 4 levels of intensity)
- Privacy footnote section explicitly listing tracked vs not-tracked
  fields

Library Insights (existing card) reworked to be exclusively
metadata-from-saved-samples (status mix, top partners, date range).

**Versions**

- App: `v0.15.0 → v0.16.0` (`package.json` 0.15.0 → 0.16.0)
- Core engine: stays `0.14.0` (still no `packages/core/` changes —
  this release is auth/cabinet shell only)

### v0.15.0 — i18n debt closure + recovery_configured API (2026-05-09)

Closes the long-standing i18n debt (Chapter D from
`docs/next-chapters-2026-05-09.md`). Personal cabinet shell drafted into
the repo as a parallel deliverable but NOT yet wired to the routing —
intentional: shape and content under review before going live.

**i18n debt — Tier-2 batch (21 user-facing strings)**

After the original Tier-1 cut (131 keys in `public/i18n.js`), the audit
found 21 hardcoded UK strings still inline in `public/spyglass.app.js`:

- 9 toast / error messages (internal*ui_error, uncaught_error, template_inserted*\*, partners_load_failed, samples_load_failed, sample_load_failed, error.generic)
- 5 tooltip strings (peek_no_load, history_delete, partner_edit, delete × 2 sites)
- 3 fallback strings (history_entry, local_request, partner_id)
- 3 inline DOM strings (no_imp_slots, no_iab_categories, status.local already existed)
- crosscheck strings (3): summary, all_passed, need_response

All 21 keys added to `public/i18n.js` × 3 locales (en/uk/ru) = 63 entries.
Inline UK strings replaced with `t()` calls. Backward-compat status mapper
(`Critical`/`Healthy`/etc.) folded onto the same i18n keys as the modern
lowercase set.

After this release, `grep -nE "[А-Яа-яЇїІіЄєҐґ]"` on `spyglass.app.js`
returns only comments — zero user-facing UK leaks.

**Server: `publicEncryption` exposes `recovery_configured` boolean**

`/api/auth/me` now returns `encryption.recovery_configured` (bool —
true if the user set up a recovery key at registration). Drafted for
the personal cabinet to display recovery setup status without a
separate endpoint. Existing fields (`kdf_salt`, `dek_wrapped`,
`dek_iv`) unchanged. No client-side breakage.

**Personal cabinet (`/account`) — DRAFTED, NOT WIRED**

`public/account.en.html` + `public/account.js` exist as a draft for
operator review. Sections: Profile (email + verified + member-since +
encryption + recovery status), Library (counts: samples + partners +
encrypted + assigned-to-partner), Insights (status distribution + top
partners + first/last saved date), Recent samples, Preferences (theme

- findings locale + dialect — localStorage-only), Encryption &
  recovery, Account actions. Routing in `server.js` intentionally
  COMMENTED OUT — the page won't be reachable via `/account` until
  operator approves the content.

**Versions**

- App: `v0.14.0 → v0.15.0` (`package.json` 0.14.0 → 0.15.0)
- Core engine: stays `0.14.0` (no `packages/core/` changes — honest
  divergence from app version when the core spec coverage didn't
  shift; aligned numbers reset on the next core change)

### v0.14.0 — Functional close: full VAST + 3.0 BidResponse + sniffer consolidation (2026-05-09)

Closes the deferred items from v0.11/v0.12/v0.13 — the validator now has
production-grade VAST coverage and full oRTB 3.0 routing (request +
response). Three concerns folded into one MINOR bump because each is
small in isolation but they share a coherent theme: "no more half-done
features".

**4 additional VAST rules** (`packages/core/rules-vast.js`) — now 12 total:

| Rule id                            | Level | Fires when                                                 |
| ---------------------------------- | ----- | ---------------------------------------------------------- |
| `vast.ad_pod`                      | INFO  | multiple `<Ad>` in one VAST (sequential ads) — count param |
| `vast.linear_duration_missing`     | ERROR | `<Linear>` without `<Duration>` (VAST §3.7)                |
| `vast.vpaid_deprecated`            | WARN  | `apiFramework="VPAID"` (deprecated 4.1, removed 4.2)       |
| `vast.impression_tracking_missing` | WARN  | `<InLine>` without `<Impression>` beacon                   |

**oRTB 3.0 BidResponse routing** (new file `packages/core/rules-response-30.js`)

- 3.0 BidResponse (`{ openrtb: { ver, response: {...} } }`) previously
  fell through to `payload.unknown_type` because `detectType` always
  routed 3.0 envelopes to ORTB_REQUEST.
- `detect.js` now discriminates: envelope with `openrtb.response{}` →
  ORTB_RESPONSE; else → ORTB_REQUEST.
- `index.js` adds version-dispatch on the response side mirroring the
  request side (V_3_0 → `validateResponse30`).
- 16 new structural rules: envelope (`response.30.envelope_required`,
  `ver_required`, `ver_invalid`, `response_required`), response object
  (`id_required`, `seatbid_or_nbr_required`, `no_bid` INFO,
  `seatbid_empty_no_nbr`), per-bid (`seatbid.empty`, `bid.invalid`,
  `bid.id_required`, `bid.item_required` — note 3.0 uses `bid.item`
  instead of 2.x `bid.impid`, `bid.price_required`), plus
  `deep_validation_limited` always-fire INFO.

**Sniffer consolidation**

- `crosscheck.js` line 258 dropped its inline VAST regex; now uses the
  canonical `isVastShape` from `format-detect.js`.
- `public/spyglass.app.js` line 816 regex aligned to the canonical
  `^(<\?xml|<VAST)` shape with a comment pointing at the core helper
  (browser doesn't have direct access to the bundled core helpers
  today; refactor that exposes `window.SpyglassCore` is a separate
  concern, deferred).

**Samples** — 2 new in `samples/`:

- `synthetic-vast-vpaid-deprecated.json` — VAST 3.0 InLine with
  `apiFramework="VPAID"` and Linear without Duration. Fires both new
  rules at once.
- `synthetic-ortb30-clean-response.json` — well-formed 3.0
  BidResponse. Fires only the `deep_validation_limited` INFO.

UI dropdown gets 1 new VAST button + 1 new 3.0 button per locale.

**Tests** — 21 new (full suite: **381 → 402**):

- 9 in `tests/vast.test.js` for the 4 new rules + the renumbered
  "clean fixture" test (now requires `<Duration>`)
- 12 in `tests/ortb30.test.js` for `validateResponse30` + integration

**Versions**

- App: `v0.13.0 → v0.14.0` (`package.json` 0.13.0 → 0.14.0)
- Core engine: `0.13.0 → 0.14.0` (MINOR: 4 new VAST rules, 16 new
  response-side 3.0 rules, sniffer consolidation, breaking `detectType`
  refinement for 3.0 — request vs response now discriminated by
  envelope contents)

### Version normalization (2026-05-09)

Aligned ALL version surfaces to a single truthful number track. Previously:

- core engine published as `0.x` (correct — pre-stable API)
- app `package.json` claimed `1.12.0` (overclaimed stability we don't have)
- public UI showed `v9.12.0` (a historical high-water-mark counter
  detached from anything substantive)

Three numbers, two of them theatre. Reset all three to follow the core
engine's number, which is the only one that's been honest. Today's three
releases v9.10/v9.11/v9.12 are renumbered to v0.11/v0.12/v0.13 — each
matches the core version that shipped with it.

When VAST coverage is full, oRTB 3.0 BidResponse routing exists,
sniffer-consolidation lands, and the Behavior & Anti-Fraud epic
ships, that's a real 1.0.0 with a deliberate ceremony. Until then the
0.x prefix tells the world "API may shift" — which is the truth.

### v0.13.0 — oRTB 3.0 envelope routing (2026-05-09)

Spyglass now routes oRTB 3.0 payloads through 3.0-specific rules instead
of feeding them to the 2.x validator (which produced wholly irrelevant
"imp_required", "no_site_or_app" findings on every 3.0 paste). Closes
roadmap item ④. Scope is **structural** — envelope shape + per-item
shape; deeper AdCOM 1.0 placement validation deferred until production
3.0 traffic shows up to test against.

**12 new rules** (`packages/core/rules-request-30.js`)

Envelope:
| Rule id | Level | Fires when |
|---|---|---|
| `request.30.envelope_required` | ERROR | `payload.openrtb` missing |
| `request.30.ver_required` | ERROR | `openrtb.ver` missing |
| `request.30.ver_invalid` | ERROR | `openrtb.ver` not 3.x |
| `request.30.request_required` | ERROR | `openrtb.request` missing |
| `request.30.id_required` | ERROR | `openrtb.request.id` missing |
| `request.30.item_required` | ERROR | `openrtb.request.item[]` missing/empty |
| `request.30.context_recommended` | WARN | `openrtb.request.context` missing |

Per-item:
| Rule id | Level | Fires when |
|---|---|---|
| `request.30.item.invalid` | ERROR | item entry isn't a plain object |
| `request.30.item.id_required` | ERROR | item without `id` |
| `request.30.item.qty_invalid` | WARN | `qty` present but ≤ 0 |
| `request.30.item.spec_required` | ERROR | item without `spec` |

Always-fire:
| Rule id | Level | Purpose |
|---|---|---|
| `request.30.deep_validation_limited` | INFO | tells the user envelope-only validation is by design; deeper coverage deferred |

**Architecture**

- New file `packages/core/rules-request-30.js` — pure, no deps. Exports
  `validateRequest30(payload, ctx)`.
- `packages/core/index.js` — version dispatch added: when `detectVersion`
  returns `V_3_0`, route to `validateRequest30()` instead of the legacy
  `validateRequest()`. 2.x payloads unchanged.
- `packages/core/detect.js` — both `detectType()` and `detectVersion()`
  loosened: presence of an `openrtb` object (regardless of `ver` validity)
  is enough to classify a payload as 3.0. Catches **broken envelopes**
  (`ver=""`, no `request`) so the user sees 3.0-specific structural
  findings, not generic `payload.unknown_type`.
- `server.js` `handleSample` — auto-detects sample shape (`seatbid` →
  response, `openrtb`/`item[]`/`imp[]` → request). Request-shape samples
  load directly into the request editor, leaving the response editor
  empty. Enables 3.0 demos in the dropdown.

**Samples** (in `samples/`)

- `synthetic-ortb30-clean.json` — well-formed 3.0 envelope with item +
  context. Fires only the `deep_validation_limited` INFO note.
- `synthetic-ortb30-broken-envelope.json` — empty `ver`, missing
  `request.id`, item without `id`/`spec`, `qty=0`. Fires 4-5 ERRORs +
  1 WARN + INFO.

The 🎲 example dropdown gets an "oRTB 3.0" section in all 3 locales.

**Tests** — 24 new in `tests/ortb30.test.js`:

- 5 detection tests (broken envelopes still classify as 3.0)
- 13 unit tests on `validateRequest30()` directly
- 5 integration tests through `validate()` (version dispatch + 2.x
  isolation + i18n + disabledRules)
- 2 sample-file integrity tests

Total suite: **357 → 381**.

**Versions**

- App: `v0.12.0 → v0.13.0` (`package.json` 0.12.0 → 0.13.0; UI fallback strings match)
- Core engine: `0.12.0 → 0.13.0` (MINOR: new public capability — 3.0
  routing — and a behavior change in detection that some downstream
  consumers might notice if they relied on broken 3.0 payloads showing
  up as "unknown_type")

### v0.12.0 — VAST validation, minimal viable (2026-05-09)

Spyglass now validates VAST 2.x / 3.x / 4.x XML inside `bid.adm`. Closes
roadmap item ③ (`docs/validator-roadmap-2026-05-09.md`) at the user-chosen
"minimal" scope: 8 rules covering the breakage every serious SSP rejects on.
Deeper rules (VPAID deprecation, ad-pod info, Linear duration, OMID
viewability) are deferred until real-world traffic justifies them.

**8 new rules** (`packages/core/rules-vast.js`)

| Rule id                           | Level | Fires when                                                                                                               |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `vast.version_missing`            | ERROR | `<VAST>` has no `version` attribute                                                                                      |
| `vast.version_unknown`            | WARN  | `version` is not 2.x / 3.x / 4.x                                                                                         |
| `vast.inline_or_wrapper_required` | ERROR | neither `<InLine>` nor `<Wrapper>` present                                                                               |
| `vast.adsystem_missing`           | ERROR | `<InLine>` without `<AdSystem>`                                                                                          |
| `vast.adtitle_missing`            | ERROR | `<InLine>` without `<AdTitle>`                                                                                           |
| `vast.mediafile_missing`          | ERROR | `<InLine>` without `<MediaFile>`                                                                                         |
| `vast.wrapper_no_tag_uri`         | ERROR | `<Wrapper>` without `<VASTAdTagURI>`                                                                                     |
| `vast.insecure_url`               | WARN  | `http://` URL inside MediaFile / VASTAdTagURI / ClickThrough / ClickTracking / Impression. `count` + `sampleUrl` params. |

**Architecture**

- New file `packages/core/rules-vast.js` — pure regex-based scanner, zero deps.
  Exports `validateVast(adm, path)` and `isVastShape(adm)`.
- `packages/core/format-detect.js` now exports `isVastShape` + `detectVastVersion`
  helpers that `rules-vast.js` consumes. Previously the codebase had three near-
  duplicate VAST sniffers (this file, `crosscheck.js`, `public/spyglass.app.js`);
  the new helpers are the canonical pair. `crosscheck.js` and the UI keep their
  inline regexes for now to avoid an unrelated refactor; `docs/ARCHMAP.md`
  flags both for future consolidation.
- `packages/core/rules-response.js` integrates VAST rules into the per-bid
  loop, alongside the existing `behavior.static.*` scan. Triggers ONLY when
  `isVastShape(adm)` is true, so banner / native HTML adm strings skip it.
- Findings are decorated with `sNum` / `bNum` params and `seatbid[i].bid[j].adm`
  path the same way every other response-bid finding is.

**Samples** (in `samples/`)

- `synthetic-vast-clean-inline.json` — VAST 4.2 InLine, all required tags, https URLs (0 vast.\* findings)
- `synthetic-vast-broken-inline.json` — version + AdSystem + MediaFile all missing (3 ERRORs)
- `synthetic-vast-insecure-wrapper.json` — VAST 3.0 Wrapper with 3 http:// trackers (1 WARN, count=3)

The 🎲 example dropdown gets a "VAST (video)" section in all 3 locales with
direct buttons for each sample.

**Tests** — 25 new in `tests/vast.test.js`:

- 8 sniff tests (`isVastShape`, `detectVastVersion`)
- 11 unit tests on `validateVast()` directly
- 4 integration tests through `validate()` (the rules-response wiring)
- 3 sample-file integrity tests (the demo dropdown can't silently rot)

Total suite: **332 → 357**.

**Versions**

- App: `v0.11.0 → v0.12.0` (`package.json` 0.11.0 → 0.12.0)
- Core engine: `0.11.0 → 0.12.0` (MINOR: new public capability)

### Tier 1 hot keyword scan + drop unused `hot_score` column (2026-05-09, portal)

Roadmap item ② from `docs/validator-roadmap-2026-05-09.md`. Lives outside
the Spyglass repo; logged here for cross-stack traceability.

- **Mozok RSS Tick** keyword scan now sees `title + first 800 chars of
content`, not just `title`. The 800-char cap keeps the O(n×k) scan
  bounded; 800 chars covers the lede of nearly every RSS item.
- **`items.hot_score`** column dropped from `news` Postgres DB. Was
  `REAL NOT NULL DEFAULT 0`; production count of non-zero rows = 0.
  Schema doc (`/srv/DATA/Stacks/postgres/init/news_schema.sql`) updated
  so fresh provisioning matches. `hot_score_llm` (Tier 3 LLM-derived
  score 0..1) untouched — that one is in active use.

### v0.11.0 — API stability contract (2026-05-09)

The validator's public output is now deterministic. CI consumers (GitHub
Action, dashboards, third-party integrations) get a stable order, no
duplicate noise, and a way to opt out of specific rules per-call. Closes
roadmap item ① from `docs/validator-roadmap-2026-05-09.md`.

**New public guarantees on `validate()` and `crosscheck()`**

- **Order**: severity DESC → `path` ASC (lex) → `id` ASC. Errors first,
  then warnings, then info. Crosscheck `crit`/`warn`/`ok` levels fold
  into the same scale (`crit` ranks with `error`, `warn` with `warning`,
  `ok` last). Idempotent — re-sorting is a no-op.
- **Dedup**: repeated `(id, path)` pairs collapse into one finding. When
  ≥2 copies were merged, the surviving finding gets a `params.dedupCount`
  integer. The first occurrence wins on level / params / msg.
  Singletons get NO `dedupCount` so i18n templates never accidentally
  render "×1". Uses `dedupCount` (not `count`) to avoid colliding with
  rules that already use `count` for domain meaning (e.g.
  `crosscheck.bid.native_complete`).
- **`disabledRules`** option: `validate(req, { disabledRules: ['imp.*',
'regs.coppa_pii_present'] })`. Filters BEFORE dedup/sort. Accepts exact
  ids or trailing-`*` prefixes. Empty / falsy → no filter.

**Internals**

- New exports from `packages/core/findings.js`: `sortFindings`,
  `dedupFindings`, `applyDisabledRules`. Public via `index.js` (re-export
  not added — these are utilities; the contract is consumed via the
  public `validate()` / `crosscheck()` outputs).
- `POST /api/analyze` now reads `body.opts.disabledRules` (array, max 100
  entries, strings only). Forwarded to both `validate()` and
  `crosscheck()`. Browser callers and CI consumers get the same surface.
- 18 new unit tests in `tests/api-stability.test.js` covering each utility
  in isolation + 4 end-to-end checks via `validate()`.
- Pre-existing test for the renamed `response.seatbid_required` →
  `response.seatbid_or_nbr_required` rule (introduced in v9.9.0) updated
  in the same release.

**Versions**

- App: `v0.10.0 → v0.11.0` (`package.json` 0.10.0 → 0.11.0)
- Core engine: `0.10.0 → 0.11.0` (MINOR: new option + new contract guarantees)

### v9.9.0 — Validator audit follow-up (2026-05-09)

Sweeping the deep-audit findings: 5 P1 bugs in the auction-summary +
no-bid handling, three modern-privacy rule families (GPP, CCPA, COPPA),
and plumbing the runtime `behavior.static.*` engine into the
validate-response path so a paste-and-go user sees malware findings
without opening the Behavior tab.

**P1 — fixed bugs**

- `crosscheck.cur_default_usd_mismatch` (new). Response omitting `cur`
  silently fell back to USD per oRTB §3.3, but if the request excluded
  USD (e.g. `cur: ['EUR']`) the validator missed the mismatch.
- `crosscheck.bid.price_invalid` (new). `bid.price = null` was being
  coerced to 0 via `Number(x) || 0`, false-positive passing the floor
  check and polluting auction summary. Now emits CRIT.
- `response.seatbid_or_nbr_required` replaces `response.seatbid_required`.
  Previously a perfectly valid no-bid response (`{ id, nbr }` per
  §3.3.1) emitted ERROR. Now: both missing → ERROR; `nbr` only → INFO
  `response.no_bid` with reason; empty array without `nbr` → ERROR
  `response.seatbid_empty_no_nbr`.
- `regs.gdpr_consent_missing` now reads top-level `regs.gdpr` (oRTB 2.6
  §3.2.3) in addition to legacy `regs.ext.gdpr`.
- `crosscheck` early-returns cleanly on no-bid responses instead of
  emitting `crosscheck.no_response` CRIT.

**New privacy / regulatory rules**

- `regs.gpp_sid_without_string` / `regs.gpp_string_without_sid` — GPP
  signal halves must travel together.
- `regs.us_privacy_invalid` — CCPA `us_privacy` must match
  `[1-9][-YN][-YN][-YN]`.
- `regs.coppa_pii_present` — `regs.coppa=1` with `user.id`/`buyeruid`
  or precise `device.geo.lat/lon` is a COPPA violation. WARN.

**Static adm scan**

- `behavior.static.{obfuscation,miner_signature,xss_marker,high_entropy_blob}`
  now fire from `validateResponse` whenever `bid.adm` is a string.
  Engine code + regex patterns + message catalog already existed; only
  plumbing was missing. A paste-and-go user with `eval(atob('...'))` in
  adm now gets the right verdict on the validate path, no Behavior tab.

**Versions**

- App: `v9.8.2 → v9.9.0` (`package.json` 1.8.8 → 1.9.0)
- Core engine: `0.9.2 → 0.10.0` (MINOR: new rules + new exports)

### v9.8.2 — Pre-freeze hardening (Phase 9b/audit follow-up)

**Final sprint before development freeze.** Closes the two P0 risks
flagged by the 360° pre-freeze audit. Production stays live; only new
feature work pauses.

- **P0.1 — `/api/auth/reset-password` rate-limit**. The mode='rotate'
  branch calls `bcrypt.compare(oldPassword, ...)`; without a per-IP
  cap, a held reset token (15-min TTL) was a brute-force gateway for
  the user's old password. New `resetPasswordLimiter` (5 / 15 min /
  IP) matches the `/forgot-password` tier. Login (10/15min/IP +
  8/15min/email), register (5/hour/IP), and forgot-password
  (5/15min/IP) limiters were already in place — audit had missed
  them; this sprint closes the actual gap.
- **P0.2 — Behavior events ring buffer**. `__spyglassBehavior.events`
  was an unbounded array; a misbehaving creative pumping events at
  100s/sec could grow parent-tab memory linearly until OOM. New
  `pushBehaviorEvent(evt)` helper enforces a 500-event rolling
  window via `splice(0, length - MAX)`. Engine still truncates on
  wire-send; this is purely about parent-tab memory hygiene during
  long monitoring runs.

### Phase 10b — UI Format Badge + LLM Few-Shot Wiring (v9.8.0)

- `/api/analyze` now returns `meta.format = { formats, contexts,
protocols, tags, confidence }` computed as the union of
  `detectFormat(bidReq)` ∪ `detectFormat(bidRes)`.
- Three colour-coded chip families render in the left summary
  sidebar: blue (format), green (context), amber (protocol). Hidden
  while `confidence === 0`.
- Frontend builder pulls the detected format off
  `window.__spyglassLast.meta` and threads it through
  `SpyglassIntel.suggestName(bucket, fields, format)`. The cache
  key now includes format so the same field set under different
  hints resolves to different suggestions.
- Server `/api/intel/suggest-name` calls
  `kb.fewShotForFormat(format, { limit: 2 })` and threads the
  anonymised field-name lists into `intelLlm.suggestName(...,
{ fewShot })`. Prompt builder gained a "Reference examples from
  canonical RTB streams" block when fewShot is non-empty.
- Graceful fallback: unknown / missing format → empty fewShot →
  prompt collapses to original Phase 7c zero-shot form.

### Phase 10 — Knowledge Base + Format Detector (v9.7.0)

- New axis `detectFormat()` alongside `detectType()` /
  `detectVersion()`. Pure-data heuristics, runs in browser AND Node.
  Tags banner / video / audio / native / push / pops / inpage,
  context (web / inapp / ctv / dooh), and protocol family (vast-2/3/4
  / daast). Uses `imp.video.protocols`, `seatbid.bid.mtype`, and
  string-substring VAST sniffing on `bid.adm`.
- `packages/core/knowledge_base/` — curated fixtures organized by
  spec × side × format. Ships 11 hand-synthesized seeds covering
  banner/video/audio/native/inapp/dooh/ctv-rewarded/banner-response
  - push/pops/inpage. `manifest.json` indexes provenance.
    `SOURCES.md` documents the license-clean ingestion playbook for
    Phase 10c automation (Prebid.js, IAB markdown, vendor docs).
- `knowledge-base.js` (Node-only loader) exposes `listSamples`,
  `loadSample`, `fewShotForFormat` with anonymised field-name
  extraction. Path-traversal guard on file reads.
- KB round-trip test: every shipped sample is detected as its
  declared format, or the build breaks. 20 new tests; total 302/302.

### Phase 9 — Generic public branding + responsive ad preview (v9.6.x)

- "Standard IAB (oRTB 2.5)" replaces vendor-namespaced default in
  the dialect dropdown across 3 templates.
- "+ partner" → "+ Custom Dialect" wired to the Phase 7b Dialect
  Builder modal (`data-action="open-builder"`). Partner management
  now reachable only via console (`openPartnerModal()`).
- Ad preview shifted from JS `transform: scale` math to CSS
  `aspect-ratio` + `max-width: 100%` driven by `--bid-w` /
  `--bid-h` custom properties. VAST defaults to 640×360, native
  to 320×260. Empty state collapses to a thin `.preview-empty` strip.

### Phase 9b — Sidebar cleanup, auth trigger, URL sanitization (v9.8.1)

- Sidebar login block removed: the saved-list no longer renders an
  anon-CTA + sign-in button. Header sign-in button is the single
  global auth entry point. Frees ~80px of vertical sidebar real
  estate.
- Summary chrome (winning-bid card + os/geo/device/connection rows
  - section title) collapsed by default; revealed by
    `refreshEmptyStateChrome()` on first paint when the editors carry
    data. `mInfo` gained `hidden` in all three templates.
- Save → Auth toast: when an anonymous user clicks "save", a
  `'toast.signin_to_save'` notification fires before the auth modal
  opens, in 3 locales. Toast is non-blocking.
- URL sanitization for temp dialects: `?dialect=temp:<uuid>` is no
  longer written to the URL. Both `iab` (default) AND any
  `temp:*` value strip the param entirely. Named dialects
  (`kadam`, `kadam-inpage-push`) still serialise. localStorage
  tracks the author's active temp dialect locally.

### Phase 8 — UX/UI overhaul (v9.5.x)

- Visual hierarchy: typography step-down for admin-density
  surfaces; `section-title--sub` modifier for nested sections;
  collapsible cards for bidReq / bidRes editors with summary bars
  showing the bid id when collapsed.
- Safe demo mode: `?demo=safe` blurs creatives via CSS filter and
  masks domain text in the summary, so screenshots and shareable
  links don't leak real-publisher branding from test payloads.
- Clickable JSONPath: validation findings link to the exact AST
  position; clicking scrolls and highlights the corresponding
  textarea selection range.
- Email verification banner + reset-password flow (with
  zero-knowledge wrap rotation in mode='rotate' / mode='recover').

### Phase 7c — Local LLM integration (v9.4.0)

- Self-hosted Ollama bridge (`intel-llm.js`) for two narrow tasks:
  cluster naming + per-field purpose detection. Default model
  `gemma3:4b` (~7 GB on disk, 16 GB RAM headroom on i7-7700-class
  hardware). Acoustic budget validated under stress: ~3 min/day at
  realistic usage tier.
- Hard timeout: 30s `AbortController` keeps a hung Ollama from
  piling up requests. `format: 'json'` constrains gemma3 output to
  parseable JSON.
- Cache: `intel_llm_cache` IndexedDB store keyed by
  `cacheKey(['suggest-name', bucket, format, ...sortedFields])`
  with 30-day TTL — same field set never burns a second LLM call.
- Server endpoints `/api/intel/suggest-name` and
  `/api/intel/field-purpose` rate-limited at 30/min/IP. 503 on
  Ollama-unavailable; frontend latches `_llmUnavailable` and hides
  AI affordances quietly. **No values from the bid stream ever
  enter the prompt — only field paths, char-class hints, and
  bucket names.**
- Docker network: Spyglass attaches to the external `ollama_default`
  network. Configured via `OLLAMA_URL` / `OLLAMA_MODEL` env. See
  [LLM_SETUP.md](./LLM_SETUP.md).

### Phase 7b — Co-occurrence clustering + Dialect Builder (v9.3.0)

- Anchored clustering with `MIN_FIELD_SCORE=5`,
  `MIN_COOCCURRENCE=3`, `MAX_CLUSTER_SIZE=8`. Replaces the naive
  "everything-with-everything" connected-components approach so
  surfaced clusters are real signals, not coincidence.
- Dialect Builder modal: review suggested cluster, pick fields by
  checkbox, name and save. Phase 7c adds a 🤖 Suggest button that
  fills the name from the local LLM (graceful 503 hide).
- Temporary dialect runtime: `applyTempDialect(req, res, dialect)`
  walks logical paths through arrays, emits findings in the engine
  shape, pushes them onto `validation.findings`, and re-rolls
  `validation.status` if any new ERROR appeared.
- IndexedDB schema bump v2 → v3 (additive): adds `co_occurrence`,
  `temporary_dialects`, `intel_llm_cache` stores. Existing v1/v2
  data preserved.

### Phase 7a — Discovery foundation (v9.2.0)

- Browser-local IndexedDB observer (`spyglass_intel_v1`) watching
  `*.ext.*` subtrees on every analyze. Walker capped at depth 4
  with a `PII_TOKENS` denylist (`buyeruid`, `ifa`, `idfa`, `ip`,
  `ipv6`, `consent`, `gpp`, `gpp_sid`, `geo.lat`, `geo.lon`,
  `user.id`, …) plus a regex denylist (`/.*consent.*/i`).
- `field_observations` store keyed by `{bucket}::{path}`. Tracks
  count + first/last seen + decayed score (24h half-life:
  `score(t) = score(t0) * 0.5^((t-t0)/halfLife)`).
- Discovery banner surfaces the first time a previously-unseen
  cluster reaches the threshold; user opts in to the full
  Discovery flow from there.
- Privacy posture documented: **no values from the bid stream are
  persisted, only paths and char-class shapes**.

### Phase 6 — Static payload analysis (creative content)

- `behavior/rules/static.js`: regex pattern banks for obfuscation
  (eval-base64, hex-string concatenation), miner signatures
  (CoinHive, CryptoLoot, Coinimp), XSS markers (`document.write`
  with concatenation, on-handler in attribute), Shannon entropy
  outliers in the adm body. Adm sent to
  `/api/analyze-behavior` is capped at 64 KB on the wire (engine
  truncates internally to 100 KB).

### Phase 5 — Permission abuse detection

- 6 new probe hooks: `Notification.requestPermission`, `navigator.
geolocation.getCurrentPosition` / `watchPosition`,
  `navigator.mediaDevices.getUserMedia`, `Clipboard.writeText`,
  `navigator.bluetooth.requestDevice`, generic
  `Permissions.query`. Engine flags any permission request inside
  an ad iframe as a `behavior.permission.<api>` finding.

### Phase C / synthetic native rendering / button flash

- `renderNativeToHtml(native)` synthesises a stand-alone HTML card
  (sandboxed iframe, all CSS inline) from a `bid.native` object so
  Behavior probes can observe the click as a navigation event —
  previously native preview was DOM-injected into the parent and
  bypassed instrumentation entirely.
- Button feedback: clear / format / copy actions flash a
  text-swap (`'cleared'` / `'formatted'` / `'copied'`) for 1.5s
  to confirm the action without a toast. Defensive against
  re-entry: `_flashTimers` map per-button.

The library moves from "operator can read everything in SQLite" to a **zero-knowledge** model: I (server operator) hold only opaque ciphertext and a per-user wrapped key. Without the user's password I cannot decrypt their `bid_req` / `bid_res` payloads even with full DB access.

#### Architecture

KEK/DEK pattern (industry-standard — same as 1Password, Bitwarden):

- A random 256-bit **DEK** (Data Encryption Key) is generated per user at register time, **in the browser**.
- A **KEK** (Key Encryption Key) is derived from the user's password via PBKDF2-SHA-256 with 600,000 iterations and a per-user 16-byte salt — also in the browser.
- The DEK is wrapped with the KEK using AES-GCM-256 (12-byte IV) and the wrapped blob + salt + IV are persisted to the server.
- A **second wrap** of the same DEK is made with a KEK derived from a recovery key (32 hex chars). The recovery key is shown to the user once at register and never sent to the server again — it's the only way to regain access if the password is lost.
- `bid_req` and `bid_res` blobs are AES-GCM-256 encrypted in the browser with the DEK before each `POST /api/samples`. Per-blob random IVs.
- `title`, `partner_id`, `notes`, `status`, `created_at` stay plaintext — needed for sorting / filtering, low sensitivity.

#### Schema (PRAGMA user_version: 2 → 3)

`users`:

- `kdf_salt` — base64(16 random bytes), per-user, used to derive KEK from password
- `dek_wrapped` — base64 ciphertext: AES-GCM(KEK, DEK)
- `dek_iv` — base64(12-byte IV) for the wrap above
- `recovery_salt` — second salt for the recovery-key KEK
- `recovery_dek_wrapped` — DEK wrapped with recovery-key KEK
- `recovery_dek_iv` — IV for the recovery wrap

`samples`:

- `req_iv`, `res_iv` — per-blob 12-byte IVs (base64). The existing `bid_req`/`bid_res` columns now store AES-GCM ciphertext (base64) instead of plaintext JSON.

Migration v2→v3 wipes existing samples (they were plaintext relics, all empty in production). Existing user accounts are kept — they bootstrap encryption on next login (the password is in hand at that moment to derive the KEK).

#### New module: `public/spyglass-crypto.js`

Pure browser-side wrapper around Web Crypto API. Zero dependencies. Exposes `SpyglassCrypto.bootstrap(password)`, `openWithPassword(password, state)`, `openWithRecoveryKey(hex, state)`, `encryptBlob(dek, plaintext)`, `decryptBlob(dek, iv, ct)`. All operations happen in the browser; the module never sends anything anywhere.

#### Server changes

- `db.js`: schema migration v3, new `Users.getCryptoState(id)` and `Users.setCryptoState(id, state)`. `Samples` create/get/update accept and return `req_iv` / `res_iv` alongside the now-ciphertext `bid_req` / `bid_res`. Server has zero crypto code beyond passing the opaque blobs through.
- `server.js`: new `POST /api/auth/setup-encryption` (auth-required) accepts the 6-field crypto state and persists it. `/api/auth/me` and the login response now include the user's crypto state so the client can derive KEK + unwrap DEK without a second round-trip.

#### UI flow

- **Register** → bootstrap encryption automatically → show recovery-key modal once with copy-to-clipboard.
- **Login** → if encryption state exists, derive KEK + unwrap DEK locally; if not yet set up (existing pre-Phase-7 user), bootstrap immediately (we have the password in hand).
- **Page reload while logged in** → cookie persists session, but in-memory DEK is gone. The library shows a "Розблокуй бібліотеку" CTA → re-enter password modal → unwrap DEK → continue. We deliberately don't store the DEK anywhere persistent — that would defeat the threat model.
- **Save sample** → encrypt `bid_req` + `bid_res` locally with DEK → POST opaque ciphertext + IVs.
- **Load sample** → GET ciphertext + IVs → decrypt locally with DEK → fill textarea.
- **Sign out** → wipe DEK from memory.

#### Tests

- `tests/crypto.test.js` (new, 13 tests) — base64/hex round-trips, KDF determinism, bootstrap → openWithPassword round-trip, recovery-key path, AES-GCM auth (tampered ciphertext rejected), random IV per encrypt, full simulated two-session flow.
- `tests/db.test.js` — still 17 tests, unchanged (Phase 7 partial scoping rules still apply).
- All 96 tests pass.

#### Tradeoffs surfaced to the user

- Forgot password **and** lost recovery key = lost data. Documented in the recovery-key modal copy. There is no operator-side reset that preserves data — by design.
- Title / partner / notes remain server-readable (so the library can render filters and meta lines without unlock). To fully encrypt those too we'd lose server-side filtering; flagged as a possible v0.2 toggle.
- After page reload, the user has to re-enter the password to unlock the library. Cookie session alone isn't enough. Same UX as Bitwarden/1Password.

### Phase 4 — Validator extracted as `@kyivtech/spyglass-core`

The validator engine moves from a sub-directory to a separately-publishable npm package, while the parent app still consumes it through a workspace symlink. This is the structural prerequisite for the public Spyglass demo (browser-side validation) and CI/CLI use cases. Publishing to npm is a separate one-step decision when ready.

- Repo becomes an npm workspace: `validator/` → `packages/core/` with its own `package.json`, `LICENSE` (MIT), and `README.md`.
- Package metadata: `@kyivtech/spyglass-core` v0.1.0, MIT, `engines.node >=18`, `sideEffects: false`, full `files` allow-list (no source leakage).
- Server.js and tests now consume the engine via `require('@kyivtech/spyglass-core')` — same module, resolved through `node_modules/@kyivtech/spyglass-core` symlink to `packages/core/`.
- README in the package documents the public API, dialect contract, version coverage, i18n approach, and design principles — ready for npm landing page.
- Dockerfile updated to copy workspace manifests before `npm install` so the symlink resolves correctly inside the container.
- UI is unaffected: same `/api/analyze` contract, same JSON shape, same bind-mounted hot-reload workflow.
- All 83 tests pass; full CI green; container rebuilt and live-verified at `https://spyglass.kyivtech.com.ua`.

### Phase 7 (partial) — Multi-user accounts

The validator/crosscheck/preview path stays **fully public** (no login needed). Only the saved-samples library and partner taxonomy are gated behind a per-user account. Aligns with the deploy decision: spyglass.kyivtech.com.ua is a public tool with optional accounts for persistent state.

#### Storage

- `db.js` schema bumped to `user_version = 2`. Adds `users(id, email, password_hash, created_at)`. Both `partners` and `samples` get a non-null `user_id` FK with `ON DELETE CASCADE`. Slug uniqueness moves from global to `UNIQUE(user_id, slug)` so two users can each have a partner named "Adsterra".
- Existing v0 data dropped (was test-only — confirmed empty in production).
- Sample creation verifies `partner_id` belongs to the same user — prevents cross-user assignment via crafted POST.

#### Auth (`auth.js`)

- bcrypt password hashing (12 rounds), email/password registration.
- Sessions stored in-process: random 32-byte hex token in `spy_session` cookie (HttpOnly, SameSite=Lax, Secure when behind HTTPS, 30-day Max-Age).
- Constant-time login: bcrypt compare always runs even on missing email, so timing doesn't leak whether an email exists.
- Per-IP rate limits: register 5/hour, login 10/15min.
- Hourly sweeper purges expired sessions.
- Graceful shutdown clears the session map.

#### API

Public (no auth):

- `POST /api/auth/register` `{ email, password }` → creates user + sets session cookie.
- `POST /api/auth/login` `{ email, password }` → sets session cookie.
- `POST /api/auth/logout` → clears session.
- `GET  /api/auth/me` → `{ user: { id, email, created_at } | null }`.

Required to be logged in (returns 401 with uniform error envelope when anonymous):

- `/api/partners[/:id]` — all CRUD ops, scoped per user.
- `/api/samples[/:id]` — all CRUD ops, scoped per user.

`/api/health` now also surfaces `sessions` (active count) and `users` (total registered).

#### UI

- Auth widget in header: "sign in" button when anonymous; user email + "sign out" when logged in.
- Login/register modal with mode-toggle link, password length hint, and Enter-to-submit.
- `Save` button auth-gates: anonymous click prompts the sign-in modal instead of erroring on the API.
- Library panel renders an "Sign in to save" CTA for anonymous users; the partner filter / partner manager only appears when logged in.
- Localized auth errors (`invalid_email`, `weak_password`, `email_taken`, `invalid_credentials`, `rate_limited` → human Ukrainian copy).
- 401 responses on `/api/partners` or `/api/samples` (e.g. session expired during use) trigger silent fallback to anonymous state — no error toast spam.

#### Tests

- `tests/db.test.js` rewritten — 17 tests covering Users CRUD, slug-per-user uniqueness, ON DELETE CASCADE for users → partners + samples, scope enforcement (userB cannot read/update/delete userA's data), partner-of-other-user rejection on sample creation.
- `tests/auth.test.js` new — 11 tests covering register validation, login (correct + wrong + non-existent email with constant-time response), session round-trip, logout invalidation, register/login rate limits.
- All 83 tests pass.

### Phase 2 — IAB-spec authoritative validator (initial)

- `validator/detect.js` extended with `detectVersion(payload)` returning `{ version, confidence, signals }`.
  - Buckets: `'2.5' | '2.6' | '3.0' | 'unknown'` — minor revisions (`2.6-202309`, `2.6-202505`, etc.) deferred.
  - Detection by **field-presence signals** since pasted JSON has no `X-Openrtb-Version` header. 2.6 markers checked first (e.g. `imp[].rwdd`, `device.sua`, `regs.gpp`, `*.cattax`, pod fields), then 2.5 markers (`source`, `bseat`, `imp[].metric`, etc.). 3.0 uses the distinct `item[]` / `openrtb.ver` envelope.
  - Confidence: `1` for definitive markers, `0.7` for 2.5-only signals, `0.3` for default-when-no-markers, `0` for non-objects.
- `validate()` result now carries `result.version` so callers can show the detected version without a second function call.
- Public API: `detectVersion`, `VERSIONS` re-exported from `validator/index.js`.
- UI: validation tab header shows the detected version pill (e.g. "oRTB BidRequest · errors · oRTB 2.6"). Hover reveals the matched signal list. `~`/`?` suffixes mark medium/low confidence.

#### VAST 4.x acceptance

- New `imp.video.protocols_unknown` warning for `video.protocols` codes outside the IAB List 5.8 range (1-14 + `>=500` exchange-specific).
- Codes 10/11/12/13/14 (VAST 4.0 Wrapper, VAST 4.1, VAST 4.1 Wrapper, VAST 4.2, VAST 4.2 Wrapper) accepted without warning — previously the rule had no idea what valid codes were.

### CI / repo hygiene

- GitHub Actions workflow (`.github/workflows/ci.yml`) running `npm run ci` (format:check → lint → typecheck → tests) on every push to `main` and every PR. Concurrency-cancelled per ref so old runs don't keep eating minutes.
- Dependabot config (`.github/dependabot.yml`) with weekly grouped PRs: dev-tools cluster (eslint/prettier/typescript/@types) and runtime cluster (better-sqlite3) updated separately to keep diffs reviewable. GitHub Actions versions bumped on the same cadence.
- CI status badge in README.

### Phase 1 — Foundation refactor

#### Validator core split into modules

- New `validator/` directory replaces the single-file monolith. Pure JS, browser-runnable.
  - `validator/index.js` — public API: `validate()`, `crosscheck()`, `detectType()`, `listDialects()`, `listLocales()`.
  - `validator/helpers.js` — predicates, ISO regexes.
  - `validator/findings.js` — `makeFinding()` factory + level constants (`error`/`warning`/`info`).
  - `validator/detect.js` — payload type detection (Phase 2 will add version detection).
  - `validator/rules-request.js` — IAB BidRequest rules.
  - `validator/rules-response.js` — IAB BidResponse rules.
  - `validator/rules-feed.js` — vendor JSON-feed format (push + clickunder).
  - `validator/crosscheck.js` — semantic req↔res crosscheck + native asset compare.
  - `validator/dialects/iab.js` — base dialect (currently empty hooks).
  - `validator/dialects/kadam.js` — vendor-specific extras (`ext.bsection`, `subage`, macros, push detection).
  - `validator/spec-refs.json` — finding-id → IAB markdown anchor map.
  - `validator/messages/{uk,en}.json` + `index.js` — locale resolver with `{var}` interpolation.

#### Findings model

- Findings now carry **stable `id`** (e.g. `'imp.banner.size_required'`), structured `params` for interpolation, `level` (`error`/`warning`/`info`), `path`, `specRef` (deep link to IAB spec), and `msg` (localized at presentation time).
- Top-level `status` values are now `'clean' | 'warnings' | 'errors' | 'invalid'` (was `'Healthy' | 'Critical' | 'Invalid'`).
- API response payload uses `validation.findings[]` (was `validation.errors[]`).

#### Dialect split — IAB default, vendor overlays opt-in

- Default dialect is now `iab` — payloads validate strictly against the OpenRTB spec without vendor-specific rules.
- `?dialect=<vendor>` query param activates a vendor overlay (push detection, `subage`, `ext.bsection`/`btags`, macro support check).
- Future dialects add via the same overlay pattern.

#### API surface

- `/api/analyze?locale=uk&dialect=iab` accepts both as optional query params.
- Response gained `meta: { locale, dialect }`.

### Resilience sub-tasks (paired with Phase 1)

- **`GET /api/health`** — pings the SQLite DB (`SELECT 1`) and returns `{ status, checks, uptime, pid, node }`. Returns 503 if DB is unreachable.
- **Uniform API error shape** — every 4xx/5xx /api/\* response now follows `{ success: false, error: 'human msg', code: 'machine_id', detail?: any }`.
- **Process safety net** — `uncaughtException` and `unhandledRejection` handlers log and continue rather than letting Node kill the worker.
- **Graceful shutdown** — `SIGINT`/`SIGTERM` close the HTTP server cleanly with a 5s hard-exit fallback.
- **UI error boundary** — global `error` and `unhandledrejection` listeners surface a toast instead of letting one bug freeze the whole page.
- **Spec deep-links in UI** — every validation finding now shows a `spec ↗` link to the relevant IAB markdown section.

### Earlier groundwork (still in Unreleased)

- Architecture document (`ARCHITECTURE.md`) describing target shape: validator core, dialect overlays, public-vs-auth'd surfaces, i18n strategy.
- Roadmap (`ROADMAP.md`) with phased plan from current monolith to OSS-able core + hosted product.
- README with run instructions and layout overview.
- `.env.example` documenting expected runtime variables (placeholder until Phase 7 introduces auth).
- `scripts/backup-db.sh` — daily SQLite online-backup with 30-day rotation. Installed via `/etc/cron.d/spyglass-backup` (03:30 daily).
- Test infrastructure using Node's built-in `node:test` (zero deps).
  - `tests/validator.test.js` — 36 tests covering `detectType`, `validateORTB`, `crosscheck`, `nativeAssetCrosscheck`. Path-based assertions stable across future i18n key refactor.
  - `tests/db.test.js` — 13 tests covering Partners/Samples CRUD, slug uniqueness, ON DELETE SET NULL behavior. Uses tempfs DB.
  - `tests/fixtures.js` — reusable oRTB payload factories.
- ESLint flat config (`eslint.config.js`) tuned for correctness over style; Prettier handles formatting.
- Prettier config (`.prettierrc.json`, `.prettierignore`).
- TypeScript via JSDoc + `checkJs` (`tsconfig.json`) — no source migration, just `tsc --noEmit` catches type bugs in vanilla JS.
- `.editorconfig` for cross-editor consistency.
- npm scripts: `test`, `test:watch`, `test:coverage`, `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `ci`.
- `engines.node: ">=20"` in `package.json`.

### Changed

- Extracted validator core into `validator.js` (formerly inline in `server.js`). Pure JS, no Node-only APIs — runs in browser too. `server.js` is now a thin HTTP wrapper. (Phase-1 superseded this with `validator/` directory split.)
- `detectType()` now uses structural array markers (`Array.isArray(obj.imp)`) rather than `id`-presence checks, so payloads missing their `id` still dispatch to the right validator and produce actionable findings instead of "unrecognized payload". Adds heuristics for malformed payloads (site/app present → request; id+cur present → response).
- `server.js`: `PORT` is now `process.env.PORT || 3000` to support test fixtures.

### Fixed

- `detectType` for plain JSON-feed push arrays — array shape was previously short-circuited as "unknown" before reaching the array check.
- `detectType` no longer requires `obj.id` to recognize a BidRequest/BidResponse, so the validator's "missing id" finding can actually fire.

## [Pre-0.x] — 2026-04-30 baseline

Initial git import of the v8 monolith. Single-container application:

- Express HTTP server, REST API
- SQLite-backed partner + sample library (`better-sqlite3`)
- Vanilla-JS UI on the kyivtech-portal design system
- Vendor-aware validator (Ukrainian copy, baked-in dialect rules)
- Bind-mounted design-system.css from kyivtech-portal for shared tokens
- Reachable behind kyivtech-portal admin auth at `/spyglass-proxy/`
