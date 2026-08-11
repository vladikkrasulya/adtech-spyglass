# Research: Safe Blog Markdown

## Decision 1: Close the Boundary at Final Browser Rendering

**Decision**: Apply one mandatory content policy to every Blog body immediately before it enters the
browser document. Keep source classification for presentation/API compatibility, but never use it as
a trust decision.

**Rationale**: Repository evidence shows that filesystem and promoted posts share
`source: 'markdown'`, while the current browser branch passes that body through Marked and then into
the main document without a sanitizer. The initial server-rendered article and published-news branch
are escape-first, but client hydration replaces the safe initial body. Protecting only ingestion or
promotion would miss existing persistent files and any future writer. A read/render invariant covers
all current and future origins without inspecting or migrating production content.

**Alternatives considered**:

- Sanitize only admin ingestion or promotion: rejected because it leaves repository files,
  pre-existing persistent files, and other writers outside the invariant.
- Trust human-reviewed or filesystem-classified content: rejected because promotion creates the same
  classification from externally influenced draft text.
- Rely on the current CSP: rejected because containment is not equivalent to inert content and the
  existing policy intentionally permits inline script behavior required elsewhere.

## Decision 2: Keep Marked and Add DOMPurify

**Decision**: Keep Marked `15.0.12` to avoid an unrelated parser/compatibility upgrade. Add
DOMPurify `3.4.13`, the latest signed upstream release verified on 2026-08-11, as the final DOM-based
sanitizer.

