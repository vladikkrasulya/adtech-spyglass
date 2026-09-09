'use strict';

/**
 * tests/creative-resolution.test.js
 *
 * DEF-201/DEF-202/DEF-203 — unit coverage for the pure creative-resolution
 * helpers in public/ortbtools.app.js: isPushMaterialShape (the widened,
 * visual-asset-gated push qualification), findPushMaterial, findDestinationUrl,
 * creativeCandidatesFor and resolveCreativeAt.
 *
 * ortbtools.app.js is a single ES module mounted against a live DOM/session —
 * too heavy to `import()` whole in a unit test (that is what the browser
 * corpus suite is for). These functions are self-contained pure logic with no
 * DOM and almost no outer-scope dependency (renderPushToHtml needs only
 * `escapeHtml`, stubbed below as identity — sufficient to prove which branch
 * fires and what text ends up in the card, which is what these tests check).
 * So they are extracted from the real source file by brace-matched name and
 * run for real, against the ACTUAL fixture JSON these defects were filed
 * against — not hand-typed approximations of it — so a change to the
 * fixtures or to the source is what this test sees, not a copy that could
 * silently drift from either.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadCorpus } = require('./corpus/lib/load');

const ROOT = path.join(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');

/**
 * Slice one `function name(...) { ... }` declaration out of `source` by
 * brace-matching from the first `{` after `function name(` to its partner.
 * Throws loudly (a broken extraction is worse than a silently wrong test).
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`extractFunction: "${marker}" not found`);
  const braceOpen = source.indexOf('{', start);
  if (braceOpen === -1) throw new Error(`extractFunction: no body for ${name}`);
  let depth = 0;
  let i = braceOpen;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error(`extractFunction: unbalanced braces for ${name}`);
  return source.slice(start, i + 1);
}

function loadHelpers() {
  const names = [
    'hasVisualAssetKey',
    'isPushMaterialShape',
    'findPushMaterial',
    'findDestinationUrl',
    'findAdm',
    'renderPushToHtml',
    'renderNativeToHtml',
    'pickStringAlias',
    'inpagePushCardFrom',
    'unwrapResponseEnvelope',
    'adcomNativeFrom',
    'vendorNativeMaterialFrom',
    'vendorBannerMarkupFrom',
    'vendorIdentityFrom',
    'vendorMaterialAdm',
    'unwrapRequestEnvelope',
    'singleVendorCarrier',
    'applySubCentDigits',
    'activeLocaleTag',
    'formatMoney',
    'priceTextFor',
    'creativeCandidatesFor',
    'resolveCreativeAt',
  ];
  const bodies = names.map((n) => extractFunction(APP_SRC, n)).join('\n\n');
  const factory = new Function(
    'escapeHtml',
    'window',
    `${bodies}\nreturn { ${names.join(', ')} };`,
  );
  // Identity stub: these tests check WHICH branch fires and what text ends
  // up where, not HTML-entity correctness (that belongs to escapeHtml's own
  // test, if one exists — not duplicated here).
  // `window` only so activeLocaleTag can read the UI locale; the browser
  // corpus suite is where the real one is exercised. `en` matches the locale
  // that suite drives, so a price string asserted here reads the same there.
  return factory((s) => String(s == null ? '' : s), {
    tLocale: () => 'en',
    OrtbtoolsAuctionView: require('../packages/core/auction-view'),
  });
}

function fixture(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/corpus', relPath), 'utf8'));
}

// ── isPushMaterialShape / findPushMaterial — DEF-202 aliases, DEF-203 gate ──

test('isPushMaterialShape requires an actual visual-asset key (DEF-203) — price+click alone never qualifies', () => {
  const { isPushMaterialShape } = loadHelpers();
  assert.equal(
    isPushMaterialShape({ title: 'x', description: 'y', link: 'https://a.test', cpc: 1 }),
    false,
    'PPCmate-shaped material (no image/icon) must not qualify as push',
  );
  assert.equal(
    isPushMaterialShape({ price: 1, click_url: 'https://a.test', image: 'i.png', title: 't' }),
    true,
  );
  assert.equal(
    isPushMaterialShape({
      value: 1,
      clickUrl: 'https://a.test',
      imgUrl: 'i.png',
      description: 'd',
    }),
    true,
  );
  assert.equal(
    isPushMaterialShape({ cpc: 1, click_url: 'https://a.test', icon_url: 'i.png', title: 't' }),
    true,
  );
  assert.equal(
    isPushMaterialShape({ value: 1, clickUrl: 'https://a.test', iconUrl: 'i.png', title: 't' }),
    true,
  );
  assert.equal(isPushMaterialShape(null), false);
  assert.equal(isPushMaterialShape([]), false);
  assert.equal(isPushMaterialShape('x'), false);
});

test('isPushMaterialShape requires actual notification text (title or description) too — price+click+picture alone is a banner-shaped bid, not a push notification', () => {
  const { isPushMaterialShape } = loadHelpers();
  assert.equal(
    isPushMaterialShape({ value: 0.42, clickUrl: 'https://a.test', imgUrl: 'i.png' }),
    false,
    'no title AND no description: must not qualify — this is exactly the coverage-vendor-banner-exads-json shape',
  );
  assert.equal(
    isPushMaterialShape({
      value: 0.42,
      clickUrl: 'https://a.test',
      imgUrl: 'i.png',
      title: 'A view across the valley',
    }),
    true,
    'title alone is enough — inpage-exads-wrapper carries only title text at the point isPushMaterialShape is asked',
  );
});

test('isPushMaterialShape: a bare `url` click field is trusted ONLY when the caller explicitly allows it (Adon3 res.ads[] wrapper) — never generically', () => {
  const { isPushMaterialShape } = loadHelpers();
  const nativeLandingShape = {
    url: 'https://a.test',
    title: 'A notebook for field sketches',
    image: 'i.png',
    cpc: 0.003,
  };
  assert.equal(
    isPushMaterialShape(nativeLandingShape),
    false,
    "a native-format material (title/image/cpc/url, no click_url/link/clickUrl) must NOT be claimed as push — cover-vendor-native-kadam-json/-url's exact shape",
  );
  assert.equal(
    isPushMaterialShape(nativeLandingShape, true),
    true,
    'the same shape DOES qualify once the caller opts in — proves the flag is what gates it, for the one context (Adon3 ads[]) that needs it',
  );
});

test('isPushMaterialShape: `clickurl` (bare, DEF-181) and `bid_price` (DEF-161) are recognised aliases, unconditionally — landed separately on this branch and merged in alongside the DEF-202/203 widening', () => {
  const { isPushMaterialShape } = loadHelpers();
  assert.equal(
    isPushMaterialShape({
      title: 'x',
      price: 1,
      image: 'i.png',
      clickurl: 'https://a.test',
    }),
    true,
    "inpage-x-card-feed-array's exact click-field name",
  );
  assert.equal(
    isPushMaterialShape({
      title: 'x',
      bid_price: 1,
      image: 'i.png',
      link: 'https://a.test',
    }),
    true,
    "push-x-richads-bare-array's exact price-field name",
  );
});

test('findPushMaterial: DEF-203 — pop-ppcmate-json-material/-multi never qualify as push (no visual asset)', () => {
  const { findPushMaterial } = loadHelpers();
  const material = fixture('pairs/pop/pop-ppcmate-json-material.json').response;
  const multi = fixture('pairs/pop/pop-ppcmate-json-multi.json').response;
  assert.equal(findPushMaterial(material), null);
  assert.equal(findPushMaterial(multi), null);
});

test('findPushMaterial: DEF-202 — res.bid wrapper shape (EXADS) qualifies via the widened aliases', () => {
  const { findPushMaterial } = loadHelpers();
  const inpage = fixture('pairs/inpage/inpage-exads-wrapper.json').response;
  const got = findPushMaterial(inpage);
  assert.ok(got, 'inpage-exads-wrapper.res.bid must qualify as a push material');
  assert.equal(got.title, 'A view across the valley');

  const pushIcon = fixture('pairs/push/push-exads-icon-cpc.json').response;
  const got2 = findPushMaterial(pushIcon);
  assert.ok(got2);
  assert.equal(got2.title, 'A small garden project');
});

test('findPushMaterial: DEF-202 — res.ads[] array shape (Adon3) qualifies via the widened aliases', () => {
  const { findPushMaterial } = loadHelpers();
  const adon3 = fixture('pairs/push/push-adon3-string-cpc.json').response;
  const got = findPushMaterial(adon3);
  assert.ok(got, 'push-adon3-string-cpc.res.ads[0] must qualify as a push material');
  assert.equal(got.title, 'Simple tools for a garden');
});

test('findPushMaterial: Adon3 pop ads (no visual asset) never qualify as push', () => {
  const { findPushMaterial } = loadHelpers();
  const under = fixture('pairs/pop/pop-adon3-under.json').response;
  const overMulti = fixture('pairs/pop/pop-adon3-over-multi.json').response;
  assert.equal(findPushMaterial(under), null);
  assert.equal(findPushMaterial(overMulti), null);
});

test('findPushMaterial: every real push fixture in the corpus still qualifies (no DEF-203 regression)', () => {
  const { findPushMaterial } = loadHelpers();
  for (const rel of [
    'pairs/push/push-ppcmate-single.json',
    'pairs/push/push-ppcmate-multi.json',
    'pairs/push/push-x-kadam-array-alias-mixed.json',
  ]) {
    const res = fixture(rel).response;
    assert.ok(findPushMaterial(res), `${rel}: expected a qualifying push material`);
  }
});

test('findPushMaterial: push-x-kadam-array-alias-mixed — all three alias shapes qualify individually', () => {
  const { isPushMaterialShape } = loadHelpers();
  const materials = fixture('pairs/push/push-x-kadam-array-alias-mixed.json').response;
  assert.equal(materials.length, 3);
  for (const m of materials) {
    assert.equal(isPushMaterialShape(m), true, `material ${m.id || m.tId} must qualify as push`);
  }
});

// ── findDestinationUrl — DEF-202 ─────────────────────────────────────────

const DESTINATION_CASES = [
  [
    'pairs/pop/pop-x-feed-bid-redirect.json',
    'https://advertiser.example.test/offers/pop-x-feed-bid-redirect',
  ],
  ['pairs/pop/pop-exads-wrapper.json', 'https://advertiser.example.test/offers/pop-exads-wrapper'],
  [
    'pairs/pop/pop-x-feed-linkfeed-get.json',
    'https://advertiser.example.test/offers/pop-x-feed-linkfeed-get',
  ],
  [
    'pairs/pop/pop-kadam-clickunder.json',
    'https://advertiser.example.test/offers/pop-kadam-clickunder-a',
  ],
  ['pairs/pop/pop-adon3-under.json', 'https://advertiser.example.test/offers/pop-adon3-under-0'],
  [
    'pairs/pop/pop-adon3-over-multi.json',
    'https://advertiser.example.test/offers/pop-adon3-over-multi-0',
  ],
  [
    'pairs/pop/pop-ppcmate-json-material.json',
    'https://advertiser.example.test/offers/pop-ppcmate-json-material',
  ],
  [
    'pairs/pop/pop-ppcmate-json-multi.json',
    'https://advertiser.example.test/offers/pop-ppcmate-json-multi-first',
  ],
];

for (const [rel, expectedUrl] of DESTINATION_CASES) {
  test(`findDestinationUrl resolves ${rel}`, () => {
    const { findDestinationUrl } = loadHelpers();
    const res = fixture(rel).response;
    assert.equal(findDestinationUrl(res), expectedUrl);
  });
}

test('findDestinationUrl returns null for a response with no recognised wrapper shape', () => {
  const { findDestinationUrl } = loadHelpers();
  assert.equal(findDestinationUrl({}), null);
  assert.equal(findDestinationUrl({ foo: 'bar' }), null);
  assert.equal(findDestinationUrl(null), null);
  assert.equal(findDestinationUrl('a string'), null);
});

// ── creativeCandidatesFor / resolveCreativeAt — DEF-201 ──────────────────

test('creativeCandidatesFor: oRTB multi-seat/multi-bid — one entry per (seatIndex,bidIndex), in order', () => {
  const { creativeCandidatesFor } = loadHelpers();
  const res = fixture('pairs/banner/bn-banner-26-multiimp-multiseat.json').response;
  const got = creativeCandidatesFor(res);
  assert.deepEqual(
    got.map((c) => [c.seatIndex, c.bidIndex]),
    [
      [0, 0],
      [1, 0],
    ],
  );
});

test('creativeCandidatesFor: a materials array (res itself) — seatIndex always 0', () => {
  const { creativeCandidatesFor } = loadHelpers();
  const res = fixture('pairs/push/push-x-kadam-array-alias-mixed.json').response;
  const got = creativeCandidatesFor(res);
  assert.deepEqual(
    got.map((c) => [c.seatIndex, c.bidIndex]),
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
  );
});

test('creativeCandidatesFor: res.ads[] materials — same seatIndex-0 shape', () => {
  const { creativeCandidatesFor } = loadHelpers();
  const res = fixture('pairs/pop/pop-adon3-over-multi.json').response;
  const got = creativeCandidatesFor(res);
  assert.deepEqual(
    got.map((c) => [c.seatIndex, c.bidIndex]),
    [
      [0, 0],
      [0, 1],
    ],
  );
});

test('creativeCandidatesFor: a single bid/material yields exactly one candidate (selector renders none)', () => {
  const { creativeCandidatesFor } = loadHelpers();
  const single = fixture('pairs/push/push-ppcmate-single.json').response;
  assert.equal(creativeCandidatesFor(single).length, 1);
});

test("resolveCreativeAt: the second oRTB bid resolves its OWN adm, not the first bid's (the exact state-partial repro)", () => {
  const { resolveCreativeAt } = loadHelpers();
  const req = { id: 'r1', imp: [{ id: 'imp-1', banner: { w: 300, h: 250 } }] };
  const res = {
    id: 'r1',
    cur: 'USD',
    seatbid: [
      {
        bid: [
          { id: 'bid-1', impid: 'imp-1', price: 2, w: 300, h: 250, adm: '<div>first bid</div>' },
          { id: 'bid-2', impid: 'imp-1', price: 3, w: 300, h: 250, adm: '<div>second bid</div>' },
        ],
      },
    ],
  };
  const first = resolveCreativeAt(req, res, 0, 0);
  const second = resolveCreativeAt(req, res, 0, 1);
  assert.equal(first.adm, '<div>first bid</div>');
  assert.equal(second.adm, '<div>second bid</div>');
  assert.equal(second.bid.id, 'bid-2');
});

test("resolveCreativeAt: a multi-seat response resolves the OTHER seat's bid (bn-banner-26-multiimp-multiseat)", () => {
  const { resolveCreativeAt } = loadHelpers();
  const c = fixture('pairs/banner/bn-banner-26-multiimp-multiseat.json');
  const first = resolveCreativeAt(c.request, c.response, 0, 0);
  const second = resolveCreativeAt(c.request, c.response, 1, 0);
  assert.match(first.adm, /RAIL CREATIVE/);
  assert.match(second.adm, /TOP CREATIVE/);
});

test('resolveCreativeAt: materials[1]/[2] of push-x-kadam-array-alias-mixed each resolve their OWN card', () => {
  const { resolveCreativeAt } = loadHelpers();
  const c = fixture('pairs/push/push-x-kadam-array-alias-mixed.json');
  const m0 = resolveCreativeAt(c.request, c.response, 0, 0);
  const m1 = resolveCreativeAt(c.request, c.response, 0, 1);
  const m2 = resolveCreativeAt(c.request, c.response, 0, 2);
  assert.match(m0.adm, /A quiet harbor at dawn/);
  assert.match(m1.adm, /Icon-only evening reminder/);
  assert.match(m2.adm, /A hillside vineyard row/);
  assert.ok(
    m0.pushMaterial && m1.pushMaterial && m2.pushMaterial,
    'all three must resolve as push',
  );
});

test("resolveCreativeAt: a VAST bid resolves the exact bid's own XML (audio-web-26-multi-imp-reversed)", () => {
  const { resolveCreativeAt } = loadHelpers();
  const c = fixture('pairs/audio/audio-web-26-multi-imp-reversed.json');
  const post = resolveCreativeAt(c.request, c.response, 0, 0);
  const pre = resolveCreativeAt(c.request, c.response, 0, 1);
  assert.match(post.adm, /audio-web-26-multi-imp-reversed-post/);
  assert.doesNotMatch(post.adm, /audio-web-26-multi-imp-reversed-pre-creative/);
  assert.match(pre.adm, /audio-web-26-multi-imp-reversed-pre/);
});

test('resolveCreativeAt: an unqualified pop material (pop-adon3-over-multi[1]) resolves its destination URL, not a push card', () => {
  const { resolveCreativeAt } = loadHelpers();
  const c = fixture('pairs/pop/pop-adon3-over-multi.json');
  const second = resolveCreativeAt(c.request, c.response, 0, 1);
  assert.equal(second.adm, 'https://advertiser.example.test/offers/pop-adon3-over-multi-1');
  assert.equal(second.pushMaterial, null);
});

// ── Collateral-damage guard — the corpus-wide audit ──────────────────────
// The DEF-202/203 alias widening was verified against its 11 target
// fixtures, but the SAME aliases are read by every other corpus fixture with
// a similarly-shaped response — a systematic scan against the full corpus
// (not just the target list) turned up three shapes the widening would have
// silently misclassified. Each one is pinned here by name so a future edit
// to isPushMaterialShape/findDestinationUrl has to look these three in the
// eye before it can pass.

test('findPushMaterial: an EXADS bid with price+click+picture but NO title/description is a banner bid, not push (cover-vendor-banner-exads-json)', () => {
  const { findPushMaterial, findDestinationUrl, findAdm } = loadHelpers();
  const res = fixture('pairs/coverage-vendor/cover-vendor-banner-exads-json.json').response;
  assert.equal(findPushMaterial(res), null, 'must not qualify as push — no title, no description');
  // Nothing else resolves it either (findAdm sees no `.adm`, findDestinationUrl
  // sees no recognised wrapper shape) — the whole point is that this fixture
  // stays exactly as unresolved as it was before the DEF-202 widening.
  assert.equal(findAdm(res), null);
  assert.equal(findDestinationUrl(res), null);
});

test('findPushMaterial: a native-format material (title/image/cpc/url, no click_url|link|clickUrl) is never claimed as push (cover-vendor-native-kadam-json/-url)', () => {
  const { findPushMaterial } = loadHelpers();
  for (const rel of [
    'pairs/coverage-vendor/cover-vendor-native-kadam-json.json',
    'pairs/coverage-vendor/cover-vendor-native-kadam-url.json',
  ]) {
    const res = fixture(rel).response;
    assert.equal(
      findPushMaterial(res),
      null,
      `${rel}: a bare "url" field must not be read as a push click-through outside Adon3's res.ads[] wrapper`,
    );
  }
});

test('findPushMaterial: `bid_price` is a recognised price alias (DEF-161, landed separately on this branch — push-x-richads-bare-array)', () => {
  const { findPushMaterial } = loadHelpers();
  const res = fixture('pairs/push/push-x-richads-bare-array.json').response;
  // This material carries `bid_price`, not cpc/price/value. DEF-161 already
  // taught packages/core (and this file's isPushMaterialShape, merged in
  // alongside it) that alias, so this must qualify as push, not fall through
  // to a bare-link guess.
  const got = findPushMaterial(res);
  assert.ok(got, 'bid_price must be recognised as a price signal');
  assert.equal(got.title, 'A weekend hobby to try');
});

test('findDestinationUrl: a materials-array element that carries a picture but fails push qualification on some OTHER (unrecognised) field stays unresolved, not reinterpreted as a bare link', () => {
  const { findDestinationUrl } = loadHelpers();
  // Synthetic — a picture-bearing element that is not, and must never
  // silently become, push material just because nothing else claimed it:
  // an unlisted price-field name (unlike bid_price, which IS now listed).
  const res = [
    {
      title: 'x',
      description: 'y',
      image: 'i.png',
      link: 'https://a.test',
      an_unrecognised_price_field: 1,
    },
  ];
  assert.equal(
    findDestinationUrl(res),
    null,
    'an element with a visual-asset key must never fall through to the bare .link/.url guess',
  );
});

// ── DEF-180 — the In-Page Push carrier (bid.ext), feature 029 ──

test('inpagePushCardFrom: the canonical carrier resolves every role from its own key name', () => {
  const { inpagePushCardFrom } = loadHelpers();
  const c = fixture('pairs/inpage/inpage-x-widget-openrtb-canonical.json');
  const bid = c.response.seatbid[0].bid[0];
  assert.deepEqual(inpagePushCardFrom(bid), {
    title: 'A quiet harbor at dawn',
    description: 'Compare three original travel-planning tools before you book.',
    image: 'https://assets.example.test/feeds/inpage-x-widget-openrtb-canonical-hero-492x328.png',
    icon: 'https://assets.example.test/feeds/inpage-x-widget-openrtb-canonical-icon-192x192.png',
    link: 'https://advertiser.example.test/offers/inpage-x-widget-openrtb-canonical',
  });
});

test("inpagePushCardFrom: the dialect's alias names land in their own roles — `text` is a HEADLINE here, not a body line as it is in a flat Kadam feed", () => {
  const { inpagePushCardFrom, renderPushToHtml } = loadHelpers();
  const c = fixture('pairs/inpage/inpage-x-widget-openrtb-aliases.json');
  const card = inpagePushCardFrom(c.response.seatbid[0].bid[0]);
  assert.deepEqual(card, {
    title: 'Two ferries crossing at sunset',
    description: 'See why commuters are switching routes this month.',
    image: 'https://assets.example.test/feeds/inpage-x-widget-openrtb-aliases-hero-492x328.png',
    icon: 'https://assets.example.test/feeds/inpage-x-widget-openrtb-aliases-icon-192x192.png',
    link: 'https://advertiser.example.test/offers/inpage-x-widget-openrtb-aliases',
  });
  const html = renderPushToHtml(card);
  assert.match(
    html,
    /<div class="t">Two ferries crossing at sunset<\/div>/,
    'the `text` role must render in the headline slot',
  );
  assert.match(
    html,
    /<div class="d">See why commuters are switching routes this month\.<\/div>/,
    'the `desc` role must render in the body slot',
  );
});

test('inpagePushCardFrom: the in-app carrier resolves the body/image_url/href aliases', () => {
  const { inpagePushCardFrom } = loadHelpers();
  const c = fixture('pairs/inpage/inpage-x-widget-inapp.json');
  const card = inpagePushCardFrom(c.response.seatbid[0].bid[0]);
  assert.equal(card.title, 'A rooftop garden after rain');
  assert.equal(card.description, 'Read what three reviewers said about the new app tab.');
  assert.equal(
    card.image,
    'https://assets.example.test/feeds/inpage-x-widget-inapp-hero-492x328.png',
  );
  assert.equal(card.link, 'https://advertiser.example.test/offers/inpage-x-widget-inapp');
});

test('inpagePushCardFrom: only present roles are carried, so the renderer keeps its own placeholders', () => {
  const { inpagePushCardFrom, renderPushToHtml } = loadHelpers();
  const card = inpagePushCardFrom({ price: 1, ext: { image: 'https://a.test/hero.png' } });
  assert.deepEqual(
    card,
    { image: 'https://a.test/hero.png' },
    'absent roles must not become empty strings',
  );
  const html = renderPushToHtml(card);
  assert.match(html, /class="t muted">No title</, 'a missing title must render the placeholder');
  assert.match(html, /href="#"/, 'a missing click must render an inert target');
});

test('inpagePushCardFrom: a bid the dialect does not claim is not dressed as a card', () => {
  const { inpagePushCardFrom } = loadHelpers();
  for (const bid of [
    null,
    'string',
    [],
    {},
    { ext: null },
    { ext: 'string' },
    { ext: [] },
    { ext: { bidder: 'x', dsp_id: 7, deal_tier: 3 } },
    { ext: { title: 42, image: [] } },
    { ext: { title: '' } },
  ]) {
    assert.equal(inpagePushCardFrom(bid), null, `must not claim ${JSON.stringify(bid)}`);
  }
});

test('resolveCreativeAt: an In-Page Push bid resolves to its rendered card, and a sibling carrying adm still resolves the markup', () => {
  const { resolveCreativeAt } = loadHelpers();
  const carrier = fixture('pairs/inpage/inpage-x-widget-openrtb-canonical.json');
  const resolved = resolveCreativeAt(carrier.request, carrier.response, 0, 0);
  assert.ok(resolved.pushMaterial, 'the carrier must resolve a push material');
  assert.match(resolved.adm, /A quiet harbor at dawn/);
  assert.match(resolved.adm, /push · synthetic render/);
  assert.deepEqual(
    resolved.previewDims,
    { w: 360, h: 300 },
    'a bare widget impression declares no banner size, so the push aspect applies',
  );

  const withAdm = fixture('pairs/inpage/inpage-x-widget-adm-and-ext.json');
  const admResolved = resolveCreativeAt(withAdm.request, withAdm.response, 0, 0);
  assert.equal(admResolved.pushMaterial, null, 'a real adm must win over the ext carrier');
  assert.equal(admResolved.adm, withAdm.response.seatbid[0].bid[0].adm);
});

// ── DEF-151/DEF-441/DEF-106/DEF-107 — vendor and AdCOM carriers, feature 030 ──

test('unwrapResponseEnvelope: an OpenRTB 3.0 envelope yields its inner response; anything else is returned untouched', () => {
  const { unwrapResponseEnvelope } = loadHelpers();
  const c = fixture('pairs/native/native-x-ortb30-adcom-stub.json');
  assert.equal(unwrapResponseEnvelope(c.response), c.response.openrtb.response);
  const flat = { id: 'x', seatbid: [] };
  assert.equal(unwrapResponseEnvelope(flat), flat, 'a 2.x response is not an envelope');
  const arr = [{ id: 'm' }];
  assert.equal(unwrapResponseEnvelope(arr), arr, 'a materials array is not an envelope');
  for (const odd of [null, 'string', 42, { openrtb: null }, { openrtb: { response: [] } }]) {
    assert.equal(unwrapResponseEnvelope(odd), odd, `left alone: ${JSON.stringify(odd)}`);
  }
});

test("adcomNativeFrom: AdCOM's `asset`/`image` names map onto the oRTB Native 1.x shape the renderer reads", () => {
  const { adcomNativeFrom, renderNativeToHtml } = loadHelpers();
  const c = fixture('pairs/native/native-x-ortb30-adcom-stub.json');
  const bid = c.response.openrtb.response.seatbid[0].bid[0];
  const native = adcomNativeFrom(bid);
  assert.equal(native.link.url, 'https://advertiser.example.test/offer/native-x-ortb30-adcom-stub');
  assert.equal(native.assets.length, 3);
  assert.equal(native.assets[0].title.text, 'A quiet corner for weekend reading');
  assert.ok(native.assets[1].img, 'AdCOM `image` must arrive as oRTB `img`');
  assert.match(native.assets[1].img.url, /^data:image\/png;base64,/);
  assert.equal(native.assets[2].data.value, 'Fixture AdCOM');
  const html = renderNativeToHtml(native);
  assert.match(html, /native · synthetic render/);
  assert.match(html, /A quiet corner for weekend reading/);
});

test('adcomNativeFrom: a bid with no AdCOM display native is not claimed', () => {
  const { adcomNativeFrom } = loadHelpers();
  for (const bid of [
    null,
    'string',
    [],
    {},
    { media: null },
    { media: { ad: null } },
    { media: { ad: { display: { native: null } } } },
    { media: { ad: { display: { native: { link: {} } } } } },
    { media: { ad: { display: { banner: { img: 'x' } } } } },
  ]) {
    assert.equal(adcomNativeFrom(bid), null, `must not claim ${JSON.stringify(bid)}`);
  }
});

test('vendorNativeMaterialFrom: the documented Kadam Native material becomes a native card, and a push-qualified material never reaches this path', () => {
  const { vendorNativeMaterialFrom, isPushMaterialShape } = loadHelpers();
  const c = fixture('pairs/coverage-vendor/cover-vendor-native-kadam-json.json');
  const material = c.response[0];
  assert.equal(isPushMaterialShape(material), false, 'DEF-203 still refuses it as a push card');
  const native = vendorNativeMaterialFrom(material);
  assert.equal(native.link.url, material.url);
  assert.equal(native.assets[0].title.text, 'A notebook for field sketches');
  assert.equal(native.assets[1].img.url, material.image);
  const push = fixture('pairs/push/push-ppcmate-single.json').response;
  const pushMaterial = Array.isArray(push) ? push[0] : push;
  assert.equal(vendorNativeMaterialFrom(pushMaterial), null, 'a push card stays a push card');
});

test('vendorNativeMaterialFrom: every documented role is required — a material missing one is not claimed', () => {
  const { vendorNativeMaterialFrom } = loadHelpers();
  const full = {
    title: 'T',
    url: 'https://a.test/go',
    image: 'https://a.test/hero.png',
    cpc: 0.003,
  };
  assert.ok(vendorNativeMaterialFrom(full));
  for (const missing of ['title', 'url', 'image', 'cpc']) {
    const partial = { ...full };
    delete partial[missing];
    assert.equal(vendorNativeMaterialFrom(partial), null, `must not claim without ${missing}`);
  }
});

test('vendorBannerMarkupFrom: the documented EXADS bid wrapper becomes banner markup carrying its own picture and destination', () => {
  const { vendorBannerMarkupFrom, singleVendorCarrier } = loadHelpers();
  const c = fixture('pairs/coverage-vendor/cover-vendor-banner-exads-json.json');
  const material = singleVendorCarrier(c.response);
  assert.equal(material, c.response.bid, 'the EXADS wrapper resolves to res.bid');
  const markup = vendorBannerMarkupFrom(material);
  assert.match(
    markup,
    /<img src="https:\/\/assets\.example\.test\/coverage\/exads-banner-300x250\.png"/,
  );
  assert.match(markup, /<a href="https:\/\/advertiser\.example\.test\/coverage\/exads-banner"/);
});

test('vendorBannerMarkupFrom: notification text disqualifies a wrapper — that is a push card, not a banner', () => {
  const { vendorBannerMarkupFrom } = loadHelpers();
  const banner = { value: 1.25, clickUrl: 'https://a.test/go', imgUrl: 'https://a.test/x.png' };
  assert.ok(vendorBannerMarkupFrom(banner));
  assert.equal(vendorBannerMarkupFrom({ ...banner, title: 'Hello' }), null);
  assert.equal(vendorBannerMarkupFrom({ ...banner, description: 'Hello' }), null);
  for (const missing of ['value', 'clickUrl', 'imgUrl']) {
    const partial = { ...banner };
    delete partial[missing];
    assert.equal(vendorBannerMarkupFrom(partial), null, `must not claim without ${missing}`);
  }
});

test('vendorIdentityFrom: a pop material supplies its own title and description, and nothing when it has neither', () => {
  const { vendorIdentityFrom } = loadHelpers();
  const c = fixture('pairs/pop/pop-ppcmate-json-material.json');
  assert.equal(
    vendorIdentityFrom(c.response[0]),
    'Original fixture destination\nA pop landing route for local interception.',
  );
  assert.equal(vendorIdentityFrom({ link: 'https://a.test/go', cpc: 1 }), null);
  assert.equal(vendorIdentityFrom(null), null);
});

test('resolveCreativeAt: the SECOND PPCmate material resolves its own destination and its own identity', () => {
  const { resolveCreativeAt } = loadHelpers();
  const c = fixture('pairs/pop/pop-ppcmate-json-multi.json');
  const first = resolveCreativeAt({}, c.response, 0, 0);
  const second = resolveCreativeAt({}, c.response, 0, 1);
  assert.equal(first.adm, 'https://advertiser.example.test/offers/pop-ppcmate-json-multi-first');
  assert.equal(first.identity, 'First fixture destination\nFirst local navigation offer.');
  assert.equal(second.adm, 'https://advertiser.example.test/offers/pop-ppcmate-json-multi-second');
  assert.equal(second.identity, 'Second fixture destination\nSecond local navigation offer.');
});

test('resolveCreativeAt: a 3.0 AdCOM bid resolves through the envelope to its native card', () => {
  const { resolveCreativeAt } = loadHelpers();
  const c = fixture('pairs/native/native-x-ortb30-adcom-stub.json');
  const resolved = resolveCreativeAt(c.request, c.response, 0, 0);
  const parsed = JSON.parse(resolved.adm);
  assert.equal(parsed.native.assets[0].title.text, 'A quiet corner for weekend reading');
  assert.equal(resolved.identity, null, 'a rendered creative needs no identity fallback');
});

// ── Exhaustive corpus traversal ─────────────────────────────────────────────
//
// The reach guards below used to walk `tests/corpus` with their own
// `fs.readdirSync` recursion and read `parsed.response` straight off each file.
// A mutation stores a `patch` against a base pair, not a response, so every one
// of them was silently skipped: the guards said "across the whole corpus" while
// reaching 135 of the 243 responses the loader materializes. They also examined
// only the FIRST material of a materials feed, so nothing ever checked
// materials[1..n]. Both are fixed by going through the same loader and the same
// enumeration the product itself uses (feature 031).

/** Every bid of a response, through the OpenRTB 3.0 envelope when there is one. */
function bidsOf(H, response) {
  const envelope = H.unwrapResponseEnvelope(response);
  if (!envelope || typeof envelope !== 'object' || !Array.isArray(envelope.seatbid)) return [];
  return envelope.seatbid.flatMap((seat) => (Array.isArray(seat && seat.bid) ? seat.bid : []));
}

