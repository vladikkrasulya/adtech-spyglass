# Adjudication pass 2 — the maintainer worksheet (016 T008)

Pass 1 (agent, adversarially self-checked) proposes the states below. Your pass is the second
of two: **cross out what you reject** by editing the verdict line (change `state:`/`role:` in
place), leave the rest untouched, then run:

```bash
node scripts/assemble-adjudication.js --finalize
```

Scores are NOT yours to pick — the authority oracle derives them from evidence (R-04).
An `abstain` costs nothing at runtime (the layer falls through exactly as today).

## Resolved — 219 names (each with its quote; reject by editing state/role)

### credential — 4

- `app_auth_token` @ 0.4 — "The app's authentication token"
- `auth` @ 0.4 — "Authentication token provided by Adverxo platform for the AdUnit."
- `clientToken` @ 0.4 — "Your FeedAd client token. Check your FeedAd admin panel."
- `signkey` @ 0.4 — "it is the HMAC secret for the Authorization header"

### delivery-control — 30

- `adtest` @ 0.4 — "Deactivates tracking of impressions and clicks"
- `allow_smaller_sizes` @ 0.4 — "ads smaller than your ad unit's size array will be allowed to serve"
- `badv` @ 0.6 — "Blocked advertiser domains"
- `bapp` @ 0.4 — "Blocked app bundles"
- `battr` @ 0.4 — "Blocked creative attributes (OpenRTB List 5.3)"
- `bcat` @ 0.6 — "Blocked IAB advertiser categories"
- `bcid` @ 0.4 — "Block list of CID"
- `bcrid` @ 0.4 — "Block list of CRID"
- `bidonmultiformat` @ 0.4 — "It determines if the request should be processed in multi format way."
- `cwdebug` @ 0.4 — "Enable CWire debug mode"
- `delDomain` @ 0.4 — "delivery domain for the customer"
- `endpoint` @ 0.9 — "routes to a per-endpoint subdomain"
- `exp` @ 0.4 — "number of seconds that may elapse between the auction and the actual impression"
- `force_bid` @ 0.6 — "Force bids with a test creative"
- `generate_ad_pod_id` @ 0.6 — "Boolean to signal AppNexus to add ad pod id to each request"
- `host` @ 0.9 — "determining the outbound request URL host component"
- `integrationType` @ 0.4 — "Use 'ronId' when integrating via publisherToken"
- `isTest` @ 0.4 — "100% fill test placement request"
- `maxDeals` @ 0.4 — "Specify how many deals that you want to return from the auction."
- `noCookies` @ 0.4 — "Disable cookies being set by the ad server."
- `path` @ 0.4 — "become routing rather than payload"
- `pbsBufferMs` @ 0.4 — "TMax buffer, default is 250"
- `pbsHost` @ 0.4 — "Prebid Server Host supplied by Relevant Digital"
- `programmaticGuaranteed` @ 0.4 — "consumed to pick the ext key and the endpoint"
- `publisherPath` @ 0.4 — "An optional path used in the bid endpoint."
- `region` @ 0.6 — "Regional endpoint identifier"
- `route` @ 0.4 — "Full route URL used to derive RTBStack endpoint"
- `secure` @ 0.4 — "Override http/https context on ad markup."
- `test` @ 0.6 — "Switch that enables test responses"
- `useSourceBidderCode` @ 0.4 — "Use the bidder code of the actual server-side bidder in bid responses"

### format-declaration — 8

- `adtype` @ 0.9 — "7 for rewarded video, 8 for interstitial video, 2 for interstitial banner, 1 for banner, 5 for native"
- `format` @ 0.6 — "The format of the ad"
- `formats` @ 0.4 — "formats to request (banner, native, or video)"
- `parallax` @ 0.4 — "determines if the wanted advertising format is a parallax"
- `product` @ 0.4 — "Product param that allow support for Desktop Skins - display and video"
- `rewarded` @ 0.4 — "is_rewarded_inventory equals 1"
- `videoResponseType` @ 0.4 — "the video response will be an AdM element containing VAST 3.0 markup"
- `videotype` @ 0.4 — ""rewarded_interstitial" when instl is 1, otherwise "rewarded""

### identifier — 121

