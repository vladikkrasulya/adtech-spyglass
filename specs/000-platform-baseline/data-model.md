# Data Model: Current Platform

**Observed**: 2026-08-11
**Scope**: Persistent and transient data entities used by the repository implementation

This document describes entity ownership and relationships. It does not contain production rows,
counts, identifiers, or payload examples. Field-level privacy and retention rules are in
[the data-retention contract](./contracts/data-retention.md).

## SQLite Store

`db.js` owns `ortbtools.db`, schema version 10, WAL mode, foreign-key enforcement, a five-second busy
timeout, and atomic version migrations.

### User

- **Identity**: integer primary key; unique case-insensitive email
- **Authentication fields**: email, bcrypt password hash, verification timestamp
- **Crypto state**: password KDF salt, wrapped DEK and IV, recovery salt, recovery-wrapped DEK and IV
- **Preference state**: optional preferred locale
- **Relationships**: parent of sessions, partners, samples, analysis metadata, Behavior Corpus rows,
  and user dialects
- **Deletion**: account deletion cascades or explicitly deletes account-scoped rows

### Session

- **Identity**: opaque token primary key
- **Fields**: user reference, expiry, client IP, user agent, creation timestamp
- **Relationship**: belongs to one user and cascades on account deletion
- **Lifecycle**: loaded into the in-process session map at boot, removed on logout/reset/account
  deletion, and pruned after expiry

### Partner

- **Identity**: integer primary key
- **Fields**: user reference, name, per-user unique slug, notes, creation timestamp
- **Relationship**: belongs to one user; groups zero or more samples
- **Deletion**: account deletion cascades; deleting a partner sets linked samples' partner reference
  to null rather than deleting them

### Saved Sample

- **Identity**: integer primary key
- **Body fields**: `bid_req`, `bid_res`, and optional per-body IVs
- **Metadata fields**: user and optional partner references, title, status, notes, creation timestamp
- **Relationship**: belongs to one user and optionally one partner
- **Encryption meaning**: bodies produced by the current browser flow are ciphertext; the database
  stores whatever a caller supplied and does not prove encryption
- **Deletion**: explicit sample deletion, account deletion, or password-reset wipe

### Analyze Log

- **Identity**: integer primary key
- **Fields**: user reference, timestamp, payload-side label, detected version, status, format, finding
  count, error count, warning count
- **Relationship**: one metadata row per authenticated analysis; feeds account insights
- **Exclusion**: no request or response body
- **Deletion**: account deletion or password-reset wipe

### Behavior Corpus Entry

- **Identity**: integer primary key
- **Fields**: user reference, label (`legitimate`, `fraud`, or `ambiguous`), serialized probe events,
  optional source-sample reference, notes, creation timestamp
- **Relationship**: belongs to one user; an optional sample link becomes null when that sample is
  deleted
- **Deletion**: explicit entry deletion, account deletion, or password-reset wipe

### User Dialect

- **Identity**: integer primary key
- **Fields**: user reference, name, default flag, creation/update timestamps
- **Relationship**: belongs to one user and owns zero or more mappings
- **Deletion**: deleting a dialect cascades to mappings; account deletion and wipe remove both

### Dialect Mapping

- **Identity**: integer primary key
- **Fields**: dialect reference, signal path/value, semantic label, optional shape fingerprint and
  parameters, mapping version, confidence, notes, creation timestamp
- **Relationship**: belongs to one user dialect
- **Privacy**: plaintext server-readable account data

### Retained SQLite Event Table

Schema migration v9 created `event_log` with timestamp, severity, component, message, HTTP metadata,
optional user/IP/request identifiers, and context. The current application event service no longer
uses this table: `lib/event-log.js` reads and writes ClickHouse. The table remains an as-built schema
artifact and must not be mistaken for the active operational log.

### Cached Specimen

The stream module creates this table at module initialization rather than through the numbered schema
migration.

- **Identity**: deterministic short content hash
- **Fields**: serialized synthetic stream envelope and creation timestamp
- **Relationship**: independent of users and saved samples
- **Lifecycle**: insert-or-replace; when the configured cap is exceeded, the oldest batch is evicted
- **Purpose**: resolve public `/r/<hash>` and specimen API permalinks across process restarts

## ClickHouse Entities

ClickHouse-backed features are optional and no-op or degrade when credentials are absent.

### Validation Log

- **Table**: `analytics.validation_logs`
- **Fields written by this repository**: timestamp, format, detected version, error presence and
  severity counts, source (`analyze` or `stream`)
