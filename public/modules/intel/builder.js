/* ============================================================
   public/modules/intel/builder.js — Dialect Builder modal.

   Phase 7b. Activated by clicking the bottom-right Discovery chip 🧬.
   Surfaces the field-observation index + cluster suggestions, lets the
   user pick fields with checkboxes, name the dialect, and persist it
   to IndexedDB. The runtime in temp-runtime.js then applies the
   resulting spec on every analyze.

   UX rules (per Phase 7 R&D doc):
     - Show clusters at the top — pre-cooked candidates the user can
       accept with one click. ALL boxes start UNCHECKED so the user
       has to make an affirmative selection before "Create" enables.
     - Below clusters, the full field list grouped by bucket. Each row
       shows path, occurrence count, decayed score, charClass hint.
     - Required-vs-optional toggle is per-field (radio buttons). For
       7b foundation we default everything to required: false; the
       user explicitly upgrades to required.
     - Cancel = no persist. Create = persist + auto-activate as the
       current dialect (so the user sees findings on their next
       analyze without an extra step).

   What this module deliberately does NOT do for 7b:
     - Edit existing temp dialects (manage list lives in 7c)
     - Configure claimsBid (security-sensitive, needs explicit warning UI)
     - Per-field charClass / length constraints (UI complexity)
   ============================================================ */
