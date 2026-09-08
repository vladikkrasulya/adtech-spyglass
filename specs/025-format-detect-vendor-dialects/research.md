# Research: Format Detection and Feed Dispatch Alignment

The four defects were recorded expected-failure markers on the committed engine at base `340ffd3`.
The alias asymmetry and the array-dispatch shortcut are the shared root cause.

## The alias tables were out of sync

Three key-role tables and the Inspector's material finder each decided independently which physical
key names spell the same logical field:

| Key role | `format-detect.js` (before)                      | `detect.js` (before)             | `rules-feed.js` `validatePushMaterial` (before)               | Inspector `isMat` (before)       |
| -------- | ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| click    | clickurl, clickUrl, click_url, redirectUrl, link | click_url, link                  | click_url, link                                               | click_url, link                  |
| image    | image, icon                                      | image, icon, image_url, icon_url | image, image_url (and icon/icon_url/nurl for the notice slot) | image, image_url, icon, icon_url |

- **DEF-160**: `format-detect.js`'s `detectFeedFormat` image predicate was `'image' in o || 'icon' in
o`, missing `image_url`/`icon_url`. A Kadam material validated cleanly under those aliases
  (`validatePushMaterial` accepts them) but failed the three-way `hasClick && hasImage && hasTitle`
  test, so `detectFormat` returned no tag.
- **DEF-181**: `format-detect.js`'s click predicate already included `clickurl`, but `detect.js`'s
  `looksLikeJsonFeedSingle`, `rules-feed.js`'s `validatePushMaterial` click check, and the
  Inspector's `findPushMaterial.isMat` used only `click_url`/`link`. The product's own committed
  in-page card sample (`packages/core/knowledge_base/jsonfeed/inpage/inpage-card.json`) uses
  `clickurl`, so a single card was `payload.unknown_type` and an array card drew a false
  `feed.push.click_url_required`, and neither previewed.

## The array path skipped shape discrimination

`validateFeedResponse` dispatches a single object through `detectSingleBidShape` (bidprice /
valuefeed / bidredirect / push), but a bare array went straight to `validatePushMaterialsFeed`, which
runs every element through `validatePushMaterial`.

- **DEF-161**: a RichAds element `{title, description, image, notification_url, link, bid_price}` has
  no `id`, no `cpc`/`price`, and no `nurl`, so the push-material contract emitted
  `feed.push.id_required`, `feed.push.bid_required` and `feed.push.nurl_recommended` — three false
  errors about fields the bid-price shape never carries. Unwrapped, the same object dispatches to
  `bidprice` via `notification_url`/`bid_price`.

## Native identity lived only on `mtype`

`format-detect.js`'s BidResponse path tagged `native` from `MTYPE_TO_FORMAT[bid.mtype]` only.

- **DEF-460**: a Native 1.x `adm` body (`{"native":{"assets":[…]}}`) without the optional 2.6
  `mtype` previewed correctly (the Inspector's `creative-classify.js` parses the `adm`) but carried
  no format tag from Core, HTTP or the browser measurement.

## Derived rules

1. Add `image_url`/`icon_url` to `detectFeedFormat`'s image predicate (DEF-160).
2. Add `clickurl` to `detect.js`'s classifier, `rules-feed.js`'s push-material click check, and the
   Inspector's `isMat`/card-link resolution (DEF-181).
3. In `validatePushMaterialsFeed`, divert an element whose shape is `bidprice` to a shared bid-price
   contract with array-indexed paths, leaving generic materials on the push-material path (DEF-161).
4. Sniff a Native 1.x `adm` body in the response path and tag `native` only when `mtype` is absent
   (DEF-460).

## Coupling to DEF-107 (measured, re-pinned)

Rule 1 (image alias) also fires for the still-open DEF-107 Kadam cases, whose response is a Kadam
material carrying `image_url`/`icon_url`. Measured directly on the changed engine:

- `inpage-kadam-icon-notice` and `inpage-kadam-separate-notice-alias`: the response now tags `push`
  (it lacks the `ext.widget_id`/`zone_id`/`format` signal that would make it `inpage`), so their
  recorded `format.formats … got []` becomes `got [push]`.
- `push-kadam-icon-notice`: its expected format is `push`, now produced correctly, so its format
  deviation disappears entirely.

These three DEF-107 records are re-pinned to their residual `request.url.no_decoder` deviation (the
decoder itself remains unbuilt and DEF-107 stays open); the normative expectations are unchanged.
