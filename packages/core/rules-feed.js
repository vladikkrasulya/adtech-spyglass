'use strict';

/**
 * JSON-feed format validation for non-RTB CIS adtech responses.
 *
 * Five shapes recognized today:
 *   - Kadam push       — array of materials (id, click_url|link, cpc|price, …)
 *   - Kadam clickunder — { result: { listing: [{ url, bid }, …] } }
 *   - ExoClick         — single-bid object with `clickUrl` (camelCase) + `value`
 *   - RichAds          — single-bid object with `bid_price` + `link` + `notification_url`
 *   - Zeropark         — minimal single-bid `{ bid, redirecturl }`
 *
 * Per the 2026-05-04 vendor research the same logical fields use different
 * physical keys per vendor (e.g. price = `cpc`/`value`/`bid_price`/`bid`,
 * click target = `click_url`/`link`/`clickUrl`/`redirecturl`). Each vendor
 * gets its own validator with the specific naming so finding messages can
 * point users at the exact key their vendor expects.
 *
 * Lives outside dialects/ because feed-format is intrinsically a top-level
 * shape decision (oRTB vs. JSON-feed), not an extension overlay on top of a
 * common envelope.
 */

const { isObj, isStr, isNum } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');

const F = makeFinding;

function validateFeedResponse(arrOrObj) {
  // Kadam clickunder
  if (isObj(arrOrObj) && isObj(arrOrObj.result) && Array.isArray(arrOrObj.result.listing)) {
    return validateKadamClickunder(arrOrObj);
  }

  // Kadam push (array of materials)
  if (Array.isArray(arrOrObj)) {
    return validateKadamPush(arrOrObj);
  }

  // Single-bid object — discriminate vendor by signature key
  if (isObj(arrOrObj)) {
    const vendor = detectSingleVendor(arrOrObj);
    if (vendor === 'exoclick') return validateExoClick(arrOrObj);
    if (vendor === 'richads') return validateRichAds(arrOrObj);
    if (vendor === 'zeropark') return validateZeropark(arrOrObj);
  }

  return {
    type: 'unknown feed shape',
    findings: [F('feed.shape_unknown', LEVELS.ERROR, '')],
  };
}

// ── Kadam clickunder ───────────────────────────────────────────────

function validateKadamClickunder(o) {
  const findings = [];
  o.result.listing.forEach((row, i) => {
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

// ── Kadam push (array) ─────────────────────────────────────────────

function validateKadamPush(arr) {
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

// ── Vendor discrimination for single-bid objects ───────────────────

function detectSingleVendor(o) {
  // Each predicate keys off a vendor-unique field name. Order matters where
  // multiple match — but in practice the camelCase/snake_case split makes
  // these mutually exclusive.
  if ('clickUrl' in o || ('value' in o && 'nUrl' in o)) return 'exoclick';
  if ('notification_url' in o || 'bid_price' in o) return 'richads';
  if ('redirecturl' in o) return 'zeropark';
  return null;
}

// ── ExoClick (rtb.php proprietary) ─────────────────────────────────

function validateExoClick(o) {
  const findings = [];
  if (!isStr(o.id) && !isNum(o.id)) {
    findings.push(F('feed.exoclick.id_required', LEVELS.ERROR, 'id'));
  }
  if (!isNum(o.value)) {
    findings.push(F('feed.exoclick.value_required', LEVELS.ERROR, 'value'));
  }
  if (!isStr(o.clickUrl)) {
    findings.push(F('feed.exoclick.click_url_required', LEVELS.ERROR, 'clickUrl'));
  }
  if (!isStr(o.title)) {
    findings.push(F('feed.exoclick.title_recommended', LEVELS.WARNING, 'title'));
  }
  if (!isStr(o.description)) {
    findings.push(F('feed.exoclick.description_recommended', LEVELS.WARNING, 'description'));
  }
  if (!isStr(o.iconUrl) && !isStr(o.nUrl)) {
    findings.push(F('feed.exoclick.notify_recommended', LEVELS.WARNING, 'nUrl'));
  }
  return { type: 'ExoClick Feed Response', findings };
}

// ── RichAds (telegram-bid / per-format) ────────────────────────────

function validateRichAds(o) {
  const findings = [];
  if (!isNum(o.bid_price)) {
    findings.push(F('feed.richads.bid_price_required', LEVELS.ERROR, 'bid_price'));
  }
  if (!isStr(o.link)) {
    findings.push(F('feed.richads.link_required', LEVELS.ERROR, 'link'));
  }
  if (!isStr(o.notification_url)) {
    findings.push(
      F('feed.richads.notification_url_recommended', LEVELS.WARNING, 'notification_url'),
    );
  }
  if (!isStr(o.title) && !isStr(o.message)) {
    findings.push(F('feed.richads.copy_recommended', LEVELS.WARNING, 'title'));
  }
  if (!isStr(o.icon)) {
    findings.push(F('feed.richads.icon_recommended', LEVELS.WARNING, 'icon'));
  }
  return { type: 'RichAds Feed Response', findings };
}

// ── Zeropark (minimal redirect shape) ──────────────────────────────

function validateZeropark(o) {
  const findings = [];
  if (!isNum(o.bid)) {
    findings.push(F('feed.zeropark.bid_required', LEVELS.ERROR, 'bid'));
  }
  if (!isStr(o.redirecturl)) {
    findings.push(F('feed.zeropark.redirecturl_required', LEVELS.ERROR, 'redirecturl'));
  }
  if (o.campaignid != null && !isStr(o.campaignid) && !isNum(o.campaignid)) {
    findings.push(F('feed.zeropark.campaignid_invalid', LEVELS.WARNING, 'campaignid'));
  }
  return { type: 'Zeropark Feed Response', findings };
}

module.exports = { validateFeedResponse };
