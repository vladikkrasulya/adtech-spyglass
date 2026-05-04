/* ============================================================
   Spyglass v8 — OpenRTB inspector (IAB 2.5 / 2.6 / 3.0).
   - Inspector: parses BidRequest, shows imp slots, types, floors
   - Validation: structural checks + version detection + crosscheck
   - Diff: deep diff between request and response
   - Vendor reference tab: pasteable templates + macros + field map
     (hidden by default; revealed only with ?dialect=<vendor>)
   ============================================================ */
(function () {
  'use strict';

  // ── Utilities ─────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) => {
    if (s == null) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s)));
    return d.innerHTML;
  };

  function toast(msg, type) {
    const c = $('toastContainer');
    if (!c) return; // boundary fired before DOM ready — silent skip
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'success');
    t.innerHTML = (type === 'error' ? '⚠ ' : '✓ ') + escapeHtml(msg);
    c.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity 0.3s';
      setTimeout(() => t.remove(), 300);
    }, 2500);
  }

  // ── Global error boundary ──────────────────────────────────────
  // One bug in a handler shouldn't kill the page. Catch synchronous errors
  // and unhandled promise rejections, log them, and surface a toast so the
  // user sees that something went wrong (instead of a silent dead button).
  window.addEventListener('error', (e) => {
    // Resource-load errors (img/script 404) come through here too — skip.
    if (!e.error) return;
    console.error('[spyglass:error]', e.error);
    toast('Внутрішня помилка інтерфейсу: ' + (e.error.message || 'unknown'), 'error');
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[spyglass:unhandledrejection]', e.reason);
    const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    toast('Невловлений збій: ' + msg, 'error');
  });

  window.utils = {
    format(id) {
      try {
        const el = $(id);
        el.value = JSON.stringify(JSON.parse(el.value), null, 2);
        updateCharCount(id);
        updateJsonBadge(id);
      } catch (e) {
        toast(t('toast.invalid_json', { error: e.message }), 'error');
      }
    },
    copy(id) {
      const el = $(id);
      if (!el.value) {
        toast(t('toast.empty_field_copy'), 'error');
        return;
      }
      navigator.clipboard
        .writeText(el.value)
        .then(() => toast(t('toast.copied'), 'success'))
        .catch(() => toast(t('toast.copy_failed'), 'error'));
    },
  };

  window.switchTab = function (btn, targetId) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    $(targetId).classList.add('active');
  };

  window.clearInput = function (id) {
    $(id).value = '';
    updateCharCount(id);
    // Clear → drop the loaded-sample anchor so the next save starts fresh.
    _currentSampleId = null;
    _currentSampleMeta = null;
    _isDirty = false;
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
      var fromHtml = document.documentElement.getAttribute('lang');
      if (fromHtml === 'uk' || fromHtml === 'en' || fromHtml === 'ru') return fromHtml;
      var v = localStorage.getItem('kt-lang');
      if (v === 'uk' || v === 'en' || v === 'ru') return v;
      return 'uk';
    } catch (e) {
      return 'uk';
    }
  }
  function analyzeUrl() {
    // Absolute path — relative would resolve against pathname (e.g. /uk/),
    // breaking API access from non-root locales.
    return '/api/analyze?locale=' + encodeURIComponent(activeLocale());
  }

  // When the toggle changes, re-run analysis if there's a request to
  // analyse — gives instant visual feedback that EN labels appeared.
  // Pass current inputs as a `fromHist`-shaped object so runAnalysis treats
  // it as a re-run (skips spinner + history push + completion toast). Without
  // this every lang toggle was creating a duplicate history entry.
  window.addEventListener('kt:lang-change', function () {
    // Re-render the dynamic chrome that holds translated strings. Toasts
    // use t() at fire time so they're auto-correct; modals stay stale until
    // closed (acceptable — modal flicker on toggle would be worse UX).
    try {
      if (typeof renderHistory === 'function') renderHistory();
      if (typeof refreshSamples === 'function') refreshSamples();
    } catch (_) {
      /* render functions may not be defined yet during init */
    }
    if (typeof window.runAnalysis !== 'function') return;
    try {
      var req = document.getElementById('bidReq').value;
      var res = document.getElementById('bidRes').value;
      // Re-run when either pane has content — JsonFeed payloads (ExoClick,
      // RichAds, Zeropark) live in bidRes only, so gating on req-presence
      // would skip the lang-change re-render for that whole branch.
      if (!req && !res) return;
      window.runAnalysis({ req: req, res: res });
    } catch (e) {
      /* silent — user may not have a payload yet */
    }
  });

  // IAB Content Taxonomy decoder render. Reads the `meta.categories` map
  // from /api/analyze (path → [{code,label}]) and lays it out as a
  // collapsible-style list in the categories tab.
  function renderCategories(catsByPath) {
    const el = $('tCategories');
    const badge = $('categoriesBadge');
    if (!el) return;
    const paths = Object.keys(catsByPath || {});
    const total = paths.reduce((n, p) => n + catsByPath[p].length, 0);
    if (badge) badge.textContent = total ? String(total) : '0';
    if (!paths.length) {
      el.innerHTML =
        '<div class="empty-hint">' +
        'Жодних IAB-категорій у payload (cat[] / bcat[] / pcat[] порожні)' +
        '</div>';
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
    var family = 'unknown';
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
    updateJsonBadge(id);
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

  function setAdPreview(adm, simPrice) {
    const el = $('creativePreview');
    el.innerHTML = '';
    if (!adm) {
      el.innerHTML = '<div class="preview-placeholder">у відповіді немає adm/nurl</div>';
      return;
    }
    // Resolve known macros so the preview reflects an actual rendered impression.
    let resolved = String(adm)
      .replace(/\$\{AUCTION_PRICE\}/g, simPrice)
      .replace(/\$\{AUCTION_CURRENCY\}/g, 'USD')
      .replace(/\$\{AUCTION_LOSS\}/g, '0');
    const trimmed = resolved.trim();

    // 1) VAST XML → show as expandable XML preview. We can't actually play
    //    video here (no VAST player + sandbox-allow-scripts is too narrow).
    //    8000 chars is generous for modern VAST 4.x with multiple wrappers;
    //    surface a "trimmed" hint when we hit it so the user isn't surprised.
    if (/^<\?xml|<VAST/i.test(trimmed)) {
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
      return;
    }

    // 2) Native JSON → render as native-ad mockup (title + img + description).
    if (trimmed.startsWith('{')) {
      try {
        const j = JSON.parse(trimmed);
        if (j && j.native && Array.isArray(j.native.assets)) {
          el.innerHTML = renderNativePreview(j.native);
          return;
        }
      } catch {
        /* fall through to iframe */
      }
    }

    // 3) Banner HTML → iframe sandbox.
    const iframe = document.createElement('iframe');
    iframe.className = 'preview-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.srcdoc = resolved;
    el.appendChild(iframe);
  }

  // Render a Native 1.1 response as a card mockup so the user sees what the
  // creative will look like, not raw JSON.
  function renderNativePreview(native) {
    // Asset id semantics aren't fixed in the spec — most SSPs follow IAB
    // conventions: 1=title, 2=icon/image, 3=desc/sponsored. We pick by
    // structural cues (asset.title / asset.img / asset.data).
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
    const link = native.link && native.link.url;
    return `
      <div style="padding:var(--space-4);width:100%;height:100%;display:flex;flex-direction:column;gap:var(--space-3);overflow:auto">
        <div class="mono-label">native · 1.1 mockup</div>
        ${img ? `<div style="width:100%;border-radius:var(--r-sm);overflow:hidden;background:var(--bg-2);max-height:140px"><img src="${escapeHtml(img)}" style="width:100%;height:100%;object-fit:cover;display:block" alt=""></div>` : ''}
        <div style="display:flex;gap:var(--space-3);align-items:flex-start">
          ${icon ? `<img src="${escapeHtml(icon)}" style="width:44px;height:44px;border-radius:var(--r-sm);object-fit:cover;flex-shrink:0;background:var(--bg-2)" alt="">` : ''}
          <div style="flex:1;min-width:0">
            ${title ? `<div style="font-weight:600;font-size:var(--fs-sm);color:var(--text);line-height:1.35;margin-bottom:4px">${escapeHtml(title)}</div>` : '<div style="color:var(--text-dim);font-size:var(--fs-sm)">No title asset</div>'}
            ${desc ? `<div style="font-size:11.5px;color:var(--text-muted);line-height:1.45">${escapeHtml(desc)}</div>` : ''}
            ${sponsored ? `<div class="mono-label" style="margin-top:6px">${escapeHtml(sponsored)}</div>` : ''}
          </div>
        </div>
        ${link ? `<div class="mono-label" style="text-transform:none;letter-spacing:0;font-size:10px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">→ ${escapeHtml(link)}</div>` : ''}
      </div>`;
  }

  // ── Analysis ──────────────────────────────────────────────────
  // History: in-memory ring of recent analyses, persisted to localStorage so
  // a refresh doesn't lose state. Cap at HISTORY_MAX entries to keep the
  // localStorage footprint bounded (each entry can be up to ~2MB raw if user
  // pastes a huge payload — the cap is the only soft limit we have).
  const HISTORY_KEY = 'spyglass_history_v1';
  const HISTORY_MAX = 50;
  const historyStore = (() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (!saved) return [];
      const arr = JSON.parse(saved);
      return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : [];
    } catch {
      return [];
    }
  })();
  function persistHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(historyStore.slice(0, HISTORY_MAX)));
    } catch (e) {
      // QuotaExceeded — drop oldest half until it fits, or give up gracefully.
      try {
        historyStore.length = Math.floor(historyStore.length / 2);
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

  function renderHistory() {
    const list = $('hList');
    if (!list) return;
    if (!historyStore.length) {
      list.innerHTML =
        '<div style="color:var(--text-dim);font-size:var(--fs-sm);text-align:center;padding:var(--space-5)">' +
        t('history.empty') + '</div>';
      return;
    }
    list.innerHTML = historyStore
      .map((e, i) => {
        const cls = e.status === 'errors' || e.status === 'Critical' ? 'critical' : 'healthy';
        const activeCls = i === _currentHistoryIdx ? ' history-item--active' : '';
        return (
          '<div class="history-item' +
          activeCls +
          '" tabindex="0" onclick="loadFromHistory(' +
          i +
          ')" onkeydown="if(event.key===\'Enter\'){event.preventDefault();loadFromHistory(' +
          i +
          ')}">' +
          // Hover-revealed actions. Stop propagation so clicking × or 👁
          // doesn't also trigger the row\'s loadFromHistory.
          '<div class="history-actions" onclick="event.stopPropagation()">' +
          '<button class="history-act-btn" onclick="peekHistoryItem(' +
          i +
          ')" title="Переглянути без завантаження">👁</button>' +
          '<button class="history-act-btn danger" onclick="deleteHistoryItem(' +
          i +
          ')" title="Видалити з історії">×</button>' +
          '</div>' +
          '<div class="history-title">' +
          escapeHtml(e.title) +
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
  window.loadFromHistory = function (idx) {
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
    toast(t('toast.loaded', { title: entry.title || 'історія' }), 'success');
  };
  // Per-item delete from history. Cheap because historyStore is in-memory
  // + localStorage persist; no server roundtrip.
  window.deleteHistoryItem = function (idx) {
    if (!historyStore[idx]) return;
    historyStore.splice(idx, 1);
    // Active-index stays consistent: if we deleted the active one, drop the
    // anchor; if we deleted ABOVE the active, shift its index down.
    if (idx === _currentHistoryIdx) _currentHistoryIdx = -1;
    else if (idx < _currentHistoryIdx) _currentHistoryIdx--;
    persistHistory();
    renderHistory();
  };
  // Peek modal: show the request/response JSON for an entry without
  // clobbering the editor. Read-only — for "did I save the right one
  // earlier?" lookups.
  window.peekHistoryItem = function (idx) {
    const e = historyStore[idx];
    if (!e) return;
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card" style="max-width:720px;width:90vw">' +
      '<div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)">' +
      '<span>' +
      escapeHtml(e.title || 'історія') +
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
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()">' +
      t('btn.close') +
      '</button>' +
      '<button class="btn btn-primary btn-sm" onclick="closeModal();loadFromHistory(' +
      idx +
      ')">' +
      t('btn.load_to_editor') +
      '</button>' +
      '</div></div></div>';
  };
  window.clearHistory = function () {
    if (!historyStore.length) return;
    if (!confirm(t('confirm.clear_history'))) return;
    historyStore.length = 0;
    _currentHistoryIdx = -1;
    persistHistory();
    renderHistory();
    toast(t('toast.history_cleared'), 'success');
  };

  window.runAnalysis = async function (fromHist) {
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
    if (!fromHist) {
      analyzeBtn.innerHTML = '<span class="spinner"></span> analyzing…';
      analyzeBtn.disabled = true;
    }

    try {
      const req = reqVal ? JSON.parse(reqVal) : {};
      const res = resVal ? JSON.parse(resVal) : {};
      const simP = $('simPrice').value || '1.50';

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
        'локальний запит';

      // Summary info rows (left sidebar)
      const dev = req.device || {};
      $('mInfo').innerHTML =
        infoRow('os', dev.os || '—') +
        infoRow('geo', (dev.geo || {}).country || '—') +
        infoRow('device', dev.devicetype || dev.model || '—') +
        infoRow('connection', dev.connectiontype || '—');

      // Ad preview + winning bid price
      const adm = findAdm(res);
      const seatbid = res.seatbid ? res.seatbid[0] : null;
      const bid = seatbid && seatbid.bid ? seatbid.bid[0] : {};
      $('mPrice').innerText = adm
        ? bid.price
          ? '$' + Number(bid.price).toFixed(2)
          : 'BID'
        : '$0.00';
      setAdPreview(adm, simP);

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
        : '<div class="empty-hint" style="grid-column:1/-1">У запиті немає imp[] — слоти не знайдено</div>';

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
      $('inspectorBadge').textContent = imps.length;

      // Backend analysis (validation + semantic crosscheck)
      let validation = null,
        cross = null;
      try {
        const r = await fetch(analyzeUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bidReq: req, bidRes: res }),
        });
        const j = await r.json();
        if (j.success) {
          validation = j.validation;
          cross = j.crosscheck;
          // IAB cat decoding (Phase 2 feature) — surface as a side-panel
          // tab regardless of validation status. Empty object means no
          // category fields present in the payload.
          renderCategories((j.meta && j.meta.categories) || {});
          // Show humanised status to the user; stash raw canonical status
          // ('errors'/'warnings'/'clean'/'invalid') on a data-attribute so
          // confirmSave can read it without parsing localised text.
          $('stEntity').innerText = entity + ' · ' + humanStatus(validation.status);
          $('stEntity').dataset.status = validation.status || '';
          updateFormatBar(validation, (j.meta && j.meta.dialect) || null);
        }
      } catch (e) {
        console.warn('Backend unavailable:', e);
        $('stEntity').innerText = entity + ' · локально';
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
        $('validationBadge').textContent = findings.length;
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
              return (
                '<div class="validation-item ' +
                cls +
                '">' +
                '<span class="validation-icon">' +
                ic +
                '</span>' +
                '<span>' +
                escapeHtml(f.msg) +
                (f.path
                  ? ' <span style="color:var(--text-dim);font-family:var(--font-mono);font-size:10px">[' +
                    escapeHtml(f.path) +
                    ']</span>'
                  : '') +
                specLink +
                '</span>' +
                '</div>'
              );
            })
            .join('');
      } else if (validation) {
        $('validationBadge').textContent = '✓';
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
          'Усі перевірки пройдено — ' +
          escapeHtml(validation.type) +
          ' валідний</div>';
      } else {
        $('validationBadge').textContent = '—';
      }

      // Crosscheck tab — semantic verdict on req ↔ res alignment
      const crossEl = $('tCross');
      if (Array.isArray(cross) && cross.length) {
        const crit = cross.filter((c) => c.level === 'crit').length;
        const warn = cross.filter((c) => c.level === 'warn').length;
        $('crossBadge').textContent = crit + warn ? `${crit + warn}` : '✓';
        const summaryRow =
          crit || warn
            ? `<div class="mono-label" style="margin-bottom:var(--space-3)">${crit} критичних · ${warn} попереджень · ${cross.length - crit - warn} ok</div>`
            : `<div class="mono-label" style="color:var(--success);margin-bottom:var(--space-3)">Усі ${cross.length} звірок пройдено</div>`;
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
        $('crossBadge').textContent = '—';
        crossEl.innerHTML =
          '<div class="empty-hint">Для звірки потрібен ще BidResponse у правому полі</div>';
      } else {
        $('crossBadge').textContent = '—';
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
      toast(t('toast.error_generic', { error: e.message }), 'error');
      console.error('Analysis error:', e);
    } finally {
      if (!fromHist) {
        analyzeBtn.innerHTML = 'analyze stream';
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
      ['user.id', 'string', 'rec', 'User ID; auto-generated by Kadam if absent.'],
      ['bcat', 'array', 'opt', 'Blocked IAB categories ("IAB24", "IAB25-3").'],
      ['ext.bsection', 'array', 'opt', 'Kadam: blocked sections (e.g. [1001]).'],
      ['ext.btags', 'array', 'opt', 'Kadam: blocked tags (e.g. [16,14,4]).'],
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
      ['id', 'string', 'rec', 'Kadam site ID.'],
      ['domain', 'string', 'rec', 'Top-level domain.'],
      ['page', 'string', 'rec', 'Full page URL.'],
      ['publisher.id', 'string', 'rec', 'Publisher ID in Kadam.'],
      ['cat', 'array', 'opt', 'IAB categories ("IAB3-1").'],
      ['ext.exchangecat', 'int', 'opt', 'Kadam: exchange category (e.g. 555).'],
      ['ext.idzone', 'string', 'opt', 'Kadam: zone identifier.'],
    ],
    feedParams: [
      ['sid', 'string', 'req', 'Endpoint ID issued by Kadam.'],
      ['skey', 'string', 'req', 'API key issued by Kadam.'],
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
        user: { id: 'kadam_user_xyz', yob: 1990, gender: 'O' },
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
                nurl: 'https://win.kadam.net/nurl/abc?cur=${AUCTION_CURRENCY}&bid=${AUCTION_PRICE}',
                burl: 'https://bill.kadam.net/burl/abc?cur=${AUCTION_CURRENCY}&bid=${AUCTION_PRICE}',
                lurl: 'https://loss.kadam.net/lurl/abc?loss=${AUCTION_LOSS}',
                adm: '{"native":{"ver":"1.1","link":{"url":"https://click.kadam.net/c/abc"},"assets":[{"id":1,"required":1,"title":{"text":"Ad title"}},{"id":2,"required":1,"img":{"url":"https://cdn.kadam.net/i/192.png","w":192,"h":192}},{"id":3,"required":1,"data":{"value":"Short body text."}}]}}',
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
          click_url: 'https://click.kadam.net/c/abc',
          campaign_id: 555555,
          category: '1368',
          title: 'Discover this product',
          text: 'Short ad body — usually under 140 chars.',
          image_url: 'https://cdn.kadam.net/i/192.png',
          icon_url: 'https://cdn.kadam.net/icon.png?nurl=...',
          cpc: 0.031595,
          nurl: 'https://win.kadam.net/nurl/abc',
        },
      ],
      feedResponseClickunder: {
        result: { listing: [{ url: 'https://click.kadam.net/cu/xyz', bid: 0.502 }] },
      },
    },
  };

  function pasteIntoReq(json) {
    $('bidReq').value = JSON.stringify(json, null, 2);
    updateCharCount('bidReq');
    toast('Шаблон вставлено у BidRequest', 'success');
  }
  function pasteIntoRes(json) {
    $('bidRes').value = JSON.stringify(json, null, 2);
    updateCharCount('bidRes');
    toast('Шаблон вставлено у BidResponse', 'success');
  }
  function pasteString(target, str) {
    $(target).value = str;
    updateCharCount(target);
    toast('Шаблон вставлено', 'success');
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
            <button class="ref-paste-btn" onclick='_kadam.pasteIntoReq(_kadam.KADAM.templates.requestNative)'>paste → request</button>
          </div>
          <div class="ref-card-desc">Standard Kadam Native 1.1 with subage hints, geo, user, ext.bsection/btags blocking.</div>
          <pre class="ref-code">${escapeHtml(reqNativeJson)}</pre>
        </div>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Push (subscription)</span>
            <button class="ref-paste-btn" onclick='_kadam.pasteIntoReq(_kadam.KADAM.templates.requestPush)'>paste → request</button>
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
            <button class="ref-paste-btn" onclick='_kadam.pasteIntoRes(_kadam.KADAM.templates.responseNative)'>paste → response</button>
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
            <button class="ref-paste-btn" onclick="_kadam.pasteString('bidReq', _kadam.KADAM.templates.feedRequestUrl)">paste → request box</button>
          </div>
          <div class="ref-card-desc">Kadam Feed expects a GET with parameters; SSP issues sid + skey per ad format.</div>
          <pre class="ref-code">${escapeHtml(T.feedRequestUrl)}</pre>
          ${tableHtml(['param', 'type', 'rule', 'description'], KADAM.feedParams)}
        </div>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Feed response — push (JSON array)</span>
            <button class="ref-paste-btn" onclick='_kadam.pasteIntoRes(_kadam.KADAM.templates.feedResponsePush)'>paste → response</button>
          </div>
          <pre class="ref-code">${escapeHtml(feedPushJson)}</pre>
          ${tableHtml(['field', 'type', 'description'], KADAM.pushResponseFields)}
        </div>
        <div class="ref-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)">
            <span class="ref-card-title">Feed response — clickunder</span>
            <button class="ref-paste-btn" onclick='_kadam.pasteIntoRes(_kadam.KADAM.templates.feedResponseClickunder)'>paste → response</button>
          </div>
          <pre class="ref-code">${escapeHtml(feedCuJson)}</pre>
        </div>
      </div>

      <div class="ref-section">
        <h3>URL macros</h3>
        <div class="ref-card">
          <div class="ref-card-desc">Kadam supports only these three macros — others are ignored. Use in nurl, burl, lurl.</div>
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
      // At page-reload, cookie keeps the user logged in, but the in-memory
      // DEK is gone (and storing it would defeat the threat model). If the
      // user has crypto state set up but no DEK in this tab, we'll prompt
      // for password to unlock — but only after the page renders, so the
      // user sees the auth widget first and isn't slammed with a modal.
      _sessionDEK = null;
      _pendingUnlock = !!(j.user && j.encryption);
    } catch {
      _currentUser = null;
      _sessionDEK = null;
      _pendingUnlock = false;
    }
    renderAuthWidget();
    renderVerifyBanner();
  }
  let _pendingUnlock = false;

  // Show a minimal modal that takes only the password — lets a user with a
  // live cookie session re-derive the DEK without going through the full
  // login dance. Used after page-reload.
  window.openUnlockModal = function () {
    if (!_currentUser) {
      return window.openAuthModal('login');
    }
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card">' +
      '<div class="modal-title">' +
      t('modal.unlock.title') +
      '</div>' +
      '<div style="font-size:var(--fs-sm);color:var(--text-dim);margin-bottom:var(--space-3)">' +
      t('unlock.subtitle', { email: escapeHtml(_currentUser.email) }) +
      '</div>' +
      '<div class="modal-row"><label>' +
      t('auth.label.password') +
      '</label><input id="unlockPwInput" type="password" autocomplete="current-password"></div>' +
      '<div id="unlockError" style="color:var(--danger);font-size:var(--fs-sm);min-height:1.2em;margin-bottom:var(--space-2)"></div>' +
      '<div style="margin-bottom:var(--space-2);text-align:right"><a href="#" onclick="event.preventDefault();closeModal();openForgotPasswordModal()" style="font-size:var(--fs-sm);color:var(--text-dim)">' +
      t('auth.forgot_password') +
      '</a></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="signOut();closeModal()">' +
      t('btn.signout_instead') +
      '</button>' +
      '<button class="btn btn-primary btn-sm" onclick="doUnlock()">' +
      t('btn.unlock') +
      '</button>' +
      '</div></div></div>';
    setTimeout(() => $('unlockPwInput').focus(), 0);
    $('unlockPwInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.doUnlock();
      }
    });
  };

  window.doUnlock = async function () {
    const password = $('unlockPwInput').value;
    const errEl = $('unlockError');
    errEl.textContent = '';
    try {
      // Re-fetch crypto state via /api/auth/me (it's already stable across
      // calls). Then derive KEK + unwrap DEK.
      const me = await api('GET', 'api/auth/me');
      if (!me.encryption) {
        errEl.textContent = t('unlock.err.no_crypto');
        return;
      }
      _sessionDEK = await SpyglassCrypto.openWithPassword(password, me.encryption);
      _pendingUnlock = false;
      closeModal();
      toast(t('toast.library_unlocked'), 'success');
      refreshSamples();
    } catch {
      errEl.textContent = t('unlock.err.wrong_password');
    }
  };

  window.openAuthModal = function (mode) {
    const isReg = mode === 'register';
    // Preserve any email/password the user already typed before switching
    // login ↔ register so the field doesn't reset on every toggle.
    const prevEmail = $('authEmailInput')?.value || '';
    const prevPassword = $('authPasswordInput')?.value || '';
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card">' +
      '<div class="modal-title">' +
      t(isReg ? 'auth.register.title' : 'auth.login.title') +
      '</div>' +
      '<div class="modal-row"><label>' +
      t('auth.label.email') +
      '</label><input id="authEmailInput" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
      '<div class="modal-row"><label>' +
      t(isReg ? 'auth.label.password_hint' : 'auth.label.password') +
      '</label><input id="authPasswordInput" type="password" autocomplete="' +
      (isReg ? 'new-password' : 'current-password') +
      '"></div>' +
      '<div id="authError" style="color:var(--danger);font-size:var(--fs-sm);min-height:1.2em;margin-bottom:var(--space-2)"></div>' +
      (isReg
        ? ''
        : '<div style="margin-bottom:var(--space-2);text-align:right"><a href="#" onclick="event.preventDefault();openForgotPasswordModal()" style="font-size:var(--fs-sm);color:var(--text-dim)">' +
          t('auth.forgot_password') +
          '</a></div>') +
      '<div class="modal-actions" style="justify-content:space-between">' +
      '<button class="btn btn-ghost btn-sm" onclick="' +
      (isReg ? "openAuthModal('login')" : "openAuthModal('register')") +
      '">' +
      t(isReg ? 'auth.switch_to_login' : 'auth.switch_to_register') +
      '</button>' +
      '<div style="display:flex;gap:var(--space-2)">' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()">' +
      t('btn.cancel') +
      '</button>' +
      '<button class="btn btn-primary btn-sm" onclick="' +
      (isReg ? 'doRegister()' : 'doLogin()') +
      '">' +
      t(isReg ? 'auth.btn.register' : 'auth.btn.login') +
      '</button>' +
      '</div></div></div></div>';
    setTimeout(() => {
      // Restore prior values from previous mode (preserved across switches).
      // Don't auto-focus password if it was empty — focus email first.
      if (prevEmail) $('authEmailInput').value = prevEmail;
      if (prevPassword) $('authPasswordInput').value = prevPassword;
      const focusTarget = prevEmail && !prevPassword ? 'authPasswordInput' : 'authEmailInput';
      $(focusTarget).focus();
    }, 0);
    // Submit on Enter
    const submit = isReg ? () => window.doRegister() : () => window.doLogin();
    ['authEmailInput', 'authPasswordInput'].forEach((id) => {
      $(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
    });
  };

  window.doLogin = async function () {
    const email = $('authEmailInput').value.trim();
    const password = $('authPasswordInput').value;
    const errEl = $('authError');
    errEl.textContent = '';
    try {
      const j = await api('POST', 'api/auth/login', { email, password });
      _currentUser = j.user;
      // Resolve session DEK. Two paths:
      //   - Existing user with crypto already set up → derive KEK from
      //     password, unwrap DEK, keep in memory for this session.
      //   - Existing pre-Phase-7 user with no crypto state yet → bootstrap
      //     now (we have the password in hand). Show recovery key.
      if (j.encryption) {
        _sessionDEK = await SpyglassCrypto.openWithPassword(password, j.encryption);
      } else {
        await bootstrapNewCrypto(password);
      }
      renderAuthWidget();
      closeModal();
      toast(t('toast.hello', { email: j.user.email }), 'success');
      await refreshPartners();
      refreshSamples();
    } catch (e) {
      errEl.textContent = humanAuthError(e);
    }
  };

  window.doRegister = async function () {
    const email = $('authEmailInput').value.trim();
    const password = $('authPasswordInput').value;
    const errEl = $('authError');
    errEl.textContent = '';
    try {
      const j = await api('POST', 'api/auth/register', { email, password });
      _currentUser = j.user;
      await bootstrapNewCrypto(password); // brand-new user → always bootstrap
      renderAuthWidget();
      closeModal();
      toast(t('toast.account_created', { email: j.user.email }), 'success');
      await refreshPartners();
      refreshSamples();
    } catch (e) {
      errEl.textContent = humanAuthError(e);
    }
  };

  // Generates DEK + recovery key, wraps DEK with both password-KEK and
  // recovery-KEK in the browser, persists the opaque state to the server,
  // shows the recovery key to the user once. Caller must already hold the
  // user's plaintext password (passed in here, never stored anywhere).
  async function bootstrapNewCrypto(password) {
    const result = await SpyglassCrypto.bootstrap(password);
    await api('POST', 'api/auth/setup-encryption', result.state);
    _sessionDEK = result.dekKey;
    showRecoveryKeyModal(result.recoveryKey);
  }

  // Recovery-key modal close goes through this gate so Esc + backdrop +
  // explicit button all share the same "did you really save it?" confirm.
  // Without this, an accidental Esc or button-misclick lost the key forever
  // (single-show by design — the server stores only the wrap, not the key).
  let _recoveryKeyModalActive = false;
  window.closeRecoveryKeyModal = function () {
    if (!confirm(t('confirm.recovery_save'))) return;
    _recoveryKeyModalActive = false;
    closeModal();
  };

  function showRecoveryKeyModal(recoveryKey) {
    // Defensive null-guard on match() — if recoveryKey is somehow empty
    // (shouldn't happen, but guards against null.join() crash).
    const grouped = (String(recoveryKey || '').match(/.{1,4}/g) || []).join('-');
    _recoveryKeyModalActive = true;
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeRecoveryKeyModal()">' +
      '<div class="modal-card" style="max-width:520px">' +
      '<div class="modal-title">' +
      t('modal.recovery.title') +
      '</div>' +
      '<div style="font-size:var(--fs-sm);line-height:1.5;margin-bottom:var(--space-3);color:var(--text)">' +
      t('recovery.body') +
      '</div>' +
      '<div style="background:var(--bg-2);padding:var(--space-3);border-radius:var(--r-sm);font-family:var(--font-mono);font-size:14px;letter-spacing:0.05em;text-align:center;margin-bottom:var(--space-3);user-select:all;word-break:break-all">' +
      escapeHtml(grouped) +
      '</div>' +
      '<div class="modal-actions" style="justify-content:space-between">' +
      '<button id="rkCopyBtn" class="btn btn-ghost btn-sm" onclick="copyRecoveryKey(\'' +
      escapeHtml(recoveryKey) +
      '\')">' +
      t('btn.copy') +
      '</button>' +
      '<button class="btn btn-primary btn-sm" onclick="closeRecoveryKeyModal()">' +
      t('btn.recovery_saved') +
      '</button>' +
      '</div>' +
      '</div></div>';
  }

  window.copyRecoveryKey = function (key) {
    const btn = $('rkCopyBtn');
    const flashSuccess = () => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = t('btn.copied');
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = orig;
        btn.disabled = false;
      }, 1800);
    };
    navigator.clipboard
      .writeText(key)
      .then(() => {
        flashSuccess();
        toast(t('toast.recovery_key_copied'), 'success');
      })
      .catch(() => toast(t('toast.copy_failed_select'), 'error'));
  };

  window.signOut = async function () {
    try {
      await api('POST', 'api/auth/logout');
    } catch {
      /* logout is idempotent — ignore failures */
    }
    _currentUser = null;
    _partnerCache = [];
    _sessionDEK = null; // wipe DEK from memory on logout
    _currentSampleId = null;
    _currentSampleMeta = null;
    _isDirty = false;
    renderAuthWidget();
    refreshSamples();
    toast(t('toast.signed_out'), 'success');
  };

  // ── Phase 8: forgot/reset password + email verification ──────────────

  window.openForgotPasswordModal = function () {
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card">' +
      '<div class="modal-title">' +
      t('modal.password_reset.title') +
      '</div>' +
      '<div style="font-size:var(--fs-sm);color:var(--text-dim);margin-bottom:var(--space-3)">' +
      t('forgot.subtitle') +
      '</div>' +
      '<div class="modal-row"><label>' +
      t('auth.label.email') +
      '</label><input id="forgotEmailInput" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
      '<div id="forgotMessage" style="font-size:var(--fs-sm);color:var(--text-dim);min-height:1.2em;margin-bottom:var(--space-2)"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="openAuthModal(\'login\')">' +
      t('forgot.btn.back_to_login') +
      '</button>' +
      '<button class="btn btn-primary btn-sm" onclick="doForgotPassword()">' +
      t('forgot.btn.send') +
      '</button>' +
      '</div></div></div>';
    setTimeout(() => $('forgotEmailInput').focus(), 0);
    $('forgotEmailInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.doForgotPassword();
      }
    });
  };

  window.doForgotPassword = async function () {
    const email = $('forgotEmailInput').value.trim();
    const msgEl = $('forgotMessage');
    if (!email) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = t('forgot.email_required');
      return;
    }
    // Client-side email shape check — mirrors auth.js EMAIL_RE on server.
    // Without it, "asdf" hits the API, server returns 200 (anti-enumeration),
    // UI showed misleading "лист відправлено" for an obviously-bad address.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = t('forgot.invalid_email');
      return;
    }
    msgEl.style.color = 'var(--text-dim)';
    msgEl.textContent = t('forgot.sending');
    try {
      await api('POST', 'api/auth/forgot-password', { email });
      msgEl.style.color = 'var(--success, green)';
      msgEl.textContent = t('forgot.sent');
    } catch (e) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = e.message || t('toast.error_generic', { error: '' });
    }
  };

  window.openResetPasswordModal = async function (token) {
    // Fetch crypto state (proves token is valid via server) before showing UI.
    let stateRes;
    try {
      stateRes = await api('POST', 'api/auth/reset-password/state', { token });
    } catch (e) {
      toast(t('reset.err.link_invalid', { error: e.message || '' }), 'error');
      // Strip ?reset= from URL so refresh doesn't re-trigger.
      history.replaceState({}, '', location.pathname);
      return;
    }
    const enc = stateRes.encryption;
    const email = stateRes.email;
    _resetCtx = { token, encryption: enc, email };

    const radioBox = (val, key, hintColor) =>
      '<label style="display:flex;align-items:flex-start;gap:var(--space-2);cursor:pointer;padding:var(--space-2);border:1px solid var(--border);border-radius:4px;margin-bottom:var(--space-2)">' +
      '<input type="radio" name="resetMode" value="' +
      val +
      '"' +
      (val === 'rotate' ? ' checked' : '') +
      ' onchange="updateResetModeUI()" style="margin-top:3px">' +
      '<span><b>' +
      t('reset.mode.' + key) +
      '</b><br><span style="font-size:var(--fs-sm);color:' +
      hintColor +
      '">' +
      t('reset.mode.' + key + '_hint') +
      '</span></span></label>';
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card" style="max-width:520px">' +
      '<div class="modal-title">' +
      t('modal.password_reset.title') +
      '</div>' +
      '<div style="font-size:var(--fs-sm);color:var(--text-dim);margin-bottom:var(--space-3)">' +
      escapeHtml(email) +
      '</div>' +
      '<div class="modal-row" style="display:block">' +
      radioBox('rotate', 'rotate', 'var(--text-dim)') +
      radioBox('recover', 'recover', 'var(--text-dim)') +
      radioBox('wipe', 'wipe', 'var(--danger)') +
      '</div>' +
      '<div id="resetModeFields"></div>' +
      '<div class="modal-row"><label>' +
      t('reset.label.new_password') +
      '</label>' +
      '<input id="resetNewPwInput" type="password" autocomplete="new-password"></div>' +
      '<div id="resetError" style="color:var(--danger);font-size:var(--fs-sm);min-height:1.2em;margin-bottom:var(--space-2)"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal();history.replaceState({},\'\',location.pathname)">' +
      t('btn.cancel') +
      '</button>' +
      '<button id="resetPrimaryBtn" class="btn btn-primary btn-sm" onclick="doResetPassword()">' +
      t('reset.btn.reset') +
      '</button>' +
      '</div></div></div>';
    window.updateResetModeUI();
    // Auto-focus the first input visible in the default mode (rotate → oldPw).
    setTimeout(() => $('resetOldPwInput')?.focus(), 0);
  };

  window.updateResetModeUI = function () {
    const mode = document.querySelector('input[name="resetMode"]:checked').value;
    const f = $('resetModeFields');
    // Preserve any values the user typed in the previous mode so toggling
    // radios doesn't wipe their input.
    const prev = {
      old: $('resetOldPwInput')?.value || '',
      recovery: $('resetRecoveryInput')?.value || '',
      wipeConfirm: $('resetWipeConfirm')?.checked || false,
    };
    if (mode === 'rotate') {
      f.innerHTML =
        '<div class="modal-row"><label>' +
        t('reset.label.old_password') +
        '</label>' +
        '<input id="resetOldPwInput" type="password" autocomplete="current-password" value="' +
        escapeHtml(prev.old) +
        '"></div>';
      setTimeout(() => $('resetOldPwInput')?.focus(), 0);
    } else if (mode === 'recover') {
      f.innerHTML =
        '<div class="modal-row"><label>' +
        t('reset.label.recovery') +
        '</label>' +
        '<input id="resetRecoveryInput" type="text" autocomplete="off" placeholder="xxxx-xxxx-xxxx-xxxx-..." style="font-family:monospace" value="' +
        escapeHtml(prev.recovery) +
        '"></div>';
      setTimeout(() => $('resetRecoveryInput')?.focus(), 0);
    } else {
      f.innerHTML =
        '<div style="background:rgba(220,40,40,.08);border:1px solid var(--danger);padding:var(--space-2);border-radius:4px;margin-bottom:var(--space-3);font-size:var(--fs-sm)">' +
        t('reset.wipe_warn') +
        '<label style="display:flex;align-items:center;gap:var(--space-2);margin-top:var(--space-2);cursor:pointer">' +
        '<input type="checkbox" id="resetWipeConfirm"' +
        (prev.wipeConfirm ? ' checked' : '') +
        '> ' +
        t('reset.wipe_confirm') +
        '</label>' +
        '</div>';
    }
    // Primary button label matches the destructive intent in wipe mode.
    const btn = $('resetPrimaryBtn');
    if (btn) {
      btn.textContent = t(mode === 'wipe' ? 'reset.btn.wipe_reset' : 'reset.btn.reset');
      btn.classList.toggle('danger', mode === 'wipe');
    }
  };

  window.doResetPassword = async function () {
    const mode = document.querySelector('input[name="resetMode"]:checked').value;
    const newPassword = $('resetNewPwInput').value;
    const errEl = $('resetError');
    errEl.textContent = '';
    if (newPassword.length < 8) {
      errEl.textContent = t('reset.err.short_password');
      return;
    }
    const ctx = _resetCtx;
    if (!ctx) {
      errEl.textContent = t('reset.err.session_lost');
      return;
    }
    try {
      let body;
      if (mode === 'wipe') {
        if (!$('resetWipeConfirm').checked) {
          errEl.textContent = t('reset.err.wipe_unconfirmed');
          return;
        }
        body = { token: ctx.token, mode: 'wipe', newPassword };
      } else {
        // rotate / recover: unwrap DEK locally, re-wrap under new KEK.
        if (!ctx.encryption) {
          errEl.textContent = t('reset.err.no_state');
          return;
        }
        let dekBytes;
        if (mode === 'rotate') {
          const oldPassword = $('resetOldPwInput').value;
          if (!oldPassword) {
            errEl.textContent = t('reset.err.old_required');
            return;
          }
          const oldSalt = SpyglassCrypto._b64ToBytes(ctx.encryption.kdf_salt);
          const oldKEK = await SpyglassCrypto.deriveKEK(oldPassword, oldSalt);
          try {
            dekBytes = await SpyglassCrypto.unwrapBytes(
              oldKEK,
              ctx.encryption.dek_iv,
              ctx.encryption.dek_wrapped,
            );
          } catch {
            errEl.textContent = t('reset.err.old_wrong');
            return;
          }
          body = {
            token: ctx.token,
            mode: 'rotate',
            oldPassword,
            newPassword,
          };
        } else {
          const recovery = $('resetRecoveryInput')
            .value.replace(/[^0-9a-fA-F]/g, '')
            .toLowerCase();
          if (recovery.length !== 32) {
            errEl.textContent = t('reset.err.recovery_format');
            return;
          }
          const recSalt = SpyglassCrypto._b64ToBytes(ctx.encryption.recovery_salt);
          const recKEK = await SpyglassCrypto.deriveKEK(recovery, recSalt);
          try {
            dekBytes = await SpyglassCrypto.unwrapBytes(
              recKEK,
              ctx.encryption.recovery_dek_iv,
              ctx.encryption.recovery_dek_wrapped,
            );
          } catch {
            errEl.textContent = t('reset.err.recovery_wrong');
            return;
          }
          body = {
            token: ctx.token,
            mode: 'recover',
            newPassword,
          };
        }
        // Re-wrap DEK under new KEK (common for rotate + recover).
        const newSalt = crypto.getRandomValues(new Uint8Array(16));
        const newKEK = await SpyglassCrypto.deriveKEK(newPassword, newSalt);
        const wrapped = await SpyglassCrypto.wrapBytes(newKEK, dekBytes);
        body.new_kdf_salt = SpyglassCrypto._bytesToB64(newSalt);
        body.new_dek_wrapped = wrapped.ct;
        body.new_dek_iv = wrapped.iv;
        // Keep DEK live so user is unlocked immediately after reset.
        _sessionDEK = await SpyglassCrypto.importDEK(dekBytes);
      }
      const resp = await api('POST', 'api/auth/reset-password', body);
      _currentUser = resp.user;
      _resetCtx = null;
      _pendingUnlock = mode === 'wipe'; // wipe needs fresh bootstrap on next save
      if (mode === 'wipe') _sessionDEK = null;
      history.replaceState({}, '', location.pathname);
      closeModal();
      renderAuthWidget();
      renderVerifyBanner();
      refreshSamples();
      toast(t('toast.password_reset'), 'success');
    } catch (e) {
      errEl.textContent = e.message || 'Помилка';
    }
  };
  let _resetCtx = null;

  window.requestVerifyEmail = async function () {
    try {
      await api('POST', 'api/auth/verify-email/request');
      toast(t('toast.verify_email_sent', { email: (_currentUser && _currentUser.email) || '' }), 'success');
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

  function humanAuthError(e) {
    const code = e.code || '';
    if (code === 'invalid_email') return t('auth.err.invalid_email');
    if (code === 'weak_password') return t('auth.err.weak_password');
    if (code === 'email_taken') return t('auth.err.email_taken');
    if (code === 'invalid_credentials') return t('auth.err.invalid_creds');
    if (code === 'rate_limited') return t('auth.err.rate_limited');
    return e.message || t('toast.error_generic', { error: '' }).replace(/[:\s]+$/, '');
  }

  function humanStatus(s) {
    // Canonical (new validator) statuses — pull from i18n bundle so they
    // pivot UK ↔ EN with the language toggle.
    if (s === 'errors') return t('status.errors');
    if (s === 'warnings') return t('status.warnings');
    if (s === 'clean') return t('status.clean');
    if (s === 'invalid') return t('status.invalid');
    // Backward compat with the pre-Phase-1 server (transitional)
    if (s === 'Critical') return 'критичні помилки';
    if (s === 'Healthy') return 'без критичних помилок';
    if (s === 'Invalid') return 'невалідний payload';
    if (s === 'Valid') return 'валідно';
    return s || '';
  }
  window.humanStatus = humanStatus;

  async function refreshPartners() {
    if (!_currentUser) {
      _partnerCache = [];
      const sel = $('partnerFilter');
      sel.innerHTML =
        '<option value="">' + t('sample.partner_all') + '</option><option value="unassigned">' + t('sample.partner_none') + '</option>';
      return;
    }
    try {
      const j = await api('GET', 'api/partners');
      _partnerCache = j.partners || [];
      const sel = $('partnerFilter');
      const cur = sel.value;
      sel.innerHTML =
        '<option value="">' + t('sample.partner_all') + '</option>' +
        '<option value="unassigned">' + t('sample.partner_none') + '</option>' +
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
      toast('Не вдалося завантажити список партнерів: ' + e.message, 'error');
    }
  }

  async function refreshSamples() {
    const el = $('savedList');
    if (!_currentUser) {
      el.innerHTML =
        '<div class="anon-cta">' +
        t('sample.anon_cta') +
        '<br><button class="btn btn-primary btn-sm" onclick="openAuthModal(\'login\')">' +
        t('sample.btn.signin') +
        '</button></div>';
      return;
    }
    // Logged-in but DEK is gone (page reload): surface unlock CTA.
    if (_pendingUnlock && !_sessionDEK) {
      el.innerHTML =
        '<div class="anon-cta">' +
        t('sample.unlock_cta') +
        '<br><button class="btn btn-primary btn-sm" onclick="openUnlockModal()">' +
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
        el.innerHTML = '<div class="saved-empty">' + t('empty.samples') + '</div>';
        return;
      }
      const partnerName = (id) => {
        if (id == null) return t('sample.partner_unassigned');
        const p = _partnerCache.find((x) => x.id === id);
        return p ? p.name : 'партнер #' + id;
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
            '<div class="saved-item" onclick="loadSample(' +
            s.id +
            ')">' +
            '<div class="saved-item-actions" onclick="event.stopPropagation()">' +
            '<button class="saved-act-btn" onclick="editSample(' +
            s.id +
            ')" title="Перейменувати / змінити партнера">edit</button>' +
            '<button class="saved-act-btn danger" onclick="deleteSample(' +
            s.id +
            ')" title="Видалити">×</button>' +
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
      toast('Не вдалося завантажити запити: ' + e.message, 'error');
    }
  }

  function closeModal() {
    // Recovery-key modal has special "really?" gate — route Esc/backdrop
    // closures through it instead of the silent close path.
    if (_recoveryKeyModalActive) {
      window.closeRecoveryKeyModal();
      return;
    }
    $('modalRoot').innerHTML = '';
    // If the user closes the reset-password modal via Esc or backdrop click
    // (rather than the cancel button), still strip the `?reset=...` query
    // so a refresh doesn't silently re-trigger the same flow.
    if (_resetCtx && new URLSearchParams(location.search).has('reset')) {
      _resetCtx = null;
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
    return (
      '<option value="">' + t('sample.partner_none') + '</option>' +
      _partnerCache
        .map(
          (p) =>
            '<option value="' +
            p.id +
            '"' +
            (p.id === selectedId ? ' selected' : '') +
            '>' +
            escapeHtml(p.name) +
            '</option>',
        )
        .join('')
    );
  }

  window.openSaveModal = function () {
    if (!_currentUser) {
      // Auth-gate: open sign-in modal directly (no double-toast over the modal).
      window.openAuthModal('login');
      return;
    }
    const reqVal = $('bidReq').value || '';
    const resVal = $('bidRes').value || '';
    if (!reqVal.trim() && !resVal.trim()) {
      toast(t('toast.nothing_to_save'), 'error');
      return;
    }
    // Updating an existing record? Pre-fill from loaded meta so user
    // doesn't lose title/partner/notes by accident.
    const updating = !!_currentSampleId && !!_currentSampleMeta;
    let title;
    let presetPartner;
    let presetNotes;
    if (updating) {
      title = _currentSampleMeta.title || 'sample';
      presetPartner = _currentSampleMeta.partner_id;
      presetNotes = _currentSampleMeta.notes || '';
    } else {
      title = (() => {
        try {
          const j = JSON.parse(reqVal);
          return j.id || j.site?.domain || j.app?.bundle || 'sample';
        } catch {
          return 'sample';
        }
      })();
      const sel = $('partnerFilter');
      presetPartner =
        sel && sel.value && sel.value !== 'unassigned' ? Number(sel.value) : null;
      presetNotes = '';
    }
    const headerText = updating
      ? t('modal.save_sample.update_title', { id: _currentSampleId })
      : t('modal.save_sample.title');
    const primaryBtn =
      '<button class="btn btn-primary btn-sm" onclick="confirmSave()">' +
      t(updating ? 'btn.update' : 'btn.save') +
      '</button>';
    const secondaryBtn = updating
      ? '<button class="btn btn-ghost btn-sm" onclick="confirmSave({asNew:true})">' +
        t('btn.save_as_new') +
        '</button>'
      : '';
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card">' +
      '<div class="modal-title">' +
      escapeHtml(headerText) +
      '</div>' +
      '<div class="modal-row"><label>' +
      t('sample.label.title') +
      '</label><input id="mTitle" type="text" value="' +
      escapeHtml(String(title)) +
      '"></div>' +
      '<div class="modal-row"><label>' +
      t('sample.label.partner') +
      '</label><select id="mPartner">' +
      partnerOptionsHtml(presetPartner) +
      '</select></div>' +
      '<div class="modal-row"><label>' +
      t('sample.label.notes') +
      '</label><textarea id="mNotes">' +
      escapeHtml(presetNotes) +
      '</textarea></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()">' +
      t('btn.cancel') +
      '</button>' +
      secondaryBtn +
      primaryBtn +
      '</div>' +
      '</div>' +
      '</div>';
    setTimeout(() => {
      $('mTitle').focus();
      wireEnterSubmit('mTitle', () => window.confirmSave());
    }, 0);
  };

  window.confirmSave = async function (opts) {
    if (!_sessionDEK) {
      toast(t('toast.crypto_session_lost'), 'error');
      return;
    }
    const asNew = !!(opts && opts.asNew);
    const updating = !asNew && !!_currentSampleId;
    const title = $('mTitle').value.trim() || 'sample';
    const partnerId = $('mPartner').value || null;
    const notes = $('mNotes').value.trim();
    const bid_req = $('bidReq').value || '';
    const bid_res = $('bidRes').value || '';
    // Status from the most recent analysis. Stored on a data-attribute by
    // the analyzer so localised text in `innerText` doesn't break this read.
    const status = ($('stEntity')?.dataset.status || '').trim();
    try {
      // Encrypt blobs locally before POSTing. Server stores opaque ciphertext.
      const encReq = await SpyglassCrypto.encryptBlob(_sessionDEK, bid_req);
      const encRes = await SpyglassCrypto.encryptBlob(_sessionDEK, bid_res);
      const payload = {
        partner_id: partnerId ? Number(partnerId) : null,
        title,
        bid_req: encReq.ct,
        bid_res: encRes.ct,
        req_iv: encReq.iv,
        res_iv: encRes.iv,
        status,
        notes,
      };
      let saved;
      if (updating) {
        saved = await api('PATCH', 'api/samples/' + _currentSampleId, payload);
        toast(t('toast.updated', { title }), 'success');
      } else {
        saved = await api('POST', 'api/samples', payload);
        // After save-as-new (or first save), track the new id so subsequent
        // saves keep updating instead of duplicating.
        if (saved && saved.sample) {
          _currentSampleId = saved.sample.id;
          _currentSampleMeta = {
            title,
            partner_id: payload.partner_id,
            notes,
          };
        }
        toast(t('toast.saved', { title }), 'success');
      }
      // Bring the cached meta in sync with whatever the user just wrote.
      if (updating) {
        _currentSampleMeta = { title, partner_id: payload.partner_id, notes };
      }
      _isDirty = false;
      closeModal();
      refreshSamples();
    } catch (e) {
      toast(t('toast.save_failed', { error: e.message }), 'error');
    }
  };

  window.loadSample = async function (id) {
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
      console.error('[loadSample]', e);
      toast(t('toast.decrypt_failed'), 'error');
    }
  };

  window.deleteSample = async function (id) {
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
  };

  window.editSample = async function (id) {
    try {
      const j = await api('GET', 'api/samples/' + id);
      const s = j.sample;
      $('modalRoot').innerHTML =
        '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
        '<div class="modal-card">' +
        '<div class="modal-title">' +
        t('modal.edit_sample.title') +
        '</div>' +
        '<div class="modal-row"><label>' +
        t('sample.label.title') +
        '</label><input id="mTitle" type="text" value="' +
        escapeHtml(s.title) +
        '"></div>' +
        '<div class="modal-row"><label>' +
        t('sample.label.partner') +
        '</label><select id="mPartner">' +
        partnerOptionsHtml(s.partner_id) +
        '</select></div>' +
        '<div class="modal-row"><label>' +
        t('sample.label.notes_short') +
        '</label><textarea id="mNotes">' +
        escapeHtml(s.notes || '') +
        '</textarea></div>' +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="closeModal()">' +
        t('btn.cancel') +
        '</button>' +
        '<button class="btn btn-primary btn-sm" onclick="confirmEdit(' +
        s.id +
        ')">' +
        t('btn.save') +
        '</button>' +
        '</div>' +
        '</div>' +
        '</div>';
      setTimeout(() => {
        $('mTitle').focus();
        wireEnterSubmit('mTitle', () => window.confirmEdit(s.id));
      }, 0);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  window.confirmEdit = async function (id) {
    const title = $('mTitle').value.trim() || 'sample';
    const partnerId = $('mPartner').value || null;
    const notes = $('mNotes').value.trim();
    try {
      await api('PATCH', 'api/samples/' + id, {
        title,
        partner_id: partnerId ? Number(partnerId) : null,
        notes,
      });
      // Keep the loaded-meta in sync if the user just edited the same record.
      if (_currentSampleId === id && _currentSampleMeta) {
        _currentSampleMeta = { title, partner_id: partnerId ? Number(partnerId) : null, notes };
      }
      closeModal();
      toast(t('toast.saved', { title }), 'success');
      refreshSamples();
    } catch (e) {
      toast(t('toast.save_changes_failed', { error: e.message }), 'error');
    }
  };

  function partnerListHtml() {
    if (!_partnerCache.length) return '<div class="saved-empty">' + t('empty.partners') + '</div>';
    return _partnerCache
      .map(
        (p) =>
          '<div class="saved-item" style="cursor:default">' +
          '<div class="saved-item-actions" style="opacity:1">' +
          '<button class="saved-act-btn danger" onclick="deletePartner(' +
          p.id +
          ')" title="Видалити">×</button>' +
          '</div>' +
          '<div class="saved-item-title">' +
          escapeHtml(p.name) +
          '</div>' +
          '<div class="saved-item-meta"><span>slug · ' +
          escapeHtml(p.slug) +
          '</span></div>' +
          '</div>',
      )
      .join('');
  }

  window.openPartnerModal = function () {
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card">' +
      '<div class="modal-title">' +
      t('modal.partners.title') +
      '</div>' +
      '<div id="pList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:var(--space-3);max-height:240px;overflow-y:auto">' +
      partnerListHtml() +
      '</div>' +
      '<div class="modal-row"><label>' +
      t('partner.label.add_new') +
      '</label><input id="pName" type="text" placeholder="' +
      escapeHtml(t('partner.placeholder')) +
      '"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()">' +
      t('btn.close') +
      '</button>' +
      '<button class="btn btn-primary btn-sm" onclick="confirmAddPartner()">' +
      t('btn.add') +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    setTimeout(() => {
      $('pName').focus();
      wireEnterSubmit('pName', () => window.confirmAddPartner());
    }, 0);
  };

  window.confirmAddPartner = async function () {
    const name = $('pName').value.trim();
    if (!name) {
      toast(t('toast.partner_name_required'), 'error');
      $('pName').focus();
      return;
    }
    try {
      await api('POST', 'api/partners', { name });
      await refreshPartners();
      $('pList').innerHTML = partnerListHtml();
      $('pName').value = '';
      $('pName').focus();
      toast(t('toast.added', { name }), 'success');
      refreshSamples();
    } catch (e) {
      toast(t('toast.partner_add_failed', { error: e.message }), 'error');
    }
  };

  window.deletePartner = async function (id) {
    if (!confirm(t('confirm.delete_partner'))) return;
    try {
      await api('DELETE', 'api/partners/' + id);
      await refreshPartners();
      $('pList').innerHTML = partnerListHtml();
      toast(t('toast.partner_deleted'), 'success');
      refreshSamples();
    } catch (e) {
      toast(t('toast.partner_delete_failed', { error: e.message }), 'error');
    }
  };

  window.closeModal = closeModal;

  // ── Init ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    renderReference();
    updateCharCount('bidReq');
    updateCharCount('bidRes');

    // Dirty-tracking for save lifecycle. `value =` from JS doesn't fire
    // input events (per HTML spec), so loadSample / clearInput don't
    // accidentally mark the editor dirty. User typing → dirty → save
    // modal can offer "оновити" + clobber-protection on next loadSample.
    ['bidReq', 'bidRes'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('input', () => { _isDirty = true; });
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

    // Render any history that was persisted from a prior session.
    renderHistory();

    await bootAuth();
    await refreshPartners();
    refreshSamples();
    // Phase 8 URL params: ?reset=token | ?verified=1 | ?verify_error=...
    const qp = new URLSearchParams(location.search);
    // Vendor-specific reference tab is hidden by default — only revealed when
    // the user explicitly opts into a vendor dialect via ?dialect=<name>.
    // Keeps the public landing strictly oRTB-generic.
    if (qp.get('dialect') && qp.get('dialect') !== 'iab') {
      const tab = document.getElementById('kadamRefTab');
      if (tab) tab.hidden = false;
    }
    if (qp.get('reset')) {
      window.openResetPasswordModal(qp.get('reset'));
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
  });
  window.refreshSamples = refreshSamples;

  // ────────────────────────────────────────────────────────────────────
  // Seamless language switch
  //
  // The 3-locale architecture (en at /, uk at /uk/, ru at /ru/) exists for
  // SEO — each is a real, fully-rendered HTML file. But naively letting the
  // <a href> links in the language dropdown navigate causes a full reload,
  // which dumps any in-progress analysis (pasted JSON, findings, etc).
  //
  // Strategy:
  //   1. Intercept clicks on .kt-lang-menu-list a
  //   2. Fetch the target locale's HTML
  //   3. Morph in place: walk both DOMs in parallel, copy text/attrs of
  //      *parallel* elements without replacing nodes (preserves bound
  //      handlers and user state in textareas / result panels)
  //   4. Update <html lang>, meta tags, <title>, URL via pushState
  //   5. Fire kt:lang-change so the existing handler re-renders dynamic
  //      chrome (history sidebar, samples list) and re-runs analysis in
  //      the new locale
  //
  // Limitations:
  //   - The inline <head> IIFE that sets the theme-toggle tooltip strings
  //     bakes English/Ukrainian/Russian text at parse time — those
  //     tooltips stay stale until a real reload. Acceptable.
  //   - Open modals stay in the old locale until reopened.
  // ────────────────────────────────────────────────────────────────────
  const LANG_PRESERVE = [
    '#bidReq', '#bidRes', '#simPrice',
    '#authWidget', '#stEntity', '#statusText', '#statusDot',
    '#inspectorBadge', '#crosscheckBadge', '#slotsBadge',
    '#formatBar',
    '#tInspector', '#tCrosscheck', '#tSlots', '#tSummary', '#tRaw',
    '#historyList', '#libList', '#partnersList',
    '#savedSamplesList', '#partnerOptions',
    '#bidReqChars', '#bidResChars',
    '#modalRoot',
    '.toast-container', '#toastRoot',
  ];
  const LANG_SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'TEMPLATE',
  ]);
  // Attributes that may carry locale-specific text or per-locale URLs.
  const LANG_ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'aria-current', 'href'];

  function langShouldPreserve(el) {
    if (!el || !el.matches) return false;
    for (let i = 0; i < LANG_PRESERVE.length; i++) {
      if (el.matches(LANG_PRESERVE[i])) return true;
    }
    return false;
  }

  function langMorphAttrs(curEl, newEl) {
    for (let i = 0; i < LANG_ATTRS.length; i++) {
      const attr = LANG_ATTRS[i];
      const nw = newEl.getAttribute(attr);
      const cur = curEl.getAttribute(attr);
      if (nw !== null && cur !== nw) curEl.setAttribute(attr, nw);
      else if (nw === null && cur !== null) curEl.removeAttribute(attr);
    }
  }

  function langMorphTextSiblings(curEl, newEl) {
    // Update interleaved text nodes (between element children) when structure
    // matches.
    const curText = [];
    const newText = [];
    curEl.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) curText.push(n);
    });
    newEl.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) newText.push(n);
    });
    if (curText.length !== newText.length) return;
    for (let i = 0; i < curText.length; i++) {
      if (curText[i].nodeValue !== newText[i].nodeValue) {
        curText[i].nodeValue = newText[i].nodeValue;
      }
    }
  }

  function langMorph(curEl, newEl) {
    if (!curEl || !newEl) return;
    if (curEl.tagName !== newEl.tagName) return;
    if (LANG_SKIP_TAGS.has(curEl.tagName)) return;
    if (langShouldPreserve(curEl)) return;

    langMorphAttrs(curEl, newEl);

    const curKids = curEl.childNodes;
    const newKids = newEl.childNodes;
    const allText = (nl) => {
      if (nl.length === 0) return false;
      for (let i = 0; i < nl.length; i++) {
        if (nl[i].nodeType !== Node.TEXT_NODE) return false;
      }
      return true;
    };
    if (allText(curKids) && allText(newKids)) {
      if (curEl.textContent !== newEl.textContent) {
        curEl.textContent = newEl.textContent;
      }
      return;
    }

    const curChildren = curEl.children;
    const newChildren = newEl.children;
    if (curChildren.length !== newChildren.length) return;
    for (let i = 0; i < curChildren.length; i++) {
      langMorph(curChildren[i], newChildren[i]);
    }
    langMorphTextSiblings(curEl, newEl);
  }

  function langMorphHead(newDoc) {
    document.title = newDoc.title;
    document.documentElement.lang = newDoc.documentElement.lang || '';

    const newMetas = newDoc.head.querySelectorAll('meta[name], meta[property]');
    newMetas.forEach((nm) => {
      const name = nm.getAttribute('name');
      const prop = nm.getAttribute('property');
      const sel = name ? 'meta[name="' + name + '"]' : 'meta[property="' + prop + '"]';
      const cur = document.head.querySelector(sel);
      if (cur && nm.getAttribute('content') !== null) {
        cur.setAttribute('content', nm.getAttribute('content'));
      }
    });

    const canon = newDoc.head.querySelector('link[rel="canonical"]');
    if (canon) {
      const cur = document.head.querySelector('link[rel="canonical"]');
      if (cur) cur.setAttribute('href', canon.getAttribute('href'));
    }
  }

  async function switchLang(targetUrl, opts) {
    const push = !(opts && opts.push === false);

    // Modals are constructed on-open via t() at fire-time; their already-
    // rendered text doesn't auto-update. Close any open modal so it
    // re-opens (if user re-triggers) in the new locale. This loses any
    // in-progress modal input — acceptable since the user explicitly
    // chose to switch language mid-flow.
    try {
      const modalRoot = document.getElementById('modalRoot');
      if (modalRoot && modalRoot.children.length > 0 && typeof window.closeModal === 'function') {
        window.closeModal();
      }
    } catch (_) {
      /* don't block the swap on modal-close failure */
    }

    try {
      const res = await fetch(targetUrl, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('fetch failed: ' + res.status);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const newLang =
        doc.documentElement.getAttribute('data-lang') ||
        doc.documentElement.lang ||
        'en';

      langMorphHead(doc);
      langMorph(document.body, doc.body);

      document.documentElement.setAttribute('data-lang', newLang);
      try {
        localStorage.setItem('kt-lang', newLang);
      } catch (_) {
        /* ignore quota/disabled */
      }

      if (push) history.pushState({ lang: newLang }, '', targetUrl);

      // Close lang dropdown (the <details> stays open after click otherwise)
      const menu = document.querySelector('.kt-lang-menu');
      if (menu) menu.removeAttribute('open');

      // Re-bind in case the menu got morphed (idempotent — guarded by dataset)
      bindLangLinks();

      // Re-apply theme-toggle tooltip in the new locale (see
      // applyThemeTooltipI18n — the inline <head> IIFE bakes per-locale
      // strings at parse-time and overwrites our tooltip on click).
      applyThemeTooltipI18n();

      // Fires the existing kt:lang-change listener (line ~118), which
      // re-renders dynamic chrome (history, samples) and re-runs analysis
      // so /api/analyze findings come back in the new locale.
      window.dispatchEvent(
        new CustomEvent('kt:lang-change', { detail: { lang: newLang } })
      );
    } catch (e) {
      console.warn('Seamless lang switch failed, falling back to navigation:', e);
      window.location.href = targetUrl;
    }
  }

  function bindLangLinks() {
    document.querySelectorAll('.kt-lang-menu-list a').forEach((a) => {
      if (a.dataset.langSwapBound) return;
      a.dataset.langSwapBound = '1';
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (!href || /^https?:/i.test(href)) return;
        e.preventDefault();
        switchLang(href);
      });
    });
  }

  // Theme-toggle tooltip stays stale after lang swap because the inline
  // <head> IIFE bakes per-locale strings at parse-time and re-applies them
  // on every theme-button click. We override here:
  //   - At init (after i18n.js loaded) we set a localized tooltip
  //   - On every click we re-apply in a microtask, so we run *after* the
  //     IIFE's sync click-handler has clobbered the title
  function applyThemeTooltipI18n() {
    if (typeof window.t !== 'function') return;
    const btn = document.querySelector('.kt-theme-toggle');
    if (!btn) return;
    let saved = null;
    try {
      saved = localStorage.getItem('kt-theme');
    } catch (_) {
      /* storage may be disabled */
    }
    btn.title =
      saved === null
        ? window.t('theme.tooltip.auto')
        : saved === 'light'
          ? window.t('theme.tooltip.light')
          : window.t('theme.tooltip.dark');
  }
  function bindThemeTooltipI18n() {
    const btn = document.querySelector('.kt-theme-toggle');
    if (!btn || btn.dataset.themeTooltipBound) return;
    btn.dataset.themeTooltipBound = '1';
    btn.addEventListener('click', () => {
      Promise.resolve().then(applyThemeTooltipI18n);
    });
    applyThemeTooltipI18n();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindLangLinks();
      bindThemeTooltipI18n();
    });
  } else {
    bindLangLinks();
    bindThemeTooltipI18n();
  }

  // Browser back/forward — re-morph without pushing a new history entry.
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.lang) {
      switchLang(window.location.pathname, { push: false });
    }
  });
})();
