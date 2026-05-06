/* ============================================================
   Spyglass fragment-encoded permalink.

   Encodes the current BidRequest / BidResponse panes into a hash
   fragment URL so that the link, when opened, restores both panes
   and re-runs validation. Hash fragments NEVER reach the server,
   which preserves Spyglass's zero-knowledge posture.

   URL shape: spyglass.kyivtech.com.ua/?#req=<b64url(deflate(json))>&res=<...>

   Encoding pipeline:
     text → UTF-8 → CompressionStream('deflate-raw') → bytes → base64url

   Decoding pipeline (mirror):
     base64url → bytes → DecompressionStream('deflate-raw') → text

   Browser support: CompressionStream + deflate-raw is in Chrome 103+,
   Safari 16.4+, Firefox 113+. On older browsers we surface a toast
   pointing the user at the Download button (export.js) instead.

   On page load: if the hash carries `req=` or `res=`, decode and
   populate the panes, then call window.runAnalysis().
   ============================================================ */
(function () {
  'use strict';

  // Conservative cap to keep links pasteable in Slack / Discord / email.
  // Modern browsers tolerate 32KB+ URLs but chat clients often truncate.
  const URL_BUDGET = 7000;

  function hasCompressionStream() {
    return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
  }

  async function compress(text) {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(new TextEncoder().encode(text));
    writer.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }

  async function decompress(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return await new Response(ds.readable).text();
  }

  function b64uEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64uDecode(str) {
    const pad = (4 - (str.length % 4)) % 4;
    const s = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function toastErr(msg) {
    if (typeof window.toast === 'function') window.toast(msg, 'error');
  }
  function toastOk(msg) {
    if (typeof window.toast === 'function') window.toast(msg, 'success');
  }
  function tt(key, params) {
    return typeof window.t === 'function' ? window.t(key, params) : '[' + key + ']';
  }

  async function buildShareUrl(reqText, resText) {
    const parts = [];
    if (reqText && reqText.trim()) {
      parts.push('req=' + b64uEncode(await compress(reqText)));
    }
    if (resText && resText.trim()) {
      parts.push('res=' + b64uEncode(await compress(resText)));
    }
    return location.origin + location.pathname + '?#' + parts.join('&');
  }

  async function copyShareLink() {
    if (!hasCompressionStream()) {
      toastErr(tt('toast.share_unsupported'));
      return;
    }
    const reqText = (document.getElementById('bidReq') || {}).value || '';
    const resText = (document.getElementById('bidRes') || {}).value || '';

    if (!reqText.trim() && !resText.trim()) {
      toastErr(tt('toast.nothing_to_analyze'));
      return;
    }

    let url;
    try {
      url = await buildShareUrl(reqText, resText);
    } catch (e) {
      toastErr(tt('toast.share_link_failed', { error: e.message || String(e) }));
      return;
    }

    if (url.length > URL_BUDGET) {
      toastErr(tt('toast.share_link_too_long', { size: url.length }));
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      toastOk(tt('toast.share_link_copied'));
    } catch (e) {
      // Clipboard blocked — surface URL inline so the user can copy manually.
      window.prompt(tt('toast.share_link_manual_copy'), url);
    }
  }

  async function loadFromHash() {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return false;
    const params = new URLSearchParams(hash);
    const reqEnc = params.get('req');
    const resEnc = params.get('res');
    if (!reqEnc && !resEnc) return false;

    if (!hasCompressionStream()) {
      toastErr(tt('toast.share_unsupported'));
      return false;
    }

    try {
      if (reqEnc) {
        const text = await decompress(b64uDecode(reqEnc));
        const el = document.getElementById('bidReq');
        if (el) {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      if (resEnc) {
        const text = await decompress(b64uDecode(resEnc));
        const el = document.getElementById('bidRes');
        if (el) {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      if (typeof window.runAnalysis === 'function') {
        // Defer one tick so the input events finish updating badges before
        // analysis starts reading values.
        await Promise.resolve();
        window.runAnalysis();
      }
      toastOk(tt('toast.share_link_loaded'));
      return true;
    } catch (e) {
      toastErr(tt('toast.share_link_invalid', { error: e.message || String(e) }));
      return false;
    }
  }

  function bootShare() {
    // setTimeout 0 yields to any sibling kt:inspector-ready listeners
    // (so renderHistory + bootAuth land first), then populate panes.
    setTimeout(loadFromHash, 0);
  }

  // Phase C-2: inspector template is now fetched + injected by the
  // module's mount(). #bidReq / #bidRes don't exist at DOMContentLoaded
  // any more — wait for the inspector module to signal readiness.
  // { once: true } is intentional: a remount in the same page would
  // re-emit the event, but loadFromHash is idempotent + URL-driven, so
  // re-running it adds no value.
  window.addEventListener('kt:inspector-ready', bootShare, { once: true });

  window.copyShareLink = copyShareLink;
  // Exposed so embed.js can build URLs without duplicating the
  // compress + base64url pipeline.
  window.buildShareUrl = buildShareUrl;
  window.spyglassShareSupported = hasCompressionStream;
})();
