# Evidence Record: Platform Baseline

**Observed**: 2026-08-11
**Method**: Read-only inspection of repository code, schemas, tests, package metadata, and retained
public/operator contracts. No production data or live service state was used.

## Evidence Priority

For this baseline, executable code and tests establish current behavior. Package manifests establish
declared versions and runtimes. Retained privacy, security, API, npm, and operations documents are
the human-facing contracts, but a claim was included here only when its implementation boundary was
also identifiable. Historical roadmap and architecture narratives were not treated as current
evidence.

## Evidence Map

| Concern               | Primary evidence                                                                    | Conclusion captured by the baseline                                                            |
| --------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Product/version shape | `package.json`, workspace package manifests                                         | One app plus independent Core and CLI SemVer surfaces                                          |
| Core public API       | `packages/core/index.js`, `findings.js`, Core README, API stability tests           | Deterministic validation/crosscheck contract, explicit format/version limitations              |
| Rule ownership        | Core versioned validators, `rules/index.js`, rule tests                             | Baseline validators plus an explicit registered plugin layer                                   |
| CLI behavior          | `packages/cli/lib/cli.js`, CLI tests                                                | Local Core wrapper with JSON/human output and exit codes 0/1/2                                 |
| HTTP composition      | `server.js`, `lib/router.js`, `lib/http.js`, handler modules                        | One ordered router, feature factories, 2 MiB JSON body cap, static fallback                    |
| Stable HTTP surface   | `docs/api-v1.md`, analyze handler, API tests                                        | `/api/analyze` and `/api/analyze-behavior` are the documented integration contract             |
| Auth and encryption   | `auth.js`, `db.js`, browser crypto/session modules, crypto/auth tests               | Server-side bcrypt sessions plus browser-managed KEK/DEK save flow and direct-client caveat    |
| Frontend lifecycle    | `public/shell-boot.js`, `public/core/registry.js`, module README, re-entrancy tests | Lazy route sections, persistent chrome, abort/cleanup teardown contract                        |
| Creative containment  | Inspector app/module, creative probe, behavior engine/tests                         | Script-enabled iframe without same-origin privilege; bounded event capture and server analysis |
| SQLite entities       | `db.js`, stream handler, DB/stream tests                                            | Schema v10 account store plus separately initialized bounded synthetic specimen cache          |
| Derived telemetry     | analytics gate, validation/event log modules, privacy tests                         | Optional ClickHouse metrics and sampled metadata; no analyze payload bodies                    |
| Browser persistence   | Inspector history, shell session, Intel storage/walker, tests                       | Bounded raw local history, per-tab crypto continuity, derived discovery shapes                 |
| Content pipeline      | blog service/handlers, news crawler/moderator, content tests                        | Markdown plus ClickHouse reads; deterministic relevance; isolated model translation only       |
| SEO and locales       | locale routes, SEO/landing modules, localized shells, SEO tests                     | EN/UK/RU canonical routing, per-route metadata/SSR, default-deny post indexing                 |
| Immutable image       | Dockerfile, compose, ignore policy, immutable-image tests                           | Non-root exact-build runtime with one `/data` mount and no governance files                    |
| Release controls      | deploy/rollback libraries and shell simulations                                     | Clean-main gate, readiness/smoke commit point, fail-closed rollback state machine              |
| Quality gates         | root scripts, GitHub CI, test tree                                                  | Local CI plus package and production-image smoke; runner output owns totals                    |

## Resolved Ambiguities

### Hosted validation is server-side

The browser calls `POST /api/analyze`; the Node handler invokes Core and returns findings. Core is not
the hosted browser validator. Raw Inspector bodies are therefore transmitted to the application
server for transient processing even though the official saved-sample flow encrypts bodies before a
different API call.

### OpenRTB 3.0 is deeply validated but not exhaustive

Dedicated request and response validators inspect the 3.0 envelope and important AdCOM structures.
This is more than detection, but no implementation evidence supports a claim of exhaustive AdCOM
schema conformance.

### JSON Feed detection is not validation

The detector recognizes JSON Feed 1.1. The validator deliberately emits `jsonfeed.not_validated`.
Vendor feed shapes handled by `rules-feed.js` are a different, validated surface.

### Saved-body encryption is a browser-flow guarantee

The current web client encrypts request and response bodies with AES-GCM before calling the samples
API. The server stores the supplied blobs and IVs but does not cryptographically validate ciphertext.
Consequently `is_encrypted` means that an IV is present, not that storage is proven confidential for
an arbitrary direct client.

### Operational events currently live in ClickHouse

SQLite schema history still creates an `event_log` table, but the current `lib/event-log.js` writer
and reader target `analytics.ortbtools_events` in ClickHouse. No current application call path was
found that writes or queries the SQLite table. The baseline records it as a retained schema artifact,
not the active event backend.

### The stream cache is outside the numbered migration

`cached_specimens` is initialized by the stream module after SQLite is injected. It is not part of
the schema-version migration blocks. It contains only generated specimen envelopes, is capped, and
uses oldest-first bulk eviction when the cap is crossed.

### ClickHouse absence is a supported degraded mode

Derived analytics writers no-op when credentials are absent or the analytics kill switch is set.
Blog reads use explicit unavailable behavior and preserve page availability; the account/library
SQLite path and Core validation do not depend on ClickHouse.

### Interactive intelligence is deterministic

All `/api/intel/*` endpoints call `lib/intel-rules.js`. Payload-bearing partner inference and bid
simulation are transient server calls, but they do not call a model. OpenRouter is reachable only
from the news moderator after deterministic relevance scoring, for translation and categorization.

### Indexability and readability are different

Editorial Markdown and ClickHouse posts can both be read. Only a Markdown post with explicit human
opt-in, a non-duplicate body, and the code-defined content floor can enter sitemap/RSS and emit
`index,follow`. ClickHouse/firehose posts remain readable with `noindex,follow`.

### App, Core, and CLI releases are independent

The root application version is painted into browser surfaces and locked by version-consistency
tests. Core and CLI carry their own package versions and compatibility boundaries. A UI-only release
does not imply a Core or CLI bump, and package registry publication is not implied by a version in a
workspace manifest.

## Known As-Built Limitations

- The central Inspector compatibility module remains substantially larger than route modules even
  though its mount/unmount lifecycle is now re-entrant.
- Browser discovery mirrors small Core Intel helpers because the application has no bundler; parity
  must remain tested.
- OpenRTB 2.6 dated revisions share one detection bucket, and 2.x minor-field gating is incomplete.
- The repository does not define the retention policy of `analytics.validation_logs`; the operator's
  ClickHouse schema is authoritative for that table. The operational-event writer does declare a
  90-day ClickHouse TTL contract.
- Account deletion or password-reset wipe removes live account rows but does not retroactively remove
  already-created backups; backup lifecycle remains an operator contract.
- Sentry-compatible reporting, Resend, ClickHouse, RSS ingestion, and OpenRouter are configuration
  gated. Their configured production readiness is runtime state, not a repository fact.

## Maintenance Rule

When implementation evidence conflicts with this package, the change must either restore the
documented contract or update the affected baseline artifact, retained public/runbook contract, and
regression tests together. A durable architecture change also requires an ADR; a future priority
belongs in the roadmap rather than this evidence record.