/**
 * Every material of a response, in the same index space the selector uses AND
 * with the same click-alias scope the resolver applies to it. The scope is
 * carried, not re-derived: a bare `url` is a click-through only inside Adon3's
 * `res.ads[]` wrapper, and a guard that forgot that would classify an Adon3
 * push material as a vendor Native one — which is a wrong answer about the
 * guard, not about the product.
 * @returns {Array<{material: unknown, allowBareUrlClick: boolean}>}
 */
function materialsOf(H, response) {
  if (response === undefined || response === null) return [];
  if (bidsOf(H, response).length) return [];
  const envelope = H.unwrapResponseEnvelope(response);
  if (envelope && typeof envelope === 'object' && Array.isArray(envelope.seatbid)) return [];
  if (Array.isArray(response))
    return response.map((material) => ({ material, allowBareUrlClick: false }));
  if (typeof response === 'object' && Array.isArray(response.ads))
    return response.ads.map((material) => ({ material, allowBareUrlClick: true }));
  const single = H.singleVendorCarrier(response);
  return single ? [{ material: single, allowBareUrlClick: false }] : [];
}

/** The cases the loader materializes, pairs and mutations alike. */
function corpusCases() {
  return loadCorpus().all;
}

test('the corpus traversal these reach guards use is exhaustive: every case the loader materializes, and every material of every response', () => {
  const H = loadHelpers();
  const cases = corpusCases();
  assert.ok(cases.length > 250, `expected the full corpus, got ${cases.length} cases`);
  const mutations = cases.filter((c) => c.kind === 'mutation');
  assert.ok(
    mutations.length > 100,
    `mutations must be reachable; got ${mutations.length} — a raw file walk sees none of them`,
  );
  const withResponse = cases.filter((c) => c.response !== undefined);
  const reached = withResponse.filter(
    (c) => bidsOf(H, c.response).length > 0 || materialsOf(H, c.response).length > 0,
  );
  const mutationResponses = mutations.filter((c) => c.response !== undefined);
  assert.ok(
    mutationResponses.length > 100,
    `mutations must materialize responses; got ${mutationResponses.length}`,
  );
  // Not every response carries a candidate (a no-bid, a deliberately malformed
  // payload); what must hold is that nothing is skipped for being a mutation.
  assert.ok(
    reached.length >= withResponse.length - 40,
    `traversal reached ${reached.length} of ${withResponse.length} responses`,
  );
  const multiMaterial = withResponse.filter((c) => materialsOf(H, c.response).length > 1);
  const adsWrapped = withResponse.filter((c) =>
    materialsOf(H, c.response).some((m) => m.allowBareUrlClick),
  );
  assert.ok(
    adsWrapped.length > 0,
    'the corpus must contain an ads[]-wrapped response, or the click-alias scope this traversal carries is never exercised',
  );
  assert.ok(
    multiMaterial.length > 0,
    'the corpus must contain a multi-material response, or the every-material half of this guard proves nothing',
  );
});

