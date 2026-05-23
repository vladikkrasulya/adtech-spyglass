'use strict';

/**
 * JSON-feed format validation for non-RTB CIS adtech responses.
 *
 * Five shapes recognized today:
 *   - Push-materials feed — array of materials (id, click_url|link, cpc|price, …)
 *   - Clickunder feed     — { result: { listing: [{ url, bid }, …] } }
 *   - Value-feed          — single-bid object with `clickUrl` (camelCase) + `value`
 *   - Bid-price feed      — single-bid object with `bid_price` + `link` + `notification_url`
 *   - Bid-redirect feed   — minimal single-bid `{ bid, redirecturl }`
 *
 * Per the 2026-05-04 format research the same logical fields use different
 * physical keys per format (e.g. price = `cpc`/`value`/`bid_price`/`bid`,
 * click target = `click_url`/`link`/`clickUrl`/`redirecturl`). Each format
 * gets its own validator with the specific naming so finding messages can
 * point users at the exact key their format expects.
 *
 * Lives outside dialects/ because feed-format is intrinsically a top-level
 * shape decision (oRTB vs. JSON-feed), not an extension overlay on top of a
 * common envelope.
 */

const { isObj, isStr, isNum } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');

const F = makeFinding;

function validateFeedResponse(arrOrObj) {
  // Clickunder feed
  // Clickunder XML-engine response — recognise BID (listing object OR
  // listing array) and NOBID shapes. See detect.js for the full shape table.
  if (isObj(arrOrObj) && isObj(arrOrObj.result)) {
    const r = arrOrObj.result;
    const isClickunderBid = Array.isArray(r.listing) || isObj(r.listing);
    const isClickunderNobid = typeof r.status === 'string' && r.status.toUpperCase() === 'NOBID';
    if (isClickunderBid || isClickunderNobid) {
      return validateClickunderFeed(arrOrObj);
    }
    // Link-feed (single object OR array). Same `result`-wrapped
    // family as clickunder but the bids live under `link` rather than `listing`.
    // See validateLinkFeed below for the field contract.
    if (Array.isArray(r.link) || isObj(r.link)) {
      return validateLinkFeed(arrOrObj);
    }
  }

  // Push-materials feed (array of materials)
  if (Array.isArray(arrOrObj)) {
    return validatePushMaterialsFeed(arrOrObj);
  }

  // Single-bid object — discriminate vendor by signature key
  if (isObj(arrOrObj)) {
    const vendor = detectSingleBidShape(arrOrObj);
    if (vendor === 'valuefeed') return validateValueFeed(arrOrObj);
    if (vendor === 'bidprice') return validateBidPriceFeed(arrOrObj);
    if (vendor === 'bidredirect') return validateBidRedirectFeed(arrOrObj);
  }

  return {
    type: 'unknown feed shape',
    findings: [F('feed.shape_unknown', LEVELS.ERROR, '')],
  };
}

// ── Clickunder feed ─────────────────────────────────────────────────────

function validateClickunderFeed(o) {
  const findings = [];
  const r = o.result;

  // NOBID is a spec-valid shape — no listing, only a status string. The
  // upstream auction simply had no winning bid. Surface as info rather
  // than zero findings so the inspector clearly says "received, no bid"
  // instead of looking like an empty / broken response.
  const status = typeof r.status === 'string' ? r.status.toUpperCase() : null;
  // Empty array `listing:[]` is structurally equivalent to absent for NOBID.
  // Pre-fix the BID path would normalize [] to [] and iterate zero rows,
  // returning zero findings — invisible to the user.
  const listingAbsent = r.listing == null || (Array.isArray(r.listing) && r.listing.length === 0);
  if (status === 'NOBID' && listingAbsent) {
    findings.push(F('feed.clickunder.nobid', LEVELS.INFO, 'result.status', {}));
    return { type: 'Clickunder Feed Response (no bid)', findings };
  }

  // BID — listing may be a single object (real production shape, common
  // single-creative case) or an array (multi-creative variant). Normalise to
  // an array of one for iteration; path strings stay accurate either way.
  const isArrayShape = Array.isArray(r.listing);
  const rows = isArrayShape ? r.listing : [r.listing];

  rows.forEach((row, i) => {
    const num = i + 1;
    const p = isArrayShape ? `result.listing[${i}]` : 'result.listing';
    if (!row || typeof row !== 'object') {
      findings.push(F('feed.clickunder.url_required', LEVELS.ERROR, `${p}.url`, { num }));
      findings.push(F('feed.clickunder.bid_required', LEVELS.ERROR, `${p}.bid`, { num }));
      return;
    }
    if (!isStr(row.url)) {
      findings.push(F('feed.clickunder.url_required', LEVELS.ERROR, `${p}.url`, { num }));
    }
    if (!isNum(row.bid)) {
      findings.push(F('feed.clickunder.bid_required', LEVELS.ERROR, `${p}.bid`, { num }));
    }
  });
  return {
    type: isArrayShape
      ? 'Clickunder Feed Response'
      : 'Clickunder Feed Response (single)',
    findings,
  };
}

