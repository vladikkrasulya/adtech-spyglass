# AdKernel JsonFeed/RTB Research — 2026-05-04

## TL;DR

AdKernel is a **white-label adtech engine**, not a destination network. It does **not publish a public dev portal** (`docs.adkernel.com` / `wiki.adkernel.com` do not resolve). The de-facto public spec is the **Prebid adapter source** (Prebid.js + Prebid Server), referenced from AdKernel's own marketing. Wire format is **standard OpenRTB 2.5 over HTTPS POST, gzipped, with a per-tenant host and `?zone={zoneId}` query param** — there is no AdKernel-specific JsonFeed envelope. Each tenant (49 Prebid aliases) shows up as a different `host`; the body is vanilla oRTB. **Implication for Spyglass:** AdKernel is _not_ a separate dialect like the vendor-specific JSON feeds we already cover — it's "oRTB 2.5 + host/zoneId macros." One preset covers all 49 tenants for free.

## 1. Doc URL

| URL                                                        | Status       | Verdict                                    |
| ---------------------------------------------------------- | ------------ | ------------------------------------------ |
| `https://docs.adkernel.com/`                               | TLS / no DNS | **Does not exist**                         |
| `https://wiki.adkernel.com/`                               | ECONNREFUSED | Does not exist                             |
| `https://adkernel.com/xml-ad-server/`                      | 200          | Marketing only — no schema                 |
| `https://docs.prebid.org/dev-docs/bidders/adkernel.html`   | 200          | Authoritative public reference             |
| `github.com/prebid/Prebid.js/.../adkernelBidAdapter.js`    | 200          | **Full request build + alias list (v1.8)** |
| `github.com/prebid/prebid-server/.../adkernel/adkernel.go` | 200          | Server-side Go adapter                     |
| `.../static/bidder-info/adkernel.yaml`                     | 200          | Endpoint, GZIP, GVL ID, sync URL           |

Tech contact gating real partner docs: `prebid@adkernel.com`.

## 2. OpenRTB vs JsonFeed surfaces

AdKernel runs **two distinct stacks**:

| Surface                               | Page              | Wire format                                                                             |
| ------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| **RTB Suite**                         | `/rtb-suite/`     | OpenRTB 2.5 JSON (this is what Prebid talks to — documentable)                          |
| **PPC / XML / JSON Performance Feed** | `/xml-ad-server/` | XML feeds + bespoke JSON + "OpenRTB-inspired" — **per-partner, not publicly specified** |

For Spyglass, only the RTB Suite is documentable. The PPC suite (push, pop, search, smartlink) requires partner deck.

## 3. JSON-RTB Format

### Endpoint

```
POST https://{host}/hb?zone={zoneId}&v=1.8
Content-Type: application/json;charset=utf-8
x-openrtb-version: 2.5
Content-Encoding: gzip
```

Default direct host: `pbs.adksrv.com`. Aliases override (e.g. `cpm.metaadserving.com`).

### Auth

**No header API key, no bearer.** Auth is by `(host, zoneId)` tuple — `host` is tenant-specific subdomain, `zoneId` is integer zone. Tenant separation at DNS layer.

### Request — top fields (oRTB 2.5)

| Field                                                      | Type    | Req  | Notes                                                    |
| ---------------------------------------------------------- | ------- | ---- | -------------------------------------------------------- |
| `id`                                                       | string  | yes  | Auction ID                                               |
| `imp[]`                                                    | array   | yes  | Multi-format imps split into N copies with `__mf` suffix |
| `imp[].id`                                                 | string  | yes  | Suffixed (`bmf`/`vmf`/`nmf`/`amf`) when split            |
| `imp[].banner`                                             | object  | cond | `{format:[{w,h}]}`                                       |
| `imp[].video`                                              | object  | cond | Standard oRTB video                                      |
| `imp[].native`                                             | object  | cond | oRTB native 1.x request blob                             |
| `imp[].audio`                                              | object  | cond | Server adapter only                                      |
| `imp[].bidfloor` / `bidfloorcur`                           | num/str | opt  | Default USD                                              |
| `imp[].ext.bidder.{zoneId,host}`                           | obj     | yes  | **Stripped before forward** — used for routing only      |
| `site.page`                                                | string  | yes  | Page URL                                                 |
| `site.publisher` / `app.publisher`                         | obj     | —    | **Stripped by adapter** before send                      |
| `device`                                                   | object  | rec  | UA/IP/geo                                                |
| `user.buyeruid`                                            | string  | rec  | AdKernel sync ID                                         |
| `user.ext.consent`, `regs.ext.gdpr`, `regs.ext.us_privacy` | —       | cond | TCF/CCPA                                                 |
| `cur`                                                      | array   | opt  | Currency list                                            |
| `source.ext.schain`                                        | object  | opt  | Supply chain                                             |
| `tmax`                                                     | int     | opt  | Auction timeout ms                                       |

### Response — oRTB 2.5 BidResponse (real example)

```json
{
  "id": "75472df2-1cb3-4f8e-9a28-10cb95fe05a4",
  "bidid": "wehM-93KGr0",
  "cur": "TYR",
  "seatbid": [
    {
      "bid": [
        {
          "id": "wehM-93KGr0_0_0",
          "impid": "adunit-1",
          "price": 0.5,
          "cid": "3706",
          "crid": "19005",
          "adid": "19005",
          "adm": "<!-- admarkup -->",
          "cat": ["IAB2"],
          "mtype": 1,
          "adomain": ["test.com"],
          "h": 250,
          "w": 300
        }
      ]
    }
  ]
}
```