**Rationale**: [Marked's official documentation](https://marked.js.org/) explicitly states that its
HTML output is not sanitized and recommends DOMPurify for untrusted input. DOMPurify is a maintained,
DOM-aware allowlist sanitizer with browser and jsdom coverage. Its official documentation supports
explicit `ALLOWED_TAGS`, `ALLOWED_ATTR`, and `RETURN_DOM_FRAGMENT`; release `3.4.13` is signed at
upstream commit `3067f77`. This keeps the custom trusted computing base to token policy and URL
validation rather than recreating namespace, parser-mutation, template, and DOM-clobbering defenses.

**Alternatives considered**:

- Custom regex or DOM walker after Marked: rejected because it becomes a home-grown sanitizer and
  must own browser parser edge cases.
- Build DOM directly from every Marked lexer token: structurally safe but larger, tightly coupled to
  parser internals, and more expensive to keep compatible with GFM tables and nested constructs.
- `sanitize-html` or a unified/remark/rehype pipeline: rejected because it adds a larger Node/build
  graph and conflicts with the browser's no-bundler architecture.
- Native Sanitizer API only: rejected because it would create a new browser-support dependency and
  does not provide the current project's deterministic cross-browser floor.
- Render Blog bodies in an iframe: rejected because it changes navigation, styling, accessibility,
  SEO/hydration, and module architecture rather than fixing the owning seam.

## Decision 3: Make the Editorial Policy Explicit

**Decision**: Configure a per-instance Marked renderer and a strict DOMPurify allowlist.

Supported output elements are:

`a`, `blockquote`, `br`, `code`, `del`, `em`, `h1`–`h6`, `hr`, `li`, `ol`, `p`, `pre`, `strong`,
`table`, `tbody`, `td`, `th`, `thead`, `tr`, and `ul`.

Allowed attributes are limited by element to link `href`, `title`, and `rel`; ordered-list `start`;
and table-cell `align`. The controlled Marked/escape-first renderers own that element-to-attribute
placement. DOMPurify applies the global superset `href`, `title`, `rel`, `start`, and `align`, with
`ALLOW_ARIA_ATTR: false` and `ALLOW_DATA_ATTR: false`; final-document assertions enforce the narrower
element-scoped contract. No `style`, `class`, `id`, `name`, event, data, ARIA, form, media, embedded
document, or resource-loading attribute survives.

Marked overrides enforce the product-specific behavior before sanitization:

- raw HTML tokens return escaped literal source so unsupported HTML remains visible as inert text;
- image tokens return escaped alternative text and never an image/resource element;
- task-list checkbox tokens become inert text symbols rather than form controls; and
- editorial link tokens retain a destination only when the pinned parser's normalized `href` contains
  no remaining control characters, boundary whitespace, or backslashes; resolves against exact
  `document.baseURI`; and produces only `http:` or `https:`. Safe editorial relative and fragment
  links therefore remain usable. Unsafe destinations retain their readable label with no link
  capability. The fixed
  raw-input corpus verifies that parser normalization cannot turn obfuscated executable schemes into
  navigation.

Every retained link receives `rel="nofollow noopener"` and no parser-controlled target. The existing
published-news renderer remains escape-first and continues recognizing only absolute HTTP(S) links.
DOMPurify uses the exact `ALLOWED_TAGS` array above, the global `ALLOWED_ATTR` superset above,
`ALLOW_ARIA_ATTR: false`, `ALLOW_DATA_ATTR: false`, and `RETURN_DOM_FRAGMENT: true`. It does not use
broad profiles or hooks. The implementation does not use `IN_PLACE`, does not widen protocol
handling, and does not modify or reparse sanitized output as HTML afterward.

**Rationale**: The policy exactly maps the supported Markdown contract to a small set of semantic
elements. It excludes resource loads and style/namespace surfaces rather than depending on a
blocklist. Parser overrides preserve the two clarified UX decisions—literal raw HTML and image alt
text—while DOMPurify remains defense in depth for parser and browser edge cases.

**Alternatives considered**:

- DOMPurify defaults: rejected because they permit more tags, attributes, protocols, SVG/MathML, and
  media behavior than this feature supports.
- Strip unsupported HTML silently: rejected because clarification selected visible inert source and
  silent deletion can damage editorial meaning.
- Allow images with restricted URLs: rejected because the requirement is zero resource loading from
  Blog bodies.

## Decision 4: Insert a Fragment and Fail to Text

**Decision**: The renderer returns a sanitized `DocumentFragment`. `public/modules/blog/index.js`
first creates a body placeholder from already-escaped shell metadata, then dynamically imports the
renderer and calls `replaceChildren(fragment)`. Root-absolute import URLs keep the existing
content-hash rewriter in charge. It never interpolates parser or sanitizer output into the root
`innerHTML` template. Both the full Markdown path and the existing escape-first published-news path
cross this final fragment policy.

If the renderer module, parser, sanitizer, or fragment construction fails, the body placeholder uses
`textContent` with the original body. After every awaited load/render step, the mount checks
`ctx.signal.aborted` and that the placeholder still belongs to the active root before painting. The
fallback may lose formatting but remains readable and inert. No fallback returns to unsanitized
Marked output and no error message includes body content.

**Rationale**: Returning and appending an already-sanitized fragment avoids an additional HTML parse
after the security boundary. A DOM-created text fallback has no sanitizer dependency and therefore
remains safe even when the security dependency is the component that failed.

**Alternatives considered**:

- Return a sanitized string and interpolate it into the existing shell template: rejected because it
  weakens ownership of the final sink and makes accidental post-sanitize concatenation easier.
- Fall back to the old full-Markdown branch: rejected because failure must not reopen the boundary.
- Hide the entire post: rejected because inert text is a safe, more useful failure mode.

## Decision 5: Track Browser Vendor Provenance Without a Bundler

**Decision**: Add exact development dependencies `marked@15.0.12` and `dompurify@3.4.13` for
Dependabot, full npm audit, license, and source provenance. Keep production browser assets checked in:

- `public/vendor/marked.es.js`, byte-identical to
  `node_modules/marked/lib/marked.esm.js`; and
- `public/vendor/dompurify.es.js`, byte-identical to
  `node_modules/dompurify/dist/purify.es.mjs`.

Only filenames change: the existing static MIME map and transitive asset-hash rewriter own `.js`, not
`.mjs`. DOMPurify is used under its Apache-2.0 option; the upstream Apache license and Marked MIT
license are copied under `public/vendor/licenses/`. `public/vendor/NOTICE.txt` records version,
source artifact/tag/commit, checksum, license, owner, and update procedure. The plain-text extension
is deliberate because the Docker context excludes general Markdown documentation while retaining
runtime notices and licenses.

A deterministic `scripts/sync-browser-vendors.js` supports explicit write and check modes. The
offline vendor test verifies exact manifest/lock versions, byte equality for both ESM assets, copied
licenses, notice metadata, and checksums. Prettier ignores only the two exact upstream ESM targets so
formatting cannot alter reviewed bytes. Docker continues installing production-only Node
dependencies because tracked `public/` assets are already baked into the immutable image.

**Rationale**: A checked-in asset is required by the no-bundler runtime, but an untracked CDN copy is
invisible to npm audit and automated update tooling. Exact development dependencies plus parity
checks create one reviewable update path without serving `node_modules`, adding a CDN, or changing the
production Node dependency graph.

**Alternatives considered**:

- Add DOMPurify as a production Node dependency and serve it from `node_modules`: rejected because
  the static server intentionally exposes only `public/` and production does not execute the package
  server-side.
- Fetch sanitizer/parser code from a CDN at runtime: rejected because it adds network, availability,
  CSP, integrity, and privacy dependencies.
- Retain the existing jsDelivr-generated minified Marked transform and pin only its self-hash:
  rejected because a self-hash detects local drift but cannot prove byte parity with the
  lockfile-installed npm source artifact.
- Keep only a comment with a version: rejected because the current Marked asset demonstrates that
  comments alone do not provide advisory or byte-integrity ownership.

## Decision 6: Use Deterministic Final-Document Evidence

**Decision**: Use jsdom and the actual Blog mount/fragment insertion path as the mandatory browser
evidence. A deterministic test-only ESM loader reads the checked-in modules, rewrites only
root-absolute JavaScript specifiers to content-addressed `data:` module URLs rooted under `public/`,
adds a deterministic per-jsdom-realm salt to prevent Node's ESM cache from reusing a DOMPurify
instance across windows, and rejects unresolved or escaping paths. This adapts browser URL resolution
without copying Blog logic, requiring `--experimental-vm-modules`, or adding a runtime injection seam.
It can substitute dependency/parser/sanitizer behavior; scoped platform/DOM stubs prove policy,
fragment-construction, and insertion failure. Scope assertions to `.blog-post__body` so deferred
source-link findings do not silently expand this feature.

The fixed suite covers:

- every active-content and encoding class in FR-013, asserting the closed element/attribute/link
  policy on the final inserted document;
- raw HTML literal-text and image-alt/no-resource behavior, with a test-local request-attempt observer
  that must stay at zero;
- both Markdown and published-news source branches plus separate dependency-load, parser, sanitizer,
  policy, fragment-construction, and insertion failure fixtures;
- every tracked `content/posts/**/*.md` file and fixed synthetic semantics from FR-005/FR-006;
- a fully offline `parseRss` → authenticated promote handler → temporary `CONTENT_DIR` → public Blog
  handler → browser mount chain with mocked ClickHouse transport;
- unchanged escape-first SSR/readability, Blog API/source classification, RSS/SEO behavior; and
- a structural response-policy check proving the application still applies its security headers,
  without treating CSP as the Markdown defense.

No Playwright/Puppeteer/browser package or repository harness currently exists. Host-installed browser
binaries are not a reproducible CI dependency. A real-browser probe is therefore optional and not an
acceptance gate; DOMPurify's maintained upstream browser matrix plus the repository's final jsdom DOM
inspection is proportionate for this bounded change.

**Alternatives considered**:

- Assert sanitizer output strings only: rejected because the public boundary is the final inserted
  document.
- Add a new browser automation dependency/service: rejected because it adds substantial scope without
  an existing project harness.
- Exercise production content or endpoints: prohibited and unnecessary; synthetic/tracked fixtures
  cover the invariant deterministically.

## Decision 7: Treat This as an App PATCH Security Correction

**Decision**: Bump only the hosted app from `1.6.0` to `1.6.1`. Keep Core `0.31.0` and CLI `0.1.1`.
Update the root lock metadata, runtime/static version surfaces, changelog, and baseline version table
together. This does not publish, tag, merge, or deploy anything.

**Rationale**: The change corrects an unsafe implicit behavior while preserving routes, API shapes,
source classification, supported ordinary Markdown, and tracked content. Raw executable HTML was not
a declared editorial contract and is unused by the tracked corpus, so a PATCH is the proportionate
compatible-security classification.

**Alternatives considered**:

- No app bump: rejected because the browser's public content behavior and shipped asset graph change.
- App major bump: rejected because no supported API or documented editorial capability is removed and
  no consumer migration is required.
- Core or CLI bump: rejected because neither package changes.

## Decision 8: Keep Adjacent Findings Explicitly Deferred

**Decision**: Do not change SSR/Admin source-URL scheme handling, promotion status/locale/collision
rules, frontmatter serialization, global CSP, Trusted Types, unrelated `innerHTML` sinks, or CMS
workflow. Preserve their evidence in the approved assessment research/decision and the updated
Content/SEO contract.

**Rationale**: None is required to make `.blog-post__body` inert for every source and fallback.
Combining them would enlarge authorization, compatibility risk, and verification surface.

**Alternatives considered**:

- Sweep every same-origin content/link sink now: rejected because the assessment approved one bounded
  reader-body invariant.
- Harden promotion instead of rendering: rejected because it cannot protect existing files or other
  writers.
