/* ============================================================================
 * source-nav.js — exact finding→source navigation AND the payload editor's
 * syntax/diagnostic backdrop.
 *
 * Consumes the additive `finding.location` contract from /api/analyze and the
 * canonical packages/core/source-map.js (shipped verbatim to /core/source-map.js,
 * CI sha256 parity-guarded) to highlight the EXACT key/value/node in the user's
 * pasted JSON — in whichever pane (request/response) the finding belongs to.
 *
 * WHY THE SYNTAX HIGHLIGHTER LIVES HERE AND NOT IN ITS OWN LAYER
 * ---------------------------------------------------------------------------
 * A <textarea> cannot colour its own text, so both jobs — painting JSON
 * tokens and painting finding marks — are done the same way: a backdrop
 * element behind a transparent textarea, carrying the textarea's exact
 * typography and scrolled in lockstep with it.
 *
 * The tempting shape is two backdrops, one per job. That shape is wrong, and
 * measurably so: two absolutely positioned mirrors of the same text drift
 * against each other the moment anything about the geometry changes (a font
 * loading late, a resize, a scrollbar appearing), and the drift shows up as
 * colour sitting a pixel off its glyphs. It also doubles the scroll
 * synchronisation surface and forces the two to agree about compositing —
 * whether a finding's tint sits over or under a token's colour.
 *
 * So there is exactly ONE backdrop per pane and ONE render pass over it.
 * Syntax tokens and finding ranges are both just ranges over the same string;
 * renderBackdrop() walks them together and emits <mark> for findings with the
 * syntax <span>s nested inside. Alignment cannot drift because there is
 * nothing to drift against, and the compositing question answers itself:
 * one mark per finding, tokens inside it, colour on top of tint.
 *
 * WHY THERE IS NO prev/next TOOLBAR ANY MORE
 * ---------------------------------------------------------------------------
 * There used to be a stepper under the editor — "‹ prev", "next ›" and a
 * status reading "cur response:2:10". It made the reader walk a list one
 * click at a time to discover something the editor could simply have shown
 * them, and the status line was a coordinate pair with no context. Both are
 * gone. In their place every locatable finding is marked IN the text at all
 * times (a severity-coloured wavy underline) and mirrored as a tick on a rail
 * down the right edge of the editor, so the shape of the whole payload's
 * problems is visible without scrolling and any one of them is one click
 * away. The stepper's keyboard affordance is NOT lost: Alt+↓ / Alt+↑ still
 * cycle findings, and the rail is a proper ARIA toolbar with roving tabindex.
 *
 * Hard guarantees (unchanged):
 *   • Side comes ONLY from location.primary.side (server, from validate() call
 *     context). No id/path regex side-guessing anywhere here.
 *   • XSS-safe: payload text enters the backdrop ONLY as text — createTextNode
 *     for bare runs, .textContent for token spans, never innerHTML and never
 *     insertAdjacentHTML. The only elements built around it are <mark> and
 *     <span>, both with class names this module chooses.
 *   • Idempotent lifecycle: every listener is bound to a per-instance
 *     AbortController; init() fully removes the previous instance; teardown()
 *     removes listeners, backdrops, rails, popover and live region.
 *   • Honest fallback: a pointer that doesn't resolve against the CURRENT text
 *     (edited / stale / invalid / >2MB / unknown provenance) → NO jump, and no
 *     invented marker.
 *   • Privacy: nothing here is logged or transmitted; pure local DOM.
 *
 * No bundler: plain IIFE attaching window.OrtbtoolsSourceNav.
 * ========================================================================== */
