# ortbtools — Operations Runbook

This runbook covers a single-host deployment of the `ortbtools` container. Site-specific
locations are written as variables: `$STACK_DIR` (the checkout that holds `docker-compose.yml`
and `.env`), `$DATA_DIR` (the directory mounted at `/data`), `$BACKUP_DIR` (where backup sets are
written) and `$APP_PORT` (the published loopback port). Set them in your shell before running a
command. The compose project and the container are `ortbtools`. Parts of this runbook were
written for earlier layouts and are kept as the right procedure for a self-hoster with that
layout: **§0 is authoritative wherever it disagrees with a later section.**

---

## TL;DR — Quick Reference

- **Public URL**: `https://ortbtools.com/`
- **Health endpoint**: `curl -s http://127.0.0.1:$APP_PORT/api/health | python3 -m json.tool`
  — returns `{"success": true, "status": "ok", "checks": {"db": true}, "build": {"sha": "..."}}`
- **Container name**: `ortbtools` — check: `docker ps --filter name=ortbtools`
- **App is down → first command**: `docker logs ortbtools --tail 100`
- **Logs**: `docker logs ortbtools --tail 200 -f` (container stdout/stderr via pino)
- **SQLite DB**: `$DATA_DIR/ortbtools.db` (WAL mode — also
  `ortbtools.db-shm` + `ortbtools.db-wal` in the same dir, all three are live state)
- **Latest backup set** (nightly, local disk): `$BACKUP_DIR/$(date +%Y-%m-%d)/` —
  `ortbtools.db.gz`, `content-posts.tar.gz`, `state.tar.gz`, `SHA256SUMS` (details: §6.0)
- **Restart**: `cd $STACK_DIR && docker compose restart`
  (a restart reuses the old image; source changes need a rebuild — §9)
- **Secrets**: `$STACK_DIR/.env` (mode 0600, git-ignored) is the only
  file ortbtools reads; never print it (§5)

---

## 0. Deployment layout

The table describes the reference layout this runbook assumes. Older sections of the runbook
describe other layouts; where a later section disagrees with this table, this table wins, and the
later text is kept because it is still the right procedure for a self-hoster with that layout.

| Topic            | Reference layout                                                                                                                                     | What older sections say                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Machine          | One Linux host running Docker Compose                                                                                                                | a different host layout                          |
| Repository       | `$STACK_DIR` (compose project `ortbtools`, container `ortbtools`)                                                                                    | same                                             |
| App data         | `$DATA_DIR` mounted at `/data`                                                                                                                       | same                                             |
| Ports            | Container `3000` is published on loopback `$APP_PORT`. Anything wider is a per-host override in an untracked compose file selected by `COMPOSE_FILE` | loopback only                                    |
| Public ingress   | A tunnel or reverse proxy in front of `$APP_PORT`, configured outside this repository (§10.1)                                                        | a host-level connector behind a portal           |
| Error tracking   | Optional Sentry-compatible target (for example self-hosted GlitchTip) reached over the shared Docker network through `SENTRY_DSN` (§10.5)            | optional, unconfigured                           |
| Alerts           | Optional Telegram (§10.3). When `TG_BOT_TOKEN` and `TG_ADMIN_CHAT_ID` are empty, `notifyAdmin()` writes `[notify:DEV]` lines to the log              | Telegram                                         |
| Email            | Resend with a verified sender domain; the API key should be send-only and restricted to that domain                                                  | another sender domain                            |
| Analytics / blog | Optional ClickHouse stack (container `clickhouse`, alias `clickhouse` on the shared network), database `analytics`                                   | "external"                                       |
| Local model      | Optional Ollama stack (alias `ollama`, CPU, model `gemma4-prod`) for the dialect labeller                                                            | GPU runner                                       |
| Backups          | A nightly job writes dated sets under `$BACKUP_DIR/YYYY-MM-DD/` (§6.0)                                                                               | root cron `scripts/backup-db.sh`, restic, rclone |
| Monitoring       | Docker healthcheck, `/api/health` and the error tracker (§7)                                                                                         | Grafana, Prometheus, a portal                    |
| Secrets          | The stack's `.env` (mode 0600)                                                                                                                       | a shared vault                                   |

Rules that apply to every operation below: a restart, recreate or rebuild of the live container,
edge or tunnel changes, scheduler changes and anything that deletes data need the operator's
explicit approval for that specific action; do not print `.env`.

---

## 1. Architecture Overview

Single application container `ortbtools` built from the local repo. It has no
app-managed Postgres, Redis, or queue. ClickHouse is an optional external
persistent dependency for analytics and news/blog data; those features no-op
without credentials.

```
[internet] → edge / tunnel (configured outside this repository)
   └─ public hostname ──→ http://localhost:$APP_PORT

127.0.0.1:$APP_PORT → docker-proxy → ortbtools container :3000
                 ^^^^^^^^^^^^ re-originates the connection: the container's TCP
                 peer is a bridge GATEWAY (the shared network's, or the
                 project network's), NEVER loopback

ortbtools ── shared network ──→ clickhouse:8123   analytics, product telemetry, blog
                       ├─→ ollama:11434      dialect labeller (CPU)
                       └─→ glitchtip:8000    error events (SENTRY_DSN)
```

