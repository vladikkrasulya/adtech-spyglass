/* ============================================================================
 * dialect-label.js — labelling an unknown vendor ext signal, by hand or with
 * the local model's help.
 *
 * Two entry points, both from the `question` finding's card:
 *   Розмітити      → openBuilder()  — the manual picker
 *   Спитати агента → askAgent()     — asks /api/dialects/suggest-label first,
 *                                     then opens the same picker pre-filled
 *
 * ── The suggestion is never the decision ─────────────────────────────────
 * A saved mapping is not a note. The server clears its dialect cache on
 * write, and from the next analysis onward the mapping silences this
 * question and feeds the pop/push recognition table — so a wrong label
 * changes which RULES fire on every future payload, in a direction the
 * user can no longer see. The agent therefore proposes into a form that
 * still needs a human click, and the form says plainly where the proposal
 * came from: a deterministic table lookup and a language model's guess do
 * not deserve the same trust, and collapsing them into one badge is how a
 * reader stops checking.
 *
 * ── The path has to lose its index ───────────────────────────────────────
 * Findings carry `imp[0].ext.type`; the runtime looks mappings up under
 * `imp[].ext.type`. Saving the indexed form produces a mapping that never
 * matches, so the question returns on the next analysis and the user is
 * left thinking the feature is broken. toSignalPath() collapses the index.
 *
 * No bundler: plain IIFE attaching window.OrtbtoolsDialectLabel.
 * ========================================================================== */
