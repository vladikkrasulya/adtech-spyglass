'use strict';

/**
 * Kadam Feed format validation. Two shapes:
 *   - Push:        array of materials (id, click_url|link, cpc|price, …)
 *   - Clickunder:  { result: { listing: [{ url, bid }, …] } }
 *
 * Lives outside dialects/ because no other vendor ships this format and we
 * always want it validated when detected. If a non-Kadam JSON-feed format
 * ever appears, this can split.
 */

const { isObj, isStr, isNum } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');

const F = makeFinding;

function validateFeedResponse(arrOrObj) {
  const findings = [];

  // Clickunder
  if (isObj(arrOrObj) && isObj(arrOrObj.result) && Array.isArray(arrOrObj.result.listing)) {
    arrOrObj.result.listing.forEach((row, i) => {
      const num = i + 1;
      const p = `result.listing[${i}]`;
      if (!isStr(row.url)) {
        findings.push(F('feed.clickunder.url_required', LEVELS.ERROR, `${p}.url`, { num }));
      }
      if (!isNum(row.bid)) {
        findings.push(F('feed.clickunder.bid_required', LEVELS.ERROR, `${p}.bid`, { num }));
      }
    });
    return { type: 'Kadam Feed Response (clickunder)', findings };
  }

  // Push array
  if (Array.isArray(arrOrObj)) {
    arrOrObj.forEach((m, i) => {
      const num = i + 1;
      const p = `[${i}]`;
      if (!isStr(m.id)) {
        findings.push(F('feed.push.id_required', LEVELS.ERROR, `${p}.id`, { num }));
      }
      if (!isStr(m.click_url) && !isStr(m.link)) {
        findings.push(F('feed.push.click_url_required', LEVELS.ERROR, `${p}.click_url`, { num }));
      }
      if (!isNum(m.cpc) && !isNum(m.price)) {
        findings.push(F('feed.push.bid_required', LEVELS.ERROR, `${p}.cpc`, { num }));
      }
      if (!isStr(m.title)) {
        findings.push(F('feed.push.title_recommended', LEVELS.WARNING, `${p}.title`, { num }));
      }
      if (!isStr(m.image_url)) {
        findings.push(
          F('feed.push.image_url_recommended', LEVELS.WARNING, `${p}.image_url`, { num }),
        );
      }
      if (!isStr(m.icon_url) && !isStr(m.nurl)) {
        findings.push(F('feed.push.nurl_recommended', LEVELS.WARNING, `${p}.nurl`, { num }));
      }
    });
    return { type: 'Kadam Feed Response (push)', findings };
  }

  return {
    type: 'unknown feed shape',
    findings: [F('feed.shape_unknown', LEVELS.ERROR, '')],
  };
}

module.exports = { validateFeedResponse };