// ── Link-feed ─────────────────────────────────────────────────────────
//
// URL-style link-feed response. Wrapped in `result` but bids live under
// `link` (array OR single object) instead of `listing`. Each bid row:
// { bid: <float>, url: <click target>, seat: <buyer id string> }.
// `seat` is informational only — a missing seat is unusual but not fatal.

function validateLinkFeed(o) {
  const findings = [];
  const r = o.result;
  const isArrayShape = Array.isArray(r.link);
  const rows = isArrayShape ? r.link : [r.link];

  rows.forEach((row, i) => {
    const num = i + 1;
    const p = isArrayShape ? `result.link[${i}]` : 'result.link';
    if (!row || typeof row !== 'object') {
      findings.push(F('feed.linkfeed.url_required', LEVELS.ERROR, `${p}.url`, { num }));
      findings.push(F('feed.linkfeed.bid_required', LEVELS.ERROR, `${p}.bid`, { num }));
      return;
    }
    if (!isStr(row.url)) {
      findings.push(F('feed.linkfeed.url_required', LEVELS.ERROR, `${p}.url`, { num }));
    }
    if (!isNum(row.bid)) {
      findings.push(F('feed.linkfeed.bid_required', LEVELS.ERROR, `${p}.bid`, { num }));
    } else if (row.bid <= 0) {
      findings.push(
        F('feed.linkfeed.bid_nonpositive', LEVELS.WARNING, `${p}.bid`, { num, bid: row.bid }),
      );
    }
    if (!isStr(row.seat)) {
      findings.push(F('feed.linkfeed.seat_missing', LEVELS.INFO, `${p}.seat`, { num }));
    }
  });

  return {
    type: isArrayShape ? 'Link-Feed Response' : 'Link-Feed Response (single)',
    findings,
  };
}

// ── Push-materials feed (array) ─────────────────────────────────────

