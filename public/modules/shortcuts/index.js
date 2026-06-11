/* ============================================================
   modules/shortcuts/index.js — ortbtools keyboard shortcuts + cheat-sheet modal.

   Bindings:
     ?              → open cheat-sheet (skipped while typing)
     Ctrl/Cmd+S     → save current sample to library (auth-gated by openSaveModal)
     Ctrl/Cmd+Enter → already wired via spyglass.app.js#handleKeydown
     Esc            → already wired via spyglass.app.js DOMContentLoaded handler

   Self-contained: injects its own <style> on first use. Reuses the existing
   `modalRoot` / `closeModal()` / `t()` primitives from spyglass.app.js +
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
    const rows = [
      ['?', tt('shortcuts.row.help')],
      ['Ctrl + Enter', tt('shortcuts.row.run')],
      ['Ctrl + S', tt('shortcuts.row.save')],
      ['M', tt('shortcuts.row.mirror')],
      ['Esc', tt('shortcuts.row.close')],
    ];
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
      e.preventDefault();
      if (typeof window.openSaveModal === 'function') {
        window.openSaveModal();
      }
    }
    // Bare `m` → open mirror modal. Skipped while typing (so users can
    // type "m" inside the JSON textarea without hijack) and while a
    // modal is open. No modifier — feels like a tool shortcut, not OS.
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isTypingTarget(e.target)) return;
      if (isModalOpen()) return;
      e.preventDefault();
      if (typeof window.openMirrorModal === 'function') {
        window.openMirrorModal();
      }
    }
  });

  // Exposed for the future case where another surface (e.g. a "?" button
  // in the format-pill bar) wants to open the cheat-sheet programmatically.
  window.openShortcutsModal = openCheatSheet;
})();
