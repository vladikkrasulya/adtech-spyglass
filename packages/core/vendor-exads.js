'use strict';

/**
 * EXADS proprietary RTB carrier ownership. JSON POST and GET share field roles;
 * a thin URL decoder supplies decoded fields without rewriting the original.
 * Recognition uses presence, while validation independently checks values.
 *
 * Sources: EXADS publisher RTB request/response and integration contracts.
 * No IAB projection, currency inference, notification execution or URL fetching.
 */

const { isObj, isNum } = require('./helpers');
const { makeFinding, LEVELS } = require('./findings');
const F = makeFinding;

const REQUEST_FIELDS = ['id', 'ip', 'language', 'type', 'ua', 'url', 'user_id', 'export'];
const IDENTITY_FIELDS = ['id', 'ip', 'language', 'ua', 'url', 'user_id'];
const RESPONSE_ANCHORS = ['btype', 'nUrl', 'imgUrl', 'iconUrl', 'clickUrl'];
const REQUEST_TYPES = new Set([
  'banner',
  'popunder',
  'push_notification',
  'in_page_push_notification',
  'direct_link',
  'email_click',
]);
const REQUEST_FORMATS = {
  banner: 'banner',
  popunder: 'pops',
  push_notification: 'push',
  in_page_push_notification: 'inpage',
};

const has = (obj, field) => Object.prototype.hasOwnProperty.call(obj, field);
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;
const iabCarrier = (obj) => ['imp', 'seatbid', 'openrtb'].some((field) => has(obj, field));

function isExadsRequest(obj) {
  if (!isObj(obj) || iabCarrier(obj)) return false;
  const identityCount = IDENTITY_FIELDS.filter((field) => has(obj, field)).length;
  const type = has(obj, 'type');
  const exportField = has(obj, 'export');
  return (
    (type && exportField && identityCount >= 3) || ((type || exportField) && identityCount >= 5)
  );
}

function isExadsResponse(obj) {
  if (!isObj(obj) || iabCarrier(obj) || !has(obj, 'bid') || !isObj(obj.bid)) return false;
  const bid = obj.bid;
  return RESPONSE_ANCHORS.some((field) => has(bid, field)) && (has(bid, 'id') || has(bid, 'value'));
}

/**
 * Transport affects only the representation of sub: integer in JSON, text in
 * a decoded GET. Required string fields and original query paths are shared.
 * @param {any} obj
 * @param {{transport?: 'url' | 'json'}} [options]
 */
function validateExadsRequest(obj, options = {}) {
  const findings = [];
  if (!isObj(obj)) {
    findings.push(F('request.exads.field_invalid', LEVELS.ERROR, '', { field: 'request' }));
    return { type: 'EXADS RTB Request', findings };
  }

  for (const field of REQUEST_FIELDS) {
    if (obj[field] === undefined) {
      findings.push(F('request.exads.field_required', LEVELS.ERROR, field, { field }));
    } else if (!nonblank(obj[field])) {
      findings.push(F('request.exads.field_invalid', LEVELS.ERROR, field, { field }));
    }
  }

  if (nonblank(obj.type) && !REQUEST_TYPES.has(obj.type)) {
    findings.push(F('request.exads.type_unsupported', LEVELS.WARNING, 'type'));
  }
  if (nonblank(obj.export) && obj.export !== 'json' && obj.export !== 'xml') {
    findings.push(F('request.exads.export_invalid', LEVELS.ERROR, 'export'));
  }
  if (obj.size === undefined) {
    if (obj.type === 'banner') {
      findings.push(F('request.exads.field_required', LEVELS.ERROR, 'size', { field: 'size' }));
    }
  } else if (!nonblank(obj.size)) {
    findings.push(F('request.exads.field_invalid', LEVELS.ERROR, 'size', { field: 'size' }));
  }

  for (const field of ['remote_addr', 'x_forwarded_for', 'keyword', 'el']) {
    if (obj[field] !== undefined && typeof obj[field] !== 'string') {
      findings.push(F('request.exads.field_invalid', LEVELS.ERROR, field, { field }));
    }
  }

  if (obj.sub !== undefined) {
    const validRepresentation =
      options.transport === 'url'
        ? typeof obj.sub === 'string' && /^[0-9]+$/.test(obj.sub)
        : isNum(obj.sub) && Number.isInteger(obj.sub) && obj.sub >= 0;
    if (!validRepresentation) {
      findings.push(F('request.exads.field_invalid', LEVELS.ERROR, 'sub', { field: 'sub' }));
    } else if (!/^[1-9][0-9]{5,9}$/.test(String(obj.sub))) {
      // The prose requires 6–10 digits, but published examples use fewer.
      // Preserve that source disagreement as guidance, never a hard rejection.
      findings.push(F('request.exads.sub_nonstandard', LEVELS.WARNING, 'sub'));
    }
  }
  return { type: 'EXADS RTB Request', findings };
}

