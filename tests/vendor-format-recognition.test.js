'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('@ortbtools/core');
const { loadCorpus } = require('./corpus/lib/load');
const { runCore } = require('./corpus/lib/core-run');
const { evaluate } = require('./corpus/lib/oracle');
const cases = loadCorpus().all;
const canonical = (format) => ({
  variant: 'vendor-control',
  method: 'GET',
  format,
  device: {},
  _raw: {},
  meta: { detectedVariant: 'vendor-control' },
});

test('declared URL inventory is independent of response serialization', () => {
  for (const format of ['native', 'banner', 'inpage', 'push', 'pops']) {
    assert.deepEqual(core.detectFormat(canonical(format)).formats, [format]);
  }
  for (const format of ['json', 'xml', 'unknown', '']) {
    assert.deepEqual(core.detectFormat(canonical(format)).formats, []);
  }
});

test('all six project inpage pairs gain format evidence while retaining their IAB verdicts', () => {
  const scoped = cases.filter((c) =>
    [
      'cover-vendor-inpage-openrtb26',
      'inpage-x-widget-adm-and-ext',
      'inpage-x-widget-iab-contract',
      'inpage-x-widget-inapp',
      'inpage-x-widget-openrtb-aliases',
      'inpage-x-widget-openrtb-canonical',
    ].includes(c.id),
  );
  assert.equal(scoped.length, 6);
  for (const c of scoped) {
    const before = JSON.stringify([c.request, c.response]);
    assert.deepEqual(evaluate(runCore(c), c.meta.expect, { layers: ['core'] }).failures, [], c.id);
    assert.equal(JSON.stringify([c.request, c.response]), before);
  }
});

test('inpage recognition requires a placement hint or a complete card role signature', () => {
  const card = {
    text: 'Visible title',
    picture: 'https://assets.example.test/card.png',
    click: 'https://advertiser.example.test/',
  };
  const res = (ext) => ({ id: 'r', seatbid: [{ bid: [{ id: 'b', impid: 'i', price: 1, ext }] }] });
  assert.deepEqual(core.detectFormat(res(card)).formats, ['inpage']);
  assert.deepEqual(core.detectFormat(res({ title: 'Metadata only' })).formats, []);
  for (const ext of [
    null,
    [],
    3,
    { widget_id: {} },
    { zone_id: [] },
    { zone_id: 'generic-zone' },
    { format: 'json' },
  ]) {
    assert.deepEqual(core.detectFormat({ imp: [{ id: 'i', ext }] }).formats, []);
  }
  assert.deepEqual(
    core.detectFormat({
      imp: [{ video: { mimes: ['video/mp4'] }, ext: { zone_id: 'video-zone' } }],
    }).formats,
    ['video'],
  );
  const realBanner = { imp: [{ id: 'i', banner: { w: 300, h: 250 }, ext: { widget_id: 'w' } }] };
  assert.deepEqual(core.detectFormat(realBanner).formats, ['banner', 'inpage']);
  assert.ok(
    core
      .validate({ id: 'r', imp: [{ id: 'i', ext: { widget_id: 'w' } }] })
      .findings.some((f) => f.id === 'imp.format_required'),
  );
});

test('five AdCOM Native cases preserve their semantic verdict and identify nested display subtypes', () => {
  const scoped = cases.filter((c) =>
    [
      'cover-context-native-30-ctv',
      'cover-context-native-30-dooh',
      'cover-context-native-30-inapp',
      'cover-context-native-30-unspecified',
      'native-x-ortb30-adcom-stub',
    ].includes(c.id),
  );
  assert.equal(scoped.length, 5);
  for (const c of scoped)
    assert.deepEqual(evaluate(runCore(c), c.meta.expect, { layers: ['core'] }).failures, [], c.id);
  const request = {
    openrtb: {
      ver: '3.0',
      request: {
        item: [
          {
            spec: {
              placement: {
                display: { nativefmt: { asset: [] }, displayfmt: [{ w: 300, h: 250 }] },
              },
            },
          },
        ],
      },
    },
  };
  assert.deepEqual(new Set(core.detectFormat(request).formats), new Set(['banner', 'native']));
  const response = {
    openrtb: {
      ver: '3.0',
      response: {
        seatbid: [
          {
            bid: [
              {
                media: {
                  ad: { display: { native: { asset: [] }, adm: '<p>Banner alternative</p>' } },
                },
              },
            ],
          },
        ],
      },
    },
  };
  assert.deepEqual(new Set(core.detectFormat(response).formats), new Set(['banner', 'native']));
});

test('Kadam Native material validates its url carrier without widening Push aliases', () => {
  const native = {
    id: 'n',
    title: 'Native title',
    image: 'https://assets.example.test/native.png',
    url: 'https://advertiser.example.test/native',
    cpc: 0.0032,
  };
  const result = core.validate([native]);
  assert.ok(!result.findings.some((f) => f.level === 'error'), JSON.stringify(result.findings));
  assert.match(result.type, /Native/);
  for (const url of [null, '', 7, {}, 'javascript:alert(1)']) {
    assert.ok(
      core
        .validate([{ ...native, url }])
        .findings.some((f) => f.level === 'error' && f.path === '[0].url'),
    );
  }
  const unrelatedPush = {
    id: 'p',
    title: 'Push title',
    image: 'https://assets.example.test/p.png',
    cpc: 1,
  };
  assert.ok(
    core.validate([unrelatedPush]).findings.some((f) => f.id === 'feed.push.click_url_required'),
  );
});

test('Native carrier recognition preserves malformed IAB and existing feed precedence', () => {
  const native = {
    id: 'n',
    title: 'Native',
    url: 'https://advertiser.example.test/',
    image: 'https://assets.example.test/n.png',
    cpc: 0.0032,
  };
  for (const marker of [{ imp: null }, { seatbid: null }, { openrtb: false }]) {
    const result = core.validate({ ...native, ...marker });
    assert.doesNotMatch(result.type, /Native/);
    assert.ok(result.findings.some((f) => f.level === 'error'));
  }
  for (const carrier of [
    { clickUrl: 'https://advertiser.example.test/', value: 'wrong' },
    { bid_price: 'wrong', notification_url: 'https://notice.example.test/' },
    { bid: 'wrong', redirecturl: 'https://advertiser.example.test/' },
  ]) {
    const result = core.validate({ ...native, ...carrier });
    assert.doesNotMatch(result.type, /Native/);
    assert.ok(result.findings.some((f) => f.level === 'error'));
  }
});

test('Native material reuses existing carrier ownership for value and nUrl pairs', () => {
  const { validateFeedResponse } = require('../packages/core/rules-feed');
  const value = {
    url: 'https://advertiser.example.test/',
    image: 'https://assets.example.test/n.png',
    cpc: 1,
    value: 'invalid',
    nUrl: 'https://notice.example.test/',
  };
  const result = validateFeedResponse(value);
  assert.match(result.type, /Value/);
  assert.ok(result.findings.some((f) => f.id === 'feed.valuefeed.value_required'));
});
