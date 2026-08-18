/* ============================================================================
 * creative-assets.js — swap a creative's remote images for `data:` URIs
 * fetched by the server, so the picture renders without the preview iframe's
 * CSP being opened and without this browser touching the advertiser.
 *
 * The seal on that iframe (`img-src data: blob:`) is deliberate: it is the
 * chamber creative-probe.js measures from, and letting `https:` images load
 * would fire every tracking pixel in attacker-supplied markup from the
 * analyst's own machine. lib/asset-fetch.js carries the full reasoning and
 * the SSRF posture; this file is only the client half.
 *
 * ── Why this is a button and not automatic ───────────────────────────────
 * Inlining spends an outbound request from our server to a host the creative
 * named. Doing that silently for every preview would mean the act of looking
 * at a payload quietly generates traffic to third parties — which is the
 * shape of the problem we are avoiding, just moved one hop. So the user asks
 * for it, and the count they are asking for is on the button.
 * ========================================================================== */
(function () {
  'use strict';

  // A creative with more images than this is not a banner; it is a page.
  const MAX_ASSETS = 12;

  function t(key, params) {
    if (typeof window.t === 'function') {
      const s = window.t(key, params);
      if (s && s !== '[' + key + ']') return s;
    }
    return key;
  }

  /**
   * Remote http(s) URLs referenced by the creative's markup.
   *
   * Parsed with DOMParser rather than a regex: `src` can be single-quoted,
   * unquoted or entity-escaped, and a regex that gets that wrong either
   * misses assets or rewrites text that was never an attribute. The document
   * is inert — DOMParser does not load or execute anything.
   *
   * @param {string} html
   * @returns {string[]} unique absolute http(s) URLs, capped
   */
  function collectRemoteUrls(html) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    } catch (_) {
      return [];
    }
    const out = [];
    const seen = new Set();
    const push = (v) => {
      if (!v || typeof v !== 'string') return;
      if (!/^https?:\/\//i.test(v)) return; // data:/blob: already render
      if (seen.has(v) || out.length >= MAX_ASSETS) return;
      seen.add(v);
      out.push(v);
    };
    for (const img of doc.querySelectorAll('img')) push(img.getAttribute('src'));
    for (const v of doc.querySelectorAll('video')) push(v.getAttribute('poster'));
    return out;
  }

  /**
   * Ask the server for each asset and rewrite the markup to the returned
   * data: URIs.
   *
   * Replacement is done on the DOM the same parse produced, not by string
   * substitution — a URL can appear both as an attribute and inside visible
   * text (creatives routinely print their own click URL), and only the
   * attribute should change.
   *
   * @param {string} html
   * @returns {Promise<{html: string, inlined: number, failed: Array<{url: string, code: string}>}>}
   */
  async function inlineAssets(html) {
    const urls = collectRemoteUrls(html);
    if (!urls.length) return { html, inlined: 0, failed: [] };

    /** @type {Map<string, string>} */
    const resolved = new Map();
    const failed = [];

    // Sequential on purpose. These are outbound requests made on our server's
    // behalf; a burst of twelve at once against one CDN from one click is
    // rude, and the per-user rate limit would start refusing them anyway.
    for (const url of urls) {
      try {
        const r = await fetch('/api/creative/asset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const j = await r.json().catch(() => null);
        if (r.ok && j && j.ok && j.dataUri) resolved.set(url, j.dataUri);
        else failed.push({ url, code: (j && j.code) || String(r.status) });
      } catch (_) {
        failed.push({ url, code: 'network' });
      }
    }
    if (!resolved.size) return { html, inlined: 0, failed };

    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const swap = (el, attr) => {
      const v = el.getAttribute(attr);
      if (v && resolved.has(v)) el.setAttribute(attr, resolved.get(v));
    };
    for (const img of doc.querySelectorAll('img')) swap(img, 'src');
    for (const v of doc.querySelectorAll('video')) swap(v, 'poster');

    // Round-trip the body only. The parser wraps fragments in html/head/body,
    // and handing that whole document back would nest a second <html> inside
    // the srcdoc we are about to build.
    return { html: doc.body.innerHTML, inlined: resolved.size, failed };
  }

  /**
   * Describe the outcome in one sentence for a toast.
   * @param {{inlined: number, failed: Array<{code: string}>}} res
   */
  function describe(res) {
    if (!res.inlined && res.failed.length) {
      return t('creative.assets.all_failed', { n: res.failed.length });
    }
    if (res.failed.length) {
      return t('creative.assets.partial', { ok: res.inlined, bad: res.failed.length });
    }
    return t('creative.assets.loaded', { n: res.inlined });
  }

  window.OrtbtoolsCreativeAssets = { collectRemoteUrls, inlineAssets, describe, MAX_ASSETS };
})();
