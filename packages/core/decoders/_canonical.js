'use strict';

/**
 * Canonical internal representation for any "feed-style" DSP response.
 *
 * Every decoder under packages/core/decoders/<variant>/ normalizes its
 * specific shape (XML attrs, JSON keys, casing conventions) to ONE
 * canonical form below. Validators in packages/core/rules/* operate
 * on this canonical form — they don't care which DSP/variant produced
 * the bytes.
 *
 * Why a canonical shape:
 *  - One validator-plugin covers all variants. Adding a new DSP
 *    means writing a decoder, not a new validator.
 *  - Per-variant facts (XML attr names vs JSON keys, account-specific
 *    endpoint hostnames) stay isolated inside their decoder folder
 *    where they belong.
 *  - User-visible findings can phrase issues in canonical terms
 *    ("bid is missing") without leaking the variant-specific
 *    serialization detail unless asked.
 */

/**
 * @typedef {Object} CanonicalFeedItem
 * @property {number}  bid              Parsed float bid price.
 * @property {string}  clickUrl         The URL the user lands on after a click.
 * @property {string} [impressionUrl]   Pixel / impression tracker URL.
 * @property {string} [title]           Ad title (search / push variants).
 * @property {string} [description]     Ad copy / descr (search / push).
 * @property {string} [site]            Display domain (search variant).
 * @property {string} [image]           Hero image (search / push).
 * @property {string} [icon]            Icon (push, search).
 * @property {string} [badge]           Badge (push only).
 * @property {Object} _raw              Original fields verbatim — preserved
 *                                       so downstream callers can inspect
 *                                       variant-specific extras without
 *                                       extending this contract.
 */

/**
 * @typedef {Object} CanonicalFeedResponse
 * @property {string}                variant            Decoder id that produced this.
 * @property {Array<CanonicalFeedItem>} items
 * @property {number}               [generationTimeMs]  Server-side time, when present.
 * @property {string}               [error]             Variant-reported error string (often empty).
 * @property {Object}                meta
 * @property {'xml'|'json'}          meta.rawFormat
 * @property {string}                meta.detectedVariant
 */

/**
 * Build a canonical response shell. Decoders push items into `items[]`.
 * Use this rather than constructing the object literal by hand — keeps
 * the shape stable across decoders.
 *
 * @param {string} variant
 * @param {'xml'|'json'} rawFormat
 * @returns {CanonicalFeedResponse}
 */
function makeCanonical(variant, rawFormat) {
  return {
    variant,
    items: [],
    meta: {
      rawFormat,
      detectedVariant: variant,
    },
  };
}

/**
 * Build a canonical item. Required fields (bid, clickUrl) throw if
 * missing — decoders must coerce/validate before calling.
 *
 * @param {Object} fields
 * @param {number|string} fields.bid
 * @param {string} fields.clickUrl
 * @param {string} [fields.impressionUrl]
 * @param {string} [fields.title]
 * @param {string} [fields.description]
 * @param {string} [fields.site]
 * @param {string} [fields.image]
 * @param {string} [fields.icon]
 * @param {string} [fields.badge]
 * @param {Object} [fields._raw]
 * @returns {CanonicalFeedItem}
 */
function makeItem(fields) {
  if (fields == null || typeof fields !== 'object') {
    throw new TypeError('makeItem: fields must be an object');
  }
  const bid = Number(fields.bid);
  if (!Number.isFinite(bid)) {
    throw new TypeError('makeItem: bid must be a finite number, got ' + JSON.stringify(fields.bid));
  }
  if (typeof fields.clickUrl !== 'string' || fields.clickUrl.length === 0) {
    throw new TypeError('makeItem: clickUrl must be a non-empty string');
  }
  const item = /** @type {CanonicalFeedItem} */ ({
    bid,
    clickUrl: fields.clickUrl,
    _raw: fields._raw || {},
  });
  // Optional string fields — copy only when present + non-empty.
  for (const k of ['impressionUrl', 'title', 'description', 'site', 'image', 'icon', 'badge']) {
    const v = fields[k];
    if (typeof v === 'string' && v.length > 0) item[k] = v;
  }
  return item;
}

/**
 * Reject the canonical form with a structured decoder error.
 * Decoders return null from .decode() and emit one of these so the
 * registry can attach the variant id + raw-format context.
 *
 * @param {string} reason   Short machine-readable reason code.
 * @param {string} detail   Human-readable detail (becomes part of finding msg).
 * @returns {{ ok: false, reason: string, detail: string }}
 */
function decoderError(reason, detail) {
  return { ok: false, reason, detail: detail || '' };
}

module.exports = { makeCanonical, makeItem, decoderError };
