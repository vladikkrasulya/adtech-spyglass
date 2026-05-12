'use strict';

/**
 * Decoder registry for feed-style DSP responses (the "JsonFeed" family
 * plus its XML siblings — all the non-oRTB response shapes).
 *
 * Decoders are per-variant readers: each one knows how to detect its
 * specific shape and normalize it into the canonical form defined in
 * `_canonical.js`. The validator pipeline (packages/core/rules/) then
 * operates on the canonical form — one validator covers every variant.
 *
 * Add a decoder: drop a folder under `decoders/<variant>/`, register
 * it in the DECODERS array below.
 *
 * Decoder contract (see decoders/README.md):
 *
 *   module.exports = {
 *     id: 'adkernel-pop-xml',           // unique slug
 *     description: '…',                  // for docs/UI
 *     rawFormat: 'xml' | 'json',         // helps the dispatcher pick fast
 *     detect(payload, parsed): boolean,  // payload = original text, parsed = JSON or DOMlike
 *     decode(payload, parsed): CanonicalFeedResponse | { ok: false, reason, detail },
 *   };
 *
 * `parsed` is provided by the dispatcher so each decoder doesn't re-parse:
 *   - For JSON candidates, parsed = the JSON.parse(payload) result.
 *   - For XML candidates, parsed = a minimal DOMlike { root, getAttr,
 *     children } built once by the dispatcher.
 *   - Decoders may also re-parse if they need a fuller view.
 */

const DECODERS = [
  // populated as decoders ship — first will be 'adkernel-pop-xml' (Phase B).
];

/**
 * Try to decode a payload. Walks DECODERS in registration order, calls
 * detect() on each, returns the first decoder's decode() output.
 *
 * @param {string} payload  Raw response body (text).
 * @param {Object} [opts]
 * @param {'xml'|'json'} [opts.rawFormat]  Hint when known; otherwise sniffed.
 * @returns {Object|null}   Canonical response, or { ok: false, reason } if a
 *                          decoder matched-then-failed, or null if no decoder
 *                          claimed the payload.
 */
function decode(payload, opts) {
  if (typeof payload !== 'string' || payload.length === 0) return null;
  const o = opts || {};
  const rawFormat = o.rawFormat || sniffFormat(payload);
  const parsed = parseFor(payload, rawFormat);
  if (parsed === SENTINEL_PARSE_ERROR) return null;

  for (const dec of DECODERS) {
    if (dec.rawFormat && dec.rawFormat !== rawFormat) continue;
    let claimed = false;
    try {
      claimed = !!dec.detect(payload, parsed);
    } catch (e) {
      // A buggy detect() must not break dispatch — log + skip.
      console.error('[decoder.detect]', dec.id, e && e.stack ? e.stack : e);
      continue;
    }
    if (!claimed) continue;
    try {
      return dec.decode(payload, parsed);
    } catch (e) {
      console.error('[decoder.decode]', dec.id, e && e.stack ? e.stack : e);
      return { ok: false, reason: 'decoder_threw', detail: String((e && e.message) || e) };
    }
  }
  return null;
}

/**
 * Returns metadata for every registered decoder. Used by future
 * UI surfaces ("which formats can Spyglass read?") and by docs.
 */
function listDecoders() {
  return DECODERS.map((d) => ({
    id: d.id,
    description: d.description || '',
    rawFormat: d.rawFormat,
  }));
}

// ── Internals ───────────────────────────────────────────────────────────────

const SENTINEL_PARSE_ERROR = Symbol('parse_error');

function sniffFormat(payload) {
  // Cheap leading-character sniff. Decoders are still expected to do
  // their own structural checks in detect().
  // Strip optional BOM (U+FEFF) before sniffing — some partner systems
  // prepend it to UTF-8 payloads, which would shift the first visible
  // character past our '<' check. Use the unicode escape to avoid an
  // irregular-whitespace lint error on the literal BOM byte.
  const s = payload.replace(/^\uFEFF/, '').trimStart();
  if (s.startsWith('<')) return 'xml';
  return 'json';
}

function parseFor(payload, rawFormat) {
  if (rawFormat === 'json') {
    try {
      return JSON.parse(payload);
    } catch {
      return SENTINEL_PARSE_ERROR;
    }
  }
  // XML: build a tiny DOMlike walker. We DON'T require a full DOMParser
  // because all current feed XMLs are flat (`<result><attrs/></result>`).
  // Decoders that need deeper XML re-parse on their own.
  return xmlShallowParse(payload);
}

/**
 * Minimal XML walker for shallow `<root><item attr="..."/>...</root>`
 * shapes. Not a real XML parser — does NOT handle CDATA, comments,
 * namespaces, or text children. Decoders that need more re-parse.
 *
 * Returns `{ root: string, children: Array<{ tag, attrs }> }` or
 * SENTINEL_PARSE_ERROR if structure can't be read.
 */
function xmlShallowParse(payload) {
  const declStripped = payload.replace(/^\s*<\?xml[^?]*\?>\s*/i, '');
  const rootMatch = declStripped.match(/^\s*<(\w+)\b/);
  if (!rootMatch) return SENTINEL_PARSE_ERROR;
  const root = rootMatch[1];
  const children = [];
  const childRe = /<(\w+)\b([^>]*?)\/>/g;
  let m;
  while ((m = childRe.exec(declStripped))) {
    if (m[1] === root) continue;
    children.push({ tag: m[1], attrs: parseAttrs(m[2]) });
  }
  return { root, children };
}

function parseAttrs(attrStr) {
  const attrs = {};
  const re = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrStr))) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

module.exports = {
  decode,
  listDecoders,
  // Exposed for tests
  _sniffFormat: sniffFormat,
  _xmlShallowParse: xmlShallowParse,
};
