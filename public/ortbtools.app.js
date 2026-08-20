/* ============================================================
   ortbtools v8 — OpenRTB inspector (IAB 2.5 / 2.6 / 3.0).
   - Inspector: parses BidRequest, shows imp slots, types, floors
   - Validation: structural checks + version detection + crosscheck
   - Diff: deep diff between request and response
   - Vendor reference tab: pasteable templates + macros + field map
     (hidden by default; revealed only with ?dialect=<vendor>)

   Phase C-1 (2026-05-06): the IIFE was converted into the exported
   `mountInspector(root, ctx)` function so /modules/inspector/index.js
   can wrap it under the registry contract. Globals previously
   exposed for inline onclick handlers + cross-script cooperation
   (share.js, shortcuts.js, export.js, embed.js) are still attached
   on window during mount, but a single ctx.addCleanup at the bottom
   sweeps them on unmount — no leaks past deactivate().

   The kt:lang-change subscriber (added 2026-05-05) now goes through
   ctx.on() so its unsubscribe is registered with the cleanup queue.
   The 2 boundary listeners (error / unhandledrejection) use
   ctx.signal so they detach with the rest.
   ============================================================ */
import {
  $,
  escapeHtml,
  toast,
  setTabBadge,
  severityFromFindings,
  severityFromCrosschecks,
} from '/core/utils.js';
// ROADMAP #18: session/DEK/auth-api are now a shell-level service
// (public/core/session.js), created once at shell boot and surviving every
// section mount/unmount. mountInspector no longer owns any of that state —
// it registers an ADAPTER (below) for the Inspector-only bits (sample/dirty/
// partner state + renderers) that the shell service delegates to when
// Inspector happens to be mounted.
import { session } from '/core/session.js';
import {
  parseRequestInput,
  renderInputBadge,
  serializeRequestInput,
} from '/modules/inspector/request-input.js';

