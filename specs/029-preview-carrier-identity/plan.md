# Implementation Plan: Preview Identity for Redirect Pops and In-Page Push Carriers

**Feature**: [029 Preview carrier identity](./spec.md) | **Date**: 2026-09-08 | **Status**: Complete

## Summary

Two independent preview defects, one file. `public/ortbtools.app.js` gains a size fallback on the
redirect-script branch so the inert destination note is readable, and a nested-carrier resolver so an
In-Page Push bid renders the card its own dialect already validates. Nothing in `packages/core/`
changes; the corpus records the new ground truth.

## Technical Context

**Language**: JavaScript (ES modules, browser) — `public/ortbtools.app.js`
**Testing**: `tests/corpus-browser.test.js` (real Chrome, one file at a time), `tests/corpus-core.test.js`,
`tests/corpus-http.test.js`, `tests/creative-resolution.test.js`, `tests/creative-preview-classify.test.js`
**Constraints**: the sealed preview contract of [012](../012-creative-preview-repair/spec.md) — frame
CSP, sandbox flags and the refusal ledger are unchanged by this feature
**Scale**: 257 corpus cases; 9 of them assert the two behaviours this feature changes

## Constitution Check

- **I — Spec Kit is the working memory**: this package is authored before the change lands, unlike
  [027](../027-inspector-ui-repair/plan.md), whose retroactive package records the same session's
  process failure. The corrective is applied here rather than only described there.
- **II — Evidence before assertion**: both defects were measured, not inferred. DEF-245 was located
  by reading the computed geometry of `.preview-text-body` (`width: 0`, non-zero height) with the
  note's `textContent` already correct — a layout collapse, not a missing string. The In-Page Push
  carrier's blast radius was measured across all 257 corpus cases before any code changed: exactly
  five bids in the whole corpus satisfy the dialect's claim predicate, and all five already expect a
  push card.
- **III — The sealed preview**: unchanged. The redirect branch keeps the frame's own zero-footprint
  inline style, so the frame still renders nothing and still refuses the popup; only the box holding
  the inert note beside it gains a readable size. The push card travels the existing markup pipeline
  exactly as the flat-feed card already does — same CSP, same refusal ledger, same "Load N image(s)"
  action for the remote assets.
- **IV — One owner per concern**: the alias table is mirrored from the dialect module rather than
  invented here, and the flat-feed qualification gate is left alone. `packages/core/` is untouched,
  so this package cannot collide with the peer-owned Core half of DEF-180.

## Design decisions

### DEF-245 — why a size fallback and not a style override

`setDims(w, h)` publishes `--bid-w` / `--bid-h` on `#creativePreviewSafe`, and
`.preview-safe[data-has-creative='1']` sizes the whole box from them — not just the frame. A `1x1`
placeholder banner, which is what a pop request declares, therefore collapses the box, and the
collapse cascades to `.preview-container` and `.preview-text`. The note's text was already correct;
its ancestor had no width, so the harness's `visible()` check (`width > 0 && height > 0`) could not
see it and neither could a person.

The fallback chosen is the same `300x250` the VAST, JSON, URL and unidentified inert-text branches
already use — it exists purely to give inert text room. Overriding the collapsed box in CSS instead
would fix the symptom for this one branch while leaving the same trap for the next inert-text kind.

### DEF-180 — why a normalised carrier and not a wider gate

The flat-feed gate `isPushMaterialShape` demands price, click, a visual asset and notification
identity as sibling keys on one object. The In-Page Push carrier cannot satisfy it by construction:
the price is on the Bid, the creative is one level down in `ext`. Loosening the gate to reach across
that boundary would also re-admit exactly what [025](../025-format-detect-vendor-dialects/spec.md)
and DEF-203 excluded — vendor banner wrappers and pop placements dressed as notification cards.

The two alias tables also genuinely disagree: `text` is a **title** alias in the dialect and a
**description** alias in the flat-feed renderer (Kadam materials). Handing `bid.ext` to the renderer
raw would print the headline into the body slot. The carrier is therefore normalised into the
renderer's canonical field names, using the dialect's table, on its own code path.

## Project Structure

```
public/ortbtools.app.js      # size fallback on the redirect branch; nested-carrier resolver
tests/corpus/pairs/pop/      # four DEF-245 cases: gap records removed
tests/corpus/pairs/inpage/   # four In-Page Push cases: expectations and signatures corrected
tests/corpus/pairs/coverage-vendor/  # the fifth carrier case
tests/corpus/known-gaps/     # pop-ext.json record removed; inpage-ext.json narrowed
specs/029-preview-carrier-identity/  # this package
```

## Complexity Tracking

No constitutional deviation is claimed. The feature adds one branch and one resolver to a file that
already owns creative resolution, and removes more corpus ledger prose than it adds code.
