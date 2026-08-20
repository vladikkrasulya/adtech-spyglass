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

  // ── Cabinet-local i18n ────────────────────────────────────────
  // Keys only this controller renders. public/i18n.js exposes
  // registerI18nModule() for exactly this (see its "Per-module i18n
  // registration" block) and is loaded before account.js in
  // account.{en,uk,ru}.html, so the table is merged before first paint.
  //
  // What this replaces: three English literals that reached every locale —
  // pill('muted', 'not configured'), the suggestion engine's 'rules', and a
  // concatenated ' events' in the corpus list — plus 'патернів' used as if a
  // Slavic noun had one plural form.
  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule({
      id: 'cabinet',
      keys: {
        'cabinet.dialects.engine_rules': { en: 'rules', uk: 'правила', ru: 'правила' },
        'cabinet.dialects.export_empty': {
          en: 'Nothing to export yet — create a dialect first.',
          uk: 'Ще нема чого експортувати — спершу створи діалект.',
          ru: 'Пока нечего экспортировать — сначала создай диалект.',
        },
        'cabinet.corpus.event_one': { en: 'event', uk: 'подія', ru: 'событие' },
        'cabinet.corpus.events': { en: 'events', uk: 'події', ru: 'события' },
        'cabinet.corpus.events_many': { en: 'events', uk: 'подій', ru: 'событий' },
        'cabinet.matrix.pattern_one': { en: 'pattern', uk: 'патерн', ru: 'паттерн' },
        'cabinet.matrix.patterns': { en: 'patterns', uk: 'патерни', ru: 'паттерна' },
        'cabinet.matrix.patterns_many': { en: 'patterns', uk: 'патернів', ru: 'паттернов' },
        'cabinet.verify.resend': {
          en: 'send confirmation',
          uk: 'надіслати лист',
          ru: 'отправить письмо',
        },
        'cabinet.verify.sending': { en: 'sending…', uk: 'надсилаємо…', ru: 'отправляем…' },
        'cabinet.verify.sent': { en: 'sent ✓', uk: 'надіслано ✓', ru: 'отправлено ✓' },
        'cabinet.verify.sent_hint': {
          en: 'Confirmation email sent — check your inbox.',
          uk: 'Лист із підтвердженням надіслано — перевір пошту.',
          ru: 'Письмо с подтверждением отправлено — проверь почту.',
        },
        'cabinet.verify.failed': { en: 'not sent', uk: 'не надіслано', ru: 'не отправлено' },
        'cabinet.verify.failed_hint': {
          en: "Couldn't send the confirmation email. Try again later.",
          uk: 'Не вдалось надіслати лист із підтвердженням. Спробуй пізніше.',
          ru: 'Не удалось отправить письмо с подтверждением. Попробуй позже.',
        },
        'cabinet.verify.rate_limited': {
          en: 'too often',
          uk: 'забагато спроб',
          ru: 'слишком часто',
        },
        'cabinet.verify.rate_limited_hint': {
          en: 'Too many requests — the limit is 5 per hour. Try again later.',
          uk: 'Забагато запитів — ліміт 5 на годину. Спробуй пізніше.',
          ru: 'Слишком много запросов — лимит 5 в час. Попробуй позже.',
        },
      },
    });
  }

  function activeLocale() {
    if (typeof window.tLocale === 'function') return window.tLocale();
    const l = document.documentElement.getAttribute('lang');
    return l === 'en' || l === 'ru' || l === 'uk' ? l : 'uk';
  }

  // Mirror of pluralKey() in public/ortbtools.app.js, whose rule is pinned by
  // tests/plural-forms.test.js: Ukrainian and Russian need three forms, and
  // the non-obvious cases are 11-14 (5+ form) and 21 (singular). Copied
  // rather than imported because that file is a browser IIFE with no export
  // surface and the cabinet never loads it; the right end state is one shared
  // /core/plural.js, which is a change to a file this pass does not own.
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
    return n + ' ' + T(pluralKey(n, one, few, many));
  }

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

  // Sortable timestamp for a `created_at` of unknown shape.
  //
  // /api/samples returns created_at as unix-ms NUMBER (e.g. 1787173499000).
  // Sorting used to call `(b.created_at || '').localeCompare(...)`, which a
  // number does not have — so the very first comparison threw TypeError and
  // took the whole cabinet bootstrap down with it. Array.sort skips the
  // comparator for a 0- or 1-element array, which is why the crash only
  // appeared once an account had two saved samples.
  //
  // Other surfaces (and older rows) may still hand us an ISO string, so
  // normalize everything to a number and compare numerically. Unparseable
  // values sort last (0) rather than poisoning the comparison with NaN.
  function timeKey(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const asNumber = Number(v);
    if (v !== true && v !== false && Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(String(v));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Run one card renderer without letting its failure abort the rest of the
  // bootstrap. Before this, a single throwing renderer killed init() — and
  // with it bindSectionRouting(), so the eight cabinet sections all rendered
  // at once and the sidebar stopped switching.
  function safeRender(name, fn) {
    try {
      fn();
    } catch (e) {
      console.error('cabinet: ' + name + ' failed to render', e);
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

  // v8 — User Dialects loader. Returns dialects array or null on failure.
  async function loadDialects() {
    try {
      const r = await api('/api/dialects');
      return r && r.dialects ? r.dialects : [];
    } catch (_e) {
      return null;
    }
  }

  // Blob-download helper for dialect export. Sanitizes filename to
  // avoid path-traversal-ish UX issues from user-chosen dialect names.
  function downloadJson(filename, data) {
    const safe =
      String(filename)
        .replace(/[/\\?%*:|"<>]/g, '_')
        .slice(0, 120) || 'dialect';
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safe.endsWith('.json') ? safe : safe + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // Latest dialect list, shared with the click handler bound once below.
  let exportable = [];

  function renderDialectsCard(dialects) {
    // Null-guarded throughout — future ID drift in account.{lang}.html
    // won't crash init (per spyglass_cabinet_draft.md convention).
    const $stat = document.getElementById('statDialects');
    const $mappings = document.getElementById('statDialectMappings');
    const $defName = document.getElementById('dialectDefault');
    const $llm = document.getElementById('dialectLlm');
    const $btnExport = document.getElementById('btnExportDialects');

    if (!Array.isArray(dialects)) return; // null = load failed; leave '—'
    if ($stat) $stat.textContent = String(dialects.length);
    if ($mappings) {
      const total = dialects.reduce(function (acc, d) {
        return acc + (d.mapping_count || 0);
      }, 0);
      $mappings.textContent = String(total);
    }
    if ($defName) {
      const def = dialects.find(function (d) {
        return d.is_default;
      });
      $defName.textContent = def ? def.name : '—';
    }
    // Keep the legacy DOM id for compatibility; suggestions are deterministic.
    // The word is the value of a translated row ("Suggestion engine"), not an
    // identifier, so it is translated too — it read 'rules' in every locale.
    if ($llm) $llm.textContent = T('cabinet.dialects.engine_rules');

    // "Export all" used to run an empty for-loop on a fresh account: no
    // download, no message, no disabled state — indistinguishable from a
    // broken button. Disable it while there is nothing to export and say why
    // in the tooltip. `exportable` is module-scoped rather than captured by
    // the handler because init() re-runs on kt:lang-change and the handler is
    // bound once, so a captured array would go stale after the first render.
    exportable = dialects;
    if ($btnExport) {
      const empty = dialects.length === 0;
      $btnExport.disabled = empty;
      if (empty) $btnExport.title = T('cabinet.dialects.export_empty');
      else $btnExport.removeAttribute('title');
    }

    if ($btnExport && !$btnExport.dataset.bound) {
      $btnExport.dataset.bound = '1';
      $btnExport.addEventListener('click', async function () {
        if (!exportable.length || $btnExport.disabled) return;
        $btnExport.disabled = true;
        try {
          for (let i = 0; i < exportable.length; i += 1) {
            const d = exportable[i];
            try {
              const data = await api('/api/dialects/' + encodeURIComponent(d.id) + '/export');
              downloadJson(d.name || 'dialect-' + d.id, data);
            } catch (e) {
              console.warn('export failed for dialect', d.id, e);
            }
          }
        } finally {
          $btnExport.disabled = exportable.length === 0;
        }
      });
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
      // The row used to state the problem and offer nothing: the only resend
      // control in the product lives in the inspector's banner, so a user who
      // came straight to the cabinet could read "not verified" and had no way
      // to act on it from the page that reports it. The endpoint already
      // exists (POST /api/auth/verify-email/request, modules/auth/handler.js);
      // this gives it a button next to the pill. The markup is injected here
      // rather than added to account.{en,uk,ru}.html because those files are
      // not owned by this pass — same reason upgradeSignoutAndReset() tags its
      // control at runtime.
      $('profVerified').innerHTML =
        pill('warn', T('cabinet.pill.not_verified')) +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="resend-verification">' +
        escapeHtml(T('cabinet.verify.resend')) +
        '</button>';
    }
    const since = $('profSince');
    if (since) since.textContent = u.created_at ? fmtDate(u.created_at) : '—';
    if (me.encryption && me.encryption.dek_wrapped) {
      $('profCrypto').innerHTML = pill('ok', T('cabinet.pill.enabled'));
    } else {
      $('profCrypto').innerHTML = pill('muted', T('cabinet.pill.not_configured'));
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
      ul.innerHTML = '<li class="cab-empty">' + escapeHtml(T('cabinet.recent.empty')) + '</li>';
      return;
    }
    // Sort by created_at desc, take first 10. created_at is unix-ms — see
    // timeKey() for why this is not a string compare.
    const sorted = samples
      .slice()
      .sort((a, b) => timeKey(b.created_at) - timeKey(a.created_at))
      .slice(0, 10);
    ul.innerHTML = sorted
      .map((s) => {
        // `is_encrypted` is a legacy API marker derived only from req_iv.
        // It signals that an IV was supplied; it is not proof that the body is
        // valid ciphertext (direct API clients are not cryptographically checked).
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
      const sorted = samples.slice().sort((a, b) => timeKey(a.created_at) - timeKey(b.created_at));
      $('insightFirst').textContent = fmtDate(sorted[0].created_at);
      $('insightLast').textContent = fmtDate(sorted[sorted.length - 1].created_at);
    } else {
      $('insightFirst').textContent = '—';
      $('insightLast').textContent = '—';
    }
  }

  // Preferences. Native pressed buttons remain keyboard-operable while the
  // active class and ARIA state mirror the persisted value.
  function setupPreferences() {
    function setRadio(group, key, fallback, applyFn) {
      const root = $(group);
      if (!root) return;
      let current = null;
      try {
        current = localStorage.getItem(key);
      } catch (_e) {
        /* localStorage unavailable — non-fatal */
      }
      if (!current) current = fallback;
      const apply = (val) => {
        root.querySelectorAll('.cab-radio').forEach((el) => {
          const selected = el.dataset[group.replace('pref', '').toLowerCase()] === val;
          el.classList.toggle('active', selected);
          el.setAttribute('aria-pressed', String(selected));
        });
        if (applyFn) applyFn(val);
      };
      apply(current);
      // init() re-runs on kt:lang-change; binding again would stack a second
      // click handler on the same radio group (double localStorage write,
      // double navigation).
      if (root.dataset.prefBound) return;
      root.dataset.prefBound = '1';
      root.addEventListener('click', (ev) => {
        const r = ev.target.closest('.cab-radio');
        if (!r) return;
        const dataKey = group.replace('pref', '').toLowerCase();
        const val = r.dataset[dataKey];
        if (!val) return;
        try {
          localStorage.setItem(key, val);
        } catch (_e) {
          /* localStorage unavailable — non-fatal */
        }
        apply(val);
      });
    }
    // Theme: kt-theme is what the inline IIFE in head reads.
    setRadio('prefTheme', 'kt-theme', 'auto', (val) => {
      try {
        if (val === 'auto') localStorage.removeItem('kt-theme');
        else localStorage.setItem('kt-theme', val);
        // Also mirror to data-theme so live preview updates without reload.
        const eff =
          val === 'auto'
            ? matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : val;
        document.documentElement.setAttribute('data-theme', eff);
      } catch (_e) {
        /* localStorage unavailable — non-fatal */
      }
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
      } catch (_e) {
        /* localStorage unavailable — non-fatal */
      }
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
    // Dialect = the SAME `ortbtools_dialect_v1` key the main app reads.
    // Previously this wrote to `kt-default-dialect` which the main app
    // never consulted (dead-code preference).
    setRadio('prefDialect', 'ortbtools_dialect_v1', 'iab', null);
  }

  // POST /api/auth/verify-email/request deliberately answers 200 with
  // `email_sent: false` when the mailer is misconfigured — the contract
  // comment in modules/auth/handler.js explains why (5xx bodies get replaced
  // by the edge's own error page). So "it returned 200" is not "it was sent",
  // and the three outcomes — sent, not sent, rate-limited (429, 5/hour/IP) —
  // are reported separately instead of all reading as success.
  async function resendVerification(btn) {
    if (btn.disabled) return;
    const restore = T('cabinet.verify.resend');
    btn.disabled = true;
    btn.removeAttribute('title');
    btn.textContent = T('cabinet.verify.sending');
    let key = 'cabinet.verify.failed';
    try {
      const r = await fetch('/api/auth/verify-email/request', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (r.status === 429) {
        key = 'cabinet.verify.rate_limited';
      } else {
        const j = await r.json().catch(() => null);
        if (r.ok && j && j.email_sent) key = 'cabinet.verify.sent';
      }
    } catch (_e) {
      /* network blip — the default failure message already covers it */
    }
    btn.textContent = T(key);
    btn.title = T(key + '_hint');
    // Sent is terminal: the next step is in the user's inbox, not here.
    if (key === 'cabinet.verify.sent') return;
    setTimeout(() => {
      btn.disabled = false;
      btn.removeAttribute('title');
      btn.textContent = restore;
    }, 5000);
  }

  async function signOut(dest) {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_e) {
      /* swallow */
    }
    location.href = dest || '/';
  }

  // "Forgot recovery key? → Sign out and reset" ships in the localized
  // account.{en,uk,ru}.html as a bare <a href="/uk">. It navigates home and
  // does nothing else: the session cookie survives, so the user lands back
  // in the app still signed in while believing a reset has begun.
  //
  // Those files are not owned here, so instead of rewriting the markup we
  // tag the control at runtime and let the existing [data-action] dispatcher
  // do the logout. The match is deliberately structural rather than
  // text-based (the label is translated three ways): the only .btn anchor in
  // #security that points at a locale root. If the markup ever grows a real
  // data-action="signout-and-reset" this is a no-op and the dispatcher
  // branch below handles it directly; if the markup changes shape, nothing
  // matches and behaviour degrades to today's plain link.
  function upgradeSignoutAndReset() {
    const sec = document.getElementById('security');
    if (!sec) return;
    sec.querySelectorAll('a.btn[href]').forEach((a) => {
      if (a.dataset.action) return;
      if (!/^\/(?:uk|ru)?\/?$/.test(a.getAttribute('href') || '')) return;
      a.dataset.action = 'signout-and-reset';
    });
  }

  async function init() {
    const me = await loadMe();
    if (!me) {
      showGate();
      return;
    }
    showBody();
    safeRender('profile', () => setProfile(me));
    safeRender('preferences', () => setupPreferences());
    // Profile is fast — render immediately. The four data calls below are
    // independent; run them in parallel and let each panel render as data
    // arrives.
    const [samples, partners, insights, corpus, matrix, dialects] = await Promise.all([
      loadSamples(),
      loadPartners(),
      loadInsights(),
      loadCorpus(),
      loadMatrix(),
      loadDialects(),
    ]);
    safeRender('dialects', () => renderDialectsCard(dialects));
    // Count the legacy IV-presence marker, not cryptographically verified rows.
    const ivMarkedCount = samples.filter((s) => s.is_encrypted).length;
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
    setText('statEncrypted', ivMarkedCount);
    setText('statAssigned', assignedCount);
    // P1 #15 — when all 4 Library stats are zero (fresh account, nothing
    // saved yet), show a contextual empty-state hint immediately under
    // the stats grid pointing the user at the action. Without it the
    // "0 0 0 0" row reads as a dead end. The hint hides as soon as any
    // metric becomes non-zero.
    const allZero =
      samples.length === 0 && partners.length === 0 && ivMarkedCount === 0 && assignedCount === 0;
    const hint = $('libraryEmptyHint');
    if (hint) hint.hidden = !allZero;
    safeRender('recent', () => setRecent(samples));
    safeRender('library-insights', () => setLibraryInsights(samples, partners));
    safeRender('usage', () => setUsage(insights));
    safeRender('corpus', () => setCorpus(corpus));
    safeRender('matrix', () => setMatrix(matrix));
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
    const totals = matrix && matrix.totals;

    // The summary survives the gate below on purpose: "3 fraud · 0 legitimate"
    // is exactly the number the empty-state hint is asking the reader to
    // change, so hiding it would leave the instruction without its progress.
    if (summaryEl) {
      summaryEl.innerHTML =
        totals && totals.fraud + totals.legitimate > 0
          ? '<span><strong>' +
            totals.fraud +
            '</strong> ' +
            T('corpus.label.fraud') +
            '</span>' +
            ' · <span><strong>' +
            totals.legitimate +
            '</strong> ' +
            T('corpus.label.legitimate') +
            '</span>' +
            ' · <span>' +
            escapeHtml(
              counted(
                totals.patterns,
                'cabinet.matrix.pattern_one',
                'cabinet.matrix.patterns',
                'cabinet.matrix.patterns_many',
              ),
            ) +
            '</span>'
          : '';
    }

    // Both classes, not their sum. matrix.empty promises "at least one
    // legitimate AND one fraud" in all three locales, and the runner needs
    // both to mean anything: with zero legitimate entries lib/corpus-matrix.js
    // computes fp = 0 and tn = totalLegit - fp = 0, so every pattern that
    // fires at all reports precision 100% and FP 0. Reproduced on this stand
    // with 3 fraud / 0 legitimate: behavior.bot.click_burst showed 100%
    // precision on a detector that had never seen a negative example. The
    // pre-fix condition was `fraud + legitimate === 0`, which let that table
    // render and contradicted the very sentence it replaced.
    if (!totals || !totals.fraud || !totals.legitimate) {
      if (tableEl) {
        tableEl.innerHTML = '<div class="matrix-empty">' + T('matrix.empty') + '</div>';
      }
      return;
    }

    if (tableEl) {
      if (!matrix.patterns || matrix.patterns.length === 0) {
        tableEl.innerHTML = '<div class="matrix-empty">' + T('matrix.no_patterns') + '</div>';
        return;
      }
      const header =
        '<div class="matrix-row matrix-head">' +
        '<span class="matrix-cell matrix-id">' +
        T('matrix.col.pattern') +
        '</span>' +
        '<span class="matrix-cell matrix-num" title="True Positive">TP</span>' +
        '<span class="matrix-cell matrix-num" title="False Positive">FP</span>' +
        '<span class="matrix-cell matrix-num" title="False Negative">FN</span>' +
        '<span class="matrix-cell matrix-num" title="True Negative">TN</span>' +
        '<span class="matrix-cell matrix-num">' +
        T('matrix.col.precision') +
        '</span>' +
        '<span class="matrix-cell matrix-num">' +
        T('matrix.col.recall') +
        '</span>' +
        '<span class="matrix-cell matrix-num">F1</span>' +
        '</div>';
      const rows = matrix.patterns
        .map((p) => {
          const cls = colorClassForPrecision(p.precision);
          return (
            '<div class="matrix-row ' +
            cls +
            '">' +
            '<span class="matrix-cell matrix-id" title="' +
            escapeHtml(p.id) +
            '">' +
            escapeHtml(p.id) +
            '</span>' +
            '<span class="matrix-cell matrix-num">' +
            p.tp +
            '</span>' +
            '<span class="matrix-cell matrix-num">' +
            p.fp +
            '</span>' +
            '<span class="matrix-cell matrix-num">' +
            p.fn +
            '</span>' +
            '<span class="matrix-cell matrix-num">' +
            p.tn +
            '</span>' +
            '<span class="matrix-cell matrix-num">' +
            fmtPct(p.precision) +
            '</span>' +
            '<span class="matrix-cell matrix-num">' +
            fmtPct(p.recall) +
            '</span>' +
            '<span class="matrix-cell matrix-num matrix-f1">' +
            fmtPct(p.f1) +
            '</span>' +
            '</div>'
          );
        })
        .join('');
      tableEl.innerHTML = header + rows;
    }
  }
  window.refreshMatrix = async function () {
    setMatrix(await loadMatrix());
  };

  async function loadCorpus() {
    try {
      const r = await api('/api/behavior/corpus');
      return r && r.entries
        ? { entries: r.entries, counts: r.counts }
        : { entries: [], counts: { total: 0 } };
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
        '<strong>' +
        fmt(counts.total) +
        '</strong> ' +
        T('corpus.cabinet.total') +
        '</span>' +
        ' · <span class="corpus-count corpus-count-fraud">' +
        fmt(counts.fraud) +
        ' ' +
        T('corpus.label.fraud') +
        '</span>' +
        ' · <span class="corpus-count corpus-count-legit">' +
        fmt(counts.legitimate) +
        ' ' +
        T('corpus.label.legitimate') +
        '</span>' +
        ' · <span class="corpus-count corpus-count-amb">' +
        fmt(counts.ambiguous) +
        ' ' +
        T('corpus.label.ambiguous') +
        '</span>';
    }

    const list = $('corpusList');
    if (list) {
      if (!entries.length) {
        list.innerHTML = '<div class="corpus-empty">' + T('corpus.cabinet.empty') + '</div>';
      } else {
        // .corpus-row is a 4-column grid (120px 180px 1fr auto). Emit EXACTLY
        // four children, always — source and notes are optional, so they used
        // to make the child count swing between 3 and 5:
        //   - 3 children (no source, no notes) put the × button in the 1fr
        //     track, stretching it into a 456px-wide bar mid-row;
        //   - 5 children pushed the button onto an implicit second row.
        // Wrapping both optional bits in one always-present cell fixes the
        // count. min-width:0 lets the 1fr track shrink below the note's
        // intrinsic width (without it an 800-char note blew the track out to
        // 5289px and carried the × button off-screen, making the entry
        // impossible to delete); overflow-wrap is inherited by the note span
        // so long unbroken text wraps instead of overflowing.
        list.innerHTML = entries
          .map((e) => {
            const labelClass = 'corpus-label-' + e.label;
            const dt = e.createdAt ? fmtDate(e.createdAt) : '—';
            const sourceTag = e.sourceSampleId
              ? '<span class="corpus-source">↳ sample #' + escapeHtml(e.sourceSampleId) + '</span>'
              : '';
            const notes = e.notes
              ? '<span class="corpus-notes" title="' +
                escapeHtml(e.notes) +
                '">' +
                escapeHtml(e.notes) +
                '</span>'
              : '';
            return (
              '<div class="corpus-row">' +
              '<span class="corpus-label-pill ' +
              labelClass +
              '">' +
              T('corpus.label.' + e.label) +
              '</span>' +
              '<span class="corpus-meta">' +
              dt +
              ' · ' +
              escapeHtml(
                counted(
                  e.eventCount || 0,
                  'cabinet.corpus.event_one',
                  'cabinet.corpus.events',
                  'cabinet.corpus.events_many',
                ),
              ) +
              '</span>' +
              '<span class="corpus-detail" style="min-width:0;overflow-wrap:anywhere">' +
              sourceTag +
              notes +
              '</span>' +
              '<button class="btn btn-danger btn-sm corpus-delete-btn" data-action="corpus-delete" data-corpus-id="' +
              escapeHtml(e.id) +
              '" title="' +
              escapeHtml(T('corpus.cabinet.delete_title')) +
              '">×</button>' +
              '</div>'
            );
          })
          .join('');
      }
    }
  }

  // Action delegation
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    if (action === 'signout') {
      ev.preventDefault();
      signOut();
    } else if (action === 'signout-and-reset') {
      // Same destination the link always promised — but the session is
      // actually terminated first, which is the whole point of "reset".
      ev.preventDefault();
      signOut(t.getAttribute('href') || '/');
    } else if (action === 'resend-verification') {
      ev.preventDefault();
      resendVerification(t);
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

  // P1 #14 — Section-only routing. The cabinet used to render every
  // section at once and rely on scroll-spy to highlight whichever one
  // crossed a viewport threshold. The audit flagged this as "sidebar
  // implies tab routing but page renders all sections at once" — users
  // expect Gmail-style settings where clicking a sidebar item swaps
  // the content panel.
  //
  // This rewrite hides every section except the active one. Routing
  // surfaces in the URL hash so:
  //   - deep-links from outside (/account#library) land on the right
  //     section,
  //   - existing in-page anchors that target an element inside a
  //     section (e.g. <a href="#privacy">) still work by finding the
  //     ancestor .cab-section, showing it, then scrolling the inner
  //     element into view,
  //   - browser back/forward navigates between sections.
  //
  // We pushState the hash so back works; updateState on the initial
  // load just paints the hash without adding a history entry.
  let sectionRoutingBound = false;
  function bindSectionRouting() {
    // init() re-runs on kt:lang-change. The lang morph copies text into the
    // existing nodes rather than replacing them, so the listeners and the
    // captured node lists below stay valid — re-binding would only stack a
    // second document-level click handler (double pushState per click).
    if (sectionRoutingBound) return;
    const sections = [...document.querySelectorAll('.cab-section')];
    const navItems = [...document.querySelectorAll('.cab-nav-item')];
    if (!sections.length || !navItems.length) return;
    sectionRoutingBound = true;
    const validSectionIds = new Set(sections.map((s) => s.id));

    // Find the .cab-section ancestor of a given element id (or the
    // element itself if it IS a section). Returns the section id or
    // null. Used so deep-links to inner anchors like #privacy still
    // resolve to a section to show.
    function sectionIdFor(targetId) {
      if (!targetId) return null;
      if (validSectionIds.has(targetId)) return targetId;
      const el = document.getElementById(targetId);
      if (!el) return null;
      const sec = el.closest('.cab-section');
      return sec ? sec.id : null;
    }

    function paintActive(activeId) {
      navItems.forEach((n) => {
        const matches = n.getAttribute('href') === '#' + activeId;
        n.classList.toggle('is-active', matches);
        if (matches) n.setAttribute('aria-current', 'true');
        else n.removeAttribute('aria-current');
      });
    }

    function showSection(activeId, opts) {
      const o = opts || {};
      if (!validSectionIds.has(activeId)) activeId = sections[0].id;
      sections.forEach((s) => {
        s.hidden = s.id !== activeId;
      });
      paintActive(activeId);
      // If the target hash pointed at an inner element (e.g. #privacy
      // inside #activity), scroll it into view after the section
      // becomes visible. Otherwise reset scroll so the user starts at
      // the top of the new section.
      const innerTargetId = o.innerTargetId;
      if (innerTargetId && innerTargetId !== activeId) {
        const inner = document.getElementById(innerTargetId);
        if (inner) {
          requestAnimationFrame(() => {
            inner.scrollIntoView({ behavior: 'instant', block: 'start' });
          });
          return;
        }
      }
      if (o.scrollTop !== false) window.scrollTo({ top: 0, behavior: 'instant' });
    }

    // Click delegation handles both .cab-nav-item AND inner anchors
    // like the "privacy section" link inside Activity, which target an
    // id that lives inside another section.
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest('a[href^="#"]');
      if (!a) return;
      // Skip anchors that are decorative or that the rest of the page
      // owns (none in cabinet yet; defensive).
      const href = a.getAttribute('href') || '';
      const targetId = href.slice(1);
      if (!targetId) return;
      const secId = sectionIdFor(targetId);
      if (!secId) return; // not a cabinet anchor — leave native nav alone
      ev.preventDefault();
      showSection(secId, { innerTargetId: targetId });
      // pushState so browser back/forward steps between sections.
      const newHash = '#' + targetId;
      if (location.hash !== newHash) {
        history.pushState({ cabSection: secId }, '', newHash);
      }
    });

    // popstate (back/forward) re-renders without adding history.
    window.addEventListener('popstate', () => {
      const targetId = location.hash.slice(1);
      const secId = sectionIdFor(targetId) || sections[0].id;
      showSection(secId, { innerTargetId: targetId, scrollTop: !targetId });
    });

    // Initial render — honor hash, fall back to first section.
    const initialTarget = location.hash.slice(1);
    const initialSec = sectionIdFor(initialTarget) || sections[0].id;
    showSection(initialSec, {
      innerTargetId: initialTarget && initialTarget !== initialSec ? initialTarget : null,
    });
  }
  // Bind after init so cabBody is visible (sidebar lives inside cabBody and
  // is hidden until showBody flips display).
  const _origInit = init;
  // eslint-disable-next-line no-func-assign -- intentional decorator pattern: wrap init() to also bind section routing after the original init runs
  init = async function () {
    // `finally`, not a plain sequence: routing is the difference between a
    // usable cabinet and eight sections stacked into one scroll, so it must
    // survive a data-fetch or renderer failure inside init().
    try {
      await _origInit.apply(this, arguments);
    } catch (e) {
      console.error('cabinet: init failed', e);
    } finally {
      safeRender('section-routing', bindSectionRouting);
      safeRender('signout-and-reset', upgradeSignoutAndReset);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // The seamless language switch (lang-switch.js) morphs text out of the
  // freshly-fetched locale document. Every value this file painted — email,
  // member-since, the four Library counters, the heatmap, the recent list —
  // exists in that document only as the placeholder "—" (or "Loading…"), so
  // the morph faithfully copies the placeholder over the live data and the
  // cabinet goes blank. Nodes this file filled with child <span>s (the
  // profile pills, corpus counts, matrix table) are skipped by the morph
  // instead, and stay in the OLD language — so the page ends up both empty
  // and bilingual until a manual reload.
  //
  // Re-running init() repaints everything from the API in the new locale.
  // It is safe to call repeatedly: the renderers are pure overwrites, and
  // the two things that bind listeners (section routing, preferences) are
  // guarded above. window.t reads <html lang>, which lang-switch.js has
  // already updated by the time this event fires.
  window.addEventListener('kt:lang-change', () => {
    init();
  });
})();
