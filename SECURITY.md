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

## Blog content boundary

Every public Blog body is treated as untrusted at its final browser-rendering boundary, including
repository Markdown, persistent promoted Markdown, and ClickHouse/news content. Editorial Markdown
supports ordinary text structure, code, tables, inert task markers, and safe HTTP(S), relative, or
fragment links. Interpreted raw HTML, active attributes, embedded documents, forms, styles, media,
and image loading are not supported Blog-body capabilities; raw HTML and image alternative text
remain readable as inert text.

The browser uses exact reviewed Marked and DOMPurify assets, a closed element/attribute policy, and
`DocumentFragment` insertion. Rendering failures fall back to the original body via `textContent`
without logging or reporting that body. Content source or admin approval is never treated as proof
that markup is safe. The server-side/no-JavaScript renderer remains independently escape-first.

The full invariant, compatibility grammar, dependency provenance, and deliberately deferred
source-link/promotion-integrity scope are recorded in the
[Content/SEO contract](./specs/000-platform-baseline/contracts/content-seo.md) and
[ADR-011](./specs/decisions/ADR-011-browser-markdown-sanitization.md).

## Creative asset outbound boundary

`POST /api/creative/asset` is the authenticated, explicit-click path that can fetch a remote image
named by pasted creative markup. The browser never contacts the advertiser directly. Because the URL
is caller-controlled, the route treats it as an SSRF boundary before opening a socket:

- only HTTP(S) on the default HTTP/HTTPS ports is accepted;
- literal and DNS-returned addresses are canonicalized before classification, including every valid
  IPv4-mapped IPv6 spelling and WHATWG's hexadecimal form, so the embedded IPv4 address inherits the
  loopback, RFC1918, link-local, and CGNAT policy;
- every DNS answer must be public, and the request connects to the already-validated address while
  retaining the original host for HTTP `Host`, TLS SNI, and certificate validation;
- redirects are not followed; and
- only an explicit raster-image MIME allowlist is accepted (SVG is excluded), with response-size and
  timeout bounds.

Authentication and rate limiting constrain who can initiate the request, but they never replace the
network boundary above. A change to creative-asset URL parsing, address normalization/classification,
DNS resolution, connection targeting, redirects, response types, size, or timeout must update the
[HTTP/server contract](./specs/000-platform-baseline/contracts/http-api.md) and its asset-fetch and
traffic-class regression tests in the same change.
