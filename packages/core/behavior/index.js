'use strict';

/**
 * @kyivtech/spyglass-core/behavior — public API.
 *
 *   analyze(events, { locale }) → { findings, status, eventCount }
 *
 * Consumes raw probe events emitted by the in-iframe creative-probe.js
 * (postMessage payloads with `type: 'spyglass-probe'`) and produces
 * decorated findings in the same shape as the validator:
 *   { id, level, path, params, msg, specRef }
 *
 * Pure data → data: no DOM, no postMessage, no Node-only APIs. Runs
 * identically server-side (Stream-pivot specimen replay) and browser-side
 * (live preview via /api/analyze-behavior).
 */

const { analyze } = require('./analyze');

module.exports = { analyze };
