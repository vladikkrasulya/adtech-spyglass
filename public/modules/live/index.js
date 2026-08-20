/* ============================================================
   modules/live/index.js — Live tool (lazy-loaded ES module).

   Opens an EventSource on /api/v1/stream and renders an
   auto-trimming list of incoming RTB specimens. Click a row to
   load it into the matching editor (BidRequest if `imp[]` is
   present, BidResponse if `seatbid[]` is present) and close the
   modal.

   Loaded ONLY when the user clicks the "live" button — see the
   lazy stub in ortbtools.app.js dispatcher (case 'live'). On first
   click: ~7KB across this file + i18n.js. On subsequent clicks:
   cached by the module loader, zero extra fetch.

   ── This is the SECOND live feed in the product ──────────────────
   public/modules/stream/ owns /live: the same SSE endpoint, a
   hundred rows instead of fifty, grading, filters, replay marking,
   its own reconnect. This modal predates it and survives only
   because the Inspector's Tools ▾ menu still offers it (#liveBtn in
   modules/inspector/template.{en,uk,ru}.html, dispatched from
   ortbtools.app.js). Two viewers open at once also spend two of the
   eight per-IP SSE slots. Retiring the button — and this file with
   it — is the real fix; until someone owns those two files, the
   rules here are kept in step with stream/index.js rather than
   allowed to drift further apart.

   Exposed window APIs (consumed by ortbtools.app.js dispatcher
   cases 'live-pause' and 'live-load'):
     - window.openLiveModal()              — entry point
     - window.__ortbtoolsLivePauseToggle    — toggles paused state
                                             from outside the modal
                                             body. Cleared on close.
     - window.__ortbtoolsLiveSpecimens      — Map<rowId, specimen>
                                             so the dispatcher's
                                             'live-load' case can
                                             resolve a clicked row
                                             id back to its raw
                                             JSON. Cleared on close.

   Consumes (via /core/utils.js ES imports + globals):
     - $, escapeHtml, t           — DOM + i18n helpers
     - window.closeModal          — modal lifecycle. We still wrap it,
                                    but the EventSource teardown hangs
                                    off a MutationObserver on #modalRoot
                                    instead: modal-host.js closes via its
                                    own module-local binding, so wrapping
                                    the global alone missed Escape and
                                    backdrop and leaked the stream. See
                                    the teardown block below.

   Note: toast() lives in the dispatcher's 'live-load' case (in
   ortbtools.app.js, which already imports it). The modal body
   itself never toasts — connection failures show up inline in
   #mLiveStatus.
   ============================================================ */
import { $, escapeHtml, t } from '/core/utils.js';

