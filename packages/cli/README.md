# @ortbtools/cli

Validate OpenRTB payloads from the command line — the same engine that powers
[ortbtools.com](https://ortbtools.com). Version/format autodetect, IAB-spec
findings with spec links, request↔response semantic crosscheck. Pure
JavaScript, no network calls: your payloads never leave the machine.

That last statement applies to this local CLI. The hosted web inspector sends
pasted payloads to `POST /api/analyze` for transient server-side analysis; raw
payload bodies are not persisted.

## Package status

`@ortbtools/cli` is not currently published to the npm registry. Inside this
monorepo it is available as an npm workspace. Registry installation
instructions will be added after the first verified public release.

The commands below run the workspace binary from the repository root.

## Usage

```bash
# Validate a BidRequest / BidResponse / supported vendor-feed payload
node packages/cli/bin/ortbtools.js validate bid-request.json

# From stdin (logs, curl, kafkacat, or a recognized URL-style request)
cat payload.json | node packages/cli/bin/ortbtools.js validate -

# Machine-readable output + CI-friendly exit codes
node packages/cli/bin/ortbtools.js validate bid.json --json --fail-on warn

# Compare heuristic detection with the OpenRTB version you target
node packages/cli/bin/ortbtools.js validate bid.json --expect-version 2.5

# Semantic crosscheck: does this response actually answer this request?
node packages/cli/bin/ortbtools.js crosscheck request.json response.json

# What is this payload?
node packages/cli/bin/ortbtools.js detect payload.json
```

## Options

| Flag                    | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `--json`                | Full JSON result instead of the pretty report                         |
| `--locale <en\|uk\|ru>` | Finding-message language (default `en`)                               |
| `--dialect <id>`        | Validation dialect, see `ortbtools dialects` (default `iab`)          |
| `--expect-version <v>`  | Emit `version.mismatch` if heuristic detection selects another bucket |
| `--fail-on <level>`     | Exit-1 threshold: `error` (default), `warn`, `never`                  |
| `--refs`                | Print a spec link when the finding has one                            |
| `--no-color`            | Disable ANSI colors (also honors the `NO_COLOR` env var)              |

Use the listed locale, dialect, and version ids. The current CLI delegates
unknown values to core: an unknown locale falls back to English, then Ukrainian, an unknown
dialect falls back to `iab`, and an unrecognized expected version is ignored.

## Exit codes

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| `0`  | Analyzed; nothing at/above the `--fail-on` level            |
| `1`  | Analyzed; findings at/above the `--fail-on` level exist     |
| `2`  | CLI usage, input-read error, or non-object crosscheck input |

## What it checks

- **OpenRTB 2.5 / 2.6** broad BidRequest and BidResponse field-level rules
- **OpenRTB 3.x / AdCOM** envelope and deep core-field rules; not exhaustive schema conformance
- **VAST** creatives embedded in `adm` (InLine/Wrapper chains)
- **Native** request/response asset crosscheck
- **Supported vendor feeds**; JSON Feed 1.1 is detected but not structurally validated
- **URL-style GET requests** for recognized clickunder/pop and link-feed shapes
- **Crosscheck**: request/response id, `bid.impid`, currency-aware floor
  clearance, `bcat`/`badv`, banner size, Native assets, VAST shape, and an
  auction summary

The engine is the local [`@ortbtools/core`](../core) workspace — the validator
behind the [ortbtools.com](https://ortbtools.com) web inspector, where you also
get creative preview, behavior analysis, and shareable reports.

## License

MIT
