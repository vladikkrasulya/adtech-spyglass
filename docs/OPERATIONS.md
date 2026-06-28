# Spyglass — Operations Runbook

Maintainer: Vladik. Machine: Optiplex 7050 Micro, Debian 13, LAN `192.168.1.4`,
Tailscale `100.86.20.34`. Stack root: `/srv/DATA/Stacks/adtech-spyglass/`.

---

## TL;DR — Quick Reference

- **Public URL**: `https://spyglass.kyivtech.com.ua/`
- **Health endpoint**: `curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool`
  — returns `{"success": true, "status": "ok", "checks": {"db": true}, "build": {"sha": "..."}}`
- **Container name**: `adtech-spyglass` — check: `docker ps --filter name=adtech-spyglass`
- **App is down → first command**: `docker logs adtech-spyglass --tail 100`
- **Logs**: `docker logs adtech-spyglass --tail 200 -f` (container stdout/stderr via pino)
- **SQLite DB**: `/srv/DATA/AppData/adtech-spyglass/spyglass.db` (WAL mode — also
  `spyglass.db-shm` + `spyglass.db-wal` in the same dir, all three are live state)
- **Latest backup**: `/srv/DATA/Backups/adtech-spyglass/spyglass-$(date +%Y-%m-%d).db.gz`
  — daily at 03:30 via `/etc/cron.d/spyglass-backup`
- **Restart**: `cd /srv/DATA/Stacks/adtech-spyglass && docker compose restart`
- **Secrets vault**: `/srv/DATA/.secrets/api-tokens.env` (mode 0600, owner vk)

---

## 1. Architecture Overview

Single container `adtech-spyglass` built from the local repo. No external DB, no
Redis, no queue. Dependencies:

```
[internet] → CF Tunnel → kyivtech-portal (host net, port 80)
                            │ PORTAL_PROXY_TARGETS: spyglass=http://127.0.0.1:8090
                            └→ adtech-spyglass (127.0.0.1:8090 → container :3000)
```

The portal exposes Spyglass in two ways:

1. **`/spyglass-proxy/*`** — public reverse-proxy mount (no auth gate, since 2026-05-09).
   This is what `spyglass.kyivtech.com.ua` resolves to through Cloudflare Tunnel.
