'use strict';

/**
 * IAB OpenRTB 3.0 BidResponse validation — envelope + per-bid shape + creative deep validation.
 *
 * 3.0 BidResponse mirrors the request envelope:
 *   { openrtb: { ver: "3.0", response: { id, bidid?, seatbid: [...] } } }
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/openrtb/blob/main/3.0.md
 */

const { isObj, isStr, isNum } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');
const { validateVast, isVastShape } = require('./rules-vast');
const { detect30ResponseSignals } = require('./detect');

const F = makeFinding;

/**
 * @param {object} payload — full response as received (with `openrtb` envelope)
 * @returns {Array<{id:string, level:string, path:string, params:object}>}
 */
function validateResponse30(payload) {
  const findings = [];

  if (!isObj(payload.openrtb)) {
    // No envelope. Two very different payloads land here and used to get the
    // same ERROR + immediate stop: a genuinely malformed 3.0 response, and the
    // inner `{id, seatbid:[…]}` body an operator copied out of a log, where the
    // wrapper was peeled off before they ever saw it. For the second one the
    // envelope is not *wrong*, it is simply not in the paste — and refusing to
    // look further threw away a perfectly readable set of bids.
    //
    // So: when the body itself carries 3.0-only bid fields (`bid.item` /
    // `bid.media` — see `detect30ResponseSignals`), validate it in place with
    // root-relative paths, and downgrade the envelope note to a WARNING. The
    // `ver` checks are skipped entirely in this mode; `ver` lives on the
    // envelope, and demanding it from a body that never had one is how you
    // manufacture two errors out of one missing wrapper.
    const naked = detect30ResponseSignals(payload).length > 0;
    if (!naked) {
      findings.push(F('response.30.envelope_required', LEVELS.ERROR, 'openrtb'));
      findings.push(F('response.30.deep_validation_limited', LEVELS.INFO, ''));
      return findings;
    }
    findings.push(F('response.30.envelope_required', LEVELS.WARNING, ''));
    validateResponseBody30(payload, '', findings);
    findings.push(F('response.30.deep_validation_limited', LEVELS.INFO, ''));
    return findings;
  }
  const env = payload.openrtb;

  if (!isStr(env.ver)) {
    findings.push(F('response.30.ver_required', LEVELS.ERROR, 'openrtb.ver'));
  } else if (!/^3\.\d+$/.test(env.ver)) {
    findings.push(F('response.30.ver_invalid', LEVELS.ERROR, 'openrtb.ver', { ver: env.ver }));
  }

  if (!isObj(env.response)) {
    findings.push(F('response.30.response_required', LEVELS.ERROR, 'openrtb.response'));
    findings.push(F('response.30.deep_validation_limited', LEVELS.INFO, ''));
    return findings;
  }

  validateResponseBody30(env.response, 'openrtb.response', findings);
  findings.push(F('response.30.deep_validation_limited', LEVELS.INFO, ''));
  return findings;
}

/**
 * Everything below the envelope. Split out so the enveloped and the
 * envelope-less (pasted inner body) paths run the SAME rules and differ only
 * in the path prefix they stamp on findings — the alternative, a second copy
 * of the loop for the naked case, is how the two drift.
 *
 * @param {any} resp        the 3.0 Response object
 * @param {string} base     path prefix ('openrtb.response' or '' for a body)
 * @param {Array} findings  accumulator
 */
function validateResponseBody30(resp, base, findings) {
  const at = (rest) => (base ? `${base}.${rest}` : rest);

  // R3. response.id — required, mirrors request.id (auction match key)
  if (!isStr(resp.id)) {
    findings.push(F('response.30.id_required', LEVELS.ERROR, at('id')));
  }

  // R4. seatbid[] — same role as 2.x. Empty seatbid + nbr is no-bid.
  //     Both missing → ERROR (no signal at all).
  const hasSeatbid = Array.isArray(resp.seatbid);
  const hasNbr = isNum(resp.nbr);
  if (!hasSeatbid && !hasNbr) {
    findings.push(F('response.30.seatbid_or_nbr_required', LEVELS.ERROR, at('seatbid')));
  } else if (hasNbr && (!hasSeatbid || !resp.seatbid.length)) {
    findings.push(F('response.30.no_bid', LEVELS.INFO, at('nbr'), { nbr: resp.nbr }));
  } else if (hasSeatbid && !resp.seatbid.length) {
    findings.push(F('response.30.seatbid_empty_no_nbr', LEVELS.ERROR, at('seatbid')));
  }

  // R5. Per-seatbid → per-bid structural checks (id + item ref + price).
  //     3.0 bids carry `item` (the request item id) instead of 2.x `impid`.
  (resp.seatbid || []).forEach((sb, i) => {
    const sNum = i + 1;
    const sp = at(`seatbid[${i}]`);
    if (!isObj(sb)) return;
    if (!Array.isArray(sb.bid) || !sb.bid.length) {
      findings.push(F('response.30.seatbid.empty', LEVELS.ERROR, `${sp}.bid`, { num: sNum }));
      return;
    }
    sb.bid.forEach((b, j) => {
      const bNum = j + 1;
      const bp = `${sp}.bid[${j}]`;
      const params = { sNum, bNum };
      if (!isObj(b)) {
        findings.push(F('response.30.bid.invalid', LEVELS.ERROR, bp, params));
        return;
      }
      if (!isStr(b.id)) {
        findings.push(F('response.30.bid.id_required', LEVELS.ERROR, `${bp}.id`, params));
      }
      // 3.0 uses `item` (string) to reference the request's item.id.
      if (!isStr(b.item)) {
        findings.push(F('response.30.bid.item_required', LEVELS.ERROR, `${bp}.item`, params));
      }
      // price required (same as 2.x)
      if (!isNum(b.price)) {
        findings.push(F('response.30.bid.price_required', LEVELS.ERROR, `${bp}.price`, params));
      }

      // Deep Media Validation — resolves the AdCOM Ad wrapper itself.
      const creative = resolveAdCom(b.media, bp);
      validateCreative30(b.media, creative, params, findings);

      // Advertiser domains. AdCOM 1.0 puts `adomain` on the **Ad** object
      // (`bid.media.ad.adomain`), not on Media. Reading it straight off
      // `media` — which the pre-audit code did, with a comment admitting the
      // field "lives in AdCOM Ad/Media, but let's check media.adomain" —
      // inverted the verdict: a spec-correct bid was told its adomain was
      // missing, while the flat shape AdCOM has no room for came back clean.
      // `resolveAdCom` prefers the Ad object and falls back to the flat
      // reading, so payloads written against the old behaviour keep working.
      const adom = creative.obj.adomain;
      if (!Array.isArray(adom) || !adom.length) {
        findings.push(
          F('response.30.bid.adomain_missing', LEVELS.WARNING, `${creative.path}.adomain`, params),
        );
      }
    });
  });

  return findings;
}

