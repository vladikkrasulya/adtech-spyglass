# Feature Specification: Creative Preview Repair — Wave 1

**Feature Branch**: `main` (direct production-remediation workflow)

**Created**: 2026-08-25

**Status**: Complete

**Input**: Owner report, production `v1.14.6`: "поле постійно бєлібєрду показує, ніколи не показує
креатив, а якійсь з перших версій креатив малювався" — the preview box constantly shows gibberish and
never shows the creative, while some early version did render it. Investigated with a five-probe
forensic pass plus adversarial verification of twelve candidate fixes; the surviving diagnosis and
option set are recorded in [research.md](./research.md).

> **Scope**: this package repairs what the preview **says** when it cannot show a creative, and stops
> it from painting raw non-markup payloads as if they were markup. The sealed iframe policy and
> sandbox stay byte-for-byte unchanged, and the wave adds no automatic, Native-specific, advertiser,
> or other third-party fetch. The existing same-origin behavior-analysis endpoint now receives the
> exact bounded body selected to execute and may run static rules with zero runtime-visible events;
> that is analysis transport, not creative network access. Whether to widen what the preview itself
> may fetch remains a separate decision after this wave.

> **Deliberately not here**: widening the asset collector beyond `img[src]`/`video[poster]`, adding a
> content-addressed asset cache, changing the `/api/creative/asset` route, limits, response types, or
> explicit-click semantics, and changing the iframe CSP. Those form wave 2 and carry a privacy
> decision this wave does not prejudge. The IPv4-mapped IPv6 host-guard bypass found during the same
> investigation is included as a separately tested narrowing change: mapped literals inherit their
> embedded IPv4 classification before a socket opens, without adding a request path or widening the
> asset-fetch contract.

## Background: what actually broke, and when

Verified against the repository, not inferred:

- `adfaccd` (2026-08-12), titled only _"feat: add inert OpenRTB macro evaluator"_, began injecting a
  `<meta http-equiv="Content-Security-Policy">` into every creative `srcdoc`
  (`50c6294:public/ortbtools.app.js:1189`). Before it, `buildProbedSrcdoc` returned the probe followed by the
  creative and nothing else (`adfaccd^:public/ortbtools.app.js:881`); no content policy had ever been
  applied to the frame. It is the only commit in the repository's history that adds one. The owner's
  memory of an earlier version that rendered is correct, and the boundary is that date.
- The policy's `img-src data: blob:` — with no `https:` — blanks every creative whose art is on a
  CDN, and the `iurl` fallback at `50c6294:public/ortbtools.app.js:1053`. What remains visible is alt text,
  click URLs the creative prints itself, unresolved macro literals, and text nodes between scripts:
  the reported "gibberish".
- The same commit made `${AUCTION_PRICE}` resolve to itself by default
  (`50c6294:public/ortbtools.app.js:3462`, `price: ''`), so the literal is both visible and — when it sits
  inside creative JavaScript — a `SyntaxError` that stops the creative building at all.
- Branch 3 of `setAdPreview` (`50c6294:public/ortbtools.app.js:1408`) is an unconditional catch-all: anything
  that is not VAST-shaped and does not match the exact native envelope test at `:1381` is handed to
  the browser as HTML. Envelope-less native, a bare URL, and base64 all take this path, and the
  envelope-less case throws no exception, so the `console.error` at `:1400` never fires — the failure
  is entirely silent.
- The VAST branch (`:1351`) renders readable text and then calls `setDims(640, 360)`, which sets
  `data-has-creative='1'` and switches the reveal overlay on. The blur selector
  (`50c6294:public/modules/inspector/inspector.css:1056`) matches only `iframe, img`, so that text is not
  blurred — it is covered by a `backdrop-filter` layer with `pointer-events: auto`, unreadable at
  11px and unscrollable.
- Prepending the probe and the policy meta to the creative displaces its `<!DOCTYPE html>`, so a
  full-document creative parses in quirks mode. Confirmed by parsing both forms: `BackCompat` with
  the prefix, `CSS1Compat` without it.

At discovery time no regression test guarded any of this. `50c6294:tests/macro-evaluator-browser.test.js:251` asserted
`trapRequests === 0` — that the creative does **not** reach the network — which is why a change that
silenced the preview shipped green. The completed implementation now adds classifier, transport, and
real-browser gates without weakening that existing assertion.

