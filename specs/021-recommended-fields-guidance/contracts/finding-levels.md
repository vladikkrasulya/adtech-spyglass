# Public-Boundary Contract: Finding Levels for Recommended Fields

The Core public API (`validate()`, `crosscheck()`, and the CLI that wraps them) is a deterministic
data-to-data contract (Constitution IV). This file records what this feature changes at that
boundary and the compatibility decision for each change. Core moves from 0.38.0 to 0.39.0.

## What changes

| Finding id                              | Before                         | After                                                | Basis                                    |
| --------------------------------------- | ------------------------------ | ---------------------------------------------------- | ---------------------------------------- |
| `request.no_site_or_app`                | error                          | warning                                              | OpenRTB 2.6 §3.2.1: site/app recommended |
| `request.device_required`               | error                          | warning; fires alone when absent                     | §3.2.1: device recommended               |
| `request.device.ip_required`            | error                          | warning; info when dooh-only                         | §3.2.18: optional                        |
| `request.device.ua_required`            | error                          | warning; info when dooh-only                         | §3.2.18: optional, populate recommended  |
| `request.30.context.no_site_or_app`     | error                          | warning                                              | OpenRTB 3.0: context recommended         |
| `request.30.context.device_required`    | error                          | warning                                              | AdCOM 1.0 / 3.0 context recommended      |
| `request.30.context.device.ip_required` | error                          | warning; info when dooh-only                         | AdCOM 1.0: optional                      |
| `request.30.context.device.ua_required` | error                          | warning; info when dooh-only                         | AdCOM 1.0: recommended                   |
| `response.seatbid_empty_no_nbr`         | error                          | info                                                 | §4.2.1: seatbid 1+ only if bidding       |
| `response.30.seatbid_empty_no_nbr`      | error                          | info                                                 | OpenRTB 3.0 Object: Response             |
| `crosscheck.no_response`                | crit for empty `seatbid` array | only when neither a `seatbid` array nor `nbr` exists | §4.1 no-bid                              |

Unchanged: `request.30.context.device_invalid` (error), `response.seatbid_or_nbr_required` and
`response.30.seatbid_or_nbr_required` (error), `response.no_bid` (info), `request.site_and_app_both`
(warning), every other id, level, path and parameter.

## Compatibility decision

1. **Ids**: none added, removed or renamed. Consumers keying automation on ids see the same ids.
2. **Levels**: ten ids move down one or two grades. This is a public contract change (levels are
   part of the decorated finding) and is the reason for the Core minor bump. Boundary tests in
   `tests/validator.test.js`, `tests/rules-25-audit.test.js` and `tests/ortb30.test.js` pin each
   new level, including the DOOH-only info grade and the wrong-type error that stays.
3. **Finding set for an absent 2.x device**: shrinks from four findings to one
   (`request.device_required`). Dedup identity and order semantics are unchanged; the per-field
   findings simply do not fire for an absent object. Pinned by test.
4. **Status rollup**: a request whose only defects were these omissions now rolls up to `warnings`
   (or `clean` for an empty-seatbid no-bid) instead of `errors`. Consumers gating on `status`
   see valid inputs pass that previously failed. The CLI exit-code policy is unchanged
   (`--fail-on error` by default), so `ortbtools validate` now exits 0 for such inputs.
5. **Crosscheck shape**: an empty `seatbid` array yields exactly `[crosscheck.id_match]` or
   `[crosscheck.id_mismatch]` instead of `[crosscheck.no_response]`. Pinned by test.
6. **Messages**: the ten texts are rewritten in en/uk/ru to name the normative basis and the
   operational consequence; no key is added. `tests/i18n-audit.test.js` enforces parity.

## Consumers checked

- `public/ortbtools.app.js` keys nothing on these ids or on `crosscheck.no_response`.
- `packages/cli` prints levels and applies `--fail-on`; its test fixture was made to carry a real
  error (`imp.banner.size_required`) so the exit-1 path stays deterministic.
- The 020 corpus is the regression net: 21 cases now pass normatively; 8 cases keep their other
  recorded deviations with the device lines removed from their signatures.
