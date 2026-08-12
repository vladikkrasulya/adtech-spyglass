# ortbtools — Operations Runbook

Maintainer: Vladik. Machine: `vkbox`, Debian 13, LAN `192.168.1.6`,
Tailscale `100.86.20.34`. Stack root: `/srv/DATA/Stacks/ortbtools/`.

---

## TL;DR — Quick Reference

- **Public URL**: `https://ortbtools.com/`
- **Health endpoint**: `curl -s http://127.0.0.1:8090/api/health | python3 -m json.tool`
  — returns `{"success": true, "status": "ok", "checks": {"db": true}, "build": {"sha": "..."}}`
- **Container name**: `ortbtools` — check: `docker ps --filter name=ortbtools`
- **App is down → first command**: `docker logs ortbtools --tail 100`
- **Logs**: `docker logs ortbtools --tail 200 -f` (container stdout/stderr via pino)
- **SQLite DB**: `/srv/DATA/AppData/ortbtools/ortbtools.db` (WAL mode — also
  `ortbtools.db-shm` + `ortbtools.db-wal` in the same dir, all three are live state)
- **Latest backup**: `/srv/DATA/Backups/ortbtools/ortbtools-$(date +%Y-%m-%d).db.gz`
  — daily at 03:30 via `/etc/cron.d/ortbtools-backup`
- **Restart**: `cd /srv/DATA/Stacks/ortbtools && docker compose restart`
- **Secrets vault**: `/srv/DATA/.secrets/api-tokens.env` (mode 0600, owner vk)

---

## 1. Architecture Overview

Single application container `ortbtools` built from the local repo. It has no
app-managed Postgres, Redis, or queue. ClickHouse is an optional external
persistent dependency for analytics and news/blog data; those features no-op
without credentials.

```
[internet] → CF edge → cloudflared (host process, /etc/cloudflared/config.yml)
   │
   ├─ hostname ortbtools.com  ─────────────→ http://localhost:8090   (direct)
   └─ hostname kyivtech.com.ua ─→ kyivtech-portal (host net, :3000)
                                     │ PORTAL_PROXY_TARGETS: ortbtools=http://127.0.0.1:8090
                                     └→ ortbtools
                                            └→ ClickHouse on kt-shared (optional)

               ...:8090 → docker-proxy → container :3000
                          ^^^^^^^^^^^^ re-originates the connection:
                          the container's TCP peer is the bridge GATEWAY
                          (172.24.0.1), NEVER loopback
```

**`ortbtools.com` does not go through the portal.** cloudflared has its own ingress
rule sending that hostname straight to `localhost:8090`. The portal is in the path
only for `kyivtech.com.ua/ortbtools-proxy/*`. An older revision of this section said
otherwise, and the same stale assumption in a code comment is what made every
per-IP limiter bucket the whole internet together until v1.6.1 — see §4.10.

The portal still exposes ortbtools in two ways of its own:

