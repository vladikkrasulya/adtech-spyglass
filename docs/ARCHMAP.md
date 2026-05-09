# Spyglass — Architectural Map

**Purpose**: living dependency map. Read this BEFORE touching any subsystem.
For each entry: where it lives, who uses it, who depends on it, deploy chain,
related tests, known gotchas. Update in the same commit as any change that
shifts a connection.

> **Never trust this doc 100%** — verify with grep. But if a grep result
> contradicts the map, fix the map.

Last touched: 2026-05-09 (initial creation, end of API stability sprint).

---

## 1. Validator core (`packages/core/`)

### 1.1 The graph

```
detect.js ──┐
            ├──> rules-request.js ──┐
helpers.js ─┤    rules-response.js ─┼──> findings.js ──> index.js ──┐
            └──> rules-feed.js ─────┘                                ├──> consumers
                 crosscheck.js ─────────────────────────────────────┤
                 format-detect.js ──────────────────────────────────┤
                 categories.js ─────────────────────────────────────┤
                 behavior/ (analyze + rules/) ──────────────────────┤
                 knowledge-base.js, knowledge_base/data/* ──────────┘
```

**Public API** (`packages/core/index.js`):
- `validate(payload, opts?)` — schema validation per type/dialect/version
- `crosscheck(req, res, opts?)` — semantic comparison
- `detectType` / `detectVersion` / `detectFormat`
- `listDialects` / `listLocales`
- `decodeCategory` / `decodeCategories` / `extractAllCategories`
- Re-exports: `TYPES`, `VERSIONS`, `FORMATS`, `CONTEXTS`, `PROTOCOLS`, `LEVELS`, `CROSS_LEVELS`, `nativeAssetCrosscheck`

**Subpath exports** (per `packages/core/package.json` "exports" field):
- `@kyivtech/spyglass-core` → main API
- `@kyivtech/spyglass-core/behavior` → `behavior/index.js` (event-stream analyzer + static creative scan)
- `@kyivtech/spyglass-core/intel` → LLM-bridge primitives (used by `intel-llm.js`)
- `@kyivtech/spyglass-core/knowledge-base` → KB query helpers

### 1.2 Public contract guarantees (since core 0.11.0)

`validate()` and `crosscheck()` outputs are deterministic:
- Order: severity DESC → path ASC → id ASC. Errors first, then warnings, then info. `crit`≡`error`, `warn`≡`warning`, `ok` last.
- Dedup: `(id, path)` pairs collapse; merged finding gets `params.dedupCount` (≥2 only). Uses `dedupCount`, not `count`, to avoid colliding with domain `count` (e.g. `crosscheck.bid.native_complete`).
- `disabledRules: string[]` — exact ids OR trailing-`*` prefixes.

### 1.3 Format detection — VAST sniff & validation

**Canonical sniff helpers** (since core 0.12.0): `isVastShape(s)` and
`detectVastVersion(s)` exported by `packages/core/format-detect.js`.
Anchored regex (`^\s*(<\?xml|<VAST)`); HTML mentioning `<VAST` deep inside
does NOT false-positive.

