# Quickstart: Validate OpenRTB Dialect Verification

Everything runs outside the product tree; `npm run ci` in the repository is untouched by design.
Working directory: `~/.local/share/ortbtools-research/prebid-2026-08-20/`.

## 1. The lab is fail-closed and pinned

Recreate the dedicated network as an internal bridge and publish no lab ports. The preflight and
witness runner execute as one-shot clients on that bridge. `audit/pbs-audit.yaml` contains the
explicit mock routes for the adapters in the frozen B1 manifest, including
secondary/hard-coded-route mitigations.

```bash
docker network create --driver bridge --internal --subnet 172.31.253.0/24 ortb-lab
docker run -d --name mock-dsp --network ortb-lab --network-alias mock-dsp \
  --user 1000:1000 --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev \
  --cap-drop ALL --security-opt no-new-privileges --workdir /app \
  --mount type=bind,src="$PWD/lab/mock-dsp.js",dst=/app/mock-dsp.js,readonly \
  --mount type=bind,src="$PWD/lab/data",dst=/data \
  node:22-alpine node mock-dsp.js
docker run -d --name pbs-lab --network ortb-lab --network-alias pbs-lab \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount type=bind,src="$PWD/audit/pbs-audit.yaml",dst=/etc/config/pbs.yaml,readonly \
  prebid-server:local
```

The preflight is a gate, not a diagnostic:

```bash
test "$(docker network inspect ortb-lab --format '{{.Internal}}')" = true
test -z "$(docker port pbs-lab)"
test -z "$(docker port mock-dsp)"
docker run --rm --network ortb-lab node:22-alpine \
  node -e "fetch('http://pbs-lab:8000/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
docker run --rm --network ortb-lab node:22-alpine \
  node -e "const n=require('net');const s=n.connect(443,'1.1.1.1');s.setTimeout(1000);s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));s.on('timeout',()=>process.exit(0))"
docker run --rm --network ortb-lab node:22-alpine \
  node -e "const n=require('net');const s=n.connect(8099,'mock-dsp');s.setTimeout(1000);s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1))"
```

Expected: all commands exit zero; `pbs-lab` logs `Main server starting on: :8000`. A preflight
failure aborts the run. Endpoint settings alone never substitute for the internal network.

## 2. Manifests and execution inputs are frozen before execution

Expected: the canonical B1/B2 manifest generations carry `frozenAt`, commit, image digest, mock
hash, selection-script hash and selection-input hashes. Before B1, `bundle-b1.json` also hashes the
complete case bundle, runner, controls, endpoint map and lab config. Superseded generations and
failed attempts remain in their run directories with an invalidation reason.

## 3. B1 witness run

Run the runner in a pinned one-shot Node container on `ortb-lab`, with the frozen bundle mounted
read-only and only its new run directory writable. It first validates the frozen bundle and executes
one separate positive control per adapter. Each control must show the mock URI and known mock
response. Only then are triggering/minimal-pair inputs executed. Every observed URI is retained and
checked against `http://mock-dsp:8099/`.

Expected: one immutable `audit/runs-b1/<run-id>/summary.json` beside its hash-chained
`journal.jsonl`, and `audit/runs-b1/<run-id>.bundle.json` holding the exact bundle bytes that run
cited, where pass+fail+inconclusive equals the frozen B1 member count. A lab/control failure aborts the run rather
than manufacturing case-level inconclusives.

## 4. B2 blind readings and adjudication

Expected: each fresh reader runs in a mount namespace containing only a copied adapter subtree, the
nine-disposition taxonomy and its output path. After all sampled adapters finish, recursively check
the schema and citation allowlist, write `readings/<reader-run-id>/index.json` with its `.sha256`
sidecar, and make the readings read-only. Only then expose the corpus to the diff/adjudication process.

`audit/adjudication-b2.json` records all four outcomes per adapter. Every `confirmed-omission` is
also present in the corpus with B2 provenance; each disposition disagreement is either separately
resolved or remains a named open gate.

## 5. Guards

`audit/guards.sh` (which runs `audit/guards.js`) scans the whole retained bundle recursively. It rejects corpus-wide precision or
recall claims, validates every source citation against the pinned adapter-tree allowlist, verifies all
content hashes, checks that the B1 URI allowlist is mock-only, confirms the blind-reader mount
records mask the corpus, repository and quarantine trees, and resolves every run's cited execution
bundle to bytes that still exist.

## 6. The product is untouched

Compare the branch against its base using an allowlist limited to the assessment and 008 governance
files; do not infer product immutability from a four-directory status check. Then run:

```bash
npm run ci
```

Expected: green without any reference to the audit lab.
