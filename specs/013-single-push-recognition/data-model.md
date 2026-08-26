# Phase 1 Data Model: Single-Object Push Response Recognition

No storage is involved; the "data model" is the wire vocabulary the engine recognizes and the
verdicts it derives. Everything below is stateless input → output.

## Entity: Push material

One advertised item. Appears as a standalone object (new) or as an element of the materials
array (existing).

| Logical field       | Accepted keys              | Value shape       | Check level                                                    |
| ------------------- | -------------------------- | ----------------- | -------------------------------------------------------------- |
| Material identifier | `id`, `tId`                | string            | ERROR when absent                                              |
| Click destination   | `click_url`, `link`        | string (URL)      | ERROR when absent                                              |
| Price               | `cpc`, `price`             | number            | ERROR absent; WARNING numeric string; ERROR unparseable string |
| Headline            | `title`                    | string            | WARNING when absent                                            |
| Large image         | `image_url`, `image`       | string (URL)      | WARNING when absent                                            |
| Icon / win-notify   | `icon_url`, `icon`, `nurl` | string (URL)      | WARNING when all absent                                        |
| Body text           | `description`              | string            | not checked (creative key for detection only)                  |
| Freshness           | `linkTtl`                  | number (epoch ms) | recognized, no semantics (FR-008)                              |
| Creative identity   | `crid`, `cid`              | string            | not checked                                                    |

Alias rule: presence under any accepted key satisfies the presence check; the type check
applies to whichever accepted key is present (canonical first when both are).

## Detection signature (single object)

Claimed as a push-materials feed response when ALL three groups are present (key presence,
values not inspected):

1. **Price key**: `cpc` or `price`
2. **Click key**: `click_url` or `link`
3. **Creative key**: any of `title`, `description`, `image`, `image_url`, `icon`, `icon_url`

## Precedence (unchanged order, new branch last)

| Order | Shape                                                                               | Verdict                                    |
| ----- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| 1     | string input                                                                        | URL Request / unknown                      |
| 2     | array                                                                               | Vendor Feed (materials list)               |
| 3     | 3.0 envelope (`openrtb`, `item[]`)                                                  | oRTB Request/Response                      |
| 4     | `imp[]`                                                                             | oRTB BidRequest                            |
| 5     | `seatbid[]`                                                                         | oRTB BidResponse                           |
| 6     | `result.{listing,link,status:NOBID}` wrapper                                        | Vendor Feed (clickunder/link-feed)         |
| 7     | `version` + `items`                                                                 | JSON Feed 1.1                              |
| 8     | unique single-bid keys (`clickUrl`, `notification_url`, `bid_price`, `redirecturl`) | Vendor Feed (value/bid-price/bid-redirect) |
| 9     | **push-material signature (new)**                                                   | **Vendor Feed (push single)**              |
| 10    | `site`/`app`/`device` heuristic                                                     | oRTB BidRequest                            |
| 11    | `id` + `cur`/`bidid`/`nbr` heuristic                                                | oRTB BidResponse                           |
| 12    | anything else                                                                       | unknown → `payload.unknown_type`           |

Rows 8 and 9 both yield `VENDOR_FEED`; the format discrimination inside `rules-feed.js`
(`detectSingleBidShape()`) keeps the same order — unique-key vendors first, push last.

## Verdict surface

| Output             | Array form (existing)          | Single form (new)                       |
| ------------------ | ------------------------------ | --------------------------------------- |
| Result type string | `Push-Materials Feed Response` | `Push-Materials Feed Response (single)` |
| Finding IDs        | `feed.push.*` (unchanged set)  | same IDs, `num` = 1                     |
| Finding paths      | `[i].field`                    | `field` (root-relative)                 |
| Format tags        | `push` per qualifying item     | `push` when the object qualifies        |
