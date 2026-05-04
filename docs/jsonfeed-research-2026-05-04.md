# JsonFeed validator research — CIS adtech non-oRTB formats

Dated 2026-05-04. Research-only; no code changes.

## Goal

Spec a "JsonFeed baseline validator" for Spyglass alongside the existing oRTB validator. World mostly speaks oRTB; CIS networks frequently speak proprietary GET-with-query-params or POST-JSON variants. Pattern target: IAB-baseline + per-vendor overlay (same as the existing `dialects/iab.js` + `dialects/kadam.js` split).

This doc captures (a) what each vendor's *non-oRTB* surface actually looks like, (b) what fields are common across vendors, and (c) which vendors are worth overlaying first.

Method note: probe public dev docs only. Where a vendor's docs are gated, I fall back to public help-center articles, GitHub repos, or third-party tracker integration pages. "Gated" is called out per-vendor.

---

## Tier 1 — must cover

### Kadam (kadam.net)

**Doc URLs**
- Feed + oRTB SSP integration: https://wiki.kadam.net/en/index.php?title=OpenRTB/Feed_Integration_SSP (public)
- Management API (Bearer token, campaigns/materials/audiences/reports): https://wiki.kadam.net/en/index.php?title=API_setting (public)
- RTB settings: https://wiki.kadam.net/en/index.php?title=RTB_setting

**Envelope**
- *Two parallel surfaces:* oRTB endpoint (already covered by `dialects/kadam.js`) **and** a separate proprietary `/feed` surface.
- Feed = HTTP GET with URL query params, response = JSON array (or XML).
- Auth = `skey` query param.

**Feed request fields (proprietary, GET)**

| field | type | req | meaning |
|---|---|---|---|
| `sid` | string | yes | endpoint/stream id |
| `skey` | string | yes | API key |
| `ua` | string | yes | user agent |
| `ip` | string | cond | IPv4, required if no `ipv6` |
| `ipv6` | string | cond | IPv6, required if no `ip` |
| `uid` | string | yes | user id in SSP system |
| `pid` | string | yes | publisher id |
| `format` | string | yes | `push` (default) / `native` / `teaser` / `cu` / `pops` |
| `limit` | int | no | creatives, default 1 |
| `language` | string | no | ISO 3166-1 alpha-2 |
| `subage` / `subage_dt` / `subage_ts` | int/str | cond | push subscription age (mandatory for push) |
| `cat` | string | no | IAB category, default IAB24 / IAB25-3 |
| `page` | string | rec | page domain |

**Feed response fields**

```json
[{
  "id": "5555555",
  "impid": "5",
  "crid": "555555",
  "click_url": "https://...",
  "campaign_id": 555555,
  "category": "1368",
  "title": "It's like nothing you've ever seen!",
  "text": "The cutest kittens",
  "image_url": "https://.../492x328/...",
  "icon_url": "https://.../nurl/...",
  "cpc": 0.0316
}]
```

`id`, `impid`, `crid`, `click_url` (alias `link`), `title`, `image_url`, `cpc` are required. `nurl`, `description`/`text`, `icon_url`, `category`, `campaign_id` are optional.

**Formats:** push, native, teaser, popunder, in-page push, iOS calendar push.

**Quirks:** GET with query params (not POST JSON). Push traffic identified via `subage*`. Push response shape (title/icon/image/text) matches Native 1.2-ish but is *not* native-spec encoded — flat top-level fields.

---

### PropellerAds (propellerads.com)

**Doc URLs**
- Swagger UI for SSP API v5: https://ssp-api.propellerads.com/v5/docs/ (public, but the Swagger page itself renders as an SPA; programmatic GETs return only the title)
- Propush.me API (publisher subscription/push management): https://help.propellerads.com/en/articles/4262401-propush-me-api (public)
- Help center: https://help.propellerads.com/en/

