# Implementation Plan: Creative Preview Repair — Wave 1

**Branch**: `main` (direct production-remediation workflow) | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-creative-preview-repair/spec.md`

## Summary

The preview panel has two independent faults that the 22px safe-demo blur merges into one symptom.
The first is a **classification** fault: `setAdPreview`'s third branch is an unconditional catch-all,
so envelope-less native, bare URLs, base64 and unidentifiable text are all handed to the browser as
markup and painted as garbage. The second is a **communication** fault: when the sealed frame refuses
every sub-resource — which is its designed behaviour for any CDN-hosted creative — the panel says
nothing, and the residue of alt text and macro literals reads as a crash.

This wave repairs both without widening creative network access. Classification happens before
display; raw non-markup bodies are inert and named; wrapped or unwrapped Native becomes escaped
synthetic HTML; and refusals are counted inside the frame, authenticated with a hidden per-render
capability, capped again by the parent, and stated in one sentence. The frame policy, sandbox, asset
route, limits, response types, and explicit-click semantics are unchanged, with no Native
asset-inlining offer. The existing host guard is separately narrowed so every IPv4-mapped IPv6
literal inherits its embedded IPv4 classification before a socket opens. The existing same-origin
behavior endpoint now analyzes the exact bounded body selected to execute, including when there are
zero runtime-visible events.

The wave also installs the regression gate whose absence let the original change ship green.

## Technical Context

**Language/Version**: Node.js `>=22.13.0`, CommonJS server, vanilla browser JavaScript (no bundler)

**Primary Dependencies**: none added. Reuses the generated browser copy of
`packages/core/vast-shape.js` as the sole VAST detector, Web Crypto for a per-render capability, and
the existing probe/behavior endpoint for transient analysis.

**Storage**: none. The refusal ledger lives for one render and is discarded on the next mount.

**Testing**: `node:test`. Browser-behaviour coverage follows the existing pattern in
`tests/macro-evaluator-browser.test.js` (puppeteer-core, already a dependency).

**Target Platform**: the hosted SPA; the Inspector route's right-hand preview column.

**Project Type**: web application — lazy SPA sections over a `node:http` composition root.

**Performance Goals**: classification is a synchronous string/shape test on a bounded body and must
not measurably delay first paint. Inspector activation awaits one content-hash-versioned probe fetch;
refusal state remains capped at 200, and static source transport remains a deterministic 1 MiB UTF-8
window.

**Constraints**: zero new automatic advertiser/third-party requests; the injected content policy and
`sandbox="allow-scripts"` byte-identical to today; raw payload reaches `srcdoc` only as classified
markup, while Native reaches it only as escaped synthetic HTML; static scanning receives the same
selected executing body within its declared 1 MiB bound; refusal reporting cannot affect behavior
events or findings.

**Scale/Scope**: one render path, one probe hook, one CSS block, one Inspector locale module, the
existing `/api/analyze-behavior` handler, the existing creative-asset host classifier, and focused
unit/handler/browser/host-boundary tests. No new route, service, persistence, or dependency.

## Constitution Check

_GATE: evaluated before Phase 0, re-evaluated after Phase 1 design. Both passes recorded._

| Principle                            | Gate                                                                                                               | Pass 0                                                                                                           | Post-design            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| I. Spec Kit is working memory        | Package exists with testable spec, plan, tasks; constitution, roadmap and baseline contracts read before authoring | PASS — read before `spec.md` was written                                                                         | PASS                   |
| II. Truth is evidence-backed         | Every causal claim cited at `file:line` or commit and re-verified against the working tree                         | PASS — see [research.md](./research.md)                                                                          | PASS                   |
| III. Privacy/security boundaries     | Any change to sandboxing or outbound access updates the contract and regression tests in the same change           | PASS — policy/sandbox stay sealed; mapped-host acceptance narrows and updates the owning security/HTTP contracts | PASS — see Design §6   |
| IV. Public contracts deterministic   | No silent change to finding IDs, API shapes, or route semantics                                                    | PASS — the behavior request extension is additive and preserves legacy `{events,adm}`                            | PASS — see Design §5   |
| V. Architecture explicit and bounded | Follow the owning subsystem's contract; no new framework, service or facade; honour `AbortSignal`                  | PASS — extends the Inspector, probe, and existing behavior handler only                                          | PASS — see Design §2–5 |
| VI. Locales move together            | All three locales in the same change, informal singular for uk/ru                                                  | PASS — enumerated as tasks, with a parity assertion                                                              | PASS                   |
| VII. Verification proportional       | Regression test for every behaviour change; narrowest tests first, `npm run ci` before release                     | PASS — unit, handler, sealed-policy, and real-browser gates are explicit                                         | PASS — see Design §6   |
| VIII. Releases traceable             | Release actions follow current constitutional authorization and retain evidence                                    | PASS — planning records scope and required gates                                                                 | PASS                   |

**Constraint check** ([Constitution](../../.specify/memory/constitution.md) §Architectural and
Operational Constraints): creative preview remains sandboxed without `allow-same-origin`, and
outbound controls retain their protocol, port, time, redirect, response-size, DNS-answer, and pinned
connect guarantees. This wave changes no frame permission or proxy surface; it closes one alternate
spelling of an already-private target before the existing socket path.

**Contract check**: [frontend modules](../000-platform-baseline/contracts/frontend-modules.md)
§Creative Preview and Behavior Probe requires that preview markup never be promoted into the parent
origin. Binding on FR-006. See Design §3 — inert text is written with `textContent`, never
`innerHTML`, and the existing VAST branch is moved onto the same footing rather than being copied.

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
├── ortbtools.app.js                        # classification/render path, source transport, authenticated receiver
├── creative-probe.js                       # hidden capability, behavior hooks, bounded refusal listener
└── modules/inspector/
    ├── creative-classify.js                # the single fail-closed classification gate
    ├── inspector.css                       # overlay gating, text-mode scroll
    └── dialect-label.i18n.js               # preview dictionary (3 locales)

modules/analyze/
└── handler.js                              # additive canonical adm_b64 behavior transport

lib/
└── traffic-class.js                        # mapped-address normalization before host classification

public/modules/behavior/
└── behavior-tab.js                         # zero-event static requests + stale-response generations

server.js                                       # content-hashes the runtime creative-probe fetch

packages/core/
└── vast-shape.js                           # reused, unchanged — VAST recognition

tests/
├── creative-preview-classify.test.js       # classification table + fail-closed dependencies
├── creative-preview-seal.test.js           # byte-exact policy/sandbox gate (FR-015)
├── analyze-behavior-transport.test.js      # canonical/legacy transport boundary
├── creative-preview-browser.test.js        # real CSP, capability, render and source parity
├── i18n-audit.test.js                      # module locale/placeholder parity
├── macro-evaluator-browser.test.js         # existing independent zero-network assertion
├── traffic-class.test.js                   # mapped literal normalization boundaries
└── asset-fetch.test.js                     # zero-request private controls + permitted public control
```

