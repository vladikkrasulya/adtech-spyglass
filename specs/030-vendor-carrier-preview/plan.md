# Implementation Plan: Preview Identity for Vendor and AdCOM Carriers

**Feature**: [030](./spec.md) | **Date**: 2026-09-09 | **Status**: Complete

## Summary

Four documented creative carriers the preview could not read, one file. `public/ortbtools.app.js`
gains an envelope unwrapper, an AdCOM Native mapper, two vendor-material resolvers and one identity
seam. `packages/core/` is untouched; the corpus records the new ground truth and the 020 ledger
reaches zero.

## Technical Context

**Language**: JavaScript (ES modules, browser) — `public/ortbtools.app.js`
**Testing**: `tests/creative-resolution.test.js` (the pure resolvers, extracted from the real source
and run against the real fixtures), `tests/corpus-{core,http,browser}.test.js`
**Constraints**: the sealed preview contract of [012](../012-creative-preview-repair/spec.md) and the
push qualification gate of [025](../025-format-detect-vendor-dialects/spec.md)/DEF-203
**Scale**: 257 corpus cases; 10 of them assert the four behaviours this feature changes

## Constitution Check

- **I — Spec Kit is the working memory**: this package is authored alongside the change, and the
  one expectation correction it makes is carried by its own decision record
  ([ADR-017](../decisions/ADR-017-format-tags-follow-the-wire.md)) rather than buried in a fixture.
- **II — Evidence before assertion**: every field name accepted here was read out of the fixture
  provenance of the case that needs it, and each new predicate was measured across all 257 corpus
  cases before the code changed. The four predicates reach 5, 2, 1 and 2 cases respectively — the
  exact sets the four ledger records name, and nothing else.
- **III — The sealed preview**: unchanged. Every carrier enters through an existing branch — the
  native card, the markup frame, or the inert-text block — with the same content policy, the same
  sandbox flags and the same refusal ledger. The vendor banner's remote artwork is blocked exactly
  as a banner's is, which is why its expected render is `empty` and not a picture.
- **IV — One owner per concern**: the AdCOM mapper feeds `renderNativeToHtml` rather than adding a
  second native renderer; the vendor resolvers sit behind the push gate rather than inside it; the
  identity text travels beside the creative body rather than in it, so the classifier, the behaviour
  engine and the static scanner all still read the exact bytes the response carried.

## Design decisions

### Why the identity text is a separate argument and not part of the creative

A PPCmate pop material is `{title, description, link, cpc}`. Its creative resolves to the bare
`link`, which `classify()` names `url` and the preview shows as inert text. Folding the title into
that string would rename the kind to `unidentified` and change what the behaviour engine scores —
the classification is computed from the creative bytes, and those bytes must stay the material's
own. The title therefore travels as its own value through `setAdPreview`, and the inert-text branch
prints it above the destination in the same block, because one block is what a reader and the
identity measurement both look at.

### Why AdCOM is mapped rather than rendered separately

AdCOM's Native object differs from oRTB Native 1.x in exactly two names — `asset` for the list and
`image` for the picture object — and in nothing the renderer reads. A second renderer would be two
copies of one layout, and the copies would drift. The mapper is nine lines and the render path is
then byte-identical to the 2.x one, including how the corpus harness recognises the card.

### Why the vendor gates require all their roles

Each vendor resolver demands every role its documented shape carries: a Native material needs a
headline, a picture, a link and a price; a banner wrapper needs a price, a click and a picture and
must carry no notification text. A looser gate would eventually put a synthesised card in front of
an analyst for a shape no vendor ever documented, which is the failure DEF-203 already recorded
once. The corpus-wide measurement is kept as a standing test so a future loosening fails loudly.

## Project Structure

```
public/ortbtools.app.js       # envelope unwrap, AdCOM mapper, two vendor resolvers, identity seam
tests/creative-resolution.test.js  # unit coverage and the corpus-wide reach measurement
tests/corpus/pairs/…          # ten cases: retired signatures, corrected expectations
tests/corpus/known-gaps*      # the last four records retired
specs/030-vendor-carrier-preview/  # this package
specs/decisions/ADR-017-format-tags-follow-the-wire.md
```

## Complexity Tracking

No constitutional deviation is claimed.
