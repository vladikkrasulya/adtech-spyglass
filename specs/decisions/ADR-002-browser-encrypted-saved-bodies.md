# ADR-002: Browser-Encrypted Saved-Bid Bodies

**Status**: Accepted
**Date**: 2026-04-30

## Context

Authenticated users can save requests and responses for later use. Those bodies can carry sensitive
auction data, while the library still needs server-readable fields for listing, filtering, account
recovery, and operations. Browser-delivered encryption also has limits: the server authenticates the
password over TLS, serves the JavaScript, and accepts direct API clients that do not necessarily
follow the official web flow.

## Decision

The official browser save flow encrypts `bid_req` and `bid_res` with AES-GCM before calling the
sample API. A per-user data-encryption key is wrapped by a password-derived key and separately by the
one-time recovery-key path; the unwrapped data key remains in browser session memory.

The encryption claim is intentionally limited:

- sample titles, status, notes, partner references, timestamps, account data, partner profiles,
  dialect mappings, activity metadata, and explicitly saved Behavior Corpus rows remain
  server-readable;
- the API stores the submitted strings and IVs but does not prove that an arbitrary client supplied
  ciphertext;
- `is_encrypted` indicates IV presence, not cryptographic validation;
- transient `/api/analyze` processing is a separate server-visible boundary described in ADR-001.

## Alternatives Considered

- Encrypt only at rest with a server-held key. Rejected because an operator or database compromise
  with that key could recover every saved body.
- Encrypt every metadata field. Rejected because the current server-side library, filtering, and
  account workflows depend on readable metadata and no searchable-encryption design exists.
- Enforce ciphertext semantics in the current API. Rejected because legacy/direct clients and the
  existing storage shape do not provide a trustworthy proof that a string is encrypted.
- Claim zero knowledge for every product flow. Rejected because hosted analysis, authentication,
  metadata, and web-delivered JavaScript have different trust boundaries.

## Consequences

- A database dump does not reveal bodies saved by the uncompromised official web flow without the
  user's password or recovery key.
- Losing both recovery paths makes those encrypted bodies unrecoverable; the supported terminal path
  is an explicit account-data wipe.
- A malicious server able to replace the delivered JavaScript can compromise future browser input;
  immutable deployment reduces accidental drift but is not a defense against a persistent host
  attacker.
- User-facing claims and tests must preserve the distinction between encrypted bodies, plaintext
  metadata, transient analysis, and direct API behavior.

## Related Artifacts

- [Data-retention contract](../000-platform-baseline/contracts/data-retention.md)
- [Privacy contract](../../docs/PRIVACY.md)
- [Security policy](../../SECURITY.md)
- [Browser cryptography](../../public/ortbtools-crypto.js)
- [Save-sample flow](../../public/modules/save-sample/index.js)
