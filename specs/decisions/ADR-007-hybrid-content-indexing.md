# ADR-007: Hybrid Content With Default-Deny Indexing

**Status**: Accepted
**Date**: 2026-07-01

## Context

The blog combines durable editorial material with a higher-volume news firehose. Editorial Markdown
is reviewable and persists under the content directory; ClickHouse enables ingestion and publication
without an image release. Treating both sources as equivalent search content would advertise thin or
unreviewed pages, while making ClickHouse authoritative for every page would turn an analytics
outage into false 404s.

## Decision

Serve a hybrid corpus:

- localized Markdown is authoritative for an existing editorial route and wins deduplication;
- ClickHouse stores and serves published firehose rows when no Markdown post owns the same slug and
  locale;
- ClickHouse failure degrades list views to editorial content and an uncertain post lookup to a
  `200` noindex shell, never a false confirmed absence;
- only Markdown with explicit `indexable: true` and deterministic substantive-content checks can
  enter sitemap, RSS, and hreflang indexing surfaces;
- firehose rows and unavailable shells remain routable but `noindex,follow`.

The server injects safe SSR article content and per-route SEO metadata so crawlers and no-JavaScript
clients receive meaningful first response content. The client SPA may hydrate or replace that body.

## Alternatives Considered

- Make all published ClickHouse rows indexable. Rejected because publication does not prove editorial
  quality or reciprocal locale coverage.
- Serve only Git-tracked Markdown. Rejected because it removes the operational firehose and promotion
  workflow.
- Return 404 whenever ClickHouse is unavailable. Rejected because outage is not evidence that a slug
  does not exist.
- Render content only in the browser. Rejected because it weakens crawler/no-JavaScript output and
  makes initial metadata depend on API execution.

## Consequences

- Availability and indexability are separate contracts; a visible post is not automatically an SEO
  candidate.
- Editorial promotion and explicit indexability require human judgment, while deterministic checks
  block empty, duplicate-summary, and thin opt-ins.
- ClickHouse remains optional for the editorial surface, but firehose content can temporarily degrade
  to noindex shells during an outage.
- Sitemap, RSS, hreflang, SSR, routing, and content-source changes must be reviewed together.

## Related Artifacts

- [Content/SEO contract](../000-platform-baseline/contracts/content-seo.md)
- [Blog service](../../lib/blog-service.js)
- [Blog HTTP module](../../modules/blog/handler.js)
- [SEO rendering](../../lib/seo.js)