- `TagID` @ 0.6 — "An ID which identifies the adman ad tag"
- `account` @ 0.8 — "Account ID"
- `accountId` @ 0.9 — "Account id"
- `accountid` @ 0.6 — "Account id"
- `adSlot` @ 0.4 — "An ID which identifies the ad slot"
- `adSlotID` @ 0.4 — "An ID which identifies the adslot placement"
- `adSlots` @ 0.4 — "IDs which identifies the ad slots"
- `adUnitCode` @ 0.4 — "adUnitCode is written into the bidder params with the value of imp.id, overwriting any adUnitCode the publisher supplied"
- `adUnitID` @ 0.4 — "The identifier of the ad unit."
- `adUnitId` @ 0.9 — "Unique identifier for the ad unit in Adverxo platform."
- `adbreakId` @ 0.4 — "Identifier for specific adpod placement is SOMA `adbreakId`"
- `adslotId` @ 0.6 — "unique identifier for your adslot"
- `adspaceId` @ 0.4 — "Identifier for specific ad placement is SOMA `adspaceId`"
- `adunit` @ 0.6 — "An ID which identifies the adunit"
- `adunit_code` @ 0.4 — "the ad unit name becomes something like 300x250"
- `adunitcode` @ 0.4 — "The string which identifies Ad Unit"
- `adunitid` @ 0.4 — "ID for ad unit"
- `adzoneid` @ 0.4 — "An ID which identifies the placement selling the impression"
- `aid` @ 0.9 — "An ID which identifies the channel"
- `appId` @ 0.9 — "An ID which identifies this app of the impression"
- `appIds` @ 0.4 — "specifies appIds for specific media types"
- `app_store_id` @ 0.4 — "Pub App Store ID"
- `asi` @ 0.4 — "Ad spot ID"
- `assetKey` @ 0.4 — "Ogury provided id for you site."
- `auId` @ 0.4 — "Placement ID"
- `bundleId` @ 0.6 — "An id which identifies app/site in Loopme"
- `cId` @ 0.9 — "The connection id."
- `campaign` @ 0.4 — "Id of a forced campaign"
- `channel` @ 0.4 — "Inventory channel identifier, limited to 50 characters"
- `ci` @ 0.4 — "Client ID to use."
- `cid` @ 0.6 — "The customer id provided by AAX."
- `company_id` @ 0.4 — "An id used to identify madSense company"
- `cp` @ 0.4 — "An ID which identifies the publisher selling the impression"
- `creative` @ 0.4 — "Id of a forced creative"
- `crid` @ 0.6 — "The placement id provided by AAX."
- `ct` @ 0.4 — "An ID which identifies the ad slot being sold"
- `custom_site_section_id` @ 0.4 — "numeric Site Section ID"
- `cwcreative` @ 0.4 — "ID of the creative"
- `dcn` @ 0.4 — "Site ID"
- `dmxid` @ 0.4 — "placement ID"
- `domainId` @ 0.6 — "identifies the site selling the impression"
- `ext_imp_id` @ 0.4 — "unique identifier of an externally generated auction"
- `external_imp_id` @ 0.4 — "Unique identifier of an externally generated auction"
- `groupId` @ 0.4 — "An ID which identifies the colossus group"
- `group_id` @ 0.4 — "An id used to identify NextMillennium placement group"
- `hash` @ 0.4 — "The placement id provided by Adrino."
- `id` @ 0.8 — "Identifier of adslot"
- `inv` @ 0.4 — "identifies the Adform inventory source id"
- `inv_code` @ 0.6 — "A code identifying the inventory of this placement."
- `inventoryCode` @ 0.6 — "TripleLift inventory code for this ad unit"
- `irisid` @ 0.4 — "A hashed IRIS.TV Content ID"
- `location` @ 0.4 — "refer to for a specific section or page, as defined in your Adhese inventory"
- `mandantId` @ 0.4 — "a unique identifier for your account"
- `med_id` @ 0.6 — "Property ID"
- `mediaId` @ 0.4 — "Publisher specific media id"
- `member` @ 0.6 — "An ID which identifies the member selling the impression."
- `mid` @ 0.4 — "An ID which identifies the placement selling the impression"
- `mname` @ 0.4 — "A Name which identifies the placement selling the impression"
- `networkids` @ 0.4 — "imp.ext.bidder.appid and placementid are copied into a new imp.ext.networkids object"
- `ntpnid` @ 0.4 — "Network partner ID"
- `org` @ 0.8 — "The organization ID."
- `organizationId` @ 0.4 — "Id of the Organization"
- `originalPublisherid` @ 0.4 — "publisher ID from the original request"
- `pageId` @ 0.6 — "identifies the site selling the impression"
- `page_id` @ 0.4 — "Page Id"
- `partnerId` @ 0.9 — "Partner ID"
- `partnerid` @ 0.4 — "ID for partner"
- `pid` @ 0.8 — "Publisher ID"
- `pix_id` @ 0.4 — "PixFuture placement ID"
- `placementId` @ 0.9 — "An ID which identifies this placement of the impression"
- `placement_code` @ 0.4 — "An Avocet placement external code"
- `placement_id` @ 0.8 — "An ID which identifies this placement of the impression"
- `placement_reference_id` @ 0.4 — "Placement Reference ID"
- `placementid` @ 0.4 — "Placement ID"
- `platform` @ 0.4 — "The platform id for the customer."
- `plc` @ 0.4 — "An ID corresponding to the placement selling the impression"
- `pos` @ 0.4 — "Placement ID"
- `ppid` @ 0.4 — "Publisher Placement ID"
- `profile_id` @ 0.4 — "profile name"
- `pubId` @ 0.9 — "Publisher Id to use."
- `pub_id` @ 0.6 — "Assigned publisher ID"
- `pubid` @ 0.9 — "Impression's publisher ID."
- `publisher` @ 0.4 — "Unique publisher identifier."
- `publisherId` @ 0.9 — "Publisher ID"
- `publisher_id` @ 0.9 — "Publisher ID"
- `publisherid` @ 0.4 — "publisher id"
- `seat` @ 0.4 — "seat is used as the AccountID macro value in the outbound endpoint URL"
- `seller_id` @ 0.6 — "Represent DMX Partner when you get onboarded"
- `sid` @ 0.8 — "Slot ID"
- `siteID` @ 0.4 — "An ID which identifies the site selling the impression."
- `siteId` @ 0.9 — "An ID which identifies the site selling the impression"
- `site_id` @ 0.8 — "An Epsilon (Conversant) specific ID which identifies the site."
- `siteid` @ 0.6 — "An ID which identifies the site selling the impression, preferred."
- `slot` @ 0.6 — "A slot id used to identify a slot placement mapped to a GumGum zone or publisher"
- `smartadId` @ 0.4 — "An ID which identifies the smartad/placement selling the impression"
- `sourceId` @ 0.8 — "Website Source Id"
- `sourceid` @ 0.4 — "Partner id"
- `spid` @ 0.4 — "Unique supply partner ID provided by Blis"
- `srid` @ 0.4 — "Stored request ID"
- `subpoolId` @ 0.4 — "Cpmstar-specific ID for ad subpool"
- `supplierId` @ 0.4 — "ID of the supplier account in AdTonos platform"
- `supplyId` @ 0.6 — "An ID which identifies the supply source"
- `supplyPartnerId` @ 0.4 — "Supply partner id to use."
- `tagId` @ 0.9 — "An ID which identifies the deepintent ad tag"
- `tag_id` @ 0.4 — "Identifies specific ad placement."
- `tagid` @ 0.8 — "The id of an inventory target"
- `tappxkey` @ 0.4 — "An ID which identifies the adunit"
- `tenantId` @ 0.4 — "Synapse HX tenant identifier"
- `tid` @ 0.6 — "Placement ID"
- `traffic_source_code` @ 0.6 — "Specifies the third-party source of this impression."
- `uid` @ 0.6 — "An ID which identifies this placement of the impression"
- `unit` @ 0.6 — "The ad unit id."
- `userKey` @ 0.4 — "publisher-supplied user key"
- `website` @ 0.4 — "Publisher website identifier"
- `wid` @ 0.6 — "An ID which identifies the Theadx inventory source id"
- `widgetId` @ 0.4 — "An ID which identifies this Nativery widget"
- `zid` @ 0.4 — "Zone ID"
- `zone` @ 0.8 — "An ID which identifies the zone selling the impression"
- `zoneId` @ 0.9 — "Publisher Id to use."
- `zone_id` @ 0.6 — "The ad zone identifier"
- `zoneid` @ 0.6 — "Impression's zone ID."

