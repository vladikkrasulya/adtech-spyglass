/* ============================================================
   modules/save-sample/index.js — Save-sample modal (lazy-loaded ES module).

   Opens the "save sample" / "update sample" modal, then on submit
   encrypts BidRequest+BidResponse with the in-memory session DEK
   and POSTs (or PATCHes) to the sample API. Also drives the inline
   partner-inference banner (Phase C-1) — gemma names the SSP/vendor
   while the user is still typing the title; banner offers a one-
   click "use this partner" / "create partner" path.

   Loaded ONLY when the user clicks the "💾 зберегти" button — see
   the lazy stub in spyglass.app.js dispatcher (case 'save-sample').
   First click: ~10KB across this file + i18n.js. Subsequent clicks
   are cached by the module loader, zero extra fetch.

   Exposed window APIs (consumed by the central dispatcher):
     - window.openSaveModal()      — entry point (case 'save-sample')
     - window.confirmSave(opts)    — submit handler (case 'confirm-save')
     - window._spy_pickPartner(id) — banner "use existing" (case
                                      'hint-pick-partner')
     - window._spy_createPartner(name) — banner "create new" (case
                                          'hint-create-partner')

   Consumes (via /core/utils.js ES imports + globals):
     - $, escapeHtml, toast, t        — DOM + i18n helpers
     - window.closeModal               — modal lifecycle
     - window.refreshSamples           — library list refresh
     - window.openAuthModal            — auth-gate redirect
     - window.SpyglassCrypto           — AES-GCM blob encrypt
     - window.__spyglassSaveDeps       — closure-state bridge
                                          (see required addition in
                                          spyglass.app.js patch)

   The __spyglassSaveDeps bridge exposes the IIFE-private state +
   helpers that the save flow needs: api(), refreshPartners(),
   partnerOptionsHtml(), wireEnterSubmit(), and getters/setters for
   _currentUser / _sessionDEK / _currentSampleId / _currentSampleMeta /
   _isDirty / _partnerCache. Lives on window because the migration
   target file (spyglass.app.js) wraps everything in an IIFE — the
   closure state can't be reached any other way without rewriting the
   whole module shell.
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

function deps() {
  return window.__spyglassSaveDeps || {};
}

export function openSaveModal() {
  const d = deps();
  if (!d.getCurrentUser || !d.getCurrentUser()) {
    // Phase 9b auth-gate: surface an explanatory toast BEFORE opening
    // the auth modal so guests understand WHY they're being redirected
    // (previously the modal opened silently and felt like a non-sequitur).
    // Toast is non-blocking; auth modal still takes focus immediately.
    toast(t('toast.signin_to_save'), 'info');
    if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
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
  const currentSampleId = d.getCurrentSampleId ? d.getCurrentSampleId() : null;
  const currentSampleMeta = d.getCurrentSampleMeta ? d.getCurrentSampleMeta() : null;
  const updating = !!currentSampleId && !!currentSampleMeta;
  let title;
  let presetPartner;
  let presetNotes;
  if (updating) {
    title = currentSampleMeta.title || 'sample';
    presetPartner = currentSampleMeta.partner_id;
    presetNotes = currentSampleMeta.notes || '';
  } else {
    title = (() => {
      try {
        const j = JSON.parse(reqVal);
        return j.id || j.site?.domain || j.app?.bundle || 'sample';
      } catch {
        return 'sample';
      }
    })();
    // Don't seed the save-modal partner picker from the library filter.
    // Old behaviour silently coerced every new save to whatever partner
    // the user had set as the library filter — confusing and the source
    // of "all my samples ended up under partner X" reports. Default to
    // unassigned; let the user pick explicitly in the modal.
    presetPartner = null;
    presetNotes = '';
  }
  const headerText = updating
    ? t('modal.save_sample.update_title', { id: currentSampleId })
    : t('modal.save_sample.title');
  const primaryBtn =
    '<button class="btn btn-primary btn-sm" data-action="confirm-save">' +
    t(updating ? 'btn.update' : 'btn.save') +
    '</button>';
  const secondaryBtn = updating
    ? '<button class="btn btn-ghost btn-sm" data-action="confirm-save" data-as-new="1">' +
      t('btn.save_as_new') +
      '</button>'
    : '';
  const partnerOptions =
    typeof d.partnerOptionsHtml === 'function' ? d.partnerOptionsHtml(presetPartner) : '';
  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
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
    partnerOptions +
    '</select>' +
    // Phase C-1: live partner-inference banner. Populated async by
    // suggestPartnerForSave() once the save modal is mounted.
    '<div id="mPartnerHint" class="modal-hint" hidden></div>' +
    '</div>' +
    '<div class="modal-row"><label>' +
    t('sample.label.notes') +
    '</label><textarea id="mNotes">' +
    escapeHtml(presetNotes) +
    '</textarea></div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
    t('btn.cancel') +
    '</button>' +
    secondaryBtn +
    primaryBtn +
    '</div>' +
    '</div>' +
    '</div>';
  setTimeout(() => {
    const titleEl = $('mTitle');
    if (titleEl) titleEl.focus();
    if (typeof d.wireEnterSubmit === 'function') {
      d.wireEnterSubmit('mTitle', () => window.confirmSave());
    }
    // Phase C-1: kick off partner inference in the background. Result
    // (or absence of result) populates #mPartnerHint without blocking
    // the user — they can submit immediately, suggestion just upgrades
    // the UX when it lands. Skip on update flow where partner is set.
    if (!presetPartner) suggestPartnerForSave();
  }, 0);
}

// Phase C-1: ask gemma to identify the SSP / vendor based on the
// current bid_req / bid_res contents. Privacy-safe: payload stays on
// the local Ollama, never reaches a cloud LLM. Banner offers two paths:
// pick an existing partner with the same name, OR create + select a
// new one. Failures (no signal, Ollama down) silently leave the banner
// hidden — never disrupt the save flow.
async function suggestPartnerForSave() {
  const d = deps();
  const banner = $('mPartnerHint');
  if (!banner) return;
  const bid_req = $('bidReq').value || '';
  const bid_res = $('bidRes').value || '';
  if (!bid_req.trim() && !bid_res.trim()) return;
  if (typeof d.api !== 'function') return;
  let j;
  try {
    j = await d.api('POST', 'api/intel/suggest-partner', { bid_req, bid_res });
  } catch (_e) {
    return; // Ollama unavailable, rate limit, etc. — silent fallback.
  }
  if (!j || !j.suggestion || !j.suggestion.name) return;
  const name = j.suggestion.name;
  const conf = j.suggestion.confidence || 'medium';
  // Match against existing partners (case-insensitive).
  const cache = (d.getPartnerCache && d.getPartnerCache()) || [];
  const existing = cache.find((p) => p.name.toLowerCase() === name.toLowerCase());
  let actionBtn;
  if (existing) {
    actionBtn =
      '<button class="btn btn-ghost btn-sm" data-action="hint-pick-partner" data-id="' +
      existing.id +
      '">' +
      t('hint.partner.use_existing') +
      '</button>';
  } else {
    actionBtn =
      '<button class="btn btn-ghost btn-sm" data-action="hint-create-partner" data-name="' +
      escapeHtml(name) +
      '">' +
      t('hint.partner.create_new') +
      '</button>';
  }
  banner.innerHTML =
    '<span class="hint-icon" aria-hidden="true">💡</span>' +
    '<span class="hint-text">' +
    t('hint.partner.suggestion', { name: escapeHtml(name), conf }) +
    '</span>' +
    actionBtn;
  banner.dataset.confidence = conf;
  banner.hidden = false;
}

// Banner action: "use existing partner". Sets the picker value,
// hides the hint banner. Called from dispatcher case 'hint-pick-partner'.
export function pickPartner(id) {
  const sel = $('mPartner');
  if (sel) sel.value = String(id);
  const banner = $('mPartnerHint');
  if (banner) banner.hidden = true;
}

// Banner action: "create new partner". POSTs the new partner, refreshes
// the picker, hides the hint banner. Called from dispatcher case
// 'hint-create-partner'.
export async function createPartner(name) {
  const d = deps();
  if (typeof d.api !== 'function') return;
  try {
    await d.api('POST', 'api/partners', { name });
    // Refresh cache + dropdown.
    const j = await d.api('GET', 'api/partners');
    const partners = j.partners || [];
    if (typeof d.setPartnerCache === 'function') d.setPartnerCache(partners);
    const created = partners.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const sel = $('mPartner');
    if (sel && typeof d.partnerOptionsHtml === 'function') {
      sel.innerHTML = d.partnerOptionsHtml(created ? created.id : null);
    }
    const banner = $('mPartnerHint');
    if (banner) banner.hidden = true;
    toast(t('toast.partner_created', { name }), 'success');
  } catch (e) {
    toast(t('toast.send_failed', { error: e.message || '' }), 'error');
  }
}

export async function confirmSave(opts) {
  const d = deps();
  const sessionDEK = d.getSessionDEK ? d.getSessionDEK() : null;
  if (!sessionDEK) {
    toast(t('toast.crypto_session_lost'), 'error');
    return;
  }
  const asNew = !!(opts && opts.asNew);
  const currentSampleId = d.getCurrentSampleId ? d.getCurrentSampleId() : null;
  const currentSampleMeta = d.getCurrentSampleMeta ? d.getCurrentSampleMeta() : null;
  const updating = !asNew && !!currentSampleId;
  let title = $('mTitle').value.trim() || 'sample';
  const partnerId = $('mPartner').value || null;
  const notes = $('mNotes').value.trim();
  // "Save as new" forks the current sample. If the user didn't tweak the
  // title, auto-suffix "(copy)" so the new row is distinguishable in the
  // library list. Without this, identical titles + same partner produced
  // visually-indistinguishable duplicates and "where's my new save?"
  // confusion. Keep the partner preset (fast iteration) — title disambig
  // is the one signal that says "this is a fork".
  if (asNew && currentSampleMeta && title === (currentSampleMeta.title || '').trim()) {
    title = title + ' (copy)';
  }
  const bid_req = $('bidReq').value || '';
  const bid_res = $('bidRes').value || '';
  // Status from the most recent analysis. Stored on a data-attribute by
  // the analyzer so localised text in `innerText` doesn't break this read.
  const status = ($('stEntity')?.dataset.status || '').trim();
  try {
    // Encrypt blobs locally before POSTing. Server stores opaque ciphertext.
    const encReq = await window.SpyglassCrypto.encryptBlob(sessionDEK, bid_req);
    const encRes = await window.SpyglassCrypto.encryptBlob(sessionDEK, bid_res);
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
      saved = await d.api('PATCH', 'api/samples/' + currentSampleId, payload);
      toast(t('toast.updated', { title }), 'success');
    } else {
      saved = await d.api('POST', 'api/samples', payload);
      // After save-as-new (or first save), track the new id so subsequent
      // saves keep updating instead of duplicating.
      if (saved && saved.sample) {
        if (typeof d.setCurrentSampleId === 'function') d.setCurrentSampleId(saved.sample.id);
        if (typeof d.setCurrentSampleMeta === 'function') {
          d.setCurrentSampleMeta({
            title,
            partner_id: payload.partner_id,
            notes,
          });
        }
      }
      toast(t('toast.saved', { title }), 'success');
    }
    // Bring the cached meta in sync with whatever the user just wrote.
    if (updating && typeof d.setCurrentSampleMeta === 'function') {
      d.setCurrentSampleMeta({ title, partner_id: payload.partner_id, notes });
    }
    if (typeof d.setIsDirty === 'function') d.setIsDirty(false);
    if (typeof window.closeModal === 'function') window.closeModal();
    if (typeof window.refreshSamples === 'function') window.refreshSamples();
  } catch (e) {
    // Special case: the picker showed a partner that another tab just
    // deleted. Refresh the partner cache so the picker doesn't keep
    // offering the dead row, and tell the user specifically.
    if (e.code === 'partner_not_found') {
      toast(t('toast.partner_gone'), 'error');
      if (typeof d.refreshPartners === 'function') {
        try {
          await d.refreshPartners();
        } catch (_) {
          /* swallow */
        }
      }
      return;
    }
    toast(t('toast.save_failed', { error: e.message }), 'error');
  }
}

// Expose for the dispatcher in spyglass.app.js. The dispatcher does:
//   await import('/modules/save-sample/index.js'); window.openSaveModal();
// — first call: fetches + evaluates + this assignment runs.
// Subsequent calls: cached by the module loader, this assignment is a no-op.
window.openSaveModal = openSaveModal;
window.confirmSave = confirmSave;
window._spy_pickPartner = pickPartner;
window._spy_createPartner = createPartner;
