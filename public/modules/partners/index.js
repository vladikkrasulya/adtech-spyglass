/* ============================================================
   modules/partners/index.js — Partner-management modal
   (lazy-loaded ES module).

   Tiny CRUD modal for the user's partner list — the per-account
   labels attached to saved samples. Lists existing partners with
   delete buttons; one input row to add a new one. POSTs/DELETEs
   against /api/partners; on every mutation re-pulls the cache via
   window.refreshPartners() (owned by spyglass.app.js — `_partnerCache`
   is shared with the partner-suggest banner and the save modal's
   <select>, so the cache cannot move into this module).

   Loaded ONLY when the user clicks the "👥 партнери" button or
   the cabinet's "Manage partners" deep-link (?open=partners) — see
   the lazy stub in spyglass.app.js dispatcher (case 'open-partners').
   On first click: ~3KB across this file + i18n.js. On subsequent
   clicks: cached by the module loader, zero extra fetch.

   Exposed window APIs (consumed by spyglass.app.js dispatcher cases
   'confirm-add-partner' and 'delete-partner', plus the cabinet
   deep-link guard):
     - window.openPartnerModal()   — entry point
     - window.confirmAddPartner()  — POST /api/partners
     - window.deletePartner(id)    — DELETE /api/partners/:id

   Consumes (via /core/utils.js ES imports + window globals):
     - $, escapeHtml, toast, t   — DOM + i18n helpers
     - window.refreshPartners    — re-pulls _partnerCache (shared
                                   with non-modal partner-suggest
                                   banner and save-modal picker)
     - window.getPartners        — read-only getter for _partnerCache
     - window.refreshSamples     — re-render Library after partner
                                   mutations (sample.partner_name
                                   strings change when a partner is
                                   renamed/deleted)
     - window.closeModal         — modal lifecycle (Esc handler +
                                   data-action 'modal-close')
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

// Local copy of wireEnterSubmit — spyglass.app.js's helper isn't
// exported. Submitting a one-input modal with ⏎ saves the user a
// mouse trip to the primary button.
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

function partnerListHtml() {
  const partners = typeof window.getPartners === 'function' ? window.getPartners() || [] : [];
  if (!partners.length) return '<div class="saved-empty">' + t('empty.partners') + '</div>';
  return partners
    .map(
      (p) =>
        '<div class="saved-item" style="cursor:default">' +
        '<div class="saved-item-actions" style="opacity:1">' +
        '<button class="saved-act-btn danger" data-action="delete-partner" data-id="' +
        p.id +
        '" title="' +
        escapeHtml(t('tooltip.delete')) +
        '">×</button>' +
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

// Tiny fetch wrapper that mirrors spyglass.app.js's local api()
// helper — same error shape (status + code on the thrown Error)
// so the `partner_not_found` / 401 paths still surface meaningfully.
async function api(method, url, body) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) init.body = JSON.stringify(body);
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

export function openPartnerModal() {
  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
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
    '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
    t('btn.close') +
    '</button>' +
    '<button class="btn btn-primary btn-sm" data-action="confirm-add-partner">' +
    t('btn.add') +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>';
  setTimeout(() => {
    $('pName').focus();
    wireEnterSubmit('pName', () => window.confirmAddPartner());
  }, 0);
}

export async function confirmAddPartner() {
  const name = $('pName').value.trim();
  if (!name) {
    toast(t('toast.partner_name_required'), 'error');
    $('pName').focus();
    return;
  }
  try {
    await api('POST', 'api/partners', { name });
    if (typeof window.refreshPartners === 'function') {
      await window.refreshPartners();
    }
    $('pList').innerHTML = partnerListHtml();
    $('pName').value = '';
    $('pName').focus();
    toast(t('toast.added', { name }), 'success');
    if (typeof window.refreshSamples === 'function') {
      window.refreshSamples();
    }
  } catch (e) {
    toast(t('toast.partner_add_failed', { error: e.message }), 'error');
  }
}

export async function deletePartner(id) {
  // Fetch count first so the user sees how many samples are about to
  // become unassigned. Cheap (single COUNT query). Falls back to the
  // generic confirm if the count endpoint blips.
  let count = null;
  try {
    const r = await api('GET', 'api/partners/' + id + '/samples-count');
    count = r && typeof r.count === 'number' ? r.count : null;
  } catch (_e) {
    /* fall back to generic confirm */
  }
  const message =
    count != null && count > 0
      ? t('confirm.delete_partner_with_count', { count })
      : t('confirm.delete_partner');
  if (!confirm(message)) return;
  try {
    await api('DELETE', 'api/partners/' + id);
    if (typeof window.refreshPartners === 'function') {
      await window.refreshPartners();
    }
    $('pList').innerHTML = partnerListHtml();
    toast(t('toast.partner_deleted'), 'success');
    if (typeof window.refreshSamples === 'function') {
      window.refreshSamples();
    }
  } catch (e) {
    toast(t('toast.partner_delete_failed', { error: e.message }), 'error');
  }
}

// Expose for the dispatcher in spyglass.app.js. The dispatcher does:
//   await import('/modules/partners/index.js'); window.openPartnerModal();
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader, assignments are no-ops.
window.openPartnerModal = openPartnerModal;
window.confirmAddPartner = confirmAddPartner;
window.deletePartner = deletePartner;