## User Scenarios & Testing

### User Story 1 - A blocked creative explains itself (Priority: P1)

As someone inspecting a payload whose creative cannot render inside the sealed frame, I see a
statement of what was refused and to which hosts, instead of a blurred wall of stray text that reads
like a broken tool.

**Why this priority**: this is the reported complaint. The tool is behaving as designed and
communicating as if it had crashed, and the owner has been reading a designed refusal as a defect for
roughly two weeks.

**Independent Test**: paste a bid response whose `adm` is a banner referencing CDN images, and read
the preview column without opening developer tools.

**Acceptance Scenarios**:

1. **Given** a creative whose sub-resources are all refused by the frame's policy, **When** it
   renders, **Then** the preview states how many resources were refused and across how many distinct
   hosts, and both the hosts and the refused kinds — image, script, frame, style, font, connection —
   can be listed.
2. **Given** a creative that renders completely from its own markup, **When** it renders, **Then** no
   refusal statement appears — the count is zero and nothing is claimed.
3. **Given** a refusal statement is shown, **When** the analyst reads it, **Then** it distinguishes
   "this frame refused to fetch it" from "the creative is empty", in the analyst's own locale.
4. **Given** a creative that emits hundreds of refusals, **When** they are counted, **Then** the
   behaviour findings recorded for that same render are unaffected in number and content.

---

### User Story 2 - Native creatives render instead of printing themselves (Priority: P1)

As someone inspecting a native bid whose payload does not carry the `{"native": …}` wrapper, I see
the rendered native card, not its JSON printed as text.

**Why this priority**: it is the most likely single explanation for "never shows the creative" on the
owner's own traffic, it fails silently with nothing in the console, and the fix is a widening of one
condition.

**Independent Test**: paste a response whose `adm` is `{"assets":[…],"link":{…}}` at top level and
one whose `adm` is `{"native":{"assets":[…]}}`, and compare.

**Acceptance Scenarios**:

1. **Given** an `adm` carrying native assets without the envelope, **When** the preview renders,
   **Then** the native card is drawn, identically to the wrapped form.
2. **Given** an `adm` that is JSON but is not native at all, **When** the preview renders, **Then** it
   is presented as a payload that could not be identified as a creative — never as markup.
3. **Given** either native form, **When** it renders, **Then** the behaviour probe is mounted, so a
   click on the card is measured exactly as it is for a banner today.
4. **Given** a Native card with remote artwork, **When** it renders in this wave, **Then** no
   Native-specific asset-inlining/network action is offered; the sealed frame refuses the artwork
   and the ledger explains the refusal.

---

### User Story 3 - A payload that is not markup is never painted as markup (Priority: P1)

As someone pasting whatever an exchange actually sent, a creative body that is a URL, base64, or
unidentified text is labelled as what it is, rather than handed to the browser and rendered as a
line of garbage.

**Why this priority**: it is the mechanism that converts four distinct payload shapes into the same
reported symptom, and it removes a class of confusion rather than one instance.

**Independent Test**: paste, in turn, an `adm` that is a bare `https://` URL, one that is base64, and
one that is arbitrary prose; observe each.

**Acceptance Scenarios**:

1. **Given** an `adm` that is a bare URL, **When** the preview renders, **Then** it is identified as a
   URL and is not fetched, not linked, and not executed.
2. **Given** an `adm` that is padded base64 or valid base64 with omitted optional padding and decodes
   to markup, **When** the preview renders, **Then** the same decoded creative renders and the preview
   states that it was decoded first.
3. **Given** an `adm` that is base64 which decodes to nothing recognisable, **When** the preview
   renders, **Then** it is reported as unidentified, not painted.
4. **Given** any payload classified as not-markup, **When** it is displayed, **Then** it appears as
   inert text that cannot become a request, a navigation, or executable content.
5. **Given** the classifier or the shared Core VAST detector failed to load, **When** a payload is
   previewed, **Then** classification fails closed and the payload is inert rather than routed through
   the old catch-all frame.

---

### User Story 4 - VAST is readable (Priority: P2)