(function () {
  'use strict';

  // The twenty storable labels come from the generated Core mirror
  // (/core/key-role-vocabulary.js, loaded before this file) — one source of
  // truth, gated by tests/key-role-browser-mirror.test.js (016 FR-024, R-10).
  const LABELS = (window.KeyRoleVocabulary && window.KeyRoleVocabulary.STORABLE_LABELS) || [];

  // Below this the proposal is shown with an explicit "check this yourself"
  // warning. Chosen to sit above the persona's own "no ground for an answer"
  // band (it returns 0.2–0.3 for numeric vendor codes and opaque strings).
  const LOW_CONFIDENCE = 0.6;

  function t(key, params) {
    if (typeof window.t === 'function') {
      const s = window.t(key, params);
      if (s && s !== '[' + key + ']') return s;
    }
    return key;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  }

  function toast(msg, kind) {
    if (typeof window.toast === 'function') window.toast(msg, kind);
  }

  /**
   * `imp[0].ext.type` → `imp[].ext.type`; `ext.pv` unchanged.
   * See the header — this is what makes a saved mapping actually match.
   */
  function toSignalPath(findingPath) {
    return String(findingPath || '').replace(/\[\d+\]/g, '[]');
  }

  /**
   * The impression the signal sits on, read back out of the request editor.
   *
   * Sent as CONTEXT for the classifier: which media object the slot carries
   * is what separates `preroll_video` on a video imp (corroborated) from the
   * same word on a banner-only imp (contradicted, and a question for a
   * human). The server redacts this to an allowlist before any of it reaches
   * the model — see redactImp() in modules/ai-label/handler.js.
   *
   * Returns null for request-level signals and whenever the editor no longer
   * parses, which is honest: a payload edited since the analysis cannot be
   * indexed into safely.
   */
  function impFromEditor(findingPath) {
    const m = /^imp\[(\d+)\]/.exec(String(findingPath || ''));
    if (!m) return null;
    const el = document.getElementById('bidReq');
    if (!el || !el.value) return null;
    try {
      const parsed = JSON.parse(el.value);
      const imps = parsed && parsed.imp;
      if (!Array.isArray(imps)) return null;
      return imps[Number(m[1])] || null;
    } catch (_) {
      return null;
    }
  }

  // ── dialect selection ─────────────────────────────────────────────────

  async function listDialects() {
    const r = await fetch('/api/dialects');
    if (r.status === 401) {
      const e = new Error('unauthorized');
      e.code = 'unauthorized';
      throw e;
    }
    const j = await r.json();
    return (j && j.dialects) || [];
  }

  async function createDialect(name) {
    const r = await fetch('/api/dialects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, is_default: true }),
    });
    const j = await r.json();
    if (!j || !j.success) throw new Error((j && j.error) || 'create_failed');
    return j.dialect;
  }

  async function saveMapping(dialectId, body) {
    const r = await fetch('/api/dialects/' + dialectId + '/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j || !j.success) throw new Error((j && j.error) || 'save_failed');
    return j.mapping;
  }

  // ── the picker ────────────────────────────────────────────────────────

  /**
   * @param {object} sig  { path, value, shapeSignature }
   * @param {object|null} suggestion  { label, confidence, reason, source }
   */
  /**
   * Aborts the listener belonging to the previously-opened picker.
   *
   * #modalRoot outlives every modal — only its innerHTML is swapped — so a
   * listener added on open and never removed simply accumulates. The count
   * showed up as triangular numbers in the audit: one press of Save created
   * 1 dialect, then 3, then 6, because the Nth open ran the handler N times.
   * Module-level rather than per-call so a picker opened while another is
   * still mounted cannot leave the older one attached.
   */
  let _pickerAbort = null;

  async function openBuilder(sig, suggestion) {
    const root = document.getElementById('modalRoot');
    if (!root) return;
    if (_pickerAbort) _pickerAbort.abort();
    _pickerAbort = new AbortController();
    const listenerSignal = _pickerAbort.signal;

    let dialects = [];
    try {
      dialects = await listDialects();
    } catch (e) {
      if (e.code === 'unauthorized') {
        toast(t('dialect.label.err.unauthorized'), 'error');
        return;
      }
      dialects = [];
    }

    const signalPath = toSignalPath(sig.path);
    const isAmbiguous = suggestion && suggestion.resolutionStatus === 'ambiguous';
    const isRoleResolved = suggestion && suggestion.resolutionStatus === 'resolved';
    const isSaved = suggestion && suggestion.source === 'saved-mapping';
    const low =
      suggestion && !isAmbiguous && !isSaved && Number(suggestion.confidence) < LOW_CONFIDENCE;
    // An ambiguous answer preselects NOTHING (016 §response compatibility);
    // everything else preselects its label.
    const picked = (!isAmbiguous && suggestion && suggestion.label) || '';

    const sourceBadge = suggestion
      ? '<span class="dl-src dl-src-' +
        esc(suggestion.source) +
        '">' +
        esc(t('dialect.label.source.' + suggestion.source)) +
        '</span>'
      : '';

    // 016: the role/value split, provenance and states the role layer adds.
    const roleName = (id) => t('dialect.label.name.' + id);
    const evid = Array.isArray(suggestion && suggestion.evidence) ? suggestion.evidence : [];
    const unverified = evid.some((e) => e && e.unverifiedOnly === true);
    const citations = evid
      .flatMap((e) => (Array.isArray(e.citations) ? e.citations : e.citation ? [e.citation] : []))
      .slice(0, 3);
    const provenance =
      citations.length || unverified
        ? '<p class="dl-evid"><span class="dl-lbl">' +
          esc(t('dialect.label.evidence')) +
          ':</span> ' +
          citations.map(esc).join(' · ') +
          (unverified
            ? ' <span class="dl-unverified">' + esc(t('dialect.label.unverified')) + '</span>'
            : '') +
          '</p>'
        : '';
    const roleSplit = isRoleResolved
      ? '<p class="dl-role"><span class="dl-lbl">' +
        esc(t('dialect.label.role')) +
        ':</span> <strong>' +
        esc(roleName(suggestion.role === 'format-declaration' ? 'custom' : suggestion.role)) +
        '</strong></p>' +
        (suggestion.valueStatus === 'unknown'
          ? '<p class="dl-value-note">' + esc(t('dialect.label.value_yours')) + '</p>'
          : '') +
        (suggestion.conflict
          ? '<p class="dl-conflict">' + esc(t('dialect.label.conflict_note')) + '</p>'
          : '')
      : '';
    const candidateList = isAmbiguous
      ? '<p class="dl-candidates"><span class="dl-lbl">' +
        esc(t('dialect.label.candidates')) +
        ':</span> ' +
        suggestion.roleCandidates
          .map(
            (c) =>
              '<strong>' + esc(roleName(c === 'format-declaration' ? 'custom' : c)) + '</strong>',
          )
          .join(' / ') +
        '</p>'
      : '';

    // Confidence renders ONLY where a number was measured: never on an
    // ambiguous answer (no singular claim) and never on a saved mapping
    // (the operator confirmed it — a score would fake measurement).
    const confBadge =
      suggestion && !isAmbiguous && !isSaved && suggestion.confidence !== undefined
        ? '<span class="dl-conf">' +
          esc(t('dialect.label.confidence')) +
          ' ' +
          Math.round(Number(suggestion.confidence) * 100) +
          '%</span>'
        : '';
    const proposalTitle = isAmbiguous
      ? t('dialect.label.ambiguous_title')
      : t('dialect.label.proposal_title');
    const proposal = suggestion
      ? '<div class="dl-proposal' +
        (low ? ' dl-low' : '') +
        '">' +
        '<div class="dl-proposal-head">' +
        '<span class="dl-proposal-title">' +
        esc(proposalTitle) +
        '</span>' +
        sourceBadge +
        confBadge +
        '</div>' +
        roleSplit +
        candidateList +
        '<p class="dl-reason">' +
        esc(suggestion.reason || (isSaved ? suggestion.notes || '' : '')) +
        '</p>' +
        provenance +
        '<p class="dl-src-hint">' +
        esc(t('dialect.label.source.' + suggestion.source + '_hint')) +
        '</p>' +
        (low ? '<p class="dl-warn">' + esc(t('dialect.label.low_confidence_warn')) + '</p>' : '') +
        '</div>'
      : '';

    const opts = LABELS.map(
      (l) =>
        '<option value="' +
        esc(l) +
        '"' +
        (l === picked ? ' selected' : '') +
        ' title="' +
        esc(t('dialect.label.desc.' + l)) +
        '">' +
        esc(t('dialect.label.name.' + l)) +
        '</option>',
    ).join('');

    const dialectOpts =
      dialects.map((d) => '<option value="' + d.id + '">' + esc(d.name) + '</option>').join('') +
      '<option value="__new">' +
      esc(t('dialect.label.new_dialect')) +
      '</option>';

    root.innerHTML =
      '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
      '<div class="modal-card dl-card" role="dialog" aria-modal="true" aria-labelledby="dlTitle">' +
      '<div class="modal-title" id="dlTitle">' +
      esc(t('finding.action.map')) +
      '</div>' +
      '<div class="dl-signal">' +
      '<span class="dl-lbl">' +
      esc(t('dialect.label.signal')) +
      '</span>' +
      '<code>' +
      esc(signalPath) +
      ' = ' +
      esc(sig.value) +
      '</code>' +
      '</div>' +
      proposal +
      '<label class="dl-field"><span class="dl-lbl">' +
      esc(t('dialect.label.pick')) +
      '</span>' +
      '<select id="dlLabel">' +
      opts +
      '</select></label>' +
      '<label class="dl-field"><span class="dl-lbl">' +
      esc(t('dialect.label.target')) +
      '</span>' +
      '<select id="dlDialect">' +
      dialectOpts +
      '</select></label>' +
      '<label class="dl-field" id="dlNewWrap" hidden><span class="dl-lbl">' +
      esc(t('dialect.label.new_dialect_name')) +
      '</span>' +
      '<input id="dlNewName" type="text" maxlength="80" value="My dialect"></label>' +
      '<label class="dl-field"><span class="dl-lbl">' +
      esc(t('dialect.label.notes')) +
      '</span>' +
      '<input id="dlNotes" type="text" maxlength="1000"></label>' +
      '<p class="dl-scope-note">' +
      esc(t('dialect.label.scope_note')) +
      '</p>' +
      '<div class="dl-actions">' +
      '<button type="button" class="btn btn-ghost" data-action="dl-cancel">' +
      esc(t('dialect.label.cancel')) +
      '</button>' +
      '<button type="button" class="btn btn-primary" id="dlSave" data-action="dl-save">' +
      esc(t('dialect.label.save')) +
      '</button>' +
      '</div>' +
      '</div></div>';

    // No dialect yet → the picker defaults to creating one, so the very first
    // label a user saves does not dead-end on "you have no dialects".
    const dialectSel = document.getElementById('dlDialect');
    const newWrap = document.getElementById('dlNewWrap');
    if (!dialects.length) {
      dialectSel.value = '__new';
      newWrap.hidden = false;
    }
    dialectSel.addEventListener('change', () => {
      newWrap.hidden = dialectSel.value !== '__new';
    });

    root.addEventListener(
      'click',
      async (ev) => {
        const el = ev.target.closest('[data-action]');
        if (!el) return;
        const action = el.dataset.action;
        if (action === 'dl-cancel' || action === 'modal-backdrop-close') {
          if (action === 'modal-backdrop-close' && ev.target !== el) return;
          return window.closeModal && window.closeModal();
        }
        if (action !== 'dl-save') return;

        const btn = document.getElementById('dlSave');
        btn.disabled = true;
        btn.textContent = t('dialect.label.saving');
        try {
          let dialectId = dialectSel.value;
          if (dialectId === '__new') {
            const name = (document.getElementById('dlNewName').value || '').trim() || 'My dialect';
            dialectId = (await createDialect(name)).id;
          }
          const label = document.getElementById('dlLabel').value;
          await saveMapping(dialectId, {
            signal_path: signalPath,
            signal_value: String(sig.value),
            semantic_label: label,
            shape_fingerprint: sig.shapeSignature || null,
            notes: (document.getElementById('dlNotes').value || '').trim() || null,
          });
          if (window.closeModal) window.closeModal();
          toast(t('dialect.label.saved', { label }), 'success');
        } catch (e) {
          btn.disabled = false;
          btn.textContent = t('dialect.label.save');
          toast(
            e && e.code === 'unauthorized'
              ? t('dialect.label.err.unauthorized')
              : t('dialect.label.err.save'),
            'error',
          );
        }
      },
      { signal: listenerSignal },
    );
  }

  // ── the agent ─────────────────────────────────────────────────────────

  /**
   * Ask the server for a suggestion, then hand it to the picker.
   *
   * The button carries its own state — the user pressed a control and is
   * owed feedback on that control, not a toast somewhere else. The original
   * complaint about this feature was precisely that clicking produced no
   * visible response at all.
   */
  async function askAgent(btn, sig) {
    if (!btn || btn.dataset.busy === '1') return;
    const original = btn.textContent;
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.textContent = t('dialect.label.asking');

    try {
      const r = await fetch('/api/dialects/suggest-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal_path: sig.path,
          signal_value: sig.value,
          imp: impFromEditor(sig.path),
          locale: (window.tLocale && window.tLocale()) || 'en',
        }),
      });
      const j = await r.json().catch(() => null);

      if (!r.ok || !j || !j.ok) {
        const code = (j && j.code) || '';
        const key =
          r.status === 401
            ? 'unauthorized'
            : r.status === 429
              ? 'rate_limited'
              : code === 'labeller_unavailable'
                ? 'unavailable'
                : code === 'labeller_timeout'
                  ? 'timeout'
                  : 'generic';
        toast(t('dialect.label.err.' + key), 'error');
        return;
      }
      await openBuilder(sig, j.suggestion);
    } catch (_) {
      toast(t('dialect.label.err.generic'), 'error');
    } finally {
      btn.dataset.busy = '';
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  window.OrtbtoolsDialectLabel = { openBuilder, askAgent, toSignalPath, impFromEditor };
})();
