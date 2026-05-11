'use strict';

/**
 * samples/creative-picker.js — synthetic creative picker for the
 * stream view.
 *
 * The synthetic generator emits BidRequest-only specimens, so there is
 * no real `adm` to render. This picker chooses a stylized SVG creative
 * from `/public/assets/creatives/` based on the request's format and
 * context — banner / video / native, mainstream vs adult vs app-install.
 *
 * Output: the bare ref string (filename minus `.svg`). The client
 * resolves it to `/assets/creatives/<ref>.svg`.
 *
 * Deterministic by `specimen.id` so the same specimen always shows the
 * same creative across re-renders and tests.
 */

const BANK = Object.freeze({
  mainstream: [
    'mainstream-retail-summer',
    'mainstream-auto-loan',
    'mainstream-finance-card',
    'mainstream-food-burger',
    'mainstream-travel-beach',
    'mainstream-saas-cloud',
  ],
  adult: ['adult-meet-tonight', 'adult-vip-date', 'adult-online-now', 'adult-premium-vip'],
  app: ['app-game-puzzle', 'app-utility-cleaner', 'app-photo-editor'],
  video: ['video-promo-mainstream', 'video-promo-app'],
  native: ['native-article-health', 'native-article-saas'],
});

function hashString(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

function pick(pool, key) {
  if (!pool || pool.length === 0) return null;
  return pool[hashString(key) % pool.length];
}

function detectFormat(specimen) {
  const imp0 = (Array.isArray(specimen.imp) && specimen.imp[0]) || null;
  if (imp0) {
    if (imp0.video) return 'video';
    if (imp0.native) return 'native';
    if (imp0.audio) return 'audio';
    if (imp0.banner) return 'banner';
  }
  // BidResponse-shaped specimens (no imp). Peek at the first bid's adm
  // to guess format from the payload shape: VAST XML → video, native
  // JSON envelope → native, HTML / anything else → banner.
  const bid0 =
    (Array.isArray(specimen.seatbid) &&
      specimen.seatbid[0] &&
      Array.isArray(specimen.seatbid[0].bid) &&
      specimen.seatbid[0].bid[0]) ||
    null;
  if (bid0 && typeof bid0.adm === 'string') {
    const head = bid0.adm.trimStart().slice(0, 64).toLowerCase();
    if (head.includes('<vast') || head.includes('<?xml') || head.includes('<videoad'))
      return 'video';
    if (head.startsWith('{') && head.includes('"native"')) return 'native';
  }
  return 'banner';
}

function detectAdult(specimen) {
  const ctx = specimen.app || specimen.site || {};
  const cats = Array.isArray(ctx.cat) ? ctx.cat.join(' ').toLowerCase() : '';
  const bundle = String(ctx.bundle || ctx.domain || '').toLowerCase();
  // IAB25 = "Non-Standard Content" (the adult bucket in v1 taxonomy).
  if (/\biab25\b/.test(cats)) return true;
  if (/adult|dating|xxx|cams?\b|sex\b|hookup/.test(bundle)) return true;
  return false;
}

/**
 * @param {object} specimen — parsed BidRequest
 * @returns {string|null} creative ref (filename without `.svg`) or null
 */
function pickCreative(specimen) {
  if (!specimen || typeof specimen !== 'object') return null;
  const format = detectFormat(specimen);
  const id = specimen.id || '';
  const adult = detectAdult(specimen);

  if (format === 'video') return pick(BANK.video, id);
  if (format === 'native') return pick(BANK.native, id);
  if (format === 'audio') {
    // No audio-specific creative bank yet; fall through to mainstream
    // banner. Audio surfaces are rare in our sample corpus and the
    // stream row will still show a plausible visual.
    return pick(BANK.mainstream, id);
  }
  // banner branch — most traffic
  if (adult) return pick(BANK.adult, id);
  if (specimen.app) return pick(BANK.app, id);
  return pick(BANK.mainstream, id);
}

module.exports = { pickCreative, BANK, hashString };