As someone inspecting a video bid, the VAST document shown in the preview column can be read and
scrolled without first dismissing a control that promises a creative it will never reveal.

**Why this priority**: it is a small, certain repair to a surface that is currently unusable, and it
is the second-strongest contributor to the impression that the panel is broken.

**Independent Test**: paste a VAST response and attempt to read past the first screen of XML.

**Acceptance Scenarios**:

1. **Given** a VAST `adm`, **When** the preview renders, **Then** no reveal overlay covers the text.
2. **Given** a VAST document longer than the visible area, **When** it renders, **Then** it scrolls,
   and any truncation is stated with the amount hidden.
3. **Given** a VAST document preceded by a byte-order mark, an XML comment, or a processing
   instruction, **When** it renders, **Then** it is still recognised as VAST.

---

### User Story 5 - The seal cannot silently close again (Priority: P2)

As the maintainer, a change that alters what the preview can display fails the test suite instead of
shipping under an unrelated commit title.

**Why this priority**: the defect being repaired reached production because the suite only asserted
the opposite property. Without this, the same class of regression recurs.

**Independent Test**: locally widen or narrow the frame policy and run the suite.

**Acceptance Scenarios**:

1. **Given** the frame policy as it stands, **When** the suite runs, **Then** a test asserts the
   current rendering outcome for a creative carrying an `https:` image, and states in its name that
   this outcome is intentional.
2. **Given** a change to that policy in either direction, **When** the suite runs, **Then** that test
   fails.
3. **Given** the existing assertion that the creative reaches no advertiser/third-party network before
   an analyst explicitly invokes the pre-existing banner asset action, **When** the suite runs,
   **Then** it still holds unchanged.

### Edge Cases

- A creative that emits more refusals than the behaviour buffer holds MUST NOT displace recorded
  behaviour events; refusal counting and behaviour recording are separate channels.
- A creative runs inside the correctly source-pinned iframe and can call `parent.postMessage` itself;
  source identity alone is therefore insufficient. Reserved probe messages MUST also carry a hidden,
  fresh per-render capability and pass the parent-owned schema and 200-entry bounds.
- The frame is governed by two overlapping policies — the injected meta and the page policy the
  `srcdoc` document inherits — so one refused resource can be reported twice; counts MUST be
  deduplicated by directive and blocked resource.
- A creative that calls `document.open()` detaches document-level listeners; refusal counting MUST
  survive it.
- Refused resource identifiers originate in hostile payload and MUST be escaped wherever displayed.
- A creative body may be simultaneously valid JSON and intended as markup; classification order MUST
  be deterministic and documented.
- Base64 decoding MUST be bounded, so a payload cannot turn classification into a denial of service.
- Classification MUST NOT alter the selected body except for one base64 decode. Static analysis MUST
  receive the macro-resolved/classified body selected to execute, or escaped synthetic Native HTML,
  within a deterministic 1 MiB UTF-8 source window; it MUST NOT scan the encoded wrapper or raw Native
  JSON while different bytes execute.
- The first creative MUST NOT race the probe fetch, and a cached old probe MUST NOT be paired with a
  new parent receiver; Inspector activation awaits a content-hash-versioned probe asset.
- Static-only patterns MUST be reported even when the probe emits no runtime-visible event.
- A banner rerender after explicit asset inlining MUST update both its frame and static-analysis
  source before the new probe generation runs.

## Requirements

### Functional Requirements

- **FR-001**: The preview MUST classify a creative body before display. Raw payload bytes MAY reach
  the frame only when classified as markup; Native MAY reach it only after conversion to escaped
  synthetic HTML, never as raw Native JSON.
- **FR-002**: Classification MUST recognise, at minimum: VAST, native (wrapped and unwrapped), markup,
  bare URL, base64, and unidentified.
- **FR-003**: VAST recognition MUST use the project's existing Core shape detector rather than a new
  independent pattern. If Core or the classifier is absent, preview classification MUST fail closed
  to inert unidentified text.
- **FR-004**: A body classified as native MUST render as a native card whether or not it carries the
  `{"native": …}` wrapper, and MUST mount the behaviour probe in both cases.
