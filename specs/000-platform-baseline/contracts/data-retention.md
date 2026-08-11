# Contract: Data Processing, Retention, and Encryption

**Code owners**: analyze/auth/workspace handlers, `db.js`, browser crypto/session/history modules,
analytics/event writers, and stream cache
**User-facing owner**: [docs/PRIVACY.md](../../../docs/PRIVACY.md)

Raw payload bodies sent to `/api/analyze` are processed transiently and are not persisted in server
databases, application logs, analytics, or external models. This hosted-processing fact is separate
from browser-local history and from an explicit saved-sample action.

## Processing Matrix

| Flow                     | Data received                                              | Processing                                                                         | Persistent result                                                             |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Inspector analyze        | BidRequest and/or BidResponse body                         | In-process Core validation, crosscheck, categories, format                         | No server-side body; derived metrics and sampled request metadata may persist |
| Behavior analyze         | Probe events and optional creative markup                  | In-process static/runtime behavior rules                                           | None unless the user separately saves a Corpus entry                          |
| Intel partner/simulation | Request and optional response body                         | Deterministic `lib/intel-rules.js` inference/formulas                              | None; no model call                                                           |
| Discovery observer       | Parsed payload in browser                                  | Walk privacy-filtered `ext` subtrees and reduce values to bounded shapes           | Derived paths/shapes/counts in IndexedDB, not raw values                      |
| Save sample              | Browser ciphertext plus sample metadata in the official UI | Store supplied blobs and metadata                                                  | SQLite sample row                                                             |
| Save Behavior Corpus     | Probe events, label, notes, optional sample link           | Explicit authenticated save                                                        | Plaintext SQLite corpus row                                                   |
| Save dialect             | Name and signal mappings                                   | Authenticated account-scoped CRUD                                                  | Plaintext SQLite dialect/mapping rows                                         |
| Outbound proxy           | User-selected URL and body                                 | Authenticated forward to a static allowlist                                        | No application DB row; external host receives the forwarded body              |
| News moderation          | Public RSS title/URL/summary                               | Deterministic relevance; model translation/categorization only for qualifying news | ClickHouse draft/post rows                                                    |

## Browser Retention

### Raw analysis history

The Inspector stores up to 50 recent raw request/response entries in same-origin `localStorage`.
Entries survive reloads and synchronize to other tabs via the browser `storage` event. A quota error
drops the oldest half and retries. Clearing Inspector history removes this browser store but does not
delete separately saved library rows or telemetry already derived from a prior server call.

### Preferences and per-tab state

Locale, theme, dialect, version pin, layout, onboarding, and dismiss preferences use browser storage
and, where applicable, a locale cookie or account preference. They remain until the user/feature
changes them, feature expiry removes them, or site data is cleared.

The active DEK is kept in memory and serialized to `sessionStorage` only for same-tab refresh
continuity. Recovery-flow state is also per-tab and short-lived. Logout/session clearing removes the
persisted DEK. Passwords are never cached. Recovery material is not placed in URLs, DOM datasets, or
`localStorage`.

### Discovery database

IndexedDB holds normalized extension paths, types, structural/value shapes, observation and
co-occurrence counts, decay timestamps, temporary dialect definitions, and suggestion-cache entries.
The walker never descends above approved `ext` entry points, denies identifier/privacy path names,
caps depth, and reduces long strings to length metadata. Observation scores decay logically; stored
rows are retained until the user clears discovery data. Expired suggestion results are ignored but
not eagerly removed.

## Official Saved-Sample Encryption

The browser save flow uses a KEK/DEK design:

1. PBKDF2-SHA-256 derives a 256-bit KEK from the password, a per-user 16-byte salt, and 600,000
   iterations.
2. A random 256-bit DEK encrypts each request/response body with AES-GCM-256 and a fresh 12-byte IV.
3. The DEK is wrapped once by the password-derived KEK and once by a recovery-derived KEK.
4. The 128-bit recovery value is shown as 32 hexadecimal characters and is not sent to the server.
5. The server receives ciphertext bodies, IVs, salts, and wrapped DEKs; it has no server-side body
   decryption implementation.

The password itself is sent over the protected connection for server-side bcrypt hashing and
comparison. Only the hash is retained.