### measurement — 6

- `custom1` @ 0.4 — "To be used in reporting."
- `custom2` @ 0.4 — "To be used in reporting."
- `custom3` @ 0.4 — "To be used in reporting."
- `custom4` @ 0.4 — "To be used in reporting."
- `custom5` @ 0.4 — "To be used in reporting."
- `pubclick` @ 0.4 — "third-party click tracking"

### media-property — 12

- `api` @ 0.4 — "Array of supported API frameworks."
- `banner_frameworks` @ 0.4 — "List of supported API frameworks for banner ads supported by the publisher."
- `displaySizes` @ 0.4 — "Display banner sizes"
- `imageUrl` @ 0.6 — "The image url on which the ad is displayed in case of in-image ad"
- `instl` @ 0.4 — "Set to 1 if using interstitial"
- `maxduration` @ 0.4 — "Maximum duration in seconds"
- `mimes` @ 0.4 — "Array of content MIME types"
- `position` @ 0.6 — "Specifies the ad unit as above or below the fold"
- `private_sizes` @ 0.6 — "Private sizes (ex: [{"w": 300, "h": 250},{...}])"
- `protocols` @ 0.4 — "Array of supported video protocols."
- `size` @ 0.6 — "An array of two integer containing the dimension"
- `sizes` @ 0.4 — "All sizes this ad unit accepts."