- **Purpose**: public aggregate Insights
- **Exclusion**: no payload body, user-supplied title, or creative markup

### Operational Event

- **Table**: `analytics.ortbtools_events`
- **Fields**: timestamp, level, component, bounded message, method/path/status/latency, optional user
  reference, client IP, request correlation id, bounded JSON context
- **Write rule**: every API error plus a configured sample of successful API requests; static assets
  are excluded
- **Auth special case**: authentication events are reconstructed from finite outcome/reason enums and
  deliberately discard identifiers and caller-provided free text
- **Lifecycle**: writer contract expects a 90-day table TTL

### Blog Draft

- **Table**: `analytics.blog_drafts`
- **Fields used**: draft id, source metadata, title, source URL, summary, category, locale, creation
  timestamp, status, approval metadata, optional slug
- **Producers**: scheduled RSS crawler and token-gated admin ingestion
- **States**: pending, published, or rejected

### Blog Post

- **Table**: `analytics.blog_posts`
- **Identity**: slug plus locale at the read boundary
- **Fields used**: title, category, summary, body, source URL, tags, publication timestamp, optional
  source-draft reference
- **Relationship**: publication can mark its source draft published
- **SEO rule**: readable but never indexable under the current quality contract

## Filesystem Content

### Editorial Post

- **Identity**: `content/posts/<locale>/<slug>.md`, or the equivalent path below configured
  `CONTENT_DIR`
- **Locales**: English, Ukrainian, Russian
- **Fields**: shallow frontmatter plus Markdown body
- **Authority**: filename is the routing slug; explicit `indexable: true` is necessary but not
  sufficient for indexing
- **Deployment**: image contains a seed; production points `CONTENT_DIR` into `/data/content-posts`,
  which is seeded without overwriting existing runtime content

### Deployment State

- **Identity**: an operator-owned state file under `/data`
- **Fields**: bounded transition status, candidate/active/rollback image identities, provenance,
  privacy floor, timestamps
- **Security rule**: parsed as data rather than sourced as shell; symlinks and unsafe characters are
  rejected by deployment helpers
- **Purpose**: recover safely from an interrupted candidate or rollback transition

## Browser Entities

### Analysis History Entry

- **Store**: same-origin `localStorage`, versioned key
- **Fields**: timestamp/display time, raw request and/or response text, result metadata used by the
  Inspector
- **Lifecycle**: newest-first bounded ring with a maximum of 50 entries; quota failure drops the
  oldest half; cross-tab storage events refresh other tabs
- **Privacy**: raw browser-local payload retention, independent of server persistence

### Browser Preference

- **Store**: `localStorage` plus locale cookie/account preference where applicable
- **Examples**: locale, theme, selected dialect, version pin, layout sizes, collapsed panels, onboarding
  and dismiss states
- **Lifecycle**: retained until replaced, expired by feature-specific logic, cleared by the user, or
  removed with site data

### Per-Tab Crypto Continuity

- **Store**: memory plus `sessionStorage`
- **Fields**: serialized active DEK for refresh continuity and short-lived recovery-flow state
- **Lifecycle**: per tab; cleared on logout/session clearing and naturally removed when the tab
  session ends
- **Exclusion**: password is never cached; recovery state is not written to URLs, DOM datasets, or
  `localStorage`

### Discovery Observation

- **Store**: IndexedDB database `ortbtools_intel_v1`
- **Object stores**: field observations, co-occurrence, discovery metadata, temporary dialects, and a
  suggestion cache with expiry metadata
- **Fields retained from payloads**: normalized `ext` paths, types, bounded structural/value shapes,
  counts, buckets, decay scores, and timestamps
- **Exclusions**: known identifier/privacy path components are denied; raw values and creative
  strings are not stored
- **Lifecycle**: user-clearable; observation scores decay logically, while records remain until
  cleared; expired suggestion entries are ignored but not eagerly deleted

## Relationship Summary

```text
User
├── Session
├── Partner ──< Saved Sample
├── Saved Sample
├── Analyze Log
├── Behavior Corpus Entry ── optional Saved Sample
└── User Dialect ──< Dialect Mapping

Synthetic Stream ──< Cached Specimen
RSS/Admin ──< Blog Draft ── publication ──< Blog Post
Editorial files ── read/SEO independently of ClickHouse posts
Browser session ── local history/preferences/crypto/discovery stores
```

Application-side deletion and retention details are governed by
[contracts/data-retention.md](./contracts/data-retention.md); backup and restore mechanics remain in
[docs/OPERATIONS.md](../../docs/OPERATIONS.md).
