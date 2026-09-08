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
    'pickStringAlias',
    'inpagePushCardFrom',
    'creativeCandidatesFor',
    'resolveCreativeAt',
  ];
  const bodies = names.map((n) => extractFunction(APP_SRC, n)).join('\n\n');
  const factory = new Function('escapeHtml', `${bodies}\nreturn { ${names.join(', ')} };`);
  // Identity stub: these tests check WHICH branch fires and what text ends
  // up where, not HTML-entity correctness (that belongs to escapeHtml's own
  // test, if one exists — not duplicated here).
  return factory((s) => String(s == null ? '' : s));
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

test('inpagePushCardFrom: across the whole corpus it claims exactly the five documented In-Page Push carriers and nothing else', () => {
  const { inpagePushCardFrom } = loadHelpers();
  const corpusRoot = path.join(ROOT, 'tests/corpus');
  const claimed = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['assets', 'lib', 'known-gaps'].includes(entry.name)) walk(full);
      } else if (entry.name.endsWith('.json')) {
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
        } catch {
          continue;
        }
        const res = parsed.response;
        if (!res || typeof res !== 'object' || !Array.isArray(res.seatbid)) continue;
        for (const seat of res.seatbid) {
          if (!seat || !Array.isArray(seat.bid)) continue;
          for (const bid of seat.bid) {
            if (!bid || typeof bid !== 'object') continue;
            if (typeof bid.adm === 'string' && bid.adm) continue;
            if (bid.native) continue;
            if (inpagePushCardFrom(bid)) claimed.push(parsed.id);
          }
        }
      }
    }
  })(corpusRoot);
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
