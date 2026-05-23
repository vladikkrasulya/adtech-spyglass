# Spyglass

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Public OpenRTB inspector — paste a `BidRequest` / `BidResponse` JSON and get
human-readable validation, semantic request↔response crosscheck, IAB-category
decoding, and a sandboxed creative preview. With an account: zero-knowledge
encrypted library of saved samples per partner.

**Live**: <https://spyglass.kyivtech.com.ua/> · **Docs**:
[/about](https://spyglass.kyivtech.com.ua/about) · 🇺🇦 / 🇬🇧 / 🇷🇺
([UK](https://spyglass.kyivtech.com.ua/uk/) · [EN](https://spyglass.kyivtech.com.ua/) · [RU](https://spyglass.kyivtech.com.ua/ru/))

**No account required** to inspect bids — paste-and-validate works
anonymously, no logs of your payloads are kept (a per-tab in-memory
history is the only retention). Login is **opt-in** for the
encrypted library of saved samples and partner profiles. The whole
surface lives on a single domain by design — see [decision log in
ROADMAP.md](./ROADMAP.md#decision-log-live).

## What it does

- **OpenRTB**: oRTB 2.5 / 2.6 / 3.0 detection + validation. Auto-detect the
  version from field signatures (`imp.rwdd`, `device.sua`, `regs.gpp`, …) and
  surface findings with deep-links to the IAB spec paragraph.
- **Format detection** (Phase 10): a third axis alongside type + version —
  classifies the payload as banner / video / audio / native / push / pops /
  inpage and tags runtime context (web / inapp / ctv / dooh) and creative
  protocol (vast-2/3/4 / daast). Surfaces colour-coded chips in the summary
  panel.
- **Crosscheck**: request↔response sanity (`bid.impid` → `imp.id` match,
  creative format matches `imp.banner/video`, price ≥ `bidfloor`, native
  asset-id match, …).
- **JsonFeed**: validation for non-RTB push/pop feeds — vendor-specific
  push, clickunder, single-bid shapes.
- **Pop / Clickunder** (`pop`, `popunder`, `popup`, `clickunder`): first-class
  detection + validation. `format-detect.js` tags pop intent from
  `imp.ext.adtype` / `imp.ext.popunder` / `bid.ext.adtype` and from
  `bid.adm` shape (window.open / bare URL / location.href). Plugin rules
  warn on missing fcap, recommend `imp.banner.btype:[4]`, flag bid.adm
  shipping banner HTML instead of a redirect, and crosscheck the
  landing host against `bid.adomain` — pops bypass anti-phishing
  filters so adomain truth is the only safety signal.
- **IAB Content Taxonomy 1.0** category decoding from `cat[]` / `bcat[]` /
  `pcat[]`.
- **Vendor dialect overlays** — opt-in extra rules for specific SSPs/DSPs via
  `?dialect=<vendor>` (a couple of vendor-specific overlays ship by default).
  Authors can
  also build **temporary client-side dialects** from discovered fields via
  the in-UI Dialect Builder — these stay local and never leave the browser.
- **Ad preview** — renders `bid.adm` HTML, native JSON cards, and VAST
  fragments in a sandboxed iframe (`sandbox="allow-scripts"`, no
  `allow-same-origin`). Native bids are synthesized into a stand-alone HTML
  card so behavior probes see clicks the same way they would on a banner.
- **Behavior probe** (Phase 5/6): an in-iframe instrumentation bundle hooks
  `addEventListener` / `Location.href` / permission APIs and reports back
  via `postMessage`. Engine flags misclick traps, frozen threads, permission
  abuse, miner / obfuscation / XSS patterns, and entropy outliers. Capped at
  500 events per session (rolling window) to keep parent-tab memory bounded
  during long monitoring runs.

## Spyglass Intelligence (Discovery + Local AI)

Phase 7a–7c built an **opt-in, browser-local discovery layer** that watches
for unknown vendor extension fields under `*.ext.*` and clusters them by
co-occurrence into candidate dialects. Everything runs **inside the user's
browser** (IndexedDB) — payload values never leave the tab. Highlights:

- **Discovery walker** — descent capped at depth 4 with a strict PII
  denylist (`buyeruid`, `ifa`, `idfa`, `ip`, `consent`, `gpp`, `geo.lat`,
  `user.id`, …). Only field paths + character-class shapes are kept; values
  are dropped before persistence.
- **Co-occurrence clustering** — anchored exploration with a minimum
  field-score and minimum co-occurrence threshold so we surface clusters
  that are real, not "everything seen everywhere".
- **Dialect Builder** — modal that lets users review a suggested cluster,
  pick fields, and turn it into a temporary dialect overlay applied to
  validation findings client-side.
- **Local LLM bridge** (Phase 7c, **opt-in**): a self-hosted Ollama instance
  (default model `gemma4:e2b` since 2026-05-21; previously `qwen2.5:3b`)
  provides cluster naming + per-field purpose hints. The LLM call is
  fail-open: if Ollama is unreachable, the AI affordances quietly hide
  and the rest of Spyglass continues unaffected. See
  [LLM_SETUP.md](./LLM_SETUP.md) for deployment.
- **Knowledge Base** (Phase 10): a curated set of OpenRTB / JsonFeed
  reference fixtures under [packages/core/knowledge_base/](./packages/core/knowledge_base/).
  Used for two things — `format-detect` self-tests and **few-shot context**
  for the local LLM (so cluster names are grounded in real-market vocabulary
  rather than priors). License-clean ingestion plan in
  [SOURCES.md](./packages/core/knowledge_base/SOURCES.md).

The privacy posture is consistent across the whole stack: **no
bid-stream payload values leave the user's browser** unless the user is
logged in and explicitly saves a sample (in which case they're encrypted
end-to-end before transmission).

## Safe Public Mode

When the URL contains `?demo=safe` (used for the public landing strip and
shareable links), Spyglass renders ad creatives behind a CSS blur filter
and masks domains in the summary panel. The validator still runs at full
fidelity; only the visual surfaces change. This lets us screenshot the
tool in marketing material without leaking real-publisher branding from
test payloads.

## Zero-knowledge encryption

Saved samples are **encrypted in the browser** with a key derived from the
user's password (PBKDF2-SHA-256, 600k iterations, 16-byte salt). The server
stores AES-GCM-256 ciphertext + a wrapped DEK + IVs — it cannot decrypt
samples, partners, or notes even with full DB access. A 32-hex recovery key is
shown at register-time as the only way to regain access on lost-password.

This is verifiable: read [public/spyglass-crypto.js](./public/spyglass-crypto.js)
and the `Phase 7 — Zero-knowledge encryption` section of [CHANGELOG.md](./CHANGELOG.md).

## Run locally

```bash
docker compose up -d --build
# UI at http://127.0.0.1:8090
```

The container bind-mounts:

- `./public` for live-edit of HTML/CSS/JS (no rebuild on UI changes)
- `/srv/DATA/Stacks/kyivtech-portal/public/design-system.css` for the shared
  design system (this is an artefact of how I deploy it — replace the path
  with your own design-system.css source if you fork)
- `/srv/DATA/AppData/adtech-spyglass` for persistent SQLite
- `./intel-llm.js` (live-edit of the LLM bridge without container rebuild)

The `public/design-system.css` file in this repo is an **empty placeholder** —
Docker requires the bind-mount target to exist. At runtime the real file from
the path above is served on top.

**Optional: Local AI**. Discovery cluster naming + per-field purpose hints
require a local Ollama instance reachable on the `ollama_default` Docker
network. See [LLM_SETUP.md](./LLM_SETUP.md) for the full setup. Spyglass
runs cleanly without it — AI affordances hide on first 503.

## Layout

```
server.js                 vanilla node:http server, REST API
db.js                     SQLite store (partners + encrypted samples)
auth.js                   bcrypt + per-IP / per-account rate-limiter
tokens.js                 stateless HMAC tokens for verify-email + reset
email.js                  Resend HTTPS API wrapper

packages/core/            validator core (browser + server-side compatible)
  index.js                public API surface — validate(), crosscheck()
  detect.js               type + oRTB version autodetection
  format-detect.js        format detection (banner/video/audio/native/push/…)
  knowledge-base.js       fixture loader + few-shot helper for the LLM
  rules-request.js        oRTB BidRequest rules (IAB-spec baseline)
  rules-response.js       oRTB BidResponse rules
  rules-request-30.js     oRTB 3.0 BidRequest envelope checks
  rules-response-30.js    oRTB 3.0 BidResponse envelope checks
  rules-vast.js           VAST 2.x / 3.x / 4.x envelope + quality checks
  rules-feed.js           JsonFeed rules (vendor-specific shapes)
  rules/                  plugin-style validator rules — see rules/README.md
                          for contract. Currently shipped: client-hints,
                          imp-secure. Append-only — adding one is a folder
                          + one line in PLUGINS array.
  spec-refs.json          finding-id → IAB spec URL map (gated by
                          tests/spec-refs.test.js)
  crosscheck.js           request↔response semantic checks
  categories.js           IAB Content Taxonomy decoder
  dialects/iab.js         IAB-canonical baseline (default)
  dialects/ext-rtb.js     Vendor oRTB-extension overlay
  dialects/inpage-push.js  Vendor in-page push overlay
  intel/walker.js         discovery walker with PII denylist
  intel/cluster.js        co-occurrence clustering
  intel/temp-dialect.js   client-side temporary dialect runtime
  knowledge_base/         curated reference fixtures (oRTB 2.5/2.6 + JsonFeed)
  messages/{uk,en,ru}.json  localised finding messages
behavior/                 in-iframe creative-probe scanner + engine

intel-llm.js              server-side LLM bridge (Ollama)

public/index.{en,uk,ru}.html   UI per locale (EN at /, others under /uk/, /ru/)
public/about.{en,uk,ru}.html   docs per locale
public/spyglass.app.js         UI behaviours
public/spyglass-crypto.js      zero-knowledge crypto (browser-only)
public/lang-switch.js          seamless DOM-morph language switch (shared by index + about)
public/i18n.js                 ~140-key UK/EN/RU dictionary

docker-compose.yml        service definition (ports + bind mounts)
Dockerfile                multi-stage alpine + node + better-sqlite3 build
```

## Tests

```bash
npm test          # 658 tests at v0.42.10 — validator, crosscheck, auth,
                  # tokens, behavior engine, intel walker/cluster/LLM,
                  # format detection, knowledge-base round-trip, router
                  # dispatch, health endpoint, spec-refs coverage gate
npm run ci        # prettier:check → eslint → typecheck → tests; what the
                  # pre-push hook enforces
```

## Configuration

Runtime config goes in `.env` (git-ignored). See [.env.example](./.env.example)
for the full list. The defaults work without auth/email — those are only
needed if you want the saved-samples library + verify-email flow.

## Contributing

Issues + PRs welcome. Particularly useful:

- **Validator rule plugins** — see [`packages/core/rules/README.md`](./packages/core/rules/README.md)
  for the plugin contract. A plugin is one folder + one line in the
  PLUGINS array; legacy `rules-request.js` / `rules-response.js` stay
  authoritative for IAB-spec baseline. Every new finding-id must
  also land in `packages/core/spec-refs.json` (the `tests/spec-refs.test.js`
  gate enforces it).
- **Vendor dialect overlays** — if you have public docs for a CIS adtech
  network we don't cover, drop a PR with a new `dialects/<vendor>.js`.
- **Translations** — `packages/core/messages/` and `public/i18n.js` accept
  more locales; a new file + entries in the I18N object is enough.
- **oRTB minor-revisions** — 2.6-202506+ signal detection.

For security issues: see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) — use it, fork it, run it. Attribution appreciated but not
required.