**Envelope**
- The public "SSP API v5" is **not** a bid feed — it's an OAuth/Bearer-token *management* API for advertisers (campaigns, statistics, zones). Same niche as Kadam's `/api/v1`.
- PropellerAds does not publish a public bid-feed spec. Demand-side integration ("DSP partners") is gated behind a partner manager.
- Propush.me API is also reporting/management-shaped — `/v5/statistics/pub-statistics`, `/v5/sites/pub-sites-list`, etc.

**Auth:** Bearer token issued from `app.propush.me/#/profile` (up to 10 tokens), passed as `Authorization: Bearer <token>`.

**Reporting endpoints (illustrative — Propush v5)**

| endpoint | purpose |
|---|---|
| `GET /v5/statistics/pub-statistics` | account stats; `date_from`, `date_to`, `group_by[]`, `zone_ids[]` |
| `GET /v5/sites/pub-sites-list` | added sites/landings |
| `GET /v5/sites/pub-zones-list` | zones list |

**Formats:** push, in-page push, popunder, interstitial, native.

**Conclusion for Spyglass:** there is no documented JsonFeed bid surface to validate. Skip from baseline; treat PropellerAds as oRTB-only. (If we ever get a partner spec, add a separate dialect.)

---

### RichAds (richads.com)

**Doc URLs**
- Docs portal: https://docs.richads.com/ (public)
- SSP overview: https://docs.richads.com/ssp/overview
- SSP — Telegram interstitial video bid endpoint: https://docs.richads.com/ssp/telegram-interstitial-video.html (public, has full spec)
- Publisher overview: https://docs.richads.com/publishers/overview

**Envelope**
- Proprietary POST-JSON, *not* oRTB.
- One bid endpoint per format; example below is `telegram-bid`. Other formats follow the same shape.

**Endpoint:** `POST http://{ssp_id}.xml.adx1.com/telegram-bid`

**Auth:** none documented; tied to `publisher_id` field (manager-issued).

**Request fields**

| field | type | req | meaning |
|---|---|---|---|
| `ip` | string | yes | user IPv4/IPv6 |
| `user_agent` | string | yes | full UA string |
| `publisher_id` | string | yes | unique publisher id |
| `language_code` | string | no | ISO 639-1 |
| `widget_id` | string | no | mini-app integration id |
| `telegram_id` | string | no | TG user id |
| `bid_floor` | float | no | min acceptable CPM |
| `number_of_bids` | int | no | 1–5, default 1 |
| `blocked_categories` | int[] | no | category ids to exclude |
| `premium` | bool | no | premium user, default false |
| `motivated` | bool | no | intentional action flag |
| `production` | bool | no | test mode if false, default true |

**Response (array of bids)**

| field | type | meaning |
|---|---|---|
| `title` | string | creative title |
| `message` | string | body text |
| `button` | string | CTA label |
| `video` | string | MP4/HLS URL (≤30s, 16:9) |
| `icon` | string | square ≥300×300 |
| `link` | string | destination URL |
| `notification_url` | string | impression pixel |
| `bid_price` | float | winning CPM |

**Formats:** push, in-page, pop, native, calendar, video, Telegram interstitial video, Telegram Mini Apps, interstitial.

**Quirks:** snake_case fields (most CIS networks use snake_case); fields named differently from Kadam (`user_agent` vs `ua`, `link` vs `click_url`, `bid_price` vs `cpc`).

---

### Adsterra (adsterra.com)

**Doc URLs**
- Publisher reporting API article: https://adsterra.com/blog/how-to-use-adsterra-publishers-api/ (public, reporting shape)
- Publisher API portal (reporting): https://api3.adsterratools.com/docs/publishers — **404 at time of probe**, doc URL referenced from blog only
- Ads API v3 (advertiser side): https://adsterra.com/blog/api-v3/
- RTB partner page: https://adsterra.com/rtb/

**Envelope**
- *Reporting API* — GET, `X-API-Key` header, JSON/XML/CSV output.
- *RTB SSP integration* — Adsterra accepts XML/JSON feed *or* OpenRTB endpoints from SSP partners. The actual feed schema is **not published**; it's negotiated per-partner via account manager. Stated constraints: ≤200 ms response, 100 kRPS capacity, first-price auction.
- No public proprietary JsonFeed schema.

