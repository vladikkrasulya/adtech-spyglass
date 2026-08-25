# Research: Creative Preview Repair

**Created**: 2026-08-25

**Method**: five parallel forensic probes over the render path, git history, the server-side asset
fetch, the `adm` corpus, and the governing constraints; twelve candidate fixes designed across three
angles and each put through an independent adversarial verification pass. Every claim below was
re-checked against the working tree before being written down. Claims that survived only as inference
are marked as such.

## 1. The regression has a date

```
git log --all --oneline -S 'Content-Security-Policy' -- public/ortbtools.app.js
→ adfaccd feat: add inert OpenRTB macro evaluator
```

The unescaped substring matters: in the source the directive lives inside a JavaScript string with
backslash-escaped quotes, so a pickaxe search for `http-equiv="Content-Security-Policy"` matches
nothing and would read as "no such commit exists".

One commit, in the whole history. The state it replaced, at `adfaccd^:public/ortbtools.app.js:881`:

```js
function buildProbedSrcdoc(creativeHtml) {
  if (!_probeSource) return creativeHtml; // graceful: probe not loaded yet
  return '<script>' + _probeSource + '</' + 'script>' + creativeHtml;
}
```

Earlier still, at the initial commit `ddf90e1`, the assignment was a bare `iframe.srcdoc = resolved;`
with no wrapper at all; `2b5c3d8` introduced `buildProbedSrcdoc` to inline the probe. At no point
before 2026-08-12 was any content policy applied to the frame. After `adfaccd`, `buildProbedSrcdoc`
prepends:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' data:;
img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none';
```

The commit's title and message say nothing about a content policy. The only statement of intent is
the code comment at `public/ortbtools.app.js:1186-1187`. The owner's recollection that an earlier
version rendered creatives is accurate, and 2026-08-12 is the boundary.

An unreconciled contradiction sits either side of that date: `be10e0d` (2026-05-12) deliberately kept
`img-src 'self' data: blob: https:` at the server level _specifically so as not to defeat the creative
preview_, and that is still live at `server.js:1341`. `adfaccd` closed the same door at the frame
level. No commit and no document reconciles the two positions.

Note for any later attempt to simply remove the meta: the `srcdoc` document also inherits the page
policy (`server.js:1337-1349`), and against an opaque origin `'self'` matches nothing. Removing the
meta alone would not restore remote scripts.

## 2. What each directive costs

| Directive                                                  | What stops rendering                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `img-src data: blob:`                                      | every CDN-hosted image; the `iurl` fallback at `public/ortbtools.app.js:1053` |
| `script-src 'unsafe-inline'` (no host, no `'unsafe-eval'`) | external script tags; packed creatives using `eval(function(p,a,c,k,e,d)…)`   |
| `frame-src 'none'`                                         | wrapper tags that build a nested frame (SafeFrame, GAM, DSP tags)             |
| `connect-src 'none'`                                       | creatives that fetch a config document and then build their DOM               |
| `media-src 'none'`, `font-src data:`                       | video banners, web fonts                                                      |
| external `<link rel=stylesheet>`                           | content correct, layout absent — a distinct flavour of the same symptom       |

What survives on screen when all of it is refused: alt text, click URLs the creative prints itself,
unresolved macro literals, and text nodes between scripts — unstyled, blurred by 22px, in a white
box. That is the reported "gibberish", and it is the tool working as designed while communicating as
if it had crashed.

## 3. Ranked causes

Ordered by "would this alone produce the symptom".

1. **The frame policy** (§1, §2). Sufficient on its own for every CDN-hosted creative.
2. **`${AUCTION_PRICE}` literal by default.** `public/ortbtools.app.js:3462` passes `price: ''` and
   the evaluator returns the match unchanged when it has no value. Visible as text; and inside
   creative JavaScript (`var p = ${AUCTION_PRICE};`) it is a `SyntaxError` that stops the whole inline
   script, so the creative never builds. The evaluator also only understands `${MACRO}`
   (`public/modules/macros/index.js:673`), so GAM's `%%CLICK_URL_UNESC%%`, `[CACHEBUSTER]` and
   `{AUCTION_PRICE}` pass through as visible text — an independent second source of noise.
3. **Branch 3 has no format detection.** `public/ortbtools.app.js:1408` is an unconditional
   catch-all. Four payload shapes reach it and each produces the same symptom:
   - **envelope-less native** — the gate at `:1381` requires `j.native.assets` to be an array; a
     top-level `{"assets":[…]}` does not throw, so the `console.error` at `:1400` never fires. Silent.
     This is the most likely single explanation for the owner's own traffic.
   - **bare URL as `adm`** — drawn as a line of text; never fetched, never detected.
   - **base64 / gzip `adm`** — a wall of `A-Za-z0-9+/=`, or mojibake. There is no client-side
     decoding anywhere in the preview path: `atob(` appears in `public/` only in
     `ortbtools-crypto.js:34` and `modules/share/index.js:109`.
   - **`document.write` after parse** — the implicit `document.open()` erases the document.
4. **The VAST branch covers itself.** `:1351` renders readable `<pre>` text, then calls
   `setDims(640, 360)`, which sets `data-has-creative='1'` and switches the reveal overlay on. The
   blur selector at `public/modules/inspector/inspector.css:1056` matches only `iframe, img`, so the
   text is not blurred — it is covered by an opaque-ish layer with `backdrop-filter: blur(2px)` and
   `pointer-events: auto`, unreadable at 11px monospace and unscrollable.
5. **The escape hatch sees almost nothing, and damages what it sees.**
   `public/modules/inspector/creative-assets.js:60-61` collects exactly `img[src]` and
   `video[poster]`. Missing: `srcset`, `<picture><source>`, CSS `url()` in `style=` and in `<style>`,
   `background-image`, `<link rel=stylesheet>`, `<object data>`, `<embed src>`, `<svg><image href>`,
   `<input type=image>`, `@font-face`. For a JS-built DOM it returns `[]`, so the button never appears
   and the failure is indistinguishable from an empty creative. `:115` returns `doc.body.innerHTML`,
   so clicking "Load images" on a full-document creative returns the pictures **and** discards the
   entire `<head><style>`. The native branch returns at `:1392` before
   `maybeOfferAssetInlining` is reached at `:1431`, so native hero and icon images are grey
   rectangles permanently, with no button at all. `MAX_ASSETS = 12`, truncated silently. And
   `:1530-1536` reassigns `frame.srcdoc` without clearing `is-revealed`, so consent given over an
   empty box carries over to real artwork — a hole in the screenshot-safety guarantee.
6. **`findAdm` can show the wrong creative.** `:1044-1061` is a recursive first-hit walk in key
   order; a debug or `ext` envelope carrying an `adm` ahead of `seatbid` wins, while dimensions still
   come from `seatbid[0].bid[0]`.

## 4. An eighth finding, not previously recorded anywhere

Prepending the probe and the policy meta displaces the creative's `<!DOCTYPE html>`, so a
full-document creative parses in **quirks mode**. Verified by parsing both forms with the repository's
own `jsdom`:

```
probe + meta + '<!DOCTYPE html><html>…'  → compatMode: BackCompat
'<!DOCTYPE html><html>…'                 → compatMode: CSS1Compat
```

Secondary to the causes above — a fragment `adm` with no doctype is quirks-mode either way — but real
for the full-document creatives that `samples/` is entirely composed of.

## 5. Why the suite did not catch it

`tests/macro-evaluator-browser.test.js:251` asserts `trapRequests === 0` — that the creative does not
reach the network. No test asserts that a creative with an `https:` image renders, or deliberately
does not. A change that silenced the preview therefore shipped green, under a commit title about
something else.

The corpus compounds this: `samples/` is overwhelmingly self-contained CSS-gradient banners (seven),
VAST (sixteen), native JSON (four) and pop scripts (three). Exactly one fixture in the repository is
the `<a><img src=https://…>` shape that the world actually serves. The fixtures render perfectly and
hide the defect.

## 6. The honest ceiling on "nothing lights up"

A zero-signal render of a CDN-hosted creative is impossible. The bytes are on someone else's server;
drawing them means asking that server. What can change is _who_ asks, _from which address_, _carrying
which identifiers_, _how many times_, and _whether the analyst agreed_.

- **True zero** applies only to self-contained creatives — `data:` URIs, CSS gradients, inline SVG.
  Estimated at under 2% of real display traffic; this is domain judgement, not repository evidence.
- **Close to zero** is a server-side fetch, once, cached forever by content address, from an egress
  the operator chose, without a self-identifying user agent. Still not zero: the advertiser gets one
  GET tied to an impression id, from a stable address, at a known moment.
- **JS tags and wrapper stacks** — estimated 75–95% of real display, again domain judgement — cannot
  render at all without executing third-party JavaScript with working network. That is "Live" under
  another name, and there is no compromise position available.

## 7. Options killed under adversarial verification

Recorded so they are not re-proposed.

- **Rendering payload cards into the parent DOM** — `#creativePreview` is the parent page under
  `script-src 'self' 'unsafe-inline'`, not the sandbox. Any escaping error moves content from an
  opaque-origin sandbox into the analyst's session, and a clickable `<a href>` turns inert text into a
  one-click beacon.
- **Session-sticky reveal** — the code already rejects this design in its own words at
  `public/ortbtools.app.js:1276-1281`: "one accidental reveal would leak into every subsequent analyze
  until reload". Module scope _is_ "until reload".
- **Automatic token-pinned image proxy (render without a click)** — lazy loading hands the creative's
  inline script a controlled channel: _which_ tokens it requests, and _in what order_, are bits
  travelling through our own proxy to a pinned advertiser URL carrying an impression id. That is
  precisely what `lib/asset-fetch.js:6-20` exists to prevent, moved one hop. The accompanying claim
  "fewer requests than today" is false: today's baseline is approximately zero per analysis, because
  the button requires a click and for most payload shapes never appears.
- **Two frames (measure / view)** — for the JS-tag majority a `sandbox=""` viewer draws _less_ than
  today, since not even the inline bootstrap runs. It also carries a concrete defect: `:1531` does
  `host.querySelector('iframe')`, so with two frames the inlining path would push the probed `srcdoc`
  into the script-less frame and silence the behaviour tab permanently.
- **Headless Chromium on an egress-less network** — with the policy meta preserved,
  `Fetch.requestPaused` never fires, because the policy blocks in the renderer before the Fetch domain
  sees the request; the option therefore captures nothing. Drop the meta and the "the chamber is
  reproduced byte-for-byte" argument disappears with it. Nested frames are not intercepted at all.
- **Consented capture through an operator-chosen egress** — SOCKS5h resolves the _name_, while the
  entire SSRF guarantee (`lib/asset-fetch.js:143-148`) is built on "resolve locally, connect to the
  IP". It is one or the other, not both. The two-pass design is also non-deterministic for exactly the
  JS-built creatives it exists to serve, since a cache-busted URL from pass one is not the URL of pass
  two.
- **Runtime mirror shim** (trapping `HTMLImageElement.src`, `fetch`, `innerHTML`) — requires widening
  the allowed response types to text, which removes the only barrier standing over the live
  mapped-IPv6 defect in §8, handing third-party JavaScript a read-SSRF plus an exfiltration channel.
  And without `'unsafe-eval'` the mirrored bundles still die on `new Function("return this")()`.

## 8. Live defect found in passing — handled separately

The SSRF guard on `/api/creative/asset` admits IPv4-mapped IPv6 literals. Reproduced by executing the
repository's own code on the currently deployed commit:

```
http://169.254.169.254/x           → blocked (host_blocked)
http://[::ffff:169.254.169.254]/x  → ALLOWED {"address":"::ffff:a9fe:a9fe","family":6}
http://[::ffff:127.0.0.1]/x        → ALLOWED {"address":"::ffff:7f00:1","family":6}
```

`new URL()` re-serialises a mapped address into hex form; `lib/traffic-class.js:103` strips the
`::ffff:` prefix only while dots remain; and `isPrivateIp`'s IPv6 branch (`:164-174`) knows only `::`,
`::1`, `fc00::/7` and `fe80::/10`. Mitigating factors: the route is session-gated and rate-limited at
40/min (`modules/creative-asset/handler.js:48-52`), and returns only nine raster image types — so this
is an authenticated blind SSRF plus an internal scanning oracle on ports 80/443, not an open proxy.
Any widening of the accepted types removes that mitigation, which is why it must be closed before
wave 2 is considered.

Fixed as its own hardening change, deliberately not folded into this package.

## 9. Decisions taken into the plan

Recorded in the Phase 0 format so the reasoning survives the package.

### D1 — Repair legibility before repairing reach

**Decision**: wave 1 changes no network behaviour; the question of what the preview may fetch is
deferred until the refusal ledger exists.

**Rationale**: "gibberish" and "never shows the creative" are two faults merged by the blur. The first
is repairable at zero privacy cost and is what the owner sees daily. The second is a privacy decision,
and taking it blind — without being able to see which resource kinds and hosts are actually being
refused on the owner's own traffic — would be choosing without the instrument. Wave 1 builds the
instrument and spends nothing.

**Alternatives considered**: shipping both waves at once (rejected: couples a certain repair to a
reversible-but-consequential decision, and makes the rollback unit larger than the risky part);
widening the frame policy first (rejected: §7 — every design that widens it either hands the creative
a covert channel or dismantles the argument for the chamber).

### D2 — VAST recognition delegates to core

**Decision**: the preview stops carrying its own VAST regex and calls `packages/core/vast-shape.js`.

**Rationale**: `public/ortbtools.app.js:1351` is anchored so tightly that a byte-order mark, a leading
XML comment or a processing instruction defeats it, and the code comment there already concedes that
it must stay "in lockstep" with the core detector. Two detectors that must agree by hand will
eventually disagree; the correct number of VAST detectors in one product is one.

**Alternatives considered**: fixing the regex in place (rejected: preserves the duplication that is the
actual defect); a third detector shared by both (rejected: Principle V — no parallel abstraction where
an owning module already exists).

### D3 — Refusals travel on their own message type

**Decision**: `ortbtools-preview-refusal`, counted separately, never entering `pushBehaviorEvent`.

**Rationale**: the parent receiver forwards every non-heartbeat probe message into a 500-entry buffer
that drops the oldest. A creative emitting 600 refusals would evict genuine navigation and frame-bust
evidence before the behaviour POST is made. Reusing the existing channel would hand hostile markup a
one-line way to erase the findings it is being measured for.

**Alternatives considered**: a `kind` discriminator inside `ortbtools-probe` (rejected: the eviction
happens in the shared buffer, not in the discriminator, so it would not close the hole); counting
refusals in the parent instead (rejected: violations are raised inside the frame's document and are not
observable from the parent).

### D4 — Inert text is written as text, not as escaped markup

**Decision**: `textContent` for every classified non-markup body, including the VAST branch, which
moves off `innerHTML` + `escapeHtml`.

**Rationale**: `specs/000-platform-baseline/contracts/frontend-modules.md:122` forbids promoting
preview markup into the parent origin. An escaping function is a correctness dependency standing
between hostile input and the analyst's own session; writing text performs no parse at all, so there
is nothing to get wrong.

**Alternatives considered**: keeping `escapeHtml` (rejected: works today, but is a dependency with no
upside once the alternative is one property assignment); rendering into a second sandboxed frame
(rejected as over-engineering for text, and §7 records the concrete defect the two-frame design
carries).

### D5 — The seal test is a characterisation test, on purpose

**Decision**: assert the _current_ rendering outcome for a creative carrying an `https:` image, with
the intent stated in the test name, so the test fails if the policy is widened **or** narrowed.

**Rationale**: the value is not that today's answer is correct. It is that changing the answer stops
being something that can happen as a side effect of a commit about something else — which is exactly
how this defect reached production on 2026-08-12.

**Alternatives considered**: asserting only the desired end state (rejected: there is no agreed end
state until wave 2 is decided, and a test asserting an undecided future fails for the wrong reason).