function validateExadsResponse(obj) {
  const findings = [];
  if (!isObj(obj) || !has(obj, 'bid') || !isObj(obj.bid)) {
    findings.push(F('feed.exads.bid_invalid', LEVELS.ERROR, 'bid'));
    return { type: 'EXADS RTB Response', findings };
  }
  const bid = obj.bid;

  // The response table does not declare individual fields required. Omission
  // gets bounded inspection guidance; explicitly supplied invalid values err.
  for (const field of ['id', 'value']) {
    if (bid[field] === undefined) {
      findings.push(F('feed.exads.field_missing', LEVELS.WARNING, `bid.${field}`, { field }));
    }
  }
  for (const field of ['id', 'imgUrl', 'iconUrl', 'clickUrl', 'url', 'nUrl']) {
    if (bid[field] !== undefined && !nonblank(bid[field])) {
      findings.push(F('feed.exads.field_invalid', LEVELS.ERROR, `bid.${field}`, { field }));
    }
  }
  for (const field of ['title', 'description']) {
    if (bid[field] !== undefined && typeof bid[field] !== 'string') {
      findings.push(F('feed.exads.field_invalid', LEVELS.ERROR, `bid.${field}`, { field }));
    }
  }
  // A nonnegative finite number is the accepted economic inspection policy;
  // no JSON strings, booleans, arrays or objects become a monetary value.
  if (bid.value !== undefined && (!isNum(bid.value) || bid.value < 0)) {
    findings.push(F('feed.exads.value_invalid', LEVELS.ERROR, 'bid.value'));
  }
  if (bid.btype !== undefined && bid.btype !== 1 && bid.btype !== 2) {
    findings.push(F('feed.exads.btype_invalid', LEVELS.ERROR, 'bid.btype'));
  }
  if (bid.clickUrl === undefined && bid.url === undefined) {
    findings.push(F('feed.exads.landing_missing', LEVELS.WARNING, 'bid'));
  }
  return { type: 'EXADS RTB Response', findings };
}

/** Explicit documented request declaration; no subtype is inferred from copy. */
function exadsRequestFormat(obj) {
  if (!isObj(obj) || typeof obj.type !== 'string') return null;
  return has(REQUEST_FORMATS, obj.type) ? REQUEST_FORMATS[obj.type] : null;
}

/**
 * Conservative standalone role evidence. An image with copy is ambiguous;
 * its paired request, when present, supplies the explicit placement type.
 */
function exadsResponseFormat(obj) {
  if (!isExadsResponse(obj)) return null;
  const bid = obj.bid;
  const image = nonblank(bid.imgUrl);
  const icon = nonblank(bid.iconUrl);
  const click = nonblank(bid.clickUrl);
  const landing = nonblank(bid.url);
  const copy = nonblank(bid.title) || nonblank(bid.description);
  if (landing && !click && !image && !icon && !copy) return 'pops';
  if (click && icon && copy && !image && !landing) return 'push';
  if (click && image && !icon && !copy && !landing) return 'banner';
  return null;
}

module.exports = {
  isExadsRequest,
  isExadsResponse,
  validateExadsRequest,
  validateExadsResponse,
  exadsRequestFormat,
  exadsResponseFormat,
};