The docker-proxy behaviour above is why `ORTBTOOLS_TRUSTED_PROXIES` must list **both** bridge
gateways (the shared network's and the project network's — Docker picks the
publishing network by name order, so either can be the peer): without it every
visitor resolves to one address and shares one rate-limit bucket (§4.10). Read the
real values with `docker network inspect kt-shared ortbtools_default` rather than
trusting a number written here.

**SQLite** stores the application data in one WAL-mode database
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

| Host path   | Container path | RW  | Purpose                                                           |
| ----------- | -------------- | --- | ----------------------------------------------------------------- |
| `$DATA_DIR` | `/data`        | RW  | Persistent SQLite + `content-posts/` (blog) — **never lose this** |

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
cd $STACK_DIR && docker compose restart
```

### 4.2 Any source / dependency / CSS change → redeploy (§9)

Since v1.1.5 every change to `server.js`, `db.js`, `auth.js`, `modules/`,
`packages/`, `public/`, `samples/`, `lib/`, `package.json`, or the vendored
`design-system.css` ships only by building a new immutable image. Use the deploy
script (gate + build + smoke + auto-rollback):

```bash
cd $STACK_DIR
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
sqlite3 $DATA_DIR/ortbtools.db
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

Sessions expire naturally: `expires_at` is checked on every request. Manual SQL
changes persisted rows, but authentication uses a process-local session index.
Deleting rows while the app runs does **not** immediately revoke those hot sessions.

Direct database access and destructive session deletion require explicit operator
authorization for the intended scope. For a forced revocation, stop the already
verified service before deleting rows, then start that same container. Do not use
this procedure during a deploy/rollback transition; recover that transition through
`scripts/rollback.sh` first.

Run the SQLite writer as the application UID1000 with `umask 027`, preserving
the database/WAL/SHM ownership and mode contract. Membership in `ortbtools-ro`
only grants read access and is not sufficient for this deletion.

```bash
cd $STACK_DIR
docker compose stop ortbtools
sudo -n -u '#1000' sh -c 'umask 027; exec sqlite3 $DATA_DIR/ortbtools.db'
```

```sql
-- Expired-session housekeeping (does not revoke an unexpired session):
DELETE FROM sessions WHERE expires_at <= strftime('%s','now')*1000;

-- Forced logout of EVERY user: execute only if that scope was authorized.
-- For a single session or account, use the narrower statements in §4.7 instead.
DELETE FROM sessions;
.quit
```

After the approved deletion, restart the same verified container and check health:

```bash
docker compose start ortbtools
curl -fsS http://127.0.0.1:$APP_PORT/api/health
```

Verify that affected users must sign in again. Keep `session-recovery/` in place:
a completed graceful stop drains requests and writes a clean checkpoint; startup
then hydrates only the remaining database rows. If shutdown was interrupted or
recovery state is uncertain, startup invalidates all prior sessions or fails closed.
Do not edit, print or remove the checkpoint/key or lock sidecar for selective
revocation. Moving recovery state aside belongs only to the separately authorized
database-restore procedure described under “Session recovery and restores”.

### 4.7 Invalidate a specific session (stolen-cookie scenario)

Since v1.23.0, the `sessions.token` column stores an `sr1:`-prefixed keyed lookup
identity, **not** the raw browser cookie. Comparing a copied cookie with this column
will not identify or delete its row. Do not disclose the recovery key or calculate
lookup identities outside the authentication service.

With the service stopped as in §4.6 and the deletion scope explicitly authorized,
select the account's stored identities and metadata to identify the intended row:

```sql
SELECT token, ip, ua, datetime(created_at/1000, 'unixepoch') AS created,
       datetime(expires_at/1000, 'unixepoch') AS expires
FROM   sessions
WHERE  user_id = (SELECT id FROM users WHERE email = 'victim@example.com')
ORDER  BY created_at DESC;

-- Delete only the approved stored identity returned above:
DELETE FROM sessions WHERE token = '<stored_session_identity>';

-- Alternatively, if authorized, revoke every session belonging to this account:
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'victim@example.com');
```

If the exact row cannot be identified from metadata, obtain authorization for the
account-wide scope instead of treating a raw cookie as a stored identity. Exit
SQLite, start the same verified container and verify revocation as in §4.6; retain
the recovery directory so unaffected sessions can survive a clean restart.

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
cd $STACK_DIR
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
cd $STACK_DIR
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
port (`127.0.0.1:$APP_PORT -> 3000`) makes Docker's userland proxy re-originate every
connection, so the container's TCP peer is the bridge **gateway**, never loopback:

