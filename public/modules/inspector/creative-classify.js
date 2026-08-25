/* ============================================================================
 * creative-classify.js — decide what a creative body IS, once, before anything
 * decides how to show it.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 * `setAdPreview`'s third branch used to be an unconditional catch-all: any
 * body that was not VAST-shaped and did not match one exact native envelope
 * was handed to the browser as `srcdoc`. Four different payload shapes took
 * that path — envelope-less native, a bare URL, base64, and text that is not
 * markup at all — and every one of them came out as a line of garbage in the
 * preview box. The envelope-less native case is the worst of them: it throws
 * nothing, so the `console.error` that was supposed to leave a trail never
 * fired, and the failure was completely silent.
 *
 * The repair is not four special cases. It is asking the question once, up
 * front, and letting the answer decide the branch. Everything here is pure —
 * no DOM, no network, no clock — so the whole table is testable in a plain
 * node process.
 *
 * ── The one invariant that matters ───────────────────────────────────────
 * `markup` is the ONLY kind that may reach an iframe's `srcdoc`. Every other
 * kind is inert text. That is what stops the preview from painting a payload
 * as though it were a creative.
 *
 * ── What this file must never do ─────────────────────────────────────────
 * Rewrite the body it classifies. The bytes handed to the frame are the same
 * bytes the behaviour engine scores and the static scanner reads; a classifier
 * that "helpfully" normalised markup would silently change what the product
 * measures. The one exception is base64, where the decoded body IS the
 * creative and the encoding was never part of it — and even then the decode
 * happens exactly once, and `decoded` says so.
 *
 * The normative order lives in
 * specs/012-creative-preview-repair/contracts/creative-preview.md §1.
 * ========================================================================== */
