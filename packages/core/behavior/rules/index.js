'use strict';

/**
 * Behavior rule registry.
 *
 * Each family of rules lives in its own file and exports an array of
 * pure rule functions `(events, ctx) → Finding[]`. We concat them into
 * a flat list that analyze.js iterates. Adding a new family: drop a
 * file in this folder, append it here.
 *
 * Phase 1 — misclick (UX traps, dark patterns)
 * Phase 2 — bot-patterns (scripted input, headless tells)
 * Phase 3+ — malicious (heavy ads, frame-bust, miners) — TBD
 */

const misclick = require('./misclick');
const botPatterns = require('./bot-patterns');

module.exports = [...misclick, ...botPatterns];
