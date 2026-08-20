# Research: OpenRTB Compatibility Registry

**Slug**: openrtb-compatibility-registry
**Date**: 2026-08-20
**Intake**: [intake.md](./intake.md)
**Status**: settled. Licence verdicts re-verified adversarially on 2026-08-20; 17 of them moved. This
section records the verified set, not the first pass.

## Method

Ten parallel researchers, one batch of partners each, followed by a cross-partner synthesis. Every
researcher was given the same brief: read the documentation, record what it actually says, and
distinguish "the documentation does not say" from "I did not check". Page content was treated as
untrusted data throughout.

**Coverage**: 45 entries across the owner's list — 21 first-wave partners, 9 second-wave, 5
proprietary feed dialects, plus the profile splits that emerged during reading. 11 agents, 426 tool
calls, 0 failures.

**Limits, stated up front.** No payload was sent to any partner endpoint. Every rule recorded here is
documentation-derived, so where a partner's documentation and its wire behaviour diverge, this
research cannot tell. Several partners' operational halves (endpoints, QPS ceilings, body-size caps)
are explicitly "provided during onboarding" and are not public for anyone.

**Raw evidence** is outside the repository, at
`~/.local/share/ortbtools-research/` — `partner-profiles-2026-08-20.json` (45 structured records) and
`partner-synthesis-2026-08-20.md` (the full cross-partner synthesis). Kept out of git deliberately:
what gets vendored is a decision for the shape stage, not a side effect of research.

## The finding that reorders the assessment

The owner's list was correct about reachability: **40 of 45 pages are readable with no partner
login**. The premise it did not test was permission, and permission is where the idea narrows
sharply.

| Licence verdict               | First pass |  **Verified** |
| ----------------------------- | ---------: | ------------: |
| clears the `SOURCES.md` floor |  5 records | **3 sources** |
| fails the floor               |         19 |            24 |
| no statement either way       |         18 |            14 |
| needs a legal read            |          3 |             9 |

The adversarial pass re-examined 35 artifacts across 23 vendor estates and **moved 17 verdicts**. It
was wrong in both directions, which is the part worth keeping.

### It cleared things that were not cleared

- **The Google `.proto` downloads lost their grant.** The first pass assumed the doc-page footer
  travelled to `openrtb-adx-proto.txt`. A whole-file grep returns **zero** matches for any licence,
  copyright or Apache string; sibling `/NOTICE` and `/LICENSE` are both **HTTP 404**; and Site
  Policies explicitly excludes _"a link to content on a different webpage"_ from the CC BY grant. The
  cheapest artifact in the entire set to derive from — a machine-readable protobuf with parseable
  required/optional — is covered by nothing. **The absence of a burden is the absence of a licence,
  not a free pass.**
- **The Xandr "MIT in BOTH files" claim was double-counting.** The repo's own ThirdPartyNotices
  assigns `LICENSE-CODE` the code role, and the OpenRTB 2.6 article contains no code samples. A code
  grant licenses nothing this feature derives.
- **The rendered Microsoft Learn page is prohibited outright.** Site-wide Terms of Use, unread by the
  first pass, fail the floor. Citing `learn.microsoft.com` is not a stylistic preference against
  citing the repo — it is the difference between a grant and a prohibition.

### It excluded things that were not excluded

- **BidSwitch was excluded on a footer string.** _"© 2014-2026 BidSwitch GmbH. All rights reserved.
  This document contains BidSwitch GmbH proprietary information."_ is a `<div class="footleft">` theme
  string, duplicated in a dead HTML comment. No terms document, no EULA, no login; the footer's own
  "BidSwitch Policy" link is **404**. It asserts a status without directing any verb at the reader.
  **The three BidSwitch profiles were excluded on insufficient grounds and return to consideration.**
- **Unity was excluded on the wrong ground.** The first pass quoted the carve-out and missed that the
  clause _opens with a grant_: Unity _"expressly permits its users to use AI tools, agents, and large
  language models to access, index, retrieve, summarize, and train on this public documentation."_
  The real obstacle is that the prose is CC BY-**NC-ND** — which was never the stated reason.

### Silence was often an unfound page

