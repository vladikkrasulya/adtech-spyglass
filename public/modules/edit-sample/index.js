/* ============================================================
   modules/edit-sample/index.js — Edit-sample modal
   (lazy-loaded ES module).

   Lets the signed-in user rename a saved sample, change its
   partner, or update its notes — without touching the encrypted
   payload (req/res ciphertext is owned by the save modal). PATCHes
   /api/samples/:id with metadata only.

   Loaded ONLY when the user clicks the ✎ pencil button on a
   library row — see the lazy stub in spyglass.app.js dispatcher
   (case 'sample-edit'). On first click: ~3KB across this file +
   i18n.js. On subsequent clicks: cached by the module loader, zero
   extra fetch.

   Exposed window APIs (consumed by spyglass.app.js dispatcher):
     - window.editSample(id)    — entry point, called by 'sample-edit'.
     - window.confirmEdit(id)   — called by 'confirm-edit' from
                                   the modal's primary button.

   Consumes (via /core/utils.js ES imports + SpyglassSession facade):
     - $, escapeHtml, toast, t                — DOM + i18n helpers
     - SpyglassSession.api                    — auth-cookied fetch
     - SpyglassSession.partnerOptionsHtml(s)  — <select> for picker
     - SpyglassSession.wireEnterSubmit        — ⏎ submits the title
     - SpyglassSession.currentSampleId        — sync-meta check
     - SpyglassSession.setCurrentSampleMeta   — keep loaded-meta in
                                                 sync if user just
                                                 edited the open record
     - SpyglassSession.refreshSamples()       — re-render Library
     - window.closeModal()                    — modal lifecycle

   Auth gate: edit only fires from a library row, which only
   renders for signed-in users. The dispatcher does not auth-gate
   this case — by construction the user is signed in by the time
   they can click ✎.
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

export async function editSample(id) {
  const S = window.SpyglassSession;
  try {
    const j = await S.api('GET', 'api/samples/' + id);
    const s = j.sample;
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
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
      S.partnerOptionsHtml(s.partner_id) +
      '</select></div>' +
      '<div class="modal-row"><label>' +
      t('sample.label.notes_short') +
      '</label><textarea id="mNotes">' +
      escapeHtml(s.notes || '') +
      '</textarea></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
      t('btn.cancel') +
      '</button>' +
      '<button class="btn btn-primary btn-sm" data-action="confirm-edit" data-id="' +
      s.id +
      '">' +
      t('btn.save') +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    setTimeout(() => {
      $('mTitle').focus();
      S.wireEnterSubmit('mTitle', () => window.confirmEdit(s.id));
    }, 0);
  } catch (e) {
    toast(e.message, 'error');
  }
}

export async function confirmEdit(id) {
  const S = window.SpyglassSession;
  const title = $('mTitle').value.trim() || 'sample';
  const partnerId = $('mPartner').value || null;
  const notes = $('mNotes').value.trim();
  try {
    await S.api('PATCH', 'api/samples/' + id, {
      title,
      partner_id: partnerId ? Number(partnerId) : null,
      notes,
    });
    // Keep the loaded-meta in sync if the user just edited the same record.
    if (S.currentSampleId === id && S.currentSampleMeta) {
      S.setCurrentSampleMeta({
        title,
        partner_id: partnerId ? Number(partnerId) : null,
        notes,
      });
    }
    if (typeof window.closeModal === 'function') window.closeModal();
    toast(t('toast.saved', { title }), 'success');
    S.refreshSamples();
  } catch (e) {
    toast(t('toast.save_changes_failed', { error: e.message }), 'error');
  }
}

// Expose for the dispatcher in spyglass.app.js. The dispatcher does:
//   await import('/modules/edit-sample/index.js'); window.editSample(id);
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader, the assignments are no-ops.
window.editSample = editSample;
window.confirmEdit = confirmEdit;
