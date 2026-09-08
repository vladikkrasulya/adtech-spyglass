# Implementation Plan: Complete the Audio Repair

**Branch**: `codex/023-audio-repair` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/023-audio-repair/spec.md`

## Summary

Adopt the reviewed Gemini audio patch, repair the scanner's malformed-attribute nonprogress and helper JSDoc, and put all independent review controls into repository tests. Retain its bounded audio classification, required MIME validation, DAAST inert preview and three-group corpus retirement. Record Core 0.42.0 and verify the settled change in an isolated worktree without interfering with active Claude Code/Cursor work.

## Technical Context

**Language/Version**: Node.js >=22.13.0; existing CommonJS Core and browser JavaScript.
**Primary Dependencies**: Existing workspace and browser test dependencies; no new runtime dependency.
**Storage**: No persisted model or schema change; synthetic test artifacts only.
**Testing**: `node:test`, public Core/HTTP/CLI checks, existing corpus browser harness, Prettier/ESLint/JSDoc, `npm run ci`, package smoke.
**Target Platform**: Node server and CLI, existing hosted Inspector browser.
**Project Type**: Workspace library and web application.
**Performance Goals**: Monotonic bounded XML scans; hostile parser probes complete inside a isolated worker/process watchdog rather than hanging the test runner.
**Constraints**: No network/entity expansion in Core; no iframe privilege or preview fetching changes. No shared-main edits, index operations or process cleanup affecting peers.
**Scale/Scope**: Adopted 35-file Gemini patch plus bounded parser/type repair, regression coverage and feature/contract records; 17 original audio corpus cases and three retired groups.

## Constitution Check

Evaluated against v2.1.0 before design and rechecked after design. These are design decisions, not claims that pending runtime gates passed.

| Principle              | Evaluation and bounded obligation                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I — Working memory     | Constitution, ROADMAP, baseline contracts and 020/021 context read. Spec/plan/checklist/tasks and pre-implementation analysis precede this repair. The spec explicitly records Gemini's earlier process violation and recovery; no retroactive approval or history is invented.      |
| II — Evidence          | Preserved completion snapshot/review supplies before evidence; final verification records actual commands, runner totals and exact local scope. No baseline CI result is reused as current proof.                                                                                    |
| III — Privacy/security | No collection, persistence, network, model, authentication, SSRF or sandbox policy changes. Synthetic tests remain offline; DAAST is inert. Parser termination is repaired inside the existing boundary.                                                                             |
| IV — Compatibility     | Existing API shapes, IDs, sorting, deduplication and CLI exit policy remain; two new error IDs and corrected protocol evidence are explicitly documented in contracts/audio-behavior.md with public-boundary tests.                                                                  |
| V — Architecture       | Existing Core detector/rules/shared browser shape helper remain owners. No framework, parser dependency, state store or global facade.                                                                                                                                               |
| VI — Locales           | Both new IDs require en/uk/ru messages and reference coverage. The existing preview kind remains; its caption identifies ad XML accurately in all three locales.                                                                                                                     |
| VII — Verification     | Focused negative controls first, then affected corpus/browser and complete local CI plus package gates. Bound malformed probes; isolate CI process cleanup; record limitations truthfully.                                                                                           |
| VIII — Traceability    | Core minor 0.40.0→0.42.0, CLI dependency ^0.42.0; app1.19.4 and CLI0.1.3 unchanged. User authorized adopting exact Gemini scope. Deliver a verified isolated local commit/patch; shared main, push and deployment wait for safe integration with peer work and their required gates. |

No privacy or destructive-action exception is requested. Existing supported runtime, deterministic processing, immutable deployment and unpublished-package constraints remain unchanged. No unrelated work is staged. Constitution recheck after design finds no unresolved conflict for the new repair; Gemini's historical pre-spec implementation is explicitly recorded.

## Project Structure

### Documentation (this feature)

```text
specs/023-audio-repair/
  spec.md
  plan.md
  research.md
  data-model.md
  contracts/audio-behavior.md
  quickstart.md
  checklists/requirements.md
  checklists/audio-boundaries.md
  tasks.md
  verification.md
```

### Source Code (repository root)

```text
packages/core/format-detect.js          # metadata mapping and bounded creative scan
packages/core/vast-shape.js            # shared VAST/DAAST shape recognition
packages/core/rules-vast.js            # accepted audio media types
packages/core/rules-request.js         # required/invalid audio MIME errors
packages/core/messages/{en,uk,ru}.json
packages/core/spec-refs.json
packages/core/package.json
packages/cli/package.json
package-lock.json
public/core/vast-shape.js              # synchronized browser shape helper
public/modules/inspector/creative-classify.js
public/modules/inspector/dialect-label.i18n.js # neutral ad XML caption
tests/format-detect.test.js
tests/vast.test.js
tests/creative-preview-classify.test.js
tests/audio-repair.test.js            # public-boundary and isolated malformed controls
tests/corpus/                        # adopted 17 cases and exact ledger changes
specs/000-platform-baseline/contracts/{core-validator,locales-versioning}.md
specs/{README,ROADMAP}.md
specs/020-ad-format-verification-matrix/defects.md
```

**Structure Decision**: Retain existing subsystem ownership; a dedicated regression test file may organize the adopted external controls without adding a runtime abstraction.

## Implementation Design

1. Preserve the adopted 35-file snapshot in external research storage and work from the isolated `codex/023-audio-repair` checkout. Keep the machine-local feature pointer there only; 022 belongs to separate work.
2. Pin review expectations first. Add the 12 controls for independent media evidence, comments/CDATA, scalar versus array ctype, namespace roots, quoted attributes and DOCTYPE. Put the malformed-token reproduction and truncated variants behind a isolated worker/process timeout and memory limit; a hung child must fail cleanly without hanging the suite.
3. Repair `parseTagAttributes` so every loop consumes input or stops. Do not reinterpret malformed tokens as valid attribute evidence. Preserve quoted values and ignore apparent attributes within them. Document `skipDocType` string/index input and numeric return; attach the creative-inspection object JSDoc to its actual helper. Keep all scans bounded, no entity expansion or external fetch. Skip Extension/CreativeExtension subtrees: the pre-repair review proved that schema-valid vendor metadata can contain MediaFile-shaped XML unrelated to actual media.
4. Verify the adopted new `imp.audio.mimes_required` and `imp.audio.mimes_invalid` errors through public Core and real HTTP, including localized paths/levels and default CLI rejection where applicable. Preserve required-versus-invalid distinction and existing result shape.
5. Re-run original audio cases across Core, HTTP and browser; only their ledger associations change. Preserve the multi-bid browser DEF-201 guard. DAAST is the existing `vast` text preview kind, not playback support.
6. Update baseline contracts and versions; run narrow suites, complete CI in a PID namespace (preventing the runner's broad Chromium cleanup from reaching peer processes), package smoke and other required changed-surface gates. Record exact outcomes in verification.md and an external delivery receipt; do not infer green hosted or production state.

## Complexity Tracking

No new abstraction or approved exception is needed. Historical pre-spec Gemini work is documented in spec.md; newly authored work follows the lifecycle. Final verification and convergence remain pending.
