# Direct adapter witnesses

These owned scripts reproduce the nineteen frozen questions in feature033.
They require the preserved **synthetic**008 audit controls and a disposable
Prebid Server checkout at `0ba352315253f6692af6497d553cfb12909a1b8b`.
No third-party source tree is included here. The adapter source is Apache-2.0;
the retained corpus records its attribution and source citations.

The prepared environment on `vkbox` is
`/tmp/ortbtools-dialect033-kplg6vsh`. Official Go1.25.0 was checked against
`go.dev` SHA256, and dependencies were downloaded in a separate preparation
step. Its `evidence/prerequisites.json` contains the exact toolchain/image
and command. `run.py` checks the pinned revision and unchanged tracked source,
freezes harness/case/source hashes, and creates a network-none container with
read-only source/root filesystem, uid1000, dropped capabilities and a private
executable tmpfs. No HTTP request is sent; the test calls `MakeRequests` and
examines generated request data.

To reproduce in the prepared disposable directory:

1. Copy these scripts into `harness/`, the frozen feature witness manifest
   into `harness/witness-manifest.json`, and `witness_test.go` into
   `source/ortbtools033/`. Format the Go file with the pinned `gofmt`.
2. Run `python3 harness/generate.py ARCHIVE/audit harness/witness-manifest.json source/ortbtools033/cases.json`.
3. Run `python3 harness/run.py OWNED_ROOT NEW_ATTEMPT_NUMBER`.
4. After all19 pass, run `python3 harness/amend.py ARCHIVE OWNED_ROOT SUCCESSFUL_ATTEMPT_NUMBER`.

Every attempt gets a new directory; existing attempts cannot be overwritten.
The amendment produces `derived/adapter-rules-033.json` and a per-ID report.
It verifies the old corpus digest and never writes the original archive.
Only four classifications change; seventeen unique corpus rows receive the
nineteen proofs because three Insticator questions share one existing row.

The successful generation contains69 variant executions and181 assertions.
All variants have fresh inputs/adapters, independent positive controls and
source-specific errors or exact transformation/fanout expectations. Grouped
requests are ordered by content, and fanout is checked by request and impression
identity. Huawei's documented test nonce stabilizes Authorization; its unrelated
generated `device.clientTime` remains in raw evidence and is not a causal oracle.
Gamma legitimately emits bodyless GET request data. Huawei's documented
`closeSiteSelectionByCountry` option keeps generated endpoints on `mock.invalid`.

Attempts001 and002 remain retained: executable tmpfs was initially missing,
then the harness exposed Huawei's regional endpoint selection and Gamma's GET
body semantics. Attempts003 and004 pass all19;004 adds explicit source/membership
preflight. Neither prior failure was erased or counted as product evidence.
The historical008 auction result remains36pass/12inconclusive. This new direct
adapter generation supports declared-profile applicability; it makes no traffic
frequency, actual-route or corpus-wide accuracy claim.