```
edge → tunnel / reverse proxy (host) → 127.0.0.1:$APP_PORT → docker-proxy → container
                                                          peer = <bridge gateway address>
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

. scripts/deploy-lib.sh && set_env ORTBTOOLS_TRUSTED_PROXIES "<bridge gateway address>" .env
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
  -- SimpleAggregateFunction(sum, …), NOT plain UInt64: AggregatingMergeTree
  -- collapses same-key rows on merge, and a plain column keeps ONE row's value
  -- instead of the sum — counters silently shrink (bit us until 2026-08-26).
  events          SimpleAggregateFunction(sum, UInt64),
  analyses        SimpleAggregateFunction(sum, UInt64),
  registrations   SimpleAggregateFunction(sum, UInt64),
  macro_uses      SimpleAggregateFunction(sum, UInt64),
  share_uses      SimpleAggregateFunction(sum, UInt64)
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

### 4.11 ClickHouse: a least-privilege account for the application

**Status.** Recommended configuration. One correction to the obvious recipe: the settings profile
has **no** `allow_ddl = 0 CONST`. `allow_ddl = 0` also forbids lightweight `DELETE FROM`
(account-deletion purge) and `ALTER … UPDATE` on `blog_drafts`, which fail with
`QUERY_IS_PROHIBITED`. Protection rests on the grants and the host restriction instead.

**Why.** The ClickHouse stack's entrypoint creates an account from
`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD` and, with `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`, gives it
`ACCESS MANAGEMENT` and `GRANT OPTION`. If the application connects as that account, a leaked
password or any query-construction bug reaches the whole database, including creating other users.
The application never needs that, so it should run as the restricted account below and the
entrypoint-created account should stay a maintenance administrator.

**What the application does in ClickHouse** (from the code, not from the schema):

| Table                                       | Needs                                                                                    | Code                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `analytics.validation_logs`                 | `INSERT`                                                                                 | `lib/validation-log.js`                                                   |
| `analytics.ortbtools_events`                | `INSERT`, `SELECT` (admin logs), lightweight `DELETE … WHERE user_id` (account deletion) | `lib/event-log.js`, `lib/analytics-purge.js`                              |
| `analytics.ortbtools_product_events`        | `INSERT`, `SELECT` (telemetry summary), lightweight `DELETE … WHERE user_id`             | `lib/product-telemetry.js`, `modules/telemetry`, `lib/analytics-purge.js` |
| `analytics.ortbtools_usage_daily` (+ `_mv`) | `SELECT`; the materialized view writes it when `ortbtools_product_events` is inserted    | `modules/telemetry`                                                       |
| `analytics.blog_drafts`                     | `INSERT`, `SELECT`, `ALTER UPDATE` (status, slug, approval)                              | `lib/news-crawler.js`, `lib/blog-service.js`, `modules/admin/blog.js`     |
| `analytics.blog_posts`                      | `INSERT`, `SELECT`                                                                       | `lib/blog-service.js`, `modules/blog`                                     |

There is no runtime DDL, no `system.*` read and no cross-database access. The schema is created
by the ClickHouse stack's init script (administrator, first start only).

**Procedure** (run once by an administrator in an approved window; nothing here is done by the
application):

1. Create a new account `ortbtools_app` next to the old one. Do not alter `ortbtools`.

```sql
-- run as the ClickHouse administrator; choose the password at the prompt, do not paste it into history
-- no `allow_ddl = 0`: it blocks lightweight DELETE and ALTER UPDATE, which the application needs
CREATE SETTINGS PROFILE IF NOT EXISTS ortbtools_app_profile SETTINGS
    allow_introspection_functions = 0 CONST,
    max_execution_time = 10,
    max_memory_usage = 1000000000,
    max_result_rows = 100000,
    max_result_bytes = 100000000,
    max_rows_to_read = 500000000;

CREATE USER IF NOT EXISTS ortbtools_app
  IDENTIFIED WITH sha256_password BY '<chosen at the prompt>'
  HOST IP '<shared network subnet>'  -- the kt-shared subnet (`docker network inspect kt-shared`)
  DEFAULT DATABASE analytics
  SETTINGS PROFILE 'ortbtools_app_profile';

