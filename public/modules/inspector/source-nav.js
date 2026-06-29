/* ============================================================================
 * source-nav.js — exact finding→source navigation (Stage 1 CP3, client wiring).
 *
 * Consumes the additive `finding.location` contract from /api/analyze and the
 * canonical packages/core/source-map.js (shipped verbatim to /core/source-map.js,
 * CI sha256 parity-guarded) to highlight the EXACT key/value/node in the user's
 * pasted JSON — in whichever pane (request/response) the finding belongs to.
 *
 * Hard guarantees:
 *   • Side comes ONLY from location.primary.side (server, from validate() call
 *     context). No id/path regex side-guessing anywhere here.
 *   • XSS-safe: payload text enters the overlay ONLY via document.createTextNode
 *     — never innerHTML. The only element built around it is <mark>.
 *   • Honest fallback: a pointer that doesn't resolve against the CURRENT text
 *     (edited / stale / invalid / >2MB / unknown provenance) → NO jump.
 *   • Privacy: nothing here is logged or transmitted; pure local DOM.
 *
 * No bundler: plain IIFE attaching window.SpyglassSourceNav.
 * ========================================================================== */
(function () {
  'use strict';

  const EAGER_MAX = 1024 * 1024; // ≤1MB → build the index eagerly at analyze time
  const HARD_MAX = 2 * 1024 * 1024; // >2MB → disabled (matches server body cap)

  let SM = null; // window.SpyglassSourceMap (resolved lazily)
  function sm() {
    if (!SM) SM = (typeof window !== 'undefined' && window.SpyglassSourceMap) || null;
    return SM;
  }

  // ── module state ──────────────────────────────────────────────────────────
  let panes = null; // { request:{el,card,overlay}, response:{el,card,overlay} }
  let live = null; // aria-live region
  let bar = null; // prev/next controls element
  let statusEl = null;
  let analyzed = null; // { texts:{request,response}, maps:{}, list:[], cursor }

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

  // ── XSS-safe overlay (text nodes only) ─────────────────────────────────────
  function paintRanges(side, segs) {
    const ov = panes[side].overlay;
    while (ov.firstChild) ov.removeChild(ov.firstChild);
    const text = paneText(side);
    if (!segs || !segs.length) {
      ov.style.display = 'none';
      return;
    }
    // sort + drop overlaps (earliest wins)
    const ordered = segs
      .filter(function (s) {
        return s.range && s.range.end > s.range.start;
      })
      .sort(function (a, b) {
        return a.range.start - b.range.start;
      });
    let cursor = 0;
    for (let i = 0; i < ordered.length; i++) {
      const r = ordered[i].range;
      if (r.start < cursor) continue; // overlap → skip
      if (r.start > cursor) ov.appendChild(document.createTextNode(text.slice(cursor, r.start)));
      const mark = document.createElement('mark');
      mark.className = 'src-hl src-hl--' + ordered[i].kind;
      mark.appendChild(document.createTextNode(text.slice(r.start, r.end))); // payload → TEXT NODE
      ov.appendChild(mark);
      cursor = r.end;
    }
    if (cursor < text.length) ov.appendChild(document.createTextNode(text.slice(cursor)));
    alignOverlay(side);
    ov.style.display = 'block';
    syncScroll(side);
  }
  // Mirror the textarea's geometry + typography so the backdrop lines up. The
  // textarea is made transparent (CSS) and the overlay carries its background,
  // so only the <mark> backgrounds show through behind the editable text.
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
      'backgroundColor',
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
    const p = panes[side];
    if (!p || !p.overlay) return;
    p.overlay.scrollTop = p.el.scrollTop;
    p.overlay.scrollLeft = p.el.scrollLeft;
  }
  function clearHighlights() {
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
      /* selection unsupported (jsdom) — overlay still shows it */
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
  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  // ── navigate ───────────────────────────────────────────────────────────────
  function navigate(location, index) {
    if (!panes || !analyzed) return false;
    clearHighlights();
    if (!location || !location.primary) {
      announce('No source location for this finding.');
      setStatus('—');
      return false;
    }
    const pr = resolvePart(location.primary, location.dialect);
    if (!pr.ok) {
      announce('No precise source location (' + pr.reason + ').');
      setStatus('no precise location');
      return false;
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
    focusAndScroll(pr.side, pr.range, pr.line);
    if (typeof index === 'number') analyzed.cursor = index;
    const rel = bySide.request.length + bySide.response.length - 1;
    announce(
      'Jumped to ' +
        location.primary.display +
        ' on ' +
        pr.side +
        ', line ' +
        pr.line +
        ' column ' +
        pr.col +
        (rel > 0 ? ' (' + rel + ' related)' : ''),
    );
    setStatus(location.primary.display + '  ' + pr.side + ':' + pr.line + ':' + pr.col);
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
  function onAnalyzed(items) {
    if (!panes) return;
    analyzed = {
      texts: { request: djb2(paneText('request')), response: djb2(paneText('response')) },
      maps: {},
      list: [],
      cursor: -1,
    };
    // eager build for small panes; lazy (build-on-first-resolve) for 1–2MB.
    ['request', 'response'].forEach(function (side) {
      if (paneText(side).length <= EAGER_MAX) analyzed.maps[side] = buildMap(side);
    });
    const list = (items || [])
      .filter(function (f) {
        return f && f.location && f.location.precision !== 'none' && f.location.primary;
      })
      .map(function (f) {
        return { id: f.id, location: f.location };
      });
    analyzed.list = list;
    clearHighlights();
    if (bar) bar.hidden = list.length === 0;
    setStatus(list.length ? list.length + ' locatable' : 'none locatable');
  }

  // edit / stale: any change to a pane invalidates the analyzed revision.
  function markStale(side) {
    if (!analyzed) return;
    if (djb2(paneText(side)) !== analyzed.texts[side]) {
      analyzed.maps[side] = null;
      clearHighlights();
      analyzed.list = [];
      analyzed.cursor = -1;
      if (bar) bar.hidden = true;
      setStatus('edited — re-run analyze');
    }
  }

  function teardown() {
    clearHighlights();
    analyzed = null;
    if (bar) bar.hidden = true;
    setStatus('');
  }

  // ── init / DOM ──────────────────────────────────────────────────────────────
  function makeOverlay(el) {
    // idempotent across re-mounts: drop a prior overlay for this textarea
    const prev = el.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains('src-hl-overlay') && prev.remove)
      prev.remove();
    const ov = document.createElement('div');
    ov.className = 'src-hl-overlay';
    ov.setAttribute('aria-hidden', 'true');
    ov.style.display = 'none';
    if (el.parentNode) el.parentNode.insertBefore(ov, el);
    return ov;
  }
  function bindPane(side, el) {
    if (!el) return null;
    const card = el.closest ? el.closest('.input-card') : null;
    const overlay = makeOverlay(el);
    el.addEventListener('input', function () {
      markStale(side);
    });
    el.addEventListener('scroll', function () {
      syncScroll(side);
    });
    return { el: el, card: card, overlay: overlay };
  }

  function init(opts) {
    opts = opts || {};
    const reqEl = document.getElementById(opts.requestId || 'bidReq');
    const resEl = document.getElementById(opts.responseId || 'bidRes');
    if (!reqEl && !resEl) return false;
    panes = { request: bindPane('request', reqEl), response: bindPane('response', resEl) };
    live = document.getElementById('srcNavLive');
    if (!live) {
      live = document.createElement('div');
      live.id = 'srcNavLive';
      live.className = 'sr-only';
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
    }
    bar = document.getElementById('srcNavBar');
    if (bar) buildControls(bar);
    bindKeys();
    return true;
  }

  function buildControls(host) {
    while (host.firstChild) host.removeChild(host.firstChild);
    const prev = btn('‹ prev', function () {
      step(-1);
    });
    const next = btn('next ›', function () {
      step(1);
    });
    statusEl = document.createElement('span');
    statusEl.className = 'src-nav-status';
    host.appendChild(prev);
    host.appendChild(next);
    host.appendChild(statusEl);
    host.hidden = true;
  }
  function btn(label, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-icon src-nav-btn';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  function isTyping(el) {
    if (!el) return false;
    const t = (el.tagName || '').toLowerCase();
    return t === 'textarea' || t === 'input' || t === 'select' || el.isContentEditable;
  }
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      // Alt+↓ / Alt+↑ cycle findings even from inside the editor; Esc clears.
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        step(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'Escape' && analyzed && !isTyping(e.target)) clearHighlights();
    });
  }

  window.SpyglassSourceNav = {
    init: init,
    onAnalyzed: onAnalyzed,
    navigate: navigate,
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
      djb2: djb2,
      state: function () {
        return analyzed;
      },
      panes: function () {
        return panes;
      },
    },
  };
})();
