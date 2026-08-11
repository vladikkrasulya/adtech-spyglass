# ortbtools — Privacy and Zero-Knowledge Encryption

This document explains exactly what data ortbtools collects, what it encrypts,
what the server can and cannot read, and the threat model behind the
"zero-knowledge encryption" claim. Written for an end user who is skeptical and
for an auditor who wants to verify the claims against the source code.

---

## TL;DR

- **Anonymous server-side processing never persists your payload bodies.** Your
  `BidRequest` and `BidResponse` JSON is sent over HTTPS, analyzed on the server, and
  discarded — it never touches the server's databases. The server does keep _derived_
  records: anonymous analytics (detected format, oRTB version, finding counts) and an
  operational request log that records request metadata including your IP address
  (sampled). Neither contains the payload itself.
- **The browser keeps a local analysis history.** Up to 50 recent raw request/response
  entries are stored in same-origin `localStorage`, survive reloads, and synchronize
  between tabs. This is browser persistence, not a server-side history sync.
- **The current web save flow encrypts saved request/response bodies before upload.**
  The server stores AES-GCM-256 ciphertext and cannot decrypt those bodies. Sample
  titles, statuses and notes; partner profiles; and custom-dialect mappings are
  plaintext server metadata. The API does not cryptographically verify that arbitrary
  callers supplied ciphertext; the `is_encrypted` list flag only reflects IV presence.
- **The Key Encryption Key (KEK) is derived from your password using PBKDF2 and
  never leaves the browser.** ortbtools the server never sees it.
- **A 32-character hex recovery key is shown once at registration.** It is the only
  way to regain access to encrypted sample bodies if you forget your password. If both
  your password and recovery key are lost, the account's saved data can only be wiped —
  there is no server-side decryption path.
- **The `/api/analyze` endpoint reads your payload transiently.** The validator runs
  server-side, returns findings, and drops the payload. It does not write the payload
  to the database. See "What the validator pipeline does" below.
- **Self-hosters can disable ClickHouse-derived telemetry.** Leave `CLICKHOUSE_USER`
  unset, or set `ORTBTOOLS_ANALYTICS_DISABLED=1` in the container env. See
  "Self-hosting: disabling derived telemetry" below. This does not remove per-account
  Cabinet activity metadata in SQLite for signed-in users.

---

## What you give us, what we keep

### Anonymous use (no login)

