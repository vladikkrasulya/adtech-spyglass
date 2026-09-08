# Verification: 029 Preview carrier identity

**Date**: 2026-09-08 | **Feature**: [029](./spec.md) | **Status**: Complete

## What was measured, and how

### DEF-245 — the redirect note was present but unmeasurable

The note's `textContent` already held the destination. Its own client rectangle measured
`{ width: 0, height: 1363.75 }`. The zero width came from `--bid-w: 1` — the `1x1` placeholder
banner the pop request declares — published by `setDims` on `#creativePreviewSafe` before the
redirect branch appends the note, and applied to the whole box by
`.preview-safe[data-has-creative='1']`. The collapse cascaded through `.preview-container` and
`.preview-text`. The corpus harness's `visible()` requires a non-zero width, so the identity marker
resolved to the empty string — the same thing a person would have seen.

Branching `setDims(300, 250)` on that path — the fallback the VAST, JSON, URL and unidentified
inert-text branches already use — restores the box. The frame keeps its own zero-footprint inline
style, so nothing about the sandbox changed.

### DEF-180 — the preview claim predicate, measured before it was written

`packages/core/dialects/inpage-push.js` claims a bid when `bid.ext` carries a title-shaped or
image-shaped field. Before any code changed, that predicate was run across every case in the corpus
against every bid with no `adm` and no Native object: it reached **5 bids in 257 files**, and all
five were already expected to render a push card. The measurement is now a standing test
(`tests/creative-resolution.test.js`), so a future widening of the predicate fails loudly instead of
silently claiming an unrelated bid.

## Results

| Check                                                                | Result                                  |
| -------------------------------------------------------------------- | --------------------------------------- |
| `tests/creative-resolution.test.js`                                  | 39 pass / 0 fail (7 new)                |
| `tests/creative-preview-classify.test.js`, `tests/spec-refs.test.js` | 54 pass / 0 fail                        |
| `tests/corpus-core.test.js` + `tests/corpus-http.test.js`            | 514 pass / 0 fail / 3 skip              |
| `tests/corpus-lib.test.js`                                           | 14 pass / 0 fail                        |
| `tests/spec-kit-contract.test.js`                                    | 10 pass / 0 fail                        |
| Browser layer, the 10 affected cases                                 | 10 pass / 0 fail, Chrome 151.0.7922.137 |
| `npx eslint`, `npx tsc --noEmit`, `npx prettier --check`             | clean                                   |
| Full repository gate through the pre-push hook                       | recorded in the delivery evidence       |

The browser run covers the four DEF-245 pop cases, the five In-Page Push carrier cases and the
adm-bearing control `inpage-x-widget-adm-and-ext`. The corpus guard asserts a recorded deviation in
both directions, so those five carrier cases passing while still holding a `knownGap` is itself the
proof that exactly one deviation remains on them — the format tag — and that the preview and
identity deviations are gone.

### The coverage cell the correction vacated

Before this feature, the only corpus cases occupying `inpage x preview kind = empty` and
`inpage x rendered state = empty` were the four In-Page Push carrier cases whose expectations were
wrong. Correcting them emptied both cells, and the axes gate caught it during the pre-push run —
which is exactly what that gate exists for. The cell is restored with a case, not a
reclassification: `cover-preview-inpage-no-bid`, the in-page member of the per-format no-bid preview
family that already exists for audio, native, push and video. It passes at all three layers with no
recorded gap. The corpus is 257 cases.

For an In-Page Push placement this is the only honest route to an empty preview: the dialect claims
any bid whose `ext` carries a title-shaped or image-shaped field, and the preview now renders
exactly what the dialect claims — so an in-page response shows nothing only when it carries no bid.

## Ledger effect

| Record  | Before                                      | After                                                                   |
| ------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| DEF-245 | 4 cases, all three layers                   | Retired; `tests/corpus/known-gaps/pop-ext.json` holds no records        |
| DEF-180 | 6 cases; format tagging **and** ext preview | Preview half closed; the record keeps its Core format-tagging half only |

## Deployment

None. Production remains on `1.19.4`; shipping this feature is a separate decision for the owner.
