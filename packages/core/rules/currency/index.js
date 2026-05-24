'use strict';

/**
 * Currency validation — ISO-4217 Set check on req.cur / res.cur / bid.cur.
 *
 * Request-side: validates each entry in req.cur against the ISO-4217 active
 * alpha-code Set (180+ codes). Also checks if req.cur is a string instead of
 * array (wrong type → err-bid-currency-invalid with context:'request').
 *
 * Response-side: validates res.cur and every seatbid[].bid[].cur for ISO-4217
 * validity AND checks that the currency is in the allowed set from the paired
 * request (req.cur || ['USD']). Mismatch check is gated on ctx.req being
 * available (paired context). When only a response is pasted standalone,
 * only format validation runs.
 *
 * The crosscheck module handles the high-level cur_not_in_request finding.
 * This rule focuses on ISO-4217 format validity and per-bid currency mismatch.
 *
 * Rules:
 *   err-bid-currency-invalid  — a currency value is not valid ISO-4217
 *   err-bid-currency-mismatch — a bid/response currency is not in allowed set
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

// ISO-4217: exactly 3 uppercase ASCII letters — cheap pre-check
const ISO4217_RE = /^[A-Z]{3}$/;

// Canonical ISO-4217 active alpha codes (180+ currencies, as of 2025)
// Source: ISO 4217 maintenance agency + IMF SDR
const ISO_4217_CODES = new Set([
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'ANG',
  'AOA',
  'ARS',
  'AUD',
  'AWG',
  'AZN',
  'BAM',
  'BBD',
  'BDT',
  'BGN',
  'BHD',
  'BIF',
  'BMD',
  'BND',
  'BOB',
  'BOV',
  'BRL',
  'BSD',
  'BTN',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHE',
  'CHF',
  'CHW',
  'CLF',
  'CLP',
  'CNY',
  'COP',
  'COU',
  'CRC',
  'CUP',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'EUR',
  'FJD',
  'FKP',
  'GBP',
  'GEL',
  'GHS',
  'GIP',
  'GMD',
  'GNF',
  'GTQ',
  'GYD',
  'HKD',
  'HNL',
  'HTG',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KGS',
  'KHR',
  'KMF',
  'KPW',
  'KRW',
  'KWD',
  'KYD',
  'KZT',
  'LAK',
  'LBP',
  'LKR',
  'LRD',
  'LSL',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MNT',
  'MOP',
  'MRU',
  'MUR',
  'MVR',
  'MWK',
  'MXN',
  'MXV',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PGK',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SBD',
  'SCR',
  'SDG',
  'SEK',
  'SGD',
  'SHP',
  'SLL',
  'SOS',
  'SRD',
  'SSP',
  'STN',
  'SVC',
  'SYP',
  'SZL',
  'THB',
  'TJS',
  'TMT',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'USN',
  'UYI',
  'UYU',
  'UYW',
  'UZS',
  'VES',
  'VND',
  'VUV',
  'WST',
  'XAF',
  'XAG',
  'XAU',
  'XBA',
  'XBB',
  'XBC',
  'XBD',
  'XCD',
  'XDR',
  'XOF',
  'XPD',
  'XPF',
  'XPT',
  'XSU',
  'XTS',
  'XUA',
  'XXX',
  'YER',
  'ZAR',
  'ZMW',
  'ZWL',
]);

function isValidCurrency(v) {
  if (typeof v !== 'string') return false;
  if (!ISO4217_RE.test(v)) return false; // cheap: wrong format
  return ISO_4217_CODES.has(v); // real: not in known list
}

function validate(payload, ctx) {
  const findings = [];
  if (!payload || typeof payload !== 'object') return findings;

  const type = (ctx && ctx.type) || 'ORTB_REQUEST';

  if (type === 'ORTB_REQUEST') {
    // req.cur must be an array of ISO-4217 strings
    if (payload.cur != null) {
      if (!Array.isArray(payload.cur)) {
        // Wrong type for req.cur (e.g. string instead of array)
        findings.push(
          F('err-bid-currency-invalid', LEVELS.ERROR, 'cur', {
            val: String(payload.cur),
            context: 'request',
          }),
        );
      } else {
        payload.cur.forEach((c, i) => {
          if (!isValidCurrency(c)) {
            findings.push(
              F('err-bid-currency-invalid', LEVELS.ERROR, `cur[${i}]`, {
                val: String(c),
                context: 'request',
              }),
            );
          }
        });
      }
    }
    return findings;
  }

  if (type === 'ORTB_RESPONSE') {
    // Determine allowed currencies from paired request (if available)
    const req = ctx && ctx.req;
    const allowedRaw = req && Array.isArray(req.cur) && req.cur.length > 0 ? req.cur : ['USD']; // default per oRTB §4.3: if absent, USD is assumed
    const allowedSet = new Set(allowedRaw.filter(isValidCurrency));

    // Validate top-level res.cur
    if (payload.cur != null) {
      if (!isValidCurrency(payload.cur)) {
        findings.push(
          F('err-bid-currency-invalid', LEVELS.ERROR, 'cur', {
            val: String(payload.cur),
            context: 'response',
          }),
        );
      } else if (req && !allowedSet.has(payload.cur)) {
        findings.push(
          F('err-bid-currency-mismatch', LEVELS.ERROR, 'cur', {
            val: payload.cur,
            allowed: JSON.stringify(allowedRaw),
          }),
        );
      }
    }

    // Validate per-bid cur fields
    if (Array.isArray(payload.seatbid)) {
      payload.seatbid.forEach((sb, si) => {
        if (!sb || !Array.isArray(sb.bid)) return;
        sb.bid.forEach((bid, bi) => {
          if (!bid || bid.cur == null) return;
          const path = `seatbid[${si}].bid[${bi}].cur`;
          if (!isValidCurrency(bid.cur)) {
            findings.push(
              F('err-bid-currency-invalid', LEVELS.ERROR, path, {
                val: String(bid.cur),
                context: 'bid',
              }),
            );
          } else if (req && !allowedSet.has(bid.cur)) {
            findings.push(
              F('err-bid-currency-mismatch', LEVELS.ERROR, path, {
                val: bid.cur,
                allowed: JSON.stringify(allowedRaw),
              }),
            );
          }
        });
      });
    }
  }

  return findings;
}

module.exports = {
  id: 'currency',
  description:
    'Validates ISO-4217 format of req.cur / res.cur / bid.cur (Set of 180+ codes) and checks response currencies are in the request-allowed set.',
  appliesTo: ['ORTB_REQUEST', 'ORTB_RESPONSE'],
  validate,
  // Expose for tests
  _isValidCurrency: isValidCurrency,
  _ISO_4217_CODES: ISO_4217_CODES,
};
