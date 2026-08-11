# Contract: Build, Release, Deploy, and Rollback

**Owners**: package manifests, Dockerfile/Compose, GitHub workflows, `scripts/deploy*.sh`,
`scripts/rollback.sh`, smoke/backup scripts, and [docs/OPERATIONS.md](../../../docs/OPERATIONS.md)

This contract describes the mechanism. It does not authorize a commit, push, package publication,
deployment, rollback, image deletion, data restore, or other production mutation.

## Independent Release Surfaces

The app, Core, and CLI have independent SemVer lines. A change bumps only the surface whose public
contract changed and updates its package-lock workspace metadata and user-visible version surfaces in
the same feature. App version ownership is detailed in
[locales and versioning](./locales-versioning.md).

Core and CLI manifests are publishable packages, but the packages are currently repository
workspaces rather than verified npm registry releases. The GitHub publication workflow is manual,
defaults to dry run, runs the full CI/package gates, publishes Core before a dependent CLI, and
requires separate registry credentials. A live publish is restricted to `main` and follows
[docs/NPM_PUBLISH.md](../../../docs/NPM_PUBLISH.md).

An app SemVer bump does not deploy an image. A Core/CLI bump does not publish a package. Each external
mutation requires separate authorization and post-action verification.

## Production Image

The Dockerfile uses a Node 22 Alpine builder to install production workspace dependencies, including
native modules, then copies them and the filtered repository context into a clean Node 22 Alpine
runtime. The process runs as the non-root `node` user with a restrictive umask.

The image contains:

- server, backend modules, shared libraries, and workspace packages;
- browser assets and the vendored design system;
- synthetic/curated samples and the editorial content seed; and
- production dependencies.

The image excludes Git/CI metadata, Spec Kit and agent adapters, general documentation, tests,
secrets/environment files, local databases/logs/backups, build caches, Compose/Docker inputs, and
host-only scripts. The `.dockerignore` policy and immutable-image tests are merge gates.

Build provenance is injected rather than inferred at runtime:

- short Git SHA as `BUILD_SHA`, returned by `/api/health`;
- full Git SHA as the OCI revision label; and
- app version as the OCI version label.

Development builds may use a `dev` fallback. A production deployment uses an exact commit-derived
tag and verifies the expected build SHA.

## Runtime Topology

The application image is immutable. Source, packages, public assets, samples, and seed content have
no host bind mounts. `/data` is the only runtime mount and owns SQLite, deployment state, and
persistent editorial content. `CONTENT_DIR` points to `/data/content-posts` in Compose.

Consequences:

- editing source on the host does not change a running container;
- restarting a container is not a deployment and cannot load changed source;
- rollback restores the complete prior code/dependency/static snapshot; and
- `/data` survives image replacement and is never deleted by normal deploy/rollback scripts.

Compose requires an explicit image tag; it cannot silently select a local/dev image. The normal
verified steady state uses `restart: always`, a healthcheck, a loopback-only host port, the shared
service network, and a memory limit. An unverified transition overrides restart policy to `no`.

## Pre-Deployment Gates

The canonical deployment script fails before changing the running service unless:

1. repository `HEAD`, local `main`, and `origin/main` are identical;
2. the working tree is clean;
3. no prior candidate/rollback transition remains in an in-flight state;
4. environment, state, data-directory, database, and backup permissions meet the declared contract;
5. the read-only database group and directory mode are correctly provisioned;
6. persistent EN/UK/RU content can be seeded without overwriting existing content;
7. an existing service has a verifiable rollback image identity; and
8. both candidate and rollback target satisfy the immutable privacy-floor ancestry check.

The deployment script fetches remote Git state, builds the image, writes operator-owned state, and
controls Docker. Running it is therefore an explicitly authorized production operation, never an
ordinary implementation/test step.

## Crash-Safe Transition

The state machine is:

```text
ACTIVE
  → CANDIDATE_STARTING
  → CANDIDATE_READY
  → ACTIVE

candidate failure
  → ROLLING_BACK
  → ROLLED_BACK

unrecoverable transition
  → CRITICAL
```

