'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const core = require('../packages/core');
const { analyzeShape } = require('../packages/core/dialects/shape-fingerprint');
const { POP_SHAPE_FLAG_KEYS, scanExtForFormatHints } = require('../packages/core/non-iab-formats');
const req = (floor = 1, deals = []) => ({
  id: 'q',
  imp: [
    { id: 'i', bidfloor: floor, bidfloorcur: 'USD', banner: { w: 300, h: 250 }, pmp: { deals } },
  ],
});
const res = (price = 2, dealid) => ({
  id: 'q',
  seatbid: [
    {
      bid: [
        {
          id: 'b',
          impid: 'i',
          price,
          adm: '<b>x</b>',
          adomain: ['example.test'],
          w: 300,
          h: 250,
          ...(dealid ? { dealid } : {}),
        },
      ],
    },
  ],
});
const economic = (r, s, opts) =>
  core
    .crosscheck(r, s, opts)
    .filter((f) => ['crosscheck.bid.above_floor', 'crosscheck.bid.below_floor'].includes(f.id));
test('redirect aliases and value+nUrl enter their field validators with original leaf paths', () => {
  for (const key of ['redirecturl', 'redirect_url']) {
    assert.equal(
      core.validate({ bid: 1, [key]: 'https://example.test/' }).type,
      'Bid-Redirect Feed Response',
    );
    assert.ok(
      core
        .validate({ bid: 1, [key]: 2 })
        .findings.some((f) => f.id === 'feed.bidredirect.redirecturl_required' && f.path === key),
    );
  }
  const value = core.validate({ value: 1, nUrl: 'https://example.test/' });
  assert.equal(value.type, 'Value-Feed Response');
  assert.ok(value.findings.some((f) => f.id === 'feed.valuefeed.click_url_required'));
});
test('in-page validation dispatches each material independently and checks only supplied vendor fields', () => {
  const card = {
    id: 'i',
    title: 'Card',
    image: 'https://example.test/i.png',
    icon: 'https://example.test/icon.png',
    clickurl: 'https://example.test/',
    price: 1,
    ext: { format: 'inpage' },
  };
  assert.equal(core.validate([card]).type, 'In-Page-Materials Feed Response');
  assert.equal(core.validate(card).type, 'In-Page-Materials Feed Response (single)');
  assert.equal(core.validate([card]).findings.length, 0);
  const mixed = core.validate([
    { ...card, impurl: 'javascript:x', advertiser: 42 },
    { ...card, ext: {} },
  ]);
  assert.equal(mixed.type, 'Push-Materials Feed Response');
  assert.deepEqual(
    mixed.findings.filter((f) => f.id === 'feed.inpage.field_invalid').map((f) => f.path),
    ['[0].advertiser', '[0].impurl'],
  );
  assert.equal(
    core.validate({ ...card, bid_price: 2, notification_url: 'x' }).type,
    'Bid-Price Feed Response',
  );
});
test('all pop flags share accepted value domains and preserve independent corroborators', () => {
  for (const key of POP_SHAPE_FLAG_KEYS)
    for (const value of [true, false, 0, 1, '0', '1', 'true', 'false']) {
      assert.ok(scanExtForFormatHints({ [key]: value }).length);
      assert.ok(analyzeShape({ ext: { [key]: value } }).some((c) => c.format === 'pop-family'));
    }
  for (const value of [null, undefined, 2, 'yes', {}, []])
    assert.ok(!analyzeShape({ ext: { allowMT: value } }).some((c) => c.format === 'pop-family'));
  const hints = analyzeShape({
    banner: { w: 0, h: 0 },
    instl: 1,
    ext: { sizeID: [0], limit: 1 },
  }).find((c) => c.format === 'pop-family');
  assert.ok(hints && hints.score === 2.5);
});
test('shared price facts retain both legacy diagnostic IDs and their different triggers', () => {
  for (const price of [undefined, null, '1', NaN, Infinity, -1, 0, 1]) {
    for (const paired of [false, true]) {
      const response = /** @type {any} */ (res());
      response.seatbid[0].bid[0].price = price;
      const findings = core.validate(response, paired ? { pairReq: req() } : {}).findings;
      const invalid = typeof price !== 'number' || !Number.isFinite(price);
      assert.equal(
        findings.some((f) => f.id === 'response.bid.price_required'),
        invalid,
      );
      assert.equal(
        findings.some((f) => f.id === 'err-bid-price-negative'),
        invalid || price < 0,
      );
    }
  }
});
test('negative impression and matched deal floors warn and never earn an economic verdict, even filtered', () => {
  for (const r of [req(-1), req(1, [{ id: 'd', bidfloor: -2 }])]) {
    assert.ok(core.validate(r).findings.some((f) => f.id === 'floor.negative'));
    assert.equal(
      economic(r, res(2, 'd'), { disabledRules: ['floor.negative'], strictness: 'lenient' }).length,
      0,
    );
    assert.ok(
      !core
        .validate(res(0, 'd'), { pairReq: r })
        .findings.some((f) => f.id === 'err-bid-price-below-floor'),
    );
  }
  assert.equal(economic(req(0), res(0)).length, 1);
  assert.equal(economic(req(1, [{ id: 'd', bidfloor: 0 }]), res(0, 'd')).length, 1);
  assert.equal(economic(req(1, [{ id: 'd', bidfloor: -2 }]), res(2, 'other')).length, 1);
  assert.ok(
    core
      .validate(req(1, [{ id: 'd', bidfloor: -2 }]))
      .findings.some((f) => f.id === 'floor.negative' && f.path === 'imp[0].pmp.deals[0].bidfloor'),
  );
});
const root = path.join(__dirname, '..');
for (const [moduleName, exportName, family, payload] of [
  ['rules-request', 'validateRequest', 'request.2x', { id: 'q', imp: [{ id: 'i' }], tmax: -1 }],
  [
    'rules-request-30',
    'validateRequest30',
    'request.3.0',
    { openrtb: { ver: '3.0', request: { id: 'q', item: [{ id: 'i' }], tmax: -1 } } },
  ],
  ['rules-response', 'validateResponse', 'response.2x', res(-1)],
  [
    'rules-response-30',
    'validateResponse30',
    'response.3.0',
    {
      openrtb: {
        ver: '3.0',
        response: { id: 'q', seatbid: [{ bid: [{ id: 'b', item: 'i', price: -1 }] }] },
      },
    },
  ],
])
  test(`family containment: ${family} preserves other checks and unfiltered completeness`, () => {
    const script = `const m=require('./packages/core/${moduleName}');m.${exportName}=()=>{throw new Error('PRIVATE-PAYLOAD')}; const c=require('./packages/core'); const p=${JSON.stringify(payload)};process.stdout.write(JSON.stringify([c.validate(p),c.validate(p,{disabledRules:['*']})]));`;
    const [normal, filtered] = JSON.parse(
      execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' }),
    );
    assert.deepEqual(normal.completeness, { complete: false, failedFamilies: [family] });
    assert.ok(normal.findings.some((f) => f.id === 'internal.rule_family_failed'));
    assert.ok(normal.findings.some((f) => f.id !== 'internal.rule_family_failed'));
    assert.deepEqual(filtered.completeness, normal.completeness);
    assert.equal(filtered.status, 'warnings');
    assert.equal(filtered.findings.length, 0);
    assert.ok(!JSON.stringify([normal, filtered]).includes('PRIVATE-PAYLOAD'));
  });
