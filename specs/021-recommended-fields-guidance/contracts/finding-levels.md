# Public-Boundary Contract: Finding Levels for Recommended Fields

The Core public API (`validate()`, `crosscheck()`, and the CLI that wraps them) is a deterministic
data-to-data contract (Constitution IV). The initial omission-level correction used Core
0.39.0. The reviewed type-validation follow-up moves Core from 0.39.0 to 0.40.0 and the CLI's Core
dependency range to `^0.40.0`.

## Omission guidance

These levels apply to omitted values, not supplied values of the wrong type.

| Finding id                              | Before 021                     | After                                                                   | Basis                                                         |
| --------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `request.no_site_or_app`                | error                          | warning                                                                 | OpenRTB 2.6 §3.2.1: site/app recommended                      |
| `request.device_required`               | error                          | warning; fires alone when absent                                        | §3.2.1: device recommended                                    |
| `request.device.ip_required`            | error                          | warning; info when dooh-only                                            | §3.2.18: optional                                             |
| `request.device.ua_required`            | error                          | warning; info when dooh-only                                            | §3.2.18: optional, population recommended for compatibility   |
| `request.30.context.no_site_or_app`     | error                          | warning                                                                 | OpenRTB 3.0: context recommended                              |
| `request.30.context.device_required`    | error                          | warning                                                                 | AdCOM 1.0 / 3.0 context recommended                           |
| `request.30.context.device.ip_required` | error                          | warning; info when dooh-only                                            | AdCOM 1.0: optional                                           |
| `request.30.context.device.ua_required` | error                          | warning; info when dooh-only                                            | AdCOM 1.0: optional, population recommended for compatibility |
| `response.seatbid_empty_no_nbr`         | error                          | info                                                                    | §4.2.1: seatbid 1+ only if bidding                            |
| `response.30.seatbid_empty_no_nbr`      | error                          | info                                                                    | OpenRTB 3.0 Object: Response                                  |
| `crosscheck.no_response`                | crit for empty `seatbid` array | does not fire for an empty `seatbid` array with absent or integer `nbr` | §4.1 no-bid                                                   |

`response.seatbid_or_nbr_required` and `response.30.seatbid_or_nbr_required` remain errors for
responses with neither a `seatbid` array nor `nbr`; `crosscheck.no_response` remains for that
no-signal case. Existing no-bid info findings and ambiguous-channel warnings retain their ids and
levels.

## Supplied values and types

An absent property or explicit JavaScript `undefined` counts as omitted. `null` is a supplied
value and must be rejected where an object, string or integer is expected. Truthiness is not a
presence test: `false`, `0` and `""` must not bypass applicable type checks.

In both 2.x requests and 3.0 request contexts, `site`, `app`, `dooh` and `device`, when supplied,
must be non-null, non-array objects. Device `ua`, `ip` and `ipv6`, when supplied, must be strings;
an empty string may retain existing omission guidance. A wrong client-field type is an error even
if another client field is usable. An invalid Device object does not trigger child-field cascades.

Response `nbr`, when supplied, must be an integer, with or without `seatbid` and regardless of
whether its array is empty. No-bid handling must not suppress a wrong-type error. This follow-up
adds neither IP-address parsing or network-range checks nor `nbr` enum membership or numeric-range
policy.

The following **13 new ids** all have level **error**. Paths identify the supplied invalid field;
3.0 paths retain the existing `openrtb` envelope convention.

| New finding id                           | Field path                            | Expected type |
| ---------------------------------------- | ------------------------------------- | ------------- |
| `request.site_invalid`                   | `site`                                | object        |
| `request.app_invalid`                    | `app`                                 | object        |
| `request.dooh_invalid`                   | `dooh`                                | object        |
| `request.device_invalid`                 | `device`                              | object        |
| `request.device.ua_invalid`              | `device.ua`                           | string        |
| `request.device.ip_invalid`              | `device.ip`                           | string        |
| `request.device.ipv6_invalid`            | `device.ipv6`                         | string        |
| `request.30.context.dooh_invalid`        | `openrtb.request.context.dooh`        | object        |
| `request.30.context.device.ua_invalid`   | `openrtb.request.context.device.ua`   | string        |
| `request.30.context.device.ip_invalid`   | `openrtb.request.context.device.ip`   | string        |
| `request.30.context.device.ipv6_invalid` | `openrtb.request.context.device.ipv6` | string        |
| `response.nbr_invalid`                   | `nbr`                                 | integer       |
| `response.30.nbr_invalid`                | `openrtb.response.nbr`                | integer       |

Existing `request.30.context.site_invalid`, `request.30.context.app_invalid` and
`request.30.context.device_invalid` remain errors and must also reject supplied falsy wrong-type
values. All existing finding ids are preserved.

## Compatibility decision

1. **Ids**: all existing ids remain; the 13 invalid-type ids above are additive. They distinguish
   supplied malformed values from the omissions covered by the existing guidance ids.
2. **Levels**: the ten omission ids retain the lower levels introduced in 0.39.0. The 0.40.0
   follow-up restores blocking findings for supplied malformed inputs; this public behavior change
   and the additive ids justify another Core minor bump.
3. **Finding set for an absent 2.x device**: remains one finding (`request.device_required`),
   without `ip`/`ua`/`language` cascades. Dedup identity and order semantics are unchanged.
4. **Status rollup**: omission-only requests remain `warnings`, and valid empty-seatbid no-bids
   remain `clean`. Supplied wrong types produce `errors`. The CLI exit-code policy remains
   `--fail-on error` by default: the former inputs exit 0 and the latter exit 1.
5. **Crosscheck shape**: an empty `seatbid` array with absent or integer `nbr` yields exactly
   `[crosscheck.id_match]` or `[crosscheck.id_mismatch]`. A malformed supplied `nbr` must still
   produce its validator error; no-bid shortcuts cannot make the response valid.
6. **Messages**: the ten omission texts name the normative basis and operational consequence in
   en/uk/ru; the 13 new keys name the expected type in all three locales. Locale parity is required.
7. **Verification**: public-boundary tests must distinguish omission and explicit `undefined` from
   supplied `null`, falsy wrong types, arrays, strings, objects and fractional `nbr` values, as
   applicable. Core tests cover `undefined`; HTTP tests cover the corresponding JSON omission and
   supplied invalid values. No new test uses Core output as the normative type oracle.

## Consumers and corpus

- `public/ortbtools.app.js` keys nothing on the original omission ids or on `crosscheck.no_response`.
- `packages/cli` prints levels and applies `--fail-on`; its fixture retains a real error
  (`imp.banner.size_required`) so the exit-1 path remains deterministic.
- `scripts/npm-pack-smoke.sh` (hosted CI step "npm pack smoke") validates a sample and expects
  exit 1; its sample had only the now-warning omissions, so the first hosted run of this feature
  failed there. The sample now carries the same real error as the CLI fixture.
- Of the 21 initially affected 020 cases, **20 pass normatively on every layer** and **one retains
  browser DEF-201** while passing Core and HTTP. **Eight other cases** retain their unrelated
  deviations with device lines removed from their signatures. The four retired omission/no-bid
  groups do not imply that all 21 cases are fully normative.
