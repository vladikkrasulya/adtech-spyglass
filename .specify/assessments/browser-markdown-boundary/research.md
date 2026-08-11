# Idea Research: Browser Markdown Trust Boundary

- **Slug**: browser-markdown-boundary
- **Created**: 2026-08-11
- **Evidence confidence (overall)**: high

## Users & Demand

- JavaScript-enabled visitors to a filesystem-backed blog post receive an escape-first SSR article, but the Blog SPA then fetches the public post API and replaces that body with client-rendered HTML. The affected surface is therefore the normal public blog route, not an admin-only preview. — [source: `lib/seo.js:398-447`; `public/modules/blog/index.js:265-330`] (confidence: high, cited)
- Signed-in Inspector users and Blog Admin operators can carry sensitive same-origin browser state while navigating the SPA: raw analysis history is retained in `localStorage`, the active DEK and admin bearer token are retained in `sessionStorage`, and the session service explicitly treats same-origin XSS as able to reach the DEK. — [source: `public/ortbtools.app.js:1751-1801`; `public/core/session.js:39-70`; `public/modules/admin-blog/index.js:1-53`] (confidence: high, cited)
- The maintainer has already placed this trust boundary in the P1 queue, and the repository security policy treats vulnerabilities in the live application as in scope. No incident, support-ticket, exploit, or production-content evidence was found in the repository; the demand signal is preventative hardening rather than a demonstrated user complaint. — [source: `specs/ROADMAP.md:9-20`; `SECURITY.md:3-29`; local repository-history and test search on 2026-08-11] (confidence: medium, cited)

## Prior Art

- The server already has an escape-first limited Markdown renderer, and regression tests prove that body and title HTML are escaped before SSR insertion. — [source: `lib/seo.js:398-447`; `tests/seo.test.js:175-210`] (confidence: high, cited)
- The browser already uses a matching escape-first renderer for ClickHouse/firehose posts. The unsafe branch is narrower: only posts assigned server-controlled `source: 'markdown'` use full Marked output. — [source: `public/modules/blog/index.js:55-86,296-312`; `modules/blog/handler.js:289-340`] (confidence: high, cited)
- Local history shows the escape-first browser path was introduced for untrusted DB/firehose content in commit `ff33260`, while filesystem Markdown remained a trusted-editorial exception. Later persistent admin promotion made that exception broader than reviewed Git content. — [source: local `git blame`/`git log` for `public/modules/blog/index.js`, `modules/admin/blog.js`, and `scripts/deploy.sh` on 2026-08-11] (confidence: high, cited)
- The canonical Content/SEO contract already records the unsanitized Marked-to-`innerHTML` boundary and the admin promotion path, but the existing docs test checks only that the warning remains documented. — [source: `specs/000-platform-baseline/contracts/content-seo.md:110-124`; `tests/docs-truth.test.js:156-166`] (confidence: high, cited)
- The tracked editorial corpus currently contains three localized `welcome.md` files using ordinary Markdown and no raw HTML. It does use list, emphasis, and inline-code syntax, so full Markdown compatibility is a real content constraint even though raw HTML demand is unproven. — [source: `content/posts/en/welcome.md:1-17`; `content/posts/uk/welcome.md:1-17`; `content/posts/ru/welcome.md:1-17`] (confidence: high, cited)

## Market & Context

- This assessment is driven by a repository-specific same-origin content boundary, not by a market feature request. No external pages were fetched because the available fetch mechanism could not expose or pin the connected peer as required by the assessment URL policy. — [source: `.agents/skills/speckit-assess-research/SKILL.md`; assessment execution record on 2026-08-11] (confidence: high, cited)
- Operators already have a lower-trust publication alternative: normal admin `publish` and automated moderation store rows in ClickHouse, which the public API classifies as `source: 'db'` and the browser renders escape-first. The trust upgrade occurs specifically when an operator chooses `promote`. — [source: `modules/admin/blog.js:68-143`; `lib/news-moderator.js:193-215`; `modules/blog/handler.js:316-340`; `public/modules/blog/index.js:296-312`] (confidence: high, cited)
- Leaving the boundary unchanged preserves a latent stored-XSS-capable path on the public origin whenever externally influenced draft text is promoted to filesystem Markdown; this is an inference from the verified source-to-sink chain, not evidence that such content exists in production. — [source: `lib/news-crawler.js:24-34,68-89,113-167`; `modules/admin/blog.js:88-143`; `public/modules/blog/index.js:296-330`; local synthetic probes on 2026-08-11] (confidence: high, cited inference)

## Data & Constraints

