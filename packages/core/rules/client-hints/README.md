# client-hints validator plugin

Flags missing User-Agent Client Hints / Structured-UA data in oRTB
2.x BidRequests. All findings are **warning** severity — the request
is technically valid, but DSP targeting will be coarse.

## Why this matters

Chrome 100+, Edge 100+, Opera 80+ (released 2022) **freeze the legacy
User-Agent string**. It reports a generic
`"Mozilla/5.0 (...) Chrome/100.0.0.0"` no matter what the real OS,
browser minor version, or device model is. The actual fingerprint
moved to **client-hints** — `sec-ch-ua*` HTTP headers, surfaced in
oRTB 2.6 as `device.sua` (Structured User Agent).

If an SSP doesn't capture client-hints and only forwards the frozen
UA, the DSP loses:

- Accurate OS version segmentation
- Browser minor-version targeting (relevant when a creative needs a
  modern WebAPI)
- Device model identification on mobile

The bid still happens. The DSP can still respond. But targeting falls
back to "Chrome on Windows, version unknown" — and CPM follows.

## Rules

| Finding ID                            | Trigger                                                                                   | Severity |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| `device.client_hints.sua_missing`     | `device.ua` looks like Chrome/Edge/Opera ≥ UA-CH-era threshold AND `device.sua` is absent | warning  |
| `device.client_hints.os_unknown`      | No `device.os`, no `device.osv`, no `device.sua.platform` either                          | warning  |
| `device.client_hints.browser_unknown` | No `device.browser` (or `device.ext.browser`), no `device.sua.browsers[]`, no `device.ua` | warning  |

## Why warning, not error

Spec-compliant DSPs answer requests without sua / client-hints. Many
SSPs in 2026 still don't forward them. Calling this an `error` would
make the inspector lie — the request will get bids.

If you have a use-case that genuinely requires client-hints (e.g.,
serving a creative that uses `prefers-color-scheme` derived from
`sec-ch-ua-mobile`), filter your own integration accordingly. The
plugin is here to make missing data visible, not to gate it.

## Disabling

```
validate(payload, { disabledRules: ['device.client_hints.*'] })
```

Suppresses all three rules. Or disable individually with the exact ID.

## Vendor-neutrality

The doc that motivated this lives at Kadam. The pattern — "SSP omits
client-hints, DSP targets blindly" — applies to many networks. The
plugin doesn't reference Kadam, doesn't depend on dialect, and runs
for every oRTB 2.x BidRequest.

## Implementation notes

- `looksLikeUACHEraBrowser(ua)` matches `Brand/version` where
  brand ∈ {Chrome, Chromium, Edg, OPR} and version ≥ the
  per-brand threshold (Chromium-family browsers froze UA in v100,
  Opera in v80).
- We don't parse the UA string for OS / browser detection ourselves —
  that's a known anti-pattern. We only check the boolean "is ANY
  usable field present?".
- `device.browser` isn't IAB-standard. Several dialects use
  `device.ext.browser`. We accept either.