export function openLiveModal() {
  const STREAM_MAX_ROWS = 50;
  let paused = false;
  // Specimens kept in a JS map keyed by monotonic id rather than crammed
  // into a data-* attribute. utils.escapeHtml uses text-node serialisation
  // which escapes &<> but not " — putting raw JSON in data-specimen would
  // close the attribute on the first internal quote.
  const specimens = new Map();
  let rowSeq = 0;

  /** The document's locale, for Intl. Falls back the way window.t does. */
  function activeLocale() {
    const l = document.documentElement.getAttribute('lang');
    return l === 'en' || l === 'uk' || l === 'ru' ? l : 'uk';
  }

  /**
   * Which side of the auction a specimen is, and where its body lives.
   *
   * oRTB 3.0 wraps both sides in { openrtb: { request | response } }, so a
   * check for a top-level `imp` / `seatbid` misses them entirely: every 3.0
   * payload on the feed showed "?" in this modal while /live named it. Same
   * rule as public/modules/stream/index.js shapeOf() — see the note in this
   * file's header about the two implementations.
   */
  function shapeOf(spec) {
    const env = spec && spec.openrtb;
    if (env && typeof env === 'object') {
      if (env.request && typeof env.request === 'object') return { kind: 'req', body: env.request };
      if (env.response && typeof env.response === 'object')
        return { kind: 'res', body: env.response };
      return { kind: '?', body: env };
    }
    if (Array.isArray(spec && spec.imp)) return { kind: 'req', body: spec };
    if (Array.isArray(spec && spec.seatbid)) return { kind: 'res', body: spec };
    return { kind: '?', body: spec || {} };
  }

  /** "300×250" off the first banner slot, in either oRTB generation. */
  function bannerHint(body) {
    const items = Array.isArray(body.imp) ? body.imp : Array.isArray(body.item) ? body.item : [];
    const first = items[0];
    if (!first || typeof first !== 'object') return '';
    const slot = first.spec && first.spec.placement ? first.spec.placement : first;
    const b = slot.banner || slot.display;
    if (!b || typeof b !== 'object') return '';
    if (b.w && b.h) return `${b.w}×${b.h}`;
    if (Array.isArray(b.format) && b.format[0] && b.format[0].w && b.format[0].h)
      return `${b.format[0].w}×${b.format[0].h}`;
    return '';
  }

  function rowHtml(env) {
    let time;
    try {
      time = new Date(env.emittedAt || Date.now()).toLocaleTimeString(activeLocale(), {
        hour12: false,
      });
    } catch (_) {
      time = new Date(env.emittedAt || Date.now()).toTimeString().slice(0, 8);
    }
    const source = String(env.source || '?');
    const spec = env.specimen || {};
    const id = ++rowSeq;
    specimens.set(id, spec);
    const shape = shapeOf(spec);
    const kind = shape.kind;
    const sizeHint = kind === 'req' ? bannerHint(shape.body) : '';
    return (
      '<div class="kt-live-row" data-action="live-load" data-row-id="' +
      id +
      '" data-kind="' +
      kind +
      '">' +
      '<span class="kt-live-time">' +
      escapeHtml(time) +
      '</span>' +
      '<span class="kt-live-kind kt-live-kind-' +
      kind +
      '">' +
      kind +
      '</span>' +
      '<span class="kt-live-source">' +
      escapeHtml(source) +
      '</span>' +
      (sizeHint ? '<span class="kt-live-size">' + escapeHtml(sizeHint) + '</span>' : '') +
      '</div>'
    );
  }
  // Expose the lookup so the dispatcher's 'live-load' case can resolve
  // a row id to its specimen (cleaned up on tearDownLive).
  window.__ortbtoolsLiveSpecimens = specimens;

  function renderShell() {
    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
      '<div class="modal-card modal-card-wide kt-live-card">' +
      '<div class="modal-title">' +
      escapeHtml(t('modal.live.title')) +
      ' <span class="kt-live-status" id="mLiveStatus">' +
      escapeHtml(t('modal.live.connecting')) +
      '</span></div>' +
      '<div class="modal-row kt-live-controls">' +
      '<button class="btn btn-ghost btn-sm" id="mLivePauseBtn" data-action="live-pause">' +
      escapeHtml(t('modal.live.pause')) +
      '</button>' +
      '<span class="kt-live-hint">' +
      escapeHtml(t('modal.live.hint')) +
      '</span>' +
      '</div>' +
      '<div class="kt-live-list" id="mLiveList"><div class="kt-live-empty">' +
      escapeHtml(t('modal.live.empty')) +
      '</div></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
      t('btn.close') +
      '</button></div>' +
      '</div></div>';
  }

  renderShell();

  let es;
  try {
    es = new EventSource('/api/v1/stream');
  } catch (e) {
    const status = $('mLiveStatus');
    if (status) status.textContent = '✗ ' + e.message;
    return;
  }

  es.addEventListener('open', () => {
    const status = $('mLiveStatus');
    if (status) {
      status.textContent = t('modal.live.connected');
      status.classList.add('kt-live-status-on');
    }
  });

  es.addEventListener('error', () => {
    const status = $('mLiveStatus');
    if (status) {
      status.textContent = t('modal.live.connection_lost');
      status.classList.remove('kt-live-status-on');
    }
  });

  es.addEventListener('message', (ev) => {
    if (paused) return;
    let env;
    try {
      env = JSON.parse(ev.data);
    } catch {
      return;
    }
    const list = $('mLiveList');
    if (!list) return;
    const empty = list.querySelector('.kt-live-empty');
    if (empty) empty.remove();
    list.insertAdjacentHTML('afterbegin', rowHtml(env));
    // trim oldest beyond cap; also drop their specimens from the map.
    const rows = list.querySelectorAll('.kt-live-row');
    for (let i = STREAM_MAX_ROWS; i < rows.length; i++) {
      const droppedId = Number(rows[i].dataset.rowId);
      if (droppedId) specimens.delete(droppedId);
      rows[i].remove();
    }
  });

  // ── Close hook — tear the stream down on EVERY close path ────────────
  //
  // This used to be a patch on window.closeModal alone, with a comment
  // promising it caught "any close path (Esc, backdrop, button, follow-up
  // modal)". It caught none of the interesting ones. /core/modal-host.js
  // closes modals through its own MODULE-LOCAL `closeModal` binding:
  // bindEscape() calls `closeModal()`, and the 'modal-backdrop-close' /
  // 'modal-close' dispatcher cases call `closeModal()`. `window.closeModal =
  // closeModal` at install time is a separate reference for outside callers,
  // so reassigning the global never intercepted the host's own close.
  //
  // The result was an EventSource that outlived its modal. Escape or a click
  // on the backdrop emptied #modalRoot and left the socket connected for the
  // lifetime of the tab: the server kept a per-connection SSE slot open, a
  // few open/close cycles walked into the stream endpoint's connection cap,
  // and every abandoned stream went on firing 'message' — writing rows into
  // whichever live modal was on screen next, because $('mLiveList') resolves
  // by id against whatever DOM exists now, not the DOM this closure was born
  // in.
  //
  // So watch the DOM instead of trying to enumerate the exits. #modalRoot is
  // permanent chrome and every close path ends the same way — its contents
  // are cleared or replaced — which makes "is our card still in the document"
  // one question that answers all of them at once, including a follow-up
  // modal that replaces ours without closing anything.
  const modalRoot = $('modalRoot');
  const liveCard = modalRoot ? modalRoot.querySelector('.kt-live-card') : null;
  const origClose = window.closeModal;
  let observer = null;
  let teardown = false;
  function tearDownLive() {
    if (teardown) return;
    teardown = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    try {
      es.close();
    } catch {
      /* idempotent */
    }
    specimens.clear();
    // Only hand the global back if it is still ours. Restoring
    // unconditionally would clobber a later patcher's version.
    if (window.closeModal === patchedClose) window.closeModal = origClose;
    window.__ortbtoolsLivePauseToggle = null;
    window.__ortbtoolsLiveSpecimens = null;
  }

  // window.MutationObserver rather than the bare global, for the same reason
  // modal-host.js reaches for it that way: the jsdom harness the regression
  // tests run in aliases browser APIs onto its fake window, not onto
  // globalThis.
  const MO = window.MutationObserver;
  if (MO && liveCard) {
    observer = new MO(() => {
      if (!liveCard.isConnected) tearDownLive();
    });
    observer.observe(modalRoot, { childList: true, subtree: true });
  }

  // Kept as the belt to the observer's braces: it is the only teardown left
  // in an environment without MutationObserver, and it makes the close paths
  // that DO go through the global synchronous rather than microtask-deferred.
  // tearDownLive() is idempotent, so both firing is a no-op.
  function patchedClose() {
    tearDownLive();
    return origClose.apply(this, arguments);
  }
  window.closeModal = patchedClose;

  // Pause/resume toggle exposed for the dispatcher.
  window.__ortbtoolsLivePauseToggle = () => {
    paused = !paused;
    const btn = $('mLivePauseBtn');
    const status = $('mLiveStatus');
    if (btn) btn.textContent = paused ? t('modal.live.resume') : t('modal.live.pause');
    if (status) {
      status.textContent = paused ? t('modal.live.paused') : t('modal.live.connected');
      status.classList.toggle('kt-live-status-on', !paused);
    }
  };
}

// Expose for the dispatcher in ortbtools.app.js. The dispatcher does:
//   await import('/modules/live/index.js'); window.openLiveModal();
// — first call: fetches + evaluates + this assignment runs.
// Subsequent calls: cached by the module loader, this assignment is a no-op.
window.openLiveModal = openLiveModal;
