/* ============================================================
   public/modules/intel/banner.js — Discovery UI chip.

   Phase 7a foundation. Subtle bottom-right chip that surfaces the
   field-pattern count from the local Discovery index. Non-blocking,
   dismissable for 24h.

   Per Phase 7 R&D: this is a "show, don't intrude" surface. No modal,
   no auto-popup, no analytics call on render. Just a yellow-accent
   chip that appears when the count crosses zero, and disappears (or
   stays dismissed) until the user looks again.

   The primary control opens the Dialect Builder; the secondary control
   dismisses the signal for 24 hours.
   ============================================================ */
(function () {
  'use strict';

  if (window.OrtbtoolsIntelBanner) return;

  const DISMISS_KEY = 'ortbtools_intel_banner_dismissed_until';
  const DISMISS_DURATION_MS = 24 * 3600 * 1000; // 24h

  let _root = null;
  let _stylesInjected = false;

  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = [
      '.ortbtools-intel-chip{',
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
      '.ortbtools-intel-chip[hidden]{display:none}',
      '.ortbtools-intel-chip__icon{',
      '  font-size:14px;line-height:1;',
      '  flex-shrink:0;',
      '}',
      '.ortbtools-intel-chip__body{',
      '  flex:1;min-width:0;',
      '  appearance:none;border:0;background:transparent;padding:2px;',
      '  color:inherit;font:inherit;text-align:left;cursor:pointer;',
      '  border-radius:6px;',
      '}',
      '.ortbtools-intel-chip__title{',
      '  display:block;',
      '  font-weight:600;',
      '  font-size:12px;',
      '  color:var(--text, #1a1a1a);',
      '  margin-bottom:2px;',
      '}',
      '.ortbtools-intel-chip__sub{',
      '  display:block;',
      '  font-size:11px;',
      '  color:var(--text-muted, #666);',
      '  font-family:var(--font-mono, ui-monospace, monospace);',
      '  letter-spacing:0.02em;',
      '}',
      '.ortbtools-intel-chip__close{',
      '  background:transparent;border:none;cursor:pointer;',
      '  color:var(--text-dim, #999);',
      '  display:grid;place-items:center;',
      '  width:32px;height:32px;padding:0;',
      '  font-size:16px;line-height:1;',
      '  border-radius:6px;',
      '}',
      '.ortbtools-intel-chip__body:focus-visible,',
      '.ortbtools-intel-chip__close:focus-visible{',
      '  outline:2px solid var(--focus, #0284c7);outline-offset:2px;',
      '}',
      '.ortbtools-intel-chip__close:hover{',
      '  background:var(--bg-2, #f3f3f3);',
      '  color:var(--text, #1a1a1a);',
      '}',
      '.ortbtools-intel-chip__announcement{',
      '  position:absolute;width:1px;height:1px;padding:0;margin:-1px;',
      '  overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;',
      '}',
      '@media (prefers-reduced-motion: reduce){',
      '  .ortbtools-intel-chip{transition:none}',
      '}',
    ].join('');
    document.head.appendChild(style);
  }

  function ensureRoot() {
    if (_root && document.body.contains(_root)) return _root;
    injectStyles();
    _root = document.createElement('div');
    _root.className = 'ortbtools-intel-chip';
    _root.id = 'ortbtoolsIntelChip';
    _root.hidden = true;
    _root.innerHTML = [
      '<span class="ortbtools-intel-chip__announcement" role="status" aria-live="polite" data-intel-announcement></span>',
      '<span class="ortbtools-intel-chip__icon" aria-hidden="true">🧬</span>',
      '<button type="button" class="ortbtools-intel-chip__body" data-intel-open>',
      '  <span class="ortbtools-intel-chip__title" data-intel-title></span>',
      '  <span class="ortbtools-intel-chip__sub" data-intel-sub></span>',
      '</button>',
      '<button type="button" class="ortbtools-intel-chip__close" aria-label="Dismiss" title="Dismiss for 24h" data-intel-close>×</button>',
    ].join('');
    document.body.appendChild(_root);
    _root.querySelector('[data-intel-close]').addEventListener('click', dismiss);
    // Phase 7b: clicking the body opens the Dialect Builder modal.
    // Stops propagation so it doesn't also trigger the dismiss button.
    _root.querySelector('[data-intel-open]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (window.OrtbtoolsIntelBuilder && typeof window.OrtbtoolsIntelBuilder.open === 'function') {
        window.OrtbtoolsIntelBuilder.open();
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
    root.querySelector('[data-intel-announcement]').textContent = [title, sub]
      .filter(Boolean)
      .join('. ');
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

  window.OrtbtoolsIntelBanner = {
    refresh,
    dismiss,
  };
})();
