# imp-secure validator plugin

Checks the `imp[].secure` flag in oRTB BidRequests.

## Why this matters

Most publishers serve pages over HTTPS. When an impression object lacks
`secure: 1`, the exchange may return an HTTP creative — and modern
browsers block mixed content by default, so the creative never renders.
The bid wins, the impression is lost. Setting `secure: 1` is the
recommended default for any publisher whose pages run over HTTPS (which
is nearly all of them in 2026).

## Rules

| Finding ID               | Trigger                                                                                 | Severity |
| ------------------------ | --------------------------------------------------------------------------------------- | -------- |
| `imp.secure_recommended` | `imp[].secure` is missing, `null`, or `0`                                               | info     |
| `imp.secure_invalid`     | `imp[].secure` is set to anything other than `0` or `1` (string, boolean, number ≠ 0/1) | error    |

If `secure === 1` → no finding.

## Severity rationale

`secure` defaults to `0` per oRTB §3.2.4 — a request without it is
spec-valid, the auction will run, the bid will fire. The cost is
operational rather than protocol-level: a buyer that delivers an HTTP
creative onto an HTTPS page sees their impression silently dropped by
the browser's mixed-content policy. Since this is a best-practice
recommendation rather than a violation, the finding is **info** —
a clean request still rolls up to `status: 'clean'`.

An invalid value (e.g. `"1"` string, `2`, `true`) is a spec violation:
`secure` is defined as a numeric flag with two valid values only.
Different exchanges may coerce, reject, or pass it through — undefined
behaviour → **error**.

## Disabling

Per-finding suppression via the `disabledRules` option:

```js
validate(payload, { disabledRules: ['imp.secure_recommended'] });
```
