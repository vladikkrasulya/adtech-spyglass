# Implementation Plan: Creative Preview Repair — Wave 1

**Branch**: `012-creative-preview-repair` | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-creative-preview-repair/spec.md`

## Summary

The preview panel has two independent faults that the 22px safe-demo blur merges into one symptom.
The first is a **classification** fault: `setAdPreview`'s third branch is an unconditional catch-all,
so envelope-less native, bare URLs, base64 and unidentifiable text are all handed to the browser as
markup and painted as garbage. The second is a **communication** fault: when the sealed frame refuses
every sub-resource — which is its designed behaviour for any CDN-hosted creative — the panel says
nothing, and the residue of alt text and macro literals reads as a crash.

This wave repairs both without touching the network posture. Classification happens before display;
non-markup bodies are shown as inert text and named; refusals are counted inside the frame by the
probe, carried to the parent on a **separate message type**, and stated in one sentence. The frame's
content policy, its sandbox attribute, and `/api/creative/asset` are unchanged, and no new outbound
request exists anywhere in the design.

The wave also installs the regression gate whose absence let the original change ship green.

## Technical Context

**Language/Version**: Node.js `>=22.13.0`, CommonJS server, vanilla browser JavaScript (no bundler)

**Primary Dependencies**: none added. Reuses `packages/core/vast-shape.js` for VAST recognition and
the existing probe transport for refusal reporting.

**Storage**: none. The refusal ledger lives for one render and is discarded on the next mount.

**Testing**: `node:test`. Browser-behaviour coverage follows the existing pattern in
`tests/macro-evaluator-browser.test.js` (puppeteer-core, already a dependency).

**Target Platform**: the hosted SPA; the Inspector route's right-hand preview column.

**Project Type**: web application — lazy SPA sections over a `node:http` composition root.

**Performance Goals**: classification is a synchronous string/shape test on a bounded body and must
not measurably delay first paint of the preview. Refusal counting must stay flat under a creative
that emits thousands of violations.

**Constraints**: zero new network requests; the injected content policy and `sandbox="allow-scripts"`
byte-identical to today; the bytes handed to the frame unchanged, because the behaviour engine and
the static scanner measure exactly those bytes; behaviour findings identical in number and content
before and after.

**Scale/Scope**: one render path, one probe hook, one CSS block, three locale dictionaries, three
HTML templates. No server change.

## Constitution Check

_GATE: evaluated before Phase 0, re-evaluated after Phase 1 design. Both passes recorded._

| Principle                            | Gate                                                                                                                        | Pass 0                                                                                      | Post-design          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------- |
| I. Spec Kit is working memory        | Package exists with testable spec, plan, tasks; constitution, roadmap and baseline contracts read before authoring          | PASS — read before `spec.md` was written                                                    | PASS                 |
| II. Truth is evidence-backed         | Every causal claim cited at `file:line` or commit and re-verified against the working tree                                  | PASS — see [research.md](./research.md)                                                     | PASS                 |
| III. Privacy/security boundaries     | Any change to sandboxing or SSRF controls updates the privacy/security contract and its regression tests in the same change | PASS — this wave changes neither; the contract statement is _strengthened_ by an added test | PASS — see Design §5 |
| IV. Public contracts deterministic   | No silent change to finding IDs, API shapes, or route semantics                                                             | PASS — no server route touched; behaviour findings must be provably unchanged (FR-009)      | PASS                 |
| V. Architecture explicit and bounded | Follow the owning subsystem's contract; no new framework, service or facade; honour `AbortSignal`                           | PASS — extends the existing probe transport and mount lifecycle; nothing new introduced     | PASS — see Design §2 |
| VI. Locales move together            | All three locales in the same change, informal singular for uk/ru                                                           | PASS — enumerated as tasks, with a parity assertion                                         | PASS                 |
| VII. Verification proportional       | Regression test for every behaviour change; narrowest tests first, `npm run ci` before merge                                | PASS — FR-015 exists precisely because this gate was missing                                | PASS                 |
| VIII. Releases traceable             | Planning does not authorize commit, deploy, or publication                                                                  | PASS — no such action is in scope here                                                      | PASS                 |

**Constraint check** (`.specify/memory/constitution.md:106`): _"Creative preview remains sandboxed
without `allow-same-origin`; outbound proxy changes preserve allowlists plus port, time, redirect, and
response-size limits."_ This wave adds no `allow-same-origin` and makes no outbound proxy change.

**Contract check** (`specs/000-platform-baseline/contracts/frontend-modules.md:114-122`): _"Preview
markup must never be promoted into the parent origin."_ Binding on FR-006. See Design §3 — inert text
is written with `textContent`, never `innerHTML`, and the existing VAST branch is moved onto the same
footing rather than being copied.

No violations. Complexity Tracking is therefore empty and omitted.

## Project Structure

### Documentation (this feature)

```text
specs/012-creative-preview-repair/
├── spec.md
├── plan.md              # this file
├── research.md          # forensic evidence, ranked causes, rejected options
├── data-model.md
├── quickstart.md
├── contracts/
│   └── creative-preview.md
├── checklists/
│   └── requirements.md
└── tasks.md             # $speckit-tasks output
```

### Source (repository root)

```text
public/
├── ortbtools.app.js                        # setAdPreview branches, probe receiver, reveal action
├── creative-probe.js                       # refusal listener inside the frame
└── modules/inspector/
    ├── creative-classify.js                # new — the single classification gate
    ├── inspector.css                       # overlay gating, text-mode scroll
    ├── dialect-label.i18n.js               # preview dictionary (3 locales)
    └── template.{en,uk,ru}.html            # refusal ledger host element

