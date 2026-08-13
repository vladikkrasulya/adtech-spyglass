/* ============================================================
   modules/share/index.js — ortbtools fragment-encoded permalink.

   Encodes the current BidRequest / BidResponse panes into a hash
   fragment URL so that the link, when opened, restores both panes
   and re-runs validation. Hash fragments NEVER reach the server,
   which preserves ortbtools's zero-knowledge posture.

   URL shape: ortbtools.com/?#req=<b64url(deflate(json))>&res=<...>

   Encoding pipeline:
     text → UTF-8 → CompressionStream('deflate-raw') → bytes → base64url

   Decoding pipeline (mirror):
     base64url → bytes → DecompressionStream('deflate-raw') → text

   Browser support: CompressionStream + deflate-raw is in Chrome 103+,
   Safari 16.4+, Firefox 113+. On older browsers we surface a toast
   pointing the user at the Download button (export.js) instead.

   On page load: if the hash carries `req=` or `res=`, decode and
   populate the panes, then call window.runAnalysis().

   Exposed window.* (consumed by other modules):
     - window.copyShareLink()       — wired to topnav share button
     - window.buildShareUrl(req,res) — used by mirror module to build
                                        permalinks for the canonical pair
     - window.ortbtoolsShareSupported() — feature-detect for embed.js

   Listens for: kt:inspector-ready (workbench DOM mounted async).
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

  // ── Encrypted gists — the overflow path for payloads too big to fit a URL ──
  //
  // The fragment link above is the preferred form: a fragment is never
  // transmitted, so nothing leaves the browser at all. It just cannot carry a
  // real auction, because chat clients truncate long links.
  //
  // A gist keeps that property as far as it can. The bundle is compressed and
  // encrypted here, under a key minted here, and only the ciphertext is
  // uploaded. The key rides in the fragment of the resulting link, so it
  // reaches the recipient and never the server. See modules/gists/handler.js.
  //
  // Uploading is NOT automatic. The plain share link promises that nothing is
  // sent; silently turning it into an upload — even an encrypted one — would
  // break that promise at exactly the moment the user is least likely to be
  // reading carefully. So we ask.
  const GIST_BUNDLE_VERSION = 1;

  function cryptoApi() {
    return window.OrtbtoolsCrypto;
  }

  async function createGist(reqText, resText) {
    const api = cryptoApi();
    if (!api || typeof api.generateContentKey !== 'function') {
      throw new Error('crypto_unavailable');
    }
    const bundle = JSON.stringify({ v: GIST_BUNDLE_VERSION, req: reqText, res: resText });
    const compressed = await compress(bundle);
    const { key, keyB64u } = await api.generateContentKey();
    const { iv, ct } = await api.encryptBytes(key, compressed);

    const resp = await fetch('/api/v1/gists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ ciphertext: ct, iv, bundle_version: GIST_BUNDLE_VERSION }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.id) {
      throw new Error(body.error || 'HTTP ' + resp.status);
    }
    // The key is appended client-side and never travelled with the request.
    return location.origin + location.pathname + '#gist=' + body.id + '&key=' + keyB64u;
  }

  async function loadGist(id, keyB64u) {
    const api = cryptoApi();
    if (!api || typeof api.importContentKey !== 'function') {
      throw new Error('crypto_unavailable');
    }
    const resp = await fetch('/api/v1/gists/' + encodeURIComponent(id), {
      credentials: 'same-origin',
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ciphertext) {
      throw new Error(body.error || 'HTTP ' + resp.status);
    }
    const key = await api.importContentKey(keyB64u);
    // AES-GCM verifies its tag here: a tampered ciphertext or a wrong key
    // throws rather than yielding plausible-looking JSON.
    const plainBytes = await api.decryptBytes(key, body.iv, body.ciphertext);
    const text = await decompress(plainBytes);
    const bundle = JSON.parse(text);
    if (!bundle || bundle.v !== GIST_BUNDLE_VERSION) throw new Error('unsupported_bundle');
    return bundle;
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
      // Too big for a fragment. Offer the encrypted-gist path instead of
      // failing outright — but only with an explicit yes, because this is the
      // one share mode that transmits anything at all.
      if (!window.confirm(tt('confirm.share_gist_upload', { size: url.length }))) {
        toastErr(tt('toast.share_link_too_long', { size: url.length }));
        return;
      }
      try {
        url = await createGist(reqText, resText);
      } catch (e) {
        toastErr(tt('toast.share_gist_failed', { error: e.message || String(e) }));
        return;
      }
      if (typeof window.ortbtoolsTrack === 'function') window.ortbtoolsTrack('gist_create');
    }

    // Product telemetry: a share link was successfully produced, once per tab
    // session. The link encodes the payload in a fragment — neither the link
    // nor its length is sent; only the fact that sharing was used.
    if (typeof window.ortbtoolsTrackOnce === 'function') {
      window.ortbtoolsTrackOnce('share_use');
    }

    try {
      await navigator.clipboard.writeText(url);
      toastOk(tt('toast.share_link_copied'));
    } catch (_e) {
      // Clipboard blocked — surface URL inline so the user can copy manually.
      window.prompt(tt('toast.share_link_manual_copy'), url);
    }
  }

  /** Put text into a pane and let the rest of the app notice. */
  function fillPane(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function loadFromHash() {
    const hash = location.hash.replace(/^#/, '');
    if (!hash) return false;
    const params = new URLSearchParams(hash);
    const gistId = params.get('gist');
    const gistKey = params.get('key');
    const reqEnc = params.get('req');
    const resEnc = params.get('res');
    if (!gistId && !reqEnc && !resEnc) return false;

    if (!hasCompressionStream()) {
      toastErr(tt('toast.share_unsupported'));
      return false;
    }

    if (gistId) {
      if (!gistKey) {
        // The id alone is useless: without the fragment key the bundle cannot
        // be read by anyone, including us. Say so rather than showing a
        // decryption failure.
        toastErr(tt('toast.share_gist_no_key'));
        return false;
      }
      try {
        const bundle = await loadGist(gistId, gistKey);
        if (bundle.req) fillPane('bidReq', bundle.req);
        if (bundle.res) fillPane('bidRes', bundle.res);
        if (typeof window.runAnalysis === 'function') {
          await Promise.resolve();
          window.runAnalysis();
        }
        if (typeof window.ortbtoolsTrack === 'function') window.ortbtoolsTrack('gist_open');
        toastOk(tt('toast.share_gist_loaded'));
        return true;
      } catch (e) {
        toastErr(tt('toast.share_gist_invalid', { error: e.message || String(e) }));
        return false;
      }
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

  // Inspector template is fetched + injected by the inspector module's
  // mount(). #bidReq / #bidRes don't exist at DOMContentLoaded any more
  // — wait for the inspector module to signal readiness.
  // { once: true } is intentional: a remount in the same page would
  // re-emit the event, but loadFromHash is idempotent + URL-driven, so
  // re-running it adds no value.
  window.addEventListener('kt:inspector-ready', bootShare, { once: true });

  window.copyShareLink = copyShareLink;
  // Exposed so embed.js + mirror module can build URLs without
  // duplicating the compress + base64url pipeline.
  window.buildShareUrl = buildShareUrl;
  window.ortbtoolsShareSupported = hasCompressionStream;
})();
