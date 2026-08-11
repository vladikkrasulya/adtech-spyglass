# Contract: Content, Routing, and SEO

**Owners**: `lib/locale-routes.js`, `lib/seo.js`, `lib/landings.js`, `lib/blog-service.js`, blog
handlers, and `content/posts/`

## Route and Locale Model

English is canonical without a locale prefix. Ukrainian and Russian mirror the supported page paths
under `/uk` and `/ru`. Locale roots redirect to their Inspector routes; `/` uses a temporary redirect
to `/inspector`. Legacy English-prefix, standalone stream/playground, and old file-extension paths
canonicalize through explicit same-origin redirects.

The server locale router is an allowlist, not a catch-all SPA fallback. It recognizes:

- the Inspector, Live, Behavior, Library, Dialects, Blog, Docs, and Insights sections;
- the explicit `/docs/findings` subroute;
- valid blog post routes with a supported content locale and bounded slug;
- short specimen permalinks;
- localized About and Account pages;
- the token-gated Blog Admin shell; and
- the registered programmatic landing paths.

Unknown subroutes and malformed/encoded aliases fall through to a real 404. Redirect targets must be
single-leading-slash, same-origin ASCII paths; absolute, protocol-relative, backslash, and encoded
alias forms are rejected.

## Page Sources

| Page type            | Source                                        | Rendering                                                                    |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| SPA section          | `public/index.<locale>.html` plus lazy module | Server rewrites per-route metadata; browser mounts section                   |
| About                | `public/about.<locale>.html`                  | Dedicated static localized page                                              |
| Account              | `public/account.<locale>.html`                | Dedicated static localized noindex page                                      |
| Programmatic landing | `lib/landings.js` plus locale shell           | Server injects localized body into `#app-root`; landing module preserves SSR |
| Editorial blog post  | `CONTENT_DIR/<locale>/<slug>.md`              | Server reads Markdown, computes SEO, and injects article SSR                 |
| News/firehose post   | ClickHouse `analytics.blog_posts`             | Server reads with tri-state availability and injects SSR when found          |

Registered programmatic landings currently cover OpenRTB 2.5, 2.6, and 3.0, VAST, Native, and IAB
categories. Each owns localized heading/body/CTA content and a curated sample handoff where defined.

## Per-Route Metadata

`lib/seo.js` is the pure metadata/HTML-rewrite owner. For a known section it computes localized title,
description, canonical URL, Open Graph/Twitter fields, robots directive, and an EN/UK/RU plus
`x-default` alternate cluster. Served HTML replaces the shell's existing canonical, alternates,
title, descriptions, social metadata, and single robots tag.

Inspector, Behavior, Library, Dialects, Docs, programmatic landings, and About are indexable page
families. Live, the Blog hub, and Insights remain routable with per-route canonicals but emit
`noindex,follow`. Account pages use their dedicated `noindex,nofollow` shell. `/` is not an indexable
page because it redirects.

Non-HTML static assets receive `X-Robots-Tag: noindex`. Removing a section's metadata entry is not a
valid way to de-index it because that would restore the shared shell's unrelated canonical; use the
explicit noindex set while retaining route metadata.

## Blog Sources and Read Semantics

The public blog is hybrid:

- **Editorial**: Markdown under the locale/slug filesystem convention. The filename is the routing
  slug and frontmatter supplies shallow metadata.
- **News/firehose**: published ClickHouse rows created from RSS/admin drafts.

`getPost(slug, locale)` has three states:

| State              | Meaning                                                                             | HTTP/SEO behavior                                        |
| ------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `found`            | Markdown, a fresh cached ClickHouse row, or a fresh ClickHouse hit exists           | `200`, SSR body, indexability evaluated                  |
| `confirmed_absent` | Invalid route dimensions or a fresh authoritative ClickHouse query found no row     | Real `404`                                               |
| `unavailable`      | ClickHouse is disabled, timed out, or failed and no fresh cache can establish a hit | `200` shell with per-post canonical and `noindex,follow` |

Absence is never cached, and a stale cached row does not convert an unavailable query into a false
found/404 decision. Markdown remains available without ClickHouse.

The post content locale in `/blog/<locale>/<slug>` is the canonical language dimension. A localized
UI prefix can serve the matching shell, but post canonicals point to the content-locale route. Public
list/post APIs can read the full Markdown and ClickHouse corpus; indexability is a separate contract.

## Default-Deny Post Indexing

A blog post is indexable only when all conditions pass:

1. its source is Markdown, never ClickHouse/firehose;
2. frontmatter explicitly opts in with `indexable: true`;
3. the body is non-empty;
4. normalized body is not merely the summary; and
5. body content meets the `INDEXABLE_WORD_FLOOR` quality guard (currently 150 words).

