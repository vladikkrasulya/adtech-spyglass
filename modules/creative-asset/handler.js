'use strict';

/**
 * modules/creative-asset/handler.js — POST /api/creative/asset
 *
 * Hands back one creative image as a `data:` URI so the preview iframe can
 * render it without its CSP being opened up and without the analyst's
 * browser ever contacting the advertiser's origin. All the reasoning about
 * why that matters, and the SSRF posture, lives in lib/asset-fetch.js.
 *
 * Auth-gated and rate-limited: this is the one route in the app that makes
 * an outbound request to a host the caller chose, so it does not belong to
 * anonymous traffic, and a page full of creatives must not turn into a
 * fetch storm against a third party from our IP.
 *
 * Request:  { url: "https://cdn.example/banner.png" }
 * Response: { ok: true, dataUri, bytes, contentType }
 *   4xx/5xx carry a `code` the UI maps to a specific sentence — an asset
 *   that redirects, is too large, or is not an image are three different
 *   things to tell someone, and "preview failed" is none of them.
 */

const { readJson, sendJson, sendError } = require('../../lib/http');
const { fetchAsset, MAX_ASSET_BYTES } = require('../../lib/asset-fetch');
const log = require('../../lib/logger').child('creative-asset');

// Client-visible failure → HTTP status. Anything unlisted is a 502: we
// reached for something on the caller's behalf and it did not work out.
const STATUS_BY_CODE = {
  url_invalid: 400,
  scheme_blocked: 400,
  port_blocked: 400,
  host_blocked: 403,
  dns_failed: 404,
  redirect_blocked: 409,
  type_blocked: 415,
  too_large: 413,
  timeout: 504,
};

const URL_MAX = 2048;

/**
 * @param {{auth?: any, assetLimiter?: (key: string) => boolean}} [deps]
 */
function createCreativeAssetModule({ auth, assetLimiter } = {}) {
  async function handleAsset(req, res) {
    const user = auth && auth.getCurrentUser(req);
    if (!user) return sendError(res, 401, 'unauthorized', 'Sign in to load creative assets');
    if (assetLimiter && !assetLimiter(String(user.id))) {
      return sendError(res, 429, 'rate_limited', 'Too many asset requests. Try again shortly.');
    }

    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      return sendError(res, 400, 'bad_request', e.message);
    }
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url || url.length > URL_MAX) {
      return sendError(res, 400, 'url_invalid', 'url missing or too long');
    }

    try {
      const { contentType, buffer, bytes } = await fetchAsset(url);
      // No caching header: the response embeds bytes fetched for one signed-in
      // user from a host they named. Caching it at any shared layer would be a
      // way to ask this server to store third-party content.
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, 200, {
        ok: true,
        contentType,
        bytes,
        dataUri: 'data:' + contentType + ';base64,' + buffer.toString('base64'),
      });
    } catch (e) {
      const code = e && e.code ? e.code : 'upstream_failed';
      const status = STATUS_BY_CODE[code] || 502;
      // The URL is payload-derived, so only its host is logged, never the path
      // (which routinely carries click ids and user identifiers).
      let host = '';
      try {
        host = new URL(url).host;
      } catch (_) {
        /* unparseable — nothing to log */
      }
      log.warn({ code, host }, 'asset fetch failed');
      return sendError(res, status, code, e.message || 'Could not load the asset');
    }
  }

  return {
    id: 'creative-asset',
    routes: [{ method: 'POST', path: '/api/creative/asset', handler: handleAsset }],
    MAX_ASSET_BYTES,
  };
}

module.exports = { createCreativeAssetModule };
