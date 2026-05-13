# Spyglass — Privacy and Zero-Knowledge Encryption

This document explains exactly what data Spyglass collects, what it encrypts,
what the server can and cannot read, and the threat model behind the
"zero-knowledge encryption" claim. Written for an end user who is skeptical and
for an auditor who wants to verify the claims against the source code.

---

## TL;DR

- **Anonymous use (no login) never persists your payloads server-side.** Per-tab
  analysis history lives in the browser's in-memory state only. Your `BidRequest`
  and `BidResponse` JSON never touches a database.
- **Signed-in users' saved samples are encrypted in the browser before they leave
  your machine.** The server stores AES-GCM-256 ciphertext. It cannot decrypt the
  contents.
- **The Key Encryption Key (KEK) is derived from your password using PBKDF2 and
  never leaves the browser.** Spyglass the server never sees it.
- **A 32-character hex recovery key is shown once at registration.** It is the only
  way to regain access to your library if you forget your password. If both your
  password and recovery key are lost, the encrypted library can only be wiped — there
  is no server-side recovery path.
- **The `/api/analyze` endpoint reads your payload transiently.** The validator runs
  server-side, returns findings, and drops the payload. It does not write the payload
  to the database. See "What the validator pipeline does" below.

---

## What you give us, what we keep

### Anonymous use (no login)

| Data                              | Stored?                         | Notes                                                      |
| --------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| `BidRequest` / `BidResponse` JSON | No                              | Used transiently for validation; not written to DB or logs |
| Per-tab analysis history          | Browser only                    | `localStorage` — never sent to the server                  |
| IP address                        | Rate-limit bucket (memory only) | Not persisted to DB; buckets sweep on a 1-hour interval    |

Reverse proxies and CDNs between your browser and the server (Cloudflare, the
kyivtech-portal proxy) may have their own access logs. That is outside Spyglass's
control. The Spyglass application itself does not log payload bodies.

### Account creation

| Data                        | Stored?                          | Notes                                            |
| --------------------------- | -------------------------------- | ------------------------------------------------ |
| Email address               | Yes (plaintext)                  | Used for login and optional recovery-link emails |
| Password                    | Never (bcrypt hash, 12 rounds)   | `auth.js:BCRYPT_ROUNDS = 12`                     |
| KDF salt                    | Yes (base64, 16 bytes)           | Per-user random; used client-side to derive KEK  |
| Wrapped DEK                 | Yes (AES-GCM-256 ciphertext)     | Opaque blob; useless without KEK                 |
| Recovery wrapped DEK + salt | Yes (ciphertext + separate salt) | For password-reset path                          |
| Name, phone, card           | Not collected                    | None of these fields exist                       |

### Saved samples (authenticated)

| Column              | What it contains                                                      |
| ------------------- | --------------------------------------------------------------------- |
| `bid_req`           | AES-GCM-256 ciphertext of the BidRequest JSON (encrypted in browser)  |
| `bid_res`           | AES-GCM-256 ciphertext of the BidResponse JSON (encrypted in browser) |
| `req_iv` / `res_iv` | Per-blob random 12-byte IVs (base64) — needed for decryption          |
| `title`             | Plaintext (set by user; consider omitting sensitive info)             |
| `partner_id`        | Integer reference to the partner row                                  |
| `status`            | `clean` / `warnings` / `errors` (plaintext)                           |
| `notes`             | Encrypted (ciphertext, same DEK) as of schema v3                      |
| `created_at`        | Timestamp                                                             |

`title` and `status` are stored in plaintext because they are used for sorting and
filtering on the server before results are returned to the browser for decryption.
If the title itself is sensitive, treat it like you would a filename on a shared drive.

### Activity log (Cabinet → Activity)

Spyglass records a metadata row in `analyze_log` each time you run an analysis while
logged in. The row contains: `user_id`, timestamp, `payload_type`
(request / response / both), detected oRTB version and format, finding status
(`clean` / `warnings` / `errors`), number of findings by level, and whether the
analysis was a crosscheck. **Payload bodies are never written to this log.** The
activity heatmap and insights cards in the Cabinet derive from this metadata only.

### Library insights (Cabinet → Library insights)

Aggregate counts computed from `analyze_log` metadata rows for the current user. No
decryption of saved samples occurs during insights computation.

---

## The encryption model

The scheme is a standard KEK/DEK (Key Encryption Key / Data Encryption Key) pattern,
the same approach used by 1Password and Bitwarden.

### Step-by-step on registration

1. **Password → KEK.** Your password is fed into PBKDF2-SHA-256 with 600,000
   iterations and a fresh 16-byte random salt (`pwSalt`) inside your browser.
   The output is a 256-bit AES-GCM key (the KEK). The password and KEK never leave
   the browser.
   Source: `public/spyglass-crypto.js`, `deriveKEK()`, constant `PBKDF2_ITERATIONS = 600000`.

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
   `{ email, password_hash_hint (handled server-side), kdf_salt, dek_wrapped, dek_iv,
recovery_salt, recovery_dek_wrapped, recovery_dek_iv }`. The server stores these
   six crypto fields. The server never sees the password in plaintext (bcrypt hashing
   happens client-side before the request, or server-side — the bcrypt hash is what
   is persisted).

