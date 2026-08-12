'use strict';

/**
 * modules/telemetry/handler.js — product telemetry ingest + operator summary.
 *
 * Two routes:
 *
 *   POST /api/v1/telemetry/event    public beacon (browser → server)
 *   GET  /api/v1/telemetry/summary  operator read, Bearer ADMIN_STATS_TOKEN
 *
 * ── The beacon ─────────────────────────────────────────────────────────────
 * Some product events only exist in the browser — a tab session starting, the
 * Macro Evaluator being used, a share link being produced. Those cannot be
 * inferred from server logs, so public/telemetry.js posts them here.
 *
 * The endpoint is deliberately dull and hard to abuse:
 *   - 2 KB body cap, refused at the transport layer (lib/http.js maxBytes).
 *   - Every field is re-validated and the row is REBUILT by
 *     lib/product-telemetry.js buildRow(); nothing caller-supplied is stored
 *     verbatim except values that survive an enum/regex check.
 *   - The traffic class is recomputed server-side. The body's `internal` flag
 *     can only DEMOTE the request out of `external`, never promote into it.
 *   - Cross-site posts are rejected via Sec-Fetch-Site. A `text/plain` beacon
 *     is a CORS "simple request", so without this check any page on the web
 *     could inject counter noise.
 *   - Per-IP rate limited, and it ALWAYS answers 204 with no body. Success,
 *     drop, disabled and malformed are indistinguishable from outside, so the
 *     endpoint leaks nothing about its own configuration.
 *
 * ── The summary ────────────────────────────────────────────────────────────
 * Serves the three product questions the acceptance criteria name — activation,
 * repeat usage, D1/D7/D30 retention — plus the traffic-class split that proves
 * monitoring and owner traffic are excluded. All aggregates run over
 * `is_external = 1` only. Cohorts carry explicit maturity flags so a 3-day-old
 * cohort is never read as "0% D7 retention" when it simply cannot know yet.
 *
 * Gated by the same Bearer ADMIN_STATS_TOKEN as /api/admin/stats — this is
 * operator data, not user data.
 */

const { readJson, sendJson, sendError } = require('../../lib/http');
const log = require('../../lib/logger').child('telemetry');
const {
  recordProductEvent,
  isProductTelemetryEnabled,
  sanitizeReferrerHost,
  TABLE,
  RETENTION_DAYS,
} = require('../../lib/product-telemetry');
const { chQuery } = require('../../lib/clickhouse');

/** Enough for the fixed-shape beacon record with generous headroom. */
const BEACON_MAX_BYTES = 2048;

/** Only `is_external` rows with a usable cohort id take part in the metrics. */
const EXTERNAL_FILTER = "is_external = 1 AND visitor_id != ''";

/**
 * Reject a beacon that a third-party page fired at us. Browsers that do not
 * send Sec-Fetch-Site (older Safari) are allowed through — the rate limiter and
 * the field contract still bound the damage.
 * Takes only what it reads — the headers bag — so it stays callable from a
 * contract test without fabricating a whole IncomingMessage.
 *
 * @param {{ headers: Record<string, any> }} req
 */
function isSameSiteBeacon(req) {
  const site = req.headers['sec-fetch-site'];
  if (typeof site !== 'string' || site === '') return true;
  return site === 'same-origin' || site === 'same-site' || site === 'none';
}

/**
 * @param {object} deps
 * @param {(key: string) => boolean} deps.telemetryLimiter
 * @param {{ clientIp: (req: any) => string, getCurrentUser: (req: any) => any }} deps.auth
 */
