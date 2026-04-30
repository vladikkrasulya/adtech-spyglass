'use strict';

/**
 * Shared predicates and regex constants used across rule modules.
 * Pure functions — safe in browser and Node.
 */

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const ISO_3166_ALPHA3 = /^[A-Z]{3}$/; // device.geo.country
const ISO_639_ALPHA2 = /^[a-z]{2}(-[A-Z]{2})?$/; // device.language

module.exports = { isObj, isStr, isNum, ISO_3166_ALPHA3, ISO_639_ALPHA2 };
