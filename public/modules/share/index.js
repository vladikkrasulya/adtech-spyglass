/* ============================================================
   modules/share/index.js — ortbtools fragment-encoded permalink.

   Encodes the current BidRequest / BidResponse panes into a hash
   fragment URL so that the link, when opened, restores both panes
   and re-runs validation. Hash fragments NEVER reach the server,
   which preserves ortbtools's zero-knowledge posture.

   URL shape: ortbtools.com/inspector?#req=<b64url(deflate(json))>&res=<...>

   The link also carries the two pieces of *analysis context* that
   decide what the recipient sees. Without them the same payload is
   read by a different rule set and the recipient's finding count
   silently disagrees with the author's:
     - ?dialect=<vendor> in the query — where the app itself keeps it
       (activeDialect() reads location.search first), so the link
       restores the vendor overlay the author was working under.
     - #…&pin=<2.5|2.6|3.0> in the fragment — the version pin, which
       otherwise lives only in the author's localStorage and cannot
       travel at all.

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

  // Both halves of a {Compression,Decompression}Stream can reject, and the
  // writable half is the one that carries the useful message. Feeding it
  // without ever looking at the returned promises means that on malformed
  // input — a share link a chat client truncated, which is exactly what
  // URL_BUDGET exists to avoid — the rejection escapes as an uncaught
  // error, twice (write and close), while the readable half reports a bare
  // "Failed to fetch". So: keep a handle on the writable side, await it,
  // and prefer its message when both fail.
  function pumpInto(writable, bytes) {
    const writer = writable.getWriter();
    const state = { error: null };
    state.done = writer
      .write(bytes)
      .then(() => writer.close())
      .catch((e) => {
        state.error = e;
      });
    return state;
  }

  async function drain(pump, read) {
    let out;
    try {
      out = await read;
    } catch (readError) {
      await pump.done;
      throw pump.error || readError;
    }
    await pump.done;
    if (pump.error) throw pump.error;
    return out;
  }

  async function compress(text) {
    const cs = new CompressionStream('deflate-raw');
    const pump = pumpInto(cs.writable, new TextEncoder().encode(text));
    const buf = await drain(pump, new Response(cs.readable).arrayBuffer());
    return new Uint8Array(buf);
  }

  async function decompress(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const pump = pumpInto(ds.writable, bytes);
    return await drain(pump, new Response(ds.readable).text());
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

  // ── Analysis context that has to travel with the payload ────────────
  //
  // A share link that carries only the bytes is not a share of the
  // analysis: open it and the engine re-runs under whatever dialect and
  // version the *recipient* happens to have, so the finding count differs
  // from the one the author was looking at when they copied the link.
  //
  // The dialect goes in the query because that is where the app already
  // reads it from (activeDialect() checks location.search before
  // localStorage) — buildShareUrl used to throw location.search away.
  // Temp dialects (`temp:<uuid>`) are deliberately not shareable: they
  // live in the author's IndexedDB and mean nothing to a recipient, which
  // is the same rule setActiveDialect() applies to the address bar.
  const PINNABLE_VERSIONS = ['2.5', '2.6', '3.0'];

  /** origin + pathname + the query worth sharing, as a string with no '#'. */
  function shareBase() {
    let query = '';
    try {
      const dialect = new URLSearchParams(location.search).get('dialect');
      if (dialect && dialect !== 'iab' && !dialect.startsWith('temp:')) {
        query = '?dialect=' + encodeURIComponent(dialect);
      }
    } catch (_e) {
      /* exotic URL — share the payload without the overlay */
    }
    return location.origin + location.pathname + query;
  }

  /**
   * The version pin, as a fragment parameter or null. It lives only in
   * localStorage and the <select>, so unless the link carries it the
   * recipient silently falls back to auto-detection.
   */
  function pinParam() {
    const el = document.getElementById('versionPinSelector');
    const v = el && el.value;
    return v && PINNABLE_VERSIONS.includes(v) ? 'pin=' + v : null;
  }

  async function buildShareUrl(reqText, resText) {
    const parts = [];
    if (reqText && reqText.trim()) {
      parts.push('req=' + b64uEncode(await compress(reqText)));
    }
    if (resText && resText.trim()) {
      parts.push('res=' + b64uEncode(await compress(resText)));
    }
    const pin = pinParam();
    if (pin) parts.push(pin);
    // The trailing '?' with no query is kept for links that carry no
    // dialect: the shape `…/inspector?#req=` is what the docs and the
    // existing links in the wild look like.
    const base = shareBase();
    return base + (base.indexOf('?') === -1 ? '?' : '') + '#' + parts.join('&');
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

  // ── Server error code → localized message ────────────────────────
  // GET /api/v1/gists/:id answers with a machine `code` alongside its
  // English `error` sentence (see modules/gists/handler.js) — that English
  // text is the machine-readable field, not user copy, so it must never
  // reach the toast verbatim. Same shape as humanAuthError()/
  // humanResetError() in modules/auth/ and modules/password-reset/.
  function humanGistError(e) {
    const code = (e && e.code) || '';
    if (code === 'gist_expired') return tt('toast.share_gist_expired');
    if (code === 'not_found') return tt('toast.share_gist_not_found');
    return tt('toast.share_gist_invalid', { error: (e && e.message) || String(e) });
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
    // Dialect + pin ride along for the same reason they do on a plain
    // share link: without them the recipient re-analyses under their own
    // settings and sees a different verdict.
    const pin = pinParam();
    return shareBase() + '#gist=' + body.id + '&key=' + keyB64u + (pin ? '&' + pin : '');
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
      const err = new Error(body.error || 'HTTP ' + resp.status);
      err.code = body.code;
      throw err;
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

  /**
   * Apply a pin carried by the link, before analysis runs. Set without
   * dispatching 'change': the pin describes the link the reader opened,
   * it is not a preference they chose, so it must not be written into
   * their localStorage behind their back.
   */
  function applyPin(value) {
    if (!value || !PINNABLE_VERSIONS.includes(value)) return;
    const el = document.getElementById('versionPinSelector');
    if (el) el.value = value;
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
        applyPin(params.get('pin'));
        if (typeof window.runAnalysis === 'function') {
          await Promise.resolve();
          window.runAnalysis();
        }
        if (typeof window.ortbtoolsTrack === 'function') window.ortbtoolsTrack('gist_open');
        toastOk(tt('toast.share_gist_loaded'));
        return true;
      } catch (e) {
        toastErr(humanGistError(e));
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
      applyPin(params.get('pin'));
      if (typeof window.runAnalysis === 'function') {
        // Defer one tick so the input events finish updating badges before
        // analysis starts reading values.
        await Promise.resolve();
        window.runAnalysis();
      }
      toastOk(tt('toast.share_link_loaded'));
      return true;
    } catch (e) {
      // Everything on this path — base64url decode, inflate — fails for
      // one practical reason: the link that arrived is not the link that
      // was sent. Say that, instead of forwarding a stream-internals
      // message the reader can do nothing with.
      toastErr(tt('toast.share_link_truncated', { error: e.message || String(e) }));
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
