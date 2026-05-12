'use strict';

/**
 * Generic oRTB shape analysis. No vendor identifiers — describes format
 * families purely in terms of canonical oRTB field paths + a few vendor-
 * extension patterns observable across many SSPs (pop-family, in-page-push,
 * push). The vendor mapping (e.g. "this number means pop on this SSP") is
 * NOT in this file — that lives in each user's saved dialect.
 *
 * Used by the validator to (a) suggest candidate formats for unrecognized
 * vendor signals and (b) generate stable shape-fingerprints for drift
 * detection on saved dialect mappings.
 */

/**
 * Analyze a payload node (imp[i] or full request) and return a ranked list
 * of plausible format candidates.
 *
 * @param {object} payloadNode
 * @returns {Array<{format:string, score:number, signals_matched:string[], iab_ref:boolean, notes?:string}>}
 */
function analyzeShape(payloadNode) {
  const candidates = [];
  if (!payloadNode || typeof payloadNode !== 'object') return candidates;

  const ext = payloadNode.ext || {};
  const banner = payloadNode.banner;
  const popSignals = [];
  let popScore = 0;

  // ---- IAB canonical: banner (with real dimensions)
  if (banner && banner.w > 1 && banner.h > 1) {
    const sigs = [`banner.w:${banner.w}`, `banner.h:${banner.h}`];
    let score = 2.0;
    if (Array.isArray(banner.format) && banner.format.length > 0) {
      score += 1.0;
      sigs.push('banner.format:array');
    }
    candidates.push({ format: 'banner', score, signals_matched: sigs, iab_ref: true });
  }

  // ---- IAB canonical: native
  let nativeRequestParsed = null;
  if (payloadNode.native && typeof payloadNode.native.request === 'string') {
    candidates.push({
      format: 'native',
      score: 2.0,
      signals_matched: ['native.request:str'],
      iab_ref: true,
    });
    try {
      nativeRequestParsed = JSON.parse(payloadNode.native.request);
    } catch (_) {
      // malformed native.request — ignore, native still scores on presence
    }
  }

  // ---- IAB canonical: video
  if (payloadNode.video && typeof payloadNode.video === 'object') {
    let score = 1.0;
    const sigs = ['video:object'];
    if (Array.isArray(payloadNode.video.protocols) && payloadNode.video.protocols.length > 0) {
      score += 1.0;
      sigs.push('video.protocols:array');
    }
    if (typeof payloadNode.video.minduration === 'number') {
      score += 1.0;
      sigs.push('video.minduration:num');
    }
    candidates.push({ format: 'video', score, signals_matched: sigs, iab_ref: true });
  }

  // ---- IAB canonical: audio
  if (payloadNode.audio && typeof payloadNode.audio === 'object') {
    candidates.push({
      format: 'audio',
      score: 1.0,
      signals_matched: ['audio:object'],
      iab_ref: true,
    });
  }

  // ---- Vendor heuristic: pop-family
  // Boolean *presence* (true OR false) of allow* flags is the signal — vendor
  // would not include them otherwise. All-zero banner + sizeID:[0] are
  // additional pop tells. instl:1 paired with ext.limit:1 is a weak corroborator.
  if (typeof ext.allowMT === 'boolean') {
    popScore += 1.0;
    popSignals.push('ext.allowMT:bool');
  }
  if (typeof ext.allowLayer === 'boolean') {
    popScore += 1.0;
    popSignals.push('ext.allowLayer:bool');
  }
  if (typeof ext.allowShock === 'boolean') {
    popScore += 1.0;
    popSignals.push('ext.allowShock:bool');
  }
  if (banner && banner.w === 0 && banner.h === 0) {
    popScore += 1.0;
    popSignals.push('banner.w:0', 'banner.h:0');
  }
  if (Array.isArray(ext.sizeID) && ext.sizeID.length === 1 && ext.sizeID[0] === 0) {
    popScore += 1.0;
    popSignals.push('ext.sizeID:array[0]');
  }
  if (payloadNode.instl === 1 && ext.limit === 1) {
    popScore += 0.5;
    popSignals.push('instl:1', 'ext.limit:1');
  }
  if (popScore > 0) {
    candidates.push({
      format: 'pop-family',
      score: popScore,
      signals_matched: popSignals,
      iab_ref: false,
      notes: 'non-IAB vendor heuristic (pop/clickunder family)',
    });
  }

  // ---- Vendor heuristic: in-page-push
  // Small banner (1×1…50×50) + instl=1 with no pop-family hits.
  if (
    banner &&
    banner.w >= 1 && banner.w <= 50 &&
    banner.h >= 1 && banner.h <= 50 &&
    payloadNode.instl === 1 &&
    popScore === 0
  ) {
    candidates.push({
      format: 'in-page-push',
      score: 2.0,
      signals_matched: [`banner.w:${banner.w}`, `banner.h:${banner.h}`, 'instl:1'],
      iab_ref: false,
      notes: 'non-IAB: small banner with interstitial flag',
    });
  }

  // ---- Vendor heuristic: push notification
  // Native shape with short title.len (≤60 chars) → push.
  if (nativeRequestParsed && nativeRequestParsed.title && typeof nativeRequestParsed.title.len === 'number') {
    if (nativeRequestParsed.title.len <= 60) {
      candidates.push({
        format: 'push',
        score: 2.0,
        signals_matched: ['native.request:str', `native.request.title.len:${nativeRequestParsed.title.len}`],
        iab_ref: false,
        notes: 'non-IAB: native shape with short title constraint (push family)',
      });
    }
  }

  // ---- IAB canonical: interstitial-banner
  // banner with real dims + instl=1, and no pop-family signals to compete.
  if (
    banner && banner.w > 1 && banner.h > 1 &&
    payloadNode.instl === 1 &&
    popScore === 0
  ) {
    candidates.push({
      format: 'interstitial-banner',
      score: 2.0,
      signals_matched: [`banner.w:${banner.w}`, `banner.h:${banner.h}`, 'instl:1'],
      iab_ref: true,
    });
  }

  return candidates.filter((c) => c.score >= 1).sort((a, b) => b.score - a.score);
}