| Data                              | Stored?                       | Notes                                                                                                                                                                                                                |
| --------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BidRequest` / `BidResponse` JSON | Body: browser only; server no | Sent to `/api/analyze`, validated transiently, and never written to a server DB or application log. Derived analytics (format, version, finding counts) go to ClickHouse `validation_logs`.                          |
| Recent analysis history           | Browser `localStorage`        | Up to 50 raw request/response entries. Survives reloads and synchronizes across same-origin tabs. There is no dedicated history upload; analyzing an entry still sends its payload to `/api/analyze` as described.   |
| IP address                        | Yes — sampled request log     | In-memory rate-limit buckets (swept hourly) plus an operational request log (ClickHouse `event_log`) that records your IP with request metadata for every error and a sample of successful calls. Never the payload. |

ortbtools keeps two derived records for anonymous analyses: an anonymous analytics row
(detected format, oRTB version, and finding counts — ClickHouse `validation_logs`) and
an operational request log (`event_log`) that records request metadata including your
IP address, sampled. Neither contains the payload bodies. Reverse proxies and CDNs
between your browser and the server (Cloudflare, the kyivtech-portal proxy) may have
their own access logs as well. The ortbtools application itself does not log payload
bodies.

### Account creation

| Data                        | Stored?                           | Notes                                                                                                                                     |
| --------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Email address               | Yes (plaintext)                   | Used for login and optional recovery-link emails                                                                                          |
| Password                    | Only as a bcrypt hash (12 rounds) | Sent to the server over TLS and hashed with bcrypt **server-side**; the plaintext is never stored or logged. `auth.js:BCRYPT_ROUNDS = 12` |
| KDF salt                    | Yes (base64, 16 bytes)            | Per-user random; used client-side to derive KEK                                                                                           |
| Wrapped DEK                 | Yes (AES-GCM-256 ciphertext)      | Opaque blob; useless without KEK                                                                                                          |
| Recovery wrapped DEK + salt | Yes (ciphertext + separate salt)  | For password-reset path                                                                                                                   |
| Name, phone, card           | Not collected                     | None of these fields exist                                                                                                                |

### Saved samples (authenticated, current web UI)

| Column              | What it contains                                                      |
| ------------------- | --------------------------------------------------------------------- |
| `bid_req`           | AES-GCM-256 ciphertext of the BidRequest JSON (encrypted in browser)  |
| `bid_res`           | AES-GCM-256 ciphertext of the BidResponse JSON (encrypted in browser) |
| `req_iv` / `res_iv` | Per-blob random 12-byte IVs (base64) — needed for decryption          |
| `title`             | Plaintext (set by user; consider omitting sensitive info)             |
| `partner_id`        | Integer reference to the partner row                                  |
| `status`            | `clean` / `warnings` / `errors` (plaintext)                           |
| `notes`             | Plaintext user-supplied metadata                                      |
| `created_at`        | Timestamp                                                             |

The web UI encrypts `bid_req` and `bid_res` before it calls `/api/samples`. The API
also accepts legacy or direct-client rows without IVs and does not validate that a
submitted string is ciphertext; the list response's `is_encrypted` value means only
that `req_iv` is present. `title`, `status`, `notes`, `partner_id`, and timestamps are
plaintext so the server can list, filter, and edit metadata without decrypting payload
bodies. Treat all of those fields like filenames or labels on a shared drive.

### Partner profiles and custom dialects (authenticated)

Partner `name`, generated `slug`, `notes`, and creation timestamp are stored as
plaintext SQLite columns. Custom dialect names and their mappings — including signal
paths/values, semantic labels, fingerprints, parameters, confidence, notes, and
timestamps — are also plaintext. These records are account-scoped and auth-gated, but
they are not encrypted with the sample DEK and are readable by the server operator.

### Activity log (Cabinet → Activity)

ortbtools records a metadata row in `analyze_log` each time you run an analysis while
logged in. The row contains: `user_id`, timestamp, `payload_type`
(request / response / both), detected oRTB version and format, finding status
(`clean` / `warnings` / `errors`), number of findings by level, and whether the
analysis was a crosscheck. **Payload bodies are never written to this log.** The
activity heatmap and insights cards in the Cabinet derive from this metadata only.

### Library insights (Cabinet → Library insights)

Aggregate counts computed from `analyze_log` metadata rows for the current user. No
decryption of saved samples occurs during insights computation.

### Behavior Corpus (authenticated, explicit save)

The Behavior analyzer itself is transient, but choosing to save a labelled corpus
entry via `POST /api/behavior/corpus` persists the probe `events_json`, label,
free-form `notes`, optional source-sample link, and timestamp in SQLite. These fields
are plaintext and readable by the server operator. They may include URL or behavior
details from the creative probe, so save a corpus entry only when that retention is
acceptable.

---

## The encryption model

The scheme is a standard KEK/DEK (Key Encryption Key / Data Encryption Key) pattern,
the same approach used by 1Password and Bitwarden.

### Step-by-step on registration

1. **Password → KEK.** Your password is fed into PBKDF2-SHA-256 with 600,000
   iterations and a fresh 16-byte random salt (`pwSalt`) inside your browser.
   The output is a 256-bit AES-GCM key (the KEK). The KEK never leaves the browser.
   (Your password itself _is_ sent to the server over TLS to verify your login with
   bcrypt — see step 5 — but only the bcrypt hash is stored, never the plaintext.)
   Source: `public/ortbtools-crypto.js`, `deriveKEK()`, constant `PBKDF2_ITERATIONS = 600000`.

2. **Generate DEK.** A 256-bit random Data Encryption Key is generated with
   `crypto.getRandomValues()`. This key will encrypt your actual sample payloads.

3. **Generate recovery key.** A 128-bit random value is generated and displayed to
   you as a 32-character hex string (`RECOVERY_BYTES = 16`). A second KEK is derived
   from this recovery key + a separate salt (`rkSalt`) using the same PBKDF2
   parameters.

4. **Wrap DEK twice.**
   - `wrappedPw` = AES-GCM-256(KEK from password, DEK bytes), with a fresh 12-byte IV.
   - `wrappedRk` = AES-GCM-256(KEK from recovery key, DEK bytes), with a separate IV.

5. **POST to server.** The browser sends the registration payload:
   `{ email, password, kdf_salt, dek_wrapped, dek_iv, recovery_salt,
recovery_dek_wrapped, recovery_dek_iv }`. The server stores the email and the six
   crypto fields. The password is transmitted over TLS and hashed with bcrypt
   **server-side** (`auth.js`, `bcrypt.hash`, 12 rounds); only the resulting hash is
   persisted — the plaintext is never written to disk or logs. The KEK and DEK, by
   contrast, are never sent to the server, which is why it cannot decrypt the
   request/response bodies encrypted by the current web UI.

6. **Recovery key shown once.** The 32-hex recovery key is displayed in a modal. It
   is never sent to the server and never stored. If you lose it, the recovery wrap
   path is permanently unavailable and password-reset can only wipe saved account data.

### Encrypting a saved sample

When you click "save" on an analysis:

1. The browser retrieves the live DEK from the `window.OrtbtoolsSession` closure (it
   was unwrapped from `dek_wrapped` at login time using your password-derived KEK).
2. `encryptBlob(dekKey, bidReqJSON)` → `{ iv, ct }` (fresh 12-byte IV per blob).
3. Same for `bidResJSON`.
4. The browser POSTs
   `{ req_iv, bid_req, res_iv, bid_res, title, partner_id, status, notes }` to
   `/api/samples`. In the current web flow, `bid_req` and `bid_res` hold ciphertext,
   so plaintext bid JSON never appears in this POST body. The title, partner reference,
   status, and notes do appear as plaintext metadata.

### What the server stores (summary)

```
users table:
  email            ← plaintext
  password_hash    ← bcrypt(12 rounds), never the raw password
  kdf_salt         ← base64(16 random bytes)
  dek_wrapped      ← base64(AES-GCM-256 ciphertext of DEK)
  dek_iv           ← base64(12-byte IV for the above)
  recovery_salt    ← base64(16 random bytes for recovery KEK derivation)
  recovery_dek_wrapped  ← base64(AES-GCM-256 ciphertext of DEK via recovery key)
  recovery_dek_iv  ← base64(12-byte IV for the above)

