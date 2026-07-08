# AGENTS.md

## Cursor Cloud specific instructions

Spyglass is a single Node app (public OpenRTB inspector) plus an npm-workspaces
validator engine (`packages/core`) and a CLI (`packages/cli`). See `README.md`
and `CONTRIBUTING.md` for the full picture; only the non-obvious cloud caveats
are captured here.

### Running the app (no Docker needed)

`CONTRIBUTING.md` says the runtime is "container-only", but for cloud dev the
server runs fine directly with `node server.js`. Two non-obvious caveats:

- `db.js` defaults `SPYGLASS_DATA_DIR` to `/data`, which is not writable here.
  Point it at a writable dir, e.g.:
  ```bash
  SPYGLASS_DATA_DIR=/workspace/.devdata NODE_ENV=development NEWS_CRAWLER_DISABLED=1 node server.js
  ```
- The app listens on **port 3000** (`http://127.0.0.1:3000`), not 8090 — 8090 is
  only the Docker host→container mapping in `docker-compose.yml`. The compose
  file also has a hard `SPYGLASS_TAG` guard and external bind-mounts, so plain
  `docker compose up` fails by design; prefer running `node server.js` directly.
- `NEWS_CRAWLER_DISABLED=1` avoids the in-process hourly news crawler (it no-ops
  without ClickHouse anyway). All external integrations (ClickHouse, Ollama,
  Resend, OpenRouter, Telegram, Sentry) are fail-open — leave them unset for dev.
- Smoke-check a running server with `bash scripts/smoke.sh http://127.0.0.1:3000 ""`.

### Tests / lint / typecheck

Standard commands (`npm test`, `npm run lint`, `npm run typecheck`,
`npm run ci`) are documented in `README.md` / `CONTRIBUTING.md`. One non-obvious
gotcha: the deploy-orchestration simulation tests in
`tests/immutable-image.test.js` (the `deploy-sim: …` cases) shell out to the real
`scripts/deploy.sh`, which calls **`rsync`**. Without the `rsync` system binary
installed, ~23 of those tests fail with `EXIT=127`; they are unrelated to app
logic. `rsync` is a host/system dependency (not an npm package), so it is not in
the update script.
