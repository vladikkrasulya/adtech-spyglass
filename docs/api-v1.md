# Public API contract — v1

The validation engine behind [ortbtools.com](https://ortbtools.com) is reachable
three ways; all three run the exact same `@kyivtech/spyglass-core` pipeline:

| Surface                      | Best for                           |
| ---------------------------- | ---------------------------------- |
| Web inspector (`/inspector`) | Humans: paste, read, share         |
| `@ortbtools/cli`             | Scripts, CI pipelines, log triage  |
| `POST /api/analyze`          | Programmatic integration over HTTP |

This document pins the HTTP contract. **Stability promise:** fields documented
here are additive-only within the same major version — new response fields may
appear, documented fields/shapes will not change or disappear. Finding `id`s
follow the core package's API-stability contract (`packages/core/README.md`).

---

## POST `/api/analyze`

Validate an OpenRTB BidRequest and/or BidResponse, with semantic crosscheck
when both sides are present.

**Rate limit:** 60 calls/min/IP → `429` with `code: "rate_limited"`.
**Privacy:** payload bodies are never persisted. Authenticated calls record
metadata only (counts/version/format) for the personal cabinet's Insights.

### Query parameters

| Param     | Values                            | Default | Effect                       |
| --------- | --------------------------------- | ------- | ---------------------------- |
| `locale`  | `en` · `uk` · `ru`                | `uk`    | Language of finding messages |
| `dialect` | `iab` · `ext-rtb` · `inpage-push` | `iab`   | Validation dialect overlay   |

### Request body (JSON)

```jsonc
{
  // At least one of bidReq / bidRes is required — otherwise 400 empty_payload.
  "bidReq": {}, // oRTB BidRequest object — OR a URL string
  // (clickunder/teaser/pop GET request; decoded server-side)
  "bidRes": {}, // oRTB BidResponse object
  "opts": {
    // Optional. Suppress rules per call: exact ids or trailing-* prefixes.
    // Max 100 entries; non-strings are dropped.
    "disabledRules": ["imp.*", "regs.coppa_pii_present"],
    // Optional. Pin the oRTB version you target ("2.5" | "2.6" | "3.0").
    // If detection lands elsewhere a `version.mismatch` WARNING is emitted.
    "expectedVersion": "2.5",
  },
}
```

### Response `200`

```jsonc
{
  "success": true,
  "validation": {
    "type": "oRTB BidRequest", // detected payload type
    "version": {
      // detected oRTB version
      "version": "2.5",
      "confidence": 0.3, // 0..1
      "signals": [], // field-level evidence for the detection
    },
    "status": "errors", // "errors" | "warnings" | "clean"
    "findings": [
      {
        "id": "request.device_required", // stable rule id
        "level": "error", // "error" | "warning" | "info" | "question"
        "path": "device", // JSON path into the payload ('' = root)
        "params": {}, // values interpolated into msg
        "specRef": "https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#3218-object-device",
        "msg": "No device block. …", // localized human message
      },
    ],
  },
  "crosscheck": [
    // [] unless BOTH bidReq (object) + bidRes sent
    {
      "id": "crosscheck.bid.above_floor",
      "ok": true, // true = check passed
      "level": "ok", // "ok" | "warn" | "crit"
      "path": "seatbid[0].bid[0].price",
      "params": {},
      "specRef": "…",
      "msg": "…",
    },
  ],
  "meta": {
    "locale": "en",
    "dialect": "iab",
    "categories": {}, // IAB Content Taxonomy codes → labels
    "format": {
      // third detection axis
      "formats": ["banner"], // banner/video/audio/native/push/…
      "contexts": [], // web/inapp/ctv/dooh
      "protocols": [], // vast-N/daast
      "tags": [],
      "confidence": 0.6,
    },
  },
}
```

Notes:

- **Both sides sent** → `validation.findings` is the union; response-side
  findings get a `[response] ` message prefix. `validation.status` rolls up
  across the union.
- **Response-only** → same shape, all findings carry the `[response] ` prefix.
- **String `bidReq`** (URL-style GET) → validated through the URL-request
  decoders; crosscheck/categories/format are skipped for that side.

### Errors

All errors share one envelope (HTTP status carries the class):

```json
{ "success": false, "error": "human-readable message", "code": "machine_code" }
```

| Status | `code`          | When                                   |
| ------ | --------------- | -------------------------------------- |
| 400    | `empty_payload` | Neither `bidReq` nor `bidRes` provided |
| 400    | `bad_request`   | Body is not valid JSON / malformed     |
| 404    | `not_found`     | Unknown `/api/*` path                  |
| 429    | `rate_limited`  | Per-IP limiter tripped                 |

---

## POST `/api/analyze-behavior`

Run the behavior/anti-fraud engine over probe events captured by the in-iframe
`creative-probe.js` (the Behavior tab). Stateless and anonymous-safe.

**Rate limit:** 20 calls/min/IP.

### Request body

```jsonc
{
  "events": [], // required — array of probe events (probe emits summarized
  // events; >1000 are head+tail sampled at 500/500)
  "adm": "<div>…", // optional — raw creative markup for static analysis
  // (obfuscation/miner/XSS patterns + entropy)
}
```

### Response `200`

```jsonc
{
  "success": true,
  "findings": [], // same finding shape as /api/analyze
  "status": "clean",
  "eventCount": 42,
  "meta": { "locale": "en", "truncated": false, "maxEvents": 1000 },
}
```

---

## Versioning

- The engine is `@kyivtech/spyglass-core` (SemVer). The site footer and
  `ortbtools version` (CLI) report the running versions.
- Rule ids are stable identifiers: renames/removals are MAJOR-version events
  in core; additions are MINOR.
- This document: `docs/api-v1.md` — contract revisions are listed in
  `CHANGELOG.md`.