/**
 * Pick a single "recommended" format from a candidate list, or null if no
 * candidate is dominant enough to recommend with confidence.
 *
 * Rule: top candidate must score ≥2 AND ≥1.5× the runner-up score.
 *
 * @param {Array} candidates - from analyzeShape()
 * @returns {{format:string, confidence:'high'|'medium'}|null}
 */
function recommendedFormat(candidates) {
  if (!candidates || candidates.length === 0) return null;
  const [first, second] = candidates;
  if (first.score < 2) return null;
  if (!second) return { format: first.format, confidence: 'high' };
  if (first.score >= second.score * 1.5) {
    return { format: first.format, confidence: first.score >= 3 ? 'high' : 'medium' };
  }
  return null;
}

/**
 * Stable, type-bucketed fingerprint of a payload node's shape — values are
 * NOT included, only field paths and primitive type buckets. Designed for
 * drift detection: same fingerprint = "this saved mapping likely still
 * applies"; different fingerprint = "this mapping was confirmed in a
 * different context, prompt user to re-check".
 *
 * @param {object} payloadNode
 * @returns {string} pipe-joined sorted list of "path:typeBucket" entries
 */
function shapeFingerprint(payloadNode) {
  const signals = [];

  function walk(obj, path) {
    if (obj === null) {
      signals.push(`${path}:null`);
      return;
    }
    if (typeof obj === 'undefined') return;
    if (Array.isArray(obj)) {
      // type-bucket: empty arr / single-zero (pop-style) / array (any)
      if (obj.length === 0) signals.push(`${path}:array_empty`);
      else if (obj.length === 1 && obj[0] === 0) signals.push(`${path}:array[0]`);
      else signals.push(`${path}:array`);
      return;
    }
    const t = typeof obj;
    if (t === 'boolean') signals.push(`${path}:bool`);
    else if (t === 'number') signals.push(`${path}:num`);
    else if (t === 'string') signals.push(`${path}:str`);
    else if (t === 'object') {
      Object.keys(obj).sort().forEach((k) => {
        walk(obj[k], path ? `${path}.${k}` : k);
      });
    }
  }

  walk(payloadNode, '');
  return signals.sort().join('|');
}

module.exports = {
  analyzeShape,
  recommendedFormat,
  shapeFingerprint,
};
