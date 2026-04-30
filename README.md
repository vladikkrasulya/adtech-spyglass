# Spyglass

OpenRTB inspector — paste a `BidRequest` / `BidResponse` JSON and get human-readable validation, semantic crosscheck, and creative preview. Saves test samples per partner.

Runs at [kyivtech.com.ua/spyglass-proxy/](https://kyivtech.com.ua/spyglass-proxy/) (auth-gated through the kyivtech-portal).

## Status

Active development. See [ROADMAP.md](./ROADMAP.md) for phased plan and [ARCHITECTURE.md](./ARCHITECTURE.md) for the target shape.

## Run locally

```bash
docker compose up -d --build
# UI at http://127.0.0.1:8090
```

The container bind-mounts:
- `./public` for live-edit of HTML/CSS/JS (no rebuild on UI changes)
- `/srv/DATA/Stacks/kyivtech-portal/public/design-system.css` for the shared design system
- `/srv/DATA/AppData/adtech-spyglass` for persistent SQLite

The `public/design-system.css` file in this repo is an **empty placeholder**. Docker requires the target file to exist before bind-mounting onto it. The portal's real design-system.css is what gets served at runtime.

## Layout

```
server.js                 Express HTTP server, REST API
db.js                     SQLite store (partners + samples)
public/index.html         UI shell
public/spyglass.app.js    UI behaviors
docker-compose.yml        Service definition
Dockerfile                Build (alpine + node + better-sqlite3 native compile)
scripts/backup-db.sh      Daily DB backup (run via cron on host, not in container)
```

## Backups

The SQLite database lives outside the repo at `/srv/DATA/AppData/adtech-spyglass/spyglass.db`. A daily backup runs via `/etc/cron.d/spyglass-backup`, dumping to `/srv/DATA/Backups/adtech-spyglass/spyglass-YYYY-MM-DD.db.gz` with 30-day rotation. See [scripts/backup-db.sh](./scripts/backup-db.sh).

## Configuration

Runtime config goes in `.env` (git-ignored). See [.env.example](./.env.example) for the full list. Currently no secrets are required — that lands in Phase 7 (auth).
