# Quickstart: Validate the Platform Baseline

Run from the repository root in a development checkout. These checks use synthetic fixtures and
temporary data directories; they do not require production data or a live public service.

## 1. Confirm the Declared Runtime and Versions

```bash
node --version
node -e "for (const p of ['package.json','packages/core/package.json','packages/cli/package.json']) { const x=require('./'+p); console.log(x.name, x.version, x.engines.node) }"
```

Expected: the active Node runtime satisfies the root engine, and the three manifests report the app,
Core, and CLI versions recorded in [spec.md](./spec.md).

## 2. Validate the Core and CLI Contracts

```bash
node --test \
  tests/api-stability.test.js \
  tests/validator.test.js \
  tests/format-detect.test.js \
  tests/ortb30.test.js \
  tests/mirror.test.js \
  tests/behavior.test.js \
  tests/cli.test.js
```

Expected: stable finding order/deduplication, version and format routing, 3.0 coverage, mirror
self-testing, behavior rules, and CLI exit semantics pass without network access.

## 3. Validate HTTP Composition and Privacy

```bash
node --test \
  tests/router.test.js \
  tests/health.test.js \
  tests/analyze-location-api.test.js \
  tests/privacy-claims.test.js \
  tests/privacy-floor.test.js \
  tests/model-free-contract.test.js \
  tests/proxy.test.js
```

Expected: route matching, health disclosure tiers, analyze response enrichment, no raw payload
persistence, deterministic interactive intelligence, and SSRF controls match the baseline.

## 4. Validate Frontend Lifecycle and Browser State

```bash
node --test \
  tests/inspector-reentrant.test.js \
  tests/session-hoist.test.js \
  tests/window-contracts.test.js \
  tests/browser-core-parity.test.js \
  tests/intel-browser-cache.test.js \
  tests/crypto.test.js
```

Expected: route sections can deactivate and remount without leaked lifecycle state, browser/Core
copies remain aligned where used, discovery caching stays bounded by its contract, and crypto
round-trips reject tampering.

## 5. Validate Persistence and Retention Boundaries

```bash
node --test \
  tests/db.test.js \
  tests/auth.test.js \
  tests/auth-event-pii.test.js \
  tests/cached-specimens.test.js \
  tests/event-log.test.js \
  tests/analytics-enabled.test.js
```

Expected: schema/migrations, account scoping, session and wipe behavior, synthetic cache eviction,
auth-event minimization, and optional ClickHouse gating pass using disposable state.

## 6. Validate Locales, Content, and SEO

```bash
node --test \
  tests/locale-routes.test.js \
  tests/seo.test.js \
  tests/seo-html.test.js \
  tests/landings.test.js \
  tests/cp2-indexing.test.js \
  tests/source-nav-i18n.test.js \
  tests/version-consistency.test.js
```

Expected: canonical locale routing, route-specific metadata, default-deny blog indexing, localized
navigation, and app-version surfaces remain consistent.

## 7. Validate Packaging and Immutable Deployment Logic

```bash
node --test \
  tests/immutable-image.test.js \
  tests/npm-pack-manifest.test.js \
  tests/cutover-coordination.test.js \
  tests/crash-recovery.test.js \
  tests/rollback-tag-retention.test.js
bash scripts/npm-pack-smoke.sh
```

Expected: runtime image boundaries, package contents, fail-closed transition rules, and package
workspace installation pass without publishing or deploying anything.

When Docker is available, reproduce the CI image gate in an isolated container and disposable
volume:

```bash
bash scripts/ci-docker-smoke.sh
```

This builds and deletes a temporary local image/container/volume. It does not target the production
compose service.

## 8. Run the Complete Repository Gate

```bash
npm run ci
git diff --check
```

GitHub CI additionally runs package smoke and the isolated Docker production smoke. The current test
runner output is the authority for test counts; this baseline deliberately does not duplicate them.

## Change-Specific Routing

| Changed surface                       | Read first                                                   | Minimum focused verification                |
| ------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| Core rule/detection/finding           | [Core contract](./contracts/core-validator.md)               | Step 2 plus the rule-specific test          |
| HTTP handler or auth                  | [HTTP contract](./contracts/http-api.md)                     | Step 3 plus the handler test                |
| Browser section/action                | [Frontend contract](./contracts/frontend-modules.md)         | Step 4 plus the module test                 |
| Collection, storage, crypto, deletion | [Retention contract](./contracts/data-retention.md)          | Steps 3 and 5 plus privacy guards           |
| Route, post, sitemap, landing         | [Content/SEO contract](./contracts/content-seo.md)           | Step 6                                      |
| Locale or release version             | [Locale/version contract](./contracts/locales-versioning.md) | Step 6 plus affected UI/Core tests          |
| Docker, deploy, rollback, backup      | [Release/deploy contract](./contracts/release-deploy.md)     | Step 7 plus the applicable shell simulation |

Before merge, every behavior change still runs the complete repository gate and any Docker/browser
or operator simulation required by the affected contract.
