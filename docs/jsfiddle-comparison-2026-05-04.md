# Spyglass vs JSFiddle — UX Feature Comparison

**Date:** 2026-05-04
**Subject under inspiration:** [JSFiddle](https://jsfiddle.net/) — code playground, ~15-year-old toolset
**Subject under improvement:** [Spyglass](https://spyglass.kyivtech.com.ua/) — OpenRTB inspector for AdTech engineers
**Frame:** *Which JSFiddle UX patterns, if adopted, would meaningfully improve Spyglass?* The user is **not** building a code playground — Spyglass is a domain-specific oRTB BidRequest/BidResponse inspector. Treat every JSFiddle pattern through the lens of an AdTech engineer pasting a bid stream at 2 a.m. trying to figure out why a creative isn't rendering.

---

## 1. Executive summary

- **Top-3 worth adopting:** (1) **Permalink with content baked in URL** — JSFiddle's `/show/`-style shareable URL is the single most-used social primitive on the entire site, and Spyglass currently has no way for an engineer to send a colleague "look at this weird BidRequest"; (2) **Embed snippet (`<iframe>` / `<script>`) for the Inspector verdict** — would let SSP/DSP docs teams paste a live oRTB sample into release notes, JIRA, Notion; (3) **Editor settings modal collecting auto-run, auto-format-on-paste, font-size, console-on-run, line-wrap** — Spyglass already exposes 4 of these as scattered toggles or hard-coded behaviors; consolidating them into a settings drawer raises perceived polish and makes the keyboard discoverability story coherent.
- **Top-2 already covered:** sandboxed result iframe (Spyglass already uses one with macro substitution), and theme toggle (Spyglass already has light/dark/auto).
- **Do NOT copy from JSFiddle:** the **PRO paywall** model (private fiddles, ad-free, console behind €8/mo) — Spyglass is positioned as zero-knowledge OSS-friendly and a paywall would torpedo trust; also do not copy the **6 different sidebar promo cards stacked on top of the editor** (AI Code Completion, JSFiddle Apps, Carbon Ads, BuySellAds, Changelog widget, Recent Fiddles) — Spyglass's restraint is a feature, not a gap.

---

## 2. Already covered in Spyglass

| JSFiddle feature | Spyglass equivalent | Notes |
|---|---|---|
| HTML/CSS/JS editor panes (3) | BidRequest / BidResponse / Inspector (3) | Spyglass uses 3 panes too; no need to mimic 4 |
| Result preview iframe (sandboxed) | Ad preview iframe with `${AUCTION_PRICE}` substitution + native renderer | Spyglass goes further: macro substitution, native renderer, format detection |
| Theme toggle (light/dark) | Moon-icon toggle, light/dark/auto | Spyglass already has 3-way (auto follows system); JSFiddle only has 2-way |
| Run button | Ctrl+Enter shortcut | Spyglass has the keyboard shortcut; might want a visible "Run" button as an affordance for first-time users (see §3.K1) |
| Console panel (verdict / errors) | Validation tab + Inspector tab + Crosscheck tab + Categories tab + Vendor ref tab | Spyglass has 5 verdict surfaces vs JSFiddle's 1; richer than JSFiddle |
| Format pill / language indicator | Format pill bar (oRTB version, dialect, status) | Spyglass equivalent is more informative |
| Editor with line numbers + syntax | `<textarea>` paste targets + format/clear/copy buttons | Spyglass deliberately avoids a full editor — paste-driven workflow is correct for the domain |
| Boilerplate templates ("Tailwind Checkboxes", "React + JSX") | Sample loader via partner selector + JsonFeed Phase 1 (ExoClick / RichAds / Zeropark / Kadam) | Already adopted; the partner picker IS Spyglass's boilerplate menu |
| Editor in 3-locale / i18n | UK / EN / RU at separate URLs (`/`, `/uk/`, `/ru/`) | JSFiddle has a single English UI with broken `translation missing: en.editor.settings.indent_with_spaces` strings — Spyglass actually does i18n better |
| Public/anonymous use without login | Anonymous use works, no account required | Already the default |
| Authenticated library | Encrypted library (zero-knowledge AES-GCM), KEK/DEK | Spyglass is **stronger** than JSFiddle here — JSFiddle has plaintext server-side storage |
| Fork / save / download menu icons | "Save to library" + clear/format/copy on each pane | Partial parity; Spyglass lacks "Download as JSON" button (see §3.D1) |
| Recently-saved fiddles list | History panel ("History empty — paste a request to get started") | In-memory session history — adequate for anon, library handles persistent |
| GitHub OSS link | Footer "[open source ↗]" → github.com/vladikkrasulya/adtech-spyglass | Both projects link to source |

---

## 3. Worth adopting

### A. Shareable permalink with content baked in URL

**JSFiddle pattern:**
Every fiddle gets a stable URL like `jsfiddle.net/oskar/aba321/23` (user/slug/version). Anyone visiting reproduces the exact code. The URL is the unit of sharing and is by far the most-used JSFiddle primitive — Stack Overflow answers, MDN docs, bug reports all link to fiddles. Forking generates a new fiddle starting at version 0.

**Why it matters for Spyglass users:**
The single most common AdTech debugging conversation is *"Hey, look at this weird BidRequest, the SSP keeps sending us `imp[0].banner.api=[5]` but no `mimes`"* — and right now, the only way to share that with a colleague is to copy-paste the JSON into Slack. A permalink would convert Spyglass into a vocabulary item: "I'll spyglass it". This is the **single highest-leverage adoption** on the list.

**Concrete adaptation:**
- Two-tier strategy:
  - **Tier 1 (no auth):** stateless fragment encoding. URL becomes `spyglass.kyivtech.com.ua/?req=<base64url-deflate(JSON)>&res=<...>`. Hash fragment (`#`) is preferable so the payload never hits the server logs. Fragment never ages, no DB write, zero-knowledge preserved. JSON is typically <8 KB; deflate cuts to ~2 KB; base64url roughly 2.7 KB — well within URL limits for Slack/Discord/email.
  - **Tier 2 (auth):** server-side short-link. Authenticated user clicks "Save & share" → server stores encrypted blob (using user's DEK) → returns `/s/abc123` slug. Same crypto as library, plus a sharing-only DEK or a signed URL with embedded random key. Engineering cost: ~1 day for the slug table + endpoint.
- Add a "Share link" button to the format-pill bar (next to clear/format/copy). Show toast "Link copied — payload is in URL fragment, never hits server".
- Code areas: `public/js/main.js` for the share button, `public/js/share.js` (new), URL parsing on page-load in `app.init()`.

**Effort:** M (Tier 1 alone fits in 3-4 hours).
**Risk:** Low for Tier 1 (pure client-side, no server changes). Medium for Tier 2 (DB schema + endpoint).

---

### B. Embed mode (iframe / script snippet)

**JSFiddle pattern:**
"Embed" action menu builds an `<iframe>` (or `<script>`) snippet. Tab order is encoded in the URL itself: `embedded/result,js,html,css/`. Light/dark theme + accent color are URL params. The script variant auto-resizes height. This powers MDN, Stack Overflow code snippets, blog posts, conference slides.

**Why it matters for Spyglass users:**
SSPs and DSPs publish integration docs constantly. "Here is what a valid Native 1.2 BidResponse looks like for our endpoint" — currently those are static pre-formatted JSON blocks. An embed would let them ship *interactive validators* in their public docs, where the reader can edit the sample and see what fails. Same use case applies for internal Notion/Confluence runbooks ("the exact BidRequest shape Account A sends us").

**Concrete adaptation:**
- New URL pattern `/embed/?req=...&res=...&panes=verdict,preview&theme=light` — same fragment encoding as §A but in query string + a `panes=` whitelist.
- Strip header/footer/lang-switcher/auth UI in embed mode (a single CSS class `body.embed` toggled by URL).
- Provide a copy-pastable snippet under the new "Share" button: `<iframe src="https://spyglass.kyivtech.com.ua/embed/?req=…&panes=verdict,preview" width="100%" height="600" loading="lazy"></iframe>`.
- Pane whitelist: `request | response | verdict | preview | crosscheck | categories | vendor`.
- Sandboxing for the embedder's safety: ensure CSP `frame-ancestors *` is set explicitly for `/embed/*` paths (currently likely default-deny per HSTS hardening done in Session 7).
- Code areas: `public/embed/index.html` (new minimal entry), shared `public/js/inspector.js`, server route in the static-site config.

**Effort:** M (1-2 sessions).
**Risk:** Medium — `frame-ancestors` policy is a security-sensitive change; document the threat model. Low if §A ships first.

---

### C. Editor settings modal (consolidated)

**JSFiddle pattern:**
A single gear icon opens a modal with three groups:
- **Behavior:** Auto-run, Only auto-run if validates, Auto-save, Live code validation, Hot-reload CSS, Hot-reload HTML.
- **General:** Line numbers, Wrap lines, Indent with spaces, Code autocomplete, Indent size, Font size (10-20px), Font family.
- **Console:** Console in editor, Clear console on run.

**Why it matters for Spyglass users:**
Right now Spyglass has these scattered or implicit:
- Theme toggle (header) ✓
- Auto-format-on-paste — *probably* implicit
- Live validation — runs on every keystroke or Ctrl+Enter
- Font size — fixed
- Wrap lines on JSON pastes — fixed
- Show/hide each Inspector tab — not configurable

Consolidating raises perceived polish, makes settings discoverable (the user said admin/dense UIs benefit from typography consistency — this modal IS that pattern), and creates a sane home for new toggles (auto-run on paste, "auto-decode IAB categories", "auto-substitute `${AUCTION_PRICE}` in preview", "compact verdict mode", etc.).

**Concrete adaptation:**
- Add gear icon next to theme toggle in header.
- Open modal with sections: **Validation** (live-validate-on-paste, strict mode, expand-all-findings-by-default), **Display** (font size: S/M/L, wrap lines in JSON panes, default tab to open in Inspector), **Preview** (auto-substitute macros, treat-as-banner-when-ambiguous, sandbox-strictness), **Library** (auto-save successful sessions if signed in).
- Persist to `localStorage` (anon) or encrypted under DEK (auth).
- Code areas: new `public/js/settings.js`, modal markup in `public/index.html`, CSS additions in `public/design-system.css` for the modal primitive (does Spyglass have a modal primitive? if not, this is the moment to add one — check `spyglass_phase_8_plan.md` for any pre-decided modal style).

**Effort:** M (4 hours for modal + 4 settings; less if a modal primitive already exists).
**Risk:** Low. Pure additive UI.

---

### D. Download as JSON / save bundle button

**JSFiddle pattern:**
Toolbar `download` icon — exports the fiddle as a single self-contained file.

**Why it matters for Spyglass users:**
After working through a thorny session ("the bidder is sending the wrong currency, here's the proof") an AdTech engineer wants to attach **one artifact** to a JIRA ticket. Currently they'd manually copy each pane. A "Download bundle" button would emit a single `.json` (or `.zip`) containing `{ request, response, verdict, timestamp, version }`.

**Concrete adaptation:**
- Add Download icon to format-pill bar.
- Two flavors:
  - **JSON bundle**: `{ "spyglass_version": "v8.0.0", "captured_at": "...", "bid_request": {…}, "bid_response": {…}, "findings": [...] }` — readable in any editor, re-importable into Spyglass.
  - **HTML report** (longer term): self-contained single-file HTML with verdict baked in, viewable offline. JSFiddle does not do this; would be an upgrade.
- Code areas: `public/js/export.js` (new), tiny addition to format-pill bar.

**Effort:** S (JSON bundle alone is 30 min).
**Risk:** Low.

---

### E. Drag-resize panel splitter

**JSFiddle pattern:**
Every panel boundary in JSFiddle is a draggable splitter; users can grow Result to 80% width when debugging visual bugs. There's even a width readout ("278px") to help debug responsive behavior.

**Why it matters for Spyglass users:**
A common need: "Make the Inspector tab 70% wide, I'm reading findings" — or — "Make the Ad Preview huge, I'm checking creative scaling". Spyglass uses a fluid layout but (per memory) panes are likely fixed proportionally.

**Concrete adaptation:**
- Use a vanilla 30-line JS splitter (no library). On `mousedown` on the boundary, listen to `mousemove`, set `flex-basis` on the two adjacent panes, persist to localStorage.
- For the ad-preview pane specifically, also display a width readout — extremely useful for testing creative breakpoints (300×250 vs 320×50 vs full-bleed). This is a domain win JSFiddle doesn't even target.
- Mobile: skip — splitters don't work on touch and panes should stack anyway.
- Code areas: `public/js/layout.js` (likely exists for fluid layout), `public/design-system.css` for `.split-handle` primitive.

**Effort:** M (3 hours including the width-readout polish).
**Risk:** Low.

---

### F. Run-button as visible affordance (alongside Ctrl+Enter)

**JSFiddle pattern:**
A prominent green "Run" button in the header. Even though Ctrl+Enter works, the button is the discovery vector for first-time users.

**Why it matters for Spyglass users:**
Per the task brief, Ctrl+Enter is documented but **invisible**. A first-time visitor pastes JSON, sits there, doesn't know what to do. Spyglass currently auto-validates on paste (good!), but a visible "Validate" or "Run" button next to the format-pill would (a) anchor the workflow visually, (b) give the keyboard shortcut a discoverable home (tooltip "Ctrl+Enter"), (c) handle the case where someone edits the JSON and wants to re-trigger explicitly.

**Concrete adaptation:**
- Add a small "Validate" button (or icon + label) to the format-pill bar.
- Tooltip: "Validate — Ctrl+Enter".
- On click: call the same handler as the keyboard shortcut.
- Code areas: format-pill bar markup, `public/js/main.js` event binding.

**Effort:** S (15 min).
**Risk:** None.

---

### G. Auto-run / live-validate toggle

**JSFiddle pattern:**
"Auto-run code" toggle in settings; "Only auto-run code that validates" as a safety modifier.

**Why it matters for Spyglass users:**
Spyglass likely already auto-validates on paste. JSFiddle's nuance is the *safety* modifier: if the JSON is malformed, don't bother trying to render the preview — surface the parse error first. Spyglass should make sure (a) parse errors are not muffled by other findings, (b) the user can disable auto-validate if they're typing/editing JSON character-by-character (jittery validations are annoying).

**Concrete adaptation:**
- In the new settings modal (§C), expose:
  - `Live validation: on/off` (default on)
  - `Validation debounce: 100ms / 500ms / off`
- The "only auto-run if validates" idea maps in Spyglass to **"only run macro substitution if BidResponse parses"** — already presumably the case but worth verifying as a defensive guard in `public/js/preview.js`.

**Effort:** S (debounce slider) — already partially implemented in spirit.
**Risk:** Low.

---

### H. Format / Tidy-up button per pane (already partial)

**JSFiddle pattern:**
JSFiddle does not have a JSON tidy-up; this is a Spyglass-native need.

**Status in Spyglass:** ✓ Already covered (`format` button per pane). No action.

---

### I. Sample / boilerplate menu — **partial parity**

**JSFiddle pattern:**
Right rail shows boilerplate templates: Tailwind Checkboxes, jQuery, React, Preact, TypeScript, CoffeeScript, SCSS, Bootstrap, PostCSS. One click loads a pre-filled fiddle.

**Status in Spyglass:** ✓ Partial — partner selector + JsonFeed Phase 1 (Kadam, ExoClick, RichAds, Zeropark) loads samples.

**Worth-adopting refinement:**
- JSFiddle puts boilerplates **front and center** for empty editors ("Start with a boilerplate:" prompt visible when panes are empty). Spyglass already shows partner selector but it's secondary visual weight.
- When BidRequest pane is empty, surface a richer "Start with a sample:" panel with named scenarios:
  - "Display 300×250 — desktop banner"
  - "Native 1.2 — feed unit"
  - "VAST 4.x — instream video"
  - "User-sync request"
  - "Multi-imp prebid stream"
- Each sample tagged with format pills so the user learns the visual vocabulary.
- Code areas: empty-state markup in `public/index.html`, sample fixtures in `public/samples/`.

**Effort:** M (2 hours including writing the 5 canonical sample payloads).
**Risk:** None.

---

### J. Tab / panel reordering via URL

**JSFiddle pattern:**
URL controls tab order: `embedded/result,js,html,css/` literally lists pane order in path.

**Why it matters for Spyglass users:**
Combined with §B (Embed mode), this lets a docs author choose "verdict only" or "preview + verdict, no request pane" — useful when embedding into a page that already shows the BidRequest in surrounding text.

**Concrete adaptation:**
- Already partially covered in §B's `panes=` whitelist. Ensure it accepts ordering: `panes=verdict,preview` shows verdict first, preview second.
- Code areas: same as §B.

**Effort:** S — folds into §B.
**Risk:** None additional.

---

### K. Keyboard shortcut discoverability — **`?` cheat sheet**

**JSFiddle pattern:**
JSFiddle does NOT have a `?` cheat sheet. **This is a gap, not a feature** — ironic, given the toolset has Ctrl+Enter and Ctrl+S documented but no in-app hint. **Spyglass should beat JSFiddle here.**

**Why it matters for Spyglass users:**
AdTech engineers are heavy keyboard users. Showing a `?` modal with shortcuts is a 30-minute polish win that no comparable tool ships.

**Concrete adaptation:**
- Press `?` (no modifier) anywhere → modal listing:
  - `Ctrl+Enter` — Validate / re-run
  - `Ctrl+S` — Save to library (if auth)
  - `Ctrl+L` — Clear both panes
  - `Ctrl+1/2/3` — Focus BidRequest / BidResponse / Inspector
  - `Esc` — Close modals
  - `?` — This help
- Plumbing: one `keydown` handler at document root; modal reuses §C's primitive.
- Code areas: `public/js/shortcuts.js` (new).

**Effort:** S (45 min including the modal copy in 3 locales).
**Risk:** None.

---

### L. Privacy toggle (public ↔ private)

**JSFiddle pattern:**
Toolbar lock icon toggles fiddle privacy (PRO feature).

**Why it matters for Spyglass users:**
Spyglass is already zero-knowledge — saved library entries are encrypted client-side. The "private vs public" distinction maps loosely to **"library vs share-link"** in Spyglass. A simple version: when a user clicks "Share link" (§A), surface a checkbox "Anyone with the link can view" — making the social-permission step explicit.

**Concrete adaptation:**
- In Tier 2 share flow (§A): toggle "expires in: never / 1 day / 7 days / one view only".
- Default to "7 days" for paste-and-throw use cases.
- Code areas: server-side share-slug table, expiry sweeper job (cron).

**Effort:** M — folds into §A Tier 2.
**Risk:** Medium (auth/expiry logic).

---

### M. Layout switch: split-grid ↔ tabbed

**JSFiddle pattern:**
A toggle switches between tiled grid (4 panes visible) and tabbed (one pane visible at a time).

**Why it matters for Spyglass users:**
On laptops at 1366×768 (still depressingly common in adtech ops), 3 panes side-by-side is cramped. A "tabbed" mode where you Tab through Request / Response / Inspector would help small screens and presentation/screenshare scenarios.

**Concrete adaptation:**
- Already half-handled by responsive stacking on narrow viewports.
- Add an **explicit** layout toggle in §C settings: `Layout: side-by-side | stacked | tabbed`. The user gets to override the responsive default on a small laptop.
- Code areas: `public/design-system.css` layout classes; `public/js/layout.js`.

**Effort:** S (CSS classes + persistence).
**Risk:** Low.

---

### N. Console panel (errors/logs) — already covered semantically

**JSFiddle pattern:**
Console pane shows `console.log` output and counts of error/warn/info/log.

**Status in Spyglass:** ✓ Validation/Crosscheck tabs serve this role. The **counter pattern** ("0 / 0 / 0 / 0") is interesting: Spyglass's tab labels could show finding counts as a small badge ("Validation 7", "Crosscheck 2"). Worth a tiny UX upgrade — likely already done per memory of the format-pill bar.

**Effort:** S if not already done.
**Risk:** None.

---

### O. Async-request / fixture endpoints (`/echo/json/`)

**JSFiddle pattern:**
JSFiddle hosts test endpoints (`/echo/json/`, `/echo/jsonp/`, `/echo/html/`, `/echo/xml/`) so fiddles can simulate API calls.

**Why it matters for Spyglass users:**
**Skip** for now — but with a noteworthy tangent: a future Spyglass feature could be **"send to test endpoint"** where you POST your BidRequest at a stub bidder and inspect the response in the BidResponse pane. That's a Phase 9+ idea, not part of this report.

**Effort:** L (multi-session, server-side stub).
**Risk:** Medium-High.

---

## 4. Skip / N/A

| JSFiddle feature | Why skip |
|---|---|
| **AI Code Completion (paid)** | Spyglass payloads are JSON; deterministic schema validation is the value, not LLM autocomplete. Adding AI here muddies the message. |
| **Collections (PRO)** | Library already exists; folder structure for a tool used in 30-second bursts is over-engineering. |
| **CDNJS / Resources panel** | Spyglass has no user-supplied dependencies; the "partner dialect" picker is the correct domain analog and exists. |
| **Multiple frameworks (jQuery / React / Preact / TypeScript / CoffeeScript)** | Off-domain. Spyglass's "frameworks" are oRTB versions (2.5/2.6/3.0) and dialects — already handled. |
| **PRO paywall (€8/mo)** | Anti-pattern for a zero-knowledge OSS-aligned tool. Brand-damaging if adopted. |
| **Carbon Ads / BuySellAds** | Brand-damaging. Spyglass is OSS, donations or sponsorship banner okay; programmatic ads no. |
| **JSFiddle Apps grab-bag (Coder Fonts, Color Palette Generator, Flexbox Generator)** | Spyglass should stay laser-focused on oRTB. A "Spyglass Tools" grab-bag would dilute. |
| **Console-in-editor toggle** | The Inspector tabs *are* the console; no extra console needed. |
| **Hot-reload CSS / Hot-reload HTML** | Spyglass's "code" is JSON payloads; "hot reload" maps to live-validate, which already exists. |
| **Indent-with-spaces / indent-size / font-family selector** | Spyglass JSON panes are paste-targets, not authoring surfaces. Fixed mono font + sane indent is fine. Font-size could be exposed (folded into §C). |
| **Coffee/SCSS/PostCSS preprocessors** | Off-domain. |
| **GitHub/Gist import** | Theoretically Spyglass could import a JSON Gist, but the share-link flow (§A) covers the same use case more cleanly. |
| **POST-based fiddle creation API** | Possible future API, but not a UX feature; out of scope for this report. |
| **User dashboard / fiddle listing pages with public discovery** | Spyglass library is private-by-design (zero-knowledge). A public gallery would require fundamental architecture change and contradict the threat model. |
| **Username-based URLs (`/oskar/aba321/`)** | Adds identity surface that Spyglass deliberately minimizes. Anonymous slugs (§A Tier 2) are sufficient. |
| **"Live collaboration" toggle** | Spyglass sessions are short (30 sec to 5 min). Real-time collab adds CRDT complexity for vanishingly small benefit. The share-link (§A) already handles "send this to a colleague". |
| **Favourite / star button** | Library already covers "remember this one"; star is redundant. |
| **TidyUp (HTML pretty-print)** | Format button per pane already covers JSON pretty-print. |
| **Width readout in Result pane (`278px`)** | **Re-evaluated:** actually surprisingly useful for ad-preview testing. **Folded into §E** rather than skipped. |

---

## 5. Recommended next steps (ranked top-5)

These are ordered by **leverage / effort**, not by ease alone. Each row points to a concrete first task that should fit in a single session.

| # | Adoption | First task | Effort | Risk |
|---|---|---|---|---|
| 1 | **§A Tier 1 — fragment-encoded permalink** | Wire `share.js`: serialize `{ req, res }` into deflate+base64url, write to `location.hash`, parse on load, add "Share link" button to format-pill bar with toast. **NO server changes.** | M (3-4 hr) | Low |
| 2 | **§K — `?` keyboard cheat sheet** | One key handler, one modal, three-locale copy table. Massive perceived-polish win for ~45 minutes. Ship same session as #1. | S (45 min) | None |
| 3 | **§D — Download JSON bundle** | One button on format-pill bar; emit `{ spyglass_version, captured_at, bid_request, bid_response, findings }` blob via `URL.createObjectURL`. Re-importable later. | S (30 min) | None |
| 4 | **§B — Embed mode** | Builds on #1's URL primitive: add `/embed/?...&panes=verdict,preview` route serving a stripped-down shell (`body.embed` class hides chrome). Surface copy-pastable `<iframe>` snippet under the Share button. Document `frame-ancestors` policy. | M (4-6 hr) | Medium (CSP review) |
| 5 | **§C — Settings modal** | Build the modal primitive (likely doesn't exist yet — check). Wire 4-6 toggles: live-validate on/off, debounce, font size, default-tab, layout (folds in §M), auto-substitute macros. Persist to localStorage. | M (4 hr) | Low |

Bonus tier (do later, not in next-5):
- §E — drag-resize splitters with width readout for the ad-preview pane (domain-specific upgrade).
- §F — visible "Validate" button next to the keyboard shortcut — folded into the format-pill bar redesign that #1 already touches.
- §I — empty-state "Start with a sample" panel with 5 canonical scenarios, replacing the current minimalist state.
- §A Tier 2 — server-side short-link with expiry (only after Tier 1 ships and demand is observed).

---

## Appendix: JSFiddle UX inventory (raw)

Captured from `https://jsfiddle.net/` and `https://jsfiddle.net/boilerplate/jquery` via Playwright on 2026-05-04:

**Toolbar buttons** (left → right):
- `sidebarToggle` — collapse left rail
- `togglePrivacy` — public ↔ private (PRO)
- `fiddleAuthor` — author byline
- `runButton` — Run
- `saveButton` — Save (Ctrl+S)
- `forkButton` — Fork
- `favButton` — Favourite (star)
- `collaborateButton` — Live collaboration
- `downloadButton` — Download fiddle as file
- divider
- `gridButton` — Switch grid ↔ tabbed
- `settingsButton` — Editor settings modal
- `themeButton` — Toggle theme
- divider
- `embedButton` — Open embed snippet modal
- `proButton` — Go PRO

**Editor settings modal sections** (verbatim labels):
- Behavior: Auto-run code · Only auto-run code that validates · Auto-save code · Live code validation · Hot reload CSS · Hot reload HTML
- General: Line numbers · Wrap lines · Indent With Spaces · Code Autocomplete · Indent size (2/4 spaces) · Font size (10-20px) · Font family
- Console: Console in the editor · Clear console on run

**URL patterns** (documented):
- `jsfiddle.net/<user>/<slug>/<version>/` — canonical fiddle URL
- `jsfiddle.net/<user>/<slug>/` — base version (collapses if user pinned a default)
- `/embedded/result,js,html,css/` — embed with explicit pane order
- `/show/` — result-only "presentation" mode
- `/boilerplate/<name>/` — pre-filled templates
- `/api/post/` — POST-based fiddle creation
- `/user/fiddles/all/` — user dashboard

**Keyboard shortcuts:**
- `Ctrl+Enter` — Run
- `Ctrl+S` — Save
- (No in-app cheat sheet; not surfaced anywhere visible.)

**Sidebar (left rail):**
- AI Code Completion (paid Mistral integration)
- Your recent fiddles
- Collections PRO
- Resources CDNJS (CDNJS-backed library picker)
- Async requests (`/echo/json/`, `/echo/jsonp/`, `/echo/html/`, `/echo/xml/` test endpoints)
- Changelog
- JSFiddle Apps (Coder Fonts, Color Palette Generator, CSS Flexbox Generator)
- Sign-in
- Carbon Ads + BuySellAds banners (2 ad units)

**PRO features (paywalled, €8/mo or €80/yr):**
- Ad-free
- Pre-released features
- Fiddle collections
- Private collections + private fiddles
- Console