/**
 * Find the object that actually carries the creative, and the path to it.
 *
 * AdCOM 1.0 nests it: `Bid.media` is a **Media** object whose `ad` child is
 * the **Ad** object, and it is Ad that owns `adomain`, `display`, `video`,
 * `audio` and `native`. The flat `media.display` / `media.adomain` reading
 * this file shipped with corresponds to nothing in the spec.
 *
 * Both are accepted rather than only the correct one, because the flat shape
 * is what this repo's own 3.0 samples and several real integrations emit, and
 * turning every one of them into an error overnight buys nothing. The Ad
 * object wins whenever it is present — a payload that has it is telling us
 * which spec it was written against.
 *
 * @param {any} media
 * @param {string} bp   path of the bid
 * @returns {{obj: any, path: string, adInvalid: boolean}}
 */
function resolveAdCom(media, bp) {
  if (!isObj(media)) return { obj: {}, path: `${bp}.media`, adInvalid: false };
  if (isObj(media.ad)) return { obj: media.ad, path: `${bp}.media.ad`, adInvalid: false };
  // `ad` present but not an object: nothing to read, and saying so beats
  // silently falling back to the flat reading and reporting the creative as
  // absent when the sender clearly meant to put one there.
  return { obj: media, path: `${bp}.media`, adInvalid: media.ad != null };
}

/**
 * Validates AdCOM creative specifications under bid.media.
 *
 * `media` is the raw Media object (needed to judge the container itself);
 * `creative` is what `resolveAdCom` decided actually holds the display/video/
 * audio/native children, together with the path to report them under.
 *
 * @param {any} media
 * @param {{obj: any, path: string, adInvalid: boolean}} creative
 * @param {object} params
 * @param {Array} findings
 */
function validateCreative30(media, creative, params, findings) {
  const cp = creative.path;
  if (media == null) {
    findings.push(F('response.30.bid.media_missing', LEVELS.WARNING, cp, params));
    return;
  }
  if (!isObj(media)) {
    findings.push(F('response.30.bid.media_invalid', LEVELS.ERROR, cp, params));
    return;
  }
  if (creative.adInvalid) {
    // `media.ad` present but not an object — the Ad wrapper is there and
    // unreadable, which is a stronger statement than "no creative found".
    findings.push(F('response.30.bid.media_invalid', LEVELS.ERROR, `${cp}.ad`, params));
    return;
  }

  const c = creative.obj;
  const hasDisplay = c.display != null;
  const hasVideo = c.video != null;
  const hasAudio = c.audio != null;
  const hasNative = c.native != null;

  if (!hasDisplay && !hasVideo && !hasAudio && !hasNative) {
    findings.push(F('response.30.bid.media.format_required', LEVELS.ERROR, cp, params));
  }

  // display
  if (hasDisplay) {
    if (!isObj(c.display)) {
      findings.push(F('response.30.bid.display_invalid', LEVELS.ERROR, `${cp}.display`, params));
    } else {
      const d = c.display;
      if (!isStr(d.adm) && !isStr(d.curl)) {
        findings.push(
          F('response.30.bid.display.markup_required', LEVELS.ERROR, `${cp}.display`, params),
        );
      }
    }
  }

  // video
  if (hasVideo) {
    if (!isObj(c.video)) {
      findings.push(F('response.30.bid.video_invalid', LEVELS.ERROR, `${cp}.video`, params));
    } else {
      const v = c.video;
      if (!isStr(v.adm) && !isStr(v.curl)) {
        findings.push(
          F('response.30.bid.video.markup_required', LEVELS.ERROR, `${cp}.video`, params),
        );
      } else if (isStr(v.adm) && isVastShape(v.adm)) {
        const vastFindings = validateVast(v.adm, `${cp}.video.adm`);
        for (const f of vastFindings) {
          f.params = Object.assign({}, params, f.params || {});
          findings.push(f);
        }
      }
    }
  }

  // audio
  if (hasAudio) {
    if (!isObj(c.audio)) {
      findings.push(F('response.30.bid.audio_invalid', LEVELS.ERROR, `${cp}.audio`, params));
    } else {
      const a = c.audio;
      if (!isStr(a.adm) && !isStr(a.curl)) {
        findings.push(
          F('response.30.bid.audio.markup_required', LEVELS.ERROR, `${cp}.audio`, params),
        );
      }
    }
  }

  // native
  if (hasNative) {
    if (!isObj(c.native)) {
      findings.push(F('response.30.bid.native_invalid', LEVELS.ERROR, `${cp}.native`, params));
    }
  }
}

module.exports = { validateResponse30 };