GRANT SELECT, INSERT ON analytics.validation_logs          TO ortbtools_app;
GRANT SELECT, INSERT ON analytics.ortbtools_events         TO ortbtools_app;
GRANT SELECT, INSERT ON analytics.ortbtools_product_events TO ortbtools_app;
GRANT SELECT         ON analytics.ortbtools_usage_daily    TO ortbtools_app;
GRANT SELECT, INSERT ON analytics.blog_drafts              TO ortbtools_app;
GRANT SELECT, INSERT ON analytics.blog_posts               TO ortbtools_app;
GRANT ALTER UPDATE   ON analytics.blog_drafts              TO ortbtools_app;
GRANT ALTER DELETE   ON analytics.ortbtools_events         TO ortbtools_app;
GRANT ALTER DELETE   ON analytics.ortbtools_product_events TO ortbtools_app;
```

Read back with `SHOW GRANTS FOR ortbtools_app`: the lightweight `DELETE FROM` is authorised by
`ALTER DELETE`. `ortbtools_app` has no grant on `system.*`, no `CREATE`/`DROP`/`ALTER` on other
tables and no `ACCESS MANAGEMENT`; the `HOST IP` restriction makes a login from the host itself
(localhost) fail.

2. Check from the application's side before switching (as `ortbtools_app`; `clickhouse-client`
   inside the container, password from the prompt):
   - `SELECT count() FROM analytics.ortbtools_events` works;
   - `SELECT * FROM system.users` fails with "Not enough privileges";
   - `CREATE TABLE analytics.t (x UInt8) ENGINE = Memory`, `DROP TABLE` and `CREATE USER` fail;
   - `ALTER … DELETE` on `validation_logs` and `ALTER … UPDATE` on `ortbtools_events` fail;
   - `INSERT INTO analytics.ortbtools_product_events (event) VALUES ('probe')` works **and**
     `analytics.ortbtools_usage_daily` still receives the rollup (no extra grant is needed on
     this release; if a future release stops the rollup, add
     `GRANT INSERT ON analytics.ortbtools_usage_daily`);
   - `DELETE FROM analytics.ortbtools_events WHERE user_id = 999999999` and
     `DELETE FROM analytics.ortbtools_product_events WHERE user_id = 999999999` succeed;
   - `ALTER TABLE analytics.blog_drafts UPDATE …` succeeds;
   - a login from outside `kt-shared` (for example from the host over localhost) is rejected.

   Remove the probe rows afterwards (as the administrator), including the rollup row in
   `ortbtools_usage_daily`, which the application account may not delete.

3. Switch the application: set `CLICKHOUSE_USER=ortbtools_app` and the new password in the
   stack `.env` (mode 0600; back it up first with a dated name; never print it), then recreate
   the container (operator approval required). Verify `/api/health`, that `ortbtools_events` grows after
   requests, that `query_log` shows no failed queries for `ortbtools_app`, and the news crawler's
   draft read/insert in the log.
4. Keep using the entrypoint-created account `ortbtools` **only** as the administrator: it stays
   for schema changes and for this procedure, but its credentials leave the application's `.env`
   (store them wherever the other administrator credentials of the ClickHouse stack live, mode
   0600). After a day of clean operation, if you want the application account to be the only
   writer, `REVOKE` nothing from it — simply stop referencing it from ortbtools.
5. `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` is what gives the entrypoint-created account
   administrator rights. The stack can keep it (that account is the administrator), but nothing the
   application uses should rely on it.

**Rollback.** Restore the dated `.env` backup (or point `CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`
back at `ortbtools`) and recreate the container with the same image tag; the administrator account
is not modified by any step above. If the account itself must go, as the administrator:
`DROP USER ortbtools_app; DROP SETTINGS PROFILE ortbtools_app_profile`.

**Scope.** This limits what a compromised or misused application credential can do; it does not
replace input validation in the code (filters are whitelisted and escaped).

---

## 5. Secrets Management

### 5.1 Where secrets live

The stack's own `.env` is the only file ortbtools reads: `$STACK_DIR/.env`, mode 0600, owned by
the service user, git-ignored (`.env.bak*` copies are ignored too). Check without printing it:

```bash
stat -c '%a %U %n' $STACK_DIR/.env
# → 600 <service user> .../.env
```

The backup job does **not** copy `.env` (§6.0): keep the secrets recoverable by re-issuing them at
the providers. Never paste a secret value into a chat, a ticket, a commit or a command line that
lands in shell history; show a length at most.

### 5.2 What ortbtools reads

From `docker-compose.yml`, the container loads `env_file: - .env` (the per-project
`.env` at `$STACK_DIR/.env`, git-ignored). The non-secret
`CONTENT_DIR` value is set directly in the Compose service definition.

The `.env.example` documents the full key set. The variables that carry a secret:

| Var                  | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `RESEND_API_KEY`     | Transactional email (password reset, verify)           |
| `EMAIL_TOKEN_SECRET` | HMAC secret for stateless email tokens                 |
| `TG_BOT_TOKEN`       | Telegram admin alerts                                  |
| `TG_ADMIN_CHAT_ID`   | Telegram destination chat                              |
| `SENTRY_DSN`         | Sentry-compatible error reporting (§10.5)              |
| `ADMIN_STATS_TOKEN`  | Bearer token for optional `/api/admin/stats` consumers |

`NODE_ENV=production`, `EMAIL_FROM`, and `PUBLIC_BASE_URL` are non-secret and can live
directly in `.env`.

### 5.3 Adding a new secret

1. Back up the current file under a dated name (`cp -p .env .env.bak-$(date +%Y%m%d-%H%M)`;
   the copy stays 0600 and git-ignored).
2. Add the key=value to `$STACK_DIR/.env` with an editor or
   `set_env` (`. scripts/deploy-lib.sh`), which preserves mode and owner.
3. `cd $STACK_DIR && docker compose up -d --no-build ortbtools` —
   this re-reads the env file without a rebuild (operator approval is required for a recreate).

### 5.4 Rotating a secret

Order matters — kill the old credential at the provider before updating the container:

1. Revoke the old key at the provider (Resend dashboard, Telegram BotFather, etc).
2. Generate the new key.
3. Back up `$STACK_DIR/.env` under a dated name.
4. Update `$STACK_DIR/.env` with the new value.
5. `docker compose up -d --no-build ortbtools` to apply.
6. If the rotated secret is `EMAIL_TOKEN_SECRET`: all outstanding password-reset and
   email-verify links are immediately invalidated. Users mid-reset will need to
   re-request. Acceptable trade-off for a security rotation.

---

## 6. Backups

### 6.0 Local nightly backup

Backup sets are written to local disk under `$BACKUP_DIR`. §6.1 and §6.2 below describe the
repository's root-cron script and a restic/rclone variant; use whichever matches your layout.

- **Script**: a host-local wrapper (`$BACKUP_SCRIPT`, not in the repository). It uses the same
  method as `scripts/backup-db.sh`: `sqlite3 .backup` (WAL-aware, never a file copy), an
  `integrity_check` on the copy, a temporary directory moved into place atomically, `umask 077`.
- **Schedule**: nightly from cron, as the service user. Log: `$BACKUP_DIR/backup.log`.
- **Output**: `$BACKUP_DIR/YYYY-MM-DD/` (directory 0700, files 0600)
  with `ortbtools.db.gz`, `content-posts.tar.gz`, `state.tar.gz` (`fx-rates.json` and the
  `*-state.env` files) and `SHA256SUMS`. A second run on the same day replaces that day's directory.
- **Retention**: the 14 newest daily directories plus the newest of each of the last 8 ISO weeks.
- **Scope**: SQLite and persisted content. The stack `.env`, the ClickHouse data and the
  session-recovery state are handled separately.
- **Check**:

```bash
tail -n 5 $BACKUP_DIR/backup.log      # a "backup ok" line with users / cached_specimens counts
ls -l $BACKUP_DIR | tail -n 5
cd $BACKUP_DIR/$(date +%Y-%m-%d) && sha256sum -c SHA256SUMS
```

- **Manual run** (also the pre-deploy gate): `$BACKUP_SCRIPT >> $BACKUP_DIR/backup.log 2>&1`
- **Restore** — stops the container and replaces live data, so it needs the operator's explicit approval:

```bash
cd $STACK_DIR && docker compose stop ortbtools
D=$DATA_DIR; B=$BACKUP_DIR/YYYY-MM-DD
mv $D/ortbtools.db $D/ortbtools.db.broken; rm -f $D/ortbtools.db-wal $D/ortbtools.db-shm
gunzip -c $B/ortbtools.db.gz > $D/ortbtools.db && chmod 640 $D/ortbtools.db
tar xzf $B/content-posts.tar.gz -C $D      # if the blog content is needed; state.tar.gz likewise
docker compose start ortbtools && curl -s http://127.0.0.1:$APP_PORT/api/health
```

Verify with `sqlite3 $D/ortbtools.db 'PRAGMA integrity_check;'` (expected `ok`) before starting.

### 6.1 Repository script: daily SQLite and content backup (root cron)

Script: `$STACK_DIR/scripts/backup-db.sh`

Cron entry (`/etc/cron.d/ortbtools-backup`):

```
30 3 * * * root $STACK_DIR/scripts/backup-db.sh >> /var/log/ortbtools-backup.log 2>&1
```

The script uses `sqlite3 "$SRC" ".backup '$DEST'"` — this is the correct WAL-aware
database backup method. It is NOT a file copy. A bare `cp ortbtools.db` taken while the app is
running risks a torn page or a snapshot that doesn't include WAL-flushed transactions. The same run
also writes `content-posts/` to a temporary tarball and atomically moves the completed archive into
place.

Retention: 30 days. Each successful run produces this complete pair:

- `$BACKUP_DIR/ortbtools-YYYY-MM-DD.db.gz`
- `$BACKUP_DIR/content-posts-YYYY-MM-DD.tar.gz`

Check the log at `/var/log/ortbtools-backup.log` for failures or a skipped half of the pair.

Do not rely on a dated inventory in this runbook. The archives are root-only; verify the current
inventory and the cron outcome at operation time:

```bash
sudo -n find $BACKUP_DIR -maxdepth 1 -type f -printf '%TY-%Tm-%Td %TH:%TM %m %u:%g %f\n' | sort
sudo -n tail -n 50 /var/log/ortbtools-backup.log
```

#### Permissions — backups & data dir (security, since v1.1.5)

The backup archives are **full copies of the SQLite store** (bcrypt password
hashes, session/email-token secrets, encrypted samples), so they are the most
concentrated secret-at-rest on the box. `backup-db.sh` therefore:

- sets `umask 077` at the top (every file/dir it creates is owner-only),
- `chmod 700` the backup directory (`$BACKUP_DIR`) — fixing
  any older `0755`,
- `chmod 600` every `*.db.gz` and `content-posts-*.tar.gz` (fixing any older `0644`).

The cron job runs as **root**; the archives are `root:root 0600`. **No non-root
process consumes the backups**, so locking them down breaks nothing.

> **Decision (I-2, 2026-09-02): the root-only contract stands; the drift was an operator error and
> is repaired.** Three pre-deploy gate runs on 2026-09-02 were invoked without `sudo -n`, which (a)
> flipped the directory and that day's archives to the invoking user, and (b) — worse — overwrote the nightly
> `ortbtools-2026-09-02.db.gz` three times, because the gate used the same date-only name as cron.
> Ownership was restored with `chown root:root`. The structural fix is `backup-db.sh --pre-deploy`:
> the gate now writes `ortbtools-YYYY-MM-DDTHHMM.db.gz` (and the matching content archive), so it
> can never collide with the nightly file, and an unprivileged run fails fast with a hint instead of
> half-writing. Retention globs cover both shapes. Mixed ownership is not ratified; it is prevented.

The live **data dir** (`$DATA_DIR`) has three container
consumers — keep this in mind before tightening its modes:

| Consumer          | In-container uid | Access            | Needs                                            |
| ----------------- | ---------------- | ----------------- | ------------------------------------------------ |
| `ortbtools`       | `node` = 1000    | `/data` **rw**    | owner (uid 1000 = the service user) read+write   |
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

### 6.2 AppData restic snapshot (optional variant)

> This section documents an optional restic setup that the repository does not install: the
> restic repository, the timer, the password file and any remote copy are yours to provide.

Script: `<ops>/backup/scripts/kt-backup-appdata.sh`

Runs daily via a systemd timer. Snapshots the AppData tree (which includes `$DATA_DIR`) and the
secrets vault, if you keep one, into a restic repository. Password file: `/etc/kt-backup.password`.

Retention policy: 7 daily, 4 weekly, 12 monthly.

An optional `rclone sync` step can push the repository to a remote (`<remote>:<repo>`, configured
in the service user's `rclone.conf`).

**What gets backed up:**

| Data                        | Mechanism                           | Recovery path                   |
| --------------------------- | ----------------------------------- | ------------------------------- |
| `ortbtools.db` + WAL        | Both: cron `.backup` + restic       | `.gz` files or `restic restore` |
| `ortbtools.db-shm`, `-wal`  | restic (file-level)                 | `restic restore`                |
| Persistent `content-posts/` | Both: cron tar archive + restic     | `.tar.gz` or `restic restore`   |
| Application source          | git repo (source of truth)          | clean checkout + image rebuild  |
| Secrets vault               | included in restic, if you keep one | `restic restore`                |
| Project `.env`              | host runtime configuration          | restore or recreate explicitly  |

Application source is baked into the image and needs no separate runtime backup.
A clean Git checkout plus a rebuild recreates it.

### 6.3 Manual backup (on-demand)

> The pre-deploy backup gate is your backup wrapper (§6.0), run as the service user without
> `sudo`; it writes `$BACKUP_DIR/YYYY-MM-DD/` and verifies the copy. The commands below are for the
> repository's root-owned `scripts/backup-db.sh` layout. In both cases the backup is a separate
> operator gate: `deploy.sh` does not create or validate it.

```bash
(
set -euo pipefail

backup_started_at="$(date +%s)"
sudo -n $STACK_DIR/scripts/backup-db.sh --pre-deploy

# --pre-deploy stamps the names with the time (ortbtools-YYYY-MM-DDTHHMM.db.gz), so the
# nightly YYYY-MM-DD archive is never overwritten; pick up exactly what this invocation wrote.
backup_dir="$BACKUP_DIR"
db_archive="$(sudo -n find "$backup_dir" -maxdepth 1 -name 'ortbtools-????-??-??T????.db.gz' -newermt "@$backup_started_at" | sort | tail -1)"
content_archive="$(sudo -n find "$backup_dir" -maxdepth 1 -name 'content-posts-????-??-??T????.tar.gz' -newermt "@$backup_started_at" | sort | tail -1)"

# Both halves must exist and must have been written by this invocation.
test -n "$db_archive" && test -n "$content_archive"
sudo -n test -s "$db_archive"
sudo -n test -s "$content_archive"
test "$(sudo -n stat -c %Y "$db_archive")" -ge "$backup_started_at"
test "$(sudo -n stat -c %Y "$content_archive")" -ge "$backup_started_at"

# Validate the gzip stream, then restore only into an isolated temporary directory.
sudo -n gzip -t "$db_archive"
verify_dir="$(mktemp -d)"
cleanup_backup_verify() {
  rm -f -- "$verify_dir/ortbtools.db"
  rmdir -- "$verify_dir"
}
trap cleanup_backup_verify EXIT
sudo -n sh -c 'gunzip -c -- "$1" > "$2"' sh "$db_archive" "$verify_dir/ortbtools.db"
integrity_result="$(sudo -n sqlite3 "$verify_dir/ortbtools.db" 'PRAGMA integrity_check;')"
test "$integrity_result" = "ok"

# Validate and list the persistent-content archive without extracting it.
sudo -n tar tzf "$content_archive" >/dev/null
sudo -n stat -c '%n %s bytes %y' "$db_archive" "$content_archive"
)
```

Without `--pre-deploy` (the nightly cron shape) a same-day run replaces both completed
archives; with it, each run adds a time-stamped pair beside the nightly one. Both shapes rotate
after the same retention window.

`deploy.sh` does not create, validate, or inspect a backup. Immediately before every production
deployment, run the command above and verify the fresh database gzip (including a SQLite integrity
check from a temporary restore) plus the persistent-content tar archive. This is a separate operator
gate, but it is included in Constitution Principle VIII's standing deployment authorization and does
not require another approval. Keep its evidence with the deployment record.

### 6.4 Restore from backup

**Scenario: DB corrupt or accidental data loss, restore from gzip backup.**

Restore, destructive recovery, and direct `/data` access outside the documented backup, deploy, and
rollback flows remain explicit-only operations. An available archive or command does not authorize
using it.

```bash
# 1. Stop the container so no new writes race with the restore
cd $STACK_DIR && docker compose stop

