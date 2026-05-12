/* ============================================================
   public/modules/intel/banner.js — Discovery UI chip.

   Phase 7a foundation. Subtle bottom-right chip that surfaces the
   field-pattern count from the local Discovery index. Non-blocking,
   dismissable for 24h.

   Per Phase 7 R&D: this is a "show, don't intrude" surface. No modal,
   no auto-popup, no analytics call on render. Just a yellow-accent
   chip that appears when the count crosses zero, and disappears (or
   stays dismissed) until the user looks again.

   Phase 7b will add a click-through to a Dialect Builder pane. For
   now, click-through is a no-op (button is `title`-tooltipped instead).
   ============================================================ */
(function () {
  'use strict';

  if (window.SpyglassIntelBanner) return;

  const DISMISS_KEY = 'spyglass_intel_banner_dismissed_until';
  const DISMISS_DURATION_MS = 24 * 3600 * 1000; // 24h

  let _root = null;
  let _stylesInjected = false;

  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = [
      '.spyglass-intel-chip{',
      '  position:fixed;bottom:20px;right:20px;',
      '  z-index:9000;',
      '  display:flex;align-items:center;gap:10px;',
      '  padding:10px 14px;',
      '  background:var(--surface, #fff);',
      '  color:var(--text, #1a1a1a);',
      '  border:1px solid var(--accent, #ffc83d);',
      '  border-radius:8px;',
      '  box-shadow:0 4px 14px rgba(0,0,0,0.12);',
      '  font:12px/1.4 var(--font-body, system-ui, -apple-system, sans-serif);',
      '  max-width:340px;',
      '  transition:opacity 200ms ease, transform 200ms ease;',
      '}',
      '.spyglass-intel-chip[hidden]{display:none}',
      '.spyglass-intel-chip__icon{',
      '  font-size:14px;line-height:1;',
      '  flex-shrink:0;',
      '}',
      '.spyglass-intel-chip__body{flex:1;min-width:0}',
      '.spyglass-intel-chip__title{',
      '  font-weight:600;',
      '  font-size:12px;',
      '  color:var(--text, #1a1a1a);',
      '  margin-bottom:2px;',
      '}',
      '.spyglass-intel-chip__sub{',
      '  font-size:11px;',
      '  color:var(--text-muted, #666);',
      '  font-family:var(--font-mono, ui-monospace, monospace);',
      '  letter-spacing:0.02em;',
      '}',
      '.spyglass-intel-chip__close{',
      '  background:transparent;border:none;cursor:pointer;',
      '  color:var(--text-dim, #999);',
      '  font-size:14px;line-height:1;',
      '  padding:2px 6px;border-radius:3px;',
      '}',
      '.spyglass-intel-chip__close:hover{',
      '  background:var(--bg-2, #f3f3f3);',
      '  color:var(--text, #1a1a1a);',
      '}',
      '@media (prefers-reduced-motion: reduce){',
      '  .spyglass-intel-chip{transition:none}',
      '}',
    ].join('');
    document.head.appendChild(style);
  }

  function ensureRoot() {
    if (_root && document.body.contains(_root)) return _root;
    injectStyles();
    _root = document.createElement('div');
    _root.className = 'spyglass-intel-chip';
    _root.id = 'spyglassIntelChip';
    _root.setAttribute('role', 'status');
    _root.setAttribute('aria-live', 'polite');
    _root.hidden = true;
    _root.innerHTML = [
      '<span class="spyglass-intel-chip__icon" aria-hidden="true">🧬</span>',
      '<div class="spyglass-intel-chip__body" data-intel-open style="cursor:pointer">',
      '  <div class="spyglass-intel-chip__title" data-intel-title></div>',
      '  <div class="spyglass-intel-chip__sub" data-intel-sub></div>',
      '</div>',
      '<button class="spyglass-intel-chip__close" aria-label="Dismiss" title="Dismiss for 24h" data-intel-close>×</button>',
    ].join('');
    document.body.appendChild(_root);
    _root.querySelector('[data-intel-close]').addEventListener('click', dismiss);
    // Phase 7b: clicking the body opens the Dialect Builder modal.
    // Stops propagation so it doesn't also trigger the dismiss button.
    _root.querySelector('[data-intel-open]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (window.SpyglassIntelBuilder && typeof window.SpyglassIntelBuilder.open === 'function') {
        window.SpyglassIntelBuilder.open();
      }
    });
    return _root;
  }

  function isDismissed() {
    try {
      const until = Number(localStorage.getItem(DISMISS_KEY) || '0');
      return until > Date.now();
    } catch (_e) {
      return false;
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DURATION_MS));
    } catch (_e) {
      /* private mode */
    }
    if (_root) _root.hidden = true;
  }

  /**
   * Refresh the chip from a summary `{ total, byBucket }`. Hides
   * automatically when total === 0 or user has dismissed.
   */
  function refresh(summary) {
    if (!summary || summary.total === 0) {
      if (_root) _root.hidden = true;
      return;
    }
    if (isDismissed()) return;
    const root = ensureRoot();
    const title = pickLocalised(summary);
    const sub = formatBucketBreakdown(summary.byBucket);
    root.querySelector('[data-intel-title]').textContent = title;
    root.querySelector('[data-intel-sub]').textContent = sub;
    root.hidden = false;
  }

  function pickLocalised(summary) {
    // Lookup central i18n bundle (single source of truth at /public/i18n.js
    // under `banner.new_patterns` with {n} param). Pre-2026-05-10 this was
    // an inline `if uk / if ru / else en` block; consolidated for parity
    // with builder.js. Hard-coded English fallback when window.t hasn't
    // loaded yet.
    const t =
      typeof window !== 'undefined' && typeof window.t === 'function'
        ? window.t
        : (k, p) => `${(p && p.n) || ''} new field patterns detected`;
    return t('banner.new_patterns', { n: summary.total });
  }

  function formatBucketBreakdown(byBucket) {
    if (!byBucket) return '';
    const parts = [];
    for (const k of ['push', 'display', 'inapp', 'unknown']) {
      if (byBucket[k]) parts.push(`${byBucket[k]} ${k}`);
    }
    return parts.join(' · ');
  }

  window.SpyglassIntelBanner = {
    refresh,
    dismiss,
  };
})();