test('inpagePushCardFrom: across every case the loader materializes it claims exactly the five documented In-Page Push carriers and nothing else', () => {
  const H = loadHelpers();
  const claimed = [];
  for (const c of corpusCases()) {
    for (const bid of bidsOf(H, c.response)) {
      if (!bid || typeof bid !== 'object') continue;
      if (typeof bid.adm === 'string' && bid.adm) continue;
      if (bid.native) continue;
      if (H.inpagePushCardFrom(bid)) claimed.push(c.id);
    }
  }
  assert.deepEqual(
    [...new Set(claimed)].sort(),
    [
      'cover-vendor-inpage-openrtb26',
      'inpage-x-widget-iab-contract',
      'inpage-x-widget-inapp',
      'inpage-x-widget-openrtb-aliases',
      'inpage-x-widget-openrtb-canonical',
    ],
    'the carrier predicate must reach the documented In-Page Push cases and no other bid in the corpus',
  );
});

test('the four carrier predicates reach exactly the documented cases across every case and every material the loader materializes', () => {
  const H = loadHelpers();
  const reached = { adcom: [], vendorNative: [], vendorBanner: [], identity: [] };
  for (const c of corpusCases()) {
    for (const bid of bidsOf(H, c.response)) {
      if (!bid || typeof bid !== 'object') continue;
      if (typeof bid.adm === 'string' && bid.adm) continue;
      if (bid.native && Array.isArray(bid.native.assets)) continue;
      if (H.adcomNativeFrom(bid)) reached.adcom.push(c.id);
    }
    // EVERY material, not only the first: materials[1..n] were never examined.
    for (const { material, allowBareUrlClick } of materialsOf(H, c.response)) {
      if (!material || typeof material !== 'object' || Array.isArray(material)) continue;
      if (H.findAdm(material)) continue;
      if (H.isPushMaterialShape(material, allowBareUrlClick)) continue;
      if (H.vendorNativeMaterialFrom(material)) reached.vendorNative.push(c.id);
      else if (H.vendorBannerMarkupFrom(material)) reached.vendorBanner.push(c.id);
      else if (H.findDestinationUrl(material) && H.vendorIdentityFrom(material))
        reached.identity.push(c.id);
    }
  }
  assert.deepEqual([...new Set(reached.adcom)].sort(), [
    'cover-context-native-30-ctv',
    'cover-context-native-30-dooh',
    'cover-context-native-30-inapp',
    'cover-context-native-30-unspecified',
    'native-x-ortb30-adcom-stub',
  ]);
  assert.deepEqual([...new Set(reached.vendorNative)].sort(), [
    'cover-preview-materials-mixed-kinds',
    'cover-vendor-native-kadam-json',
    'cover-vendor-native-kadam-url',
  ]);
  assert.deepEqual([...new Set(reached.vendorBanner)].sort(), ['cover-vendor-banner-exads-json']);
  assert.deepEqual([...new Set(reached.identity)].sort(), [
    'pop-ppcmate-json-material',
    'pop-ppcmate-json-multi',
  ]);
});

