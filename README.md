# ortbtools

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Public OpenRTB inspector — paste a `BidRequest` / `BidResponse` JSON and get
human-readable validation, semantic request↔response crosscheck, IAB-category
decoding, and a sandboxed creative preview. With an account: browser-encrypted
saved payload bodies, organized by partner.

**Live**: <https://ortbtools.com/> · **Docs**:
[/about](https://ortbtools.com/about) · 🇺🇦 / 🇬🇧 / 🇷🇺
([UK](https://ortbtools.com/uk/) · [EN](https://ortbtools.com/) · [RU](https://ortbtools.com/ru/))

**No account required** to inspect bids — paste-and-validate works
anonymously. Your pasted payload is sent over HTTPS, analyzed on the server,
and not persisted by the server. Separately, the browser keeps up to 50 recent
raw request/response entries in same-origin `localStorage`; that history
survives reloads and is shared across tabs. The server does keep derived
analytics and a sampled request log (which includes your IP), but never the
payload bodies. Login is **opt-in** for saved samples and partner profiles.
The whole surface lives on a single domain by design — see
[decision log in ROADMAP.md](./ROADMAP.md#decisions).

## What it does

- **OpenRTB**: oRTB 2.5 / 2.6 / 3.0 detection + validation. Auto-detect the
  version from field signatures (`imp.rwdd`, `device.sua`, `regs.gpp`, …) and
  surface findings with IAB spec links where a maintained mapping exists.
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
  warn when `battr` blocks pop creatives, flag `instl` conflicts and missing
  frequency caps, detect banner HTML where a redirect is expected, and
  crosscheck the landing host against `bid.adomain`.
- **IAB Content Taxonomy 1.0** category decoding from `cat[]` / `bcat[]` /
  `pcat[]`.
- **Vendor dialect overlays** — opt-in extra rules for specific SSPs/DSPs via
  `?dialect=<vendor>`. The built-ins are `iab`, `ext-rtb`, and `inpage-push`.
  The discovery UI can also build a temporary overlay from browser-local field
  shapes; that temporary overlay is applied to rendered findings in the tab.
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

## ortbtools Intelligence (Discovery + deterministic rules)

Phase 7a–7c built an **opt-in, browser-local discovery layer** that watches
for unknown vendor extension fields under `*.ext.*` and clusters them by
co-occurrence into candidate dialects. The discovery walker runs **inside the
user's browser** (IndexedDB) — only field paths and character-class shapes are
kept; bid values are dropped in the browser, not sent to the server. Highlights:

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
- **Deterministic suggestions** — the server-side rules engine in
  [`lib/intel-rules.js`](./lib/intel-rules.js) names clusters, classifies field
  purpose, infers partners, and simulates bidder strategies. It has no model or
  third-party service dependency: the same input produces the same output, and
  unknown signals stay unknown instead of being guessed.
- **Knowledge Base** (Phase 10): a curated set of OpenRTB / JsonFeed
  reference fixtures under [packages/core/knowledge_base/](./packages/core/knowledge_base/).
  Used for `format-detect` self-tests and format-aware context for deterministic
  cluster naming. License-clean ingestion plan in
  [SOURCES.md](./packages/core/knowledge_base/SOURCES.md).

The privacy posture across the stack: Discovery persists derived field paths,
not bid values. Partner inference can send the current request (and optional
response) to the server-side deterministic rules endpoint for transient
processing; no external model receives it. The Inspector likewise sends pasted
payloads over HTTPS for transient server-side analysis. The current web save
flow encrypts request/response bodies in the browser before upload; its metadata
remains server-readable. See [docs/PRIVACY.md](./docs/PRIVACY.md) for exact
retention boundaries.

## Safe Public Mode

When the URL contains `?demo=safe` (used for the public landing strip and
shareable links), ortbtools renders ad creatives behind a CSS blur filter
and masks domains in the summary panel. The validator still runs at full
fidelity; only the visual surfaces change. This lets us screenshot the
tool in marketing material without leaking real-publisher branding from
test payloads.

## Zero-knowledge encryption

The current web save flow **encrypts the request and response bodies in the
browser** with a key derived from the user's password (PBKDF2-SHA-256, 600k
iterations, 16-byte salt). The server stores AES-GCM-256 ciphertext + a wrapped
DEK + IVs and cannot decrypt those bodies. Sample titles, statuses and notes;
partner names, slugs and notes; and custom-dialect mappings remain plaintext
server metadata. The API/schema does not enforce or cryptographically verify
ciphertext; direct clients can store plaintext or omit IVs. A 32-hex recovery
key is shown at register-time as the only way to regain access to encrypted
bodies after a lost password.

This is verifiable: read [public/ortbtools-crypto.js](./public/ortbtools-crypto.js)
and the `Phase 7 — Zero-knowledge encryption` section of [CHANGELOG.md](./CHANGELOG.md).

## Run locally

```bash
docker compose up -d --build
# UI at http://127.0.0.1:8090
```

The production container is an immutable image: application source, packages,
public assets, samples, and the vendored design system are baked at build time.
The only runtime mount is `/srv/DATA/AppData/ortbtools:/data` for SQLite and
persisted blog content. A source edit therefore requires an image rebuild; a
plain container restart does not load host-side changes.

## Layout

```
server.js                 vanilla node:http server, REST API
db.js                     SQLite store (account metadata + saved samples)
auth.js                   bcrypt + per-IP / per-account rate-limiter
tokens.js                 stateless HMAC tokens for verify-email + reset
email.js                  Resend HTTPS API wrapper

packages/core/            CommonJS validator workspace; main APIs are network-free
  index.js                public API surface — validate(), crosscheck()
  detect.js               type + oRTB version autodetection
  format-detect.js        format detection (banner/video/audio/native/push/…)
  knowledge-base.js       Node-only fixture loader + reference context
  rules-request.js        oRTB BidRequest rules (IAB-spec baseline)
  rules-response.js       oRTB BidResponse rules
  rules-request-30.js     oRTB 3.0 BidRequest envelope checks
  rules-response-30.js    oRTB 3.0 BidResponse envelope checks
  rules-vast.js           VAST 2.x / 3.x / 4.x envelope + quality checks
  rules-feed.js           JsonFeed rules (vendor-specific shapes)
  rules/                  plugin-style validator rules — see rules/README.md
                          for contract. Eleven rule groups currently ship;
                          adding one requires a folder + PLUGINS registration.
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
  behavior/               creative-probe scanner + behavior engine
lib/intel-rules.js        deterministic intel suggestions + news relevance

public/index.{en,uk,ru}.html UI per locale (EN at /, others under /uk/, /ru/)
public/about.{en,uk,ru}.html docs per locale
public/ortbtools.app.js UI behaviours
public/ortbtools-crypto.js zero-knowledge crypto (browser-only)
public/lang-switch.js seamless DOM-morph language switch (shared by index + about)
public/i18n.js central UK/EN/RU dictionary

docker-compose.yml service definition (ports + bind mounts)
Dockerfile multi-stage alpine + node + better-sqlite3 build
```

## CLI (`@ortbtools/cli`)

Validate OpenRTB JSON from the terminal — same engine as ortbtools.com, no network
calls (payloads stay on your machine).

The CLI and core packages are currently available only as workspaces in this
repository; neither package has been published to npm yet (registry status
verified 2026-08-11). From a checkout after `npm install`:

```bash
node packages/cli/bin/ortbtools.js validate path/to/bidrequest.json
node packages/cli/bin/ortbtools.js crosscheck request.json response.json --json
```

Workspace library use:

```js
const { validate, crosscheck } = require('@ortbtools/core');
```

See [the CLI README](./packages/cli/README.md) and
[the core README](./packages/core/README.md). The first-publish procedure is in
[docs/NPM_PUBLISH.md](./docs/NPM_PUBLISH.md).

## Tests

```bash
npm test          # full node:test suite
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
  network we don't cover, drop a PR with a new
  `packages/core/dialects/<vendor>.js` and register it in the `DIALECTS` map.
- **Translations** — `packages/core/messages/` and `public/i18n.js` accept
  more locales; a new file + entries in the I18N object is enough.
- **oRTB minor revisions** — per-revision detection and rule gating.

For security issues: see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) — use it, fork it, run it. Attribution appreciated but not
required.