The opt-in is a human topical/review attestation; the word floor is an additional thin-content guard,
not a replacement for review. A non-indexable post emits `noindex,follow` and no hreflang cluster.
An indexable post emits alternates only for content locales that independently pass the same gate;
`x-default` is present only when the English version is indexable.

## Sitemap and RSS

`/sitemap.xml` is generated dynamically from:

- every indexable section metadata path in all three UI locales;
- About in all three locales; and
- post locale/slug pairs returned by the approved-Markdown indexability gate.

The sitemap is a flat list of `<loc>` entries. It does not duplicate hreflang; reciprocal alternates
live only in HTML heads. The redirecting `/` URL, noindex sections, Account, Blog Admin, specimen
permalinks, and ClickHouse/firehose posts are excluded.

`/blog/rss.xml` uses the same indexable Markdown post source, so RSS cannot advertise a post the SEO
gate rejects. The feed uses the public SEO origin, not an internal proxy origin.

## SSR and Browser Body Safety

The server-side renderer in `lib/seo.js` escapes metadata and body input before applying its limited
Markdown grammar. Locale and slug allowlists prevent filesystem traversal. Blog HTML and CSS
injection are best-effort, but a render/SEO exception is reported and must not crash unrelated static
serving.

The browser treats every Blog body as untrusted regardless of `source`, author, approval, storage,
or age. Editorial Markdown uses the exact reviewed Marked parser with controlled raw-HTML, image,
task-control, and link renderers. Both that output and the existing escape-first ClickHouse/news
presentation cross one strict DOMPurify allowlist and are inserted only as a `DocumentFragment`.
Parser or sanitizer output is never interpolated back into the Blog shell.

Supported browser semantics are paragraphs, headings, emphasis, strong text, ordered and unordered
lists, blockquotes, inline and fenced code, tables, line and thematic breaks, strikethrough, inert
task-list markers, and safe links. Raw HTML remains visible as literal text, Markdown images retain
only readable alternative text, and no content-driven resource is loaded. Links resolve against the
document base and retain capability only for unambiguous HTTP(S), relative, or fragment destinations;
unsafe destinations retain their readable labels without becoming links.

If a renderer dependency, parser, sanitizer, policy, fragment construction, or insertion step fails,
the original body is inserted with `textContent`. Abort and stale-root checks prevent an obsolete
section from painting after an awaited load. No failure path logs or reports the body. These rules
also cover Markdown created by the token-gated admin `promote` action and pre-existing persistent
content; source classification is a presentation choice, never a content-safety proof. Exact
third-party provenance and update rules are owned by
[ADR-011](../../decisions/ADR-011-browser-markdown-sanitization.md).

For a found blog post, the server replaces `#app-root` with the article before delivery. For a
programmatic landing, it injects the localized landing body. Client navigation onto an SSR-only
landing performs a full navigation so the server can reconstruct content; first load mounts a
lightweight module that preserves the existing SSR body.

This boundary does not change the Blog HTTP or authorization model. Source-URL scheme parity outside
`.blog-post__body`, promotion state/locale/collision/frontmatter integrity, global CSP or Trusted
Types policy, unrelated DOM sinks, and a broader CMS redesign remain separately assessed work.

## News Pipeline Boundary

When ClickHouse is configured and the crawler is enabled:

1. a scheduled crawler fetches the code-reviewed public RSS source list;
2. normalized title, source URL, summary, and source metadata enter `analytics.blog_drafts` after URL
   deduplication;
3. deterministic `lib/intel-rules.js` relevance scoring rejects low-signal drafts;
4. only qualifying public news title/summary content is sent to OpenRouter for EN/UK/RU translation
   and categorization;
5. successful results publish localized ClickHouse post rows through the shared blog service; and
6. failures or incomplete model output leave the draft pending instead of publishing guessed data.

The model path is isolated to public content translation/categorization. Inspector payloads, saved
samples, behavior events, dialects, account data, and interactive Intel requests never enter it.
Manual Blog Admin publication/rejection uses the same underlying service and is bearer-token gated.

ClickHouse credentials and a boot-time crawler kill switch control the pipeline. Deployed enabled or
paused state is runtime/operator truth, not a claim this baseline derives from repository code.

## Change and Verification Rule

A route, canonical, robots directive, alternate, landing, post source, indexability gate, SSR
behavior, sitemap member, RSS member, or content-processor change updates this contract and its locale,
SEO, content, and HTML tests together. A new model/content destination also updates
[data retention](./data-retention.md) and public privacy copy. Run the locale/content/SEO step in
[quickstart.md](../quickstart.md), then the complete repository gate.
