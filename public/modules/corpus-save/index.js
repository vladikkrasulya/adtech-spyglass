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
   spyglass.app.js dispatcher (case 'open-corpus-save'). On first
   click: ~5KB across this file + i18n.js. On subsequent clicks:
   cached by the module loader, zero extra fetch.

   Exposed window APIs (consumed by spyglass.app.js dispatcher):
     - window.openCorpusSaveModal()    — entry point, called by
                                          'open-corpus-save'.
     - window.confirmCorpusSave()      — called by
                                          'confirm-corpus-save' from
                                          the modal's primary button.

   Consumes (via /core/utils.js ES imports + globals):
     - $, escapeHtml, toast, t   — DOM + i18n helpers
     - window.closeModal          — modal lifecycle
     - window.__spyglassBehavior  — { events: [...] } captured by
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
   handled by the 'corpus-delete' dispatcher case in spyglass.app.js
   and stays there — it's a one-shot fetch, no modal needed).
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

export function openCorpusSaveModal() {
  const events = (window.__spyglassBehavior && window.__spyglassBehavior.events) || [];
  const usable = events.filter((e) => e.kind !== 'probe_ready');
  if (!usable.length) {
    toast(t('toast.corpus_no_events'), 'error');
    return;
  }

  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
    '<div class="modal-card">' +
    '<div class="modal-title">' +
    escapeHtml(t('modal.corpus_save.title')) +
    '</div>' +
    '<div class="modal-row"><div class="kt-corpus-summary">' +
    escapeHtml(t('modal.corpus_save.summary', { count: usable.length })) +
    '</div></div>' +
    '<div class="modal-row"><label>' +
    escapeHtml(t('modal.corpus_save.label')) +
    '</label>' +
    '<div class="kt-corpus-labels">' +
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
    '<div class="modal-row"><label>' +
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

export async function confirmCorpusSave() {
  const events = (window.__spyglassBehavior && window.__spyglassBehavior.events) || [];
  const usable = events.filter((e) => e.kind !== 'probe_ready');
  const labelEl = document.querySelector('input[name="corpusLabel"]:checked');
  const label = labelEl ? labelEl.value : 'fraud';
  const notes = ($('corpusNotes')?.value || '').trim();
  const sourceSampleId = window._currentSampleId || null;

  try {
    const r = await fetch('/api/behavior/corpus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: usable, label, notes, sourceSampleId }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'corpus_save_failed');
    if (typeof window.closeModal === 'function') window.closeModal();
    toast(t('toast.corpus_saved', { count: usable.length, label }), 'success');
  } catch (e) {
    toast(t('toast.corpus_save_failed', { error: e.message }), 'error');
  }
}

// Expose for the dispatcher in spyglass.app.js. The dispatcher does:
//   await import('/modules/corpus-save/index.js'); window.openCorpusSaveModal();
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader, the assignments are no-ops.
window.openCorpusSaveModal = openCorpusSaveModal;
window.confirmCorpusSave = confirmCorpusSave;
