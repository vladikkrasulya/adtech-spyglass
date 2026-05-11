'use strict';

/**
 * modules/analyze/handler.js — POST /api/analyze + /api/analyze-behavior.
 *
 * Two routes share one module because they're the human-paste front door:
 *   • /api/analyze         — { bidReq, bidRes } → validation + crosscheck +
 *                            category decode + format detection + per-user
 *                            AnalyzeLog write (auth-gated, metadata only).
 *   • /api/analyze-behavior — runs the behavior engine over an array of
 *                            probe events captured by the in-iframe
 *                            creative-probe.js. Stateless, anonymous-safe.
 *
 * The two routes have separate rate-limiter buckets (analyzeLimiter +
 * behaviorLimiter) because anonymous behavior-analyze is more attractive to
 * fuzzers than the auth-friendly /api/analyze surface — see the comment
 * around BEHAVIOR_MAX_PER_WINDOW in server.js.
 *
 * Factory shape mirrors modules/mirror/handler.js + modules/replay/handler.js:
 * server.js injects closure-scoped helpers (limiters, auth, locale
 * resolvers, core pipeline fns, AnalyzeLog) at boot so this module stays
 * decoupled from server.js internals and testable in isolation.
 *
 * Wiring (in server.js):
 *   const { createAnalyzeModule } = require('./modules/analyze/handler');
 *   router.register(createAnalyzeModule({
 *     analyzeLimiter, behaviorLimiter, auth,
 *     ANALYZE_MAX_PER_WINDOW, BEHAVIOR_MAX_PER_WINDOW,
 *     resolveLocale, resolveDialect,
 *     validate, crosscheck, analyzeBehavior,
 *     extractAllCategories, detectFormat, unionFormat,
 *     AnalyzeLog,
 *   }));
 */

const { readJson, sendJson, sendError } = require('../../lib/http');

/**
 * @param {{
 *   analyzeLimiter: (key: string) => boolean,
 *   behaviorLimiter: (key: string) => boolean,
 *   auth: {
 *     clientIp: (req: import('http').IncomingMessage) => string,
 *     getCurrentUser: (req: import('http').IncomingMessage) => ({ id: number } | null),
 *   },
 *   ANALYZE_MAX_PER_WINDOW: number,
 *   BEHAVIOR_MAX_PER_WINDOW: number,
 *   resolveLocale: (parsed: URL) => string,
 *   resolveDialect: (parsed: URL) => string,
 *   validate: Function,
 *   crosscheck: Function,
 *   analyzeBehavior: Function,
 *   extractAllCategories: Function,
 *   detectFormat: Function,
 *   unionFormat: Function,
 *   AnalyzeLog: { record: Function },
 * }} deps
 */
