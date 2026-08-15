/* ============================================================
   modules/shortcuts/index.js — ortbtools keyboard shortcuts + cheat-sheet modal.

   Bindings:
     ?               → open cheat-sheet (skipped while typing)
     Ctrl/Cmd+1…5    → jump to a section (Inspector, Streams, Samples,
                       Dialects, Insights — the mockup manual's contract)
     Ctrl/Cmd+Enter  → run analysis. The textareas bind their own copy via
                       ortbtools.app.js#handleKeydown; this module adds the
                       document-level fallback so the combo works when focus
                       is on a button, a select or the page body.
     Ctrl/Cmd+S      → save current sample to library (auth-gated by openSaveModal)
     Ctrl/Cmd+K      → command palette (owned by modules/search/index.js)
     Esc             → close menus/modals (ortbtools.app.js popover handler)

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

  // Cheat-sheet rows and the palette chip must show the visitor's actual
  // modifier — ⌘ on Apple keyboards, Ctrl everywhere else.
  const IS_MAC = /Mac|iP(hone|ad|od)/.test(
    (typeof navigator === 'undefined'
      ? ''
      : (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform) || '',
  );
  const MOD = IS_MAC ? '⌘' : 'Ctrl';

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
      [MOD + ' + K', tt('shortcuts.row.palette')],
      [MOD + ' + 1…5', tt('shortcuts.row.sections')],
      [MOD + ' + Enter', tt('shortcuts.row.run')],
      [MOD + ' + S', tt('shortcuts.row.save')],
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

  // ⌘1…⌘5 / Ctrl+1…5 → section jump. Routes and order come from the nav
  // catalog (QUICK_JUMPS in modules/nav/index.js) via dynamic import — this
  // file is a classic script, and the nav module is already instantiated by
  // shell boot, so the import resolves from cache.
  function jumpToSection(idx) {
    import('/modules/nav/index.js')
      .then(function (nav) {
        const section = nav.SECTIONS.find(function (s) {
          return s.id === nav.QUICK_JUMPS[idx];
        });
        if (!section) return;
        // Already on that section → don't push a duplicate history entry.
        if (nav.canonicalize(location.pathname) === section.route) return;
        const target = nav.prefixLocale(section.route);
        if (window.OrtbtoolsShell && typeof window.OrtbtoolsShell.navigateTo === 'function') {
          window.OrtbtoolsShell.navigateTo(target);
        } else {
          window.location.assign(target);
        }
      })
      .catch(function () {
        /* nav module unavailable (non-shell page) — the combo stays inert */
      });
  }

  // Which quick-jump digit (1…5) a keydown addresses, or 0 if none.
  // e.code covers layouts where the digit row is shifted (AZERTY sends
  // e.key='&' for the physical 1); e.key covers remapped/virtual keyboards.
  function quickJumpDigit(e) {
    if (/^(Digit|Numpad)[1-5]$/.test(e.code || '')) return Number((e.code || '').slice(-1));
    if (e.key >= '1' && e.key <= '5' && e.key.length === 1) return Number(e.key);
    return 0;
  }

  document.addEventListener('keydown', function (e) {
    // Ctrl/Cmd+1…5 → quick section jumps. Modifier chords are safe even
    // while typing; !altKey keeps AltGr (Ctrl+Alt) layouts able to type
    // digits, and an open modal means the user is mid-flow — don't yank
    // the page out from under it.
    const digit = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey ? quickJumpDigit(e) : 0;
    if (digit) {
      if (isModalOpen()) return;
      e.preventDefault();
      jumpToSection(digit - 1);
      return;
    }
    // Ctrl/Cmd+Enter → run analysis from anywhere on the Inspector. When
    // focus sits in a payload textarea, ortbtools.app.js#handleKeydown has
    // already run (target phase) and preventDefault()ed — skip the rerun.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (e.defaultPrevented) return;
      if (isModalOpen()) return;
      if (!document.getElementById('bidReq')) return; // Inspector not mounted
      if (typeof window.runAnalysis === 'function') {
        e.preventDefault();
        window.runAnalysis();
      }
      return;
    }
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
