/* ============================================================
   Spyglass v8 — OpenRTB inspector (IAB 2.5 / 2.6 / 3.0).
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

export async function mountInspector(root, ctx) {
  'use strict';

  // Utilities ($/escapeHtml/toast) and tab-badge helpers (setTabBadge,
  // severityFromFindings, severityFromCrosschecks) imported above from
  // /core/utils.js. Behaviour identical to the previous inline copies
  // — this file no longer redefines them.

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
      console.error('[spyglass:error]', e.error);
      toast(t('toast.internal_ui_error', { error: e.error.message || 'unknown' }), 'error');
    },
    { signal: ctx.signal },
  );
  window.addEventListener(
    'unhandledrejection',
    (e) => {
      console.error('[spyglass:unhandledrejection]', e.reason);
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
  function flashButtonStatus(btn, key) {
    if (!btn) return;
    const prev = _flashTimers.get(btn);
    if (prev) {
      clearTimeout(prev.timeout);
      btn.textContent = prev.original;
    }
    const original = (btn.textContent || '').trim();
    btn.textContent = t(key);
    btn.classList.add('btn-icon--ok');
    const timeout = setTimeout(function () {
      btn.textContent = original;
      btn.classList.remove('btn-icon--ok');
      _flashTimers.delete(btn);
    }, 1500);
    _flashTimers.set(btn, { timeout, original });
  }

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
      navigator.clipboard
        .writeText(el.value)
        .then(() => flashButtonStatus(btn, 'button.status.copied'))
        .catch(() => toast(t('toast.copy_failed'), 'error'));
    },
  };

  window.switchTab = function (btn, targetId) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    $(targetId).classList.add('active');
  };

  window.clearInput = function (id, btn) {
    $(id).value = '';
    updateCharCount(id);
    // Clear → drop the loaded-sample anchor so the next save starts fresh.
    _currentSampleId = null;
    _currentSampleMeta = null;
    _isDirty = false;
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
  function analyzeUrl() {
    // Absolute path — relative would resolve against pathname (e.g. /uk/),
    // breaking API access from non-root locales. serverSideDialect()
    // collapses temp dialects to their IAB parent so the server runs the
    // canonical ruleset; the temp-dialect findings are merged client-side
    // by SpyglassIntel.applyToFindings() after the response lands.
    return (
      '/api/analyze?locale=' +
      encodeURIComponent(activeLocale()) +
      '&dialect=' +
      encodeURIComponent(serverSideDialect())
    );
  }

  // ── Dialect state ─────────────────────────────────────────────
  // The validation engine accepts ?dialect=<name> to layer vendor-specific
  // rules (Kadam RTB, Kadam In-Page Push) over the IAB baseline. The
  // active dialect needs to survive page reloads (so users on a Kadam
  // workflow don't reset every session) and be shareable via URL (so a
  // bug report can carry the dialect context). Resolution priority:
  //   1. ?dialect=… in the URL — highest, lets shared links override the
  //      user's saved choice without permanent persistence
  //   2. localStorage — survives reloads
  //   3. 'iab' — safe default
  const DIALECT_STORAGE_KEY = 'spyglass_dialect_v1';
  const KNOWN_DIALECTS = new Set(['iab', 'kadam', 'kadam-inpage-push']);

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
  // about it (server validate() only sees IAB+Kadam variants). Send the
  // parent dialect server-side; the temp-dialect overlay is applied
  // client-side after analyze().
  function serverSideDialect() {
    const d = activeDialect();
    return isTempDialect(d) ? 'iab' : d;
  }

  function setActiveDialect(dialect) {
    if (!KNOWN_DIALECTS.has(dialect) && !isTempDialect(dialect)) return;
    try {
      localStorage.setItem(DIALECT_STORAGE_KEY, dialect);
    } catch (_e) {
      /* storage quota / private mode — best effort, the URL reflects state */
    }
    // Notify the intel module so its activeSpec cache invalidates and
    // applyToFindings reaches for the right spec on the next analyze.
    if (
      isTempDialect(dialect) &&
      window.SpyglassIntel &&
      typeof window.SpyglassIntel.activate === 'function'
    ) {
      window.SpyglassIntel.activate(dialect);
    } else if (
      !isTempDialect(dialect) &&
      window.SpyglassIntel &&
      typeof window.SpyglassIntel.activate === 'function'
    ) {
      window.SpyglassIntel.activate(null);
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
    //   - Everything else (kadam, kadam-inpage-push, future named
    //     dialects) is shareable — we write it.
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
        ['tInspector', 'tValidation', 'tCross', 'tCategories', 'tBehavior'].forEach(function (id) {
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
        });
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
        // Re-run when either pane has content — JsonFeed payloads (ExoClick,
        // RichAds, Zeropark) live in bidRes only, so gating on req-presence
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

  // Format pill — surfaces detected payload type, status, version, dialect
  // as a coloured pill row above the inspector tabs. Hidden until first
  // analysis result lands. Categorises type into oRTB-family vs JsonFeed-
  // family for colour coding (see CSS .format-pill-type[data-format]).
  function updateFormatBar(validation, dialect) {
    const bar = $('formatBar');
    if (!bar) return;
    if (!validation || !validation.type) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const type = String(validation.type || '');
    const status = String(validation.status || '');

    const pillType = $('formatPillType');
    pillType.textContent = type;
    // Discriminator drives colour. "oRTB BidRequest" / "oRTB BidResponse" → ortb;
    // anything with "Feed Response" → feed. Unknown stays neutral.
    let family = 'unknown';
    if (/oRTB/i.test(type)) family = 'ortb';
    else if (/Feed Response/i.test(type)) family = 'feed';
    pillType.dataset.format = family;

    const pillStatus = $('formatPillStatus');
    pillStatus.textContent = humanStatus(status) || status || '—';
    pillStatus.dataset.status = status;

    const pillVer = $('formatPillVersion');
    const v = validation.version;
    // oRTB version pill only makes sense for oRTB-family payloads. JsonFeed
    // formats don't have an oRTB version dimension — suppress to avoid
    // showing a confusing "oRTB 2.5 ?" tag on e.g. an ExoClick rtb.php feed.
    if (family === 'ortb' && v && v.version && v.version !== 'unknown') {
      const cf = v.confidence;
      const cfTag = cf >= 1 ? '' : cf >= 0.5 ? ' ≈' : ' ?';
      pillVer.textContent = 'oRTB ' + v.version + cfTag;
      pillVer.title =
        v.signals && v.signals.length
          ? 'Detected via: ' + v.signals.join(', ')
          : 'No version-specific markers — defaulted to spec baseline';
      pillVer.hidden = false;
    } else {
      pillVer.hidden = true;
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
    const len = el.value.length;
    count.textContent = len > 0 ? (len > 999 ? (len / 1000).toFixed(1) + 'k' : len) : '0';
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
    const badge = $(id === 'bidReq' ? 'reqBadge' : 'resBadge');
    const v = el.value.trim();
    if (!v) {
      badge.textContent = t('badge.empty');
      badge.className = 'json-badge empty';
      return;
    }
    try {
      JSON.parse(v);
      badge.textContent = t('badge.valid');
      badge.className = 'json-badge valid';
    } catch {
      badge.textContent = t('badge.invalid');
      badge.className = 'json-badge invalid';
    }
  }

  // ── Ad preview helpers ────────────────────────────────────────
  function findAdm(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.adm) return obj.adm;
    if (obj.nurl && typeof obj.nurl === 'string')
      return '<img src="' + escapeHtml(obj.nurl) + '" style="width:100%"/>';
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
  // could otherwise send forged `spyglass-probe` messages and poison
  // __spyglassBehavior.events. Cleared on every new preview; set only
  // when the banner-iframe branch actually mounts a probed iframe (VAST
  // and native preview branches don't get a probe → null guard rejects
  // their events too).
  let _currentProbedIframe = null;

  // Phase 4 — frozen-thread watchdog. The probe sends a 1Hz heartbeat
  // (creative-probe.js hook 15); the parent receiver below updates
  // _lastHeartbeatAt on every probe message it accepts. _watchdogTimer
  // ticks WATCHDOG_INTERVAL_MS and, if lag exceeds FROZEN_THRESHOLD_MS,
  // injects a synthetic kind:'frozen_thread' event into
  // __spyglassBehavior.events — bypassing postMessage because a frozen
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
    if (!window.__spyglassBehavior) {
      window.__spyglassBehavior = { events: [], startedAt: Date.now() };
    }
    const list = window.__spyglassBehavior.events;
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
        type: 'spyglass-probe-watchdog',
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
    if (!_probeSource) return creativeHtml; // graceful: probe not loaded yet
    // Wrap in a <script> at the very top so listeners are hooked before
    // creative HTML parses any inline handlers.
    return '<script>' + _probeSource + '</' + 'script>' + creativeHtml;
  }

  function resetBehavior() {
    window.__spyglassBehavior = { events: [], startedAt: Date.now() };
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

  // Phase 8: clickable JSONPath in findings — best-effort scroll-to.
  // Picks the LAST property name in the path (e.g. `seatbid[0].bid[0].impid`
  // → 'impid'), searches the textarea for `"impid"`, focuses + scrolls
  // to that line. Won't disambiguate when the same key appears multiple
  // times (we hit the FIRST occurrence) — adequate for "basic mechanism"
  // per Phase 8 brief; precise multi-occurrence resolution is a future
  // enhancement that requires JSON-AST source-mapping.
  function jsonPathToTextarea(path) {
    if (!path) return null;
    // Path side: response paths begin with `seatbid` / `bid` / `cur`;
    // request paths begin with `imp` / `site` / `app` / `device` /
    // `user` / `regs` / `source` / `cur` (ambiguous — bias to req when
    // unknown).
    if (/\b(?:seatbid|bidid|nbr)\b/.test(path)) return 'bidRes';
    return 'bidReq';
  }
  function scrollToPath(path) {
    const targetId = jsonPathToTextarea(path);
    if (!targetId) return;
    // Auto-expand the panel if it was collapsed.
    const cardId = targetId === 'bidReq' ? 'cardReq' : 'cardRes';
    const card = document.getElementById(cardId);
    if (card && card.classList.contains('is-collapsed')) {
      card.classList.remove('is-collapsed');
    }
    const ta = document.getElementById(targetId);
    if (!ta) return;
    // Pick the last identifier-shaped segment from the path.
    const m = path.match(/([a-zA-Z_][a-zA-Z0-9_]*)(?:\[\d+\])?$/);
    const key = m && m[1];
    if (!key) return;
    const needle = '"' + key + '"';
    const idx = ta.value.indexOf(needle);
    if (idx < 0) return;
    ta.focus();
    try {
      ta.setSelectionRange(idx, idx + needle.length);
    } catch (_e) {
      /* */
    }
    // setSelectionRange doesn't reliably scroll the textarea into view —
    // approximate with line-height arithmetic. Off by a couple of lines
    // is fine; the highlighted selection draws the eye anyway.
    const before = ta.value.slice(0, idx);
    const linesAbove = (before.match(/\n/g) || []).length;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 16;
    ta.scrollTop = Math.max(0, linesAbove * lh - 60);
  }

  function setAdPreview(adm, simPrice, dims) {
    const el = $('creativePreview');
    el.innerHTML = '';
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
    // Phase 6: park the creative source on __spyglassBehavior so that
    // modules/behavior/index.js can include it in the /api/analyze-behavior
    // POST body. Truncated to ADM_TRANSPORT_LIMIT — the engine's scanner
    // truncates internally too, but bounding wire size keeps the per-render
    // round-trip fast (Behavior tab re-fetches on every probe event).
    try {
      const admStr = String(adm);
      window.__spyglassBehavior.creative_adm =
        admStr.length > ADM_TRANSPORT_LIMIT ? admStr.slice(0, ADM_TRANSPORT_LIMIT) : admStr;
    } catch (_e) {
      /* defensive — shouldn't fail, but the rest of preview must run */
    }
    // Resolve known macros so the preview reflects an actual rendered impression.
    const resolved = String(adm)
      .replace(/\$\{AUCTION_PRICE\}/g, simPrice)
      .replace(/\$\{AUCTION_CURRENCY\}/g, 'USD')
      .replace(/\$\{AUCTION_LOSS\}/g, '0');
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
        console.error('[spyglass] native render failed, falling back to banner branch', err);
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
    // our just-mounted creative can populate __spyglassBehavior.events.
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

  function renderBehaviorTab() {
    const tab = $('tBehavior');
    const badge = $('behaviorBadge');
    if (!tab || !badge) return;
    const all = (window.__spyglassBehavior && window.__spyglassBehavior.events) || [];
    // probe_ready is an internal signal, not user-visible.
    const events = all.filter((e) => e.kind !== 'probe_ready');
    setTabBadge('behaviorBadge', { text: events.length || '' });
    // Phase 1 Behavior epic: delegate body render to the Behavior module
    // (public/modules/behavior/index.js) when it's loaded. The module
    // posts events to /api/analyze-behavior and renders findings above
    // the raw event timeline. Fallback below remains for boot-order
    // resilience — if the module script hasn't parsed yet, we still
    // render the timeline so the tab isn't blank.
    if (window.SpyglassBehavior && typeof window.SpyglassBehavior.render === 'function') {
      window.SpyglassBehavior.render(tab, all, {
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
    if (!_currentUser) return;
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
  const HISTORY_KEY = 'spyglass_history_v1';
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
            typeof e.ts === 'number' &&
            (typeof e.req === 'string' || typeof e.res === 'string'),
        )
        .slice(0, HISTORY_MAX);
    } catch {
      return [];
    }
  })();
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
  window.addEventListener('storage', (e) => {
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
  });

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
          escapeHtml(e.time) +
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
    $('bidReq').value = entry.req || '';
    $('bidRes').value = entry.res || '';
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
      escapeHtml(e.time || '') +
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
        closeModal();
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

  window.runAnalysis = async function (fromHist) {
    const myReqId = ++_analyzeReqSeq;
    if (_analyzeAbort) {
      try {
        _analyzeAbort.abort();
      } catch (_) {
        /* idempotent */
      }
    }
    _analyzeAbort = typeof AbortController === 'function' ? new AbortController() : null;
    const reqVal = fromHist ? fromHist.req : $('bidReq').value;
    const resVal = fromHist ? fromHist.res : $('bidRes').value;
    // Backend supports request-only, response-only, or both. JsonFeed-format
    // payloads (Kadam push, ExoClick rtb.php, RichAds, Zeropark) are typically
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
      const req = reqVal ? JSON.parse(reqVal) : {};
      const res = resVal ? JSON.parse(resVal) : {};
      // Auto-fill SIM PRICE from the actual auction signals so the value
      // shown reflects the bid being analysed, not a stale placeholder.
      // Priority: winning bid.price (the SSP would substitute this into
      // ${AUCTION_PRICE}) → imp[0].bidfloor (lower bound for what a bid
      // would have to clear) → 0.00 (nothing to anchor against).
      // The user can still type over the field after analysis; the next
      // runAnalysis call re-derives.
      const simPriceEl = $('simPrice');
      const seatbidAuto = res.seatbid && res.seatbid[0];
      const bidAuto = seatbidAuto && seatbidAuto.bid && seatbidAuto.bid[0];
      let autoPrice = null;
      if (bidAuto && typeof bidAuto.price === 'number') {
        autoPrice = bidAuto.price;
      } else if (req.imp && req.imp[0] && typeof req.imp[0].bidfloor === 'number') {
        autoPrice = req.imp[0].bidfloor;
      }
      simPriceEl.value = autoPrice != null ? Number(autoPrice).toFixed(2) : '0.00';
      const simP = simPriceEl.value || '0.00';

      if (!fromHist) {
        if (reqVal) $('bidReq').value = JSON.stringify(req, null, 2);
        if (resVal) $('bidRes').value = JSON.stringify(res, null, 2);
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
      $('mPrice').innerText = adm
        ? bid.price
          ? '$' + Number(bid.price).toFixed(2)
          : 'BID'
        : '$0.00';
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
      setAdPreview(adm, simP, previewDims);

      // Phase 8: paint summary-bar IDs so the collapsed-card state shows
      // identity. req.id / res.id are the canonical oRTB BidRequest /
      // BidResponse identifiers; if missing, fall back to a placeholder
      // so the bar still has shape.
      paintCardSummary('cardReq', (req && req.id) || '—');
      paintCardSummary('cardRes', (res && res.id) || '—');

      // Inspector tab — slot cards
      const imps = req.imp || [];
      const slotGrid = $('slotGrid');
      // Currency for bidfloor: pick first allowed in req.cur (typical: ["USD"]).
      // Fallback "$" for legacy/empty payloads.
      const curList = Array.isArray(req.cur) ? req.cur.filter((x) => typeof x === 'string') : [];
      const curSym = curList.length ? curList[0] : 'USD';
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
                (Number(i.bidfloor) || 0).toFixed(3) +
                ' ' +
                escapeHtml(curSym) +
                '</span></div>' +
                '</div>'
              );
            })
            .join('')
        : '<div class="empty-hint" style="grid-column:1/-1">' +
          escapeHtml(t('empty.no_imp_slots')) +
          '</div>';

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
        const body = { bidReq: req, bidRes: res };
        if (expectedVersion) body.opts = { expectedVersion };
        const r = await fetch(analyzeUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: _analyzeAbort ? _analyzeAbort.signal : undefined,
        });
        const j = await r.json().catch(() => ({}));
        // Drop stale: a newer analyze started while we were waiting. Don't
        // overwrite the UI with our (outdated) findings.
        if (myReqId !== _analyzeReqSeq) return;
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
          validation = j.validation;
          cross = j.crosscheck;
          // IAB cat decoding (Phase 2 feature) — surface as a side-panel
          // tab regardless of validation status. Empty object means no
          // category fields present in the payload.
          renderCategories((j.meta && j.meta.categories) || {});
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
            window.SpyglassIntel &&
            typeof window.SpyglassIntel.applyToFindings === 'function' &&
            isTempDialect(activeDialect())
          ) {
            try {
              await window.SpyglassIntel.applyToFindings({ req, res }, validation);
            } catch (_e) {
              /* defensive — never block the analyze flow */
            }
          }

          // Stash latest analysis for the JSON-bundle export (export.js)
          // AND for finding-detail panel value extraction. `req`/`res` are
          // the parsed inputs, kept here so the panel can resolve a
          // finding's path back to the actual user-pasted value.
          window.__spyglassLast = {
            validation: validation,
            crosscheck: cross,
            meta: j.meta || null,
            req: req,
            res: res,
            at: new Date().toISOString(),
          };

          // Phase 7a — Spyglass Intelligence side-channel observer.
          // Fire-and-forget: observe() walks ext-fields of req+res into
          // the local IndexedDB index, gated by validation status. Errors
          // are swallowed inside the module; analyze flow is unaffected.
          // Discovery is disabled cleanly when the script tag isn't
          // loaded (e.g. in /embed view) — the global guard makes this
          // a one-line no-op there.
          if (window.SpyglassIntel && typeof window.SpyglassIntel.observe === 'function') {
            try {
              window.SpyglassIntel.observe(req, validation);
              window.SpyglassIntel.observe(res, validation);
            } catch (_e) {
              /* observe() is already defensive; this is belt-and-braces */
            }
          }
        }
      } catch (e) {
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
      if (validation && findings && findings.length) {
        setTabBadge('validationBadge', {
          text: findings.length,
          severity: severityFromFindings(findings),
        });
        valEl.innerHTML =
          '<div class="mono-label" style="margin-bottom:var(--space-3)">' +
          escapeHtml(validation.type) +
          ' · ' +
          escapeHtml(humanStatus(validation.status)) +
          versionPill +
          '</div>' +
          findings
            .map((f) => {
              // 'error' is canonical; fall back to old 'danger' if API still emits it.
              const lvl = f.level === 'danger' ? 'error' : f.level;
              const cls = lvl === 'error' ? 'danger' : lvl === 'info' ? 'info' : 'warning';
              const ic = lvl === 'error' ? '✕' : lvl === 'info' ? 'i' : '!';
              const specLink = f.specRef
                ? ' <a href="' +
                  escapeHtml(f.specRef) +
                  '" target="_blank" rel="noopener noreferrer" style="color:var(--text-dim);font-family:var(--font-mono);font-size:10px;text-decoration:none" title="OpenRTB spec reference">spec ↗</a>'
                : '';
              const pathBtn = f.path
                ? ' <button type="button" class="finding-path" data-action="goto-path" data-jsonpath="' +
                  escapeHtml(f.path) +
                  '" title="Jump to this path in the JSON">[' +
                  escapeHtml(f.path) +
                  ']</button>'
                : '';
              // Finding-detail expand. Wrap the row in <details> so the
              // native disclosure widget gives us free keyboard support and
              // ARIA semantics. The summary is the original one-line view;
              // the body (rendered lazily by buildFindingDetail on first
              // open) shows path, the user's value at that path, severity
              // meaning, and spec link.
              return (
                '<details class="validation-item ' +
                cls +
                ' finding-detail" data-finding-id="' +
                escapeHtml(f.id || '') +
                '" data-finding-path="' +
                escapeHtml(f.path || '') +
                '" data-finding-level="' +
                escapeHtml(lvl || '') +
                '" data-finding-spec="' +
                escapeHtml(f.specRef || '') +
                '">' +
                '<summary>' +
                '<span class="validation-icon">' +
                ic +
                '</span>' +
                '<span class="validation-text">' +
                escapeHtml(f.msg) +
                pathBtn +
                specLink +
                '</span>' +
                '<span class="finding-detail-toggle" aria-hidden="true">▾</span>' +
                '</summary>' +
                '<div class="finding-detail-body" data-detail-rendered="0"></div>' +
                '</details>'
              );
            })
            .join('');
      } else if (validation) {
        setTabBadge('validationBadge', { text: '✓', severity: 'ok' });
        // Clean state — still surface the detected oRTB version so the user
        // knows which spec the inspector validated against. Was hidden before.
        valEl.innerHTML =
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
                ${c.path ? `<div class="cross-path">${escapeHtml(c.path)}</div>` : ''}
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
          req: JSON.stringify(req, null, 2),
          res: resVal ? JSON.stringify(res, null, 2) : '',
          title: entity,
          status,
          time: new Date().toLocaleTimeString(),
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
  function statBox(value, label) {
    return (
      '<div class="stat-box"><div class="stat-value">' +
      value +
      '</div><div class="stat-label">' +
      label +
      '</div></div>'
    );
  }

  // ── Kadam reference tab ───────────────────────────────────────
  const KADAM = {
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
    $('bidReq').value = JSON.stringify(json, null, 2);
    updateCharCount('bidReq');
    toast(t('toast.template_inserted_req'), 'success');
  }
  function pasteIntoRes(json) {
    $('bidRes').value = JSON.stringify(json, null, 2);
    updateCharCount('bidRes');
    toast(t('toast.template_inserted_res'), 'success');
  }
  function pasteString(target, str) {
    $(target).value = str;
    updateCharCount(target);
    toast(t('toast.template_inserted'), 'success');
  }
  // Expose for inline onclicks
  window._kadam = { pasteIntoReq, pasteIntoRes, pasteString, KADAM };

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
    const T = KADAM.templates;
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
            <button class="ref-paste-btn" data-action="kadam-paste-req" data-template="requestNative">paste → request</button>
          </div>
          <div class="ref-card-desc">Vendor-style Native 1.1 with subage hints, geo, user, ext.bsection/btags blocking.</div>
          <pre class="ref-code">${escapeHtml(reqNativeJson)}</pre>
        </div>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Push (subscription)</span>
            <button class="ref-paste-btn" data-action="kadam-paste-req" data-template="requestPush">paste → request</button>
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
            <button class="ref-paste-btn" data-action="kadam-paste-res" data-template="responseNative">paste → response</button>
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
            <button class="ref-paste-btn" data-action="kadam-paste-string" data-target="bidReq" data-template="feedRequestUrl">paste → request box</button>
          </div>
          <div class="ref-card-desc">Vendor feed expects a GET with parameters; SSP issues sid + skey per ad format.</div>
          <pre class="ref-code">${escapeHtml(T.feedRequestUrl)}</pre>
          ${tableHtml(['param', 'type', 'rule', 'description'], KADAM.feedParams)}
        </div>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Feed response — push (JSON array)</span>
            <button class="ref-paste-btn" data-action="kadam-paste-res" data-template="feedResponsePush">paste → response</button>
          </div>
          <pre class="ref-code">${escapeHtml(feedPushJson)}</pre>
          ${tableHtml(['field', 'type', 'description'], KADAM.pushResponseFields)}
        </div>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Feed response — clickunder</span>
            <button class="ref-paste-btn" data-action="kadam-paste-res" data-template="feedResponseClickunder">paste → response</button>
          </div>
          <pre class="ref-code">${escapeHtml(feedCuJson)}</pre>
        </div>
      </div>

      <div class="ref-section">
        <h3>URL macros</h3>
        <div class="ref-card">
          <div class="ref-card-desc">This vendor supports only these three macros — others are ignored. Use in nurl, burl, lurl.</div>
          ${tableHtml(['macro', 'description'], KADAM.macros)}
        </div>
      </div>

      <div class="ref-section">
        <h3>Field cheatsheet</h3>
        <div class="ref-card">
          <span class="ref-card-title">BidRequest root</span>
          ${tableHtml(['field', 'type', 'rule', 'description'], KADAM.requestFields)}
        </div>
        <div class="ref-card">
          <span class="ref-card-title">imp[]</span>
          ${tableHtml(['field', 'type', 'rule', 'description'], KADAM.impFields)}
        </div>
        <div class="ref-card">
          <span class="ref-card-title">site / app</span>
          ${tableHtml(['field', 'type', 'rule', 'description'], KADAM.siteFields)}
        </div>
      </div>

      <div class="ref-section" style="color:var(--text-dim);font-size:var(--fs-sm);text-align:center;padding:var(--space-4) 0">
        Source: <a href="https://wiki.kadam.net/en/index.php?title=RTB_setting" target="_blank" rel="noopener" style="color:var(--text);text-decoration:underline">wiki.kadam.net · RTB setting</a>
      </div>
    `;
  }

  // ── Auth state + saved samples library ────────────────────────
  // The library is per-account: anonymous users see a "Sign in to save"
  // panel; logged-in users get partners/samples scoped to their user_id.
  //
  // Phase 7 (zero-knowledge): _sessionDEK is the live AES-GCM key derived
  // from the user's password. It lives only in this closure — never in
  // localStorage, never on window, never sent to the server. Cleared on
  // signOut. Server stores only ciphertext + wrapped DEK + salt.
  let _partnerCache = [];
  let _currentSampleId = null;
  // Metadata of the currently-loaded sample (so the Save modal can pre-fill
  // title/partner/notes when the user wants to UPDATE the existing record).
  // Set by loadSample, cleared by clear-button + signOut.
  let _currentSampleMeta = null;
  // Dirty flag — set on input into bidReq/bidRes after a successful load.
  // Used to: (a) warn before clobber on loadSample, (b) reset after save.
  let _isDirty = false;
  let _currentUser = null;
  let _sessionDEK = null;

  // sessionStorage scope: per-tab, dies on tab close. XSS that can
  // read sessionStorage already has full DEK access via _sessionDEK
  // in module scope — same threat surface, no new vector. Buys F5
  // survival; doesn't survive tab close (matches DEK-in-memory model).
  const DEK_STORAGE_KEY = 'kt-dek-v1';

  async function persistDEK(dekKey) {
    if (!dekKey) return;
    try {
      const b64 = await SpyglassCrypto.serializeDEK(dekKey);
      sessionStorage.setItem(DEK_STORAGE_KEY, b64);
    } catch (e) {
      // exportKey('raw') fails if the key wasn't created with
      // extractable=true. Soft-fail so F5 falls back to unlock prompt
      // instead of breaking the active session.
      console.warn('[spyglass] DEK persist failed:', e && e.message);
    }
  }

  async function loadPersistedDEK() {
    try {
      const b64 = sessionStorage.getItem(DEK_STORAGE_KEY);
      if (!b64) return null;
      return await SpyglassCrypto.deserializeDEK(b64);
    } catch {
      sessionStorage.removeItem(DEK_STORAGE_KEY);
      return null;
    }
  }

  function clearPersistedDEK() {
    try {
      sessionStorage.removeItem(DEK_STORAGE_KEY);
    } catch (_) {
      /* sessionStorage may be blocked by Safari private mode — ignore */
    }
  }

  async function api(method, url, body) {
    const init = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    // Force absolute path so calls work after seamless lang-switch shifts
    // pathname to /uk/ or /ru/ (callers pass 'api/...' historically).
    const absUrl = /^https?:|^\//.test(url) ? url : '/' + url;
    const r = await fetch(absUrl, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const err = new Error(j.error || 'http ' + r.status);
      err.status = r.status;
      err.code = j.code;
      throw err;
    }
    return j;
  }

  // ── Auth widget ───────────────────────────────────────────────

  function renderAuthWidget() {
    const signInBtn = $('authSignInBtn');
    const userBlock = $('authUserBlock');
    const emailEl = $('authEmail');
    if (_currentUser) {
      signInBtn.style.display = 'none';
      userBlock.style.display = 'inline-flex';
      emailEl.textContent = _currentUser.email;
    } else {
      signInBtn.style.display = 'inline-flex';
      userBlock.style.display = 'none';
      emailEl.textContent = '';
    }
  }

  async function bootAuth() {
    try {
      const j = await api('GET', 'api/auth/me');
      _currentUser = j.user || null;
      // Locale stickiness: if the user has a server-stored
      // preferred_locale that differs from the URL we're on, soft-
      // redirect to the right localized path. Catches:
      //   - returning user on a different device (no localStorage)
      //   - bookmark to bare URL (/, /about, /account)
      //   - first login redirected back to /
      // We only fire on the canonical landing routes (/, /uk, /ru,
      // /about, /uk/about, /ru/about, /account, /uk/account, /ru/account)
      // and only when the preference is set and mismatches.
      try {
        if (j.user && j.user.preferred_locale) {
          const want = j.user.preferred_locale;
          const path = location.pathname.replace(/\/$/, '') || '/';
          const here = path.startsWith('/uk') ? 'uk' : path.startsWith('/ru') ? 'ru' : 'en';
          if (want !== here) {
            // Build the equivalent path in the wanted locale.
            const enPart = path.replace(/^\/(uk|ru)/, '') || '/';
            const target = want === 'en' ? enPart : '/' + want + (enPart === '/' ? '' : enPart);
            // Only landing pages (avoid touching deep app paths).
            if (['/', '/about', '/account'].includes(enPart) && target !== path) {
              location.replace(target);
              return; // boot continues on the new page
            }
          }
        }
      } catch (_e) {
        /* never block boot on a redirect heuristic */
      }
      // F5 survival: cookie keeps the user logged in, and sessionStorage
      // (this tab only) holds the DEK from the last unlock. If both are
      // alive, restore silently — no "Sign in to unlock" prompt. If the
      // cookie is alive but sessionStorage is empty (different tab, or
      // the DEK was cleared), surface the unlock CTA in the saved-list.
      if (j.user && j.encryption) {
        const restored = await loadPersistedDEK();
        if (restored) {
          _sessionDEK = restored;
          _pendingUnlock = false;
        } else {
          _sessionDEK = null;
          _pendingUnlock = true;
        }
      } else {
        _sessionDEK = null;
        _pendingUnlock = false;
        clearPersistedDEK();
      }
    } catch {
      _currentUser = null;
      _sessionDEK = null;
      _pendingUnlock = false;
      clearPersistedDEK();
    }
    renderAuthWidget();
    renderVerifyBanner();
  }
  let _pendingUnlock = false;

  // The unlock modal (re-derive DEK from password against the live
  // cookie session) lives in /modules/unlock/. The dispatcher's
  // 'open-unlock' case lazy-loads it on first use; 'do-unlock' fires
  // after the modal is already on screen, by which point
  // window.openUnlockModal + window.doUnlock are wired up.

  // ── Auth modal: lazy-loaded module ──────────────────────────
  // openAuthModal / doLogin / doRegister live in /modules/auth/.
  // The dispatcher case 'open-auth' calls lazyOpenAuth() (below)
  // which lazy-imports the module then invokes window.openAuthModal(mode).
  // doLogin / doRegister are reached only after the modal is on screen,
  // by which point the module is loaded and its window.* assignments ran.
  //
  // The module talks to this closure via window.SpyglassSession
  // (the facade defined further down) — DEK + _currentUser stay
  // here. Two non-facade hooks the module consumes:
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

  // Lazy-loader for the auth module. Used by dispatcher case
  // 'open-auth' (header button + auth-modal mode-toggle), the
  // openSaveModal guest gate, the open-corpus-save guest gate, and
  // the open-unlock guest fallback. All of those used to call
  // window.openAuthModal directly; now they go through this helper
  // so the module is fetched on demand.
  async function lazyOpenAuth(mode) {
    if (typeof window.openAuthModal === 'function') {
      return window.openAuthModal(mode);
    }
    try {
      await Promise.all([import('/modules/auth/i18n.js'), import('/modules/auth/index.js')]);
      window.openAuthModal(mode);
    } catch (err) {
      console.error('[auth] lazy import failed:', err);
      toast(t('toast.error_generic', { error: 'auth module load failed' }), 'error');
    }
  }
  // Exposed for sibling lazy modules (save-sample, future ones) that
  // need to redirect guests to the auth modal — they reach for
  // window.openAuthModal first (synchronous best-case if auth was
  // already activated this session) and fall back to this when it's
  // not yet defined. See modules/save-sample/index.js openSaveModal
  // guest gate for the migrated call pattern.
  window.lazyOpenAuth = lazyOpenAuth;

  // ── Recovery-key modal: lazy-loaded module ──────────────────
  // The full implementation (modal HTML, copy handler, confirm-gated
  // close, sessionStorage persistence) lives in /modules/recovery/.
  // It's loaded on demand because it's only needed:
  //   - immediately after register (one path: bootstrapNewCrypto)
  //   - on F5-survival re-show (one path: bootAuth post-init below)
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
  const RECOVERY_PENDING_KEY = 'spyglass_recovery_pending_v1';

  // Shell hook: module calls this after the user clicks "I saved it"
  // (post-confirm). We clear #modalRoot here (instead of inside the
  // module) so the module doesn't have to know about the global
  // modalRoot ID, and we chain the history-merge prompt only after
  // the user has explicitly acknowledged — otherwise the merge modal
  // would obscure the key before they had a chance to copy.
  window.__spyglassRecoveryClosed = function () {
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
    // Local listener — the modal teardown clears innerHTML so the
    // listener detaches automatically with the orphaned DOM nodes.
    $('modalRoot').addEventListener('click', (ev) => {
      const target = ev.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'merge-skip') return closeModal();
      if (action === 'merge-import') return runHistoryMerge();
    });
  }

  async function runHistoryMerge() {
    if (!_sessionDEK) {
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
        const encReq = await SpyglassCrypto.encryptBlob(_sessionDEK, e.req || '');
        const encRes = await SpyglassCrypto.encryptBlob(_sessionDEK, e.res || '');
        await api('POST', 'api/samples', {
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

    closeModal();
    if (failed === 0) {
      toast(t('toast.merge_done', { count: imported }), 'success');
    } else if (imported === 0) {
      toast(t('toast.merge_failed', { failed }), 'error');
    } else {
      toast(t('toast.merge_partial', { imported, failed }), 'warning');
    }
    refreshSamples();
  }

  window.signOut = async function () {
    try {
      await api('POST', 'api/auth/logout');
    } catch {
      /* logout is idempotent — ignore failures */
    }
    _currentUser = null;
    _partnerCache = [];
    _sessionDEK = null; // wipe DEK from memory on logout
    clearPersistedDEK(); // wipe DEK from sessionStorage too
    _currentSampleId = null;
    _currentSampleMeta = null;
    _isDirty = false;
    renderAuthWidget();
    refreshSamples();
    toast(t('toast.signed_out'), 'success');
  };

  // ── Phase 8: forgot/reset password + email verification ──────────────
  // The forgot/reset password flow lives in /modules/password-reset/
  // (lazy-loaded). Triggers:
  //   - 'open-forgot' data-action          → window.openForgotPasswordFlow
  //   - ?reset=<token> URL boot detection  → window.openPasswordResetFlow
  // The dispatcher cases below handle lazy-import-on-first-use.
  // The shell's closeModal() reads window.__spyglassResetActive to know
  // when to strip ?reset= from the URL on Esc/backdrop close. The DEK
  // installed after a successful reset goes through
  // SpyglassSession.importDEKFromBytes() — raw DEK bytes never touch
  // the shell scope.

  window.requestVerifyEmail = async function () {
    try {
      const j = await api('POST', 'api/auth/verify-email/request');
      // Server returns 200 even when delivery fails (Cloudflare edge would
      // otherwise swallow a 5xx body). Inspect the flag to surface the
      // truth instead of always celebrating.
      if (j && j.email_sent === false) {
        toast(t('toast.send_failed', { error: j.email_error || '' }), 'error');
      } else {
        toast(
          t('toast.verify_email_sent', { email: (_currentUser && _currentUser.email) || '' }),
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
    if (_currentUser && !_currentUser.email_verified_at) {
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }

  // ── Finding-detail expand ────────────────────────────────────────────
  // Walk a Spyglass-style JSON path ('imp[0].banner.w', 'seatbid[1].bid[0]
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

  // Resolve a finding's path to its actual value in the user's pasted
  // JSON. Tries bidReq first (most paths live there), falls back to
  // bidRes for response-side findings (`response.*`, `seatbid*`).
  function resolveFindingValue(path, findingId) {
    const last = window.__spyglassLast;
    if (!last) return { found: false };
    const isResponseSide =
      (findingId && /^response\b|^crosscheck\.bid\b/.test(findingId)) || /^seatbid\b/.test(path);
    const primary = isResponseSide ? last.res : last.req;
    const secondary = isResponseSide ? last.req : last.res;
    let v = getJsonAtPath(primary, path);
    if (v === undefined) v = getJsonAtPath(secondary, path);
    return v === undefined ? { found: false } : { found: true, value: v };
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
    return { label: level || '?', text: '' };
  }

  function buildFindingDetailHtml(ds) {
    const path = ds.findingPath || '';
    const id = ds.findingId || '';
    const level = ds.findingLevel || '';
    const spec = ds.findingSpec || '';

    const sev = severityCopy(level);
    let valueBlock;
    if (path) {
      const r = resolveFindingValue(path, id);
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
      '</strong> · ' +
      escapeHtml(sev.text) +
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
  // Spyglass tabs see at a glance which one ended in errors. Reset on
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
    document.title = 'Spyglass · ' + badge;
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
    if (!_currentUser) {
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
      const j = await api('GET', 'api/partners');
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
      if (e.status === 401) {
        // session expired — fall back to anonymous state cleanly
        _currentUser = null;
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
    if (!_currentUser) {
      // Anonymous: hide the whole Library block — save action lives in
      // the bid-request toolbar; signing in surfaces the section once
      // there are samples to show.
      if (wrap) wrap.hidden = true;
      el.innerHTML = '';
      return;
    }
    // Logged-in but DEK is gone (page reload): surface unlock CTA inside
    // the Library wrapper so the user sees something actionable.
    if (_pendingUnlock && !_sessionDEK) {
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
      const j = await api('GET', 'api/samples' + qs);
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
      if (e.status === 401) {
        _currentUser = null;
        renderAuthWidget();
        refreshSamples(); // re-render anonymous state
        return;
      }
      toast(t('toast.samples_load_failed', { error: e.message }), 'error');
    }
  }

  function closeModal() {
    // Recovery-key modal has special "really?" gate — route Esc/backdrop
    // closures through it instead of the silent close path. The flag +
    // the close fn live in /modules/recovery/ (lazy-loaded). When the
    // module isn't loaded the flag is undefined → falsy → normal close.
    if (
      typeof window.isRecoveryKeyModalActive === 'function' &&
      window.isRecoveryKeyModalActive()
    ) {
      window.closeRecoveryKeyModal();
      return;
    }
    $('modalRoot').innerHTML = '';
    // If the user closes the reset-password modal via Esc or backdrop click
    // (rather than the cancel button), still strip the `?reset=...` query
    // so a refresh doesn't silently re-trigger the same flow. The flag is
    // owned by /modules/password-reset/ — undefined when the module isn't
    // loaded → falsy → normal close.
    if (window.__spyglassResetActive && new URLSearchParams(location.search).has('reset')) {
      if (typeof window.cancelPasswordReset === 'function') {
        window.cancelPasswordReset();
      }
      history.replaceState({}, '', location.pathname);
    }
  }

  // Wire Enter-to-submit on a modal text input so the user can hit ⏎ from
  // the title / name field and not have to mouse over to the primary button.
  // Pass the input id and the action to fire (confirmSave, confirmAddPartner,
  // etc.). Skips Shift+Enter so multiline textareas behave normally.
  function wireEnterSubmit(inputId, action) {
    const el = $(inputId);
    if (!el) return;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        action();
      }
    });
  }

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

  // ── window.SpyglassSession — facade for lazy modules ─────────────────
  // Modules under /modules/ that need authenticated state, sample state,
  // partner cache, HTTP helper, or crypto operations talk through this
  // facade instead of reaching into the IIFE closure (they can't anyway —
  // ES module boundary). The DEK never leaves this scope: callers
  // request operations (encryptBlob, decryptBlob, openFromPassword, …)
  // and the facade performs them internally using _sessionDEK.
  //
  // Why this exists: pre-Phase-A modules either had no auth-state needs
  // (mirror, live, simulate, etc.) or got auth-gated at the dispatcher
  // layer (corpus-save). Once we started extracting save-sample +
  // edit-sample + auth-lifecycle modals, the closure-state coupling
  // became unworkable without either weakening security (DEK on window)
  // or duplicating dozens of helpers in every module. The facade is the
  // narrow waist: ~14 methods, fully documented, single source of truth.
  window.SpyglassSession = {
    // ── Non-secret state ──────────────────────────────────────────────
    get user() {
      return _currentUser;
    },
    setUser(u) {
      _currentUser = u;
    },
    get currentSampleId() {
      return _currentSampleId;
    },
    setCurrentSampleId(v) {
      _currentSampleId = v;
    },
    get currentSampleMeta() {
      return _currentSampleMeta;
    },
    setCurrentSampleMeta(v) {
      _currentSampleMeta = v;
    },
    get isDirty() {
      return _isDirty;
    },
    setDirty(v) {
      _isDirty = !!v;
    },
    get partnerCache() {
      return _partnerCache;
    },
    setPartnerCache(v) {
      _partnerCache = v;
    },

    // ── Helpers (non-secret) ──────────────────────────────────────────
    api: (method, url, body) => api(method, url, body),
    refreshPartners: () => refreshPartners(),
    refreshSamples: () => refreshSamples(),
    renderAuthWidget: () => renderAuthWidget(),
    partnerOptionsHtml: (sel) => partnerOptionsHtml(sel),
    wireEnterSubmit: (id, fn) => wireEnterSubmit(id, fn),

    // ── Crypto operations (DEK stays in closure) ──────────────────────
    hasSession: () => !!_sessionDEK,
    encryptBlob: async (plain) => SpyglassCrypto.encryptBlob(_sessionDEK, plain),
    decryptBlob: async (ivB64, ctB64) => SpyglassCrypto.decryptBlob(_sessionDEK, ivB64, ctB64),

    // ── Crypto lifecycle (for auth-modal / unlock-modal / etc.) ───────
    // These accept and produce metadata (state, recoveryKey) but never
    // expose raw DEK bytes to the caller. Wrapping/unwrapping happens
    // inside the facade using the closure-private _sessionDEK.
    async openFromPassword(password, encState, opts) {
      _sessionDEK = await SpyglassCrypto.openWithPassword(password, encState, opts || {});
      await persistDEK(_sessionDEK);
    },
    async bootstrap(password) {
      // Register flow: derives a fresh DEK + recovery key, returns the
      // wrap-state for the server to persist + the recovery key to show
      // to the user once.
      const result = await SpyglassCrypto.bootstrap(password, { extractable: true });
      _sessionDEK = result.dekKey;
      await persistDEK(_sessionDEK);
      return { state: result.state, recoveryKey: result.recoveryKey };
    },
    clearSession() {
      _sessionDEK = null;
      clearPersistedDEK();
      _currentUser = null;
      _currentSampleId = null;
      _currentSampleMeta = null;
      _isDirty = false;
    },
    async importDEKFromBytes(dekBytes) {
      // For recovery + password-reset: caller has unwrapped raw DEK
      // bytes via SpyglassCrypto.unwrapWithRecoveryKey/etc. We import
      // them as a CryptoKey and store. Bytes themselves stay with the
      // caller for the duration of the call; facade doesn't retain.
      _sessionDEK = await SpyglassCrypto.importDEK(dekBytes, { extractable: true });
      await persistDEK(_sessionDEK);
    },
    clearDEK() {
      // Wipe just the DEK (in-memory + persisted) without touching the
      // user record. Used by the wipe branch of password-reset, where
      // the user remains signed in but the encrypted blobs are gone
      // server-side and a fresh bootstrap is required on next save.
      _sessionDEK = null;
      clearPersistedDEK();
    },
    setPendingUnlock(v) {
      _pendingUnlock = !!v;
    },
    renderVerifyBanner: () => renderVerifyBanner(),
  };

  // ── Save-sample modal — MOVED to modules/save-sample/ (lazy) ─────────
  // openSaveModal + suggestPartnerForSave + _spy_pickPartner +
  // _spy_createPartner + confirmSave (≈265 LOC) now live in
  // /modules/save-sample/index.js and are fetched on first click of
  // the "💾 зберегти" button (case 'save-sample' in the dispatcher
  // below). State + crypto access goes through the SpyglassSession
  // facade — no closure-private references in the module.

  // ── Live + Simulate modals — MOVED to modules/{live,simulate}/ (lazy) ──
  // Both fetch on first click of their topnav buttons (`case 'live'`
  // and `case 'sim-bids'` in the dispatcher below). Pre-migration this
  // block held openLiveModal (~164 LOC, EventSource + tail list) and
  // openSimBidsModal (~105 LOC, LLM 3-strategy DSP demo). Together
  // they used to add ~280 LOC + 23 i18n keys × 3 locales to the initial
  // bundle. Now they're lazy — only loaded for users who click.

  // ── Mirror modal — MOVED to modules/mirror/ (lazy-loaded) ────────────
  // The implementation lives in /modules/mirror/index.js and is fetched
  // on first click of the "дзеркало ↔" button (case 'mirror' in the
  // dispatcher above). Pre-migration this block held openMirrorModal +
  // diffJsonForMirror + truncate (≈220 LOC); they're now ES-imported
  // helpers inside the module. ~25KB stays out of the initial JS
  // bundle until a user actually opens mirror.
  async function loadSample(id) {
    if (!_sessionDEK) {
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
      const j = await api('GET', 'api/samples/' + id);
      const s = j.sample;
      // Decrypt locally — server returned opaque ciphertext + IVs.
      const reqText = await SpyglassCrypto.decryptBlob(_sessionDEK, s.req_iv, s.bid_req);
      const resText = await SpyglassCrypto.decryptBlob(_sessionDEK, s.res_iv, s.bid_res);
      $('bidReq').value = reqText;
      $('bidRes').value = resText;
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
  async function loadDemoSample(type) {
    const hasContent = ($('bidReq').value || '').trim() || ($('bidRes').value || '').trim();
    if (_isDirty && hasContent) {
      if (!confirm(t('confirm.clobber_load'))) return;
    }
    try {
      const url = '/api/v1/sample' + (type ? '?type=' + encodeURIComponent(type) : '');
      const j = await fetch(url).then((r) => r.json());
      if (!j || !j.success) throw new Error(j && j.error ? j.error : 'unexpected');
      $('bidReq').value = JSON.stringify(j.bid_request, null, 2);
      $('bidRes').value = JSON.stringify(j.bid_response, null, 2);
      updateCharCount('bidReq');
      updateCharCount('bidRes');
      _currentSampleId = null;
      _currentSampleMeta = null;
      _isDirty = false;
      toast('🎲 ' + j.label, 'success');
      // Auto-close the dropdown after pick.
      document.querySelectorAll('.kt-example-menu[open]').forEach((d) => d.removeAttribute('open'));
    } catch (e) {
      console.error('[loadDemoSample]', e);
      toast(t('toast.sample_load_failed'), 'error');
    }
  }

  async function deleteSample(id) {
    if (!confirm(t('confirm.delete_sample'))) return;
    try {
      await api('DELETE', 'api/samples/' + id);
      // If the deleted sample is the one currently loaded, drop the anchor
      // so the next save creates a fresh record (not a 404 PATCH).
      if (_currentSampleId === id) {
        _currentSampleId = null;
        _currentSampleMeta = null;
      }
      toast(t('toast.deleted'), 'success');
      refreshSamples();
    } catch (e) {
      toast(t('toast.delete_failed', { error: e.message }), 'error');
    }
  }

  // editSample + confirmEdit migrated to /modules/edit-sample/ on
  // 2026-05-10. Lazy-loaded by the 'sample-edit' dispatcher case;
  // 'confirm-edit' calls window.confirmEdit which the module
  // self-registers on first load.

  window.closeModal = closeModal;

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
    if (btn) btn.textContent = arrowFor(side, isHidden);
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
      if (btn) btn.textContent = arrowFor(side, document.body.classList.contains(cls));
    });
  }

  // Reset Layout — escape hatch from any persisted sidebar state. Wipes
  // both flags + both timestamps and shows both panels. Bound to a small
  // ↺ button in the footer (template) and to a 'reset-layout' data-action.
  function resetLayout() {
    ['left', 'right'].forEach((side) => {
      document.body.classList.remove('sb-' + side + '-hidden');
      try {
        localStorage.removeItem(SB_HIDDEN_KEYS[side]);
        localStorage.removeItem(SB_HIDDEN_TS_KEYS[side]);
      } catch (_e) {
        /* */
      }
      const btn = document.getElementById(
        side === 'left' ? 'toggleSidebarLeft' : 'toggleSidebarRight',
      );
      if (btn) btn.textContent = arrowFor(side, false);
    });
    toast(t('toast.layout.reset'));
  }

  window.toggleSidebar = toggleSidebar;
  window.resetLayout = resetLayout;

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

    // Dirty-tracking for save lifecycle. `value =` from JS doesn't fire
    // input events (per HTML spec), so loadSample / clearInput don't
    // accidentally mark the editor dirty. User typing → dirty → save
    // modal can offer "оновити" + clobber-protection on next loadSample.
    ['bidReq', 'bidRes'].forEach((id) => {
      const el = $(id);
      if (el)
        el.addEventListener('input', () => {
          _isDirty = true;
        });
    });

    // Partner filter dropdown — refresh sample list on change. Without
    // this listener users selected a partner and saw no UI reaction.
    const pf = $('partnerFilter');
    if (pf) pf.addEventListener('change', () => refreshSamples());

    // Global Esc closes any open modal. Modals each had their own Enter
    // handler before; consolidating Esc here covers all of them.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('modalRoot').children.length) {
        closeModal();
      }
    });

    // Prefetch the creative-probe source so it's ready when the first
    // adm renders. Fire-and-forget — setAdPreview gracefully renders
    // without the probe if the fetch hasn't resolved yet.
    loadProbeSource();

    // Receive postMessage events from the in-iframe creative probe.
    // Origin will be 'null' for sandboxed iframes (opaque origin), so we
    // can't filter on origin. We pin to the contentWindow reference of
    // the iframe we just mounted (set inside setAdPreview) and reject
    // anything else. Without this any frame on the page could fabricate
    // `spyglass-probe` events and poison the analysis pipeline.
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.type !== 'spyglass-probe') return;
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
    });

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
    //     edit-sample, partner, kadam-reference)
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
          case 'live': {
            // Lazy-load the live module on first click. Subsequent
            // clicks hit the browser's ES module cache for free.
            if (typeof window.openLiveModal === 'function') {
              return window.openLiveModal();
            }
            (async () => {
              try {
                await Promise.all([
                  import('/modules/live/i18n.js'),
                  import('/modules/live/index.js'),
                ]);
                window.openLiveModal();
              } catch (err) {
                console.error('[live] lazy import failed:', err);
                toast(t('toast.error_generic', { error: 'live module load failed' }), 'error');
              }
            })();
            return;
          }
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
            if (!_currentUser) {
              toast(t('toast.signin_to_save'), 'info');
              lazyOpenAuth('login');
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
            fetch('/api/behavior/corpus/' + id, { method: 'DELETE' })
              .then((r) => r.json())
              .then((j) => {
                if (!j.success) throw new Error(j.error || 'delete_failed');
                if (window.refreshCorpus) window.refreshCorpus();
                toast(t('toast.corpus_deleted'), 'success');
              })
              .catch((e) => toast(t('toast.corpus_delete_failed', { error: e.message }), 'error'));
            return;
          }
          case 'live-pause':
            return window.__spyglassLivePauseToggle && window.__spyglassLivePauseToggle();
          case 'live-load': {
            const id = Number(el.dataset.rowId);
            const map = window.__spyglassLiveSpecimens;
            const spec = map && map.get ? map.get(id) : null;
            if (!spec) {
              toast(t('toast.live_load_failed'), 'error');
              return;
            }
            const isReq = Array.isArray(spec.imp);
            const target = isReq ? 'bidReq' : 'bidRes';
            const ta = $(target);
            if (!ta) return;
            ta.value = JSON.stringify(spec, null, 2);
            updateCharCount(target);
            closeModal();
            toast(t('toast.live_loaded'), 'success');
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
          case 'mirror-copy': {
            const out = $('mMirrorOutput');
            if (!out) return;
            navigator.clipboard.writeText(out.value).then(
              () => toast(t('toast.mirror_copied'), 'success'),
              () => toast(t('toast.mirror_copy_failed'), 'error'),
            );
            return;
          }
          case 'mirror-load': {
            const out = $('mMirrorOutput');
            const target = el.dataset.target;
            if (!out || !target) return;
            const ta = $(target);
            if (!ta) return;
            ta.value = out.value;
            updateCharCount(target);
            closeModal();
            toast(t('toast.mirror_loaded'), 'success');
            return;
          }
          case 'mirror-mode-change': {
            const newMode = el.value;
            if (typeof window.__spyglassMirrorRefetch === 'function') {
              window.__spyglassMirrorRefetch(newMode);
            }
            return;
          }
          case 'mirror-share': {
            const out = $('mMirrorOutput');
            if (!out || typeof window.buildShareUrl !== 'function') return;
            // Pair the mirror output with the user's source pane so the
            // recipient gets BOTH halves and can run analysis immediately.
            // Direction is inferred from which source pane was non-empty
            // when openMirrorModal ran — recover via the mirror-load
            // button's data-target (the EMPTY pane that gets the output).
            const loadBtn = document.querySelector('[data-action="mirror-load"]');
            const target = loadBtn ? loadBtn.dataset.target : 'bidRes';
            const source = target === 'bidRes' ? 'bidReq' : 'bidRes';
            const sourceText = $(source) ? $(source).value : '';
            const reqText = target === 'bidRes' ? sourceText : out.value;
            const resText = target === 'bidRes' ? out.value : sourceText;
            (async () => {
              try {
                const url = await window.buildShareUrl(reqText, resText);
                await navigator.clipboard.writeText(url);
                toast(t('toast.mirror_share_copied'), 'success');
              } catch (e) {
                toast(t('toast.mirror_share_failed', { error: e.message }), 'error');
              }
            })();
            return;
          }
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
            // Used by header button (no modal) AND unlock-modal escape
            // route. closeModal() is a no-op if no modal is open.
            closeModal();
            return window.signOut && window.signOut();
          case 'open-auth':
            // Auth is a lazy module since 2026-05-10. lazyOpenAuth
            // imports /modules/auth/ on first activation, then re-
            // dispatches to window.openAuthModal(mode). Subsequent
            // clicks hit the synchronous-best-case branch (module
            // already loaded → direct call).
            return lazyOpenAuth(el.dataset.mode || 'login');
          case 'open-unlock': {
            // Guests: short-circuit to auth modal — no point fetching
            // the unlock module if there's no cookie session to
            // re-derive against.
            if (!_currentUser) {
              return lazyOpenAuth('login');
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
            // point (replaces the Kadam-branded partner button on the
            // sidebar). Falls back gracefully when the intel module
            // isn't loaded (embed mode, private browsing).
            return (
              window.SpyglassIntelBuilder &&
              typeof window.SpyglassIntelBuilder.open === 'function' &&
              window.SpyglassIntelBuilder.open()
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
          case 'goto-path': {
            // Phase 8: clickable finding path. Auto-expands the
            // collapsed JSON panel and scrolls to the matching key.
            scrollToPath(el.dataset.jsonpath);
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

          // — modals (Etap 3 — generic close paths) —
          case 'modal-backdrop-close':
            // Only fire when the click is directly on the backdrop,
            // not on a child element (otherwise clicks inside the
            // modal card would close it).
            if (ev.target === el) closeModal();
            return;
          case 'modal-backdrop-close-recovery':
            if (ev.target === el) window.closeRecoveryKeyModal();
            return;
          case 'modal-close':
            return closeModal();
          case 'close-recovery':
            return window.closeRecoveryKeyModal();
          case 'reset-cancel':
            // Cancel reset-password modal: close + strip ?reset=
            // query + clear in-flight ctx in /modules/password-reset/
            // so a refresh doesn't re-trigger the same flow.
            if (typeof window.cancelPasswordReset === 'function') {
              window.cancelPasswordReset();
            }
            closeModal();
            history.replaceState({}, '', location.pathname);
            return;

          // — modals (Etap 3 — auth/unlock/recovery/reset action verbs) —
          case 'do-auth':
            return el.dataset.mode === 'register'
              ? window.doRegister && window.doRegister()
              : window.doLogin && window.doLogin();
          case 'do-unlock':
            return window.doUnlock && window.doUnlock();
          case 'do-forgot':
            // /modules/password-reset/ is already loaded at this point
            // (the modal is on screen, which means open-forgot ran the
            // lazy-import). doForgotPassword is on window from the
            // module's self-registration.
            return window.doForgotPassword && window.doForgotPassword();
          case 'do-reset':
            // Same: /modules/password-reset/ already loaded (URL boot
            // or open-forgot path). doResetPassword is on window.
            return window.doResetPassword && window.doResetPassword();
          case 'open-forgot': {
            // Lazy-load /modules/password-reset/ on first click of the
            // "forgot password?" link in login or unlock modals.
            if (typeof window.openForgotPasswordFlow === 'function') {
              return window.openForgotPasswordFlow();
            }
            (async () => {
              try {
                await Promise.all([
                  import('/modules/password-reset/i18n.js'),
                  import('/modules/password-reset/index.js'),
                ]);
                window.openForgotPasswordFlow();
              } catch (err) {
                console.error('[password-reset] lazy import failed:', err);
                toast(
                  t('toast.error_generic', { error: 'password-reset module load failed' }),
                  'error',
                );
              }
            })();
            return;
          }
          case 'copy-recovery':
            // Key lives in /modules/recovery/'s closure — never on
            // window, never in a DOM attribute. The module's
            // copyRecoveryKey() pulls it from its own scope.
            return window.copyRecoveryKey && window.copyRecoveryKey();

          // — modals (Etap 3 — sample / partner CRUD verbs) —
          case 'confirm-save':
            return window.confirmSave({ asNew: el.dataset.asNew === '1' });
          case 'confirm-edit':
            return window.confirmEdit(Number(el.dataset.id));
          case 'confirm-add-partner':
            return window.confirmAddPartner && window.confirmAddPartner();
          case 'delete-partner':
            return window.deletePartner && window.deletePartner(Number(el.dataset.id));

          // — Kadam reference templates (paste-from-docs buttons) —
          case 'kadam-paste-req':
            return (
              window._kadam &&
              window._kadam.pasteIntoReq(window._kadam.KADAM.templates[el.dataset.template])
            );
          case 'kadam-paste-res':
            return (
              window._kadam &&
              window._kadam.pasteIntoRes(window._kadam.KADAM.templates[el.dataset.template])
            );
          case 'kadam-paste-string':
            return (
              window._kadam &&
              window._kadam.pasteString(
                el.dataset.target,
                window._kadam.KADAM.templates[el.dataset.template],
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
          // is dialect-sensitive (e.g. Kadam In-Page Push suppresses the
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
            if (el.value) localStorage.setItem('spyglass_version_pin', el.value);
            else localStorage.removeItem('spyglass_version_pin');
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

    // Close any open <details> popover (sample picker, lang switcher) when
    // the user clicks outside of it. Native <details> stays open until you
    // click its <summary> again, which surprises users who expect popover
    // semantics. Scoped to the .kt-example-menu / .kt-lang-menu classes so
    // it doesn't interfere with content disclosures (e.g. .finding-detail
    // expanders) which SHOULD stay open until the user folds them.
    document.addEventListener(
      'click',
      (ev) => {
        const opened = document.querySelectorAll('.kt-example-menu[open], .kt-lang-menu[open]');
        if (!opened.length) return;
        opened.forEach((d) => {
          if (!d.contains(ev.target)) d.removeAttribute('open');
        });
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

    await bootAuth();
    await refreshPartners();
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
      if (_currentUser) {
        if (pending) {
          // queueMicrotask so the inspector template has a moment to mount
          // (the module writes into #modalRoot which is shell-level).
          queueMicrotask(() => openRecoveryKeyModalLazy(pending));
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
      if (params.get('open') === 'partners' && _currentUser) {
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
      const savedPin = localStorage.getItem('spyglass_version_pin');
      const pinEl = $('versionPinSelector');
      if (pinEl && savedPin && ['2.5', '2.6', '3.0'].includes(savedPin)) {
        pinEl.value = savedPin;
      }
    } catch {
      /* localStorage disabled — pin stays at 'auto' for this session */
    }

    // Phase 7b: append <option>s for every temporary dialect the user
    // has saved in IndexedDB. Re-runs on `spyglass:intel-dialect-changed`
    // (fired when builder creates a new dialect) so the dropdown stays
    // current without a page reload.
    async function repaintDialectOptions() {
      if (!dialectSel || !window.SpyglassIntel) return;
      // Strip prior temp options — keep the first three built-ins.
      const built = ['iab', 'kadam', 'kadam-inpage-push'];
      Array.from(dialectSel.options)
        .filter((o) => !built.includes(o.value))
        .forEach((o) => o.remove());
      let temps = [];
      try {
        temps = await window.SpyglassIntel.listTempDialects();
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
    window.addEventListener('spyglass:intel-dialect-changed', repaintDialectOptions);

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
      const tab = document.getElementById('kadamRefTab');
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
    } else if (qp.get('verified') === '1') {
      toast(t('toast.email_verified'), 'success');
      history.replaceState({}, '', location.pathname);
      // Refresh /api/auth/me so banner clears
      bootAuth();
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
  // shortcuts.js → openSaveModal, export.js → __spyglassLast,
  // creative-probe.js iframe → renderBehaviorTab via postMessage).
  //
  // On unmount the registry calls our addCleanup. We delete every name
  // we attached so the next mount or another module starts clean — no
  // stale references lingering on window past deactivate().
  ctx.addCleanup(() => {
    const exposed = [
      // utilities + tab/input chrome
      'utils',
      'switchTab',
      'clearInput',
      'handleKeydown',
      'updateCharCount',
      'closeModal',
      'toggleSidebar',
      'resetLayout',
      // analysis + history (loadFromHistory/peekHistoryItem/deleteHistoryItem
      // are now local — driven by delegated handler on #hList)
      'runAnalysis',
      'clearHistory',
      'historyStore',
      'humanStatus',
      // behaviour tab + kadam dialect
      'renderBehaviorTab',
      '_kadam',
      // auth flows
      // openUnlockModal + doUnlock live in /modules/unlock/ (lazy);
      // managed by the module loader, not by this sweep.
      'openAuthModal',
      'doLogin',
      'doRegister',
      // showRecoveryKeyModal + closeRecoveryKeyModal + copyRecoveryKey
      // + isRecoveryKeyModalActive live in /modules/recovery/ (lazy);
      // managed by the module loader, not by this sweep. Same for the
      // shell hook __spyglassRecoveryClosed which we install above.
      '__spyglassRecoveryClosed',
      'signOut',
      // openForgotPasswordFlow + openPasswordResetFlow + doForgotPassword
      // + doResetPassword + updateResetModeUI + cancelPasswordReset live
      // in /modules/password-reset/ (lazy); managed by the module loader,
      // not by this sweep. Same for window.__spyglassResetActive.
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
      '__spyglassLast',
      '__spyglassBehavior',
    ];
    for (const name of exposed) {
      try {
        delete window[name];
      } catch (_) {
        /* non-configurable, ignore */
      }
    }
    // NOTE: we deliberately do NOT clearPersistedDEK() here. Module
    // unmount fires when the user switches modules (inspector → stream
    // → inspector), and we want the DEK to survive that round-trip so
    // the user isn't asked to unlock twice in one tab. DEK lifetime is
    // tied to the cookie session + sessionStorage scope, not to the
    // inspector module mount lifetime.

    // Phase 4: stop the freeze watchdog so the next mount starts clean
    // (otherwise a setInterval would keep ticking against a stale
    // _currentProbedIframe reference).
    stopWatchdog();
  });
}
