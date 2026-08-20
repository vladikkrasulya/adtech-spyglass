# Idea Intake: OpenRTB Compatibility Registry

- **Slug**: openrtb-compatibility-registry
- **Created**: 2026-08-20
- **Source**: pasted text (owner, 2026-08-20), following a session that retrieved and licence-checked
  the Google Authorized Buyers RTB documentation set
- **Type**: new-capability

## Idea (as captured)

The owner's framing, verbatim:

> Так, ідея сильна. Я б лише позиціонував це не як набір «синтаксисів», а як OpenRTB compatibility
> registry: базовий IAB-стандарт плюс точний профіль конкретного партнера.
>
> Ключове повідомлення валідатора має виглядати так:
>
> > OpenRTB 2.6: валідний.
> > Index Exchange DSP profile: невалідний — відсутнє поле X, поле Y ігнорується партнером.
>
> Питань, які блокують старт, немає. Нижче — перевірений станом на 20 серпня 2026 року список
> офіційних документів, доступних без партнерського логіну.

### First wave — owner states documentation is sufficient for implementation

| Партнер / діалект        | Офіційна документація                                                                                                                                                                                                                                                                                                                                                                                | Покриття                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Google Authorized Buyers | [OpenRTB guide](https://developers.google.com/authorized-buyers/rtb/openrtb-guide), [протоколи та protobuf](https://developers.google.com/authorized-buyers/rtb/data)                                                                                                                                                                                                                                | OpenRTB 2.6 JSON/Protobuf, Google extensions                  |
| Google DV360             | [DV360 OpenRTB specification](https://developers.google.com/display-video/ortb-spec)                                                                                                                                                                                                                                                                                                                 | Окремий supply→DSP профіль 2.6                                |
| Microsoft/Xandr          | [Bidder 2.6](https://learn.microsoft.com/en-us/xandr/bidders/integration-with-openrtb-2-6), [Supply 2.6](https://learn.microsoft.com/en-us/xandr/supply-partners/integration-with-openrtb-2-6), [відкритий репозиторій документації](https://github.com/MicrosoftDocs/Xandr-docs)                                                                                                                    | Bidder і supply — окремі профілі, `ext.appnexus`              |
| Index Exchange           | [DSP request](https://kb.indexexchange.com/dsps/open-rtb/list_of_supported_openrtb_bid_request_fields_dsp.htm), [DSP response](https://kb.indexexchange.com/dsps/open-rtb/list_of_supported_openrtb_bid_response_fields_dsp.htm), [seller request](https://kb.indexexchange.com/publishers/openrtb_integration/list_of_supported_openrtb_bid_request_fields_for_sellers.htm)                         | OpenRTB 2.6; DSP і seller profiles                            |
| The Trade Desk OpenPath  | [Standard Adapter specification](https://partner.thetradedesk.com/v3/portal/openpath/doc/StandardAdapter)                                                                                                                                                                                                                                                                                            | Детальна матриця required/recommended/not used, CTV/DOOH/pods |
| BidSwitch                | [Protocol hub](https://protocol.bidswitch.com/), [Buyer 5.7](https://protocol.bidswitch.com/standards-v57/standards.html), [Supplier 1.1](https://protocol.bidswitch.com/ssp-protocol-v11.html)                                                                                                                                                                                                      | Окремі buyer/supplier-діалекти на базі 2.6                    |
| InMobi                   | [DSP profile](https://support.inmobi.com/advertise/integration/ortb-specs/overviewdsp), [Supply profile](https://support.inmobi.com/monetize/other-integrations/ortb-integrations/overview-ortb)                                                                                                                                                                                                     | Два напрямки OpenRTB 2.5, Native, SKAN, privacy               |
| Verve/Smaato             | [Brand+](https://developers-brand.verve.com/docs/brand-openrtb-specifications), [Performance+](https://developers.verve.com/docs/verve-openrtb-specifications)                                                                                                                                                                                                                                       | Два різні діалекти; current 2.6 і legacy PubNative            |
| Unity                    | [Unity Exchange](https://docs.unity.com/en-us/grow/programmatic/unity-exchange/get-started), [ironSource Exchange](https://docs.unity.com/en-us/grow/programmatic/ironsource-exchange/openrtb-specs)                                                                                                                                                                                                 | Два окремі OpenRTB 2.5 profiles                               |
| AppLovin/MAX             | [Introduction](https://support.applovin.com/en/max/demand-partners/demand-side-platforms/applovin-ortb-specification/introduction), [requests](https://support.applovin.com/en/max/demand-partners/demand-side-platforms/applovin-ortb-specification/bid-requests), [responses](https://support.applovin.com/en/max/demand-partners/demand-side-platforms/applovin-ortb-specification/bid-responses) | Mobile/app, Native 1.2, VAST/MRAID                            |
| Digital Turbine/Fyber    | [DT Exchange OpenRTB](https://docs.digitalturbine.com/dt-ads-demand/dt-exchange-openrtb-2.5-specs)                                                                                                                                                                                                                                                                                                   | 2.5, rewarded, SKOverlay, EIDs, mobile extensions             |
| Liftoff/Vungle           | [OpenRTB 2.5](https://support.vungle.com/hc/en-us/articles/360045953431-Vungle-Exchange-OpenRTB-2-5-Integration-Guide), [Native](https://support.vungle.com/hc/en-us/articles/8582189840923-Vungle-Exchange-OpenRTB-2-5-Native-Ad-Integration)                                                                                                                                                       | Власні headers, Native asset IDs, rewarded/deeplink           |
| Chartboost               | [2.6 request](https://docs.chartboost.com/en/partners/exchange/openrtb/2.6-bid-request/), [2.6 response](https://docs.chartboost.com/en/partners/exchange/openrtb/2.6-bid-response/), [legacy 2.3](https://docs.chartboost.com/en/partners/exchange/openrtb/2.3-bid-request/)                                                                                                                        | Current і legacy mobile-game profiles                         |
| FreeWheel                | [Supported request objects](https://hub.freewheel.tv/x/goKnl), [response objects](https://hub.freewheel.tv/x/hoKnl)                                                                                                                                                                                                                                                                                  | 2.2/2.5/2.6, CTV, SSAI, pods, server-side extensions          |
| Sovrn                    | [OpenRTB specs](https://knowledge.sovrn.com/kb/sovrn-ortb-specs), [implementation guide](https://knowledge.sovrn.com/kb/sovrn-ortb-implementation-guide), [CTV](https://knowledge.sovrn.com/kb/ctv-inapp-specs-and-faqs)                                                                                                                                                                             | Core 2.5, passthrough 2.6, CTV/pods                           |
| Equativ                  | [Bidder integration](https://equativ.helpjuice.com/connect-bidder-to-equativ-ssp/connect-bidder-to-equativ-ssp-get-started), [examples](https://equativ.helpjuice.com/connect-bidder-to-equativ-ssp/connect-bidder-to-equativ-ssp-bid-request-and-bid-response-examples)                                                                                                                             | 2.2–2.5 плюс окремі 2.6 cases, Native                         |
| ExoClick                 | [OpenRTB supply](https://docs.exoclick.com/rtb/publishers/rtb-supply), [2.5 request](https://docs.exoclick.com/rtb/publishers/open-rtb/pub-open-rtb-2.5-request), [2.5 response](https://docs.exoclick.com/rtb/publishers/open-rtb/pub-open-rtb-2.5-response)                                                                                                                                        | OpenRTB 2.4/2.5, pop/push/native/video, нестандартний ADM     |
| TrafficStars             | [RTB Integration Guide](https://rtb-docs.trafficstars.com/)                                                                                                                                                                                                                                                                                                                                          | OpenRTB 2.5, Native 1.2, VAST 3, pop/push/full-page           |
| MGID                     | [DSP Integration Guide](https://help.mgid.com/openrtb-dsp-integration-guide)                                                                                                                                                                                                                                                                                                                         | OpenRTB 2.5, Native 1.1/1.2 та MGID response extensions       |
| Vistar Media             | [OpenRTB specification](https://help.vistarmedia.com/hc/en-us/articles/360035196692-OpenRTB-specification), [RTB documentation hub](https://help.vistarmedia.com/hc/en-us/categories/203551548-Bidders-RTB)                                                                                                                                                                                          | Сильний DOOH-профіль, price/impression semantics              |
| Hivestack                | [OpenRTB integration](https://docs.hivestack.com/docs/openrtb), [documentation overview](https://docs.hivestack.com/docs/hivestack-integration-documentation)                                                                                                                                                                                                                                        | OpenRTB 2.5 із DOOH screen/audience extensions                |

### Second wave — owner notes these are usable but lower priority or narrower

> - [TripleLift OpenRTB 2.5](https://docs.triplelift.com/docs/openrtb-25-2) та [Native 1.2](https://docs.triplelift.com/docs/openrtb-native-12-specification-1).
> - [Adform OpenRTB Handler](https://www.adformhelp.com/hc/en-us/articles/10431570694033-Adform-OpenRTB-Handler-Bid-Request-Specifications).
> - [Opera Ads OpenRTB 2.5](https://doc.adx.opera.com/adx/openrtb).
> - [Admixer RTB Stack SSP integration](https://helpcenter.admixer.com/openrtb-ssp-integration).
> - [EXADS OpenRTB 2.5](https://docs.exads.com/docs/rtb-advertisers/open-rtb/open-rtb-advertisers/).
> - [Insticator/Cool Media Direct OpenRTB](https://documentation.cool.co/docs/rtb).
> - [RevContent SSP/DSP onboarding](https://help.revcontent.com/knowledge/common-ssp-onboarding-questions) — корисний профіль, але не повна таблиця всіх об'єктів.
> - [Adspin SSP integration](https://www.adspin.io/integratessp).
> - [Nexx360 OpenRTB](https://developer.nexx360.io/openrtb/introduction) — важливо: Nexx360 не є Nexxen.

### Separate catalogue of JSON/XML feed dialects — owner states these must not be mixed into the OpenRTB schema

> - [ExoClick RTB 1.0](https://docs.exoclick.com/rtb/publishers/exoclick-rtb/exoclick-rtb) — proprietary JSON/XML.
> - [Zeropark Redirect RTB](https://doc.zeropark.com/article/redirect-rtb-integration-xml-json-open-rtb) — JSON/XML redirect feed.
> - [RichAds Telegram SSP](https://docs.richads.com/ssp/overview.html) — proprietary JSON для native/interstitial/banner/bot message.
> - [Outbrain Endpoint API](https://developer.outbrain.com/apis/outbrain-endpoint-api-guide-server-server/) — recommendation retrieval, не auction protocol.
> - [RevContent RevShifter/feed](https://help.revcontent.com/knowledge/revshifter) — request-параметри відкриті, response-схема описана лише частково.

### Outreach queue — owner did not confirm a complete public wire spec

> - PropellerAds — є [SSP management API](https://ssp-api.propellerads.com/v5/docs/) і заявлена підтримка oRTB/XML/JSON, але немає field-level bid protocol. Це ваш P0-кандидат на запит документації.
> - Amazon APS/TAM — [сторінка Programmatic Bidders](https://publishers.advertising.a2z.com/aps/services/programmatic-bidders/index.html) відсилає до документації після створення акаунта.
> - OpenX, PubMatic, Magnite — документація або закрита логіном, або публічні сторінки не містять повної request/response-спеки.
> - Yahoo DSP, Criteo/Commerce Grid, Sharethrough, Mintegral, Pangle, Moloco, StackAdapt, GumGum, Kargo, LoopMe, Nexxen/Unruly.
> - Adsterra, Clickadu, AdMaven, Bidvertiser, RollerAds — публічно заявляють RTB/feed-інтеграції, але schema відсутня.

### Owner's proposed registry shape

> Один `dialect_id` має містити:
>
> - owner, aliases та напрямок `supply → buyer` або `exchange → bidder`;
> - базову версію OpenRTB і media type;
> - supported, required, conditional, ignored і forbidden fields;
> - vendor `ext` objects та enums;
> - headers, gzip, timeout, no-bid status;
> - macros, win/loss/billing semantics;
> - fixtures, URL джерела, дату та hash версії документації.
>
> Валідація повинна бути детермінованою. Модель можна використовувати для витягування правил і
> пояснення помилок, але не як остаточне джерело істини.
>
> Також я б залишив явний вибір діалекту, а auto-detect показував лише як підказку з confidence:
> партнерські `ext` нерідко просто передаються далі через кілька платформ.
>
> Базою реєстру мають стати [IAB OpenRTB 2.6 living specification](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md)
> і окремий інфраструктурний профіль [Prebid Server `/openrtb2/auction`](https://docs.prebid.org/prebid-server/endpoints/openrtb2/pbs-endpoint-auction).
> Публічні документи краще не дзеркалити повністю: зберігати похідні правила, тести, посилання і
> provenance.

### URL Trust Policy branch

**No URL in this intake was fetched.** The idea arrived as pasted text that already carries the
owner's own reachability check; intake records links as data. Retrieval is research-stage work and is
subject to the policy at that point. The one exception predates this intake: the Google Authorized
Buyers set was retrieved earlier in the same session on direct instruction, and is described under
prior work below.

## Restated

Add a registry of named partner profiles on top of the IAB OpenRTB baseline, so a payload can be
reported as conforming to the base specification while simultaneously non-conforming to a specific
partner's documented profile, with the differences named field by field. The owner supplies a
verified list of partners whose profiles are publicly documented, a proposed content model for a
profile entry, and constraints on determinism, provenance, and how a profile is selected.

## Origin & Context

- **Raised by**: the project owner, 2026-08-20, in direct response to an assistant proposal to
  attribute payloads to vendor dialects.
- **Trigger**: a question about whether the project uses Google's Authorized Buyers documentation
  (it does not). That established the material exists, is licence-clean, and is machine-readable,
  which prompted the owner to widen the idea from one vendor to a registry and to supply the list.
- **Owner's stated position on readiness**: "Питань, які блокують старт, немає."

## Prior Work Already on Disk (read-only observation)

Recorded so the research stage does not repeat it, not as a finding:

- The Google Authorized Buyers set was retrieved on 2026-08-20 to
  `~/.local/share/ortbtools-research/google-rtb-2026-08-20/` — 42 documentation pages, raw HTML kept
  beside the derived Markdown, plus proto definitions and 21 RTB dictionaries. Deliberately **not**
  vendored: placement is a Spec Kit decision.
- Licence verified in the retrieved page footer: CC BY 4.0 for content and Apache 2.0 for code
  samples, which clears the floor in `packages/core/knowledge_base/SOURCES.md`. CC BY carries an
  attribution obligation. The `storage.googleapis.com/adx-rtb-dictionaries/*` files carry no footer
  of their own and are unlicensed until checked separately.
- `openrtb-adx-proto.txt` (protocol v.210) declares Google's dialect machine-readably: 200 extension
  fields across 21 oRTB objects, of which 82 top-level keys are not industry-shared. Signal strength
  is very uneven — `google_query_id` and `dfp_ad_unit_code` are near-signatures, `amp` and `memory`
  are not.

## Current Repository State (read-only observation)

- `packages/core/index.js` holds a `DIALECTS` registry (`iab`, `ext-rtb`, `inpage-push`) with
  `DEFAULT_DIALECT = 'iab'`. The dialect is supplied by the caller through `opts.dialect`; nothing
  detects it. The named-overlay mechanism the idea needs therefore already exists in outline.
- `packages/core/dialects/shape-fingerprint.js` opens with an explicit boundary: "No vendor
  identifiers … The vendor mapping is NOT in this file — that lives in each user's saved dialect."
- `packages/core/rules/dialects-questions/index.js` carries a matching instruction on its IAB
  known-key sets: "NEVER add vendor-specific custom keys — those belong in user dialects."
- ADR-005 (Accepted, 2026-05-12) states that "a named built-in overlay requires public documentation
  or representative synthetic/redacted evidence plus regression tests", and separately that discovery
  "does not assign authoritative meaning". Whether the idea sits inside that clause or requires a new
  decision is a question for the define stage, recorded below rather than answered here.
- `packages/core/knowledge_base/SOURCES.md` already lists a Tier 3 of SSP/DSP public documentation
  (Xandr, Equativ, Magnite, OpenX) with a licence floor. Google is absent from it.
- `tests/docs-truth.test.js` gates documentation claims against the checked-in repository state, so a
  product claim about partner coverage has a mechanical check attached to it.

## Owner Decisions Taken at Intake

Recorded as captured fact, not as evaluation. Both were answered by the owner on 2026-08-20 in
response to the unknowns listed below, and the corresponding entries are annotated there.

- **A partner profile is strictly additive.** It may never suppress or downgrade an IAB baseline
  finding. "Ignored by partner" becomes a separate informational signal shown alongside the baseline
  result, not a replacement for it. This is the most conservative of the options offered and removes
  the ADR-005 "especially strong evidence" burden entirely, because nothing in the registry can
  suppress a baseline finding by construction.
- **Research covers all partners in parallel; the build boundary stays open.** The owner directed
  that the full list be researched concurrently rather than sampled. The ROADMAP P3 gate constrains
  what is _built_ first, not how much evidence is gathered, so breadth at the research stage and one
  bounded problem at the build stage are compatible. The choice of first profile is deferred until
  the evidence is in.

## First-Glance Unknowns

- [NEEDS CLARIFICATION: What is the one bounded problem? The ROADMAP P3 gate requires one; the intake
  carries 21 first-wave partners, 9 second-wave, 5 feed dialects and an outreach queue. Candidate
  boundaries include the profile schema alone, the schema plus one reference partner, or the
  attribution mechanism alone — these are materially different pieces of work.]
- [NEEDS CLARIFICATION: Does a documented partner profile fall inside ADR-005's existing
  "named built-in overlay" clause, or does the registry constitute a new decision? The clause names
  public documentation plus regression tests as the bar, which the first wave appears to clear, but
  the two in-code boundaries quoted above were written on the opposite assumption.]
- **ANSWERED 2026-08-20 — strictly additive; see Owner Decisions above.** ~~[NEEDS CLARIFICATION: Can a partner profile ever suppress or downgrade an IAB baseline finding, or
  is it strictly additive? ADR-005 requires "especially strong evidence, a compatibility review, and
  regression coverage" for anything that suppresses a baseline finding, and "поле Y ігнорується
  партнером" in the owner's target message reads as a candidate suppression.]~~
- [NEEDS CLARIFICATION: What does "ігнорується партнером" mean as a finding severity? It is neither
  an error nor a pass; the existing severity registry may or may not have a slot for it.]
- [NEEDS CLARIFICATION: How is a profile kept honest as partner documentation changes? The owner
  proposes storing a date and hash of the documentation version, which implies a drift check, and
  it is unclear whether that check is manual, scheduled, or absent.]
- [NEEDS CLARIFICATION: Where does the derived-rule data live — `packages/core` as code, a data file,
  or the knowledge base? The owner's constraint is to store derived rules, tests, links and
  provenance rather than mirroring documents, but not where.]
- [NEEDS CLARIFICATION: Both directions are in scope for several partners (Xandr bidder vs supply,
  Index Exchange DSP vs seller, InMobi DSP vs supply, BidSwitch buyer vs supplier). Is a direction a
  separate `dialect_id` or a facet of one?]
- [NEEDS CLARIFICATION: What licence applies to each non-Google source, and does any of the first
  wave fail the `SOURCES.md` floor? Only Google has been checked. A partner whose terms forbid
  derived redistribution would have to be dropped or handled differently.]
- [NEEDS CLARIFICATION: The owner constrains a model to rule extraction and error explanation, never
  as the source of truth. Rule extraction from documentation is a use no existing ADR covers —
  ADR-003 governs interactive paths and ADR-012 covers one labelling path. Is an offline extraction
  pipeline in scope for this assessment or a separate one?]
- [NEEDS CLARIFICATION: How does attribution avoid claiming origin? The owner already flags that
  partner `ext` fields are frequently passed through several platforms, so a confident-looking
  attribution can be wrong for a structurally correct reason. What confidence presentation makes
  that honest rather than merely hedged?]
- [NEEDS CLARIFICATION: Does the feed-dialect catalogue belong to this assessment at all? The owner
  says it must not be mixed into the OpenRTB schema, and `rules-feed.js` plus `non-iab-formats.js`
  already cover part of that ground.]
- [NEEDS CLARIFICATION: Is the Prebid Server `/openrtb2/auction` infrastructure profile the same kind
  of object as a partner profile, or a different kind that happens to share the registry?]
