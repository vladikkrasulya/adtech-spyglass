# Contributing to ortbtools

ortbtools uses GitHub Spec Kit as its working-memory and delivery system. Do
not infer project policy from an agent-specific file or from an old planning
document: the canonical sources below own separate concerns.

## Start here

Before changing code or documentation, read:

1. [Project constitution](./.specify/memory/constitution.md) — binding
   engineering and governance rules.
2. [Specs index](./specs/README.md) and [current roadmap](./specs/ROADMAP.md) —
   document ownership and active priorities.
3. [Platform baseline](./specs/000-platform-baseline/plan.md) — the current
   as-built architecture and links to its contracts.
4. The active feature directory under `specs/NNN-feature/` — the approved
   requirements, plan, tasks, contracts, and verification evidence for the
   change in progress.

Public and operational documentation remains canonical in its own domain:

- [privacy](./docs/PRIVACY.md) and [security](./SECURITY.md);
- [operations](./docs/OPERATIONS.md) and
  [release publishing](./docs/NPM_PUBLISH.md);
- [public API v1](./docs/api-v1.md) and
  [user guide](./docs/USER_GUIDE.md);
- [Core rules](./packages/core/rules/README.md) and
  [frontend modules](./public/modules/README.md).

If two active documents disagree, stop and resolve the ownership conflict in
the same change. Do not create a third description.

## Local setup

Requirements:

- Node.js 22.13 or newer;
- npm;
- `uv` when installing or upgrading the pinned Spec Kit CLI;
- Docker with Docker Compose for a production-like runtime;
- Git.

Install the root workspace once:

```bash
npm install
```

The root workspace includes the app, `packages/core`, and `packages/cli`.
Package-local installs are not required.

For the production-like application, copy `.env.example` to `.env`, choose a
writable host path for the `/data` mount, then build and start the immutable
image:

```bash
docker compose up -d --build
```

The default local URL is `http://127.0.0.1:8090`. Source is baked into the
image; rebuild after source changes. A restart alone reuses the old image.

## Spec Kit workflow

Codex, Claude, Cursor, and Gemini integrations are tracked in this repository.
Use the corresponding `speckit-*` skill or command supplied by the active
agent integration. The project does not use `AGENTS.md` or `CLAUDE.md` as a
parallel policy source. CLI installation and regeneration use the exact release
in the [foundation quickstart](./specs/001-spec-kit-foundation/quickstart.md),
never an automatic upgrade during ordinary work.

For an uncertain product idea, read the constitution and memory index above,
then start with the `assess` workflow. Its bundled adapters are a bounded
pre-delivery funnel and do not automatically load full project context. A
`go` decision returns through `speckit.specify`. For an approved change, use
this full sequence:

1. `speckit.specify` — define user outcomes and testable requirements.
2. `speckit.clarify` — resolve material ambiguity before planning.
3. `speckit.plan` — record the implementation design and affected contracts.
4. `speckit.checklist` — create the domain-specific requirement checklist.
5. `speckit.tasks` — produce ordered, independently verifiable work.
6. `speckit.analyze` — prove requirements, plan, and tasks are consistent.
7. `speckit.implement` — implement only the approved scope in bounded phases.
8. Run the relevant tests and the full repository CI gate.
9. `speckit.converge` — compare the finished implementation with the spec and
   record any remaining work. If it adds tasks, implement and verify them
   before converging again.

Feature selection is local to each worktree. On a fresh checkout, take the
active path from `specs/ROADMAP.md` and seed the ignored pointer before a phase
that expects an existing plan or task list:

```bash
SPECIFY_FEATURE_DIRECTORY=specs/NNN-feature \
  .specify/scripts/bash/check-prerequisites.sh --json --require-tasks
```

The command persists `.specify/feature.json` locally. Do not commit that
pointer, and change it deliberately when switching features.

The bundled headless workflow is not a substitute for these review gates.
Commits, pushes, pull requests, releases, and deployments always require
explicit authorization; a completed Spec Kit plan does not authorize them.

All tracked Spec Kit files are public repository content. Use synthetic or
redacted evidence only: never put payload bodies, credentials, tokens, DSNs,
email or IP addresses, production records, or private incident URLs in a spec,
assessment, task, or ADR.

## Where changes belong

- Core validation, detection, crosscheck, dialect, or finding behavior:
  `packages/core/`.
- CLI behavior: `packages/cli/`.
- Backend routes: `modules/<feature>/handler.js`, registered through the
  router in `server.js`.
- Browser features: `public/modules/`; follow the caller-specific lifecycle
  in the frontend module guide.
- Shared backend infrastructure: `lib/`.
- Product and browser tests: flat files under `tests/*.test.js` so the standard
  test glob discovers them.

Changes to stable behavior must update the owning baseline contract or feature
contract. A non-obvious architectural choice belongs in an ADR indexed by
`specs/DECISIONS.md`. Current priority belongs only in `specs/ROADMAP.md`.

## Verification

During implementation, run the smallest relevant test file first:

```bash
node --test tests/<area>.test.js
```

Before handoff, run the full local gate:

```bash
npm run ci
```

That command checks formatting, lint, JSDoc type checking, tests, and coverage.
Use additional gates when the changed surface requires them:

- `bash scripts/npm-pack-smoke.sh` for package or publishing changes;
- `bash scripts/ci-docker-smoke.sh` for runtime, dependency, image, or deploy
  changes;
- a focused browser or production-like smoke for user-visible behavior.

Do not hard-code test totals in documentation. Record commands, exit status,
and relevant evidence in the active spec instead.

The tracked `.githooks/pre-push` hook can be enabled per clone with:

```bash
git config core.hooksPath .githooks
```

It runs the local gate only for a direct push to `main`; feature branches rely
on the same checks in GitHub CI. Do not bypass a failing gate.

## Change discipline

- Preserve stable finding IDs, ordering, deduplication, and API shapes unless
  the active spec explicitly approves a breaking change.
- Keep English, Ukrainian, and Russian user-facing surfaces in parity.
- Update the independent App, Core, or CLI SemVer surface only when its public
  contract changes, and update the changelog in the same change.
- Keep changes scoped. Do not mix unrelated dependency, feature, cleanup, or
  production mutations into one pull request.
- Do not commit generated secrets, local data, `.env`, or production evidence.

Open a pull request against `main`, include the active spec path and exact
verification commands, and wait for green CI before merge. Deployment is a
separate, explicitly authorized operation governed by the release/deploy
contract and operations runbook.
