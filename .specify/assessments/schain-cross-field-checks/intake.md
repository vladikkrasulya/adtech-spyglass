# Idea Intake: SChain Cross-Field Checks for Video/CTV

- **Slug**: schain-cross-field-checks
- **Created**: 2026-08-14
- **Source**: pasted text (AI assistant session, 2026-08-14), following a research question about what `schain` is in the oRTB video context
- **Type**: improvement

## Idea (as captured)

> Запиши це в speckit як те що треба буде додати і протестувати найближчими апдейтами

The "це" refers to the closing section of a research answer given in the same session, which listed
checks the current SChain validator does not perform:

> Чого там принципово немає і що є наступним рівнем глибини (усе це — перевірки, які **можна зробити
> з однієї транзакції**, без походу в мережу):
>
> - **`complete: 1` при одному вузлі, який не є паблішерською SSP** — найдешевший спосіб приховати походження;
> - **дублікати `asi`** в ланцюжку або вузол, що повторює сам себе;
> - **невідповідність останнього вузла тому, хто реально шле запит** (звірка з полем, за яким ви ідентифікуєте партнера);
> - **`node[0].domain` vs `site.domain` / `app.bundle`** — перший вузол претендує на паблішера, чий домен не збігається з інвентарем у запиті;
> - **`schain` присутній в обох локаціях і вони різні** — зараз обидві валідуються, але розбіжність між ними не діагностується, а це класична ознака двох різних кодових шляхів, що склеїлися;
> - **довжина ланцюжка** як сигнал (4+ вузли у відео — привід питати).

One further item was raised alongside these: the **serialized SChain string form** used in VAST-tag /
non-oRTB video requests (`{об'єкт}!{вузол}!{вузол}`, comma-delimited, URL-encoded values), which is
where the chain is most often lost or mangled on video paths.

### Research context recorded in the same session

Findings that motivated the list (external sources, not repository evidence):

- SChain placement differs by protocol version: `source.schain` (oRTB 2.6+), `source.ext.schain`
  (2.5), `BidRequest.ext.schain` (2.4 and earlier), and a serialized `schain=` URL parameter for
  VAST-tag video requests — per the IAB SupplyChain object specification.
- The specification requires a reseller to insert its own node; copying a chain forward unchanged is
  invalid.
- HUMAN Security reports SChain presence at roughly 94% for web inventory but ~62% for app inventory
  (which includes CTV), with close to 70% of app-inventory chains invalid — i.e. the worst data
  quality sits exactly where video/CTV chains are longest.
- Brand-side supply-path audits reported in 2026 are focused on CTV and video specifically.

### Current repository state (read-only observation)

- `packages/core/rules/schain/index.js` validates both `source.schain` and `source.ext.schain`
  independently, covering `ver` / `complete` / `nodes` and per-node `asi` / `sid` / `hp` / `rid` /
  `domain`. Every existing finding is single-field and structural.
- A migration rule and fixtures already exist for the `source.ext.schain` → `source.schain` move
  (`tests/fixtures/migrate/source-schain.before.json` / `.after.json`).
- `samples/synthetic-schain-malformed.json` exercises `err-schain-version` and
  `err-schain-nodes-empty`.

## Restated

Extend SChain validation beyond per-field structural checks to cross-field consistency checks that
can be derived from a single transaction without any network lookup, with attention to the
video/CTV failure modes, and consider whether the serialized VAST-tag SChain string is in scope as an
input form.

## Origin & Context

- **Raised by**: AI assistant, drafted as the "next level of depth" section of a research answer, and
  explicitly accepted by the user with the instruction to record it for upcoming updates.
- **Trigger**: The user asked what `schain` is in the oRTB video context; the research surfaced that
  the failure modes that matter in video/CTV are cross-field, while the shipped rule is per-field.

## First-Glance Unknowns

- [NEEDS CLARIFICATION: Which of these checks are ERROR and which are WARNING? "Chain length ≥ 4" and
  "`complete: 1` with a single node" are signals, not specification violations — the SupplyChain spec
  does not forbid either.]
- [NEEDS CLARIFICATION: How is "not a publisher SSP" determined without `sellers.json`? The
  no-network constraint may make that specific check underivable as stated, or reduce it to a weaker
  heuristic.]
- [NEEDS CLARIFICATION: What counts as a `node[0].domain` vs `site.domain` / `app.bundle` mismatch
  that is worth reporting? Subdomains, publisher-owned alternate domains, and CTV bundle-ID formats
  (which differ per platform for the same app) all produce legitimate divergence — false-positive
  risk needs bounding.]
- [NEEDS CLARIFICATION: Is divergence between `source.schain` and `source.ext.schain` an error, or is
  dual-emission the expected 2.5→2.6 transition practice? If dual-emission is expected, only
  _differing content_ is the defect — needs a comparison rule (deep equality? node-array equality?).]
- [NEEDS CLARIFICATION: Does the "last node vs who actually sent the request" check have any
  in-payload counterpart, given that the tool inspects a payload with no session/partner identity
  attached?]
- [NEEDS CLARIFICATION: Is the serialized VAST-tag `schain=` string in scope at all? The current
  decoder surface accepts oRTB request/response payloads; accepting a URL parameter form would be a
  new input type, not a new rule.]
- [NEEDS CLARIFICATION: Should the video-specific checks gate on `imp[].video` being present, or
  apply to every request with a chain length threshold that differs by media type?]
- [NEEDS CLARIFICATION: What is the interaction with the existing `source.ext.schain` → `source.schain`
  migration rule — does migration output need to satisfy the new checks, and do the new checks fire on
  pre-migration payloads?]
- [NEEDS CLARIFICATION: How many new finding IDs does this add, and does each need en/uk/ru message
  copy at the same explanatory depth as the existing `schain` messages?]
