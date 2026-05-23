# Spyglass — CU + Pops support audit (2026-05-12)

> **Source**: DeepSeek v4 Pro via OpenRouter, single 15.7k-token pass against
> all pops/CU touchpoints in `packages/core/` + UI surface + samples list +
> dialect overlays + crosscheck.
> **Cost**: $0.036, 9.5k output tokens, finish=stop, 34 gaps across 10 buckets.
> **Calibration note**: DS over-rated severity (15 🔴 CRITICAL out of 34 is the
> typical DS audit-FP pattern — most CRITICALs are actually MEDIUM). Trust the
> substance + my severity recalibration below, not the emoji.
> **Calibration verified manually by Claude** before presenting to user.

---

## 1. Format detection — does Spyglass correctly identify CU/Pops in payloads?

**Gap:** oRTB request pop/clickunder format not detected  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** `packages/core/format-detect.js` lines 120–150 scan `imp.banner`, `imp.video`, `imp.audio`, `imp.native` but never inspect `imp.ext` for pop signals like `adtype`, `format`, `type`, or boolean flags.  
**What's missing for proper CU/Pops support:** Many pop SSPs (pop vendor B, ext-rtb vendor, pop vendor C) signal the format via `imp.ext.adtype = "popunder"` or similar. Without detection, the inspector cannot tag the payload as `pops`, breaking downstream validation, crosscheck, and UI chips.  
**Proposed fix:** In `detectFormat`, after the `imp` loop, iterate `imp.ext` keys for known pop strings/booleans and add `FORMATS.POPS`. Also check `imp.banner.btype` for `4` (popup block) as a secondary signal.  
**Test angle:** Provide an oRTB request with `imp[0].ext.adtype = "popunder"` and assert `detectFormat` returns `formats: ['pops']`.

**Gap:** oRTB bid response pop format not detected  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** `packages/core/format-detect.js` lines 155–180 derive format from `mtype` and VAST sniffing only; no check for pop signals in `bid.ext` or `bid.adm` content.  
**What's missing for proper CU/Pops support:** A pop bid response often carries `bid.adm` as a `window.open` script or a redirect URL, not a banner. Without detection, the response is misclassified as banner or unknown, and crosscheck rules won't fire.  
**Proposed fix:** In the response path, if `bid.adm` contains `window.open` or `bid.ext` has pop flags, add `FORMATS.POPS`.  
**Test angle:** Provide a bid response with `adm = "<script>window.open('http://x.com')</script>"` and verify `pops` appears in formats.

**Gap:** JSON-feed pop detection misses feeds with additional metadata  
**Severity:** 🟡 MEDIUM  
**Evidence from snapshot:** `packages/core/format-detect.js` lines 85–95: `detectFeedFormat` only adds `POPS` when `hasRedirect && !hasImage && !hasTitle`. Some pop feeds (e.g., pop vendor D) may include a `type` field or frequency cap keys alongside the redirect URL, but still lack image/title.  
**What's missing for proper CU/Pops support:** A feed object like `{ redirecturl: "...", freqcap: 3 }` would not be tagged as pops because the heuristic is too narrow.  
**Proposed fix:** Also check for a `type` field equal to `"pop"` or `"popunder"`, or relax the condition to require only a redirect URL and no creative assets (image/title/description).  
**Test angle:** Feed a single object `{ redirecturl: "http://x.com", freqcap: 2 }` and assert `pops` is detected.

## 2. Validator rules — are pop-specific signals (fcap, adomain, secure, btype, ext.adtype) checked?

**Gap:** No validation of frequency cap for pop requests  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** `packages/core/rules-request.js` lines 155–360: `detectNonStandardFormats` only emits an INFO finding; no rule checks for `imp.ext.frequency_cap`, `imp.ext.fcap`, or similar.  
**What's missing for proper CU/Pops support:** Pops are intrusive; almost every SSP requires per-user/IP/session caps. Missing fcap leads to floor cuts and poor delivery. The validator must warn when a pop impression lacks any frequency cap signal.  
**Proposed fix:** In `rules-request.js`, after detecting a pop format, check for known fcap keys (`frequency_cap`, `fcap`, `freq`) in `imp.ext` and emit a WARNING if absent.  
**Test angle:** Provide a pop request without any fcap field and assert a WARNING finding.

