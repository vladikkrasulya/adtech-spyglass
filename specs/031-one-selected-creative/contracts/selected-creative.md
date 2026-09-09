# Contract: the selected creative

**Owner**: `public/ortbtools.app.js`
**Status**: Active as of 2026-09-09

A response may carry several creatives. Exactly one is on screen at a time, and everything the panel
says about it — its markup, its destination, its price, its identifiers — must describe that one.

## The single definition

`resolveCreativeAt(req, res, seatIndex, bidIndex)` is the only answer to "what is the creative at
this index". The first render, the per-material selector and the price chip all call it. Nothing may
resolve a creative any other way.

`creativeCandidatesFor(res)` enumerates the addressable creatives of a response. The two must agree:
**every candidate it enumerates, the resolver resolves, and every shape the resolver accepts, it
enumerates.** The index space covers:

| Response shape                      | Candidates                              |
| ----------------------------------- | --------------------------------------- |
| oRTB 2.x `seatbid[]`                | one per `(seatIndex, bidIndex)`         |
| oRTB 3.0 `openrtb.response.seatbid` | the same, through the envelope          |
| a bare materials array              | one per element, `seatIndex` always `0` |
| `res.ads[]`                         | the same                                |
| `res.bid` (the EXADS wrapper)       | exactly one, at `(0, 0)`                |
| a bare single-object feed           | exactly one, at `(0, 0)`                |

## The rules

1. **The first render resolves the first enumerated candidate.** Not `(0, 0)` — a response whose
   first seat carries no bids has no candidate there, and rendering `(0, 0)` for it meant showing one
   seat's creative labelled with another seat's absent bid.
2. **The selector marks the candidate that was rendered.** Same pair of indices, same call.
3. **Nothing searches the whole response for a preferred kind.** Scanning a materials array for the
   first push-shaped element is how the panel came to render material[1] while marking material[0]
   selected. The index decides; the shape does not.
4. **The envelope is unwrapped on both sides before anything is read from it.** An OpenRTB 3.0
   payload nests its request and response one level down, and the currency, the auction id and the
   response bid id all live there.
5. **Identifiers use the field names the engine's own 3.0 projection uses** — `bid.item` where 2.x
   says `bid.impid`, and so on. Where 3.0 defines no equivalent, as for `bid.adid`, the value stays
   empty. A plausible substitute would be a guess presented as a reading.
6. **The price comes from the resolved candidate**, under any price alias the product documents, in
   the currency that candidate names. The two non-answers stay distinguishable: `BID` means a
   creative that named no price; the formatted zero means there is no creative. A real price of zero
   is a price and formats as one.

## What this contract does not cover

The creative body's classification and rendering, which belong to
[012](../../012-creative-preview-repair/contracts/creative-preview.md) and
[030](../../030-vendor-carrier-preview/contracts/vendor-carrier-preview.md). This contract is only
about **which** creative those act on.
