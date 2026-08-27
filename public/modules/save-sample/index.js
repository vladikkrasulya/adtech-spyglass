/* ============================================================
   modules/save-sample/index.js — Save-sample modal
   (lazy-loaded ES module).

   The library "save / update" modal: title + partner picker + notes,
   plus a live partner-inference banner backed by deterministic
   server-side domain/bundle rules. The save/update request encrypts
   blobs locally via the OrtbtoolsSession facade BEFORE POSTing, so the
   sample API stores only ciphertext. Partner inference is separate: it
   may POST the raw bid_req / bid_res to the ortbtools server for
   transient processing. That endpoint does not persist the bodies, and
   no external model receives them.

   Loaded ONLY when the user clicks the "💾 зберегти" button — see
   the lazy stub in ortbtools.app.js dispatcher (case 'save-sample').
   On first click: ~6KB across this file + i18n.js. On subsequent
   clicks: cached by the module loader, zero extra fetch.

   Exposed window APIs (consumed by ortbtools.app.js dispatcher):
     - window.openSaveModal()        — entry point, called by
                                        case 'save-sample'.
     - window.confirmSave(opts)      — called by case 'confirm-save'
                                        from the modal's primary /
                                        save-as-new buttons.
     - window._spy_pickPartner(id)   — partner-suggest banner action,
                                        called by 'hint-pick-partner'.
     - window._spy_createPartner(n)  — partner-suggest banner action,
                                        called by 'hint-create-partner'.

   Consumes (via /core/utils.js ES imports + window globals):
     - $, escapeHtml, toast, t       — DOM + i18n helpers
     - window.closeModal             — modal lifecycle
     - window.openAuthModal          — auth-gate fallback for guests
     - window.OrtbtoolsSession        — round-5 facade (commit 42130f6).
                                        Provides ALL state + crypto
                                        access (no closure imports).

   OrtbtoolsSession surface used (~12 methods):
     user, currentSampleId / setCurrentSampleId,
     currentSampleMeta / setCurrentSampleMeta,
     setDirty, partnerCache,
     api(), refreshPartners(), refreshSamples(),
     partnerOptionsHtml(), wireEnterSubmit(),
     hasSession, encryptBlob().

   IMPORTANT: never asks for raw DEK bytes — encryptBlob() runs the
   AES-GCM op inside the facade with the closure-private key.

   Auth gate: openSaveModal() checks OrtbtoolsSession.user up front
   and bounces guests through openAuthModal('login') — guests never
   see the modal. confirmSave() additionally verifies hasSession()
   before encrypting (defence in depth: if the DEK was cleared mid-
   flight, e.g. by a sign-out from another tab, fail loud rather than
   POST plaintext).
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

export function openSaveModal() {
  const S = window.OrtbtoolsSession;
  if (!S.user) {
    // Phase 9b auth-gate: surface an explanatory toast BEFORE opening
    // the auth modal so guests understand WHY they're being redirected
    // (previously the modal opened silently and felt like a non-sequitur).
    // Toast is non-blocking; auth modal still takes focus immediately.
    toast(t('toast.signin_to_save'), 'info');
    // Auth is itself a lazy module since 2026-05-10 — prefer the
    // lazy entrypoint exposed by ortbtools.app.js so guests don't
    // hit a no-op when window.openAuthModal isn't wired yet. Falls
    // back to the direct call if (somehow) lazyOpenAuth is missing.
    if (typeof window.lazyOpenAuth === 'function') {
      window.lazyOpenAuth('login');
    } else if (typeof window.openAuthModal === 'function') {
      window.openAuthModal('login');
    }
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
  const currentSampleId = S.currentSampleId;
  const currentSampleMeta = S.currentSampleMeta;
  const updating = !!currentSampleId && !!currentSampleMeta;
  let title;
  let presetPartner;
  let presetNotes;
  if (updating) {
    title = currentSampleMeta.title || t('sample.default_title');
    presetPartner = currentSampleMeta.partner_id;
    presetNotes = currentSampleMeta.notes || '';
  } else {
    title = (() => {
      try {
        const j = JSON.parse(reqVal);
        return j.id || j.site?.domain || j.app?.bundle || t('sample.default_title');
      } catch {
        return t('sample.default_title');
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
  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
    '<div class="modal-card">' +
    '<div class="modal-title">' +
    escapeHtml(headerText) +
    '</div>' +
    '<div class="modal-row"><label for="mTitle">' +
    t('sample.label.title') +
    '</label><input id="mTitle" type="text" value="' +
    escapeHtml(String(title)) +
    '"></div>' +
    '<div class="modal-row"><label for="mPartner">' +
    t('sample.label.partner') +
    '</label><select id="mPartner">' +
    S.partnerOptionsHtml(presetPartner) +
    '</select>' +
    // Phase C-1: live partner-inference banner. Populated async by
    // suggestPartnerForSave() once the save modal is mounted.
    '<div id="mPartnerHint" class="modal-hint" hidden></div>' +
    '</div>' +
    '<div class="modal-row"><label for="mNotes">' +
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
  bindHintActions();
  setTimeout(() => {
    $('mTitle').focus();
    S.wireEnterSubmit('mTitle', () => window.confirmSave());
    // Phase C-1: kick off partner inference in the background. Result
    // (or absence of result) populates #mPartnerHint without blocking
    // the user — they can submit immediately, suggestion just upgrades
    // the UX when it lands. Skip on update flow where partner is set.
    if (!presetPartner) suggestPartnerForSave();
  }, 0);
}

// ── Partner-hint actions: a local #modalRoot listener ────────────────────
// The two buttons the suggestion banner draws — "use the partner we matched"
// and "create it" — were DEAD from the day the banner shipped, and dead in a
// way nothing could report: they carry data-action, they look exactly like
// every other button in the app, and the click simply reached no handler.
//
// The reason is structural. mountInspector's delegated dispatcher (the one
// that owns the ~90 data-action verbs of the workbench) is bound to #app-root,
// and since ROADMAP #18 moved modal chrome up to the shell, #modalRoot is a
// SIBLING of #app-root — index.*.html closes </main> and only then declares
// <div id="modalRoot">. So no click inside any modal bubbles to that
// dispatcher, ever. Modal verbs are handled by /core/modal-host.js's own
// #modalRoot-scoped dispatcher (which is why 'confirm-save' and 'modal-close'
// on this same card work fine), and these two are not in its case list —
// deliberately, since they are this module's private business and the host
// deliberately only relocates the verbs it must.
//
// Hence a local listener, the same shape openBuilder() in
// /modules/inspector/dialect-label.js uses for its own modal: delegated off
// #modalRoot, matching only our two verbs, ignoring everything else that
// bubbles through it.
//
// Bound once. #modalRoot is PERMANENT chrome — closeModal() clears its
// innerHTML but never replaces the node — so a listener attached to it is not
// torn down when the modal closes, and re-binding on every openSaveModal()
// would give the fifth save modal five live copies of this handler and five
// POSTs to /api/partners from one click on "create". The module itself is a
// singleton (the ES module loader caches it after the first lazy import), so
// module scope is exactly the right lifetime for the flag.
let _hintActionsBound = false;
function bindHintActions() {
  if (_hintActionsBound) return;
  const root = $('modalRoot');
  if (!root) return;
  _hintActionsBound = true;
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const action = el.dataset.action;
    if (action === 'hint-pick-partner') {
      pickPartner(el.dataset.id);
      return;
    }
    if (action === 'hint-create-partner') {
      createPartnerFromHint(el.dataset.name || '');
      return;
    }
  });
}

// Phase C-1: ask the deterministic server-side rules engine to identify
// the SSP / vendor from domain and bundle signals in bid_req / bid_res.
// Privacy boundary: these raw bodies are POSTed to the ortbtools server,
// processed transiently, and not persisted by this endpoint; no external
// model receives them. Banner offers two paths: pick an existing partner
// with the same name, OR create + select a new one. Failures or no signal
// silently leave the banner hidden — never disrupt the save flow.
async function suggestPartnerForSave() {
  const S = window.OrtbtoolsSession;
  const banner = $('mPartnerHint');
  if (!banner) return;
  const bid_req = $('bidReq').value || '';
  const bid_res = $('bidRes').value || '';
  if (!bid_req.trim() && !bid_res.trim()) return;
  let j;
  try {
    j = await S.api('POST', 'api/intel/suggest-partner', { bid_req, bid_res });
  } catch (_e) {
    return; // Request failure, rate limit, etc. — silent fallback.
  }
  if (!j || !j.suggestion || !j.suggestion.name) return;
  const name = j.suggestion.name;
  const conf = j.suggestion.confidence || 'medium';
  // Match against existing partners (case-insensitive).
  const existing = (S.partnerCache || []).find((p) => p.name.toLowerCase() === name.toLowerCase());
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

// Partner-suggest banner action: user picked the existing partner the
// rules engine matched. Just sets the <select> value and hides the banner.
export function pickPartner(id) {
  const sel = $('mPartner');
  if (sel) sel.value = String(id);
  const banner = $('mPartnerHint');
  if (banner) banner.hidden = true;
}

// Partner-suggest banner action: user accepted the rules engine's "create new"
// suggestion. POSTs the new partner, refreshes the cache, re-renders
// the <select> with the new partner pre-selected.
export async function createPartnerFromHint(name) {
  const S = window.OrtbtoolsSession;
  try {
    await S.api('POST', 'api/partners', { name });
    // Refresh the shared partner cache so other surfaces (library
    // filter, save-modal picker on next open) see the new row.
    await S.refreshPartners();
    const created = (S.partnerCache || []).find((p) => p.name.toLowerCase() === name.toLowerCase());
    const sel = $('mPartner');
    if (sel) {
      sel.innerHTML = S.partnerOptionsHtml(created ? created.id : null);
    }
    const banner = $('mPartnerHint');
    if (banner) banner.hidden = true;
    toast(t('toast.partner_created', { name }), 'success');
  } catch (e) {
    toast(t('toast.send_failed', { error: e.message || '' }), 'error');
  }
}

export async function confirmSave(opts) {
  const S = window.OrtbtoolsSession;
  if (!S.hasSession()) {
    toast(t('toast.crypto_session_lost'), 'error');
    return;
  }
  const asNew = !!(opts && opts.asNew);
  const currentSampleId = S.currentSampleId;
  const currentSampleMeta = S.currentSampleMeta;
  const updating = !asNew && !!currentSampleId;
  let title = $('mTitle').value.trim() || t('sample.default_title');
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
    // Facade owns the DEK; we only ever pass plaintext + receive {iv, ct}.
    const encReq = await S.encryptBlob(bid_req);
    const encRes = await S.encryptBlob(bid_res);
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
      saved = await S.api('PATCH', 'api/samples/' + currentSampleId, payload);
      toast(t('toast.updated', { title }), 'success');
    } else {
      saved = await S.api('POST', 'api/samples', payload);
      // After save-as-new (or first save), track the new id so subsequent
      // saves keep updating instead of duplicating.
      if (saved && saved.sample) {
        S.setCurrentSampleId(saved.sample.id);
        S.setCurrentSampleMeta({
          title,
          partner_id: payload.partner_id,
          notes,
        });
      }
      toast(t('toast.saved', { title }), 'success');
    }
    // Bring the cached meta in sync with whatever the user just wrote.
    if (updating) {
      S.setCurrentSampleMeta({ title, partner_id: payload.partner_id, notes });
    }
    S.setDirty(false);
    window.closeModal();
    S.refreshSamples();
  } catch (e) {
    // Special case: the picker showed a partner that another tab just
    // deleted. Refresh the partner cache so the picker doesn't keep
    // offering the dead row, and tell the user specifically.
    if (e.code === 'partner_not_found') {
      toast(t('toast.partner_gone'), 'error');
      try {
        await S.refreshPartners();
      } catch (_) {
        /* swallow */
      }
      return;
    }
    toast(t('toast.save_failed', { error: e.message }), 'error');
  }
}

// Expose for the dispatcher in ortbtools.app.js. The dispatcher does:
//   await import('/modules/save-sample/index.js'); window.openSaveModal();
// — first call: fetches + evaluates + these assignments run.
// Subsequent calls: cached by the module loader, the assignments are no-ops.
window.openSaveModal = openSaveModal;
window.confirmSave = confirmSave;
window._spy_pickPartner = pickPartner;
window._spy_createPartner = createPartnerFromHint;
