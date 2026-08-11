# Quickstart: Validate Safe Blog Markdown

Run from the repository root with feature 003 active. Use only synthetic/tracked content and never a
production endpoint, content directory, ClickHouse destination, or real admin token.

## 1. Confirm Feature and Scope

```bash
.specify/scripts/bash/check-prerequisites.sh --json
git status --short
git diff --stat main
git diff main -- public/modules/blog public/vendor package.json package-lock.json \
  .prettierignore design-system.vendor.json scripts/ci-docker-smoke.sh \
  tests CHANGELOG.md SECURITY.md specs
```

Expected: Spec Kit resolves `specs/003-blog-markdown-safety`; changes stay within the planned Blog
render/vendor/test/document/version surfaces; crawler, database schema, global CSP, deployment, Core,
and CLI behavior are unchanged.

## 2. Reproduce and Verify Vendor Assets

```bash
npm ci
npm ls --all marked dompurify
node scripts/sync-browser-vendors.js --check
NODE_ENV=test LOG_LEVEL=silent node --test --test-reporter=spec \
  tests/browser-vendor-parity.test.js
```

Expected: exact `marked@15.0.12` and `dompurify@3.4.13` development packages resolve from the lock;
both checked-in ESM assets and copied licenses match the installed package files byte-for-byte; the
plain-text notice records their checksums/provenance; no command writes during check mode.

## 3. Run the Final-Document and Promotion Gates

```bash
NODE_ENV=test LOG_LEVEL=silent node --test --test-reporter=spec \
  tests/blog-markdown-safety.test.js \
  tests/blog-promotion-safety.test.js \
  tests/security-headers.test.js
```

Expected:

- every exact FR-013 security class ends as inert content inside the final `.blog-post__body`;
- every tracked post and supported synthetic Markdown construct remains readable, with full supported
  browser semantics;
- raw HTML is visible text, image syntax preserves alt text without a resource node, and unsafe links
  retain labels without navigation;
- a test-local resource/fetch observer records zero body-driven request attempts;
- Markdown, published-news, unknown/missing, and forced-failure modes cross the same final policy;
- the synthetic RSS → authorized promotion → temporary file → public handler → Blog mount chain is
  inert and removes its temporary data; and
- the application still applies its baseline security headers, while the tests do not rely on CSP as
  the body sanitizer.

## 4. Run Existing Blog, SSR, SEO, and RSS Regressions

```bash
NODE_ENV=test LOG_LEVEL=silent node --test --test-reporter=spec \
  tests/seo.test.js \
  tests/blog-handler-contract.test.js \
  tests/blog-search-contract.test.js \
  tests/cp2-indexing.test.js \
  tests/cp2-getpost-clickhouse.test.js \
  tests/cp2-rss-empty.test.js \
  tests/cp2-rss-pubdate.test.js \
  tests/news-moderator.test.js
```

Expected: limited SSR stays escape-first and readable for the complete compatibility corpus; Blog
list/post API shapes, source classification, and search indexing/navigation stay stable;
indexability, RSS, and published-news behavior do not change. Full browser Markdown semantics are
not imposed on SSR.

## 5. Verify Documentation, Governance, and Version Surfaces

```bash
NODE_ENV=test LOG_LEVEL=silent node --test --test-reporter=spec \
  tests/docs-truth.test.js \
  tests/spec-kit-contract.test.js \
  tests/version-consistency.test.js
```

Expected: the prior unsanitized trusted-editorial exception is absent from current contracts; the
new source-neutral render invariant and deferred adjacent findings are documented; the app PATCH
version is consistent everywhere; Core and CLI versions remain unchanged.

## 6. Audit and Static Gates

The two audit commands query the npm advisory service and therefore require ordinary approved
network access. Run and record them separately.

```bash
npm audit
npm audit --omit=dev
npm run format:check
npm run lint
npm run typecheck
git diff --check
```

Expected: both dependency graphs report zero current findings; generated/vendor license files are
excluded from formatting only where byte parity requires it; all repository static gates pass.

## 7. Run Complete CI and Production-Shaped Asset Smoke

```bash
npm run ci
bash scripts/ci-docker-smoke.sh
git status --short
```

Expected: the complete repository gate passes; the disposable immutable-image smoke serves the
hashed Blog module and both vendor imports from the production image without external content
requests. The smoke must not target production or deploy an image. Record Docker unavailability or
sandbox process restrictions explicitly rather than marking an unrun gate successful.

## 8. Converge

The pre-implementation `speckit.analyze` result must already be recorded in `tasks.md`. After all
verification, run `speckit.converge`. If convergence appends tasks, implement and verify them, then
repeat until clean. Update `tasks.md`, the feature status, and `specs/ROADMAP.md` with exact current
evidence.

Commit, push, PR creation, merge, package publication, deployment, cache purge, production content
inspection, and production data migration remain separate explicit decisions.
