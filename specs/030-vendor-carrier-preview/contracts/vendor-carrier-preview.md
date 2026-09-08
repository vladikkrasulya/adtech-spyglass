# Contract: which creative carriers the preview can read

**Owner**: `public/ortbtools.app.js`
**Status**: Active as of 2026-09-09

A response says it carries a creative in one of a small number of documented ways. This contract
lists every carrier the preview resolves, in the order it tries them, and the rule each one obeys.
Anything not on this list renders the empty state — deliberately, because a carrier the product
cannot name is a carrier it must not guess at.

## Resolution order

For an OpenRTB response, the envelope is unwrapped first: a 3.0 payload nests everything under
`openrtb.response`, and every later step reads the unwrapped object.

| #   | Carrier              | Where it lives                        | Renders as   |
| --- | -------------------- | ------------------------------------- | ------------ |
| 1   | oRTB Native 1.x      | `bid.native.assets[]`                 | native card  |
| 2   | AdCOM Native         | `bid.media.ad.display.native.asset[]` | native card  |
| 3   | Markup               | `bid.adm` / `bid.iurl`                | sealed frame |
| 4   | Flat push material   | a vendor wrapper or materials array   | push card    |
| 5   | In-Page Push carrier | `bid.ext.*`                           | push card    |
| 6   | Vendor Native        | a materials array or wrapper          | native card  |
| 7   | Vendor banner        | a materials array or wrapper          | sealed frame |
| 8   | Documented link      | a vendor wire wrapper                 | inert text   |

Carriers 4 and 5 are the subject of [014](../../014-push-creative-preview/spec.md) and
[029](../../029-preview-carrier-identity/contracts/inpage-push-preview.md). Carriers 2, 6, 7 and the
identity rule below are this feature's.

## AdCOM Native (carrier 2)

AdCOM's Native object differs from the oRTB Native 1.x response object in exactly two names — the
asset list is `asset` rather than `assets`, and an asset's picture is `image` rather than `img` — and
in nothing the renderer reads. It is therefore mapped onto the 1.x shape and rendered by the same
function. There is one native renderer in this file and there must stay one.

## Vendor Native material (carrier 6)

Claimed only when the material carries **all four** of a headline, a picture, a landing link (`url`)
and a price, and does **not** qualify as a push card. The absence of a push click alias is what makes
`url` a native landing link rather than a click-through, and that distinction is load-bearing: the
push gate refuses this shape on purpose (DEF-203), and widening the gate instead of adding this path
would misclassify it.

## Vendor banner wrapper (carrier 7)

Claimed only when the wrapper carries a price, a click and a picture and carries **no** notification
text at all. Notification text is precisely what separates a push card from a banner bid; a wrapper
that has it qualified as a push card at carrier 4 and never reaches here.

The synthesised markup is an anchor around an image and nothing else. It travels the sealed frame
like any banner adm: the remote picture is blocked by the same content policy, the block is counted
in the same refusal ledger, and the render is therefore `empty` rather than a picture until the
analyst asks for the assets.

## Material identity beside an inert destination

When a material's creative resolves to a bare destination (carrier 8) and the material carries a
title or a description, those are shown above the destination in the same inert block.

They travel to the preview as a value of their own and are **never** merged into the creative body.
The body is what `classify()` names, what the behaviour engine scores and what the static scanner
reads; folding vendor metadata into it would change all three and rename the kind. The rule is:
identity is displayed with the creative, never counted as the creative.

## What none of this changes

The frame policy, the sandbox flags, the refusal ledger and the explicit action for remote assets
are the same for every carrier here as for a banner's `adm`. No carrier fetches anything, and no
carrier is rendered by a second copy of a renderer that already exists.
