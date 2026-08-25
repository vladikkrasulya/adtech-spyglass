# Contract: HTTP and Server Boundaries

**Owner**: `server.js`, `lib/router.js`, `lib/http.js`, and `modules/`
**Public stable reference**: [docs/api-v1.md](../../../docs/api-v1.md)

## Composition and Dispatch

One `node:http` process owns static pages and API routes. `server.js` constructs shared services,
registers feature modules with an ordered `Router`, and invokes the first method/path match. Route
patterns are exact, single-segment parameters, or an explicit trailing-star prefix. Feature handlers
receive injected Core, auth, storage, limiter, and integration dependencies rather than creating a
second application framework.

Unmatched `/api/*` paths return JSON `404` with code `not_found`. Other misses use the confined
`public/` static-file handler. A malformed request URL returns a client error before routing.

`readJson()` accepts at most 2 MiB and rejects malformed JSON or an oversized body with stable error
codes. Most JSON handlers use `{ success: true, ... }` and
`{ success: false, error, code, detail? }`; individual read APIs such as the finding catalog and blog
use their documented `ok` envelope. SSE, RSS, HTML, and static assets are intentionally not JSON
envelopes.

## Stable Analyze Surface

`POST /api/analyze` runs Core validation server-side after the browser or client sends a request
and/or response body. It accepts `locale`, `dialect`, disabled-rule, and expected-version inputs,
returns validation/crosscheck/category/format metadata, and does not persist raw payload bodies.
Authenticated calls additionally write account-scoped derived counts; configured analytics can
receive derived validation metrics.

`POST /api/analyze-behavior` runs the behavior engine server-side over the required probe-event array
and optional creative source. Events beyond the accepted bound are head/tail sampled. Legacy
`{ events, adm }` remains accepted. The hosted Inspector uses additive
`{ events, adm_b64, adm_truncated }`: `adm_b64` is canonical padded base64 of valid UTF-8 no larger
than 1 MiB decoded, takes precedence over `adm`, and is rejected when non-canonical, invalid UTF-8, or
oversized. `adm_truncated`, when present, is boolean. Empty events are valid so static rules can scan
the selected executing body without a runtime-visible probe event.

The endpoint returns findings, status, accepted event count, event truncation metadata, and additive
`meta.admTruncated` for caller-declared creative-source truncation. Creative source is processed
transiently, not logged as request context, and does not create a Behavior Corpus entry. The browser
selects macro-resolved/classified/once-decoded markup or escaped synthetic Native HTML before
probe/CSP instrumentation; details of that selection and the 1 MiB UTF-8 window live in
[the frontend contract](./frontend-modules.md).

These two endpoints are the documented HTTP integration contract. Their request, response, error,
and additive-versioning semantics remain in [docs/api-v1.md](../../../docs/api-v1.md). Other routes
listed below are current implementation surfaces and must not silently inherit that document's
stability promise.

## Current Route Families

### Public Read and Analysis

| Family          | Routes                                                                            | Behavior                                                                                                           |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Health          | `GET /api/health`                                                                 | Anonymous liveness/DB/build/local-Sentry-config view; authenticated session receives additional operational detail |
| Analyze         | `POST /api/analyze`, `POST /api/analyze-behavior`                                 | Transient validator and behavior analysis                                                                          |
| Mirror/replay   | `POST /api/v1/mirror`, `POST /api/v1/replay`                                      | Core counterpart generation and bounded multi-sample replay                                                        |
| Curated samples | `GET /api/v1/sample`, `GET /api/v1/sample/list`, `GET /api/v1/behavior/scenarios` | Repository-baked synthetic/curated corpus                                                                          |
| Finding catalog | `GET /api/v1/finding-catalog`                                                     | Locale message/spec-reference catalog                                                                              |
| Exchange rates  | `GET /api/v1/fx-rates`                                                            | Cached USD rate table for display-only currency conversion; 503 when no table (never a fallback rate)              |
| Stream          | `GET /api/v1/stream`, `GET /api/v1/specimen/:hash`                                | Demand-gated SSE and cached synthetic permalinks                                                                   |
| Analytics       | `GET /api/v1/analytics/summary`                                                   | ClickHouse-derived aggregate with graceful failure                                                                 |
| Blog            | `GET /api/v1/blog/list`, `GET /api/v1/blog/post`, `GET /blog/rss.xml`             | Markdown and ClickHouse content reads; RSS is indexable Markdown only                                              |

Public Intel routes are `POST /api/intel/suggest-name`, `POST /api/intel/field-purpose`, and
`POST /api/intel/simulate-bids`. They run deterministic `lib/intel-rules.js` logic. Simulation can
receive a request body for transient processing but does not call an external model or store the
body.

The Health response retains `sentry: { ready: boolean }`. `true` means only that this server process
initialized its Sentry-compatible SDK with a locally parsed destination. It does not prove target
reachability, authentication, envelope ingestion, retention, alerting, or delivery. The response
never exposes the destination host, project identifier, credentials, or initialization error.
Database health—not the optional Sentry state—owns the endpoint's HTTP `200`/`503` status.

### Session and Account

The auth family contains:

- `GET /api/auth/me`;
- `POST /api/auth/register`, `/login`, `/logout`, and `/preferences`;
- `POST /api/auth/setup-encryption`;
- `POST /api/auth/verify-email/request` and `GET /api/auth/verify-email/confirm`; and
- `POST /api/auth/forgot-password`, `/reset-password/state`, and `/reset-password`.

