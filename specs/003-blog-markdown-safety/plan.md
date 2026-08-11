# Implementation Plan: Safe Blog Markdown

**Branch**: `assess/browser-markdown-boundary` | **Date**: 2026-08-11 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from `specs/003-blog-markdown-safety/spec.md`

## Summary

Close the browser Markdown trust boundary at the one final Blog-body render seam. Keep the existing
vendored Marked parser for supported editorial semantics, override raw HTML and image tokens into
inert text, pass every browser body source through an explicit DOMPurify allowlist, and append the
result as a `DocumentFragment` rather than interpolating parser output into the page shell. Pin both
browser libraries in npm and verify the checked-in browser assets against the lockfile-installed
artifacts. Preserve the public Blog API, source classification, escape-first published-news path,
limited safe SSR, SEO/RSS behavior, and admin authorization model. Prove the boundary offline with a
fixed synthetic security matrix, the full tracked EN/UK/RU Markdown corpus, and the existing
promotion handler using only temporary storage and mocked infrastructure.

## Technical Context

**Language/Version**: Browser ES modules and vanilla JavaScript; Node.js `>=22.13.0` for server and
verification code; Markdown

**Primary Dependencies**: Existing Marked `15.0.12`, pinned as an exact development/provenance
dependency; DOMPurify `3.4.13`, pinned the same way and checked in as its upstream ESM production
asset; existing jsdom `29.1.1` test environment

**Storage**: Existing repository and persistent `CONTENT_DIR` Markdown files plus existing
ClickHouse Blog rows; no schema, migration, production read, or data rewrite

**Testing**: `node:test`, jsdom final-document assertions with a zero-attempt resource/fetch observer,
temporary content directories, mocked ClickHouse transport, tracked Markdown fixtures, vendor-byte
integrity checks, existing SSR/SEO/RSS tests, npm audit, full `npm run ci`, and disposable Docker
smoke

**Target Platform**: Modern browsers already supported by the SPA and the Linux Node.js production
container; no new browser support promise

**Project Type**: Brownfield vanilla Node.js web application with lazy browser modules and a hybrid
filesystem/ClickHouse Blog

**Performance Goals**: One parse-and-sanitize pass when a post opens; no body-driven resource
request, background job, or network dependency; no change to listing/search/RSS paths

**Constraints**: No home-grown sanitizer; no bundler, framework, service, CSP redesign, Trusted Types
rollout, production content inspection, real credential, or external network in tests; unsupported raw
HTML remains visible as inert text; Markdown images retain alternative text but load no resource

**Scale/Scope**: One browser render seam, two pinned browser assets, one app PATCH line synchronized
across every current version surface, a fixed security/compatibility corpus, focused
promotion/render tests, the affected current baseline artifacts, one security-policy update, and one
durable ADR

## Constitution Check

_GATE: Passed before Phase 0 research and re-checked after Phase 1 design._

| Principle                              | Gate                                                                                                                      | Result |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| I. Spec Kit Is the Working Memory      | Assessment and feature 003 own the evidence, spec, plan, contracts, tasks, verification, and convergence                  | PASS   |
| II. Truth Is Evidence-Backed           | The verified source-to-sink chain, tracked corpus, parser behavior, and current public contracts are recorded separately  | PASS   |
| III. Privacy and Security Boundaries   | Only synthetic/tracked text enters tests; no production content, secrets, tokens, private links, or network egress        | PASS   |
| IV. Deterministic Public Contracts     | Blog response shapes, routes, status behavior, source classification, SSR, RSS, and published-news rendering stay stable  | PASS   |
| V. Explicit and Bounded Architecture   | The existing lazy Blog module remains owner; one maintained DOM sanitizer replaces the unsafe exception                   | PASS   |
| VI. Locale Meaning Moves Together      | No new localized copy is planned; all tracked EN/UK/RU posts and every version fallback move together                     | PASS   |
| VII. Proportional Verification         | Fixed final-document matrices, promotion-chain proof, vendor integrity, audits, full CI, and Docker smoke are required    | PASS   |
| VIII. Traceable Releases and Mutations | App receives a PATCH bump; Core/CLI stay unchanged; no commit, push, PR, publish, deploy, or content migration is implied | PASS   |

## Project Structure

### Documentation (this feature)

```text
specs/003-blog-markdown-safety/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   ├── requirements.md
│   └── content-security.md
├── contracts/
│   ├── blog-rendering.md
│   └── vendor-integrity.md
└── tasks.md
```

### Repository Changes

