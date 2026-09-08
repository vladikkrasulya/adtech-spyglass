# Ad format verification matrix

Generated: 2026-09-08T08:07:51.892Z. Baseline: dd0e7681a7d1db5bd5e52f48f68c377af7602727.

Audit execution: **complete**. Product conformity across asserted cases: **not fully satisfied**.

A known gap is a reproducible unmet expectation, not a passing product check. Not-applicable and missing execution are counted separately. This is representative coverage, not all possible OpenRTB combinations.

| Format | Qualified pairs | Provisional references | Standalone probes | Mutations |
| ------ | --------------: | ---------------------: | ----------------: | --------: |
| banner |              23 |                      0 |                 0 |        82 |
| video  |              21 |                      0 |                 2 |        12 |
| audio  |              20 |                      0 |                 2 |         4 |
| native |              22 |                      0 |                 3 |         9 |
| push   |               8 |                      1 |                 6 |         2 |
| pop    |              13 |                      2 |                 3 |         4 |
| inpage |              12 |                      0 |                 3 |         2 |

| Layer   | Pass | Known gap | Fail | Skip | Not applicable | Missing |
| ------- | ---: | --------: | ---: | ---: | -------------: | ------: |
| core    |  151 |       102 |    0 |    0 |              3 |       0 |
| http    |  150 |       106 |    0 |    0 |              0 |       0 |
| browser |  140 |       115 |    0 |    0 |              1 |       0 |
| ux      |    0 |        12 |    0 |    0 |              0 |       0 |
| a11y    |   17 |         2 |    0 |    0 |              0 |       0 |