Before starting the candidate, deployment records the attempt and rollback identity outside the Git
worktree. It starts the candidate with the transition Compose override and does not update the
persistent image tag or arm automatic restart.

A candidate is committed to `ACTIVE` only after:

1. readiness reaches the expected health state;
2. `/api/health` reports the expected `BUILD_SHA`;
3. the non-destructive public smoke passes; and
4. the deployment script pins the verified tag and arms `restart: always`.

The readiness gate is application/database health plus expected build identity. The optional
`sentry.ready` field reports only whether the local SDK retained a parsed destination; it is not a
deployment gate and does not prove upstream delivery. A real controlled delivery check is a separate
operator procedure after explicitly authorized configuration/deployment work. Telegram remains an
independent incident channel.

If the host/process stops during an unverified phase, Docker must not resurrect the candidate
automatically. The in-flight state blocks a new blind deploy and requires an operator to inspect and
restore a known-good image.

## Smoke Boundary

The production smoke verifies:

- health and exact build identity;
- a synthetic `/api/analyze` call;
- demand-gated SSE output;
- primary EN/UK/RU page routes;
- seeded Markdown content in all three locales; and
- container health/restart count when a container name is supplied.

It does not change source, configuration, account-owned SQLite rows, or editorial content. By product
design it can create derived validation/event telemetry and warm the synthetic specimen cache. Those
side effects are disclosed in the smoke script and in [data retention](./data-retention.md).

## Rollback

Before a new candidate, the current image is retained under a tag derived from that image's own build
SHA. This prevents different commits with the same app version from overwriting one rollback
identity.

Automatic and manual rollback both:

- resolve expected build identity from the selected image;
- enforce the privacy floor;
- start with automatic restart disabled;
- wait for readiness and run the same smoke against the rollback SHA; and
- pin the tag and arm restart only after verification.

If candidate and rollback both fail, state becomes `CRITICAL`; the scripts do not claim an active
image. Rollback does not alter Git or `/data` and does not restore database backups. Data restore is a
separate operator procedure.

## Backups and Recovery

The SQLite backup script uses SQLite's WAL-aware `.backup` operation, then compresses and
permission-restricts the archive. Its daily archive retention is 30 days. Host-level snapshots have a
separate operator policy and include the persistent application data/content; ClickHouse backup is
outside this repository's application script.

Restore stops the writer, preserves the displaced database for recovery, removes stale WAL sidecars,
restores a selected archive, checks integrity, starts the verified image, and re-runs health. A
restore target, archive, and production stop/start always require explicit operator authorization.

Application source requires no runtime backup because exact images and Git own it. Secrets are not
baked into images or tracked memory; runtime environment and secret-vault recovery remain in the
operator runbook.

## CI and Pre-Merge Gates

Local `npm run ci` runs Prettier check, ESLint, JSDoc/TypeScript checking, and the Node suite with
coverage. GitHub CI on `main` pushes and pull requests uses full Git history, then runs formatting,
lint, type checking, tests, npm pack smoke, and an isolated production Docker smoke.

The standard CI workflow does not query the mutable npm advisory service. A dependency-security
feature therefore records both full and production-only `npm audit` results separately, in addition
to an offline regression for the advisory floors it changes.

The Docker CI smoke builds a temporary image, uses a disposable data volume/container, verifies
health/analyze and native dependency loading, then removes those local artifacts. It does not use the
production Compose service. Deploy/rollback/backup/cutover shell behavior is additionally exercised
through simulations and isolated fixtures.

No documentation hard-codes a passing test total. Exact command output for the current feature is the
evidence authority.

## Change Rule

A dependency/runtime, image-content, mount, provenance, health, readiness, smoke, permission,
privacy-floor, transition, rollback, backup, or publication change updates this contract, the
operator/public package document, and its regression/simulation tests together. Before handoff, run
the packaging/deployment and complete gates in [quickstart.md](../quickstart.md). Production deploy
or npm publication remains a separate decision after merge.