# 2. Identify the backup to restore from
ls -lh $BACKUP_DIR/

# 3. Copy the live DB aside (keep it until restore is confirmed good)
cp $DATA_DIR/ortbtools.db /tmp/ortbtools-broken-$(date +%s).db

# 4. Remove WAL sidecar files (stale WAL on top of a fresh DB = corruption)
rm -f $DATA_DIR/ortbtools.db-shm
rm -f $DATA_DIR/ortbtools.db-wal

# 5. Restore
gunzip -c $BACKUP_DIR/ortbtools-2026-05-12.db.gz \
  > $DATA_DIR/ortbtools.db

# 6. Verify the restored DB is not corrupt
sqlite3 $DATA_DIR/ortbtools.db "PRAGMA integrity_check;"
# Expected: ok

# 7. Start the container
docker compose start

# 8. Verify health
curl -s http://127.0.0.1:$APP_PORT/api/health | python3 -m json.tool
```

**Scenario: full disk loss, fresh container from git + restic (applies only if you run the
restic variant of §6.2; otherwise rebuild from git, recreate `.env` from the providers, and
restore `ortbtools.db` from a §6.0 archive).**

```bash
# 1. Clone the repo
cd <stacks-root>
git clone <repo_url> ortbtools

# 2. Restore the secrets vault from restic
restic --repo <restic-repo> \
       --password-file /etc/kt-backup.password \
       restore latest --include <secrets-vault> --target /