export async function mountInspector(root, ctx) {
  'use strict';

  // Utilities ($/escapeHtml/toast) and tab-badge helpers (setTabBadge,
  // severityFromFindings, severityFromCrosschecks) imported above from
  // /core/utils.js. Behaviour identical to the previous inline copies
  // — this file no longer redefines them.

  // ── ROADMAP #18: register this mount as the session service's Inspector
  // adapter ──────────────────────────────────────────────────────────────
  // Session/DEK/auth-api live in the shell (/core/session.js) independent of
  // any section; the handful of things that are genuinely Inspector-only
  // (sample/dirty/partner state + their DOM renderers) are exposed here so
  // window.OrtbtoolsSession's facade methods have somewhere to delegate WHILE
  // this mount is alive. registerAdapter returns a generation token;
  // unregisterAdapter only clears the slot if the token still matches
  // (guards against a stale/aborted mount racing a fresh one and wiping the
  // NEW mount's adapter — see also ctx.addCleanup below). The functions named
  // here (refreshPartners, refreshSamples, renderAuthWidget, renderVerifyBanner,
  // partnerOptionsHtml) are hoisted declarations defined later in this same
  // scope — safe to close over now since nothing can INVOKE them before the
  // rest of this synchronous mount() body (incl. the `let` state below) runs.
  const _adapterToken = session.registerAdapter({
    getCurrentSampleId: () => _currentSampleId,
    setCurrentSampleId: (v) => {
      _currentSampleId = v;
    },
    getCurrentSampleMeta: () => _currentSampleMeta,
    setCurrentSampleMeta: (v) => {
      _currentSampleMeta = v;
    },
    getIsDirty: () => _isDirty,
    setDirty: (v) => {
      _isDirty = !!v;
    },
    getPartnerCache: () => _partnerCache,
    setPartnerCache: (v) => {
      _partnerCache = v;
    },
    refreshPartners: () => refreshPartners(),
    refreshSamples: () => refreshSamples(),
    renderAuthWidget: () => renderAuthWidget(),
    renderVerifyBanner: () => renderVerifyBanner(),
    partnerOptionsHtml: (sel) => partnerOptionsHtml(sel),
    // Called by session.clearSession() (logout) — bundles the Inspector-side
    // reset + repaint so signOut's behaviour is identical to before the hoist.
    clearInspectorState: () => {
      _partnerCache = [];
      _currentSampleId = null;
      _currentSampleMeta = null;
      _isDirty = false;
      renderAuthWidget();
      refreshSamples();
    },
  });
  ctx.addCleanup(() => session.unregisterAdapter(_adapterToken));

  // ── Macro Evaluator: mount-scoped state reset ───────────────────
  // Overrides entered during a previous Inspector mount must not leak
  // into a new mount (e.g. Inspector → Live → Inspector).
  if (window.OrtbtoolsMacros && typeof window.OrtbtoolsMacros.resetState === 'function') {
    window.OrtbtoolsMacros.resetState();
  }
  ctx.addCleanup(() => {
    if (window.OrtbtoolsMacros && typeof window.OrtbtoolsMacros.resetState === 'function') {
      window.OrtbtoolsMacros.resetState();
    }
  });

  // ── Global error boundary ──────────────────────────────────────
  // One bug in a handler shouldn't kill the page. Catch synchronous errors
  // and unhandled promise rejections, log them, and surface a toast so the
  // user sees that something went wrong (instead of a silent dead button).
  // Both listeners use ctx.signal so they auto-detach on unmount; otherwise
  // they would survive deactivate() and double-fire if the module re-mounts.
  window.addEventListener(
    'error',
    (e) => {
      // Resource-load errors (img/script 404) come through here too — skip.
      if (!e.error) return;
      console.error('[ortbtools:error]', e.error);
      toast(t('toast.internal_ui_error', { error: e.error.message || 'unknown' }), 'error');
    },
    { signal: ctx.signal },
  );
  // Stage-1: wire the exact finding→source navigator. Markup (#bidReq/#bidRes)
  // is already injected by /modules/inspector/index.js before this mount runs.
  // Idempotent per mount; teardown on unmount via ctx.signal.
  if (window.OrtbtoolsSourceNav) {
    try {
      window.OrtbtoolsSourceNav.init({});
      ctx.signal.addEventListener('abort', () => {
        try {
          window.OrtbtoolsSourceNav.teardown();
        } catch (_e) {
          /* */
        }
      });
    } catch (_e) {
      /* navigator is optional; never block the mount */
    }
  }

  window.addEventListener(
    'unhandledrejection',
    (e) => {
      console.error('[ortbtools:unhandledrejection]', e.reason);
      const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
      toast(t('toast.uncaught_error', { error: msg }), 'error');
    },
    { signal: ctx.signal },
  );

  // Action-button feedback: temporarily swap a button's label to a
  // localized status (e.g. "скопійовано") for 1.5s after a successful
  // action, then restore. The previous UX gave no in-button confirmation
  // for clear/format and only a small corner toast for copy — easy to
  // miss when the cursor sits on the button itself.
  //
  // Re-clicks debounce: a pending restore is cancelled and the new
  // status takes over. Without this, a fast double-click would race the
  // first restore against the second flash and leave a stale label.
  // WeakMap keyed by the button element so multiple buttons flash
  // independently; map entries auto-collect when buttons leave the DOM.
  const _flashTimers = new WeakMap();
  /**
   * Briefly replace a button's contents with "copied" / "cleared" / etc.
   *
   * Saves and restores innerHTML, not textContent. All three buttons this is
   * called on are icon buttons whose content is an <svg>, and an element's
   * textContent for an SVG child is the empty string — so the old version
   * read back "", overwrote the icon with a word, and 1500ms later restored
   * that empty string. One press of Clear left a blank 28×28 square where
   * the ✕ had been, for the rest of the session.
   */
  function flashButtonStatus(btn, key) {
    if (!btn) return;
    const prev = _flashTimers.get(btn);
    if (prev) {
      clearTimeout(prev.timeout);
      btn.innerHTML = prev.original;
    }
    const original = btn.innerHTML;
    btn.textContent = t(key);
    btn.classList.add('btn-icon--ok');
    const timeout = setTimeout(function () {
      btn.innerHTML = original;
      btn.classList.remove('btn-icon--ok');
      _flashTimers.delete(btn);
    }, 1500);
    _flashTimers.set(btn, { timeout, original });
  }

  // Expose toast on window so non-module IIFE scripts (share/index.js,
  // embed/index.js, export.js) can call it for user feedback.
  window.toast = toast;

  // The URL the operator pasted and the URL that was analysed are not always
  // the same string: the decoder repairs transport artifacts (a trailing ")"
  // off a chat paste, an HTML-escaped &amp;, a missing scheme) before parsing.
  // Set from `validation.urlRequest.repairs` after every analyse, cleared when
  // an analyse produced no repairs. Read by copy() below and by the Validation
  // panel — see urlRepairsHtml().
  let _lastUrlRepair = null;

  window.utils = {
    format(id, btn) {
      try {
        const el = $(id);
        el.value = JSON.stringify(JSON.parse(el.value), null, 2);
        updateCharCount(id);
        updateJsonBadge(id);
        flashButtonStatus(btn, 'button.status.formatted');
      } catch (e) {
        toast(t('toast.invalid_json', { error: e.message }), 'error');
      }
    },
    copy(id, btn) {
      const el = $(id);
      if (!el.value) {
        toast(t('toast.empty_field_copy'), 'error');
        return;
      }
      // Pre-fix this read `el.value` unconditionally — the raw textarea. When
      // the pane held a URL that only parsed after repair, Copy handed the
      // operator back the broken string they pasted, so the fix never left the
      // tool. Hand back the URL that was actually analysed instead, and say so;
      // the pane itself is left exactly as they typed it. Gated on the text
      // still being the one that was repaired, so an edit since the analyse
      // falls back to the literal value.
      const pasted = el.value;
      const canonical =
        id === 'bidReq' &&
        _lastUrlRepair &&
        (pasted === _lastUrlRepair.original || pasted.trim() === _lastUrlRepair.original)
          ? _lastUrlRepair.repaired
          : null;
      navigator.clipboard
        .writeText(canonical || pasted)
        .then(() => {
          flashButtonStatus(btn, 'button.status.copied');
          if (canonical) toast(t('toast.copied_repaired_url'), 'info');
        })
        .catch(() => toast(t('toast.copy_failed'), 'error'));
    },
  };

  window.switchTab = function (btn, targetId) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    $(targetId).classList.add('active');
    // Tabs that live behind the strip's "more ▾" menu switch and then leave
    // the menu open over the content they just revealed — close it. The
    // summary itself gets no active class; CSS marks it via :has().
    const more = btn.closest('details.tab-more');
    if (more) more.open = false;
  };

  window.clearInput = function (id, btn) {
    $(id).value = '';
    updateCharCount(id);
    // Clear → drop the loaded-sample anchor so the next save starts fresh.
    _currentSampleId = null;
    _currentSampleMeta = null;
    _isDirty = false;
    clearMacros();
    // Assigning .value fires no `input` event (per the HTML spec), and the
    // gutter is only rebuilt on that event — so it kept numbering the lines
    // of the payload we just deleted: 31 line numbers beside an empty
    // editor. renderGutter draws nothing for empty text; it just has to be
    // told to run.
    renderGutter(id);
    // …and the result computed from what was just deleted. Clearing only the
    // editor left the verdict, the quality score and the impression list on
    // screen, describing bytes that no longer existed anywhere.
    clearResultsForEmpty();
    flashButtonStatus(btn, 'button.status.cleared');
  };

  window.handleKeydown = function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runAnalysis();
    }
  };

  // Active UI locale. Read once at module load + listen for toggle event.
  // Used to pass ?locale=… to /api/analyze so the server resolves finding
  // messages in the user's chosen language.
  function activeLocale() {
    // Source-of-truth: <html lang> (kept in sync by the seamless lang
    // switch). Falls back to localStorage, then 'uk'. RU was previously
    // collapsed to UK here, which made /api/analyze return Ukrainian
    // findings even on the /ru/ surface.
    try {
      const fromHtml = document.documentElement.getAttribute('lang');
      if (fromHtml === 'uk' || fromHtml === 'en' || fromHtml === 'ru') return fromHtml;
      const v = localStorage.getItem('kt-lang');
      if (v === 'uk' || v === 'en' || v === 'ru') return v;
      return 'uk';
    } catch (_e) {
      return 'uk';
    }
  }
  /**
   * Pick the plural form for `n` in the active locale.
   *
   * Ukrainian and Russian have three: 1 / 2-4 / 5+. Every count in this file
   * used to interpolate a single stored plural, so any figure of five or
   * more read as broken grammar in two of the three product locales —
   * "5 критичні помилки" where the language wants "5 критичних помилок".
   * It was invisible while counts lived inside a small pill and became
   * obvious the moment the verdict put them in a sentence.
   *
   * English collapses `few` and `many` onto the same string, so callers can
   * pass all three keys unconditionally.
   *
   * @param {number} n
   * @param {string} one   key for 1
   * @param {string} few   key for 2-4 (and English plural)
   * @param {string} many  key for 5+
   */
  function pluralKey(n, one, few, many) {
    if (activeLocale() === 'en') return n === 1 ? one : few;
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  /** `n` followed by the correctly-inflected noun. */
  function counted(n, one, few, many) {
    return n + ' ' + t(pluralKey(n, one, few, many));
  }

  function analyzeUrl() {
    // Absolute path — relative would resolve against pathname (e.g. /uk/),
    // breaking API access from non-root locales. serverSideDialect()
    // collapses temp dialects to their IAB parent so the server runs the
    // canonical ruleset; the temp-dialect findings are merged client-side
    // by OrtbtoolsIntel.applyToFindings() after the response lands.
    return (
      '/api/analyze?locale=' +
      encodeURIComponent(activeLocale()) +
      '&dialect=' +
      encodeURIComponent(serverSideDialect())
    );
  }

  // ── Dialect state ─────────────────────────────────────────────
  // The validation engine accepts ?dialect=<name> to layer vendor-specific
  // rules (ext-rtb, inpage-push) over the IAB baseline. The
  // active dialect needs to survive page reloads (so users on a vendor
  // workflow don't reset every session) and be shareable via URL (so a
  // bug report can carry the dialect context). Resolution priority:
  //   1. ?dialect=… in the URL — highest, lets shared links override the
  //      user's saved choice without permanent persistence
  //   2. localStorage — survives reloads
  //   3. 'iab' — safe default
  const DIALECT_STORAGE_KEY = 'ortbtools_dialect_v1';
  const KNOWN_DIALECTS = new Set(['iab', 'ext-rtb', 'inpage-push']);

  function isTempDialect(value) {
    return typeof value === 'string' && value.startsWith('temp:');
  }

  function activeDialect() {
    try {
      const qp = new URLSearchParams(location.search);
      const fromUrl = qp.get('dialect');
      if (fromUrl && (KNOWN_DIALECTS.has(fromUrl) || isTempDialect(fromUrl))) return fromUrl;
      const fromStorage = localStorage.getItem(DIALECT_STORAGE_KEY);
      if (fromStorage && (KNOWN_DIALECTS.has(fromStorage) || isTempDialect(fromStorage))) {
        return fromStorage;
      }
    } catch (_e) {
      /* private mode / SSR */
    }
    return 'iab';
  }

  // Phase 7b: when a temp dialect is active, the server doesn't know
  // about it (server validate() only sees IAB+vendor variants). Send the
  // parent dialect server-side; the temp-dialect overlay is applied
  // client-side after analyze().
  function serverSideDialect() {
    const d = activeDialect();
    return isTempDialect(d) ? 'iab' : d;
  }

  // P2 #26 — footer dialect label is state-style ("Dialect: <name>")
  // instead of feature-badge ("🧬 custom dialect"). Paint the value
  // from the canonical activeDialect getter so it stays in sync with
  // the format-bar's dialect picker, URL ?dialect, and localStorage.
  //
  // No "▾" here any more. The chip does not open a list of dialects — it
  // opens the temporary-dialect BUILDER — and a chevron next to the word
  // "Dialect:" promised a switch that clicking it never delivered. The
  // switch is the <select> in the work bar, which is now on screen from the
  // first paint (see setWorkbarReadoutsVisible); this chip only reports
  // which dialect that switch currently sits on.
  function paintFooterDialect(explicit) {
    const valueEl = document.querySelector('.footer-dialect-value');
    if (!valueEl) return;
    // Callers that just changed the dialect pass it in; everyone else (mount,
    // the intel-dialect-changed listener) reads the canonical state.
    const d =
      typeof explicit === 'string' && (KNOWN_DIALECTS.has(explicit) || isTempDialect(explicit))
        ? explicit
        : activeDialect();
    let label;
    if (d === 'iab') label = 'IAB';
    else if (d === 'ext-rtb') label = 'Vendor · RTB';
    else if (d === 'inpage-push') label = 'Vendor · In-Page Push';
    else if (isTempDialect(d)) label = 'custom';
    else label = d;
    valueEl.textContent = label;
  }
  window.paintFooterDialect = paintFooterDialect;

  // Input-section drag-resize. Reads height from localStorage and
  // paints --input-section-height on documentElement. Mousedown on
  // the handle starts a drag; mousemove updates the var while
  // body[data-resizing="input-section"] keeps pointer-events off
  // the textareas (otherwise the textarea steals the mousemove and
  // the drag stutters). Mouseup persists + clears the data attr.
  // Double-click resets to the 280px default.
  const RESIZE_STORAGE_KEY = 'kt-input-section-height';
  const RESIZE_DEFAULT_PX = 280;
  const RESIZE_MIN_PX = 180;
  function clampResize(px) {
    const max = Math.round(window.innerHeight * 0.65);
    if (px < RESIZE_MIN_PX) return RESIZE_MIN_PX;
    if (px > max) return max;
    return px;
  }
  function applyInputSectionHeight(px) {
    document.documentElement.style.setProperty('--input-section-height', px + 'px');
  }
  function initInputSectionResize() {
    const handle = document.querySelector('[data-action="input-section-resize"]');
    const section = document.querySelector('.input-section');
    if (!handle || !section) return;
    // Restore persisted height (if any).
    try {
      const saved = parseInt(localStorage.getItem(RESIZE_STORAGE_KEY) || '', 10);
      if (Number.isFinite(saved) && saved > 0) applyInputSectionHeight(clampResize(saved));
    } catch (_e) {
      /* private mode — best effort */
    }
    let dragging = false;
    let startY = 0;
    let startH = 0;
    function onMove(ev) {
      if (!dragging) return;
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const next = clampResize(startH + (y - startY));
      applyInputSectionHeight(next);
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.body.removeAttribute('data-resizing');
      // Persist the actual rendered height (post-clamp) so reloads land
      // on the same layout the user saw.
      const cur = section.getBoundingClientRect().height;
      try {
        localStorage.setItem(RESIZE_STORAGE_KEY, String(Math.round(cur)));
      } catch (_e) {
        /* best effort */
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    }
    function onDown(ev) {
      dragging = true;
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      startY = y;
      startH = section.getBoundingClientRect().height;
      document.body.setAttribute('data-resizing', 'input-section');
      // {signal: ctx.signal} so an unmount MID-DRAG (mouse still down) detaches
      // these window-level move/up listeners with the rest of the module — otherwise
      // onUp (which normally removes them) never fires and they leak past
      // deactivate(), holding this mount's onMove/onUp closures. onUp still removes
      // them on a normal drag-end; both paths are clean.
      window.addEventListener('mousemove', onMove, { signal: ctx.signal });
      window.addEventListener('mouseup', onUp, { signal: ctx.signal });
      window.addEventListener('touchmove', onMove, { passive: false, signal: ctx.signal });
      window.addEventListener('touchend', onUp, { signal: ctx.signal });
      ev.preventDefault();
    }
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
    // Double-click resets to default.
    handle.addEventListener('dblclick', () => {
      applyInputSectionHeight(RESIZE_DEFAULT_PX);
      try {
        localStorage.removeItem(RESIZE_STORAGE_KEY);
      } catch (_e) {
        /* best effort */
      }
    });
    // Keyboard accessibility — focus the handle, use Up/Down (or
    // PageUp/PageDown for big steps) to nudge. Reset on Home.
    handle.addEventListener('keydown', (ev) => {
      const cur = section.getBoundingClientRect().height;
      const step =
        ev.key === 'PageUp' || ev.key === 'PageDown' ? 40 : ev.key === 'Home' ? null : 10;
      if (ev.key === 'ArrowDown' || ev.key === 'PageDown') {
        applyInputSectionHeight(clampResize(cur + step));
        ev.preventDefault();
      } else if (ev.key === 'ArrowUp' || ev.key === 'PageUp') {
        applyInputSectionHeight(clampResize(cur - step));
        ev.preventDefault();
      } else if (ev.key === 'Home') {
        applyInputSectionHeight(RESIZE_DEFAULT_PX);
        try {
          localStorage.removeItem(RESIZE_STORAGE_KEY);
        } catch (_e) {
          /* best effort */
        }
        ev.preventDefault();
      }
    });
  }

  function setActiveDialect(dialect) {
    if (!KNOWN_DIALECTS.has(dialect) && !isTempDialect(dialect)) return;
    try {
      localStorage.setItem(DIALECT_STORAGE_KEY, dialect);
    } catch (_e) {
      /* storage quota / private mode — best effort, the URL reflects state */
    }
    // Keep the URL in sync for the current tab so a refresh and a
    // shared-link copy both surface the active dialect, but ONLY for
    // dialects that mean something to a recipient. Phase 9b tightens
    // this to two rules:
    //   - 'iab' is the default — drop ?dialect= entirely so the URL is
    //     clean for the most common case.
    //   - Temp dialects (`temp:<uuid>`) live only in the author's
    //     IndexedDB; sharing the link surfaces the UUID to a recipient
    //     who has no record of it, so we strip them too. The recipient
    //     would have fallen back to the parent dialect anyway, but the
    //     bare UUID looked alarming. Author's own tab still keeps the
    //     temp dialect active via localStorage, so this is purely a
    //     URL-display fix.
    //   - Everything else (ext-rtb, inpage-push, future named
    //     dialects) is shareable — we write it.
    //
    // This has to happen BEFORE anything repaints. activeDialect() reads the
    // URL first and localStorage second, so while a stale ?dialect= is still
    // in the address bar, every reader of the state — the footer chip here,
    // and paintFooterDialect() again from the intel-dialect-changed listener
    // — resolves to the dialect the user just left. Switching away from
    // ext-rtb or inpage-push left the footer stating the OLD dialect until
    // some unrelated repaint came along.
    try {
      const url = new URL(location.href);
      if (dialect === 'iab' || isTempDialect(dialect)) {
        url.searchParams.delete('dialect');
      } else {
        url.searchParams.set('dialect', dialect);
      }
      history.replaceState({}, '', url.toString());
    } catch (_e) {
      /* */
    }
    // Belt and braces: paint from the value we were just handed, so the label
    // is right even if replaceState above threw (sandboxed iframe, exotic
    // history state) and the URL still says otherwise.
    paintFooterDialect(dialect);
    // Notify the intel module so its activeSpec cache invalidates and
    // applyToFindings reaches for the right spec on the next analyze.
    if (
      isTempDialect(dialect) &&
      window.OrtbtoolsIntel &&
      typeof window.OrtbtoolsIntel.activate === 'function'
    ) {
      window.OrtbtoolsIntel.activate(dialect);
    } else if (
      !isTempDialect(dialect) &&
      window.OrtbtoolsIntel &&
      typeof window.OrtbtoolsIntel.activate === 'function'
    ) {
      window.OrtbtoolsIntel.activate(null);
    }
  }

  // When the toggle changes (kt:lang-change fired by lang-switch.js),
  // patch the bits the morph deliberately skips:
  //   - <textarea>/<input> placeholders (LANG_SKIP_TAGS)
  //   - empty-state text inside preserved tab panes (LANG_PRESERVE)
  // Then re-render history + samples and re-run analysis if payload exists,
  // so all dynamic chrome lands in the new locale immediately.
  //
  // Subscribed via on() from /core/events.js — same window event under the
  // hood, just signals that this is part of the modular core contract.
  ctx.addCleanup(
    ctx.on('kt:lang-change', function (e) {
      const detail = e && e.detail;
      const doc = detail && detail.doc;

      // 1) Refresh placeholders. Lang-switch skips TEXTAREA/INPUT by tag.
      if (doc) {
        ['bidReq', 'bidRes', 'simPrice'].forEach(function (id) {
          const cur = document.getElementById(id);
          const fresh = doc.getElementById(id);
          if (!cur || !fresh) return;
          const ph = fresh.getAttribute('placeholder');
          if (ph != null) cur.setAttribute('placeholder', ph);
        });

        // 2) Refresh empty-state text inside preserved tab panes — but only
        //    if the pane is still untouched. Detect by matching child shape
        //    with the freshly-loaded pane: same count, same tagName/className
        //    per index. If analysed content is present (different shape),
        //    leave alone — runAnalysis below will repaint in the new locale.
        ['tInspector', 'tValidation', 'tCross', 'tCategories', 'tBehavior', 'tMacros'].forEach(
          function (id) {
            const cur = document.getElementById(id);
            const fresh = doc.getElementById(id);
            if (!cur || !fresh) return;
            if (cur.children.length !== fresh.children.length) return;
            let untouched = true;
            for (let i = 0; i < cur.children.length; i++) {
              if (
                cur.children[i].tagName !== fresh.children[i].tagName ||
                cur.children[i].className !== fresh.children[i].className
              ) {
                untouched = false;
                break;
              }
            }
            if (untouched) cur.innerHTML = fresh.innerHTML;
          },
        );
      }

      // 3) Re-render the dynamic chrome that holds translated strings. Toasts
      // use t() at fire time so they're auto-correct; modals stay stale until
      // closed (acceptable — modal flicker on toggle would be worse UX).
      try {
        if (typeof renderHistory === 'function') renderHistory();
        if (typeof refreshSamples === 'function') refreshSamples();
      } catch (_) {
        /* render functions may not be defined yet during init */
      }

      // 4) Re-run analysis if there's a payload — repaints decoded findings
      // / crosscheck / categories in the new locale.
      if (typeof window.runAnalysis !== 'function') return;
      try {
        const req = document.getElementById('bidReq').value;
        const res = document.getElementById('bidRes').value;
        // Re-run when either pane has content — JSON-feed payloads (value-feed,
        // bid-price, bid-redirect) live in bidRes only, so gating on req-presence
        // would skip the lang-change re-render for that whole branch.
        if (!req && !res) return;
        window.runAnalysis({ req: req, res: res });
      } catch (_e) {
        /* silent — user may not have a payload yet */
      }
    }),
  );

  // IAB Content Taxonomy decoder render. Reads the `meta.categories` map
  // from /api/analyze (path → [{code,label}]) and lays it out as a
  // collapsible-style list in the categories tab.
  function renderCategories(catsByPath) {
    const el = $('tCategories');
    if (!el) return;
    const paths = Object.keys(catsByPath || {});
    const total = paths.reduce((n, p) => n + catsByPath[p].length, 0);
    setTabBadge('categoriesBadge', { text: total ? String(total) : '' });
    if (!paths.length) {
      el.innerHTML =
        '<div class="empty-hint">' + escapeHtml(t('empty.no_iab_categories')) + '</div>';
      return;
    }
    el.innerHTML = paths
      .map((path) => {
        const items = catsByPath[path];
        const rows = items
          .map((c) => {
            const label = c.label
              ? '<span style="color:var(--text)">' + escapeHtml(c.label) + '</span>'
              : '<span style="color:var(--text-dim);font-style:italic">unknown / not in IAB 1.0</span>';
            return (
              '<div class="validation-item info" style="align-items:flex-start">' +
              '<span class="validation-icon" style="font-family:var(--font-mono);font-size:11px">' +
              escapeHtml(c.code) +
              '</span>' +
              '<span style="flex:1;min-width:0">' +
              label +
              '</span>' +
              '</div>'
            );
          })
          .join('');
        return (
          '<div style="margin-bottom:var(--space-4)">' +
          '<div class="mono-label" style="margin-bottom:var(--space-2)">' +
          escapeHtml(path) +
          ' <span style="color:var(--text-dim)">(' +
          items.length +
          ')</span>' +
          '</div>' +
          rows +
          '</div>'
        );
      })
      .join('');
  }

  let _lastExtractedMacros = [];
  let _currentPreviewAdm = null;
  let _currentPreviewBaseContext = null;
  let _currentPreviewDims = null;

  function reRenderPreview() {
    if (!_currentPreviewBaseContext) return;
    const macros = window.OrtbtoolsMacros;
    const overrides =
      macros && typeof macros.getOverrides === 'function' ? macros.getOverrides() : {};
    const context =
      macros && typeof macros.mergeMacroContext === 'function'
        ? macros.mergeMacroContext(_currentPreviewBaseContext, overrides)
        : { ..._currentPreviewBaseContext, price: overrides.price || '' };
    setAdPreview(_currentPreviewAdm, context, _currentPreviewDims);
  }

  function renderMacros(res, req) {
    const el = $('macroEvaluatorContainer');
    if (!el) return;
    if (window.OrtbtoolsMacros && typeof window.OrtbtoolsMacros.extractBidTrackers === 'function') {
      _lastExtractedMacros = window.OrtbtoolsMacros.extractBidTrackers(res, req);
      const count = _lastExtractedMacros.length;
      setTabBadge('macrosBadge', { text: count ? String(count) : '' });
      const simP = ($('simPrice') || {}).value || '';
      window.OrtbtoolsMacros.renderMacroTable(
        el,
        _lastExtractedMacros,
        { price: simP },
        reRenderPreview,
      );
    }
  }

  function clearMacros() {
    _lastExtractedMacros = [];
    setTabBadge('macrosBadge', { text: '' });
    const el = $('macroEvaluatorContainer');
    if (
      el &&
      window.OrtbtoolsMacros &&
      typeof window.OrtbtoolsMacros.renderMacroTable === 'function'
    ) {
      window.OrtbtoolsMacros.renderMacroTable(el, []);
    }
  }

  // The work bar's left half holds two different kinds of thing, and only one
  // of them is about a payload:
  //   - READOUTS — the validity chip and the dialect-overlay pill. They state
  //     something about the analysis that just ran, so before the first one
  //     they have nothing true to say and must stay down.
  //   - CONTROLS — the version pin and the dialect switch. They are INPUTS to
  //     the next analysis; a reader needs them before pressing Analyze, not
  //     after.
  // Hiding the whole strip until a result landed took the dialect switch down
  // with the chip, so on a fresh tab the only dialect-shaped control on screen
  // was the footer chip — and that one opens the dialect BUILDER, which on an
  // empty session can only answer "not enough data yet". Someone who simply
  // wanted to validate against a vendor dialect had nowhere to go.
  function setWorkbarReadoutsVisible(on) {
    const chip = $('validityChip');
    if (chip) {
      chip.hidden = !on;
      // .validity-chip declares display:inline-flex, and an author `display`
      // beats the UA stylesheet's [hidden] { display: none } — the attribute
      // alone would leave the chip on screen.
      chip.style.display = on ? '' : 'none';
    }
    const divider = document.querySelector('#formatBar .workbar-divider');
    if (divider) {
      // The divider exists to separate the chip from the controls; with no
      // chip it is a rule floating on its own.
      divider.hidden = !on;
      divider.style.display = on ? '' : 'none';
    }
  }

  // Format pill — surfaces detected payload type, status, version, dialect
  // as a coloured pill row above the inspector tabs. The readouts are hidden
  // until the first analysis result lands. Categorises type into oRTB-family
  // vs JsonFeed-family for colour coding (see CSS .format-pill-type[data-format]).
  function updateFormatBar(validation, dialect) {
    const bar = $('formatBar');
    if (!bar) return;
    if (!validation || !validation.type) {
      // The strip stays — it carries the two selects. Only what it SAYS about
      // a payload goes away.
      bar.hidden = false;
      setWorkbarReadoutsVisible(false);
      const stalePill = $('formatPillDialect');
      if (stalePill) stalePill.hidden = true;
      // The verdict has to leave with the readouts. It is rendered further
      // down this function, so an early return here would have left the
      // previous payload's sentence sitting above an empty workbench —
      // stating an outcome for something the user already cleared.
      const staleVerdict = $('verdict');
      if (staleVerdict) staleVerdict.hidden = true;
      return;
    }
    bar.hidden = false;
    setWorkbarReadoutsVisible(true);
    const type = String(validation.type || '');
    const status = String(validation.status || '');

    // The payload-type and version pills used to sit here. The mockup's work
    // bar carries a validity chip and two selects and nothing else — the type
    // and the version are both stated by the verdict's chip row a few pixels
    // below, and printing them twice is what made this bar read as a wall of
    // uppercase mono. `family` is still derived because the CSS that colours
    // by payload family is keyed off it elsewhere.
    let _family = 'unknown';
    if (/oRTB/i.test(type)) _family = 'ortb';
    else if (/Feed Response/i.test(type)) _family = 'feed';

    const findings = (validation && validation.findings) || [];
    const errCount = findings.filter((f) => f.level === 'error').length;
    const warnCount = findings.filter((f) => f.level === 'warning').length;

    // ── Verdict ────────────────────────────────────────────────────────────
    // The mockup's head, verbatim: an icon square, one sentence, and a meta
    // line that speaks the same language as the finding groups below it —
    // blocking / to fix / unmapped — plus when the analysis ran and on which
    // engine. A reader triaging a ticket needs those two facts the moment a
    // screenshot of this panel lands in a chat.
    const verdictBox = $('verdict');
    if (verdictBox) {
      const questionCount = findings.filter((f) => f.level === 'question').length;

      // Lucide glyphs, same geometry as the mockup: triangle-alert for a
      // payload that will not serve, check for a clean one.
      const TRIANGLE =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>' +
        '<path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
      const CHECK =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="m5 13 4 4L19 7"/></svg>';

      let vKey;
      let vIcon;
      if (status === 'invalid') {
        vKey = 'verdict.invalid';
        vIcon = TRIANGLE;
      } else if (errCount) {
        vKey = 'verdict.blocked';
        vIcon = TRIANGLE;
      } else if (warnCount) {
        vKey = 'verdict.risky';
        vIcon = TRIANGLE;
      } else {
        vKey = 'verdict.clean';
        vIcon = CHECK;
      }

      // "1 blocking issue · 3 to fix · 1 unmapped field. Analyzed 12:04,
      // engine v1.11.3." — counts in the groups' own vocabulary, so the meta
      // line and the section headers can never disagree about what a thing
      // is called.
      const parts = [];
      if (errCount) {
        parts.push(
          counted(errCount, 'verdict.blocker_one', 'verdict.blockers', 'verdict.blockers_many'),
        );
      }
      if (warnCount) parts.push(warnCount + ' ' + t('verdict.tofix'));
      if (questionCount) {
        parts.push(
          counted(
            questionCount,
            'verdict.question_one',
            'verdict.questions',
            'verdict.questions_many',
          ),
        );
      }
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const engineEl = document.getElementById('engineVer');
      const engine = engineEl ? engineEl.textContent.trim() : '';
      const analyzed = t('verdict.analyzed', { time: hh + ':' + mm, engine: engine });

      $('verdictIcon').innerHTML = vIcon;
      $('verdictHeadline').textContent = t(vKey);
      const detail = $('verdictDetail');
      detail.textContent = (parts.length ? parts.join(' · ') + '. ' : '') + analyzed;
      detail.hidden = false;
      verdictBox.dataset.status = status;
      verdictBox.dataset.verdict = vKey.slice('verdict.'.length);
      verdictBox.hidden = false;
    }

    // Validity chip — the mockup's first element on the work bar, and the one
    // fact the bar is best placed to state: whether the text in the editor is
    // JSON at all. Everything downstream depends on it, and until v1.12.1 it
    // was only visible inside the payload card's own header row.
    const vChip = $('validityChip');
    if (vChip) {
      const bad = status === 'invalid';
      vChip.dataset.state = bad ? 'invalid' : 'valid';
      const label = $('validityChipText');
      if (label) label.textContent = t(bad ? 'workbar.json_invalid' : 'workbar.json_valid');
      vChip.hidden = false;
    }

    const pillDialect = $('formatPillDialect');
    if (dialect && dialect !== 'iab') {
      pillDialect.textContent = '+ ' + dialect;
      pillDialect.title = 'Active dialect overlay: ' + dialect;
      pillDialect.hidden = false;
    } else {
      pillDialect.hidden = true;
    }
  }

  window.updateCharCount = updateCharCount;
  function updateCharCount(id) {
    const el = $(id);
    const count = $(id === 'bidReq' ? 'reqCount' : 'resCount');
    // Bytes, with a unit and thin-space grouping — the mockup reads "1 284 B".
    // The old form was a bare character count ("850"), which is neither the
    // same number nor labelled as anything: a payload's size is what an
    // exchange's body limit is measured in, and UTF-8 makes those two differ
    // the moment a payload carries a non-ASCII domain or creative.
    const len = new TextEncoder().encode(el.value).length;
    count.textContent = len > 0 ? String(len).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' B' : '';
    count.className = 'char-count' + (len > 50000 ? ' warn' : '');
    // Manifesto rule 3: hide the char-count when the editor is empty.
    // '0' adds noise to the empty state (the "0 порожньо" pair reads as
    // duplicate "nothing here" markers). The json-badge below already
    // says 'порожньо' / 'empty' more readably.
    count.hidden = len === 0;
    updateJsonBadge(id);
    refreshEmptyStateChrome();
  }

  // Manifesto rule 3 enforcer — hides chrome elements that have no data
  // to display in the current state. Called from updateCharCount on every
  // editor change (input / clear / format / paste) so visibility tracks
  // payload presence in real time. Tab badges hide themselves via
  // setTabBadge() in utils.js; this function covers the sidebar.
  //
  //   - "summary" section title  → hidden when both editors are empty
  //   - "winning bid" metric     → hidden until there's a bidRes
  //                                (the price is meaningless without one)
  //   - OS/GEO/device/connection → hidden until there's a bidReq
  //                                (those rows come from the request payload)
  //
  // The library + history sections in the same sidebar stay visible
  // regardless — they reflect saved state, not the current analysis.
  function refreshEmptyStateChrome() {
    const reqEl = $('bidReq');
    const resEl = $('bidRes');
    const hasReq = !!(reqEl && reqEl.value && reqEl.value.trim());
    const hasRes = !!(resEl && resEl.value && resEl.value.trim());
    const isAllEmpty = !hasReq && !hasRes;

    const summaryTitle = document.querySelector('[data-section="summary-title"]');
    if (summaryTitle) summaryTitle.hidden = isAllEmpty;

    const winningBidCard = document.querySelector('[data-section="winning-bid"]');
    if (winningBidCard) winningBidCard.hidden = !hasRes;

    const mInfo = $('mInfo');
    if (mInfo) mInfo.hidden = !hasReq;
  }

  function updateJsonBadge(id) {
    const el = $(id);
    const badge = document.getElementById(id === 'bidReq' ? 'reqBadge' : 'resBadge');
    // The per-editor badge left the payload column in v1.13.1 — validity is
    // stated once, by the work bar's chip, where the mockup puts it. The
    // element may simply be absent now, and the null check is the whole
    // difference between that being a design decision and being a crash that
    // takes the entire module's activate() down with it.
    if (!el || !badge) return;
    // The request editor admits two wire shapes: OpenRTB JSON and a raw
    // HTTP(S) feed URL. Give the latter an explicit state instead of the
    // misleading red "invalid JSON" badge. The response editor remains
    // JSON-only.
    renderInputBadge(el.value, badge, t, { allowUrl: id === 'bidReq' });
  }

  // ── Ad preview helpers ────────────────────────────────────────
  function findAdm(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.adm) return obj.adm;
    // adm-less fallback: `iurl` is the oRTB Bid object's "sample image URL …
    // for content checking" — a real static image, the correct thing to render.
    // We deliberately DO NOT fall back to `nurl`/`burl`: those are win/billing
    // NOTICE urls (tracking beacons fired by the exchange), not creatives — they
    // return HTML/204/JSON, never image bytes, so `<img src=nurl>` only paints a
    // broken-image icon (ORB-blocked). A nurl-only bid → no renderable creative.
    if (obj.iurl && typeof obj.iurl === 'string')
      return '<img src="' + escapeHtml(obj.iurl) + '" style="width:100%"/>';
    for (const k in obj) {
      if (typeof obj[k] === 'object' && obj[k] !== null) {
        const f = findAdm(obj[k]);
        if (f) return f;
      }
    }
    return null;
  }

  function getSlotType(imp) {
    const types = [];
    if (imp.banner) types.push('banner');
    if (imp.video) types.push('video');
    if (imp.native) types.push('native');
    if (imp.audio) types.push('audio');
    return types.length ? types : ['unknown'];
  }

  // Lazy-loaded source of /creative-probe.js — fetched once and inlined
  // into the iframe srcdoc so the probe runs BEFORE creative scripts.
  // Inlining avoids cross-origin nuance with sandbox `srcdoc` + opaque
  // origin loading external `<script src>`. Prefetch fires on DOMReady.
  let _probeSource = null;
  let _probeSourcePromise = null;

  // Reference to the iframe currently hosting the probed creative. Used
  // by the postMessage receiver (further below) to verify event.source —
  // any other frame on the page (other ad slots, GTM, third-party widgets)
  // could otherwise send forged `ortbtools-probe` messages and poison
  // __ortbtoolsBehavior.events. Cleared on every new preview; set only
  // when the banner-iframe branch actually mounts a probed iframe (VAST
  // and native preview branches don't get a probe → null guard rejects
  // their events too).
  let _currentProbedIframe = null;

  // Phase 4 — frozen-thread watchdog. The probe sends a 1Hz heartbeat
  // (creative-probe.js hook 15); the parent receiver below updates
  // _lastHeartbeatAt on every probe message it accepts. _watchdogTimer
  // ticks WATCHDOG_INTERVAL_MS and, if lag exceeds FROZEN_THRESHOLD_MS,
  // injects a synthetic kind:'frozen_thread' event into
  // __ortbtoolsBehavior.events — bypassing postMessage because a frozen
  // iframe can't send messages itself. Engine then promotes that event
  // to a behavior.malicious.frozen_thread finding (ERROR).
  //
  // Lifetime: timer starts lazily on first probe message (so we don't
  // run the watchdog before the iframe has even loaded), resets on
  // every new setAdPreview call, and clears on module unmount.
  // Bumped 3500 → 6000 in v0.24.0 after audit found false-positives on
  // legitimate heavy-compute creatives (image processing, wasm decode,
  // physics sims) that briefly block the JS thread for 2-3s. ≥5 missed
  // heartbeats with margin — still catches genuine `while(true){}` and
  // similar deadlocks within ~6s, just stops mistaking heavy-but-recovering
  // creatives for malicious freezes. Real fraud freezes don't recover.
  const FROZEN_THRESHOLD_MS = 6000;
  const WATCHDOG_INTERVAL_MS = 1000;
  let _lastHeartbeatAt = 0;
  let _frozenAlerted = false;
  let _watchdogTimer = null;

  // Phase 9b/freeze hardening (P0.2 audit): rolling-window cap on the
  // behavior-events buffer. A misbehaving creative can pump events at
  // 100s/sec; without a cap, leaving the tab open for hours grows the
  // array linearly until OOM. 500 is generous (>10× what the engine
  // will ever score on a single render) and keeps the parent-tab
  // memory bounded at ~200KB. The engine truncates internally on
  // wire-send; this cap is purely about parent-tab memory hygiene.
  const BEHAVIOR_EVENTS_MAX = 500;
  function pushBehaviorEvent(evt) {
    if (!window.__ortbtoolsBehavior) {
      window.__ortbtoolsBehavior = { events: [], startedAt: Date.now() };
    }
    const list = window.__ortbtoolsBehavior.events;
    list.push(evt);
    if (list.length > BEHAVIOR_EVENTS_MAX) {
      // Drop oldest. .splice keeps the same array reference so any
      // outside code still holding `events` (e.g. an in-flight
      // fetchAnalysis snapshot) sees consistent state.
      list.splice(0, list.length - BEHAVIOR_EVENTS_MAX);
    }
  }

  function stopWatchdog() {
    if (_watchdogTimer) {
      clearInterval(_watchdogTimer);
      _watchdogTimer = null;
    }
    _lastHeartbeatAt = 0;
    _frozenAlerted = false;
  }

  function startWatchdog() {
    if (_watchdogTimer) return;
    _watchdogTimer = setInterval(function () {
      // Bail if no probed iframe is mounted (preview was reset between
      // ticks). _lastHeartbeatAt = 0 means we've never seen liveness yet
      // — don't start counting until the probe has at least sent
      // probe_ready, otherwise we'd false-fire on every blank-iframe gap.
      if (!_currentProbedIframe || !_lastHeartbeatAt || _frozenAlerted) return;
      const lag = Date.now() - _lastHeartbeatAt;
      if (lag <= FROZEN_THRESHOLD_MS) return;
      _frozenAlerted = true;
      const evt = {
        type: 'ortbtools-probe-watchdog',
        v: 1,
        ts: Date.now(),
        kind: 'frozen_thread',
        method: 'parent-watchdog',
        url: '',
        trigger: 'no-event',
        msSinceLastHeartbeat: lag,
      };
      pushBehaviorEvent(evt);
      renderBehaviorTab();
    }, WATCHDOG_INTERVAL_MS);
  }
  function loadProbeSource() {
    if (_probeSourcePromise) return _probeSourcePromise;
    _probeSourcePromise = fetch('/creative-probe.js')
      .then((r) => (r.ok ? r.text() : ''))
      .then((src) => {
        _probeSource = src;
        return src;
      })
      .catch(() => {
        _probeSource = '';
        return '';
      });
    return _probeSourcePromise;
  }

  function buildProbedSrcdoc(creativeHtml) {
    // Inject a restrictive Content-Security-Policy meta tag into the creative iframe
    // so no external images, scripts, fonts, or network beacons can load over HTTPS during preview.
    const cspMeta =
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none';\">";
    if (!_probeSource) return cspMeta + creativeHtml;
    // Wrap in a <script> at the very top so listeners are hooked before
    // creative HTML parses any inline handlers.
    return '<script>' + _probeSource + '</' + 'script>' + cspMeta + creativeHtml;
  }

  function resetBehavior() {
    window.__ortbtoolsBehavior = { events: [], startedAt: Date.now() };
    renderBehaviorTab();
  }

  // Phase 6 — cap the adm copy that gets posted alongside probe events to
  // /api/analyze-behavior. The engine's scanner truncates internally to
  // 100 KB, but we cap the wire payload to 64 KB to keep round-trips fast
  // and avoid re-sending the full creative on every Behavior-tab render
  // (a banner adm can be 200KB+ when it embeds base64 sprites). Pattern
  // matches always fire in the head of the creative (loader / decoder),
  // so the prefix is sufficient.
  const ADM_TRANSPORT_LIMIT = 64 * 1024;

  // ── Phase 8: helpers ─────────────────────────────────────────────

  // Paint the per-card summary bar that shows when the input panel is
  // collapsed. The summary lives inside the input-card and is visible
  // only when the parent has .is-collapsed; this just keeps the data
  // fresh so the user sees identity at a glance without expanding.
  function paintCardSummary(cardId, value) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const el = card.querySelector('[data-summary-id]');
    if (el) el.textContent = String(value || '—');
    if (cardId === 'cardReq') paintCrumbs(value);
  }

  /**
   * The topbar breadcrumb: which section, and which payload.
   *
   * The id was already computed for the collapsed-card summary and rendered
   * into a span that measures 0x0 unless the card is folded — so the one
   * string identifying what is on screen was, in practice, invisible. The
   * mockup puts it in the title position; this paints the same value there,
   * from the same call, so the two cannot describe different payloads.
   */
  function paintCrumbs(id) {
    // The section half is the topbar's job now — it derives it from the route,
    // so every page has one whether or not its module remembers. This supplies
    // only the detail: which payload is on screen.
    const clean = id && id !== '—' ? String(id) : '';
    if (typeof window.ktSetCrumbDetail === 'function') window.ktSetCrumbDetail(clean);
  }

  // Domain masking for History list — protects users from accidentally
  // showing adult/casino domains during demos, screenshots, or
  // pair-debugging. Matches a small allow-list of high-sensitivity
  // tokens; everything else passes through unchanged. Format:
  // `pornhub.com` → `***hub.com`. SLDs ≤3 chars get fully masked.
  const MASK_PATTERNS =
    /(porn|xxx|adult|nude|sex(?!ton)|casino|gambl|poker|slot(?!s?\.)|bet(?!a)|wager)/i;
  function maskDomain(domain) {
    if (!domain || typeof domain !== 'string') return domain;
    if (!MASK_PATTERNS.test(domain)) return domain;
    const parts = domain.split('.');
    if (parts.length < 2) return '***';
    const sld = parts[parts.length - 2];
    const tld = parts[parts.length - 1];
    if (sld.length <= 3) return '***.' + tld;
    return '***' + sld.slice(-3) + '.' + tld;
  }

  // Stage-1 (CP3): the old best-effort `jsonPathToTextarea`/`scrollToPath`
  // (regex side-guess + first-`"key"` substring match) is REMOVED. Exact
  // navigation now flows through the `location` contract → window.
  // OrtbtoolsSourceNav (explicit side, RFC 6901 pointer, source-map resolved).
  // See the `goto-path` action handler.

  function setAdPreview(adm, macroContext, dims) {
    const el = $('creativePreview');
    el.innerHTML = '';
    // The asset-inlining button lives OUTSIDE the preview frame (see
    // creativeActionsHost) and therefore survives `el.innerHTML = ''`.
    // Clearing the frame is what makes a creative "new", so the offer that
    // belonged to the previous one has to go with it — otherwise a VAST or
    // native response (branches that never reach maybeOfferAssetInlining)
    // would keep offering to inline the images of a banner that is no
    // longer on screen.
    clearCreativeActions();
    // Phase 8: re-apply safe-demo blur on every new creative. The user
    // explicitly reveals each creative; we don't carry the reveal state
    // across impressions because that would defeat the screenshot-safety
    // guarantee (one accidental reveal would leak into every subsequent
    // analyze until reload).
    const safeWrap = document.getElementById('creativePreviewSafe');
    if (safeWrap) safeWrap.classList.remove('is-revealed');
    // Phase 9: responsive sizing helper. Sets --bid-w/--bid-h CSS vars
    // on .preview-safe so the wrapper sizes via aspect-ratio, with
    // max-width:100% fit. data-has-creative drives the empty-state
    // collapse — no creative = thin strip, no wasted vertical space.
    const setDims = (w, h) => {
      if (!safeWrap) return;
      if (w && h && w > 0 && h > 0) {
        safeWrap.style.setProperty('--bid-w', String(w));
        safeWrap.style.setProperty('--bid-h', String(h));
        safeWrap.dataset.hasCreative = '1';
      } else {
        safeWrap.style.removeProperty('--bid-w');
        safeWrap.style.removeProperty('--bid-h');
        safeWrap.dataset.hasCreative = '0';
      }
    };
    // Drop the previous probed iframe ref before any branch runs — the
    // VAST + native + empty-adm branches never reassign it, and we don't
    // want stale messages from a torn-down iframe to slip through.
    _currentProbedIframe = null;
    // Watchdog must reset alongside the iframe ref: a torn-down iframe
    // shouldn't keep ticking a stale heartbeat-clock from the previous
    // creative, and the new probe will lazy-start a fresh watchdog when
    // it sends probe_ready.
    stopWatchdog();
    // New creative → fresh behaviour log. Old findings would otherwise leak
    // across previews and produce confusing per-tab counts.
    resetBehavior();
    if (!adm) {
      // Phase 9: empty state collapses to a thin strip — preview-empty
      // takes its content height (~32px) instead of inheriting a tall
      // .preview-container. Frees vertical space for findings.
      el.innerHTML = '<div class="preview-empty">' + escapeHtml(t('preview.no_adm')) + '</div>';
      setDims(0, 0);
      return;
    }
    // Phase 6: park the creative source on __ortbtoolsBehavior so that
    // modules/behavior/index.js can include it in the /api/analyze-behavior
    // POST body. Truncated to ADM_TRANSPORT_LIMIT — the engine's scanner
    // truncates internally too, but bounding wire size keeps the per-render
    // round-trip fast (Behavior tab re-fetches on every probe event).
    try {
      const admStr = String(adm);
      window.__ortbtoolsBehavior.creative_adm =
        admStr.length > ADM_TRANSPORT_LIMIT ? admStr.slice(0, ADM_TRANSPORT_LIMIT) : admStr;
    } catch (_e) {
      /* defensive — shouldn't fail, but the rest of preview must run */
    }
    // Resolve known macros via the shared evaluator.
    // macroContext carries the same overrides as the Macro table:
    // - AUCTION_PRICE: only from explicit user simulation input (empty = literal)
    // - AUCTION_CURRENCY: BidResponse.cur or USD
    // - AUCTION_ID: BidRequest.id only
    // Unresolved macros stay literal in the creative, which is correct
    // for an inert preview where no real auction has occurred.
    const resolved =
      window.OrtbtoolsMacros && typeof window.OrtbtoolsMacros.resolveAdmMacros === 'function'
        ? window.OrtbtoolsMacros.resolveAdmMacros(String(adm), macroContext || {})
        : String(adm);
    const trimmed = resolved.trim();

    // 1) VAST XML → show as expandable XML preview. We can't actually play
    //    video here (no VAST player + sandbox-allow-scripts is too narrow).
    //    8000 chars is generous for modern VAST 4.x with multiple wrappers;
    //    surface a "trimmed" hint when we hit it so the user isn't surprised.
    //    NOTE: regex must stay in lockstep with `isVastShape` in
    //    packages/core/format-detect.js — anchored at start, accepts
    //    `<?xml` declaration or bare `<VAST`.
    if (/^(<\?xml|<VAST)/i.test(trimmed)) {
      const VAST_MAX = 8000;
      const truncated = trimmed.length > VAST_MAX;
      const display = truncated ? trimmed.slice(0, VAST_MAX) : trimmed;
      const note = truncated
        ? `<div class="mono-label" style="margin-top:var(--space-2);color:var(--text-dim)">… trimmed (${trimmed.length - VAST_MAX} chars hidden)</div>`
        : '';
      el.innerHTML = `
        <div style="padding:var(--space-4);font-family:var(--font-mono);font-size:11px;color:var(--text-muted);overflow:auto;height:100%;width:100%">
          <div class="mono-label" style="margin-bottom:var(--space-2)">vast · video xml · preview-only (no playback)</div>
          <pre style="white-space:pre-wrap;word-break:break-word;margin:0;color:var(--text)">${escapeHtml(display)}</pre>
          ${note}
        </div>`;
      // VAST is text-content; size to a generic 16:9 video frame.
      setDims(640, 360);
      return;
    }

    // 2) Native JSON → synthesize a standalone HTML card and pipe it through
    //    the probe identically to banner adm. Without this, clicks on the
    //    rendered native were invisible to the Behavior engine (the previous
    //    implementation injected the card directly into the parent DOM and
    //    never mounted a probed iframe). The card uses a plain <a href>
    //    without target=_top: a click attempts iframe-self navigation, which
    //    the probe's Location.href setter hook captures as a `navigation`
    //    event — same tracking signal as a banner adm without the
    //    frame_bust_anchor false-positive label.
    if (trimmed.startsWith('{')) {
      try {
        const j = JSON.parse(trimmed);
        if (j && j.native && Array.isArray(j.native.assets)) {
          const iframe = document.createElement('iframe');
          iframe.setAttribute('sandbox', 'allow-scripts');
          iframe.style.cssText = 'border:none;background:#fff;width:100%;height:100%';
          iframe.srcdoc = buildProbedSrcdoc(renderNativeToHtml(j.native));
          // Native ads vary wildly in shape; the synthetic render is a
          // typical card layout that fits 320×260 reasonably. Caller can
          // override later via dims if request specified them.
          setDims(dims && dims.w ? dims.w : 320, dims && dims.h ? dims.h : 260);
          _currentProbedIframe = iframe;
          el.appendChild(iframe);
          return;
        }
      } catch (err) {
        // Surface the failure: a silent catch here means a blank iframe AND
        // no probe → watchdog spams frozen_thread with no diagnostic trail.
        // Logging lets us see ReferenceErrors / parse failures / asset shape
        // mismatches immediately. Falls through to the banner-iframe branch
        // below so the user still sees *something* (even if just raw JSON).
        console.error('[ortbtools] native render failed, falling back to banner branch', err);
      }
    }

    // 3) Banner HTML → iframe sandbox.
    // If we know native banner dimensions, render the iframe at native size
    // and scale-to-fit the (narrow) preview container, preserving aspect.
    // Otherwise fall back to legacy 100%-of-container behaviour.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.srcdoc = buildProbedSrcdoc(resolved);
    // Pin THIS iframe as the only legitimate probe source. The receiver
    // below rejects every postMessage whose `event.source` doesn't match
    // this contentWindow — so even on a page with multiple iframes, only
    // our just-mounted creative can populate __ortbtoolsBehavior.events.
    _currentProbedIframe = iframe;
    // Phase 9: responsive sizing replaces the JS scale-to-fit math.
    // .preview-safe sizes itself via aspect-ratio + max-width:100% from
    // the --bid-w / --bid-h CSS vars; the iframe just fills its parent.
    // Cleaner than transform:scale (which broke clickable regions for
    // creatives that did their own internal hit-testing).
    iframe.style.cssText = 'border:none;background:#fff;width:100%;height:100%;display:block;';
    if (dims && dims.w > 0 && dims.h > 0) {
      setDims(dims.w, dims.h);
    } else {
      // Unknown dims fallback: tag as has-creative=1 with default 300×250
      // ratio so the preview at least has a non-zero footprint. The
      // creative still renders 100% width inside its iframe.
      setDims(300, 250);
    }
    el.appendChild(iframe);
    maybeOfferAssetInlining(el, resolved, dims);
  }

  /**
   * The strip of controls that act on the preview, as a sibling AFTER the
   * preview frame — never inside it.
   *
   * `.preview-container` is a fixed-size clipper: it takes its width and
   * height from the bid's own dimensions (300×250 for the common banner),
   * sets `overflow:hidden`, and centres its children with flexbox. A control
   * appended in there is a second flex item next to a `width:100%` iframe, so
   * the row it forms is wider than the box that centres it: the iframe slides
   * left by half the button's width and the button hangs off the right edge,
   * where the clipper cuts it in half. Measured at 1366×768 before this
   * moved: the 264px button started at x=1101 inside a clipper ending at
   * x=1234 — 131px and the end of its own label amputated — while the iframe
   * sat 131px left of the frame it was supposed to fill. `.preview-safe-
   * overlay` covers the same box at z-index 5, so what survived the clip was
   * unclickable anyway until the creative was revealed.
   *
   * Hence a container of our own, after `.preview-safe` (after the overlay's
   * containing block, not just after the clipper — inside `.preview-safe` the
   * overlay would still be painted on top of it). `.creative-actions` is the
   * agreed seam: this file owns putting controls in it, inspector.css owns
   * how it looks.
   *
   * Created on demand and removed when empty, so a creative with no remote
   * assets leaves no styled gap between the preview and the slot stats.
   *
   * @param {boolean} [create] mount the container if it isn't there yet
   * @returns {HTMLElement|null}
   */
  function creativeActionsHost(create) {
    const existing = document.getElementById('creativeActions');
    if (existing) return existing;
    if (!create) return null;
    // After the safe-mode wrapper when there is one; the bare preview
    // container is the fallback for a DOM that predates it.
    const anchor =
      document.getElementById('creativePreviewSafe') || document.getElementById('creativePreview');
    if (!anchor || !anchor.parentNode) return null;
    const box = document.createElement('div');
    box.id = 'creativeActions';
    box.className = 'creative-actions';
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    return box;
  }

  /** Drop the actions strip entirely — an empty one would still take margin. */
  function clearCreativeActions() {
    const box = document.getElementById('creativeActions');
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  /**
   * Offer to render the creative's remote images, fetched by the server.
   *
   * The preview iframe's CSP allows `data:` and `blob:` only, on purpose —
   * it is the chamber creative-probe.js measures from, and letting `https:`
   * images load would fire every tracking pixel in attacker-supplied markup
   * from this machine. So a banner whose art lives on a CDN renders empty,
   * correctly. The server can fetch those bytes without anything identifying
   * the analyst reaching the advertiser, and hand them back as data: URIs.
   *
   * A button rather than automatic: inlining spends outbound requests to a
   * host the creative named, and doing that silently on every preview would
   * move the problem one hop rather than solve it. The count is on the
   * button so the ask is explicit.
   *
   * Re-rendering restarts the behaviour probe — resetBehavior() first, or the
   * second pass double-counts every event the first one recorded.
   *
   * `host` stays the preview container: it is where the iframe to re-point
   * lives. The button itself goes to `.creative-actions`, outside the frame —
   * see creativeActionsHost for why.
   */
  function maybeOfferAssetInlining(host, creativeHtml, dims) {
    const api = window.OrtbtoolsCreativeAssets;
    if (!api || !host) return;
    let urls = [];
    try {
      urls = api.collectRemoteUrls(creativeHtml);
    } catch (_e) {
      return;
    }
    if (!urls.length) return;
    const actions = creativeActionsHost(true);
    if (!actions) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm creative-inline-assets';
    btn.textContent = t('creative.assets.load', { n: urls.length });
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = t('creative.assets.loading');
      try {
        const res = await api.inlineAssets(creativeHtml);
        if (res.inlined > 0) {
          const frame = host.querySelector('iframe');
          if (frame) {
            resetBehavior();
            frame.srcdoc = buildProbedSrcdoc(res.html);
            _currentProbedIframe = frame;
          }
        }
        toast(api.describe(res), res.inlined ? 'success' : 'error');
        if (res.inlined && !res.failed.length) {
          // Nothing left to ask for. Take the empty strip with it rather
          // than leave a styled container holding no controls.
          btn.remove();
          if (!actions.children.length) clearCreativeActions();
          return;
        }
      } catch (_e) {
        toast(t('creative.assets.all_failed', { n: urls.length }), 'error');
      }
      btn.disabled = false;
      btn.textContent = t('creative.assets.load', { n: urls.length });
    });
    actions.appendChild(btn);
    void dims;
  }

  // ── Creative-probe receiver ──────────────────────────────────
  // The probe (creative-probe.js) runs INSIDE the sandboxed iframe and
  // posts every navigation attempt + click event lineage back here.
  // Findings show up in the Behavior tab; counts feed the tab badge.
  function humanizeBehaviorKind(kind) {
    const map = {
      click_skim_suspect: t('behavior.kind.click_skim_suspect'),
      auto_navigate: t('behavior.kind.auto_navigate'),
      window_open: t('behavior.kind.window_open'),
      navigation: t('behavior.kind.navigation'),
      location_set: t('behavior.kind.location_set'),
      programmatic_click: t('behavior.kind.programmatic_click'),
    };
    return map[kind] || kind;
  }

  function severityForKind(kind) {
    if (kind === 'click_skim_suspect') return 'danger';
    if (kind === 'auto_navigate') return 'warning';
    return 'info';
  }

  // ── Price formatting ────────────────────────────────────────────────────
  // toFixed(2) reads a real sub-cent bid (e.g. 0.00177 CPM) as "0.00", which
  // looks like "no bid". Use adaptive precision so any non-zero price shows a
  // non-zero value: >=0.01 → 2 decimals; sub-cent → up to 6 so the magnitude
  // is visible; exact 0 / non-finite → "0.00".
  function formatPrice(p) {
    const n = Number(p);
    if (!isFinite(n) || n === 0) return '0.00';
    if (Math.abs(n) >= 0.01) return n.toFixed(2);
    // Trim trailing zeros from a 6-decimal render so 0.00177 → "0.001768"-ish
    // stays compact (e.g. "0.0018", "0.000125").
    return parseFloat(n.toFixed(6)).toString();
  }

  // ── Money rendering ─────────────────────────────────────────────────────
  // A price is a number AND the currency it is denominated in. The strip used
  // to print a hardcoded '$' in front of whatever arrived, so a request
  // pricing its floor in RUB rendered "Floor: $12500.00 · RUB" — a dollar
  // sign, a rouble amount and the letters RUB, all in one line, describing
  // three different things.
  //
  // Precision follows formatPrice: a currency's own minor-unit convention for
  // ordinary amounts (JPY gets 0 decimals, USD 2), but sub-cent floors get up
  // to 6 so a real 0.001 CPM does not render as "0.00" and read as "no bid".
  function formatMoney(amount, code) {
    const n = Number(amount);
    if (!isFinite(n)) return String(amount);
    const cur = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const opts = { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' };
    applySubCentDigits(opts, n);
    try {
      return new Intl.NumberFormat(activeLocaleTag(), opts).format(n);
    } catch (_e) {
      // Intl throws on a non-ISO code, and `narrowSymbol` is unsupported on
      // older engines. Either way the amount still has to be readable, so
      // fall back to the plain number beside whatever code arrived.
      return formatPrice(n) + (cur ? ' ' + cur : '');
    }
  }

  /**
   * The amount alone, formatted with the currency's own minor-unit convention
   * but no symbol — the caller writes the ISO code beside it.
   *
   * The floor uses this rather than formatMoney because a symbol AND a code
   * ("12 500,00 ₽ · RUB") says the same thing twice in the tightest block on
   * the bar, and pushed the USD equivalent off the end. Splitting the two
   * roles also makes the line unambiguous at a glance: what arrived is a
   * number with a CODE, what we derived is a number with a $.
   */
  function formatAmount(amount, code) {
    const n = Number(amount);
    if (!isFinite(n)) return String(amount);
    const cur = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    // Borrow the currency's minor units (JPY 0, USD 2, KWD 3) without letting
    // Intl print the symbol.
    try {
      const r = new Intl.NumberFormat(activeLocaleTag(), {
        style: 'currency',
        currency: cur,
      }).resolvedOptions();
      opts.minimumFractionDigits = r.minimumFractionDigits;
      opts.maximumFractionDigits = r.maximumFractionDigits;
    } catch (_e) {
      // Unknown code — 2 decimals is the sane default, already set above.
    }
    applySubCentDigits(opts, n);
    try {
      return new Intl.NumberFormat(activeLocaleTag(), opts).format(n);
    } catch (_e) {
      return formatPrice(n);
    }
  }

  /**
   * A real sub-cent CPM (0.00177) must not round to "0.00" and read as "no
   * bid" — the same reason formatPrice exists. Widen the fraction digits for
   * small non-zero amounts only, so ordinary prices keep their conventional
   * two (or none, for JPY).
   */
  function applySubCentDigits(opts, n) {
    if (n !== 0 && Math.abs(n) < 0.01) {
      opts.minimumFractionDigits = 2;
      opts.maximumFractionDigits = 6;
    }
  }

  // BCP-47 tag for Intl. The UI locale is uk | en | ru; en formats as en-US
  // (the convention the rest of the numeric UI already follows).
  function activeLocaleTag() {
    const l = (window.tLocale && window.tLocale()) || 'uk';
    return l === 'en' ? 'en-US' : l;
  }

  // ── FX: USD equivalent for a non-USD floor ──────────────────────────────
  // Display only. The rate is live, so the same payload converts to a
  // slightly different number tomorrow — that must never reach a finding, a
  // verdict or a stored record, only the line the operator reads. Everything
  // here degrades to "no conversion shown"; it never invents a rate.
  let _fxTable = null;
  let _fxPromise = null;

  function loadFxRates() {
    if (_fxTable) return Promise.resolve(_fxTable);
    if (!_fxPromise) {
      _fxPromise = fetch('/api/v1/fx-rates', { headers: { Accept: 'application/json' } })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (j) {
          if (j && j.ok && j.rates && typeof j.rates === 'object') _fxTable = j;
          return _fxTable;
        })
        .catch(function () {
          // Offline, blocked, or the server has no table yet. The amount is
          // already on screen in its own currency; that stays the answer.
          return null;
        });
    }
    return _fxPromise;
  }

  /**
   * The provider's own "last updated" stamp, in the reader's locale. It
   * arrives as RFC-1123 ("Fri, 14 Aug 2026 00:02:32 +0000"), which reads as
   * noise inside a Ukrainian or Russian sentence. Unparseable input is passed
   * through verbatim rather than replaced with a date we made up.
   */
  function formatFxDate(raw) {
    if (!raw) return '—';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return String(raw);
    try {
      return new Intl.DateTimeFormat(activeLocaleTag(), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(d);
    } catch (_e) {
      return String(raw);
    }
  }

  /**
   * Convert into USD using the cached table.
   * @returns {{usd: number, rate: number, table: object}|null} null when the
   *   table is missing, the currency is absent from it, or no conversion is
   *   needed (the amount is already USD).
   */
  function toUsd(amount, code) {
    const n = Number(amount);
    const cur = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!_fxTable || !isFinite(n) || !cur || cur === 'USD') return null;
    const rate = Number(_fxTable.rates[cur]);
    if (!isFinite(rate) || rate <= 0) return null;
    return { usd: n / rate, rate: rate, table: _fxTable };
  }

  // ── Feature #12: Quality Score Pill ─────────────────────────────────────
  // Computes a 0-100 quality score from findings. Returns {score, errors,
  // warnings, info, deductions} for tooltip use.
  function computeQualityScore(findings) {
    if (!findings || !findings.length) {
      return { score: 100, errors: 0, warnings: 0, info: 0, deductions: 0 };
    }
    let errors = 0,
      warnings = 0,
      info = 0;
    findings.forEach(function (f) {
      const lvl = f.level === 'danger' ? 'error' : f.level;
      if (lvl === 'error') errors++;
      else if (lvl === 'warning') warnings++;
      else info++;
    });
    const deductions = errors * 25 + warnings * 10 + info * 2;
    const score = Math.max(0, Math.min(100, 100 - deductions));
    return { score: score, errors: errors, warnings: warnings, info: info, deductions: deductions };
  }
  window.computeQualityScore = computeQualityScore;

  /**
   * Fill the strip's USD-equivalent slot, fetching the rate table on first
   * need. Re-entrant and self-cancelling: it re-reads the slot from the DOM
   * after the await, so a second analysis landing mid-flight repaints its own
   * floor rather than the previous one's.
   */
  function paintFloorUsd() {
    const slot = document.querySelector('#analysisStrip .floor-usd');
    if (!slot) return;
    const amount = Number(slot.getAttribute('data-floor-amount'));
    const cur = slot.getAttribute('data-floor-cur');
    if (!isFinite(amount) || !cur || cur.toUpperCase() === 'USD') return;

    const paint = function () {
      const live = document.querySelector('#analysisStrip .floor-usd');
      // A newer analysis has replaced the strip — that render paints itself.
      if (!live || live !== slot) return;
      const conv = toUsd(amount, cur);
      if (!conv) return;
      live.textContent = ' ≈ ' + formatMoney(conv.usd, 'USD');
      // This lands AFTER the strip's title pass, so the cell's own title would
      // otherwise describe the figure as it read before the conversion arrived
      // — accurate for a moment, then quietly wrong in the one cell whose value
      // is longest and gets truncated first. Re-read it from the DOM, which is
      // the only version that cannot disagree with what is on screen.
      const cell = live.closest('.analysis-strip-value');
      if (cell) cell.setAttribute('title', cell.textContent.trim());
      live.title = t('strip.pricing.fx_tooltip', {
        amount: formatAmount(amount, cur) + ' ' + cur,
        cur: cur,
        rate: conv.rate,
        provider: conv.table.provider || '—',
        date: formatFxDate(conv.table.providerUpdatedAt),
      });
      if (conv.table.stale) {
        live.classList.add('floor-usd-stale');
        live.title += ' · ' + t('strip.pricing.fx_stale');
      }
    };

    if (_fxTable) paint();
    else loadFxRates().then(paint);
  }

  // ── Feature #13: Request Analysis Summary Strip ─────────────────────────
  // Renders a thin horizontal strip above the tab-bar showing 5 key
  // parameters extracted from the BidRequest JSON. Injected once into the
  // DOM between .format-bar and .tab-bar; updated on every analyze.
  function renderAnalysisStrip(req, findings) {
    if (!req || typeof req !== 'object') {
      const existing = document.getElementById('analysisStrip');
      if (existing) existing.hidden = true;
      return;
    }

    // 1. Version — precedence:
    //    a) oRTB 3.0 envelope (req.openrtb.ver)
    //    b) explicit ext.openrtb_version declaration in the payload
    //    c) high-confidence (≥0.8) engine detection from __ortbtoolsLast
    //    d) low-confidence engine fallback (prefixed with ≈)
    //    e) '?' if nothing found
    let _version = '?';
    if (req.openrtb && req.openrtb.ver) {
      _version = 'oRTB 3.0';
    } else if (req.ext && req.ext.openrtb_version) {
      // Explicit self-declaration in payload — highest trust for 2.x
      _version = 'oRTB ' + req.ext.openrtb_version;
    } else {
      // Use validation result from last analysis if available
      const lastVer =
        window.__ortbtoolsLast &&
        window.__ortbtoolsLast.validation &&
        window.__ortbtoolsLast.validation.version;
      if (lastVer && lastVer.version && lastVer.version !== 'unknown') {
        const cf = lastVer.confidence || 0;
        const cfTag = cf >= 0.8 ? '' : ' (≈)';
        _version = 'oRTB ' + lastVer.version + cfTag;
      } else if (req.at !== undefined || req.imp) {
        _version = 'oRTB 2.x';
      }
    }

    // 2. Traffic + Format
    // No emoji. They render in a different font per OS, carry their own
    // colour, and sit off the baseline of the mono run beside them — the
    // mockup's context chip is plain text end to end.
    let trafficLabel = 'Web';
    if (req.app) {
      trafficLabel = 'In-App';
    } else if (req.site) {
      const dt = req.device && req.device.devicetype;
      trafficLabel = dt === 3 || dt === 7 ? 'CTV' : 'Web';
    }
    let formatLabel = '';
    const imp0 = req.imp && req.imp[0];
    if (imp0) {
      if (imp0.banner) formatLabel = 'Banner';
      else if (imp0.video) formatLabel = 'Video';
      else if (imp0.native) formatLabel = 'Native';
      else if (imp0.audio) formatLabel = 'Audio';
    }
    const _trafficValue = trafficLabel + (formatLabel ? ' (' + formatLabel + ')' : '');

    // 3. Device + OS
    let deviceLabel = '?';
    const dev = req.device || {};
    const make = (dev.make || '').toLowerCase();
    const os = (dev.os || '').toLowerCase();
    const ua = (dev.ua || '').toLowerCase();
    if (
      make.includes('apple') ||
      os.includes('ios') ||
      os.includes('macos') ||
      ua.includes('iphone') ||
      ua.includes('ipad')
    ) {
      deviceLabel =
        'Apple' +
        (os
          ? ' (' + (os.includes('ios') ? 'iOS' : os.includes('macos') ? 'macOS' : dev.os) + ')'
          : '');
    } else if (make.includes('google') || os.includes('android') || ua.includes('android')) {
      deviceLabel = 'Google (Android)';
    } else if (os.includes('windows') || ua.includes('windows')) {
      deviceLabel = 'PC (Windows)';
    } else if (dev.devicetype === 2 || ua.includes('macintosh')) {
      deviceLabel = 'PC';
    } else if (dev.make) {
      deviceLabel = dev.make + (dev.os ? ' (' + dev.os + ')' : '');
    }

    // 4. Privacy
    const regs = req.regs || {};
    const regsExt = regs.ext || {};
    const privBadges = [];
    if (regsExt.gdpr === 1 || regs.gdpr === 1) privBadges.push('GDPR');
    if (regsExt.us_privacy || regs.us_privacy) privBadges.push('CCPA');
    if (regs.gpp || regs.gpp_sid) privBadges.push('GPP');
    // Flat text. The mockup's chip values are one run of type — a nested
    // bordered pill inside a chip is a box inside a box saying the same
    // thing twice, and it was the only place on the row with two edges.
    const _privValue = privBadges.length
      ? escapeHtml(privBadges.join(' '))
      : escapeHtml(t('strip.privacy.none'));

    // 5. Pricing
    //
    // Three separate facts, kept separate: what the floor is, which currency
    // it is priced in, and — when that is not USD — roughly what it is worth
    // in USD. Per oRTB §3.2.4 imp.bidfloorcur overrides req.cur for this
    // impression, so it wins here; req.cur is the *allowed* set, and a floor
    // priced outside it is a real mismatch worth showing rather than hiding
    // behind a currency code nobody reads.
    let pricingValue = escapeHtml(t('strip.pricing.no_floor'));
    if (imp0 && imp0.bidfloor != null) {
      const allowed = Array.isArray(req.cur) ? req.cur.filter((c) => typeof c === 'string') : [];
      const cur = imp0.bidfloorcur || allowed[0] || 'USD';
      const outsideAllowed = allowed.length > 0 && allowed.indexOf(cur) === -1;

      // No "Floor: " prefix. It was a hardcoded English literal printed into
      // all three locales, so a Ukrainian reader got "Floor: 0,30 USD" — and it
      // repeated the column it sits in, which is labelled PRICE / ЦІНА / ЦЕНА
      // and whose own hint already says "the floor this impression asks for".
      // A label and its value saying the same word twice is the redundancy that
      // squeezed the figure: in Ukrainian the quality cell is 12px wider than in
      // English ("Критично" against "Critical"), that came out of the other five
      // cells, and the amount ended up 3px short of its own box. Dropping a
      // duplicate is a better answer than tuning a flex weight until three
      // pixels appear.
      pricingValue =
        escapeHtml(formatAmount(imp0.bidfloor, cur)) +
        ' <span class="floor-cur' +
        (outsideAllowed ? ' floor-cur-mismatch' : '') +
        '"' +
        (outsideAllowed
          ? ' title="' +
            escapeHtml(t('strip.pricing.not_allowed', { cur: cur, allowed: allowed.join(', ') })) +
            '"'
          : '') +
        '>' +
        escapeHtml(cur) +
        (outsideAllowed ? ' ⚠' : '') +
        '</span>' +
        // Filled in asynchronously once the rate table lands — the strip never
        // waits on the network to show the number that actually arrived.
        '<span class="floor-usd" data-floor-amount="' +
        escapeHtml(String(imp0.bidfloor)) +
        '" data-floor-cur="' +
        escapeHtml(cur) +
        '"></span>';
    }

    // The bar's labels are abbreviated because the bar is narrow: it gets the
    // width of the centre column, `viewport − ~900px`, which is 540px for six
    // labelled cells at an ordinary 1440px window. Full words at the scale's
    // smallest step did not fit — VERSION and PRIVACY grew wider than the cells
    // they shrink into and painted over their neighbours, and the room they took
    // was paid for by the values, which is the wrong way round: a reader can
    // infer a label from its column, never a price from a truncated one.
    //
    // So the label is short and a hint carries the meaning — not a re-spelling
    // of the same word, which would be one record restating another and free to
    // drift from it, but a plain-language line about what the column holds.
    // Both come from one place here rather than being repeated at six call
    // sites, so a label can never end up beside another column's explanation.
    const stripLabel = (key) =>
      '<div class="analysis-strip-label" title="' +
      escapeHtml(t('strip.hint.' + key)) +
      '">' +
      escapeHtml(t('strip.label.' + key)) +
      '</div>';

    // Chips the mockup adds beside the classic five: the winning bid when a
    // response has been analyzed, the creative size, and the declared intent.
    // All three come from data this function already holds — they were shown
    // only in the drawer before, which is the one place a reader deciding
    // "is this bid sane" was guaranteed not to be looking.
    let bidChip = '';
    const mPriceEl = document.getElementById('mPrice');
    const mPriceTxt = mPriceEl ? mPriceEl.textContent.trim() : '';
    // A winning bid exists when the figure has a nonzero digit — not when
    // the string fails to look like "$0.00". The first guard assumed the
    // currency sign leads, which is true in English and false in Ukrainian
    // and Russian ("0,00 $"), so both Slavic locales grew a chip announcing
    // a winning bid of zero on every request-only analysis.
    if (/[1-9]/.test(mPriceTxt)) {
      bidChip =
        '<div class="analysis-strip-block">' +
        stripLabel('bid') +
        '<div class="analysis-strip-value">' +
        escapeHtml(mPriceTxt) +
        '</div>' +
        '</div>';
    }

    let sizeChip = '';
    if (imp0 && imp0.banner && imp0.banner.w && imp0.banner.h) {
      sizeChip =
        '<div class="analysis-strip-block">' +
        stripLabel('creative') +
        '<div class="analysis-strip-value">' +
        escapeHtml(imp0.banner.w + '×' + imp0.banner.h) +
        '</div>' +
        '</div>';
    }

    let intentChip = '';
    const adtype = imp0 && imp0.ext && typeof imp0.ext.adtype === 'string' ? imp0.ext.adtype : '';
    if (adtype) {
      intentChip =
        '<div class="analysis-strip-block analysis-strip-intent">' +
        stripLabel('intent') +
        '<div class="analysis-strip-value">' +
        escapeHtml(adtype) +
        '</div>' +
        '</div>';
    }

    // Mockup order: money first, then what the impression is, then where it
    // runs. Version keeps a chip even though the work bar states it too — the
    // work bar shows the *pinned* selector state, this shows what the payload
    // itself declares, and the two disagreeing is worth seeing.
    // ONE context chip, as the mockup draws it: "web · mobile · UA/Kyiv ·
    // wifi". Traffic, device, geo and connection are four facts about the
    // same thing — where this impression runs — and splitting them into four
    // labelled cells made the row read as a table of unrelated fields. The
    // pieces are joined with the same middot the mockup uses and the cell
    // carries no label, because a reader does not need one to know that
    // "UA/Kyiv" is a place.
    const ctxParts = [];
    if (trafficLabel) ctxParts.push(trafficLabel.toLowerCase());
    if (deviceLabel && deviceLabel !== '?') ctxParts.push(deviceLabel);
    const geo = (req.device && req.device.geo) || {};
    if (geo.country) ctxParts.push(geo.country + (geo.city ? '/' + geo.city : ''));
    if (privBadges.length) ctxParts.push(privBadges.join(' '));
    const contextChip = ctxParts.length
      ? '<div class="analysis-strip-block analysis-strip-context">' +
        '<div class="analysis-strip-value">' +
        escapeHtml(ctxParts.join(' · ')) +
        '</div>' +
        '</div>'
      : '';

    // Five chips, the mockup's set and its order: what was bid, what the
    // floor asks, what the slot is, what it declares itself to be, and where
    // it runs. Version left the row because the work bar's own selector
    // states it two rows up; the quality score left it because the mockup
    // has no such concept and the verdict already says what to do.
    const stripHtml =
      bidChip +
      '<div class="analysis-strip-block analysis-strip-pricing">' +
      stripLabel('pricing') +
      '<div class="analysis-strip-value">' +
      pricingValue +
      '</div>' +
      '</div>' +
      sizeChip +
      intentChip +
      contextChip;

    // Quality Pill (Feature #12) — 6th block
    const qualityBlock = (function () {
      if (!findings || !findings.length) return '';
      const q = computeQualityScore(findings);
      const s = q.score;
      let tierClass, tierLabel;
      if (s >= 90) {
        tierClass = 'q-excellent';
        tierLabel = t('quality.status.excellent');
      } else if (s >= 70) {
        tierClass = 'q-good';
        tierLabel = t('quality.status.good');
      } else if (s >= 40) {
        tierClass = 'q-needs-attention';
        tierLabel = t('quality.status.needs_attention');
      } else {
        tierClass = 'q-critical';
        tierLabel = t('quality.status.critical');
      }

      // Build tooltip text
      const deductionParts = [];
      if (q.errors)
        deductionParts.push(
          q.errors + ' ' + t('quality.tooltip.error') + ' (-' + q.errors * 25 + ')',
        );
      if (q.warnings)
        deductionParts.push(
          q.warnings + ' ' + t('quality.tooltip.warning') + ' (-' + q.warnings * 10 + ')',
        );
      if (q.info)
        deductionParts.push(q.info + ' ' + t('quality.tooltip.info') + ' (-' + q.info * 2 + ')');
      const tooltipText =
        t('quality.tooltip.base') +
        ': 100 · ' +
        t('quality.tooltip.deductions') +
        ': ' +
        (deductionParts.length ? deductionParts.join(', ') : '0') +
        ' · ' +
        t('quality.tooltip.total') +
        ': ' +
        s +
        '/100';

      return (
        '<div class="analysis-strip-block analysis-strip-quality">' +
        stripLabel('quality') +
        '<div class="analysis-strip-value">' +
        '<span class="quality-pill ' +
        tierClass +
        '" data-tooltip="' +
        escapeHtml(tooltipText) +
        '" data-score="' +
        s +
        '">' +
        '<span class="quality-score">0</span>' +
        '<span class="quality-status">' +
        escapeHtml(tierLabel) +
        '</span>' +
        '</span>' +
        '</div>' +
        '</div>'
      );
    })();

    // The quality pill is not part of the mockup's chip row. It stays in the
    // DOM (the strip's own browser test asserts it, and the score is a real
    // signal) but as a trailing cell rather than a sixth labelled column
    // competing with the five facts the mockup put there.
    const fullStripHtml = stripHtml + qualityBlock;

    // The chips live inside the verdict block — the mockup's context row
    // under the headline — not in a band of their own. Same element, same id,
    // same classes; only its parent changed, so everything that addresses
    // #analysisStrip keeps working.
    let strip = document.getElementById('analysisStrip');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'analysisStrip';
      strip.className = 'analysis-strip';
    }
    const verdictHost = document.getElementById('verdict');
    if (verdictHost) {
      if (strip.parentElement !== verdictHost) verdictHost.appendChild(strip);
    } else if (!strip.parentElement) {
      const tabBar = document.querySelector('.center-panel .tab-bar');
      if (tabBar) tabBar.parentNode.insertBefore(strip, tabBar);
    }
    strip.innerHTML = fullStripHtml;
    strip.hidden = false;

    // Every value carries its own full text as a title, so an ellipsised cell
    // is still readable. This bar is only as wide as the centre column —
    // `viewport − ~900px`, so 540px for six labelled cells at a 1440px window —
    // and measured on that width four of the six were cut with no title, no
    // tooltip and no other route to the value. The text was simply gone.
    //
    // Done here in one pass over the rendered result rather than at each of the
    // six places that build a cell: those are six chances to forget, and a
    // seventh cell added later would arrive without one. Reading it back off
    // the DOM cannot disagree with what was rendered.
    //
    // Set unconditionally rather than only when scrollWidth exceeds clientWidth,
    // because whether a cell is truncated changes with every resize and a title
    // computed once would then describe the width it was measured at. A tooltip
    // repeating text you can already read is a much smaller cost than a value
    // you cannot recover.
    // The quality block is excluded for two measured reasons. Its score counts
    // up from 0 over 400ms, so a title read at this instant says "0Critical"
    // while the cell settles on "29Critical" — a record taken in one moment and
    // never checked against what happened next, which is the exact defect this
    // title exists to avoid. And its pill already owns a richer tooltip: the
    // score breakdown, which was unreachable until it was fixed. A crude title
    // on the ancestor would compete with it and win.
    for (const valueEl of strip.querySelectorAll(
      '.analysis-strip-block:not(.analysis-strip-quality) .analysis-strip-value',
    )) {
      const full = valueEl.textContent.trim();
      if (full) valueEl.setAttribute('title', full);
    }

    // USD equivalent, painted in as soon as the rate table is available. The
    // strip is already complete and correct without it.
    paintFloorUsd();

    // Animate quality pill count-up (Feature #12)
    // Uses setTimeout-based ticks so it works even in background tabs
    // where requestAnimationFrame is throttled to ~1fps.
    const pillEl = strip.querySelector('.quality-pill');
    if (pillEl) {
      const numberEl = pillEl.querySelector('.quality-score');
      const target = parseInt(pillEl.getAttribute('data-score'), 10) || 0;
      const duration = 400;
      const frameMs = 16; // ~60fps via setTimeout
      const startTime = Date.now();
      function tickQuality() {
        // Stop the self-rescheduling chain once the module unmounts — otherwise
        // it keeps ticking for up to `duration` ms against a detached numberEl.
        if (ctx.signal.aborted) return;
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        numberEl.textContent = Math.round(target * eased);
        if (t < 1) setTimeout(tickQuality, frameMs);
      }
      tickQuality();
    }
  }
  window.renderAnalysisStrip = renderAnalysisStrip;

  // ── Feature #14: Severity Filter Chips ─────────────────────────────────
  // Renders severity chips (All / Errors / Warnings / Info) above a findings
  // list in a tab container. `container` is the tab's DOM element.
  // `findings` is the array of finding objects. `headerHtml` is the header
  // row HTML (mono-label + version pill) that sits above the chips.
  function renderSeverityTabs(container, findings, headerHtml) {
    function buildFindingHtml(f) {
      const lvl = f.level === 'danger' ? 'error' : f.level;
      const cls =
        lvl === 'error'
          ? 'danger'
          : lvl === 'info'
            ? 'info'
            : lvl === 'question'
              ? 'question'
              : 'warning';

      // The mockup's card splits a finding into a bold claim and a quieter
      // explanation. Our engine writes both into one msg, first sentence
      // first — so the split point is the first sentence boundary, and a msg
      // without one is all title. No per-row severity icon: severity is the
      // group header and the card's leading edge, stated once.
      //
      // Response-side findings arrive with a literal "[response] " prefix —
      // the backend's display hack for the old flat list, where a text tag
      // was the only way to say which pane a finding belongs to. In a card
      // that bolds its first line, the tag reads as a broken message id
      // ("[res…" was the first thing the user saw in the Info group). The
      // side moves into a badge; the sentence starts with its own words.
      let msg = String(f.msg || '');
      let side = '';
      const sideTag = msg.match(/^\[(request|response)\]\s+/);
      if (sideTag) {
        side = sideTag[1];
        msg = msg.slice(sideTag[0].length);
      }
      const cut = msg.indexOf('. ');
      const title = cut > 0 ? msg.slice(0, cut + 1) : msg;
      const rest = cut > 0 ? msg.slice(cut + 2) : '';
      const sideBadge = side
        ? '<span class="finding-side">' + escapeHtml(t('finding.side.' + side)) + '</span>'
        : '';

      // ── Which pane does this finding actually talk about? ────────────────
      // `location.primary.side` is the authoritative answer and the only one
      // allowed to be believed: finding-location.js derives it from the
      // validate() call context and its header carries a HARD RULE against
      // ever re-deriving it from an id or a path. The "[response] " prefix
      // parsed above is the older, weaker signal — a display hack that only
      // ever tagged the response half — so it stays as the fallback for
      // findings that arrive without the location contract at all. That is a
      // real population, not a theoretical one: the temp-dialect runtime
      // (OrtbtoolsIntel.applyToFindings) pushes its own findings onto
      // validation.findings in the browser, after the server attached
      // locations to everything it produced.
      //
      // Carried on the <details> because the detail body is rendered lazily
      // from `d.dataset` on first open, long after this closure is gone.
      // Until it was, that body guessed the side with a regex over the
      // finding id — precisely what the contract forbids — and got
      // err-bid-currency-invalid wrong in the most confusing way available:
      // its id has no `response.` prefix and its path is a bare `cur`, so the
      // guess said "request", the panel printed the REQUEST's ["USD"], and
      // the badge two lines above it said "response".
      const locSide = f.location && f.location.primary ? f.location.primary.side : null;
      const authoritativeSide = locSide === 'request' || locSide === 'response' ? locSide : side;

      // The `· line N` suffix is a placeholder here and filled by a post-pass
      // over the rendered list. The line can only be known by resolving the
      // pointer against the editor's current text, which source-nav already
      // does for the jump this same chip performs — asking it once, after
      // render, keeps one answer to that question instead of two.
      const pathChip = f.path
        ? '<button type="button" class="finding-path" data-action="goto-path" data-jsonpath="' +
          escapeHtml(f.path) +
          '" data-loc="' +
          // &quot;-escape: data-loc holds JSON (full of quotes) in a double-quoted
          // attribute; escapeHtml alone leaves the quotes raw → the attribute
          // truncates at the first " and JSON.parse fails (the jump silently no-ops).
          (f.location ? escapeHtml(JSON.stringify(f.location)).replace(/"/g, '&quot;') : '') +
          '" title="Jump to this path in the JSON">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<span class="finding-path-text">' +
          escapeHtml(f.path) +
          '</span><span class="finding-line" hidden></span>' +
          '</button>'
        : '';
      const specLink = f.specRef
        ? '<a class="finding-spec" href="' +
          escapeHtml(f.specRef) +
          '" target="_blank" rel="noopener noreferrer" title="OpenRTB spec reference">spec ↗</a>'
        : '';
      const code = f.id ? '<span class="finding-code">' + escapeHtml(f.id) + '</span>' : '';

      // The mockup gives the reader ONE expanded card — the blocking one —
      // and collapses everything below it to a title plus its path. Fifteen
      // paragraphs stacked is not a list you scan, it is a document you read,
      // and the group that matters is the one you have to scroll past.
      //
      // A CLASS, not `<details open>`. Opening the element also renders the
      // lazy detail body — JSON path, current value, severity, spec ref, rule
      // id — which is a 450px panel the mockup's lead card does not have. The
      // difference the mockup draws is only whether the description and the
      // action row are visible; the detail body stays behind a real click.
      const expanded = lvl === 'error';

      // The action a finding asks for, in the mockup's words. `question`
      // findings ask you to map a field; everything else asks you to edit the
      // payload, and both routes already exist behind data-action="goto-path".
      // A `question` finding gets two routes, because the two are not the same
      // act. "Розмітити" opens the picker and the user names the signal
      // themselves. "Спитати агента" asks the server first — a deterministic
      // lexicon, then the local model for what the lexicon abstains on — and
      // opens the same picker with the proposal filled in and badged with
      // where it came from. Neither writes anything; the save is the click
      // inside the picker, because a saved mapping silently re-applies to
      // every future payload the user analyses.
      //
      // The signal travels on the button rather than being re-derived from
      // the payload at click time: by then the editor may have been edited,
      // and labelling a signal the analysis never saw is worse than not
      // offering the button.
      const qData =
        lvl === 'question' && f.params
          ? ' data-signal-path="' +
            escapeHtml(f.params.path || f.path || '') +
            '" data-signal-value="' +
            escapeHtml(String(f.params.value == null ? '' : f.params.value)) +
            '" data-shape-signature="' +
            escapeHtml(f.params.shape_signature || '') +
            '"'
          : '';
      const actionBtn =
        lvl === 'question'
          ? '<button type="button" class="finding-action finding-action-accent" ' +
            'data-action="open-dialect-builder"' +
            qData +
            '>' +
            escapeHtml(t('finding.action.map')) +
            '</button>' +
            '<button type="button" class="finding-action finding-action-agent" ' +
            'data-action="ask-dialect-agent"' +
            qData +
            '>' +
            escapeHtml(t('dialect.label.ask')) +
            '</button>'
          : expanded && f.path
            ? '<button type="button" class="finding-action" data-action="goto-path" ' +
              'data-jsonpath="' +
              escapeHtml(f.path) +
              '" data-loc="' +
              (f.location ? escapeHtml(JSON.stringify(f.location)).replace(/"/g, '&quot;') : '') +
              '">' +
              escapeHtml(t('finding.action.fix')) +
              '</button>'
            : '';

      const foot =
        pathChip || specLink || actionBtn
          ? '<span class="finding-foot">' + pathChip + specLink + actionBtn + '</span>'
          : '';

      return (
        '<details class="validation-item ' +
        cls +
        ' finding-detail' +
        (expanded ? ' is-lead' : '') +
        '" data-finding-id="' +
        escapeHtml(f.id || '') +
        '" data-finding-path="' +
        escapeHtml(f.path || '') +
        '" data-finding-level="' +
        escapeHtml(lvl || '') +
        '" data-finding-side="' +
        escapeHtml(authoritativeSide || '') +
        '" data-finding-spec="' +
        escapeHtml(f.specRef || '') +
        '">' +
        '<summary>' +
        '<span class="finding-row">' +
        '<span class="finding-main">' +
        '<span class="finding-title">' +
        sideBadge +
        escapeHtml(title) +
        '</span>' +
        (rest ? '<span class="finding-desc">' + escapeHtml(rest) + '</span>' : '') +
        '</span>' +
        code +
        '</span>' +
        foot +
        (expanded
          ? ''
          : '<span class="finding-detail-toggle" aria-hidden="true">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="m6 9 6 6 6-6"/></svg></span>') +
        '</summary>' +
        '<div class="finding-detail-body" data-detail-rendered="0"></div>' +
        '</details>'
      );
    }

    // ── Groups, not filters ────────────────────────────────────────────────
    // The mockup sections findings by what the reader should do about them —
    // Blocking / Should fix / Needs your input — instead of offering a filter
    // row. A group is a filter that costs nothing: every severity is visible,
    // labelled and counted at once, and severity itself is stated by the
    // section header rather than repeated on every row.
    //
    // GROUPS is the complete map of Core's finding levels. The coverage test
    // asserts both directions against packages/core LEVELS: a new level with
    // no group would silently vanish from the panel, and a group for a level
    // Core no longer emits is a section that can never render.
    const GROUPS = [
      { key: 'blocking', level: 'error', labelKey: 'group.blocking', tone: 'danger' },
      { key: 'should_fix', level: 'warning', labelKey: 'group.should_fix', tone: 'warning' },
      { key: 'needs_input', level: 'question', labelKey: 'group.needs_input', tone: 'question' },
      { key: 'info', level: 'info', labelKey: 'group.info', tone: 'info' },
    ];

    function groupsHtml() {
      const sections = GROUPS.map((g) => {
        const items = findings.filter((f) => {
          const l = f.level === 'danger' ? 'error' : f.level;
          return l === g.level;
        });
        if (!items.length) return '';
        return (
          '<section class="finding-group finding-group-' +
          g.tone +
          '">' +
          '<div class="finding-group-head">' +
          '<span class="finding-group-label">' +
          escapeHtml(t(g.labelKey)) +
          '</span>' +
          '<span class="finding-group-count">' +
          items.length +
          '</span>' +
          '<span class="finding-group-rule"></span>' +
          '</div>' +
          items.map(buildFindingHtml).join('') +
          '</section>'
        );
      }).join('');
      return '<div class="findings-list findings-grouped">' + sections + '</div>';
    }

    container.innerHTML = (headerHtml || '') + groupsHtml();
    paintFindingLines(container);
    for (const id of Object.keys(GUTTER_OF)) renderGutter(id);
    paintGutterSeverity(findings);
  }
  window.renderSeverityTabs = renderSeverityTabs;

  /**
   * Fill each path chip's "· line N" from the finding's own location.
   *
   * Done as one pass over the rendered list rather than inside the template:
   * the line number is not a property of a finding, it is a property of the
   * finding AGAINST the text currently in the editor. Only source-nav can
   * answer that — it owns the pointer→offset map the jump uses — and asking
   * it here means the number beside a chip and the line that chip scrolls to
   * are computed by the same code. A second implementation in the template
   * would be free to disagree, and the disagreement would be silent.
   *
   * A finding whose pointer does not resolve keeps its chip and shows no
   * line, which is honest: the alternative is inventing one.
   */
  function paintFindingLines(root) {
    const nav = window.OrtbtoolsSourceNav;
    if (!nav || typeof nav.lineFor !== 'function') return;
    for (const chip of root.querySelectorAll('.finding-path')) {
      const slot = chip.querySelector('.finding-line');
      if (!slot) continue;
      let loc = null;
      try {
        loc = JSON.parse(chip.getAttribute('data-loc') || 'null');
      } catch (_e) {
        loc = null;
      }
      const line = loc ? nav.lineFor(loc) : null;
      if (line) {
        slot.textContent = ' · ' + t('finding.line', { n: line });
        slot.hidden = false;
      } else {
        slot.textContent = '';
        slot.hidden = true;
      }
    }
  }

  function renderBehaviorTab() {
    const tab = $('tBehavior');
    const badge = $('behaviorBadge');
    if (!tab || !badge) return;
    const all = (window.__ortbtoolsBehavior && window.__ortbtoolsBehavior.events) || [];
    // probe_ready is an internal signal, not user-visible.
    const events = all.filter((e) => e.kind !== 'probe_ready');
    setTabBadge('behaviorBadge', { text: events.length || '' });
    // Phase 1 Behavior epic: delegate body render to the Behavior module
    // (public/modules/behavior/index.js) when it's loaded. The module
    // posts events to /api/analyze-behavior and renders findings above
    // the raw event timeline. Fallback below remains for boot-order
    // resilience — if the module script hasn't parsed yet, we still
    // render the timeline so the tab isn't blank.
    if (window.OrtbtoolsBehavior && typeof window.OrtbtoolsBehavior.render === 'function') {
      window.OrtbtoolsBehavior.render(tab, all, {
        emptyMessage: t('behavior.empty'),
        findingsHeading: t('behavior.heading.findings'),
        timelineHeading: t('behavior.heading.timeline'),
        triggerLabel: t('behavior.label.trigger'),
        kindLabels: {
          click_skim_suspect: t('behavior.kind.click_skim_suspect'),
          auto_navigate: t('behavior.kind.auto_navigate'),
          window_open: t('behavior.kind.window_open'),
          navigation: t('behavior.kind.navigation'),
          location_set: t('behavior.kind.location_set'),
          programmatic_click: t('behavior.kind.programmatic_click'),
          invisible_overlay_click: t('behavior.kind.invisible_overlay_click'),
          center_synth_click: t('behavior.kind.center_synth_click'),
          click_burst: t('behavior.kind.click_burst'),
          phantom_click: t('behavior.kind.phantom_click'),
          frame_bust_anchor: t('behavior.kind.frame_bust_anchor'),
          frame_bust_form: t('behavior.kind.frame_bust_form'),
          heavy_ad_cpu: t('behavior.kind.heavy_ad_cpu'),
          heavy_ad_network: t('behavior.kind.heavy_ad_network'),
          frozen_thread: t('behavior.kind.frozen_thread'),
          permission_abuse: t('behavior.kind.permission_abuse'),
          static_obfuscation: t('behavior.kind.static_obfuscation'),
          static_miner: t('behavior.kind.static_miner'),
          static_xss_marker: t('behavior.kind.static_xss_marker'),
          static_high_entropy: t('behavior.kind.static_high_entropy'),
        },
        locale: activeLocale(),
      });
      injectCorpusBar(tab, events);
      return;
    }
    if (!events.length) {
      tab.innerHTML = '<div class="empty-hint">' + escapeHtml(t('behavior.empty')) + '</div>';
      return;
    }
    tab.innerHTML = events
      .map((ev) => {
        const sev = severityForKind(ev.kind);
        const cls = sev === 'danger' ? 'danger' : sev === 'warning' ? 'warning' : 'info';
        const ic = sev === 'danger' ? '✕' : sev === 'warning' ? '!' : 'i';
        const url = ev.url ? String(ev.url) : '';
        const urlSnip = url.length > 90 ? escapeHtml(url.slice(0, 90)) + '…' : escapeHtml(url);
        return (
          '<div class="validation-item ' +
          cls +
          '">' +
          '<span class="validation-icon">' +
          ic +
          '</span>' +
          '<span>' +
          '<strong>' +
          escapeHtml(humanizeBehaviorKind(ev.kind)) +
          '</strong>' +
          ' <span style="color:var(--text-dim);font-family:var(--font-mono);font-size:10px">' +
          escapeHtml(ev.method || '') +
          '</span>' +
          (url
            ? ' → <span style="font-family:var(--font-mono);font-size:11px;color:var(--text)">' +
              urlSnip +
              '</span>'
            : '') +
          (ev.trigger
            ? ' <span style="color:var(--text-dim);font-family:var(--font-mono);font-size:10px">[' +
              t('behavior.label.trigger') +
              ': ' +
              escapeHtml(ev.trigger) +
              ']</span>'
            : '') +
          '</span>' +
          '</div>'
        );
      })
      .join('');
    injectCorpusBar(tab, events);
  }
  window.renderBehaviorTab = renderBehaviorTab;

  // Behavior corpus capture bar — appears at the top of the behavior tab
  // when there are events AND user is authed (corpus is per-user). Renders
  // independently of the behavior module so adding/removing it doesn't
  // require coordinating with public/modules/behavior/index.js.
  function injectCorpusBar(tab, events) {
    if (!tab || !events || !events.length) return;
    if (!session.user) return;
    // Renderer fires on every probe heartbeat. Reuse the existing bar if
    // event count hasn't changed; only update / re-create when the count
    // actually changed. Pre-fix removed+re-injected the bar 10×/sec under
    // active probes, causing layout thrash.
    const existing = tab.querySelector('.kt-corpus-bar');
    if (existing && existing.dataset.eventCount === String(events.length)) {
      return;
    }
    if (existing) existing.remove();
    const eventCount = events.length;
    const bar =
      '<div class="kt-corpus-bar" data-event-count="' +
      eventCount +
      '">' +
      '<span class="kt-corpus-bar-label">' +
      escapeHtml(t('corpus.bar.label', { count: eventCount })) +
      '</span>' +
      '<button class="btn btn-ghost btn-sm" data-action="open-corpus-save">' +
      '💾 ' +
      escapeHtml(t('corpus.bar.save_btn')) +
      '</button>' +
      '</div>';
    tab.insertAdjacentHTML('afterbegin', bar);
  }
  window.injectCorpusBar = injectCorpusBar;

  // Render a Native 1.1 response as a card mockup so the user sees what the
  // creative will look like, not raw JSON.
  function renderNativeToHtml(native) {
    // Asset id semantics aren't fixed in the spec — most SSPs follow IAB
    // conventions: 1=title, 2=icon/image, 3=desc/sponsored. We pick by
    // structural cues (asset.title / asset.img / asset.data) since IDs are
    // routinely miswired in the wild.
    let title = null,
      img = null,
      icon = null,
      desc = null,
      sponsored = null;
    for (const a of native.assets || []) {
      if (a.title && a.title.text) title = a.title.text;
      if (a.img && a.img.url) {
        const w = Number(a.img.w || 0),
          h = Number(a.img.h || 0);
        // Heuristic: small square = icon, larger = main image.
        if (icon == null && w && h && w === h && w <= 200) icon = a.img.url;
        else if (img == null) img = a.img.url;
      }
      if (a.data && a.data.value) {
        if (desc == null) desc = a.data.value;
        else if (sponsored == null) sponsored = a.data.value;
      }
    }
    const link = (native.link && native.link.url) || '#';

    // Self-contained: the iframe's sandboxed document doesn't inherit
    // /design-system.css, so every style ships inline. No target attribute
    // on the anchor — see setAdPreview comment for the rationale.
    return (
      '<!doctype html><html><head><meta charset="utf-8"><style>' +
      "html,body{margin:0;padding:0;background:#fff;color:#1a1a1a;font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif}" +
      'a.card{display:block;text-decoration:none;color:inherit;padding:12px;box-sizing:border-box;height:100%;overflow:auto}' +
      '.label{font:10px/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:#888;margin-bottom:8px}' +
      '.hero{width:100%;max-height:140px;border-radius:4px;overflow:hidden;background:#f3f3f3;margin-bottom:10px}' +
      '.hero img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.row{display:flex;gap:10px;align-items:flex-start}' +
      '.icon{width:44px;height:44px;border-radius:4px;object-fit:cover;flex-shrink:0;background:#f3f3f3}' +
      '.body{flex:1;min-width:0}' +
      '.t{font-weight:600;font-size:13px;line-height:1.35;margin-bottom:4px}' +
      '.t.muted{color:#888;font-weight:400}' +
      '.d{font-size:11.5px;color:#555;line-height:1.45}' +
      '.s{font:10px/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:#888;margin-top:6px}' +
      '.u{font:10px/1.3 ui-monospace,monospace;color:#888;margin-top:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '</style></head><body>' +
      '<a class="card" href="' +
      escapeHtml(link) +
      '" rel="noopener noreferrer">' +
      '<div class="label">native · synthetic render</div>' +
      (img ? '<div class="hero"><img src="' + escapeHtml(img) + '" alt=""></div>' : '') +
      '<div class="row">' +
      (icon ? '<img class="icon" src="' + escapeHtml(icon) + '" alt="">' : '') +
      '<div class="body">' +
      (title
        ? '<div class="t">' + escapeHtml(title) + '</div>'
        : '<div class="t muted">No title asset</div>') +
      (desc ? '<div class="d">' + escapeHtml(desc) + '</div>' : '') +
      (sponsored ? '<div class="s">' + escapeHtml(sponsored) + '</div>' : '') +
      '</div></div>' +
      (native.link && native.link.url
        ? '<div class="u">→ ' + escapeHtml(native.link.url) + '</div>'
        : '') +
      '</a></body></html>'
    );
  }

  // ── Analysis ──────────────────────────────────────────────────
  // History: in-memory ring of recent analyses, persisted to localStorage so
  // a refresh doesn't lose state. Cap at HISTORY_MAX entries to keep the
  // localStorage footprint bounded (each entry can be up to ~2MB raw if user
  // pastes a huge payload — the cap is the only soft limit we have).
  // The `_v1` suffix on the key IS the schema version. If we ever change
  // the entry shape incompatibly, bump to `_v2` and the v1 data is
  // ignored. Within the v1 schema, individual entries are validated on
  // load so a single corrupted row doesn't poison the whole list.
  const HISTORY_KEY = 'ortbtools_history_v1';
  const HISTORY_MAX = 50;
  const historyStore = (() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (!saved) return [];
      const arr = JSON.parse(saved);
      if (!Array.isArray(arr)) return [];
      // Drop entries that don't even have the required fields. Anything
      // not an object, missing a timestamp, or lacking both req+res
      // payloads is a corruption artifact (incomplete write, manual
      // tinkering, schema drift) — skip it rather than crash later
      // accessors.
      return arr
        .filter(
          (e) =>
            e &&
            typeof e === 'object' &&
            // Accept entries with a numeric ts (new format) OR a time string
            // (entries written before ts was added to the schema — migration path).
            (typeof e.ts === 'number' || typeof e.time === 'string') &&
            (typeof e.req === 'string' || typeof e.res === 'string'),
        )
        .slice(0, HISTORY_MAX);
    } catch {
      return [];
    }
  })();
  /**
   * The clock time of a history entry, in the locale the PAGE is in.
   *
   * `new Date().toLocaleTimeString()` with no argument formats in the
   * BROWSER's locale, which has nothing to do with the one the user chose
   * here: on a machine set to en-US the Ukrainian sidebar listed
   * "11:54:02 AM ПОПЕРЕДЖЕННЯ" — an English 12-hour clock inside a
   * Ukrainian row, when uk uses a 24-hour one. Everything else numeric in
   * this file already goes through activeLocaleTag(); the timestamp had
   * simply been left out of it.
   *
   * Formatted at RENDER time from the stored epoch rather than at write
   * time, for two reasons: entries already sitting in localStorage — whose
   * `time` string was frozen in whatever locale wrote them — are corrected
   * the moment the list repaints, and a language switch re-renders the list
   * (kt:lang-change → renderHistory), so the rows follow the switch instead
   * of keeping the clock of the locale they were recorded in.
   *
   * `e.time` remains the fallback for pre-`ts` entries, which the loader
   * above deliberately still accepts.
   */
  function historyTime(e) {
    if (!e) return '';
    if (typeof e.ts === 'number' && isFinite(e.ts)) {
      try {
        return new Date(e.ts).toLocaleTimeString(activeLocaleTag());
      } catch (_err) {
        /* bad tag or ancient engine — fall through to the stored string */
      }
    }
    return e.time || '';
  }

  function persistHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(historyStore.slice(0, HISTORY_MAX)));
    } catch (_e) {
      // QuotaExceeded — drop oldest half until it fits, or give up gracefully.
      try {
        historyStore.length = Math.floor(historyStore.length / 2);
        // Clamp the active-entry pointer so we don't render a phantom
        // selection at an index that no longer exists.
        if (_currentHistoryIdx >= historyStore.length) _currentHistoryIdx = -1;
        localStorage.setItem(HISTORY_KEY, JSON.stringify(historyStore));
      } catch {
        /* persistence is best-effort; in-memory store keeps working */
      }
    }
  }
  // Index of the history entry currently loaded into the editor (so we can
  // highlight it). Set on every loadFromHistory + reset to 0 (top of stack)
  // after a fresh analysis. -1 = nothing in editor matches any entry.
  let _currentHistoryIdx = -1;

  // Cross-tab history sync. When tab A analyses a request and persists
  // to localStorage, the `storage` event fires in OTHER tabs of the
  // same origin. Catch it, refresh our in-memory mirror, re-render the
  // sidebar — without this, tab B kept showing stale history until F5.
  // Skip same-key writes from this tab (event.key is null when caller
  // is the originator's storage.setItem? no — actually the event fires
  // ONLY in other tabs, never the originating one. Safe to mutate).
  window.addEventListener(
    'storage',
    (e) => {
      if (e.key !== HISTORY_KEY) return;
      try {
        const raw = e.newValue ? JSON.parse(e.newValue) : [];
        historyStore.length = 0;
        if (Array.isArray(raw)) {
          for (const entry of raw.slice(0, HISTORY_MAX)) {
            if (
              entry &&
              typeof entry === 'object' &&
              typeof entry.ts === 'number' &&
              (typeof entry.req === 'string' || typeof entry.res === 'string')
            ) {
              historyStore.push(entry);
            }
          }
        }
        // Active-entry pointer may have shifted; clamp.
        if (_currentHistoryIdx >= historyStore.length) _currentHistoryIdx = -1;
        if (typeof renderHistory === 'function') renderHistory();
      } catch (_e) {
        /* parse error → leave in-memory store as-is */
      }
    },
    { signal: ctx.signal },
  );

  function renderHistory() {
    const list = $('hList');
    if (!list) return;
    if (!historyStore.length) {
      list.innerHTML =
        '<div style="color:var(--text-dim);font-size:var(--fs-sm);text-align:center;padding:var(--space-5)">' +
        t('history.empty') +
        '</div>';
      return;
    }
    list.innerHTML = historyStore
      .map((e, i) => {
        const cls = e.status === 'errors' || e.status === 'Critical' ? 'critical' : 'healthy';
        const activeCls = i === _currentHistoryIdx ? ' history-item--active' : '';
        return (
          '<div class="history-item' +
          activeCls +
          '" tabindex="0" data-action="history-load" data-idx="' +
          i +
          '">' +
          '<div class="history-actions">' +
          '<button class="history-act-btn" data-action="history-peek" data-idx="' +
          i +
          '" title="' +
          escapeHtml(t('tooltip.peek_no_load')) +
          '">👁</button>' +
          '<button class="history-act-btn danger" data-action="history-delete" data-idx="' +
          i +
          '" title="' +
          escapeHtml(t('tooltip.history_delete')) +
          '">×</button>' +
          '</div>' +
          '<div class="history-title">' +
          // Phase 8: domain-mask sensitive sources so the History list
          // is safe to show in screenshots / pair-debugging / live
          // demos. Adult and casino-shaped tokens get masked
          // (porn / xxx / adult / casino / poker / slot / bet / etc.);
          // everything else passes through.
          escapeHtml(maskDomain(e.title)) +
          '</div>' +
          '<div class="history-meta">' +
          '<span>' +
          escapeHtml(historyTime(e)) +
          '</span>' +
          '<span class="history-status ' +
          cls +
          '">' +
          escapeHtml(humanStatus(e.status) || e.status || '') +
          '</span>' +
          '</div></div>'
        );
      })
      .join('');
  }
  // History-item click handler — populates the editor textareas with the
  // saved JSON, then re-runs analysis. Without the value-set step the
  // user saw the toast "Завантажено · X" but the editors stayed empty —
  // confusing because they had no copy of the JSON to tweak. JS `.value`
  // assignment doesn't fire input events (per HTML spec), so `_isDirty`
  // stays false — no false-positive clobber-protection on next load.
  function loadFromHistory(idx) {
    const entry = historyStore[idx];
    if (!entry) return;
    setEditorValue('bidReq', entry.req || '');
    setEditorValue('bidRes', entry.res || '');
    updateCharCount('bidReq');
    updateCharCount('bidRes');
    _currentHistoryIdx = idx;
    _isDirty = false;
    runAnalysis(entry);
    renderHistory(); // re-render to update the active-highlight
    toast(t('toast.loaded', { title: entry.title || t('fallback.history_entry') }), 'success');
  }
  // Per-item delete from history. Cheap because historyStore is in-memory
  // + localStorage persist; no server roundtrip.
  function deleteHistoryItem(idx) {
    if (!historyStore[idx]) return;
    historyStore.splice(idx, 1);
    // Active-index stays consistent: if we deleted the active one, drop the
    // anchor; if we deleted ABOVE the active, shift its index down.
    if (idx === _currentHistoryIdx) _currentHistoryIdx = -1;
    else if (idx < _currentHistoryIdx) _currentHistoryIdx--;
    persistHistory();
    renderHistory();
  }
  // Peek modal: show the request/response JSON for an entry without
  // clobbering the editor. Read-only — for "did I save the right one
  // earlier?" lookups.
  function peekHistoryItem(idx) {
    const e = historyStore[idx];
    if (!e) return;
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
      '<div class="modal-card" style="max-width:720px;width:90vw">' +
      '<div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)">' +
      '<span>' +
      escapeHtml(e.title || t('fallback.history_entry')) +
      ' · ' +
      escapeHtml(historyTime(e)) +
      '</span>' +
      '<span class="mono-label" style="color:var(--text-dim)">' +
      escapeHtml(humanStatus(e.status) || e.status || '') +
      '</span>' +
      '</div>' +
      '<div style="font-family:var(--font-mono);font-size:11px;max-height:50vh;overflow:auto;border:1px solid var(--border);border-radius:4px;padding:var(--space-3);background:var(--bg-2);margin-bottom:var(--space-3)">' +
      '<div class="mono-label" style="margin-bottom:var(--space-2)">' +
      t('peek.label.bid_req') +
      '</div>' +
      '<pre style="white-space:pre-wrap;word-break:break-word;margin:0">' +
      escapeHtml(e.req || '') +
      '</pre>' +
      (e.res
        ? '<div class="mono-label" style="margin:var(--space-3) 0 var(--space-2)">' +
          t('peek.label.bid_res') +
          '</div>' +
          '<pre style="white-space:pre-wrap;word-break:break-word;margin:0">' +
          escapeHtml(e.res) +
          '</pre>'
        : '') +
      '</div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
      t('btn.close') +
      '</button>' +
      '<button id="peekLoadBtn" class="btn btn-primary btn-sm">' +
      t('btn.load_to_editor') +
      '</button>' +
      '</div></div></div>';
    const peekLoadBtn = $('peekLoadBtn');
    if (peekLoadBtn) {
      peekLoadBtn.addEventListener('click', () => {
        window.closeModal();
        loadFromHistory(idx);
      });
    }
  }
  window.clearHistory = function () {
    if (!historyStore.length) return;
    if (!confirm(t('confirm.clear_history'))) return;
    historyStore.length = 0;
    _currentHistoryIdx = -1;
    persistHistory();
    renderHistory();
    toast(t('toast.history_cleared'), 'success');
  };

  // Monotonic counter so a slow analyze can't render its findings on top
  // of a faster one fired afterward. Each call increments + captures.
  // Stale completions are dropped silently.
  let _analyzeReqSeq = 0;
  // AbortController for the in-flight analyze fetch. Pre-fix the seq
  // counter (`_analyzeReqSeq`) only prevented STALE responses from
  // overwriting the UI — the actual fetch still ran to completion,
  // wasting server CPU and the user's bandwidth on results we'd discard.
  // With AbortController, mashing "analyze" or fast-typing into the
  // textareas cancels the previous fetch on the wire.
  let _analyzeAbort = null;
  // Re-entrancy: on unmount, cancel any in-flight analyze. Its seq guard
  // (`_analyzeReqSeq`) is per-mount, so without this the old fetch would resolve
  // after a remount, pass its (stale-but-unbumped) seq check, and paint the
  // previous payload's findings into the NEW mount via $()/getElementById. The
  // render paths below also bail on ctx.signal.aborted as a belt-and-braces guard.
  ctx.addCleanup(() => {
    if (_analyzeAbort) {
      try {
        _analyzeAbort.abort();
      } catch (_) {
        /* idempotent */
      }
    }
  });

  // Bytes of the request pane as the operator pasted them, kept across the
  // pretty-print that would otherwise erase duplicate keys and oversized
  // integer spellings. Reset when the operator edits the pane.
  let _rawBeforePretty = null;
  let _prettyPrintedReq = null;
  // The same two, for the response pane. Pre-fix only the request pane kept
  // its bytes, so a duplicate `id` or a price past 2^53-1 in a BidResponse was
  // unreportable — the pane was pretty-printed on the way out and nothing
  // upstream ever saw the spelling. Same pair, same invalidation rule.
  let _rawBeforePrettyRes = null;
  let _prettyPrintedRes = null;

  /**
   * An oRTB payload is an object. `JSON.parse` is happy to hand back `null`,
   * `[]`, `42` or `"x"` for text that is perfectly valid JSON and not a
   * payload, and every read below (`req.site`, `res.seatbid`, …) assumes an
   * object. Say which pane and which root, in words, instead of letting the
   * first property read throw "Cannot read properties of null (reading
   * 'site')" from somewhere in the middle of the render.
   *
   * `allowUrlString` is the request pane only: a bare URL is a legitimate
   * request shape there (clickunder/teaser/pop GET), decoded server-side.
   */
  function assertJsonRoot(value, paneText, paneLabelKey, allowUrlString) {
    // Empty pane is not an error — the caller substitutes `{}` and the
    // request-only / response-only branches take it from there.
    if (!paneText) return;
    if (allowUrlString && typeof value === 'string') return;
    if (value && typeof value === 'object' && !Array.isArray(value)) return;
    const root = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    throw new Error(t('error.json_root_not_object', { pane: t(paneLabelKey), root }));
  }

  /**
   * The empty state the template ships with, captured once before the first
   * analysis paints over it. Restoring it is how "clear" returns to a page
   * that states nothing, instead of one that keeps stating the previous
   * payload's verdict under an editor the user just emptied.
   *
   * Captured rather than re-authored because the copy already exists in three
   * locales inside the templates; a second set of strings here would be a
   * second thing to keep in sync, and it would drift.
   */
  const PRISTINE_PANEL_IDS = ['tValidation', 'tCross', 'tBehavior', 'slotGrid', 'quickStats'];
  let _pristinePanels = null;
  function capturePristinePanels() {
    if (_pristinePanels) return;
    _pristinePanels = {};
    for (const id of PRISTINE_PANEL_IDS) {
      const el = $(id);
      if (el) _pristinePanels[id] = el.innerHTML;
    }
    // Not panels, but the same question: these three are overwritten by an
    // analysis (and by a failed one) and have to be able to come back.
    const ent = $('stEntity');
    if (ent) _pristinePanels['@stEntity'] = ent.innerText;
    const dot = $('statusDot');
    if (dot) _pristinePanels['@statusDot'] = dot.className;
    const stx = $('statusText');
    if (stx) _pristinePanels['@statusText'] = stx.textContent;
  }

  /**
   * Everything the last analysis left behind that is not panel copy: badges,
   * the strip, the format bar and verdict, the creative preview, the export
   * handle, the finding→source highlight. It has to die whether the analysis
   * failed or the user cleared the payload out from under it, so it lives in
   * one place and both callers below use it.
   */
  function resetAnalysisArtifacts() {
    setTabBadge('inspectorBadge', { text: '' });
    renderCategories({});
    paintFormatSummary(null);
    renderAnalysisStrip(null, []);
    // Hides the verdict sentence along with the bar — see updateFormatBar.
    updateFormatBar(null, null);
    resetTabStatus();
    paintCardSummary('cardReq', '—');
    paintCardSummary('cardRes', '—');
    clearMacros();
    // The preview and the export bundle are both "the last analysis" too;
    // leaving either behind is the same lie in a different panel.
    _currentPreviewAdm = null;
    _currentPreviewBaseContext = null;
    _currentPreviewDims = null;
    if ($('creativePreview')) setAdPreview(null, {}, null);
    window.__ortbtoolsLast = null;
    // No current analysis means no canonical repaired URL either — Copy must
    // not keep offering the previous request's repair.
    _lastUrlRepair = null;
    // A stale finding→source highlight points at the previous payload's
    // bytes; runAnalysis already resets it on entry, but a failure that
    // happens after a successful analyse must not re-arm it either.
    if (window.OrtbtoolsSourceNav) {
      try {
        window.OrtbtoolsSourceNav.resetNavigation();
      } catch (_e) {
        /* navigator is optional */
      }
    }
  }

  /**
   * Text of both panes at the moment the last analysis succeeded. Everything
   * on the right describes THIS text and nothing else, so it is the only
   * thing that can tell us whether the result still belongs to what is on
   * screen. Null means "no analysis is currently claimed".
   */
  let _analyzedSnapshot = null;

  function snapshotAnalyzedPayload() {
    _analyzedSnapshot = {
      req: ($('bidReq') && $('bidReq').value) || '',
      res: ($('bidRes') && $('bidRes').value) || '',
    };
  }

  /**
   * Drop the result the moment the payload it describes stops being the
   * payload on screen.
   *
   * Clear already did this for the empty case, but that is the narrow end of
   * the same problem: analyse A, then load B from Demo/Saved/Live/Mirror or
   * simply edit a character, and the verdict, quality score, findings and
   * impression list from A stayed — a full-page claim about bytes that were
   * no longer anywhere. Download made it concrete: it assembled payload B
   * with analysis A into one file.
   *
   * The result is cleared, not badged as stale. A stale verdict left legible
   * on screen is still read, and this tool's whole stance is that showing a
   * wrong answer costs more than showing none. Re-running the analysis is one
   * keystroke.
   *
   * The source markers go with it. Findings carry positions resolved against
   * the analysed revision; over a different payload those wavy underlines and
   * rail ticks point at whatever now happens to sit at those offsets.
   */
  function invalidateIfPayloadChanged() {
    if (!_analyzedSnapshot) return;
    const req = ($('bidReq') && $('bidReq').value) || '';
    const res = ($('bidRes') && $('bidRes').value) || '';
    if (req === _analyzedSnapshot.req && res === _analyzedSnapshot.res) return;
    _analyzedSnapshot = null;
    clearResultsForEmpty();
    if (
      window.OrtbtoolsSourceNav &&
      typeof window.OrtbtoolsSourceNav.resetNavigation === 'function'
    ) {
      try {
        window.OrtbtoolsSourceNav.resetNavigation();
      } catch (_e) {
        /* navigator is defensive; invalidation must never break on it */
      }
    }
  }

  /**
   * The one way to put text into an editor from code.
   *
   * `el.value = …` fires no input event (per the HTML spec), so every
   * programmatic load — history, sample, mirror, migrate, URL decode — used
   * to slip past both the dirty flag and any result invalidation. Each site
   * then remembered, or forgot, to call updateCharCount and renderGutter on
   * its own. Routing them through here means a new loader cannot forget, and
   * the next one added inherits the invalidation for free.
   */
  function setEditorValue(id, text) {
    const el = $(id);
    if (!el) return;
    el.value = text == null ? '' : String(text);
    updateCharCount(id);
    renderGutter(id);
    invalidateIfPayloadChanged();
  }

  /**
   * Clearing a payload must clear what was said about it. Before this, Clear
   * emptied the editor and left the verdict, the quality score and the
   * impression list standing — a full-page claim about bytes that were no
   * longer anywhere on screen. Same principle as clearResultsForError below,
   * without the alarm: nothing failed, there is simply nothing to report.
   *
   * Both panes clear the whole result on purpose. The analysis is computed
   * from the request and the response together, and crosscheck, creative and
   * impressions all mix the two — so there is no half of it that survives
   * losing either side.
   */
  function clearResultsForEmpty() {
    capturePristinePanels();
    for (const id of PRISTINE_PANEL_IDS) {
      const el = $(id);
      if (el && _pristinePanels && id in _pristinePanels) el.innerHTML = _pristinePanels[id];
    }
    const info = $('mInfo');
    if (info) {
      info.innerHTML = '';
      info.hidden = true;
    }
    const price = $('mPrice');
    if (price) price.innerText = '$0.00';
    const restore = (id, key, apply) => {
      const el = $(id);
      if (el && _pristinePanels && key in _pristinePanels) apply(el, _pristinePanels[key]);
    };
    restore('stEntity', '@stEntity', (el, v) => {
      el.innerText = v;
      el.dataset.status = '';
    });
    // These two carry the CONNECTION state, which clearResultsForError
    // borrows to show its reason. After an error then a clear, leaving them
    // red would report a failure that has been cleared away.
    restore('statusDot', '@statusDot', (el, v) => {
      el.className = v;
    });
    restore('statusText', '@statusText', (el, v) => {
      el.textContent = v;
    });
    setTabBadge('validationBadge', { text: '', severity: null });
    setTabBadge('crossBadge', { text: '', severity: null });
    setTabBadge('behaviorBadge', { text: '' });
    // The red and amber line numbers are findings too. A pane the user did
    // not clear keeps its numbers — it still has text — but nothing may keep
    // pointing at findings that no longer exist.
    paintGutterSeverity([]);
    resetAnalysisArtifacts();
  }

  /**
   * Wipe every panel the last analysis painted and put the reason in its
   * place. Pre-fix a failed analyse only raised a toast: the status bar still
   * read the PREVIOUS payload's entity, its findings stayed rendered, and the
   * tab badges still carried its counts — so the stale verdict read as the
   * verdict for the payload that just failed. A result that is not current
   * must not look current.
   */
  function clearResultsForError(reason) {
    // This runs from a catch block, so it must not be the thing that throws
    // next: the panels below are all optional in the stripped /embed view.
    const paint = (id, html) => {
      const el = $(id);
      if (el) el.innerHTML = html;
    };
    const errHint =
      '<div class="empty-hint" style="color:var(--danger)">' + escapeHtml(reason) + '</div>';
    const stEntity = $('stEntity');
    if (stEntity) {
      stEntity.innerText = t('status.analysis_failed');
      stEntity.dataset.status = '';
    }
    const dot = $('statusDot');
    if (dot) dot.className = 'status-dot error';
    const stText = $('statusText');
    if (stText) stText.textContent = reason;
    paint('tValidation', errHint);
    paint('tCross', errHint);
    paint(
      'slotGrid',
      '<div class="empty-hint" style="grid-column:1/-1;color:var(--danger)">' +
        escapeHtml(reason) +
        '</div>',
    );
    paint('quickStats', '');
    paint('mInfo', '');
    const price = $('mPrice');
    if (price) price.innerText = '$0.00';
    setTabBadge('validationBadge', { text: '!', severity: 'error' });
    setTabBadge('crossBadge', { text: '—', severity: null });
    resetAnalysisArtifacts();
  }

  window.runAnalysis = async function (fromHist) {
    const myReqId = ++_analyzeReqSeq;
    // Snapshot the untouched panels before this analysis writes over them —
    // this is the only path that paints results, so here is the last moment
    // the page still shows what it shipped with. Idempotent after the first
    // call; Clear relies on it having happened.
    capturePristinePanels();
    clearMacros();
    // Stage-1: drop any prior finding→source jump at the START of every analyze.
    // A failed/aborted analyze must not leave a stale highlight pointing at the
    // previous payload; onAnalyzed() re-arms navigation only on success.
    if (window.OrtbtoolsSourceNav) {
      try {
        window.OrtbtoolsSourceNav.resetNavigation();
      } catch (_e) {
        /* navigator is optional */
      }
    }
    if (_analyzeAbort) {
      try {
        _analyzeAbort.abort();
      } catch (_) {
        /* idempotent */
      }
    }
    _analyzeAbort = typeof AbortController === 'function' ? new AbortController() : null;
    const reqVal = fromHist ? fromHist.req : $('bidReq').value;
    // If the pane still holds our own pretty-print, the bytes the operator
    // pasted are the ones we stashed before rewriting it. See the pretty-print
    // below for why this matters.
    const rawReqBytes =
      !fromHist && _prettyPrintedReq !== null && reqVal === _prettyPrintedReq
        ? _rawBeforePretty
        : reqVal;
    const resVal = fromHist ? fromHist.res : $('bidRes').value;
    // Mirror of `rawReqBytes` — see the comment above it. Same guard, same
    // reason: on a repeat analyse the pane holds our pretty-print, and the
    // operator's bytes are the ones we stashed before rewriting it.
    const rawResBytes =
      !fromHist && _prettyPrintedRes !== null && resVal === _prettyPrintedRes
        ? _rawBeforePrettyRes
        : resVal;
    // Backend supports request-only, response-only, or both. JsonFeed-format
    // payloads (push-materials, value-feed, bid-price, bid-redirect) are typically
    // pasted into bidRes — refusing to analyze in that case loses the whole
    // JsonFeed branch. Only block when both fields are empty.
    if (!reqVal && !resVal) {
      toast(t('toast.nothing_to_analyze'), 'error');
      return;
    }

    const analyzeBtn = $('analyzeBtn');
    // Capture the locale-appropriate label BEFORE swapping for the spinner
    // so the finally block can restore it. The pre-fix code restored a
    // hardcoded English string ("analyze stream") which left the button
    // mistranslated until the next page load.
    const analyzeBtnOriginal = analyzeBtn.innerHTML;
    if (!fromHist) {
      analyzeBtn.innerHTML = '<span class="spinner"></span> ' + t('button.status.analyzing');
      analyzeBtn.disabled = true;
    }

    try {
      // bidReq accepts two shapes: oRTB JSON (parsed to object) OR a URL-
      // style legacy feed request string (decoded
      // server-side via packages/core/decoders/request/). If JSON.parse
      // fails AND the text looks like a URL, pass it through verbatim;
      // the server's validate() will route it to the URL_REQUEST branch.
      const req = parseRequestInput(reqVal);
      const res = resVal ? JSON.parse(resVal) : {};
      // `JSON.parse` accepts every JSON value, not just an object: `null`,
      // `[]`, `42` and `"x"` all parse fine. Pre-fix the only gate was
      // `typeof req === 'object'`, and `typeof null === 'object'` — so a pane
      // holding `null` walked straight into `(req.site || req.app || {})` and
      // threw a TypeError from the middle of the render, after the toast but
      // before anything on screen had been touched. Reject the root here, by
      // name, while nothing has been painted yet.
      assertJsonRoot(req, reqVal, 'peek.label.bid_req', true);
      assertJsonRoot(res, resVal, 'peek.label.bid_res', false);
      // Simulated clearing price: use ONLY the user's explicit input.
      // Do NOT fallback to bid.price, bidfloor, or 0.00 — an empty field
      // means "clearing price unknown" and macros stay literal.
      const simPriceEl = $('simPrice');
      const simP = simPriceEl.value || '';

      if (!fromHist) {
        // Skip pretty-print for string bidReq (URL-style requests). Running
        // JSON.stringify on a string yields a quote-wrapped version that
        // would overwrite the user's textarea with `"http://…"` on every
        // analyse click.
        if (reqVal && typeof req === 'object') {
          // Pretty-printing rewrites the pane, and re-serialising is exactly
          // what erases a duplicate key or an oversized integer's spelling.
          // Without remembering the text we replaced, the first analyse would
          // report those defects and every later one would not — the tool
          // destroying its own evidence. Kept until the operator edits the pane
          // themselves, which `onBidReqInput` detects by the value no longer
          // matching what we wrote.
          // `rawReqBytes`, not `reqVal`: on a repeat analyse the pane already
          // holds our pretty-print, and stashing that would quietly discard the
          // operator's bytes on the second click instead of the first.
          _rawBeforePretty = rawReqBytes;
          setEditorValue('bidReq', JSON.stringify(req, null, 2));
          _prettyPrintedReq = $('bidReq').value;
        }
        if (resVal) {
          // Same bookkeeping as the request pane above: the pretty-print is
          // what erases a duplicate key or an oversized integer's spelling, so
          // remember the text it replaced or the second analyse reports less
          // than the first.
          _rawBeforePrettyRes = rawResBytes;
          setEditorValue('bidRes', JSON.stringify(res, null, 2));
          _prettyPrintedRes = $('bidRes').value;
        }
        if (reqVal) updateCharCount('bidReq');
        if (resVal) updateCharCount('bidRes');
      }

      const entity =
        (req.site || req.app || {}).domain ||
        (req.site || req.app || {}).bundle ||
        // Fallback when neither site.domain nor app.bundle is set — used to
        // be the inscrutable "local-stream"; "локальний запит" reads as a
        // human label and matches surrounding UI strings.
        t('fallback.local_request');

      // Summary info rows (left sidebar)
      const dev = req.device || {};
      $('mInfo').innerHTML =
        infoRow('os', dev.os || '—') +
        infoRow('geo', (dev.geo || {}).country || '—') +
        infoRow('device', dev.devicetype || dev.model || '—') +
        infoRow('connection', dev.connectiontype || '—');

      // Ad preview + winning bid price.
      // Priority order matters: structured bid.native (oRTB 2.6+) wins over
      // findAdm's recursive walk, because findAdm short-circuits on `nurl`
      // (impression-tracker beacon, often HTTP-only and useless to render)
      // and would never reach the actual creative when both fields coexist.
      // P0-bug post-c6f9611: SSPs that ship `bid.nurl + bid.native` together
      // were rendering the nurl pixel into the banner branch → blank iframe
      // (mixed-content) and zero behavior signal. Wrap bid.native first.
      const seatbid = res.seatbid ? res.seatbid[0] : null;
      const bid = seatbid && seatbid.bid ? seatbid.bid[0] : {};
      let adm;
      if (bid && bid.native && Array.isArray(bid.native.assets)) {
        adm = JSON.stringify({ native: bid.native });
      } else {
        adm = findAdm(res);
      }
      // Winning-bid price. Per oRTB §4.3.2 bid.cur overrides the response's
      // cur, which in turn defaults to USD — the hardcoded '$' here labelled
      // every bid as dollars regardless of what the response said it was.
      const bidCur =
        (typeof bid.cur === 'string' && bid.cur.trim()) ||
        (res && typeof res.cur === 'string' && res.cur.trim()) ||
        'USD';
      $('mPrice').innerText = adm
        ? bid.price
          ? formatMoney(bid.price, bidCur)
          : 'BID'
        : formatMoney(0, bidCur);
      // Banner dimensions: prefer bid.{w,h} (winning creative size), fall back
      // to req.imp[0].banner.{w,h}, then to format[0] when banner has multi-size.
      // Used by setAdPreview to render at native size and scale-to-fit the
      // narrow right-sidebar preview container.
      let previewDims = null;
      if (bid && bid.w && bid.h) {
        previewDims = { w: Number(bid.w), h: Number(bid.h) };
      } else if (req.imp && req.imp[0] && req.imp[0].banner) {
        const b = req.imp[0].banner;
        if (b.w && b.h) previewDims = { w: Number(b.w), h: Number(b.h) };
        else if (Array.isArray(b.format) && b.format[0] && b.format[0].w && b.format[0].h) {
          previewDims = { w: Number(b.format[0].w), h: Number(b.format[0].h) };
        }
      }
      // Build a shared macro context for the preview — same sources as
      // extractBidTrackers uses. The preview resolves adm through the
      // same evaluator as the Macro tab so results are always in sync.
      const previewCurrency =
        res && typeof res.cur === 'string' && res.cur.trim() ? res.cur.trim() : 'USD';
      const previewMacroContext = {
        auctionId: (req && req.id) || '',
        responseBidId: (res && res.bidid) || '',
        bidId: bid.id || '',
        impid: bid.impid || '',
        seat: seatbid ? seatbid.seat || '' : '',
        adid: bid.adid || '',
        currency: previewCurrency,
        bidPrice: typeof bid.price === 'number' ? String(bid.price) : bid.price || '',
        price: '', // Only an explicit simulation override may replace this value
        lossCode: '',
        mbr: '',
        minToWin: '',
        multiplier: '',
        impTs: '',
        discountPct: '',
        discountCpm: '',
      };

      // Keep preview data local to this Inspector mount. The shared overrides
      // are merged through the Macro Evaluator before every render.
      if (window.OrtbtoolsMacros && typeof window.OrtbtoolsMacros.syncPriceInputs === 'function') {
        window.OrtbtoolsMacros.syncPriceInputs(simP);
      }
      _currentPreviewAdm = adm;
      _currentPreviewBaseContext = previewMacroContext;
      _currentPreviewDims = previewDims;
      reRenderPreview();

      // Phase 8: paint summary-bar IDs so the collapsed-card state shows
      // identity. req.id / res.id are the canonical oRTB BidRequest /
      // BidResponse identifiers; if missing, fall back to a placeholder
      // so the bar still has shape.
      paintCardSummary('cardReq', (req && req.id) || '—');
      paintCardSummary('cardRes', (res && res.id) || '—');

      // Inspector tab — slot cards
      const imps = req.imp || [];
      const slotGrid = $('slotGrid');
      // Currency for a slot's bidfloor. req.cur is only the *default* and the
      // allowed set; imp.bidfloorcur overrides it per impression (oRTB §3.2.4).
      // Reading req.cur[0] for every card labelled an imp that overrode it
      // with a currency that impression is not priced in.
      const curList = Array.isArray(req.cur) ? req.cur.filter((x) => typeof x === 'string') : [];
      const reqCur0 = curList.length ? curList[0] : 'USD';
      const impCur = (i) => (typeof i.bidfloorcur === 'string' && i.bidfloorcur.trim()) || reqCur0;
      // Banner sizes: prefer w×h if both set, otherwise pull from format[] (up
      // to 3 entries) so multi-size slots render meaningfully instead of empty.
      const bannerDims = (b) => {
        if (!b) return '';
        if (b.w && b.h) return b.w + '×' + b.h;
        if (Array.isArray(b.format) && b.format.length) {
          const sizes = b.format
            .filter((f) => f && f.w && f.h)
            .slice(0, 3)
            .map((f) => f.w + '×' + f.h)
            .join(', ');
          const more = b.format.length > 3 ? ` (+${b.format.length - 3})` : '';
          return sizes ? sizes + more : '';
        }
        return '';
      };
      // Slot-level flags surfaced as small chips. Helps spot rewarded /
      // interstitial / secure / private deals at a glance without expanding.
      const slotFlags = (i) => {
        const flags = [];
        if (i.secure === 1) flags.push('secure');
        if (i.instl === 1) flags.push('instl');
        if (i.rwdd === 1) flags.push('rwdd');
        if (i.pmp && Array.isArray(i.pmp.deals) && i.pmp.deals.length) flags.push('pmp');
        return flags;
      };
      // First MIME for video/audio gives quick "what player do I need" hint.
      const mimeHint = (i) => {
        if (i.video && Array.isArray(i.video.mimes) && i.video.mimes.length) {
          const first = i.video.mimes[0];
          const more = i.video.mimes.length > 1 ? ` +${i.video.mimes.length - 1}` : '';
          return first + more;
        }
        if (i.audio && Array.isArray(i.audio.mimes) && i.audio.mimes.length) {
          const first = i.audio.mimes[0];
          const more = i.audio.mimes.length > 1 ? ` +${i.audio.mimes.length - 1}` : '';
          return first + more;
        }
        return '';
      };
      slotGrid.innerHTML = imps.length
        ? imps
            .map((i, idx) => {
              const types = getSlotType(i);
              const typeHtml =
                '<div class="slot-type-row">' +
                types.map((t) => '<span class="slot-type ' + t + '">' + t + '</span>').join('') +
                '</div>';
              let dims = bannerDims(i.banner);
              if (!dims && i.video && i.video.w && i.video.h)
                dims = i.video.w + '×' + i.video.h + ' video';
              const mh = mimeHint(i);
              const flags = slotFlags(i);
              const flagsHtml = flags.length
                ? '<div class="slot-type-row" style="margin-top:4px">' +
                  flags
                    .map((f) => '<span class="slot-type" style="opacity:0.7">' + f + '</span>')
                    .join('') +
                  '</div>'
                : '';
              const tagidHtml = i.tagid
                ? '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;max-width:140px;vertical-align:bottom" title="' +
                  escapeHtml(i.tagid) +
                  '"> · ' +
                  escapeHtml(i.tagid) +
                  '</span>'
                : '';
              return (
                '<div class="slot-card">' +
                typeHtml +
                '<div class="slot-id">' +
                escapeHtml(i.id || 'imp-' + idx) +
                tagidHtml +
                '</div>' +
                (dims ? '<div class="slot-dims">' + escapeHtml(dims) + '</div>' : '') +
                (mh
                  ? '<div class="slot-dims" style="font-size:10px;color:var(--text-dim)">' +
                    escapeHtml(mh) +
                    '</div>'
                  : '') +
                flagsHtml +
                '<div class="slot-floor"><span class="slot-floor-label">floor</span><span class="slot-floor-value">' +
                escapeHtml(formatPrice(Number(i.bidfloor) || 0)) +
                ' ' +
                escapeHtml(impCur(i)) +
                '</span></div>' +
                '</div>'
              );
            })
            .join('')
        : (function () {
            // URL-style request branch: `req` is a string when the user pasted
            // a clickunder/teaser/pop GET URL. The card is painted twice — once
            // here with nothing decoded yet (`validation` is in TDZ at this
            // point), then repainted from the server's canonical when the
            // analyze response lands. See urlSlotCardHtml for why the browser
            // no longer parses the URL a second time itself.
            if (typeof req !== 'string') {
              // Two different states used to print the same sentence. When the
              // operator pastes only a BidResponse there IS no request, and
              // "Request has no imp[]" accused them of a defect in a payload
              // they never sent. Only say that about a request that exists.
              const hasRequestText = typeof reqVal === 'string' && reqVal.trim().length > 0;
              return (
                '<div class="empty-hint" style="grid-column:1/-1">' +
                escapeHtml(
                  t(hasRequestText ? 'empty.no_imp_slots' : 'empty.needs_paired_request'),
                ) +
                '</div>'
              );
            }
            return urlSlotCardHtml(req, null);
          })();

      // Quick stats (right sidebar)
      const counts = {
        banner: imps.filter((i) => i.banner).length,
        video: imps.filter((i) => i.video).length,
        native: imps.filter((i) => i.native).length,
        audio: imps.filter((i) => i.audio).length,
      };
      $('quickStats').innerHTML =
        statBox(counts.banner, 'banners') +
        statBox(counts.video, 'videos') +
        statBox(counts.native, 'native') +
        statBox(counts.audio, 'audio');
      setTabBadge('inspectorBadge', { text: imps.length || '' });

      // Backend analysis (validation + semantic crosscheck)
      let validation = null,
        cross = null;
      try {
        // v0.39.0 — Version Pinning UI. Read the toolbar selector once
        // per call; "" / "auto" means "trust the detector". Forwarded as
        // opts.expectedVersion through the API. Server returns
        // `version.mismatch` finding when the dev's declared version
        // differs from what field-presence detection landed on, so a
        // rogue 2.6-only field in a payload pinned to 2.5 is visible
        // instead of silently flipping the rule set.
        const versionPinEl = document.getElementById('versionPinSelector');
        const expectedVersion = versionPinEl && versionPinEl.value ? versionPinEl.value : null;
        // `reqVal` is the textarea verbatim, NOT a re-serialisation of `req`.
        // Re-serialising would lose exactly what the raw scan looks for: a
        // duplicate key collapses to one, and an integer past 2^53-1 comes
        // back spelled differently. Those defects exist only in the bytes the
        // operator pasted, so the bytes are what travels. Both panes: pre-fix
        // only the request side sent its bytes, which made the same defect
        // reportable in a BidRequest and silent in the BidResponse beside it.
        const body = {
          bidReq: req,
          bidRes: res,
          bidReqRaw: rawReqBytes,
          bidResRaw: rawResBytes,
        };
        if (expectedVersion) body.opts = { expectedVersion };
        const r = await fetch(analyzeUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: _analyzeAbort ? _analyzeAbort.signal : undefined,
        });
        const j = await r.json().catch(() => ({}));
        // Drop stale: a newer analyze started while we were waiting, OR the
        // module unmounted (ctx.signal.aborted) — don't overwrite the UI with
        // our (outdated) findings, and never paint into a subsequent remount.
        if (myReqId !== _analyzeReqSeq || ctx.signal.aborted) return;
        // Surface server-side errors (4xx/5xx) explicitly. Pre-v0.20.0 we
        // only handled NETWORK failures via the catch below — structured
        // server errors (rate-limit, empty-payload, invalid-JSON) returned
        // {success:false} and silently fell through the if-branch below,
        // leaving the user staring at a stale UI with no toast.
        if (!r.ok || j.success === false) {
          const code = j && j.code;
          const errMsg = (j && j.error) || 'HTTP ' + r.status;
          if (r.status === 429) {
            toast(t('toast.error_generic', { error: errMsg }), 'error');
          } else if (code === 'empty_payload') {
            toast(t('toast.nothing_to_analyze'), 'info');
          } else {
            toast(t('toast.error_generic', { error: errMsg }), 'error');
          }
          $('stEntity').innerText = entity + ' · ' + t('status.local');
          $('stEntity').dataset.status = '';
          $('statusDot').className = 'status-dot error';
          $('statusText').textContent = errMsg;
          return;
        }
        if (j.success) {
          // Product telemetry: a counter only — the event carries no payload,
          // no findings and no status, just "an analysis completed in this
          // tab". Drives the activation metric (visitors who ever analyse).
          if (typeof window.ortbtoolsTrack === 'function') {
            window.ortbtoolsTrack('analyze_success');
          }
          validation = j.validation;
          cross = j.crosscheck;
          // Remember what the decoder had to change, so Copy can hand back the
          // URL that was actually analysed instead of the one that wouldn't
          // parse. Cleared on a clean paste so a later Copy can't hand out a
          // previous request's repair.
          const repairs =
            validation && validation.urlRequest && Array.isArray(validation.urlRequest.repairs)
              ? validation.urlRequest.repairs
              : [];
          _lastUrlRepair = repairs.length
            ? { original: repairs[0].before, repaired: repairs[repairs.length - 1].after }
            : null;
          // Repaint the URL slot card now that the decoder has spoken. The
          // first paint above ran before this response existed and therefore
          // claimed nothing; this one carries the host, path, variant and the
          // decoded device/site fields, all derived from the REPAIRED url — so
          // the card, the repair steps and the findings all describe one URL.
          if (typeof req === 'string') {
            const grid = $('slotGrid');
            if (grid) grid.innerHTML = urlSlotCardHtml(req, validation && validation.urlRequest);
          }
          // IAB cat decoding (Phase 2 feature) — surface as a side-panel
          // tab regardless of validation status. Empty object means no
          // category fields present in the payload.
          renderCategories((j.meta && j.meta.categories) || {});
          renderMacros(res, req);
          // Phase 10b — third detection axis. Server returns
          // meta.format = { formats, contexts, protocols, tags, confidence }.
          // Painted into the left-sidebar "Підсумок" panel as colour-coded
          // chips. Hidden gracefully when nothing was detected.
          paintFormatSummary((j.meta && j.meta.format) || null);
          // Show humanised status to the user; stash raw canonical status
          // ('errors'/'warnings'/'clean'/'invalid') on a data-attribute so
          // confirmSave can read it without parsing localised text.
          $('stEntity').innerText = entity + ' · ' + humanStatus(validation.status);
          $('stEntity').dataset.status = validation.status || '';
          updateFormatBar(validation, (j.meta && j.meta.dialect) || null);
          // Tab-title status pulse: surface analysis verdict in document.title
          // so users with many tabs open can see at a glance which one
          // produced errors. Idempotent on repeated analyses; reset by the
          // bidReq/bidRes input handlers below when the user starts editing.
          setTabStatus(validation);
          // Phase 7b — apply active temporary dialect (if any) to the
          // server's findings BEFORE rendering. The temp-dialect runtime
          // walks (req, res) against the spec, emits findings in engine
          // shape, pushes them onto validation.findings, and re-rolls the
          // status if any new ERROR appeared. No-op when no temp dialect
          // is active.
          if (
            window.OrtbtoolsIntel &&
            typeof window.OrtbtoolsIntel.applyToFindings === 'function' &&
            isTempDialect(activeDialect())
          ) {
            try {
              await window.OrtbtoolsIntel.applyToFindings({ req, res }, validation);
            } catch (_e) {
              /* defensive — never block the analyze flow */
            }
          }

          // Stash latest analysis for the JSON-bundle export (export.js)
          // AND for finding-detail panel value extraction. `req`/`res` are
          // the parsed inputs, kept here so the panel can resolve a
          // finding's path back to the actual user-pasted value.
          window.__ortbtoolsLast = {
            validation: validation,
            crosscheck: cross,
            meta: j.meta || null,
            req: req,
            res: res,
            at: new Date().toISOString(),
          };

          // Stage-1: hand the located findings (request + response + crosscheck,
          // each carrying the additive `location` contract) to the source
          // navigator. It snapshots the current pane text as the analyzed
          // revision and builds the prev/next list. No payload values are
          // passed — only the location contract + live textarea text (local).
          // The result now on screen belongs to exactly this text. Recorded
          // here, at the one point an analysis is known to have succeeded, so
          // invalidateIfPayloadChanged() has something to compare against.
          snapshotAnalyzedPayload();
          if (window.OrtbtoolsSourceNav) {
            try {
              window.OrtbtoolsSourceNav.onAnalyzed((validation.findings || []).concat(cross || []));
            } catch (_e) {
              /* navigator is defensive; analyze flow must never break on it */
            }
          }

          // Phase 7a — ortbtools Intelligence side-channel observer.
          // Fire-and-forget: observe() walks ext-fields of req+res into
          // the local IndexedDB index, gated by validation status. Errors
          // are swallowed inside the module; analyze flow is unaffected.
          // Discovery is disabled cleanly when the script tag isn't
          // loaded (e.g. in /embed view) — the global guard makes this
          // a one-line no-op there.
          if (window.OrtbtoolsIntel && typeof window.OrtbtoolsIntel.observe === 'function') {
            try {
              window.OrtbtoolsIntel.observe(req, validation);
              window.OrtbtoolsIntel.observe(res, validation);
            } catch (_e) {
              /* observe() is already defensive; this is belt-and-braces */
            }
          }
        }
      } catch (e) {
        // Module unmounted while the analyze was in flight (incl. our own abort
        // on unmount) — bail before painting "backend offline" (and the
        // validation-tab render below) into a possible remount.
        if (ctx.signal.aborted) return;
        console.warn('Backend unavailable:', e);
        $('stEntity').innerText = entity + ' · ' + t('status.local');
        $('stEntity').dataset.status = ''; // backend unreachable — no canonical status
        $('statusDot').className = 'status-dot error';
        $('statusText').textContent = 'backend offline';
      }

      // Validation tab — new findings model: { id, level, path, params, specRef, msg }
      const valEl = $('tValidation');
      const findings = validation && (validation.findings || validation.errors); // graceful migration
      // Detected oRTB version pill (Phase 2). Renders whenever version data
      // is present — including the all-clean branch — so the user always
      // sees what spec version was assumed for the validation.
      const versionPill = (() => {
        const v = validation && validation.version;
        if (!v || !v.version || v.version === 'unknown') return '';
        // detectVersion always returns SOMETHING (defaults to 2.5/0.3
        // confidence for shapes with no markers), but if the payload
        // failed type detection ("unknown_type" finding) the version
        // is meaningless — don't surface a fake "2.5 (?)" pill that
        // suggests we identified the spec.
        if (!validation.type || validation.type === 'unknown') return '';
        const cf = v.confidence;
        // ≈ for partial-confidence (≥0.5), ? for low. Was bare ~ / ? which
        // disappeared visually next to the version string.
        const cfTag = cf >= 1 ? '' : cf >= 0.5 ? ' (≈)' : ' (?)';
        const sigTitle =
          v.signals && v.signals.length
            ? 'Detected via: ' + v.signals.join(', ')
            : 'No version-specific markers — defaulted to spec baseline';
        return (
          ' · <span style="font-family:var(--font-mono);color:var(--text-dim);cursor:help" title="' +
          escapeHtml(sigTitle) +
          '">oRTB ' +
          escapeHtml(v.version) +
          cfTag +
          '</span>'
        );
      })();
      // Render analysis strip (Feature #13) — uses validation.version which
      // is now stashed in window.__ortbtoolsLast after the try-block above.
      renderAnalysisStrip(req, findings);

      // What the decoder changed before it could parse the URL. Empty string
      // for every other payload shape, so both branches below prepend it
      // unconditionally — including the clean one, where "we repaired your URL
      // and then found nothing wrong with it" is the whole message.
      const repairsHtml = urlRepairsHtml(validation);

      if (validation && findings && findings.length) {
        setTabBadge('validationBadge', {
          text: findings.length,
          severity: severityFromFindings(findings),
        });
        // Feature #14: replace flat list with severity-filtered tabs.
        // No breadcrumb line above the groups. It restated the payload type,
        // the status and the version — all three already stated by the work
        // bar and the verdict directly above it — and pushed the first group
        // header, the thing this tab exists to show, a row further down. The
        // URL-repair notice stays: it is the only part that says something
        // nothing else does.
        renderSeverityTabs(valEl, findings, repairsHtml);
      } else if (validation) {
        setTabBadge('validationBadge', { text: '✓', severity: 'ok' });
        // Clean state — still surface the detected oRTB version so the user
        // knows which spec the inspector validated against. Was hidden before.
        valEl.innerHTML =
          repairsHtml +
          '<div class="mono-label" style="margin-bottom:var(--space-3)">' +
          escapeHtml(validation.type) +
          ' · ' +
          escapeHtml(humanStatus(validation.status)) +
          versionPill +
          '</div>' +
          '<div style="text-align:center;padding:var(--space-7);color:var(--success);font-weight:500;">' +
          escapeHtml(t('validation.all_passed', { type: validation.type })) +
          '</div>';
      } else {
        setTabBadge('validationBadge', { text: '—', severity: null });
      }

      // Crosscheck tab — semantic verdict on req ↔ res alignment
      const crossEl = $('tCross');
      if (Array.isArray(cross) && cross.length) {
        const crit = cross.filter((c) => c.level === 'crit').length;
        const warn = cross.filter((c) => c.level === 'warn').length;
        setTabBadge('crossBadge', {
          text: crit + warn ? `${crit + warn}` : '✓',
          severity: severityFromCrosschecks(cross),
        });
        const summaryRow =
          crit || warn
            ? `<div class="mono-label" style="margin-bottom:var(--space-3)">${escapeHtml(t('crosscheck.summary', { crit, warn, ok: cross.length - crit - warn }))}</div>`
            : `<div class="mono-label" style="color:var(--success);margin-bottom:var(--space-3)">${escapeHtml(t('crosscheck.all_passed', { count: cross.length }))}</div>`;
        // CP3.2: locatable crosscheck paths are clickable, reusing the EXISTING
        // finding→source contract — data-loc carries the finding-location and the
        // goto-path dispatcher calls OrtbtoolsSourceNav.navigate(). No data-jsonpath,
        // no indexOf, no size→w alias: the source map resolves the exact key/value
        // (incl. size→/w + /h related) from the server-attached location. Non-
        // locatable crosschecks (precision 'none' / no primary) stay plain text.
        const crossPathHtml = (c) => {
          if (!c.path) return '';
          const loc = c.location;
          const navigable = loc && loc.precision !== 'none' && loc.primary;
          if (!navigable) return `<div class="cross-path">${escapeHtml(c.path)}</div>`;
          return (
            `<button type="button" class="cross-path cross-path-btn" data-action="goto-path"` +
            // data-loc holds JSON (full of quotes) inside a double-quoted attribute:
            // escapeHtml handles & < > but NOT quotes, so &quot;-escape too or the
            // attribute truncates at the first " and JSON.parse fails (no jump).
            ` data-loc="${escapeHtml(JSON.stringify(loc)).replace(/"/g, '&quot;')}"` +
            ` title="${escapeHtml(t('inspector.nav.jump', 'Jump to this location in the source'))}">` +
            `${escapeHtml(c.path)}</button>`
          );
        };
        crossEl.innerHTML =
          summaryRow +
          cross
            .map((c) => {
              const cls = c.level === 'crit' ? 'crit' : c.level === 'warn' ? 'warn' : 'ok';
              const ic = c.level === 'crit' ? '✕' : c.level === 'warn' ? '!' : '✓';
              const detailHtml = c.detail
                ? `<div class="cross-detail">${escapeHtml(JSON.stringify(c.detail))}</div>`
                : '';
              return `<div class="cross-item ${cls}">
              <span class="cross-icon">${ic}</span>
              <div style="flex:1;min-width:0">
                <div>${escapeHtml(c.msg)}</div>
                ${crossPathHtml(c)}
                ${detailHtml}
              </div>
            </div>`;
            })
            .join('');
      } else if (cross) {
        setTabBadge('crossBadge', { text: '—', severity: null });
        crossEl.innerHTML =
          '<div class="empty-hint">' + escapeHtml(t('crosscheck.need_response')) + '</div>';
      } else {
        setTabBadge('crossBadge', { text: '—', severity: null });
      }

      // History — push to the in-memory ring + persist to localStorage so
      // it survives reload. Drop overflow past HISTORY_MAX to keep the
      // serialised state bounded.
      if (!fromHist) {
        const status = validation ? validation.status : 'local';
        historyStore.unshift({
          ts: Date.now(),
          // Keep URL-style requests as raw URLs. JSON.stringify(string)
          // would persist a quote-wrapped JSON scalar, so loading History
          // would visibly mutate the original request.
          req: serializeRequestInput(req),
          res: resVal ? JSON.stringify(res, null, 2) : '',
          title: entity,
          status,
          // Superseded by historyTime(), which formats from `ts` at render
          // time. Still written — and now written in the page's locale
          // rather than the browser's — because it is the fallback an older
          // cached bundle, and the loader's pre-`ts` migration path, both
          // still read.
          time: new Date().toLocaleTimeString(activeLocaleTag()),
        });
        if (historyStore.length > HISTORY_MAX) historyStore.length = HISTORY_MAX;
        // Fresh analysis is always at index 0 — pin the active highlight
        // there so the user sees which row they just produced.
        _currentHistoryIdx = 0;
        renderHistory();
        persistHistory();
        if (resVal)
          toast(
            t('toast.analysis_complete', {
              status: validation ? humanStatus(validation.status) : t('status.local'),
            }),
            'success',
          );
        // P0 #3 fix — bring the verdict into view after a fresh analyze.
        // On desktop the format-bar usually sits at or near the fold; on
        // mobile + small viewports the JSON input panes push it well
        // below the fold and the user has to hunt for the result. Only
        // scroll when the bar is meaningfully off-screen (>60% of fold)
        // so tall screens don't get a jarring jump.
        const bar = $('formatBar');
        if (bar && !bar.hidden) {
          const r = bar.getBoundingClientRect();
          if (r.top > window.innerHeight * 0.6 || r.top < 0) {
            bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }
    } catch (e) {
      // AbortError fires when a newer analyze starts before this one
      // returns. That's expected behavior — we cancelled it on purpose;
      // no toast, no console noise.
      if (e && e.name === 'AbortError') {
        return;
      }
      toast(t('toast.error_generic', { error: e.message }), 'error');
      console.error('Analysis error:', e);
      // The toast is not the result panel. Pre-fix the throw left every panel
      // showing the PREVIOUS payload — same entity in the status bar, same
      // findings, same badges — so the stale verdict read as this payload's
      // verdict and only a fading toast said otherwise. Clear them together
      // with the reason in their place, unless this mount is already gone.
      if (!ctx.signal.aborted) clearResultsForError(e.message);
    } finally {
      if (!fromHist) {
        analyzeBtn.innerHTML = analyzeBtnOriginal;
        analyzeBtn.disabled = false;
      }
    }
  };
  // Expose history to inline onclick handlers
  window.historyStore = historyStore;

  function infoRow(k, v) {
    return (
      '<div class="info-row"><span class="info-key">' +
      escapeHtml(k) +
      '</span><span class="info-val">' +
      escapeHtml(v) +
      '</span></div>'
    );
  }

  // Phase 10b — paint the third detection axis (FORMAT / CONTEXT /
  // PROTOCOL) into the summary sidebar. Hidden by default; revealed
  // only when the analyze response carried a confidence-1 detection.
  // Three chip variants are colour-coded so users can scan formats
  // (banner/video/…) vs runtime context (web/inapp/ctv/…) vs creative
  // protocol (vast-3/4 / daast) at a glance.
  function paintFormatSummary(detected) {
    const wrap = document.getElementById('mFormat');
    const chips = document.getElementById('mFormatChips');
    if (!wrap || !chips) return;
    if (!detected || !detected.confidence) {
      wrap.hidden = true;
      chips.innerHTML = '';
      return;
    }
    const parts = [];
    for (const f of detected.formats || []) {
      parts.push(
        '<span class="format-chip format-chip--format" data-fmt="' +
          escapeHtml(f) +
          '">' +
          escapeHtml(f) +
          '</span>',
      );
    }
    for (const c of detected.contexts || []) {
      parts.push('<span class="format-chip format-chip--context">' + escapeHtml(c) + '</span>');
    }
    for (const p of detected.protocols || []) {
      parts.push('<span class="format-chip format-chip--protocol">' + escapeHtml(p) + '</span>');
    }
    if (parts.length === 0) {
      wrap.hidden = true;
      chips.innerHTML = '';
      return;
    }
    chips.innerHTML = parts.join(' ');
    wrap.hidden = false;
  }
  // F-02 — say what was repaired. `POST /api/analyze` has always returned the
  // repair steps as `validation.urlRequest.repairs` ({step, before, after} in
  // application order), and the string "repairs" appeared nowhere in public/:
  // the tool analysed a different URL than the one on screen and never
  // mentioned it. That is the exact class of silent failure this product
  // exists to report, so it gets stated at the top of the Validation panel,
  // above the findings that were produced FROM the repaired URL.
  //
  // Returns '' for everything that is not a repaired URL request, so both
  // render branches below can prepend it unconditionally.
  function urlRepairsHtml(validation) {
    const ur = validation && validation.urlRequest;
    const repairs = ur && Array.isArray(ur.repairs) ? ur.repairs : [];
    if (!repairs.length) return '';
    // First `before` is the operator's own text; last `after` is what the
    // decoder parsed. The steps in between are the derivation.
    const original = repairs[0].before;
    const analysed = repairs[repairs.length - 1].after;
    const steps = repairs
      .map(
        (r) =>
          '<div style="margin-top:var(--space-2)">' +
          '<div class="mono-label">' +
          escapeHtml(t('repair.step.' + r.step)) +
          '</div>' +
          '<div style="font-family:var(--font-mono);font-size:11px;word-break:break-all">' +
          '<span style="color:var(--text-dim);text-decoration:line-through">' +
          escapeHtml(r.before) +
          '</span>' +
          ' → ' +
          '<span>' +
          escapeHtml(r.after) +
          '</span>' +
          '</div>' +
          '</div>',
      )
      .join('');
    return (
      '<div class="validation-item warning" style="margin-bottom:var(--space-3)">' +
      '<div><strong>' +
      escapeHtml(t('repair.title', { count: repairs.length })) +
      '</strong></div>' +
      '<div style="margin-top:var(--space-2);font-family:var(--font-mono);font-size:11px;word-break:break-all">' +
      '<div class="mono-label">' +
      escapeHtml(t('repair.pasted')) +
      '</div>' +
      escapeHtml(original) +
      '</div>' +
      '<div style="margin-top:var(--space-2);font-family:var(--font-mono);font-size:11px;word-break:break-all">' +
      '<div class="mono-label">' +
      escapeHtml(t('repair.analysed')) +
      '</div>' +
      escapeHtml(analysed) +
      '</div>' +
      steps +
      '<div class="mono-label" style="margin-top:var(--space-3)">' +
      escapeHtml(t('repair.copy_hint')) +
      '</div>' +
      '</div>'
    );
  }

  // The Inspector card for a URL-style request (clickunder/teaser/pop GET).
  //
  // Pre-fix this ran `new URL(req)` in the browser and, on throw, fell back to
  // `req.slice(0, 80)` in the endpoint field. That was survivable only while
  // the client gate refused everything `new URL()` refuses. It no longer does:
  // schemeless, wrapped, markdown-linked and zero-width-prefixed pastes now
  // route to the URL branch, and every one of them makes that constructor
  // throw — so the first thing the operator saw after pasting `<https://…>`
  // was their own raw text labelled as a parsed endpoint.
  //
  // The server already holds the answer. `validation.urlRequest` is built from
  // the REPAIRED url by the decoder registry, so it agrees with the repair
  // steps shown in the Validation panel and with the findings. Two parsers
  // that disagree is the defect; this leaves one. `canonical` is null on the
  // first paint (the analyze response has not arrived yet) and stays null when
  // the backend is unreachable — that state says so instead of guessing.
  function urlSlotCardHtml(rawText, canonical) {
    let endpoint = '';
    let ip = '';
    let ua = '';
    let page = '';
    let variant = '';

    if (canonical && canonical.ok !== false) {
      // Decoded canonical. `endpoint` is host+path as the decoder read it;
      // `url` is the repaired string, and it parsed by construction.
      endpoint = canonical.endpoint || '';
      if (!endpoint && canonical.url) {
        try {
          const u = new URL(canonical.url);
          endpoint = u.hostname + u.pathname;
        } catch (_e) {
          /* canonical.url parsed server-side; a throw here is not worth a card */
        }
      }
      const dev = canonical.device || {};
      ip = dev.ip || dev.ipv6 || '';
      ua = dev.ua || '';
      page = (canonical.site || {}).page || '';
      variant = canonical.variant || '';
    } else if (canonical && canonical.parsed) {
      // Refusal envelope: the URL parsed, but no decoder claimed the feed.
      // `parsed` is what the server read, which is still more than we know.
      endpoint = (canonical.parsed.host || '') + (canonical.parsed.pathname || '');
    }

    const decoded = !!endpoint;
    const uaShort = ua.length > 80 ? ua.slice(0, 80) + '…' : ua;
    const shownRaw = rawText.length > 120 ? rawText.slice(0, 120) + '…' : rawText;
    return (
      '<div class="slot-card" style="grid-column:1/-1">' +
      '<div class="slot-type-row">' +
      '<span class="slot-type">URL</span>' +
      (variant
        ? '<span class="slot-type" style="opacity:0.7">' + escapeHtml(variant) + '</span>'
        : '') +
      '</div>' +
      '<div class="slot-id">' +
      escapeHtml(decoded ? endpoint : shownRaw) +
      '</div>' +
      // Say which of the two this is. Without the label the verbatim paste and
      // a decoded host+path look like the same claim.
      (decoded
        ? ''
        : '<div class="slot-dims" style="font-size:10px;color:var(--text-dim)">' +
          escapeHtml(t('slot.url.not_decoded')) +
          '</div>') +
      (ip ? '<div class="slot-dims">ip: ' + escapeHtml(ip) + '</div>' : '') +
      (uaShort
        ? '<div class="slot-dims" style="font-size:10px;color:var(--text-dim)">' +
          escapeHtml(uaShort) +
          '</div>'
        : '') +
      (page ? '<div class="slot-dims">page: ' + escapeHtml(page) + '</div>' : '') +
      '</div>'
    );
  }

  function statBox(value, label) {
    return (
      '<div class="stat-box"><div class="stat-value">' +
      value +
      '</div><div class="stat-label">' +
      label +
      '</div></div>'
    );
  }

  // ── Vendor reference tab ─────────────────────────────────────
  const VENDOR_REF = {
    macros: [
      ['${AUCTION_PRICE}', 'Winning bid price (used in nurl/burl).'],
      ['${AUCTION_CURRENCY}', 'Currency of the auction (e.g. USD).'],
      ['${AUCTION_LOSS}', 'Loss reason code (used in lurl).'],
    ],
    requestFields: [
      ['id', 'string', 'req', 'Unique BidRequest ID.'],
      ['at', 'int', 'opt', '1=first-price (CPC SSPs), 2=second-price (default).'],
      ['cur', 'array', 'opt', 'Default SSP currency, e.g. ["USD"].'],
      ['tmax', 'int', 'opt', 'Auction timeout in ms (typical 100–150).'],
      ['imp[]', 'array', 'req', 'At least one impression.'],
      ['site OR app', 'obj', 'req', 'Source description; one of the two.'],
      ['device.ip / .ipv6', 'string', 'req', 'At least one IP.'],
      ['device.ua', 'string', 'req', 'User agent.'],
      ['user.id', 'string', 'rec', 'User ID; auto-generated by the SSP if absent.'],
      ['bcat', 'array', 'opt', 'Blocked IAB categories ("IAB24", "IAB25-3").'],
      ['ext.bsection', 'array', 'opt', 'Vendor: blocked sections (e.g. [1001]).'],
      ['ext.btags', 'array', 'opt', 'Vendor: blocked tags (e.g. [16,14,4]).'],
    ],
    impFields: [
      ['id', 'string', 'req', 'Impression ID.'],
      ['secure', 'int', 'rec', '1 if HTTPS required.'],
      ['bidfloor', 'float', 'rec', 'Minimum CPM/CPC bid (e.g. 0.001).'],
      ['bidfloorcur', 'string', 'opt', 'Floor currency (default = cur[0]).'],
      ['tagid', 'string', 'rec', 'Placement / zone identifier.'],
      ['instl', 'int', 'opt', '1 = interstitial.'],
      ['banner / video / native', 'obj', 'req', 'At least one ad object.'],
      [
        'ext.subage',
        'int',
        'req*',
        'Push: days since subscription. *Required for push, missing reduces buyout.',
      ],
      ['ext.subage_dt', 'string', 'opt', 'Push: subscription date YYYY-MM-DD.'],
      ['ext.subage0', 'int', 'opt', 'Push: 0 = first day, then days count.'],
      ['ext.subage_ts', 'int', 'opt', 'Push: subscription Unix timestamp.'],
    ],
    siteFields: [
      ['id', 'string', 'rec', 'SSP site ID.'],
      ['domain', 'string', 'rec', 'Top-level domain.'],
      ['page', 'string', 'rec', 'Full page URL.'],
      ['publisher.id', 'string', 'rec', 'Publisher ID in SSP.'],
      ['cat', 'array', 'opt', 'IAB categories ("IAB3-1").'],
      ['ext.exchangecat', 'int', 'opt', 'Vendor: exchange category (e.g. 555).'],
      ['ext.idzone', 'string', 'opt', 'Vendor: zone identifier.'],
    ],
    feedParams: [
      ['sid', 'string', 'req', 'Endpoint ID issued by the SSP.'],
      ['skey', 'string', 'req', 'API key issued by the SSP.'],
      ['ua', 'string', 'req', 'User agent (URL-encoded).'],
      ['ip / ipv6', 'string', 'req', 'At least one IP.'],
      ['uid', 'string', 'req', 'User ID in SSP.'],
      ['pid', 'string', 'req', 'Publisher ID.'],
      ['limit', 'int', 'opt', 'Creatives per response (default 1).'],
      ['language', 'string', 'rec', 'ISO-3166-1 alpha-2 (e.g. "ru-RU"); missing reduces buyout.'],
      ['cat', 'string', 'opt', 'IAB category ("IAB24", "IAB25-3").'],
      ['page', 'string', 'rec', 'Page domain.'],
      ['format', 'string', 'opt', '"cu" / "native" / "push" (default).'],
      ['subage', 'int', 'req*', 'Push: days since subscription. *Missing reduces buyout.'],
    ],
    pushResponseFields: [
      ['id', 'string', 'Material ID.'],
      ['click_url', 'string', 'Trackable click URL.'],
      ['campaign_id', 'int', 'Campaign ID (cid).'],
      ['category', 'string', 'Material category.'],
      ['title', 'string', 'Ad title.'],
      ['text', 'string', 'Ad body text.'],
      ['image_url', 'string', 'Image URL.'],
      ['icon_url', 'string', 'Icon URL with embedded nurl (push).'],
      ['cpc', 'float', 'Bid price (CPC).'],
      ['nurl', 'string', 'Win-notice URL (or embedded in icon_url/image).'],
    ],
    templates: {
      requestNative: {
        id: '8a1f5b9e-2c4d-...',
        at: 2,
        cur: ['USD'],
        tmax: 150,
        imp: [
          {
            id: '1',
            secure: 1,
            bidfloor: 0.005,
            bidfloorcur: 'USD',
            tagid: 'zone_42',
            native: {
              request:
                '{"native":{"ver":"1.1","plcmtcnt":1,"assets":[{"id":1,"required":1,"title":{"len":90}},{"id":2,"required":1,"img":{"type":1,"wmin":192,"hmin":192}},{"id":3,"required":1,"data":{"type":2,"len":140}}]}}',
              ver: '1.1',
            },
            ext: { subage: 2, subage_dt: '2026-04-15', subage_ts: 1744156800 },
          },
        ],
        site: {
          id: 'pub_site_1',
          domain: 'example.com',
          page: 'https://example.com/article',
          publisher: { id: 'pub_001', name: 'Example Pub' },
          cat: ['IAB3-1'],
          ext: { exchangecat: 555, idzone: 'zone_42' },
        },
        device: {
          ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          ip: '203.0.113.42',
          geo: { country: 'UKR', utcoffset: 180, lat: 50.4522, lon: 30.5287, type: 2 },
          language: 'uk',
          js: 1,
          devicetype: 2,
          os: 'macOS',
          osv: '13.6',
          connectiontype: 2,
          dnt: 0,
          lmt: 0,
        },
        user: { id: 'ssp_user_xyz', yob: 1990, gender: 'O' },
        bcat: ['IAB25-3', 'IAB26'],
        ext: { bsection: [1001], btags: [16, 14, 4] },
      },
      requestPush: {
        id: 'push-req-9c33...',
        at: 2,
        cur: ['USD'],
        tmax: 150,
        imp: [
          {
            id: '1',
            secure: 1,
            bidfloor: 0.001,
            tagid: 'push_zone_7',
            native: {
              request:
                '{"native":{"ver":"1.1","plcmtcnt":1,"assets":[{"id":1,"required":1,"title":{"len":50}},{"id":2,"required":1,"img":{"type":1,"wmin":192,"hmin":192}},{"id":3,"required":1,"data":{"type":2,"len":120}}]}}',
              ver: '1.1',
            },
            ext: { subage: 5, subage0: 5, subage_dt: '2026-04-25', subage_ts: 1745020800 },
          },
        ],
        site: {
          id: 's1',
          domain: 'pushsite.example',
          publisher: { id: 'pub_001' },
          ext: { idzone: 'push_zone_7' },
        },
        device: {
          ua: 'Mozilla/5.0 (Linux; Android 13)',
          ip: '203.0.113.42',
          geo: { country: 'POL' },
          language: 'pl',
          devicetype: 4,
          os: 'Android',
          osv: '13',
        },
        user: { id: 'sub_user_abc' },
      },
      responseNative: {
        id: 'request-id-from-bidreq',
        cur: 'USD',
        seatbid: [
          {
            seat: '1',
            group: 0,
            bid: [
              {
                id: 'bid-1',
                impid: '1',
                price: 0.087,
                adid: 'ad_555',
                crid: 'cr_777',
                cid: '555555',
                adomain: ['example-advertiser.com'],
                cat: ['IAB3-1'],
                nurl: 'https://win.ssp.example/nurl/abc?cur=${AUCTION_CURRENCY}&bid=${AUCTION_PRICE}',
                burl: 'https://bill.ssp.example/burl/abc?cur=${AUCTION_CURRENCY}&bid=${AUCTION_PRICE}',
                lurl: 'https://loss.ssp.example/lurl/abc?loss=${AUCTION_LOSS}',
                adm: '{"native":{"ver":"1.1","link":{"url":"https://click.ssp.example/c/abc"},"assets":[{"id":1,"required":1,"title":{"text":"Ad title"}},{"id":2,"required":1,"img":{"url":"https://cdn.ssp.example/i/192.png","w":192,"h":192}},{"id":3,"required":1,"data":{"value":"Short body text."}}]}}',
                w: 192,
                h: 192,
              },
            ],
          },
        ],
      },
      feedRequestUrl:
        '/feed?sid=ENDPOINT_ID&skey=API_KEY&ua=Mozilla%2F5.0&ip=203.0.113.42&uid=user_abc&limit=1&language=uk&pid=pub_001&subage=2&cat=IAB24&page=example.com&format=push',
      feedResponsePush: [
        {
          id: 'material_777',
          click_url: 'https://click.ssp.example/c/abc',
          campaign_id: 555555,
          category: '1368',
          title: 'Discover this product',
          text: 'Short ad body — usually under 140 chars.',
          image_url: 'https://cdn.ssp.example/i/192.png',
          icon_url: 'https://cdn.ssp.example/icon.png?nurl=...',
          cpc: 0.031595,
          nurl: 'https://win.ssp.example/nurl/abc',
        },
      ],
      feedResponseClickunder: {
        result: { listing: [{ url: 'https://click.ssp.example/cu/xyz', bid: 0.502 }] },
      },
    },
  };

  function pasteIntoReq(json) {
    setEditorValue('bidReq', JSON.stringify(json, null, 2));
    updateCharCount('bidReq');
    toast(t('toast.template_inserted_req'), 'success');
  }
  function pasteIntoRes(json) {
    setEditorValue('bidRes', JSON.stringify(json, null, 2));
    updateCharCount('bidRes');
    toast(t('toast.template_inserted_res'), 'success');
  }
  function pasteString(target, str) {
    $(target).value = str;
    updateCharCount(target);
    toast(t('toast.template_inserted'), 'success');
  }
  // Expose for inline onclicks
  window._vendorRef = { pasteIntoReq, pasteIntoRes, pasteString, VENDOR_REF };

  function tableHtml(headers, rows) {
    return (
      '<table class="ref-table"><thead><tr>' +
      headers.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') +
      '</tr></thead><tbody>' +
      rows
        .map(
          (row) =>
            '<tr>' +
            row
              .map((cell, i) => {
                if (i === 0) return '<td class="mono">' + escapeHtml(cell) + '</td>';
                if (typeof cell === 'string' && /^(req\*?|opt|rec)$/.test(cell)) {
                  const cls = cell.startsWith('req') ? 'req' : 'opt';
                  return (
                    '<td><span class="ref-pill ' + cls + '">' + escapeHtml(cell) + '</span></td>'
                  );
                }
                return '<td>' + escapeHtml(cell) + '</td>';
              })
              .join('') +
            '</tr>',
        )
        .join('') +
      '</tbody></table>'
    );
  }

  function renderReference() {
    const T = VENDOR_REF.templates;
    const reqNativeJson = JSON.stringify(T.requestNative, null, 2);
    const reqPushJson = JSON.stringify(T.requestPush, null, 2);
    const resNativeJson = JSON.stringify(T.responseNative, null, 2);
    const feedPushJson = JSON.stringify(T.feedResponsePush, null, 2);
    const feedCuJson = JSON.stringify(T.feedResponseClickunder, null, 2);

    $('tRef').innerHTML = `
      <div class="ref-section">
        <h3>OpenRTB request templates</h3>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Native (web/in-page)</span>
            <button class="ref-paste-btn" data-action="vendor-paste-req" data-template="requestNative">paste → request</button>
          </div>
          <div class="ref-card-desc">Vendor-style Native 1.1 with subage hints, geo, user, ext.bsection/btags blocking.</div>
          <pre class="ref-code">${escapeHtml(reqNativeJson)}</pre>
        </div>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Push (subscription)</span>
            <button class="ref-paste-btn" data-action="vendor-paste-req" data-template="requestPush">paste → request</button>
          </div>
          <div class="ref-card-desc">Push impression with imp.ext.subage, subage0, subage_dt, subage_ts — required to maximize buyout.</div>
          <pre class="ref-code">${escapeHtml(reqPushJson)}</pre>
        </div>
      </div>

      <div class="ref-section">
        <h3>OpenRTB response template</h3>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Native bid response</span>
            <button class="ref-paste-btn" data-action="vendor-paste-res" data-template="responseNative">paste → response</button>
          </div>
          <div class="ref-card-desc">Bid + nurl/burl/lurl with macros + Native 1.1 adm with assets matching the request.</div>
          <pre class="ref-code">${escapeHtml(resNativeJson)}</pre>
        </div>
      </div>

      <div class="ref-section">
        <h3>Feed integration (GET)</h3>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Feed request URL</span>
            <button class="ref-paste-btn" data-action="vendor-paste-string" data-target="bidReq" data-template="feedRequestUrl">paste → request box</button>
          </div>
          <div class="ref-card-desc">Vendor feed expects a GET with parameters; SSP issues sid + skey per ad format.</div>
          <pre class="ref-code">${escapeHtml(T.feedRequestUrl)}</pre>
          ${tableHtml(['param', 'type', 'rule', 'description'], VENDOR_REF.feedParams)}
        </div>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Feed response — push (JSON array)</span>
            <button class="ref-paste-btn" data-action="vendor-paste-res" data-template="feedResponsePush">paste → response</button>
          </div>
          <pre class="ref-code">${escapeHtml(feedPushJson)}</pre>
          ${tableHtml(['field', 'type', 'description'], VENDOR_REF.pushResponseFields)}
        </div>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Feed response — clickunder</span>
            <button class="ref-paste-btn" data-action="vendor-paste-res" data-template="feedResponseClickunder">paste → response</button>
          </div>
          <pre class="ref-code">${escapeHtml(feedCuJson)}</pre>
        </div>
      </div>

      <div class="ref-section">
        <h3>URL macros</h3>
        <div class="ref-card">
          <div class="ref-card-desc">This vendor supports only these three macros — others are ignored. Use in nurl, burl, lurl.</div>
          ${tableHtml(['macro', 'description'], VENDOR_REF.macros)}
        </div>
      </div>

      <div class="ref-section">
        <h3>Field cheatsheet</h3>
        <div class="ref-card">
          <span class="ref-card-title">BidRequest root</span>
          ${tableHtml(['field', 'type', 'rule', 'description'], VENDOR_REF.requestFields)}
        </div>
        <div class="ref-card">
          <span class="ref-card-title">imp[]</span>
          ${tableHtml(['field', 'type', 'rule', 'description'], VENDOR_REF.impFields)}
        </div>
        <div class="ref-card">
          <span class="ref-card-title">site / app</span>
          ${tableHtml(['field', 'type', 'rule', 'description'], VENDOR_REF.siteFields)}
        </div>
      </div>

      <div class="ref-section" style="color:var(--text-dim);font-size:var(--fs-sm);text-align:center;padding:var(--space-4) 0">
        Source: vendor-specific RTB dialect reference (private).
      </div>
    `;
  }

  // ── Inspector-owned library state ──────────────────────────────
  // The library is per-account: anonymous users see a "Sign in to save"
  // panel; logged-in users get partners/samples scoped to their user_id.
  // Auth/DEK/api now live in the shell-level session service
  // (public/core/session.js) — this is ONLY the Inspector-specific state
  // (sample/dirty/partner cache), registered below as a session adapter so
  // it survives exactly as long as this mount does.
  let _partnerCache = [];
  let _currentSampleId = null;
  // Metadata of the currently-loaded sample (so the Save modal can pre-fill
  // title/partner/notes when the user wants to UPDATE the existing record).
  // Set by loadSample, cleared by clear-button + signOut.
  let _currentSampleMeta = null;
  // Dirty flag — set on input into bidReq/bidRes after a successful load.
  // Used to: (a) warn before clobber on loadSample, (b) reset after save.
  let _isDirty = false;

  // ── Auth widget ───────────────────────────────────────────────

  function renderAuthWidget() {
    const signInBtn = $('authSignInBtn');
    const userBlock = $('authUserBlock');
    const emailEl = $('authEmail');
    if (session.user) {
      signInBtn.style.display = 'none';
      userBlock.style.display = 'inline-flex';
      emailEl.textContent = session.user.email;
    } else {
      signInBtn.style.display = 'inline-flex';
      userBlock.style.display = 'none';
      emailEl.textContent = '';
    }
  }

  // Auth boot (session/DEK restore, locale-stickiness redirect) is now the
  // shell-level session.ensureBooted() — canonical, shared with topbar and
  // any other consumer, gen-guarded against a stale response overwriting a
  // newer login/logout. mountInspector calls it in the boot sequence below
  // and paints renderAuthWidget()/renderVerifyBanner() once it resolves.

  // The unlock modal (re-derive DEK from password against the live
  // cookie session) lives in /modules/unlock/. The dispatcher's
  // 'open-unlock' case lazy-loads it on first use; 'do-unlock' fires
  // after the modal is already on screen, by which point
  // window.openUnlockModal + window.doUnlock are wired up.

  // ── Auth modal: lazy-loaded module ──────────────────────────
  // openAuthModal / doLogin / doRegister live in /modules/auth/.
  // window.lazyOpenAuth (installed at shell boot by /core/modal-host.js)
  // lazy-imports the module then invokes window.openAuthModal(mode) — chrome-
  // level now, ROADMAP #18, so it works regardless of which section is
  // mounted. The module talks to session state via window.OrtbtoolsSession
  // (the shell-owned facade, /core/session.js) — DEK + user never touch this
  // closure anymore. Two Inspector-owned hooks the module still consumes:
  //   - window.snapshotPendingHistoryMerge — sets the closure-private
  //     _pendingHistoryMerge flag (mirrors historyStore.length > 0
  //     at call time) before the recovery modal opens, so
  //     closeRecoveryKeyModal can chain the import-history prompt
  //     once the key is acknowledged.
  //   - window.openRecoveryKeyModalLazy — already exposed below for
  //     the F5-survival path; the auth module reuses it for the
  //     register-flow + legacy pre-Phase-7-bootstrap-on-login.
  let _pendingHistoryMerge = false;

  window.snapshotPendingHistoryMerge = function () {
    _pendingHistoryMerge = historyStore.length > 0;
  };

  // ── Recovery-key modal: lazy-loaded module ──────────────────
  // The full implementation (modal HTML, copy handler, confirm-gated
  // close, sessionStorage persistence) lives in /modules/recovery/.
  // It's loaded on demand because it's only needed:
  //   - immediately after register (one path: bootstrapNewCrypto)
  //   - on F5-survival re-show (one path: session.ensureBooted() post-init below)
  // — never during normal use of the tool.
  //
  // Single-show invariant: server stores the *wrap* of the DEK under
  // the recovery key, never the key bytes themselves. Lose the modal
  // without saving the key and the only path back into the library
  // (if the password is forgotten) is gone. That's why close goes
  // through a "did you really save it?" confirm gate inside the
  // module — Esc + backdrop + explicit button all share the gate.
  //
  // sessionStorage key duplicated here so the boot path can do a
  // cheap synchronous check without paying the import cost in the
  // 99.99% case where nothing is pending. Module owns the same
  // constant; both must agree.
  const RECOVERY_PENDING_KEY = 'ortbtools_recovery_pending_v1';

  // Shell hook: module calls this after the user clicks "I saved it"
  // (post-confirm). We clear #modalRoot here (instead of inside the
  // module) so the module doesn't have to know about the global
  // modalRoot ID, and we chain the history-merge prompt only after
  // the user has explicitly acknowledged — otherwise the merge modal
  // would obscure the key before they had a chance to copy.
  window.__ortbtoolsRecoveryClosed = function () {
    $('modalRoot').innerHTML = '';
    if (_pendingHistoryMerge) {
      _pendingHistoryMerge = false;
      // queueMicrotask defers paint past the current modal close so
      // the next modal opens cleanly (no "flash of two backdrops").
      queueMicrotask(() => openHistoryMergeModal());
    }
  };

  async function openRecoveryKeyModalLazy(recoveryKey) {
    if (typeof window.showRecoveryKeyModal === 'function') {
      return window.showRecoveryKeyModal(recoveryKey);
    }
    try {
      await Promise.all([
        import('/modules/recovery/i18n.js'),
        import('/modules/recovery/index.js'),
      ]);
      window.showRecoveryKeyModal(recoveryKey);
    } catch (err) {
      console.error('[recovery] lazy import failed:', err);
      toast(t('toast.error_generic', { error: 'recovery module load failed' }), 'error');
    }
  }

  // ── History merge (post-register import prompt) ──────────────
  // Triggered by closeRecoveryKeyModal when historyStore has entries.
  // Encrypt + POST each local entry into the user's library serially —
  // sequential keeps the event loop responsive and gives honest progress.
  // Local #modalRoot listener for this modal's two verbs.
  //
  // It has to be local: mountInspector's delegated dispatcher is bound to
  // #app-root, and #modalRoot is a SIBLING of #app-root in the shell chrome
  // (index.*.html closes </main> before declaring it), so a click inside any
  // modal never bubbles anywhere near that dispatcher. Anything drawn into
  // #modalRoot is handled either by /core/modal-host.js's own dispatcher or
  // by a listener like this one; nothing else can see it.
  //
  // Bound ONCE per mount, and neither guard is decoration. The comment that
  // used to sit here claimed "the modal teardown clears innerHTML so the
  // listener detaches automatically with the orphaned DOM nodes" — which is
  // false, and the kind of false that leaves no trace: the listener is on the
  // #modalRoot NODE, and #modalRoot is permanent chrome that closeModal()
  // empties but never replaces. So:
  //   - the flag stops a re-open stacking a second live copy on the same
  //     permanent node, which would run runHistoryMerge() twice off one
  //     click — and the merge has no server-side idempotency key, so that is
  //     duplicate samples in the user's library, not a wasted round trip;
  //   - {signal: ctx.signal} stops an unmount leaving this mount's copy
  //     attached to chrome that outlives it, still closing over this mount's
  //     historyStore. Same reasoning as every other listener in here.
  let _mergeActionsBound = false;
  function bindHistoryMergeActions() {
    if (_mergeActionsBound) return;
    _mergeActionsBound = true;
    $('modalRoot').addEventListener(
      'click',
      (ev) => {
        const target = ev.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'merge-skip') return window.closeModal();
        if (action === 'merge-import') return runHistoryMerge();
      },
      { signal: ctx.signal },
    );
  }

  function openHistoryMergeModal() {
    const count = historyStore.length;
    if (!count) return;
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
      '<div class="modal-card">' +
      '<div class="modal-title">' +
      t('merge.title') +
      '</div>' +
      '<div style="font-size:var(--fs-sm);line-height:1.5;margin-bottom:var(--space-3);color:var(--text)">' +
      t('merge.body', { count }) +
      '</div>' +
      '<div id="mergeProgress" style="font-size:var(--fs-sm);color:var(--text-dim);min-height:1.2em;margin-bottom:var(--space-2)"></div>' +
      '<div class="modal-actions" style="justify-content:space-between">' +
      '<button class="btn btn-ghost btn-sm" data-action="merge-skip">' +
      t('merge.btn.skip') +
      '</button>' +
      '<button id="mergeConfirmBtn" class="btn btn-primary btn-sm" data-action="merge-import">' +
      t('merge.btn.import', { count }) +
      '</button>' +
      '</div></div></div>';
    bindHistoryMergeActions();
  }

  async function runHistoryMerge() {
    if (!session.hasSession()) {
      toast(t('toast.crypto_session_lost'), 'error');
      return;
    }
    // Snapshot so concurrent renderHistory mutations don't desync indexing.
    const entries = historyStore.slice();
    const total = entries.length;
    const progressEl = $('mergeProgress');
    const confirmBtn = $('mergeConfirmBtn');
    const skipBtn = $('modalRoot').querySelector('[data-action="merge-skip"]');
    if (confirmBtn) confirmBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;

    let imported = 0;
    let failed = 0;
    // Remove successfully-imported entries from historyStore as we go so
    // a mid-merge tab close doesn't leave the user re-importing the same
    // 10 entries on next visit (would create duplicates server-side
    // since there's no idempotency key). Entries that fail mid-batch
    // stay in history so the user can retry later.
    const remaining = entries.slice();
    for (let i = 0; i < entries.length; i++) {
      if (progressEl) {
        progressEl.textContent = t('merge.progress', { i: i + 1, total });
      }
      const e = entries[i];
      try {
        const encReq = await session.encryptBlob(e.req || '');
        const encRes = await session.encryptBlob(e.res || '');
        await session.api('POST', 'api/samples', {
          title: e.title || 'imported sample',
          partner_id: null,
          notes: '',
          status: e.status || '',
          bid_req: encReq.ct,
          req_iv: encReq.iv,
          bid_res: encRes.ct,
          res_iv: encRes.iv,
        });
        imported++;
        // Remove from working copy on success.
        const idx = remaining.indexOf(e);
        if (idx !== -1) remaining.splice(idx, 1);
        // Sync historyStore + persist after each success — bounds the
        // damage from a tab-close to whatever was in flight at that
        // moment.
        historyStore.length = 0;
        for (const r of remaining) historyStore.push(r);
        persistHistory();
      } catch (err) {
        failed++;
        console.warn('[history-merge] entry', i, 'failed:', err && err.message);
      }
    }
    // Final repaint of the sidebar after batch completion.
    if (typeof renderHistory === 'function') renderHistory();

    window.closeModal();
    if (failed === 0) {
      toast(t('toast.merge_done', { count: imported }), 'success');
    } else if (imported === 0) {
      toast(t('toast.merge_failed', { failed }), 'error');
    } else {
      toast(t('toast.merge_partial', { imported, failed }), 'warning');
    }
    refreshSamples();
  }

  // window.signOut now lives in /core/session.js (chrome-level: it must work
  // regardless of which section — or none — is mounted, e.g. the unlock
  // modal's escape route reaches it even when Inspector state is stale).
  // It calls session.clearSession(), which notifies THIS mount's adapter via
  // clearInspectorState (registered below) so refreshSamples()/
  // renderAuthWidget() still run on logout exactly as before.

  // ── Phase 8: forgot/reset password + email verification ──────────────
  // The forgot/reset password flow lives in /modules/password-reset/
  // (lazy-loaded). Triggers:
  //   - 'open-forgot' data-action          → window.openForgotPasswordFlow
  //   - ?reset=<token> URL boot detection  → window.openPasswordResetFlow
  // The dispatcher cases live in /core/modal-host.js (modal-content actions).
  // The shell's closeModal() reads window.__ortbtoolsResetActive to know
  // when to strip ?reset= from the URL on Esc/backdrop close. The DEK
  // installed after a successful reset goes through
  // OrtbtoolsSession.importDEKFromBytes() — raw DEK bytes never touch
  // this closure.

  window.requestVerifyEmail = async function () {
    try {
      const j = await session.api('POST', 'api/auth/verify-email/request');
      // Server returns 200 even when delivery fails (Cloudflare edge would
      // otherwise swallow a 5xx body). Inspect the flag to surface the
      // truth instead of always celebrating.
      if (j && j.email_sent === false) {
        toast(t('toast.send_failed', { error: j.email_error || '' }), 'error');
      } else {
        toast(
          t('toast.verify_email_sent', { email: (session.user && session.user.email) || '' }),
          'success',
        );
      }
    } catch (e) {
      toast(t('toast.send_failed', { error: e.message || '' }), 'error');
    }
  };

  function renderVerifyBanner() {
    const banner = $('verifyBanner');
    if (!banner) return;
    if (session.user && !session.user.email_verified_at) {
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }

  // ── Finding-detail expand ────────────────────────────────────────────
  // Walk a ortbtools-style JSON path ('imp[0].banner.w', 'seatbid[1].bid[0]
  // .price', 'regs.gdpr_consent') against the parsed bidReq/bidRes object
  // and return the value at that path. Returns undefined if the path
  // can't be resolved.
  function getJsonAtPath(obj, path) {
    if (obj == null || !path) return undefined;
    let cur = obj;
    const parts = path.split('.');
    for (const part of parts) {
      if (cur == null) return undefined;
      const m = part.match(/^([^[]*)((?:\[\d+\])*)$/);
      if (!m) return undefined;
      const key = m[1];
      if (key) {
        if (typeof cur !== 'object') return undefined;
        cur = cur[key];
      }
      const idxStr = m[2];
      if (idxStr) {
        const indices = idxStr.match(/\d+/g) || [];
        for (const idx of indices) {
          if (cur == null || !Array.isArray(cur)) return undefined;
          cur = cur[Number(idx)];
        }
      }
    }
    return cur;
  }
  window.getJsonAtPath = getJsonAtPath;

  // Resolve a finding's path to its actual value in the user's pasted JSON.
  //
  // `side` is the finding's OWN declared pane — data-finding-side, which comes
  // from location.primary.side, which comes from the validate() call context.
  // When we have it, it is the only thing consulted, and there is deliberately
  // no cross-pane fallback: a response-side finding is answered out of the
  // response, and if the path is not in the response the honest answer is
  // "field missing" — which is what the panel's value_missing copy already
  // says, and usually why the finding exists.
  //
  // The old code had no side to consult and guessed one from the finding id
  // and path (`response.*`, `crosscheck.bid*`, `seatbid*`), then searched the
  // other pane when the guess came up empty. Both halves were wrong in the
  // same direction. Request and response share key names by design — `cur`,
  // `id`, `bidfloor`, `at` — so the fallback did not merely fail to find the
  // value, it reliably found a DIFFERENT one and printed it as fact:
  // err-bid-currency-invalid (path `cur`, side response) showed the request's
  // ["USD"] while complaining about the response's "usd", under a badge that
  // correctly read "response". A panel disagreeing with itself is worse than a
  // panel admitting it does not know.
  //
  // The heuristic survives below for findings that carry no location contract
  // — browser-side temp-dialect findings, injected after the server attached
  // locations to everything else. It is an explicit guess, so it keeps its
  // cross-pane fallback: with no declared side, a value found somewhere is
  // still better than nothing.
  function resolveFindingValue(path, findingId, side) {
    const last = window.__ortbtoolsLast;
    if (!last) return { found: false };
    if (side === 'request' || side === 'response') {
      const v = getJsonAtPath(side === 'response' ? last.res : last.req, path);
      return v === undefined ? { found: false } : { found: true, value: v };
    }
    const isResponseSide =
      (findingId && /^response\b|^crosscheck\.bid\b/.test(findingId)) || /^seatbid\b/.test(path);
    const primary = isResponseSide ? last.res : last.req;
    const secondary = isResponseSide ? last.req : last.res;
    let v = getJsonAtPath(primary, path);
    if (v === undefined) v = getJsonAtPath(secondary, path);
    return v === undefined ? { found: false } : { found: true, value: v };
  }

  // ── `question` severity copy ─────────────────────────────────────────
  // `question` has been a first-class engine level since v8 (packages/core
  // findings.js LEVELS, its own group in renderSeverityTabs, its own rank in
  // SEV_RANK) and on a real payload it is the most frequent level on screen —
  // dialects.question.unknown_ext_signal fires once per ext key the active
  // dialect does not know. public/i18n.js, though, only ever grew
  // finding.severity copy for error/warning/info, so severityCopy() fell
  // through to `{ label: level, text: '' }` and the detail panel's severity
  // row rendered as "question · " — the bare English level name, a separator,
  // and nothing. On the one level whose entire meaning is "this blocks
  // nothing, I am asking you something", saying nothing is the worst
  // available answer.
  //
  // The text has to be true, so it states the two facts an operator acts on:
  // rollupStatus() filters LEVELS.QUESTION out before deciding the verdict
  // (findings.js — a payload of nothing but questions rolls up `clean`), and
  // the way to make one stop asking is to map the signal, which is what the
  // card's own "Розмітити" button does.
  //
  // Registered through the per-module i18n channel every /modules/*/i18n.js
  // already uses, rather than by editing public/i18n.js, and only when the
  // central catalogue does not already answer: window.t returns '[key]' for a
  // key it cannot resolve, which is the cheapest honest probe available. If
  // the keys later land in public/i18n.js this block stands down instead of
  // shadowing them. The label stays the raw English level name because its
  // three siblings do — 'error'/'warning'/'info' are untranslated in all
  // three locale blocks, and a lone localised 'питання' beside them would
  // read as a different kind of thing.
  const QUESTION_SEVERITY_I18N = {
    id: 'inspector-severity-question',
    keys: {
      'finding.severity.question.label': { uk: 'question', en: 'question', ru: 'question' },
      'finding.severity.question.text': {
        uk: 'Не блокує — цей рівень не впливає на статус аналізу. Движок не впізнав сигнал і питає тебе: розмітиш його — і наступні payload читатимуться вже з ним.',
        en: 'Not blocking — this level never changes the verdict. The engine did not recognise the signal and is asking you to name it; map it once and later payloads are read with it.',
        ru: 'Не блокирует — этот уровень не влияет на статус анализа. Движок не распознал сигнал и спрашивает тебя: разметишь его — и следующие payload будут читаться уже с ним.',
      },
    },
  };
  let _questionCopyChecked = false;
  function ensureQuestionSeverityCopy() {
    if (_questionCopyChecked) return;
    _questionCopyChecked = true;
    if (typeof window.registerI18nModule !== 'function') return;
    if (t('finding.severity.question.label') !== '[finding.severity.question.label]') return;
    window.registerI18nModule(QUESTION_SEVERITY_I18N);
  }

  function severityCopy(level) {
    if (level === 'error' || level === 'danger')
      return { label: t('finding.severity.error.label'), text: t('finding.severity.error.text') };
    if (level === 'warning')
      return {
        label: t('finding.severity.warning.label'),
        text: t('finding.severity.warning.text'),
      };
    if (level === 'info')
      return { label: t('finding.severity.info.label'), text: t('finding.severity.info.text') };
    if (level === 'question') {
      ensureQuestionSeverityCopy();
      return {
        label: t('finding.severity.question.label'),
        text: t('finding.severity.question.text'),
      };
    }
    return { label: level || '?', text: '' };
  }

  function buildFindingDetailHtml(ds) {
    const path = ds.findingPath || '';
    const id = ds.findingId || '';
    const level = ds.findingLevel || '';
    const spec = ds.findingSpec || '';
    // Written by buildFindingHtml from location.primary.side — the pane the
    // server says this finding is about. Empty only for findings that reached
    // the panel without a location contract; resolveFindingValue falls back to
    // its old heuristic for exactly those.
    const side = ds.findingSide || '';

    const sev = severityCopy(level);
    let valueBlock;
    if (path) {
      const r = resolveFindingValue(path, id, side);
      if (r.found) {
        const v = r.value;
        const formatted = typeof v === 'object' ? JSON.stringify(v, null, 2) : JSON.stringify(v);
        valueBlock =
          '<div class="finding-detail-row"><span class="finding-detail-label">' +
          escapeHtml(t('finding.detail.value_at_path')) +
          '</span>' +
          '<pre class="finding-detail-value">' +
          escapeHtml(formatted) +
          '</pre>' +
          '</div>';
      } else {
        valueBlock =
          '<div class="finding-detail-row"><span class="finding-detail-label">' +
          escapeHtml(t('finding.detail.value_at_path')) +
          '</span>' +
          '<div class="finding-detail-value-missing">' +
          escapeHtml(t('finding.detail.value_missing')) +
          '</div></div>';
      }
    } else {
      valueBlock = '';
    }

    const pathBlock = path
      ? '<div class="finding-detail-row"><span class="finding-detail-label">' +
        escapeHtml(t('finding.detail.path')) +
        '</span>' +
        '<code class="finding-detail-path">' +
        escapeHtml(path) +
        '</code>' +
        '</div>'
      : '';

    const sevBlock =
      '<div class="finding-detail-row"><span class="finding-detail-label">' +
      escapeHtml(t('finding.detail.severity')) +
      '</span>' +
      '<div class="finding-detail-severity">' +
      '<strong>' +
      escapeHtml(sev.label) +
      '</strong>' +
      // The separator belongs to the text, not to the label. A level with no
      // copy used to render "<strong>question</strong> · " and the trailing
      // middot advertised a sentence that never arrived. Any future level
      // that reaches the fallback branch now reads as a bare name instead.
      (sev.text ? ' · ' + escapeHtml(sev.text) : '') +
      '</div></div>';

    const specBlock = spec
      ? '<div class="finding-detail-row"><span class="finding-detail-label">' +
        escapeHtml(t('finding.detail.spec')) +
        '</span>' +
        '<a class="finding-detail-spec" href="' +
        escapeHtml(spec) +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(spec) +
        ' ↗</a>' +
        '</div>'
      : '';

    const idBlock = id
      ? '<div class="finding-detail-row"><span class="finding-detail-label">' +
        escapeHtml(t('finding.detail.rule_id')) +
        '</span>' +
        '<code class="finding-detail-id">' +
        escapeHtml(id) +
        '</code>' +
        '</div>'
      : '';

    return pathBlock + valueBlock + sevBlock + specBlock + idBlock;
  }

  // ── Tab-title status ─────────────────────────────────────────────────
  // Reflect analysis verdict in document.title so users running multiple
  // ortbtools tabs see at a glance which one ended in errors. Reset on
  // first input change after analysis (the verdict is stale once user
  // starts editing).
  const _baseTabTitle = document.title;
  function setTabStatus(validation) {
    if (!validation || typeof document === 'undefined') return;
    const errs = (validation.findings || []).filter((f) => f.level === 'error').length;
    const warns = (validation.findings || []).filter((f) => f.level === 'warning').length;
    let badge = '';
    if (validation.status === 'invalid') badge = '⚠ invalid';
    else if (errs) badge = '⚠ ' + errs + ' error' + (errs === 1 ? '' : 's');
    else if (warns) badge = '! ' + warns + ' warn' + (warns === 1 ? '' : 's');
    else badge = '✓ clean';
    document.title = 'ortbtools · ' + badge;
  }
  function resetTabStatus() {
    if (typeof document === 'undefined') return;
    if (document.title !== _baseTabTitle) document.title = _baseTabTitle;
  }
  window.setTabStatus = setTabStatus;

  function humanStatus(s) {
    // Canonical (new validator) statuses — pull from i18n bundle so they
    // pivot UK ↔ EN with the language toggle.
    if (s === 'errors') return t('status.errors');
    if (s === 'warnings') return t('status.warnings');
    if (s === 'clean') return t('status.clean');
    if (s === 'invalid') return t('status.invalid');
    // Backward compat with the pre-Phase-1 server (transitional). Map legacy
    // capitalized labels onto the same i18n keys as the modern lowercase set.
    if (s === 'Critical') return t('status.errors');
    if (s === 'Healthy') return t('status.clean');
    if (s === 'Invalid') return t('status.invalid');
    if (s === 'Valid') return t('status.clean');
    return s || '';
  }
  window.humanStatus = humanStatus;

  async function refreshPartners() {
    if (!session.user) {
      _partnerCache = [];
      const sel = $('partnerFilter');
      sel.innerHTML =
        '<option value="">' +
        t('sample.partner_all') +
        '</option><option value="unassigned">' +
        t('sample.partner_none') +
        '</option>';
      return;
    }
    try {
      const j = await session.api('GET', 'api/partners', undefined, { signal: ctx.signal });
      if (ctx.signal.aborted) return; // unmounted during the request
      _partnerCache = j.partners || [];
      const sel = $('partnerFilter');
      const cur = sel.value;
      sel.innerHTML =
        '<option value="">' +
        t('sample.partner_all') +
        '</option>' +
        '<option value="unassigned">' +
        t('sample.partner_none') +
        '</option>' +
        _partnerCache
          .map((p) => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>')
          .join('');
      if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    } catch (e) {
      if (ctx.signal.aborted) return; // unmounted — don't paint/toast into a remount
      if (e.status === 401) {
        // session expired — fall back to anonymous state cleanly
        session.setUser(null);
        renderAuthWidget();
        return;
      }
      toast(t('toast.partners_load_failed', { error: e.message }), 'error');
    }
  }

  // Exposed for the lazy-loaded partners module (modules/partners/index.js).
  // The module renders the partners list + add/delete actions; it needs
  // to read+invalidate the cache that refreshPartners owns.
  window.refreshPartners = refreshPartners;
  window.getPartners = () => _partnerCache;

  async function refreshSamples() {
    const el = $('savedList');
    const wrap = $('libraryWrap');
    if (!session.user) {
      // Anonymous: hide the whole Library block — save action lives in
      // the bid-request toolbar; signing in surfaces the section once
      // there are samples to show.
      if (wrap) wrap.hidden = true;
      el.innerHTML = '';
      return;
    }
    // Logged-in but DEK is gone (page reload): surface unlock CTA inside
    // the Library wrapper so the user sees something actionable.
    if (session.pendingUnlock && !session.hasSession()) {
      if (wrap) wrap.hidden = false;
      el.innerHTML =
        '<div class="anon-cta">' +
        t('sample.unlock_cta') +
        '<br><button class="btn btn-primary btn-sm" data-action="open-unlock">' +
        t('sample.btn.unlock') +
        '</button></div>';
      return;
    }
    const sel = $('partnerFilter');
    const v = sel.value;
    const qs = v === '' ? '' : '?partner_id=' + encodeURIComponent(v);
    try {
      const j = await session.api('GET', 'api/samples' + qs, undefined, { signal: ctx.signal });
      if (ctx.signal.aborted) return; // unmounted during the request
      const list = j.samples || [];
      if (!list.length) {
        // No saved samples — keep the wrapper visible only when the user
        // is filtering by a specific partner (so they can switch back to
        // "all partners"); otherwise hide the section entirely.
        if (wrap) wrap.hidden = !v;
        el.innerHTML = v ? '<div class="saved-empty">' + t('empty.samples') + '</div>' : '';
        return;
      }
      if (wrap) wrap.hidden = false;
      const partnerName = (id) => {
        if (id == null) return t('sample.partner_unassigned');
        const p = _partnerCache.find((x) => x.id === id);
        return p ? p.name : t('fallback.partner_id', { id });
      };
      // Stored req_len/res_len are length(ciphertext_base64). The original
      // JSON byte count ≈ ciphertext_bytes − 16 (AES-GCM auth tag). Base64
      // chars → bytes via *3/4. Subtract the tag, clamp to ≥ 0. Result is
      // a rough estimate; we don't render decimals.
      const plainKb = (n) => {
        const bytes = Math.max(0, Math.round((n * 3) / 4) - 16);
        return Math.round(bytes / 1024);
      };
      el.innerHTML = list
        .map((s) => {
          const pieces = [];
          if (s.req_len) pieces.push('req ~' + plainKb(s.req_len) + 'k');
          if (s.res_len) pieces.push('res ~' + plainKb(s.res_len) + 'k');
          if (s.status) pieces.push(escapeHtml(humanStatus(s.status)));
          return (
            '<div class="saved-item" data-action="sample-load" data-id="' +
            s.id +
            '">' +
            '<div class="saved-item-actions">' +
            '<button class="saved-act-btn" data-action="sample-edit" data-id="' +
            s.id +
            '" title="' +
            escapeHtml(t('tooltip.partner_edit')) +
            '">edit</button>' +
            '<button class="saved-act-btn danger" data-action="sample-delete" data-id="' +
            s.id +
            '" title="' +
            escapeHtml(t('tooltip.delete')) +
            '">×</button>' +
            '</div>' +
            '<div class="saved-item-title">' +
            escapeHtml(s.title) +
            '</div>' +
            '<div class="saved-item-meta">' +
            '<span>' +
            escapeHtml(partnerName(s.partner_id)) +
            '</span>' +
            (pieces.length ? '<span>·</span><span>' + pieces.join(' · ') + '</span>' : '') +
            '</div>' +
            '</div>'
          );
        })
        .join('');
    } catch (e) {
      if (ctx.signal.aborted) return; // unmounted — don't paint/toast into a remount
      if (e.status === 401) {
        session.setUser(null);
        renderAuthWidget();
        refreshSamples(); // re-render anonymous state
        return;
      }
      toast(t('toast.samples_load_failed', { error: e.message }), 'error');
    }
  }

  // closeModal() and wireEnterSubmit() now live at chrome level
  // (/core/modal-host.js and /core/session.js respectively, ROADMAP #18) —
  // #modalRoot is shell-owned, so modal lifecycle can't be Inspector-mount-
  // scoped. Callers here use window.closeModal() / session.wireEnterSubmit().

  function partnerOptionsHtml(selectedId) {
    // Coerce to Number for the equality check — JSON.parse may surface
    // partner_id as a string (depending on serializer chain), and strict
    // === would silently fail to mark the right option as selected.
    // Result: edit modal opens with "no partner" instead of the assigned one.
    const wantId = selectedId == null ? null : Number(selectedId);
    return (
      '<option value="">' +
      t('sample.partner_none') +
      '</option>' +
      _partnerCache
        .map(
          (p) =>
            '<option value="' +
            p.id +
            '"' +
            (wantId !== null && Number(p.id) === wantId ? ' selected' : '') +
            '>' +
            escapeHtml(p.name) +
            '</option>',
        )
        .join('')
    );
  }

  // window.OrtbtoolsSession is now installed ONCE at shell boot
  // (public/core/session.js's installSessionFacade()) — session/crypto
  // methods delegate to the shell service; the Inspector-specific ones
  // (currentSampleId, isDirty, partnerCache, refreshPartners/Samples,
  // renderAuthWidget/VerifyBanner, partnerOptionsHtml) delegate to whichever
  // Inspector adapter is currently registered (see registerAdapter below) —
  // a safe no-op when Inspector isn't mounted. DEK never leaves session.js.

  // ── Save-sample modal — MOVED to modules/save-sample/ (lazy) ─────────
  // openSaveModal + suggestPartnerForSave + _spy_pickPartner +
  // _spy_createPartner + confirmSave (≈265 LOC) now live in
  // /modules/save-sample/index.js and are fetched on first click of
  // the "💾 зберегти" button (case 'save-sample' in the dispatcher
  // below). State + crypto access goes through the OrtbtoolsSession
  // facade — no closure-private references in the module.

  // ── Simulate modal — MOVED to modules/simulate/ (lazy) ──────────────
  // It fetches on first click (`case 'sim-bids'` in the dispatcher below).
  // Pre-migration this block held openSimBidsModal (~105 LOC, deterministic
  // 3-strategy DSP demo); it now stays out of the initial bundle until used.

  // ── Mirror modal — MOVED to modules/mirror/ (lazy-loaded) ────────────
  // The implementation lives in /modules/mirror/index.js and is fetched
  // on first click of the "дзеркало ↔" button (case 'mirror' in the
  // dispatcher above). Pre-migration this block held openMirrorModal +
  // diffJsonForMirror + truncate (≈220 LOC); they're now ES-imported
  // helpers inside the module. ~25KB stays out of the initial JS
  // bundle until a user actually opens mirror.
  async function loadSample(id) {
    if (!session.hasSession()) {
      toast(t('toast.crypto_session_lost'), 'error');
      return;
    }
    // Clobber-protection: warn before discarding unsaved edits.
    const hasContent = ($('bidReq').value || '').trim() || ($('bidRes').value || '').trim();
    if (_isDirty && hasContent) {
      if (!confirm(t('confirm.clobber_load'))) {
        return;
      }
    }
    try {
      const j = await session.api('GET', 'api/samples/' + id, undefined, { signal: ctx.signal });
      const s = j.sample;
      // Decrypt locally — server returned opaque ciphertext + IVs.
      const reqText = await session.decryptBlob(s.req_iv, s.bid_req);
      const resText = await session.decryptBlob(s.res_iv, s.bid_res);
      if (ctx.signal.aborted) return; // unmounted during fetch/decrypt — don't fill a remount's editors
      setEditorValue('bidReq', reqText);
      setEditorValue('bidRes', resText);
      updateCharCount('bidReq');
      updateCharCount('bidRes');
      _currentSampleId = s.id;
      _currentSampleMeta = {
        title: s.title,
        partner_id: s.partner_id,
        notes: s.notes || '',
      };
      _isDirty = false;
      toast(t('toast.loaded', { title: s.title }), 'success');
    } catch (e) {
      // Most common cause: tampered ciphertext or wrong DEK (e.g. cookie
      // outlived the in-memory DEK after a page reload without re-login).
      // AES-GCM doesn't tell us *which* (tamper vs key mismatch are
      // indistinguishable by design). The actionable hint is "log out and
      // back in" — fixes both legitimate causes (rotated DEK, stale
      // session DEK reference). Don't echo the raw exception name —
      // 'OperationError' is meaningless to non-cryptographers.
      if (ctx.signal.aborted) return; // unmounted — swallow the abort, don't toast into a remount
      console.error('[loadSample]', e);
      toast(t('toast.decrypt_failed_with_hint'), 'error');
    }
  }

  // 🎲 demo example — pulls one synthetic specimen from /api/v1/sample
  // and pre-fills both editors. First-time visitor onboarding: the empty
  // Playground was bouncing people who didn't know what to paste. Now
  // the dice menu gives them random or specific attack patterns.
  // Optional `type` selects a specific specimen (e.g. 'clean-banner',
  // 'frame-bust-form'); omitted = random.
  const INSPECTOR_ONBOARD_KEY = 'themis.inspectorOnboardingDismissed';

  function dismissInspectorOnboarding() {
    try {
      localStorage.setItem(INSPECTOR_ONBOARD_KEY, '1');
    } catch (_e) {
      /* */
    }
    root.querySelectorAll('.kt-onboarding-banner').forEach((el) => el.remove());
    root.querySelectorAll('.kt-onboarding-pulse').forEach((el) => {
      el.classList.remove('kt-onboarding-pulse');
    });
  }

  function maybeShowInspectorOnboarding() {
    try {
      if (localStorage.getItem(INSPECTOR_ONBOARD_KEY)) return;
    } catch (_e) {
      return;
    }
    const reqEl = $('bidReq');
    const resEl = $('bidRes');
    if (!reqEl || !resEl) return;
    if ((reqEl.value || '').trim() || (resEl.value || '').trim()) return;
    if (root.querySelector('.kt-onboarding-banner')) return;

    const exampleMenu = root.querySelector('.kt-example-menu');
    if (exampleMenu) exampleMenu.classList.add('kt-onboarding-pulse');

    const banner = document.createElement('div');
    banner.className = 'kt-onboarding-banner';
    banner.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = t('onboarding.banner.text');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm';
    btn.dataset.action = 'dismiss-onboarding';
    btn.textContent = t('onboarding.banner.dismiss');
    banner.append(text, btn);

    const header = root.querySelector('.app-header');
    if (header) header.insertAdjacentElement('afterend', banner);
  }

  async function loadDemoSample(type) {
    const hasContent = ($('bidReq').value || '').trim() || ($('bidRes').value || '').trim();
    if (_isDirty && hasContent) {
      if (!confirm(t('confirm.clobber_load'))) return;
    }
    try {
      const url = '/api/v1/sample' + (type ? '?type=' + encodeURIComponent(type) : '');
      const j = await fetch(url, { signal: ctx.signal }).then((r) => r.json());
      if (ctx.signal.aborted) return; // unmounted during the request
      if (!j || !j.success) throw new Error(j && j.error ? j.error : 'unexpected');
      setEditorValue('bidReq', JSON.stringify(j.bid_request, null, 2));
      setEditorValue('bidRes', JSON.stringify(j.bid_response, null, 2));
      updateCharCount('bidReq');
      updateCharCount('bidRes');
      _currentSampleId = null;
      _currentSampleMeta = null;
      _isDirty = false;
      toast('🎲 ' + j.label, 'success');
      dismissInspectorOnboarding();
      // Auto-close the dropdown after pick.
      document.querySelectorAll('.kt-example-menu[open]').forEach((d) => d.removeAttribute('open'));
    } catch (e) {
      if (ctx.signal.aborted) return; // unmounted — swallow the abort, don't toast into a remount
      console.error('[loadDemoSample]', e);
      toast(t('toast.sample_load_failed'), 'error');
    }
  }

  async function deleteSample(id) {
    if (!confirm(t('confirm.delete_sample'))) return;
    try {
      // Mutation: NOT aborted on unmount (let the delete complete server-side);
      // we only guard the response so it can't refresh/toast into a remount.
      await session.api('DELETE', 'api/samples/' + id);
      if (ctx.signal.aborted) return;
      // If the deleted sample is the one currently loaded, drop the anchor
      // so the next save creates a fresh record (not a 404 PATCH).
      if (_currentSampleId === id) {
        _currentSampleId = null;
        _currentSampleMeta = null;
      }
      toast(t('toast.deleted'), 'success');
      refreshSamples();
    } catch (e) {
      if (ctx.signal.aborted) return;
      toast(t('toast.delete_failed', { error: e.message }), 'error');
    }
  }

  // editSample + confirmEdit migrated to /modules/edit-sample/ on
  // 2026-05-10. Lazy-loaded by the 'sample-edit' dispatcher case;
  // 'confirm-edit' calls window.confirmEdit which the module
  // self-registers on first load.

  // window.closeModal is installed ONCE at shell boot by /core/modal-host.js
  // (ROADMAP #18) — no per-mount assignment here anymore.

  // Sidebar visibility toggles. Click ◀ in the tab-bar to hide the left
  // sidebar (summary/library/history); click ▶ at the right end to hide
  // the ad-preview sidebar. State persists in localStorage so refreshes
  // keep the user's choice.
  //
  // 2026-05-06 hotfix — defensive bugfix for "iframe disappeared" P0
  // (root cause was localStorage.spy-sb-right-hidden=1 from a forgotten
  // earlier toggle, leaving users unable to find the preview pane). We
  // keep the persistence (deliberate hides should survive refreshes)
  // but add a health-check at mount that reclaims the panel for users
  // who almost certainly aren't using a hidden state on purpose anymore.
  const SB_HIDDEN_KEYS = { left: 'spy-sb-left-hidden', right: 'spy-sb-right-hidden' };
  const SB_HIDDEN_TS_KEYS = { left: 'spy-sb-left-hidden-ts', right: 'spy-sb-right-hidden-ts' };
  // 7 days. A user actively using a hidden-panel layout re-toggles often
  // enough that the timestamp stays fresh; one-off forgetting decays.
  const SB_STALE_MS = 7 * 24 * 60 * 60 * 1000;

  function arrowFor(side, hidden) {
    if (side === 'left') return hidden ? '▶' : '◀';
    return hidden ? '◀' : '▶';
  }

  // Health-check on a saved 'hidden' preference. Returns one of:
  //   'respect'  — apply the preference (user deliberately hid this panel
  //                recently; layout is theirs)
  //   'override' — don't apply this mount, but keep localStorage. The
  //                current task wants the panel visible (e.g. bidRes is
  //                staged for the right-sidebar preview pane); their
  //                long-term preference may still be valid.
  //   'expire'   — don't apply AND clear localStorage. The preference is
  //                older than SB_STALE_MS and the user is on a desktop
  //                viewport — almost certainly forgotten state. Clearing
  //                prevents the next refresh from re-trapping them.
  //
  // Why a tiered verdict instead of a binary force-show: a deliberate
  // "I work in JSON-only mode" user shouldn't be auto-undone. They get
  // 'respect' even on cold starts because their toggle timestamp stays
  // fresh through regular use. Only forgotten or clearly-conflicting
  // hides are reclaimed.
  function checkSidebarHealth(side) {
    let savedAt = 0;
    try {
      savedAt = parseInt(localStorage.getItem(SB_HIDDEN_TS_KEYS[side]) || '0', 10);
    } catch (_e) {
      /* private mode → savedAt stays 0, no timestamp = legacy hide before
         this hotfix shipped → treat as fresh, won't expire on first visit */
    }

    // Override 1 (right-sidebar only) — context: the right pane hosts the
    // ad-preview iframe. If a bidRes payload is currently staged in the
    // editor (typed, pasted, or hydrated from history / share-link / saved
    // sample), the user is about to need the preview. A hidden panel here
    // would silently swallow the rendered creative. Show it; don't touch
    // their saved preference.
    if (side === 'right') {
      const resEl = document.getElementById('bidRes');
      if (resEl && resEl.value && resEl.value.trim()) return 'override';
    }

    // Override 2 (staleness) — desktop only. Hide preferences older than
    // SB_STALE_MS came from a session the user has likely forgotten about.
    // We skip narrow viewports (<1280px) where responsive media queries
    // dominate the sidebar layout anyway and the hidden class is mostly
    // moot. Pre-hotfix hides have no timestamp (savedAt === 0) and are
    // grandfathered in as 'respect' — we don't retroactively expire
    // existing saved preferences.
    if (savedAt > 0 && window.innerWidth >= 1280) {
      if (Date.now() - savedAt > SB_STALE_MS) return 'expire';
    }

    return 'respect';
  }

  function toggleSidebar(side) {
    const cls = 'sb-' + side + '-hidden';
    const isHidden = document.body.classList.toggle(cls);
    try {
      // Refresh both flag AND timestamp on every toggle. Active users keep
      // their 'recent' status across the SB_STALE_MS window naturally;
      // forgotten state ages out without further action.
      localStorage.setItem(SB_HIDDEN_KEYS[side], isHidden ? '1' : '0');
      localStorage.setItem(SB_HIDDEN_TS_KEYS[side], String(Date.now()));
    } catch (_e) {
      /* private mode */
    }
    const btn = document.getElementById(
      side === 'left' ? 'toggleSidebarLeft' : 'toggleSidebarRight',
    );
    if (btn && !btn.hasAttribute('data-static-icon')) btn.textContent = arrowFor(side, isHidden);
  }

  function setupSidebarToggles() {
    ['left', 'right'].forEach((side) => {
      const cls = 'sb-' + side + '-hidden';
      let saved;
      try {
        saved = localStorage.getItem(SB_HIDDEN_KEYS[side]);
      } catch (_e) {
        saved = null;
      }

      // v2: the left sidebar became an overlay drawer, so its resting state
      // is closed. It holds history, the saved library and the metric card —
      // reference material, consulted occasionally, which was charging 320px
      // of permanent rent for that. A stored preference still wins; this only
      // changes what happens when there is none.
      if (side === 'left' && saved === null) {
        document.body.classList.add(cls);
      }

      if (saved === '1') {
        const verdict = checkSidebarHealth(side);
        if (verdict === 'respect') {
          document.body.classList.add(cls);
        } else if (verdict === 'expire') {
          // Stale preference — sync localStorage so the user lands in a
          // clean default on next visit instead of re-checking every time.
          try {
            localStorage.removeItem(SB_HIDDEN_KEYS[side]);
            localStorage.removeItem(SB_HIDDEN_TS_KEYS[side]);
          } catch (_e) {
            /* */
          }
        }
        // 'override' — leave class off, leave localStorage intact (one-time
        // contextual override; long-term preference is still saved).
      }

      const btn = document.getElementById(
        side === 'left' ? 'toggleSidebarLeft' : 'toggleSidebarRight',
      );
      if (btn && !btn.hasAttribute('data-static-icon'))
        btn.textContent = arrowFor(side, document.body.classList.contains(cls));
    });
  }

  // Reset Layout — escape hatch from any persisted sidebar state. Wipes
  // both flags + both timestamps and shows both panels. Bound to a small
  // ↺ button in the footer (template) and to a 'reset-layout' data-action.
  function resetLayout() {
    ['left', 'right'].forEach((side) => {
      // "Reset" means the DEFAULT layout, and v2 changed what the default
      // is: the left sidebar became an overlay drawer whose resting state is
      // closed — the sb-left-hidden class PRESENT. This function predates
      // that and removed the class for both sides, so clicking reset with
      // the drawer open cleared the stored preference and left the drawer
      // sitting there; only a reload (which re-derives the default) closed
      // it. A reset that needs a reload to take effect is not a reset.
      document.body.classList.toggle('sb-' + side + '-hidden', side === 'left');
      try {
        localStorage.removeItem(SB_HIDDEN_KEYS[side]);
        localStorage.removeItem(SB_HIDDEN_TS_KEYS[side]);
      } catch (_e) {
        /* */
      }
      const btn = document.getElementById(
        side === 'left' ? 'toggleSidebarLeft' : 'toggleSidebarRight',
      );
      if (btn && !btn.hasAttribute('data-static-icon'))
        btn.textContent = arrowFor(side, side === 'left');
    });
    toast(t('toast.layout.reset'));
  }

  window.toggleSidebar = toggleSidebar;
  window.resetLayout = resetLayout;

  // ── Payload switch ──────────────────────────────────────────────────────
  // Request and Response were two half-height textareas side by side. Each
  // showed about eight lines of JSON, which is less than one `imp` object,
  // so reading a payload meant scrolling a pane the size of a receipt while
  // the other pane sat empty most of the time — a BidResponse is optional
  // and absent from the majority of sessions.
  //
  // One editor at full column height shows ~25 lines. Both cards stay in the
  // DOM: #bidReq and #bidRes are addressed directly by the analyzer, the
  // mirror, diff, migrate, share and a large part of the test suite, and
  // none of that should have to care which side is visible.
  const PAYLOAD_SIDES = { req: 'cardReq', res: 'cardRes' };

  function showPayloadSide(side) {
    if (!PAYLOAD_SIDES[side]) return;
    for (const [key, cardId] of Object.entries(PAYLOAD_SIDES)) {
      const card = document.getElementById(cardId);
      if (card) card.classList.toggle('is-shown', key === side);
    }
    document.querySelectorAll('.payload-switch-btn').forEach((btn) => {
      const on = btn.getAttribute('data-payload') === side;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    refreshPayloadDots();
  }

  /** Mark the side you are NOT looking at as already filled. The two-pane
   *  layout told you this for free by simply being visible; a switch has to
   *  say it explicitly, or a pasted BidResponse becomes invisible. */
  function refreshPayloadDots() {
    // The dot marks the side you are NOT looking at. On the active tab it
    // says nothing — you can see that pane's contents — while on the inactive
    // one it is the only signal that a payload is waiting there. The first
    // cut showed it on both, which made it read as decoration.
    const active =
      (document.querySelector('.payload-switch-btn.is-active') || {}).getAttribute &&
      document.querySelector('.payload-switch-btn.is-active').getAttribute('data-payload');
    for (const [side, inputId, key] of [
      ['Req', 'bidReq', 'req'],
      ['Res', 'bidRes', 'res'],
    ]) {
      const dot = document.getElementById('payloadDot' + side);
      const input = document.getElementById(inputId);
      if (!dot || !input) continue;
      const filled = !!String(input.value || '').trim();
      dot.hidden = !filled || key === active;
    }
  }

  function setupPayloadSwitch() {
    const buttons = document.querySelectorAll('.payload-switch-btn');
    if (!buttons.length) return;
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => showPayloadSide(btn.getAttribute('data-payload')));
    });
    for (const id of ['bidReq', 'bidRes']) {
      const input = document.getElementById(id);
      if (input) input.addEventListener('input', refreshPayloadDots);
    }
    showPayloadSide('req');
    refreshPayloadDots();
  }

  window.showPayloadSide = showPayloadSide;
  window.refreshPayloadDots = refreshPayloadDots;

  // ── Line gutter ─────────────────────────────────────────────────────────
  // The mockup numbers the payload's lines and tints the numbers that carry
  // a finding — red where something blocks, amber where something should be
  // fixed. It is the one place the two halves of this screen touch: a
  // finding says "line 6" and the editor says which line that is.
  //
  // Built as a sibling column rather than inside the textarea, because a
  // textarea cannot contain elements. That means the two must agree on
  // exactly three things — font, line-height and vertical padding — and the
  // CSS sets all three from the same tokens for both. It also means the
  // gutter has to follow the editor's scroll, since only one of them has a
  // scrollbar.
  const GUTTER_OF = { bidReq: 'gutterReq', bidRes: 'gutterRes' };

  function renderGutter(inputId) {
    const input = document.getElementById(inputId);
    const gutter = document.getElementById(GUTTER_OF[inputId]);
    if (!input || !gutter) return;
    const text = String(input.value || '');
    // An empty editor shows no numbers at all: "1" beside a placeholder
    // claims a line exists where none does.
    const lines = text ? text.split('\n').length : 0;
    if (gutter.childElementCount === lines) return;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= lines; i++) {
      const el = document.createElement('span');
      el.className = 'line-no';
      el.dataset.line = String(i);
      el.textContent = String(i);
      frag.appendChild(el);
    }
    gutter.replaceChildren(frag);
    syncGutterScroll(inputId);
  }

  function syncGutterScroll(inputId) {
    const input = document.getElementById(inputId);
    const gutter = document.getElementById(GUTTER_OF[inputId]);
    if (input && gutter) gutter.scrollTop = input.scrollTop;
  }

  /**
   * Tint the numbers that carry a finding.
   *
   * The line for a finding is resolved by source-nav, the same module the
   * path chips ask — so a number tinted red in the gutter and a chip reading
   * "line 6" cannot disagree about which line that is. Severity wins by
   * worst-first: a line carrying both an error and a warning is red, because
   * the reader is being told what to fix first, not what is most numerous.
   */
  function paintGutterSeverity(findings) {
    const nav = window.OrtbtoolsSourceNav;
    for (const id of Object.keys(GUTTER_OF)) {
      const gutter = document.getElementById(GUTTER_OF[id]);
      if (!gutter) continue;
      for (const el of gutter.children) el.removeAttribute('data-severity');
    }
    if (!nav || typeof nav.lineFor !== 'function' || !Array.isArray(findings)) return;
    const RANK = { error: 3, warning: 2, question: 1 };
    const marks = {};
    for (const f of findings) {
      const lvl = f.level === 'danger' ? 'error' : f.level;
      if (!RANK[lvl] || !f.location || !f.location.primary) continue;
      const side = f.location.primary.side === 'response' ? 'bidRes' : 'bidReq';
      const line = nav.lineFor(f.location);
      if (!line) continue;
      const key = side + ':' + line;
      if (!marks[key] || RANK[lvl] > RANK[marks[key]]) marks[key] = lvl;
    }
    for (const [key, lvl] of Object.entries(marks)) {
      const [side, line] = key.split(':');
      const gutter = document.getElementById(GUTTER_OF[side]);
      if (!gutter) continue;
      const el = gutter.querySelector('.line-no[data-line="' + line + '"]');
      if (el) el.dataset.severity = lvl;
    }
  }

  function setupGutters() {
    for (const id of Object.keys(GUTTER_OF)) {
      const input = document.getElementById(id);
      if (!input) continue;
      input.addEventListener('input', () => renderGutter(id));
      input.addEventListener('scroll', () => syncGutterScroll(id));
      renderGutter(id);
    }
  }

  window.renderGutter = renderGutter;
  window.paintGutterSeverity = paintGutterSeverity;

  // ── Init ──────────────────────────────────────────────────────
  // Phase C-2: mount() guarantees the template DOM is injected before
  // calling mountInspector(), and the call itself is awaited inside
  // an async module mount() — which can run AFTER DOMContentLoaded
  // has already fired. Listening for DOMContentLoaded here would
  // silently never trigger. So we just run the init body inline.
  {
    renderReference();
    updateCharCount('bidReq');
    updateCharCount('bidRes');
    setupSidebarToggles();
    setupPayloadSwitch();
    setupGutters();
    maybeShowInspectorOnboarding();

    // Dirty-tracking for save lifecycle. `value =` from JS doesn't fire
    // input events (per HTML spec), so loadSample / clearInput don't
    // accidentally mark the editor dirty. User typing → dirty → save
    // modal can offer "оновити" + clobber-protection on next loadSample.
    ['bidReq', 'bidRes'].forEach((id) => {
      const el = $(id);
      if (el)
        el.addEventListener('input', () => {
          _isDirty = true;
          clearMacros();
          // Typing is the other way the payload stops matching the result.
          // Programmatic loads go through setEditorValue(); this covers the
          // keyboard, which fires input and never touches that helper.
          invalidateIfPayloadChanged();
        });
    });

    const spEl = $('simPrice');
    if (spEl) {
      spEl.addEventListener('input', () => {
        const simP = spEl.value || '';
        if (
          window.OrtbtoolsMacros &&
          typeof window.OrtbtoolsMacros.syncPriceInputs === 'function'
        ) {
          window.OrtbtoolsMacros.syncPriceInputs(simP);
        }
        const el = $('macroEvaluatorContainer');
        if (
          el &&
          window.OrtbtoolsMacros &&
          typeof window.OrtbtoolsMacros.renderMacroTable === 'function'
        ) {
          window.OrtbtoolsMacros.renderMacroTable(
            el,
            _lastExtractedMacros,
            { price: simP },
            reRenderPreview,
          );
          reRenderPreview();
        }
      });
    }

    // Partner filter dropdown — refresh sample list on change. Without
    // this listener users selected a partner and saw no UI reaction.
    const pf = $('partnerFilter');
    if (pf) pf.addEventListener('change', () => refreshSamples());

    // Global Esc-closes-modal now lives in /core/modal-host.js (permanent,
    // installed once at shell boot — ROADMAP #18): #modalRoot is shell-owned
    // chrome, not Inspector-mount-scoped, so this can't be a ctx.signal-bound
    // per-mount listener anymore without missing Esc on every other section.

    // Prefetch the creative-probe source so it's ready when the first
    // adm renders. Fire-and-forget — setAdPreview gracefully renders
    // without the probe if the fetch hasn't resolved yet.
    loadProbeSource();

    // Receive postMessage events from the in-iframe creative probe.
    // Origin will be 'null' for sandboxed iframes (opaque origin), so we
    // can't filter on origin. We pin to the contentWindow reference of
    // the iframe we just mounted (set inside setAdPreview) and reject
    // anything else. Without this any frame on the page could fabricate
    // `ortbtools-probe` events and poison the analysis pipeline.
    // {signal: ctx.signal} so a remount detaches the previous handler,
    // otherwise probe events could fan-out to stale closures.
    window.addEventListener(
      'message',
      (e) => {
        const d = e.data;
        if (!d || d.type !== 'ortbtools-probe') return;
        // Spoof-protection: only accept messages from the currently-mounted
        // probed iframe. Drops events when no iframe is active (VAST/native
        // previews, between-creative gap) and from any unrelated frame.
        if (!_currentProbedIframe || e.source !== _currentProbedIframe.contentWindow) return;
        // Phase 4 watchdog liveness: every accepted probe message resets
        // the freeze timer. Heartbeats (kind:'heartbeat') are 1Hz pings
        // sent purely for this purpose — they update liveness but DON'T
        // pollute the user-visible events timeline. Other event kinds
        // also count as liveness (more activity = more recent proof of
        // a working JS thread).
        _lastHeartbeatAt = Date.now();
        _frozenAlerted = false;
        if (!_watchdogTimer) startWatchdog();
        if (d.kind === 'heartbeat') return;
        pushBehaviorEvent(d);
        renderBehaviorTab();
      },
      { signal: ctx.signal },
    );

    // Render any history that was persisted from a prior session.
    renderHistory();

    // ── Central event dispatcher (Cabinet Refactor Etap 2 + 3) ─────
    // Single root-level handler dispatches every data-action click
    // anywhere inside the inspector mount tree, including dynamic
    // modals rendered into #modalRoot (which sits inside #app-root,
    // so clicks bubble here naturally — no separate listener needed).
    // Replaces:
    //   - 87 inline onclick="…" handlers across index.{en,uk,ru}.html
    //   - per-list scoped dispatchers from Etap 1 (#hList, #savedList)
    //   - 39 inline onclick="…" handlers inside JS-generated modal
    //     templates (auth, unlock, recovery, forgot, reset, save,
    //     edit-sample, partner, vendor-reference)
    // {signal: ctx.signal} auto-detaches on module unmount.
    const root = document.getElementById('app-root') || document.body;

    root.addEventListener(
      'click',
      (ev) => {
        const el = ev.target.closest('[data-action]');
        if (!el || !root.contains(el)) return;
        // Anchor actions need preventDefault so the href="#" doesn't
        // append # to the URL and trigger a back-button trap.
        if (el.tagName === 'A') ev.preventDefault();
        const action = el.dataset.action;
        switch (action) {
          // — top bar / chrome —
          case 'analyze':
            return runAnalysis();
          case 'sim-bids': {
            // Lazy-load the simulate module on first click.
            if (typeof window.openSimBidsModal === 'function') {
              return window.openSimBidsModal();
            }
            (async () => {
              try {
                await Promise.all([
                  import('/modules/simulate/i18n.js'),
                  import('/modules/simulate/index.js'),
                ]);
                window.openSimBidsModal();
              } catch (err) {
                console.error('[simulate] lazy import failed:', err);
                toast(t('toast.error_generic', { error: 'simulate module load failed' }), 'error');
              }
            })();
            return;
          }
          case 'open-corpus-save': {
            // Auth-gate BEFORE lazy-loading — guests can't save corpus,
            // no point fetching the module for them.
            if (!session.user) {
              toast(t('toast.signin_to_save'), 'info');
              window.lazyOpenAuth('login');
              return;
            }
            if (typeof window.openCorpusSaveModal === 'function') {
              return window.openCorpusSaveModal();
            }
            (async () => {
              try {
                await Promise.all([
                  import('/modules/corpus-save/i18n.js'),
                  import('/modules/corpus-save/index.js'),
                ]);
                window.openCorpusSaveModal();
              } catch (err) {
                console.error('[corpus-save] lazy import failed:', err);
                toast(
                  t('toast.error_generic', { error: 'corpus-save module load failed' }),
                  'error',
                );
              }
            })();
            return;
          }
          case 'confirm-corpus-save':
            return window.confirmCorpusSave && window.confirmCorpusSave();
          case 'corpus-delete': {
            const id = Number(el.dataset.corpusId);
            if (!id) return;
            if (!confirm(t('confirm.corpus_delete'))) return;
            // Mutation: the DELETE runs to completion; guard the response so an
            // unmount can't refresh/toast the corpus into a remount.
            fetch('/api/behavior/corpus/' + id, { method: 'DELETE' })
              .then((r) => r.json())
              .then((j) => {
                if (ctx.signal.aborted) return;
                if (!j.success) throw new Error(j.error || 'delete_failed');
                if (window.refreshCorpus) window.refreshCorpus();
                toast(t('toast.corpus_deleted'), 'success');
              })
              .catch((e) => {
                if (ctx.signal.aborted) return;
                toast(t('toast.corpus_delete_failed', { error: e.message }), 'error');
              });
            return;
          }
          case 'mirror': {
            // Lazy-load the mirror module on first click. Subsequent
            // clicks hit the browser's ES module cache for free.
            if (typeof window.openMirrorModal === 'function') {
              return window.openMirrorModal();
            }
            (async () => {
              try {
                await Promise.all([
                  import('/modules/mirror/i18n.js'),
                  import('/modules/mirror/index.js'),
                ]);
                window.openMirrorModal();
              } catch (err) {
                console.error('[mirror] lazy import failed:', err);
                toast(t('toast.error_generic', { error: 'mirror module load failed' }), 'error');
              }
            })();
            return;
          }
          // 'mirror-copy' / 'mirror-load' / 'mirror-mode-change' / 'mirror-share'
          // moved to /core/modal-host.js because their buttons render inside
          // shell-owned #modalRoot, outside the Inspector root's reach.
          case 'save-sample': {
            // Lazy-load the save-sample module on first click. Subsequent
            // clicks hit the browser's ES module cache for free. The
            // auth-gate lives INSIDE openSaveModal (it shows an explanatory
            // toast + opens the auth modal for guests) — we still pay the
            // module fetch for guests, but it's tiny and rare.
            if (typeof window.openSaveModal === 'function') {
              return window.openSaveModal();
            }
            (async () => {
              try {
                await Promise.all([
                  import('/modules/save-sample/i18n.js'),
                  import('/modules/save-sample/index.js'),
                ]);
                window.openSaveModal();
              } catch (err) {
                console.error('[save-sample] lazy import failed:', err);
                toast(
                  t('toast.error_generic', { error: 'save-sample module load failed' }),
                  'error',
                );
              }
            })();
            return;
          }
          case 'verify-email':
            return window.requestVerifyEmail && window.requestVerifyEmail();
          case 'signout':
            // Reachable from Inspector's own inline auth-widget button (this
            // copy) AND the unlock modal's escape route (a duplicate copy in
            // /core/modal-host.js — the two dispatchers cover disjoint DOM
            // subtrees, #app-root vs #modalRoot, so no double-fire). closeModal
            // is a no-op if no modal is open.
            window.closeModal();
            return window.signOut && window.signOut();
          case 'open-auth':
            // Auth is a lazy module since 2026-05-10. window.lazyOpenAuth
            // (chrome-level, installed at shell boot — ROADMAP #18) imports
            // /modules/auth/ on first activation, then re-dispatches to
            // window.openAuthModal(mode). Subsequent clicks hit the
            // synchronous-best-case branch (module already loaded → direct call).
            return window.lazyOpenAuth(el.dataset.mode || 'login');
          case 'open-unlock': {
            // Guests: short-circuit to auth modal — no point fetching
            // the unlock module if there's no cookie session to
            // re-derive against.
            if (!session.user) {
              return window.lazyOpenAuth('login');
            }
            if (typeof window.openUnlockModal === 'function') {
              return window.openUnlockModal();
            }
            (async () => {
              try {
                await Promise.all([
                  import('/modules/unlock/i18n.js'),
                  import('/modules/unlock/index.js'),
                ]);
                window.openUnlockModal();
              } catch (err) {
                console.error('[unlock] lazy import failed:', err);
                toast(t('toast.error_generic', { error: 'unlock module load failed' }), 'error');
              }
            })();
            return;
          }
          case 'open-partners': {
            // Lazy-load the partners module on first click.
            if (typeof window.openPartnerModal === 'function') {
              return window.openPartnerModal();
            }
            (async () => {
              try {
                await Promise.all([
                  import('/modules/partners/i18n.js'),
                  import('/modules/partners/index.js'),
                ]);
                window.openPartnerModal();
              } catch (err) {
                console.error('[partners] lazy import failed:', err);
                toast(t('toast.error_generic', { error: 'partners module load failed' }), 'error');
              }
            })();
            return;
          }
          case 'open-builder':
            // Phase 9: Dialect Builder is the new public-facing entry
            // point (replaces the vendor-branded partner button on the
            // sidebar). Falls back gracefully when the intel module
            // isn't loaded (embed mode, private browsing).
            return (
              window.OrtbtoolsIntelBuilder &&
              typeof window.OrtbtoolsIntelBuilder.open === 'function' &&
              window.OrtbtoolsIntelBuilder.open()
            );
          // Phase C-1 — partner-inference banner in save modal.
          case 'hint-pick-partner':
            return window._spy_pickPartner && window._spy_pickPartner(el.dataset.id);
          case 'hint-create-partner':
            return window._spy_createPartner && window._spy_createPartner(el.dataset.name);
          case 'open-embed':
            return window.openEmbedModal && window.openEmbedModal();
          case 'share-link':
            return window.copyShareLink && window.copyShareLink();
          case 'download-bundle':
            return window.downloadBundle && window.downloadBundle();

          // — editor controls —
          case 'clear-input':
            return window.clearInput(el.dataset.target, el);
          case 'format-json':
            return window.utils.format(el.dataset.target, el);
          case 'copy-text':
            return window.utils.copy(el.dataset.target, el);

          // — Phase 8: collapsible JSON panels + safe-mode preview —
          case 'toggle-card': {
            const card = document.getElementById(el.dataset.target);
            if (card) card.classList.toggle('is-collapsed');
            return;
          }
          case 'reveal-creative': {
            // Click anywhere on the overlay reveals; the inner button
            // bubbles up here too. setAdPreview re-applies blur on
            // every new creative so the reveal is per-impression.
            const safe = document.getElementById('creativePreviewSafe');
            if (safe) safe.classList.add('is-revealed');
            return;
          }
          // — dialect labelling (question findings) —
          //
          // Both read the signal off the button's own dataset; see the render
          // for why it travels there rather than being re-derived. The module
          // is loaded via a plain <script defer> alongside source-nav, so if
          // it somehow did not load we say so instead of doing nothing — the
          // original complaint about this control was a click that produced
          // no visible response whatsoever.
          case 'open-dialect-builder':
          case 'ask-dialect-agent': {
            const dl = window.OrtbtoolsDialectLabel;
            if (!dl) {
              toast(t('dialect.label.err.generic'), 'error');
              return;
            }
            const sig = {
              path: el.dataset.signalPath || '',
              value: el.dataset.signalValue || '',
              shapeSignature: el.dataset.shapeSignature || '',
            };
            if (!sig.path) {
              toast(t('dialect.label.err.no_payload'), 'error');
              return;
            }
            if (action === 'ask-dialect-agent') return dl.askAgent(el, sig);
            return dl.openBuilder(sig, null);
          }
          case 'goto-path': {
            // Stage-1: exact finding→source navigation via the location
            // contract (explicit side + RFC 6901 pointer). No regex side-guess,
            // no approximate jump — an unresolved/stale location simply no-ops.
            if (window.OrtbtoolsSourceNav && el.dataset.loc) {
              try {
                window.OrtbtoolsSourceNav.navigate(JSON.parse(el.dataset.loc));
              } catch (_e) {
                /* malformed location → honest no-jump */
              }
            }
            return;
          }

          // — layout —
          case 'toggle-sidebar':
            return toggleSidebar(el.dataset.side);
          case 'reset-layout':
            return resetLayout();
          case 'switch-tab':
            return window.switchTab(el, el.dataset.target);

          // — history list (merged from Etap 1 #hList scoped dispatcher) —
          case 'history-load':
            ev.preventDefault();
            return loadFromHistory(Number(el.dataset.idx));
          case 'history-peek':
            ev.stopPropagation();
            return peekHistoryItem(Number(el.dataset.idx));
          case 'history-delete':
            ev.stopPropagation();
            return deleteHistoryItem(Number(el.dataset.idx));
          case 'clear-history':
            return window.clearHistory && window.clearHistory();

          // 🎲 demo onboarding: pull one synthetic example. data-type filters
          // to a specific specimen ('clean-banner', 'frame-bust-form', …);
          // omitted = random. Triggered only from inner menu buttons; the
          // outer <summary> just toggles the dropdown (default <details>
          // behavior, no data-action on it).
          case 'load-demo':
            return loadDemoSample(el.dataset.type || undefined);
          case 'dismiss-onboarding':
            return dismissInspectorOnboarding();

          // — saved samples (merged from Etap 1 #savedList scoped dispatcher) —
          case 'sample-load':
            return loadSample(Number(el.dataset.id));
          case 'sample-edit': {
            ev.stopPropagation();
            // Lazy-load the edit-sample module on first click.
            const editId = Number(el.dataset.id);
            if (typeof window.editSample === 'function') {
              return window.editSample(editId);
            }
            (async () => {
              try {
                await Promise.all([
                  import('/modules/edit-sample/i18n.js'),
                  import('/modules/edit-sample/index.js'),
                ]);
                window.editSample(editId);
              } catch (err) {
                console.error('[edit-sample] lazy import failed:', err);
                toast(
                  t('toast.error_generic', { error: 'edit-sample module load failed' }),
                  'error',
                );
              }
            })();
            return;
          }
          case 'sample-delete':
            ev.stopPropagation();
            return deleteSample(Number(el.dataset.id));

          // Modal generic-close paths (modal-backdrop-close(-recovery),
          // modal-close, close-recovery, reset-cancel), auth/unlock/recovery/
          // reset action verbs (do-auth, do-unlock, do-forgot, do-reset,
          // open-forgot, copy-recovery), and sample/partner CRUD verbs
          // (confirm-save, confirm-edit, confirm-add-partner, delete-partner)
          // all moved to /core/modal-host.js — every one of those buttons
          // renders inside a modal, which lives in the shell-owned #modalRoot
          // (outside root's reach), not in Inspector's own DOM (ROADMAP #18).

          // — Vendor reference templates (paste-from-docs buttons) —
          case 'vendor-paste-req':
            return (
              window._vendorRef &&
              window._vendorRef.pasteIntoReq(
                window._vendorRef.VENDOR_REF.templates[el.dataset.template],
              )
            );
          case 'vendor-paste-res':
            return (
              window._vendorRef &&
              window._vendorRef.pasteIntoRes(
                window._vendorRef.VENDOR_REF.templates[el.dataset.template],
              )
            );
          case 'vendor-paste-string':
            return (
              window._vendorRef &&
              window._vendorRef.pasteString(
                el.dataset.target,
                window._vendorRef.VENDOR_REF.templates[el.dataset.template],
              )
            );
        }
      },
      { signal: ctx.signal },
    );

    // Keyboard activation for history rows. Click is covered above;
    // keydown stays scoped to data-action="history-load" so we don't
    // intercept the Ctrl+Enter shortcut bound on textareas below.
    root.addEventListener(
      'keydown',
      (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const el = ev.target.closest('[data-action="history-load"]');
        if (!el || !root.contains(el)) return;
        ev.preventDefault();
        loadFromHistory(Number(el.dataset.idx));
      },
      { signal: ctx.signal },
    );

    // Change-event dispatcher for <select data-action="…"> controls.
    // The click-dispatcher above doesn't fire on dropdown value changes,
    // so we mirror it here for the small set of select-based actions.
    // Currently:
    //   - change-dialect — toolbar dialect picker; persists choice and
    //     re-runs analysis so findings reflect the new ruleset
    //     immediately (no extra "click analyze" step needed).
    root.addEventListener(
      'change',
      (ev) => {
        const el = ev.target.closest('[data-action]');
        if (!el || !root.contains(el)) return;
        const action = el.dataset.action;
        if (action === 'change-dialect') {
          setActiveDialect(el.value);
          // Re-run analysis if the editors hold a payload — engine output
          // is dialect-sensitive (e.g. inpage-push suppresses the
          // IAB payload_missing rule), so the user expects findings to
          // refresh in place. No-op when the editors are empty.
          if ($('bidReq').value || $('bidRes').value) runAnalysis();
        } else if (action === 'change-version-pin') {
          // v0.39.0 — Version Pinning UI. Persist the chosen pin
          // (or empty for 'auto'); re-run analysis so version.mismatch
          // findings surface immediately. Forwarded into the request
          // body via the analyze fetch — see the body construction
          // near the analyzeUrl call.
          try {
            if (el.value) localStorage.setItem('ortbtools_version_pin', el.value);
            else localStorage.removeItem('ortbtools_version_pin');
          } catch {
            /* storage disabled / quota — pin stays in-memory only */
          }
          if ($('bidReq').value || $('bidRes').value) runAnalysis();
        }
      },
      { signal: ctx.signal },
    );

    // Direct bindings for non-click events on stable nodes (replace
    // oninput/onkeydown attrs that lived on the textareas in HTML).
    ['bidReq', 'bidRes'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(
        'input',
        () => {
          updateCharCount(id);
          // Editing invalidates the prior analysis verdict — drop the tab
          // title back to baseline so users don't trust a stale "✓ clean".
          resetTabStatus();
        },
        { signal: ctx.signal },
      );
      el.addEventListener('keydown', window.handleKeydown, { signal: ctx.signal });
    });

    // Close any open <details> popover when the user clicks outside of it.
    // Native <details> stays open until you click its <summary> again, which
    // surprises users who expect popover semantics. Scoped to the popover
    // menus — v2 added tools ▾, share report ▾ and the tab strip's more ▾ to
    // the original pair — so it doesn't interfere with content disclosures
    // (e.g. .finding-detail expanders) which SHOULD stay open until the user
    // folds them. The mockup's own manual states the contract: "Esc або клік
    // поза меню — закрити", so Escape closes them too.
    const POPOVER_MENUS =
      '.kt-example-menu[open], .kt-lang-menu[open], ' +
      '.kt-tools-menu[open], .kt-share-menu[open], .tab-more[open]';
    document.addEventListener(
      'click',
      (ev) => {
        const opened = document.querySelectorAll(POPOVER_MENUS);
        if (!opened.length) return;
        opened.forEach((d) => {
          if (!d.contains(ev.target)) d.removeAttribute('open');
        });
      },
      { signal: ctx.signal },
    );
    document.addEventListener(
      'keydown',
      (ev) => {
        if (ev.key !== 'Escape') return;
        document.querySelectorAll(POPOVER_MENUS).forEach((d) => d.removeAttribute('open'));
      },
      { signal: ctx.signal },
    );

    // Lazy-render finding-detail bodies on first toggle-open. Native
    // <details> emits a 'toggle' event when open state changes; we listen
    // on the validation list root and walk events bubbling from finding-
    // detail elements. data-detail-rendered guards the one-shot render.
    root.addEventListener(
      'toggle',
      (ev) => {
        const d = ev.target;
        if (!d || !d.classList || !d.classList.contains('finding-detail')) return;
        if (!d.open) return;
        const body = d.querySelector('.finding-detail-body');
        if (!body || body.dataset.detailRendered === '1') return;
        body.innerHTML = buildFindingDetailHtml(d.dataset);
        body.dataset.detailRendered = '1';
      },
      { capture: true, signal: ctx.signal },
    );

    // Initial boot sequence — halt if the mount was torn down during any step
    // so we don't run later refresh steps (or paint) against a remount.
    // session.ensureBooted() is the ONE canonical /api/auth/me — shared with
    // topbar and any other concurrent consumer (ROADMAP #18); it resolves to
    // an anonymous result on any failure, so this can never reject.
    await session.ensureBooted();
    if (ctx.signal.aborted) return;
    renderAuthWidget();
    renderVerifyBanner();
    if (ctx.signal.aborted) return;
    await refreshPartners();
    if (ctx.signal.aborted) return;
    refreshSamples();

    // F5-survival for the recovery-key modal: if a key was on screen but
    // user reloaded before clicking "I saved it", re-show the modal with
    // the same key. sessionStorage is per-tab so this doesn't survive a
    // full close — single accidental refresh is the realistic scenario.
    //
    // Inline sessionStorage read (instead of importing the recovery
    // module) so we don't pay the import cost in the 99.99% case where
    // nothing is pending. RECOVERY_PENDING_KEY constant is duplicated
    // in /modules/recovery/index.js; both must agree.
    try {
      let pending = null;
      try {
        pending = sessionStorage.getItem(RECOVERY_PENDING_KEY);
      } catch (_e) {
        /* sessionStorage unavailable — non-fatal, no F5 survival */
      }
      if (session.user) {
        if (pending) {
          // queueMicrotask so the inspector template has a moment to mount
          // (the module writes into #modalRoot which is shell-level).
          queueMicrotask(() => {
            if (ctx.signal.aborted) return; // unmounted before the microtask ran
            openRecoveryKeyModalLazy(pending);
          });
        }
      } else if (pending) {
        // User isn't authed anymore — no point keeping a stale key.
        try {
          sessionStorage.removeItem(RECOVERY_PENDING_KEY);
        } catch (_e) {
          /* sessionStorage unavailable — non-fatal */
        }
      }
    } catch (_e) {
      /* defensive */
    }

    // Deep-link from the cabinet's "Manage partners" button: /?open=partners
    // → open the partner-management modal once we're authed and the cache is
    // populated. URL is cleaned so a refresh doesn't re-trigger.
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('open') === 'partners' && session.user) {
        // Partners is a lazy module — synthesize a click on the same
        // dispatcher case so the deep-link goes through the same lazy
        // import path as the topnav button. Avoids racing the cache.
        if (typeof window.openPartnerModal === 'function') {
          window.openPartnerModal();
        } else {
          (async () => {
            try {
              await Promise.all([
                import('/modules/partners/i18n.js'),
                import('/modules/partners/index.js'),
              ]);
              window.openPartnerModal();
            } catch (err) {
              console.error('[partners] deep-link lazy import failed:', err);
            }
          })();
        }
        params.delete('open');
        const cleanQ = params.toString();
        history.replaceState(
          null,
          '',
          location.pathname + (cleanQ ? '?' + cleanQ : '') + location.hash,
        );
      }
    } catch (_e) {
      /* defensive — never block boot on a deep-link helper */
    }

    // Phase 9b: collapse the summary chrome (winning-bid card + os/geo/
    // device/connection rows + section title) on first paint when the
    // editors are still empty. Without this initial sweep, the four "—"
    // placeholder rows show right after mount and only collapse on the
    // first user keystroke. refreshEmptyStateChrome reads bidReq/bidRes
    // values, so an empty boot collapses, a hydrated boot (history nav)
    // reveals.
    refreshEmptyStateChrome();

    // A freshly mounted Inspector has run no analysis, which is exactly the
    // state a Clear leaves behind — so paint it through the same function
    // rather than trusting the template's initial attributes. That keeps the
    // two states identical (a cleared page must be indistinguishable from a
    // freshly loaded one — tests/clear-resets-results-browser.test.js) and it
    // is what puts the version pin and the dialect switch on screen before
    // the first Analyze instead of after it.
    updateFormatBar(null, null);

    // Sync the dialect selector with the resolved active dialect.
    // activeDialect() reads ?dialect=… first, then localStorage; sync the
    // <select> so the UI reflects the engine's actual choice. Do this
    // BEFORE the qp checks below — URL-driven dialect should take effect
    // even on first paint without waiting for a manual interaction.
    const initialDialect = activeDialect();
    const dialectSel = $('dialectSelector');

    // v0.39.0 — restore Version Pinning selector from localStorage. Empty
    // value (the default) means "auto", which lets the field-presence
    // detector decide. Stale values that don't match an <option> are
    // silently ignored — the <select> falls back to its first option.
    try {
      const savedPin = localStorage.getItem('ortbtools_version_pin');
      const pinEl = $('versionPinSelector');
      if (pinEl && savedPin && ['2.5', '2.6', '3.0'].includes(savedPin)) {
        pinEl.value = savedPin;
      }
    } catch {
      /* localStorage disabled — pin stays at 'auto' for this session */
    }

    // Phase 7b: append <option>s for every temporary dialect the user
    // has saved in IndexedDB. Re-runs on `ortbtools:intel-dialect-changed`
    // (fired when builder creates a new dialect) so the dropdown stays
    // current without a page reload.
    async function repaintDialectOptions() {
      if (!dialectSel || !window.OrtbtoolsIntel) return;
      // Strip prior temp options — keep the first three built-ins.
      const built = ['iab', 'ext-rtb', 'inpage-push'];
      Array.from(dialectSel.options)
        .filter((o) => !built.includes(o.value))
        .forEach((o) => o.remove());
      let temps = [];
      try {
        temps = await window.OrtbtoolsIntel.listTempDialects();
      } catch (_e) {
        /* */
      }
      for (const spec of temps || []) {
        const opt = document.createElement('option');
        opt.value = spec.id;
        opt.textContent = '✦ ' + (spec.name || 'Custom');
        dialectSel.appendChild(opt);
      }
      // Re-set the value AFTER appending — otherwise a temp-dialect
      // initial value gets lost when its option doesn't exist yet.
      dialectSel.value = activeDialect();
      updateCustomDialectIndicator();
    }
    repaintDialectOptions();
    paintFooterDialect();
    window.addEventListener(
      'ortbtools:intel-dialect-changed',
      () => {
        repaintDialectOptions();
        paintFooterDialect();
      },
      { signal: ctx.signal },
    );

    // Input-section drag-resize. User can pull the handle below the
    // BID REQUEST / BID RESPONSE panes to grow them when working with
    // large bid payloads. Persisted across reloads via localStorage.
    // Defaults to 280px (the original fixed height). Range clamped
    // [180, 65vh] so the page doesn't squeeze the inspector tabs
    // below off-screen on shorter monitors. Double-click resets.
    initInputSectionResize();

    // Phase 7b: header indicator — small badge that surfaces "this is a
    // user-built dialect, not a stock one". The format-bar already shows
    // the active dialect; this just adds a leading "✦ custom" tag so
    // it's visually distinct in the chrome.
    function updateCustomDialectIndicator() {
      const pill = $('formatPillDialect');
      const sel = $('dialectSelector');
      if (!pill || !sel) return;
      const cur = activeDialect();
      if (isTempDialect(cur)) {
        const opt = Array.from(sel.options).find((o) => o.value === cur);
        const label = opt ? opt.textContent : '✦ custom';
        pill.textContent = label + ' (temp)';
        pill.title = 'Active temporary dialect — auto-applied client-side. Edit via the 🧬 chip.';
        pill.hidden = false;
      } else if (cur && cur !== 'iab') {
        pill.textContent = '+ ' + cur;
        pill.title = 'Active dialect overlay: ' + cur;
        pill.hidden = false;
      } else {
        pill.hidden = true;
      }
    }
    if (dialectSel) dialectSel.value = initialDialect;

    // Phase 8 URL params: ?reset=token | ?verified=1 | ?verify_error=...
    const qp = new URLSearchParams(location.search);
    // Vendor-specific reference tab is hidden by default — only revealed when
    // the user explicitly opts into a vendor dialect via ?dialect=<name>
    // OR when the persisted dialect is non-IAB (so a power user who
    // switched once doesn't lose the reference tab on next visit).
    if (initialDialect !== 'iab') {
      const tab = document.getElementById('vendorRefTab');
      if (tab) tab.hidden = false;
    }
    if (qp.get('reset')) {
      // Lazy-load /modules/password-reset/ on URL boot trigger. The
      // module self-registers window.openPasswordResetFlow, which we
      // then call with the token. Subsequent triggers (none expected
      // — token is single-use) hit the ES module cache.
      const token = qp.get('reset');
      (async () => {
        try {
          await Promise.all([
            import('/modules/password-reset/i18n.js'),
            import('/modules/password-reset/index.js'),
          ]);
          window.openPasswordResetFlow(token);
        } catch (err) {
          console.error('[password-reset] lazy import failed:', err);
          toast(t('toast.error_generic', { error: 'password-reset module load failed' }), 'error');
          // Strip the URL so a refresh doesn't re-attempt the same
          // failing import in a loop.
          history.replaceState({}, '', location.pathname);
        }
      })();
    } else if (qp.get('forgot') === '1') {
      // The cabinet's "forgot password" action navigates here with ?forgot=1
      // (public/account.js). Pre-fix nothing on this side read that param —
      // `qp.get('forgot')` appeared zero times in this file — so the deep link
      // dropped the user on the inspector with no recovery UI and no message.
      // Same lazy-import + same failure handling as ?reset= above; the entry
      // point is the other one the module registers.
      history.replaceState({}, '', location.pathname);
      (async () => {
        try {
          await Promise.all([
            import('/modules/password-reset/i18n.js'),
            import('/modules/password-reset/index.js'),
          ]);
          window.openForgotPasswordFlow();
        } catch (err) {
          console.error('[password-reset] lazy import failed:', err);
          toast(t('toast.error_generic', { error: 'password-reset module load failed' }), 'error');
        }
      })();
    } else if (qp.get('verified') === '1') {
      toast(t('toast.email_verified'), 'success');
      // Product telemetry: the verification link was confirmed server-side and
      // bounced us back here with ?verified=1. Counting it in the browser (not
      // in the redirect handler) is what lets it join the same anonymous cohort
      // as the landing and register events.
      if (typeof window.ortbtoolsTrack === 'function') {
        window.ortbtoolsTrack('verify_email');
      }
      history.replaceState({}, '', location.pathname);
      // Force a fresh /api/auth/me (email_verified_at just flipped
      // server-side) so the verify banner clears without a reload.
      (async () => {
        await session.ensureBooted(true);
        if (ctx.signal.aborted) return;
        renderAuthWidget();
        renderVerifyBanner();
      })();
    } else if (qp.get('verify_error')) {
      const code = qp.get('verify_error');
      const msg =
        code === 'expired'
          ? t('reset.err.link_expired')
          : code === 'tampered' || code === 'malformed'
            ? t('reset.err.link_tampered')
            : t('reset.err.verify_failed');
      toast(msg, 'error');
      history.replaceState({}, '', location.pathname);
    } else if (qp.get('auth') === 'login' || qp.get('auth') === 'signup') {
      // Deep-link from the cabinet anon-gate "Sign in" / "Create account"
      // CTAs (/account → /?auth=login|signup). The modal's internal mode
      // name is 'register' (not 'signup'); map here so the URL stays
      // user-readable. Skip if already signed in — the modal would be
      // confusing and the user landed here from a back-button +
      // cookie-refresh race. URL is cleaned so a refresh doesn't
      // re-open the modal.
      const mode = qp.get('auth') === 'signup' ? 'register' : 'login';
      history.replaceState({}, '', location.pathname);
      if (!session.user) {
        window.lazyOpenAuth(mode);
      }
    }
  }
  window.refreshSamples = refreshSamples;

  // Seamless language switch was extracted to /public/lang-switch.js so
  // the about pages (which don't load this file) can share the morph
  // machinery. The kt:lang-change listener at line ~145 above is the
  // inspector-specific subscriber that re-runs analysis on lang change.

  // ── Globals sweep on unmount ───────────────────────────────────
  // After Etap 2 + Etap 3, no inline onclick="" remains in HTML or
  // JS-generated modals — every interaction routes through the
  // central data-action dispatcher above. window.X is preserved
  // only for external script callers (share.js → runAnalysis,
  // shortcuts.js → openSaveModal, export.js → __ortbtoolsLast,
  // creative-probe.js iframe → renderBehaviorTab via postMessage).
  //
  // On unmount the registry calls our addCleanup. We delete every name
  // we attached so the next mount or another module starts clean — no
  // stale references lingering on window past deactivate().
  ctx.addCleanup(() => {
    const exposed = [
      // utilities + tab/input chrome
      'toast',
      'utils',
      'switchTab',
      'clearInput',
      'handleKeydown',
      'updateCharCount',
      'toggleSidebar',
      'resetLayout',
      'showPayloadSide',
      'refreshPayloadDots',
      'renderGutter',
      'paintGutterSeverity',
      // analysis + history (loadFromHistory/peekHistoryItem/deleteHistoryItem
      // are now local — driven by delegated handler on #hList)
      'runAnalysis',
      'clearHistory',
      'historyStore',
      'humanStatus',
      // behaviour tab + vendor dialect
      'renderBehaviorTab',
      '_vendorRef',
      // auth flows
      // openUnlockModal + doUnlock live in /modules/unlock/ (lazy);
      // managed by the module loader, not by this sweep.
      'openAuthModal',
      'doLogin',
      'doRegister',
      // showRecoveryKeyModal + closeRecoveryKeyModal + copyRecoveryKey
      // + isRecoveryKeyModalActive live in /modules/recovery/ (lazy);
      // managed by the module loader, not by this sweep. Same for the
      // shell hook __ortbtoolsRecoveryClosed which we install above.
      // window.signOut is shell-owned (installed once at boot by
      // /core/session.js, ROADMAP #18) — never swept here.
      '__ortbtoolsRecoveryClosed',
      // openForgotPasswordFlow + openPasswordResetFlow + doForgotPassword
      // + doResetPassword + updateResetModeUI + cancelPasswordReset live
      // in /modules/password-reset/ (lazy); managed by the module loader,
      // not by this sweep. Same for window.__ortbtoolsResetActive.
      'requestVerifyEmail',
      // save / partner / sample / embed (loadSample/deleteSample are
      // local — driven by delegated handler on #savedList; editSample
      // is lazy-registered by /modules/edit-sample/ so it lives here)
      'openSaveModal',
      'confirmSave',
      'editSample',
      'confirmEdit',
      'openPartnerModal',
      'confirmAddPartner',
      'deletePartner',
      'refreshSamples',
      // ephemeral state
      '__ortbtoolsLast',
      '__ortbtoolsBehavior',
      // Feature #12 + #13 + #14 helpers
      'computeQualityScore',
      'renderAnalysisStrip',
      'renderSeverityTabs',
    ];
    for (const name of exposed) {
      try {
        delete window[name];
      } catch (_) {
        /* non-configurable, ignore */
      }
    }
    // NOTE: the DEK is NOT wiped here. It lives in the shell-level session
    // service (/core/session.js, ROADMAP #18) now, not this closure, so
    // module unmount (inspector → stream → inspector) structurally can't
    // touch it — the user isn't asked to unlock twice in one tab. DEK
    // lifetime is tied to the cookie session + sessionStorage scope, not to
    // any section's mount lifetime.

    // Phase 4: stop the freeze watchdog so the next mount starts clean
    // (otherwise a setInterval would keep ticking against a stale
    // _currentProbedIframe reference).
    stopWatchdog();
  });
}