- The verified path is `fixed public RSS or token-gated admin ingest → ClickHouse draft → manual bearer-token-gated promote → persistent .md → source:'markdown' → Marked → innerHTML`. Anonymous users have no direct Markdown write path. — [source: `lib/news-crawler.js:24-34,150-209`; `modules/admin/blog.js:27-40,72-143,176-215`; `modules/blog/handler.js:289-313`; `public/modules/blog/index.js:296-330`] (confidence: high, cited)
- RSS cleanup strips literal tags before decoding HTML entities. A local synthetic RSS item containing encoded harmless probe markup emerged from `parseRss()` as literal `<img ... onerror=...>` text; vendored Marked preserved that attribute. — [source: `lib/news-crawler.js:68-89,113-132`; local synthetic `parseRss()` and Marked probes on 2026-08-11] (confidence: high, cited)
- A local synthetic DOM probe inserted the Marked result with `innerHTML` and dispatched an `error` event; the harmless marker ran. The probe used no network, production data, credentials, or production endpoint. — [source: local Node/jsdom probe on 2026-08-11; sink at `public/modules/blog/index.js:314-330`] (confidence: high, cited)
- Vendored Marked is version 15.0.12, is invoked without sanitizer/options/hooks, preserves raw HTML and `javascript:` link schemes in local probes, and is outside the npm dependency graph. No DOMPurify, `sanitize-html`, or Trusted Types integration exists in the current manifest or Blog path. — [source: `public/vendor/marked.esm.min.js:1-7`; `public/modules/blog/index.js:302-306`; `package.json:24-40`; local repository search and synthetic probes on 2026-08-11] (confidence: high, cited)
- The Blog body is inserted into the main document rather than a sandbox. The origin CSP applies to every response and includes `script-src 'self' 'unsafe-inline'`; `connect-src 'self'` and `object-src 'none'` reduce some impact, while `img-src ... https:` remains an outbound channel. — [source: `public/modules/blog/index.js:314-330`; `server.js:1185-1226,1277-1287`] (confidence: high, cited)
- Promotion is a human and authorization gate: all admin-blog routes require `ADMIN_STATS_TOKEN`, the UI escapes the draft preview, and `promote` requires an explicit click plus slug prompt. However, the preview shows only the first 100 summary characters and has no rendered-content warning. — [source: `modules/admin/blog.js:27-40,72-85`; `public/modules/admin-blog/index.js:131-192,228-260`] (confidence: high, cited)
- The promoted file is written to persistent `CONTENT_DIR`, deployment preserves existing runtime files, and backups include that content. Repository inspection cannot establish what files currently exist in production. — [source: `modules/admin/blog.js:121-143`; `docker-compose.yml:41-52`; `scripts/deploy.sh:107-118`; `scripts/backup-db.sh:52-64`] (confidence: high for persistence, unknown for production contents, cited)
- Indexability is default-deny, but it is not an execution gate: non-indexable Markdown posts remain available through the public list/post API and Blog UI. — [source: `lib/blog-service.js:159-192`; `modules/blog/handler.js:173-346`; `public/modules/blog/index.js:181-200`] (confidence: high, cited)
- Existing XSS coverage protects SSR only. No current test imports the browser Blog module or exercises RSS entity decoding, promotion-to-render, Marked output, final DOM behavior, or CSP interaction. — [source: `tests/seo.test.js:175-210`; `tests/docs-truth.test.js:156-166`; local `tests/` import/search inventory on 2026-08-11] (confidence: high, cited)
- Adjacent content-boundary gaps exist: SSR/Admin source links HTML-escape URLs but do not apply the browser's HTTP(S) scheme allowlist; promotion does not revalidate draft status/locale, refuses no existing slug, and interpolates title/category into frontmatter. These are related observations, not proof that they belong in the same implementation scope. — [source: `lib/seo.js:432-439`; `public/modules/blog/index.js:48-53,324`; `public/modules/admin-blog/index.js:228-240`; `modules/admin/blog.js:88-143`] (confidence: high, cited)

## Evidence Against the Idea

- External content is not automatically classified as Markdown: automated moderation and normal admin publication remain on the escape-first DB path. — [source: `lib/news-moderator.js:193-215`; `modules/admin/blog.js:106-120`; `modules/blog/handler.js:316-340`; `public/modules/blog/index.js:310-312`] (confidence: high, cited)
- Promotion requires a configured bearer token and a deliberate human action; a missing token disables the route and a mismatch returns unauthorized. — [source: `modules/admin/blog.js:27-40,72-85`; `public/modules/admin-blog/index.js:172-192`] (confidence: high, cited)
- The initial SSR body, Blog cards, search results, admin table, RSS, and ClickHouse/firehose body paths already escape content, and a failed Marked import falls back to the safe renderer. — [source: `lib/seo.js:398-447`; `public/modules/blog/index.js:237-260,303-312`; `public/modules/admin-blog/index.js:228-260`; `modules/blog/handler.js:349-392`] (confidence: high, cited)
- The tracked Markdown corpus and its local Git history contain no observed raw HTML use, and no repository evidence shows a real incident or malicious production post. — [source: local `content/posts/` and Git-history search on 2026-08-11] (confidence: medium, cited)
- A top-level `<script>` inserted through `innerHTML` is not the basis for this finding; the verified concern is event-handler, SVG/iframe, and unsafe-link-capable markup. — [source: local synthetic Marked/jsdom probes on 2026-08-11] (confidence: high, cited)

## Gaps & Open Questions

- [NEEDS CLARIFICATION: Is raw HTML, iframe, SVG, or style markup an intentional editorial capability, or should supported input be Markdown-only?]
- [NEEDS CLARIFICATION: Which full-Markdown constructs must remain byte-for-byte or visually compatible across SSR and browser rendering?]
- [NEEDS CLARIFICATION: What files exist in the production `CONTENT_DIR`, and should an authorized later implementation include a redacted audit/migration step rather than reading them during assessment?]
- [NEEDS CLARIFICATION: What operational review is expected before Promote, and who can obtain `ADMIN_STATS_TOKEN`?]
- [NEEDS CLARIFICATION: Should adjacent source-URL scheme parity and promotion integrity checks be included in one bounded content-security feature or assessed separately?]
- [NEEDS CLARIFICATION: Which browser fixture should prove the final sanitizer and CSP behavior without a production exploit?]

## Sources

- Local repository at commit `e6f4750`, branch `assess/browser-markdown-boundary` (policy: local codebase pointer; read-only evidence)
- Local Git history for the cited Blog, crawler, promotion, deployment, and SSR files (policy: local repository history; read-only evidence)
- Local synthetic `parseRss()`, Marked 15.0.12, and jsdom probes executed on 2026-08-11 (policy: synthetic/redacted evidence; no network or production)
- No external URL was fetched (policy: fetch skipped because the available mechanism does not expose or pin the connected peer)