**Structure Decision**: no new subsystem. The small pure classifier belongs to the existing Inspector
module; probe authentication remains in the probe/parent boundary; exact-source decoding remains in
the existing analyze handler. No parallel renderer, scanner, route, or transport facade is created.

## Design

### 1. Classification happens once, before any display decision

A pure function takes the macro-resolved body and returns a classification plus the reason for it.
Order is fixed and documented in [contracts/creative-preview.md](./contracts/creative-preview.md),
because a body can satisfy more than one test:

1. **VAST** — delegated to `packages/core/vast-shape.js`. The current inline regex at
   `50c6294:public/ortbtools.app.js:1351` is anchored so tightly that a byte-order mark, a leading comment or
   a processing instruction defeats it; the core detector already handles those, and having the
   preview and the format detector disagree about what VAST is would be its own defect.
2. **Native** — JSON whose assets are reachable either as `native.assets` or as a top-level `assets`
   array. This is the widening that FR-004 asks for.
3. **JSON, not native** — parses as JSON but carries no native assets. Displayed as an unidentified
   payload, never as markup. This is the silent path that produces the reported symptom today.
4. **Base64** — padded or valid unpadded input is normalized for `atob`, decoded once within the
   input bound, then re-classified. A one-character final quantum is invalid; nested base64 does not
   recurse.
5. **URL** — a body that is a single absolute `http(s)` URL and nothing else.
6. **Markup** — the only raw classification body that reaches `srcdoc` directly.
7. **Unidentifiable** — everything else.

The function is pure and lives where it can be unit-tested without a browser. The generated browser
Core detector is a safety dependency: if it is absent, the whole classification fails closed to
`unidentified`, preventing VAST-shaped markup from falling through to `srcdoc`. `setAdPreview` uses
the same fail-closed result if the classifier itself is absent.

**It replaces all three existing detections, not just the catch-all.** The inline VAST regex at
`50c6294:public/ortbtools.app.js:1351` and the native envelope test at
`50c6294:public/ortbtools.app.js:1381` are deleted, and every branch
routes on `kind`. Wiring the classifier only ahead of branch 3 would leave two hand-maintained
detectors beside a third that is unit-tested but unreachable — FR-003's delegation would never take
effect on the real render path, and the duplicate native detection Principle V prohibits would survive
the change that was supposed to remove it.

"Only markup reaches `srcdoc`" applies to raw payload bodies. Native is normalized and escaped into a
standalone synthetic HTML card first; only that generated card is framed and probed. Raw Native JSON,
VAST, URLs, generic JSON, and prose remain inert. The newly reachable Native branch deliberately has
no asset-inlining/network offer in wave 1.

### 2. The refusal ledger rides its own message type

The probe already runs inside the frame before any creative markup parses, which is exactly where a
`securitypolicyviolation` listener has to be. Four constraints shape this, each derived from a
verified failure mode rather than from caution:

- **A separate type, not a behaviour event.** The behavior buffer caps at 500 and drops the oldest.
  A creative emitting 600 refusals would otherwise evict genuine navigation and frame-bust evidence.
  Refusals therefore travel as `ortbtools-preview-refusal`, are counted separately, and never enter
  the behavior buffer or request.
