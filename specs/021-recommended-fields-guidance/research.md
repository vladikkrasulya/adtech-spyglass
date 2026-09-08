# Phase 0 Research: Recommended Fields Are Guidance, Not Errors

**Date**: 2026-09-08. No clarification markers existed; this file records the normative evidence
behind each level and the decisions that go beyond the letter of the text. Line numbers refer to
the pinned OpenRTB 2.6 markdown at commit `403cbba542de3a5d9cfcccd0a34e74b01b79a9f1`
(`https://raw.githubusercontent.com/InteractiveAdvertisingBureau/openrtb2.x/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md`),
fetched and grepped on 2026-09-08.

## R1. What the specifications say (evidence)

OpenRTB 2.6 §3.2.1 Object: BidRequest (lines 544–548):

- `imp` — "object array; required".
- `site` — "object; recommended … Only applicable and recommended for websites."
- `app` — "object; recommended … Only applicable and recommended for apps."
- `dooh` — "object … A bid request with a DOOH object must not contain a site or app object."
- `device` — "object; recommended".

OpenRTB 2.6 §3.2.18 Object: Device (lines 960–965):

- `geo` — "object; recommended".
- `ua` — "string … For backwards compatibility, exchanges are recommended to always populate `ua`
  with the User-Agent string, when available from the end user's device …".
- `ip` — "string. IPv4 address closest to device."; `ipv6` — "string".

OpenRTB 2.6 §4.1 and §4.2.1 (lines 1259, 1296, 1303, 1307) and §2.1 (line 384):

- "An empty HTTP response constitutes a no-bid …" (§4.1).
- "To express a 'no-bid', the options are to return an empty response with HTTP 204. Alternately
  if the bidder wishes to convey to the exchange a reason for not bidding, just a `BidResponse`
  object is returned with a reason code in the `nbr` attribute." (§4.1).
- `seatbid` — "object array. Array of seatbid objects; 1+ required if a bid is to be made."
- `nbr` — "integer. Reason for not bidding."
- §2.1: "an empty bid response which is one option for indicating no-bid".

AdCOM 1.0 (`df8ba06de0ba77c82efee7a2dc832bd4968474d6`) Object: Device: `ua` — "string;
recommended"; `ip`, `ipv6` — "string"; `geo` — "object". OpenRTB 3.0 FINAL Object: Response:
`seatbid` — "Array of Seatbid objects; 1+ required if a bid is to be made"; `nbr` — "Reason for not
bidding if applicable"; no-bid is "an empty response with HTTP 204" or "a Response object … with
just a reason code in the nbr attribute". The 3.0 request rule in Core already treats `context`
itself as recommended (`request.30.context_recommended`, warning).

## R2. Level mapping (decision)

**Decision**: the validator's own convention, already used by `request.site.domain_missing`
(recommended → warning) and `request.device.language_missing` (optional → info), applies to this
class:

| Qualifier in the text                        | Level   | Applied to                                                                                              |
| -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| required                                     | error   | unchanged (`imp`, `id`; wrong types where a dedicated id exists, e.g. the 3.0 `context.device_invalid`) |
| recommended                                  | warning | `site`/`app` channel, `device`, and their 3.0 mirrors                                                   |
| optional with a compatibility recommendation | warning | `device.ua`, `device.ip` on a site/app request (2.x and 3.0)                                            |
| optional, meaningless for the channel        | info    | `device.ua`, `device.ip` on a DOOH-only request (2.x and 3.0)                                           |
| valid no-bid without a reason                | info    | empty `seatbid` array without `nbr` (2.x and 3.0)                                                       |

`ip` is typed plain optional; it shares the warning grade with `ua` because the two are the client
identity a bidder keys geo, fraud scoring and browser/OS detection on — the engine's existing
comments say so and the rules-25 audit of 2026-08-18 already reduced both to info on DOOH for the
same reason. Splitting them (ua warning, ip info) would present two grades for one omission with no
normative gain.

**Alternatives rejected**:

- Info for every optional field, including `ua`/`ip` on web/app: loses the operational signal the
  message exists for; the 2.6 compatibility note leans the other way.
- Removing the findings entirely: an operator who meant to send an address gets nothing.
- New ids (`…_recommended`) next to the old ones: the constitution treats ids as public
  compatibility keys; the existing ids stay and the messages carry the corrected meaning.
- A new 2.x `request.device_invalid` for a non-object device: additive and reasonable, but outside
  the four groups; today a non-object 2.x `device` falls under `request.device_required` at
  warning level, recorded as an edge case in the spec and in ADR-016.

## R3. Absent device: one finding, not four (decision)

Before: an absent `device` produced `device_required`, `ip_required`, `ua_required` and
`language_missing`. The three per-field findings restate the same omission. After: only
`request.device_required` fires; the per-field checks run when the object exists. The 3.0 rule
already behaves this way. Pinned by test (spec FR-002).

## R4. Crosscheck no-bid (decision)

`crosscheck.js` returned `crosscheck.no_response` (crit) for an empty `seatbid` array without
`nbr`, and skipped the id check. Per §4.2.1 the empty array is a no-bid, so the id check applies
and nothing else does: `[id_match]` or `[id_mismatch]`. `crosscheck.no_response` remains for a
response that carries neither a `seatbid` array nor an `nbr`, matching the validator's
`response.seatbid_or_nbr_required`.

## R5. Ledger consequences (evidence)

Running the Core corpus layer with the four records removed and the 21 cases stripped left
exactly eight guards failing with "recorded deviations disappeared: …device…" and no other
difference: seven DEF-101 audio cases and one DEF-151 Native 3.0 DOOH case. Their remaining
signatures (audio MIME warning, video format tag, Native 3.0 markup/completeness) are unchanged, so
the device pattern was removed from their `core`, `http` and `browser` match lists and the DEF-101
title no longer mentions device errors. No case that lacked a record started to fail, and no
recorded deviation started to pass by accident.
