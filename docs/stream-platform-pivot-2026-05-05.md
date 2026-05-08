# Stream-Platform Pivot — Product Doc + 6-Month Roadmap

> **Date:** 2026-05-05
> **Status:** Direction committed. Phase 1 starts on synthetic + IAB samples.
> **Supersedes:** Implicit single-specimen-inspector framing.

## Position statement

Spyglass — **public observability platform for the OpenRTB ecosystem**. Conceptual reference: Wireshark + Sentry + httpbin, applied to programmatic ad tech.

Three differentiators that don't exist in the market today:

1. **Live feed as default landing.** Visitor sees moving traffic before any action — the product demonstrates itself.
2. **Permalink culture.** Every analyzed specimen (single request or req+resp pair) is shareable as a stable URL. Engineers DM each other links, links spread on Slack/LinkedIn.
3. **Sandboxed creative iframe is a first-class diagnostic primitive.** Reproduce ad-fraud / click-without-click in a controlled environment. Validated 2026-05-04 by senior eng who used Spyglass to isolate an SSP-3027 click-without-click complaint to publisher-side environment vs. creative.

Existing competitors (IAB OpenRTB Validator, Postman SSP collections) are form-inspectors and integration helpers — they don't stream, don't aggregate, don't catalog partners. Spyglass occupies an empty category.

## What we are NOT (yet)

- Not a tcpdump for production traffic — we sample heavily and anonymize
- Not a real-time monitoring SaaS for individual SSPs — we're cross-ecosystem and public
- Not a JSON-validator with extra steps — the validator is a feature of the specimen surface, not the product

## What's gating real traffic

**Risk B (commercial sensitivity, identified 2026-05-05):** streaming the employer's RTBS traffic publicly requires explicit legal/management approval. Approval not yet obtained — long process.

**Phase 1 decision:** start on synthetic + open-source corpora. Real-traffic ingest gated on Risk B clearance. Anonymization middleware built and tested against synthetic before any real flow is wired.

Synthetic corpus sources for Phase 1:

- IAB OpenRTB 2.5 / 2.6 / 3.0 reference examples (public, on iabtechlab GitHub)
- IAB JsonFeed examples
- VAST 4.x samples (IAB)
- Public ad-tech case studies / blog post examples
- Generated variations (controlled mutation: shuffle imp ordering, vary device/geo, inject typical issues)

## Architecture (anchored to actual stack)

**Stack reality check** (per project conventions):

- vanilla `node:http` server, no Next.js
- `better-sqlite3` (embedded), no PostgreSQL
- vanilla JS frontend, no bundler
- `packages/core/` validator engine (npm workspace, browser+server compatible)

**Stream pipeline (Phase 1, in-process):**

```
[synthetic-generator]
        ↓ emit every 1-2s
[anonymization-middleware]   ← skeleton works on synthetic; identical to real-traffic path
        ↓ stripped specimen
[in-process ring buffer]     ← Node Array, ~5000 entries, FIFO
        ↓ subscribe
[SSE endpoint /api/stream]   ← Server-Sent Events, simpler than WebSocket for one-way feed
        ↓ event-stream
[frontend Stream surface]    ← appends rows, virtual scroll, click → /r/{hash}
```

No Redis, no PostgreSQL. Ring buffer in same Node process. **If/when scale demands** → introduce Redis sidecar (separate compose service); migration is contained because the API surface (SSE endpoint) doesn't change.

**Specimen storage (Phase 1):**

- Hash = `sha256(canonical-json(specimen)).slice(0, 12)`
- SQLite cache: `(hash, specimen_json, created_at, last_accessed_at)`
- TTL: 90 days from `last_accessed_at`
- Separate from existing `samples` table (which is user-saved encrypted)

**Patterns + directory (Phase 2+):**

- Patterns: hourly/daily aggregation jobs over the ring-buffer-archived specimens (separate SQLite table for time-bucketed counts)
- Directory: static pages per partner, content authored or extracted from samples (one-time research → docs)

## Four surfaces

### 1. Stream `/`

Default landing. Live ring-buffer playback, sampling-aware. First impression of the product.

**Empty state of stream is impossible by construction** — synthetic generator always emits. If generator is down, show explicit "stream paused — generator offline" not zero-counters.

**Components:**

- Header: live counter `~X req/sec sampled · Y% of source` (synthetic in Phase 1)
- Filter rail: format / partner / severity / version / geo (each reflected in URL `?format=banner&partner=smaato`)
- Stream rows: timestamp, partner badge, format pill, validation-finding count, click → `/r/{hash}`
- Pause/resume button (pin current state for inspection)
- Download CSV / NDJSON (current filtered view)

### 2. Specimen `/r/{id}`

Single specimen deep-dive. The current Spyglass UI as a permalink-able detail page.

**This is the existing inspector** moved under a stable URL. Its tabs (Inspector / Validation / Crosscheck / Categories / Behavior / AD PREVIEW) are second-level views of the SAME specimen, not separate top-level pages.

