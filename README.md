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
- **Crosscheck**: request↔response sanity (`bid.impid` → `imp.id` match,
  creative format matches `imp.banner/video`, price ≥ `bidfloor`, native
  asset-id match, …).
- **JsonFeed (CIS adtech)**: validation for non-RTB push/pop feeds — Kadam
  push + clickunder, ExoClick `rtb.php`, RichAds telegram-bid, Zeropark.
- **IAB Content Taxonomy 1.0** category decoding from `cat[]` / `bcat[]` /
  `pcat[]`.
- **Vendor dialect overlays** — opt-in extra rules for specific SSPs/DSPs via
  `?dialect=<vendor>` (currently `kadam`).
- **Ad preview** — renders `bid.adm` HTML in a sandboxed iframe
  (`sandbox="allow-scripts"`, no `allow-same-origin`).

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

The `public/design-system.css` file in this repo is an **empty placeholder** —
Docker requires the bind-mount target to exist. At runtime the real file from
the path above is served on top.

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
  rules-request.js        oRTB BidRequest rules
  rules-response.js       oRTB BidResponse rules
  rules-feed.js           JsonFeed rules — Kadam/ExoClick/RichAds/Zeropark
  crosscheck.js           request↔response semantic checks
  categories.js           IAB Content Taxonomy decoder
  dialects/iab.js         IAB-canonical baseline (default)
  dialects/kadam.js       Kadam oRTB-extension overlay
  messages/{uk,en,ru}.json  localised finding messages

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
npm test          # 124+ unit tests (validator + crosscheck + auth + tokens)
```

## Configuration

Runtime config goes in `.env` (git-ignored). See [.env.example](./.env.example)
for the full list. The defaults work without auth/email — those are only
needed if you want the saved-samples library + verify-email flow.

## Contributing

Issues + PRs welcome. Particularly useful:

- **Vendor dialect overlays** — if you have public docs for a CIS adtech
  network we don't cover, drop a PR with a new `dialects/<vendor>.js`.
- **Translations** — `packages/core/messages/` and `public/i18n.js` accept
  more locales; a new file + entries in the I18N object is enough.
- **oRTB minor-revisions** — 2.6-202506+ signal detection.

For security issues: see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) — use it, fork it, run it. Attribution appreciated but not
required.
