'use strict';

/**
 * lib/logger.js — pino-based structured logger for the Spyglass server.
 *
 * One process-wide pino instance. Modules get a child via
 * `logger.child({ component: 'auth' })` so log lines self-identify
 * without every call having to repeat a tag prefix.
 *
 * Configuration knobs (env-driven, evaluated at module load):
 *   LOG_LEVEL  — pino level: 'fatal' | 'error' | 'warn' | 'info' |
 *                'debug' | 'trace' | 'silent'.
 *                Default: 'info' (or 'silent' when NODE_ENV === 'test').
 *   NODE_ENV   — when not 'production', uses pino-pretty for human-
 *                readable output. In production: line-delimited JSON.
 *
 * Why this exists: pre-2026-05-12 the server used `console.log/.error`
 * inline. That works but doesn't give us per-component child loggers,
 * structured error fields, level-based filtering, or JSON output for
 * log aggregators. Pino gives all four with negligible overhead and
 * no transport drama (pretty-print is dev-only via a dependency-
 * injected stream).
 *
 * NOT for browser-side code — `public/**` keeps its existing
 * `console.*` calls. Pino is Node-only.
 */

const pino = require('pino');
const Sentry = require('@sentry/node');

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

const level = process.env.LOG_LEVEL || (isTest ? 'silent' : 'info');

const baseOptions = {
  level,
  // Standard err serializer — pino renders `err.message`, `err.stack`,
  // `err.code` etc. as flat fields. Keeps stack traces structured.
  serializers: pino.stdSerializers,
  // Drop `pid` and `hostname` from each line — for a single-process
  // container they're constant noise. The container name in compose +
  // the request-id (when we add it) carry the routing info.
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
};

// Pretty-print for local dev. In production it's pure JSON to stdout —
// the container engine / aggregator handles indexing.
const logger = isProd
  ? pino(baseOptions)
  : pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: false,
          messageFormat: '{component} | {msg}',
        },
      },
    });

/**
 * Get a child logger scoped to a named component. Use this instead of
 * the root `logger` from every module so every line carries its origin.
 *
 *   const log = require('./lib/logger').child('auth');
 *   log.error({ err }, 'verify email send failed');
 *
 * @param {string} component
 * @returns {import('pino').Logger}
 */
function child(component) {
  return logger.child({ component });
}

// ── Sentry / GlitchTip integration ─────────────────────────────────────────
//
// When SENTRY_DSN is set in the environment, capture uncaught and explicit-
// `captureException` calls into the upstream GlitchTip instance (Sentry-
// protocol compatible — same SDK works for both). When unset, the helpers
// no-op cleanly so dev / test boots don't fail.
//
// GlitchTip is the self-hosted target at /srv/DATA/Stacks/glitchtip/ —
// no SaaS dependency. The SDK ships the same envelope format Sentry uses,
// and the GlitchTip Django app accepts it at /api/<project>/store/.

let _sentryReady = false;

if (process.env.SENTRY_DSN && !isTest) {
  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: isProd ? 'production' : 'development',
      release: process.env.BUILD_SHA || 'dev',
      // We're not (yet) doing performance tracing — keep payload focused
      // on errors. Bump to 0.1 if/when we want request spans.
      tracesSampleRate: 0,
      // Don't send PII by default — bid payloads can carry user IPs, UAs,
      // GDPR consent strings. Opt in per call via Sentry.setContext if a
      // specific error needs more context.
      sendDefaultPii: false,
    });
    _sentryReady = true;
  } catch (_e) {
    // Bad DSN, network error, etc. — never let observability crash boot.
    _sentryReady = false;
  }
}

/**
 * Report an exception to GlitchTip/Sentry. No-ops when SENTRY_DSN isn't
 * configured (dev/test) so callers don't need to feature-check. Optional
 * `ctx` becomes the `extra`/`contexts` payload on the captured event —
 * pass `{ request: { method, url } }` etc.
 *
 * Never throws — observability failures shouldn't crash the app.
 *
 * @param {unknown} err
 * @param {Record<string, unknown>} [ctx]
 */
function captureException(err, ctx) {
  if (!_sentryReady) return;
  try {
    Sentry.withScope((scope) => {
      if (ctx && typeof ctx === 'object') {
        for (const [k, v] of Object.entries(ctx)) {
          if (v && typeof v === 'object') {
            scope.setContext(k, /** @type {Record<string, unknown>} */ (v));
          } else if (v !== undefined && v !== null) {
            scope.setTag(k, String(v));
          }
        }
      }
      Sentry.captureException(err);
    });
  } catch (_e) {
    // swallow — never let Sentry crash the caller
  }
}

/**
 * For graceful-shutdown paths: flush in-flight Sentry events. No-op when
 * Sentry isn't configured. Returns when flush completes OR after timeout.
 *
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<boolean>}
 */
async function flushSentry(timeoutMs) {
  if (!_sentryReady) return true;
  try {
    return await Sentry.flush(timeoutMs || 2000);
  } catch (_e) {
    return false;
  }
}

/** Is Sentry initialized? (For tests and the /api/health debug surface.) */
function sentryReady() {
  return _sentryReady;
}

module.exports = { logger, child, captureException, flushSentry, sentryReady };
