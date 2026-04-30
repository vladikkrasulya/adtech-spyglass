'use strict';

/**
 * Payload type detection. Phase 1 only distinguishes the four top-level shapes
 * we know how to validate. Phase 2 will add `detectVersion()` for OpenRTB 2.5
 * vs 2.6 vs 2.6-202309 etc., per the tiered signals in ARCHITECTURE §3.3.
 */

const { isObj } = require('./helpers');

const TYPES = {
  ORTB_REQUEST: 'oRTB BidRequest',
  ORTB_RESPONSE: 'oRTB BidResponse',
  KADAM_FEED: 'Kadam Feed Response',
  JSON_FEED: 'JSON Feed 1.1',
  UNKNOWN: 'unknown',
};

function detectType(obj) {
  // Arrays are Kadam push-feed responses (list of materials).
  if (Array.isArray(obj)) return TYPES.KADAM_FEED;
  if (!isObj(obj)) return TYPES.UNKNOWN;

  // Structural markers — the canonical array decides the type.
  // (id is recommended but not load-bearing; payloads missing id should still
  // dispatch to the right validator so it can emit "missing id" findings.)
  if (Array.isArray(obj.imp)) return TYPES.ORTB_REQUEST;
  if (Array.isArray(obj.seatbid)) return TYPES.ORTB_RESPONSE;
  if (obj.result && Array.isArray(obj.result.listing)) return TYPES.KADAM_FEED;
  if (obj.version && obj.items) return TYPES.JSON_FEED;

  // Heuristics for malformed payloads — dispatch to the validator that can
  // produce actionable findings instead of "unknown".
  if (obj.site || obj.app || obj.device) return TYPES.ORTB_REQUEST;
  if (typeof obj.id === 'string' && (obj.cur != null || obj.bidid != null || obj.nbr != null)) {
    return TYPES.ORTB_RESPONSE;
  }
  return TYPES.UNKNOWN;
}

module.exports = { detectType, TYPES };
