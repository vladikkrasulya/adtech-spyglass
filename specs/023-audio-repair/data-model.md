# Data Model: Audio Repair

No persistence or API envelope changes are introduced.

| Entity                     | Existing fields and repair meaning                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenRTB Audio impression   | `mimes`: required nonempty string array; absent/non-array/empty produces the required error, invalid entries produce the invalid error. `protocols`: numeric protocol signals.             |
| AdCOM Audio/Video response | `ctype`: scalar integer signal; request placement arrays are a different contract. `adm` remains creative markup.                                                                          |
| Creative evidence          | Independent audio/video flags derived from actual MediaFile MIME/ad-type attributes and supported metadata. Comments, CDATA, declarations and malformed attributes do not supply evidence. |
| Validation finding         | Existing id/level/path/params/specRef/msg shape; two additive error IDs, no changed identity or ordering.                                                                                  |
| Corpus case                | Original request/response/expectations remain; only scoped known-gap associations are retired or retained.                                                                                 |

Preview classification remains the existing `vast` inert document kind for recognized DAAST. There is no new playable media state or network transition.
