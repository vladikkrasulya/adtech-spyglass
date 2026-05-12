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

module.exports = { logger, child };
