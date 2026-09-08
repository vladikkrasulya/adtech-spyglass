# Research: The Analyze Boundary Survives Malformed and Oversized Input

The four defects were reproduced against the committed engine before any code changed; each was an
expected-failure marker in the 020 corpus at base `82c0426`. The normative basis and the derived
rules are recorded here.

## Normative basis

- **OpenRTB 2.6** (pinned at `403cbba542de3a5d9cfcccd0a34e74b01b79a9f1`), §4.2.1 BidResponse: the
  response root is an object carrying `id` and either `seatbid[]` or `nbr`. A bare JSON scalar is
  neither the object the root requires nor any documented vendor feed shape, so it is invalid input,
  not an absent response.
- **OpenRTB 2.6** §4.2.2 SeatBid: `bid` is an array of one or more Bid objects. A non-array `bid`, a
  non-array `seatbid`, or a null bid is a structural error the validator already reports; nothing in
  the spec makes it a reason to abandon category decoding or to crash the client.
- **HTTP API contract** ([docs/api-v1.md](../../docs/api-v1.md)): `POST /api/analyze` returns a 200
  success envelope with structured findings for analyzable input, and `400 payload_too_large` for a
  body above the 2 MiB parser limit. A connection reset is not one of the documented outcomes.

## Reproductions on the committed engine

- **DEF-115**: `packages/core/categories.js` walked `imp`, `seatbid` and `sb.bid` with
  `(x || []).forEach`. For `seatbid[0].bid = {}` (a valid object), `(sb.bid ? sb.bid : []).forEach`
  called `forEach` on an object and threw `forEach is not a function`; the handler's `.catch`
  returned `400 bad_request` with the raw message. The Core layer never saw this because `core-run`
  does not call `extractAllCategories`; the crash is HTTP-only. `shape-bid-object` and
  `shape-seatbid-object` recorded it at the HTTP layer, and `shape-seatbid-object` recorded the
  resulting `400` at the browser layer.
- **DEF-204**: `public/ortbtools.app.js` computed `const bid = seatbid && seatbid.bid ? seatbid.bid[0] : {}`,
  so a non-array `bid` (`{}`) yielded `undefined`, a null first bid yielded `null`, and an empty
  `bid[]` yielded `undefined`. The later `bid.cur` read then threw `Cannot read properties of …
(reading 'cur')` before the Analyze POST. `shape-bid-null`, `shape-bid-object` and
  `multiplicity-empty-bid-array` recorded it at the browser layer.
- **DEF-300**: `modules/analyze/handler.js` computed
  `hasRes = bidRes && typeof bidRes === 'object' && Object.keys(bidRes).length > 0`, which is false
  for the number `42`, so `validate(bidRes)` was never called and `crosscheck` was skipped. The
  merged envelope came back with only the request's findings and an empty crosscheck.
  `mut-input-shape-number-root-response` recorded it at the HTTP layer; the Core layer already passed,
  because `core-run` calls `validate(42)` and `crosscheck(req, 42)` directly and both are correct.
- **DEF-303**: `lib/http.js#readJson` called `req.destroy()` the moment the body passed the 2 MiB
  cap, sending a TCP reset while the client was still uploading. `undici`/`curl` reported
  `ECONNRESET`; the documented `400 payload_too_large` envelope was never delivered.
  `encoding-request-body-oversized` recorded it at the HTTP layer.

## Derived rules

1. Guard every level of the category walk with `Array.isArray`; a malformed container decodes to no
   categories, and the validator's own structural finding remains the answer.
2. Resolve the Inspector's winning bid through `Array.isArray` guards and default a null/non-object
   first bid to `{}`, so every downstream field read is safe and the analysis reaches the server.
3. Treat a present scalar `bidRes` as a submitted response so the HTTP path validates it exactly as
   Core's `validate()` does when called directly.
4. On an oversized body, reject with `payload_too_large` and drain without buffering rather than
   destroying the socket, so the handler delivers the documented envelope. The drain is O(bytes) with
   flat memory, and the per-IP analyze limiter bounds how often a client can reach it.

## Harness note

The HTTP corpus harness (`tests/corpus/lib/http-run.js`) could not represent a scalar response side:
`hasRes` was computed only for a non-empty object. Teaching it to recognise a present scalar is part
of modelling the public contract, not a weakening of the oracle. The reviewer measured the blast
radius through the real `loadCorpus()` across all cases: both edits affect exactly the one scalar
case, and the per-side `invalid` status that a merged envelope cannot express stays asserted at the
Core layer — the same treatment `type` and `version` already receive.
