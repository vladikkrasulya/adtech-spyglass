'use strict';

/**
 * Canonical internal representation for any URL-style ad REQUEST.
 *
 * Mirrors the response-side `decoders/_canonical.js` contract, but for the
 * opposite direction: most non-oRTB SSPs (clickunder, url-linkfeed, pop
 * networks) accept ad calls as plain `GET host/endpoint?key=value&…` and
 * return JSON/XML feeds. There's no OpenRTB request body to validate — just
 * a URL with query parameters that follow loosely-vendor-specific schemas.
 *
 * Each decoder under `decoders/request/<variant>/`:
 *   1. detect(text, parsed) — recognize its own host/path/param signature
 *   2. decode(text, parsed) — parse + normalize into CanonicalUrlRequest
 *
 * Downstream validators in `rules-request-url.js` (TBD) operate on the
 * canonical shape only — adding a new vendor means writing a decoder, not
 * a new validator.
 *
 * Mapping principle: where a query param has a direct oRTB analogue we
 * preserve the oRTB path (`device.ip`, `device.ua`, `site.page`, `user.id`)
 * so existing rules-request.js findings can be reused for shared concerns
 * (IP family, UA presence, language codes). Vendor-specific params stay in
 * `_raw` verbatim.
 */

/**
 * @typedef {Object} CanonicalUrlRequest
 * @property {string} variant            Decoder id that produced this.
 * @property {string} method             'GET' (only one observed today).
 * @property {string} endpoint           Vendor endpoint identifier (host + path).
 * @property {string} url                Original URL verbatim.
 * @property {Object} device
 * @property {string} [device.ip]        IPv4 (when user_ip is v4).
 * @property {string} [device.ipv6]      IPv6 (when user_ip is v6).
 * @property {string} [device.ua]        Full UA string.
 * @property {string} [device.language]  ISO 639-1 if vendor passes one.
 * @property {Object} [device.sua]       Structured UA (Client Hints fold).
 * @property {Object} [site]
 * @property {string} [site.page]        Referring page URL (from `url=` etc.).
 * @property {Object} [user]
 * @property {string} [user.id]          Vendor sub-id / publisher tracking id.
 * @property {Object} _raw               Original query params verbatim —
 *                                       per-vendor extras live here so the
 *                                       canonical shape stays stable.
 * @property {Object} meta
 * @property {string} meta.detectedVariant
 */

/**
 * Build a canonical URL-request shell. Decoders fill in fields they parsed.
 *
 * @param {string} variant
 * @param {string} url
 * @returns {CanonicalUrlRequest}
 */
function makeCanonicalUrlRequest(variant, url) {
  return {
    variant,
    method: 'GET',
    endpoint: '',
    url,
    device: {},
    site: {},
    user: {},
    _raw: {},
    meta: { detectedVariant: variant },
  };
}

module.exports = { makeCanonicalUrlRequest };
