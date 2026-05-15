'use strict';

// Thin structured-logging wrapper. Uses pino in Node; falls back to a
// console stub in browser/worker environments (core is browser-compatible).
// LOG_LEVEL=silent suppresses all output — set by the test runner.

let logger;

if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  try {
    const pino = require('pino');
    logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'spyglass-core' });
  } catch (_) {
    logger = makeConsoleStub();
  }
} else {
  logger = makeConsoleStub();
}

function makeConsoleStub() {
  return {
    error(obj, msg) {
      console.error(msg || obj, msg ? obj : undefined);
    },
  };
}

module.exports = logger;
