# Spyglass — Next Chapters

End-of-day 2026-05-09 strategic doc. Validator coverage is mature
(v0.14.0): IAB 2.5/2.6 full + 3.0 envelope routing + VAST 12 rules + 12
behavior detection patterns shipped on 2026-05-06. This document surveys
where the product extends NEXT — not next-week patches, but month-scale
chapters.

The canonical brief is in `MEMORY.md`. The architecture map is in
[`ARCHMAP.md`](./ARCHMAP.md). The roadmap that closed today is in
[`validator-roadmap-2026-05-09.md`](./validator-roadmap-2026-05-09.md).

---

## Where we are

**Mature surface**:

- Validator: oRTB 2.5/2.6 schema + 3.0 envelope (req + resp), 3 oRTB dialects (iab / kadam / kadam-inpage-push) + 4 JsonFeed handlers (kadam / exoclick / richads / zeropark)
- VAST: 12 rules (8 envelope + 4 quality)
- Behavior: 16 detection patterns across misclick / bot-patterns /
  malicious / static creative scan
- API stability: deterministic order, dedup, disabledRules option
- 463 tests (count refreshed 2026-05-10), 3 locales (en/uk/ru), public site through CF tunnel
- LLM bridge (Spyglass Intel) using gemma3:4b on Ollama

**Where it's still 0.x**:

- AdCOM 1.0 deep validation (3.0 placement specs, bid.media)
- i18n debt — ~30 hardcoded UK strings in `spyglass.app.js`
- Real-world precision/recall on behavior — only synthetic corpus
- Inspector pattern (paste → findings) only; no continuous monitoring

---

## Chapter A — From inspector to **monitor** (~1-2 weeks)

> Currently: user pastes JSON, gets findings. Next: feed live traffic in,
> get a stream of findings + dashboards.

The Stream Pivot from 2026-05-05 framed this — Spyglass becomes a public
RTB observability platform, not just a one-off paste tool. Foundations
are in place (samples lib, /api/v1/sample, format detection, behavior
analyzer is browser+Node compat).

**Concrete pieces**:

1. **Specimen replay endpoint** — `POST /api/v1/replay { samples: [...] }`
   that runs validator + crosscheck + behavior over an array, returns a
   summary. Already a 70%-built path; needs API + tests + UI.
2. **Real-time stream ingestion** — SSE endpoint that accepts streamed
   pairs (req/resp) from a partner DSP, runs analyze, surfaces findings
   to a public dashboard. Needs auth + rate-limiting + persistence.
3. **Aggregate findings dashboard** — "% bids with VAST insecure URL
   over the last 1k requests", "top finding ids by frequency", "%
   bids with vpaid_deprecated". OLAP-style — ClickHouse fits if we
   want history.

**Risk**: scope creep. Easy to morph this into a SaaS. Stay narrow —
keep "paste & inspect" as the primary doorway, monitoring is a
secondary mode.

**Sizing**: 1-2 weeks for the replay endpoint + dashboard MVP. Stream
ingestion is a separate week if user wants partner DSP integration.

---

## Chapter B — Behavior v2: **real corpus + tuning** (~3-5 days)

Behavior epic CLOSED on 2026-05-06 with synthetic samples. Memory
flagged that real-world precision/recall isn't characterized.

**Concrete pieces**:

1. **Capture pipeline**: button on the inspector "Save current event
   stream as labelled corpus entry". Tagged by user (legitimate /
   fraud / ambiguous). Stored in samples DB.
2. **Confusion matrix doc**: every Friday run all 16 detection patterns
   over the corpus, log false-positive / false-negative rates per id.
3. **Patterns deferred from epic memory**:
   - `behavior.bot.center_pixel_perfect` (isTrusted=true, dist<1px)
   - `behavior.bot.double_too_fast` (2 clicks <100ms)
   - These need labelled corpus to calibrate FP rates BEFORE shipping.
4. **`performance.memory` tracking** — Chrome-only signal. Real-world
   traffic answers whether the FP rate justifies adding it.

**Sizing**: capture + matrix UI in 1-2 days; tuning is iterative, ongoing.

---

## Chapter C — **AdCOM 1.0** + 3.0 deep validation (~1 week)

The deferral most likely to bite: every 3.0 finding today emits the
`*.30.deep_validation_limited` INFO note. If real 3.0 traffic shows up,
we go deep on AdCOM:

1. **Placement specs**: `item.spec.placement.{display,video,native,...}`
   — analogous to 2.x banner/video/native objects but per AdCOM 1.0
2. **Creative response**: `bid.media.{display,video,...}` — same dual
3. **AdCOM enums**: pos, ctxsubtype, plcmttype, etc. — currently 2.x
   has these, 3.0 references them via AdCOM but we don't validate

Realistic only when there's traffic to test against — IAB says
production 3.0 is essentially nil. Keep as a "ready to build when
asked" bucket, not a sprint.

**Sizing**: 1 week with traffic to test against. **Don't start without it.**

---

## Chapter D — **i18n technical debt** (~3-4 days, mechanical)

Memory `spyglass_i18n_debt.md` flags ~30 hardcoded UK strings in
`spyglass.app.js`. Pre-existing, never bucketed. The reason it's not
done yet: tedious, low ROI, no business pressure.

**Sizing**: 3-4 days dedicated. Best done as a clean sprint — find
all strings, add to all 3 locale files, replace inline UK with
`t()` calls. Tests would catch regressions.

**Could AI-batch**: prompt LLM with each string + context, ask for
EN + RU translations matching tone. Reduce 3-4 days to ~1 day with
human review.

---

## Chapter E — **API platform** (~2 weeks)

Currently `/api/analyze` is single-call public. To become a platform
other tools integrate with:

1. Authenticated API keys (per-account rate-limits, usage logs)
2. Webhook on findings (notify a channel when X finding fires)
3. CLI package (`@kyivtech/spyglass-cli`) — reads stdin, outputs
   JSON. CI integration.
4. GitHub Action wrapper around the CLI — PR comments with findings
5. SDK (`@kyivtech/spyglass-client` for Node/browser) wrapping the
   HTTP API with typings

**Risk**: this is "build a SaaS" energy. Only worth doing if user has
clear demand from at least 2-3 external users. Don't speculate.

**Sizing**: 2 weeks for the auth + CLI + Action triple, if priorities.

---

## Recommended ordering (my opinion)

1. **First**: Chapter B (behavior tuning). Cheap, builds the corpus we'll
   need for everything else. Concrete weekly artifact (confusion matrix).
2. **If user wants visible progress**: Chapter A specimen replay (~3 days
   for the endpoint MVP). Demonstrable on the public site.
3. **Strategic only if user has external interest**: Chapter E (API
   platform). Otherwise skip.
4. **Defer until traffic shows up**: Chapter C (AdCOM). Don't pre-build.
5. **Nights/weekends**: Chapter D (i18n). Mechanical, AI-assistable.

---

## What's NOT in this doc (intentional)

- **Spyglass Intel (LLM bridge)** — separate roadmap. Phase 7c shipped
  with gemma3:4b; few-shot wiring + format-badge done in v9.8.0. Next
  steps belong in a separate doc when user wants to expand.
- **Stream platform launch & marketing** — strategic, not technical.
- **Pricing / hosting / infra** — out of scope for a code roadmap.
- **`Behavior & Anti-Fraud` listed in canonical brief MEMORY.md is
  STALE** — it shipped 2026-05-06; memory says "next epic" but it's
  closed. Will update memory in same commit as this doc lands.