- **FR-005**: Padded and valid unpadded base64 MUST decode to the same body and be re-classified once;
  invalid final quanta MUST be rejected and the preview MUST state when decoding occurred.
- **FR-006**: A body classified as URL, or as unidentified, MUST be displayed as inert text that
  cannot become a request, a navigation, or executable content.
- **FR-007**: The preview MUST report, per render, the number of sub-resources the frame refused and
  the number of distinct hosts involved, and MUST allow both the hosts and the refused resource kinds
  to be listed. The kind — image, script, frame, style, font, connection — is what turns the count
  into a decision input; a number alone cannot tell the analyst whether the creative needs pictures or
  needs to execute.
- **FR-008**: Refusal reporting MUST be deduplicated per render by refused directive and refused
  resource. Both probe and parent MUST enforce a 200-entry render cap; the parent MUST validate the
  message schema, accept at most 200 items per batch, and bound directive/URI strings.
- **FR-009**: Refusal reporting MUST NOT consume, displace, or reorder recorded behaviour events, and
  MUST NOT change the count or content of behaviour findings for the same render.
- **FR-010**: The reveal overlay MUST NOT be offered over a preview that contains no revealable
  creative, including the VAST text branch.
- **FR-011**: Text-mode previews MUST be scrollable, and MUST state the amount hidden when truncated.
- **FR-012**: The frame's content policy, its sandbox attribute, and the route, limits, response
  types, and explicit-click semantics of `/api/creative/asset` MUST be unchanged. Host acceptance may
  only be narrowed as required by FR-025. The newly reachable Native branch MUST NOT expose the
  existing asset-inlining action; an explicitly asset-inlined banner rerender MUST update the static
  source to the rewritten HTML.
- **FR-013**: The feature MUST introduce no automatic, Native-specific, advertiser, or other
  third-party request from either browser or server. The existing same-origin behavior-analysis
  request is permitted only for transient analysis of the bounded executing source.
- **FR-014**: Every user-facing string introduced MUST ship in all three supported locales in the same
  change.
- **FR-015**: The suite MUST contain an explicit, named assertion of the current rendering outcome for
  a creative carrying an `https:` image, which fails if the frame policy changes in either direction.
- **FR-016**: Unresolved macro literals MUST be explained to the analyst without rewriting the bytes
  handed to the frame.
- **FR-017**: Any refused-resource identifier or classified payload rendered into the interface MUST
  reach the page as inert text that is never parsed as markup — not by way of an escaping helper, but
  by never being parsed at all. An escaping function is a correctness dependency standing between
  hostile input and the analyst's session; assigning text performs no parse, so there is nothing to
  get wrong.
- **FR-018**: Both reserved frame message types MUST require the current iframe `event.source` and a
  fresh cryptographically random per-render capability hidden in the trusted probe closure. Creative
  code in the same source-pinned frame MUST NOT be able to forge an accepted reserved message.
- **FR-019**: Inspector activation MUST await the probe fetch before exposing Analyze, and the runtime
  probe URL MUST carry its content hash so browser/CDN cache cannot pair incompatible probe and parent
  versions. Probe failure MUST fail telemetry closed.
- **FR-020**: Static behavior analysis MUST use the body selected to execute before probe/CSP
  instrumentation: macro-resolved/classified/once-decoded markup or escaped synthetic Native HTML.
  The transport MUST be canonical base64 of a deterministic, valid UTF-8 prefix no larger than
  1 MiB, with explicit truncation metadata.
- **FR-021**: Static analysis MUST run when the runtime-visible event list is empty, and stale
  same-count or previous-creative responses MUST NOT repaint a newer Behavior tab.
- **FR-022**: `/api/analyze-behavior` MUST preserve legacy `{ events, adm }` callers while accepting
  `{ events, adm_b64, adm_truncated }`; canonical `adm_b64` takes precedence and invalid base64,
  invalid UTF-8, oversized decoded source, or non-boolean truncation metadata MUST be rejected.
- **FR-023**: Chromium directive aliases MUST normalize to stable localized resource groups, and VAST
  truncation text MUST be localized with placeholder parity in all three supported locales.
- **FR-024**: A non-skipped real-browser gate MUST exercise hashed/awaited probe loading, capability
  authentication, the parent cap and behavior isolation, actual CSP refusals, inert fallbacks,
  Native parity, padded/unpadded base64, exact static source bytes, and localized VAST trimming.
