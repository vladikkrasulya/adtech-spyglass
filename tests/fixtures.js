'use strict';

/**
 * Reusable oRTB payloads for tests. Hand-crafted (not minified upstream
 * fixtures) so each one is small enough to grok and intentionally exercises
 * one specific validator path.
 *
 * When Phase 1 introduces version-aware rules, these will gain a `version`
 * property and we'll add 2.6-specific fixtures (regs.gpp, imp.rwdd, etc.).
 */

// A near-minimal valid 2.5-shaped BidRequest. Banner slot, no extras.
// Includes `at` + `bidfloorcur` so the new strict rules added in 2026-05-05
// (request.at_required, imp.bidfloorcur_missing) leave it clean.
// Returns `any` so tests can freely mutate / delete fields without TS narrowing.
/** @returns {any} */
const validRequest = () => ({
  id: 'req-1',
  at: 2,
  imp: [
    {
      id: 'imp-1',
      bidfloor: 0.1,
      bidfloorcur: 'USD',
      banner: { w: 300, h: 250 },
    },
  ],
  site: { domain: 'example.com' },
  device: {
    ip: '203.0.113.1',
    ua: 'Mozilla/5.0',
    os: 'Linux',
    osv: '6.1',
    geo: { country: 'UKR' },
    language: 'uk',
  },
  cur: ['USD'],
});

// Matching valid BidResponse for the request above.
/** @returns {any} */
const validResponse = () => ({
  id: 'req-1', // matches request.id
  cur: 'USD',
  seatbid: [
    {
      bid: [
        {
          id: 'bid-1',
          impid: 'imp-1', // references request.imp[0].id
          price: 1.5, // ≥ bidfloor 0.10
          adm: '<html>creative</html>',
          adomain: ['advertiser.com'],
          w: 300,
          h: 250,
        },
      ],
    },
  ],
});

// Native 1.1 request fragment for crosscheck tests.
/** @returns {any} */
const nativeRequest = () => ({
  id: 'req-native',
  imp: [
    {
      id: 'imp-native-1',
      native: {
        ver: '1.1',
        request: JSON.stringify({
          native: {
            assets: [
              { id: 1, required: 1, title: { len: 90 } },
              { id: 2, required: 1, img: { type: 3, w: 300, h: 250 } },
              { id: 3, required: 0, data: { type: 2 } },
            ],
          },
        }),
      },
    },
  ],
  site: { domain: 'native.example.com' },
  device: { ip: '198.51.100.1', ua: 'Mozilla/5.0', language: 'en' },
});

/**
 * @param {{ omitAsset?: boolean }} [opts]
 * @returns {any}
 */
const nativeResponse = ({ omitAsset } = {}) => {
  /** @type {any[]} */
  const assets = [
    { id: 1, title: { text: 'Headline' } },
    { id: 2, img: { url: 'https://cdn.example/img.jpg', w: 300, h: 250 } },
  ];
  if (!omitAsset) assets.push({ id: 3, data: { value: 'Body text' } });
  return {
    id: 'req-native',
    seatbid: [
      {
        bid: [
          {
            id: 'bid-native-1',
            impid: 'imp-native-1',
            price: 0.5,
            adm: JSON.stringify({ native: { assets, link: { url: 'https://example.com' } } }),
            adomain: ['advertiser.com'],
          },
        ],
      },
    ],
  };
};

// Version-marker variants for detectVersion() tests.
//
// 2.5: presence of `source` (with pchain) — added in 2.5.
// 2.6: presence of `imp[].rwdd` — added in 2.6 (rewarded video flag).
// 3.0: distinct `item[]` array shape replaces `imp[]`.
/** @returns {any} */
const v25Request = () => {
  const r = validRequest();
  r.source = { pchain: 'a:b' };
  return r;
};

/** @returns {any} */
const v26Request = () => {
  const r = validRequest();
  r.imp[0].rwdd = 1;
  return r;
};

/** @returns {any} */
const v26GppRequest = () => {
  const r = validRequest();
  r.regs = { gpp: 'CPv6XYZ', gpp_sid: [7] };
  return r;
};

/** @returns {any} */
const v3Request = () => ({
  openrtb: { ver: '3.0' },
  item: [{ id: '1', spec: {} }],
});

module.exports = {
  validRequest,
  validResponse,
  nativeRequest,
  nativeResponse,
  v25Request,
  v26Request,
  v26GppRequest,
  v3Request,
};
