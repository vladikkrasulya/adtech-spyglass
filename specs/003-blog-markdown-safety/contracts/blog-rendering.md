# Contract: Blog Body Rendering

## Public Interface Compatibility

This feature does not change Blog routes, HTTP methods, status behavior, JSON field names, source
classification, listing/search behavior, RSS output, SEO/indexability, locale routing, or the Blog
Admin authorization model.

`GET /api/v1/blog/post` continues returning filesystem/persistent editorial posts as
`source: "markdown"` and ClickHouse-published posts as `source: "db"`. The browser may use that field
to select full editorial Markdown versus the existing limited escape-first presentation, but it must
not use the field as a trust signal.

## One Final Body Boundary

Every body displayed inside `.blog-post__body` crosses the same final sanitizer and fragment
insertion boundary, including:

- repository Markdown;
- current and future persistent promoted Markdown;
- persistent Markdown written before this feature;
- published-news/DB bodies;
- unknown or missing source classifications; and
- parser, import, sanitizer, or rendering fallback states.

The Blog page shell may still be constructed from escaped metadata HTML. Parser or sanitizer output
must never be concatenated into that shell. The body is inserted only as a sanitized
`DocumentFragment`; failure inserts original body text with DOM `textContent` semantics.

## Supported Markdown

The browser preserves the following editorial constructs:

- paragraphs and headings;
- emphasis and strong text;
- ordered and unordered lists;
- blockquotes;
- inline and fenced code;
- tables;
- line/thematic breaks;
- safe links; and
- strikethrough when emitted by the pinned parser.

Allowed output elements are exactly:

`a`, `blockquote`, `br`, `code`, `del`, `em`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `hr`, `li`, `ol`,
`p`, `pre`, `strong`, `table`, `tbody`, `td`, `th`, `thead`, `tr`, and `ul`.

The controlled renderers emit the following exact element-scoped attributes:

- `a`: `href`, `title`, `rel`;
- `ol`: `start`;
- `td` and `th`: `align`.

DOMPurify receives the global superset `href`, `title`, `rel`, `start`, and `align`, because its base
`ALLOWED_ATTR` array is not element-scoped. It also receives `ALLOW_ARIA_ATTR: false` and
`ALLOW_DATA_ATTR: false`, the exact `ALLOWED_TAGS` array above, and `RETURN_DOM_FRAGMENT: true`. Raw
HTML is escaped before sanitization, and only the controlled renderers can create
elements/attributes; final-document assertions enforce the narrower placement above. No other
element or attribute is part of the Blog-body contract. In particular,
style/class/id/name, event, data/ARIA, form, embedded-document, media, namespace, and resource-loading
surfaces are absent. `USE_PROFILES`, sanitizer hooks, `IN_PLACE`, and post-sanitize HTML reparsing are
not used.

## Raw HTML, Images, and Controls

- Raw HTML is unsupported. Its literal source remains readable as inert text; it is not interpreted
  as elements and is not silently discarded.
- Markdown image syntax preserves readable alternative text but creates no image or resource request.
- Task-list controls may retain an inert textual checked/unchecked marker but create no form control.
- Comments, malformed markup, and nested unsupported constructs receive the same inert outcome.

These rules apply to old content at read time; there is no prerequisite migration or production
content scan.

## Link Policy

A normalized editorial-Markdown destination is usable only when all of the following hold:

1. it contains no C0/C1 controls, boundary whitespace, or backslash ambiguity;
2. it resolves against exact `document.baseURI`; and
3. the resolved protocol is exactly `http:` or `https:`.

The predicate evaluates the pinned parser's normalized `href`; the fixed raw-input corpus verifies
that parser normalization cannot turn obfuscated executable schemes into navigation. Editorial
relative and fragment links that resolve under those rules remain usable. Safe external HTTP(S)
links remain usable. An unsafe or malformed destination loses its link capability while preserving
the readable label. Retained links have `rel="nofollow noopener"` and no content-controlled target.
The existing published-news renderer remains escape-first and continues recognizing only absolute
HTTP(S) Markdown links before the shared final policy.

## Failure Contract

The Blog shell creates `.blog-post__body` before dynamically loading the renderer. Any dependency
load, parser, sanitizer, policy, fragment-construction, or insertion error therefore fails to inert
readable text. After each awaited load/render step, the module checks `ctx.signal.aborted` and that
the placeholder still belongs to the active root before changing the document. A failure must not:

- retry with unsanitized full Markdown;
- place body text in an HTML template string;
- log or report the body;
- trigger a resource request; or
- prevent the surrounding Blog route from presenting safe metadata/navigation.

An empty body remains empty. Malformed or lone-surrogate input receives the same safe state
transition. This feature introduces no new Blog-body size limit; a fixed synthetic 128 KiB fixture
exercises the long-text path without claiming a production maximum.

## SSR and Other Surfaces

`lib/seo.js` retains its existing escape-first limited Markdown renderer for initial SSR/no-JS
output. SSR and browser output need not be byte-identical or structurally identical; both must be
inert and retain their baseline readable text. Full browser semantics are not imposed on SSR by this
feature.

Published-news bodies retain their existing escape-first transformation before the shared final
fragment policy. Listings, search, Admin draft tables, RSS, metadata, and social cards do not render
the Blog body and retain their current escaping contracts.

Source URL scheme parity outside `.blog-post__body`, promotion state/locale/collision/frontmatter
integrity, global CSP/Trusted Types, unrelated DOM sinks, and CMS redesign remain deferred in the
[approved assessment](../../../.specify/assessments/browser-markdown-boundary/decision.md).

## Verification Contract

Offline tests must exercise the actual Blog mount/body replacement path and inspect the final
`.blog-post__body`, not only a parser or sanitizer string. A repository-confined test-only loader
rewrites root-absolute browser ESM specifiers to content-addressed, per-jsdom-realm-salted `data:`
URLs. It can substitute dependency/parser/sanitizer behavior, rejects unresolved or escaping paths,
and does not copy Blog logic. Policy and fragment-construction failures use controlled test-local
platform/dependency substitutes; insertion failure uses a scoped DOM prototype stub. The denominator
is:

- every fixed FR-013 security class, with exact unique class/fixture IDs;
- both supported source modes plus unknown/missing and failure modes;
- every tracked localized Markdown post;
- every fixed supported Markdown construct; and
- the synthetic RSS normalization → authorized promotion → temporary persistence → public handler →
  browser-render path.

Assertions prohibit every element, attribute, URL, and resource capability outside this contract.
A test-local resource/fetch observer must also record zero body-driven request attempts; absence of a
resource node alone is insufficient evidence. Tests use synthetic/tracked content, temporary
storage, mocked infrastructure, and no network or real credential. A separate real-browser run is
optional; jsdom final-document evidence is the required repository gate.