### metadata — 6

- `adapterVersion` @ 0.4 — "A non-oRTB adapterVersion key with the constant "1.0.0" is added to the top-level ext."
- `is_prebid` @ 0.4 — "is_prebid is added to imp.ext and always set true"
- `language` @ 0.4 — "Language code (e.g., 'fr', 'en')"
- `pbs` @ 0.4 — "carrying the server version and the literal platform "go""
- `str` @ 0.4 — "hard-coded version string '10.0'"
- `version` @ 0.4 — "Stamped with the running prebid-server version."

### pricing — 16

- `bidFloor` @ 0.6 — "The minimum CPM price in USD"
- `bidFloorCur` @ 0.6 — "The currency of the bid floor"
- `bidType` @ 0.4 — "Allows you to specify Net or Gross bids."
- `bidfloor` @ 0.9 — "The minimum price acceptable for a bid"
- `cur` @ 0.4 — "optional bidfloor currency"
- `currency` @ 0.4 — "optional bidfloor currency"
- `customFloor` @ 0.6 — "The minimum CPM price in USD."
- `floor` @ 0.6 — "the bid floor"
- `floorPrice` @ 0.4 — "CPM bidfloor in USD"
- `kadfloor` @ 0.4 — "bid floor value set to imp.bidfloor"
- `mktag` @ 0.4 — "Minimum bid for this impression expressed in CPM (USD)"
- `priceType` @ 0.6 — "gross or net. Default is net."
- `pt` @ 0.8 — "holding the priceType of the first imp that declared one"
- `reserve` @ 0.6 — "The minimium acceptable bid, in CPM, using US Dollars"
- `use_payment_rule` @ 0.4 — "apply the relevant payment rule"
- `use_pmt_rule` @ 0.6 — "return net price after publisher payment rules are applied"

### privacy-consent — 3

- `consent` @ 0.9 — "User consent"
- `gdpr` @ 0.4 — "A GDPR flag of 1 rejects the entire request."
- `us_privacy` @ 0.4 — "Any non-empty US privacy string rejects the entire request."

### targeting — 13

- `acat` @ 0.4 — "List of allowed categories for a given auction to be sent in request.ext"
- `audiences` @ 0.4 — "publisher audiences"
- `category` @ 0.4 — "Category of the content displayed in the page."
- `customParams` @ 0.9 — "User-defined targeting key-value pairs."
- `customTargeting` @ 0.4 — "Custom Targeting Parameters"
- `dctr` @ 0.4 — "Deals Custom Targeting"
- `inventory` @ 0.4 — "An object defining arbitrary targeting key/value pairs related to the page"
- `keyValues` @ 0.4 — "key-value pairings for key-value targeting"
- `keywords` @ 0.6 — "page context keywords"
- `pagetype` @ 0.4 — "Describes what kind of content will be present in the page."
- `query` @ 0.4 — "Semicolon separated list of keywords."
- `targeting` @ 0.4 — "Targeting information in key value pairs"
- `visitor` @ 0.4 — "targeting key/value pairs related to the visitor"

## Ambiguous — 20 names