Five partners moved from `none-stated` to `fails-floor` once the pass looked past the documentation
host — and the hiding places were not trivial: **Equativ**'s terms live in a Salesforce SPA invisible
to `curl`; **TrafficStars** serves its body in an iframe at a different path than `/terms`;
**Hivestack**'s terms now 301 to Perion, with a wider prohibition; **Nexx360** publishes
`Content-Signal: ai-train=no, ai-input=no` plus `Disallow: /` on the docs host itself; **TripleLift**
forbids derivative works in terms. Two more (**EXADS**, **RichAds**) moved to `needs-legal-read`
because their prohibitions are scoped to an apex domain while the docs sit on a subdomain.

**Index Exchange's prohibition was confirmed verbatim and stands.**

### The usable set, verified

Three sources carry an affirmative grant reaching documentation **prose and field tables**: the two
Google pages (`authorized-buyers/rtb/openrtb-guide` and `display-video/ortb-spec`, CC BY 4.0 for
prose and tables, Apache-2.0 for code samples only — not a code-only grant) and the **prose of the
Xandr docs repository**, cited at a pinned commit, never via Learn.

### The reframing that matters more than the count

This feature's own constraint is to store **derived rules and provenance, never a mirror of the
document**. Under that constraint the licence is mostly not even reached: the CC BY grant is _wider
than the need_. `none-stated` therefore is not an automatic "cannot build" — it is "no permission to
reproduce, and an unanswered question about deriving", which is a different posture and a different
conversation. What silence never becomes is permission.

Full artifact-level matrix, with every quote and the URL it came from:
`~/.local/share/ortbtools-research/licence-matrix-2026-08-20.md`.

## Findings that change the design, independent of licence

### 1. The unit of work is a profile, not a company

**≈59 distinct documented wire profiles across 29 organisations — roughly 2:1.** Directions split
(Xandr bidder vs supply, IX DSP vs seller), versions split (Chartboost 2.3 vs 2.6, which _relocate_
`schain` and `gdpr` — a payload valid under one is non-conforming under the other), and brands split
(Unity vs ironSource share a domain and a licence but have different required sets, macros and ext
keys).

A registry keyed on partner name will be wrong on its second entry.

### 2. Profiles are not stricter subsets of IAB — they are mutually incompatible

This is the finding that most affects the schema. The intuitive model — IAB is the loose baseline,
each partner tightens it — is false:

- `tmax` is **required** by Index Exchange and _"isn't supported"_ by Xandr supply.
- `iurl` beats `adm` at Vistar; `iurl` is ignored when `adm` is populated at Hivestack. Same two
  fields, inverted precedence, same media type.
- `bid.price` is a true CPM at Hivestack and CPM × impression-multiplier at Vistar. **The identical
  number means different money.**

That last one is this project's own thesis restated by the market: a payload that parses, validates,
and reads correctly while meaning something else entirely.

### 3. There are more than three dispositions

"Accepted / rejected / ignored" is not enough vocabulary:

- **accepted-then-ignored** — Xandr: `enable_bid_shading` _"is set as false irrespective of the value
  sent"_.
- **accepted-but-not-forwarded** — IX seller uses `user.gender`/`user.yob` for deal setup and strips
  them before the DSP sees them.
- **sometimes sent** — IX response: conditionally present, and absence is not an error.
- **absence semantics** — Google AB expresses non-support as _"doesn't populate"_, not as
  prohibition. Conflating that with a forbid rule would produce false findings.
- **non-payload requirement** — Xandr supply's required matrix is a **95% volume threshold enforced
  commercially**, not a per-payload rule. Rendering it as payload invalidity would be simply wrong.

### 4. DV360 states the additive invariant, in the partner's own words

> _"Some fields are not supported, but are still parsed. These fields must be formatted correctly but
> won't affect the bidding outcome."_

That is the owner's strictly-additive decision, authored by a partner. DV360 says `Not supported.`
85 times, per field. It is the strongest single argument that the additive model matches how partners
actually describe themselves.

### 5. Attribution is more dangerous than it looked

