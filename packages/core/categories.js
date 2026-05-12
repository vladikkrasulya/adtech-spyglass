'use strict';

/**
 * IAB Content Taxonomy decoder. Resolves codes like "IAB9-11" → human label.
 *
 * Three locales: en (source language per IAB 1.0), uk, ru. Stored as
 * parallel `iab-categories.{locale}.json` flat dicts. Each locale carries
 * the same key set (verified by the 3-locale parity test in
 * tests/categories.test.js). Missing keys fall back to en, then to
 * top-level, then to null — so an unknown sub-code or an unsupported
 * locale never crashes the decoder.
 *
 * Resolution order:
 *   exact code (locale) → exact code (en) → top-level (drop "-N" suffix) → null
 *
 * Used both at server-render time (to enrich findings) and at API-response
 * time (to populate meta.categories) so the frontend doesn't need its own
 * copy of the dictionary.
 */

const enDict = require('./iab-categories.en.json');
const ukDict = require('./iab-categories.uk.json');
const ruDict = require('./iab-categories.ru.json');

const DICTS = { en: enDict, uk: ukDict, ru: ruDict };
const DEFAULT_LOCALE = 'en';

function pickDict(locale) {
  return (locale && DICTS[locale]) || enDict;
}

/**
 * Decode a single IAB code in the requested locale. Falls back to the
 * en label if the locale dict has the code missing, then to the parent
 * if the sub-code itself is unknown.
 *
 *   decodeCategory('IAB9-11')            → 'Hobbies & Interests → Comic Books'
 *   decodeCategory('IAB9-11', 'uk')      → 'Хобі та інтереси → Комікси'
 *   decodeCategory('IAB9', 'ru')         → 'Хобби и интересы'
 *   decodeCategory('IAB9-99', 'uk')      → 'Хобі та інтереси' (parent fallback)
 *   decodeCategory('NOT_A_CODE', 'uk')   → null
 *   decodeCategory('IAB9-11', 'fr')      → 'Hobbies & Interests → Comic Books' (en fallback)
 *
 * @param {string} code
 * @param {string} [locale='en']
 * @returns {string | null}
 */
function decodeCategory(code, locale) {
  if (typeof code !== 'string' || !code.length) return null;
  const loc = locale || DEFAULT_LOCALE;
  const dict = pickDict(loc);
  const direct = dict[code];
  if (typeof direct === 'string') return direct;
  // en fallback when the requested locale has the code missing
  if (dict !== enDict) {
    const enDirect = enDict[code];
    if (typeof enDirect === 'string') return enDirect;
  }
  // Top-level fallback: try parent ("IAB9-11" → "IAB9") in the SAME locale,
  // then en. Lets exchanges that invent custom subs still get a meaningful
  // group label.
  const dash = code.indexOf('-');
  if (dash > 0) {
    const parentCode = code.slice(0, dash);
    const parent = dict[parentCode];
    if (typeof parent === 'string') return parent;
    if (dict !== enDict) {
      const enParent = enDict[parentCode];
      if (typeof enParent === 'string') return enParent;
    }
  }
  return null;
}

/**
 * Decode an array of IAB codes in the requested locale.
 *
 * @param {string[]} codes
 * @param {string} [locale='en']
 * @returns {Array<{ code: string, label: string | null }>}
 */
function decodeCategories(codes, locale) {
  if (!Array.isArray(codes)) return [];
  return codes.map((c) => ({ code: c, label: decodeCategory(c, locale) }));
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
 * @param {string} [locale='en']
 * @returns {Record<string, Array<{ code: string, label: string | null }>>}
 */
function extractAllCategories(payload, locale) {
  if (!payload || typeof payload !== 'object') return {};
  /** @type {Record<string, Array<{ code: string, label: string | null }>>} */
  const out = {};
  function take(path, arr) {
    if (Array.isArray(arr) && arr.length) out[path] = decodeCategories(arr, locale);
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
          out[`imp[${i}].pmp.deals[${di}].bcat`] = decodeCategories(d.bcat, locale);
        }
      });
    }
  });

  // BidResponse-side (bid-level cat[])
  (payload.seatbid || []).forEach((sb, sbi) => {
    (sb && sb.bid ? sb.bid : []).forEach((bid, bi) => {
      if (bid && Array.isArray(bid.cat) && bid.cat.length) {
        out[`seatbid[${sbi}].bid[${bi}].cat`] = decodeCategories(bid.cat, locale);
      }
    });
  });

  return out;
}

module.exports = { decodeCategory, decodeCategories, extractAllCategories };
