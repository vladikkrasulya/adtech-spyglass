# Quickstart: Validate OpenRTB Dialect Verification

Everything runs outside the product tree; `npm run ci` in the repository is untouched by design.
Working directory: `~/.local/share/ortbtools-research/prebid-2026-08-20/`.

## 1. The lab is up and pinned

```bash
docker network create ortb-lab 2>/dev/null
docker run -d --name mock-dsp --network ortb-lab -v $PWD/lab:/app -v $PWD/lab/data:/data \
  -w /app node:22-alpine node mock-dsp.js
docker run -d --name pbs-lab --network ortb-lab -v $PWD/lab/pbs.yaml:/etc/config/pbs.yaml:ro \
  -e PBS_ADAPTERS_M152_ENDPOINT="http://mock-dsp:8099/m152" \
  -e PBS_ADAPTERS_IX_DISABLED="false" \
  prebid-server:local
```

Expected: both containers running; `pbs-lab` log shows `Main server starting on: :8000`. The `m152`
override is mandatory — without it prebid-server fails its own config validation at startup.

## 2. Manifests are frozen before execution

Expected: `audit/manifest-b1.json` and `audit/manifest-b2.json` exist, carry `frozenAt`, the pinned
commit, image digest and mock hash, and their timestamps predate every result file.

## 3. B1 witness run

Expected per case: triggering assertion checked against `ext.debug.httpcalls.{bidder}[].requestbody`,
minimal pair checked the same way, execution control present for the adapter. Output
`audit/results-b1.json` where pass+fail+inconclusive = manifest member count.

## 4. B2 blind readings and adjudication

Expected: one reading per sampled adapter whose citations reference only that adapter's files; then
`audit/adjudication-b2.json` with all four outcome counts per adapter, and every
`confirmed-omission` also present as a new corpus rule with B2 provenance.

## 5. Guards

```bash
# no corpus-wide claims anywhere in artifacts
grep -rniE "corpus-wide|recall (rate|estimate)|precision (rate|estimate)" audit/ && echo VIOLATION || echo clean
# quarantine never cited
grep -rl "QUARANTINE\|kb.indexexchange\|helpjuice\|docs.hivestack" audit/*.json && echo VIOLATION || echo clean
```

## 6. The product is untouched

```bash
git status --porcelain -- lib/ modules/ public/ server.js
```

Expected: empty. IAB findings for any payload are byte-identical before and after (SC-006).