| File | Lines | Sniff | Used for | Status |
|---|---|---|---|---|
| [`format-detect.js`](../packages/core/format-detect.js) | helper exports | canonical | format-detect itself + rules-vast.js | ✅ canonical |
| [`rules-vast.js`](../packages/core/rules-vast.js) | imports helpers | reuses | 8 VAST validation rules | ✅ canonical |
| [`crosscheck.js`](../packages/core/crosscheck.js#L258) | 258 (inline regex) | local | emits `crosscheck.bid.video_vast` / `video_not_vast` | ⚠ deferred consolidation — works, has tests, separate refactor when there's a reason |
| [`spyglass.app.js`](../public/spyglass.app.js#L816) | 816 (inline regex) | local | UI-side preview branching | ⚠ same; the UI already loads the bundled core, could switch to `SpyglassCore.isVastShape` in a future pass |

**Rule for new code**: import `isVastShape` / `detectVastVersion` from
`format-detect.js`. Don't write a 4th sniff regex.

### 1.3.0 oRTB 3.0 routing (since 0.13.0; response since 0.14.0)

- Detection (`detect.js`): presence of `openrtb` object (any shape, even
  broken `ver=""`) OR top-level `item[]` classifies the payload as 3.0
  with confidence 1. Envelope discrimination: `openrtb.response{}` →
  ORTB_RESPONSE, else → ORTB_REQUEST.
- Routing (`index.js validate()`): version-dispatch on both sides:
  V_3_0 + ORTB_REQUEST → `validateRequest30()`,
  V_3_0 + ORTB_RESPONSE → `validateResponse30()`.
  Same `disabledRules` / `dialect` / `locale` opts.
- Request rules (`rules-request-30.js`): 12 — 7 envelope-level, 4
  per-item, 1 always-fire INFO.
- Response rules (`rules-response-30.js`): 16 — envelope (4), response
  body (4 incl. `no_bid` INFO), per-seatbid + per-bid (5 incl.
  `bid.item_required` since 3.0 uses `bid.item` instead of 2.x
  `bid.impid`), plus `deep_validation_limited` INFO.
- Test surface: `tests/ortb30.test.js` (~36 cases).
- AdCOM 1.0 placement validation (item.spec.placement, bid.media,
  AdCOM creative specs) NOT covered. The always-fire INFO
  `*.30.deep_validation_limited` tells users so they aren't surprised
  by a thin findings list.

### 1.3.1 VAST validation surface (since 0.12.0; expanded 0.14.0)

- **12 rules** in `packages/core/rules-vast.js`, fired from
  `rules-response.js` per bid (when `isVastShape(adm)` is true)
- Envelope rules (8): `vast.version_missing` (ERR),
  `version_unknown` (WARN), `inline_or_wrapper_required` (ERR),
  `adsystem_missing` (ERR — InLine), `adtitle_missing` (ERR — InLine),
  `mediafile_missing` (ERR — InLine), `wrapper_no_tag_uri` (ERR —
  Wrapper), `insecure_url` (WARN; carries `count` + `sampleUrl`)
- Quality rules added in 0.14.0 (4): `vast.ad_pod` (INFO — multiple
  `<Ad>` = sequential ad-pod, count param), `linear_duration_missing`
  (ERR — `<Linear>` without `<Duration>`),
  `vpaid_deprecated` (WARN — `apiFramework="VPAID"`),
  `impression_tracking_missing` (WARN — InLine without `<Impression>`)
- 4 synthetic samples in `samples/`: `synthetic-vast-clean-inline`,
  `synthetic-vast-broken-inline`, `synthetic-vast-insecure-wrapper`,
  `synthetic-vast-vpaid-deprecated`
- ~34 tests in `tests/vast.test.js`
- UI dropdown: "VAST (video)" section, 4 buttons per locale
- The pre-existing crosscheck rules `video_vast` / `video_not_vast` (about
  format-vs-slot match) are independent and untouched. They check whether
  a video imp got a VAST adm; rules-vast.js checks whether the VAST itself
  is well-formed. Both can fire on the same bid.
- **Sniffer consolidation (since 0.14.0)**: `crosscheck.js` now imports
  `isVastShape` from `format-detect.js` instead of inline regex. Browser
  `public/spyglass.app.js` regex aligned but still inline (browser
  doesn't have direct access to bundled core helpers; future
  `window.SpyglassCore` exposure would let us drop the duplication).

### 1.4 Consumers

| Consumer | File | What it uses |
|---|---|---|
| `server.js` (Spyglass HTTP API) | top of [server.js:50-52](../server.js#L50) | full `validate` / `crosscheck` + `behavior.analyze` + `knowledge-base` |
| Browser (validator card) | [`public/spyglass.app.js`](../public/spyglass.app.js) | client-side validation via webpack/inline-bundled core (matters for "no phoning home" promise) |
| Browser (behavior tab) | [`public/modules/behavior/index.js`](../public/modules/behavior/) | `behavior` subpath — server-side proxy, but UI consumes findings |
| Tests | `tests/{validator,dialects,format-detect,behavior,intel}.test.js` | every public surface |
| `intel-llm.js` | [intel-llm.js](../intel-llm.js) | uses LLM-bridge primitives from `core/intel` |

### 1.5 Tests by surface (so changes know where to look)

| Touching... | Run these |
|---|---|
| `findings.js` | `tests/api-stability.test.js` + `tests/validator.test.js` (snapshots) |
| `rules-request.js` | `tests/validator.test.js` (~50 cases) + `tests/dialects.test.js` |
| `rules-response.js` | `tests/validator.test.js` |
| `crosscheck.js` | `tests/validator.test.js` (crosscheck section, ~40 cases) |
| `format-detect.js` | `tests/format-detect.test.js` (~30 cases) |
| `behavior/` | `tests/behavior.test.js` |
| Any new message key | manually check 3 locales (`messages/{en,uk,ru}.json`) — there's no test that enforces this; *yet* |

**Total suite**: 381 tests (as of 2026-05-09 v0.13.0). Run `node --test tests/` from repo root, ~7s.

---

## 2. Deploy chain (the stuff that bites you)

### 2.1 What rebuilds vs what doesn't

**Bind-mounted** (live edit, `compose restart` if Node-cached, browser refresh otherwise):
- `./public/` → `/app/public/`
- `./packages/` → `/app/packages/` (read-only)
- `./intel-llm.js` → `/app/intel-llm.js` (read-only)
- `./samples/` → `/app/samples/` (read-only) — added 2026-05-09 after the trap below

**Baked into image** (requires `docker compose up -d --build`):
- `server.js` ← BIG TRAP. Edit it → must rebuild.
- `tests/` (not consumed at runtime, but worth knowing)
- `Dockerfile`-installed deps
- Anything else not in the bind-mount list above

> If you edit `server.js`, you MUST `compose up -d --build`.
> `compose restart` won't pick it up.

### 2.2 Public exposure

```
Browser (https://spyglass.kyivtech.com.ua)
    │
    ▼  Cloudflare (DNS + edge)
    │
    ▼  CF Tunnel → 192.168.1.4
    │
    ▼  kyivtech-portal (host network) — proxies admin tiles
    │  PUBLIC_PROXIES=Set(['spyglass']) anon-allowed
    │  src/routes/admin/proxies.js, src/config.js (PROXY_TARGETS)
    │
    ▼  127.0.0.1:8090 → adtech-spyglass container :3000
```

**So**: any URL change in spyglass affects portal's proxy paths. Re-test BOTH `localhost:8090/...` (direct) AND `https://spyglass.kyivtech.com.ua/...` (full chain) after deploy.

### 2.3 Cross-stack dependencies of Spyglass

| Spyglass needs... | From... | How it connects |
|---|---|---|
| LLM (intel) | `ollama` container | shared docker network `ollama_default`, `OLLAMA_URL=http://ollama:11434` |
| Design system CSS | `kyivtech-portal` | bind mount `kyivtech-portal/public/design-system.css:/app/public/design-system.css:ro` |
| Persistent SQLite | host fs | `/srv/DATA/AppData/adtech-spyglass:/data` |
| Email (recovery key, verify) | Resend | `RESEND_API_KEY` from `.env` (gitignored) |
| Health monitoring | `uptime-kuma` | HTTP probe of public URL |

### 2.4 SemVer bump locations (9 files, do all in one commit)

Per `feedback_spyglass_semver_bump.md`:
1. `package.json` (root, app version)
2. `packages/core/package.json` (engine version)
3. `public/version.js` (browser-side `VERSION` constant)
4-6. `public/about.{en,uk,ru}.html` (eyebrow + footer span × 2 each = 2 spots × 3 locales, but search is `v9.X.Y`)
7-9. `public/modules/inspector/template.{en,uk,ru}.html` (topnav brand + footer #engineVer × 3 locales)

Use `version.js` for runtime paint via `data-spyglass-version`, but the static fallback strings in HTML still need to bump (browsers without JS see them, and bundle metadata in `export.js` reads `#engineVer.textContent`).

---

## 3. Surrounding stack pointers

### 3.1 Validator-aware components elsewhere

- **kyivtech-portal**:
  - `src/services/stats.js:96` — `Spyglass RTB` health tile
  - `src/routes/admin/proxies.js` — `PUBLIC_PROXIES = new Set(['spyglass'])` makes the tile anon-public
  - `src/routes/bot/index.js:49` — Telegram bot status command lists `adtech-spyglass`
- **uptime-kuma** monitor on `https://spyglass.kyivtech.com.ua`
- **n8n**: no direct integration today (Mozok bot doesn't call validator)

### 3.2 Schema / migration reminders for adjacent data

- `news` Postgres DB: `items` table — `hot_score` column DROPPED 2026-05-09 (was always 0). `hot_score_llm` (LLM 0..1) is the live signal. `news_schema.sql` is the source-of-truth doc.
- ClickHouse OLAP: `analytics.news_events` mirrors `items` minus `hot_score`. CH script: `/srv/DATA/Stacks/clickhouse/scripts/replicate-news.sh`.

---

## 4. "Things that broke last time" (chronological warnings)

| When | What | Root cause | How to avoid |
|---|---|---|---|
| 2026-05-09 sprint 1 | Pre-existing test broke after rule rename `response.seatbid_required` → `response.seatbid_or_nbr_required` | yesterday's P1 bundle renamed the rule, didn't update the test | grep `tests/` for the OLD rule id BEFORE renaming |
| 2026-05-09 sprint 1 | dedup `count` collided with `crosscheck.bid.native_complete` domain `count` | I assumed `count` was free | grep messages for `{count}` BEFORE introducing a synthetic param of the same name |
| 2026-05-09 sprint 1 | `disabledRules` ignored by `/api/analyze` despite working in core | `server.js` baked-in, not bind-mounted | always check whether the file is bind-mounted; baked = `--build` |
| 2026-05-09 sprint 2 (VAST) | `/api/v1/sample?type=vast-broken-inline` returned random sample | `samples/` baked-in, new files invisible to running container | rebuild after adding samples; future fix: bind-mount `samples/` |
| 2026-05-04 | n8n `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` → Mozok 100% fail | env-access flag default changed; agent code couldn't read tokens | for any code-node that reads env, verify the flag |

---

## 5. Time-estimate calibration

Estimates that ignore the connection-audit + regression-test + rollback verification phases are wrong by 1.5-2×. For Spyglass, multiply pure-coding estimates by 1.5 minimum, plus add:

- +0.5h connection-audit BEFORE (grep callers + tests + deploy chain)
- +0.5h SemVer bump + CHANGELOG + map update
- +1h regression test + smoke through public URL + rollback path

**Realistic floors** (revised from validator-roadmap-2026-05-09.md):

| Item | Original est | Honest est | Actual | Why |
|---|---|---|---|---|
| ① API stability | 3-4h | 3-4h ✓ | ~2.5h | done; small surface, accurate |
| ② Tier 1 + drop hot_score | 2h | 2h ✓ | ~1h | done; smaller than expected (column already had 0 non-zero rows) |
| ③ VAST validation (minimal) | 1-2 days | **2-3 days** | ~3h | done at REDUCED scope (8 rules vs 13). User chose minimal; defers VPAID/ad-pod/Linear duration/OMID. |
| ④ oRTB 3.0 routing (request-only, minimal) | 1 day | **1.5-2 days** | ~2.5h | done at REDUCED scope — request envelope + item shape only. Pre-flight cut the honest estimate. |
| Functional close (v0.14.0): 4 VAST rules + 3.0 response + sniffer consolidation | 4-5h | **4-5h** | ~3h | done; closes the deferrals from items ③ and ④. Only AdCOM 1.0 deep validation remains intentionally deferred (no production 3.0 traffic yet). |