Key fields: `seatbid[]` **must have exactly 1 entry** (server adapter rejects otherwise). `bid[].adm` carries creative inline (HTML / VAST / oRTB-native JSON). `bid[].mtype` required for type detection (1=banner, 2=video, 3=audio, 4=native). `nurl`/`burl`/`lurl` are standard win/billing/loss notify URLs. **No proprietary `click_url` envelope** — clicks live inside `adm` or via standard oRTB notify URLs. HTTP 204 = no-bid.

### Placements

| Placement                | RTB Suite           | PPC/Feed Suite              |
| ------------------------ | ------------------- | --------------------------- |
| Banner / video / native  | yes                 | yes                         |
| Audio                    | yes (server only)   | —                           |
| Interstitial / in-page   | yes                 | —                           |
| **Push / pop / onclick** | no (not oRTB media) | **yes** (undocumented JSON) |
| Search / shopping        | —                   | yes (XML)                   |

## 4. Detection signatures (vs vendor JSON feeds)

1. **Path `…/hb?zone=<int>&v=<x.y>`** — AdKernel-specific URL convention.
2. **`x-openrtb-version: 2.5`** header (consistent — never 2.6).
3. **`Content-Encoding: gzip` on the request body** (uncommon — most SSPs gzip responses only; AdKernel gzips outbound bid requests too).
4. **`imp.id` suffix `__mf`** with single-letter prefix (`bmf`/`vmf`/`nmf`/`amf`) — unique multi-format split convention.
5. **`gvlVendorID: 14`** in TCF disclosures.
6. **Sync URL** `sync.adkernel.com/user-sync?t=image&...&r={RedirectURL}` with `{UID}` macro.
7. **Stripped `site.publisher` / `app.publisher`** — present in Prebid input, absent in upstream call.
8. **`seatbid` length strictly = 1** in responses (deviation from oRTB which permits N).
9. **Bid IDs of form `<base64ish>_N_M`** (e.g. `wehM-93KGr0_0_0`).

## 5. Quirks

- **Gzip on the request, not just response.** Validators that only handle gzipped responses miss AdKernel traffic.
- **Multi-format imps split, not combined.** Validator must reverse-map by stripping `__mf` suffix.
- **No JsonFeed envelope.** Despite "JSON Ad Server" marketing, the JSON surface is literally oRTB BidRequest/BidResponse. "JSON feed" language refers to the _PPC_ suite's bespoke per-partner feeds.
- **`v=1.8` is adapter version, not API version.** Drifts with Prebid releases.
- **Tenant config lives in DNS, not payload.** Same JSON body works against any tenant; routing happens by `host`.
- **Currency `"TYR"` in upstream test fixture** is an upstream typo for `"TRY"`, not a real code.

## 6. Networks running on AdKernel

Prebid.js adapter (`adkernelBidAdapter.js` v1.8) declares **49 aliases** dispatching to the same code path with different `host` defaults. Each alias = a tenant SSP/network on AdKernel infrastructure.

**Notable / CIS-adjacent:** `waardex_ak` (Waardex), `turktelekom` (Türk Telekom), `monetix` (Monetix), `denakop`, `ergadx`, `engageadx`, `converge` (gvlid 248), `displayioads` (display.io), `appmonsta` (gvlid 1283), `spinx` (gvlid 1308), `pixelpluses` (gvlid 1209), `oppamedia`, `houseofpubs`, `urekamedia`, `smartyexchange`, `infinety`, `unibots`.

**Remaining 30+ aliases** (smaller/global): `headbidding`, `adsolut`, `oftmediahb`, `audiencemedia`, `roqoon`, `adbite`, `torchad`, `stringads`, `bcm`, `adomega`, `rtbanalytica`, `motionspots`, `sonic_twist`, `rtbdemand_com`, `bidbuddy`, `didnadisplay`, `qortex`, `adpluto`, `headbidder`, `digiad`, `hyperbrainz`, `voisetech`, `global_sun`, `rxnetwork`, `revbid`, `qohere`, `blutonic`, `intlscoop`. All inherit identical wire format.

## Sources

- [Prebid AdKernel bidder page](https://docs.prebid.org/dev-docs/bidders/adkernel.html)
- [Prebid.js adkernelBidAdapter.js](https://github.com/prebid/Prebid.js/blob/master/modules/adkernelBidAdapter.js)
- [Prebid Server adkernel.go](https://github.com/prebid/prebid-server/blob/master/adapters/adkernel/adkernel.go)
- [bidder-info/adkernel.yaml](https://raw.githubusercontent.com/prebid/prebid-server/master/static/bidder-info/adkernel.yaml)
- [Exemplary banner request/response](https://raw.githubusercontent.com/prebid/prebid-server/master/adapters/adkernel/adkerneltest/exemplary/single-banner-impression.json)
- [AdKernel marketing — XML/JSON ad-server](https://adkernel.com/xml-ad-server/)
- [AdKernel marketing — RTB Suite](https://adkernel.com/rtb-suite/)
