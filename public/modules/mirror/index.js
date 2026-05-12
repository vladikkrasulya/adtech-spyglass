/* ============================================================
   modules/mirror/index.js — Mirror tool (lazy-loaded ES module).

   Generates the canonical counterpart for any pasted BidRequest /
   BidResponse, runs validate+crosscheck on the result (self-test),
   and shows a structural diff between the user's version and the
   canonical one when both panes are populated.

   Loaded ONLY when the user clicks the "дзеркало ↔" button — see
   the lazy stub in spyglass.app.js dispatcher (case 'mirror').
   On first click: ~30KB across this file + i18n.js. On subsequent
   clicks: cached by the module loader, zero extra fetch.

   Exposed window APIs (consumed by spyglass.app.js dispatcher for
   the modal's mirror-copy / mirror-load / mirror-mode-change /
   mirror-share buttons):
     - window.openMirrorModal()        — entry point
     - window.__spyglassMirrorRefetch  — closure called when user
                                          flips mode radio (minimal /
                                          best-practice). Exposed as
                                          a getter — spy gets the
                                          *current* refetch fn even
                                          across re-opens.

   Consumes (via /core/utils.js ES imports + globals):
     - $, escapeHtml, toast, t   — DOM + i18n helpers
     - window.closeModal          — modal lifecycle
     - window.buildShareUrl       — provided by modules/share/ when present
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

// Compact one-deep JSON diff for the mirror modal. Top-level keys
// only (deeper subtrees are stringified as leaves), three change
// kinds: changed (≠), added by mirror (+), missing in mirror (−).
// Returns an array of pre-escaped HTML rows.
function diffJsonForMirror(userObj, mirrorObj) {
  const rows = [];
  const u = userObj && typeof userObj === 'object' ? userObj : {};
  const m = mirrorObj && typeof mirrorObj === 'object' ? mirrorObj : {};
  const keys = new Set([...Object.keys(u), ...Object.keys(m)]);
  const sortedKeys = Array.from(keys).sort();
  for (const k of sortedKeys) {
    const inU = Object.prototype.hasOwnProperty.call(u, k);
    const inM = Object.prototype.hasOwnProperty.call(m, k);
    if (inU && inM) {
      const a = JSON.stringify(u[k]);
      const b = JSON.stringify(m[k]);
      if (a === b) continue; // same — skip silently
      rows.push(
        '<div class="kt-diff-row kt-diff-changed">' +
          '<span class="kt-diff-marker">≠</span>' +
          '<span class="kt-diff-key">' +
          escapeHtml(k) +
          '</span>' +
          '<span class="kt-diff-side kt-diff-yours" title="yours">' +
          escapeHtml(truncate(a, 120)) +
          '</span>' +
          '<span class="kt-diff-arrow">→</span>' +
          '<span class="kt-diff-side kt-diff-canon" title="canonical">' +
          escapeHtml(truncate(b, 120)) +
          '</span>' +
          '</div>',
      );
    } else if (inM && !inU) {
      rows.push(
        '<div class="kt-diff-row kt-diff-added">' +
          '<span class="kt-diff-marker">+</span>' +
          '<span class="kt-diff-key">' +
          escapeHtml(k) +
          '</span>' +
          '<span class="kt-diff-side kt-diff-canon">' +
          escapeHtml(truncate(JSON.stringify(m[k]), 120)) +
          '</span>' +
          '</div>',
      );
    } else {
      rows.push(
        '<div class="kt-diff-row kt-diff-missing">' +
          '<span class="kt-diff-marker">−</span>' +
          '<span class="kt-diff-key">' +
          escapeHtml(k) +
          '</span>' +
          '<span class="kt-diff-side kt-diff-yours">' +
          escapeHtml(truncate(JSON.stringify(u[k]), 120)) +
          '</span>' +
          '</div>',
      );
    }
  }
  return rows;
}

function truncate(s, n) {
  return s == null ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export async function openMirrorModal() {
  const reqVal = ($('bidReq').value || '').trim();
  const resVal = ($('bidRes').value || '').trim();
  if (!reqVal && !resVal) {
    toast(t('toast.nothing_to_mirror'), 'error');
    return;
  }

  let parsedReq = null;
  let parsedRes = null;
  try {
    if (reqVal) parsedReq = JSON.parse(reqVal);
    if (resVal) parsedRes = JSON.parse(resVal);
  } catch (_e) {
    toast(t('toast.mirror_invalid_json'), 'error');
    return;
  }

  // Source/target derivation. When both are present we mirror from
  // bidReq → bidRes (the more common direction for "is my response
  // shaped right?") and diff against the user's real bidRes.
  const haveBoth = !!(parsedReq && parsedRes);
  const sourceInput = parsedReq || parsedRes;
  const targetField = parsedReq ? 'bidRes' : 'bidReq';
  const userCounterpart = haveBoth ? (parsedReq ? parsedRes : parsedReq) : null;

  let currentMode = 'minimal';

  function loadingTemplate() {
    return (
      '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
      '<div class="modal-card modal-card-wide">' +
      '<div class="modal-title">' +
      escapeHtml(t('modal.mirror.title')) +
      '</div>' +
      '<div class="modal-row"><div class="kt-mirror-loading"><span class="spinner"></span> ' +
      escapeHtml(t('modal.mirror.loading')) +
      '</div></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-action="modal-close">' +
      t('btn.cancel') +
      '</button></div></div></div>'
    );
  }

  async function fetchAndRender() {
    $('modalRoot').innerHTML = loadingTemplate();
    let result;
    try {
      const r = await fetch('/api/v1/mirror', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: sourceInput, mode: currentMode }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'mirror_failed');
      result = j.result;
    } catch (err) {
      $('modalRoot').innerHTML =
        '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
        '<div class="modal-card">' +
        '<div class="modal-title">' +
        escapeHtml(t('modal.mirror.title')) +
        '</div>' +
        '<div class="modal-row"><div class="finding finding-error">' +
        escapeHtml(t('modal.mirror.failed')) +
        ': ' +
        escapeHtml(String(err.message)) +
        '</div></div>' +
        '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-action="modal-close">' +
        t('btn.close') +
        '</button></div></div></div>';
      return;
    }
    renderResult(result);
  }

  function renderResult(result) {
    if (!result.ok) {
      const noteList = (result.notes || [])
        .map((n) => '<li>' + escapeHtml(n.msg || n.id) + '</li>')
        .join('');
      $('modalRoot').innerHTML =
        '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
        '<div class="modal-card">' +
        '<div class="modal-title">' +
        escapeHtml(t('modal.mirror.unsupported_title')) +
        '</div>' +
        '<div class="modal-row"><ul class="kt-mirror-notes">' +
        noteList +
        '</ul></div>' +
        '<div class="modal-actions"><button class="btn btn-ghost btn-sm" data-action="modal-close">' +
        t('btn.close') +
        '</button></div></div></div>';
      return;
    }

    const direction =
      result.direction === 'response_from_request'
        ? t('modal.mirror.dir.response_from_request')
        : t('modal.mirror.dir.request_from_response');
    const outputJson = JSON.stringify(result.output, null, 2);
    const noteList = (result.notes || [])
      .map((n) => '<li>' + escapeHtml(n.msg || n.id) + '</li>')
      .join('');
    const st = result.selfTest || { validate: {}, crosscheck: {} };
    const stChip =
      st.validate.errorCount === 0 && st.crosscheck.critCount === 0
        ? '<span class="kt-chip kt-chip-ok">' +
          escapeHtml(t('modal.mirror.selftest.clean')) +
          '</span>'
        : '<span class="kt-chip kt-chip-warn">' +
          escapeHtml(
            t('modal.mirror.selftest.dirty', {
              errors: st.validate.errorCount,
              crits: st.crosscheck.critCount,
            }),
          ) +
          '</span>';

    const modeChecked = (m) => (currentMode === m ? ' checked' : '');
    const modeRow =
      '<div class="modal-row"><label>' +
      escapeHtml(t('modal.mirror.mode_label')) +
      '</label>' +
      '<div class="kt-mirror-modes">' +
      '<label><input type="radio" name="mMirrorMode" value="minimal" data-action="mirror-mode-change"' +
      modeChecked('minimal') +
      '> ' +
      escapeHtml(t('modal.mirror.mode.minimal')) +
      '</label>' +
      '<label><input type="radio" name="mMirrorMode" value="best-practice" data-action="mirror-mode-change"' +
      modeChecked('best-practice') +
      '> ' +
      escapeHtml(t('modal.mirror.mode.best_practice')) +
      '</label>' +
      '</div></div>';

    let diffHtml = '';
    if (haveBoth && userCounterpart) {
      const diffRows = diffJsonForMirror(userCounterpart, result.output);
      if (diffRows.length) {
        diffHtml =
          '<div class="modal-row"><label>' +
          escapeHtml(t('modal.mirror.diff_label')) +
          '</label>' +
          '<div class="kt-mirror-diff">' +
          diffRows.join('') +
          '</div>' +
          '<div class="kt-mirror-diff-legend">' +
          escapeHtml(t('modal.mirror.diff_legend')) +
          '</div></div>';
      } else {
        diffHtml =
          '<div class="modal-row"><label>' +
          escapeHtml(t('modal.mirror.diff_label')) +
          '</label>' +
          '<div class="kt-mirror-diff-empty">' +
          escapeHtml(t('modal.mirror.diff_no_changes')) +
          '</div></div>';
      }
    }

    $('modalRoot').innerHTML =
      '<div class="modal-backdrop" data-action="modal-backdrop-close">' +
      '<div class="modal-card modal-card-wide">' +
      '<div class="modal-title">' +
      escapeHtml(t('modal.mirror.title')) +
      ' <small>· ' +
      escapeHtml(direction) +
      '</small></div>' +
      '<div class="modal-row">' +
      stChip +
      '</div>' +
      modeRow +
      '<div class="modal-row"><label>' +
      escapeHtml(t('modal.mirror.output_label')) +
      '</label>' +
      '<textarea id="mMirrorOutput" rows="14" readonly>' +
      escapeHtml(outputJson) +
      '</textarea>' +
      '</div>' +
      diffHtml +
      (noteList
        ? '<div class="modal-row"><label>' +
          escapeHtml(t('modal.mirror.notes_label')) +
          '</label>' +
          '<ul class="kt-mirror-notes">' +
          noteList +
          '</ul></div>'
        : '') +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" data-action="modal-close">' +
      t('btn.close') +
      '</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="mirror-copy">' +
      escapeHtml(t('modal.mirror.btn_copy')) +
      '</button>' +
      (typeof window.buildShareUrl === 'function'
        ? '<button class="btn btn-ghost btn-sm" data-action="mirror-share">' +
          escapeHtml(t('modal.mirror.btn_share')) +
          '</button>'
        : '') +
      '<button class="btn btn-primary btn-sm" data-action="mirror-load" data-target="' +
      targetField +
      '">' +
      escapeHtml(t('modal.mirror.btn_load')) +
      '</button>' +
      '</div>' +
      '</div></div>';
  }

  // Mode change handler is dispatched through spyglass.app.js's central
  // data-action listener (case 'mirror-mode-change'). We expose the
  // refetch function on a closure so the dispatcher can trigger it.
  window.__spyglassMirrorRefetch = (newMode) => {
    currentMode = newMode === 'best-practice' ? 'best-practice' : 'minimal';
    fetchAndRender();
  };

  await fetchAndRender();
}

// Expose for the dispatcher in spyglass.app.js. The dispatcher does:
//   await import('/modules/mirror/index.js'); window.openMirrorModal();
// — first call: fetches + evaluates + this assignment runs.
// Subsequent calls: cached by the module loader, this assignment is a no-op.
window.openMirrorModal = openMirrorModal;