for (const method of ['applies', 'validate'])
  test(`plugin ${method} faults are visible without leaking exception text`, () => {
    const script = `const p=require('./packages/core/rules/imp-secure');p.${method}=()=>{throw new Error('PRIVATE-PAYLOAD')};const c=require('./packages/core');process.stdout.write(JSON.stringify(c.validate({id:'q',imp:[{id:'i'}],tmax:-1})));`;
    const result = JSON.parse(
      execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' }),
    );
    assert.deepEqual(result.completeness, {
      complete: false,
      failedFamilies: ['plugin.imp-secure'],
    });
    assert.ok(result.findings.some((f) => f.id === 'internal.rule_family_failed'));
    assert.ok(result.findings.some((f) => f.id === 'err-tmax-invalid'));
    assert.ok(!JSON.stringify(result).includes('PRIVATE-PAYLOAD'));
  });

test('3.0 negative original matched-deal floor veto is exact and preserves positive-deal eligibility', () => {
  const request = (floor) => ({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'q',
        item: [
          {
            id: 'i',
            flr: 1,
            deal: [{ id: 'd', flr: floor }],
            spec: { placement: { display: { w: 300, h: 250 } } },
          },
        ],
      },
    },
  });
  const response = (deal) => ({
    openrtb: {
      ver: '3.0',
      response: {
        id: 'q',
        seatbid: [
          {
            bid: [{ item: 'i', deal, price: 2, media: { display: { adm: 'x', w: 300, h: 250 } } }],
          },
        ],
      },
    },
  });
  assert.ok(
    core
      .validate(request(-2))
      .findings.some(
        (f) => f.id === 'floor.negative' && f.path === 'openrtb.request.item[0].deal[0].flr',
      ),
  );
  assert.equal(economic(request(-2), response('d')).length, 0);
  assert.ok(
    core
      .crosscheck(request(-2), response('d'))
      .some(
        (f) =>
          f.id === 'crosscheck.bid.no_floor_set' &&
          f.path === 'openrtb.request.item[0].deal[0].flr',
      ),
  );
  assert.equal(economic(request(-2), response('other')).length, 1);
  assert.ok(economic(request(5), response('d')).some((f) => f.id === 'crosscheck.bid.above_floor'));
});