2. **`/api/admin/spyglass`** — admin-only data surface used by the portal admin dashboard
   (reads Spyglass's SQLite read-only via bind-mount at `/app/spyglass-data/`).

`kyivtech-portal` runs with `network_mode: host` so `http://127.0.0.1:8090` resolves
directly. Spyglass is on Docker's default bridge and publishes only to
`127.0.0.1:8090` — never to `0.0.0.0`.

**SQLite** is the only persistent store — one file, WAL mode, no migration tooling
needed beyond running the app (schema auto-applied at startup via `db.js`). No
Postgres or Redis to manage.

**Ollama** (cross-stack, `ollama_default` network): LLM intel features call
`http://ollama:11434`. Fail-open — if Ollama is down, AI affordances hide in the UI,
everything else continues unaffected. The model in use is `gemma4:e2b` (since
2026-05-21; previously `qwen2.5:3b`). See §8 (Monitoring) and §5.8 (Bump Ollama
model) for ops details.

For deep architectural context see `ARCHITECTURE.md` (especially §0 Current State).

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

Only two host paths are mounted:

| Host path                                                   | Container path                  | RW  | Purpose                                                             |
| ----------------------------------------------------------- | ------------------------------- | --- | ------------------------------------------------------------------- |
| `/srv/DATA/AppData/adtech-spyglass`                         | `/data`                         | RW  | Persistent SQLite + `content-posts/` (blog) — **never lose this**   |
| `/srv/DATA/Stacks/kyivtech-portal/public/design-system.css` | `/app/public/design-system.css` | ro  | **TRANSITIONAL** (removed v1.1.6) — overlays the baked vendored CSS |

**The `/data` mount** holds `spyglass.db` + `-wal`/`-shm` (live SQLite WAL state)
and `content-posts/` (persistent blog content; the container reads it via
`CONTENT_DIR=/data/content-posts`). Never copy only `spyglass.db` without the WAL
files. The backup script archives both (§7).

**`design-system.css`** is vendored byte-for-byte into the image
(`public/design-system.css`; provenance + update procedure in
`design-system.vendor.json`). The portal mount above is kept for ONE release so a
rollback to the v1.1.4 image (which still carries the 783-byte stub) serves real
CSS; it is removed in v1.1.6. To update the design system, re-vendor per the
manifest, bump the patch version, and redeploy.

---

## 3. The Bind-Mount Inode Gotcha (mostly historical)

Since v1.1.5 the image is immutable and all source is baked, so the classic inode
gotcha (an atomic host edit to a bind-mounted source file not being visible in the
container) **no longer applies to source** — source changes ship only via a
rebuild+redeploy (§9).

The **only** remaining bind-mount that can still hit this is the **transitional**
`design-system.css` overlay (`/srv/DATA/Stacks/kyivtech-portal/public/design-system.css`,
removed in v1.1.6): an atomic edit to the portal's copy needs a
`docker compose restart` to re-open the fd. Historically this also bit `./public`,
`./packages`, `./intel-llm.js` and `./samples` (v0.42.5 / v0.42.8) — none of which
are mounted any more.

---

## 4. Common Ops Tasks

### 4.1 Restart (no rebuild)

Use only to recover from a transient crash, or after editing the **transitional**
`design-system.css` portal overlay (the only remaining bind-mount). It does **not**
pick up source changes — those are baked into the image.

```bash
cd /srv/DATA/Stacks/adtech-spyglass && docker compose restart
```

### 4.2 Any source / dependency / CSS change → redeploy (§9)

Since v1.1.5 every change to `server.js`, `db.js`, `auth.js`, `modules/`,
`packages/`, `public/`, `samples/`, `lib/`, `package.json`, or the vendored
`design-system.css` ships only by building a new immutable image. Use the deploy
script (gate + build + smoke + auto-rollback):

```bash
cd /srv/DATA/Stacks/adtech-spyglass
git checkout main && git pull --ff-only
./scripts/deploy.sh
```

See §9 for the full flow and rollback.

### 4.3 View logs

```bash
docker logs adtech-spyglass --tail 200 -f
```

Logs are JSON (pino). For a specific time window:

```bash
docker logs adtech-spyglass --since 1h 2>&1 | grep -i "error\|warn"
```

The container does not write to any host log file. All output goes to Docker's default
json-file log driver. If you need persistent log files, add a `logging:` stanza to
`docker-compose.yml` or redirect `docker logs` to a file in the cron log setup.

### 4.4 Open SQLite shell

```bash
sqlite3 /srv/DATA/AppData/adtech-spyglass/spyglass.db
```

Useful commands inside the shell:

```sql
.tables
.schema users
SELECT count(*) FROM users;
SELECT count(*) FROM sessions WHERE expires_at > strftime('%s','now')*1000;
```

The DB runs in WAL mode. The `spyglass.db-shm` and `spyglass.db-wal` files in the
same directory are part of the live state. `sqlite3` handles WAL transparently — you
do not need to stop the container to run read queries, but be aware that writes from
the shell while the container is running can race with the app.

### 4.5 Reset a test user's password

**This is destructive.** Resetting `password_hash` via SQL also invalidates the
user's KEK (key-encryption key), which is derived from the old password. The wrapped
DEK stored in `dek_wrapped` becomes unrecoverable — the user permanently loses access
to their encrypted library (saved samples, partner notes). If they have a recovery key
they can wrap a new DEK from the recovery path. If they do not, library data is lost.

Use this only for test accounts or at explicit user request where they understand the
consequence.

```bash
# Generate a bcrypt hash first (cost 12):
python3 -c "import bcrypt; print(bcrypt.hashpw(b'newpassword', bcrypt.gensalt(12)).decode())"
# or: node -e "const b=require('bcryptjs'); b.hash('newpassword',12).then(console.log)"
```

Then in the SQLite shell:

```sql
-- DESTRUCTIVE: user loses encrypted library access (KEK invalidated)
UPDATE users
SET    password_hash = '$2b$12$<hash_from_above>',
       dek_wrapped   = NULL,
       dek_iv        = NULL,
       kdf_salt      = NULL
WHERE  email = 'target@example.com';

-- Verify exactly one row affected before committing:
SELECT id, email FROM users WHERE email = 'target@example.com';
```

After the UPDATE the user can log in with the new password but their library will be
empty (encrypted blobs remain in `samples` but the DEK is gone so they decrypt to
garbage — they will see an error or empty state depending on the UI path).

### 4.6 Force-clear all anonymous / expired sessions

Sessions expire naturally — `expires_at` is checked on every request. But after a
security incident you may want to force-invalidate immediately.

```bash
sqlite3 /srv/DATA/AppData/adtech-spyglass/spyglass.db
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
sqlite3 /srv/DATA/AppData/adtech-spyglass/spyglass.db
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

### 4.8 Bump Ollama model

The current model is `gemma4:e2b` (set in `docker-compose.yml` as
`OLLAMA_MODEL=gemma4:e2b`). To switch:

1. Pull the new model into Ollama first:
   ```bash
   docker exec ollama ollama pull <new-model>
   ```
2. Edit `docker-compose.yml` — change `OLLAMA_MODEL=<new-model>` in the `environment`
   block.
3. `docker compose up -d` (no rebuild needed — the env var is the only thing changing).

If the model is not pulled and the app calls it, the request returns a non-200 and
the LLM feature degrades silently (fail-open). No user-facing crash.

The Ollama container is managed by the separate stack at `/srv/DATA/Stacks/ollama/`.

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

### 5.2 What Spyglass reads

From `docker-compose.yml`, the container loads `env_file: - .env` (the per-project
`.env` at `/srv/DATA/Stacks/adtech-spyglass/.env`, git-ignored). Additional env vars
(`OLLAMA_URL`, `OLLAMA_MODEL`) are set directly in the `environment:` block and do not
come from the vault.

The `.env.example` documents the full key set. Variables that should live in the vault
and be referenced from `.env`:

| Var                  | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `RESEND_API_KEY`     | Transactional email (password reset, verify) |
| `EMAIL_TOKEN_SECRET` | HMAC secret for stateless email tokens       |
| `TG_BOT_TOKEN`       | Telegram admin alerts                        |
| `TG_ADMIN_CHAT_ID`   | Telegram destination chat                    |
| `ADMIN_STATS_TOKEN`  | Bearer token for `/api/admin/stats` (n8n)    |

`NODE_ENV=production`, `EMAIL_FROM`, and `PUBLIC_BASE_URL` are non-secret and can live
directly in `.env`.

### 5.3 Adding a new secret

1. Append the key=value to `/srv/DATA/.secrets/api-tokens.env`.
2. Reference it in `/srv/DATA/Stacks/adtech-spyglass/.env`.
3. `cd /srv/DATA/Stacks/adtech-spyglass && docker compose up -d` — this re-reads the
   env file without a rebuild.

### 5.4 Rotating a secret

Order matters — kill the old credential at the provider before updating the container:

1. Revoke the old key at the provider (Resend dashboard, Telegram BotFather, etc).
2. Generate the new key.
3. Update `/srv/DATA/.secrets/api-tokens.env`.
4. Update `/srv/DATA/Stacks/adtech-spyglass/.env` with the new value.
5. `docker compose up -d` to apply.
6. If the rotated secret is `EMAIL_TOKEN_SECRET`: all outstanding password-reset and
   email-verify links are immediately invalidated. Users mid-reset will need to
   re-request. Acceptable trade-off for a security rotation.

---

## 6. Backups

### 6.1 Daily SQLite backup (cron)

Script: `/srv/DATA/Stacks/adtech-spyglass/scripts/backup-db.sh`

Cron entry (`/etc/cron.d/spyglass-backup`):

```
30 3 * * * root /srv/DATA/Stacks/adtech-spyglass/scripts/backup-db.sh >> /var/log/spyglass-backup.log 2>&1
```

The script uses `sqlite3 "$SRC" ".backup '$DEST'"` — this is the correct WAL-aware
backup method. It is NOT a file copy. A bare `cp spyglass.db` taken while the app is
running risks a torn page or a snapshot that doesn't include WAL-flushed transactions.

Retention: 30 days. Output: `/srv/DATA/Backups/adtech-spyglass/spyglass-YYYY-MM-DD.db.gz`.
Check the log at `/var/log/spyglass-backup.log` for failures.

Current backup inventory (verified 2026-05-13):

```
/srv/DATA/Backups/adtech-spyglass/spyglass-2026-04-30.db.gz  … spyglass-2026-05-13.db.gz
```

### 6.2 AppData restic snapshot (systemd timer)

Script: `/srv/DATA/Ops/backup/scripts/kt-backup-appdata.sh`

Runs daily at 03:00 via `kt-backup-appdata.timer`. Snapshots `/srv/DATA/AppData`
(which includes `/srv/DATA/AppData/adtech-spyglass/`) and `/srv/DATA/.secrets` into
the restic repo at `/srv/DATA/Backups/restic-repo`. Password file:
`/etc/kt-backup.password`.

Retention policy: 7 daily, 4 weekly, 12 monthly.

After the restic snapshot, the script runs `rclone sync` to push the repo to
`gdrive:optiplex-restic` (configured in `/home/vk/.config/rclone/rclone.conf`).
Off-site replica confirmed fresh as of 2026-05-10.

**What gets backed up:**

| Data                                        | Mechanism                               | Recovery path                   |
| ------------------------------------------- | --------------------------------------- | ------------------------------- |
| `spyglass.db` + WAL                         | Both: cron `.backup` + restic           | `.gz` files or `restic restore` |
| `spyglass.db-shm`, `-wal`                   | restic (file-level)                     | `restic restore`                |
| `./public` bind-mount                       | git repo (source of truth)              | `git checkout`                  |
| `./packages`, `./samples`, `./intel-llm.js` | git repo                                | `git checkout`                  |
| `.env` secrets                              | `/srv/DATA/.secrets` included in restic | `restic restore`                |

The bind-mounted `/app/public` directory is in git — no separate backup needed.
Losing it is a `git checkout` away.

### 6.3 Manual backup (on-demand)

```bash
/srv/DATA/Stacks/adtech-spyglass/scripts/backup-db.sh
# Output: /srv/DATA/Backups/adtech-spyglass/spyglass-$(date +%Y-%m-%d).db.gz
```

If a file for today already exists, `gzip -f` will overwrite it.

### 6.4 Restore from backup

**Scenario: DB corrupt or accidental data loss, restore from gzip backup.**

```bash
# 1. Stop the container so no new writes race with the restore
cd /srv/DATA/Stacks/adtech-spyglass && docker compose stop

# 2. Identify the backup to restore from
ls -lh /srv/DATA/Backups/adtech-spyglass/

# 3. Copy the live DB aside (keep it until restore is confirmed good)
cp /srv/DATA/AppData/adtech-spyglass/spyglass.db /tmp/spyglass-broken-$(date +%s).db

# 4. Remove WAL sidecar files (stale WAL on top of a fresh DB = corruption)
rm -f /srv/DATA/AppData/adtech-spyglass/spyglass.db-shm
rm -f /srv/DATA/AppData/adtech-spyglass/spyglass.db-wal

# 5. Restore
gunzip -c /srv/DATA/Backups/adtech-spyglass/spyglass-2026-05-12.db.gz \
  > /srv/DATA/AppData/adtech-spyglass/spyglass.db

# 6. Verify the restored DB is not corrupt
sqlite3 /srv/DATA/AppData/adtech-spyglass/spyglass.db "PRAGMA integrity_check;"
# Expected: ok

# 7. Start the container
docker compose start

# 8. Verify health
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
```

**Scenario: full disk loss, fresh container from git + restic.**

```bash
# 1. Clone the repo
cd /srv/DATA/Stacks
git clone <repo_url> adtech-spyglass

# 2. Restore .env and secrets from restic
restic --repo /srv/DATA/Backups/restic-repo \
       --password-file /etc/kt-backup.password \
       restore latest --include /srv/DATA/.secrets --target /

# Or restore from off-site:
# rclone sync gdrive:optiplex-restic /srv/DATA/Backups/restic-repo
# then restic restore as above

# 3. Restore AppData
restic --repo /srv/DATA/Backups/restic-repo \
       --password-file /etc/kt-backup.password \
       restore latest --include /srv/DATA/AppData/adtech-spyglass --target /

# 4. Rebuild and start
cd /srv/DATA/Stacks/adtech-spyglass
BUILD_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
```

---

## 7. Monitoring

### 7.1 Beszel (container metrics)

Hub + agent compose at `/srv/DATA/Stacks/beszel/`. Hub UI: `http://127.0.0.1:8190`
(or via Tailscale at `100.86.20.34:8190`). Container `adtech-spyglass` should appear
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
Spyglass returns 404 on HEAD requests, so wget's GET against the root is used instead.
`/api/health` does a live DB ping and is the better liveness probe for manual checks:

```bash
curl -s http://127.0.0.1:3000/api/health
# Healthy: {"success":true,"status":"ok","checks":{"db":true},"build":{"sha":"<sha>"}}
# DB down: {"success":false,"status":"degraded","checks":{"db":false},...} + HTTP 503
```

Check Docker's view of the health state:

```bash
docker inspect adtech-spyglass --format '{{.State.Health.Status}}'
# healthy | unhealthy | starting
```

### 7.3 n8n morning brief

The n8n workflow (at `/srv/DATA/Stacks/n8n/`) calls `GET /api/admin/stats` with a
bearer token (`ADMIN_STATS_TOKEN` env) to include Spyglass stats in the morning
report. If `ADMIN_STATS_TOKEN` is unset or wrong, the endpoint returns 503 and n8n
will log a workflow error — Spyglass itself is unaffected.

### 7.4 Telegram alerts

Spyglass fires `notifyAdmin()` via `notify.js` for: uncaught exceptions, unhandled
promise rejections, and 5xx handler crashes. Rate-limited to one message per tag per
5 minutes (in-memory throttle, resets on container restart). Requires `TG_BOT_TOKEN`
and `TG_ADMIN_CHAT_ID` in `.env`. If either is missing, alerts log to stderr only.

---

## 8. Incident Playbook

### 8.1 Container is "unhealthy" or not running

```bash
# Check status
docker ps --filter name=adtech-spyglass

# Check last 100 log lines for the error
docker logs adtech-spyglass --tail 100

# Attempt restart
cd /srv/DATA/Stacks/adtech-spyglass && docker compose restart

# If still unhealthy after ~30s, look at exit reason
docker inspect adtech-spyglass --format '{{.State.ExitCode}} {{.State.Error}}'

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
cd /srv/DATA/Stacks/adtech-spyglass && docker compose stop

# 2. Copy the corrupt DB aside for post-mortem
cp /srv/DATA/AppData/adtech-spyglass/spyglass.db /tmp/spyglass-corrupt-$(date +%s).db

# 3. Run WAL recovery on the corrupt DB first (may be enough)
sqlite3 /srv/DATA/AppData/adtech-spyglass/spyglass.db "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 /srv/DATA/AppData/adtech-spyglass/spyglass.db "PRAGMA integrity_check;"

# If still corrupt, restore from backup (see §6.4)
```

### 8.3 Disk full at `/srv/DATA`

Storage layout: `/srv/DATA` → `/srv/DATA` (symlink to `/srv/DATA` on the host SSD).

Safe to delete first:

- `/var/log/spyglass-backup.log` — rotates manually, can grow large if cron floods
- Old gz backups beyond 30 days (the cron handles this, but you can purge manually):
  `find /srv/DATA/Backups/adtech-spyglass -name '*.db.gz' -mtime +30 -delete`
- Container log files: `docker system prune` (removes stopped containers + dangling
  images — do NOT use `-v` unless you intend to delete volumes)

**Never delete:**

- `/srv/DATA/AppData/adtech-spyglass/` — live DB
- `/srv/DATA/Backups/adtech-spyglass/` — only backup copies
- `/srv/DATA/.secrets/` — credentials, vault

Check disk usage breakdown:

```bash
du -sh /srv/DATA/AppData/* | sort -rh | head -10
du -sh /srv/DATA/Backups/* | sort -rh | head -10
docker system df
```

### 8.4 Ollama unreachable (LLM intel features down)

Expected behavior: the app detects the 503/connection-refused on the first LLM call
and hides AI affordances in the UI. Logged at `warn` level, no crash. Users see the
inspector without dialect naming / field-purpose hints.

Verify from inside the container:

```bash
docker exec adtech-spyglass wget -qO- --tries=1 --timeout=3 http://ollama:11434/api/tags
```

If that returns `{}` or a model list — Ollama is up, DNS resolution via `ollama_default`
network is working.

If it returns a connection error:

```bash
# Check if the ollama container is running
docker ps --filter name=ollama

# Check if the network exists
docker network inspect ollama_default | grep -E "Name|Containers" | head -10

# Restart Ollama stack
cd /srv/DATA/Stacks/ollama && docker compose restart
```

If `ollama_default` network doesn't exist at all (Ollama stack was removed), the
adtech-spyglass container won't start because the network is declared `external: true`
in `docker-compose.yml`. Start the Ollama stack first:

```bash
cd /srv/DATA/Stacks/ollama && docker compose up -d
cd /srv/DATA/Stacks/adtech-spyglass && docker compose up -d
```

### 8.5 Token leak — secret pushed to GitHub or otherwise exposed

1. **Immediately revoke the leaked token at the provider** (Resend, Telegram BotFather,
   wherever it was issued).
2. **Invalidate all active user sessions** (the token may not be a session token, but
   do this as a precaution if there's any possibility of account compromise):
   ```bash
   sqlite3 /srv/DATA/AppData/adtech-spyglass/spyglass.db "DELETE FROM sessions;"
   ```
3. **Update the vault** with the new token:
   Edit `/srv/DATA/.secrets/api-tokens.env`, then update `.env`.
4. **Restart the container** to pick up the new env:
   ```bash
   cd /srv/DATA/Stacks/adtech-spyglass && docker compose up -d
   ```
5. **Audit logs** for the exposure window:
   ```bash
   docker logs adtech-spyglass --since <ISO_timestamp_of_push> 2>&1 | grep -E "error|warn|5[0-9][0-9]"
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

```bash
cd /srv/DATA/Stacks/adtech-spyglass
git checkout main && git pull --ff-only        # clean main == origin/main
./scripts/deploy.sh
```

`scripts/deploy.sh` does the whole thing safely:

1. Refuses to run unless the tree is clean and `HEAD == main == origin/main`.
2. Tags the currently-running image as `adtech-spyglass:rollback-pre-v<version>`
   and records the previous `BUILD_SHA`.
3. Builds the image with `BUILD_SHA` (short), `GIT_SHA` (full → OCI revision
   label) and `APP_VERSION` (package.json → OCI version label), tagging it
   `adtech-spyglass:<short-sha>` + `adtech-spyglass:v<version>`.
4. Writes `SPYGLASS_TAG=<short-sha>` to `.env` (auto-read by compose, so a reboot
   or a plain `docker compose up -d` starts the SAME image) and brings it up with
   `--no-build`.
5. Runs `scripts/smoke.sh` against production. **On smoke failure it auto-rolls
   back** to `rollback-pre-v<version>` and re-smokes the previous `BUILD_SHA`;
   prints `CRITICAL` and exits non-zero if the rollback also fails.

The deploy is reproducible from any clean checkout (GitHub Actions builds the same
image) — the build context is `.`, the CSS is vendored into `public/design-system.css`,
and nothing is read from `/srv/DATA/Stacks/kyivtech-portal` at build time.

### 9.2 Rollback

```bash
cd /srv/DATA/Stacks/adtech-spyglass
./scripts/rollback.sh                 # → the rollback-pre-v<version> image from the last deploy
# or pin an explicit image:  ./scripts/rollback.sh <tag>
```

Rollback selects a previous **self-contained** image, pins it in `.env`, and runs
`docker compose up -d --no-build` (no silent rebuild). It does **not** touch git,
does **not** re-add source bind-mounts, and does **not** touch `/data` or
`content-posts`. It verifies the expected previous `BUILD_SHA` and prints
`CRITICAL` if the smoke fails.

### 9.3 Updating the vendored `design-system.css`

The CSS is baked from `public/design-system.css` (no longer auto-propagated from
the portal). To pull a new portal version, follow `design-system.vendor.json`:
re-copy the file, recompute the sha256 into the manifest, bump the app patch
version, and deploy (§9.1). The CI guard (`tests/immutable-image.test.js`) fails
if the CSS is left as the stub or the hash drifts from the manifest.

### 9.4 Verifying the deployed commit

```bash
curl -s http://127.0.0.1:8090/api/health | python3 -m json.tool   # → "build":{"sha":"<short>"}
docker image inspect adtech-spyglass:$(curl -s http://127.0.0.1:8090/api/health \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["build"]["sha"])') \
  --format '{{json .Config.Labels}}'                               # → version + revision labels
```

The `/api/health` `build.sha` must equal `git rev-parse --short HEAD`; the image's
`org.opencontainers.image.revision` label must equal the full `git rev-parse HEAD`.

---

## 10. External Integrations

### 10.1 Cloudflare Tunnel (public ingress)

The tunnel terminates at `kyivtech-portal` (host port 80). All of `*.kyivtech.com.ua`
routes through it. `spyglass.kyivtech.com.ua` is not a separate tunnel route — it's
a subdomain that the portal handles at the application layer via
`PORTAL_PROXY_TARGETS: spyglass=http://127.0.0.1:8090`.

If the public URL is unreachable but `http://127.0.0.1:3000/api/health` returns OK:
the problem is in the Cloudflare Tunnel or the portal proxy, not in Spyglass. Check
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

If Resend is down or the API key is invalid, Spyglass catches the error and logs it at
`warn` level. It will also fire a Telegram alert via `notifyAdmin()` with tag
`email-send-fail`. The user's registration/reset request will return an error
explaining that the email could not be sent. No crash, no data loss.

To test Resend connectivity without a real user:

```bash
curl -s http://127.0.0.1:3000/api/health
# Then check docker logs for any email-related warnings in the last run
docker logs adtech-spyglass --since 10m 2>&1 | grep -i "email\|resend"
```

Resend dashboard: `https://resend.com/` — use the account tied to `EMAIL_FROM`:
`spyglass@kyivtech.com.ua`. Domain verification is via Cloudflare TXT record on
`kyivtech.com.ua`.

### 10.3 Telegram bot (admin alerts)

Spyglass pings the bot for: uncaught exceptions, unhandled rejections, 5xx crashes.
If `TG_BOT_TOKEN` or `TG_ADMIN_CHAT_ID` is missing from `.env`, alerts go to stderr
only — no crash, no impact on users.

If you stop receiving alerts: check both env vars are set, then verify the bot token
is still valid by calling the Telegram API directly:

```bash
curl "https://api.telegram.org/bot${TG_BOT_TOKEN}/getMe"
```

### 10.4 n8n morning brief

n8n stack at `/srv/DATA/Stacks/n8n/`. The workflow calls `GET /api/admin/stats` with
`Authorization: Bearer <ADMIN_STATS_TOKEN>`. If the token is wrong or unset, Spyglass
returns 503 and the workflow logs an error — Spyglass is unaffected. Fix: ensure
`ADMIN_STATS_TOKEN` in `.env` matches what the n8n workflow credential has.

### 10.5 GlitchTip (error tracking)

GlitchTip runs at `/srv/DATA/Stacks/glitchtip/`. As of the ARCHITECTURE.md "Current
State" note, Sentry/GlitchTip integration in Spyglass is on the backlog (Phase 8 ⏸️
partial — not yet wired in). Spyglass does not currently send error events to
GlitchTip. The Telegram alert path (`notify.js`) is the active incident signal.

---

## Appendix: Container Network Summary

Spyglass attaches to three Docker networks:

| Network                 | Type                               | Purpose                                 |
| ----------------------- | ---------------------------------- | --------------------------------------- |
| `default` (stack-local) | Managed by compose                 | Internal stack bridge                   |
| `ollama_default`        | External (managed by ollama stack) | DNS `http://ollama:11434` for LLM calls |
| `kt-shared`             | External (cross-stack hub)         | n8n can reach `/api/admin/stats`        |

If either external network is missing at startup, `docker compose up` will fail with
"network not found". Fix: ensure the owning stack is running and has created the
network:

```bash
docker network ls | grep -E "ollama_default|kt-shared"
# If missing:
cd /srv/DATA/Stacks/ollama && docker compose up -d
# kt-shared is created by whichever stack owns it — check portal or n8n compose
```

---

_Last updated: 2026-05-13. Reflects Spyglass v0.42.10._
