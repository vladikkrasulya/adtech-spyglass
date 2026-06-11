# @ortbtools/cli

Validate OpenRTB payloads from the command line — the same engine that powers
[ortbtools.com](https://ortbtools.com). Version/format autodetect, IAB-spec
findings with spec links, request↔response semantic crosscheck. Pure
JavaScript, no network calls: your payloads never leave the machine.

## Install

```bash
npm install -g @ortbtools/cli
# or one-off:
npx @ortbtools/cli validate bid-request.json
```

## Usage

```bash
# Validate a BidRequest / BidResponse / feed payload (type is autodetected)
ortbtools validate bid-request.json

# From stdin (logs, curl, kafkacat...)
cat payload.json | ortbtools validate -

# Machine-readable output + CI-friendly exit codes
ortbtools validate bid.json --json --fail-on warn

# Pin the spec version you target — flags fields from other versions
ortbtools validate bid.json --expect-version 2.5

# Semantic crosscheck: does this response actually answer this request?
ortbtools crosscheck request.json response.json

# What is this payload?
ortbtools detect payload.json
```

## Options

| Flag                    | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `--json`                | Full JSON result instead of the pretty report                 |
| `--locale <en\|uk\|ru>` | Finding-message language (default `en`)                       |
| `--dialect <id>`        | Validation dialect, see `ortbtools dialects` (default `iab`)  |
| `--expect-version <v>`  | Emit `version.mismatch` if detection lands on another version |
| `--fail-on <level>`     | Exit-1 threshold: `error` (default), `warn`, `never`          |
| `--refs`                | Print the IAB spec link under each finding                    |
| `--no-color`            | Disable ANSI colors (also honors the `NO_COLOR` env var)      |

## Exit codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `0`  | Analyzed; nothing at/above the `--fail-on` level        |
| `1`  | Analyzed; findings at/above the `--fail-on` level exist |
| `2`  | Usage / IO / parse error — nothing was analyzed         |

## What it checks

- **OpenRTB 2.5 / 2.6** BidRequest + BidResponse field-level rules
- **OpenRTB 3.0 / AdCOM** layered-envelope validation
- **VAST** creatives embedded in `adm` (InLine/Wrapper chains)
- **Native** request/response asset crosscheck
- **URL-style GET requests** (clickunder/teaser/pop feeds)
- **Crosscheck**: impid resolution, floor clearance, currency, deal
  consistency between a request and its response

The engine is [`@kyivtech/spyglass-core`](https://www.npmjs.com/package/@kyivtech/spyglass-core) —
the validator behind the [ortbtools.com](https://ortbtools.com) web inspector,
where you also get creative preview, behavior analysis and shareable reports.

## License

MIT