samples table:
  bid_req          ← base64(AES-GCM-256 ciphertext)  ← cannot decrypt without DEK
  bid_res          ← base64(AES-GCM-256 ciphertext)  ← cannot decrypt without DEK
  req_iv / res_iv  ← base64(12-byte IVs)
  title            ← plaintext (user-supplied, used for filtering)
  status           ← plaintext (clean/warnings/errors, used for filtering)
  notes            ← plaintext (user-supplied)
  partner_id       ← plaintext reference to a partner row

partners table:
  name / slug / notes / created_at  ← plaintext account metadata

user_dialects + dialect_mappings tables:
  names, signal mappings, params, notes and timestamps  ← plaintext account metadata
```

The server cannot recover the DEK without the user's password or recovery key. A
full DB dump reveals encrypted sample bodies alongside the plaintext metadata listed
above. Direct API clients can also create rows without IVs; server storage does not
enforce or prove client-side encryption.

---

## Recovery key flow

The recovery key is a 128-bit random value displayed as a **32-character hex string**
(e.g. `a3f81c9e4b2d70e56a12fcd8093e47b1`) immediately after registration. It is shown
exactly once, in a modal with a "copy to clipboard" button.

The recovery key is used in the **forgot-password flow**: if you request a password
reset, the browser can open your DEK using the recovery key instead of the password.
After you set a new password, the DEK is re-wrapped with the new KEK. The recovery
wrap is preserved so the key-on-paper remains valid.

If the password is forgotten **and** the recovery key is lost, there is no server-side
path to decrypt the encrypted sample bodies. The reset flow's `wipe` mode clears the
crypto state and deletes samples, partners, custom dialects/mappings, activity rows,
saved Behavior Corpus rows, and sessions before a fresh crypto state is created; the
account email remains.

Source: `public/ortbtools-crypto.js`, `openWithRecoveryKey()`;
`public/modules/password-reset/index.js` (rotate / recover / wipe modes).

---

## What the validator pipeline does to payloads

When any user (anonymous or logged in) submits a payload to `/api/analyze`, the
following happens server-side:

1. The JSON is parsed from the request body.
2. `validate(payload, opts)` and `crosscheck(req, res, opts)` run in-process and
   return a structured findings array.
3. The findings are serialized and returned as the HTTP response.
4. **The payload is not written to the database, not appended to log files, not
   forwarded to any third party.**

The `analyze_log` table (for logged-in users) records only metadata derived from the
findings: detected version/format, finding status, count by level, and whether it was
a crosscheck. It never includes `bid_req` or `bid_res` body content.

### Logging

The server uses pino-based structured logging (`lib/logger.js`). The default log
level in production is `'info'`. At `info` level, ortbtools logs request routing
events, session lifecycle, and error stack traces. **It does not log request bodies
at any level — there is no debug/trace handler that dumps the `bidReq`/`bidRes`
payload.** The analyze handler at `modules/analyze/handler.js` logs only parse errors
and rate-limit events, not the payload content.

Separately, an operational request log (`lib/event-log.js`, ClickHouse `event_log`)
records one row per `/api/*` request — every 4xx/5xx and a 1-in-N sample of successful
requests — capturing method, path, status, latency, the user id when signed in, and the
client IP. It never captures the request or response body. Error events are also sent to
Sentry/GlitchTip (`lib/logger.js`), again without payload bodies.

Authentication telemetry stores a fixed event label, severity (`level`), a
timestamp, and a finite `outcome` (`success`/`failure`) + `reason_code`. The
event-log boundary (`lib/event-log.js`) **reconstructs** the whole row from that
contract: the caller-provided message, email, IP address, user id, request id,
URL / method / status / latency and any other context are discarded, and the
message label is derived internally from `reason_code` (it deliberately does not
reveal which accounts exist). A malformed auth event is dropped. So an auth row
physically cannot carry an identifier or free-form text even if a future caller
passes one (v1.2.1).

Test mode runs with `LOG_LEVEL=silent` (see `package.json` `npm test` script).

---

## Self-hosting: disabling derived telemetry

ortbtools writes **derived** analytics to ClickHouse when credentials are configured:

| Table / module                                        | What it stores                                       | Env gate                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `analytics.validation_logs` (`lib/validation-log.js`) | Format, oRTB version, finding counts per analyze     | `CLICKHOUSE_USER` + not `ORTBTOOLS_ANALYTICS_DISABLED=1` |
| `analytics.ortbtools_events` (`lib/event-log.js`)     | Sampled request metadata (path, status, IP, latency) | same                                                     |

**Option A — no ClickHouse (simplest):** leave `CLICKHOUSE_USER` empty in `.env`
(default in `.env.example`). Both modules no-op; the app boots normally.

**Option B — explicit kill-switch:** set `ORTBTOOLS_ANALYTICS_DISABLED=1` in the
container environment even when ClickHouse credentials exist (useful when CH is
shared with other services on the same host).

```bash
# In /srv/DATA/Stacks/ortbtools/.env (then recreate container):
ORTBTOOLS_ANALYTICS_DISABLED=1
```

```bash
cd /srv/DATA/Stacks/ortbtools && docker compose up -d
```

**Not disabled by either option:** per-user `analyze_log` rows in SQLite (Cabinet →
Activity for signed-in users), bcrypt auth, saved-sample/account storage, and stdout
pino logs. `/api/analyze` payload bodies are never persisted server-side regardless of
these settings; browser history and explicitly saved samples follow the separate
retention rules above.

See also [OPERATIONS §4.9](./OPERATIONS.md#49-disable-clickhouse-derived-telemetry-self-host-privacy).

---

## Threat model

### What ortbtools protects against

**Server-side data breach (full DB dump).** An attacker who reads the SQLite database
file sees bcrypt hashes, encrypted body blobs produced by the current web UI, and all
plaintext metadata described above. Without the user's password or recovery key, those
encrypted body blobs cannot be decrypted. The wrapped DEK and IVs in the `users` table
are cryptographically inert without the KEK, which is never stored. Because the API
does not enforce ciphertext, any direct-client sample saved as plaintext is visible in
the dump.

**Operator curiosity.** The server operator (the person running the container) has
read access to the database file. They can read sample/partner/dialect metadata and
saved Behavior Corpus events. They cannot read `bid_req` / `bid_res` bodies encrypted
by the current web UI without the user's password or recovery key.

**Password reuse from a different breach.** Because PBKDF2 uses a per-user random
salt stored separately from the wrapped DEK, a leaked plaintext password from a
different service cannot be used to brute-force the DEK without also obtaining the
`kdf_salt` from this database. The 600,000-iteration cost makes offline brute-force
expensive even then.

### What ortbtools does NOT protect against

**Compromised user device.** If a browser extension or malware on your machine has
access to the browser's memory or can intercept keystrokes, it can extract the
plaintext password or the live DEK. No server-side architecture can protect against
a compromised client.

**Active attacker with persistent server access (code injection).** A determined
attacker who can modify the JavaScript files served by ortbtools could replace
`ortbtools-crypto.js` to exfiltrate the password at the next login. This is not a
weakness specific to ortbtools — it applies to any web-delivered encryption. The
source is public at `github.com/vladikkrasulya/adtech-spyglass`, and the deployment
pipeline uses exact-SHA immutable images plus readiness/smoke gates. Those controls
reduce accidental drift and some supply-chain mistakes; they do not protect a user
from an attacker who retains control of the host, proxy, container runtime, or served
JavaScript.

**Your bid stream through ad networks.** ortbtools inspects a _copy_ of the payload
you paste. The original bid transaction still passed through the SSP, DSP, and any
intermediaries. ortbtools protects the copy you saved; it has no effect on what the ad
networks logged.

**Plaintext metadata.** Sample titles, statuses, notes, partner references and
timestamps; partner names/slugs/notes; custom dialect mappings; and saved Behavior
Corpus data are readable by the server. Do not put sensitive deal IDs, identifiers,
URLs, or secrets in these fields if that would be a concern.

---

## What an auditor can verify

The following proof points are available without access to the production server:

1. **Source code.** The repository is public at
   `https://github.com/vladikkrasulya/adtech-spyglass`. The crypto module is at
   `public/ortbtools-crypto.js`. The KEK derivation parameters (`PBKDF2_ITERATIONS`,
   `PBKDF2_HASH`, `KEY_BITS`, `SALT_BYTES`, `IV_BYTES`) are declared at the top of
   that file. As of this writing: 600,000 iterations, SHA-256, 256-bit key, 16-byte
   salt, 12-byte IV.

2. **Auth module.** `auth.js` contains the session and bcrypt logic. `BCRYPT_ROUNDS`
   is set to 12. The file confirms that the server calls `bcrypt.compare()` against
   the stored hash — plaintext password is never persisted or logged.

3. **Server crypto-state endpoint.** `POST /api/auth/setup-encryption` accepts
   the six crypto-state fields and stores them. `GET /api/auth/me` returns the
   crypto state to the browser so the client can derive the KEK without a second
   round-trip. You can verify with `curl -b <session-cookie>
https://ortbtools.com/api/auth/me` — the response includes
   `kdf_salt`, `dek_wrapped`, `dek_iv` (ciphertext blobs) and no password field.

4. **Samples endpoints.** `GET /api/samples` returns metadata, blob lengths, and an
   `is_encrypted` marker derived only from `req_iv` presence; it does not return the
   bodies. `GET /api/samples/:id` returns the stored `bid_req`, `bid_res`, and IVs.
   For a sample created by the current web UI, the body fields are base64 ciphertext.
   The server does not verify that direct API clients supplied ciphertext.

5. **No server-side decryption code.** Search the repository for `decryptBlob`,
   `unwrapBytes`, `openWithPassword` — these functions exist only in
   `public/ortbtools-crypto.js` (browser) and `tests/crypto.test.js`. They are
   absent from `server.js`, `db.js`, and all `modules/` handlers.

6. **Analyze handler.** `modules/analyze/handler.js` processes the payload and
   returns findings. There is no `db.Samples.create(...)` or equivalent write call
   in this handler. The analyze path and the sample-save path are separate code
   routes initiated by separate user actions.

---

## Reporting a security issue

See `SECURITY.md` in the repo root. Email `hi@kyivtech.com.ua`. Do not open a
public issue before the maintainer has had a chance to ship a fix.

A finding that lets the server decrypt request/response bodies saved through the
current encrypted web flow is treated as high severity and triaged immediately.

---

## Changelog of privacy-relevant changes

Selected entries from CHANGELOG.md:

**v0.37.1** — Closed an audit P1 desync: on password reset, stolen cookies stayed
live in the in-memory session Map even after the DB-side delete threw. Fixed via a
`finally` block that clears the Map regardless of DB outcome, combined with the
`updatePasswordAndCrypto` atomic transaction.

**v0.25.0** — Password reset "wipe" mode: DEK destruction confirmed server-side.
Previous versions silently failed to delete the DB session row on reset; post-v0.25.0
`Sessions.destroyForUser()` is called atomically alongside the password update.

**v0.20.0** — Phase 7 Zero-knowledge encryption shipped. KEK/DEK scheme, PBKDF2
600k iterations, AES-GCM-256, per-user recovery key. Schema v3 migration wiped
pre-existing plaintext samples (all were empty in production at the time). Browser
test suite added: `tests/crypto.test.js` (13 round-trip tests including tampered-
ciphertext rejection).

**setup-encryption replay protection** (post-Phase-7 hardening) — The
`POST /api/auth/setup-encryption` endpoint was originally idempotent; an attacker
with a valid session could overwrite the crypto state and lock the user out. Now
rejects with `409 crypto_already_setup` if a state already exists for the user.