6. **Recovery key shown once.** The 32-hex recovery key is displayed in a modal. It
   is never sent to the server and never stored. If you lose it, the recovery wrap
   path is permanently unavailable and password-reset can only wipe your library.

### Encrypting a saved sample

When you click "save" on an analysis:

1. The browser retrieves the live DEK from the `window.SpyglassSession` closure (it
   was unwrapped from `dek_wrapped` at login time using your password-derived KEK).
2. `encryptBlob(dekKey, bidReqJSON)` → `{ iv, ct }` (fresh 12-byte IV per blob).
3. Same for `bidResJSON`.
4. The browser POSTs `{ req_iv, bid_req_ct, res_iv, bid_res_ct, title, partner_id, status }`
   to `/api/samples`. The plaintext JSON never appears in the POST body.

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
```

The server cannot recover the DEK without the user's password or recovery key. A
full DB dump reveals only ciphertext and metadata.

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
path to decrypt the library. The "wipe" mode in the reset flow deletes the encrypted
samples and creates a fresh crypto state — your data is gone but your account
(email, metadata) can continue.

Source: `public/spyglass-crypto.js`, `openWithRecoveryKey()`;
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
level in production is `'info'`. At `info` level, Spyglass logs request routing
events, session lifecycle, and error stack traces. **It does not log request bodies
at any level — there is no debug/trace handler that dumps the `bidReq`/`bidRes`
payload.** The analyze handler at `modules/analyze/handler.js` logs only parse errors
and rate-limit events, not the payload content.

Test mode runs with `LOG_LEVEL=silent` (see `package.json` `npm test` script).

---

## Threat model

### What Spyglass protects against

**Server-side data breach (full DB dump).** An attacker who reads the SQLite database
file sees bcrypt hashes, ciphertext blobs, and metadata. Without the user's password
or recovery key, the ciphertext cannot be decrypted. The wrapped DEK and IVs in the
`users` table are cryptographically inert without the KEK, which is never stored.

**Operator curiosity.** The server operator (the person running the container) has
read access to the database file. They see the same thing an attacker with a DB dump
would see: ciphertext. They cannot read `bid_req` / `bid_res` payloads without the
user's password.

**Password reuse from a different breach.** Because PBKDF2 uses a per-user random
salt stored separately from the wrapped DEK, a leaked plaintext password from a
different service cannot be used to brute-force the DEK without also obtaining the
`kdf_salt` from this database. The 600,000-iteration cost makes offline brute-force
expensive even then.

### What Spyglass does NOT protect against

**Compromised user device.** If a browser extension or malware on your machine has
access to the browser's memory or can intercept keystrokes, it can extract the
plaintext password or the live DEK. No server-side architecture can protect against
a compromised client.

**Active attacker with persistent server access (code injection).** A determined
attacker who can modify the JavaScript files served by Spyglass could replace
`spyglass-crypto.js` to exfiltrate the password at the next login. This is not a
weakness specific to Spyglass — it applies to any web-delivered encryption. The
mitigation is source integrity: the source code is public at
`github.com/vladikkrasulya/adtech-spyglass`, and a hash-verified deployment process
would close this gap.

**Your bid stream through ad networks.** Spyglass inspects a _copy_ of the payload
you paste. The original bid transaction still passed through the SSP, DSP, and any
intermediaries. Spyglass protects the copy you saved; it has no effect on what the ad
networks logged.

**Plaintext metadata (title, status, timestamps).** As noted above, `title` and
`status` are stored in plaintext. Do not put sensitive deal IDs or partner
identifiers in the title field if that would be a concern.

---

## What an auditor can verify

The following proof points are available without access to the production server:

1. **Source code.** The repository is public at
   `https://github.com/vladikkrasulya/adtech-spyglass`. The crypto module is at
   `public/spyglass-crypto.js`. The KEK derivation parameters (`PBKDF2_ITERATIONS`,
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
https://spyglass.kyivtech.com.ua/api/auth/me` — the response includes
   `kdf_salt`, `dek_wrapped`, `dek_iv` (ciphertext blobs) and no password field.

4. **Samples endpoint.** `GET /api/samples` returns the list of saved samples for
   the logged-in user. Each row includes `bid_req` and `bid_res` as base64 blobs
   (ciphertext), not plaintext JSON. You can confirm this by saving a sample and
   inspecting the API response in the browser's network tab.

5. **No server-side decryption code.** Search the repository for `decryptBlob`,
   `unwrapBytes`, `openWithPassword` — these functions exist only in
   `public/spyglass-crypto.js` (browser) and `tests/crypto.test.js`. They are
   absent from `server.js`, `db.js`, and all `modules/` handlers.

6. **Analyze handler.** `modules/analyze/handler.js` processes the payload and
   returns findings. There is no `db.Samples.create(...)` or equivalent write call
   in this handler. The analyze path and the sample-save path are separate code
   routes initiated by separate user actions.

---

## Reporting a security issue

See `SECURITY.md` in the repo root. Email `hi@kyivtech.com.ua`. Do not open a
public issue before the maintainer has had a chance to ship a fix.

A finding that breaks the "server cannot decrypt saved samples" claim is treated as
high severity and triaged immediately.

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