test('shared auction view: selected dimensions follow its matching impression across all 2.x and 3.0 items', () => {
  const { resolveCreativeAt } = loadHelpers();
  const req2 = {
    id: 'dimensions',
    imp: [
      { id: 'small', banner: { w: 300, h: 250 } },
      { id: 'wide', banner: { w: 728, h: 90 } },
    ],
  };
  const bid2 = { id: 'selected', impid: 'wide', adm: '<p>own</p>' };
  const res2 = { seatbid: [{ bid: [bid2] }] };
  assert.deepEqual(resolveCreativeAt(req2, res2, 0, 0).previewDims, { w: 728, h: 90 });
  assert.equal(resolveCreativeAt(req2, res2, 0, 0).bid, bid2);
  const req3 = {
    openrtb: {
      ver: '3.0',
      request: {
        id: 'dimensions',
        item: req2.imp.map((imp) => ({ id: imp.id, spec: { placement: { display: imp.banner } } })),
      },
    },
  };
  const bid3 = { id: 'selected', item: 'wide', media: { display: { adm: '<p>own 3</p>' } } };
  const res3 = { openrtb: { response: { seatbid: [{ bid: [bid3] }] } } };
  assert.deepEqual(resolveCreativeAt(req3, res3, 0, 0).previewDims, { w: 728, h: 90 });
  assert.equal(
    resolveCreativeAt(req3, res3, 0, 0).bid,
    bid3,
    'normalization never replaces original creative identity',
  );
  assert.deepEqual(
    resolveCreativeAt(req3.openrtb.request, res3.openrtb.response, 0, 0).previewDims,
    { w: 728, h: 90 },
  );
  bid3.item = 'not-present';
  assert.equal(
    resolveCreativeAt(req3, res3, 0, 0).previewDims,
    null,
    'an unmatched item does not borrow the first impression',
  );
});