**Components retained from current code:**

- Decoded request fields with hover-spec-references
- Validation findings (severity, message, IAB spec link)
- Crosscheck panel (auto-shows if specimen has both req and res)
- Categories decoder (IAB Content Taxonomy)
- Behavior tab (click-skim probe, in-iframe instrumentation — already shipped)
- AD PREVIEW iframe (sandboxed, with macro substitution — already shipped, core diagnostic primitive)
- Share-link button (already shipped — fragment-encoded permalink) — extend to also produce `/r/{hash}` short-link

**New for stream-context:**

- Breadcrumb: "← Stream / smaato banner / 2026-05-05 14:32:11"
- "Back to stream with this filter" button
- "Find similar specimens" link (Phase 3 — uses Patterns aggregation)

### 3. Patterns `/patterns`

Aggregated insights. Not present in current code at all — net-new build.

**Phase 2 deliverable.** Initial panels:

- **Format distribution over time** (banner / video / native / audio / dooh, last 1h / 24h / 7d)
- **Top validation findings by partner** (heatmap-table: partners on Y, finding-codes on X, cell intensity = count)
- **Geo distribution** (country list with bar lengths, no map in v1)
- **oRTB version mix** (2.5 / 2.6 / 3.0 split, trending direction)
- **Schema conformance score per partner** (clean / warnings / errors percentage)

Each panel: snapshot permalink `/patterns/snapshot/{date-range-hash}`. Each panel: time-range toggle.

### 4. Directory `/p/{slug}`

Partner catalog. Not present in current code — net-new build.

**Phase 2-3 deliverable.** Per-partner page:

- Slug e.g. `/p/smaato`, `/p/openx`, `/p/smartadserver`
- Header: partner logo, oRTB versions supported, integration type
- Typical request structure (anonymized example, link to live `/r/{id}`)
- Common validation findings observed (last 30d)
- Format breakdown
- Integration notes (manually authored — `docs/partners/{slug}.md` rendered)
- Backlinks: stream filtered to this partner, patterns filtered to this partner

This is the **SEO magnet**. Engineer Googles "smaato openrtb missing device.ifa" → lands on `/p/smaato#findings` with a real example.

### 5. Playground `/playground` (legacy, secondary)

The current main Spyglass UI moves here. Manual JSON paste for users who want to test their own traffic, edge cases, partner-pre-integration.

**Not the default landing anymore.** Linked from header as a secondary action.

Existing features kept: paste, format, copy, save (signed-in), share (fragment permalink), export (JSON bundle), keyboard shortcuts, embed mode.

## 6-month roadmap

Honest dates. Each milestone closes with a working surface, not a half-built one.

### Month 1 (June 2026): Foundation pivot

- Manifesto rule 4 revised (in-memory + this doc reference)
- Architecture decision doc committed (this file)
- Synthetic generator: 50-100 base specimens from IAB sources, controlled mutation engine
- Anonymization middleware skeleton (works on synthetic — same path real traffic will use)
- Stream surface MVP: SSE endpoint + ring buffer + simple list view
- Specimen permalink: `/r/{hash}` route + SQLite cache (separate table)
- Existing inspector demoted to `/playground`, header link
- Smoke tests for new routes

### Month 2: Filtering + crosscheck via permalink

- Stream filters: format / partner / severity / version, URL-reflected
- Specimen URL extends to optional `?response={hash2}` for pair view
- Click row in stream → specimen with breadcrumb
- "Back to filtered stream" button
- Pause/resume on stream

### Month 3: Patterns v0

- 4 of 5 patterns panels (format-mix, top-findings-by-partner, version-mix, geo)
- Hourly aggregation job (in-process cron, SQLite time-bucket table)
- `/patterns/snapshot/{hash}` permalinks
- Initial corpus expanded (Smaato OB samples, ExoClick public examples, etc.)

### Month 4: Directory + API

- Directory pages for top 10-15 partners (manually authored content + auto-extracted examples)
- Public REST API: `GET /api/v1/specimen/{hash}`, `GET /api/v1/patterns/{panel}`, SSE `GET /api/v1/stream`
- API rate-limiting (per-IP token bucket, in-process)
- Embed mode for stream rows (iframe snippet generator)
- OG-image auto-generation per specimen permalink (lightweight static SVG-to-PNG)

### Month 5: Real-traffic gate (conditional)

**IF employer's legal approval clears:**

- Production ingest endpoint behind auth: `POST /api/v1/ingest` (only employer-signed source)
- Anonymization middleware activated on real flow (already battle-tested on synthetic)
- Sampling controls: 0.01% / 0.1% / 1% configurable per source
- Opt-out registry: publishers/SSPs can request domain redaction (manual review queue)
- Audit log of every ingested record for compliance
- Public landing copy updated: "live RTB traffic from N integrations"