**Auth:** `X-API-Key: <token>` header (reporting only).

**Conclusion for Spyglass:** like PropellerAds, the bid surface is gated. We cannot baseline against an unpublished schema. Skip Adsterra from JsonFeed v1; revisit if a partner spec lands.

---

### ClickAdu (clickadu.com)

**Doc URLs**
- API collection (help center): https://faq.clickadu.com/en/collections/3474608-api (public, 403 to fetcher but viewable)
- API documentation article: https://faq.clickadu.com/en/articles/6234861-api-documentation (gated to fetcher)
- API integration guide: https://faq.clickadu.com/en/articles/6234995-api-integration-guide (gated to fetcher)

**Envelope**
- Two surfaces: a *campaign-management* API (POST JSON with `Authorization` header, used by Voluum / Postman style integrations) and a *feed* surface that supports both XML and JSON (default JSON), shape negotiated with partner manager.
- Public articles describe the management API more thoroughly than the SSP/feed.

**Auth:** API token in header, `Content-Type: application/json`.

**Formats:** popunder (their flagship), push, in-page push, video, interstitial. They've called their format "SKIM" historically.

**Conclusion for Spyglass:** management API ≠ JsonFeed validator scope. Public feed schema not pinned down. Treat as deferred (until we get a partner doc).

---

## Tier 2 — medium depth

### AdMaven (ad-maven.com)

**Doc URLs**
- Publishers HelpDesk API category: https://publishers-help.ad-maven.com/en/category/api-1fvhmuv/ (public)
- Content Locker API: https://publishers-help.ad-maven.com/en/article/admaven-content-locker-api-documentation-11q0a5r/ (public, full spec)

**Envelope**
- Proprietary content-locker endpoint, *not* a bid feed.
- POST or GET; `POST https://publishers.ad-maven.com/api/public/content_locker`.

**Auth:** `Authorization: Bearer <token>` (POST) or `?api_token=<token>` query (GET).

**Request:**

| field | type | req | notes |
|---|---|---|---|
| `title` | string | yes | ≤30 chars |
| `url` | string | yes | valid link, URL-encode special chars |
| `background` | string | no | image or YouTube link |
| `sub_id` | string | no | ≤7 chars, must be pre-configured |

**Response:** `{ type: "created"|"fetched"|"error", request_time, message: { title, url, background, short, desturl } }`.

**Formats (broader product, not all in API):** popunder, lightbox, push, interstitial, content-locker.

**Conclusion:** the public API is *creator-side*, not an auction feed — out of scope for our JsonFeed validator.

---

### AdCash (adcash.com)

**Doc URLs**
- Advertiser Reporting API: https://support.adcash.com/en/articles/38-advertiser-reporting-api (public)
- Publisher Reporting API: https://support.adcash.com/en/articles/367-publisher-reporting-api (public)
- Voluum integration (third-party reference): https://doc.voluum.com/article/adcash-full-integration

**Envelope**
- Reporting only (token derived from username/password). No public JsonFeed/RTB schema.
- Filterable by date, country, campaign id, device type, pack id, platform; metrics impressions/clicks/conversions/spend.

**Conclusion:** out of scope for JsonFeed validator.

---

### EvaDav (evadav.com)

**Doc URLs**
- API (Swagger UI shell): https://evadavapi.com/docs/api (public; renders as SPA so HTTP fetchers see only the title)
- Publisher FAQ: https://evadav.com/faq-publisher
- Pop-up push article: https://support.evadav.com/en/articles/7250864-publishers-ad-formats-pop-up-push-notification

**Envelope**
- Public API exists but requires `apiKey` from manager and the schema is not published outside the Swagger UI. From observed integrations: standard reporting + campaign-management, JSON.
- Bid/feed surface for SSP partners is gated.

**Formats:** push, in-page, native, popunder.

**Conclusion:** not enough public schema to baseline against. Defer.

