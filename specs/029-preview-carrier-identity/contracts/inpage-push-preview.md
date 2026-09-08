# Contract: In-Page Push carrier preview

**Owner**: `public/ortbtools.app.js` (rendering) · `packages/core/dialects/inpage-push.js` (field contract)
**Status**: Active as of 2026-09-08

## Boundary

The In-Page Push format carries its creative in `bid.ext`, not in `bid.adm` and not in an OpenRTB
Native object. The engine owns the field contract: which names carry which role, which roles are
required, and whether a given bid is In-Page Push at all. The Inspector owns the render.

This contract fixes the seam between them.

## What the engine decides

`claimsBid(bid)` is true when `bid.ext` is an object carrying a non-empty title-shaped **or**
image-shaped field. When it is true, `rules-response.js` suppresses the IAB `payload_missing`
warning for that bid and the dialect's own field checks run instead.

The role alias table is:

| Role        | Accepted names                              |
| ----------- | ------------------------------------------- |
| title       | `title`, `text`                             |
| description | `description`, `body`, `desc`               |
| image       | `image`, `image_url`, `picture`             |
| icon        | `icon`, `favicon`                           |
| click       | `url`, `click`, `click_url`, `href`, `link` |
| cta         | `cta`, `button`, `button_text`              |

## What the preview must do

1. **Claim exactly what the engine claims.** The preview uses the same predicate. A bid the engine
   validates as In-Page Push must not render as the generic empty state, and a bid the engine does
   not claim must not be dressed as a card.
2. **Resolve roles through the table above, not through the flat-feed renderer's own aliases.**
   The two tables disagree on `text`, which is a title here and a description there. Resolution
   happens before rendering; the renderer receives canonical names.
3. **Carry only present roles.** A missing title renders the renderer's own placeholder and a
   missing click renders an inert target. Absent roles are the engine's findings to raise
   (`inpage-push.title_required`, `inpage-push.image_required`, `inpage-push.click_required`), never
   a reason for the preview to show nothing.
4. **Yield to a real creative.** `bid.adm` and a structured Native object both win; the carrier is
   consulted only when neither resolves.
5. **Leave the flat-material gate alone.** `isPushMaterialShape` continues to require price, click,
   a visual asset and notification identity as sibling keys of one object. The nested carrier is
   reached by its own path, so vendor banner and pop wrappers stay excluded (DEF-203).
6. **Change nothing about the frame.** The card enters the sealed preview as markup, exactly as the
   flat-feed card does: same CSP, same sandbox flags, same refusal ledger, same explicit action for
   remote assets. Remote hero and icon images stay blocked and the blocking stays explained.

## Not covered here

Format detection. Tagging an OpenRTB envelope that carries the widget/zone placement signal as
`inpage` is engine work and remains open in the 020 ledger under DEF-180.