packages/core/
└── vast-shape.js                           # reused, unchanged — VAST recognition

tests/
├── creative-preview-classify.test.js       # new — classification table
├── creative-preview-seal.test.js           # new — the regression gate (FR-015)
└── macro-evaluator-browser.test.js         # existing network assertion, unchanged
```

**Structure Decision**: no new directories. The feature lives entirely in the existing Inspector
module and the probe, because both already own exactly these responsibilities; introducing a new
module for classification would be the "parallel facade" Principle V prohibits.

## Design

### 1. Classification happens once, before any display decision

A pure function takes the macro-resolved body and returns a classification plus the reason for it.
Order is fixed and documented in [contracts/creative-preview.md](./contracts/creative-preview.md),
because a body can satisfy more than one test:

1. **VAST** — delegated to `packages/core/vast-shape.js`. The current inline regex at
   `public/ortbtools.app.js:1351` is anchored so tightly that a byte-order mark, a leading comment or
   a processing instruction defeats it; the core detector already handles those, and having the
   preview and the format detector disagree about what VAST is would be its own defect.
2. **Native** — JSON whose assets are reachable either as `native.assets` or as a top-level `assets`
   array. This is the widening that FR-004 asks for.
3. **JSON, not native** — parses as JSON but carries no native assets. Displayed as an unidentified
   payload, never as markup. This is the silent path that produces the reported symptom today.
4. **Base64** — decoded once, bounded, then re-classified. Exactly one decode round, so a nested
   payload cannot recurse.
5. **URL** — a body that is a single absolute `http(s)` URL and nothing else.
6. **Markup** — the only classification that reaches `srcdoc`.
7. **Unidentifiable** — everything else.

The function is pure and lives where it can be unit-tested without a browser.

**It replaces all three existing detections, not just the catch-all.** The inline VAST regex at
`public/ortbtools.app.js:1351` and the native envelope test at `:1381` are deleted, and every branch
routes on `kind`. Wiring the classifier only ahead of branch 3 would leave two hand-maintained
detectors beside a third that is unit-tested but unreachable — FR-003's delegation would never take
effect on the real render path, and the duplicate native detection Principle V prohibits would survive
the change that was supposed to remove it.

### 2. The refusal ledger rides its own message type

The probe already runs inside the frame before any creative markup parses, which is exactly where a
`securitypolicyviolation` listener has to be. Four constraints shape this, each derived from a
verified failure mode rather than from caution:

- **A separate type, not a behaviour event.** The parent receiver at `public/ortbtools.app.js:5965`
  accepts only `type === 'ortbtools-probe'` and forwards everything non-heartbeat into
  `pushBehaviorEvent`, which caps at 500 and drops the oldest. A creative emitting 600 refusals would
  evict genuine navigation and frame-bust evidence before it was ever sent. That is an
  evidence-eviction primitive, not a cosmetic bug. Refusals therefore travel as
  `ortbtools-preview-refusal`, are counted separately, and never enter the behaviour buffer. The
  existing source-pinning check applies unchanged.
- **Deduplicated by directive and blocked resource.** The `srcdoc` document is governed by two
  overlapping policies — the injected meta and the page policy it inherits (`server.js:1337-1349`) —
  so a single refused resource can raise two violations. Counting raw events would inflate the number
  the analyst is being asked to trust.
- **Listener on `window`, capture phase.** `document.open()` detaches document-level listeners, and it
  is reachable on exactly the most tangled creatives.
- **Coalesced, not streamed.** Refusals arrive in bursts; the probe batches on a short timer so a
  pathological creative cannot turn counting into a message storm.

The parent stores the ledger for the active render only, and clears it in `setAdPreview` alongside
`resetBehavior()` and `stopWatchdog()`.

### 3. Non-markup bodies are inert text in the parent, written as text

FR-006 needs somewhere to put a classified payload. The baseline contract forbids promoting preview
markup into the parent origin, so:

- text is written with `textContent`, never `innerHTML` — no escaping function stands between hostile
  input and the parent DOM, because no parse happens at all;
- no `<a href>` is generated for a URL body, so inert text cannot become a one-click beacon;
- the VAST branch, which today builds `innerHTML` from `escapeHtml(display)`, moves onto the same
  footing rather than being duplicated.

### 4. The overlay stops covering things it cannot reveal

`setDims` is what switches the overlay on, via `data-has-creative`. The VAST branch calls it purely to
size the box, and inherits an overlay over text that no reveal will ever change. Sizing and
revealability become separate signals: text-mode previews size themselves and declare no revealable
creative. The blur selector (`public/modules/inspector/inspector.css:1056`) already matches only
`iframe, img`, so nothing about screenshot-safety for actual creatives changes.

### 5. The regression gate

Two tests, and the distinction between them matters:

- **`creative-preview-classify.test.js`** — a table over every body shape in
  [contracts/creative-preview.md](./contracts/creative-preview.md), asserting the classification and
  that only `markup` is ever handed to a frame. Pure, fast, no browser.
- **`creative-preview-seal.test.js`** — the gate FR-015 requires. It asserts the _current_ rendering
  outcome for a creative carrying an `https:` image, and its name states that the outcome is
  intentional. It fails if the policy is widened **or** narrowed. This is deliberately a
  characterisation test: its value is not that today's answer is right, but that changing the answer
  becomes a decision someone has to make on purpose. `tests/macro-evaluator-browser.test.js:251` keeps
  its `trapRequests === 0` assertion unchanged — the two are complementary, and the reason this
  defect shipped is that only the second existed.

### 6. Deliberately deferred within this wave

- **Macro legend.** FR-016 is satisfied by explaining unresolved literals _below_ the frame. Rewriting
  them inside the markup would change the bytes the behaviour engine and the static scanner measure,
  which FR-012's constraint forbids.
- **Quirks mode.** Correcting the displaced `<!DOCTYPE>` means changing the prefix, and the prefix is
  the measured artefact. Scheduled only if a correction exists that leaves the creative's own bytes
  untouched; otherwise it carries forward with its evidence into wave 2.
- **`findAdm` first-hit ordering** (research §3.6) is a real defect but a different one: it selects the
  wrong creative rather than mis-displaying the right one. Recorded, not fixed here.

## Complexity Tracking

No constitutional violations; section intentionally empty.