---

### Galaksion (galaksion.com)

**Doc URLs**
- Self-service / SSP product: https://galaksion.com/self-service
- CPV Lab integration page (third-party): https://doc.cpvlab.pro/integrations/galaksion-integration.html

**Envelope**
- No public dev docs. Tracker integration is via postback URL with macro tokens (`{clickid}`, etc.) — that's URL-params pixel, not a JsonFeed.
- Bid surface gated to direct partners.

**Formats:** popunder, native, on-page push, push, mobile push-up, interstitial.

**Conclusion:** out of scope for JsonFeed validator.

---

### Mondiad (mondiad.com)

**Doc URLs**
- Members API (Swagger shell): https://docs.api.members.mondiad.com/ (public; SPA — fetcher gets only the title, but the OpenAPI JSON is reachable inside)

**Envelope**
- Members API = campaign management / reporting, JSON over HTTPS, token auth.
- No public JsonFeed bid endpoint.

**Formats:** push, in-page, native, popunder.

**Conclusion:** out of scope for JsonFeed validator (reporting-shaped, not a bid surface).

---

## Tier 3 — light

### TrafficStars (trafficstars.com)

**Doc URLs**
- Integration API (GitHub, archived 2020): https://github.com/trafficstars/integrationapi
- Public API: gated behind login

**Envelope**
- The "Integration API" is a *complement* to OpenRTB, not a replacement. Custom HTTP headers (`X-Request-Ts`, `X-Response-Ts`, `X-Response-Node`, etc.) and a single `GET /v2/ssp/{id}/integration` endpoint with Basic auth that returns latency/success metrics.
- TrafficStars itself runs OpenRTB 2.x for bidding.

**Formats:** banner, popunder, video pre-roll/outstream, in-stream, native, push (adult vertical).

**Conclusion:** not a JsonFeed envelope — it's a sidecar telemetry API. Skip from JsonFeed validator entirely.

---

### ExoClick (exoclick.com)

**Doc URLs**
- Publisher RTB overview: https://docs.exoclick.com/docs/rtb-publishers/exoclick-rtb/ (public)
- Publisher request/response examples: https://docs.exoclick.com/docs/rtb-publishers/exoclick-rtb/exoclick-rtb-publisher-code-examples/ (public, full JSON examples)
- OpenRTB 2.4/2.5 reference: https://docs.exoclick.com/docs/rtb-publishers/open-rtb/

**Envelope**
- *Two parallel surfaces:* OpenRTB 2.4/2.5 *and* a proprietary "ExoClick RTB" template. The proprietary one is the relevant target here.
- Endpoint: `POST https://rtb.{network}/rtb.php` — POST JSON or GET URL-params.
- Currency EUR or USD per account; one bid per request.

**Request (push 720×480 example):**

```json
{
  "id": "d4b5c697-...",
  "ip": "131.34.123.159",
  "language": "en",
  "type": "push_notification",
  "remote_addr": "131.34.123.159",
  "x_forwarded_for": "120.52.73.97",
  "ua": "Mozilla/5.0 ...",
  "url": "https://sitedomain.com/page",
  "user_id": "57592f...",
  "sub": 4312,
  "export": "json",
  "keyword": "lifestyle, humour",
  "size": "720x480"
}
```

**Response:**

```json
{ "bid": {
  "id": "d4b5c697-...",
  "iconUrl": "http://.../myadicon.jpg",
  "clickUrl": "http://.../landingpages/mypage",
  "nUrl": "http://.../win-notification",
  "title": "My Ad Title",
  "description": "My Ad Description Text",
  "btype": 2,
  "value": 0.13
}}
```

**Fields**