test('multiple failed families stay sorted, private and visible under lax filtering in every locale', () => {
  const script = `require('./packages/core/rules-request').validateRequest=()=>{throw new Error('PRIVATE')};require('./packages/core/rules/tmax').validate=()=>{throw new Error('PRIVATE')};const core=require('./packages/core');const p={id:'q',imp:[{id:'i'}]};process.stdout.write(JSON.stringify(['uk','en','ru'].map(locale=>[core.validate(p,{locale}),core.validate(p,{locale,strictness:'lax'})])));`;
  const results = JSON.parse(
    execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' }),
  );
  for (const [normal, lax] of results) {
    assert.deepEqual(lax.completeness, {
      complete: false,
      failedFamilies: ['plugin.tmax', 'request.2x'],
    });
    assert.equal(lax.status, 'warnings');
    assert.ok(!lax.findings.some((f) => f.id === 'internal.rule_family_failed'));
    const warning = normal.findings.find((f) => f.id === 'internal.rule_family_failed');
    assert.equal(warning.level, 'warning');
    assert.ok(warning.specRef);
    assert.ok(!warning.msg.includes('internal.rule_family_failed'));
    assert.ok(!JSON.stringify(normal).includes('PRIVATE'));
  }
});

test('feed aliases and mixed material dispatch preserve existing vendor precedence', () => {
  const both = core.validate({ bid: 1, redirecturl: 42, redirect_url: 'https://example.test/' });
  assert.ok(
    both.findings.some(
      (f) => f.id === 'feed.bidredirect.redirecturl_required' && f.path === 'redirecturl',
    ),
  );
  const native = {
    url: 'https://example.test/',
    image: 'https://example.test/i.png',
    cpc: 1,
    title: 'Native',
    ext: { format: 'inpage' },
  };
  assert.equal(core.validate(native).type, 'Native-Materials Feed Response (single)');
  const mixed = core.validate([
    native,
    { bid_price: 1, link: 'x', notification_url: 'x', title: 'Push', icon: 'x' },
    {
      id: 'i',
      clickurl: 'x',
      price: 1,
      title: 'Card',
      image: 'x',
      icon: 'x',
      impurl: 42,
      ext: { format: 'inpage' },
    },
  ]);
  assert.deepEqual(
    mixed.findings.map((f) => [f.id, f.path]),
    [['feed.inpage.field_invalid', '[2].impurl']],
  );
});