# Or restore from off-site:
# rclone sync <remote>:<repo> <restic-repo>
# then restic restore as above

# 3. Recreate the project .env if it was not restored by the host backup.
# Start from .env.example, populate production values from the restored vault,
# and keep mode 0600. Do not start Compose with placeholder secrets.
cp --no-clobber .env.example .env
chmod 600 .env
$EDITOR .env

# 4. Restore AppData
restic --repo <restic-repo> \
       --password-file /etc/kt-backup.password \
       restore latest --include $DATA_DIR --target /

# 5. Build, verify, and deploy through the canonical state machine. The script
# writes ORTBTOOLS_TAG and build provenance into .env after successful checks.
cd $STACK_DIR
./scripts/deploy.sh
```

---

## 7. Monitoring

### 7.1 Container metrics

Metrics stacks (Grafana, Prometheus, exporters) and a portal proxy are optional integrations. The
sections of this runbook that mention them (the read-only SQLite group in §6.1 and §9.1.1, the
portal proxy) apply only to a deployment that has them; otherwise the DB stays readable by the
application user only.

Built in: the Docker healthcheck (§7.2), `docker stats --no-stream ortbtools`, `/api/health`, and
the error tracker (§10.5). Alerting is optional (§10.3).

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
curl -s http://127.0.0.1:$APP_PORT/api/health
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
cd $STACK_DIR && docker compose restart

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
cd $STACK_DIR && docker compose stop

# 2. Copy the corrupt DB aside for post-mortem
cp $DATA_DIR/ortbtools.db /tmp/ortbtools-corrupt-$(date +%s).db

# 3. Run WAL recovery on the corrupt DB first (may be enough)
sqlite3 $DATA_DIR/ortbtools.db "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 $DATA_DIR/ortbtools.db "PRAGMA integrity_check;"

# If still corrupt, restore from backup (see §6.4)
```