| field | type | req | meaning |
|---|---|---|---|
| `id` | string | yes | request id |
| `ip` | string | yes | IPv4/IPv6 |
| `ua` | string | yes | UA |
| `type` | string | yes | format: `push_notification`, `banner`, `direct_link`, `email_clicks`, `popunder` |
| `url` | string | yes | page URL |
| `user_id` | string | rec | publisher-stable user id |
| `sub` | int | yes | publisher id |
| `export` | string | yes | `json` / `xml` |
| `language` | string | no | ISO |
| `size` | string | cond | `720x480` for push, `300x250` for banner |
| `keyword` | string | no | targeting hint |
| `remote_addr` / `x_forwarded_for` | string | no | extra IP signal |
| `el` | string | cond | base64 email (for direct-link/email-clicks) |

**Formats:** banner, direct link, email clicks, popunder, push notifications (720×480 and 192×192).

**Quirks:** camelCase response fields (`iconUrl`, `clickUrl`, `nUrl`) — opposite convention from Kadam/RichAds snake_case. `btype` integer enum (1=display, 2=link). 300 ms `tmax`. Adult/mainstream both supported.

---

## Bonus reference — Zeropark (Codewise)

Not in the original list, but Zeropark publishes the cleanest non-oRTB JsonFeed in the public CIS-adjacent space. Useful as a *baseline reference* because it strips the format down to the minimum.

- Doc: https://doc.zeropark.com/article/redirect-rtb-integration-xml-json-open-rtb (public)
- Endpoint: `GET https://feed.zeropark.com/zeroclick`
- Request: `feedid` (uuid), `domain`, `ip`, `useragent`, `responseformat=JSON` (all required); `fallbackurl`, `domainid`, `keywords`, `pubid`, `deviceid`, `secure`, `x_for_ip` (optional).
- Response: `{ bid, redirecturl, clickid, campaignid }`. HTTP 204 = no-bid.
- Format: pop/redirect only. No auth.

This is the smallest viable JsonFeed and a good shape to model "minimal pop redirect" on.

---

## Synthesis

### What's actually documentable

Of the 12 vendors:

- **Has a public, machine-readable proprietary JsonFeed bid spec:** Kadam `/feed`, ExoClick `rtb.php`, RichAds `telegram-bid`, Zeropark `zeroclick` (bonus). 4/12.
- **Has only a management/reporting API publicly:** PropellerAds, Propush, AdMaven content-locker, AdCash, EvaDav, Mondiad, ClickAdu. 7/12.
- **Has only an OpenRTB-with-extensions surface (covered by the existing oRTB validator + dialects):** Adsterra, EXADS-family, Kadam-oRTB, ExoClick-oRTB. Multi.
- **Has no public bid surface (gated, partner-only):** Adsterra-RTB, Galaksion, ClickAdu-feed, EvaDav-feed, Mondiad-feed.
- **Has only a sidecar telemetry API:** TrafficStars `integrationapi`.

So a public "JsonFeed" baseline can only be drawn from the four vendors that publish: **Kadam, ExoClick, RichAds, Zeropark.** Everyone else either uses oRTB (already covered) or hides the schema behind a partner manager.

### Common-baseline fields (≥60% of public JsonFeeds)

Looking at Kadam-feed + ExoClick-rtb + RichAds-telegram + Zeropark across request side:

| baseline field | Kadam | ExoClick | RichAds | Zeropark | %  |
|---|---|---|---|---|---|
| request id            | (impid)`impid`  | `id`     | (none)        | (none)    | 50% |
| user IP               | `ip`/`ipv6`     | `ip`     | `ip`          | `ip`      | 100% |
| user agent            | `ua`            | `ua`     | `user_agent`  | `useragent` | 100% |
| publisher id          | `pid`           | `sub`    | `publisher_id`| `domainid`/`feedid` | 100% |
| page / domain         | `page`          | `url`    | (n/a TG)      | `domain`  | 75% |
| language              | `language`      | `language` | `language_code` | (none) | 75% |
| ad format / type      | `format`        | `type`   | (path)        | (none)    | 50% |
| ad-count limit        | `limit`         | (1 only) | `number_of_bids` | (1 only) | 50% |
| bid floor             | (none)          | (none)   | `bid_floor`   | (none)    | 25% |
| keyword/category      | `cat`           | `keyword`| `blocked_categories` | `keywords` | 100% |
| user id               | `uid`           | `user_id`| `telegram_id` | (none)    | 75% |
| fallback URL          | (none)          | (none)   | (none)        | `fallbackurl` | 25% |

