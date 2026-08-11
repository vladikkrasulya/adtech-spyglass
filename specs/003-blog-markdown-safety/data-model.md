# Data Model: Safe Blog Markdown

This feature adds no database table, browser storage, API field, content migration, or production
record. Its entities describe the deterministic browser content boundary and the fixtures that prove
it.

## Blog Body Input

- **Identity**: one body from `GET /api/v1/blog/post`
- **Fields**:
  - `body`: UTF-8 text; empty is valid
  - `source`: existing `markdown`, `db`, or an unknown/missing classification
  - `baseURI`: exact `document.baseURI` used only to resolve editorial relative/fragment links
- **Origins**: repository Markdown, persistent promoted Markdown, existing persistent files,
  ClickHouse-published news, and safe error/fallback text
- **Rules**: source controls supported formatting only; it never grants executable trust; the body is
  never logged or copied into Spec Kit evidence

## Markdown Render Policy

- **Identity**: one immutable browser-module policy shared by every Blog body
- **Supported elements**: `a`, `blockquote`, `br`, `code`, `del`, `em`, `h1`–`h6`, `hr`, `li`, `ol`,
  `p`, `pre`, `strong`, `table`, `tbody`, `td`, `th`, `thead`, `tr`, `ul`
- **Allowed attributes**:
  - links: `href`, `title`, `rel`
  - ordered lists: `start`
  - table cells: `align`
- **URL state**:
  - `safe`: the pinned parser's normalized editorial `href` has no remaining
    controls/boundary whitespace/backslashes and resolves to `http:` or `https:` from the current
    page, including relative and fragment forms
  - `unsafe`: missing the predicate above; label remains but link capability is removed
- **Unsupported content**:
  - raw HTML becomes visible literal text
  - image syntax becomes visible alternative text with no resource element
  - task controls become inert text rather than form controls
  - styles, namespaces, media, embeds, forms, document-policy elements, event attributes, and resource
    attributes are absent
- **Rules**: controlled renderers own element-scoped attribute placement; DOMPurify receives their
  global attribute-name superset plus `ALLOW_ARIA_ATTR: false` and `ALLOW_DATA_ATTR: false`; explicit
  allowlists only; no mutable global hooks, post-sanitize HTML modification, or source-specific trust
  exception

## Rendered Blog Fragment

- **Identity**: one `DocumentFragment` ready for a `.blog-post__body` placeholder
- **Fields**:
  - supported semantic elements and attributes
  - readable text
  - normalized safe links
  - no executable/resource/document-policy capabilities
- **Construction states**:
  1. `received`: input is still text
  2. `parsed`: Markdown source used Marked overrides, or published-news source used the existing
     escape-first renderer
  3. `sanitized`: DOMPurify applied the immutable element/attribute policy
  4. `ready`: a same-document fragment can be inserted with `replaceChildren`
  5. `text_fallback`: any earlier failure created inert DOM text from the original body
- **Terminal rule**: both `ready` and `text_fallback` are safe to append; no other state reaches the
  document

## Browser Vendor Artifact

- **Identity**: package name plus exact version
- **Fields**: npm manifest version, lockfile resolution/integrity, upstream source artifact, release
  tag/commit, checked-in public path, checksum or byte parity, chosen license, update owner
- **Instances**:
  - Marked `15.0.12`: upstream `lib/marked.esm.js` bytes under the public
    `marked.es.js` filename, MIT license
  - DOMPurify `3.4.13`: upstream `dist/purify.es.mjs` bytes under a `.js` public filename,
    Apache-2.0 license, signed tag commit `3067f77`
- **Rules**: package versions are exact development dependencies; both public ESM files are
  byte-identical to their lockfile-installed npm artifacts; production serves only reviewed
  checked-in assets; the sync/check command and vendor regression must agree before merge
- **Transition**: an update changes manifest/lock, reviewed upstream asset/license/provenance, checksum
  evidence, security/compatibility corpus results, and Docker smoke as one change

## Security Fixture

- **Identity**: stable unique fixture ID mapped to one FR-013 capability class
- **Fields**: class ID, synthetic Markdown input, expected readable text, expected safe-link state,
  optional expected supported elements, and expected resource-attempt count
- **Rules**: the class denominator and fixture IDs are exact and unique; every final inserted body
  passes the shared inert-body assertion and a test-local resource/fetch observer reports zero
  body-driven attempts; fixtures contain no real payload, credential, destination, user, incident, or
  production content

## Compatibility Fixture

- **Identity**: tracked file path or stable synthetic construct ID
- **Members**:
  - every `content/posts/**/*.md` body in EN, UK, and RU
  - paragraphs, headings, emphasis, strong text, ordered/unordered lists, blockquotes, inline/fenced
    code, tables, line/thematic breaks, strikethrough, inert task-list markers, safe links, raw-HTML
    literal text, and image alternative text
  - one fixed 128 KiB synthetic text body and one lone-surrogate fixture; neither defines a new
    product body-size limit
- **Expected outcome**: browser semantic structure matches the maintained expectation; browser and
  server retain expected readable text; limited SSR is not required to implement full browser
  semantics

## Synthetic Promotion Scenario

- **Identity**: one test-local draft ID and temporary content root
- **Inputs**: synthetic encoded feed description, fake authorized request, mocked ClickHouse draft and
  status responses
- **State transition**: RSS normalization → pending draft → authorized promotion → temporary Markdown
  file → public Blog post response → final browser body
- **Rules**: no external fetch, production endpoint, real token, persistent project file, or retained
  test data; temporary storage is removed after the test

## Verification Evidence

- **Identity**: task ID plus exact command/outcome in `tasks.md`
- **Fields**: focused test result, corpus denominator, vendor parity, audit modes, full CI, Docker
  smoke, sandbox limitation if any, convergence state
- **Rules**: current-run evidence only; no production content inspection or deployment claim; long-lived
  contracts do not freeze changing global test totals
