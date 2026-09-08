# ADR-016: Recommended and Optional Fields Are Guidance, Not Errors

**Status**: Accepted
**Date**: 2026-09-08

## Context

The 020 ad format verification matrix authored its expectations from the specification text and
found one class of false positive on 21 of its 256 cases: Core answered a specification-permitted
omission with an ERROR, so a spec-valid payload rolled up to the blocking verdict `errors`.

- OpenRTB 2.6 §3.2.1 lists `site`, `app` and `device` as "object; recommended" and `dooh` as a
  plain "object"; only `id` and `imp` are "required". Core emitted `request.no_site_or_app` and
  `request.device_required` at error level (DEF-302, DEF-103).
- §3.2.18 types `device.ua` and `device.ip` as optional strings; the only normative lean is the
  compatibility note that "exchanges are recommended to always populate `ua`". Core emitted
  `request.device.ip_required` and `request.device.ua_required` at error level on every site/app
  request (DEF-100), and the 3.0 rules did the same under `request.30.context.device.*`.
- §4.1 says a no-bid is an empty response or a `BidResponse` carrying just `id` and an `nbr`
  reason; §4.2.1 types `seatbid` as "1+ required if a bid is to be made" and `nbr` as optional.
  Core emitted `response.seatbid_empty_no_nbr` at error level for an empty `seatbid` array and
  crosscheck compounded it into `crosscheck.no_response` at critical level (DEF-114).

The validator already had a convention for the other qualifiers: `request.site.domain_missing`
(recommended in §3.2.13) is a warning and `request.device.language_missing` (optional) is info. The
four groups were the places where the convention had not been applied. Constitution IV makes
finding ids public compatibility keys and finding levels part of the decorated result, so a level
change is a contract change and needs an explicit decision.

## Decision

1. A specification qualifier maps to a validator level: `required` → error, `recommended` →
   warning, `optional` → info. Wrong types stay errors regardless of the qualifier.
2. Two named exceptions, both grounded in the text rather than against it:
   - `device.ua` and `device.ip` (2.x) and `context.device.ua`/`ip` (3.0) are warnings on a
     site/app request: §3.2.18 recommends populating `ua`, and the two fields are the client
     identity bidders key geo, fraud scoring and browser/OS detection on. On a DOOH-only request
     they are info, as the 2026-08-18 rules audit already decided for 2.x.
   - An empty `seatbid` array without `nbr` is an info-level no-bid on both protocol lines;
     crosscheck keeps only the id check for it and reports "no response" only when neither a
     `seatbid` array nor an `nbr` exists.
3. An absent 2.x `device` yields one finding, `request.device_required`; the per-field findings run
   only when the object exists (the 3.0 rule already behaved this way).
4. Ids are never renamed to carry a new level. The ten affected ids keep their names; their
   messages in all three locales state the basis (section and qualifier) and the operational
   consequence, and no longer call the omission required.
5. The change ships as a Core MINOR bump (0.38.0 → 0.39.0) with the CLI dependency range and the
   lock file in the same commit, the level table in the validator contract, boundary tests for
   every changed level, and the 020 ledger updated in the same change (four records retired, eight
   signatures re-pinned).

## Alternatives Considered

- **Keep the errors and document them as house strictness.** Rejected: the verdict `errors` is
  what the Inspector, the CLI exit code and the API status expose as "this payload will be
  rejected"; asserting that for spec-valid input is the false positive the audit measured.
- **Info for every optional field, including `ua`/`ip` on web/app.** Rejected: it drops the one
  operational signal the message exists for; the 2.6 compatibility note leans toward populating
  `ua`, and splitting `ua` (warning) from `ip` (info) would present two grades for one omission
  with no normative gain.
- **Remove the findings for recommended objects.** Rejected: an operator who meant to send a
  channel or a device gets no hint at all.
- **New `…_recommended` ids beside the old ones.** Rejected: ids are public compatibility keys;
  consumers keying on the existing ids would silently stop seeing them.
- **A separate strictness profile that keeps the errors.** Rejected for this feature: strictness
  filters levels after the fact and cannot make a warning an error; a strict profile is a
  possible later capability, not a reason to leave the baseline wrong.

## Consequences

- Requests whose only defects were these omissions roll up to `warnings` instead of `errors`; an
  empty-seatbid no-bid rolls up to `clean`. Consumers gating on status, and the CLI at its default
  `--fail-on error`, now pass such inputs. This is the intended correction and is recorded in the
  021 contract.
- The four ledger groups are retired; the coverage axes of the next 020-style audit run will show
  more conformant cells for banner, video, audio and native contexts. Eight cases keep their
  other deviations (DEF-101 audio, DEF-151 Native 3.0) with the device lines removed from their
  signatures.
- Future rules that touch a recommended or optional field follow the mapping in this record;
  deviating from it requires a new ADR.
- A 2.x `device` of the wrong type keeps the `request.device_required` id at warning level; a
  dedicated 2.x `device_invalid` error, mirroring the 3.0 rule, is left for a later additive
  change.

## Related Artifacts

- [021 Recommended fields are guidance, not errors](../021-recommended-fields-guidance/spec.md) —
  spec, [research with pinned citations](../021-recommended-fields-guidance/research.md),
  [public-boundary contract](../021-recommended-fields-guidance/contracts/finding-levels.md).
- [Validator contract](../000-platform-baseline/contracts/core-validator.md) — section
  "Recommended-Field Levels (021, ADR-016; Core 0.39.0)".
- [020 defect report](../020-ad-format-verification-matrix/defects.md) — DEF-100, DEF-103,
  DEF-114, DEF-302 and the "Resolutions" section.
- `packages/core/rules-request.js`, `rules-request-30.js`, `rules-response.js`,
  `rules-response-30.js`, `crosscheck.js`; `tests/validator.test.js`,
  `tests/rules-25-audit.test.js`, `tests/ortb30.test.js`.