On the response side:

| baseline field | Kadam | ExoClick | RichAds | Zeropark | %  |
|---|---|---|---|---|---|
| bid price             | `cpc`           | `value`  | `bid_price`   | `bid`     | 100% |
| destination URL       | `click_url`/`link` | `clickUrl` | `link` | `redirecturl` | 100% |
| creative id           | `crid`          | `id`     | (none)        | `campaignid` | 75% |
| win-notify URL        | `nurl`          | `nUrl`   | `notification_url` | (none) | 75% |
| title                 | `title`         | `title`  | `title`       | (none)    | 75% |
| body / description    | `text`/`description` | `description` | `message` | (none) | 75% |
| icon URL              | `icon_url`      | `iconUrl`| `icon`        | (none)    | 75% |
| image URL             | `image_url`     | (n/a)    | (none)        | (none)    | 25% |
| video URL             | (none)          | (none)   | `video`       | (none)    | 25% |
| campaign id           | `campaign_id`   | (none)   | (none)        | `campaignid` | 50% |
| category              | `category`      | (none)   | (none)        | (none)    | 25% |
| no-bid signal         | (empty array)   | (empty obj) | (empty arr) | HTTP 204 | varies |

**Baseline candidates (≥75% coverage):**

Request side: `ip`, `ua`, `publisher_id`, `page`/`url`, `language`, `keywords`/`cat`, `user_id`.

Response side: `bid_price`, `click_url`, `creative_id`, `nurl`, `title`, `description`, `icon_url`.

These are the shape-of-a-JsonFeed fields. Anything beyond is overlay territory.

### Naming-convention deltas (the real annoyance)

Even on the same semantic field, vendors disagree:

| concept | Kadam | ExoClick | RichAds | Zeropark |
|---|---|---|---|---|
| user agent | `ua` | `ua` | `user_agent` | `useragent` |
| page URL | `page` | `url` | (n/a) | `domain` |
| publisher id | `pid` | `sub` | `publisher_id` | `domainid` |
| bid price | `cpc` | `value` | `bid_price` | `bid` |
| click URL | `click_url` / `link` | `clickUrl` | `link` | `redirecturl` |
| win notify | `nurl` | `nUrl` | `notification_url` | (none) |

Implication: the JsonFeed baseline validator has to be **field-aliased**, not field-named. Each "logical field" is a set of acceptable keys per dialect — closer to how Prebid's `params` adapters work than how `dialects/iab.js` works today. The baseline validates *presence* of a logical field, the dialect resolves which physical key is in use.

### Vendor-specific overlay fields (beyond baseline)

- **Kadam:** `sid`, `skey`, `subage*`, `format` enum, `cat` IAB taxonomy, response `impid`.
- **ExoClick:** `sub` numeric, `type` enum, `el` (base64 email), `size` string, `export` format selector, response `btype` enum.
- **RichAds:** `widget_id`, `telegram_id`, `bid_floor`, `number_of_bids`, `premium`/`motivated`/`production` booleans.
- **Zeropark:** `feedid` UUID, `responseformat` enum, `secure` bool, `fallbackurl`, HTTP 204 no-bid signal.

### Recommended implementation order

1. **Kadam-feed dialect first.** It's the format we already have business reason to support (existing Kadam oRTB overlay), the docs are the most complete, and it's the densest field set. New finding namespace: `kadam_feed.*`. Keep separate from existing `kadam.*` (which is oRTB-overlay).
2. **ExoClick proprietary RTB second.** Adult-vertical coverage that oRTB 2.6 doesn't reach cleanly. Endpoint shape is similar enough to Kadam that a shared "GET-with-params or POST-JSON" detector can carry both. Namespace: `exoclick.*`.
3. **JsonFeed-baseline detector + minimal validator third.** Once two vendors are real, factor out the common-baseline check into `rules-jsonfeed.js` (parallel to `rules-feed.js`). Use field-alias map (see deltas table above) so a single set of "must-have logical fields" rules applies across vendors.
4. **RichAds Telegram fourth.** Format-specific (TG mini apps + interstitial video). Worth doing only if Telegram TMA traffic shows up in user-pasted samples. Namespace: `richads.*`.
5. **Zeropark fifth (optional).** Tiny surface, useful as a regression test fixture more than a real validator target.

