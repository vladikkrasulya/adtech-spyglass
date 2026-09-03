# ADR-011: Sanitize Every Browser-Rendered Blog Body

**Status**: Accepted
**Date**: 2026-08-11

## Context

The public Blog combines repository Markdown, persistent files written by the token-gated promotion
flow, and ClickHouse-backed news. The server renderer escaped body text before applying a limited
Markdown grammar, and the browser did the same for news rows. Files classified as Markdown were the
exception: the browser passed them through full Marked output and interpolated that output into the
main-origin DOM. Marked intentionally does not sanitize HTML, and promotion can persist text that did
not originate in reviewed Git history. Source classification or human approval is therefore not a
valid executable-content boundary.

The product still needs ordinary Markdown semantics, deterministic offline tests, a vanilla
no-bundler runtime, and reproducible third-party ownership. The correction must protect old and new
content at read time without requiring a production scan or migration.

## Decision

Every browser-rendered Blog body (`.blog-post__body`) is treated as untrusted and crosses one final
fragment boundary regardless of source. Editorial content uses exact Marked `18.0.11` (bumped from `15.0.12` on 2026-09-03 through the vendor sync contract) with
per-instance renderers that turn raw HTML into literal text, images
into alternative text, task controls into inert markers, and unsafe links into labels. Existing
escape-first news rendering remains the presentation input for non-Markdown sources.

Both paths then pass through exact DOMPurify `3.4.14` with a closed tag/attribute configuration,
ARIA/data attributes disabled, and `RETURN_DOM_FRAGMENT`. The Blog inserts that fragment with DOM
APIs rather than HTML interpolation. Any dependency, parser, sanitizer, policy, fragment, or
insertion failure displays the original body using `textContent`; abort and root-ownership checks
prevent stale asynchronous paints. Body text is not logged or reported on failure.

Both browser libraries are exact development dependencies and byte-identical checked-in ESM assets.
Their versions, package/lock ownership, copied licenses, notice, formatter exclusions, and immutable
image presence are guarded offline. Updates require an explicit sync, complete security and
compatibility corpora, npm audits, CI, and disposable-image smoke evidence.

## Alternatives Considered

- Continue trusting repository/admin Markdown. Rejected because promotion and persistent content
  make provenance broader than reviewed Git, and approval cannot safely grant script execution.
- Escape all Markdown to plain text. Rejected because it needlessly removes the Blog's maintained
  editorial semantics.
- Build a project-specific HTML sanitizer. Rejected because namespace, parser, mutation-XSS, URL,
  and DOM-clobbering behavior would become an unnecessarily large custom security surface.
- Render a complete Markdown token tree with hand-written DOM construction. Structurally viable,
  but larger and more parser-version-coupled than controlled Marked output plus a maintained final
  sanitizer.
- Add a framework, bundler, remote CDN, or runtime npm asset serving. Rejected because none is needed
  for this boundary and each expands runtime or supply-chain scope.

## Consequences

- Raw HTML and body-driven images are deliberately no longer Blog formatting capabilities; their
  readable text remains.
- Ordinary Markdown structure remains available in the browser, while SSR intentionally keeps its
  smaller escape-first grammar.
- DOMPurify becomes security-critical and requires prompt, reviewed updates. Marked renderer-token
  compatibility is pinned and covered whenever its version changes.
- All protected content is covered at read time, including older persistent files, without a data
  migration or production inspection.
- Source URL parity outside the body, promotion state/locale/collision/frontmatter integrity, global
  CSP/Trusted Types, other DOM sinks, and CMS redesign remain separate work.

## Related Artifacts

- [Safe Blog Markdown feature](../003-blog-markdown-safety/spec.md)
- [Blog rendering contract](../003-blog-markdown-safety/contracts/blog-rendering.md)
- [Vendor integrity contract](../003-blog-markdown-safety/contracts/vendor-integrity.md)
- [Content/SEO baseline](../000-platform-baseline/contracts/content-seo.md)
- [Current roadmap](../ROADMAP.md)
