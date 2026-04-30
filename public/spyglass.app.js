/* ============================================================
   Spyglass v8 — OpenRTB inspector tuned for Kadam.net SSP/DSP.
   - Inspector: parses BidRequest, shows imp slots, types, floors
   - Validation: Kadam-aware oRTB + Feed checks (subage, ext.bsection,
     site.ext.idzone, etc.)
   - Diff: deep diff between request and response
   - Kadam reference tab: pasteable templates + macros + field map
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
        toast('Невалідний JSON: ' + e.message, 'error');
      }
    },
    copy(id) {
      const el = $(id);
      if (!el.value) {
        toast('Поле пусте — нічого копіювати', 'error');
        return;
      }
      navigator.clipboard
        .writeText(el.value)
        .then(() => toast('Скопійовано', 'success'))
        .catch(() => toast('Не вдалося скопіювати', 'error'));
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
  };

  window.handleKeydown = function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runAnalysis();
    }
  };

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
      badge.textContent = 'empty';
      badge.className = 'json-badge empty';
      return;
    }
    try {
      JSON.parse(v);
      badge.textContent = 'valid';
      badge.className = 'json-badge valid';
    } catch {
      badge.textContent = 'invalid';
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
      el.innerHTML = '<div class="preview-placeholder">no ad content detected</div>';
      return;
    }
    // Resolve known macros so the preview reflects an actual rendered impression.
    let resolved = String(adm)
      .replace(/\$\{AUCTION_PRICE\}/g, simPrice)
      .replace(/\$\{AUCTION_CURRENCY\}/g, 'USD')
      .replace(/\$\{AUCTION_LOSS\}/g, '0');
    const trimmed = resolved.trim();

    // 1) VAST XML → show as expandable XML preview (video can't render here).
    if (/^<\?xml|<VAST/i.test(trimmed)) {
      el.innerHTML = `
        <div style="padding:var(--space-4);font-family:var(--font-mono);font-size:11px;color:var(--text-muted);overflow:auto;height:100%;width:100%">
          <div class="mono-label" style="margin-bottom:var(--space-2)">vast · video xml</div>
          <pre style="white-space:pre-wrap;word-break:break-word;margin:0;color:var(--text)">${escapeHtml(trimmed.slice(0, 4000))}</pre>
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
  const historyStore = [];

  window.runAnalysis = async function (fromHist) {
    const reqVal = fromHist ? fromHist.req : $('bidReq').value;
    const resVal = fromHist ? fromHist.res : $('bidRes').value;
    if (!reqVal) {
      toast('Встав BidRequest у ліве поле', 'error');
      return;
    }

    const analyzeBtn = $('analyzeBtn');
    if (!fromHist) {
      analyzeBtn.innerHTML = '<span class="spinner"></span> analyzing…';
      analyzeBtn.disabled = true;
    }

    try {
      const req = JSON.parse(reqVal);
      const res = resVal ? JSON.parse(resVal) : {};
      const simP = $('simPrice').value;

      if (!fromHist) {
        $('bidReq').value = JSON.stringify(req, null, 2);
        if (resVal) $('bidRes').value = JSON.stringify(res, null, 2);
        updateCharCount('bidReq');
        if (resVal) updateCharCount('bidRes');
      }

      const entity =
        (req.site || req.app || {}).domain || (req.site || req.app || {}).bundle || 'local-stream';

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
      slotGrid.innerHTML = imps.length
        ? imps
            .map((i, idx) => {
              const types = getSlotType(i);
              const typeHtml =
                '<div class="slot-type-row">' +
                types.map((t) => '<span class="slot-type ' + t + '">' + t + '</span>').join('') +
                '</div>';
              let dims = '';
              if (i.banner && i.banner.w && i.banner.h) dims = i.banner.w + '×' + i.banner.h;
              else if (i.video && i.video.w && i.video.h)
                dims = i.video.w + '×' + i.video.h + ' video';
              return (
                '<div class="slot-card">' +
                typeHtml +
                '<div class="slot-id">' +
                escapeHtml(i.id || 'imp-' + idx) +
                (i.tagid ? ' · ' + escapeHtml(i.tagid) : '') +
                '</div>' +
                (dims ? '<div class="slot-dims">' + dims + '</div>' : '') +
                '<div class="slot-floor"><span class="slot-floor-label">floor</span><span class="slot-floor-value">$' +
                (Number(i.bidfloor) || 0).toFixed(3) +
                '</span></div>' +
                '</div>'
              );
            })
            .join('')
        : '<div class="empty-hint" style="grid-column:1/-1">No impressions found.</div>';

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
        const r = await fetch('api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bidReq: req, bidRes: res }),
        });
        const j = await r.json();
        if (j.success) {
          validation = j.validation;
          cross = j.crosscheck;
          $('stEntity').innerText = entity + ' · ' + (validation.status || '');
        }
      } catch (e) {
        console.warn('Backend unavailable:', e);
        $('stEntity').innerText = entity + ' · local';
        $('statusDot').className = 'status-dot error';
        $('statusText').textContent = 'backend offline';
      }

      // Validation tab — new findings model: { id, level, path, params, specRef, msg }
      const valEl = $('tValidation');
      const findings = validation && (validation.findings || validation.errors); // graceful migration
      if (validation && findings && findings.length) {
        $('validationBadge').textContent = findings.length;
        valEl.innerHTML =
          '<div class="mono-label" style="margin-bottom:var(--space-3)">' +
          escapeHtml(validation.type) +
          ' · ' +
          escapeHtml(humanStatus(validation.status)) +
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
        valEl.innerHTML =
          '<div style="text-align:center;padding:var(--space-7);color:var(--success);font-weight:500;">All checks passed — ' +
          escapeHtml(validation.type) +
          ' is valid.</div>';
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
            ? `<div class="mono-label" style="margin-bottom:var(--space-3)">${crit} critical · ${warn} warning · ${cross.length - crit - warn} ok</div>`
            : `<div class="mono-label" style="color:var(--success);margin-bottom:var(--space-3)">All ${cross.length} crosschecks passed</div>`;
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
          '<div class="empty-hint">Crosscheck needs both Bid Request and Bid Response.</div>';
      } else {
        $('crossBadge').textContent = '—';
      }

      // History
      if (!fromHist) {
        const status = validation ? validation.status : 'local';
        historyStore.unshift({
          req: JSON.stringify(req, null, 2),
          res: resVal ? JSON.stringify(res, null, 2) : '',
          title: entity,
          status,
          time: new Date().toLocaleTimeString(),
        });
        $('hList').innerHTML = historyStore
          .map((e, i) => {
            const cls = e.status === 'errors' || e.status === 'Critical' ? 'critical' : 'healthy';
            return (
              '<div class="history-item" onclick="runAnalysis(historyStore[' +
              i +
              '])">' +
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
              escapeHtml(e.status) +
              '</span>' +
              '</div></div>'
            );
          })
          .join('');
        if (resVal)
          toast(
            'Аналіз завершено · ' + (validation ? humanStatus(validation.status) : 'локально'),
            'success',
          );
      }
    } catch (e) {
      toast('Помилка: ' + e.message, 'error');
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

  // ── Saved samples library (DB-backed) ─────────────────────────
  // partners + samples are stored in spyglass.db. This block owns the left
  // panel "saved" section, the partner filter, and the save/edit/delete modals.
  let _partnerCache = [];
  let _currentSampleId = null;

  async function api(method, url, body) {
    const init = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const r = await fetch(url, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || 'http ' + r.status);
    return j;
  }

  function humanStatus(s) {
    // Canonical (new validator) statuses
    if (s === 'errors') return 'критичні помилки';
    if (s === 'warnings') return 'попередження';
    if (s === 'clean') return 'чисто';
    if (s === 'invalid') return 'невалідний payload';
    // Backward compat with the pre-Phase-1 server (transitional)
    if (s === 'Critical') return 'критичні помилки';
    if (s === 'Healthy') return 'без критичних помилок';
    if (s === 'Invalid') return 'невалідний payload';
    if (s === 'Valid') return 'валідно';
    return s || '';
  }
  window.humanStatus = humanStatus;

  async function refreshPartners() {
    try {
      const j = await api('GET', 'api/partners');
      _partnerCache = j.partners || [];
      const sel = $('partnerFilter');
      const cur = sel.value;
      sel.innerHTML =
        '<option value="">усі партнери</option>' +
        '<option value="unassigned">— без партнера —</option>' +
        _partnerCache
          .map((p) => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>')
          .join('');
      if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    } catch (e) {
      toast('Не вдалося завантажити список партнерів: ' + e.message, 'error');
    }
  }

  async function refreshSamples() {
    const sel = $('partnerFilter');
    const v = sel.value;
    const qs = v === '' ? '' : '?partner_id=' + encodeURIComponent(v);
    try {
      const j = await api('GET', 'api/samples' + qs);
      const list = j.samples || [];
      const el = $('savedList');
      if (!list.length) {
        el.innerHTML = '<div class="saved-empty">Збережених запитів ще немає</div>';
        return;
      }
      const partnerName = (id) => {
        if (id == null) return 'без партнера';
        const p = _partnerCache.find((x) => x.id === id);
        return p ? p.name : 'партнер #' + id;
      };
      el.innerHTML = list
        .map((s) => {
          const pieces = [];
          if (s.req_len) pieces.push('req ' + Math.round(s.req_len / 1024) + 'k');
          if (s.res_len) pieces.push('res ' + Math.round(s.res_len / 1024) + 'k');
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
      toast('Не вдалося завантажити запити: ' + e.message, 'error');
    }
  }

  function closeModal() {
    $('modalRoot').innerHTML = '';
  }

  function partnerOptionsHtml(selectedId) {
    return (
      '<option value="">— без партнера —</option>' +
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
    const reqVal = $('bidReq').value || '';
    const resVal = $('bidRes').value || '';
    if (!reqVal.trim() && !resVal.trim()) {
      toast('Нічого зберігати — обидва поля порожні', 'error');
      return;
    }
    const guess = (() => {
      try {
        const j = JSON.parse(reqVal);
        return j.id || j.site?.domain || j.app?.bundle || 'sample';
      } catch {
        return 'sample';
      }
    })();
    const sel = $('partnerFilter');
    const presetPartner = sel && sel.value && sel.value !== 'unassigned' ? Number(sel.value) : null;
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card">' +
      '<div class="modal-title">зберегти запит</div>' +
      '<div class="modal-row"><label>назва</label><input id="mTitle" type="text" value="' +
      escapeHtml(String(guess)) +
      '"></div>' +
      '<div class="modal-row"><label>партнер</label><select id="mPartner">' +
      partnerOptionsHtml(presetPartner) +
      '</select></div>' +
      '<div class="modal-row"><label>нотатки (необовʼязково)</label><textarea id="mNotes"></textarea></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()">скасувати</button>' +
      '<button class="btn btn-primary btn-sm" onclick="confirmSave()">зберегти</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    setTimeout(() => $('mTitle').focus(), 0);
  };

  window.confirmSave = async function () {
    const title = $('mTitle').value.trim() || 'sample';
    const partnerId = $('mPartner').value || null;
    const notes = $('mNotes').value.trim();
    const bid_req = $('bidReq').value || '';
    const bid_res = $('bidRes').value || '';
    let status = '';
    try {
      const r = await fetch('api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidReq: bid_req ? JSON.parse(bid_req) : {},
          bidRes: bid_res ? JSON.parse(bid_res) : {},
        }),
      });
      const j = await r.json();
      if (j.success && j.validation) status = j.validation.status || '';
    } catch (_) {
      /* status optional */
    }
    try {
      await api('POST', 'api/samples', {
        partner_id: partnerId ? Number(partnerId) : null,
        title,
        bid_req,
        bid_res,
        status,
        notes,
      });
      closeModal();
      toast('Збережено · ' + title, 'success');
      refreshSamples();
    } catch (e) {
      toast('Не вдалося зберегти: ' + e.message, 'error');
    }
  };

  window.loadSample = async function (id) {
    try {
      const j = await api('GET', 'api/samples/' + id);
      const s = j.sample;
      $('bidReq').value = s.bid_req || '';
      $('bidRes').value = s.bid_res || '';
      updateCharCount('bidReq');
      updateCharCount('bidRes');
      _currentSampleId = s.id;
      toast('Завантажено · ' + s.title, 'success');
    } catch (e) {
      toast('Не вдалося завантажити: ' + e.message, 'error');
    }
  };

  window.deleteSample = async function (id) {
    if (!confirm('Видалити цей запит з бібліотеки?')) return;
    try {
      await api('DELETE', 'api/samples/' + id);
      refreshSamples();
    } catch (e) {
      toast('Не вдалося видалити: ' + e.message, 'error');
    }
  };

  window.editSample = async function (id) {
    try {
      const j = await api('GET', 'api/samples/' + id);
      const s = j.sample;
      $('modalRoot').innerHTML =
        '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
        '<div class="modal-card">' +
        '<div class="modal-title">редагувати запит</div>' +
        '<div class="modal-row"><label>назва</label><input id="mTitle" type="text" value="' +
        escapeHtml(s.title) +
        '"></div>' +
        '<div class="modal-row"><label>партнер</label><select id="mPartner">' +
        partnerOptionsHtml(s.partner_id) +
        '</select></div>' +
        '<div class="modal-row"><label>нотатки</label><textarea id="mNotes">' +
        escapeHtml(s.notes || '') +
        '</textarea></div>' +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="closeModal()">скасувати</button>' +
        '<button class="btn btn-primary btn-sm" onclick="confirmEdit(' +
        s.id +
        ')">зберегти</button>' +
        '</div>' +
        '</div>' +
        '</div>';
      setTimeout(() => $('mTitle').focus(), 0);
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
      closeModal();
      refreshSamples();
    } catch (e) {
      toast('Не вдалося зберегти зміни: ' + e.message, 'error');
    }
  };

  function partnerListHtml() {
    if (!_partnerCache.length) return '<div class="saved-empty">Партнерів ще немає</div>';
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
      '<div class="modal-title">партнери</div>' +
      '<div id="pList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:var(--space-3);max-height:240px;overflow-y:auto">' +
      partnerListHtml() +
      '</div>' +
      '<div class="modal-row"><label>додати нового</label><input id="pName" type="text" placeholder="наприклад Kadam, BidMachine"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()">закрити</button>' +
      '<button class="btn btn-primary btn-sm" onclick="confirmAddPartner()">додати</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    setTimeout(() => $('pName').focus(), 0);
  };

  window.confirmAddPartner = async function () {
    const name = $('pName').value.trim();
    if (!name) return;
    try {
      await api('POST', 'api/partners', { name });
      await refreshPartners();
      $('pList').innerHTML = partnerListHtml();
      $('pName').value = '';
      refreshSamples();
    } catch (e) {
      toast('Не вдалося додати партнера: ' + e.message, 'error');
    }
  };

  window.deletePartner = async function (id) {
    if (
      !confirm(
        'Видалити цього партнера? Запити що були з ним повʼязані стануть "без партнера" (не видаляються).',
      )
    )
      return;
    try {
      await api('DELETE', 'api/partners/' + id);
      await refreshPartners();
      $('pList').innerHTML = partnerListHtml();
      refreshSamples();
    } catch (e) {
      toast('Не вдалося видалити партнера: ' + e.message, 'error');
    }
  };

  window.closeModal = closeModal;

  // ── Init ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    renderReference();
    updateCharCount('bidReq');
    updateCharCount('bidRes');
    await refreshPartners();
    refreshSamples();
  });
  window.refreshSamples = refreshSamples;
})();