### Risk / blockers

- **PropellerAds, Adsterra, ClickAdu, EvaDav, AdCash, Galaksion, Mondiad** — no public JsonFeed bid spec. Cannot baseline. If a user pastes one of these, our best result is to fall back to "looks like a JsonFeed but vendor unknown — running baseline rules only."
- **TrafficStars** — only a telemetry sidecar, not a bid surface. Out of scope for JsonFeed validator.
- **Naming-convention split** — baseline rules must be alias-aware (see table). Implementing as a flat field-name regex against `req[fieldName] != null` will not work cross-vendor. Need a `logicalField → vendorKey[]` resolver before any rule fires.
- **Format detection ambiguity** — Kadam-feed uses query-string `format=push`; ExoClick uses body `type=push_notification`; RichAds uses path `/telegram-bid`. Detector needs to try multiple signals; cannot rely on a single envelope marker. Probably defer detector to a `detect.js` extension after we have at least two real dialects.
- **Response no-bid varies** — empty array (Kadam, RichAds), empty object/missing `bid` (ExoClick), HTTP 204 (Zeropark). Validator must accept all three; "no bid" is not an error.

### Concrete next-step suggestion (not part of this research)

Add `TYPES.JSONFEED_REQUEST` and `TYPES.JSONFEED_RESPONSE` constants, a `rules-jsonfeed.js` ruleset operating on a logical-field map, and start with the Kadam-feed dialect. The existing `TYPES.JSON_FEED` / `TYPES.KADAM_FEED` enums in `index.js` already hint that the architecture anticipated this — current code just early-returns clean for `JSON_FEED`. That's the seam to extend.

---

## Source URLs (verified accessible at probe time, 2026-05-04)

- https://wiki.kadam.net/en/index.php?title=OpenRTB/Feed_Integration_SSP — OK, full spec
- https://wiki.kadam.net/en/index.php?title=API_setting — OK
- https://wiki.kadam.net/en/index.php?title=RTB_setting — OK
- https://ssp-api.propellerads.com/v5/docs/ — OK (Swagger SPA)
- https://help.propellerads.com/en/articles/4262401-propush-me-api — OK
- https://docs.richads.com/ — OK
- https://docs.richads.com/ssp/overview — OK (overview only)
- https://docs.richads.com/ssp/telegram-interstitial-video.html — OK, full spec
- https://adsterra.com/blog/how-to-use-adsterra-publishers-api/ — OK
- https://api3.adsterratools.com/docs/publishers — 404
- https://faq.clickadu.com/en/collections/3474608-api — OK (403 to fetcher, viewable in browser)
- https://publishers-help.ad-maven.com/en/article/admaven-content-locker-api-documentation-11q0a5r/ — OK
- https://support.adcash.com/en/articles/38-advertiser-reporting-api — OK
- https://evadavapi.com/docs/api — OK (Swagger SPA)
- https://docs.api.members.mondiad.com/ — OK (Swagger SPA)
- https://github.com/trafficstars/integrationapi — OK (archived)
- https://docs.exoclick.com/docs/rtb-publishers/exoclick-rtb/ — OK
- https://docs.exoclick.com/docs/rtb-publishers/exoclick-rtb/exoclick-rtb-publisher-code-examples/ — OK, full examples
- https://docs.exads.com/docs/rtb-publishers/open-rtb/bid-request/open-rtb-publishers-request/ — OK (related family)
- https://doc.zeropark.com/article/redirect-rtb-integration-xml-json-open-rtb — OK, full spec