- `adhese` → [identifier, targeting] — The adhese ext object is shown both synthesizing a slot identifier (SL, joined from location+format params) and having free-form targeting keys from imp.ext.bid
- `appnexus` → [metadata, identifier] — adapter-rule text describes the injected object as carrying hb_source (a configured platform id) and is_amp (an entry-point flag) — integration-context metadata
- `customerId` → [identifier, delivery-control] — pass1 skeptic: The quote ('Customer ID') is verbatim but truncates the actual sentence 'Customer ID used to build the endpoint URL.' Critically, the adapter rul
- `debug` → [delivery-control, identifier, metadata] — pass1 skeptic: Three vendors describe three structurally different fields sharing this name: aduptech (boolean) "Enables debug mode" fits delivery-control's mod
- `env` → [metadata, delivery-control] — Schema descriptions call it plain "[Vendor] environment", the literal example term listed under metadata, while xeworks/bematterfull adapter-rule text shows it
- `exchange` → [metadata, identifier] — "Exchange/Publisher Name" supports both a vendor/partner-name metadata reading (Exchange) and an entity-naming identifier reading (Publisher Name); the descript
- `ixdiag` → [metadata, measurement] — pass1 skeptic: The verdict's quote (prebid-server version, commit hash trimmed) is verbatim and squarely metadata. But the second piece of evidence for the same
- `key` → [identifier, delivery-control] — mobfoxpb's own description calls it 'An ID which identifies the mobfox adexchange partner' (identifier), but mobfoxpb's own adapter rule shows the SAME field, w
- `keyid` → [identifier, credential] — pass1 skeptic: The quote 'the key id of publisher' is verbatim but lexically ambiguous: 'key id' is a standard industry pattern (e.g. JWT/JOSE 'kid' header, API
- `network` → [identifier, metadata, delivery-control] — pass1 skeptic: The only description, adnuntius's 'Network if required', is bare and commits to no role — it could equally name a metadata vendor/network label (
- `partnerName` → [metadata, delivery-control] — Smarthub's description 'unique partner name' matches the metadata vocabulary's own example ('partner/vendor name', controls nothing), but the adapter rule state
- `pkey` → [identifier, credential] — pass1 skeptic: Sharethrough's only evidence, 'Placement Key', is verbatim, but 'Key' is one of the role vocabulary's own listed credential examples ('token, key
- `placement` → [media-property, identifier] — Adagio's description frames the field as 'the placement of an adunit in a page' with a link to a fixed set of recommended enum values, i.e. a page-position/slot
- `pmzoneid` → [targeting, identifier] — pass1 skeptic: The full pubmatic description reads: 'Comma separated zone id. Used im deal targeting & site section targeting. e.g drama,sport.' The same senten
- `relevant` → [delivery-control, metadata] — pass1 skeptic: The 'count' sub-field quote ('a server-to-server loop guard', verified) does support delivery-control. But the SAME name's evidence also includes
- `source` → [identifier, metadata] — bidmatic's 'An ID which identifies the channel' supports identifier, while adyoulike's 'context of the campaign' for the same key reads as descriptive integrati
- `supplySourceId` → [identifier, delivery-control] — The description names an ID provided by TheTradeDesk referencing a supply-source entity (identifier), but the same description and the adapter rule both state i
- `token` → [identifier, credential] — pass1 skeptic: The chosen quote (smarthub: fills a 'SourceId' macro) does support identifier, but alkimi's description 'Publisher Token provided by Alkimi' read
- `type` → [delivery-control, format-declaration] — pass1 skeptic: The delivery-control quote is well-corroborated (four independently verified adapters injecting the same publisher/network discriminator), but th
- `viewabilityPercentage` → [measurement, media-property] — pass1 skeptic: Quote is verbatim, but the field is a value declared by the supply side as part of the outbound BID REQUEST describing an inherent characteristic

## Abstain — 83 names (cheap by design; listed for completeness)

`PId` · `PublisherPath` · `access_token` · `account_id` · `adCode` · `ad_unit_id` · `ae` · `allowedAds` · `apiKey` · `appid` · `banner` · `bidder` · `bidfloorcur` · `bids` · `code` · `connatix` · `consented_providers_settings` · `context` · `creativeType` · `cwfeatures` · `decoration` · `displayio` · `divId` · `endpointId` · `ext` · `extId` · `ext_inv_code` · `favoredMediaType` · `formatId` · `imp_id` · `insticator` · `integration` · `invCode` · `inventoryId` · `ip` · `is_rewarded_inventory` · `just_an_unused_vrtcal_param` · `jxprop1` · `jxprop2` · `memberid` · `nativery` · `networkId` · `network_id` · `networkid` · `nid` · `options` · `owner` · `pageTemplate` · `pageType` · `params` · `pchain` · `prebid` · `productId` · `publisherDomain` · `publisherNameIdentifier` · `rateLimit` · `rp` · `sample` · `sdkOptions` · `seatCode` · `seatId` · `settings` · `site` · `slotId` · `slotid` · `sparteo` · `sspId` · `sspid` · `storeUrl` · `style` · `supplyType` · `supply_id` · `targets` · `tokenId` · `track` · `trafficSourceCode` · `ttx` · `unitId` · `unitName` · `video` · `vungle` · `wrapper` · `zoneIds`