Registration/login accept a password over the protected connection for server-side bcrypt handling.
Wrapped-key fields are opaque to the server. Reset and wipe behavior is part of
[the data-retention contract](./data-retention.md).

### Authenticated Workspace

| Family            | Routes                                                                        | Scope                                                     |
| ----------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| Partners          | collection CRUD, item patch/delete, `:id/samples-count` under `/api/partners` | Current user only                                         |
| Samples           | collection create/list and item get/patch/delete under `/api/samples`         | Current user only                                         |
| Account insights  | `GET /api/account/insights`                                                   | Current user's derived analyze metadata                   |
| Behavior Corpus   | list/create/delete and matrix under `/api/behavior/corpus`                    | Current user's explicitly saved probe events              |
| User dialects     | dialect CRUD/import/export plus mapping CRUD under `/api/dialects`            | Current user only                                         |
| Partner inference | `POST /api/intel/suggest-partner`                                             | Transient deterministic inference for signed-in save flow |
| Creative asset    | `POST /api/creative/asset`                                                    | Signed-in, explicit-click raster inlining                 |
| Outbound proxy    | `POST /api/proxy`                                                             | Signed-in allowlisted test harness                        |

Workspace handlers perform the auth gate themselves and always scope persistence calls by user id.
A partner deletion unassigns its samples; it does not transfer another user's data.

The creative-asset route is a separate caller-chosen-host SSRF boundary. Before a socket opens, it
accepts only HTTP(S) on default ports, canonicalizes literal and DNS-returned addresses (including
IPv4-mapped IPv6 and WHATWG hexadecimal forms) before private-address classification, and rejects a
hostname if any answer is private. The connection is pinned to the validated address while retaining
the original hostname for HTTP `Host`, TLS SNI, and certificate validation. Redirects are not
followed. Responses must match the raster-image MIME allowlist (which excludes SVG) and stay within
the configured byte and timeout bounds. Authentication and rate limiting are additional controls,
not substitutes for these socket-level guarantees.

### Operator and Optional Error Ingest

`GET /api/admin/stats`, `GET /api/admin/logs`, and Blog Admin list/approve/reject/ingest routes use a
separate configured bearer token rather than the user session. If the token is absent the surface is
disabled. Token values never belong in tracked artifacts.

`POST /glitchtip-ingest/*` is registered only when compatible error-ingest configuration exists. It
accepts only approved event-store path shapes, enforces its own rate/body/time bounds, and proxies to
the configured internal upstream. It is not a general reverse proxy.

## Limits and Abuse Boundaries

- Analyze, mirror, and replay share a per-IP human-paste limiter.
- Behavior analysis has a separate, tighter per-IP limiter.
- Intel uses its own per-IP limiter.
- Public ClickHouse reads use a bounded read limiter and request timeout.
- SSE limits concurrent connections per client and stops the generator when the last subscriber
  leaves.
- Auth has account/IP-oriented registration/login/recovery limiters and persistent session expiry.
- The authenticated creative-asset fetch enforces the caller-chosen-host boundary documented above.
- The authenticated outbound proxy uses a static hostname allowlist, HTTP/HTTPS only, approved
  ports, redirect revalidation, response-size cap, and timeout. The user intentionally sends its
  request body to the selected external allowlisted host.

Limit values are implementation constants or bounded environment configuration. A value change is
tested at the handler boundary and documented publicly when it affects the stable API.

## Static, Cache, and SEO Boundary

Locale resolution occurs before filesystem access. English routes are unprefixed; Ukrainian and
Russian routes use locale prefixes. Canonical redirects, registered SPA routes/subroutes, blog
routes, specimen permalinks, and programmatic landings are allowlisted by the locale router. Unknown
page routes return a real 404.

The static handler rejects traversal outside `public/`, content-hashes asset references, rewrites
route SEO, and optionally injects blog/landing SSR. HTML and unversioned assets are `no-cache`;
content-hashed assets are immutable for a long cache lifetime. Non-HTML assets carry
`X-Robots-Tag: noindex`.

All responses receive baseline headers for MIME sniffing, same-origin framing, referrer policy,
geolocation/camera/microphone denial, HSTS, and CSP. The current CSP is self-origin based, blocks
objects, constrains frames/forms/base URLs, and retains `unsafe-inline` for existing shell/creative
compatibility. Creative containment is separately enforced by the iframe sandbox in
[the frontend contract](./frontend-modules.md).

## External Processing Boundary

- Analyze, behavior, mirror, replay, and Intel do not forward submitted payloads to a model.
- `/api/proxy` is an explicit authenticated user-requested transmission to a small code-reviewed
  allowlist.
- `/api/creative/asset` is an explicit authenticated user-requested image fetch to a creative-named
  host, subject to the pinned-address SSRF boundary above.
- Resend receives transactional email data only from auth flows when configured.
- ClickHouse receives the derived/operational/content entities described in
  [data-model.md](../data-model.md).
- Sentry-compatible reporting and Telegram receive bounded error/alert context when configured;
  handlers must not attach payload bodies, secrets, passwords, or key material.
- OpenRouter is not an HTTP request-handler dependency; it exists only in the scheduled news content
  pipeline described by [content and SEO](./content-seo.md).

## Change and Verification Rule

Any route addition/change must update its owning handler tests and this inventory when the family or
access boundary changes. Stable analyze changes also update `docs/api-v1.md`. Collection or
third-party flow changes update [data retention](./data-retention.md), privacy/security documents,
and regression guards in the same feature. Run the HTTP/privacy steps in
[quickstart.md](../quickstart.md), then the complete repository gate.