function validatePushMaterialsFeed(arr) {
  const findings = [];
  arr.forEach((m, i) => {
    const num = i + 1;
    const p = `[${i}]`;
    if (!isStr(m.id)) {
      findings.push(F('feed.push.id_required', LEVELS.ERROR, `${p}.id`, { num }));
    }
    if (!isStr(m.click_url) && !isStr(m.link)) {
      findings.push(F('feed.push.click_url_required', LEVELS.ERROR, `${p}.click_url`, { num }));
    }
    if (!isNum(m.cpc) && !isNum(m.price)) {
      // 3-tier: distinguish missing / wrong-type-but-parseable / wrong-type-unparseable.
      // The narrow original "missing" message confused users when cpc was present
      // as a numeric string (most SSPs do parseFloat, so it works in practice
      // but violates the spec). Now we tell them WHAT is wrong, not just that
      // something is.
      const cpcStr = typeof m.cpc === 'string' ? m.cpc : null;
      const priceStr = typeof m.price === 'string' ? m.price : null;
      const cpcParsed = cpcStr != null ? parseFloat(cpcStr) : NaN;
      const priceParsed = priceStr != null ? parseFloat(priceStr) : NaN;
      const parseable = Number.isFinite(cpcParsed)
        ? cpcStr
        : Number.isFinite(priceParsed)
          ? priceStr
          : null;
      if (parseable != null) {
        findings.push(
          F('feed.push.bid_string_type', LEVELS.WARNING, `${p}.cpc`, { num, val: parseable }),
        );
      } else if (cpcStr != null || priceStr != null) {
        findings.push(F('feed.push.bid_not_numeric', LEVELS.ERROR, `${p}.cpc`, { num }));
      } else {
        findings.push(F('feed.push.bid_required', LEVELS.ERROR, `${p}.cpc`, { num }));
      }
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
  return { type: 'Push-Materials Feed Response', findings };
}

// ── Single-bid shape discrimination ─────────────────────────────────

function detectSingleBidShape(o) {
  // Each predicate keys off a format-unique field name. Order matters where
  // multiple match — but in practice the camelCase/snake_case split makes
  // these mutually exclusive.
  if ('clickUrl' in o || ('value' in o && 'nUrl' in o)) return 'valuefeed';
  if ('notification_url' in o || 'bid_price' in o) return 'bidprice';
  if ('redirecturl' in o) return 'bidredirect';
  return null;
}

// ── Value-feed (rtb.php-style) ───────────────────────────────────────

function validateValueFeed(o) {
  const findings = [];
  if (!isStr(o.id) && !isNum(o.id)) {
    findings.push(F('feed.valuefeed.id_required', LEVELS.ERROR, 'id'));
  }
  if (!isNum(o.value)) {
    findings.push(F('feed.valuefeed.value_required', LEVELS.ERROR, 'value'));
  }
  if (!isStr(o.clickUrl)) {
    findings.push(F('feed.valuefeed.click_url_required', LEVELS.ERROR, 'clickUrl'));
  }
  if (!isStr(o.title)) {
    findings.push(F('feed.valuefeed.title_recommended', LEVELS.WARNING, 'title'));
  }
  if (!isStr(o.description)) {
    findings.push(F('feed.valuefeed.description_recommended', LEVELS.WARNING, 'description'));
  }
  if (!isStr(o.iconUrl) && !isStr(o.nUrl)) {
    findings.push(F('feed.valuefeed.notify_recommended', LEVELS.WARNING, 'nUrl'));
  }
  return { type: 'Value-Feed Response', findings };
}

// ── Bid-price feed ───────────────────────────────────────────────────

function validateBidPriceFeed(o) {
  const findings = [];
  if (!isNum(o.bid_price)) {
    findings.push(F('feed.bidprice.bid_price_required', LEVELS.ERROR, 'bid_price'));
  }
  if (!isStr(o.link)) {
    findings.push(F('feed.bidprice.link_required', LEVELS.ERROR, 'link'));
  }
  if (!isStr(o.notification_url)) {
    findings.push(
      F('feed.bidprice.notification_url_recommended', LEVELS.WARNING, 'notification_url'),
    );
  }
  if (!isStr(o.title) && !isStr(o.message)) {
    findings.push(F('feed.bidprice.copy_recommended', LEVELS.WARNING, 'title'));
  }
  if (!isStr(o.icon)) {
    findings.push(F('feed.bidprice.icon_recommended', LEVELS.WARNING, 'icon'));
  }
  return { type: 'Bid-Price Feed Response', findings };
}

// ── Bid-redirect feed (minimal redirect shape) ───────────────────────

function validateBidRedirectFeed(o) {
  const findings = [];
  if (!isNum(o.bid)) {
    findings.push(F('feed.bidredirect.bid_required', LEVELS.ERROR, 'bid'));
  }
  if (!isStr(o.redirecturl)) {
    findings.push(F('feed.bidredirect.redirecturl_required', LEVELS.ERROR, 'redirecturl'));
  }
  if (o.campaignid != null && !isStr(o.campaignid) && !isNum(o.campaignid)) {
    findings.push(F('feed.bidredirect.campaignid_invalid', LEVELS.WARNING, 'campaignid'));
  }
  return { type: 'Bid-Redirect Feed Response', findings };
}

module.exports = { validateFeedResponse };