(function () {
  'use strict';

  /**
   * Anything longer than this is not decoded. Base64 detection is a
   * character-class test, so a multi-megabyte creative that happens to be all
   * word characters would otherwise buy a pointless decode of itself. Real
   * base64-wrapped creatives are far under this.
   */
  const MAX_DECODE_INPUT = 512 * 1024;

  /**
   * Below this length a base64-looking string is far more likely to be a short
   * word than an encoded document. `PGRpdj4=` is eight characters and decodes
   * to `<div>`, but so does any four-letter alphanumeric token decode to
   * something — the length floor is what keeps the guess honest.
   */
  const MIN_BASE64_LENGTH = 16;

  const KINDS = ['vast', 'native', 'json', 'url', 'markup', 'unidentified'];

  /**
   * A body that is one absolute http(s) URL and nothing else — no surrounding
   * markup, no whitespace-separated second token. Exchanges do send these, and
   * painting one as HTML produces a line of blue-less text that looks like the
   * tool gave up.
   */
  const BARE_URL = /^https?:\/\/[^\s"'<>]+$/i;

  /**
   * Base64 alphabet plus the line breaks that wrapped encoders insert. The
   * padding is optional because plenty of encoders omit it.
   */
  const BASE64_BODY = /^[A-Za-z0-9+/\s]+={0,2}$/;

  /**
   * The cheapest honest test for "this is markup": an angle bracket opening a
   * tag, a closing tag, a comment, or a doctype. Deliberately not a parse —
   * `DOMParser` never fails, so parsing tells us nothing about whether the
   * input was markup in the first place. It happily returns a document whose
   * body holds one text node for input that was never markup at all, which is
   * precisely the mistake this whole file exists to stop making.
   */
  const MARKUP_SHAPE = /<\s*[a-zA-Z!/?]/;

  /**
   * Native assets, wherever the exchange chose to put them.
   *
   * oRTB puts them at `native.assets`. Plenty of exchanges send the object
   * itself, with `assets` at the top level, and the previous gate — an exact
   * `j.native.assets` array test — rejected those without raising anything a
   * human would ever see.
   *
   * @param {unknown} parsed a value that already came out of JSON.parse
   * @returns {{assets: unknown[]}|null} the native object in wrapped shape, or null
   */
  function nativeOf(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const wrapped = /** @type {{native?: {assets?: unknown}}} */ (parsed).native;
    if (wrapped && typeof wrapped === 'object' && Array.isArray(wrapped.assets)) {
      return /** @type {{assets: unknown[]}} */ (wrapped);
    }
    const bare = /** @type {{assets?: unknown}} */ (parsed).assets;
    if (Array.isArray(bare)) {
      // Re-wrap rather than teach the renderer a second shape. The renderer is
      // correct as it stands; it was only ever being handed the wrong thing.
      return /** @type {{assets: unknown[]}} */ (parsed);
    }
    return null;
  }

  /**
   * Decode one round of base64, or return null when the body is not base64 or
   * is too large to be worth the attempt.
   *
   * `atob` throws on invalid input, and the UTF-8 re-decode below throws on
   * bytes that are not valid UTF-8 — both are answers, not errors, so both are
   * caught and turned into "not base64".
   *
   * @param {string} s trimmed body
   * @returns {string|null}
   */
  function decodeBase64Once(s) {
    if (s.length < MIN_BASE64_LENGTH || s.length > MAX_DECODE_INPUT) return null;
    if (!BASE64_BODY.test(s)) return null;
    const compact = s.replace(/\s+/g, '');
    // RFC 4648 padding is optional in common transports. A remainder of one
    // can never represent complete base64 data; remainders two and three are
    // valid unpadded input and are normalised only for `atob`.
    const remainder = compact.length % 4;
    if (remainder === 1) return null;
    const normalized = remainder ? compact + '='.repeat(4 - remainder) : compact;
    try {
      const binary = atob(normalized);
      // atob yields one character per byte. Creatives are UTF-8, and reading
      // those bytes as characters would mangle every non-ASCII glyph in the
      // markup — so go back through the bytes explicitly.
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_e) {
      return null;
    }
  }

  /**
   * @param {string} body
   * @param {boolean} allowDecode false on the second pass, so one round is one round
   * @returns {{kind: string, body: string, decoded: boolean, native: object|null, reason: string}}
   */
  function classifyOnce(body, allowDecode) {
    const trimmed = String(body == null ? '' : body).trim();
    const out = (kind, reason, native) => ({
      kind,
      body,
      decoded: false,
      native: native || null,
      reason,
    });

    if (!trimmed) return out('unidentified', 'empty body');

    // 1. VAST. Delegated, never re-implemented: the preview carrying its own
    //    regex is how it came to disagree with the format detector about a
    //    document that opens with a byte-order mark or an XML comment.
    const vast = typeof window !== 'undefined' && window.OrtbtoolsVastShape;
    if (!vast || typeof vast.isVastShape !== 'function') {
      // The core detector is a safety dependency: without it, `<VAST>` would
      // fall through to the generic markup rule and reach `srcdoc`. Failing
      // the whole classification closed is safer than restoring a second
      // private detector that can drift from Core.
      return out('unidentified', 'core VAST detector unavailable');
    }
    if (vast.isVastShape(trimmed)) return out('vast', 'core isVastShape');

    // 2 & 3. JSON. Native if it carries assets anywhere we accept, otherwise a
    //        payload we can name but not render — which is still infinitely
    //        better than painting it.
    if (trimmed[0] === '{' || trimmed[0] === '[') {
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (_e) {
        parsed = undefined;
      }
      if (parsed !== undefined) {
        const native = nativeOf(parsed);
        if (native) {
          return out(
            'native',
            /** @type {{native?: unknown}} */ (parsed).native
              ? 'native.assets'
              : 'top-level assets',
            native,
          );
        }
        return out('json', 'JSON without native assets');
      }
      // Opens like JSON but is not JSON. It is not markup either — falling
      // through would hand a broken object to the browser to paint.
      if (!MARKUP_SHAPE.test(trimmed)) return out('unidentified', 'malformed JSON');
    }

    // 4. Base64, exactly one round.
    if (allowDecode) {
      const decoded = decodeBase64Once(trimmed);
      if (decoded !== null) {
        const inner = classifyOnce(decoded, false);
        if (inner.kind !== 'unidentified') {
          return {
            kind: inner.kind,
            body: decoded,
            decoded: true,
            native: inner.native,
            reason: 'base64 → ' + inner.reason,
          };
        }
      }
    }

    // 5. A bare URL. Named, never fetched, never turned into a link.
    if (BARE_URL.test(trimmed)) return out('url', 'single absolute URL');

    // 6. Markup — the only kind that reaches a frame.
    if (MARKUP_SHAPE.test(trimmed)) return out('markup', 'element-like construct');

    // 7. Everything else.
    return out('unidentified', 'no recognised shape');
  }

  /**
   * Classify a creative body.
   *
   * @param {string} body the macro-resolved `adm`, exactly as the frame would receive it
   * @returns {{kind: string, body: string, decoded: boolean, native: object|null, reason: string}}
   */
  function classify(body) {
    return classifyOnce(body, true);
  }

  /**
   * The single question the render path asks. Kept as a named predicate rather
   * than an inline `=== 'markup'` so that the invariant is greppable and the
   * test can assert it directly.
   *
   * @param {{kind: string}} result
   * @returns {boolean}
   */
  function isFrameable(result) {
    return !!result && result.kind === 'markup';
  }

  window.OrtbtoolsCreativeClassify = { classify, isFrameable, KINDS, MAX_DECODE_INPUT };
})();
