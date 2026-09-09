# Implementation Plan: One Selected Creative, One Reading of the Response

**Feature**: [031](./spec.md) | **Date**: 2026-09-09 | **Status**: Complete

## Summary

Creative resolution existed in two copies and the panel around it read the response a third way.
`resolveCreativeAt` becomes the single definition — completed to cover every response shape the
product accepts — and the analysis path, the selector and the price chip all answer to it. Four
defects fall out together. `packages/core/` is untouched.

## Technical Context

**Language**: JavaScript (ES modules, browser) — `public/ortbtools.app.js`, `public/i18n.js`
**Testing**: `tests/creative-resolution.test.js` (the pure resolvers, extracted from the real source
and run against real fixtures), `tests/inspector-reentrant.test.js` (static wiring),
`tests/corpus-{core,http,browser,ux-browser}.test.js`
**Constraints**: the sealed preview contract of [012](../012-creative-preview-repair/spec.md); the
push qualification gate of DEF-203; the corpus oracle's additive-expectation discipline
**Scale**: 258 corpus cases; the change moves the displayed price on 14 of them

## Constitution Check

- **I — Spec Kit is the working memory**: authored alongside the change. The one behaviour this
  feature changes beyond the reported defects — a price appearing where `$0.00` used to be — is
  written down as a requirement and pinned by corpus assertions, not left as a silent side effect.
- **II — Evidence before assertion**: both reported defects were reproduced in a real browser on
  payloads written for this feature before any code changed, and re-measured after. The consequence
  of unifying the two copies was measured across all 243 materialized responses **before** the
  unification: 229 agreed, 14 differed, and every one of the 14 was read and judged individually.
- **III — The sealed preview**: unchanged. No branch, policy, sandbox flag or refusal changes; the
  call-to-action label is one more inert string inside the same synthetic card.
- **IV — One owner per concern**: this is the whole feature. Creative resolution had two owners,
  the price chip had two, and the corpus reach guards had a third partial copy of the resolution
  ordering. All three are now single.

## Design decisions

### Why the resolver was completed rather than the analysis path delegating as it stood

Delegating naively would have regressed twelve cases. `resolveCreativeAt`'s materials branch reached
only an array or `res.ads`; the six `res.bid` vendor wrappers and six bare single-object feeds were
resolvable **only** through the analysis path's whole-response helpers. Measured, not assumed:
0 of 6 and 0 of 6 respectively resolved through the resolver before this change. Those shapes now
occupy index `(0,0)`, `creativeCandidatesFor` enumerates them, and the delegation is safe.

### Why the first render follows the first enumerated candidate rather than (0,0)

`(0,0)` is not always a candidate. A response whose first seat carries no bids enumerates exactly one
candidate at `(1,0)`; the old code rendered `findAdm(res)` — which walks the whole response and
crossed the seat boundary — while labelling it with `seatbid[0].bid[0]`, an object that does not
exist. The creative of one seat was shown with the metadata of another. Following the enumeration
closes that by construction rather than by a special case.

### Why the price moved into the resolver

The chip was written out twice and both copies read `bid.price` off a local that is `{}` for every
materials resolution, so a vendor material's own `cpc` was never displayed. One function now answers
"what does this candidate cost", and both callers ask it. Its fallbacks are ordered so that the two
honest non-answers stay distinguishable: `BID` means a creative that named no price, and `$0.00`
means no creative at all. A real price of zero formats as a price.

### Why `expect.preview.price` had to be added to the corpus

The harness has always measured the chip and never asserted it. That is precisely why a release
shipped showing euros as dollars: the case that reproduces it, `bn-banner-30-adcom`, was green the
whole time. The assertion is additive — only a case that declares a price is checked — and the
regression for the currency defect is that existing case with one line added, not a new fixture.

## Project Structure

```
public/ortbtools.app.js        # the single resolver, the single price, the exhaustive response guard
public/i18n.js                 # one message, three locales
tests/corpus/lib/schema.js     # expect.preview.price
tests/corpus/lib/oracle.js     # its assertion
tests/creative-resolution.test.js   # reach guards rebuilt on loadCorpus() and every material
tests/inspector-reentrant.test.js   # the wiring invariant, strengthened
tests/corpus-ux-browser.test.js     # the unreadable-2xx regression
tests/corpus/…                 # one new case, nine assertions added
specs/031-one-selected-creative/
```

## Complexity Tracking

No constitutional deviation is claimed. The feature deletes one helper, removes two duplicated
blocks, and leaves the file shorter than it found it.
