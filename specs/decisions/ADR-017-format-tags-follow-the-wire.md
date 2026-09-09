# ADR-017: A format tag reports what the wire carries, not what the account is provisioned for

**Status**: Accepted

**Date**: 2026-09-09

## Context

Two corpus cases — `inpage-kadam-icon-notice` and `inpage-kadam-separate-notice-alias` — expect the
merged format result to include `inpage`. Both are a documented Kadam feed GET request paired with a
materials response.

Nothing in either half of that transaction says "in-page":

- The request is `/feed?sid=…&skey=…&ua=…&ip=…&uid=…&limit=…&language=…&pid=…&page=…`. The vendor's
  feed contract does carry an optional `format` parameter, and [028](../028-vendor-request-dialects/spec.md)'s
  decoder accepts its documented values — `push`, `native`, `teaser`, `cu`, `pops`. There is no
  `inpage` value, and these two requests omit the parameter entirely, which that decoder records as
  `meta.formatAmbiguous`.
- The response materials are `{id, impid, crid, campaign_id, category, title, text, image_url,
icon_url, click_url, cpc}`. `format-detect.js` reads a click, a picture and a headline together as
  a card, and separates in-page from push on one signal: an `ext.widget_id`, `ext.zone_id` or
  `ext.format === 'inpage'`. These materials carry no `ext` at all.

The cases' own specification notes say so plainly: _"The feed key identifies in-page inventory"_ and
_"The same feed shape can also carry push: format cannot be conclusively inferred from response
fields alone."_ The feed key identifies the inventory to the **vendor**, through account
provisioning that never travels on the wire. An inspector reading one pasted transaction cannot see
it, and no amount of engine work will make it visible.

The expectation was therefore recording a capability that no evidence in the transaction can
support, and it kept DEF-107 open on that basis alone.

## Decision

A format tag reports what the transaction on the wire carries. Where the wire does not carry a
distinction, the tool reports the shape it can see and does not guess at the rest.

The two expectations become `["push"]` — the material is a push-shaped card, which is exactly what
its fields say and all they say. The cases keep their `format: inpage` corpus metadata, because that
is what the fixtures document about the inventory; only the assertion about what the **tool** should
conclude changes.

## Alternatives

1. **Tag `inpage` from the feed key.** Rejected: it requires a feed-key-to-inventory mapping that
   exists only inside the vendor's account system. Encoding any particular key would be fixture
   memorisation, not detection.
2. **Leave the expectation and keep the record open.** Rejected: a permanently open defect against a
   capability nothing on the wire can support is not a defect, and carrying it teaches the ledger to
   be ignored.
3. **Add an `inpage` value to the vendor's `format` enum.** Rejected: the vendor's published contract
   does not list one. Inventing an enum value and then detecting it would be the tool validating its
   own invention.

## Consequences

- The two cases pass, and DEF-107 — the last open record naming them — closes.
- In-page versus push for this vendor's feed stays out of reach until the vendor's own wire carries
  the distinction. If a later **material** supplies the `ext.widget_id` / `ext.zone_id` /
  `ext.format` placement signal, the existing `format-detect.js` rule tags it with no further
  change — verified. A later **request** supplying `format=inpage` would **not**: the Kadam decoder
  validates that parameter against the vendor's documented values, which do not include one, so such
  a request is answered with `request.url.parameter_invalid` and no format tag. Supporting it would
  need a documented vendor source first and then decoder work — it is not a change this decision
  makes free. (Corrected 2026-09-09 after an independent review found the original sentence
  overstated; the decision itself is unchanged.)
- The rule generalises: a corpus expectation must be derivable from the bytes of the transaction it
  is attached to. Where it is not, the expectation is corrected here rather than left as a standing
  defect against the product.

## Related

- [ADR-005](./ADR-005-evidence-driven-dialects.md) — dialect behaviour is driven by evidence
- [020 defect ledger](../020-ad-format-verification-matrix/defects.md) — DEF-107
- [028 vendor request dialects](../028-vendor-request-dialects/spec.md) — the Kadam feed decoder and
  its `formatAmbiguous` reading
- [030 vendor carrier preview](../030-vendor-carrier-preview/spec.md) — the feature that applies this
