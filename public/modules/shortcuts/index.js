/* ============================================================
   modules/shortcuts/index.js — ortbtools keyboard shortcuts + cheat-sheet modal.

   Bindings:
     ?              → open cheat-sheet (skipped while typing)
     Ctrl/Cmd+S     → save current sample to library (auth-gated by openSaveModal)
     Ctrl/Cmd+Enter → already wired via ortbtools.app.js#handleKeydown
     Ctrl/Cmd+K     → already wired via modules/search/index.js (listed by the
                      cheat-sheet, bound there — the sheet documents every key
                      the page answers, not only the ones this file installs)
     Esc            → already wired via ortbtools.app.js DOMContentLoaded handler

   Self-contained: injects its own <style> on first use. Reuses the existing
   `modalRoot` / `closeModal()` / `t()` primitives from ortbtools.app.js +
   i18n.js. Loads after both, so all globals are present.
   ============================================================ */
(function () {
  'use strict';

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function tt(key) {
    return typeof window.t === 'function' ? window.t(key) : '[' + key + ']';
  }

  let _styleInjected = false;
  function ensureStyle() {
    if (_styleInjected) return;
    _styleInjected = true;
    const css =
      '.shortcuts-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:var(--space-3)}' +
      '.shortcuts-table td{padding:8px 6px;border-bottom:1px solid var(--border);vertical-align:middle}' +
      '.shortcuts-table tr:last-child td{border-bottom:0}' +
      '.shortcuts-table td:first-child{white-space:nowrap;width:1%}' +
      '.shortcuts-table td:last-child{color:var(--text-dim)}' +
      '.shortcuts-table kbd{display:inline-block;font-family:var(--font-mono);font-size:11px;line-height:1;' +
      'padding:3px 6px;margin:0 2px;border:1px solid var(--border);border-bottom-width:2px;' +
      'border-radius:4px;background:var(--bg-2);color:var(--text);min-width:18px;text-align:center}';
    const style = document.createElement('style');
    style.setAttribute('data-shortcuts', '1');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderKeys(combo) {
    return combo
      .split('+')
      .map(function (part) {
        return '<kbd>' + escapeHtml(part.trim()) + '</kbd>';
      })
      .join(' + ');
  }

  function openCheatSheet() {
    const root = document.getElementById('modalRoot');
    if (!root) return;
    ensureStyle();
    // Run / Save / Mirror all act on the Inspector's editor: Ctrl+Enter is
    // bound in ortbtools.app.js#handleKeydown, the other two above. On a
    // section that has no editor they cannot fire, and listing them there
    // was the help screen telling the user about keys that do nothing —
    // which is how the dead M and Ctrl+S went unnoticed for so long.
    const editorRows = inspectorSurfaceReady()
      ? [
          ['Ctrl + Enter', tt('shortcuts.row.run')],
          ['Ctrl + S', tt('shortcuts.row.save')],
          ['M', tt('shortcuts.row.mirror')],
        ]
      : [];
    // Ctrl/⌘+K — the one binding that works on EVERY section, and the only
    // one the product advertises outside this sheet: the topbar prints a ⌘K
    // hint right inside the search field. It was missing here, so the help
    // screen listed three keys that need an editor and omitted the one that
    // never does. Gated the same way the editor rows are, on the control the
    // key acts on: /modules/search/ installs the global handler when it
    // mounts onto that input, so where there is no input there is no chord,
    // and the sheet must not promise one. Spelled "Ctrl" to match the rows
    // beside it — the handler accepts Ctrl and ⌘ alike, so it is true on
    // every platform.
    const searchRows = document.querySelector('.kt-topbar__search-input')
      ? [['Ctrl + K', tt('shortcuts.row.search')]]
      : [];
    const rows = [['?', tt('shortcuts.row.help')]]
      .concat(searchRows)
      .concat(editorRows)
      .concat([['Esc', tt('shortcuts.row.close')]]);
    const body = rows
      .map(function (r) {
        return '<tr><td>' + renderKeys(r[0]) + '</td><td>' + escapeHtml(r[1]) + '</td></tr>';
      })
      .join('');
    root.innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card" style="max-width:520px;width:92vw">' +
      '<div class="modal-title">' +
      escapeHtml(tt('shortcuts.title')) +
      '</div>' +
      '<table class="shortcuts-table">' +
      body +
      '</table>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()">' +
      escapeHtml(tt('btn.close')) +
      '</button>' +
      '</div></div></div>';
  }

  function isModalOpen() {
    const root = document.getElementById('modalRoot');
    return !!(root && root.children.length);
  }

  // ── Lazy actions ────────────────────────────────────────────────────────
  // Save and Mirror live in modules that are imported on FIRST CLICK of the
  // matching toolbar button (ortbtools.app.js, cases 'save-sample' /
  // 'mirror') — and that import is the only thing that installs
  // window.openSaveModal / window.openMirrorModal. This handler used to call
  // those globals "if they exist", so both shortcuts did nothing on a fresh
  // page and started working only after the user had performed the same
  // action with the mouse: the keyboard was available exactly when it was no
  // longer needed, while the cheat-sheet below promised it unconditionally.
  // Doing the import here — the same two module specifiers, so the browser's
  // module cache is shared with the toolbar path — is what makes the key
  // equal to the button.
  const LAZY_ACTIONS = {
    save: {
      global: 'openSaveModal',
      modules: ['/modules/save-sample/i18n.js', '/modules/save-sample/index.js'],
    },
    mirror: {
      global: 'openMirrorModal',
      modules: ['/modules/mirror/i18n.js', '/modules/mirror/index.js'],
    },
  };
  const _loading = Object.create(null);

  /** Both actions read the Inspector's request editor the instant they open
   *  (openSaveModal/openMirrorModal both do $('bidReq').value), so on a
   *  section that has no editor — /library, /docs, /blog — there is nothing
   *  for them to act on. The keys are then left to the browser rather than
   *  swallowed for a no-op, and the cheat-sheet stops listing them. */
  function inspectorSurfaceReady() {
    return !!document.getElementById('bidReq');
  }

  function runLazyAction(name) {
    const spec = LAZY_ACTIONS[name];
    if (!spec) return;
    if (typeof window[spec.global] === 'function') {
      window[spec.global]();
      return;
    }
    if (_loading[name]) return; // import already in flight — ignore the repeat
    _loading[name] = true;
    Promise.all(spec.modules.map((m) => import(m)))
      .then(function () {
        if (typeof window[spec.global] === 'function') window[spec.global]();
      })
      .catch(function (err) {
        console.error('[shortcuts] ' + name + ' module load failed:', err);
      })
      .then(function () {
        _loading[name] = false;
      });
  }

  document.addEventListener('keydown', function (e) {
    // `?` (Shift+/) opens cheat-sheet — only when not typing into a field
    // (otherwise pasting/editing JSON containing '?' would pop the modal).
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isTypingTarget(e.target)) return;
      if (isModalOpen()) return;
      e.preventDefault();
      openCheatSheet();
      return;
    }
    // Ctrl/Cmd+S → save to library. Override browser "save page" default.
    // openSaveModal() already auth-gates and validates non-empty panes.
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      // preventDefault ONLY when we are actually going to do something.
      // It used to run first, unconditionally: on a section with no editor
      // the browser's own "save page" was suppressed and nothing replaced
      // it. Pressing the shortcut looked like the app had frozen, and the
      // one thing the key is for was taken away without being offered.
      if (!inspectorSurfaceReady()) return;
      e.preventDefault();
      runLazyAction('save');
      return;
    }
    // Bare `m` → open mirror modal. Skipped while typing (so users can
    // type "m" inside the JSON textarea without hijack) and while a
    // modal is open. No modifier — feels like a tool shortcut, not OS.
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isTypingTarget(e.target)) return;
      if (isModalOpen()) return;
      // Same order as Ctrl+S above: decide FIRST, swallow the key second.
      // preventDefault used to run before the availability check, so on a
      // section without an editor the key was eaten for nothing.
      if (!inspectorSurfaceReady()) return;
      e.preventDefault();
      runLazyAction('mirror');
    }
  });

  // Exposed for the future case where another surface (e.g. a "?" button
  // in the format-pill bar) wants to open the cheat-sheet programmatically.
  window.openShortcutsModal = openCheatSheet;
})();
