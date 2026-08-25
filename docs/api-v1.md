# Public API contract — v1

The validation engine behind [ortbtools.com](https://ortbtools.com) has three
surfaces. The hosted inspector and HTTP API run `@ortbtools/core` server-side;
the CLI workspace runs the same engine locally without network calls:

| Surface                                       | Best for                                                |
| --------------------------------------------- | ------------------------------------------------------- |
| Web inspector (`/inspector`)                  | Humans: paste, read, share                              |
| `@ortbtools/cli` (local repository workspace) | Scripts, CI pipelines, log triage                       |
| `POST /api/analyze`, `/api/analyze-behavior`  | Programmatic validation and behavior analysis over HTTP |

`@ortbtools/cli` is not currently published to npm. References to it in this
document describe the workspace in this repository, not a registry install.

This document pins the HTTP contract. **Stability promise:** fields documented
here are additive-only within the same major version — new response fields may
appear, documented fields/shapes will not change or disappear. Finding `id`s
follow the core package's API-stability contract (`packages/core/README.md`).

---

## POST `/api/analyze`

Validate an OpenRTB BidRequest and/or BidResponse, with semantic crosscheck
when both sides are present.

**Rate limit:** 60 calls/min/IP → `429` with `code: "rate_limited"`.
**Privacy:** payload bodies are processed transiently and are not persisted.
Derived validation metrics may be recorded; authenticated calls also record
counts/version/format for Insights, and sampled operational request metadata
includes the client IP. See [`PRIVACY.md`](./PRIVACY.md) for the complete
retention boundary.

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
    "status": "errors", // "invalid" | "errors" | "warnings" | "clean"
    "findings": [
      {
        "id": "request.device_required", // stable rule id
        "level": "error", // "error" | "warning" | "info" | "question"
        "path": "device", // JSON path into the payload ('' = root)
        "params": {}, // values interpolated into msg
        "specRef": "https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#3218-object-device", // URL or null
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
      "tags": ["banner"], // union of formats + contexts + protocols
      "confidence": 1, // 1 when any tag was detected, otherwise 0
    },
  },
}
```

Notes:

- **Both sides sent** → `validation.findings` is the union; response-side
  findings get a `[response] ` message prefix. `validation.status` rolls up
  across the union.
- **Response-only** → same shape, all findings carry the `[response] ` prefix.
- **String `bidReq`** (recognized URL-style GET) → validated through the
  URL-request decoders. Crosscheck and category extraction are skipped for that
  side; format detection uses the decoded canonical request.

### Errors

All errors share one envelope (HTTP status carries the class):

```json
{ "success": false, "error": "human-readable message", "code": "machine_code" }
```

| Status | `code`              | When                                        |
| ------ | ------------------- | ------------------------------------------- |
| 400    | `empty_payload`     | Neither `bidReq` nor `bidRes` provided      |
| 400    | `invalid_json`      | Body is not valid JSON                      |
| 400    | `payload_too_large` | Request body exceeds the 2 MiB parser limit |
| 404    | `not_found`         | Unknown `/api/*` path                       |
| 429    | `rate_limited`      | Per-IP limiter tripped                      |

---

## POST `/api/analyze-behavior`

Run the behavior/anti-fraud engine over probe events captured by the in-iframe
`creative-probe.js` (the Behavior tab). Stateless and anonymous-safe.

**Rate limit:** 20 calls/min/IP.

Creative source is processed transiently for static rules and is not persisted or logged as request
context. The hosted Inspector sends the macro-resolved/classified body selected to execute (or escaped
synthetic Native HTML), not a base64 creative wrapper or raw Native JSON. Static analysis is valid
with an empty `events` array.

### Request body

```jsonc
{
  "events": [], // required — array of probe events (probe emits summarized
  // events; >1000 are head+tail sampled at 500/500)
  "adm": "<div>…", // optional legacy string form; remains supported
  "adm_b64": "PGRpdj7igKY8L2Rpdj4=", // optional preferred form: canonical padded
  // base64 of valid UTF-8, decoded size <= 1 MiB. When present it takes
  // precedence over adm.
  "adm_truncated": false, // optional boolean; true means the caller sent
  // only the deterministic UTF-8-safe 1 MiB source prefix
}
```

The hosted Inspector uses `adm_b64` because its deterministic 4/3 expansion avoids the unpredictable
JSON escaping of quote/control-heavy markup. For a source at or under 1 MiB, decoding it yields the
complete body selected for the frame before probe/CSP instrumentation. The endpoint rejects
non-canonical base64, invalid UTF-8, decoded data over 1 MiB, and a non-boolean `adm_truncated` with
`400 invalid_input`.

### Response `200`

```jsonc
{
  "success": true,
  "findings": [], // same finding shape as /api/analyze
  "status": "clean",
  "eventCount": 42,
  "meta": {
    "locale": "en",
    "truncated": false, // event-list sampling occurred
    "maxEvents": 1000,
    "admTruncated": false, // caller declared a bounded creative-source prefix
  },
}
```

`eventCount` and `meta.truncated` describe only the runtime event array. `meta.admTruncated` describes
the independently bounded static creative source.

### Errors

Errors use the same envelope shown for `/api/analyze`.

| Status | `code`              | When                                                                                                                                     |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_input`     | `events` is not an array; `adm_b64` is not canonical padded base64 of valid UTF-8 up to 1 MiB decoded; or `adm_truncated` is not boolean |
| 400    | `invalid_json`      | Body is not valid JSON                                                                                                                   |
| 400    | `payload_too_large` | Request body exceeds the 2 MiB parser limit                                                                                              |
| 429    | `rate_limited`      | Per-IP behavior limiter tripped                                                                                                          |

---

## Versioning

- The engine is `@ortbtools/core` (SemVer). The site footer and local CLI
  `version` command report the running versions.
- Rule ids are stable identifiers: renames/removals are MAJOR-version events
  in core; additions are MINOR.
- This document: `docs/api-v1.md` — contract revisions are listed in
  `CHANGELOG.md`.