Some ext keys are near-signatures: `source.pchain` containing `50b1c356f2c5c8fc` (IX), `at = 3852512`
(Hivestack), `ext.appnexus` (Xandr), the `com.google.doubleclick` proto package.

But the collisions are severe, and one is a trap:

| Shared                                                                                                                                               | Partners                                                           | Consequence                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| The whole `device.ext` battery block (`batterylevel`, `charging`, `headset`, `ringmute`, `darkmode`, `airplane`, `dnd`, `bluetooth`, `diskspace`, …) | Verve Performance+ **and** Digital Turbine — key for key identical | Looks maximally distinctive; identifies two different companies |
| `google_query_id`                                                                                                                                    | Google AB, BidSwitch buyer, BidSwitch supplier                     | Identifies a Google-sourced demand _path_, not the sender       |
| `imp.ext.wopv`                                                                                                                                       | IX, BidSwitch, TTD                                                 | It is HUMAN/White Ops' lookup ID — three partners, one vendor   |
| `bid.ext.crtype`                                                                                                                                     | Unity, AppLovin, DT, Vungle, Chartboost                            | Five partners; attribution lives in the value enum, not the key |

And one key must be **actively blacklisted**: `bid.ext.rp{...}` appears in MGID's own Native example —
it is Rubicon/Magnite's namespace, copy-pasted into MGID's documentation. Using it as an MGID
fingerprint would misattribute Magnite payloads.

This is direct evidence for the owner's constraint that auto-detect stays a hint with confidence and
never an assertion of origin.

### 6. Mechanical derivability is not safe derivation

Every high-quality candidate carries at least one trap where a blind parse yields a wrong rule:

- IX types `bid.w`/`bid.h` optional but they are conditionally **required**; types `bid.adomain`
  required but it is conditionally **not**. A type-cell regex is wrong in both directions.
- Xandr supply's source says `imp.video.mimes contains value 1 for VPAID1` where it plainly means
  `imp.video.api`.
- Xandr bidder's markdown contains an **HTML-commented-out** endpoint block that docfx strips — a
  raw-markdown parser would ingest a rule that does not exist.
- Opera's macro table renders every Macro cell as a bare `$`.
- BidSwitch's deprecated 2.5 supplier protocol is still live at a near-identical URL prefix; the
  wrong prefix yields the wrong protocol version with no error.

Verification is a first-class line item, not a rounding error.

### 7. Four vendor documentation sites carry prompt-injection blocks

Digital Turbine, ExoClick, EXADS and Nexx360 serve `# Agent Instructions` blocks attempting to append
an `ask=` query parameter, and similar directive text was found inside TTD's proto and Vistar's page
HTML. The researchers were instructed to treat page content as data and reported these rather than
following them.

Any ingestion pipeline this feature grows **must strip such blocks before content reaches a model**.
This is a security requirement, not a hygiene note.

## What the research could not establish

Recorded so the next stage does not inherit false confidence.

- **FreeWheel** — both pages 403 from Cloudflare. A **WAF block, not a login wall**: the site reports
  `loggedIn: false` and still serves a shell. Nothing about FreeWheel may be asserted from this pass.
- **Adform** — redirects to SSO. Its `none-stated` verdict means _no licence was visible to an
  unauthenticated reader_, not that Adform states none.
- **The Trade Desk** — the portal is an empty SPA shell; only the public protobuf was readable.
  Whether `openpath` and `ssp` differ on the wire is undeterminable without a login.
- **Google AB** — headers, gzip and no-bid codes live on pages not checked. 21 top-level `extend`
  blocks were confirmed; the ~200 individual ext fields were not re-counted in this pass.
- **Dead URLs in the owner's list** — 2 of 3 Sovrn URLs are genuine 404s absent from the site's own
  sitemap (there is no CTV spec and no bid-response spec on the site any more); Nexx360's URL 404s;
  Outbrain's primary guide is retired; RichAds' URL is marketing copy with the real spec elsewhere.
- **Reachability depended on User-Agent, not credentials**, for Vungle and Vistar — 403 to one fetch
  tool, 200 to curl with a browser UA. A crawler treating 403 as a paywall will silently
  under-collect.