function createAnalyzeModule(deps) {
  const {
    analyzeLimiter,
    behaviorLimiter,
    auth,
    ANALYZE_MAX_PER_WINDOW,
    BEHAVIOR_MAX_PER_WINDOW,
    resolveLocale,
    resolveDialect,
    validate,
    crosscheck,
    analyzeBehavior,
    extractAllCategories,
    detectFormat,
    unionFormat,
    AnalyzeLog,
  } = deps;

  function handleAnalyze(req, res, parsed) {
    if (!analyzeLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        `Too many analyze calls. Try again shortly (limit: ${ANALYZE_MAX_PER_WINDOW}/min/IP).`,
      );
    }
    const locale = resolveLocale(parsed);
    const dialect = resolveDialect(parsed);
    readJson(req)
      .then((body) => {
        const { bidReq, bidRes } = body || {};
        const hasReq = bidReq && typeof bidReq === 'object' && Object.keys(bidReq).length > 0;
        const hasRes = bidRes && typeof bidRes === 'object' && Object.keys(bidRes).length > 0;

        // Optional `opts.disabledRules`: forwarded to validate() / crosscheck()
        // for per-call rule suppression. Accepts string[] of exact ids or
        // trailing-`*` prefixes (e.g. ['imp.*', 'regs.coppa_pii_present']).
        // See packages/core/README.md → "API stability contract".
        const rawDisabled = body && body.opts && body.opts.disabledRules;
        const disabledRules = Array.isArray(rawDisabled)
          ? rawDisabled.filter((r) => typeof r === 'string' && r.length).slice(0, 100)
          : undefined;

        // Empty payload is now an explicit 400 instead of a synthetic
        // "unknown_type" finding masquerading as a real validation error.
        if (!hasReq && !hasRes) {
          return sendError(
            res,
            400,
            'empty_payload',
            'Provide bidReq or bidRes (or both) in the request body',
          );
        }

        // Branch on what was actually sent — running validate({}) when only
        // bidRes is present produced a misleading payload.unknown_type error
        // that masked perfectly valid response findings.
        let validation;
        if (hasReq) {
          validation = validate(bidReq, { locale, dialect, disabledRules });
          if (hasRes) {
            const resValidation = validate(bidRes, { locale, dialect, disabledRules });
            if (resValidation.findings && resValidation.findings.length) {
              validation.findings = validation.findings.concat(
                resValidation.findings.map((f) =>
                  Object.assign({}, f, { msg: '[response] ' + f.msg }),
                ),
              );
            }
          }
        } else {
          // Response-only path. Validate bidRes and prefix findings for clarity.
          validation = validate(bidRes, { locale, dialect, disabledRules });
          validation.findings = validation.findings.map((f) =>
            Object.assign({}, f, { msg: '[response] ' + f.msg }),
          );
        }

        // Recompute status from the union — `errors` if any finding is error,
        // else `warnings` if any warning, else `clean`. (Mirrors the core
        // rollupStatus helper without importing it; keep in sync.)
        const levels = new Set((validation.findings || []).map((f) => f.level));
        validation.status = levels.has('error')
          ? 'errors'
          : levels.has('warning')
            ? 'warnings'
            : 'clean';

        const cross =
          hasReq && hasRes ? crosscheck(bidReq, bidRes, { locale, dialect, disabledRules }) : [];

        // Decode IAB Content Taxonomy codes (cat / bcat / pcat / sectioncat
        // / pagecat / bid.cat) into English labels so the frontend can render
        // human text alongside `IAB9-11` etc. without bundling its own dict.
        const categories = {};
        if (hasReq) Object.assign(categories, extractAllCategories(bidReq));
        if (hasRes) Object.assign(categories, extractAllCategories(bidRes));

        // Phase 10b — third detection axis (banner/video/audio/native/push/…
        // + web/inapp/ctv/dooh + vast-N/daast). Compute on whichever payloads
        // were sent and union the results; the request side carries
        // imp[].banner|video|audio|native + context, the response side
        // carries mtype + adm sniffing. A null/empty `format` is a valid
        // outcome — the frontend gates rendering on `confidence`.
        const formatReq = hasReq ? detectFormat(bidReq) : null;
        const formatRes = hasRes ? detectFormat(bidRes) : null;
        const format = unionFormat(formatReq, formatRes);

        // Per-user usage tracking — METADATA only, never the payload bodies.
        // Skipped for anonymous calls (no user_id). The personal cabinet's
        // Insights section reads aggregates back via /api/account/insights.
        try {
          const currentUser = auth.getCurrentUser(req);
          if (currentUser && currentUser.id) {
            const findings = (validation && validation.findings) || [];
            const errs = findings.filter((f) => f.level === 'error').length;
            const warns = findings.filter((f) => f.level === 'warning').length;
            const fmt =
              format && format.formats && format.formats.length
                ? format.formats.length === 1
                  ? format.formats[0]
                  : 'multi'
                : null;
            AnalyzeLog.record({
              userId: currentUser.id,
              payloadType: hasReq && hasRes ? 'both' : hasReq ? 'request' : 'response',
              version:
                validation && validation.version && validation.version.version
                  ? validation.version.version
                  : null,
              status: validation && validation.status ? validation.status : 'unknown',
              format: fmt,
              findingCount: findings.length,
              errorCount: errs,
              warningCount: warns,
            });
          }
        } catch (e) {
          // Tracking failure must never break the response. Log + continue.
          console.error('[analyze-log] record failed:', e.message);
        }

        sendJson(res, 200, {
          success: true,
          validation,
          crosscheck: cross,
          meta: { locale, dialect, categories, format },
        });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }

  function handleAnalyzeBehavior(req, res, parsed) {
    if (!behaviorLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        `Too many behavior-analyze calls. Try again shortly (limit: ${BEHAVIOR_MAX_PER_WINDOW}/min/IP).`,
      );
    }
    const locale = resolveLocale(parsed);
    readJson(req)
      .then(({ events, adm }) => {
        if (!Array.isArray(events)) {
          return sendError(res, 400, 'invalid_input', 'events array is required');
        }
        // Server-side events cap (v0.25.0; head-only → head+tail in
        // v0.37.1 after Pro-audit P1-003). Probe-side already emits
        // summarised events (one click_burst per burst, not one per
        // click), so a real session tops out at ~100 events. A caller
        // bypassing the probe and POSTing a flood directly would
        // otherwise burn CPU in the rules loop.
        //
        // Why head+tail and not head-only: malicious flooding can
        // intentionally pad with thousands of benign mousemove events
        // up front to push the real fraud signal (auto_redirect,
        // frame_bust) past the head boundary — head-slice would then
        // return status:clean. Sampling both ends preserves the
        // probe_ready handshake (always at index 0) AND the latest
        // events (where the fraud action most often sits). A 50/50
        // split keeps total within MAX_EVENTS while exercising both
        // boundaries of the timeline.
        const MAX_EVENTS = 1000;
        const HEAD_SAMPLE = 500;
        const TAIL_SAMPLE = 500;
        const truncated = events.length > MAX_EVENTS;
        const capped = truncated
          ? events.slice(0, HEAD_SAMPLE).concat(events.slice(-TAIL_SAMPLE))
          : events;

        // Phase 6: optional `adm` field carries the raw creative string for
        // static-payload analysis (obfuscation/miner/XSS pattern matching +
        // entropy). Engine treats it as opt-in; callers that omit it get
        // the pre-Phase-6 runtime-only pipeline.
        const r = analyzeBehavior(capped, {
          locale,
          adm: typeof adm === 'string' ? adm : '',
        });
        sendJson(res, 200, {
          success: true,
          findings: r.findings,
          status: r.status,
          eventCount: r.eventCount,
          meta: { locale, truncated, maxEvents: MAX_EVENTS },
        });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  return {
    id: 'analyze',
    routes: [
      { method: 'POST', path: '/api/analyze', handler: handleAnalyze },
      { method: 'POST', path: '/api/analyze-behavior', handler: handleAnalyzeBehavior },
    ],
  };
}

module.exports = { createAnalyzeModule };
