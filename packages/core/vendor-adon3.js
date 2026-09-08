'use strict';

/**
 * Inspection of the published, explicitly provisional Adon3 response carrier.
 * Recognition is not vendor certification. Keep decimal prices and tracking
 * values as supplied; this owner performs no conversion, mutation or I/O.
 */
const { LEVELS, makeFinding } = require('./findings');

const F = makeFinding;

function isRecord(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonblankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAdon3Response(value) {
  return (
    isRecord(value) &&
    !['imp', 'seatbid', 'openrtb'].some((key) => Object.hasOwn(value, key)) &&
    ['rid', 'cur', 'ads'].every((key) => Object.hasOwn(value, key))
  );
}

function isHttpUrl(value) {
  if (!isNonblankString(value) || /\s/.test(value)) return false;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 32 || value.charCodeAt(i) === 127) return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

// A single pass avoids float precision/overflow and accepts the complete
// supplied decimal string, including six-place pop prices and trailing zeros.
function isDecimalString(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  let decimalPoint = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (ch >= 48 && ch <= 57) continue;
    if (ch === 46 && !decimalPoint && i > 0 && i < value.length - 1) {
      decimalPoint = true;
      continue;
    }
    return false;
  }
  return true;
}

function validateAdon3Response(value) {
  const findings = [F('feed.adon3.provisional_contract', LEVELS.WARNING, '', { vendor: 'Adon3' })];
  const result = { type: 'Provisional Adon3 Response', findings };
  const payload = isRecord(value) ? value : {};

  for (const field of ['rid', 'cur']) {
    if (!Object.hasOwn(payload, field) || !isNonblankString(payload[field])) {
      findings.push(F('feed.adon3.field_invalid', LEVELS.ERROR, field, { field }));
    }
  }

  if (!Array.isArray(payload.ads) || payload.ads.length === 0) {
    findings.push(F('feed.adon3.ads_invalid', LEVELS.ERROR, 'ads', {}));
    return result;
  }

  for (let i = 0; i < payload.ads.length; i++) {
    const row = payload.ads[i];
    const path = `ads[${i}]`;
    if (!isRecord(row)) {
      findings.push(F('feed.adon3.field_invalid', LEVELS.ERROR, path, { field: 'ad' }));
      continue;
    }

    for (const field of ['url', 'imp_url']) {
      if (!Object.hasOwn(row, field) || !isHttpUrl(row[field])) {
        findings.push(F('feed.adon3.field_invalid', LEVELS.ERROR, `${path}.${field}`, { field }));
      }
    }
    if (!Object.hasOwn(row, 'price') || !isDecimalString(row.price)) {
      findings.push(F('feed.adon3.price_invalid', LEVELS.ERROR, `${path}.price`, {}));
    }

    // Optional typed fields remain optional. A future nonempty pop_type value
    // is covered by the provisional warning, not rejected as a final enum.
    for (const field of ['cid', 'title', 'text', 'pop_type']) {
      if (Object.hasOwn(row, field) && typeof row[field] !== 'string') {
        findings.push(F('feed.adon3.field_invalid', LEVELS.ERROR, `${path}.${field}`, { field }));
      }
    }
    for (const field of ['image', 'icon']) {
      if (Object.hasOwn(row, field) && !isHttpUrl(row[field])) {
        findings.push(F('feed.adon3.field_invalid', LEVELS.ERROR, `${path}.${field}`, { field }));
      }
    }
    for (const field of ['exp', 'freq_cap']) {
      if (Object.hasOwn(row, field) && !(Number.isInteger(row[field]) && row[field] >= 0)) {
        findings.push(F('feed.adon3.field_invalid', LEVELS.ERROR, `${path}.${field}`, { field }));
      }
    }
  }
  return result;
}

function adon3ResponseFormats(value) {
  if (!isAdon3Response(value) || !Array.isArray(value.ads)) return [];
  const formats = new Set();
  for (const row of value.ads) {
    if (!isRecord(row)) continue;
    if (row.pop_type === 'under' || row.pop_type === 'over') formats.add('pops');
    if (
      isNonblankString(row.title) &&
      (isNonblankString(row.image) || isNonblankString(row.icon))
    ) {
      formats.add('push');
    }
  }
  return Array.from(formats);
}

module.exports = { isAdon3Response, validateAdon3Response, adon3ResponseFormats };