| Case                                           | Format / context | Protocol / dialect     | Scenario      | Preview expectation                  | Core           | HTTP      | Browser        | Gap     |
| ---------------------------------------------- | ---------------- | ---------------------- | ------------- | ------------------------------------ | -------------- | --------- | -------------- | ------- |
| audio-daast-26-request-only                    | audio / web      | ortb-2.6 / iab         | request-only  | n/a / n/a / play:n/a                 | known-gap      | known-gap | known-gap      | DEF-102 |
| audio-inapp-26-podcast-companion               | audio / inapp    | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| audio-inapp-26-wrapper                         | audio / inapp    | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| audio-web-25-mp3-legacy                        | audio / web      | ortb-2.5 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| audio-web-26-live-exact-aac                    | audio / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| audio-web-26-multi-imp-reversed                | audio / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| audio-x-ctv-smartspeaker-postroll              | audio / ctv      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| audio-x-daast-inline-podcast                   | audio / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-102 |
| audio-x-nvol-companion-html                    | audio / inapp    | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| audio-x-ortb30-placement-audio                 | audio / inapp    | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| audio-x-stitched-preroll-podcast               | audio / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| audio-x-vast41-bitrate-ladder                  | audio / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| banner-dooh-26-screen                          | banner / dooh    | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-103 |
| banner-x-ctv-fullscreen-1080p                  | banner / ctv     | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| banner-x-format-flex-wratio                    | banner / web     | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| banner-x-gpid-tid-gpp-26                       | banner / web     | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| banner-x-html-adm-base64                       | banner / web     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| banner-x-iurl-only-png                         | banner / web     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| banner-x-js-tag-docwrite                       | banner / web     | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| banner-x-mtype-cattax-26                       | banner / web     | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| banner-x-prebid-appush-iframe                  | banner / inapp   | ortb-2.5 / iab         | pair          | markup / empty / play:n/a            | pass           | pass      | pass           |         |
| bn-banner-25-app-interstitial                  | banner / inapp   | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| bn-banner-25-fixed                             | banner / web     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| bn-banner-26-multiimp-multiseat                | banner / web     | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | known-gap      | DEF-201 |
| bn-banner-26-pmp-multisize                     | banner / web     | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-104 |
| bn-banner-30-adcom                             | banner / web     | ortb-3.0 / iab         | pair          | markup / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-105 |
| cover-context-audio-25-ctv                     | audio / ctv      | ortb-2.5 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| cover-context-audio-25-inapp                   | audio / inapp    | ortb-2.5 / ext-rtb     | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| cover-context-audio-25-unspecified             | audio / n/a      | ortb-2.5 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| cover-context-audio-26-dooh                    | audio / dooh     | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| cover-context-audio-26-unspecified             | audio / n/a      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-101 |
| cover-context-audio-30-ctv                     | audio / ctv      | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-context-audio-30-dooh                    | audio / dooh     | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-100 |
| cover-context-audio-30-unspecified             | audio / n/a      | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-context-audio-30-web                     | audio / web      | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-context-banner-25-ctv                    | banner / ctv     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| cover-context-banner-25-unspecified            | banner / n/a     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-302 |
| cover-context-banner-26-inapp                  | banner / inapp   | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| cover-context-banner-26-unspecified            | banner / n/a     | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-302 |
| cover-context-banner-30-ctv                    | banner / ctv     | ortb-3.0 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| cover-context-banner-30-dooh                   | banner / dooh    | ortb-3.0 / iab         | pair          | markup / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-100 |
| cover-context-banner-30-inapp                  | banner / inapp   | ortb-3.0 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| cover-context-banner-30-unspecified            | banner / n/a     | ortb-3.0 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| cover-context-native-25-ctv                    | native / ctv     | ortb-2.5 / iab         | pair          | native / full / play:n/a             | pass           | pass      | pass           |         |
| cover-context-native-25-unspecified            | native / n/a     | ortb-2.5 / iab         | pair          | native / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-302 |
| cover-context-native-26-ctv                    | native / ctv     | ortb-2.6 / iab         | pair          | native / full / play:n/a             | pass           | pass      | pass           |         |
| cover-context-native-26-dooh                   | native / dooh    | ortb-2.6 / iab         | pair          | native / full / play:n/a             | pass           | pass      | pass           |         |
| cover-context-native-26-unspecified            | native / n/a     | ortb-2.6 / iab         | pair          | native / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-302 |
| cover-context-native-30-ctv                    | native / ctv     | ortb-3.0 / iab         | pair          | native / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-151 |
| cover-context-native-30-dooh                   | native / dooh    | ortb-3.0 / iab         | pair          | native / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-151 |
| cover-context-native-30-inapp                  | native / inapp   | ortb-3.0 / iab         | pair          | native / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-151 |
| cover-context-native-30-unspecified            | native / n/a     | ortb-3.0 / iab         | pair          | native / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-151 |
| cover-context-push-26-inapp                    | push / inapp     | ortb-2.6 / ext-rtb     | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| cover-context-video-25-ctv                     | video / ctv      | ortb-2.5 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-context-video-25-inapp                   | video / inapp    | ortb-2.5 / ext-rtb     | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-context-video-25-unspecified             | video / n/a      | ortb-2.5 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-302 |
| cover-context-video-26-unspecified             | video / n/a      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-302 |
| cover-context-video-30-ctv                     | video / ctv      | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-context-video-30-dooh                    | video / dooh     | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-100 |
| cover-context-video-30-inapp                   | video / inapp    | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-context-video-30-unspecified             | video / n/a      | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-input-audio-response-only                | audio / n/a      | ortb-3.0 / iab         | response-only | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-input-inpage-request-only                | inpage / web     | ortb-2.5 / ext-rtb     | request-only  | n/a / n/a / play:n/a                 | pass           | pass      | pass           |         |
| cover-input-native-request-only                | native / web     | ortb-2.6 / iab         | request-only  | n/a / n/a / play:n/a                 | pass           | pass      | pass           |         |
| cover-input-native-response-only               | native / n/a     | ortb-2.6 / iab         | response-only | native / full / play:n/a             | pass           | pass      | pass           |         |
| cover-input-pop-request-only                   | pop / web        | ortb-2.5 / iab         | request-only  | n/a / n/a / play:n/a                 | pass           | pass      | pass           |         |
| cover-input-pop-response-only                  | pop / n/a        | ortb-2.5 / iab         | response-only | url / inert-text / play:n/a          | pass           | pass      | pass           |         |
| cover-input-push-request-only                  | push / web       | ortb-2.6 / iab         | request-only  | n/a / n/a / play:n/a                 | pass           | pass      | pass           |         |
| cover-input-push-response-only                 | push / n/a       | ortb-2.5 / ext-rtb     | response-only | native / partial / play:n/a          | known-gap      | known-gap | known-gap      | DEF-460 |
| cover-input-video-request-only                 | video / web      | ortb-2.6 / iab         | request-only  | n/a / n/a / play:n/a                 | pass           | pass      | pass           |         |
| cover-input-video-response-only                | video / n/a      | ortb-2.6 / iab         | response-only | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| cover-vendor-banner-exads-json                 | banner / web     | jsonfeed / ext-rtb     | pair          | markup / empty / play:n/a            | known-gap      | known-gap | known-gap      | DEF-106 |
| cover-vendor-inpage-exads-url                  | inpage / web     | url-request / ext-rtb  | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-106 |
| cover-vendor-inpage-openrtb26                  | inpage / web     | ortb-2.6 / inpage-push | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-180 |
| cover-vendor-native-kadam-json                 | native / n/a     | jsonfeed / ext-rtb     | response-only | native / partial / play:n/a          | known-gap      | known-gap | known-gap      | DEF-441 |
| cover-vendor-native-kadam-url                  | native / web     | url-request / ext-rtb  | pair          | native / partial / play:n/a          | known-gap      | known-gap | known-gap      | DEF-441 |
| cover-vendor-pop-openrtb26                     | pop / web        | ortb-2.6 / iab         | pair          | url / inert-text / play:n/a          | pass           | pass      | pass           |         |
| cover-vendor-push-exads-url                    | push / web       | url-request / ext-rtb  | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-106 |
| inpage-exads-native-501                        | inpage / web     | ortb-2.5 / ext-rtb     | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| inpage-exads-wrapper                           | inpage / web     | jsonfeed / ext-rtb     | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-106 |
| inpage-kadam-icon-notice                       | inpage / web     | jsonfeed / ext-rtb     | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-107 |
| inpage-kadam-native-square                     | inpage / web     | ortb-2.5 / ext-rtb     | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| inpage-kadam-separate-notice-alias             | inpage / web     | jsonfeed / ext-rtb     | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-107 |
| inpage-x-card-feed-array                       | inpage / n/a     | jsonfeed / iab         | response-only | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-181 |
| inpage-x-card-feed-single                      | inpage / n/a     | jsonfeed / iab         | response-only | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-181 |
| inpage-x-widget-adm-and-ext                    | inpage / web     | ortb-2.5 / inpage-push | pair          | markup / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-180 |
| inpage-x-widget-iab-contract                   | inpage / web     | ortb-2.5 / iab         | pair          | empty / empty / play:n/a             | known-gap      | known-gap | known-gap      | DEF-180 |
| inpage-x-widget-inapp                          | inpage / inapp   | ortb-2.5 / inpage-push | pair          | empty / empty / play:n/a             | known-gap      | known-gap | known-gap      | DEF-180 |
| inpage-x-widget-openrtb-aliases                | inpage / web     | ortb-2.5 / inpage-push | pair          | empty / empty / play:n/a             | known-gap      | known-gap | known-gap      | DEF-180 |
| inpage-x-widget-openrtb-canonical              | inpage / web     | ortb-2.5 / inpage-push | pair          | empty / empty / play:n/a             | known-gap      | known-gap | known-gap      | DEF-180 |
| bn-native-25-app-install                       | native / inapp   | ortb-2.5 / iab         | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| bn-native-25-social-wrapped                    | native / web     | ortb-2.5 / iab         | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| bn-native-26-editorial-bare                    | native / web     | ortb-2.6 / iab         | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| bn-native-26-optional-image-omitted            | native / inapp   | ortb-2.6 / iab         | pair          | native / full / play:n/a             | pass           | pass      | pass           |         |
| bn-native-26-text-cta                          | native / web     | ortb-2.6 / iab         | pair          | native / full / play:n/a             | pass           | pass      | pass           |         |
| native-x-assetsurl-thirdparty                  | native / web     | ortb-2.6 / iab         | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| native-x-legacy-wrapped-v11                    | native / web     | ortb-2.5 / iab         | pair          | native / full / play:n/a             | pass           | pass      | pass           |         |
| native-x-ortb30-adcom-stub                     | native / web     | ortb-3.0 / iab         | pair          | native / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-151 |
| native-x-prebid-zeroclickfraud                 | native / web     | ortb-2.5 / iab         | pair          | native / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-100 |
| native-x-rich-data-privacy-tracking            | native / inapp   | ortb-2.6 / iab         | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| native-x-structured-bid-object                 | native / web     | ortb-2.6 / ext-rtb     | pair          | native / full / play:n/a             | known-gap      | known-gap | known-gap      | DEF-150 |
| native-x-video-vast-asset                      | native / inapp   | ortb-2.6 / iab         | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| pop-adon3-over-multi                           | pop / web        | jsonfeed / ext-rtb     | pair          | url / inert-text / play:n/a          | known-gap      | known-gap | known-gap      | DEF-108 |
| pop-adon3-under                                | pop / web        | jsonfeed / ext-rtb     | pair          | url / inert-text / play:n/a          | known-gap      | known-gap | known-gap      | DEF-108 |
| pop-exads-openrtb-url-adm                      | pop / web        | ortb-2.5 / ext-rtb     | pair          | url / inert-text / play:n/a          | known-gap      | known-gap | known-gap      | DEF-109 |
| pop-exads-wrapper                              | pop / web        | jsonfeed / ext-rtb     | pair          | url / inert-text / play:n/a          | known-gap      | known-gap | known-gap      | DEF-106 |
| pop-kadam-clickunder                           | pop / web        | jsonfeed / ext-rtb     | pair          | url / inert-text / play:n/a          | pass           | pass      | known-gap      | DEF-202 |
| pop-ppcmate-json-material                      | pop / web        | jsonfeed / ext-rtb     | pair          | url / inert-text / play:n/a          | known-gap      | known-gap | known-gap      | DEF-107 |
| pop-ppcmate-json-multi                         | pop / web        | jsonfeed / ext-rtb     | pair          | url / inert-text / play:n/a          | known-gap      | known-gap | known-gap      | DEF-107 |
| pop-x-feed-bid-redirect                        | pop / web        | jsonfeed / ext-rtb     | response-only | url / inert-text / play:n/a          | pass           | pass      | known-gap      | DEF-202 |
| pop-x-feed-linkfeed-get                        | pop / web        | url-request / ext-rtb  | pair          | url / inert-text / play:n/a          | pass           | pass      | known-gap      | DEF-202 |
| pop-x-nurl-only-response                       | pop / web        | ortb-2.5 / iab         | pair          | empty / empty / play:n/a             | known-gap      | known-gap | known-gap      | DEF-170 |
| pop-x-openrtb-adtype-clickunder-location       | pop / inapp      | ortb-2.5 / iab         | pair          | markup / empty / play:n/a            | pass           | pass      | known-gap      | DEF-245 |
| pop-x-openrtb-adtype-popunder-window-open      | pop / web        | ortb-2.5 / iab         | pair          | markup / empty / play:n/a            | pass           | pass      | known-gap      | DEF-245 |
| pop-x-openrtb-adtype-popup-bare-url            | pop / web        | ortb-2.5 / iab         | pair          | url / inert-text / play:n/a          | pass           | pass      | pass           |         |
| pop-x-openrtb-flag-popunder-bool               | pop / web        | ortb-2.5 / iab         | pair          | markup / empty / play:n/a            | pass           | pass      | known-gap      | DEF-245 |
| pop-x-openrtb-shape-flag-allowshock            | pop / web        | ortb-2.5 / iab         | pair          | markup / empty / play:n/a            | pass           | pass      | known-gap      | DEF-245 |
| push-adon3-string-cpc                          | push / web       | jsonfeed / ext-rtb     | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-108 |
| push-exads-icon-cpc                            | push / web       | jsonfeed / ext-rtb     | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-106 |
| push-exads-openrtb-native-500                  | push / web       | ortb-2.5 / ext-rtb     | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| push-kadam-icon-notice                         | push / web       | jsonfeed / ext-rtb     | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-107 |
| push-ppcmate-multi                             | push / web       | jsonfeed / ext-rtb     | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-107 |
| push-ppcmate-single                            | push / web       | jsonfeed / ext-rtb     | pair          | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-107 |
| push-x-ext-rtb-native-push                     | push / web       | ortb-2.6 / ext-rtb     | pair          | native / partial / play:n/a          | pass           | pass      | pass           |         |
| push-x-kadam-array-alias-mixed                 | push / web       | jsonfeed / ext-rtb     | response-only | push / full / play:n/a               | pass           | pass      | known-gap      | DEF-201 |
| push-x-kadam-material-single                   | push / web       | jsonfeed / ext-rtb     | response-only | push / full / play:n/a               | known-gap      | known-gap | known-gap      | DEF-160 |
| push-x-numeric-string-cpc                      | push / web       | jsonfeed / ext-rtb     | response-only | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-160 |
| push-x-richads-bare-array                      | push / web       | jsonfeed / ext-rtb     | response-only | push / partial / play:n/a            | known-gap      | known-gap | known-gap      | DEF-161 |
| video-ctv-26-dynamic-pod                       | video / ctv      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-100 |
| video-inapp-26-rewarded-portrait               | video / inapp    | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-100 |
| video-web-25-inline-vast2                      | video / web      | ortb-2.5 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-100 |
| video-web-26-companion-vast3                   | video / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-100 |
| video-web-26-outstream-wrapper                 | video / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-100 |
| video-x-ctv-26-sua-gpp                         | video / ctv      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| video-x-dooh-26-mtype-dur                      | video / dooh     | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| video-x-inapp-26-interstitial-skippable        | video / inapp    | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-100 |
| video-x-web-26-iab-example4                    | video / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| video-x-web-30-adcom-video                     | video / web      | ortb-3.0 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| video-x-web-42-inline-linear                   | video / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| video-x-web-42-nonlinear-overlay               | video / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-130 |
| video-x-web-42-wrapper-companion               | video / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | known-gap      | known-gap | known-gap      | DEF-100 |
| commercial-blocked-advertiser                  | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| commercial-blocked-category                    | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| currency-outside-request                       | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| price-below-impression-floor                   | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| price-below-matched-deal-floor                 | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-104 |
| price-invalid-array-empty                      | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-110 |
| price-invalid-array-one                        | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-110 |
| price-invalid-boolean                          | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-110 |
| price-invalid-empty-string                     | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-110 |
| price-invalid-negative                         | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-110 |
| price-invalid-null                             | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| price-invalid-numeric-string                   | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-110 |
| cover-preview-audio-no-bid                     | audio / web      | ortb-2.5 / iab         | pair          | empty / empty / play:n/a             | pass           | pass      | pass           |         |
| cover-preview-audio-unidentified-inert         | audio / web      | ortb-2.5 / iab         | pair          | unidentified / inert-text / play:n/a | known-gap      | known-gap | known-gap      | DEF-194 |
| cover-preview-banner-blocked-media             | banner / web     | ortb-2.5 / iab         | pair          | markup / partial / play:no           | pass           | pass      | pass           |         |
| cover-preview-banner-json-inert                | banner / web     | ortb-2.5 / iab         | pair          | json / inert-text / play:n/a         | pass           | pass      | pass           |         |
| cover-preview-banner-partial-image             | banner / web     | ortb-2.5 / iab         | pair          | markup / partial / play:n/a          | pass           | pass      | pass           |         |
| cover-preview-banner-url-inert                 | banner / web     | ortb-2.5 / iab         | pair          | url / inert-text / play:n/a          | pass           | pass      | pass           |         |
| cover-preview-inpage-blocked-media             | inpage / web     | ortb-2.5 / inpage-push | pair          | markup / partial / play:no           | pass           | pass      | pass           |         |
| cover-preview-inpage-unidentified-inert        | inpage / web     | ortb-2.5 / inpage-push | pair          | unidentified / inert-text / play:n/a | pass           | pass      | pass           |         |
| cover-preview-native-json-without-assets       | native / web     | ortb-2.6 / iab         | pair          | json / inert-text / play:n/a         | pass           | pass      | pass           |         |
| cover-preview-native-no-bid                    | native / web     | ortb-2.6 / iab         | pair          | empty / empty / play:n/a             | pass           | pass      | pass           |         |
| cover-preview-native-unidentified-inert        | native / web     | ortb-2.6 / iab         | pair          | unidentified / inert-text / play:n/a | pass           | pass      | pass           |         |
| cover-preview-pop-markup-full                  | pop / web        | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| cover-preview-pop-markup-partial-media         | pop / web        | ortb-2.5 / iab         | pair          | markup / partial / play:no           | pass           | pass      | pass           |         |
| cover-preview-pop-unidentified-inert           | pop / web        | ortb-2.5 / iab         | pair          | unidentified / inert-text / play:n/a | pass           | pass      | pass           |         |
| cover-preview-push-no-bid                      | push / web       | ortb-2.6 / ext-rtb     | pair          | empty / empty / play:n/a             | pass           | pass      | pass           |         |
| cover-preview-push-unidentified-inert          | push / web       | ortb-2.6 / ext-rtb     | pair          | unidentified / inert-text / play:n/a | pass           | pass      | pass           |         |
| cover-preview-video-html-full                  | video / web      | ortb-2.6 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| cover-preview-video-html-partial               | video / web      | ortb-2.6 / iab         | pair          | markup / partial / play:n/a          | pass           | pass      | pass           |         |
| cover-preview-video-no-bid                     | video / web      | ortb-2.6 / iab         | pair          | empty / empty / play:n/a             | pass           | pass      | pass           |         |
| cover-preview-video-unidentified-inert         | video / web      | ortb-2.6 / iab         | pair          | unidentified / inert-text / play:n/a | pass           | pass      | pass           |         |
| encoding-adm-base64-html                       | banner / web     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| encoding-adm-bom-prefixed-vast                 | video / web      | ortb-2.6 / iab         | pair          | vast / inert-text / play:no          | pass           | pass      | pass           |         |
| encoding-adm-forged-postmessage                | banner / web     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| encoding-adm-large-600kb                       | banner / web     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| encoding-adm-mixed-scripts-image               | banner / web     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| encoding-adm-null                              | banner / web     | ortb-2.5 / iab         | pair          | empty / empty / play:n/a             | pass           | pass      | pass           |         |
| encoding-adm-unresolved-macros                 | banner / web     | ortb-2.5 / iab         | pair          | markup / full / play:n/a             | pass           | pass      | pass           |         |
| encoding-adm-whitespace-only                   | banner / web     | ortb-2.5 / iab         | pair          | unidentified / inert-text / play:n/a | known-gap      | known-gap | known-gap      | DEF-198 |
| encoding-escaped-control-char                  | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| encoding-ext-nested-50-levels                  | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| encoding-large-ext-string                      | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| encoding-request-body-oversized                | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | not-applicable | known-gap | not-applicable | DEF-303 |
| encoding-request-duplicate-id                  | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| encoding-response-duplicate-price              | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| encoding-unicode-auction-id                    | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| dooh-conflicting-site                          | banner / dooh    | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| field-shape-at-invalid                         | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| field-shape-bid-price-missing                  | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| field-shape-device-missing                     | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-100 |
| field-shape-imp-empty-array                    | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| field-shape-imp-id-missing                     | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| field-shape-imp-missing                        | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| field-shape-native-request-object              | native / inapp   | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| field-shape-no-site-or-app                     | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-302 |
| field-shape-regs-coppa-invalid                 | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-197 |
| field-shape-request-id-missing                 | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| field-shape-tmax-negative                      | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| shape-bid-null                                 | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | known-gap      | DEF-204 |
| shape-bid-object                               | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | known-gap | known-gap      | DEF-115 |
| shape-seatbid-object                           | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | known-gap | known-gap      | DEF-115 |
| format-mixed-impression-video-wins             | video / web      | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-111 |
| mut-format-mismatch-audio-video-mediafile      | audio / web      | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-194 |
| mut-format-mismatch-banner-vast-adm            | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-194 |
| mut-format-mismatch-mixed-video-mtype-banner   | video / web      | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-111 |
| mut-format-mismatch-mtype-invalid-enum         | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-195 |
| mut-format-mismatch-mtype-video-banner-only    | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-195 |
| mut-format-mismatch-native-html-adm            | native / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-format-mismatch-pop-nonredirect-adm        | pop / web        | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-format-mismatch-video-html-adm             | video / web      | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| identity-auction-id-mismatch                   | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| identity-duplicate-impression                  | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| identity-unknown-impid                         | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-identity-duplicate-bid-ids                 | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-identity-duplicate-seat-ids                | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-190 |
| mut-identity-empty-string-ids                  | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-identity-missing-bid-id                    | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-identity-missing-bid-impid                 | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-identity-multiple-bids-same-impid          | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-identity-numeric-id-types                  | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| input-request-invalid-json                     | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | not-applicable | pass      | pass           |         |
| input-request-only                             | banner / web     | ortb-2.5 / iab         | request-only  | n/a                                  | pass           | pass      | pass           |         |
| input-response-invalid-json                    | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | not-applicable | pass      | pass           |         |
| input-response-only                            | banner / web     | ortb-2.5 / iab         | response-only | n/a                                  | pass           | pass      | pass           |         |
| mut-input-shape-array-root-request             | banner / web     | ortb-2.5 / iab         | request-only  | n/a                                  | pass           | pass      | pass           |         |
| mut-input-shape-hybrid-imp-and-seatbid         | banner / web     | ortb-2.5 / iab         | request-only  | n/a                                  | pass           | pass      | pass           |         |
| mut-input-shape-jsonfeed-as-response           | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-input-shape-nbr-exchange-specific          | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-input-shape-nbr-unassigned-code            | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-301 |
| mut-input-shape-number-root-response           | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | known-gap | pass           | DEF-300 |
| mut-input-shape-ortb30-envelope-with-2x-imp    | banner / web     | ortb-3.0 / iab         | request-only  | n/a                                  | pass           | pass      | pass           |         |
| mut-input-shape-unrecognized-object-both-sides | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| mut-input-shape-url-no-decoder                 | banner / web     | url-request / ext-rtb  | request-only  | n/a                                  | pass           | pass      | pass           |         |
| audio-mimes-missing                            | audio / web      | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-112 |
| native-asset-kind                              | native / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| native-image-too-small                         | native / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| native-required-missing                        | native / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| native-title-too-long                          | native / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| video-duration-incompatible                    | video / web      | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-113 |
| video-mime-incompatible                        | video / web      | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-113 |
| video-mimes-missing                            | video / web      | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| video-protocol-incompatible                    | video / web      | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-113 |
| multiplicity-bseat-blocks-responding-seat      | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-192 |
| multiplicity-empty-bid-array                   | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | known-gap      | DEF-204 |
| multiplicity-forty-imps-forty-bids             | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| multiplicity-group-partial-coverage            | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| multiplicity-missing-bid-key                   | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| multiplicity-partial-two-imps                  | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| multiplicity-reordered-impressions             | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| multiplicity-three-imps-single-seat            | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| multiplicity-three-seats-distinct-imps         | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |
| multiplicity-wseat-allows-other-seat           | banner / web     | ortb-2.6 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-192 |
| nobid-empty-seatbid                            | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | known-gap      | known-gap | known-gap      | DEF-114 |
| nobid-explicit-reason                          | banner / web     | ortb-2.5 / iab         | pair          | n/a                                  | pass           | pass      | pass           |         |

