/* ============================================================
   ortbtools JSON-bundle export.

   Reads the BidRequest / BidResponse panes + the latest analysis result
   stashed by spyglass.app.js (window.__spyglassLast), packages them
   into a single JSON file, and triggers a browser download.

   Bundle shape:
     {
       "spyglass_version": "v8.0.0",
       "captured_at": "<ISO>",
       "url": "https://ortbtools.com/...",
       "bid_request": <object | string>,
       "bid_response": <object | string | null>,
       "validation": <object | null>,
       "crosscheck": <object | null>,
       "meta": <object | null>
     }

   Filename: spyglass-{YYYY-MM-DD}-{6 hex}.json (hex is the leading 24 bits
   of SHA-256 over the request text — collision-resistant enough for a
   stable name, short enough to be readable).
   ============================================================ */
(function () {
  'use strict';

  function getEngineVersion() {
    const el = document.getElementById('engineVer');
    return (el && el.textContent && el.textContent.trim()) || 'unknown';
  }

  function dataField(text) {
    if (!text || !text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function shortHash(text) {
    try {
      const buf = new TextEncoder().encode(text || '');
      const h = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(h))
        .slice(0, 3)
        .map(function (b) {
          return b.toString(16).padStart(2, '0');
        })
        .join('');
    } catch {
      // Crypto unavailable on http (rare for this surface, but safe).
      return Math.random().toString(16).slice(2, 8);
    }
  }

  async function downloadBundle() {
    const reqEl = document.getElementById('bidReq');
    const resEl = document.getElementById('bidRes');
    const reqText = (reqEl && reqEl.value) || '';
    const resText = (resEl && resEl.value) || '';

    if (!reqText.trim() && !resText.trim()) {
      const msg =
        typeof window.t === 'function' ? window.t('toast.nothing_to_analyze') : 'Nothing to export';
      if (typeof window.toast === 'function') window.toast(msg, 'error');
      return;
    }

    const last = window.__spyglassLast || null;
    const bundle = {
      spyglass_version: getEngineVersion(),
      captured_at: new Date().toISOString(),
      url: location.href,
      bid_request: dataField(reqText),
      bid_response: dataField(resText),
      validation: last ? last.validation : null,
      crosscheck: last ? last.crosscheck : null,
      meta: last ? last.meta : null,
    };

    const json = JSON.stringify(bundle, null, 2);
    const date = new Date().toISOString().slice(0, 10);
    const hash = await shortHash(reqText || resText);
    const filename = 'spyglass-' + date + '-' + hash + '.json';

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revoke so Safari has a chance to start the download.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    if (typeof window.toast === 'function') {
      const msg =
        typeof window.t === 'function'
          ? window.t('toast.bundle_downloaded', { name: filename })
          : 'Downloaded ' + filename;
      window.toast(msg, 'success');
    }
  }

  window.downloadBundle = downloadBundle;
})();