### 8.3 Disk full

Storage layout: the application data and the backups can live on different disks.

Safe to delete first:

- `$BACKUP_DIR/backup.log` — rotates manually, can grow large if cron floods
- Old backup directories beyond the retention in §6.0 (the script rotates them itself;
  deleting data needs the operator's approval)
- Container log files: `docker system prune` (removes stopped containers + dangling
  images — do NOT use `-v` unless you intend to delete volumes)

**Never delete:**

- `$DATA_DIR/` — live DB
- `$BACKUP_DIR/` — the backup copies
- the stack `.env` files — credentials

Check disk usage breakdown:

```bash
du -sh "$DATA_DIR"/../* | sort -rh | head -10
du -sh "$BACKUP_DIR"/../* | sort -rh | head -10
docker system df
```

### 8.4 Token leak — secret pushed to GitHub or otherwise exposed

1. **Immediately revoke the leaked token at the provider** (Resend, Telegram BotFather,
   wherever it was issued).
2. **Invalidate all active user sessions** (the token may not be a session token, but
   do this as a precaution if there's any possibility of account compromise):
   ```bash
   sqlite3 $DATA_DIR/ortbtools.db "DELETE FROM sessions;"
   ```
3. **Store the new token** in the secret store you use (if any), then update `.env`.
4. **Restart the container** to pick up the new env:
   ```bash
   cd $STACK_DIR && docker compose up -d
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
or inspect backup archives. The canonical backup and deployment flows carry standing authorization
only under Constitution Principle VIII's conditions; tool access or available credentials do not
expand that scope.

```bash
cd $STACK_DIR
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
and nothing is read from a portal checkout at build time.

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

Pruning of old rollback tags is a scheduled job on the host (weekly). It delegates to the tracked
`scripts/cleanup-rollback-tags.sh`, which ranks the tags by the referenced image's machine-readable
creation timestamp and retains the ten newest. A tag whose image timestamp cannot be inspected or
parsed is retained and logged for manual review; if the helper itself is unavailable, every tag is
retained and a warning is logged. Ordinary dangling-image pruning does not govern named rollback
tags.

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
the **coordinated wrapper**, NOT a bare `deploy.sh`, as the service user
(prereq: CP3A done — Grafana joined to group 2472):

```bash
cd $STACK_DIR
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

State at `$DATA_DIR/cutover-state.env` (full snapshot,
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
cd $STACK_DIR
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
preflight check. The documented rollback flow is the always-authorized safety action; it never waits
for another approval. Direct `/data` access or restore outside this flow remains explicit-only.

### 9.3 Updating the vendored `design-system.css`

The CSS is baked from `public/design-system.css` (no longer auto-propagated from
the portal). To pull a new portal version, follow `design-system.vendor.json`:
re-copy the file, recompute the sha256 into the manifest, bump the app patch
version, and deploy (§9.1). The CI guard (`tests/immutable-image.test.js`) fails
if the CSS is left as the stub or the hash drifts from the manifest.

### 9.4 Verifying the deployed commit

```bash
curl -s http://127.0.0.1:$APP_PORT/api/health | python3 -m json.tool   # → "build":{"sha":"<short>"}
docker image inspect ortbtools:$(curl -s http://127.0.0.1:$APP_PORT/api/health \
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

### 10.1 Public ingress (tunnel or reverse proxy)

Public traffic reaches the application through a tunnel or reverse proxy that is configured outside
this repository and forwards to `http://localhost:$APP_PORT`. Changing a route, the tunnel or any
edge setting needs the operator's explicit approval.

If the public URL is unreachable but `http://127.0.0.1:$APP_PORT/api/health` returns OK, the
problem is the ingress or the edge, not ortbtools: check the connector's container or service
status and its logs.

To take the site off the internet without touching ortbtools, stop the ingress connector (and start
it again to restore).

Edge providers answer a plain-text `error code: 502/504` page whenever the origin returns 502 or
504, which hides the JSON body; the application therefore reports failed third-party calls as
`424` (see the HTTP contract).

### 10.2 Resend (transactional email)

Used for: email verification at signup, password-reset links.

If Resend is down or the API key is invalid, ortbtools catches the error and logs it at
`warn` level. It will also fire a Telegram alert via `notifyAdmin()` with tag
`email-send-fail`. The user's registration/reset request will return an error
explaining that the email could not be sent. No crash, no data loss.

To test Resend connectivity without a real user:

```bash
curl -s http://127.0.0.1:$APP_PORT/api/health
# Then check docker logs for any email-related warnings in the last run
docker logs ortbtools --since 10m 2>&1 | grep -i "email\|resend"
```

Resend dashboard: `https://resend.com/` — use the account tied to `EMAIL_FROM`. The sending domain
should be verified there (DKIM and return-path records live in your DNS zone, DNS only), and the
production API key should be send-only and restricted to that domain. When `RESEND_API_KEY` is
empty the mailer short-circuits to a log line and the API says so (`email_sent: false`).

### 10.3 Telegram bot (admin alerts)

> Optional. When `TG_BOT_TOKEN` and `TG_ADMIN_CHAT_ID` are empty, alerts become `[notify:DEV]`
> log lines.

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

A Sentry-compatible target such as a self-hosted GlitchTip works. `SENTRY_DSN` is
`http://<key>@<host>:<port>/<project>`, and `/api/health` reports `"sentry":{"ready":true}`. If
the tracker is down ortbtools keeps serving and the events are dropped. To turn reporting off,
empty `SENTRY_DSN` in `.env` and recreate the container. Browser errors reach the same project
through the same-origin `/glitchtip-ingest/*` tunnel, which is rate limited.

The paragraph that follows records the earlier state of maintenance 019 and is kept for history.

Maintenance 019 retains the existing Telegram channel and optional, unconfigured Sentry
integration. On 2026-09-07 the container had both Telegram configuration fields and
reported `sentry.ready: false`; mocked notifier tests passed. This is configuration and
local-path evidence, not an upstream delivery claim. No new destination or synthetic
alert message was sent as part of that check. A future change starts with a specified
target and the controlled verification described below.

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
curl -s http://127.0.0.1:$APP_PORT/api/health | python3 -m json.tool
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

## Checkout recovery and worktree permissions — 2026-09-05

The interrupted vendor rebase was completed with both updated vendors and the newer main-branch
development dependencies. Its original git state, unmerged files, patches and labeller draft were
preserved in a dated repair directory outside the repository before recovery.

The sibling worktree parent `$STACK_DIR.worktrees` is owned by the service user, mode `0755`.
An actual detached worktree creation and clean removal succeeded there. Keep the stacks root
root-owned; provision only this project-specific worktree parent when restoring the checkout.

The completed Local Model Maximum cycle is indexed in
[its SpecKit archive](../specs/011-local-model-maximum/archive/README.md). Research outputs are
kept outside the live application data directory and never enter the production image as source
overlays. The archive decision cancels further inference experiments; no scheduler was created.

## Session recovery and restores (v1.23.0)

`/data/session-recovery/checkpoint.json` is private versioned authentication recovery state (directory0700, files0600); `owner.sqlite` is an empty lock sidecar held exclusively for the process lifetime. It does not contain application tables. The OS releases ownership after a crash. The checkpoint contains a private HMAC key and bounded keyed revocation identities/expiries, never raw browser cookies. Do not print, publish or copy it into a report.

Serving starts only after a durable dirty fence. Ordinary drained shutdown writes a clean checkpoint after all authentication work completes. A dirty, missing, incompatible or corrupted checkpoint causes durable invalidation of prior sessions before new authentication; inability to invalidate leaves the app unavailable. First upgrade invalidates legacy raw-token sessions. Users may need to log in again; saved encrypted payloads and account data are retained.

Canonical SQLite/content backups deliberately do not carry a live recovery checkpoint. For database restore: stop the app, restore the verified database/content set using the existing procedure, move aside any current `session-recovery/` directory, then start the app and verify health plus fresh login. Do not reattach an unrelated clean checkpoint to restored session rows. Keyed session identities also prevent old application images from interpreting new raw cookies during rollback; users must log in again. Backup completeness remains SQLite plus persisted content, with external ClickHouse handled separately.

Cloudflare Web Analytics automatic RUM injection is disabled for `ortbtools.com` (verified2026-09-09 in Manage site after save/reload). This removes the injected third-party beacon without expanding application CSP. First-party `/telemetry.js` and `/api/v1/telemetry/event` remain active with their existing privacy controls.