| UX scenario         | Outcome   | Gap     |
| ------------------- | --------- | ------- |
| ux-en-light-desktop | known-gap | DEF-200 |
| ux-en-light-mobile  | known-gap | DEF-200 |
| ux-en-dark-desktop  | known-gap | DEF-200 |
| ux-en-dark-mobile   | known-gap | DEF-200 |
| ux-uk-light-desktop | known-gap | DEF-200 |
| ux-uk-light-mobile  | known-gap | DEF-200 |
| ux-uk-dark-desktop  | known-gap | DEF-200 |
| ux-uk-dark-mobile   | known-gap | DEF-200 |
| ux-ru-light-desktop | known-gap | DEF-200 |
| ux-ru-light-mobile  | known-gap | DEF-200 |
| ux-ru-dark-desktop  | known-gap | DEF-200 |
| ux-ru-dark-mobile   | known-gap | DEF-200 |

## Accessibility, overflow and state layer

Scenarios recorded: 19. Findings: 39 (info: 34, medium: 3, low: 2). Details: ux-a11y-findings.json in the report directory.

Observations: 37. Deviations: 2. Observations do not certify that an unasserted behavior meets its expectation.

| Accessibility scenario | Outcome   | Gap     |
| ---------------------- | --------- | ------- |
| viewport-1440x900      | pass      |         |
| viewport-1100x800      | pass      |         |
| viewport-768x1024      | pass      |         |
| viewport-390x844       | pass      |         |
| contrast-light         | pass      |         |
| contrast-dark          | pass      |         |
| names-desktop          | known-gap | DEF-260 |
| names-mobile           | pass      |         |
| keyboard               | pass      |         |
| state-empty            | pass      |         |
| state-unsupported      | pass      |         |
| state-request-only     | pass      |         |
| state-response-only    | pass      |         |
| state-partial          | known-gap | DEF-201 |
| state-warning          | pass      |         |
| state-error            | pass      |         |
| state-large-json       | pass      |         |
| zoom-dsf2              | pass      |         |
| zoom-css150            | pass      |         |

## Remaining coverage boundaries

- Finite source examples and mutations do not exhaust arbitrary vendor extensions or the format × version × context cross-product.
- VAST preview is inert by contract; external wrappers, live ad serving, trackers, click destinations and real media playback are not certified.
- Chromium automation does not replace manual accessibility, screen-reader, Safari/Firefox or real mobile-device review.
- Provisional vendor references are retained for investigation and excluded from minimum qualified-pair counts.
- See verification.md, defects.md and cleanup-backlog.md for interpretations and follow-up work.
