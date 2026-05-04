# Security policy

## Reporting a vulnerability

Email **hi@kyivtech.com.ua** with the details. If you want to encrypt the
report, request my PGP key in a first short message and I'll send it.

Please do **not** open a public issue for security-relevant findings until
the maintainer has had a chance to ship a fix.

## What's in scope

- Anything in this repo: server, validator, auth, tokens, crypto, UI, build.
- Any vulnerability that affects the live deploy at
  <https://spyglass.kyivtech.com.ua/>.

## What's out of scope

- Third-party services (Cloudflare Tunnel, Resend, Telegram, IAB GitHub).
- Issues caused by users running modified forks with their own
  configuration.
- Theoretical attacks on bcrypt / PBKDF2 / AES-GCM / Web Crypto themselves
  (those are kernel concerns, not Spyglass concerns).

## What I commit to

- Acknowledge receipt within 72 hours.
- A fix or a clear explanation of why it's not a vulnerability within 14 days
  for high-severity issues.
- Public credit (if you want it) once the fix ships.

## Zero-knowledge crypto threat model

Spyglass encrypts saved samples in the browser with a key derived from the
user's password (PBKDF2-SHA-256, 600 000 iterations). The server stores
opaque AES-GCM ciphertext + a wrapped DEK + IVs.

**The server cannot decrypt**:

- Sample `bid_req` / `bid_res` payloads
- Sample notes / metadata
- Partner labels

**The server can see**:

- email + bcrypt hash
- Sample title, partner-id reference, status, created-at timestamp (these
  fields are plaintext for sorting/filtering)
- Whether the user has a saved sample for a given partner
- KDF salt + wrapped DEK + IVs (useless to an attacker without the password)

A finding that breaks any "server cannot decrypt" claim above is treated as
high severity and triaged immediately.