- **FR-025**: Before `/api/creative/asset` opens a socket, every syntactically valid IPv4-mapped IPv6
  literal — compressed, partially compressed, fully expanded, dotted, or WHATWG-canonical hex — MUST
  inherit the existing classification of its embedded IPv4 address. Private mapped targets MUST be
  refused and a public mapped control MUST retain the existing permitted behavior.

### Key Entities

- **Creative body classification**: the determination of what a creative payload _is_ — one of VAST,
  native, markup, URL, base64, or unidentified — made before any display decision, carrying the
  reason for the determination.
- **Refusal ledger**: the per-render tally of sub-resources the frame refused, keyed by refused
  directive and resource, reduced to a count and a distinct-host count for display. Lives for exactly
  one render and is discarded when the next creative mounts.
- **Probe capability**: a fresh per-render secret closed over by the trusted probe and required beside
  current-frame source identity for either reserved message type.
- **Executing creative source**: the bounded UTF-8 body selected for static behavior analysis —
  classified markup or escaped synthetic Native HTML — versioned with the current preview.

## Success Criteria

### Measurable Outcomes

- **SC-001**: For every creative-body shape the repository can produce, the preview either draws the
  creative or states in one sentence why it cannot — no shape produces unexplained text.
- **SC-002**: An analyst who has not read this specification can tell, from the preview alone, whether
  the creative is empty or whether the tool refused to fetch it.
- **SC-003**: Native bids render as the same escaped synthetic card regardless of wrapper, with
  identical behavior measurement and no Native asset-inlining offer.
- **SC-004**: A VAST response can be read end to end and scrolled without dismissing any control.
- **SC-005**: The number and content of behaviour findings for a given payload are identical before
  and after this feature.
- **SC-006**: Zero automatic advertiser/third-party creative requests are made by this feature,
  verified by the existing network assertion continuing to hold.
- **SC-007**: A change to what the preview may fetch, in either direction, fails the suite.
- **SC-008**: After this wave the owner can state, from the interface, which resource kinds and hosts
  are being refused on their own traffic — the input the wave 2 decision needs.
- **SC-009**: A creative in the current source-pinned frame cannot forge accepted probe/refusal
  messages; a valid probe still reports, and no ledger can retain more than 200 entries.
- **SC-010**: For every executing body at or under 1 MiB, decoding the browser's behavior-analysis
  `adm_b64` yields exactly the macro-resolved/classified/synthetic bytes mounted before instrumentation;
  larger bodies declare deterministic UTF-8-safe truncation.
- **SC-011**: Static findings are produced with zero runtime-visible events, legacy `{ events, adm }`
  remains accepted, and a real Chrome run covers the complete preview boundary.
- **SC-012**: Focused host-boundary tests observe zero outbound request attempts for mapped loopback,
  link-local, private, and other non-public IPv4 targets, while a mapped public control reaches the
  unchanged pinned-address request path.

## Assumptions

- The owner's traffic contains creative shapes not represented in `samples/`, whose fixtures are
  overwhelmingly self-contained CSS-gradient banners and therefore render correctly today. This is why
  the defect is invisible to the current suite and visible in daily use.
- The sealed frame's purpose — that it is the chamber the behaviour probe measures from, not a viewer
  — remains correct and is not being revisited in this wave.
- `sandbox="allow-scripts"` without `allow-same-origin` is the stable creative-preview constraint in
  the [Constitution](../../.specify/memory/constitution.md) §Architectural and Operational
  Constraints and is out of scope for any wave.
- The owner has accepted, for wave 2, that a server-side fetch on an explicit click is a tolerable
  disclosure. That acceptance does not apply to wave 1, which spends none of it.
- The macro evaluator and behavior endpoint remain the owning subsystems. This wave extends their
  wiring with a content-hash-versioned authenticated probe channel and a bounded exact-source
  transport rather than adding a parallel scanner or transport facade.
- The quirks-mode side effect of the injected prefix is real but secondary; it is recorded here and
  scheduled in this wave only if it can be corrected without altering the bytes the behaviour engine
  measures.