(function () {
  'use strict';

  const EAGER_MAX = 1024 * 1024; // ≤1MB → build the index eagerly at analyze time
  const HARD_MAX = 2 * 1024 * 1024; // >2MB → disabled (matches server body cap)

  /* Re-highlighting on every keystroke would rebuild the whole backdrop for
     one character. 90ms is below the threshold where the colour feels like it
     lags the typing, and above the interval at which a fast typist would
     trigger a rebuild per key. */
  const RENDER_DEBOUNCE_MS = 90;

  let SM = null; // window.OrtbtoolsSourceMap (resolved lazily)
  function sm() {
    if (!SM) SM = (typeof window !== 'undefined' && window.OrtbtoolsSourceMap) || null;
    return SM;
  }
  function syn() {
    return (typeof window !== 'undefined' && window.OrtbtoolsJsonSyntax) || null;
  }
  // localized string (UK/EN/RU via the central i18n table); safe fallback if t() absent
  function tr(key, fallback, params) {
    if (typeof window !== 'undefined' && typeof window.t === 'function') {
      const s = window.t(key, params);
      if (s && s !== '[' + key + ']') return s;
    }
    if (!params) return fallback;
    return String(fallback).replace(/\{(\w+)\}/g, function (_, k) {
      return params[k] != null ? String(params[k]) : '{' + k + '}';
    });
  }
  function sideLabel(side) {
    return tr('inspector.nav.side.' + side, side);
  }

  // ── per-instance state ──────────────────────────────────────────────────────
  let controller = null; // AbortController — owns ALL listeners for this instance
  let panes = null; // { request:{el,card,overlay,rail,…}, response:{…} }
  let live = null; // aria-live region (created/owned by this instance)
  let popover = null; // the single caret/tick popover, shared by both panes
  let popoverItem = null; // which finding the popover is currently describing
  let analyzed = null; // { texts:{request,response}, maps:{}, list:[], cursor }
  let highlightActive = false;
  let resizeObs = null; // CP3.2 ResizeObserver — re-aligns the backdrop on geometry change
  let geometryRefreshCount = 0; // test-observable: number of backdrop geometry refreshes

  /* Severity vocabulary. The engine speaks two dialects — validation findings
     use LEVELS (error/warning/info/question) and crosscheck uses CROSS_LEVELS
     (crit/warn/ok) — and the editor must not show two vocabularies for one
     idea. Normalise once, here, so a wavy underline and a gutter number and a
     rail tick cannot disagree about how bad something is. `ok` maps to null:
     a passing crosscheck is not a place in the payload worth marking. */
  const SEVERITY = {
    error: 'error',
    danger: 'error',
    crit: 'error',
    warning: 'warning',
    warn: 'warning',
    question: 'question',
    info: 'info',
  };
  const SEV_RANK = { error: 3, warning: 2, question: 1, info: 0 };
  function normSeverity(level) {
    return SEVERITY[String(level || '').toLowerCase()] || null;
  }

  function djb2(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h + ':' + s.length;
  }
  function paneText(side) {
    return panes && panes[side] && panes[side].el ? panes[side].el.value : '';
  }

  // ── source-map cache (one build per analyzed revision, per pane) ───────────
  function buildMap(side) {
    const text = paneText(side);
    if (text.length > HARD_MAX) return { status: 'too-large' };
    const lib = sm();
    if (!lib) return { status: 'no-lib' };
    const m = lib.buildSourceMap(text);
    if (!m.ok) return { status: 'invalid', error: m.error };
    return { status: 'ok', map: m };
  }
  function ensureMap(side) {
    if (!analyzed) return { status: 'no-analysis' };
    if (djb2(paneText(side)) !== analyzed.texts[side]) return { status: 'stale' };
    if (!analyzed.maps[side]) analyzed.maps[side] = buildMap(side);
    return analyzed.maps[side];
  }

  // ── resolution (pure given pane text + maps) ───────────────────────────────
  function rangeFromEntry(entry, target) {
    if (!entry) return null;
    if (target === 'key' && entry.keyStart != null)
      return { start: entry.keyStart, end: entry.keyEnd };
    return { start: entry.valueStart, end: entry.valueEnd }; // value | node
  }
  // Resolve one primary/related part against the CURRENT pane text.
  function resolvePart(part, dialect) {
    if (!part || !panes || !panes[part.side]) return { ok: false, reason: 'no-pane' };
    const side = part.side;
    if (!analyzed || djb2(paneText(side)) !== analyzed.texts[side])
      return { ok: false, reason: 'stale' };
    if (dialect === 'url') {
      // URL provenance is server-gated; here we locate the raw param exactly.
      const lib = sm();
      const loc = lib && lib.locateUrlParam(paneText(side), part.pointer);
      if (!loc) return { ok: false, reason: 'unresolved' };
      const prefix = paneText(side).slice(0, loc.valStart);
      return {
        ok: true,
        side: side,
        range: { start: loc.valStart, end: loc.valEnd },
        line: prefix.split('\n').length,
        col: loc.valStart - prefix.lastIndexOf('\n'),
        precision: part.precision,
      };
    }
    const em = ensureMap(side);
    if (em.status !== 'ok') return { ok: false, reason: em.status };
    const entry = em.map.resolve(part.pointer);
    if (!entry) return { ok: false, reason: 'unresolved' };
    const range = rangeFromEntry(entry, part.target);
    const pos = em.map.positionAt(range.start);
    return {
      ok: true,
      side: side,
      range: range,
      line: pos.line,
      col: pos.col,
      precision: part.precision,
    };
  }

  // ── syntax tokens (cached per pane revision) ───────────────────────────────
  /**
   * Tokens for the pane's CURRENT text, or null when the payload is past the
   * highlighter's ceiling.
   *
   * Cached on the exact string it was built from rather than a hash: a hash
   * costs a full pass over the text on every render, and `===` on two
   * references to the same string is a pointer compare in practice. The cache
   * therefore invalidates exactly when the text changes and never otherwise.
   */
  function syntaxTokens(side, text) {
    const p = panes[side];
    if (p.synText === text) return p.synToks;
    const lib = syn();
    p.synText = text;
    p.synToks = lib ? lib.tokenize(text) : null;
    return p.synToks;
  }

  // ── the ONE backdrop render ────────────────────────────────────────────────
  /**
   * Merge the two range layers into a single ascending, non-overlapping list.
   *
   * Layer 1 is the ACTIVE jump (what the reader just clicked), layer 2 is the
   * persistent marker for every locatable finding. They are merged rather
   * than stacked because a single backdrop can only paint one mark at a given
   * offset, and because the honest answer when two findings claim overlapping
   * text is to show one of them, not to invent a blended third thing.
   *
   * Ties go to the active layer: while the reader is looking at one finding,
   * that finding's own treatment wins over its resting-state underline.
   */
  function combinedSegments(p) {
    const entries = [];
    for (let i = 0; i < p.active.length; i++) {
      const a = p.active[i];
      if (!a.range || a.range.end <= a.range.start) continue;
      entries.push({
        start: a.range.start,
        end: a.range.end,
        cls: 'src-hl src-hl--' + a.kind,
        pri: 0,
      });
    }
    for (let i = 0; i < p.marks.length; i++) {
      const m = p.marks[i];
      entries.push({
        start: m.range.start,
        end: m.range.end,
        cls: 'src-fx src-fx--' + m.sev,
        pri: 1,
      });
    }
    entries.sort(function (a, b) {
      return a.start - b.start || a.pri - b.pri || b.end - a.end;
    });
    const out = [];
    let cursor = 0;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].start < cursor) continue; // overlap → skip, never blend
      out.push(entries[i]);
      cursor = entries[i].end;
    }
    return out;
  }

  /**
   * Paint the syntax tokens covering [from, to) into `parent`.
   *
   * `st` is a walk cursor shared across calls within one render so the token
   * list is traversed exactly once overall rather than re-scanned per
   * segment. A token that straddles the segment boundary is emitted clipped
   * and deliberately NOT consumed, so its remainder lands in the next
   * segment — that is what lets a finding mark start in the middle of a long
   * string value without losing the string's colour on either side of it.
   */
  function emitSyntax(parent, text, toks, st, from, to) {
    if (!toks) {
      if (to > from) parent.appendChild(document.createTextNode(text.slice(from, to)));
      return;
    }
    while (st.i < toks.length && toks[st.i].e <= from) st.i++;
    let cur = from;
    while (st.i < toks.length && toks[st.i].s < to) {
      const tk = toks[st.i];
      const a = tk.s > cur ? tk.s : cur;
      if (a > cur) parent.appendChild(document.createTextNode(text.slice(cur, a)));
      const b = tk.e < to ? tk.e : to;
      const span = document.createElement('span');
      span.className = tk.c;
      // .textContent, not innerHTML: the setter stores the string as a text
      // node without ever parsing it as markup, so a payload containing
      // "<script>" is still just characters. It is one call instead of
      // createTextNode + appendChild, which at ~15k tokens is worth having.
      span.textContent = text.slice(a, b);
      parent.appendChild(span);
      cur = b;
      if (tk.e <= to) st.i++;
      else break;
    }
    if (cur < to) parent.appendChild(document.createTextNode(text.slice(cur, to)));
  }

  function renderBackdrop(side) {
    const p = panes && panes[side];
    if (!p || !p.overlay) return;
    const ov = p.overlay;
    const text = paneText(side);
    const toks = syntaxTokens(side, text);
    const segs = combinedSegments(p);
    const wantSyntax = !!(toks && toks.length);

    if (!wantSyntax && !segs.length) {
      // Nothing to paint. Hide the backdrop and give the textarea its own ink
      // back — an editor whose text lives only in a hidden mirror is a blank
      // editor, which is a far worse failure than an uncoloured one.
      ov.replaceChildren();
      ov.style.display = 'none';
      ov.classList.remove('has-syntax');
      p.el.classList.remove('has-syntax');
      markClipped(p);
      updateSyntaxNotice(p, toks);
      return;
    }

    /* Built into a fragment and swapped in with ONE mutation, which also
       replaces what used to be a node-by-node removal loop over the previous
       render.

       Worth being honest about what this did and did not buy: measured on a
       250KB payload it moved the render from 342ms to 293ms. The cost here is
       CREATING ~15k nodes, not inserting them, and no amount of batching
       changes that — which is exactly why json-syntax.js has a size ceiling
       instead of a cleverer renderer. The fragment stays because one atomic
       swap is still the right shape: the backdrop is never observable in a
       half-built state. */
    const frag = document.createDocumentFragment();
    const st = { i: 0 };
    let cursor = 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      emitSyntax(frag, text, toks, st, cursor, s.start);
      const mark = document.createElement('mark');
      mark.className = s.cls;
      emitSyntax(mark, text, toks, st, s.start, s.end);
      frag.appendChild(mark);
      cursor = s.end;
    }
    emitSyntax(frag, text, toks, st, cursor, text.length);
    ov.replaceChildren(frag);

    // The textarea only goes transparent when the backdrop is genuinely
    // painting its glyphs. With marks but no syntax (a payload past the
    // ceiling) the marks are backgrounds under the textarea's own visible
    // text, exactly as before this module learned to highlight.
    ov.classList.toggle('has-syntax', wantSyntax);
    p.el.classList.toggle('has-syntax', wantSyntax);
    alignOverlay(side);
    ov.style.display = 'block';
    syncScroll(side);
    updateSyntaxNotice(p, toks);
  }

  /* Debounced re-render. Typing must not rebuild a 200KB backdrop per key. */
  function scheduleRender(side) {
    const p = panes && panes[side];
    if (!p) return;
    if (p.renderTimer) clearTimeout(p.renderTimer);
    p.renderTimer = setTimeout(function () {
      p.renderTimer = null;
      renderBackdrop(side);
    }, RENDER_DEBOUNCE_MS);
  }

  /**
   * Say out loud when highlighting is off.
   *
   * A payload past the tokenizer's ceiling renders monochrome, and monochrome
   * is exactly what this whole change was meant to remove — so a reader who
   * sees it needs to know it is a size decision and not a bug. The note is
   * created lazily next to the byte count, which is the one place in the
   * header already talking about how big this payload is.
   */
  function updateSyntaxNotice(p, toks) {
    const off = toks === null; // null means "past the ceiling"; [] just means empty
    if (!off) {
      if (p.notice) p.notice.hidden = true;
      return;
    }
    if (!p.notice) {
      const head = p.card && p.card.querySelector('.input-card-header');
      if (!head) return;
      p.notice = document.createElement('span');
      p.notice.className = 'syntax-off-note';
      const count = head.querySelector('.char-count');
      if (count && count.nextSibling) head.insertBefore(p.notice, count.nextSibling);
      else head.appendChild(p.notice);
    }
    p.notice.textContent = tr('inspector.nav.syntax_off', 'highlighting off — payload too large');
    p.notice.hidden = false;
  }

  /**
   * Compatibility surface for the old two-layer world: set the ACTIVE jump
   * ranges for a pane and re-render. Kept under its original name and
   * signature because it is the module's tested seam for "what does the
   * overlay look like after a navigate()".
   */
  function paintRanges(side, segs) {
    const p = panes && panes[side];
    if (!p) return;
    p.active = (segs || []).filter(function (s) {
      return s.range && s.range.end > s.range.start;
    });
    renderBackdrop(side);
  }

  function alignOverlay(side) {
    const el = panes[side].el;
    const ov = panes[side].overlay;
    let cs;
    try {
      cs = getComputedStyle(el);
    } catch (_e) {
      return; // no layout (jsdom) — structure is still correct
    }
    [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'tabSize',
      'padding',
      'whiteSpace',
      'overflowWrap',
      'wordBreak',
      'boxSizing',
    ].forEach(function (k) {
      if (cs[k]) ov.style[k] = cs[k];
    });
    ov.style.position = 'absolute';
    ov.style.top = el.offsetTop + 'px';
    ov.style.left = el.offsetLeft + 'px';
    ov.style.width = el.clientWidth + 'px';
    ov.style.height = el.clientHeight + 'px';
  }
  function syncScroll(side) {
    const p = panes && panes[side];
    if (!p || !p.overlay) return;
    p.overlay.scrollTop = p.el.scrollTop;
    p.overlay.scrollLeft = p.el.scrollLeft;
    markClipped(p);
    positionPopover();
  }
  /**
   * Say when a line runs past the right edge.
   *
   * The editor does NOT soft-wrap, and that is a deliberate choice rather than
   * an oversight: a payload is code, re-flowing it on every column resize
   * loses the reader the position they were holding, the gutter numbers
   * LOGICAL lines so wrapping would desynchronise it from the text, and one
   * `adm` carrying a 13KB VAST would wrap into ~150 visual lines and bury the
   * rest of the payload under a single field.
   *
   * The cost of that choice is that a long line is silently cut at the panel
   * edge — which is what "lines 14/15/23 are truncated" actually was. The
   * scrollbar is supposed to be the cue and cannot be relied on: this shell
   * asks for `scrollbar-width: thin`, and on the platforms that honour it as
   * an OVERLAY scrollbar nothing is drawn at all until you are already
   * scrolling. So the cue is stated explicitly — a fade at the edge whenever
   * there is more text to the right of it, gone the moment there is not.
   */
  function markClipped(p) {
    if (!p.editor || !p.el) return;
    let more = false;
    try {
      more = p.el.scrollWidth - p.el.clientWidth - p.el.scrollLeft > 1;
    } catch (_e) {
      return;
    }
    p.editor.classList.toggle('is-clipped-right', more);
  }
  // CP3.2: re-align the EXISTING backdrop to its textarea after a geometry
  // change. Re-applies geometry/scroll only — never rebuilds the source map.
  // Unconditional since the backdrop became permanent: it now carries the
  // syntax colouring too, so it is live whether or not a jump is active.
  function refreshOverlayGeometry() {
    geometryRefreshCount++;
    if (!panes) return;
    ['request', 'response'].forEach(function (side) {
      if (panes[side]) {
        alignOverlay(side);
        syncScroll(side);
      }
    });
  }
  function clearHighlights() {
    highlightActive = false;
    if (!panes) return;
    ['request', 'response'].forEach(function (s) {
      if (panes[s]) paintRanges(s, []);
    });
  }

  function expand(side) {
    const card = panes[side] && panes[side].card;
    if (card && card.classList.contains('is-collapsed')) card.classList.remove('is-collapsed');
  }
  function focusAndScroll(side, range, line) {
    const el = panes[side].el;
    try {
      el.focus();
      el.setSelectionRange(range.start, range.end);
    } catch (_e) {
      /* selection unsupported (jsdom) — backdrop still shows it */
    }
    let lh = 16;
    try {
      lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
    } catch (_e2) {
      /* */
    }
    el.scrollTop = Math.max(0, (line - 1) * lh - 60);
    syncScroll(side);
  }

  function announce(msg) {
    if (live) live.textContent = msg;
  }

  // ── persistent finding markers + the rail ──────────────────────────────────
  /**
   * Resolve every locatable finding once, at analyze time, into a marker.
   *
   * Container-precision locations are deliberately excluded from the resting
   * marker layer: a container range can span a hundred lines, and underlining
   * a hundred lines says "everything here is wrong" when the finding means
   * "something in here is". Containers still work for the ACTIVE jump, where
   * a large highlight is a deliberate answer to a deliberate click.
   *
   * Overlaps are resolved worst-first, then narrowest-first — the same rule
   * the gutter uses for its line numbers, so a line tinted red in the gutter
   * and the underline beneath it cannot disagree about severity.
   */
  function buildMarkers() {
    if (!panes) return;
    ['request', 'response'].forEach(function (s) {
      if (panes[s]) panes[s].marks = [];
    });
    if (!analyzed) return;
    const byKey = {};
    for (let i = 0; i < analyzed.list.length; i++) {
      const item = analyzed.list[i];
      const sev = normSeverity(item.level);
      if (!sev) continue; // `ok` crosschecks are not places to mark
      const prim = item.location && item.location.primary;
      if (!prim || prim.precision === 'container') continue;
      const r = resolvePart(prim, item.location.dialect);
      if (!r.ok || r.range.end <= r.range.start) continue;
      const key = r.side + ':' + r.range.start + ':' + r.range.end;
      const prev = byKey[key];
      if (prev && SEV_RANK[prev.sev] >= SEV_RANK[sev]) continue;
      byKey[key] = { side: r.side, range: r.range, sev: sev, line: r.line, index: i, item: item };
    }
    const all = Object.keys(byKey).map(function (k) {
      return byKey[k];
    });
    all.sort(function (a, b) {
      return a.range.start - b.range.start || a.range.end - b.range.end;
    });
    for (let i = 0; i < all.length; i++) {
      const m = all[i];
      if (panes[m.side]) panes[m.side].marks.push(m);
    }
  }

  /**
   * The rail: one tick per marker, positioned by line as a fraction of the
   * payload's height, down the right edge of the editor.
   *
   * This is the piece that replaces the stepper. A stepper answers "what is
   * the next problem"; a rail answers "how many problems are there, how bad,
   * and where do they cluster" — which is the question a reader actually
   * opens a payload with, and it answers it without a single click.
   *
   * Built as an ARIA toolbar with roving tabindex so the whole rail is ONE
   * tab stop and the arrow keys walk it. That is deliberately not a pile of
   * focusable buttons: eleven findings would otherwise mean eleven tab stops
   * between the editor and everything after it.
   */
  function renderRail(side) {
    const p = panes && panes[side];
    if (!p || !p.rail) return;
    const rail = p.rail;
    while (rail.firstChild) rail.removeChild(rail.firstChild);
    const marks = p.marks;
    if (!marks.length) {
      rail.hidden = true;
      if (p.editor) p.editor.classList.remove('has-finding-rail');
      return;
    }
    const total = Math.max(1, paneText(side).split('\n').length);
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'finding-tick finding-tick--' + m.sev;
      tick.tabIndex = i === 0 ? 0 : -1;
      tick.style.top = ((m.line - 1) / total) * 100 + '%';
      tick.dataset.index = String(m.index);
      const label = tr('inspector.nav.tick', 'line {line}: {what}', {
        line: m.line,
        what: markerLabel(m),
      });
      tick.setAttribute('aria-label', label);
      tick.title = label;
      rail.appendChild(tick);
    }
    rail.hidden = false;
    if (p.editor) p.editor.classList.add('has-finding-rail');
  }

  /* What to call a marker in a tooltip / popover. The server already sends a
     localized sentence per finding; its first clause is the title the right
     panel shows, so reusing it keeps the two names identical. Falls back to
     the location's own display string, which is always present. */
  function markerLabel(m) {
    const msg = String((m.item && m.item.msg) || '').replace(/^\[(request|response)\]\s+/, '');
    if (msg) {
      const cut = msg.indexOf('. ');
      return cut > 0 ? msg.slice(0, cut + 1) : msg;
    }
    return (m.item && m.item.location && m.item.location.primary.display) || '';
  }

  // ── the caret/tick popover ─────────────────────────────────────────────────
  /**
   * Zed's move: the diagnostic for wherever you are, right where you are.
   *
   * Hit-testing the inline markers with the mouse is not possible here — the
   * backdrop sits BEHIND a transparent textarea and is pointer-events:none,
   * so every mouse event belongs to the textarea by construction. Rather than
   * fight that with coordinate maths, this uses the textarea's OWN hit
   * testing: wherever the caret lands, by click or by arrow key, we ask which
   * marker contains that offset. That is more accurate than a pixel guess,
   * and it makes the feature keyboard-native rather than keyboard-retrofitted.
   *
   * The popover anchors to the LINE, not the column: a column-accurate anchor
   * would need per-character measurement that a late-loading font invalidates,
   * and the line is the unit the reader is looking at anyway.
   */
  function ensurePopover() {
    if (popover) return popover;
    popover = document.createElement('div');
    popover.className = 'src-pop';
    popover.hidden = true;
    // This surface contains an action, so it is a non-modal dialog rather than
    // a live-region status. Keyboard focus stays in the editor until Tab moves
    // directly to the action (see onKeydown).
    popover.setAttribute('role', 'dialog');
    document.body.appendChild(popover);
    return popover;
  }
  function hidePopover() {
    popoverItem = null;
    if (popover) popover.hidden = true;
  }
  function markerAtOffset(side, offset) {
    const p = panes && panes[side];
    if (!p) return null;
    for (let i = 0; i < p.marks.length; i++) {
      const m = p.marks[i];
      if (offset >= m.range.start && offset <= m.range.end) return m;
    }
    return null;
  }
  function showPopoverFor(m) {
    if (!m) return hidePopover();
    const pop = ensurePopover();
    popoverItem = m;
    while (pop.firstChild) pop.removeChild(pop.firstChild);
    pop.className = 'src-pop src-pop--' + m.sev;

    const title = document.createElement('span');
    title.className = 'src-pop-title';
    title.id = 'src-pop-title';
    title.appendChild(document.createTextNode(markerLabel(m)));
    pop.appendChild(title);
    pop.setAttribute('aria-labelledby', title.id);

    const where = document.createElement('span');
    where.className = 'src-pop-where';
    where.id = 'src-pop-where';
    where.appendChild(
      document.createTextNode(
        (m.item.location.primary.display || '') +
          '  ' +
          tr('inspector.nav.at_line', 'line {line}', { line: m.line }),
      ),
    );
    pop.appendChild(where);
    pop.setAttribute('aria-describedby', where.id);

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'src-pop-go';
    go.textContent = tr('inspector.nav.to_card', 'open the finding');
    go.addEventListener('click', function () {
      hidePopover();
      revealCard(m.item.id);
    });
    go.addEventListener('blur', function (e) {
      if (!pop.contains(e.relatedTarget)) hidePopover();
    });
    pop.appendChild(go);

    pop.hidden = false;
    positionPopover();
  }
  function positionPopover() {
    if (!popover || popover.hidden || !popoverItem || !panes) return;
    const m = popoverItem;
    const p = panes[m.side];
    if (!p || !p.el) {
      hidePopover();
      return;
    }
    let rect, lh, padTop;
    try {
      rect = p.el.getBoundingClientRect();
      const cs = getComputedStyle(p.el);
      lh = parseFloat(cs.lineHeight) || 16;
      padTop = parseFloat(cs.paddingTop) || 0;
    } catch (_e) {
      return;
    }
    // Prefer below the marked line, flip above when there is no room, then
    // clamp the complete box to the visible editor/viewport intersection.
    // Checking only the anchor left the action below the screen on the last
    // visible line of a short/mobile viewport.
    const y = rect.top + padTop + m.line * lh - p.el.scrollTop;
    if (y < rect.top || y > rect.bottom) {
      popover.hidden = true;
      return;
    }
    popover.hidden = false;
    const docEl = document.documentElement;
    const viewportWidth = window.innerWidth || (docEl && docEl.clientWidth) || rect.right;
    const viewportHeight = window.innerHeight || (docEl && docEl.clientHeight) || rect.bottom;
    const gutter = 8;
    const editorRight = Math.min(rect.right, viewportWidth - gutter);
    const left = Math.max(gutter, Math.min(rect.left, editorRight));
    const maxWidth = Math.max(1, editorRight - left);
    popover.style.left = Math.round(left) + 'px';
    popover.style.maxWidth = Math.round(maxWidth) + 'px';

    const popRect = popover.getBoundingClientRect();
    const popHeight = popRect.height || popover.offsetHeight || 0;
    const minTop = Math.max(gutter, rect.top);
    const visibleBottom = Math.min(rect.bottom, viewportHeight - gutter);
    const maxTop = Math.max(minTop, visibleBottom - popHeight);
    let top = y + 4;
    if (popHeight && top + popHeight > visibleBottom) top = y - lh - popHeight - 4;
    top = Math.max(minTop, Math.min(top, maxTop));
    popover.style.top = Math.round(top) + 'px';
  }
  /**
   * The other half of the two-way link: from a place in the code to the card
   * that explains it. The findings panel stamps data-finding-id on every card,
   * so this is a lookup and a scroll — and when the card is not on screen
   * (another tab is open) it does nothing rather than pretending.
   */
  function revealCard(id) {
    if (!id) return;
    const card = document.querySelector('[data-finding-id="' + CSS.escape(String(id)) + '"]');
    if (!card) return;
    // Smooth only when the reader has not asked for less motion; a long
    // animated scroll is exactly the thing that setting exists to stop.
    let smooth = true;
    try {
      smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_e) {
      /* no matchMedia (jsdom) — fall through to the default */
    }
    try {
      card.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    } catch (_e) {
      card.scrollIntoView();
    }
    card.classList.add('is-flashed');
    const focusTarget = card.firstElementChild;
    if (focusTarget && focusTarget.tagName === 'SUMMARY') {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch (_e) {
        focusTarget.focus();
      }
    }
    setTimeout(function () {
      card.classList.remove('is-flashed');
    }, 1200);
  }
  function onCaretMoved(side) {
    const p = panes && panes[side];
    if (!p || !p.marks.length) return hidePopover();
    let pos = null;
    try {
      pos = p.el.selectionStart;
    } catch (_e) {
      return;
    }
    if (pos == null) return;
    const m = markerAtOffset(side, pos);
    if (!m) return hidePopover();
    if (popoverItem && popoverItem === m) return;
    showPopoverFor(m);
  }

  // ── navigate ───────────────────────────────────────────────────────────────
  function navigate(location, index) {
    if (!panes || !analyzed) return false;
    clearHighlights();
    if (!location || !location.primary) {
      announce(tr('inspector.nav.no_source', 'No source location for this finding.'));
      return false;
    }
    const pr = resolvePart(location.primary, location.dialect);
    if (!pr.ok) {
      announce(
        tr('inspector.nav.no_precise', 'No precise source location ({reason}).', {
          reason: pr.reason,
        }),
      );
      return false;
    }
    // The one-editor tab layout hides the inactive payload behind a tab, and
    // hides it with a class expand() does not touch — expand() removes
    // `is-collapsed`, the fold mechanism of the old two-pane layout where both
    // textareas were visible. A jump into the hidden side therefore painted an
    // overlay nobody could see, and left the reader on a payload with nothing
    // wrong in it.
    //
    // Reveal here, not in the finding-action dispatcher: the source rail and
    // Alt+↓/↑ stepping reach navigate() by their own routes, and all three
    // should behave the same. Key off pr.side — the PRIMARY location — because
    // the paint loop below walks both sides, so revealing from inside it would
    // end on whichever side happens to be last and steal the tab from the
    // location the user actually asked for. The guard keeps this working where
    // the host page exposes no tab function, which is the standalone shells
    // and every jsdom test.
    if (typeof window.showPayloadSide === 'function') {
      window.showPayloadSide(pr.side === 'response' ? 'res' : 'req');
    }
    const bySide = { request: [], response: [] };
    bySide[pr.side].push({
      range: pr.range,
      kind: location.primary.precision === 'container' ? 'container' : 'exact',
    });
    (location.related || []).forEach(function (rel) {
      const rr = resolvePart(rel, location.dialect);
      if (rr.ok) bySide[rr.side].push({ range: rr.range, kind: 'related' });
    });
    ['request', 'response'].forEach(function (side) {
      if (bySide[side].length) expand(side);
      paintRanges(side, bySide[side]);
    });
    highlightActive = true;
    focusAndScroll(pr.side, pr.range, pr.line);
    if (typeof index === 'number') analyzed.cursor = index;
    const relCount = bySide.request.length + bySide.response.length - 1;
    announce(
      tr('inspector.nav.jumped', 'Jumped to {display} on {side}, line {line} column {col}', {
        display: location.primary.display,
        side: sideLabel(pr.side),
        line: pr.line,
        col: pr.col,
      }) + (relCount > 0 ? tr('inspector.nav.related', ' ({n} related)', { n: relCount }) : ''),
    );
    onCaretMoved(pr.side);
    return true;
  }

  function step(dir) {
    if (!analyzed || !analyzed.list.length) return;
    const n = analyzed.list.length;
    let c = analyzed.cursor;
    c = ((((c < 0 ? (dir > 0 ? -1 : 0) : c) + dir) % n) + n) % n;
    navigate(analyzed.list[c].location, c);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  // Clear the CURRENT navigation (highlight + analyzed revision) WITHOUT
  // removing the instance. Called at the START of every runAnalysis() so a
  // failed/aborted analyze never leaves a stale jump — or a stale marker —
  // active. The syntax layer is NOT part of a "navigation" and survives: it
  // describes the text, not the analysis.
  function resetNavigation() {
    clearHighlights();
    analyzed = null;
    hidePopover();
    if (panes) {
      ['request', 'response'].forEach(function (s) {
        if (!panes[s]) return;
        panes[s].marks = [];
        renderRail(s);
        renderBackdrop(s);
      });
    }
  }

  function onAnalyzed(items) {
    if (!panes) return;
    analyzed = {
      texts: { request: djb2(paneText('request')), response: djb2(paneText('response')) },
      maps: {},
      list: [],
      cursor: -1,
    };
    ['request', 'response'].forEach(function (side) {
      if (paneText(side).length <= EAGER_MAX) analyzed.maps[side] = buildMap(side);
    });
    const list = (items || [])
      .filter(function (f) {
        return f && f.location && f.location.precision !== 'none' && f.location.primary;
      })
      .map(function (f) {
        // `level` and `msg` ride along so the marker layer can colour and
        // name itself without a second trip to the findings panel.
        return { id: f.id, location: f.location, level: f.level, msg: f.msg };
      });
    analyzed.list = list;
    clearHighlights();
    buildMarkers();
    ['request', 'response'].forEach(function (s) {
      if (!panes[s]) return;
      renderRail(s);
      renderBackdrop(s);
    });
  }

  // edit / stale: any change to a pane invalidates the analyzed revision.
  // The markers go with it — a wavy underline pinned to an offset the user has
  // just typed past is worse than no underline, because it is confidently wrong.
  function markStale(side) {
    if (!analyzed) return;
    if (djb2(paneText(side)) !== analyzed.texts[side]) {
      analyzed.maps[side] = null;
      clearHighlights();
      analyzed.list = [];
      analyzed.cursor = -1;
      hidePopover();
      ['request', 'response'].forEach(function (s) {
        if (!panes[s]) return;
        panes[s].marks = [];
        renderRail(s);
      });
    }
  }

  // Full instance removal: abort every listener, remove backdrops, rails,
  // popover and live region, drop all state. Safe to call repeatedly.
  function teardown() {
    if (controller) {
      try {
        controller.abort();
      } catch (_e) {
        /* */
      }
      controller = null;
    }
    // CP3.2: the window listeners detach via controller.abort() (signal); the
    // ResizeObserver has no signal, so disconnect it explicitly here.
    if (resizeObs) {
      try {
        resizeObs.disconnect();
      } catch (_e) {
        /* */
      }
      resizeObs = null;
    }
    if (panes) {
      ['request', 'response'].forEach(function (s) {
        const p = panes[s];
        if (!p) return;
        if (p.renderTimer) clearTimeout(p.renderTimer);
        if (p.overlay && p.overlay.remove) p.overlay.remove();
        if (p.rail && p.rail.remove) p.rail.remove();
        if (p.notice && p.notice.remove) p.notice.remove();
        if (p.el && p.el.classList) p.el.classList.remove('has-syntax');
        if (p.editor && p.editor.classList) p.editor.classList.remove('has-finding-rail');
      });
    }
    if (live && live.remove) live.remove();
    if (popover && popover.remove) popover.remove();
    panes = null;
    live = null;
    popover = null;
    popoverItem = null;
    analyzed = null;
    highlightActive = false;
  }

  // ── init / DOM ──────────────────────────────────────────────────────────────
  function makeOverlay(el) {
    // idempotent across re-mounts: drop a prior backdrop for this textarea
    const prev = el.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains('src-hl-overlay') && prev.remove)
      prev.remove();
    // <pre> rather than <div>: the backdrop's whole job is to reproduce the
    // textarea's text layout, and <pre> is the element whose defaults already
    // do that. alignOverlay() still copies the live computed metrics on top.
    const ov = document.createElement('pre');
    ov.className = 'src-hl-overlay';
    ov.setAttribute('aria-hidden', 'true');
    ov.style.display = 'none';
    if (el.parentNode) el.parentNode.insertBefore(ov, el);
    return ov;
  }
  function makeRail(editor, side, signal) {
    if (!editor) return null;
    const prev = editor.querySelector(':scope > .finding-rail');
    if (prev && prev.remove) prev.remove();
    const rail = document.createElement('div');
    rail.className = 'finding-rail';
    rail.setAttribute('role', 'toolbar');
    rail.setAttribute('aria-orientation', 'vertical');
    rail.setAttribute('aria-label', tr('inspector.nav.rail', 'Findings in this payload'));
    rail.hidden = true;
    rail.addEventListener(
      'click',
      function (e) {
        const tick = e.target && e.target.closest ? e.target.closest('.finding-tick') : null;
        if (!tick || !analyzed) return;
        const idx = Number(tick.dataset.index);
        const item = analyzed.list[idx];
        if (item) navigate(item.location, idx);
      },
      { signal: signal },
    );
    // Roving tabindex: one tab stop for the rail, arrows to walk the ticks.
    rail.addEventListener(
      'keydown',
      function (e) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const ticks = Array.prototype.slice.call(rail.querySelectorAll('.finding-tick'));
        if (!ticks.length) return;
        e.preventDefault();
        const at = ticks.indexOf(document.activeElement);
        const nextIdx = (at + (e.key === 'ArrowDown' ? 1 : -1) + ticks.length) % ticks.length;
        ticks.forEach(function (t) {
          t.tabIndex = -1;
        });
        ticks[nextIdx].tabIndex = 0;
        ticks[nextIdx].focus();
      },
      { signal: signal },
    );
    editor.appendChild(rail);
    return rail;
  }
  function bindPane(side, el, signal) {
    if (!el) return null;
    const card = el.closest ? el.closest('.input-card') : null;
    const editor = el.closest ? el.closest('.json-editor') : null;
    const overlay = makeOverlay(el);
    const pane = {
      el: el,
      card: card,
      editor: editor,
      overlay: overlay,
      rail: null,
      marks: [],
      active: [],
      synText: null,
      synToks: null,
      renderTimer: null,
      notice: null,
    };
    pane.rail = makeRail(editor, side, signal);
    el.addEventListener(
      'input',
      function () {
        markStale(side);
        scheduleRender(side);
      },
      { signal: signal },
    );
    el.addEventListener(
      'scroll',
      function () {
        syncScroll(side);
      },
      { signal: signal },
    );
    // Caret-driven popover: click and keyboard both land here, because both
    // ultimately move selectionStart. 'select' covers programmatic jumps.
    ['click', 'keyup', 'select'].forEach(function (evt) {
      el.addEventListener(
        evt,
        function () {
          onCaretMoved(side);
        },
        { signal: signal },
      );
    });
    el.addEventListener(
      'blur',
      function (e) {
        if (popover && e.relatedTarget && popover.contains(e.relatedTarget)) return;
        const itemAtBlur = popoverItem;
        setTimeout(function () {
          if (!popover || popover.hidden || popoverItem !== itemAtBlur) return;
          if (popover.contains(document.activeElement)) return;
          hidePopover();
        }, 0);
      },
      { signal: signal },
    );
    return pane;
  }

  function init(opts) {
    opts = opts || {};
    // Fully remove any previous instance FIRST → idempotent, no listener stacking.
    teardown();
    const reqEl = document.getElementById(opts.requestId || 'bidReq');
    const resEl = document.getElementById(opts.responseId || 'bidRes');
    if (!reqEl && !resEl) return false;
    controller =
      typeof AbortController === 'function'
        ? new AbortController()
        : { abort: function () {}, signal: undefined };
    const signal = controller.signal;
    panes = {
      request: bindPane('request', reqEl, signal),
      response: bindPane('response', resEl, signal),
    };
    live = document.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
    document.addEventListener('keydown', onKeydown, { signal: signal });
    // CP3.2: keep the EXISTING backdrop aligned to its textarea after any
    // geometry change — input-section drag-resize, window resize/orientation,
    // a responsive breakpoint, or a textarea/card resize. Re-aligns only; it
    // never rebuilds the source map. Lifecycle-owned: the ResizeObserver is
    // disconnected in teardown() and the window listeners detach via this
    // instance's signal, so a remount starts fresh with no stale callbacks.
    if (typeof ResizeObserver === 'function') {
      resizeObs = new ResizeObserver(refreshOverlayGeometry);
      ['request', 'response'].forEach(function (side) {
        if (panes[side] && panes[side].el) resizeObs.observe(panes[side].el);
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', refreshOverlayGeometry, { signal: signal });
      window.addEventListener('orientationchange', refreshOverlayGeometry, { signal: signal });
    }
    // Paint whatever is already in the panes — a restored session, a shared
    // permalink or a sample loaded before this module mounted.
    ['request', 'response'].forEach(function (side) {
      if (panes[side]) renderBackdrop(side);
    });
    return true;
  }

  function isTyping(el) {
    if (!el) return false;
    const t = (el.tagName || '').toLowerCase();
    return t === 'textarea' || t === 'input' || t === 'select' || el.isContentEditable;
  }
  function onKeydown(e) {
    if (e.key === 'Tab' && popover && !popover.hidden && popoverItem) {
      const source = panes && panes[popoverItem.side] && panes[popoverItem.side].el;
      const action = popover.querySelector('.src-pop-go');
      if (!e.shiftKey && e.target === source && action) {
        e.preventDefault();
        action.focus();
        return;
      }
      if (e.shiftKey && e.target === action && source) {
        e.preventDefault();
        source.focus();
        return;
      }
    }
    // Alt+↓ / Alt+↑ cycle findings even from inside the editor. This is the
    // stepper's keyboard contract, kept after its buttons were removed.
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      step(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    // Esc clears an ACTIVE highlight — including while the textarea has focus
    // (no isTyping guard); when no highlight is active it stays out of the way.
    // The resting marker layer survives: Esc dismisses what you jumped to, not
    // the map of what is wrong.
    if (e.key === 'Escape') {
      if (popover && !popover.hidden) {
        const source =
          popoverItem && panes && panes[popoverItem.side] && panes[popoverItem.side].el;
        const focusWasInside = popover.contains(document.activeElement);
        hidePopover();
        if (focusWasInside && source) {
          e.preventDefault();
          source.focus();
        }
      }
      if (highlightActive) {
        clearHighlights();
        if (analyzed) analyzed.cursor = -1;
      }
    }
  }

  /**
   * The 1-based source line a finding's location resolves to, or null when
   * the payload has no such line (unresolved pointer, stale map, URL dialect
   * without provenance). Public because the findings panel prints "· line N"
   * beside each path chip, and the alternative — re-implementing the pointer
   * walk there — would be a second answer to a question this module already
   * answers, free to disagree with the jump the same chip performs.
   */
  function lineFor(location) {
    if (!location || !location.primary) return null;
    try {
      const r = resolvePart(location.primary);
      return r && r.ok ? r.line : null;
    } catch (_e) {
      return null;
    }
  }

  window.OrtbtoolsSourceNav = {
    init: init,
    onAnalyzed: onAnalyzed,
    navigate: navigate,
    lineFor: lineFor,
    resetNavigation: resetNavigation,
    next: function () {
      step(1);
    },
    prev: function () {
      step(-1);
    },
    markStale: markStale,
    teardown: teardown,
    // test surface (pure helpers + state peek)
    __test: {
      resolvePart: resolvePart,
      paintRanges: paintRanges,
      renderBackdrop: renderBackdrop,
      djb2: djb2,
      isTyping: isTyping,
      highlightActive: function () {
        return highlightActive;
      },
      state: function () {
        return analyzed;
      },
      panes: function () {
        return panes;
      },
      markers: function (side) {
        return panes && panes[side] ? panes[side].marks : [];
      },
      geometryRefreshes: function () {
        return geometryRefreshCount;
      },
      popover: function () {
        return popover;
      },
      positionPopover: positionPopover,
    },
  };
})();