(function () {
  'use strict';

  if (window.SpyglassIntelBuilder) return;

  // ── Inlined pure-helper shims (KEEP IN SYNC: packages/core/intel/*) ──

  const MS_PER_HOUR = 3600 * 1000;
  function applyDecay(prev, lastSeenAt, now) {
    if (typeof prev !== 'number' || !Number.isFinite(prev) || prev <= 0) return 0;
    if (typeof lastSeenAt !== 'number' || lastSeenAt <= 0) return prev;
    const elapsed = now - lastSeenAt;
    if (elapsed <= 0) return prev;
    const halfLives = elapsed / MS_PER_HOUR / 24;
    if (halfLives >= 30) return 0;
    return prev * Math.pow(0.5, halfLives);
  }

  // Trimmed cluster detector (same algorithm as packages/core/intel/cluster.js)
  function detectClusters(observations, coOccurrences, opts) {
    const o = opts || {};
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const minFieldScore = o.minFieldScore != null ? o.minFieldScore : 5;
    const minCo = o.minCoOccurrence != null ? o.minCoOccurrence : 3;
    const obs = (observations || []).filter((r) => !o.bucket || r.bucket === o.bucket);
    const co = (coOccurrences || []).filter((r) => !o.bucket || r.bucket === o.bucket);
    const fieldScores = new Map();
    for (const r of obs) {
      const decayed = applyDecay(r.decayedScore || 0, r.lastSeenAt || 0, now);
      if (decayed > 0) fieldScores.set(r.path, decayed);
    }
    const adjacency = new Map();
    for (const c of co) {
      const decayed = applyDecay(
        c.decayedScore != null ? c.decayedScore : c.count || 0,
        c.lastSeenAt || 0,
        now,
      );
      if (decayed < minCo) continue;
      pushMap(adjacency, c.pathA, { partner: c.pathB, weight: decayed });
      pushMap(adjacency, c.pathB, { partner: c.pathA, weight: decayed });
    }
    const anchors = Array.from(fieldScores.entries())
      .filter(([, score]) => score >= minFieldScore)
      .sort((a, b) => b[1] - a[1])
      .map(([path]) => path);
    const clusters = [];
    const seenSig = new Set();
    for (const anchor of anchors) {
      const partners = (adjacency.get(anchor) || [])
        .filter(
          ({ partner }) => fieldScores.has(partner) && fieldScores.get(partner) >= minFieldScore,
        )
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 7)
        .map((p) => p.partner);
      if (partners.length < 2) continue;
      const fields = [anchor, ...partners].sort();
      const sig = fields.join('|');
      if (seenSig.has(sig)) continue;
      seenSig.add(sig);
      let totalCount = 0;
      for (const f of fields) totalCount += fieldScores.get(f) || 0;
      clusters.push({ anchorPath: anchor, fields, totalCount: Number(totalCount.toFixed(2)) });
    }
    clusters.sort((a, b) => b.totalCount - a.totalCount);
    return clusters;
  }
  function pushMap(map, key, value) {
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(value);
  }

  // ── DOM ──────────────────────────────────────────────────────────

  let _root = null;
  let _stylesInjected = false;
  // Field state in the open modal: path → boolean (checked).
  let _selection = new Map();

  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const css = [
      '.spyglass-intel-modal-bg{',
      '  position:fixed;inset:0;z-index:9500;',
      '  background:rgba(0,0,0,0.5);',
      '  display:flex;align-items:center;justify-content:center;',
      '  padding:20px;',
      '}',
      '.spyglass-intel-modal-bg[hidden]{display:none}',
      '.spyglass-intel-modal{',
      '  background:var(--surface, #fff);',
      '  color:var(--text, #1a1a1a);',
      '  border-radius:10px;',
      '  border:1px solid var(--border, #e0e0e0);',
      '  width:min(780px, 100%);max-height:80vh;',
      '  display:flex;flex-direction:column;',
      '  box-shadow:0 10px 40px rgba(0,0,0,0.25);',
      '  font:13px/1.45 var(--font-body, system-ui, sans-serif);',
      '}',
      '.spyglass-intel-modal__header{',
      '  padding:16px 20px;',
      '  border-bottom:1px solid var(--border, #e0e0e0);',
      '  display:flex;align-items:center;gap:10px;',
      '}',
      '.spyglass-intel-modal__title{font-weight:600;font-size:14px;flex:1}',
      '.spyglass-intel-modal__close{',
      '  background:transparent;border:none;cursor:pointer;',
      '  font-size:20px;line-height:1;color:var(--text-dim, #999);',
      '  padding:4px 8px;border-radius:4px;',
      '}',
      '.spyglass-intel-modal__close:hover{background:var(--bg-2, #f3f3f3);color:var(--text)}',
      '.spyglass-intel-modal__body{padding:16px 20px;overflow-y:auto;flex:1}',
      '.spyglass-intel-modal__field{',
      '  display:block;font-size:12px;color:var(--text-muted, #666);',
      '  margin-bottom:6px;',
      '}',
      '.spyglass-intel-modal__name-row{',
      '  display:flex;gap:8px;align-items:center;margin-bottom:14px;',
      '}',
      '.spyglass-intel-modal__name-input{',
      '  flex:1;padding:6px 10px;font:13px var(--font-body, system-ui, sans-serif);',
      '  background:var(--surface);border:1px solid var(--border, #e0e0e0);',
      '  border-radius:4px;color:var(--text);',
      '}',
      '.spyglass-intel-modal__name-input:focus{outline:none;border-color:var(--accent, #ffc83d)}',
      '.spyglass-intel-modal__suggest-btn{',
      '  flex-shrink:0;padding:6px 12px;font:12px var(--font-body, system-ui, sans-serif);',
      '  background:var(--bg-2, #f8f8f8);color:var(--text);',
      '  border:1px solid var(--border, #e0e0e0);border-radius:4px;cursor:pointer;',
      '  white-space:nowrap;',
      '}',
      '.spyglass-intel-modal__suggest-btn:hover{',
      '  background:var(--accent-soft, #fff4d4);border-color:var(--accent, #ffc83d);',
      '}',
      '.spyglass-intel-modal__suggest-btn:disabled{',
      '  opacity:0.6;cursor:wait;',
      '}',
      '.spyglass-intel-modal__section-title{',
      '  font:11px/1 var(--font-mono, ui-monospace, monospace);',
      '  letter-spacing:.05em;text-transform:uppercase;',
      '  color:var(--text-dim, #999);',
      '  margin:16px 0 8px;',
      '}',
      '.spyglass-intel-cluster{',
      '  background:var(--bg-2, #f8f8f8);',
      '  border:1px solid var(--border, #e0e0e0);',
      '  border-radius:6px;padding:10px 12px;margin-bottom:8px;',
      '}',
      '.spyglass-intel-cluster__head{',
      '  display:flex;align-items:center;gap:8px;',
      '  font-size:11px;color:var(--text-muted, #666);',
      '  margin-bottom:6px;',
      '}',
      '.spyglass-intel-cluster__use-btn{',
      '  background:var(--accent, #ffc83d);color:var(--text);',
      '  border:none;border-radius:4px;padding:5px 12px;',
      '  font:12px var(--font-body);font-weight:600;cursor:pointer;',
      '  margin-left:auto;',
      '}',
      '.spyglass-intel-cluster__use-btn:hover{filter:brightness(1.05)}',
      '.spyglass-intel-cluster__fields{',
      '  font:11px var(--font-mono, ui-monospace, monospace);',
      '  color:var(--text);',
      '  display:flex;flex-wrap:wrap;gap:6px;',
      '}',
      '.spyglass-intel-cluster__fields span{',
      '  background:var(--surface);padding:2px 6px;border-radius:3px;',
      '  border:1px solid var(--border);',
      '}',
      '.spyglass-intel-fieldlist{display:flex;flex-direction:column;gap:2px}',
      '.spyglass-intel-fieldlist__row{',
      '  display:grid;grid-template-columns:16px 1fr;',
      '  column-gap:10px;row-gap:2px;',
      '  padding:6px 8px;border-radius:4px;cursor:pointer;',
      '}',
      '.spyglass-intel-fieldlist__row:hover{background:var(--bg-2, #f8f8f8)}',
      '.spyglass-intel-fieldlist__row input[type=checkbox]{',
      '  grid-column:1;grid-row:1 / span 2;',
      '  margin:3px 0 0;align-self:start;cursor:pointer;',
      '}',
      '.spyglass-intel-fieldlist__path{',
      '  grid-column:2;',
      '  font:12px/1.35 var(--font-mono, ui-monospace, monospace);',
      '  color:var(--text);',
      '  word-break:break-all;',
      '}',
      '.spyglass-intel-fieldlist__meta{',
      '  grid-column:2;',
      '  font:10px/1.3 var(--font-mono);color:var(--text-dim);',
      '}',
      '.spyglass-intel-modal__footer{',
      '  padding:12px 20px;border-top:1px solid var(--border, #e0e0e0);',
      '  display:flex;justify-content:flex-end;gap:8px;align-items:center;',
      '}',
      '.spyglass-intel-modal__footer-info{',
      '  font:11px var(--font-mono);color:var(--text-dim);',
      '  margin-right:auto;',
      '}',
      '.spyglass-intel-modal__btn{',
      '  padding:6px 14px;font:13px var(--font-body);',
      '  border-radius:4px;cursor:pointer;',
      '  border:1px solid var(--border, #e0e0e0);',
      '  background:var(--surface);color:var(--text);',
      '}',
      '.spyglass-intel-modal__btn:hover{background:var(--bg-2)}',
      '.spyglass-intel-modal__btn--primary{',
      '  background:var(--accent, #ffc83d);border-color:var(--accent);',
      '  color:var(--text);font-weight:600;',
      '}',
      '.spyglass-intel-modal__btn--primary:disabled{',
      '  opacity:0.5;cursor:not-allowed;',
      '}',
      '.spyglass-intel-modal__empty{',
      '  text-align:center;padding:30px;',
      '  color:var(--text-dim);font-size:12px;',
      '}',
    ].join('');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    if (_root && document.body.contains(_root)) return _root;
    injectStyles();
    _root = document.createElement('div');
    _root.className = 'spyglass-intel-modal-bg';
    _root.id = 'spyglassIntelBuilder';
    _root.hidden = true;
    _root.innerHTML = [
      '<div class="spyglass-intel-modal" role="dialog" aria-modal="true" aria-labelledby="spyglassIntelBuilderTitle">',
      '  <div class="spyglass-intel-modal__header">',
      '    <span aria-hidden="true">🧬</span>',
      '    <span class="spyglass-intel-modal__title" id="spyglassIntelBuilderTitle"></span>',
      '    <button class="spyglass-intel-modal__close" aria-label="Close" data-builder-close>×</button>',
      '  </div>',
      '  <div class="spyglass-intel-modal__body" data-builder-body></div>',
      '  <div class="spyglass-intel-modal__footer">',
      '    <span class="spyglass-intel-modal__footer-info" data-builder-info></span>',
      '    <button class="spyglass-intel-modal__btn" data-builder-cancel></button>',
      '    <button class="spyglass-intel-modal__btn spyglass-intel-modal__btn--primary" data-builder-create disabled></button>',
      '  </div>',
      '</div>',
    ].join('');
    document.body.appendChild(_root);
    // Backdrop click closes modal
    _root.addEventListener('click', (ev) => {
      if (ev.target === _root) close();
    });
    _root.querySelector('[data-builder-close]').addEventListener('click', close);
    _root.querySelector('[data-builder-cancel]').addEventListener('click', close);
    _root.querySelector('[data-builder-create]').addEventListener('click', create);
    document.addEventListener('keydown', (ev) => {
      if (!_root.hidden && ev.key === 'Escape') close();
    });
    return _root;
  }

  // Lookup against the central i18n bundle (window.t). Single source of
  // truth lives in /public/i18n.js under `builder.*` keys; this used to be
  // a 50-line inline three-locale dictionary, consolidated 2026-05-10.
  // Falls back to a tiny shim when window.t isn't loaded (e.g. tests, embed
  // surfaces) so the builder still renders something readable instead of
  // raw `[builder.title]` placeholders.
  function localised() {
    const t = typeof window !== 'undefined' && typeof window.t === 'function'
      ? window.t
      : (k) => k;
    return {
      title: t('builder.title'),
      nameLabel: t('builder.name_label'),
      namePlaceholder: t('builder.name_placeholder'),
      clustersHeading: t('builder.clusters_heading'),
      fieldsHeading: t('builder.fields_heading'),
      empty: t('builder.empty'),
      useCluster: t('builder.use_cluster'),
      cancel: t('builder.cancel'),
      create: t('builder.create'),
      info: (n) => t('builder.info', { n }),
      suggestName: t('builder.suggest_name'),
      suggestNameTooltip: t('builder.suggest_name_tooltip'),
      suggesting: t('builder.suggesting'),
    };
  }

  async function open() {
    ensureRoot();
    const t = localised();
    _root.querySelector('#spyglassIntelBuilderTitle').textContent = t.title;
    _root.querySelector('[data-builder-cancel]').textContent = t.cancel;
    _root.querySelector('[data-builder-create]').textContent = t.create;
    _root.hidden = false;
    _selection = new Map();
    await render();
  }

  function close() {
    if (_root) _root.hidden = true;
  }

  async function render() {
    const storage = window.SpyglassIntelStorage;
    if (!storage) return;
    const t = localised();
    const observations = await storage.listObservations();
    const coOccurrences = await storage.listCoOccurrences();
    const clusters = detectClusters(observations, coOccurrences);

    const body = _root.querySelector('[data-builder-body]');

    if (!observations || !observations.length) {
      body.innerHTML = '<div class="spyglass-intel-modal__empty">' + escapeHtml(t.empty) + '</div>';
      _root.querySelector('[data-builder-create]').disabled = true;
      _root.querySelector('[data-builder-info]').textContent = '';
      return;
    }

    const parts = [];

    // Name input + 🤖 Suggest button (Phase 7c — LLM-backed naming).
    // Button is wired here but auto-hides if Ollama is unavailable
    // (graceful degradation per Phase 7 R&D). The label-row layout
    // keeps name + button on the same line so the input doesn't shift
    // when the button appears/disappears.
    parts.push(
      '<label class="spyglass-intel-modal__field">' + escapeHtml(t.nameLabel) + '</label>',
      '<div class="spyglass-intel-modal__name-row">',
      '  <input type="text" class="spyglass-intel-modal__name-input" data-builder-name placeholder="' +
        escapeHtml(t.namePlaceholder) +
        '">',
      '  <button class="spyglass-intel-modal__suggest-btn" data-suggest-name title="' +
        escapeHtml(t.suggestNameTooltip || 'Suggest name with local LLM') +
        '">🤖 ' +
        escapeHtml(t.suggestName || 'Suggest') +
        '</button>',
      '</div>',
    );

    // Cluster suggestions
    if (clusters.length > 0) {
      parts.push(
        '<div class="spyglass-intel-modal__section-title">' +
          escapeHtml(t.clustersHeading) +
          '</div>',
      );
      for (const cl of clusters.slice(0, 5)) {
        parts.push(
          '<div class="spyglass-intel-cluster">',
          '  <div class="spyglass-intel-cluster__head">',
          '    <span>' +
            cl.fields.length +
            ' fields · score ' +
            cl.totalCount.toFixed(0) +
            '</span>',
          '    <button class="spyglass-intel-cluster__use-btn" data-cluster-pick="' +
            escapeAttr(cl.fields.join('|')) +
            '">' +
            escapeHtml(t.useCluster) +
            '</button>',
          '  </div>',
          '  <div class="spyglass-intel-cluster__fields">',
          ...cl.fields.map((f) => '<span>' + escapeHtml(f) + '</span>'),
          '  </div>',
          '</div>',
        );
      }
    }

    // All fields
    parts.push(
      '<div class="spyglass-intel-modal__section-title">' +
        escapeHtml(t.fieldsHeading) +
        ' (' +
        observations.length +
        ')</div>',
      '<div class="spyglass-intel-fieldlist" data-fieldlist>',
    );
    // Sort by decayed score, descending.
    const now = Date.now();
    const sorted = observations.slice().sort((a, b) => {
      const sa = applyDecay(a.decayedScore || 0, a.lastSeenAt || 0, now);
      const sb = applyDecay(b.decayedScore || 0, b.lastSeenAt || 0, now);
      return sb - sa;
    });
    for (const r of sorted) {
      const decayed = applyDecay(r.decayedScore || 0, r.lastSeenAt || 0, now);
      const charClass = (r.valueShape && r.valueShape.charClass) || r.type || '?';
      parts.push(
        '<label class="spyglass-intel-fieldlist__row">',
        '  <input type="checkbox" data-field-toggle="' +
          escapeAttr(r.path) +
          '" data-bucket="' +
          escapeAttr(r.bucket) +
          '">',
        '  <span class="spyglass-intel-fieldlist__path">' + escapeHtml(r.path) + '</span>',
        '  <span class="spyglass-intel-fieldlist__meta">[' +
          escapeHtml(r.bucket) +
          '] ' +
          escapeHtml(charClass) +
          ' · ' +
          decayed.toFixed(1) +
          '× · ' +
          (r.count || 0) +
          ' total</span>',
        '</label>',
      );
    }
    parts.push('</div>');

    body.innerHTML = parts.join('');

    // Wire up per-row checkboxes
    body.querySelectorAll('[data-field-toggle]').forEach((el) => {
      el.addEventListener('change', (ev) => {
        const path = ev.target.getAttribute('data-field-toggle');
        if (ev.target.checked) {
          _selection.set(path, ev.target.getAttribute('data-bucket'));
        } else {
          _selection.delete(path);
        }
        updateFooter();
      });
    });

    // Wire up cluster "Use" buttons
    body.querySelectorAll('[data-cluster-pick]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const fields = btn.getAttribute('data-cluster-pick').split('|');
        for (const path of fields) {
          const cb = body.querySelector('[data-field-toggle="' + cssEscape(path) + '"]');
          if (cb && !cb.checked) {
            cb.checked = true;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });
    });

    // Phase 7c: 🤖 Suggest button. Pulls cluster-naming suggestion from
    // local Ollama, fills the name input. Hides itself on the first
    // 503 (server-side Ollama unavailable) so users don't keep
    // hammering a non-responsive endpoint.
    const suggestBtn = body.querySelector('[data-suggest-name]');
    if (suggestBtn) {
      // Hide proactively if a previous /api/intel call already hit 503.
      if (window.SpyglassIntel && !window.SpyglassIntel.isLlmAvailable()) {
        suggestBtn.style.display = 'none';
      }
      suggestBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (_selection.size === 0) return; // nothing to suggest from
        const nameInput = body.querySelector('[data-builder-name]');
        const original = suggestBtn.textContent;
        suggestBtn.disabled = true;
        suggestBtn.textContent = t.suggesting;
        // Bucket = most-frequent among selected fields (mirrors create()).
        const bucketCount = Array.from(_selection.values()).reduce((acc, b) => {
          acc[b] = (acc[b] || 0) + 1;
          return acc;
        }, {});
        const bucket =
          Object.keys(bucketCount).sort((a, b) => bucketCount[b] - bucketCount[a])[0] || 'display';
        const fields = Array.from(_selection.keys());
        // Phase 10b — fish the detected format off the last /api/analyze
        // run so the LLM gets KB few-shot context grounded in the actual
        // payload kind. Falls through to '' (zero-shot) when there is no
        // analysis cached yet, when meta.format is missing, or when the
        // detector returned no formats — graceful by design.
        let detectedFormat = '';
        try {
          const last = window.__spyglassLast;
          const fmt = last && last.meta && last.meta.format;
          if (fmt && Array.isArray(fmt.formats) && fmt.formats.length > 0) {
            detectedFormat = String(fmt.formats[0]);
          }
        } catch (e) {
          /* defensive — never block the suggest flow */
        }
        let suggestion = null;
        try {
          if (window.SpyglassIntel) {
            suggestion = await window.SpyglassIntel.suggestName(bucket, fields, detectedFormat);
          }
        } catch (e) {
          /* swallow — graceful degradation */
        }
        suggestBtn.textContent = original;
        suggestBtn.disabled = false;
        if (suggestion && suggestion.name && nameInput) {
          nameInput.value = suggestion.name;
          if (suggestion.description) {
            nameInput.title = suggestion.description; // tooltip with full description
          }
        } else if (window.SpyglassIntel && !window.SpyglassIntel.isLlmAvailable()) {
          // 503 latched: hide the button quietly. No toast, no alarm.
          suggestBtn.style.display = 'none';
        }
      });
    }

    // Phase 7c: per-field purpose hint on hover. Lazy fetch — only
    // fires on first hover for a path; result populates the row's
    // tooltip via title attribute. Cached for 30 days client-side
    // (storage layer), so a hover storm doesn't burn LLM calls.
    body.querySelectorAll('[data-field-toggle]').forEach((cb) => {
      const row = cb.closest('.spyglass-intel-fieldlist__row');
      if (!row) return;
      let purposeFetched = false;
      const onEnter = async () => {
        if (purposeFetched) return;
        purposeFetched = true; // mark BEFORE fetch so re-entry doesn't double-fire
        if (!window.SpyglassIntel || !window.SpyglassIntel.isLlmAvailable()) return;
        const path = cb.getAttribute('data-field-toggle');
        const bucket = cb.getAttribute('data-bucket');
        try {
          const r = await window.SpyglassIntel.fieldPurpose(path, '', bucket);
          if (r && r.purpose) {
            const meta = row.querySelector('.spyglass-intel-fieldlist__meta');
            if (meta) {
              const ai = ' · 🤖 ' + r.purpose + (r.confidence === 'low' ? '?' : '');
              if (!meta.dataset.aiAdded) {
                meta.textContent = meta.textContent + ai;
                meta.dataset.aiAdded = '1';
              }
              row.title =
                'AI-suggested purpose: ' + r.purpose + ' (confidence: ' + r.confidence + ')';
            }
          }
        } catch (e) {
          /* graceful */
        }
      };
      // mouseenter (not mouseover) = single fire per row enter, not per
      // child element. Pointerenter would also work; mouseenter is the
      // older spec but identical for this use case.
      row.addEventListener('mouseenter', onEnter, { once: true });
    });

    updateFooter();
  }

  function updateFooter() {
    const t = localised();
    const info = _root.querySelector('[data-builder-info]');
    const create = _root.querySelector('[data-builder-create]');
    info.textContent = t.info(_selection.size);
    create.disabled = _selection.size === 0;
  }

  async function create() {
    const storage = window.SpyglassIntelStorage;
    if (!storage || _selection.size === 0) return;
    const nameInput = _root.querySelector('[data-builder-name]');
    const name =
      (nameInput && nameInput.value && nameInput.value.trim()) ||
      'Custom ' + new Date().toISOString().slice(0, 16).replace('T', ' ');

    // Pick the most-frequent bucket among selected fields as the
    // dialect's primary bucket.
    const buckets = Array.from(_selection.values());
    const bucketCount = buckets.reduce((acc, b) => {
      acc[b] = (acc[b] || 0) + 1;
      return acc;
    }, {});
    const domainBucket =
      Object.keys(bucketCount).sort((a, b) => bucketCount[b] - bucketCount[a])[0] || 'all';

    const id =
      'temp:' +
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

    const spec = {
      id,
      name,
      domainBucket,
      fields: Array.from(_selection.keys()).map((path) => ({ path, required: false })),
      parentDialect: 'iab',
      createdAt: Date.now(),
      validUntil: Date.now() + 30 * 86400000, // 30 days
    };
    try {
      await storage.putTempDialect(spec);
    } catch (e) {
      console.warn('[spyglass-intel] putTempDialect failed', e);
      return;
    }
    // Activate the new dialect immediately + sync UI selector.
    if (window.SpyglassIntel && typeof window.SpyglassIntel.activate === 'function') {
      window.SpyglassIntel.activate(id);
    }
    close();
  }

  // ── Helpers ──────────────────────────────────────────────────────

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (m) => '\\' + m);
  }

  window.SpyglassIntelBuilder = { open, close };
})();
