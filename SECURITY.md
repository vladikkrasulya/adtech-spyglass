# Security policy

## Reporting a vulnerability

Email **hi@kyivtech.com.ua** with the details. If you want to encrypt the
report, request my PGP key in a first short message and I'll send it.

Please do **not** open a public issue for security-relevant findings until
the maintainer has had a chance to ship a fix.

## What's in scope

- Anything in this repo: server, validator, auth, tokens, crypto, UI, build.
- Any vulnerability that affects the live deploy at
  <https://ortbtools.com/>.

## What's out of scope

- Third-party services (Cloudflare Tunnel, Resend, Telegram, IAB GitHub).
- Issues caused by users running modified forks with their own
  configuration.
- Theoretical attacks on bcrypt / PBKDF2 / AES-GCM / Web Crypto themselves
  (those are kernel concerns, not ortbtools concerns).

## What I commit to

- Acknowledge receipt within 72 hours.
- A fix or a clear explanation of why it's not a vulnerability within 14 days
  for high-severity issues.
- Public credit (if you want it) once the fix ships.

## Zero-knowledge crypto threat model

The current ortbtools web save flow encrypts saved request/response bodies in the
browser with a key derived from the user's password (PBKDF2-SHA-256, 600 000
iterations). The server stores AES-GCM ciphertext + a wrapped DEK + IVs. The samples
API/schema does not enforce or cryptographically verify ciphertext for direct clients.

**The server cannot decrypt**:

- `bid_req` / `bid_res` bodies encrypted by the current web UI

**The server can see**:

- email + bcrypt hash
- Sample title, partner-id reference, status, notes, and created-at timestamp
- Whether the user has a saved sample for a given partner
- Partner names, slugs, notes, and custom-dialect mappings
- Explicitly saved Behavior Corpus probe events, labels, and notes
- KDF salt + wrapped DEK + IVs (useless to an attacker without the password)

A finding that lets the server decrypt a body encrypted by the current web flow is
treated as high severity and triaged immediately. The full retention boundary and
direct-API caveat are documented in [`docs/PRIVACY.md`](./docs/PRIVACY.md).
