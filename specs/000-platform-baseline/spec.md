# Platform Baseline: ortbtools

**Kind**: Current as-built reference
**Observed**: 2026-08-11
**Status**: Current

This package describes the product and public behavior that exist now. It does not authorize a
change, carry future priorities, or replace the conventional privacy, security, operations, and HTTP
API documents. A feature that changes this baseline updates the affected contract in the same
change.

## Product Boundary

ortbtools is an OpenRTB inspection toolkit with three delivery surfaces:

1. a localized hosted web application at `ortbtools.com`;
2. the CommonJS `@ortbtools/core` workspace for deterministic, network-free validation logic; and
3. the `@ortbtools/cli` workspace, which wraps Core for local terminal and CI use.

The app currently reports version `1.12.1`, Core reports `0.35.0`, and CLI reports `0.1.1`. The
workspace packages are not currently published to npm; repository-local use and the publication
procedure are the only documented package paths.

## Current User Surfaces

| Surface               | Current behavior                                                                                                                                            | Access boundary                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Inspector             | Server-side OpenRTB, vendor-feed, URL-request, VAST, format, category, and request/response analysis; source navigation; export; sandboxed creative preview | Anonymous analysis; account optional               |
| Live                  | Demand-gated synthetic specimen stream with content-hash permalinks                                                                                         | Public                                             |
| Behavior              | Curated scenarios, in-iframe creative instrumentation, static/runtime behavior findings, and an optional labelled corpus                                    | Analysis public; corpus persistence authenticated  |
| Library               | Curated repository samples plus a user's saved samples and partner grouping                                                                                 | Curated samples public; user library authenticated |
| Dialects              | Built-in IAB/vendor overlays and account-scoped custom signal mappings                                                                                      | Built-ins public; saved dialects authenticated     |
| Blog                  | Editorial Markdown and ClickHouse-backed news posts, localized list/post reads, SSR, and RSS                                                                | Public reads; token-gated administration           |
| Docs                  | Product guidance and a generated finding catalog                                                                                                            | Public                                             |
| Insights              | Derived validation aggregates                                                                                                                               | Public aggregate and account-scoped views          |
| About and Account     | Localized product documentation and account management                                                                                                      | Public page; account actions session-gated         |
| Programmatic landings | Server-rendered localized OpenRTB, VAST, Native, and IAB-category landing content                                                                           | Public                                             |

The browser shell also provides persistent navigation, session state, modal hosting, search,
language switching, theme state, and action modules used by the route-level sections.

## Validation Scope

- OpenRTB 2.5 and 2.6 share broad BidRequest/BidResponse rules. Detection selects a version bucket,
  but the implementation is not exhaustive schema conformance and does not gate every 2.x field by
  minor revision.
- OpenRTB 3.0 has envelope and deep request/response coverage for core context, privacy, placement,
  media, creative, and embedded VAST structures. It is not exhaustive AdCOM conformance.
- Supported vendor-feed shapes and recognized URL-style request strings have dedicated decoders and
  rules. JSON Feed 1.1 is detected but explicitly returns `jsonfeed.not_validated` rather than a
  false clean verdict.
- Format detection is independent of type/version detection and covers standard media plus
  non-IAB push/pop families, runtime context, and VAST/DAAST protocol hints.
- Request/response crosscheck covers identifiers, floors/currency, exclusions, media compatibility,
  Native asset references, VAST shape, and an auction summary.
- Mirror and replay reuse the same validators. Mirror self-tests the generated counterpart through
  validation and crosscheck.
- Creative behavior analysis consumes bounded probe events plus optional markup. The preview iframe
  allows scripts but never `allow-same-origin`.

The stable output and compatibility rules are defined in
[the Core validator contract](./contracts/core-validator.md).

## Data and Privacy Boundary

Hosted Inspector payloads are sent over HTTPS to `/api/analyze` and processed in the Node process.
They are not persisted as payload bodies and are not forwarded to an external model. Derived
validation metrics and sampled operational request metadata may be retained. The browser separately
keeps a bounded raw analysis history in same-origin `localStorage`.

The official browser save path encrypts BidRequest and BidResponse bodies before upload. The server
stores ciphertext, wrapping material, and IVs, but it can read account and sample metadata. The API
does not prove or require that direct clients supplied ciphertext. Behavior events are transient
unless a signed-in user explicitly saves a corpus entry; saved corpus events are plaintext. Custom
dialect mappings are also plaintext.

The detailed code-facing boundary is [data retention](./contracts/data-retention.md). The user-facing
contract remains [docs/PRIVACY.md](../../docs/PRIVACY.md), and security reporting remains in
[SECURITY.md](../../SECURITY.md).

## Architecture Invariants

- The server is a single vanilla `node:http` composition root with a small ordered router and
  feature handler modules.
- SQLite is the account/library store. ClickHouse is optional analytics and blog/news
  infrastructure. Browser storage owns local history, UI preferences, session-scoped key material,
  and discovery observations.
- The frontend is native browser JavaScript and CSS without an application bundler. Route sections
  lazy-load through a registry and own cleanup through a mount-scoped `AbortSignal` and cleanup
  stack.
- Core's main data-to-data APIs make no network calls. Interactive intelligence uses deterministic
  server rules. The only external model path is isolated news translation/categorization after a
  deterministic relevance gate.
- Runtime source is immutable: application files and dependencies are baked into an exact-build
  image, and `/data` is the sole production mount.
- English, Ukrainian, and Russian are one product contract. English uses unprefixed canonical URLs;
  Ukrainian and Russian use `/uk` and `/ru`.

Component ownership and dependency direction are defined in [plan.md](./plan.md).

## Out of Scope for This Baseline

- Future product priorities, which belong in `specs/ROADMAP.md`.
- Historical architecture or completed roadmap narratives.
- Production inventory, user counts, payload examples, secrets, or incident records.
- A promise of official JSON Schema conformance, full AdCOM coverage, consent-string decoding, live
  exchange simulation, or a bidder SDK.
- Registry installation until npm publication is completed and independently verified.

## Acceptance of the Baseline

The baseline is current when all of the following remain true:

- each product surface has one owning implementation path;
- Core output remains deterministic and compatible at its documented boundary;
- the hosted-processing, browser-storage, and server-retention claims match code and tests;
- every route-level frontend section satisfies the registry cleanup contract;
- localized paths and user-facing meaning remain aligned across all three locales;
- the image contains application runtime assets but no project-governance or development-only files;
- repository CI, package smoke, and Docker smoke cover the changed surfaces without relying on live
  production data.

Run [the baseline quickstart](./quickstart.md) for the reproducible validation path.
