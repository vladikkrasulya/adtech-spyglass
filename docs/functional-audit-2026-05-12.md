# Spyglass — Functional Audit (2026-05-12)

> **Source**: DeepSeek v4 Pro via OpenRouter, single 247k-token pass against
> ~22k LOC of source + ROADMAP/README/ARCHMAP/about-pages.
> **Cost**: $0.38, finish=stop, 70 sections.
> **Calibration note**: DS severity is unreliable in this run. Both 🔴 CRITICAL
> findings are mis-rated (one is a known-and-now-addressed tech debt — CSP
> shipped today; the other contains DS's own self-correction "No serious gap;
> probe is thorough"). Trust the substance, not the emoji.
> **Verification**: ~6 sections spot-checked by Claude against source; cited
> file/line references mostly accurate but some hand-wavy ("line ~96-110" style).

---

## Validator engine

### 🟡 HIGH — oRTB 2.5/2.6/3.0 detection + validation

**Should:** Detect OpenRTB version from field‑presence signals (imp.rwdd, device.sua, regs.gpp, …), route to the correct rule set, and surface findings with spec deep‑links. (ROADMAP Phase 2, ARCHMAP §1.3.0)

**Does:** `detect.js` returns `{ version, confidence, signals[] }` using `SIGNALS_2_6` and `SIGNALS_2_5`. In `index.js`, the router dispatches to `validateRequest` / `validateResponse` for 2.x and to `validateRequest30` / `validateResponse30` for 3.0. All findings include `specRef` links. Version‑aware gating is _partially_ implemented — some rules remain spec‑version‑agnostic. ROADMAP notes this as “remaining”. 3.0 validation is structural only; an INFO `deep_validation_limited` is always emitted. (`packages/core/index.js` line ~96‑110, `packages/core/detect.js`, `packages/core/rules-request-30.js`, `packages/core/rules-response-30.js`)

**Gap:** Version‑aware rule gating is still listed as a TODO in ROADMAP. Some oRTB 2.6‑only fields (e.g., `imp.qty`) are accepted without warning on a 2.5 payload, unless the user pins the version via `expectedVersion`. The 3.0 path does not validate AdCOM placement details.

**Recommendation:** Complete the version‑gating map so that every rule declares its applicable versions; enable `strictness` levels (lax/normal/pedantic) as planned in Phase 2.

### ✅ MATCH — Native 1.1/1.2 asset‑id crosscheck

**Should:** Detect Native 1.2 via `eventtrackers[]` in the request, adjust asset‑id matching, and crosscheck request ↔ response for missing/extra assets. (ARCHMAP §1.3)

**Does:** `crosscheck.js` includes `nativeAssetCrosscheck` that parses request JSON for assets and compares with response assets. Detection of Native 1.2 uses the presence of `eventtrackers` to switch expectations, aligning with the documented detection. (`packages/core/crosscheck.js` line ~258‑310)

**Gap:** matches intent

**Recommendation:** —

### ✅ MATCH — VAST 4.x version detection in video.protocols

**Should:** Accept values 10/11/12 without warning; detect VAST shape in adm.

**Does:** `format-detect.js` exports `isVastShape()` and `detectVastVersion()`. `videoProtocolToFamily()` maps protocol codes including 10/11 → `vast-4`. (`packages/core/format-detect.js` line ~80‑95, 130‑134) No warnings are raised for these values.

**Gap:** matches intent

**Recommendation:** —

### 🟢 LOW — Spec‑ref anchors not yet fully live in all finding surfaces

**Should:** Every finding carries a `specRef` link to the exact IAB paragraph; UI surfaces them as “see spec ↗”. (ROADMAP Phase 2, ARCHMAP §1.3)

**Does:** `specRefs.json` maps finding IDs to URLs. `findings.js` and the UI rendering in `spyglass.app.js` include the link when `specRef` is non‑null. However, not all findings have specRef entries yet — some map to placeholder/null. ROADMAP notes this as “live” but a full mapping may not be complete for all rules (the `spec-refs.json` file may have gaps).

**Gap:** Some recent or plugin‑authored rules (e.g., client‑hints, imp-secure) might lack specRefs. The code does not enforce that every finding must have one.

**Recommendation:** Audit all rule definitions to ensure each stable id is present in `specRefs.json`; add a CI check to flag missing entries.

### 🟡 MEDIUM — Format detection (banner/video/audio/native/push/pops/inpage)

**Should:** Classify payload ad format, runtime context (web/inapp/ctv/dooh), and creative protocol (vast‑N/daast). Show colour‑coded chips in the summary panel. (README, ROADMAP Phase 10)

**Does:** `format-detect.js` implements heuristic detection: inspects `imp[].banner/video/audio/native`, `site/app` context, `device.devicetype`, `video.protocols`, response adm shape, and JSON feed keys. Returns `{ formats, contexts, protocols, tags, confidence }`. The UI paints chips in `paintFormatSummary()` in `spyglass.app.js`. (`packages/core/format-detect.js`, `public/spyglass.app.js` line ~1233‑1247)

**Gap:** JSON‑feed detection is intentionally narrow; some vendor shapes (e.g., value-feed vendor’s `clickUrl`) are detected, but not all possible JSON‑feed variants will be tagged. The format‑detection heuristic sometimes yields low confidence or no tag for edge cases.

**Recommendation:** Expand the JSON‑feed signature library as new vendor APIs are documented; consider exposing a “format unknown” chip rather than hiding the entire bar.

### 🟡 MEDIUM — Vendor dialect overlays (ext-rtb vendor, ext-rtb vendor In‑Page Push)

**Should:** Opt‑in vendor‑specific rules layered over IAB baseline via `?dialect=<vendor>`. Dialect modules add extra validation findings and may suppress IAB rules (e.g., payload_missing when bid.ext carries creative). (README, ARCHMAP)

**Does:** Dialects are registered in `DIALECTS` map in `index.js`. `dialects/ext-rtb.js` adds checks for ext-rtb vendor macros and feed‑specific fields; `dialects/inpage-push.js` defines `claimsBid()` to suppress payload_missing when the bid’s ext contains title/image/url. The server resolves `?dialect=` and passes it to `validate`. Temporary client‑side dialects from the Discovery layer are applied via `SpyglassIntel.applyToFindings()`. (`packages/core/index.js` line ~42‑47, `packages/core/dialects/inpage-push.js`, `public/spyglass.app.js` line ~2874‑2888)

**Gap:** The dialect selection via `?dialect=ext-rtb` is stored in localStorage but not mirrored back to the URL for sharing (see later note). The `claimsBid` mechanism is dialect‑specific; not all dialects use it, and adding new dialects requires both a server‑side module and possibly a front‑end <option>.

**Recommendation:** Standardize a dialect descriptor that includes `claimsBid`, `validateRequest`, `validateResponse`, and UX metadata so adding a dialect is a single file.

### 🟡 MEDIUM — Plugin‑style rule modules (client‑hints, imp‑secure)

**Should:** Modular rules can be plugged into the validator engine, each with its own `appliesTo` and optional `applies` gate. (ARCHMAP §1.1)

**Does:** `packages/core/rules/index.js` manages a plugin list; each is loaded and called by `runRulePlugins()`. Plugins like `client‑hints` and `imp‑secure` produce findings that are merged before dedup. (`packages/core/rules/index.js`, `packages/core/rules/client-hints/index.js`, `packages/core/rules/imp-secure/index.js`)

**Gap:** The plugin system is functional but not documented in the public README. Adding a plugin currently requires editing the plugin array, not via a config file.

**Recommendation:** Document the plugin contract (as already in README.md) and consider a configuration‑file or `plugins/` directory that is auto‑scanned.

### 🟢 LOW — Crosscheck request↔response (bid.impid, price vs floor, format match)

**Should:** Semantic checks: impid resolution, price ≥ floor, creative format matches imp slot, bcat/badv enforcement, native asset back‑reference. (ARCHMAP §1.3)

**Does:** `crosscheck.js` implements all of the above. For each bid, it resolves imp by `impid`, compares price, checks `bcat`/`badv`, and runs `nativeAssetCrosscheck` if the request had native. The output uses `CROSS_LEVELS`. (`packages/core/crosscheck.js`)

**Gap:** The crosscheck does not enforce `bid.w`/`h` against `imp.banner.format` beyond the simple size match in native crosscheck. Price comparison uses `Number(bidfloor)`, but floor may be `undefined`; the code handles it by defaulting to 0, which passes `bid.price >= 0` always, potentially missing a real‑world missing‑floor case. However, the validation side already flags missing floor as a warning/error.

**Recommendation:** Enrich crosscheck to warn if `imp.bidfloor` is missing when checking price — the crosscheck could surface that the floor is implicitly 0.

### ✅ MATCH — Mirror generator: canonical counterpart one‑click

**Should:** Generate minimal‑valid BidResponse from BidRequest (or reverse), self‑test via validate+crosscheck, offer modes “minimal” and “best‑practice”. UI button + diff. (README, ARCHMAP §1.3.2, /about page)

**Does:** `packages/core/mirror.js` implements `mirror(input, {mode})`. It builds a response or request using defaults, copies site/device where possible, adds `best‑practice` enrichers (schain, DSA, etc.). The wrapper in `index.js` runs the generated output through `validate()` and `crosscheck()` and returns `selfTest` counts. HTTP endpoint `POST /api/v1/mirror` exists. The UI lazy‑loads `modules/mirror/index.js`, shows a modal with mode toggle and diff when both panes are populated. (`packages/core/mirror.js`, `packages/core/index.js` line ~? near mirror wrapper, `modules/mirror/handler.js`, `public/modules/mirror/index.js`)

**Gap:** matches intent

**Recommendation:** —

### 🟢 LOW — oRTB 2.5/2.6 detection via signals

**Should:** Detect version from tiered signals and return confidence. (ARCHMAP §3.3)

**Does:** `detect.js` uses two signal lists; any 2.6 signal → confidence 1.0, else if any 2.5 signal → confidence 0.3, else unknown. This is simpler than the “tiered” concept described in ARCHMAP (which suggests confidence levels for individual 2.6‑202211/2.6‑202309). The `detectVersion` output includes `signals` list. (`packages/core/detect.js`)

**Gap:** The detection does not break down minor revisions (2.6‑202211, 2.6‑202309) as ARCHMAP §3.3 envisioned. Confidence is binary (1.0 or 0.3) rather than probabilistic.

**Recommendation:** Enrich with minor‑revision signals when spec changes are documented; currently low priority.

### 🟡 MEDIUM — 3.0 detection and routing

**Should:** Detect 3.0 via `openrtb` envelope, route to dedicated validation, and label that deep AdCOM validation is not done. (ARCHMAP §1.3.0)

**Does:** `detectVersion` returns `V_3_0` if `openrtb` object exists (any shape). `index.js` dispatches to `validateRequest30`/`validateResponse30`. Those files emit structural findings and a final INFO `*.30.deep_validation_limited`. (`packages/core/detect.js` line ~? 3.0 check, `packages/core/index.js` line ~96‑104)

**Gap:** 3.0 detection does not verify that the envelope contains `ver` with a 3.x version; it accepts any object with `openrtb` as 3.0. This could mis‑classify a payload that has `openrtb` for a non‑RTB purpose (unlikely but possible). The `ver` field is validated only inside the request/response rules, not at detection time.

**Recommendation:** Move the `ver` check into detection to reject non‑3.0 `openrtb` payloads as `unknown_type` early, avoiding misleading validation.

### 🟢 LOW — IAB category decoding (Content Taxonomy 1.0)

**Should:** Decode `cat`/`bcat`/`pcat` codes to English labels, surface in a tab. (README)

**Does:** `categories.js` loads `iab-categories.json`, provides `decodeCategory`, `decodeCategories`, and `extractAllCategories`. The UI renders the result via `renderCategories`. (`packages/core/categories.js`, `public/spyglass.app.js` line ~1204‑1240)

**Gap:** Decoding is English‑only; no locale‑specific labels. The “Categories” tab renders codes and labels but does not link back to the IAB taxonomy page.

**Recommendation:** Consider adding i18n support for category labels as future polish, but it’s not a gap for functionality.

### 🟡 MEDIUM — JsonFeed validation (ext-rtb vendor push/clickunder, value-feed vendor, bid-price vendor, bid-redirect vendor)

**Should:** Validate vendor‑specific JSON‑feed shapes (push arrays, clickunder, single‑bid objects). (README, ARCHMAP §1.1)

**Does:** `rules-feed.js` handles ext-rtb vendor push array, ext-rtb vendor clickunder, value-feed vendor, bid-price vendor, bid-redirect vendor. Each vendor has dedicated validation with appropriate field names (e.g., `clickUrl` for value-feed vendor, `bid_price` for bid-price vendor). The validation is triggered when `detectType` returns `VENDOR_FEED` or `JSON_FEED` for arrays/objects. (`packages/core/rules-feed.js`)

**Gap:** The single‑bid object detection relies on vendor‑unique keys (`clickUrl`, `notification_url`, `redirecturl`). If a new vendor overlaps (e.g., both have `bid` and `link` without a unique key), detection may misclassify. Also, the `JSON_FEED` type is returned for an object that doesn’t match any known vendor; currently that results in an empty findings list with type `JSON_FEED`, which may be confusing.

**Recommendation:** Return an INFO finding for unrecognized single‑bid objects, and consider a more robust detection algorithm (e.g., key‑count threshold).

## Inspector UI

### 🔴 CRITICAL — Dispatcher‑based event handling and CSP

**Should:** No inline `onclick`/event handlers in HTML; all actions routed through a central `data‑action` dispatcher, satisfying Content‑Security‑Policy without `unsafe‑inline` for scripts (but currently requires it for inline `<script>` blocks). (server.js CSP comment, ARCHMAP §2)

**Does:** The UI uses a single `click` event listener on `#app-root` with a `switch(action)` that covers all modal triggers, toolbar buttons, tab switches, etc. Inline `<script>` blocks remain (theme init, JSON‑LD, module bootstrap). (`public/spyglass.app.js` line ~5000‑5400). The CSP allows `'unsafe‑inline'` for `script‑src` because of these inline scripts and the srcdoc iframe for ad previews.

**Gap:** The inline `<script>` blocks still exist, violating the desired strict CSP without `'unsafe‑inline'`. The comment in `server.js` acknowledges this as tech debt.

**Recommendation:** Transition the remaining inline scripts to external modules or add nonces per request to remove `'unsafe‑inline'`.

### 🟡 MEDIUM — Tab modal lazy‑loading

**Should:** Modules like mirror, live, simulate, save‑sample, partners, edit‑sample, auth, unlock, recovery, password‑reset loaded lazily via `import()` to keep initial bundle size small. (ARCHMAP)

**Does:** These modules are lazy‑loaded in the dispatcher via `await import(...)`. After first load, they’re cached by the browser. The pattern is consistent. (`public/spyglass.app.js` dispatcher lines for each case)

**Gap:** Some modules (share, embed, shortcuts) are still loaded eagerly as classic scripts because they need to bind early (e.g., keyboard shortcuts). This is reasonable, but the lazy‑loading strategy is incomplete for those; they could be converted with lazy `import()` after DOM ready.

**Recommendation:** Convert share, embed, shortcuts to lazy modules using the same pattern to keep the shell as thin as possible.

### 🟡 MEDIUM — Sidebar persistence and health‑check

**Should:** Sidebar visibility toggles (left summary, right preview) persist to localStorage and survive refreshes. A stale‑preference health‑check reclaims panels for users who accidentally hid them. (ROADMAP / ARCHMAP §? not explicitly, but implemented)

**Does:** Toggle calls `toggleSidebar(side)` which flips a body class and stores in localStorage with a timestamp. `setupSidebarToggles()` on init checks stored preference; if saved > 7 days ago and viewport ≥1280px, it expires the preference and resets to visible. Additionally, if `bidRes` is populated, the right panel is forced visible (override). (`public/spyglass.app.js` line ~4600‑4710)

**Gap:** Works as described. The health‑check might be slightly aggressive on desktops where a user intentionally keeps preview hidden; but the 7‑day window mitigates that.

**Recommendation:** —

### 🟢 LOW — JSON editor badges (valid/invalid/empty)

**Should:** Live JSON validity badge next to each editor, updating on input. (README)

**Does:** `updateJsonBadge(id)` is called from `updateCharCount` on every input. It sets badge text and class accordingly. (`public/spyglass.app.js` line ~1130‑1140)

**Gap:** matches intent

**Recommendation:** —

### 🟢 LOW — Character count with length warning

**Should:** Show character count below editor, turn red when >50k. (README)

**Does:** `updateCharCount` updates the count span, adds class `warn` if length >50000, and hides it when empty. (`public/spyglass.app.js` line ~1100‑1114)

**Gap:** matches intent

**Recommendation:** —

### 🟢 LOW — Quick stats sidebar (impression counts by type)

**Should:** Show counts of banner/video/native/audio imps in the left sidebar after analysis. (README)

**Does:** `runAnalysis` computes these counts from `imp` array and renders them via `statBox`. (`public/spyglass.app.js` line ~1540‑1550)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Inspector tab badge severity

**Should:** Tab badges reflect the severity of findings (error/warning/clean). (README)

**Does:** `setTabBadge` (in `utils.js`) accepts `severity` and applies appropriate class. The analysis flow calls `setTabBadge` for validation, crosscheck, categories, behavior. (`public/spyglass.app.js` calls to `setTabBadge`)

**Gap:** The “Categories” badge does not show severity colors; it only shows count. The behavior badge severity is determined by the engine, but the fallback in `renderBehaviorTab` uses a simple count. That’s acceptable.

**Recommendation:** No action needed; badge behavior is adequate.

### 🟢 LOW — Collapsible JSON panels (Phase 8)

**Should:** Allow collapsing `bidReq`/`bidRes` panels to show only a summary, with toggle buttons. (ARCHMAP mentioned)

**Does:** CSS class `.is-collapsed` is toggled by `toggle-card` data‑action; the panel shows a summary bar. `paintCardSummary` updates the summary content. (`public/spyglass.app.js` line ~1148‑1160, ~4600)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Finding detail expand (Phase 0.28.0)

**Should:** Each finding is a `<details>` element; on open, show JSON path, current value, severity meaning, spec link, rule id. (ARCHMAP §1.3.4)

**Does:** The UI wraps validation findings in `<details class="finding-detail">`. A `toggle` event listener at capture renders the body via `buildFindingDetailHtml(ds)`, which resolves value using `getJsonAtPath` and shows severity copy. (`public/spyglass.app.js` line ~2100‑2200)

**Gap:** For response‑only analysis, `window.__spyglassLast.res` might be missing and the path resolution may incorrectly fallback to the request side. The code uses `resolveFindingValue` which checks `findingId` prefix; it works but could be more robust. There is no handling for paths that involve array indices beyond a single index (e.g., `imp[1].banner` works, but `imp[0].banner.format[0].w` might not be resolved because `getJsonAtPath` does not handle nested array indices inside the path; only top‑level array brackets like `[0]` are supported). This is a known limitation.

**Recommendation:** Enhance `getJsonAtPath` to support nested array indices (e.g., `a[0].b[1]`), perhaps using a JSONPath library.

### 🟢 LOW — Version pinning selector

**Should:** Allow user to declare which oRTB version they are targeting; validation emits `version.mismatch` if detection differs. (ARCHMAP §3.3.3)

**Does:** A `<select id="versionPinSelector">` is present in the toolbar (likely). The handler on change persists to localStorage and re‑runs analysis. The analyze request includes `opts.expectedVersion`. The core’s `validate` uses that to emit mismatch findings. (`public/spyglass.app.js` line ~2878‑2895)

**Gap:** matches intent

**Recommendation:** —

### 🟢 LOW — Dialect selector in toolbar

**Should:** Dropdown to choose dialect; change persists and re‑runs analysis. (README)

**Does:** `dialectSelector` is populated with built‑in and temporary dialects; change triggers `setActiveDialect` and `runAnalysis`. (`public/spyglass.app.js` line ~2876‑2888)

**Gap:** matches intent

**Recommendation:** —

### ✅ MATCH — Safe‑mode preview (?demo=safe)

**Should:** In safe mode, blur creative previews and mask domains in history for screenshots. (README)

**Does:** In analytics flow, `setAdPreview` always adds blur class initially; user can reveal per creative. History rendering uses `maskDomain()` that masks adult/casino tokens. No special `?demo=safe` parameter is needed because the reveal‑per‑creative approach covers the use case; but there is also a `?demo=safe` mode that could apply to embedding. The CSS for `?.preview-safe:not(.is-revealed)` blurs content. (`public/spyglass.app.js` line ~1313‑1317, `maskDomain` function)

**Gap:** The `?demo=safe` parameter is not explicitly handled in the static file routing; but the current behavior (blur until reveal) already provides screenshot safety. However, the domain masking is only applied in history, not in the summary panel or inspector. The README mentions masking domains in summary panel; that’s not fully implemented.

**Recommendation:** Apply `maskDomain` to the `site.domain` / `app.bundle` displayed in the summary bar when safe mode is active, not just history.

## Behavior tab

### 🔴 CRITICAL — In‑iframe creative probe (event capture)

**Should:** Instrument sandboxed iframe to report navigation attempts, click‑skim, bot patterns, heavy ads, frozen thread, permission abuse. (README, ARCHMAP §1.3)

**Does:** `creative-probe.js` is injected into the iframe srcdoc. It hooks `window.open`, `Location.href`, `addEventListener`, on‑property setters, `click` geometry analysis, `PerformanceObserver`, `requestFullscreen`, geolocation, etc. Events are sent via `postMessage` to parent. The receiver in `spyglass.app.js` validates `event.source`, applies cap, and resets watchdog. (`public/creative-probe.js`, `public/spyglass.app.js` line ~1400‑1450, ~1500‑)

**Gap:** The sandbox does not include `allow-same-origin`; the probe is fetched from the same origin and runs fine. However, some APIs (e.g., `navigator.mediaDevices.getUserMedia`) are allowed in the sandbox? The probe hooks them but the underlying call may be rejected by the sandbox, which is fine. The probe’s coverage of frame‑bust via `<base target=_top>` was added after an audit, so it’s present. The heavy‑ad CPU detection relies on `PerformanceObserver` for `longtask`; that’s not available in Safari or older Chrome, which is acceptable.

**Gap:** No serious gap; probe is thorough.

**Recommendation:** Continue to add missing hooks as per behavior roadmap.

### ✅ MATCH — Behavior analysis engine (server‑side endpoint)

**Should:** Receive probe events, run static and runtime rules, return structured findings with severity. (ARCHMAP §1.3)

**Does:** `packages/core/behavior/` contains the engine (likely imported via `require('@kyivtech/spyglass-core/behavior')`). The endpoint `POST /api/analyze-behavior` accepts `events` and optional `adm`, invokes `analyzeBehavior(capped, {locale, adm})`, and returns findings with severity and localized messages. (`modules/analyze/handler.js` handleAnalyzeBehavior, `packages/core/behavior/index.js` not shown but referenced)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Behavior‑tab UI: findings + timeline

**Should:** Render threats and raw event timeline in the behavior tab, with localized kind labels. Engine fetch debounced. (ARCHMAP §1.3, README)

**Does:** `modules/behavior/index.js` provides `render(container, allEvents, opts)`. It renders timeline immediately, then fetches `/api/analyze-behavior` debounced 150ms and paints findings on success. The UI uses `SpyglassBehavior.render`. (`public/modules/behavior/index.js`)

**Gap:** The finding rendering does not display a `specRef` link, because behavior findings lack specRefs (they are not IAB‑spec related). That’s fine. The `render` function replaces the container’s innerHTML, causing a flash; could be improved with a request‑animation‑frame commit but not a bug.

**Recommendation:** No action needed.

### 🟡 MEDIUM — Behavior‑corpus capture and confusion matrix

**Should:** Allow saving probe event streams with label (legitimate/fraud/ambiguous) into a per‑user corpus; compute confusion matrix displaying precision/recall for each pattern. (ARCHMAP §1.3.5, ROADMAP Phase 7)

**Does:** `modules/corpus/handler.js` provides CRUD for `behavior_corpus` table; the UI `open-corpus-save` modal gathers events and label. `lib/corpus-matrix.js` computes TP/FP/FN/TN per pattern. Both work. Cabinet page shows matrix. (`modules/corpus/handler.js`, `lib/corpus-matrix.js`, `public/account.js`)

**Gap:** The matrix runner is limited to 500 entries (hard limit in `listForUser`). For large corpora, pagination is needed. Also, corpus entries are not linked to `samples` table via `source_sample_id` if the user clears the library sample later; the FK `ON DELETE SET NULL` handles that.

**Recommendation:** Implement pagination for corpus listing and matrix computation when total exceeds 500.

## Authentication + session

### ✅ MATCH — Email/password registration and login

**Should:** Register with email+password, bcrypt hashed, session cookie (HttpOnly, Secure, SameSite=Lax, 30‑day). Rate limits per IP and per email. (ROADMAP Phase 7)

**Does:** `auth.js` implements `register` and `login` with bcrypt, timing‑safe dummy hash for non‑existent users, rate limiting (register: 5/h, login: 10/15min, per‑email 8/15min). Sessions stored in‑memory Map + SQLite. `server.js` uses `auth.createSession` and `destroySession`. (`auth.js`, `server.js` line ~150‑200)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Email verification (optional)

**Should:** Send verification email via Resend, allow re‑send, token expires 7 days. (ROADMAP Phase 8)

**Does:** `authRoutesModule` includes `handleVerifyEmailRequest` and `handleVerifyEmailConfirm`. The token is stateless HMAC. The verify link is `GET /api/auth/verify-email/confirm?token=...`. The user is marked verified. (`modules/auth/handler.js`)

**Gap:** No mechanism to enforce verified email for critical actions (e.g., reset password). That’s a future enhancement.

**Recommendation:** Optionally require verified email for password reset, as per many apps; not critical.

### ✅ MATCH — Forgot password and reset flow (rotate, recover, wipe)

**Should:** Send reset email with 15‑min token; user can reset password with old password (rotate), recovery key (recover), or wipe all data. (ROADMAP Phase 8)

**Does:** `authRoutesModule` implements `forgot-password`, `reset-password/state`, and `reset-password` with three modes. `password-reset` module UI loads lazily. Crypto state is rotated properly, sessions invalidated, and dead‑man‑switch safety ensured with atomic transactions. (`modules/auth/handler.js`, `modules/password-reset/index.js`, `db.js` updatePasswordAndCrypto/wipe)

**Gap:** matches intent, including audit fixes for session invalidation.

**Recommendation:** —

### ✅ MATCH — Persistent sessions (SQLite + in‑memory)

**Should:** Sessions survive server restart via SQLite; loaded into Map on boot, swept periodically. (ROADMAP Phase 8)

**Does:** `auth.js` creates sessions in both Map and DB on login, loads from DB on startup, prunes expired rows. `Sessions` model handles CRUD. (`auth.js` line ~150‑200, `db.js`)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Locale preference persistence

**Should:** Locale preference stored in `kt-lang` cookie and optionally in the server’s `users.preferred_locale` for cross‑device stickiness. (ROADMAP Phase 3)

**Does:** `setLocaleCookie()` in `server.js` sets a 1‑year cookie. The UI `lang-switch.js` writes cookie, localStorage, and POSTs to `/api/auth/preferences` to update the DB when logged in. The server reads cookie for bare‑URL redirect. (`server.js` resolveLocaleRoute), (`public/lang-switch.js`), (`modules/auth/handler.js` handlePreferences)

**Gap:** The `/about` and `/account` pages rely on the cookie but do not read `preferred_locale` from server (they are static). However, bootAuth in `spyglass.app.js` redirects if `user.preferred_locale` differs from URL. This work‑around is OK.

**Recommendation:** Implement server‑side redirection for `/about` and `/account` as well, but not essential.

## Crypto / library

### ✅ MATCH — Zero‑knowledge KEK/DEK encryption for saved samples

**Should:** Encrypt samples client‑side with AES‑GCM using a DEK derived from password via PBKDF2 (600k iterations). Server stores ciphertext, IV, and wrapped DEK (under KEK). Recovery key derived from a separate random 16‑byte key, displayed once. (README, ARCHMAP §1.2, docstring in crypto.js)

**Does:** `public/spyglass-crypto.js` implements the whole KP: `bootstrap`, `openWithPassword`, `openWithRecoveryKey`, `encryptBlob`, `decryptBlob`. `SpyglassSession` facade manages the DEK CryptoKey in memory (closure), persists to sessionStorage for F5 survival. The server stores `kdf_salt`, `dek_wrapped`, `dek_iv`, and recovery equivalents. The recovery key is shown once and never stored on server. (`public/spyglass-crypto.js`, `public/spyglass.app.js` `SpyglassSession`, `db.js` schema)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Recovery key management

**Should:** Recovery key generated at registration, displayed once, used to unwrap DEK when password is forgotten. (README)

**Does:** The key is generated in `bootstrap` and shown in `openRecoveryKeyModalLazy`. It can re‑show if pending in sessionStorage on refresh. The key is never stored on server; only the wrapped DEK under recovery KEY is stored. (`public/modules/recovery/index.js`, `public/spyglass.app.js` `openRecoveryKeyModalLazy`)

**Gap:** If the user loses the recovery key and password, they must wipe data. The UI warning correctly conveys this.

**Recommendation:** Provide a way to download/print the recovery key securely (e.g., QR code) as a future enhancement.

### ✅ MATCH — Encrypt/decrypt on save/load

**Should:** When saving a sample, encrypt both bid_req and bid_res with separate IVs using the DEK; on load, decrypt client‑side. (README)

**Does:** `confirmSave` in `save-sample` module encrypts via `encryptBlob` and sends `{bid_req: ct, req_iv: iv}`. `loadSample` decrypts with `decryptBlob`. (`modules/save-sample/index.js`, `public/spyglass.app.js` `loadSample`)

**Gap:** matches intent

**Recommendation:** —

## Cabinet / account

### ✅ MATCH — Profile and stats on `/account`

**Should:** Show user email, verification status, crypto state, recovery key configured, library stats (total samples, partners, encrypted count). (ROADMAP Phase 7)

**Does:** `public/account.js` fetches `/api/auth/me` and `/api/samples`, `/api/partners`, renders these. (`public/account.js`)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Activity insights (heatmap, usage trends)

**Should:** Display metrics from `AnalyzeLog`: total analyses, 7‑/30‑day counts, status distribution, daily heatmap, version/format distributions. (ROADMAP Phase 8)

**Does:** `AnalyzeLog.insights(userId)` in `db.js` aggregates SQL. `/api/account/insights` returns data. `public/account.js` renders charts. (`db.js` AnalyzeLog, `modules/account/handler.js`, `public/account.js` `setUsage`)

**Gap:** The heatmap uses CSS `cell` with levels; it works. The version/format distributions are shown as text lines, not charts. That’s acceptable.

**Recommendation:** No action.

### ✅ MATCH — Behavior corpus card on account page

**Should:** Show corpus statistics (total, fraud, legitimate, ambiguous) and list of entries with delete, plus confusion matrix. (ARCHMAP §1.3.5)

**Does:** `public/account.js` loads corpus via `loadCorpus()` and matrix via `loadMatrix()`, renders them. Deletion is delegated to `/api/behavior/corpus/:id`. The matrix is color‑coded. (`public/account.js`)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Preferences (theme, locale, default dialect) on account page

**Should:** Allow changing theme (light/dark/auto), locale, and default dialect from the cabinet; these should persist to localStorage and where possible sync to server. (ROADMAP Phase 3)

**Does:** `setupPreferences()` in `public/account.js` wires radio buttons for theme, locale, dialect. Theme uses `kt-theme` key and updates `data-theme`. Locale writes `kt-lang` cookie and POSTs to preferences. Dialect uses `spyglass_dialect_v1`. The pickers reflect current values. (`public/account.js`)

**Gap:** The dialect picker offers only `iab`, `ext-rtb`, `inpage-push`; it does not list temporary dialects, which the main app’s dialect selector does. That’s minor.

**Recommendation:** Unify the dialect pickers across cabinet and inspector; use the same code to populate options.

### 🟢 LOW — Scroll‑spy sidebar in cabinet

**Should:** As user scrolls, highlight the corresponding navigation item in the sticky sidebar. (ROADMAP Phase 8)

**Does:** `bindScrollSpy()` uses `IntersectionObserver` with `rootMargin`, updates `is-active` class and `aria-current`. (`public/account.js`)

**Gap:** matches intent

**Recommendation:** —

### 🟢 LOW — Danger zone (data wipe) placeholder

**Should:** The /account page includes a "danger zone" section for wiping data. (README)

**Does:** The account page templates likely include a “Danger Zone” section with a button that triggers the reset password wipe flow? Actually, the code shows no explicit wipe endpoint other than reset‑password mode='wipe'. The account page could have a link to that flow. In the provided HTML files there's a `#cabDanger` section. It’s present but not implemented in `account.js`. The button might be static HTML with `data-action="..."`. The code doesn't show any handler for that action. Likely a placeholder.

**Gap:** The Danger Zone section exists but not functional. No JavaScript handler to wipe data or confirm.

**Recommendation:** Implement the wipe action using a modal that calls `POST /api/auth/reset-password` with mode='wipe' and user confirmation.

## Live stream + simulate

### ✅ MATCH — Live RTB stream (SSE)

**Should:** Provide a real‑time feed of synthetic specimens via SSE, display newest‑on‑top, pause/resume, click to load into inspector. (ARCHMAP §1.3.3)

**Does:** `modules/stream/handler.js` creates SSE endpoint, uses `SyntheticGenerator` to emit at ~1Hz, replay ring buffer. The UI module `modules/live/index.js` opens an EventSource, renders rows, allows pause, and click dispatches ‘live-load’ that loads the specimen into the editor. (`modules/stream/handler.js`, `modules/live/index.js`)

**Gap:** matches intent

**Recommendation:** —

### ✅ MATCH — Bid simulator (3‑strategy DSP demo via LLM)

**Should:** Simulate aggressive/conservative/quality bids using local Ollama, showing bid/no‑bid, price, reason. Privacy‑safe: only metadata sent. (ROADMAP Phase 7c)

**Does:** `intel-llm.js` `simulateBids` strips request to 8 metadata fields, calls Ollama with three prompts, validates outputs. `modules/simulate/index.js` UI fetches and renders. (`intel-llm.js`, `modules/intel/handler.js`, `modules/simulate/index.js`)

**Gap:** matches intent

**Recommendation:** —

## Mirror

### ✅ MATCH — Mirror generator integration (modal + diff + share)

**Should:** One‑click generation, two modes, diff when both panes filled, copy/share output, load into editor. (README, ARCHMAP §1.3.2)

**Does:** `modules/mirror/index.js` implements all of that. The dispatcher routes “mirror” case to lazy‑load. The diff is computed with `diffJsonForMirror`. Share button builds a permalink using `buildShareUrl`. (`modules/mirror/index.js`)

**Gap:** matches intent

**Recommendation:** —

## Embed

### 🟡 MEDIUM — Embed snippet (?embed=1)

**Should:** Provide an iframe snippet that strips chrome and shows the shared bid with validation results. (README)

**Does:** `modules/embed/index.js` builds an iframe URL with `?embed=1#req=…&res=…`. The CSS hides header/input/sidebar when `data-embed="1"` is on `<html>`. The share module uses deflate+base64url to pack. The code checks `spyglassShareSupported()` before enabling. (`modules/embed/index.js`, `public/spyglass.app.js` embed detection)

**Gap:** The embed mode does not hide the “Behavior tab” or other tabs; it just hides chrome. It still shows tabs and perhaps the footer. Not a critical gap.

**Recommendation:** Ensure all non‑essential UI is stripped when embed=1, perhaps using CSS classes.

## Share

### ✅ MATCH — Deflate+base64url permalink

**Should:** Compress bid req/res into URL hash fragment that never reaches server. Copy to clipboard, open to restore. (README)

**Does:** `modules/share/index.js` uses `CompressionStream('deflate-raw')` and base64url encoding. `buildShareUrl` and `copyShareLink` are wired. `loadFromHash` decodes on startup. (`modules/share/index.js`)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Share link length limit guard

**Should:** Warn if URL > 7000 chars. (ROADMAP Phase 7)

**Does:** `copyShareLink` checks `url.length > URL_BUDGET` (7000) and shows a toast. (`modules/share/index.js`)

**Gap:** The guard is present. If the limit is exceeded, the user can still manually copy via prompt; the link might be truncated by some clients, but the tool warns.

**Recommendation:** —

## Shortcuts

### ✅ MATCH — Keyboard shortcuts (?, Ctrl+Enter, Ctrl+S, M, Esc)

**Should:** ? opens cheat sheet, Ctrl+Enter runs analysis, Ctrl+S saves, M opens mirror, Esc closes modal. (ROADMAP Phase 3)

**Does:** `modules/shortcuts/index.js` binds these keys on `document`, skipping when typing. The cheat sheet modal is rendered. `Ctrl+S` calls `openSaveModal()` which auth‑gates. `M` calls `window.openMirrorModal()`. (`modules/shortcuts/index.js`)

**Gap:** matches intent

**Recommendation:** —

## Export

### ✅ MATCH — Download JSON bundle

**Should:** Package current request/response + validation/crosscheck into a JSON file with a hashed filename, trigger download. (README)

**Does:** `public/export.js` implements `downloadBundle`, constructs bundle, generates filename using SHA‑256 prefix, uses `Blob` + `URL.createObjectURL`. (`public/export.js`)

**Gap:** matches intent

**Recommendation:** —

## Lang switch

### ✅ MATCH — Seamless DOM‑morph language swap (uk/en/ru) + cookie sync

**Should:** Click on language link morphs the page without full reload, keeps analysis state, updates URL, sets cookie, re‑fires analysis. About/account pages share same morph logic. (README, ROADMAP Phase 3)

**Does:** `public/lang-switch.js` intercepts clicks on lang menu, fetches target HTML, morphs body via `langMorph`, updates head metadata, pushes history, dispatches `kt:lang-change` event. Inspector listens on that event and re‑runs analysis, refreshes placeholders. About/account pages also include lang‑switch. (`public/lang-switch.js`, `public/spyglass.app.js` listener)

**Gap:** matches intent

**Recommendation:** —

### 🟢 LOW — Cookie synchronization on lang switch

**Should:** Write `kt-lang` cookie before the fetch so server serves correct locale. (ARCHMAP)

**Does:** `switchLang` sets the cookie before fetching, then updates it post‑morph. Also POSTs to preferences. (`public/lang-switch.js`)

**Gap:** works.

**Recommendation:** —

## Intel (LLM bridge)

### ✅ MATCH — Ollama integration for cluster naming, field purpose, partner inference, bid simulation

**Should:** Server‑side LLM bridge to local Ollama (model qwen2.5:3b). Client cache results 30 days in IndexedDB. Fail‑open: hide AI affordances if unavailable. (ROADMAP Phase 7c)

**Does:** `intel-llm.js` provides `suggestName`, `fieldPurpose`, `suggestPartner`, `simulateBids`. All calls have timeouts, temperature settings, JSON‑only prompt, and response validation. `modules/intel/handler.js` exposes HTTP endpoints. Client modules `modules/intel/index.js` and its sub‑modules (`banner.js`, `builder.js`, `observer.js`) handle caching and UI. Failure sets `_llmUnavailable` latch. (`intel-llm.js`, `modules/intel/handler.js`, `public/modules/intel/index.js`)

**Gap:** The LLM bridge uses `fetch` with `AbortController`, but `intel-llm.js` is Node‑side and `fetch` was added in Node 18; the Dockerfile likely uses a compatible version. The code uses `global.fetch` (native) which is available. That's fine.

**Recommendation:** No issues.

### 🟡 MEDIUM — Intel discovery observer (walk ext fields and cluster)

**Should:** Watch for unknown ext‑fields across multiple analyses, cluster by co‑occurrence, surface in a Dialect Builder. (README Phase 7a‑7b)

**Does:** `observer.js` records field observations into IndexedDB, applies decay, and triggers co‑occurrence recording. `builder.js` provides the Dialect Builder modal that shows clusters and lets user create temporary dialect. Temporary dialect is applied client‑side via `applyTempDialect`. (`public/modules/intel/observer.js`, `public/modules/intel/builder.js`, `public/spyglass.app.js` `SpyglassIntel` facade)

**Gap:** The Discovery walker and cluster detection are in‑browser only; no server‑side aggregation across users (by design for privacy). The observer runs on every analysis; it respects a gate (`validation.status clean/warnings`). The cluster detection algorithm is basic; it may miss weaker signals. That’s acceptable.

**Recommendation:** As more patterns accumulate, refine clustering parameters.

## Admin

### ✅ MATCH — Admin stats endpoint (bearer token)

**Should:** Provide operational stats: uptime, sessions, user/partner/sample counts, recent sample count. Accessible only with `ADMIN_STATS_TOKEN`. (ROADMAP Phase 8)

**Does:** `modules/admin/handler.js` checks `ADMIN_STATS_TOKEN` env var, validates Bearer token, and returns JSON. (`modules/admin/handler.js`)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Admin / partner CRUD (not present)

**Should:** The ROADMAP mentions partners CRUD, but there is no admin‑specific UI for managing partners aside from the per‑user API. The admin endpoint only returns stats. That’s fine; partners are per‑user and not admin.

**Gap:** No additional admin features needed.

**Recommendation:** —

## Proxy

### ✅ MATCH — SSRF‑hardened proxy to allowed hosts

**Should:** Allow authorized users to POST to a small allow‑list of public RTB‑echo services, with SSRF protections. (README)

**Does:** `modules/proxy/handler.js` checks session, validates hostname against hard‑coded `['httpbin.org','postman-echo.com']`, port allowed only 80/443, enforces response size cap (1 MB) and timeout (10s). The allow‑list is strict exact match (prevents subdomain bypass). Response size cap prevents OOM. (`modules/proxy/handler.js`)

**Gap:** matches intent, plus audit fixes (port restriction, response cap).

**Recommendation:** —

## Replay

### ✅ MATCH — Specimen replay endpoint (bulk validation pipeline)

**Should:** Accept array of sample envelopes, run validate + crosscheck + behavior on each, return aggregated results with top findings. Cap 100 samples per call. (ARCHMAP §1.3.7)

**Does:** `modules/replay/handler.js` delegates to `lib/replay.js`. It validates sample array, passes to `replay()`, returns `results` and `summary`. Server‑side cap enforced. (`modules/replay/handler.js`, `lib/replay.js`)

**Gap:** matches intent

**Recommendation:** —

## Server infrastructure

### ✅ MATCH — Asset cache‑busting via content‑hash injection

**Should:** Replace manual `?v=N` with content‑based hashes for JS/CSS imports; handle transitive dependencies. (ARCHMAP §1.2)

**Does:** `server.js` contains `rewriteAssetVersions` that scans HTML and JS for imports and appends `?v=<sha1[0:8]>` computed from file content, with recursion for JS files’ imports. It also handles module‑bundle hash tokens. (`server.js` around line 400‑550)

**Gap:** matches intent

**Recommendation:** —

### ✅ MATCH — Security headers (CSP, X‑Content‑Type, X‑Frame, Referrer, Permissions‑Policy)

**Should:** Apply baseline hardening headers to every response. (server.js)

**Does:** `applyBaselineHeaders` sets them on every response. CSP allows `'unsafe-inline'` as noted. (`server.js` line ~?)

**Gap:** matches plan.

**Recommendation:** —

### ✅ MATCH — Rate limiting on analyze, login, register, etc.

**Should:** Rate‑limit critical endpoints per IP: analyze 60/min, login 10/15min, register 5/hour, behavior‑analyze 20/min, intel 30/min, etc. (server.js)

**Does:** Various `makeLimiter` calls create per‑IP buckets with sweep. `analyzeLimiter` and `behaviorLimiter` are used. Login/register limits are inside `auth.js`. (`server.js` ~line 80‑100, `auth.js`)

**Gap:** matches intent

**Recommendation:** —

### 🟡 MEDIUM — Health endpoint with build SHA

**Should:** Return health status with DB ping and optional build SHA. (ROADMAP Phase 8)

**Does:** `modules/health/handler.js` returns db status; authed users get sessions, users count, uptime, pid, node version. No build SHA or version metadata is included yet, as ROADMAP notes. (`modules/health/handler.js`)

**Gap:** Build SHA is still missing.

**Recommendation:** Inject `BUILD_SHA` environment variable during build and expose in health endpoint.

### 🟢 LOW — Structured logging (Pino) not present

**Should:** Use Pino for structured logs instead of console.log. (ROADMAP Phase 8)

**Does:** Code everywhere uses `console.log`/`error`. No Pino dependency.

**Gap:** Not implemented; lower priority.

**Recommendation:** Introduce Pino when operational needs grow, but not critical for MVP.

### 🟡 MEDIUM — Error tracking (Sentry/GlitchTip) not integrated

**Should:** Uncaught exceptions/rejections should be sent to error tracking service. (ROADMAP Phase 8)

**Does:** `server.js` catches uncaughtException/unhandledRejection and logs + Telegram notifyAdmin. No Sentry. (`server.js`)

**Gap:** Not yet integrated; can be added later.

**Recommendation:** Integrate Sentry or similar when user base grows.

## Persistence (SQLite)

### ✅ MATCH — Schema migrations (v0→v7), auto‑migrate on start

**Should:** Run migrations to latest version, bump `user_version`, all in a transaction. (db.js)

**Does:** `migrate(db, curVersion)` applies step‑by‑step ALTER/CREATE statements. `db.transaction` wraps all migrations and version bump. (`db.js`)

**Gap:** matches intent

**Recommendation:** —

### ✅ MATCH — Sessions table (persistent, loaded on boot)

**Should:** Survive container restarts, loaded into in‑memory Map on boot. (ROADMAP Phase 8)

**Does:** `Sessions.loadActive()` on startup hydrates the map. `auth.js` uses write‑through. Periodically pruned. (`db.js`, `auth.js`)

**Gap:** matches intent

**Recommendation:** —

### ✅ MATCH — AnalyzeLog for per‑user usage tracking

**Should:** Record metadata (version, status, format, finding counts) on every analyze for authenticated users, used for cabinet insights. (ROADMAP Phase 8)

**Does:** `AnalyzeLog.record` called in `handleAnalyze` when user is authed. `insights` aggregates. (`db.js` AnalyzeLog, `modules/analyze/handler.js`)

**Gap:** matches intent

**Recommendation:** —

### ✅ MATCH — Behavior corpus storage (v7 schema)

**Should:** Store labeled event streams per user with FK to `samples`. (ARCHMAP §1.3.5)

**Does:** `BehaviorCorpus` model with validation, constraints, indexes. (`db.js`)

**Gap:** matches intent

**Recommendation:** —

## Email notifications

### ✅ MATCH — Resend integration for verify and reset emails

**Should:** Send transactional emails via Resend HTTPS API; dev‑mode logs to console. (README, email.js)

**Does:** `email.js` implements `postToResend` with timeout, HTML/text templates, dev‑mode short‑circuit when key missing or NODE_ENV!=production. Templates include verify and reset links. (`email.js`)

**Gap:** matches intent

**Recommendation:** —
