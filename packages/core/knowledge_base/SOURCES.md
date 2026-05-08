# Knowledge Base — Sources & Collection Plan

The Knowledge Base bootstraps from hand-synthesized samples (already
checked in) and grows through deliberate, license-clean ingestion of
public reference material. This document is the playbook.

## Collection rules

1. **License floor**: MIT, Apache-2.0, BSD, CC-BY, CC0, public domain.
   No copy-paste from blog posts, vendor PDFs marked "confidential",
   or scraped customer payloads.
2. **No PII**: every imported sample passes the same denylist as the
   discovery walker (`packages/core/intel/walker.js`). Specifically
   strip / synthesise: `buyeruid`, `ifa`, `idfa`, `gaid`, `ip`, `ipv6`,
   `consent`, `gpp`, `geo.lat`, `geo.lon`, `user.id`, `user.email`.
3. **Provenance**: every entry in `manifest.json` carries a `source`
   field. If it cites a URL, that URL is the canonical place where the
   sample (or the spec passage it was synthesized from) lives.
4. **Minimality**: prefer the smallest payload that demonstrates the
   format. Two 3KB samples beat one 30KB sample.

## Open sources to harvest

### Tier 1 — IAB official

| Source             | URL                                                        | Notes                                                                                            |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| OpenRTB 2.x spec   | https://github.com/InteractiveAdvertisingBureau/openrtb2.x | The 2.6 markdown has inline JSON samples in §6 (Examples). License: noted per-file; majority CC. |
| AdCOM 1.0 spec     | https://github.com/InteractiveAdvertisingBureau/AdCOM      | For oRTB 3.0 examples.                                                                           |
| OpenRTB Native 1.2 | https://github.com/InteractiveAdvertisingBureau/openrtb    | Native asset request/response sample blocks.                                                     |
| VAST 4.x examples  | https://iabtechlab.com/standards/vast/                     | XML samples — KB stores them as `adm` strings inside response fixtures.                          |

### Tier 2 — Prebid.js (Apache-2.0)

| Source                  | URL                                                                         | Notes                                                                   |
| ----------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Prebid.js test fixtures | https://github.com/prebid/Prebid.js/tree/master/test/spec/modules           | Each adapter has its own request/response samples. License: Apache-2.0. |
| Prebid Server Java      | https://github.com/prebid/prebid-server-java/tree/master/src/test/resources | Cleaner JSON fixtures than the JS repo.                                 |

### Tier 3 — SSP/DSP public docs

| Vendor            | URL                                                                 | Format coverage                                                      |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Xandr (Microsoft) | https://learn.microsoft.com/en-us/xandr/bidders/openrtb-rtb-bidders | Request/response examples per format. Terms allow educational reuse. |
| Equativ (Smart)   | https://help.smartadserver.com/                                     | Public sample payloads for native + video.                           |
| Magnite           | https://docs.prebid.org/dev-docs/bidders/magnite.html               | Via Prebid docs (Apache-2.0).                                        |
| OpenX             | https://docs.prebid.org/dev-docs/bidders/openx.html                 | Via Prebid docs.                                                     |

### Tier 4 — JsonFeed CIS networks (per `spyglass_jsonfeed_research.md`)

Documented vendors with public-facing API docs (4/12 from the 2026-05-04
research): four CIS push/pop networks. Samples should match what the
existing `rules-feed.js` already detects.

## Ingestion plan

### Phase 10a (now)

- 6–8 hand-synthesized seeds covering each top-level format.
- Pure JSON, no automation. Just enough to make `format-detect.js`
  testable end-to-end and let the LLM few-shot loader return a
  non-empty result for every supported bucket.

### Phase 10b (next sprint)

- Write `scripts/fetch-fixtures.mjs` — Node script that:
  1. Pulls Prebid.js test fixtures from a pinned commit.
  2. Walks the `test/spec/modules/*Spec.js` files, extracts inline
     request/response objects.
  3. Runs them through the privacy denylist.
  4. Sorts into `knowledge_base/<spec>/<side>/<format>/` based on
     `detectFormat()` output.
  5. Writes provenance entries to `manifest.json`.
- Run quarterly (matches Prebid.js release cadence). Pin the upstream
  commit so re-runs are deterministic.
- Output is reviewed by hand before merge — no auto-commits.

### Phase 10c (later)

- IAB markdown extraction: parse the OpenRTB 2.6 markdown spec, pull
  the `json` fenced blocks, classify by surrounding section, write to
  `knowledge_base/ortb-2.6/`.
- VAST sample extraction (XML — store as response `adm` strings).

## What we do NOT ingest

- Customer bidstream replay (privacy floor).
- Anything from a `confidential` or `internal` doc.
- Vendor SDKs themselves (only their declared sample payloads).
- Real consent strings or device IDs, even from public samples — we
  always replace them with synthetic placeholders before checkin.
