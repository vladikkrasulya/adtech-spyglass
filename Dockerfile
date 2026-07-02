# ── Builder ──────────────────────────────────────────────────────────
# Install prod deps with the native-build toolchain (better-sqlite3 compiles
# bindings at install). The toolchain is *only* in this stage — runtime image
# stays small and surface-minimal.
FROM node:22.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev

# ── Runtime ──────────────────────────────────────────────────────────
# No build tools, no dev deps, runs as the non-root `node` user (uid 1000).
# The host's /srv/DATA/AppData/adtech-spyglass is also uid 1000 (vk:vk),
# so the SQLite WAL/shm files are writable without an explicit chown step.
# .dockerignore filters .env / .git / node_modules / docs / *.bak / ops files
# out of the build context (see tests/immutable-image.test.js for the policy).
FROM node:22.22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Build provenance, all injected via --build-arg (NOTHING hardcoded here):
#   BUILD_SHA   — short git SHA, surfaced via /api/health for monitoring/smoke.
#   GIT_SHA     — full git SHA, baked as the OCI image revision label.
#   APP_VERSION — package.json version, baked as the OCI image version label.
# scripts/deploy.sh computes all three from the clean checkout. They default to
# 'dev' so a manual `docker build` without args still succeeds (non-prod).
ARG BUILD_SHA=dev
ARG GIT_SHA=dev
ARG APP_VERSION=dev
ENV BUILD_SHA=${BUILD_SHA}
LABEL org.opencontainers.image.title="adtech-spyglass" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.source="https://github.com/vladikkrasulya/adtech-spyglass"
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 3000
# umask 027 so the app creates the SQLite WAL/SHM (and DB) without "other" perms
# (mode 0640) — the Grafana datasource reads them via the shared `spyglass-ro`
# group instead. `exec` makes node PID 1 so SIGTERM/SIGINT reach it for graceful
# shutdown. See scripts/provision-spyglass-ro.sh + docs/OPERATIONS.md.
CMD ["sh", "-c", "umask 027 && exec node server.js"]