This guarantee applies to bodies created by the current web flow. The samples API accepts the
supplied strings/IVs without proving ciphertext. Its `is_encrypted` indicator reflects IV presence,
not cryptographic validation. Titles, statuses, notes, partner references, partner profiles, dialect
mappings, timestamps, and explicitly saved Behavior Corpus data remain plaintext and server-readable.

## Server-Side Stores and Lifetimes

### SQLite

- Users, partners, saved samples, authenticated analyze metadata, Behavior Corpus rows, and user
  dialects remain until an explicit delete/wipe path removes them.
- Sessions expire after 30 days and are pruned after expiry; logout, password reset, and wipe also
  invalidate the applicable sessions.
- Analyze metadata contains side/type, version, status, format, and severity counts only.
- A partner deletion sets its samples' partner reference to null. It does not delete the samples.
- A sample deletion nulls any optional Behavior Corpus source link through its foreign-key rule.
- The synthetic `cached_specimens` table is independent of accounts. It is capped at 10,000 rows and
  evicts the oldest approximately ten percent after crossing the cap.
- The retained SQLite `event_log` table is not the current operational-event backend.

### ClickHouse

- `analytics.validation_logs` receives format, version, severity counts, and source for analyze and
  signal-bearing stream events. This repository does not define that table's retention duration;
  deployed ClickHouse schema/policy is authoritative.
- `analytics.ortbtools_events` receives every API error and a configured sample of successful API
  metadata: method, path, status, latency, optional user reference, client IP, request id, and bounded
  context. It never receives request/response bodies. The writer contract expects a 90-day table TTL.
- Auth events are reconstructed from fixed outcome/reason enums; caller-provided message, email, IP,
  user id, request id, and free-form context are discarded.
- Blog drafts and posts retain public content workflow data according to operator ClickHouse policy;
  they do not contain Inspector payloads.

ClickHouse telemetry is disabled when credentials are absent or
`ORTBTOOLS_ANALYTICS_DISABLED=1`. This does not disable authenticated SQLite `analyze_log`, browser
history, account/library persistence, pino stdout, or explicitly saved corpus data.

## Logging and Error Reporting

Pino logs request lifecycle and errors but has no request-body logger. The operational event writer
records bounded request metadata, not bodies. Sentry-compatible capture and Telegram alerts receive
bounded error/route context when configured; callers must never attach payload bodies, passwords,
DEKs, recovery keys, tokens, DSNs, or other secrets.

Reverse proxies, ingress/CDN, allowed proxy destinations, email delivery, ClickHouse, and configured
error services have their own retention outside this repository. The application privacy contract
must not imply those independent processors lack logging or retention.

## Deletion and Recovery

- Deleting a saved sample, partner, Corpus row, or dialect uses an authenticated account-scoped
  handler and its documented foreign-key behavior.
- Password-reset recovery can unwrap and rewrap the DEK when the recovery value is available.
- Password-reset wipe is the explicit path when both password access and recovery are unavailable.
  It replaces password/crypto state and removes samples, partners, analyze metadata, Behavior Corpus
  rows, user dialects/mappings, and sessions while retaining the account identity.
- Destruction of live crypto state makes prior encrypted bodies inaccessible through the application,
  but rows already captured in backups follow backup retention rather than disappearing immediately.

## Backups

The repository backup script uses SQLite's WAL-aware `.backup` operation, compresses the result,
restricts backup permissions, and removes its daily archives after 30 days. The operator runbook also
documents host-level snapshots with their own retention. A database archive contains the full SQLite
state at capture time: encrypted body blobs from the web flow plus plaintext metadata and any direct
client data exactly as stored.

Account/sample deletion and reset wipe affect the live database; they do not retroactively edit
existing archives. Backup/restore and host-level retention remain in
[docs/OPERATIONS.md](../../../docs/OPERATIONS.md).

## Prohibited Changes Without a Contract Update

A feature may not introduce payload bodies into SQLite analyze metadata, ClickHouse validation or
event rows, pino/Sentry/Telegram context, Spec Kit artifacts, or a new third party without updating
this contract, the user-facing privacy/security documents, and regression tests in the same change.
The same rule applies to changed encryption parameters, ciphertext enforcement, browser retention,
session lifetime, deletion scope, cache cap, telemetry gate, or backup lifecycle.

Run the HTTP/privacy and persistence steps in [quickstart.md](../quickstart.md), then the complete
repository gate.
