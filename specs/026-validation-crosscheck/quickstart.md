# Quickstart: Verify Validation Semantics

## Prerequisites and checkout

Use the dedicated `codex/026-validation-crosscheck` worktree created from main `340ffd3`, Node.js >=22.13.0 and installed workspace dependencies. Keep peer checkouts and browser processes separate. The local feature pointer is `.specify/feature.json` with `feature_directory` set to `specs/026-validation-crosscheck`.

```bash
.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
node --test tests/validation-semantics-crosscheck.test.js
node --test tests/crosscheck-price-floor.test.js tests/audio-repair.test.js tests/spec-refs.test.js tests/spec-kit-contract.test.js
```

The new boundary regressions cover the two waves' positive and negative controls. The retained 022 and 023 tests protect economic resolution, supplied MIME types and bounded XML evidence. Add the actual HTTP/CLI test file names to the verification record if those tests are split into separate files.

## Corpus verification

Use the current corpus runner and the real `tests/corpus/lib/load.js` loader. Record all 256 case identities and exact unrelated deviation signatures before changes, then compare after each wave. Expected outcomes come from the fixtures and their pinned primary sources. Remove only proven resolved signatures; preserve an independent browser failure under its existing defect identity. Run all applicable Core, HTTP and browser layers with browser coverage required.

## Full gates with peer-safe Chrome

Adapt the retained `2026-09-08-023-audio-repair/run-isolated-ci.sh` recipe into the external `2026-09-08-026-validation-crosscheck/` evidence directory: private Chrome profile prefix, the matching private `ci-bin/pgrep` on `PATH`, and `unshare --user --map-current-user --pid --fork --mount-proc`. These isolate cleanup; test assertions and browser policy stay unchanged.

```bash
npm run ci
bash scripts/npm-pack-smoke.sh
bash scripts/ci-docker-smoke.sh ortbtools-ci-smoke:validation-026
```

Run full CI through that isolated wrapper on this shared host. Record the exact invoked commands, exit statuses, runner totals and any retries. Package scripts must prove the packed Core/CLI combination; Docker smoke uses its temporary image/container lifecycle and does not deploy production.

## Version and branch delivery

Before each reviewed push, read back the Core manifest, CLI dependency and workspace lock entries. The final value is Core 0.45.0 and CLI Core range `^0.45.0`, even if another branch independently changed the same starting value. Stage the explicit authored allowlist. Commit and push once after wave A, then once after wave B, obeying the mandatory pre-push gate. Wait for hosted CI for the pushed SHA and retain the run URL/result. The maintainer owns main integration.

## Expectation identity binding and peer-owned observations

Existing fixture IDs prefixed `expected.` are unbound semantic symbols, not shipped finding IDs. Bind only the selected affected symbols to implemented public IDs, retaining every payload, severity, path and parameter assertion. The corpus harness/oracle stays unchanged; the real 256-case loader comparison proves the bounded impact. DEF-151 additionally has recognition/preview expectations owned by another agent; those observations must pass before its record is retired. Assigned-file implementation can proceed while that ownership coordination remains explicit.
