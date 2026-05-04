/* ============================================================
   Spyglass embed mode.

   Two roles:

   1. PRODUCING the embed: opens a modal where the user copies an
      <iframe> snippet pointing at the current bid via the share-link
      URL primitive (`?embed=1#req=…&res=…`). Reuses share.js's
      buildShareUrl + appends `?embed=1` so the loaded view strips
      chrome.

   2. RENDERING the embed: when the URL has `?embed=1`, the inline
      head-IIFE in each HTML file already sets `data-embed="1"` on
      the documentElement. CSS gated on that attribute hides the
      header / input panels / left sidebar / footer / theme-toggle
      and tightens the layout for in-iframe display.

   No external deps. Loads after share.js so it can call
   window.buildShareUrl.
   ============================================================ */
(function () {
  'use strict';

  function tt(key, params) {
    return typeof window.t === 'function' ? window.t(key, params) : '[' + key + ']';
  }
  function toastErr(msg) {
    if (typeof window.toast === 'function') window.toast(msg, 'error');
  }
  function toastOk(msg) {
    if (typeof window.toast === 'function') window.toast(msg, 'success');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildSnippet(url, width, height) {
    return (
      '<iframe\n' +
      '  src="' +
      url +
      '"\n' +
      '  width="' +
      width +
      '"\n' +
      '  height="' +
      height +
      '"\n' +
      '  style="border:1px solid #ccc;border-radius:8px;max-width:100%"\n' +
      '  loading="lazy"\n' +
      '  title="Spyglass · OpenRTB inspector"\n' +
      '></iframe>'
    );
  }

  async function openEmbedModal() {
    if (typeof window.buildShareUrl !== 'function') {
      toastErr(tt('toast.share_unsupported'));
      return;
    }
    if (window.spyglassShareSupported && !window.spyglassShareSupported()) {
      toastErr(tt('toast.share_unsupported'));
      return;
    }
    const reqText = (document.getElementById('bidReq') || {}).value || '';
    const resText = (document.getElementById('bidRes') || {}).value || '';
    if (!reqText.trim() && !resText.trim()) {
      toastErr(tt('toast.nothing_to_analyze'));
      return;
    }

    let shareUrl;
    try {
      shareUrl = await window.buildShareUrl(reqText, resText);
    } catch (e) {
      toastErr(tt('toast.share_link_failed', { error: e.message || String(e) }));
      return;
    }
    // Append `?embed=1` — share.js builds with `/?#req=…`, we slot embed=1
    // into the existing query.
    const embedUrl = shareUrl.replace('/?#', '/?embed=1#');
    if (embedUrl.length > 7000) {
      toastErr(tt('toast.share_link_too_long', { size: embedUrl.length }));
      return;
    }

    const root = document.getElementById('modalRoot');
    if (!root) return;
    const initialW = '100%';
    const initialH = '600';
    const snippet = buildSnippet(embedUrl, initialW, initialH);

    root.innerHTML =
      '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal-card" style="max-width:680px;width:92vw">' +
      '<div class="modal-title">' +
      escapeHtml(tt('embed.title')) +
      '</div>' +
      '<div style="font-size:13px;color:var(--text-dim);margin-bottom:var(--space-3);line-height:1.5">' +
      escapeHtml(tt('embed.body')) +
      '</div>' +
      '<div class="modal-row">' +
      '<label>' +
      escapeHtml(tt('embed.label.height')) +
      '</label>' +
      '<select id="embedHeight">' +
      '<option value="400">400</option>' +
      '<option value="600" selected>600</option>' +
      '<option value="800">800</option>' +
      '<option value="1000">1000</option>' +
      '</select>' +
      '</div>' +
      '<div class="modal-row">' +
      '<label>' +
      escapeHtml(tt('embed.label.snippet')) +
      '</label>' +
      '<textarea id="embedSnippet" rows="7" readonly style="font-family:var(--font-mono);font-size:12px">' +
      escapeHtml(snippet) +
      '</textarea>' +
      '</div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()">' +
      escapeHtml(tt('btn.close')) +
      '</button>' +
      '<button class="btn btn-primary btn-sm" onclick="window._copyEmbedSnippet()">' +
      escapeHtml(tt('embed.btn.copy')) +
      '</button>' +
      '</div></div></div>';

    const ta = document.getElementById('embedSnippet');
    const sel = document.getElementById('embedHeight');
    sel.addEventListener('change', () => {
      ta.value = buildSnippet(embedUrl, '100%', sel.value);
    });
    setTimeout(() => {
      ta.focus();
      ta.select();
    }, 0);
  }

  window._copyEmbedSnippet = async function () {
    const ta = document.getElementById('embedSnippet');
    if (!ta) return;
    try {
      await navigator.clipboard.writeText(ta.value);
      toastOk(tt('embed.toast.copied'));
    } catch {
      ta.select();
      // Fallback: keep the modal open so the user can copy manually.
      toastErr(tt('toast.share_link_manual_copy'));
    }
  };

  window.openEmbedModal = openEmbedModal;
})();
