/* ============================================================
   modules/corpus-save/index.js — Behavior-corpus save modal
   (lazy-loaded ES module).

   Lets the signed-in user pick a label (legitimate / fraud /
   ambiguous) and optional notes for the events captured by the
   current behavior probe, then POSTs them to /api/behavior/corpus
   so they become a labeled training sample for the confusion
   matrix in the cabinet.

   Loaded ONLY when the user clicks the "зберегти як corpus"
   button in the behavior tab — see the lazy stub in
   ortbtools.app.js dispatcher (case 'open-corpus-save'). On first
   click: ~5KB across this file + i18n.js. On subsequent clicks:
   cached by the module loader, zero extra fetch.

   Exposed window APIs (consumed by ortbtools.app.js dispatcher):
     - window.openCorpusSaveModal()    — entry point, called by
                                          'open-corpus-save'.
     - window.confirmCorpusSave()      — called by
                                          'confirm-corpus-save' from
                                          the modal's primary button.

   Consumes (via /core/utils.js ES imports + globals):
     - $, escapeHtml, toast, t   — DOM + i18n helpers
     - window.closeModal          — modal lifecycle
     - window.__ortbtoolsBehavior  — { events: [...] } captured by
                                     the behavior probe
     - window._currentSampleId    — optional anchor to the current
                                     library sample (passed through
                                     to the API as sourceSampleId)

   Auth gate: the dispatcher checks `_currentUser` before
   lazy-loading this module — by the time openCorpusSaveModal()
   runs, the user is guaranteed signed in. confirmCorpusSave()
   inherits that guarantee since it can only fire from a button
   inside an already-open modal.

   Backend: POST /api/behavior/corpus (handler appends an entry
   keyed by the signed-in user; DELETE /api/behavior/corpus/:id is
   handled by the 'corpus-delete' dispatcher case in ortbtools.app.js
   and stays there — it's a one-shot fetch, no modal needed).
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

/**
 * Suffix of the plural key an event count needs: `_one` / `_few` / `_many`.
 *
 * The i18n interpolator has no plural machinery — it substitutes {vars} and
 * nothing else — so a counted noun has to pick its own key. The rule is the
 * same one pluralKey() applies in public/ortbtools.app.js and
 * tests/plural-forms.test.js pins: 11 takes the 5+ form, 21 the singular,
 * 111 the 5+ form again. English has two forms, so it never reaches _many.
 */
function pluralKeySuffix(n) {
  const locale =
    (typeof window.tLocale === 'function' && window.tLocale()) ||
    document.documentElement.getAttribute('lang') ||
    'en';
  if (locale !== 'uk' && locale !== 'ru') return n === 1 ? '_one' : '_few';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return '_one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return '_few';
  return '_many';
}

export function openCorpusSaveModal() {
  const events = (window.__ortbtoolsBehavior && window.__ortbtoolsBehavior.events) || [];
  const usable = events.filter((e) => e.kind !== 'probe_ready');
  if (!usable.length) {
    toast(t('toast.corpus_no_events'), 'error');
    return;
  }

  // The modal's own click dispatcher.
  //
  // ROADMAP #18 moved modal chrome up to the shell, and <div id="modalRoot">
  // is a SIBLING of <main id="app-root">, not a descendant. The delegated
  // listener in ortbtools.app.js is bound to #app-root, so no click inside any
  // modal reaches it. 'confirm-corpus-save' was written expecting that
  // listener and therefore never fired once: the button rendered, the user
  // pressed it, and nothing happened.
  //
  // Same shape as the fix in modules/save-sample and the local listener the
  // history-merge modal already used.
  bindCorpusModal();

  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
    '<div class="modal-card">' +
    '<div class="modal-title">' +
    escapeHtml(t('modal.corpus_save.title')) +
    '</div>' +
    '<div class="modal-row"><div class="kt-corpus-summary">' +
    escapeHtml(
      t('modal.corpus_save.summary' + pluralKeySuffix(usable.length), { count: usable.length }),
    ) +
    '</div></div>' +
    '<div class="modal-row"><label id="corpusLabelLegend">' +
    escapeHtml(t('modal.corpus_save.label')) +
    '</label>' +
    '<div class="kt-corpus-labels" role="radiogroup" aria-labelledby="corpusLabelLegend">' +
    '<label><input type="radio" name="corpusLabel" value="legitimate"> ' +
    escapeHtml(t('modal.corpus_save.label.legitimate')) +
    '</label>' +
    '<label><input type="radio" name="corpusLabel" value="fraud" checked> ' +
    escapeHtml(t('modal.corpus_save.label.fraud')) +
    '</label>' +
    '<label><input type="radio" name="corpusLabel" value="ambiguous"> ' +
    escapeHtml(t('modal.corpus_save.label.ambiguous')) +
    '</label>' +
    '</div></div>' +
    '<div class="modal-row"><label for="corpusNotes">' +
    escapeHtml(t('modal.corpus_save.notes')) +
    '</label>' +
    '<textarea id="corpusNotes" rows="3" placeholder="' +
    escapeHtml(t('modal.corpus_save.notes_placeholder')) +
    '"></textarea></div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
    t('btn.cancel') +
    '</button>' +
    '<button class="btn btn-primary btn-sm" data-action="confirm-corpus-save">' +
    escapeHtml(t('btn.save')) +
    '</button>' +
    '</div></div></div>';
}

