'use strict';

/**
 * IAB Content Taxonomy decoder. Resolves codes like "IAB9-11" → human label.
 * Currently English-only (Taxonomy 1.0 source language). Multi-locale labels
 * could land later via parallel iab-categories-{locale}.json files; resolver
 * signature stays the same.
 *
 * Resolution order:
 *   exact code → top-level fallback (drop "-N" suffix) → null
 *
 * Used both at server-render time (to enrich findings) and at API-response
 * time (to populate meta.categories) so the frontend doesn't need its own
 * copy of the dictionary.
 */

const dict = require('./iab-categories.json');

/**
 * Decode a single IAB code. Falls through to the top-level if the sub-code
 * isn't in the dict (some networks invent custom subs that share a parent).
 *
 *   decodeCategory('IAB9-11')        → 'Hobbies & Interests → Comic Books'
 *   decodeCategory('IAB9')           → 'Hobbies & Interests'
 *   decodeCategory('IAB9-99')        → 'Hobbies & Interests' (parent fallback)
 *   decodeCategory('NOT_A_CODE')     → null
 *
 * @param {string} code
 * @returns {string | null}
 */
function decodeCategory(code) {
  if (typeof code !== 'string' || !code.length) return null;
  const direct = dict[code];
  if (typeof direct === 'string') return direct;
  // Fallback: try parent ("IAB9-11" → "IAB9")
  const dash = code.indexOf('-');
  if (dash > 0) {
    const parent = dict[code.slice(0, dash)];
    if (typeof parent === 'string') return parent;
  }
  return null;
}

/**
 * Decode an array of IAB codes. Preserves the original array order and
 * keeps unrecognised codes as `{ code, label: null }` so the consumer can
 * render them as-is without losing track.
 *
 * @param {string[]} codes
 * @returns {Array<{ code: string, label: string | null }>}
 */
function decodeCategories(codes) {
  if (!Array.isArray(codes)) return [];
  return codes.map((c) => ({ code: c, label: decodeCategory(c) }));
}

/**
 * Walk a BidRequest / BidResponse and pull every place where IAB-style
 * category codes can legitimately appear in OpenRTB 2.x. Returns a flat
 * map keyed by JSON-path so the inspector can render decoded labels at
 * each location independently.
 *
 *   extractAllCategories({ bcat: ['IAB25-3'], site: { cat: ['IAB1'] } })
 *     → { 'bcat': [...], 'site.cat': [...] }
 *
 * @param {object} payload
 * @returns {Record<string, Array<{ code: string, label: string | null }>>}
 */
function extractAllCategories(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const out = {};
  function take(path, arr) {
    if (Array.isArray(arr) && arr.length) out[path] = decodeCategories(arr);
  }

  // BidRequest-side
  take('bcat', payload.bcat);
  if (payload.site) {
    take('site.cat', payload.site.cat);
    take('site.sectioncat', payload.site.sectioncat);
    take('site.pagecat', payload.site.pagecat);
  }
  if (payload.app) {
    take('app.cat', payload.app.cat);
    take('app.sectioncat', payload.app.sectioncat);
    take('app.pagecat', payload.app.pagecat);
  }
  (payload.imp || []).forEach((imp, i) => {
    if (imp && imp.pmp && Array.isArray(imp.pmp.deals)) {
      imp.pmp.deals.forEach((d, di) => {
        if (d && Array.isArray(d.bcat) && d.bcat.length) {
          out[`imp[${i}].pmp.deals[${di}].bcat`] = decodeCategories(d.bcat);
        }
      });
    }
  });

  // BidResponse-side (bid-level cat[])
  (payload.seatbid || []).forEach((sb, sbi) => {
    (sb && sb.bid ? sb.bid : []).forEach((bid, bi) => {
      if (bid && Array.isArray(bid.cat) && bid.cat.length) {
        out[`seatbid[${sbi}].bid[${bi}].cat`] = decodeCategories(bid.cat);
      }
    });
  });

  return out;
}

module.exports = { decodeCategory, decodeCategories, extractAllCategories };