- **Source pin plus a hidden capability.** Creative code shares the correctly source-pinned iframe and
  can call `parent.postMessage`, so source identity is not authentication. Each inlined probe closes
  over a fresh cryptographically random per-render channel and removes its own channel-bearing script
  element before payload markup parses. Both reserved message types require source and channel.
- **Parent-owned schema and caps.** The probe and parent independently cap a render at 200 refusals.
  The parent accepts at most 200 batch items, validates version/timestamp/boolean/array/string fields,
  limits directives to 64 characters and URIs to 2048, and marks any overflow as truncated.
- **Deduplicated by directive and blocked resource.** The `srcdoc` document is governed by two
  overlapping policies — the injected meta and the page policy it inherits
  (`50c6294:server.js:1337-1349`) —
  so a single refused resource can raise two violations. Counting raw events would inflate the number
  the analyst is being asked to trust.
- **Listener on `window`, capture phase.** `document.open()` detaches document-level listeners, and it
  is reachable on exactly the most tangled creatives.
- **Coalesced, not streamed.** Refusals arrive in bursts; the probe batches through a private
  `MessageChannel` task (with a captured microtask fallback) so a pathological creative cannot turn
  counting into a message storm, replace the scheduling primitive, or cancel a guessed timer handle.
- **Stable localized kinds.** Chromium's `script-src-elem`/`style-src-elem` and related aliases are
  normalized to the resource groups the locale dictionary owns instead of leaking raw placeholders.

The parent stores the ledger for the active render only, and clears it in `setAdPreview` alongside
`resetBehavior()` and `stopWatchdog()`.

Inspector activation awaits the one-time probe fetch before Analyze is available. The static server
rewriter adds the probe file's content hash to this runtime `fetch()` URL; without that explicit pass,
the CDN could pair a stale probe with a fresh authenticated receiver and silently disable telemetry.

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
creative. The blur selector (`50c6294:public/modules/inspector/inspector.css:1056`) already matches only
`iframe, img`, so nothing about screenshot-safety for actual creatives changes.

VAST's hidden-character notice is resolved through the same three-locale module dictionary, and the
locale audit compares placeholder sets so `{n}` cannot silently drift.

### 5. Static scanning follows the executing body

The old behavior wiring parked the original raw `adm` before macro resolution/classification and sent
only a 64 KiB JavaScript-character prefix after a runtime event. That could scan an encoded wrapper
while decoded code executed, omit malicious code after front padding, cut source by code units rather
than bytes, and produce no static finding at all when the probe had zero visible events.

The completed path selects source at the last safe point before instrumentation:

- classified markup uses the macro-resolved, once-decoded body;
- Native uses escaped synthetic card HTML rather than raw JSON; and
- the existing explicit banner asset-inlining rerender replaces the source with rewritten HTML before
  repointing the frame.

The browser produces canonical padded base64 of a valid UTF-8 prefix of at most 1 MiB and sends
`adm_b64` plus `adm_truncated` over the existing same-origin endpoint. The handler validates canonical
base64, decoded size, and fatal UTF-8, while preserving legacy `{ events, adm }`; the new form takes
precedence when present. `behavior-tab.js` schedules analysis even with zero runtime-visible events
and uses render generation plus creative revision to reject stale responses.

### 6. The regression gate

Four focused layers, and the distinction between them matters:

- **`creative-preview-classify.test.js`** — a table over every body shape in
  [contracts/creative-preview.md](./contracts/creative-preview.md), asserting the classification and
  raw-frame invariant, padded/unpadded parity, and fail-closed missing Core. Pure, fast, no browser.
- **`creative-preview-seal.test.js`** — the gate FR-015 requires. It asserts the _current_ rendering
  outcome for a creative carrying an `https:` image, and its name states that the outcome is
  intentional. It fails if the policy is widened **or** narrowed. This is deliberately a
  characterisation test: its value is not that today's answer is right, but that changing the answer
  becomes a decision someone has to make on purpose.
  `50c6294:tests/macro-evaluator-browser.test.js:251` keeps
  its `trapRequests === 0` assertion unchanged — the two are complementary, and the reason this
  defect shipped is that only the second existed.
- **`analyze-behavior-transport.test.js`** — the additive canonical/legacy API boundary, 1 MiB UTF-8
  limit, truncation metadata, invalid-input rejection, and zero-event static analysis.
- **`creative-preview-browser.test.js`** — a real Chrome pass over awaited/hash-versioned probe load,
  hidden capability authentication, real CSP aliases, parent cap/isolation, inert branches,
  wrapped/unwrapped Native, padded/unpadded base64, decoded static-source parity, and locale output.
- **`traffic-class.test.js` + `asset-fetch.test.js`** — compressed, partially compressed, expanded,
  dotted, and WHATWG-hex mapped literals inherit the embedded IPv4 classification before any
  request function is called; a mapped public control preserves the existing pinned-address path.

### 7. Deliberately deferred within this wave

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
