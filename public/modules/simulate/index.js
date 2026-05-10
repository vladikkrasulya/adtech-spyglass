/* ============================================================
   modules/simulate/index.js — Bid simulator (lazy-loaded ES module).

   POSTs the parsed BidRequest to /api/intel/simulate-bids and renders
   3 DSP strategies (aggressive / conservative / quality) side-by-side.
   Each strategy gets bid yes/no, price, and a one-sentence rationale.
   Best run with a non-trivial request loaded in #bidReq.

   Loaded ONLY when the user clicks the "🤖 симуляція" button — see
   the lazy stub in spyglass.app.js dispatcher (case 'sim-bids'). On
   first click: ~6KB across this file + i18n.js. On subsequent clicks:
   cached by the module loader, zero extra fetch.

   Exposed window APIs:
     - window.openSimBidsModal()   — entry point, called by dispatcher

   Consumes (via /core/utils.js ES imports + globals):
     - $, escapeHtml, toast, t   — DOM + i18n helpers
     - window.closeModal          — modal lifecycle (Esc handler in
                                    spyglass.app.js + data-action
                                    'modal-close' / 'modal-backdrop-close')

   Backend: /api/intel/simulate-bids — handler delegates to local
   gemma3:4b via Ollama (see packages/intel/intel-llm.js). On
   ollama_unavailable the modal renders a translated friendly error
   instead of the raw error string.
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

export async function openSimBidsModal() {
  const reqVal = ($('bidReq').value || '').trim();
  if (!reqVal) {
    toast(t('toast.simbids_no_request'), 'error');
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(reqVal);
  } catch (e) {
    toast(t('toast.simbids_invalid_json'), 'error');
    return;
  }

  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
    '<div class="modal-card modal-card-wide">' +
    '<div class="modal-title">' +
    escapeHtml(t('modal.simbids.title')) +
    '</div>' +
    '<div class="modal-row"><div class="kt-mirror-loading"><span class="spinner"></span> ' +
    escapeHtml(t('modal.simbids.loading')) +
    '</div></div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
    t('btn.cancel') +
    '</button></div></div></div>';

  let results;
  try {
    const r = await fetch('/api/intel/simulate-bids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bid_req: JSON.stringify(parsed) }),
    });
    const j = await r.json();
    if (!j.success) {
      const msg =
        j.code === 'ollama_unavailable'
          ? t('modal.simbids.ollama_down')
          : j.error || 'simulation_failed';
      $('modalRoot').innerHTML =
        '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
        '<div class="modal-card">' +
        '<div class="modal-title">' +
        escapeHtml(t('modal.simbids.title')) +
        '</div>' +
        '<div class="modal-row"><div class="finding finding-error">' +
        escapeHtml(msg) +
        '</div></div>' +
        '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-action="modal-close">' +
        t('btn.close') +
        '</button></div></div></div>';
      return;
    }
    results = j.strategies;
  } catch (e) {
    toast(t('toast.simbids_failed', { error: e.message }), 'error');
    return;
  }

  const rows = results
    .map((s) => {
      const cls = s.bid ? 'sim-bid-yes' : 'sim-bid-no';
      const priceStr = s.bid && s.price != null ? '$' + Number(s.price).toFixed(3) : '—';
      return (
        '<div class="sim-strategy ' +
        cls +
        '">' +
        '<div class="sim-strategy-head">' +
        '<span class="sim-strategy-label">' +
        escapeHtml(t('modal.simbids.strat.' + s.strategy)) +
        '</span>' +
        '<span class="sim-strategy-verdict">' +
        (s.bid ? t('modal.simbids.bid') : t('modal.simbids.pass')) +
        '</span>' +
        '<span class="sim-strategy-price">' +
        escapeHtml(priceStr) +
        '</span>' +
        '</div>' +
        '<div class="sim-strategy-reason">' +
        escapeHtml(s.reason || '') +
        '</div>' +
        '</div>'
      );
    })
    .join('');

  $('modalRoot').innerHTML =
    '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
    '<div class="modal-card modal-card-wide">' +
    '<div class="modal-title">' +
    escapeHtml(t('modal.simbids.title')) +
    '</div>' +
    '<div class="modal-row"><div class="sim-hint">' +
    escapeHtml(t('modal.simbids.hint')) +
    '</div></div>' +
    '<div class="modal-row"><div class="sim-strategies">' +
    rows +
    '</div></div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
    t('btn.close') +
    '</button></div></div></div>';
}

// Expose for the dispatcher in spyglass.app.js. The dispatcher does:
//   await import('/modules/simulate/index.js'); window.openSimBidsModal();
// — first call: fetches + evaluates + this assignment runs.
// Subsequent calls: cached by the module loader, this assignment is a no-op.
window.openSimBidsModal = openSimBidsModal;
