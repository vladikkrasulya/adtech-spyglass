# Contributing to ortbtools

This document covers the full contributor workflow: local setup, the dev loop,
code conventions, adding rules / modules / routes, and the commit protocol.
For the codebase map read [ARCHMAP](./docs/ARCHMAP.md) first.

---

## Prerequisites

- **Node 22.13+** — production Docker image, ESLint 10, and the test runner (`node --test`) require it.
- **Docker + Docker Compose** — the runtime is container-only; no native
  `node server.js` path for non-trivial local dev.
- **Git** — standard workflow, PR against `main`.
- Linux is the primary platform. macOS works; Windows is untested.

---

## Cloning + first run

```bash
git clone <repo-url> ortbtools
cd ortbtools
npm install          # installs root deps + all workspace packages
```

This repo is an **npm workspace** with two packages: `packages/core/` (the
`@ortbtools/core` validator engine) and `packages/cli/` (the
`@ortbtools/cli` command-line wrapper). The private root package aggregates
both; `npm install` at the root covers the app and both workspaces. You never
need to install dependencies separately inside either package directory.

### Start the container

```bash
docker compose up -d --build
```

The UI is at **http://127.0.0.1:8090**. The container name is
`ortbtools`; the app listens on port 3000 inside and is forwarded to
8090 on the host.

`docker compose up -d --build` is required on first run and after every source
edit. The runtime image is immutable; source files are not bind-mounted into a
running container.

### SQLite database

The compose file bind-mounts `/srv/DATA/AppData/ortbtools:/data` for
persistent SQLite. That path is the maintainer's production path. On a fork or
contributor machine, change the left side of that bind mount to any directory
you own — the container only cares about `/data` inside. Alternatively, add a
`docker-compose.override.yml`:

```yaml
services:
  ortbtools:
    volumes:
      - ./data:/data
```

The database is auto-created by `db.js` on first boot; no migration step needed.

### Config

Copy `.env.example` to `.env`. The defaults run without auth or email. You
only need `RESEND_API_KEY`, `EMAIL_FROM`, and `EMAIL_TOKEN_SECRET` if you want
the register/verify/reset flow; `PUBLIC_BASE_URL` for the production domain.

---

## The dev loop

All application source is baked into the immutable image: `public/`,
`packages/`, `modules/`, `lib/`, `samples/`, and the root server files. The
vendored `public/design-system.css` is baked too. The only runtime mount is the
`/data` directory for SQLite and persisted blog content.

After any source edit, run the relevant tests and rebuild the image:

```bash
docker compose up -d --build
```

To surface the build SHA in `/api/health`:

```bash
BUILD_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
```

