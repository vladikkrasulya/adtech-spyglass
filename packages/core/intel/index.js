'use strict';

/**
 * Discovery / Spyglass Intelligence — pure helpers.
 *
 * The browser-only orchestration (IndexedDB storage, banner UI, observer
 * wiring) lives in public/modules/intel/. The pieces here are pure JS
 * with no DOM dependencies, so they're testable in Node and reusable
 * server-side if/when contribution-aggregation telemetry ships in
 * Phase 7d.
 */

const { extractFields, bucketize } = require('./walker');
const { fingerprintValue, classifyString } = require('./fingerprint');
const { applyDecay, DEFAULT_HALF_LIFE_HOURS } = require('./decay');
const { isLearnable } = require('./gate');

module.exports = {
  extractFields,
  bucketize,
  fingerprintValue,
  classifyString,
  applyDecay,
  DEFAULT_HALF_LIFE_HOURS,
  isLearnable,
};
