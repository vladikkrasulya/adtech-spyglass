# ── Builder ──────────────────────────────────────────────────────────
# Install prod deps with the native-build toolchain (better-sqlite3 compiles
# bindings at install). The toolchain is *only* in this stage — runtime image
# stays small and surface-minimal.
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev

# ── Runtime ──────────────────────────────────────────────────────────
# No build tools, no dev deps, runs as the non-root `node` user (uid 1000).
# The host's /srv/DATA/AppData/adtech-spyglass is also uid 1000 (vk:vk),
# so the SQLite WAL/shm files are writable without an explicit chown step.
# .dockerignore filters .env / .git / node_modules / docs out of the build context.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node", "server.js"]