**IF NOT (default assumption):**

- Expand synthetic corpus 5×
- Add second synthetic source (e.g., synthesized JsonFeed traffic)
- Public landing stays "synthetic + open-source samples · representative of real RTB structure"

### Month 6: Stabilization + community

- Self-monitoring: queue depth, sampler rate, generator health (meta-observability)
- Public landing rewrite around "Wireshark for OpenRTB"
- Phase 5 of original roadmap closes: public/private split done
- Open-source: README, CONTRIBUTING.md, good-first-issues labeled
- Initial blog post: "Why Spyglass exists" + Show HN attempt
- Submit to AdTech newsletters (Marketecture, AdExchanger if possible)

## Phase 1 breakdown — concrete next steps (next 2 weeks)

Order matters. Each step is shippable.

### Week 1

**Step 1.1 — synthetic generator (3 days)**

- New file: `samples/synthetic-generator.js` in repo root
- Pulls base samples from `samples/iab/`, `samples/opensource/` directories
- Mutation engine: vary `imp[].id`, `device.geo.country`, `request.id`, timestamp
- Emits via Node EventEmitter at configurable rate (`SYNTHETIC_RATE_MS=2000`)
- Tests: corpus loads, mutation preserves schema validity, rate is configurable

**Step 1.2 — ring buffer + SSE endpoint (2 days)**

- `server.js`: add `/api/v1/stream` route (SSE: `text/event-stream`)
- In-memory `RingBuffer` class, `MAX_ITEMS = 5000`
- Subscribers join, replay last 50 items, then receive new
- Anonymization middleware skeleton: `src/anonymize.js` — strips `device.ifa`, `device.ip`, `user.id`, `user.buyeruid`, redacts geo to country-only
- Tests: anonymization is exhaustive (PII-fuzz test), ring buffer behaves under load

**Step 1.3 — specimen permalink (1 day)**

- Route: `GET /r/{hash}` → renders `index.{locale}.html` with `data-specimen-hash` attr
- Frontend reads attr, fetches `/api/v1/specimen/{hash}`, hydrates UI
- New SQLite table: `cached_specimens (hash TEXT PK, json TEXT, created_at, last_accessed)`
- Cache eviction: cron job every 24h, DELETE WHERE last_accessed < now - 90d
- Tests: hash collision check, TTL enforcement

### Week 2

**Step 1.4 — Stream frontend surface (4 days)**

- New page: `public/stream.{en,uk,ru}.html` (3-locale parity)
- Connects to SSE endpoint, appends rows
- Each row: timestamp, partner-badge (extracted from `site.publisher.name` or `app.publisher.name`), format-pill (banner / video / native — derived from `imp[].banner | video | native`), finding-count (lazy-validated)
- Click row → navigate to `/r/{hash}`
- Pause button toggles SSE subscribe/unsubscribe
- Tests: SSE reconnect on disconnect, pause works, virtual scroll handles 1k+ rows

**Step 1.5 — Demote current UI to /playground (1 day)**

- Server route: `/` → `stream.{locale}.html` (was `index.{locale}.html`)
- New route: `/playground` → existing `index.{locale}.html`
- Header nav updated: "stream" + "playground" + "docs" + "sign in"
- Permalink share button on playground generates `/r/{hash}` short-link
- Tests: smoke that all existing inspector flows still work under `/playground`

**Step 1.6 — Phase 1 close (final day)**

- Documentation: README updated, `docs/architecture-stream.md` written
- Smoke test pass: 141+ existing tests still pass, ~20-30 new tests added
- Manual QA: each route renders in 3 locales
- Lint clean
- Tag `v9.0.0-stream-mvp`, ship to prod (with owner's go-ahead)

## Open questions / risks logged

1. **Sampling rate calibration** — synthetic at 1 req / 2s feels right for first impression. Validate on first preview. May need to vary by surface (faster on stream, slower on patterns).

2. **i18n parity for new content** — Patterns panel labels, Directory partner pages — need uk / en / ru. Adds ~30% effort to each phase. Documented but accepted.

3. **Backwards compatibility** — current `/?bidreq=...` query-string fragment permalinks: keep working as redirect to `/playground`. Not breaking existing shared links.

4. **Rate limit on SSE** — public endpoint, no auth in Phase 1. Need IP-based connection cap (5 concurrent SSE per IP) to prevent DoS-by-tab-spam. Logged for Step 1.2.

5. **Mobile view** — stream-row layout differs significantly from current dense workbench. Will need fresh responsive treatment, not just shrink-to-fit. Defer to Month 2.

## Non-goals for Phase 1 (explicitly out of scope)

- Login / auth changes: keep existing
- Encryption layer changes: keep existing zero-knowledge crypto for /playground saved samples
- Real production traffic: gated on Risk B
- Patterns aggregation: Phase 2
- Directory pages: Phase 2
- API v1 spec: Phase 4
- Mobile redesign: Phase 2+