function createTelemetryModule(deps) {
  const { telemetryLimiter, auth } = deps;

  // ── POST /api/v1/telemetry/event ─────────────────────────────────────────
  function handleBeacon(req, res) {
    // 204 no matter what. Declared once so every exit path is identical.
    // Guarded because an oversized body makes readJson destroy the request,
    // which can take the socket with it — answering a dead socket must not
    // surface as an unhandled rejection.
    const accepted = () => {
      try {
        res.writeHead(204);
        res.end();
      } catch (_e) {
        /* client already gone */
      }
    };

    let ip = '';
    try {
      ip = auth.clientIp(req);
    } catch (_e) {
      ip = '';
    }

    if (!isSameSiteBeacon(req)) return accepted();
    if (telemetryLimiter && !telemetryLimiter(ip)) return accepted();
    if (!isProductTelemetryEnabled()) return accepted();

    return readJson(req, { maxBytes: BEACON_MAX_BYTES })
      .then((body) => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return accepted();

        let userId = 0;
        try {
          const user = auth.getCurrentUser(req);
          if (user && user.id) userId = user.id;
        } catch (_e) {
          /* anonymous */
        }

        // A referrer pointing at ourselves is in-app navigation, not
        // acquisition — blank it so it never pollutes the source mix.
        let referrer = sanitizeReferrerHost(body.referrer);
        const selfHost = sanitizeReferrerHost(req.headers.host);
        if (referrer && selfHost && referrer === selfHost) referrer = '';

        recordProductEvent({
          event: body.event,
          ip,
          headers: req.headers,
          // `internal: true` is how a browser marks itself as owner/dev traffic
          // (public/telemetry.js, ?__ot_internal=1). Demote-only by contract.
          clientHint: body.internal ? 'internal' : undefined,
          visitorId: body.visitor_id,
          sessionId: body.session_id,
          userId,
          locale: body.locale,
          surface: 'web',
          referrer,
          utmSource: body.utm_source,
          utmMedium: body.utm_medium,
          utmCampaign: body.utm_campaign,
          dnt: body.dnt,
        });
        return accepted();
      })
      .catch(() => accepted());
  }

  // ── GET /api/v1/telemetry/summary ────────────────────────────────────────
  async function handleSummary(req, res, parsed) {
    const expected = process.env.ADMIN_STATS_TOKEN;
    if (!expected) {
      return sendError(res, 503, 'telemetry_summary_disabled', 'ADMIN_STATS_TOKEN not configured');
    }
    const header = req.headers['authorization'] || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || provided !== expected) {
      return sendError(res, 401, 'unauthorized', 'Bearer token required');
    }
    if (!isProductTelemetryEnabled()) {
      return sendError(res, 503, 'telemetry_disabled', 'Product telemetry is disabled');
    }

    const requested = Number(parsed && parsed.searchParams.get('days'));
    const days = Number.isFinite(requested)
      ? Math.max(1, Math.min(RETENTION_DAYS, Math.trunc(requested)))
      : 30;
    const window = `ts >= now() - INTERVAL ${days} DAY`;

    try {
      const [trafficRows, funnelRows, dailyRows, cohortRows] = await Promise.all([
        // Proof that monitoring / owner / agent traffic is separable.
        chQuery(
          `SELECT traffic_class, count() AS events, ` +
            // Skip the empty id (DNT / storage-blocked) so it is not counted as
            // one extra "visitor" shared by every such row.
            `uniqExactIf(visitor_id, visitor_id != '') AS visitors ` +
            `FROM ${TABLE} WHERE ${window} GROUP BY traffic_class ORDER BY events DESC`,
        ),
        // Activation + repeat usage in one pass over per-visitor rollups.
        chQuery(
          `SELECT ` +
            `uniqExact(visitor_id) AS visitors, ` +
            `uniqExactIf(visitor_id, has(events, 'analyze_success')) AS activated, ` +
            `uniqExactIf(visitor_id, active_days >= 2) AS repeat_visitors, ` +
            `uniqExactIf(visitor_id, registered > 0) AS registered ` +
            `FROM (SELECT visitor_id, groupUniqArray(event) AS events, ` +
            `uniqExact(toDate(ts)) AS active_days, ` +
            `countIf(event = 'register') AS registered ` +
            `FROM ${TABLE} WHERE ${EXTERNAL_FILTER} AND ${window} GROUP BY visitor_id)`,
        ),
        chQuery(
          `SELECT toDate(ts) AS day, ` +
            `uniqExact(visitor_id) AS visitors, ` +
            `uniqExactIf(session_id, event = 'session_start' AND session_id != '') AS sessions, ` +
            `countIf(event = 'analyze_success') AS analyses ` +
            `FROM ${TABLE} WHERE ${EXTERNAL_FILTER} AND ${window} ` +
            `GROUP BY day ORDER BY day`,
        ),
        // D1/D7/D30 by acquisition day. `days` is the visitor's set of active
        // dates, so has(days, d0 + N) is an exact "came back on day N" test.
        chQuery(
          `SELECT d0 AS cohort_date, ` +
            `uniqExact(visitor_id) AS cohort_size, ` +
            `uniqExactIf(visitor_id, has(days, d0 + 1)) AS d1, ` +
            `uniqExactIf(visitor_id, has(days, d0 + 7)) AS d7, ` +
            `uniqExactIf(visitor_id, has(days, d0 + 30)) AS d30 ` +
            `FROM (SELECT visitor_id, min(toDate(ts)) AS d0, ` +
            `groupUniqArray(toDate(ts)) AS days ` +
            `FROM ${TABLE} WHERE ${EXTERNAL_FILTER} AND ${window} GROUP BY visitor_id) ` +
            `GROUP BY d0 ORDER BY d0 DESC`,
        ),
      ]);

      const num = (v) => Number(v) || 0;
      const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

      const traffic = trafficRows.map((r) => ({
        traffic_class: String(r.traffic_class || 'unknown'),
        events: num(r.events),
        visitors: num(r.visitors),
      }));

      const f = funnelRows[0] || {};
      const visitors = num(f.visitors);
      const activated = num(f.activated);
      const repeatVisitors = num(f.repeat_visitors);

      const todayMs = Date.now();
      const cohorts = cohortRows.map((r) => {
        const size = num(r.cohort_size);
        const ageDays = Math.floor(
          (todayMs - Date.parse(`${r.cohort_date}T00:00:00Z`)) / 86_400_000,
        );
        // A cohort can only report D-N once N full days have elapsed.
        const mature = (n) => Number.isFinite(ageDays) && ageDays > n;
        return {
          cohort_date: String(r.cohort_date),
          cohort_size: size,
          d1: { retained: num(r.d1), pct: pct(num(r.d1), size), mature: mature(1) },
          d7: { retained: num(r.d7), pct: pct(num(r.d7), size), mature: mature(7) },
          d30: { retained: num(r.d30), pct: pct(num(r.d30), size), mature: mature(30) },
        };
      });

      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, 200, {
        success: true,
        window_days: days,
        generated_at: todayMs,
        // Every metric below counts external traffic only.
        traffic,
        activation: {
          visitors,
          activated,
          pct: pct(activated, visitors),
          registered: num(f.registered),
        },
        repeat_usage: {
          visitors,
          repeat_visitors: repeatVisitors,
          pct: pct(repeatVisitors, visitors),
        },
        retention: cohorts,
        daily: dailyRows.map((r) => ({
          day: String(r.day),
          visitors: num(r.visitors),
          sessions: num(r.sessions),
          analyses: num(r.analyses),
        })),
      });
    } catch (e) {
      log.error({ err: e }, 'telemetry summary failed');
      return sendError(res, 500, 'telemetry_summary_failed', e.message);
    }
  }

  return {
    id: 'telemetry',
    routes: [
      { method: 'POST', path: '/api/v1/telemetry/event', handler: handleBeacon },
      { method: 'GET', path: '/api/v1/telemetry/summary', handler: handleSummary },
    ],
  };
}

module.exports = { createTelemetryModule, BEACON_MAX_BYTES, isSameSiteBeacon };