1. **`/ortbtools-proxy/*`** — public reverse-proxy mount (no auth gate, since 2026-05-09).
2. **`/api/admin/ortbtools`** — admin-only data surface used by the portal admin dashboard
   (reads ortbtools's SQLite read-only via bind-mount at `/app/ortbtools-data/`).

`kyivtech-portal` runs with `network_mode: host` so `http://127.0.0.1:8090` resolves
directly. ortbtools is on Docker's default bridge and publishes only to
`127.0.0.1:8090` — never to `0.0.0.0`. Because that publish is what re-originates
the connection, **no** caller reaches the container from loopback, whichever path it
took; `ORTBTOOLS_TRUSTED_PROXIES` is what makes the forwarded address usable (§4.10).

**SQLite** is the application's only mounted local store: one WAL-mode database
whose schema is auto-applied at startup by `db.js`. When `CLICKHOUSE_*`
credentials are configured, ClickHouse separately persists derived analytics,
news drafts, and published blog records. The `/data` backup procedure in this
runbook covers SQLite and persisted Markdown content only; ClickHouse backup and
restore belong to that external stack's operations. There is no Postgres or
Redis service to manage for ortbtools.

For the as-built architecture, read the
[platform baseline](../specs/000-platform-baseline/plan.md) and its
[release/deploy contract](../specs/000-platform-baseline/contracts/release-deploy.md).

---

## 2. Bind-Mount Layout

All volumes are defined in `docker-compose.yml`. Each one has different operational
implications — know these before touching files.

**Immutable image (v1.1.5+).** ALL source — `server.js`, `db.js`, `auth.js`,
`modules/`, `packages/`, `public/`, `samples/`, `lib/`, and the `content/posts`
seed — is **baked into the image** at build time (`COPY . .`, filtered by
`.dockerignore`). There are **no source bind-mounts**, so a host edit can no
longer change production out of band and the deployed image is a complete
snapshot of the release. To change source: commit to `main`, then redeploy (§9).
`docker compose restart` no longer reloads source.

Since v1.1.6 exactly **one** host path is mounted:

| Host path                     | Container path | RW  | Purpose                                                           |
| ----------------------------- | -------------- | --- | ----------------------------------------------------------------- |
| `/srv/DATA/AppData/ortbtools` | `/data`        | RW  | Persistent SQLite + `content-posts/` (blog) — **never lose this** |

**The `/data` mount** holds `ortbtools.db` + `-wal`/`-shm` (live SQLite WAL state)
and `content-posts/` (persistent blog content; the container reads it via
`CONTENT_DIR=/data/content-posts`). Never copy only `ortbtools.db` without the WAL
files. The backup script archives both (§6).

**`design-system.css`** is vendored byte-for-byte into the image
(`public/design-system.css`; provenance + update procedure in
`design-system.vendor.json`) and served from the baked copy — there is **no portal
bind-mount** any more (the transitional overlay was removed in v1.1.6; the rollback
target, the v1.1.5 image, also bakes the full CSS). The container is fully
self-contained. To update the design system, re-vendor per the manifest, bump the
patch version, and redeploy (§9.3) — production never follows the portal copy live.

---

## 3. The Bind-Mount Inode Gotcha (mostly historical)

Since v1.1.5 the image is immutable and all source is baked, so the classic inode
gotcha (an atomic host edit to a bind-mounted source file not being visible in the
container) **no longer applies to source** — source changes ship only via a
rebuild+redeploy (§9).

Since v1.1.6 there are **no file-level bind-mounts at all** — the transitional
`design-system.css` overlay was removed, so the inode trap is fully retired. The
single remaining mount is the `/data` **directory** (persistent SQLite + content),
which is not subject to this gotcha. Historically the trap affected selected
source directories and the portal `design-system.css` (through v1.1.5) — none
are mounted any more.

---

## 4. Common Ops Tasks

### 4.1 Restart (no rebuild)

Use only to recover from a transient crash. It does **not** pick up source or CSS
changes — everything is baked into the image (there are no bind-mounts left except
the `/data` data directory).

```bash
cd /srv/DATA/Stacks/ortbtools && docker compose restart
```

### 4.2 Any source / dependency / CSS change → redeploy (§9)

Since v1.1.5 every change to `server.js`, `db.js`, `auth.js`, `modules/`,
`packages/`, `public/`, `samples/`, `lib/`, `package.json`, or the vendored
`design-system.css` ships only by building a new immutable image. Use the deploy
script (gate + build + smoke + auto-rollback):

```bash
cd /srv/DATA/Stacks/ortbtools
git checkout main && git pull --ff-only
./scripts/deploy.sh
```

See §9 for the full flow and rollback.

### 4.3 View logs

```bash
docker logs ortbtools --tail 200 -f
```

Logs are JSON (pino). For a specific time window:

```bash
docker logs ortbtools --since 1h 2>&1 | grep -i "error\|warn"
```

The container does not write to any host log file. All output goes to Docker's default
json-file log driver. If you need persistent log files, add a `logging:` stanza to
`docker-compose.yml` or redirect `docker logs` to a file in the cron log setup.

### 4.4 Open SQLite shell

```bash
sqlite3 /srv/DATA/AppData/ortbtools/ortbtools.db
```

Useful commands inside the shell:

```sql
.tables
.schema users
SELECT count(*) FROM users;
SELECT count(*) FROM sessions WHERE expires_at > strftime('%s','now')*1000;
```

The DB runs in WAL mode. The `ortbtools.db-shm` and `ortbtools.db-wal` files in the
same directory are part of the live state. `sqlite3` handles WAL transparently — you
do not need to stop the container to run read queries, but be aware that writes from
the shell while the container is running can race with the app.

### 4.5 Reset or recover a user's password

Use the application's Forgot Password flow. It preserves the security invariants and
invalidates sessions atomically:

- `rotate` re-wraps the existing DEK when the user can unlock it;
- `recover` uses the one-time recovery key to unwrap and re-wrap the existing DEK;
- `wipe` is the explicit lost-password-and-recovery-key path. It changes the password,
  clears crypto state, and deletes samples, partners, custom dialects/mappings,
  analyze history, Behavior Corpus rows, and sessions while keeping the account email.

Do **not** update `password_hash` or null crypto columns directly in SQLite. That
unsupported shortcut leaves existing sessions valid, bypasses the atomic reset logic,
and can make web-UI-encrypted bid bodies permanently unreadable even when the user has
a recovery key. For a disposable test account, use the application's `wipe` mode so
the deletion and session invalidation happen together.

### 4.6 Force-clear all anonymous / expired sessions

Sessions expire naturally — `expires_at` is checked on every request. But after a
security incident you may want to force-invalidate immediately.

```bash
sqlite3 /srv/DATA/AppData/ortbtools/ortbtools.db
```

```sql
-- Delete all expired sessions (housekeeping, safe any time):
DELETE FROM sessions WHERE expires_at <= strftime('%s','now')*1000;

-- Delete ALL sessions (force logout of every logged-in user):
-- DESTRUCTIVE — confirm this is what you want.
DELETE FROM sessions;
```

### 4.7 Invalidate a specific session (stolen-cookie scenario)

The `token` column in `sessions` is the opaque session token value stored in the
browser cookie. You need the token value — either from the cookie itself (if you have
access to the victim's browser dev tools) or from DB inspection.

```bash
sqlite3 /srv/DATA/AppData/ortbtools/ortbtools.db
```

```sql
-- List sessions for a user to identify the suspicious one:
SELECT token, ip, ua, datetime(created_at/1000, 'unixepoch') AS created,
       datetime(expires_at/1000, 'unixepoch') AS expires
FROM   sessions
WHERE  user_id = (SELECT id FROM users WHERE email = 'victim@example.com')
ORDER  BY created_at DESC;

-- Delete the specific session:
-- DESTRUCTIVE
DELETE FROM sessions WHERE token = '<token_value>';

-- Or delete all sessions for that user (log them out everywhere):
-- DESTRUCTIVE
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'victim@example.com');
```

Also rotate `EMAIL_TOKEN_SECRET` in the vault and restart if the leak included
password-reset / email-verify tokens (stateless HMAC — rotation invalidates all
outstanding tokens of that type).

### 4.8 Pause / resume the news+blog pipeline (whole-pipeline kill-switch)

`NEWS_CRAWLER_DISABLED=1` is an **emergency whole-pipeline kill-switch**: it stops
the hourly scheduler that does RSS crawl → draft ingest → AI moderation →
auto-publish (all of it, not just publishing). It is the supported way to stop
new thin/auto-news posts from appearing. It leaves existing drafts and posts
untouched and rejects nothing.

> Do **not** use `BLOG_MAX_PER_DAY=0` to pause — `Number('0') || 3 === 3`, so it
> is a no-op (same falsy-default bug on `BLOG_RELEVANCE_MIN`/`BLOG_MODERATE_BATCH`).

The flag is read once at boot (`server.js`), passed into the container via the
`.env` `env_file`, so toggling it requires a **container recreate** (not a bare
restart). It is NOT an image rebuild.

```bash
cd /srv/DATA/Stacks/ortbtools
# PAUSE — set the flag atomically (preserves .env 0600/owner) and recreate
. scripts/deploy-lib.sh && set_env NEWS_CRAWLER_DISABLED 1 .env
ORTBTOOLS_TAG="$(grep -E '^ORTBTOOLS_TAG=' .env | cut -d= -f2)" docker compose up -d --no-build

# VERIFY paused
docker inspect ortbtools --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^NEWS_CRAWLER_DISABLED='
docker logs ortbtools 2>&1 | grep -c 'news crawler scheduled'   # expect 0 (scheduler never started)

# RESUME — set the flag back to 0 atomically (preserves .env 0600/owner) and recreate.
# `0` resumes because server.js gates on `NEWS_CRAWLER_DISABLED !== '1'`, so 0 is
# equivalent to removing the line — but set_env keeps perms/owner and never leaves
# a half-written .env, unlike an in-place `sed -i`.
. scripts/deploy-lib.sh && set_env NEWS_CRAWLER_DISABLED 0 .env
ORTBTOOLS_TAG="$(grep -E '^ORTBTOOLS_TAG=' .env | cut -d= -f2)" docker compose up -d --no-build
```

To pause ONLY publishing while keeping crawl/ingest running, a separate
`BLOG_AUTO_PUBLISH_DISABLED` flag (gating just `moderatePendingDrafts()`) would be
needed — not yet implemented.

### 4.9 Disable ClickHouse-derived telemetry (self-host / privacy)

Anonymous analyze metadata (`validation_logs`) and the operational request log
(`event_log`) write to ClickHouse only when `CLICKHOUSE_USER` is set **and**
`ORTBTOOLS_ANALYTICS_DISABLED` is not `1`.

```bash
cd /srv/DATA/Stacks/ortbtools
# Option A: leave CLICKHOUSE_USER empty in .env (default for local dev).

# Option B: explicit opt-out on production-like stacks:
. scripts/deploy-lib.sh && set_env ORTBTOOLS_ANALYTICS_DISABLED 1 .env
ORTBTOOLS_TAG="$(grep -E '^ORTBTOOLS_TAG=' .env | cut -d= -f2)" docker compose up -d --no-build
```

Verify: run an analyze, then confirm no new rows in `analytics.validation_logs` for
that window. Cabinet `analyze_log` (signed-in users) still records metadata in SQLite.

Full contract: `docs/PRIVACY.md` → "Self-hosting: disabling derived telemetry".

### 4.10 Product telemetry — provisioning and analysis

Anonymous product counters (`lib/product-telemetry.js`) answer "how many REAL people
use this, and do they come back". They live in their own ClickHouse table and store
no payload, no IP address and no User-Agent string — see `docs/PRIVACY.md` →
"Product telemetry" for the full field contract.

**One-time table creation.** The app never issues DDL; create the table once with a
CH account that has `CREATE TABLE` on the `analytics` database.

```bash
docker exec -i clickhouse clickhouse-client --multiquery <<'SQL'
CREATE TABLE IF NOT EXISTS analytics.ortbtools_product_events
(
  ts            DateTime64(3) DEFAULT now64(),
  event         LowCardinality(String),
  traffic_class LowCardinality(String) DEFAULT '',
  is_external   UInt8 DEFAULT 0,
  visitor_id    String DEFAULT '' CODEC(ZSTD(3)),
  session_id    String DEFAULT '' CODEC(ZSTD(3)),
  user_id       UInt32 DEFAULT 0,
  locale        LowCardinality(String) DEFAULT '',
  surface       LowCardinality(String) DEFAULT 'web',
  ua_class      LowCardinality(String) DEFAULT 'unknown',
  referrer_host String DEFAULT '' CODEC(ZSTD(3)),
  utm_source    LowCardinality(String) DEFAULT '',
  utm_medium    LowCardinality(String) DEFAULT '',
  utm_campaign  LowCardinality(String) DEFAULT '',
  dnt           UInt8 DEFAULT 0,
  app_version   LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (is_external, ts)
TTL toDateTime(ts) + toIntervalDay(180)
SETTINGS index_granularity = 8192;
SQL
```

Notes on the shape, since it deviates from `ortbtools_events` in two places:

- `PARTITION BY toYYYYMM(ts)` — this table takes a row per page view, so it grows
  much faster than the event log. Monthly partitions let the 180-day TTL drop whole
  parts instead of rewriting them row by row.
- `ORDER BY (is_external, ts)` — every product query starts with
  `WHERE is_external = 1 AND ts >= …`, so the primary index prunes on both.
- The `DEFAULT`s exist only so a hand-written partial `INSERT` cannot fabricate a
  real user: `traffic_class` defaults to `''` and `is_external` to `0`. The
  application always writes every column explicitly.

180 days is the floor for the D30 curve: a cohort must still have its acquisition row
in range 30 days after the fact, with room to plot a trend. It matches
`RETENTION_DAYS` in `lib/product-telemetry.js`.

**Trusted proxy — required, or every visitor counts as internal.** The published
port (`127.0.0.1:8090 -> 3000`) makes Docker's userland proxy re-originate every
connection, so the container's TCP peer is the bridge **gateway**, never loopback:

```
Cloudflare edge → cloudflared (host) → 127.0.0.1:8090 → docker-proxy → container
                                                          peer = 172.24.0.1
```

`lib/client-ip.js` therefore believes `CF-Connecting-IP` / `X-Forwarded-For` only
from a peer listed in `ORTBTOOLS_TRUSTED_PROXIES`. Leave it empty and the forwarded
header is discarded, every real visitor resolves to a private address, and
`is_external` is 0 forever.

Find the peer the app actually sees, then set it:

```bash
# Which addresses does the app currently record as the client?
docker exec clickhouse clickhouse-client -q \
  "SELECT ip, count() FROM analytics.ortbtools_events \
   WHERE ts >= now() - INTERVAL 1 DAY AND component='http' GROUP BY ip ORDER BY 2 DESC"
# All-private output means the forwarded header is being dropped.

. scripts/deploy-lib.sh && set_env ORTBTOOLS_TRUSTED_PROXIES "172.24.0.1" .env
ORTBTOOLS_TAG="$(grep -E '^ORTBTOOLS_TAG=' .env | cut -d= -f2)" docker compose up -d --no-build
```

Keep the list as narrow as the real hop. Anything able to connect from a trusted
address can claim any client IP, and therefore any rate-limit bucket; here that is
the Docker gateway, reachable only by host processes through the published port. No
authentication or authorization decision reads this value — it selects a throttling
bucket and labels a log row.

**This setting is app-wide, not telemetry-only.** `lib/client-ip.js` is the single
client-address rule, and `auth.clientIp()` delegates to it, so the same value also
governs:

| Consumer                                               | What it keys                               |
| ------------------------------------------------------ | ------------------------------------------ |
| `auth.js`                                              | login / register / reset / verify limits   |
| `modules/{analyze,mirror,replay,intel,blog,analytics}` | per-IP request limits                      |
| `modules/stream`                                       | concurrent SSE connections per IP          |
| `modules/sentry-ingest`                                | GlitchTip ingest limit                     |
| `server.js` → `event_log`, `auth.js` → `sessions`      | the recorded client address                |
| `lib/product-telemetry.js`                             | traffic classification (address discarded) |

Leaving it unset does not merely blank the product metrics — it collapses every
per-IP limiter into one shared bucket for the whole internet. Verify after setting
it that real addresses now appear:

```bash
docker exec clickhouse clickhouse-client -q \
  "SELECT ip, count() FROM analytics.ortbtools_events \
   WHERE ts >= now() - INTERVAL 1 HOUR AND component='http' GROUP BY ip ORDER BY 2 DESC LIMIT 10"
# Expect a spread of public addresses, not one private one.
```

**Excluding your own traffic.** Set these in `.env` and recreate the container. All
three are optional and additive; without them, your own browsing counts as a user.

```bash
. scripts/deploy-lib.sh
set_env ORTBTOOLS_OWNER_IPS "203.0.113.45,198.51.100.0/24" .env   # exact IPv4, CIDR, literal IPv6
set_env ORTBTOOLS_OWNER_USER_IDS "1" .env                          # your own account id(s)
ORTBTOOLS_TAG="$(grep -E '^ORTBTOOLS_TAG=' .env | cut -d= -f2)" docker compose up -d --no-build
```

For a browser on a changing address, visit `https://ortbtools.com/?__ot_internal=1`
once — it sets a sticky localStorage flag and every later event from that browser is
filed as `internal`. Clear with `?__ot_internal=0`. To stop sending entirely (rather
than reclassifying), use `?__ot_optout=1`.

Automated callers can declare themselves with a header instead:
`X-Ortbtools-Traffic: ci` (also accepts `agent`, `monitor`, `internal`, `owner`, `bot`).
The header can only move a request OUT of `external` — it can never promote one in.

**The usage table — "how many people, per day / week / month".**

```bash
./scripts/usage-report.sh              # last 30 days, 12 weeks, 12 months
./scripts/usage-report.sh --days 90    # widen the daily table
./scripts/usage-report.sh --all        # add the traffic-class split
```

It reads `analytics.ortbtools_usage_daily`, an AggregatingMergeTree rollup kept
current by a materialized view on the raw events. Create both once, alongside the
table above:

```bash
docker exec -i clickhouse clickhouse-client --multiquery <<'SQL'
CREATE TABLE IF NOT EXISTS analytics.ortbtools_usage_daily
(
  day             Date,
  traffic_class   LowCardinality(String),
  visitors_state  AggregateFunction(uniq, String),
  sessions_state  AggregateFunction(uniq, String),
  events          UInt64,
  analyses        UInt64,
  registrations   UInt64,
  macro_uses      UInt64,
  share_uses      UInt64
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (day, traffic_class);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.ortbtools_usage_daily_mv
TO analytics.ortbtools_usage_daily AS
SELECT
  toDate(ts)                                                            AS day,
  traffic_class,
  uniqStateIf(visitor_id, visitor_id != '')                             AS visitors_state,
  uniqStateIf(session_id, session_id != '' AND event = 'session_start') AS sessions_state,
  count()                                                               AS events,
  countIf(event = 'analyze_success')                                    AS analyses,
  countIf(event = 'register')                                           AS registrations,
  countIf(event = 'macro_use')                                          AS macro_uses,
  countIf(event = 'share_use')                                          AS share_uses
FROM analytics.ortbtools_product_events
GROUP BY day, traffic_class;
SQL
```

Two properties this shape exists for, both easy to get wrong:

- **It outlives the raw data.** `ortbtools_product_events` drops rows after 180
  days; the rollup has no TTL, so "visitors in March" stays answerable next year.
- **Unique visitors do not add up.** Someone who visits Monday and Tuesday is ONE
  weekly visitor, not two — a weekly number can never be the sum of daily numbers.
  Storing `uniqState` (not a count) lets `uniqMerge` recompute the true distinct
  figure at day, week or month grain. Verified against a fixture where the naive
  sum reports 3 and the correct answer is 2.

A materialized view only sees rows inserted after it exists. If it is ever
recreated, backfill the gap explicitly:

```bash
docker exec -i clickhouse clickhouse-client -q "
INSERT INTO analytics.ortbtools_usage_daily
SELECT toDate(ts), traffic_class,
       uniqStateIf(visitor_id, visitor_id != ''),
       uniqStateIf(session_id, session_id != '' AND event = 'session_start'),
       count(), countIf(event='analyze_success'), countIf(event='register'),
       countIf(event='macro_use'), countIf(event='share_use')
FROM analytics.ortbtools_product_events
WHERE toDate(ts) BETWEEN '2026-08-12' AND '2026-08-31'
GROUP BY toDate(ts), traffic_class"
# Delete the same day range from the rollup first, or the counts double.
```

**Reading the funnel.** The operator endpoint is gated by the same Bearer token as
`/api/admin/stats`:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_STATS_TOKEN" \
  'https://ortbtools.com/api/v1/telemetry/summary?days=30' | jq
```

It returns `traffic` (the class split — proof that monitoring and owner traffic are
excluded), `activation`, `repeat_usage`, `retention` (per-cohort D1/D7/D30 with
`mature` flags) and `daily`. A cohort younger than N days reports `mature: false` for
D-N; treat that as "unknown", not as 0%.

The same numbers straight from ClickHouse, if the endpoint is unavailable:

```sql
-- Activation: external visitors who ever completed an analysis.
SELECT uniqExact(visitor_id) AS visitors,
       uniqExactIf(visitor_id, has(events, 'analyze_success')) AS activated
FROM (
  SELECT visitor_id, groupUniqArray(event) AS events
  FROM analytics.ortbtools_product_events
  WHERE is_external = 1 AND visitor_id != '' AND ts >= now() - INTERVAL 30 DAY
  GROUP BY visitor_id
);

-- Repeat usage: external visitors active on 2+ distinct days.
SELECT uniqExact(visitor_id) AS visitors,
       uniqExactIf(visitor_id, active_days >= 2) AS repeat_visitors
FROM (
  SELECT visitor_id, uniqExact(toDate(ts)) AS active_days
  FROM analytics.ortbtools_product_events
  WHERE is_external = 1 AND visitor_id != '' AND ts >= now() - INTERVAL 30 DAY
  GROUP BY visitor_id
);

-- D1/D7/D30 retention by acquisition day.
SELECT d0 AS cohort_date,
       uniqExact(visitor_id) AS cohort_size,
       uniqExactIf(visitor_id, has(days, d0 + 1))  AS d1,
       uniqExactIf(visitor_id, has(days, d0 + 7))  AS d7,
       uniqExactIf(visitor_id, has(days, d0 + 30)) AS d30
FROM (
  SELECT visitor_id, min(toDate(ts)) AS d0, groupUniqArray(toDate(ts)) AS days
  FROM analytics.ortbtools_product_events
  WHERE is_external = 1 AND visitor_id != '' AND ts >= now() - INTERVAL 180 DAY
  GROUP BY visitor_id
)
GROUP BY d0 ORDER BY d0 DESC;

-- Who is actually hitting us (the exclusion proof). The empty visitor_id
-- (DNT / storage blocked) is skipped so it is not counted as one shared visitor.
SELECT traffic_class, count() AS events,
       uniqExactIf(visitor_id, visitor_id != '') AS visitors
FROM analytics.ortbtools_product_events
WHERE ts >= now() - INTERVAL 30 DAY
GROUP BY traffic_class ORDER BY events DESC;
```

**Verify after a deploy:**

```bash
# 204 with an empty body, whether or not ClickHouse is configured.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: text/plain' -H 'sec-fetch-site: same-origin' \
  --data '{"event":"landing"}' https://ortbtools.com/api/v1/telemetry/event   # → 204

# Rows landing, and none of them classed as a real user for a curl caller.
docker exec -i clickhouse clickhouse-client -q \
  "SELECT traffic_class, count() FROM analytics.ortbtools_product_events
   WHERE ts >= now() - INTERVAL 10 MINUTE GROUP BY traffic_class"
```

**Pause just this table** (keeps `validation_logs` and `event_log` running):

```bash
. scripts/deploy-lib.sh && set_env ORTBTOOLS_PRODUCT_TELEMETRY_DISABLED 1 .env
ORTBTOOLS_TAG="$(grep -E '^ORTBTOOLS_TAG=' .env | cut -d= -f2)" docker compose up -d --no-build
```

---

## 5. Secrets Management

### 5.1 Vault location

`/srv/DATA/.secrets/api-tokens.env` — mode 0600, owner `vk`. Confirmed by:

```bash
stat /srv/DATA/.secrets/api-tokens.env
# → Access: (0600/-rw-------)  Uid: (1000/vk)
```

This file is sourced by `.bashrc` for interactive shells. The backup job
(`kt-backup-appdata.sh`) includes `/srv/DATA/.secrets` in the restic snapshot so the
vault rides the daily AppData backup and off-site sync.

### 5.2 What ortbtools reads

From `docker-compose.yml`, the container loads `env_file: - .env` (the per-project
`.env` at `/srv/DATA/Stacks/ortbtools/.env`, git-ignored). The non-secret
`CONTENT_DIR` value is set directly in the Compose service definition.

The `.env.example` documents the full key set. Variables that should live in the vault
and be referenced from `.env`:

| Var                  | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `RESEND_API_KEY`     | Transactional email (password reset, verify)           |
| `EMAIL_TOKEN_SECRET` | HMAC secret for stateless email tokens                 |
| `TG_BOT_TOKEN`       | Telegram admin alerts                                  |
| `TG_ADMIN_CHAT_ID`   | Telegram destination chat                              |
| `SENTRY_DSN`         | Optional server-side Sentry-compatible error reporting |
| `ADMIN_STATS_TOKEN`  | Bearer token for optional `/api/admin/stats` consumers |

`NODE_ENV=production`, `EMAIL_FROM`, and `PUBLIC_BASE_URL` are non-secret and can live
directly in `.env`.

### 5.3 Adding a new secret

1. Append the key=value to `/srv/DATA/.secrets/api-tokens.env`.
2. Reference it in `/srv/DATA/Stacks/ortbtools/.env`.
3. `cd /srv/DATA/Stacks/ortbtools && docker compose up -d` — this re-reads the
   env file without a rebuild.

### 5.4 Rotating a secret

Order matters — kill the old credential at the provider before updating the container:

1. Revoke the old key at the provider (Resend dashboard, Telegram BotFather, etc).
2. Generate the new key.
3. Update `/srv/DATA/.secrets/api-tokens.env`.
4. Update `/srv/DATA/Stacks/ortbtools/.env` with the new value.
5. `docker compose up -d` to apply.
6. If the rotated secret is `EMAIL_TOKEN_SECRET`: all outstanding password-reset and
   email-verify links are immediately invalidated. Users mid-reset will need to
   re-request. Acceptable trade-off for a security rotation.

---

## 6. Backups

### 6.1 Daily SQLite backup (cron)

Script: `/srv/DATA/Stacks/ortbtools/scripts/backup-db.sh`

Cron entry (`/etc/cron.d/ortbtools-backup`):

```
30 3 * * * root /srv/DATA/Stacks/ortbtools/scripts/backup-db.sh >> /var/log/ortbtools-backup.log 2>&1
```

The script uses `sqlite3 "$SRC" ".backup '$DEST'"` — this is the correct WAL-aware
backup method. It is NOT a file copy. A bare `cp ortbtools.db` taken while the app is
running risks a torn page or a snapshot that doesn't include WAL-flushed transactions.

Retention: 30 days. Output: `/srv/DATA/Backups/ortbtools/ortbtools-YYYY-MM-DD.db.gz`.
Check the log at `/var/log/ortbtools-backup.log` for failures.

Do not rely on a dated inventory in this runbook. The archives are root-only; verify the current
inventory and the cron outcome at operation time:

```bash
sudo -n find /srv/DATA/Backups/ortbtools -maxdepth 1 -type f -printf '%TY-%Tm-%Td %TH:%TM %m %u:%g %f\n' | sort
sudo -n tail -n 50 /var/log/ortbtools-backup.log
```

#### Permissions — backups & data dir (security, since v1.1.5)

The backup archives are **full copies of the SQLite store** (bcrypt password
hashes, session/email-token secrets, encrypted samples), so they are the most
concentrated secret-at-rest on the box. `backup-db.sh` therefore:

- sets `umask 077` at the top (every file/dir it creates is owner-only),
- `chmod 700` the backup directory (`/srv/DATA/Backups/ortbtools`) — fixing
  any older `0755`,
- `chmod 600` every `*.db.gz` and `content-posts-*.tar.gz` (fixing any older `0644`).

The cron job runs as **root**; the archives are `root:root 0600`. **No non-root
process consumes the backups**, so locking them down breaks nothing.

The live **data dir** (`/srv/DATA/AppData/ortbtools`) has three container
consumers — keep this in mind before tightening its modes:

| Consumer          | In-container uid | Access            | Needs                                            |
| ----------------- | ---------------- | ----------------- | ------------------------------------------------ |
| `ortbtools`       | `node` = 1000    | `/data` **rw**    | owner (uid 1000 = `vk`) read+write               |
| `kyivtech-portal` | 0 (root)         | ro `ortbtools.db` | root — bypasses host modes                       |
| `grafana`         | 472              | ro `ortbtools.db` | read via the `ortbtools-ro` **group** (GID 2472) |

**Since v1.1.7 the live DB is no longer world-readable.** A dedicated group
`ortbtools-ro` (fixed **GID 2472**) replaces the "other" read bit:

- AppData dir → `1000:ortbtools-ro` mode **`2710`** (setgid; group `--x` traverses
  to a known path but cannot list the dir);
- `ortbtools.db`/`-wal`/`-shm` → `1000:ortbtools-ro` **`0640`** (no "other");
- the app runs **`umask 027`** (v1.1.7 image) so recreated WAL/SHM stay `0640`;
- Grafana joins the group via `group_add: ["2472"]` (grafana-stack repo) and reads
  via the group — uid/mounts/networks unchanged;
- `deploy-state.env` and the stale `db.sqlite` stay `0600`; backups are untouched.
- **`content-posts/` is NOT chgrp'd** — it stays `1000:1000` and Grafana never
  reads it. The shared group governs **only** AppData traversal (`--x`) and the DB
  trio; `content-posts/` is a non-setgid subdir, so blog files the app writes there
  keep group `1000`. The provisioning is **NON-RECURSIVE** by design.

Provision with **`scripts/provision-ortbtools-ro.sh`** (root; dry-run default,
`--apply`/`--rollback`; backs up first, GID-collision guard, never `chgrp -R`,
`setpriv`-missing aborts, verify FAILS CLOSED). Rollback restores
`1000:1000`/`0644`/`0755` (also non-recursive; uses `APP_GID=1000`, not `APP_UID`).

**Deploy preflight.** `deploy.sh` runs `check_perms` (**exit 5** if
`.env`/`deploy-state.env` ≠ `0600` or data-dir/DB world-writable) AND, since
v1.1.7, `check_group` + `check_db_perms` — **always enforced, no bypass** —
aborting **exit 6** if the `ortbtools-ro` group (GID 2472) is missing/mismatched or
the AppData/DB owner·group·mode don't match the `0640`/`2710` contract. (The
`ORTBTOOLS_APP_UID`/`ORTBTOOLS_DB_GID`/`ORTBTOOLS_DB_GROUP`/`ORTBTOOLS_DIR_MODE` params
exist only so disposable tests can point at a test-owned dir/group; they cannot
disable the check.) Both run before any build/seed/transition and print only file
names + numeric owner/group/mode — never secrets or DB contents.

### 6.2 AppData restic snapshot (systemd timer)

Script: `/srv/DATA/Ops/backup/scripts/kt-backup-appdata.sh`

Runs daily at 03:00 via `kt-backup-appdata.timer`. Snapshots `/srv/DATA/AppData`
(which includes `/srv/DATA/AppData/ortbtools/`) and `/srv/DATA/.secrets` into
the restic repo at `/srv/DATA/Backups/restic-repo`. Password file:
`/etc/kt-backup.password`.

Retention policy: 7 daily, 4 weekly, 12 monthly.

After the restic snapshot, the script runs `rclone sync` to push the repo to
`gdrive:optiplex-restic` (configured in `/home/vk/.config/rclone/rclone.conf`).
Off-site replica confirmed fresh as of 2026-05-10.

**What gets backed up:**

| Data                       | Mechanism                               | Recovery path                   |
| -------------------------- | --------------------------------------- | ------------------------------- |
| `ortbtools.db` + WAL       | Both: cron `.backup` + restic           | `.gz` files or `restic restore` |
| `ortbtools.db-shm`, `-wal` | restic (file-level)                     | `restic restore`                |
| Application source         | git repo (source of truth)              | clean checkout + image rebuild  |
| Secrets vault              | `/srv/DATA/.secrets` included in restic | `restic restore`                |
| Project `.env`             | host runtime configuration              | restore or recreate explicitly  |

Application source is baked into the image and needs no separate runtime backup.
A clean Git checkout plus a rebuild recreates it.

### 6.3 Manual backup (on-demand)

```bash
sudo -n /srv/DATA/Stacks/ortbtools/scripts/backup-db.sh
# Output: /srv/DATA/Backups/ortbtools/ortbtools-$(date +%Y-%m-%d).db.gz
```

If a file for today already exists, `gzip -f` will overwrite it.

`deploy.sh` does not create, validate, or inspect a backup. Immediately before an authorized
production deployment, run the command above and verify the fresh database gzip (including a SQLite
integrity check from a temporary restore) plus the persistent-content tar archive. This is a separate
operator gate; keep its evidence with the deployment record.

### 6.4 Restore from backup

**Scenario: DB corrupt or accidental data loss, restore from gzip backup.**

```bash
# 1. Stop the container so no new writes race with the restore
cd /srv/DATA/Stacks/ortbtools && docker compose stop

# 2. Identify the backup to restore from
ls -lh /srv/DATA/Backups/ortbtools/

# 3. Copy the live DB aside (keep it until restore is confirmed good)
cp /srv/DATA/AppData/ortbtools/ortbtools.db /tmp/ortbtools-broken-$(date +%s).db

# 4. Remove WAL sidecar files (stale WAL on top of a fresh DB = corruption)
rm -f /srv/DATA/AppData/ortbtools/ortbtools.db-shm
rm -f /srv/DATA/AppData/ortbtools/ortbtools.db-wal

# 5. Restore
gunzip -c /srv/DATA/Backups/ortbtools/ortbtools-2026-05-12.db.gz \
  > /srv/DATA/AppData/ortbtools/ortbtools.db

# 6. Verify the restored DB is not corrupt
sqlite3 /srv/DATA/AppData/ortbtools/ortbtools.db "PRAGMA integrity_check;"
# Expected: ok

# 7. Start the container
docker compose start

# 8. Verify health
curl -s http://127.0.0.1:8090/api/health | python3 -m json.tool
```

**Scenario: full disk loss, fresh container from git + restic.**

```bash
# 1. Clone the repo
cd /srv/DATA/Stacks
git clone <repo_url> ortbtools

# 2. Restore the secrets vault from restic
restic --repo /srv/DATA/Backups/restic-repo \
       --password-file /etc/kt-backup.password \
       restore latest --include /srv/DATA/.secrets --target /

# Or restore from off-site:
# rclone sync gdrive:optiplex-restic /srv/DATA/Backups/restic-repo
# then restic restore as above

# 3. Recreate the project .env if it was not restored by the host backup.
# Start from .env.example, populate production values from the restored vault,
# and keep mode 0600. Do not start Compose with placeholder secrets.
cp --no-clobber .env.example .env
chmod 600 .env
$EDITOR .env

# 4. Restore AppData
restic --repo /srv/DATA/Backups/restic-repo \
       --password-file /etc/kt-backup.password \
       restore latest --include /srv/DATA/AppData/ortbtools --target /

# 5. Build, verify, and deploy through the canonical state machine. The script
# writes ORTBTOOLS_TAG and build provenance into .env after successful checks.
cd /srv/DATA/Stacks/ortbtools
./scripts/deploy.sh
```

---

## 7. Monitoring

### 7.1 Beszel (container metrics)

Hub + agent compose at `/srv/DATA/Stacks/beszel/`. Hub UI: `http://127.0.0.1:8190`
(or via Tailscale at `100.86.20.34:8190`). Container `ortbtools` should appear
in the system list. CPU, RAM, and network are tracked by the agent via Docker socket.

### 7.2 Docker healthcheck

Defined in `docker-compose.yml`:

```yaml
healthcheck:
  test: ['CMD-SHELL', 'wget -qO- --tries=1 --timeout=3 http://127.0.0.1:3000/ > /dev/null']
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 15s
```

Note: the check hits `/` not `/api/health` — the docker-compose comment explains that
ortbtools returns 404 on HEAD requests, so wget's GET against the root is used instead.
`/api/health` does a live DB ping and is the better liveness probe for manual checks:

```bash
curl -s http://127.0.0.1:8090/api/health
# Healthy: {"success":true,"status":"ok","checks":{"db":true},"build":{"sha":"<sha>"}}
# DB down: {"success":false,"status":"degraded","checks":{"db":false},...} + HTTP 503
```

Check Docker's view of the health state:

```bash
docker inspect ortbtools --format '{{.State.Health.Status}}'
# healthy | unhealthy | starting
```

### 7.3 Optional admin stats endpoint

`GET /api/admin/stats` exposes aggregate operational counts to trusted internal
automation. It requires `Authorization: Bearer <ADMIN_STATS_TOKEN>` and returns
503 when the token is not configured. The application itself is unaffected.
Consumers run outside this repository; verify their deployment separately.

### 7.4 Telegram alerts

ortbtools fires `notifyAdmin()` via `notify.js` for: uncaught exceptions, unhandled
promise rejections, and 5xx handler crashes. Rate-limited to one message per tag per
5 minutes (in-memory throttle, resets on container restart). Requires `TG_BOT_TOKEN`
and `TG_ADMIN_CHAT_ID` in `.env`. If either is missing, alerts log to stderr only.

---

## 8. Incident Playbook

### 8.1 Container is "unhealthy" or not running

```bash
# Check status
docker ps --filter name=ortbtools

# Check last 100 log lines for the error
docker logs ortbtools --tail 100

# Attempt restart
cd /srv/DATA/Stacks/ortbtools && docker compose restart

# If still unhealthy after ~30s, look at exit reason
docker inspect ortbtools --format '{{.State.ExitCode}} {{.State.Error}}'

# Hard reset (stop + start without rebuild)
docker compose down && docker compose up -d

# If the app can't start at all (bad code, missing dep), rebuild
BUILD_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
```

Escalation path: `docker logs` → `compose restart` → `compose down && up` → rebuild.

### 8.2 DB is corrupt

Signs: `/api/health` returns `"db": false`, container logs show `SQLITE_CORRUPT` or
`sqlite3` exits with an error on `PRAGMA integrity_check`.

```bash
# 1. Stop the container immediately to prevent further writes
cd /srv/DATA/Stacks/ortbtools && docker compose stop

# 2. Copy the corrupt DB aside for post-mortem
cp /srv/DATA/AppData/ortbtools/ortbtools.db /tmp/ortbtools-corrupt-$(date +%s).db

# 3. Run WAL recovery on the corrupt DB first (may be enough)
sqlite3 /srv/DATA/AppData/ortbtools/ortbtools.db "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 /srv/DATA/AppData/ortbtools/ortbtools.db "PRAGMA integrity_check;"

# If still corrupt, restore from backup (see §6.4)
```

### 8.3 Disk full at `/srv/DATA`

Storage layout: `/srv/DATA` → `/srv/DATA` (symlink to `/srv/DATA` on the host SSD).

Safe to delete first:

- `/var/log/ortbtools-backup.log` — rotates manually, can grow large if cron floods
- Old gz backups beyond 30 days (the cron handles this, but you can purge manually):
  `find /srv/DATA/Backups/ortbtools -name '*.db.gz' -mtime +30 -delete`
- Container log files: `docker system prune` (removes stopped containers + dangling
  images — do NOT use `-v` unless you intend to delete volumes)

**Never delete:**

- `/srv/DATA/AppData/ortbtools/` — live DB
- `/srv/DATA/Backups/ortbtools/` — only backup copies
- `/srv/DATA/.secrets/` — credentials, vault

Check disk usage breakdown:

```bash
du -sh /srv/DATA/AppData/* | sort -rh | head -10
du -sh /srv/DATA/Backups/* | sort -rh | head -10
docker system df
```

### 8.4 Token leak — secret pushed to GitHub or otherwise exposed

1. **Immediately revoke the leaked token at the provider** (Resend, Telegram BotFather,
   wherever it was issued).
2. **Invalidate all active user sessions** (the token may not be a session token, but
   do this as a precaution if there's any possibility of account compromise):
   ```bash
   sqlite3 /srv/DATA/AppData/ortbtools/ortbtools.db "DELETE FROM sessions;"
   ```
3. **Update the vault** with the new token:
   Edit `/srv/DATA/.secrets/api-tokens.env`, then update `.env`.
4. **Restart the container** to pick up the new env:
   ```bash
   cd /srv/DATA/Stacks/ortbtools && docker compose up -d
   ```
5. **Audit logs** for the exposure window:
   ```bash
   docker logs ortbtools --since <ISO_timestamp_of_push> 2>&1 | grep -E "error|warn|5[0-9][0-9]"
   ```
6. **Rotate `EMAIL_TOKEN_SECRET` if exposed** — all outstanding reset/verify tokens
   are invalidated. Users mid-reset need to re-request. Accept this trade-off.

---

## 9. Deployment / Release Flow (immutable image, v1.1.5+)

Since v1.1.5 there is **one** deploy path regardless of what changed (frontend,
validator, server, deps, CSS): build a new immutable image and run it. There are
no source bind-mounts, so `git pull` + `docker compose restart` no longer applies
to source — everything ships in the image.

### 9.1 Deploy

First complete the separate backup gate in §6.3. The deployment script deliberately does not create
or inspect backup archives.

```bash
cd /srv/DATA/Stacks/ortbtools
git checkout main && git pull --ff-only        # clean main == origin/main
./scripts/deploy.sh
```

`scripts/deploy.sh` performs the image transition safely after that operator prerequisite:

1. **Preflight** — refuses to run if a prior attempt was left mid-transition
   (`deploy-state.env` `STATUS` is `CANDIDATE_STARTING`/`CANDIDATE_READY`/
   `ROLLING_BACK`/legacy `DEPLOYING`; exit 7 with an explicit next-step message).
   Also refuses unless the tree is clean and `HEAD == main == origin/main`, and
   unless the candidate/previous image both satisfy the **privacy floor** (§9.1.2).
2. Tags the currently-running image as `ortbtools:rollback-pre-<BUILD_SHA>`
   — keyed by the **previous image's own immutable BUILD_SHA**, not the app
   version (§9.1.2 "SHA-keyed rollback tags") — and records that `BUILD_SHA`.
3. Builds the image with `BUILD_SHA` (short), `GIT_SHA` (full → OCI revision
   label) and `APP_VERSION` (package.json → OCI version label), tagging it
   `ortbtools:<short-sha>` + `ortbtools:v<version>`.
4. Brings the candidate up via `docker compose -f docker-compose.yml -f
docker-compose.deploy-transition.yml up -d --no-build` — the transition
   override forces `restart:'no'` for this UNVERIFIED image only (§9.1.2). `.env`
   is **not yet** touched.
5. Runs `scripts/smoke.sh` against production. **Only once wait_ready +
   smoke both pass** does it write `ORTBTOOLS_TAG=<short-sha>` to `.env` and run
   `docker update --restart=always` on the now-verified container in place (no
   recreate) — re-arming the exact behavior the base `docker-compose.yml`
   documents (a reboot or a plain `docker compose up -d` resumes the SAME,
   verified image). **On smoke failure it auto-rolls back** to
   `rollback-pre-<BUILD_SHA>` through the SAME transition override, and only
   pins `.env`/arms `always` once THAT image is verified too; prints `CRITICAL`
   and exits non-zero if the rollback also fails.

The operation is not storage-write-free: it seeds only missing EN/UK/RU files under
`/data/content-posts`, writes `deploy-state.env`, and updates `.env` only after verification. It does
not overwrite existing editorial posts or account-owned SQLite rows. The shared smoke can emit
derived validation/event telemetry and warm the synthetic specimen cache as documented by the smoke
script and the data-retention contract.

The deploy is reproducible from any clean checkout (GitHub Actions builds the same
image) — the build context is `.`, the CSS is vendored into `public/design-system.css`,
and nothing is read from `/srv/DATA/Stacks/kyivtech-portal` at build time.

### 9.1.2 Crash-safe deploy state machine, privacy floor, and rollback identity

Added by the privacy-floor-guard work (v1.2.4-line hardening). Three related
mechanisms, all in `scripts/deploy-lib.sh` / `scripts/deploy.sh` /
`scripts/rollback.sh` / `docker-compose.yml` + `docker-compose.deploy-transition.yml`:

**State machine**

```
LAST_GOOD(=ACTIVE) ──deploy──▶ CANDIDATE_STARTING ──health──▶ CANDIDATE_READY ──smoke──▶ ACTIVE
        ▲                          restart:'no'                  restart:'no'              │ arm restart:always
        │                          (fail-closed)                 (fail-closed)              │ THEN commit STATUS
        │                                                                                    ▼
        └──────────────────────────────── ROLLING_BACK ──smoke──▶ ROLLED_BACK | CRITICAL
                                           restart:'no' (fail-closed)   arm always   restart:'no' (fail-closed)
```

`LAST_GOOD` is the conceptual name for the resting state; the persisted
`deploy-state.env` field stays the literal `STATUS=ACTIVE` (kept for
backward-compatible tooling/log greps).

**Recovery per phase, if the host/dockerd/deploy.sh is killed or the box reboots:**

| `STATUS` at crash time   | What comes back on its own                                                                                                                                  | How to recover                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVE` / `ROLLED_BACK` | **Automatic and safe** — Docker's restart-manager resurrects exactly this verified container (armed `always`).                                              | Nothing to do.                                                                                                                                                                                              |
| `CANDIDATE_STARTING`     | **Nothing.** The container (if it even exists) was created via the deploy-transition override, so it carries `restart:'no'` — Docker will not resurrect it. | Investigate (`docker ps`, `cat deploy-state.env`, `curl /api/health`), then run `./scripts/rollback.sh` to restore the last verified image. Re-running `deploy.sh` directly is refused (preflight, exit 7). |
| `CANDIDATE_READY`        | **Nothing** — same as above; the candidate passed health but was never smoke-verified or committed.                                                         | Same as above.                                                                                                                                                                                              |
| `ROLLING_BACK`           | **Nothing** — the rollback attempt's own container also carries `restart:'no'` until ITS smoke passes.                                                      | Same as above — `./scripts/rollback.sh` remains the correct action even when the state already says `ROLLING_BACK`; it re-derives its target fresh.                                                         |
| `CRITICAL`               | Nothing (by design — both the candidate and rollback attempts failed).                                                                                      | Manual intervention: identify a known-good tag, `./scripts/rollback.sh <tag>`.                                                                                                                              |

**Verifying a container's ACTUAL restart policy** (do this whenever the STATUS
above looks stale, or before trusting that a host reboot will self-heal):

```bash
docker inspect ortbtools --format '{{.HostConfig.RestartPolicy.Name}}'
# → "always"  : verified, self-healing (expected steady state)
# → "no"      : an UNVERIFIED transition is in progress or was interrupted —
#               do NOT assume a reboot will bring the app back; check
#               deploy-state.env STATUS and run ./scripts/rollback.sh
```

**Never bypass `deploy.sh`/`rollback.sh` while a transition is in progress.** A
bare `docker compose up -d` (no `-f` override) issued by a human WHILE
deploy.sh's own transitional container is up can cause compose to detect a
restart-policy mismatch against the base file and force an unwanted recreate,
interrupting the script's own verification. There is no lock file — this is an
operational rule, not a technical guard: **if `deploy-state.env` `STATUS` is not
`ACTIVE`/`ROLLED_BACK`/`CRITICAL`, do not run any bare `docker compose`/`docker`
command against this service** — use `scripts/rollback.sh` only, and let
`scripts/deploy.sh`'s own preflight gate a retry.

**Deploy-transition compose override.** `docker-compose.yml` (base) keeps
`restart: always` — a plain `docker compose up -d` (routine ops, manual
recovery, whatever brings dockerd back after a reboot) is completely
unaffected. `docker-compose.deploy-transition.yml` overrides that to `'no'` and
is passed ONLY by `deploy.sh`/`rollback.sh`'s own `up` calls (via
`$COMPOSE_TRANSITION_FILES` in `scripts/deploy-lib.sh`) while bringing up an
unverified image. It is deliberately **not** named `docker-compose.override.yml`
— that literal filename is auto-merged by Compose on every plain invocation,
which would silently apply `restart:'no'` everywhere and defeat the whole point.

**SHA-keyed rollback tags.** The rollback image tag is
`ortbtools:rollback-pre-<BUILD_SHA>` — the _previous_ image's own
immutable build SHA, not `v<app-version>`. Two deploys under an unchanged/
unbumped version (a same-version retry, or a hotfix that forgot to bump SemVer)
therefore never collide on the same tag name and silently overwrite a different
commit's rollback target; a genuinely repeated deploy of the identical commit
re-tags the identical name (harmless).

**Privacy floor.** `deploy.sh`/`rollback.sh` refuse to deploy/roll back to any
image that does not descend from the immutable `PRIVACY_BASELINE_SHA` (v1.2.1,
commit `2437646` — the PII-removal release) baked into `scripts/deploy-lib.sh`.
This baseline is **not** read from `deploy-state.env` and cannot be weakened by
deleting/resetting that file; a runtime floor there may only raise the bar. See
`scripts/deploy-lib.sh`'s "Threat model / ancestry semantics" comment for the
guard's scope (it proves ancestry, not behavior — the compensating control is
the CI gate `tests/auth-event-pii.test.js`).

### 9.1.1 Security cutover (v1.1.7 — Grafana read-only SQLite permissions)

The **first** v1.1.7 deploy must change host file permissions (lock the live
SQLite to `0640 ortbtools-ro`) in lock-step with the app gaining `umask 027`. Run
the **coordinated wrapper**, NOT a bare `deploy.sh`, as the host user `vk`
(prereq: CP3A done — Grafana joined to group 2472):

```bash
cd /srv/DATA/Stacks/ortbtools
git checkout main && git pull --ff-only
./scripts/cutover-ortbtools-ro.sh            # dry-run: gates + plan, no changes
./scripts/cutover-ortbtools-ro.sh --apply    # perform the cutover
```

It gates (clean tree, Grafana in group 2472, `sudo -n`, expected current
`BUILD_SHA`, backups) → `sudo -n scripts/provision-ortbtools-ro.sh --apply`
(group + chgrp/setgid the DB trio to `0640`) → `scripts/deploy.sh` (build/deploy
v1.1.7). **Success requires full verification:** target SHA active, PID1
`Umask 0027`, the exact secure state (AppData `1000:2472/2710` + the whole
DB/WAL/SHM trio `0640`), Grafana reads, and a stranger UID denied. **Coordinated
rollback:** if v1.1.7 isn't active after a failed deploy, the wrapper rolls the
host permissions back to baseline (`0644`/`0755`), confirms baseline + Grafana
read, then returns the deploy's exit code; if v1.1.7 IS active but verification is
incomplete it records `DEGRADED` and **keeps** the perms (the app is on target);
any unconfirmed rollback/baseline is `STATUS=CRITICAL`, exit 9.

State at `/srv/DATA/AppData/ortbtools/cutover-state.env` (full snapshot,
0600): `STATUS=SECURITY_CUTOVER|DEGRADED|ROLLED_BACK|CRITICAL|ABORTED|APPLYING`,
`HOST_PERMS=APPLIED|PARTIAL|BASELINE|UNKNOWN`, `APP_DEPLOY=ACTIVE|ROLLED_BACK|FAILED`,
`ACTIVE/PREV_BUILD_SHA`, `DEPLOY_RC`, `LAST_ERROR`, timestamps.

**Manual recovery runbook**

- _Wrapper non-zero, `HOST_PERMS=BASELINE`_: app is back on v1.1.6, DB `0644`
  (Grafana reads via "other"). Fix the deploy cause, re-run `--apply`.
- _Half-state (perms `0640` but app v1.1.6)_: Grafana still reads via the group,
  but a v1.1.6 restart recreates WAL at `0644`. Run
  `./scripts/cutover-ortbtools-ro.sh --recover` to re-deploy v1.1.7.
- _`STATUS=CRITICAL` (host rollback failed)_: `sudo scripts/provision-ortbtools-ro.sh`
  (dry-run shows modes), then `sudo scripts/provision-ortbtools-ro.sh --rollback`
  (non-recursive → AppData `0755 1000:1000`, DB trio `0644 1000:1000`); confirm
  `docker exec -u 472 grafana dd if=/var/lib/grafana/ortbtools-data/ortbtools.db bs=1 count=1`
  succeeds. **Never `cp`/`mv` the live DB.**
- Later releases (v1.1.8+) use the normal `./scripts/deploy.sh` — the group +
  perms are already in place and `check_group`/`check_db_perms` enforce them.

### 9.2 Rollback

```bash
cd /srv/DATA/Stacks/ortbtools
./scripts/rollback.sh                 # → the rollback-pre-<BUILD_SHA> image from the last deploy
# or pin an explicit image:  ./scripts/rollback.sh <tag>
```

Rollback selects a previous **self-contained** image (by its SHA-keyed
`rollback-pre-<BUILD_SHA>` tag — see §9.1.2) and runs it through the SAME
crash-safe path as `deploy.sh`: `docker compose -f docker-compose.yml -f
docker-compose.deploy-transition.yml up -d --no-build` (restart:'no' until
verified; no silent rebuild), then pins `.env` and arms `docker update
--restart=always` ONLY after wait_ready + smoke both pass. It does **not** touch
git, re-add source bind-mounts, restore backups, or edit account-owned SQLite rows/editorial posts.
It does write `deploy-state.env` under `/data`, update `.env`, and run the shared smoke with its
documented derived-telemetry/cache side effects. It also enforces the privacy floor (§9.1.2) — refuses to
roll back to any image older than `PRIVACY_BASELINE_SHA`. It verifies the
expected previous `BUILD_SHA` and prints `CRITICAL` if the smoke fails.
`rollback.sh` is the designated recovery action for a stuck/mid-transition
`deploy-state.env` — it is intentionally NOT gated by `deploy.sh`'s own
preflight check.

### 9.3 Updating the vendored `design-system.css`

The CSS is baked from `public/design-system.css` (no longer auto-propagated from
the portal). To pull a new portal version, follow `design-system.vendor.json`:
re-copy the file, recompute the sha256 into the manifest, bump the app patch
version, and deploy (§9.1). The CI guard (`tests/immutable-image.test.js`) fails
if the CSS is left as the stub or the hash drifts from the manifest.

### 9.4 Verifying the deployed commit

```bash
curl -s http://127.0.0.1:8090/api/health | python3 -m json.tool   # → "build":{"sha":"<short>"}
docker image inspect ortbtools:$(curl -s http://127.0.0.1:8090/api/health \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["build"]["sha"])') \
  --format '{{json .Config.Labels}}'                               # → version + revision labels
```

The `/api/health` `build.sha` must equal `git rev-parse --short HEAD`; the image's
`org.opencontainers.image.revision` label must equal the full `git rev-parse HEAD`.

Also confirm the container is self-healing (armed, not mid-transition):

```bash
docker inspect ortbtools --format '{{.HostConfig.RestartPolicy.Name}}'   # expect: always
```

See §9.1.2 if this ever prints `no` outside of an in-progress deploy/rollback.

---

## 10. External Integrations

### 10.1 Cloudflare Tunnel (public ingress)

The tunnel terminates at `kyivtech-portal` (host port 80). All of `*.kyivtech.com.ua`
routes through it. `ortbtools.com` is not a separate tunnel route — it's
a subdomain that the portal handles at the application layer via
`PORTAL_PROXY_TARGETS: ortbtools=http://127.0.0.1:8090`.

If the public URL is unreachable but `http://127.0.0.1:8090/api/health` returns OK:
the problem is in the Cloudflare Tunnel or the portal proxy, not in ortbtools. Check
the `kyivtech-portal` container:

```bash
docker logs kyivtech-portal --tail 50
# And the portal stack:
cd /srv/DATA/Stacks/kyivtech-portal && docker compose ps
```

The Cloudflare Tunnel config lives at `/home/vk/.cloudflared/` (tunnel ID
`a6e590aa-91ca-4644-adaf-438d0d43f29b`). Tunnel token is in the vault.

### 10.2 Resend (transactional email)

Used for: email verification at signup, password-reset links.

If Resend is down or the API key is invalid, ortbtools catches the error and logs it at
`warn` level. It will also fire a Telegram alert via `notifyAdmin()` with tag
`email-send-fail`. The user's registration/reset request will return an error
explaining that the email could not be sent. No crash, no data loss.

To test Resend connectivity without a real user:

```bash
curl -s http://127.0.0.1:8090/api/health
# Then check docker logs for any email-related warnings in the last run
docker logs ortbtools --since 10m 2>&1 | grep -i "email\|resend"
```

Resend dashboard: `https://resend.com/` — use the account tied to `EMAIL_FROM`:
`ortbtools@kyivtech.com.ua`. Domain verification is via Cloudflare TXT record on
`kyivtech.com.ua`.

### 10.3 Telegram bot (admin alerts)

ortbtools pings the bot for: uncaught exceptions, unhandled rejections, 5xx crashes.
If `TG_BOT_TOKEN` or `TG_ADMIN_CHAT_ID` is missing from `.env`, alerts go to stderr
only — no crash, no impact on users.

If you stop receiving alerts: check both env vars are set, then verify the bot token
is still valid by calling the Telegram API directly:

```bash
curl "https://api.telegram.org/bot${TG_BOT_TOKEN}/getMe"
```

### 10.4 Optional admin stats consumers

Internal automation can call `GET /api/admin/stats` over `kt-shared` with the
`ADMIN_STATS_TOKEN` bearer token. A missing or mismatched token returns 503 or
401 and does not affect public application traffic. Workflow definitions and
credentials are managed outside this repository.

### 10.5 Sentry-compatible error tracking

Server-side reporting is implemented in `lib/logger.js` with `@sentry/node`.
When `SENTRY_DSN` is present and the SDK retains a valid parsed DSN,
`/api/health` reports `sentry.ready: true`; explicit handler errors and
process-level failures call `captureException()`. This flag confirms local SDK
configuration only — it does not probe target reachability or guarantee event
delivery. When the DSN is absent, invalid, or initialization fails, the
integration no-ops and health reports `ready: false` without degrading the app.

The DSN may point to Sentry or a compatible self-hosted target such as GlitchTip.
Target lifecycle and credentials live outside this repository. After changing
the DSN, recreate the container so it rereads `.env`, then verify:

```bash
curl -s http://127.0.0.1:8090/api/health | python3 -m json.tool
docker logs ortbtools --since 10m 2>&1 | grep -i sentry
```

The health response verifies local configuration only. Confirm end-to-end
delivery separately with a controlled test event and the configured target's
event view.

`sentry.ready: false` is expected for a deliberate Telegram-only deployment.
Telegram alerts remain the independent incident channel either way.

---

## Appendix: Container Network Summary

ortbtools attaches to two Docker networks:

| Network                 | Type                     | Purpose                                                  |
| ----------------------- | ------------------------ | -------------------------------------------------------- |
| `default` (stack-local) | Managed by compose       | Internal stack bridge                                    |
| `kt-shared`             | External cross-stack hub | ClickHouse + optional internal `/api/admin/stats` access |

If `kt-shared` is missing at startup, `docker compose up` will fail with
"network not found". Recreate it from one of the retained shared-infrastructure
stacks before deploying ortbtools. ClickHouse-backed analytics/blog features
also require valid `CLICKHOUSE_*` credentials; without them those features no-op.

---

_Last updated: 2026-08-12._