/* One POST at a time.
 *
 * The modal used to stay live and clickable for the whole round-trip
 * (closeModal() only ran AFTER `await fetch`), so a double-click posted the
 * same events twice and the corpus grew two identical rows — which then
 * counted twice in the confusion matrix, corrupting the very metric the
 * corpus exists to produce. Guarded by a module-level flag AND by disabling
 * the button: the flag is what actually stops the second call (a programmatic
 * window.confirmCorpusSave() bypasses the disabled attribute), the disabled
 * state is what tells the user why nothing is happening. */
let _saveInFlight = false;

export async function confirmCorpusSave() {
  if (_saveInFlight) return;

  const events = (window.__ortbtoolsBehavior && window.__ortbtoolsBehavior.events) || [];
  const usable = events.filter((e) => e.kind !== 'probe_ready');
  const labelEl = document.querySelector('input[name="corpusLabel"]:checked');
  const label = labelEl ? labelEl.value : 'fraud';
  const notes = ($('corpusNotes')?.value || '').trim();
  const sourceSampleId = window._currentSampleId || null;
  const btn = document.querySelector('[data-action="confirm-corpus-save"]');

  _saveInFlight = true;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  try {
    const r = await fetch('/api/behavior/corpus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: usable, label, notes, sourceSampleId }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'corpus_save_failed');
    if (typeof window.closeModal === 'function') window.closeModal();
    toast(
      t('toast.corpus_saved' + pluralKeySuffix(usable.length), {
        count: usable.length,
        // The stored value is a machine token; the reader gets the short
        // localized name the cabinet uses for the same row.
        label: t('corpus.label.' + label),
      }),
      'success',
    );
  } catch (e) {
    toast(t('toast.corpus_save_failed', { error: e.message }), 'error');
  } finally {
    // Re-arm only for a modal that is still on screen — on success closeModal()
    // has already detached the button, and a retry has to start from a fresh
    // open (which re-renders the button enabled).
    _saveInFlight = false;
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }
}

// Expose for the dispatcher in ortbtools.app.js. The dispatcher does:
//   await import('/modules/corpus-save/index.js'); window.openCorpusSaveModal();
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader, the assignments are no-ops.
window.openCorpusSaveModal = openCorpusSaveModal;
window.confirmCorpusSave = confirmCorpusSave;

/**
 * Bind the corpus modal's primary button to a #modalRoot-scoped listener.
 *
 * Guarded by a dataset flag rather than removeEventListener: modalRoot itself
 * survives across modals (only its innerHTML is swapped), so binding on every
 * open would stack handlers and fire confirmCorpusSave() once per previous
 * open. One listener for the life of the page, matching on the action, is
 * both simpler and immune to that.
 */
function bindCorpusModal() {
  const root = $('modalRoot');
  if (!root || root.dataset.corpusBound === '1') return;
  root.dataset.corpusBound = '1';
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-action]');
    if (!el || el.dataset.action !== 'confirm-corpus-save') return;
    ev.preventDefault();
    if (typeof window.confirmCorpusSave === 'function') window.confirmCorpusSave();
  });
}
