'use strict';

// Thin structured-logging wrapper. Uses pino when available in Node and falls
// back to a console stub otherwise. Node/CommonJS is the supported package
// distribution contract; this fallback is not a browser-bundle guarantee.
// LOG_LEVEL=silent suppresses all output — set by the test runner.

let logger;

if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  try {
    const pino = require('pino');
    logger = pino({ level: process.env.LOG_LEVEL || 'info', name: 'ortbtools-core' });
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
