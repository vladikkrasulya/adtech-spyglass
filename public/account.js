/* ============================================================
   account.js — personal cabinet controller.

   Lightweight: no app-level deps (lang-switch, version, i18n
   load before this script). Purpose: fetch /api/auth/me, gate
   anon vs authed; if authed, populate profile + samples count
   + partners count + recent samples list.

   Encrypted samples remain encrypted on this page — the cabinet
   does NOT decrypt them. Decryption happens in the main app
   (which has the unlock modal + DEK in memory). The cabinet is
   a metadata view: it tells the user what's there, not the
   contents.
   ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const T = (k, p) => (typeof window.t === 'function' ? window.t(k, p) : k);

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pill(kind, label) {
    return '<span class="cab-pill ' + kind + '">' + escapeHtml(label) + '</span>';
  }

  function fmtDate(s) {
    if (s == null || s === '') return '—';
    try {
      // Accept either ISO string or unix-ms number (the analyze_log returns ms).
      const d = typeof s === 'number' ? new Date(s) : new Date(s);
      if (isNaN(d.getTime())) return '—';
      return d.toISOString().slice(0, 10);
    } catch (_e) {
      return '—';
    }
  }

  // "{key}={n}" pairs joined into a compact one-line summary, sorted by n DESC.
  // Used for byVersion / byFormat / byStatus aggregates.
  function distLine(obj, opts) {
    const o = opts || {};
    const entries = Object.entries(obj || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, o.max || 6);
    if (!entries.length) return '—';
    return entries.map(([k, n]) => escapeHtml(k) + '·' + n).join(' / ');
  }

  async function api(path, opts) {
    const r = await fetch(path, opts || {});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function loadMe() {
    try {
      const r = await api('/api/auth/me');
      return r.user ? { user: r.user, encryption: r.encryption } : null;
    } catch (_e) {
      return null;
    }
  }

  async function loadSamples() {
    try {
      const r = await api('/api/samples');
      return Array.isArray(r) ? r : r.samples || [];
    } catch (_e) {
      return [];
    }
  }

  async function loadPartners() {
    try {
      const r = await api('/api/partners');
      return Array.isArray(r) ? r : r.partners || [];
    } catch (_e) {
      return [];
    }
  }

  async function loadInsights() {
    try {
      const r = await api('/api/account/insights');
      return r && r.insights ? r.insights : null;
    } catch (_e) {
      return null;
    }
  }

  function showGate() {
    $('cabGate').style.display = '';
    $('cabBody').style.display = 'none';
  }

  function showBody() {
    $('cabGate').style.display = 'none';
    $('cabBody').style.display = '';
  }

  function setProfile(me) {
    const u = me.user;
    $('profEmail').textContent = u.email || '—';
    if (u.email_verified_at) {
      $('profVerified').innerHTML = pill('ok', T('cabinet.pill.verified'));
    } else {
      $('profVerified').innerHTML = pill('warn', T('cabinet.pill.not_verified'));
    }
    const since = $('profSince');
    if (since) since.textContent = u.created_at ? fmtDate(u.created_at) : '—';
    if (me.encryption && me.encryption.dek_wrapped) {
      $('profCrypto').innerHTML = pill('ok', T('cabinet.pill.enabled'));
    } else {
      $('profCrypto').innerHTML = pill('muted', 'not configured');
    }
    const recovery = $('profRecovery');
    if (recovery) {
      if (me.encryption && me.encryption.recovery_configured) {
        recovery.innerHTML = pill('ok', T('cabinet.pill.configured'));
      } else if (me.encryption) {
        recovery.innerHTML = pill('warn', T('cabinet.pill.not_configured'));
      } else {
        recovery.innerHTML = pill('muted', '—');
      }
    }
  }

  function setRecent(samples) {
    const ul = $('recentList');
    if (!samples.length) {
      ul.innerHTML =
        '<li class="cab-empty">' + escapeHtml(T('cabinet.recent.empty')) + '</li>';
      return;
    }
    // Sort by created_at desc, take first 10
    const sorted = samples
      .slice()
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 10);
    ul.innerHTML = sorted
      .map((s) => {
        const enc = s.is_encrypted
          ? pill('ok', T('cabinet.pill.encrypted'))
          : pill('muted', T('cabinet.pill.plain'));
        return (
          '<li>' +
          '<div style="display:flex;flex-direction:column;gap:2px;min-width:0">' +
          '<span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          escapeHtml(s.title || T('cabinet.untitled')) +
          '</span>' +
          '<span style="font-size:var(--fs-xs);color:var(--text-muted);font-family:var(--font-mono)">#' +
          escapeHtml(s.id) +
          ' · ' +
          fmtDate(s.created_at) +
          '</span>' +
          '</div>' +
          '<span>' +
          enc +
          '</span>' +
          '</li>'
        );
      })
      .join('');
  }

  function setUsage(insights) {
    if (!insights) {
      // /api/account/insights failed or empty — keep dashes; don't crash.
      return;
    }
    $('usageTotal').textContent = insights.total || 0;
    $('usageLast7').textContent = insights.last7 || 0;
    $('usageLast30').textContent = insights.last30 || 0;
    $('usageFindings').textContent = (insights.sums && insights.sums.findings) || 0;
    $('usageFirst').textContent = fmtDate(insights.first_at);
    $('usageLast').textContent = fmtDate(insights.last_at);

    // Status mix as a colored bar + textual summary.
    const bs = insights.byStatus || {};
    const total = insights.total || 0;
    if (total > 0) {
      const clean = bs.clean || 0;
      const warns = bs.warnings || 0;
      const errs = bs.errors || 0;
      const other = total - clean - warns - errs;
      // Three-way Math.round can sum to 99% or 101%. Compute the first
      // three normally and force the last segment to absorb any rounding
      // delta so the bar always fills exactly 100%.
      const pctC = Math.round((clean / total) * 100);
      const pctW = Math.round((warns / total) * 100);
      const pctE = Math.round((errs / total) * 100);
      const pctO = Math.max(0, 100 - pctC - pctW - pctE);
      $('usageStatusMix').innerHTML =
        pill('ok', T('cabinet.status.clean_pct', { pct: pctC })) +
        ' ' +
        pill('warn', T('cabinet.status.warn_pct', { pct: pctW })) +
        ' ' +
        pill('danger', T('cabinet.status.err_pct', { pct: pctE }));
      const bar = $('usageStatusBar');
      bar.style.display = '';
      $('barClean').style.width = pctC + '%';
      $('barWarn').style.width = pctW + '%';
      $('barErr').style.width = pctE + '%';
      $('barOther').style.width = pctO + '%';
    } else {
      $('usageStatusMix').textContent = T('cabinet.no_analyses');
    }

    $('usageVersions').innerHTML = distLine(insights.byVersion);
    $('usageFormats').innerHTML = distLine(insights.byFormat);

    // 30-day heatmap. Build a 30-cell grid keyed by date.
    const heatmap = $('usageHeatmap');
    if (!heatmap) return;
    // Empty state: show a friendly hint instead of 30 grey squares so a
    // brand-new user understands the heatmap will populate over time.
    if (!insights.last30) {
      heatmap.classList.add('heatmap--empty');
      heatmap.style.display = 'block';
      heatmap.style.fontStyle = 'italic';
      heatmap.style.color = 'var(--text-muted)';
      heatmap.style.fontSize = 'var(--fs-sm)';
      heatmap.textContent = T('cabinet.heatmap.empty');
      return;
    }
    // Make sure styles are reset if we previously showed the empty hint.
    heatmap.classList.remove('heatmap--empty');
    heatmap.style.display = '';
    heatmap.style.fontStyle = '';
    heatmap.style.color = '';
    heatmap.style.fontSize = '';
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const cells = [];
    const activity = insights.activity || [];
    const byDate = activity.reduce((acc, a) => {
      acc[a.date] = a.n;
      return acc;
    }, {});
    const max = activity.reduce((m, a) => Math.max(m, a.n), 0) || 1;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const n = byDate[iso] || 0;
      let level = 0;
      if (n > 0) {
        const ratio = n / max;
        if (ratio > 0.75) level = 4;
        else if (ratio > 0.5) level = 3;
        else if (ratio > 0.25) level = 2;
        else level = 1;
      }
      cells.push(
        '<div class="cell ' +
          (level ? 'l' + level : '') +
          '" title="' +
          escapeHtml(T('cabinet.heatmap.tooltip', { date: iso, n })) +
          '"></div>',
      );
    }
    heatmap.innerHTML = cells.join('');
  }

  function setLibraryInsights(samples, partners) {
    // Status distribution from saved-sample status field (clean/warnings/errors).
    const byStatus = samples.reduce((acc, s) => {
      const k = s.status || 'unknown';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    $('insightStatusValue').innerHTML = distLine(byStatus);

    // Top 3 partners by sample count.
    const partnerCount = {};
    for (const s of samples) {
      const pid = s.partner_id;
      if (pid != null) partnerCount[pid] = (partnerCount[pid] || 0) + 1;
    }
    const partnerName = (id) => {
      const p = partners.find((x) => x.id === id);
      return p ? p.name : 'partner #' + id;
    };
    const topPartners = Object.entries(partnerCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, n]) => escapeHtml(partnerName(Number(id))) + '·' + n);
    $('insightTopPartners').innerHTML = topPartners.length ? topPartners.join(' / ') : '—';

    // Date range of saved samples.
    if (samples.length) {
      const sorted = samples
        .slice()
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      $('insightFirst').textContent = fmtDate(sorted[0].created_at);
      $('insightLast').textContent = fmtDate(sorted[sorted.length - 1].created_at);
    } else {
      $('insightFirst').textContent = '—';
      $('insightLast').textContent = '—';
    }
  }

  // Preferences (localStorage-only). Read on init, click-to-toggle.
  function setupPreferences() {
    function setRadio(group, key, fallback, applyFn) {
      const root = $(group);
      if (!root) return;
      let current = null;
      try {
        current = localStorage.getItem(key);
      } catch (_e) {}
      if (!current) current = fallback;
      const apply = (val) => {
        root.querySelectorAll('.cab-radio').forEach((el) => {
          el.classList.toggle('active', el.dataset[group.replace('pref', '').toLowerCase()] === val);
        });
        if (applyFn) applyFn(val);
      };
      apply(current);
      root.addEventListener('click', (ev) => {
        const r = ev.target.closest('.cab-radio');
        if (!r) return;
        const dataKey = group.replace('pref', '').toLowerCase();
        const val = r.dataset[dataKey];
        if (!val) return;
        try {
          localStorage.setItem(key, val);
        } catch (_e) {}
        apply(val);
      });
    }
    // Theme: kt-theme is what the inline IIFE in head reads.
    setRadio('prefTheme', 'kt-theme', 'auto', (val) => {
      try {
        if (val === 'auto') localStorage.removeItem('kt-theme');
        else localStorage.setItem('kt-theme', val);
        // Also mirror to data-theme so live preview updates without reload.
        const eff = val === 'auto'
          ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : val;
        document.documentElement.setAttribute('data-theme', eff);
      } catch (_e) {}
    });
    // Findings locale = the SAME `kt-lang` key the main app + i18n.js read.
    // Picking here behaves like picking from the lang menu — write cookie
    // + localStorage + (auth-only) POST preferences for cross-device.
    // Previously this wrote to `kt-default-findings-locale` which no
    // consumer ever read (dead-code preference).
    setRadio('prefLocale', 'kt-lang', 'en', (val) => {
      const currentLang = document.documentElement.getAttribute('data-lang') || 'en';
      // Pre-v0.24.0 the picker only wrote cookie + localStorage + POSTed
      // preferences but the page itself stayed in the old locale — user saw
      // their pick "store" but no UI feedback. Now: navigate to the
      // localized cabinet path (the lang-switch.js seamless morph would
      // also work, but cabinet has its own bootstrap that's simpler to
      // re-run via a real navigation).
      try {
        const isHttps = location.protocol === 'https:';
        document.cookie =
          'kt-lang=' +
          encodeURIComponent(val) +
          '; Path=/; Max-Age=31536000; SameSite=Lax' +
          (isHttps ? '; Secure' : '');
      } catch (_e) {}
      // Best-effort cross-device persistence — auth-gated on server side.
      fetch('/api/auth/preferences', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: val }),
      }).catch(() => {});
      // Trigger reload only if locale actually changed.
      if (val !== currentLang) {
        const target = val === 'en' ? '/account' : '/' + val + '/account';
        location.href = target;
      }
    });
    // Dialect = the SAME `spyglass_dialect_v1` key the main app reads.
    // Previously this wrote to `kt-default-dialect` which the main app
    // never consulted (dead-code preference).
    setRadio('prefDialect', 'spyglass_dialect_v1', 'iab', null);
  }

  async function signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_e) {
      /* swallow */
    }
    location.href = '/';
  }

  async function init() {
    const me = await loadMe();
    if (!me) {
      showGate();
      return;
    }
    showBody();
    setProfile(me);
    setupPreferences();
    // Profile is fast — render immediately. The four data calls below are
    // independent; run them in parallel and let each panel render as data
    // arrives.
    const [samples, partners, insights, corpus, matrix] = await Promise.all([
      loadSamples(),
      loadPartners(),
      loadInsights(),
      loadCorpus(),
      loadMatrix(),
    ]);
    // Compute encrypted/assigned counts from sample metadata.
    const encryptedCount = samples.filter((s) => s.is_encrypted).length;
    const assignedCount = samples.filter((s) => s.partner_id != null).length;
    // Defensive guards — Profile + Library cards may be in display:none until
    // setProfile() flipped showBody(). querySelector returning null on a
    // missing id (e.g. stale localized HTML) used to crash the entire init,
    // leaving Activity/Insights/Recent silently blank with a console error.
    // Now each setter probes the element first and skips quietly if absent.
    const setText = (id, val) => {
      const el = $(id);
      if (el) el.textContent = val;
    };
    setText('statSamples', samples.length);
    setText('statPartners', partners.length);
    setText('statEncrypted', encryptedCount);
    setText('statAssigned', assignedCount);
    setRecent(samples);
    setLibraryInsights(samples, partners);
    setUsage(insights);
    setCorpus(corpus);
    setMatrix(matrix);
  }

  // Refresh corpus card after delete (no full re-init needed). Also
  // re-fetch matrix since deletes invalidate the precision/recall counts.
  window.refreshCorpus = async function () {
    const [corpus, matrix] = await Promise.all([loadCorpus(), loadMatrix()]);
    setCorpus(corpus);
    setMatrix(matrix);
  };

  async function loadMatrix() {
    try {
      const r = await api('/api/behavior/corpus/matrix');
      return r && r.matrix ? r.matrix : null;
    } catch (_e) {
      return null;
    }
  }

  function fmtPct(x) {
    if (x == null) return '—';
    return (x * 100).toFixed(0) + '%';
  }

  function colorClassForPrecision(p) {
    if (p == null) return 'matrix-na';
    if (p >= 0.9) return 'matrix-good';
    if (p >= 0.6) return 'matrix-mid';
    return 'matrix-bad';
  }

  function setMatrix(matrix) {
    const card = $('cabMatrix');
    if (!card) return;
    const T = window.t || ((k) => k);

    const summaryEl = $('matrixSummary');
    const tableEl = $('matrixTable');
    if (!matrix || !matrix.totals || matrix.totals.fraud + matrix.totals.legitimate === 0) {
      if (summaryEl) summaryEl.innerHTML = '';
      if (tableEl) {
        tableEl.innerHTML =
          '<div class="matrix-empty">' + T('matrix.empty') + '</div>';
      }
      return;
    }

    if (summaryEl) {
      summaryEl.innerHTML =
        '<span><strong>' + matrix.totals.fraud + '</strong> ' + T('corpus.label.fraud') + '</span>' +
        ' · <span><strong>' + matrix.totals.legitimate + '</strong> ' + T('corpus.label.legitimate') + '</span>' +
        ' · <span>' + matrix.totals.patterns + ' ' + T('matrix.summary.patterns') + '</span>';
    }

    if (tableEl) {
      if (!matrix.patterns || matrix.patterns.length === 0) {
        tableEl.innerHTML =
          '<div class="matrix-empty">' + T('matrix.no_patterns') + '</div>';
        return;
      }
      const header =
        '<div class="matrix-row matrix-head">' +
        '<span class="matrix-cell matrix-id">' + T('matrix.col.pattern') + '</span>' +
        '<span class="matrix-cell matrix-num" title="True Positive">TP</span>' +
        '<span class="matrix-cell matrix-num" title="False Positive">FP</span>' +
        '<span class="matrix-cell matrix-num" title="False Negative">FN</span>' +
        '<span class="matrix-cell matrix-num" title="True Negative">TN</span>' +
        '<span class="matrix-cell matrix-num">' + T('matrix.col.precision') + '</span>' +
        '<span class="matrix-cell matrix-num">' + T('matrix.col.recall') + '</span>' +
        '<span class="matrix-cell matrix-num">F1</span>' +
        '</div>';
      const rows = matrix.patterns.map((p) => {
        const cls = colorClassForPrecision(p.precision);
        return '<div class="matrix-row ' + cls + '">' +
          '<span class="matrix-cell matrix-id" title="' + escapeHtml(p.id) + '">' +
          escapeHtml(p.id) + '</span>' +
          '<span class="matrix-cell matrix-num">' + p.tp + '</span>' +
          '<span class="matrix-cell matrix-num">' + p.fp + '</span>' +
          '<span class="matrix-cell matrix-num">' + p.fn + '</span>' +
          '<span class="matrix-cell matrix-num">' + p.tn + '</span>' +
          '<span class="matrix-cell matrix-num">' + fmtPct(p.precision) + '</span>' +
          '<span class="matrix-cell matrix-num">' + fmtPct(p.recall) + '</span>' +
          '<span class="matrix-cell matrix-num matrix-f1">' + fmtPct(p.f1) + '</span>' +
          '</div>';
      }).join('');
      tableEl.innerHTML = header + rows;
    }
  }
  window.refreshMatrix = async function () {
    setMatrix(await loadMatrix());
  };

  async function loadCorpus() {
    try {
      const r = await api('/api/behavior/corpus');
      return r && r.entries ? { entries: r.entries, counts: r.counts } : { entries: [], counts: { total: 0 } };
    } catch (_e) {
      return { entries: [], counts: { total: 0 } };
    }
  }

  function setCorpus(data) {
    const card = $('cabCorpus');
    if (!card) return;
    const counts = (data && data.counts) || { total: 0, fraud: 0, legitimate: 0, ambiguous: 0 };
    const entries = (data && data.entries) || [];
    const T = window.t || ((k) => k);
    const fmt = (n) => String(n);

    const summaryEl = $('corpusCounts');
    if (summaryEl) {
      summaryEl.innerHTML =
        '<span class="corpus-count corpus-count-total">' +
          '<strong>' + fmt(counts.total) + '</strong> ' +
          T('corpus.cabinet.total') + '</span>' +
        ' · <span class="corpus-count corpus-count-fraud">' +
          fmt(counts.fraud) + ' ' + T('corpus.label.fraud') + '</span>' +
        ' · <span class="corpus-count corpus-count-legit">' +
          fmt(counts.legitimate) + ' ' + T('corpus.label.legitimate') + '</span>' +
        ' · <span class="corpus-count corpus-count-amb">' +
          fmt(counts.ambiguous) + ' ' + T('corpus.label.ambiguous') + '</span>';
    }

    const list = $('corpusList');
    if (list) {
      if (!entries.length) {
        list.innerHTML = '<div class="corpus-empty">' + T('corpus.cabinet.empty') + '</div>';
      } else {
        list.innerHTML = entries.map((e) => {
          const labelClass = 'corpus-label-' + e.label;
          const dt = e.createdAt ? fmtDate(e.createdAt) : '—';
          const sourceTag = e.sourceSampleId
            ? '<span class="corpus-source">↳ sample #' + e.sourceSampleId + '</span>'
            : '';
          const notes = e.notes
            ? '<span class="corpus-notes">' + escapeHtml(e.notes) + '</span>'
            : '';
          return '<div class="corpus-row">' +
            '<span class="corpus-label-pill ' + labelClass + '">' +
            T('corpus.label.' + e.label) + '</span>' +
            '<span class="corpus-meta">' + dt + ' · ' +
            (e.eventCount || 0) + ' events</span>' +
            sourceTag + notes +
            '<button class="btn btn-ghost btn-sm corpus-delete-btn" data-action="corpus-delete" data-corpus-id="' + e.id + '" title="' + T('corpus.cabinet.delete_title') + '">×</button>' +
            '</div>';
        }).join('');
      }
    }
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  // Action delegation
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    if (action === 'signout') {
      ev.preventDefault();
      signOut();
    } else if (action === 'forgot-password') {
      ev.preventDefault();
      // Send the user back to the main app and trigger forgot-password modal.
      // The /?reset=1 hint can be handled by the main app on load. For now,
      // simplest: just open the home page where the auth widget lives.
      location.href = '/?forgot=1';
    } else if (action === 'corpus-delete') {
      ev.preventDefault();
      const id = Number(t.dataset.corpusId);
      if (!id) return;
      const T = window.t || ((k) => k);
      if (!confirm(T('confirm.corpus_delete'))) return;
      fetch('/api/behavior/corpus/' + id, { method: 'DELETE' })
        .then((r) => r.json())
        .then((j) => {
          if (!j.success) throw new Error(j.error || 'delete_failed');
          window.refreshCorpus && window.refreshCorpus();
        })
        .catch((err) => alert(T('toast.corpus_delete_failed', { error: err.message })));
    } else if (action === 'corpus-matrix-refresh') {
      ev.preventDefault();
      window.refreshMatrix && window.refreshMatrix();
    }
  });

  // Scroll-spy: highlight active sidebar item as the user scrolls past
  // each section. IntersectionObserver fires when a section enters the
  // configured rootMargin band; we toggle .is-active on its corresponding
  // nav link. rootMargin '-20% 0px -70% 0px' means a section becomes
  // active when its top crosses 20% from the viewport top — felt right
  // for a tall cabinet where users dwell on the visible-mid region.
  function bindScrollSpy() {
    const sections = document.querySelectorAll('.cab-section');
    const navItems = document.querySelectorAll('.cab-nav-item');
    if (!sections.length || !navItems.length) return;
    const setActive = (id) => {
      navItems.forEach((n) => {
        n.classList.toggle('is-active', n.getAttribute('href') === '#' + id);
      });
    };
    const obs = new IntersectionObserver(
      (entries) => {
        // Pick the topmost-intersecting section as the active one. This
        // avoids flicker when the user scrolls fast and multiple sections
        // briefly intersect at once.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    sections.forEach((s) => obs.observe(s));

    // Click on a nav link → smooth-scroll to the target. Native href="#id"
    // already navigates; we just make it smooth + update URL hash for share.
    navItems.forEach((n) => {
      n.addEventListener('click', (ev) => {
        const id = (n.getAttribute('href') || '').replace('#', '');
        const target = document.getElementById(id);
        if (!target) return;
        ev.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', '#' + id);
        setActive(id);
      });
    });

    // Honor an initial hash (deep-link from share / refresh).
    if (location.hash) {
      const id = location.hash.replace('#', '');
      const target = document.getElementById(id);
      if (target) {
        // Defer to next frame so layout has settled.
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: 'instant', block: 'start' });
          setActive(id);
        });
      }
    }
  }
  // Bind after init so cabBody is visible (sidebar lives inside cabBody and
  // is hidden until showBody flips display).
  const _origInit = init;
  init = async function () {
    await _origInit.apply(this, arguments);
    bindScrollSpy();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