The ARCHMAP [§2.1](./docs/ARCHMAP.md#21-what-rebuilds-vs-what-doesnt) documents
the immutable deploy contract. A plain `docker compose restart` only restarts
the existing image and never loads host-side source edits.

---

## Code style + conventions

### Formatting

All code is formatted with Prettier. Don't fight it; run:

```bash
npm run format          # write in place
npm run format:check    # check only (what CI runs)
```

Prettier config lives in `.prettierrc` (or `package.json` — check which).

### Linting

ESLint with custom rules. Most issues are auto-fixable:

```bash
npm run lint            # check
npm run lint:fix        # auto-fix
```

The `no-var` rule is enforced. A common batch failure after a long WIP stack is
seeing several `no-var` and unused-catch-binding warnings all surface at once —
they accumulate silently until `npm run ci` runs the full lint pass. Run
`npm run lint` early and often.

### TypeScript via JSDoc

The codebase uses `// @ts-check` at the top of files and JSDoc annotations for
type information. There are **no `.ts` files** and no transpilation step. This
keeps the build-step zero — what you see is what the Node runtime executes.

```bash
npm run typecheck       # runs tsc --noEmit over the JSDoc annotations
```

When adding or modifying a function, keep the `@param` / `@returns` annotations
in sync. The `tsconfig.json` at the root controls the check surface.

### Comments

Comment the **why**, not the **what**. The code itself should be readable enough
that "// increment i" adds nothing. What belongs in a comment: non-obvious
constraints ("// alpine resolves 'localhost' as ::1 first; app listens IPv4
only"), deferred work ("// AdCOM 1.0 deep validation — deferred, no production
3.0 traffic yet"), cross-references ("// see ARCHMAP §2.1 for image contract").

### Locales

Three locales ship: `en`, `uk`, `ru`. When you touch any user-facing copy —
error messages, UI labels, finding descriptions — update all three. The key
places:

- `packages/core/messages/{en,uk,ru}.json` — validator finding messages
- `public/i18n.js` — browser chrome strings
- `public/modules/<name>/i18n.js` — per-module strings (if the module has one)
- HTML templates per locale (see "Adding a frontend module" below)

Ukrainian and Russian copy uses the informal second person ("ти", not "Ви").
English copy is plain imperative / declarative — no "Please" prefix.

### SemVer bumps

App, Core, and CLI use independent SemVer lines. Choose the surface from the
public contract that changed; a typical backward-compatible feature is MINOR
and a fix is PATCH, but an app-only change must not bump Core or CLI.

- **App:** update root `package.json`, root metadata in `package-lock.json`,
  `public/version.js`, and the six static HTML fallbacks guarded by
  `tests/version-consistency.test.js`.
- **Core:** update `packages/core/package.json` and its workspace entry in
  `package-lock.json` only when the engine contract changes.
- **CLI:** update `packages/cli/package.json` and its workspace entry in
  `package-lock.json` when CLI flags/output change; align its Core dependency
  range when required.

Keep the version and CHANGELOG entry in the same commit. See
[ARCHMAP §2.4](./docs/ARCHMAP.md#24-independent-semver-release-surfaces) for
the exact release surfaces.

---

## Adding a validator rule

The validator has two layers:

1. **Baseline flat-file rules** — `packages/core/rules-request.js` and
   `rules-response.js`. These cover the IAB-spec baseline and are unlikely to
   need new entries from contributors (additions here require careful version
   gating and spec-ref citations).

2. **Plugin-style rules** — `packages/core/rules/`. One folder per rule group,
   registered in `packages/core/rules/index.js`. This is the right place for
   new checks.

The full plugin contract is in
[`packages/core/rules/README.md`](./packages/core/rules/README.md). Short
version: a plugin is a folder with an `index.js` exporting `{ id, description,
appliesTo, validate(payload, ctx) → Finding[] }`. Add the folder, add one line
to the `PLUGINS` array in `rules/index.js`, done.

Every new finding `id` must also appear in
`packages/core/spec-refs.json`. The `tests/spec-refs.test.js` gate will fail
CI if you add a finding id without a corresponding spec-ref entry.

Tests for the new rule go in `tests/rules-plugins.test.js` or a new
`tests/<rule-name>.test.js`.

---

## Adding a frontend module

The loading and lifecycle contracts are documented in
[`public/modules/README.md`](./public/modules/README.md). First decide whether
the feature is a lazy SPA section, persistent shell/chrome code, or a
feature/action/compatibility helper; the caller determines its contract.

A typical directory uses only the files it needs:

```
public/modules/<tool>/
  index.js              ES module or classic compatibility entry point
  i18n.js               optional namespaced translations
  template.en.html      injected DOM (only if the tool adds markup)
  template.uk.html
  template.ru.html
  styles.css            tool-specific styles (optional)
  README.md             what the tool does, window.* APIs, events
```

SPA sections default-export the registry contract and are registered lazily in
`public/shell-boot.js`; use `ctx.signal` and `ctx.addCleanup()` for lifecycle
ownership. Direct ES imports and the event bus are preferred in module code.
Existing classic compatibility helpers may use documented `window.*` APIs and
`kt:` events. See the modules README and the existing caller before wiring a
new feature.

### Asset versioning

You don't bump cache-bust tokens manually. `server.js` runs
`rewriteAssetVersions()` at boot, which replaces `__<MODULE>_BUNDLE_HASH__`
tokens in the shell HTML with a content hash of all files under
`public/modules/<module>/`. Touch any file in the module folder → hash changes
→ browser cache invalidates. This is automatic; don't add `?v=` query strings
by hand.

To register a new lazy module in the dispatcher, add a case to the
`data-action` switch in `public/ortbtools.app.js` that does:

```js
case 'open-mytool':
  await import('/modules/mytool/index.js?v=__MYTOOL_BUNDLE_HASH__');
  window.openMyTool?.();
  break;
```

The `__MYTOOL_BUNDLE_HASH__` token is replaced at runtime; just follow the
pattern of an existing module.

---

## Adding a server route

Backend handlers live in `modules/<tool>/handler.js`. Each handler exports
either a plain `{ id, routes }` object or a `createXxxModule(deps)` factory
that returns the same shape. Routes are registered with `lib/router.js` at
boot in `server.js`.

The router in `lib/router.js` supports exact matches, `:id` params, and
trailing-`*` wildcards. `lib/http.js` provides `readJson`, `sendJson`,
`sendError`, and `makeError` helpers — use them instead of writing raw
`res.write` / `res.end` calls.

Since `server.js`, `lib/`, and `modules/` are all baked into the image,
any change to a handler requires `docker compose up -d --build`.

See [ARCHMAP §0](./docs/ARCHMAP.md#0-module-layout)
for the full backend module inventory and §1.4 for the consumer table.

---

## i18n

Three shell HTML files per locale serve the root routes (`/`, `/uk/`, `/ru/`):

```
public/index.en.html
public/index.uk.html
public/index.ru.html
```

About pages follow the same pattern (`about.{en,uk,ru}.html`). The inspector
workbench is injected from:

```
public/modules/inspector/template.{en,uk,ru}.html
```

Browser chrome strings (nav, toasts, modal titles, shared labels) live in
`public/i18n.js` as a single `I18N` object keyed by locale then string id.
Module-specific strings live in `public/modules/<name>/i18n.js` and are merged
into the global table at load time via `window.registerI18nModule()`.

Validator finding messages (the human-readable explanations with fix hints) live
in `packages/core/messages/{en,uk,ru}.json`. These are keyed by stable finding
`id` strings and are kept in sync manually — there is no test that enforces
all three locales have the same key set (yet), so check all three when you add
a finding.

---

## Commit + PR workflow

### Commit message format

Follow the style visible throughout CHANGELOG.md:

```
fix(ui): v0.X.Y — short description of the change

Why this exists / what problem it solves. One or two sentences.
Keep it factual — the reader shouldn't need to look at the diff to
understand the motivation.

What changed:
- file.js — specific thing that changed and why
- other.js — specific thing

Verified:
- N tests pass; prettier+lint+typecheck clean.
- Manual smoke: [what you checked]
```

The subject line format is `<type>(<scope>): vX.Y.Z — <title>`. Version in the
subject is optional for non-release commits (hotfixes, WIP on a branch) but
required for version-bump commits.

If you used an LLM for any part of the change, add a co-authorship trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Use whatever model you actually used. Don't invent one.

### Pre-push hook

The hook itself lives in the repo at `.githooks/pre-push` (tracked, so it
stays in sync for everyone). Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

That's a `--local` config write — it stays in `.git/config` for this clone
only, no global side-effects.

After that, every `git push` to `main` runs:

```
npm run format:check && npm run lint && npm run typecheck && npm test
```

All four steps must pass before the push is accepted. Don't use `--no-verify`.
If one step fails, investigate and fix it — that's the point of the gate.
Non-main branches skip the check (the hook short-circuits at the top).

The most common failure after a long WIP stack: you haven't run `npm run ci`
in a while and several issues accumulated in parallel — Prettier complaints on
reformatted files, `no-var` ESLint warnings, JSDoc typecheck errors, and
unused-catch-binding warnings all surface together. Run them individually to
triage:

```bash
npm run format:check    # fails? run `npm run format` to fix
npm run lint            # fails? run `npm run lint:fix` for autos; the rest are manual
npm run typecheck       # fails? JSDoc annotation out of sync with usage
npm test                # fails? a test is broken or a spec-refs entry is missing
```

### Pull request

Open a PR against `main`. Wait for CI green before merging. Self-merge is fine
if you're the maintainer and CI is green. There's no required reviewer count
set, but for significant changes (new module, schema change, crypto touch)
request a review explicitly.

---

## Common gotchas

- **Immutable-image trap**: edited any source file and the change isn't live?
  Rebuild and recreate the container. `compose restart` only restarts the
  existing image.

- **CSS source-order trap**: added a media-query override and it doesn't fire?
  The unconditional desktop rule is declared later in the file and wins on
  equal specificity. Wrap the desktop rule in `@media (min-width: ...)` or move
  the mobile override to the end of the file with an anchor comment. (Surfaced
  in v0.42.9 — see CHANGELOG for the pattern.)

- **spec-refs gate**: added a new finding id but forgot to add it to
  `packages/core/spec-refs.json`? `tests/spec-refs.test.js` will fail with a
  clear "unknown finding id" message.

- **Message key drift**: added a finding but only updated one locale's message
  file? The other locales will render the raw key string instead of a
  human-readable message. Check all three message files together.

- **`disabledRules` not working**: edited `packages/core/` but tested against
  the old running image? Rebuild and recreate the container; packages are baked
  with the rest of the source.

- **Test count drift**: the ARCHMAP lists the test count as of its last-touched
  date. The README's test count was accurate at v0.40.x. Neither is guaranteed
  current — run `npm test` and trust the live number.