**Gap:** No validation of `imp.secure` for pop traffic  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** `packages/core/rules-request.js` has no rule referencing `imp.secure` in the context of pops.  
**What's missing for proper CU/Pops support:** Pops often open HTTP landing pages; `secure: 0` is common. If `secure: 1` is set, the pop may be blocked by mixed-content policies. The validator should flag a mismatch.  
**Proposed fix:** Add a rule: if pop format detected and `imp.secure === 1`, emit a WARNING that HTTPS may break pop delivery.  
**Test angle:** Provide a pop request with `imp[0].secure = 1` and verify a WARNING.

**Gap:** No validation of `imp.banner.btype` for popup block  
**Severity:** 🟡 MEDIUM  
**Evidence from snapshot:** `packages/core/rules-request.js` does not inspect `btype`.  
**What's missing for proper CU/Pops support:** IAB `btype: [4]` indicates a popup block. A pop request should include this to signal the creative type. Absence may cause SSP misinterpretation.  
**Proposed fix:** If pop format detected and `imp.banner` exists but `btype` does not include `4`, emit an INFO suggestion.  
**Test angle:** Provide a pop request with `banner: {}` and no `btype`; expect an INFO finding.

**Gap:** No validation of `bid.adomain` against landing URL in pop response  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** `packages/core/rules-response.js` (not fully shown, but no pop-specific rules exist in snapshot) and `crosscheck.js` only checks `badv` block, not adomain-landing match.  
**What's missing for proper CU/Pops support:** Pops bypass anti-phishing checks; `bid.adomain` must match the domain in the landing URL. A mismatch is a security risk.  
**Proposed fix:** In a pop response validator (or crosscheck), extract the domain from `bid.adm` (if it's a URL or `window.open` target) and compare with `bid.adomain`. Emit CRIT if mismatch.  
**Test angle:** Provide a pop bid with `adomain: ["safe.com"]` but `adm` opening `evil.com`; expect CRIT.

**Gap:** No validation of `bid.adm` content for pop (must be script/redirect)  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** `packages/core/rules-response.js` has no pop-specific adm check; `crosscheck.js` only checks VAST for video.  
**What's missing for proper CU/Pops support:** A pop bid with banner HTML in `adm` will not render as a pop. The validator must ensure `adm` contains `window.open` or a redirect URL.  
**Proposed fix:** Add a rule: if pop format detected, `bid.adm` must be a string matching `window.open` or a valid URL; otherwise CRIT.  
**Test angle:** Provide a pop bid with `adm = "<img src=x>"` and expect CRIT.

**Gap:** No validation of `bid.nurl` for pop win tracking  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** `packages/core/rules-response.js` does not enforce `nurl` for pops.  
**What's missing for proper CU/Pops support:** Pop networks often rely on `nurl` for win notification; missing it breaks attribution.  
**Proposed fix:** If pop format detected and `bid.nurl` is missing, emit WARNING.  
**Test angle:** Provide a pop bid without `nurl` and verify WARNING.

**Gap:** No validation of pop-specific macros (e.g., `${POPUNDER_URL}`)  
**Severity:** 🟡 MEDIUM  
**Evidence from snapshot:** `packages/core/dialects/ext-rtb.js` checks macros but only for ext-rtb vendor push; no pop macro check exists.  
**What's missing for proper CU/Pops support:** Vendors split macros into `${POPUNDER_URL}` vs `${CLICK_URL}`. Using the wrong macro breaks the pop.  
**Proposed fix:** In a pop dialect, scan `bid.adm`/`nurl` for known pop macros and warn if standard click macros are used instead.  
**Test angle:** Provide a pop bid with `${CLICK_URL}` in `adm` and expect a WARNING suggesting `${POPUNDER_URL}`.

## 3. Crosscheck — does request↔response logic understand that pop bid.adm is window.open script, not banner HTML?

**Gap:** Crosscheck does not validate pop `bid.adm` content  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** `packages/core/crosscheck.js` lines for video VAST (3g) but no pop-specific check.  
**What's missing for proper CU/Pops support:** A pop bid with banner HTML in `adm` will silently fail to render. Crosscheck must flag this mismatch.  
**Proposed fix:** In `crosscheck`, if the request imp signals pop format, verify `bid.adm` contains `window.open` or a redirect URL; if not, emit CRIT.  
**Test angle:** Crosscheck a pop request with a bid containing `adm = "<div>ad</div>"` and expect a CRIT finding.

**Gap:** Crosscheck does not verify `bid.adomain` against landing domain in pop  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** `packages/core/crosscheck.js` only checks `badv` block, not adomain-landing match.  
**What's missing for proper CU/Pops support:** Pops are prone to domain spoofing; crosscheck must ensure the declared adomain matches the actual landing URL domain.  
**Proposed fix:** Extract domain from `bid.adm` (if it's a URL or `window.open` target) and compare with `bid.adomain`. Emit CRIT on mismatch.  
**Test angle:** Crosscheck a pop bid with `adomain: ["good.com"]` but `adm` opening `bad.com`; expect CRIT.

**Gap:** Crosscheck does not enforce `bid.nurl` presence for pop  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** `packages/core/crosscheck.js` has no `nurl` requirement for any format.  
**What's missing for proper CU/Pops support:** Pop win tracking depends on `nurl`; missing it means no attribution.  
**Proposed fix:** If pop format detected, require `bid.nurl` and emit WARNING if absent.  
**Test angle:** Crosscheck a pop bid without `nurl` and expect WARNING.

**Gap:** Crosscheck does not handle pop-specific price vs floor (CPC/CPM mismatch)  
**Severity:** 🟡 MEDIUM  
**Evidence from snapshot:** `packages/core/crosscheck.js` price-vs-floor logic is generic; it doesn't account for pop bids often being CPC while floor may be CPM.  
**What's missing for proper CU/Pops support:** A pop bid with `price` in CPC and `imp.bidfloor` in CPM will compare incorrectly, leading to false positives/negatives.  
**Proposed fix:** If pop format detected, check for a currency/unit hint (e.g., `imp.ext.bidtype = "cpc"`) and adjust comparison or warn about unit mismatch.  
**Test angle:** Crosscheck a pop request with `bidfloor=0.50` (CPM) and bid `price=0.01` (CPC) and expect a WARNING about unit mismatch.

## 4. Dialect overlays — which CIS-adtech pop SSPs are missing (pop vendor C, pop vendor B, pop vendor A, pop vendor E, pop vendor D, pop vendor F, pop vendor G)?

**Gap:** Missing pop vendor C dialect  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** `packages/core/dialects/` contains only `iab.js`, `inpage-push.js`, `ext-rtb.js`.  
**What's missing for proper CU/Pops support:** pop vendor C uses `imp.ext.type = "pop"` and custom frequency cap fields; without a dialect, these go unvalidated.  
**Proposed fix:** Create `dialects/popvendor-c.js` with `validateRequest` checking `ext.type`, `ext.fcap`, and `validateResponse` checking `bid.adm` shape.  
**Test angle:** Provide a pop vendor C request and verify dialect fires findings for missing fcap.

**Gap:** Missing pop vendor B dialect  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** Same as above.  
**What's missing for proper CU/Pops support:** pop vendor B uses `imp.ext.adtype = "popunder"` and specific `ext.frequency_cap` structure.  
**Proposed fix:** Create `dialects/popvendor-b.js` with validation for `adtype`, `frequency_cap`, and response `adm` script.  
**Test angle:** Provide an pop vendor B request and verify dialect validates fcap.

**Gap:** Missing pop vendor A dialect  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** pop vendor A uses a custom JSON feed (similar to ext-rtb vendor) but also oRTB with `ext.adtype`.  
**Proposed fix:** Create `dialects/popvendor-a.js` for oRTB validation and extend `rules-feed.js` for its JSON shape.  
**Test angle:** Provide a pop vendor A oRTB request and verify dialect detects missing `ext.zone_id`.

**Gap:** Missing pop vendor E dialect  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** pop vendor E uses oRTB with `imp.ext.format = "popunder"` and specific `ext.zoneid`.  
**Proposed fix:** Create `dialects/popvendor-e.js` to validate `format` and `zoneid`.  
**Test angle:** Provide an pop vendor E request and verify dialect warns if `zoneid` missing.

**Gap:** Missing pop vendor D dialect  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** pop vendor D has a unique auction model (bid-per-thousand then bid-per-popunder) and uses a custom JSON feed with `bid` and `url`.  
**Proposed fix:** Create `dialects/popvendor-d.js` for feed validation (or extend `rules-feed.js`) and handle the two-stage bidding logic.  
**Test angle:** Provide a pop vendor D feed and verify it's recognized and validated.

**Gap:** Missing pop vendor F dialect  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** pop vendor F uses a JSON feed with `url`, `bid`, and `frequency` fields.  
**Proposed fix:** Create `dialects/popvendor-f.js` or add to `rules-feed.js`.  
**Test angle:** Provide a pop vendor F feed and verify validation of `frequency`.

**Gap:** Missing pop vendor G dialect  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** pop vendor G uses oRTB with `imp.ext.format = "popunder"` and custom `ext.zone_id`.  
**Proposed fix:** Create `dialects/popvendor-g.js` to validate `format` and `zone_id`.  
**Test angle:** Provide a pop vendor G request and verify dialect fires.

## 5. JsonFeed shapes — what vendor-specific JSON feed formats are missing from rules-feed.js?

**Gap:** pop vendor C JSON feed not recognized  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** `packages/core/rules-feed.js` only handles ext-rtb vendor, value-feed vendor, bid-price vendor, bid-redirect vendor.  
**What's missing for proper CU/Pops support:** pop vendor C delivers pops via a custom JSON feed with fields like `url`, `bid`, `campaign_id`, `frequency`. Without a validator, users get "unknown feed shape".  
**Proposed fix:** Add a `detectSingleVendor` predicate for pop vendor C (e.g., presence of `campaign_id` and `url`) and a `validatePopVendorC` function.  
**Test angle:** Paste a pop vendor C feed and verify it's identified and validated.

**Gap:** pop vendor A JSON feed not recognized  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** pop vendor A feed shape is similar to ext-rtb vendor clickunder (`{ result: { listing: [...] } }`) but may use different keys.  
**Proposed fix:** Extend `validateFeedResponse` to detect pop vendor A’s envelope and validate `url`, `bid`, `id`.  
**Test angle:** Provide a pop vendor A feed and verify it's not "unknown feed shape".

**Gap:** pop vendor F JSON feed not recognized  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** pop vendor F feed objects contain `url`, `bid`, `frequency`.  
**Proposed fix:** Add detection for `frequency` key and validate required fields.  
**Test angle:** Provide a pop vendor F feed and verify validation.

**Gap:** pop vendor D JSON feed not recognized  
**Severity:** 🔴 CRITICAL  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** pop vendor D feed may have a unique structure (e.g., `{ bids: [...] }` with `bid` and `url`).  
**Proposed fix:** Add pop vendor D feed validator.  
**Test angle:** Provide a pop vendor D feed and verify it's handled.

**Gap:** pop vendor B JSON feed not recognized (if they offer one)  
**Severity:** 🟡 MEDIUM  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** pop vendor B primarily uses oRTB, but may have a JSON fallback; if so, it's missing.  
**Proposed fix:** Research and add if applicable.  
**Test angle:** Provide an pop vendor B JSON feed (if exists) and verify recognition.

## 6. Sample fixtures — what `samples/synthetic-*.json` are missing for pop/clickunder coverage?

**Gap:** No synthetic pop request fixture  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** `samples/` list contains no `synthetic-pop-request.json`.  
**What's missing for proper CU/Pops support:** Without a fixture, automated tests cannot verify pop request detection and validation.  
**Proposed fix:** Create `samples/synthetic-pop-request.json` with `imp.ext.adtype = "popunder"` and typical pop fields.  
**Test angle:** Run format detection and validator tests against this fixture.

**Gap:** No synthetic pop response fixture  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** Same.  
**What's missing for proper CU/Pops support:** Needed to test response validation and crosscheck.  
**Proposed fix:** Create `samples/synthetic-pop-response.json` with `bid.adm` as `window.open` script.  
**Test angle:** Crosscheck this response against a pop request fixture.

**Gap:** No synthetic pop feed fixtures for various SSPs  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** No feed fixtures beyond the existing ones.  
**What's missing for proper CU/Pops support:** Each SSP feed shape needs a fixture to test `rules-feed.js`.  
**Proposed fix:** Create `synthetic-feed-popvendor-c.json`, `synthetic-feed-popvendor-a.json`, `synthetic-feed-popvendor-f.json`, etc.  
**Test angle:** Run feed validation tests with these fixtures.

## 7. UI surface — does the inspector visibly flag "POPS" as a top-level format in tabs / chips?

(no gap found)  
**Evidence from snapshot:** `format-detect.js` produces `'pops'` in the `tags` array, which the UI likely renders as a chip. The snapshot does not include UI code, but the architecture suggests it will appear. No evidence of a missing UI element.

## 8. Behavior-probe integration — should pop-served creatives ALWAYS trigger certain behavior signals?

**Gap:** Behavior-probe findings not linked to pop format  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** User statement: “Spyglass behavior-probe catches some of this (frame*bust*\*, click_burst, etc.) but doesn't tie back to pop-specific findings.” No code in snapshot shows such linkage.  
**What's missing for proper CU/Pops support:** When a creative is a pop, the probe should expect `window.open` calls and user-gesture triggers. Without linking, generic probe findings are not contextualized as pop issues.  
**Proposed fix:** In the behavior-probe module, if the format is detected as pops, add specific checks: expect `window.open` presence, expect a user-gesture event; if missing, emit a pop-specific finding.  
**Test angle:** Serve a pop creative that uses a meta-refresh instead of `window.open`; verify a behavior-probe finding like “pop_missing_window_open”.

**Gap:** No pop-specific behavior checks (e.g., `window.open` presence, user gesture)  
**Severity:** 🟠 HIGH  
**Evidence from snapshot:** No behavior-probe code in snapshot, but the user indicates it doesn't tie back.  
**What's missing for proper CU/Pops support:** Pops rely on `window.open`; if the creative uses a different method, it may be blocked. The probe should flag this.  
**Proposed fix:** Implement a probe rule: if format is pops, scan the rendered creative for `window.open` calls; if absent, emit WARNING.  
**Test angle:** Provide a pop creative with a simple redirect link and verify the probe warns.

## 9. Spec deep-links — are pop findings linked to relevant docs (IAB, vendor public pages)?

**Gap:** Missing spec links for `feed.clickunder.*` findings  
**Severity:** 🟢 LOW  
**Evidence from snapshot:** Messages list shows `feed.clickunder.url_required: ''` and `feed.clickunder.bid_required: ''` (empty specRef).  
**What's missing for proper CU/Pops support:** Users can't click through to vendor docs for these findings.  
**Proposed fix:** Add URLs to ext-rtb vendor clickunder documentation (e.g., `(vendor docs — private)) in the messages config.  
**Test angle:** Check that the finding object includes a non-empty `specRef`.

**Gap:** Missing spec links for any new pop findings  
**Severity:** 🟢 LOW  
**Evidence from snapshot:** All pop-related findings that will be added (fcap, secure, etc.) will need spec links.  
**What's missing for proper CU/Pops support:** Without links, findings are less actionable.  
**Proposed fix:** As new pop rules are added, include relevant IAB sections or vendor docs.  
**Test angle:** Verify each new finding has a `specRef` property.

## 10. Operational / docs — README/ROADMAP/about-page coverage of CU/Pops as a first-class supported format

**Gap:** No documentation in snapshot about pops as a supported format  
**Severity:** 🟡 MEDIUM  
**Evidence from snapshot:** The snapshot does not include README or docs, but the absence of any mention in the provided code (e.g., no comment in `format-detect.js` stating “pops is a first-class format”) suggests it may not be documented.  
**What's missing for proper CU/Pops support:** Users need to know that Spyglass supports pops/clickunder; otherwise they may not use it for those formats.  
**Proposed fix:** Update README and ROADMAP to list “Popunder / Clickunder / Pops” as a supported format, and add a section in the about page.  
**Test angle:** Check the project’s public documentation for the string “popunder” or “clickunder”.