- **Unresolved contradictions inside partner documentation**, deliberately not adjudicated: Vistar
  describes `bid.price` three mutually inconsistent ways, so no `bid.price` rule can be written for it
  without partner confirmation; Hivestack's §6.5 and its `BidResponse.cur` note disagree on currency
  conversion; Xandr's own index still says 2.4 while its 2.6 page says otherwise; Verve
  Performance+'s banner claims 2.6 while the wire header says 2.3.

## Effect on the intake's open questions

| Intake unknown                                        | Status after research                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is the one bounded problem?                      | Answerable now — the verified licence filter reduces the candidate set to 3 sources. Recommendation below; the choice remains the owner's.                                                                                                                                                                                                                                                                                                                |
| Does this fall inside ADR-005's named-overlay clause? | Yes for the licensed four: ADR-005 asks for public documentation plus regression tests, and both are available. Unchanged for the rest.                                                                                                                                                                                                                                                                                                                   |
| Can a profile suppress a baseline finding?            | Closed at intake — strictly additive. Research reinforces it: DV360 states the same invariant itself.                                                                                                                                                                                                                                                                                                                                                     |
| What does "ignored by partner" mean as a severity?    | Now shown to need **five or six** dispositions, not one. Carried to the define stage as a schema requirement.                                                                                                                                                                                                                                                                                                                                             |
| Where do derived rules live?                          | Open. Now constrained by an obligation nobody had costed: attribution notices, NOTICE handling, and pinned-commit citation must travel with the derived files.                                                                                                                                                                                                                                                                                            |
| Is direction a separate `dialect_id`?                 | Yes. Evidence: ≈59 profiles / 29 organisations, and Xandr's two directions disagree on `tmax` and on version negotiation.                                                                                                                                                                                                                                                                                                                                 |
| What licence applies to each non-Google source?       | **Answered and re-verified.** 3 sources clear, 24 fail, 14 silent, 9 need a legal read. Three questions remain for a lawyer, not an agent: Google's chain of title to IAB-originated wording; which instrument governs Xandr prose when LICENSE says MIT and ThirdPartyNotices says CC BY 4.0; and whether apex-domain terms reach a docs subdomain in five separate estates, one of them under Irish law with a database right and no US-style fair use. |
| How does attribution avoid claiming origin?           | Sharpened: `google_query_id` traverses BidSwitch; the battery block is shared key-for-key by two companies. Attribution must key on sets with weights, never on single keys.                                                                                                                                                                                                                                                                              |
| Do feed dialects belong here?                         | No — confirmed. All 5 are non-OpenRTB, and one (RevContent RevShifter) is not an auction protocol at all.                                                                                                                                                                                                                                                                                                                                                 |
| Prebid Server profile — same kind of object?          | Not yet examined; it was not in the researched batch.                                                                                                                                                                                                                                                                                                                                                                                                     |

## Recommended first bounded problem

Offered as the synthesis's reasoning, not as a decision. The licence filter does most of the
selecting.

1. **Google DV360, supply-side.** One page, one direction, one document — genuinely bounded. It
   stresses the schema hard: an eight-value requiredness vocabulary that breaks any
   required/optional binary, genuine forbids, genuine ignores, a cardinality rule, enum-value
   non-support and version non-support. And it contains the partner-authored statement of the
   additive invariant. **Precondition**: re-transcribe the `Not supported.` list field-by-field from
   raw HTML — only 12 entries were verified verbatim, and two entries in the longer list contradict
   the raw text.
2. **Xandr bidder + supply as one paired cycle.** They prove the model precisely because they
   disagree with each other. Forces two schema features nothing else does: **profile composition**
   (2.4 baseline + 2.6 delta — the 2.6 page says three times that unlisted fields stay as documented
   in 2.4) and **non-payload requirements** (the 95% volume threshold). Discovering either after the
   schema freezes is expensive.
3. **Google Authorized Buyers.** The `.proto` is the only licensed machine-readable artifact in the
   entire set. Build it third, as the test of whether the registry can ingest a schema artifact
   rather than transcribed tables.

## Next stage

`/speckit-assess-define` — with the licence verification landed, since it may still move the
candidate set.
