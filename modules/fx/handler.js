'use strict';

/**
 * modules/fx/handler.js — GET /api/v1/fx-rates
 *
 * Serves the cached USD rate table so the Inspector can show a non-USD bid
 * floor's USD equivalent. See lib/fx.js for why the table is fetched whole on
 * a timer instead of being queried per payload, and why the converted figure
 * is display-only.
 *
 * The request carries nothing: no amount, no currency, no payload. It is the
 * same response for every caller, which is what makes it cacheable and what
 * keeps the privacy claim in docs/PRIVACY.md true.
 *
 * Response 200: { ok: true, base: 'USD', rates: {...}, fetchedAt, providerUpdatedAt,
 *                 provider, stale }
 * Response 503: { ok: false, error: 'fx_unavailable' } — no table yet. The
 *   client renders the arriving currency alone; it never invents a rate.
 *
 * Cache-Control: public, max-age=1800 — the source moves once a day, and a
 * client holding a half-hour-old table is showing the same number the server
 * would have given it.
 */

const { sendJson, sendError } = require('../../lib/http');
const fx = require('../../lib/fx');

/**
 * @param {object} deps
 * @param {(key: string) => boolean} [deps.readLimiter]
 * @param {*} [deps.auth]
 */
function createFxModule({ readLimiter, auth } = {}) {
  async function handleFxRates(req, res) {
    if (readLimiter && auth && !readLimiter(auth.clientIp(req))) {
      return sendError(res, 429, 'rate_limited', 'Too many requests. Try again shortly.');
    }
    try {
      const table = await fx.ensureRates();
      if (!table) {
        // Do not cache the miss for long — a refresh may land seconds later.
        res.setHeader('Cache-Control', 'public, max-age=60');
        return sendError(
          res,
          503,
          'fx_unavailable',
          'No exchange-rate table available yet. Amounts are shown in their own currency.',
        );
      }
      res.setHeader('Cache-Control', 'public, max-age=1800');
      sendJson(res, 200, {
        ok: true,
        base: table.base,
        rates: table.rates,
        fetchedAt: table.fetchedAt,
        providerUpdatedAt: table.providerUpdatedAt,
        provider: table.provider,
        stale: table.stale,
      });
    } catch (e) {
      sendError(res, 500, 'fx_failed', e.message);
    }
  }

  return {
    id: 'fx',
    routes: [{ method: 'GET', path: '/api/v1/fx-rates', handler: handleFxRates }],
  };
}

module.exports = { createFxModule };
