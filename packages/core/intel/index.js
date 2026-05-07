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
const { detectClusters, MIN_FIELD_SCORE, MIN_COOCCURRENCE } = require('./cluster');
const {
  applyTempDialect,
  resolvePath,
  generateTempDialectId,
  isTempDialectId,
  TEMP_DIALECT_ID_PREFIX,
} = require('./temp-dialect');

module.exports = {
  extractFields,
  bucketize,
  fingerprintValue,
  classifyString,
  applyDecay,
  DEFAULT_HALF_LIFE_HOURS,
  isLearnable,
  // Phase 7b
  detectClusters,
  MIN_FIELD_SCORE,
  MIN_COOCCURRENCE,
  applyTempDialect,
  resolvePath,
  generateTempDialectId,
  isTempDialectId,
  TEMP_DIALECT_ID_PREFIX,
};
