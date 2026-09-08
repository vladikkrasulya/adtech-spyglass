# Phase 0 Research: Recommended Fields Are Guidance, Not Errors

**Date**: 2026-09-08. This file records the normative evidence behind the omission levels and the
reviewed correction for supplied values of the wrong type. The follow-up reuses the pinned sources
and public-API reproductions from the review; it does not expand the validation scope.

## R1. What the specifications say (evidence)

[OpenRTB 2.6, pinned at `403cbba542de3a5d9cfcccd0a34e74b01b79a9f1`](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md)
distinguishes field presence from the declared type:

- §3.2.1 Object: BidRequest declares `imp` a required object array, `site`, `app` and `device`
  recommended objects, and `dooh` an optional object. Site and App apply to their respective
  distribution channels; DOOH must not coexist with either.
- §3.2.18 Object: Device declares `ua`, `ip` and `ipv6` strings. It recommends populating `ua`
  for compatibility when the device's User-Agent is available. This presence recommendation does
  not permit a non-string value.
- §4.1 and §2.1 allow an empty no-bid response; §4.2.1 requires one or more `seatbid` entries only
  when bidding and declares `nbr` an optional integer reason code. Optional does not mean that a
  supplied string, object, boolean, `null` or fractional number is a valid `nbr`.

[AdCOM 1.0, pinned at `df8ba06de0ba77c82efee7a2dc832bd4968474d6`](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md)
Object: Device likewise declares `ua`, `ip` and `ipv6` strings; the User-Agent compatibility
recommendation is explanatory text, not a different field type. Appendix C maps distribution
channel objects and Device into the 3.0 request context. OpenRTB 3.0 FINAL Object: Response also
declares `nbr` an integer and requires Seatbid entries only when bidding. Core already treats an
omitted 3.0 `context` as recommended (`request.30.context_recommended`, warning).

## R2. Level mapping (decision)

**Decision**: the validator's own convention, already used by `request.site.domain_missing`
(recommended → warning) and `request.device.language_missing` (optional → info), applies to this
class of omissions:

| Qualifier in the text                        | Level   | Applied to                                                    |
| -------------------------------------------- | ------- | ------------------------------------------------------------- |
| required                                     | error   | omitted required fields (`imp`, `id`)                         |
| recommended                                  | warning | `site`/`app` channel, `device`, and their 3.0 mirrors         |
| optional with a compatibility recommendation | warning | `device.ua`, `device.ip` on a site/app request (2.x and 3.0)  |
| optional, meaningless for the channel        | info    | `device.ua`, `device.ip` on a DOOH-only request (2.x and 3.0) |
| valid no-bid without a reason                | info    | empty `seatbid` array without `nbr` (2.x and 3.0)             |

This mapping applies to omission. A supplied wrong type is an error regardless of whether the
field is required, recommended or optional; dedicated ids distinguish the two conditions.

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
- Deferring supplied-type errors: rejected by the follow-up review. Downgrading a shared omission
  and wrong-type branch made malformed supplied values non-blocking. The follow-up adds distinct
  invalid-type ids while preserving every existing guidance id (R6).

## R3. Absent device: one finding, not four (decision)

Before: an absent `device` produced `device_required`, `ip_required`, `ua_required` and
`language_missing`. The three per-field findings restate the same omission. After: only
`request.device_required` fires; the per-field checks run when the object exists. The 3.0 rule
already behaves this way. Invalid Device objects also stop child-field checks, but produce an
invalid-type error instead of omission guidance (spec FR-002 and FR-010).

## R4. Crosscheck no-bid (decision)

`crosscheck.js` returned `crosscheck.no_response` (crit) for an empty `seatbid` array without
`nbr`, and skipped the id check. Per §4.2.1 the empty array is a no-bid, so the id check applies
and nothing else does: `[id_match]` or `[id_mismatch]`. `crosscheck.no_response` remains for a
response that carries neither a `seatbid` array nor an `nbr`, matching the validator's
`response.seatbid_or_nbr_required`. A supplied `nbr` must independently pass the integer check;
no-bid handling cannot suppress a malformed-value error (spec FR-011).

## R5. Ledger consequences (evidence)

The initial Core-only run after removing the four omission/no-bid records identified eight other
cases needing re-pinned signatures: seven DEF-101 audio cases and one DEF-151 Native 3.0 DOOH case.
Their unrelated audio and Native deviations remain. That Core result did not establish browser
conformance for every initially affected case.

The reviewed accounting is **20 fully normative cases**, **one case that passes Core and HTTP but
retains browser DEF-201**, and **eight other re-pinned cases**. The four resolved groups DEF-100,
DEF-103, DEF-114 and DEF-302 are retired; the existing DEF-201 record must retain the independent
browser deviation. All remaining per-case, per-layer guards must continue to match exactly.

## R6. Supplied invalid values (reviewed follow-up)

The review reproduced malformed supplied Device, channel and client-field values through the
public Core API before and after the initial correction. Values such as `device: false`,
`device: "phone"`, `device.ua: 42`, `device.ip: false` and `site: false` lost blocking findings
when shared omission/type branches were downgraded. Separate response reproductions showed that
`nbr: "2"` and `nbr: {}` could produce a clean no-bid result with `seatbid: []` in both protocol
families. These are type violations of the sources in R1, not optional-field omissions.

**Decision**: preserve the warning/info omission levels, and separate presence from type checks.
An absent property or explicit JavaScript `undefined` is omitted. `null`, including on an optional
field, is supplied and invalid for the object/string/integer types in scope. Falsy values must not
bypass checks. Supplied channel and Device fields must be non-null, non-array objects; supplied
UA/IP/IPv6 fields must be strings. Empty client-field strings may retain existing omission guidance.
Every supplied `nbr` must be an integer, whether the response has bids, empty seats or no seats.

The [finding contract](contracts/finding-levels.md) enumerates exactly 13 new error ids and the
existing 3.0 invalid-object ids that remain errors. All old ids are preserved. These additive ids
and the restored blocking verdicts for malformed supplied values justify Core 0.39.0 → 0.40.0,
with CLI dependency `^0.40.0` and the lock file updated together. Public-boundary tests must pair
malformed-value regressions with valid omission controls. Address parsing, network-range checks
and `nbr` enum membership or numeric-range policy are outside this follow-up.