```text
package.json
package-lock.json
CHANGELOG.md
.prettierignore
design-system.vendor.json

public/
├── version.js
├── about.{en,uk,ru}.html
├── modules/
│   ├── blog/index.js
│   ├── blog/markdown-renderer.js
│   └── inspector/template.{en,uk,ru}.html
└── vendor/
    ├── NOTICE.txt
    ├── dompurify.es.js
    ├── licenses/
    │   ├── DOMPurify-Apache-2.0.txt
    │   └── Marked-MIT.txt
    └── marked.es.js

tests/
├── browser-esm-loader.js
├── blog-dom-assertions.js
├── blog-markdown-fixtures.js
├── blog-markdown-safety.test.js
├── blog-promotion-safety.test.js
├── blog-handler-contract.test.js
├── blog-search-contract.test.js
├── browser-vendor-parity.test.js
├── docs-truth.test.js
├── security-headers.test.js
├── seo.test.js
└── version-consistency.test.js

SECURITY.md
specs/ROADMAP.md
specs/DECISIONS.md
specs/decisions/ADR-011-browser-markdown-sanitization.md
specs/000-platform-baseline/contracts/
├── content-seo.md
└── locales-versioning.md
specs/000-platform-baseline/spec.md
specs/000-platform-baseline/plan.md

scripts/sync-browser-vendors.js
scripts/ci-docker-smoke.sh
```

The plan expects no runtime change to the crawler, promotion endpoint, Blog HTTP handler, SSR
renderer, CSP, database, or production deploy/rollback scripts. The disposable CI Docker smoke gains
static Blog/vendor assertions; tests otherwise exercise existing seams through their public handlers
and exported contracts. If implementation discovers that a source change outside this tree is
necessary, `speckit.analyze` or an explicit plan amendment must account for it before the change
lands.

**Structure Decision**: Add one ESM renderer beside the owning Blog section. It imports root-absolute
`/vendor/*.js` assets so the current static MIME map and transitive content-hash rewriter handle both
without a bundler. The checked-in Marked and DOMPurify modules are byte-identical copies of the exact
npm-package ESM artifacts, renamed only from `.mjs` where required. Exact development dependencies, a
deterministic sync/check script, copied upstream licenses, and a plain-text provenance notice provide
one reviewable update path. The two exact vendor modules are excluded from Prettier so byte parity
cannot drift; their `.txt` notices/licenses remain in the Docker context despite the general Markdown
documentation exclusion. The Blog shell continues to use escaped metadata HTML, but body content is
inserted only as a sanitized fragment or a DOM-created text fallback. It creates the safe body
placeholder before dynamically importing the renderer, then checks `ctx.signal.aborted` and active
root ownership after every awaited step so dependency failure or stale navigation cannot bypass the
fallback. Tests execute this actual mount path through a deterministic test-only loader that rewrites
root-absolute browser module specifiers to repository-confined, per-jsdom-realm-salted `data:` URLs;
no test-only runtime seam or experimental Node flag is added. A test-local observer counts body-driven
resource/fetch attempts and must remain at zero.

## Implementation Phases

1. Run `speckit.checklist`, generate dependency-ordered tasks, and run `speckit.analyze`; resolve
   every critical/high/medium requirement or constitution gap before changing runtime files.
2. Author the vendor parity regression, add exact Marked/DOMPurify manifest ownership, observe the
   intended old-asset mismatch, then sync the reviewed upstream assets/licenses and prove equality.
3. Add the fixed security/source/failure/resource-attempt and promotion regressions against the actual
   Blog mount; observe the intended unsafe pre-fix result before implementation.
4. Add the Blog render module with raw-HTML/image overrides, explicit element/attribute/link policy,
   final DOMPurify fragment output, closed failure behavior, and lifecycle-safe insertion; route both
   filesystem Markdown and escape-first published-news bodies through it.
5. Add compatibility characterization for the tracked corpus, supported constructs, SSR, public Blog
   handler, RSS, and published-news behavior; reconcile only the renderer where tests expose a gap.
6. Update the Content/SEO baseline, `SECURITY.md`, vendor ownership, ADR index, roadmap, changelog,
   and app PATCH version surfaces; do not change Core or CLI versions.
7. Run focused tests, vendor integrity, clean install/tree/audits, format/lint/typecheck, full CI, and
   disposable Docker smoke. Record exact current evidence and any sandbox limitation in `tasks.md`.
8. Run `speckit.converge`; if it appends work, implement and verify the new tasks, then repeat until
   clean. Commit, push, PR, merge, deploy, cache purge, and production content inspection remain
   separately authorized.

## Complexity Tracking

No constitution violation requires justification. DOMPurify is a narrowly scoped security
dependency rather than a new framework or build pipeline; the ADR and vendor-integrity contract own
its provenance and maintenance boundary.
