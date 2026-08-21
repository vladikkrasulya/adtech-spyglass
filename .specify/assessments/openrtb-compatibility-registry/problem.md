# Problem Definition: OpenRTB Compatibility Registry

**Slug**: openrtb-compatibility-registry · **Date**: 2026-08-21
**Prior**: [intake.md](./intake.md) · [research.md](./research.md)

## Problem Statement

A payload that is valid per IAB OpenRTB reaches a partner materially altered, and nothing in the
product says so. A `tagid` is overwritten from a bidder param; a publisher id is replaced; a floor
never arrives. The sender's own validator reports success, the partner's behaviour disagrees, and the
gap is invisible until someone reads a bid stream by hand.

ortbtools today answers one question — _is this valid per IAB?_ — and stops. The question that
follows it in real work is _what will actually arrive, on the route this payload is taking?_

## Affected Users & Stakeholders

- **Integrators debugging a live integration** — the primary case. They hold a payload and a partner
  and need to know whether the two agree before spending a day on a support thread.
- **Publishers and SSP-side operators** reading a stream, who need the same answer per record rather
  than per paste.
- **The project itself**: the compatibility claim is only worth making if each statement is
  attributable and falsifiable. An unattributable claim is a liability with a partner's name on it.

## Evidence

- **Documentation is mostly not usable.** Of 45 researched profiles, three sources carry a grant that
  reaches prose and field tables. Seven partners forbid derivation outright, four of them explicitly
  including non-commercial use. See [research.md](./research.md) and `QUARANTINE.json`.
- **The same facts exist under Apache-2.0.** Every one of those seven publishes a prebid-server
  adapter, maintained from its own domain. 1188 dialect rules were derived across 232 adapters, each
  carrying a `file.go:LINE` citation.
- **Traceability is established; correctness is not.** 1186 of 1188 citations resolve at the pinned
  commit — that proves the rules are traceable, not that they are correctly interpreted. Three
  adversarial lenses over 140 rules produced 13 substantive corrections, 1 deletion and 16 rules the
  first pass missed. **Unknown recall is the live risk, not coverage.**
- **Coverage is not the constraint.** On an IAB-valid banner request, 190 partners have an applicable
  rule and 553 rules apply. The unsolved problem is selection, not supply.

## Goals

- Tell the user, before sending, that a specific route will alter or reject a specific field.
- Make every such statement attributable to a cited artifact and falsifiable against it.
- Preserve the IAB baseline untouched; a dialect statement is additive, never a suppression.
- Rank statements so the user sees the consequential one first, and knows how many were withheld.

## Non-Goals

- **Becoming an auction participant.** No credentials, no partner integration, no live bidding.
  Confirmed by the owner on 2026-08-21; this bounds what evidence is obtainable, permanently.
- **Claiming exchange behaviour.** The evidence describes a Prebid adapter at a pinned commit, not
  the partner's own exchange. Messages must say so.
- **Mirroring partner documentation.** Derived rules with provenance only; the quarantined set stays
  out of the product.
- Replacing, re-ordering or suppressing existing IAB findings.

## Success Signals

- A user changes the payload in response to a dialect statement and the statement disappears on
  re-check. **This, not clicks or impressions, is the measure of usefulness.**
- Statements survive adversarial re-reading at a rate that does not degrade as coverage grows.
- No statement is shown whose evidence cannot be produced on demand.
