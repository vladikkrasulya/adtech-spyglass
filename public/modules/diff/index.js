/* ============================================================
   modules/diff/index.js — the Diff tab.

   Compares what is in the Inspector (side A) against a payload the
   user pastes (side B), using the shared engine mirrored to
   /core/diff.js. There is deliberately no second implementation of
   the comparison rules here: this file is presentation only.

   READ-ONLY BY CONTRACT. The tab never writes to the editor panes.
   It reads them, renders a comparison, and can move the caret to a
   position — nothing else. A diff view that silently edited the
   payload it was describing would be the worst possible surprise.

   WHY REQUEST AND RESPONSE ARE COMPARED SEPARATELY
   The semantic registry is rooted at the payload root — "/imp",
   "/seatbid", and per-imp media paths. Wrapping both sides into one
   {req, res} bundle would shift every path down a level, so NONE of
   the OpenRTB rules would match and the whole thing would silently
   degrade to a raw positional compare. The tab therefore compares one
   document at a time, and the target selector picks which.

   Exposed: window.OrtbtoolsDiffTab (mount/render, for tests).
   ============================================================ */
(function () {
  'use strict';

  const MAX_VALUE_PREVIEW = 160;

  function tt(key, params) {
    return typeof window.t === 'function' ? window.t(key, params) : '[' + key + ']';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Compact one-line rendering of a JSON value, truncated for the table. */
  function preview(value) {
    if (value === undefined) return '—';
    let text;
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value);
    } catch (_e) {
      text = String(value);
    }
    if (text === undefined) text = 'undefined';
    return text.length > MAX_VALUE_PREVIEW ? text.slice(0, MAX_VALUE_PREVIEW) + '…' : text;
  }

  // ── State ────────────────────────────────────────────────────────
  let target = 'request'; // 'request' | 'response'
  let mode = 'semantic'; // 'semantic' | 'raw'
  let sideB = '';
  /** Last result, kept so a jump can resolve paths without recomputing. */
  let lastResult = null;

  function paneIdFor(which) {
    return which === 'response' ? 'bidRes' : 'bidReq';
  }

  function readSideA() {
    const el = document.getElementById(paneIdFor(target));
    return el ? el.value || '' : '';
  }

  // ── Comparison ───────────────────────────────────────────────────

  /**
   * Turn an engine warning into a sentence a person can act on. The engine
   * reports which indices were missing/invalid/duplicated on each side; the
   * user needs to know WHY matching was abandoned, not the index list.
   */
  function describeWarning(w) {
    const sides = [w.left, w.right].filter(Boolean);
    let reasonKey = 'diff.warning.reason.invalid';
    if (sides.some((s) => s.duplicates && s.duplicates.length)) {
      reasonKey = 'diff.warning.reason.duplicate';
    } else if (sides.some((s) => s.missingIndices && s.missingIndices.length)) {
      reasonKey = 'diff.warning.reason.missing';
    }
    return tt('diff.warning.fallback', {
      path: w.path || '/',
      key: w.identityKey || '',
      reason: tt(reasonKey),
    });
  }

  function compare() {
    const engine = window.OrtbtoolsDiff;
    if (!engine) return { error: tt('diff.failed', { error: 'engine unavailable' }) };

    const aText = readSideA();
    if (!aText.trim()) return { error: tt('diff.a_empty') };
    if (!sideB.trim()) return { error: tt('diff.b_empty') };

    let a;
    let b;
    try {
      a = JSON.parse(aText);
    } catch (e) {
      return { error: tt('diff.invalid', { side: 'A', error: e.message || String(e) }) };
    }
    try {
      b = JSON.parse(sideB);
    } catch (e) {
      return { error: tt('diff.invalid', { side: 'B', error: e.message || String(e) }) };
    }

    try {
      return { result: engine.diffJson(a, b, { mode: mode }) };
    } catch (e) {
      // The engine rejects non-JSON-compatible input and over-deep nesting with
      // a typed error carrying a pointer — surface it rather than swallowing it.
      return { error: tt('diff.failed', { error: e.message || String(e) }) };
    }
  }

  // ── Rendering ────────────────────────────────────────────────────

  function rowHtml(change) {
    const sign = change.op === 'add' ? '+' : change.op === 'remove' ? '−' : '~';
    const cls =
      change.op === 'add' ? 'diff-add' : change.op === 'remove' ? 'diff-remove' : 'diff-change';
    // leftPath addresses the Inspector's own text, so only those rows can jump.
    const canJump = !!change.leftPath;
    const pathCell = canJump
      ? `<button type="button" class="diff-path diff-path-btn" data-action="diff-goto"` +
        ` data-pointer="${escapeHtml(change.leftPath)}"` +
        ` title="${escapeHtml(tt('diff.jump'))}">${escapeHtml(change.path)}</button>`
      : `<span class="diff-path" title="${escapeHtml(tt('diff.jump_unavailable'))}">${escapeHtml(
          change.path,
        )}</span>`;

    let values;
    if (change.op === 'add') {
      values = `<span class="diff-after">${escapeHtml(preview(change.after))}</span>`;
    } else if (change.op === 'remove') {
      values = `<span class="diff-before">${escapeHtml(preview(change.before))}</span>`;
    } else {
      values =
        `<span class="diff-before">${escapeHtml(preview(change.before))}</span>` +
        ` <span class="diff-arrow">→</span> ` +
        `<span class="diff-after">${escapeHtml(preview(change.after))}</span>`;
    }
    return `<tr class="${cls}"><td class="diff-sign">${sign}</td><td>${pathCell}</td><td class="diff-values">${values}</td></tr>`;
  }

  function groupHtml(titleKey, changes) {
    if (!changes.length) return '';
    return (
      `<div class="diff-group"><div class="mono-label">${escapeHtml(tt(titleKey))} · ${changes.length}</div>` +
      `<table class="diff-table"><tbody>${changes.map(rowHtml).join('')}</tbody></table></div>`
    );
  }

  function warningsHtml(warnings) {
    if (!warnings || !warnings.length) return '';
    return (
      `<div class="diff-warning" role="status">` +
      `<div class="mono-label">⚠ ${escapeHtml(tt('diff.warning.title'))}</div>` +
      warnings.map((w) => `<div>${escapeHtml(describeWarning(w))}</div>`).join('') +
      `</div>`
    );
  }

  function resultHtml(result) {
    const added = result.changes.filter((c) => c.op === 'add');
    const removed = result.changes.filter((c) => c.op === 'remove');
    const changed = result.changes.filter((c) => c.op === 'replace');
    const warned = result.warnings && result.warnings.length;

    if (result.equal) {
      // "Equal" plus warnings is a real state and must not read as a clean bill
      // of health — the arrays that could not be matched were compared by index.
      const msg = warned ? tt('diff.equal_with_warnings') : tt('diff.identical');
      return `<div class="diff-summary${warned ? ' diff-summary-warned' : ''}">${escapeHtml(msg)}</div>${warningsHtml(result.warnings)}`;
    }

    return (
      `<div class="diff-summary">${escapeHtml(
        tt('diff.summary', {
          added: added.length,
          removed: removed.length,
          changed: changed.length,
        }),
      )}</div>` +
      warningsHtml(result.warnings) +
      groupHtml('diff.group.changed', changed) +
      groupHtml('diff.group.added', added) +
      groupHtml('diff.group.removed', removed)
    );
  }

  function controlsHtml() {
    const radio = (name, value, current, labelKey) =>
      `<label class="diff-opt"><input type="radio" name="${name}" value="${value}"${
        value === current ? ' checked' : ''
      }> ${escapeHtml(tt(labelKey))}</label>`;

    return (
      `<div class="diff-controls">` +
      `<div class="diff-optgroup"><span class="mono-label">${escapeHtml(tt('diff.target'))}</span>` +
      radio('diffTarget', 'request', target, 'diff.target.request') +
      radio('diffTarget', 'response', target, 'diff.target.response') +
      `</div>` +
      `<div class="diff-optgroup"><span class="mono-label">${escapeHtml(tt('diff.mode'))}</span>` +
      radio('diffMode', 'semantic', mode, 'diff.mode.semantic') +
      radio('diffMode', 'raw', mode, 'diff.mode.raw') +
      `</div>` +
      `<button type="button" class="btn" id="diffRun">${escapeHtml(tt('diff.run'))}</button>` +
      `</div>` +
      `<div class="diff-hint mono-label">${escapeHtml(
        tt(mode === 'semantic' ? 'diff.mode.semantic_hint' : 'diff.mode.raw_hint'),
      )}</div>`
    );
  }

  function render(container, state) {
    const aText = readSideA();
    container.innerHTML =
      controlsHtml() +
      `<div class="diff-sides">` +
      `<div class="diff-side"><div class="mono-label">${escapeHtml(tt('diff.side_a'))} · ${aText.length}</div>` +
      `<textarea class="diff-pane" id="diffPaneA" readonly>${escapeHtml(aText)}</textarea></div>` +
      `<div class="diff-side"><div class="mono-label">${escapeHtml(tt('diff.side_b'))}</div>` +
      `<textarea class="diff-pane" id="diffPaneB" spellcheck="false" placeholder="${escapeHtml(
        tt('diff.side_b_placeholder'),
      )}">${escapeHtml(sideB)}</textarea></div>` +
      `</div>` +
      `<div class="diff-result" id="diffResult">${state}</div>`;
  }

  function renderInto(container) {
    if (!container) return;
    render(container, `<div class="empty-hint">${escapeHtml(tt('diff.empty'))}</div>`);
  }

  function runAndRender(container) {
    const outcome = compare();
    lastResult = outcome.result || null;
    const body = outcome.error
      ? `<div class="empty-hint">${escapeHtml(outcome.error)}</div>`
      : resultHtml(outcome.result);
    const slot = container.querySelector('#diffResult');
    if (slot) slot.innerHTML = body;
    else render(container, body);
  }

  // ── Jump to a position in the editor ─────────────────────────────

  /**
   * Move the caret in the Inspector pane to the value at `pointer`. Selection
   * only — the pane is never modified. Falls back silently when the source map
   * cannot resolve the pointer (which happens for a value inside a string that
   * the user has since edited).
   */
  function gotoPointer(pointer) {
    const mapper = window.OrtbtoolsSourceMap;
    const el = document.getElementById(paneIdFor(target));
    if (!mapper || !el) return false;
    const map = mapper.buildSourceMap(el.value || '');
    if (!map || !map.ok) return false;
    const entry = map.resolve(pointer);
    if (!entry) return false;

    const start = entry.keyStart != null ? entry.keyStart : entry.valueStart;
    el.focus();
    try {
      el.setSelectionRange(start, entry.valueEnd);
    } catch (_e) {
      return false;
    }
    // Bring the selection into view: textareas do not scroll to a programmatic
    // selection on their own.
    const ratio = start / Math.max(1, (el.value || '').length);
    el.scrollTop = Math.max(0, ratio * el.scrollHeight - el.clientHeight / 2);
    return true;
  }

  // ── Wiring ───────────────────────────────────────────────────────

  function mount() {
    const container = document.getElementById('diffContainer');
    if (!container) return;
    renderInto(container);

    container.addEventListener('input', (e) => {
      const el = /** @type {any} */ (e.target);
      if (el && el.id === 'diffPaneB') sideB = el.value;
    });

    container.addEventListener('change', (e) => {
      const el = /** @type {any} */ (e.target);
      if (!el || el.type !== 'radio') return;
      if (el.name === 'diffTarget') target = el.value;
      else if (el.name === 'diffMode') mode = el.value;
      else return;
      // Re-render so side A follows the target and the mode hint stays honest.
      renderInto(container);
    });

    container.addEventListener('click', (e) => {
      const btn = /** @type {any} */ (e.target).closest
        ? /** @type {any} */ (e.target).closest('[data-action="diff-goto"], #diffRun')
        : null;
      if (!btn) return;
      e.preventDefault();
      if (btn.id === 'diffRun') {
        runAndRender(container);
        if (typeof window.ortbtoolsTrackOnce === 'function') {
          window.ortbtoolsTrackOnce('diff_use');
        }
        return;
      }
      const pointer = btn.getAttribute('data-pointer');
      if (pointer != null) gotoPointer(pointer);
    });
  }

  window.OrtbtoolsDiffTab = {
    mount: mount,
    // Test surface: pure pieces, no DOM required.
    __test: {
      describeWarning: describeWarning,
      preview: preview,
      resultHtml: resultHtml,
      setSideB: function (v) {
        sideB = v;
      },
      setMode: function (v) {
        mode = v;
      },
      setTarget: function (v) {
        target = v;
      },
      compare: compare,
      lastResult: function () {
        return lastResult;
      },
    },
  };

  window.addEventListener('kt:inspector-ready', mount, { once: true });
})();
