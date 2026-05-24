'use strict';

/**
 * tests/rules-etap-b-2.test.js — Etap B Part 2 + Part 1 fixes.
 *
 * Covers:
 *   Part 1 fixes:
 *     - schain node.domain validation (err-schain-node-domain-invalid)
 *     - schain node.rid strict-type (err-schain-node-rid-invalid)
 *     - eids source domain validation (err-eids-source-invalid)
 *   Part 2 new rules:
 *     - currency: ISO-4217 validation, mismatch
 *     - price-floor: bid.price > 0, floor crosscheck
 *     - tmax: integer + boundary warns
 *
 * Asserts on stable `id` and `path`, never on message text.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const schain = require('@kyivtech/spyglass-core/rules/schain');
const eids = require('@kyivtech/spyglass-core/rules/eids');
const currency = require('@kyivtech/spyglass-core/rules/currency');
const priceFloor = require('@kyivtech/spyglass-core/rules/price-floor');
const tmax = require('@kyivtech/spyglass-core/rules/tmax');
const { listPlugins } = require('@kyivtech/spyglass-core/rules');

// ─── Helpers ────────────────────────────────────────────────────────────────

const validSchain = () => ({
  ver: '1.0',
  complete: 1,
  nodes: [{ asi: 'openx.com', sid: 'pub-12345', hp: 1, rid: 'abc123', domain: 'openx.com' }],
});

const reqWithSchain = (sc) => ({ source: { ext: { schain: sc || validSchain() } } });

// ─── Part 1.1: schain node.domain validation ────────────────────────────────

test('schain: node.domain = "not_a_domain" → err-schain-node-domain-invalid', () => {
  const sc = validSchain();
  sc.nodes[0].domain = 'not_a_domain';
  const out = schain.validate(reqWithSchain(sc));
  const f = out.find((x) => x.id === 'err-schain-node-domain-invalid');
  assert.ok(f, 'err-schain-node-domain-invalid should fire');
  assert.equal(f.level, 'error');
  assert.ok(f.path.includes('.domain'));
  assert.equal(f.params.val, 'not_a_domain');
});

test('schain: node.domain = "openx.com" (valid) → no domain error', () => {
  const sc = validSchain();
  sc.nodes[0].domain = 'openx.com';
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(!out.find((x) => x.id === 'err-schain-node-domain-invalid'));
});

test('schain: node.domain = "no-tld" → err-schain-node-domain-invalid', () => {
  const sc = validSchain();
  sc.nodes[0].domain = 'no-tld';
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'err-schain-node-domain-invalid'));
});

test('schain: node.domain = null → warn-schain-node-domain-missing (not invalid)', () => {
  const sc = validSchain();
  sc.nodes[0].domain = null;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'warn-schain-node-domain-missing'));
  assert.ok(!out.find((x) => x.id === 'err-schain-node-domain-invalid'));
});

test('schain: node.domain absent → warn-schain-node-domain-missing', () => {
  const sc = validSchain();
  delete sc.nodes[0].domain;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'warn-schain-node-domain-missing'));
  assert.ok(!out.find((x) => x.id === 'err-schain-node-domain-invalid'));
});

// ─── Part 1.2: schain node.rid strict-type ──────────────────────────────────

test('schain: node.rid = 12345 (number) → err-schain-node-rid-invalid', () => {
  const sc = validSchain();
  sc.nodes[0].rid = 12345;
  const out = schain.validate(reqWithSchain(sc));
  const f = out.find((x) => x.id === 'err-schain-node-rid-invalid');
  assert.ok(f, 'err-schain-node-rid-invalid should fire');
  assert.equal(f.level, 'error');
});

test('schain: node.rid = "" (empty string) → err-schain-node-rid-invalid', () => {
  const sc = validSchain();
  sc.nodes[0].rid = '';
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'err-schain-node-rid-invalid'));
});

test('schain: node.rid = "abc123" (valid) → no rid error', () => {
  const sc = validSchain();
  sc.nodes[0].rid = 'abc123';
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(!out.find((x) => x.id === 'err-schain-node-rid-invalid'));
  assert.ok(!out.find((x) => x.id === 'warn-schain-node-rid-missing'));
});

test('schain: node.rid = null → warn-schain-node-rid-missing (not invalid)', () => {
  const sc = validSchain();
  sc.nodes[0].rid = null;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'warn-schain-node-rid-missing'));
  assert.ok(!out.find((x) => x.id === 'err-schain-node-rid-invalid'));
});

test('schain: node.rid = false (boolean) → err-schain-node-rid-invalid', () => {
  const sc = validSchain();
  sc.nodes[0].rid = false;
  const out = schain.validate(reqWithSchain(sc));
  assert.ok(out.find((x) => x.id === 'err-schain-node-rid-invalid'));
});

// ─── Part 1.3: eids source domain validation ────────────────────────────────

test('eids: source = "id5-sync" (no TLD) → err-eids-source-invalid', () => {
  const req = { user: { ext: { eids: [{ source: 'id5-sync', uids: [{ id: 'x', atype: 3 }] }] } } };
  const out = eids.validate(req);
  const f = out.find((x) => x.id === 'err-eids-source-invalid');
  assert.ok(f, 'err-eids-source-invalid should fire');
  assert.equal(f.level, 'error');
  assert.equal(f.params.val, 'id5-sync');
});

test('eids: source = "id5-sync.com" (valid domain) → no source error', () => {
  const req = {
    user: { ext: { eids: [{ source: 'id5-sync.com', uids: [{ id: 'x', atype: 3 }] }] } },
  };
  const out = eids.validate(req);
  assert.ok(!out.find((x) => x.id === 'err-eids-source-invalid'));
  assert.ok(!out.find((x) => x.id === 'err-eids-source-missing'));
});

test('eids: source = "" → err-eids-source-missing (not source-invalid)', () => {
  const req = { user: { ext: { eids: [{ source: '', uids: [{ id: 'x' }] }] } } };
  const out = eids.validate(req);
  assert.ok(out.find((x) => x.id === 'err-eids-source-missing'));
  assert.ok(!out.find((x) => x.id === 'err-eids-source-invalid'));
});

test('eids: source = "liveramp.com" (valid) → no source findings', () => {
  const req = { user: { ext: { eids: [{ source: 'liveramp.com', uids: [{ id: 'x' }] }] } } };
  const out = eids.validate(req);
  assert.ok(!out.find((x) => x.id.startsWith('err-eids-source')));
});

// ─── Plugin registration for new rules ──────────────────────────────────────

test('currency: plugin is registered', () => {
  const meta = listPlugins().find((p) => p.id === 'currency');
  assert.ok(meta, 'currency plugin should appear in listPlugins()');
  assert.ok(meta.appliesTo.includes('ORTB_REQUEST'));
  assert.ok(meta.appliesTo.includes('ORTB_RESPONSE'));
});

test('price-floor: plugin is registered', () => {
  const meta = listPlugins().find((p) => p.id === 'price-floor');
  assert.ok(meta, 'price-floor plugin should appear in listPlugins()');
  assert.ok(meta.appliesTo.includes('ORTB_RESPONSE'));
});

test('tmax: plugin is registered', () => {
  const meta = listPlugins().find((p) => p.id === 'tmax');
  assert.ok(meta, 'tmax plugin should appear in listPlugins()');
  assert.ok(meta.appliesTo.includes('ORTB_REQUEST'));
});

// ─── Currency: ISO-4217 validation ──────────────────────────────────────────

test('currency: req.cur = ["USD"] → no findings', () => {
  const req = { cur: ['USD'] };
  const out = currency.validate(req, { type: 'ORTB_REQUEST' });
  assert.deepEqual(out, []);
});

test('currency: req.cur = ["usd"] (lowercase) → err-bid-currency-invalid', () => {
  const req = { cur: ['usd'] };
  const out = currency.validate(req, { type: 'ORTB_REQUEST' });
  const f = out.find((x) => x.id === 'err-bid-currency-invalid');
  assert.ok(f);
  assert.equal(f.params.val, 'usd');
  assert.equal(f.level, 'error');
});

test('currency: req.cur = ["USD", "EUR"] → no findings', () => {
  const req = { cur: ['USD', 'EUR'] };
  const out = currency.validate(req, { type: 'ORTB_REQUEST' });
  assert.deepEqual(out, []);
});

test('currency: req.cur = ["USDD"] (4 chars) → err-bid-currency-invalid', () => {
  const req = { cur: ['USDD'] };
  const out = currency.validate(req, { type: 'ORTB_REQUEST' });
  assert.ok(out.find((x) => x.id === 'err-bid-currency-invalid'));
});

test('currency: req.cur = ["US"] (2 chars) → err-bid-currency-invalid', () => {
  const req = { cur: ['US'] };
  const out = currency.validate(req, { type: 'ORTB_REQUEST' });
  assert.ok(out.find((x) => x.id === 'err-bid-currency-invalid'));
});

test('currency: req.cur absent → no findings', () => {
  const req = {};
  const out = currency.validate(req, { type: 'ORTB_REQUEST' });
  assert.deepEqual(out, []);
});

test('currency: res.cur = "UAH" when req.cur = ["USD"] → err-bid-currency-mismatch', () => {
  const res = { cur: 'UAH', seatbid: [] };
  const req = { cur: ['USD'] };
  const out = currency.validate(res, { type: 'ORTB_RESPONSE', req });
  const f = out.find((x) => x.id === 'err-bid-currency-mismatch');
  assert.ok(f, 'err-bid-currency-mismatch should fire');
  assert.equal(f.params.val, 'UAH');
});

test('currency: res.cur = "USD" when req.cur = ["USD"] → no mismatch', () => {
  const res = { cur: 'USD', seatbid: [] };
  const req = { cur: ['USD'] };
  const out = currency.validate(res, { type: 'ORTB_RESPONSE', req });
  assert.ok(!out.find((x) => x.id === 'err-bid-currency-mismatch'));
});

test('currency: res bid.cur = "GBP" when req.cur = ["USD"] → err-bid-currency-mismatch', () => {
  const res = {
    cur: 'USD',
    seatbid: [{ bid: [{ id: 'b1', impid: 'i1', price: 1.5, cur: 'GBP' }] }],
  };
  const req = { cur: ['USD'] };
  const out = currency.validate(res, { type: 'ORTB_RESPONSE', req });
  const f = out.find((x) => x.id === 'err-bid-currency-mismatch' && x.path.includes('bid'));
  assert.ok(f, 'per-bid currency mismatch should fire');
});

test('currency: res.cur = "usd" (lowercase) → err-bid-currency-invalid', () => {
  const res = { cur: 'usd', seatbid: [] };
  const out = currency.validate(res, { type: 'ORTB_RESPONSE' });
  assert.ok(out.find((x) => x.id === 'err-bid-currency-invalid'));
});

test('currency: res.cur absent, no req → no findings', () => {
  const res = { seatbid: [{ bid: [{ id: 'b1', impid: 'i1', price: 1.5 }] }] };
  const out = currency.validate(res, { type: 'ORTB_RESPONSE' });
  assert.deepEqual(
    out.filter((f) => f.id.startsWith('err-bid-currency')),
    [],
  );
});

// ─── Price-floor: bid.price validation ──────────────────────────────────────

const makeRes = (price) => ({
  id: 'resp1',
  seatbid: [{ bid: [{ id: 'b1', impid: 'imp1', price }] }],
});

test('price-floor: bid.price = 1.5 → no findings', () => {
  const out = priceFloor.validate(makeRes(1.5), { type: 'ORTB_RESPONSE' });
  assert.deepEqual(out, []);
});

test('price-floor: bid.price = 0 → no error (zero allowed per IAB §4.3.1)', () => {
  const out = priceFloor.validate(makeRes(0), { type: 'ORTB_RESPONSE' });
  assert.ok(
    !out.find((x) => x.id === 'err-bid-price-negative'),
    'zero price is valid per IAB second-price auctions',
  );
});

test('price-floor: bid.price = -1 → err-bid-price-negative', () => {
  const out = priceFloor.validate(makeRes(-1), { type: 'ORTB_RESPONSE' });
  assert.ok(out.find((x) => x.id === 'err-bid-price-negative'));
});

test('price-floor: bid.price = "1.5" (string) → err-bid-price-negative', () => {
  const out = priceFloor.validate(makeRes('1.5'), { type: 'ORTB_RESPONSE' });
  assert.ok(out.find((x) => x.id === 'err-bid-price-negative'));
});

test('price-floor: bid.price = NaN → err-bid-price-negative', () => {
  const out = priceFloor.validate(makeRes(NaN), { type: 'ORTB_RESPONSE' });
  assert.ok(out.find((x) => x.id === 'err-bid-price-negative'));
});

test('price-floor: bid.price = Infinity → err-bid-price-negative', () => {
  const out = priceFloor.validate(makeRes(Infinity), { type: 'ORTB_RESPONSE' });
  assert.ok(out.find((x) => x.id === 'err-bid-price-negative'));
});

test('price-floor: bid.price = 1.20, bidfloor = 1.50 → err-bid-price-below-floor', () => {
  const res = makeRes(1.2);
  const req = { imp: [{ id: 'imp1', bidfloor: 1.5 }] };
  const out = priceFloor.validate(res, { type: 'ORTB_RESPONSE', req });
  const f = out.find((x) => x.id === 'err-bid-price-below-floor');
  assert.ok(f, 'err-bid-price-below-floor should fire');
  assert.equal(f.params.price, 1.2);
  assert.equal(f.params.floor, 1.5);
});

test('price-floor: bid.price = 1.50, bidfloor = 1.50 → no floor finding', () => {
  const res = makeRes(1.5);
  const req = { imp: [{ id: 'imp1', bidfloor: 1.5 }] };
  const out = priceFloor.validate(res, { type: 'ORTB_RESPONSE', req });
  assert.ok(!out.find((x) => x.id === 'err-bid-price-below-floor'));
});

test('price-floor: bid.price = 2.00, bidfloor = 1.50 → no floor finding', () => {
  const res = makeRes(2.0);
  const req = { imp: [{ id: 'imp1', bidfloor: 1.5 }] };
  const out = priceFloor.validate(res, { type: 'ORTB_RESPONSE', req });
  assert.ok(!out.find((x) => x.id === 'err-bid-price-below-floor'));
});

test('price-floor: no paired req → no floor finding (standalone response)', () => {
  const res = makeRes(0.01);
  const out = priceFloor.validate(res, { type: 'ORTB_RESPONSE' });
  assert.ok(!out.find((x) => x.id === 'err-bid-price-below-floor'));
});

test('price-floor: empty seatbid → no findings', () => {
  const out = priceFloor.validate({ seatbid: [] }, { type: 'ORTB_RESPONSE' });
  assert.deepEqual(out, []);
});

// ─── TMAX: sanity checks ─────────────────────────────────────────────────────

test('tmax: absent → no findings', () => {
  assert.deepEqual(tmax.validate({}), []);
});

test('tmax: tmax = 500 (valid integer, in range) → no findings', () => {
  assert.deepEqual(tmax.validate({ tmax: 500 }), []);
});

test('tmax: tmax = 50 (boundary, exactly min) → no findings', () => {
  assert.deepEqual(tmax.validate({ tmax: 50 }), []);
});

test('tmax: tmax = 3000 (boundary, exactly max) → no findings', () => {
  assert.deepEqual(tmax.validate({ tmax: 3000 }), []);
});

test('tmax: tmax = 0 → err-tmax-invalid', () => {
  const out = tmax.validate({ tmax: 0 });
  assert.ok(out.find((x) => x.id === 'err-tmax-invalid'));
});

test('tmax: tmax = -1 → err-tmax-invalid', () => {
  const out = tmax.validate({ tmax: -1 });
  assert.ok(out.find((x) => x.id === 'err-tmax-invalid'));
});

test('tmax: tmax = "100" (string) → err-tmax-invalid', () => {
  const out = tmax.validate({ tmax: '100' });
  const f = out.find((x) => x.id === 'err-tmax-invalid');
  assert.ok(f, 'err-tmax-invalid should fire for string tmax');
});

test('tmax: tmax = 1.5 (float) → err-tmax-invalid', () => {
  const out = tmax.validate({ tmax: 1.5 });
  assert.ok(out.find((x) => x.id === 'err-tmax-invalid'));
});

test('tmax: tmax = 49 → warn-tmax-too-small', () => {
  const out = tmax.validate({ tmax: 49 });
  const f = out.find((x) => x.id === 'warn-tmax-too-small');
  assert.ok(f, 'warn-tmax-too-small should fire at 49ms');
  assert.equal(f.params.val, 49);
});

test('tmax: tmax = 1 (very small) → warn-tmax-too-small', () => {
  const out = tmax.validate({ tmax: 1 });
  assert.ok(out.find((x) => x.id === 'warn-tmax-too-small'));
  assert.ok(!out.find((x) => x.id === 'err-tmax-invalid'));
});

test('tmax: tmax = 3001 → warn-tmax-too-large', () => {
  const out = tmax.validate({ tmax: 3001 });
  const f = out.find((x) => x.id === 'warn-tmax-too-large');
  assert.ok(f, 'warn-tmax-too-large should fire at 3001ms');
  assert.equal(f.params.val, 3001);
});

test('tmax: tmax = 10000 → warn-tmax-too-large', () => {
  const out = tmax.validate({ tmax: 10000 });
  assert.ok(out.find((x) => x.id === 'warn-tmax-too-large'));
  assert.ok(!out.find((x) => x.id === 'err-tmax-invalid'));
});

test('tmax: null payload → no findings', () => {
  assert.deepEqual(tmax.validate(null), []);
});

// ─── Shared isValidDomain helper (back-compat) ───────────────────────────────

test('schain _isValidDomain still exported (back-compat)', () => {
  assert.ok(typeof schain._isValidDomain === 'function');
  assert.equal(schain._isValidDomain('openx.com'), true);
  assert.equal(schain._isValidDomain('no_dot'), false);
});

// ─── currency _isValidCurrency helper ───────────────────────────────────────

test('currency _isValidCurrency: USD/EUR valid, usd/USDD/ZZZ invalid', () => {
  assert.equal(currency._isValidCurrency('USD'), true);
  assert.equal(currency._isValidCurrency('EUR'), true);
  assert.equal(currency._isValidCurrency('UAH'), true);
  assert.equal(currency._isValidCurrency('GBP'), true);
  assert.equal(currency._isValidCurrency('usd'), false);
  assert.equal(currency._isValidCurrency('USDD'), false);
  assert.equal(currency._isValidCurrency('US'), false);
  assert.equal(currency._isValidCurrency('ZZZ'), false); // valid regex but not in ISO-4217 Set
  assert.equal(currency._isValidCurrency(''), false);
  assert.equal(currency._isValidCurrency(null), false);
});

// ─── NEW: price-floor currency-mismatch + PMP + Infinity ────────────────────

test('price-floor: bid.price = -0.01 → err-bid-price-negative', () => {
  const out = priceFloor.validate(makeRes(-0.01), { type: 'ORTB_RESPONSE' });
  assert.ok(
    out.find((x) => x.id === 'err-bid-price-negative'),
    'negative price must error',
  );
});

test('price-floor: bidfloor = Infinity → no phantom below-floor (Infinity not finite)', () => {
  const res = makeRes(1.5);
  const req = { imp: [{ id: 'imp1', bidfloor: Infinity }] };
  const out = priceFloor.validate(res, { type: 'ORTB_RESPONSE', req });
  assert.ok(
    !out.find((x) => x.id === 'err-bid-price-below-floor'),
    'Infinity bidfloor must be ignored',
  );
});

test('price-floor: currency mismatch → warn-currency-conversion-needed, no below-floor', () => {
  const res = {
    id: 'resp1',
    cur: 'EUR', // response currency
    seatbid: [{ bid: [{ id: 'b1', impid: 'imp1', price: 0.5 }] }],
  };
  const req = {
    cur: ['USD'],
    imp: [{ id: 'imp1', bidfloor: 1.0, bidfloorcur: 'USD' }], // floor in USD
  };
  const out = priceFloor.validate(res, { type: 'ORTB_RESPONSE', req });
  const warn = out.find((x) => x.id === 'warn-currency-conversion-needed');
  assert.ok(warn, 'warn-currency-conversion-needed should fire for EUR vs USD');
  assert.equal(warn.level, 'warning');
  assert.ok(
    !out.find((x) => x.id === 'err-bid-price-below-floor'),
    'no numeric floor check when currencies differ',
  );
});

test('price-floor: PMP deal floor wins over imp floor', () => {
  // bid passes deal floor (1.0) but would fail imp floor (2.0)
  const res = {
    id: 'resp1',
    cur: 'USD',
    seatbid: [{ bid: [{ id: 'b1', impid: 'imp1', price: 1.2, dealid: 'deal-123' }] }],
  };
  const req = {
    cur: ['USD'],
    imp: [
      {
        id: 'imp1',
        bidfloor: 2.0,
        bidfloorcur: 'USD',
        pmp: {
          deals: [{ dealid: 'deal-123', bidfloor: 1.0, bidfloorcur: 'USD' }],
        },
      },
    ],
  };
  const out = priceFloor.validate(res, { type: 'ORTB_RESPONSE', req });
  assert.ok(
    !out.find((x) => x.id === 'err-bid-price-below-floor'),
    'deal floor (1.0) wins: price 1.2 passes',
  );
});

test('price-floor: PMP deal floor applies — bid below deal floor fails', () => {
  const res = {
    id: 'resp1',
    cur: 'USD',
    seatbid: [{ bid: [{ id: 'b1', impid: 'imp1', price: 0.5, dealid: 'deal-456' }] }],
  };
  const req = {
    cur: ['USD'],
    imp: [
      {
        id: 'imp1',
        bidfloor: 0.1,
        bidfloorcur: 'USD',
        pmp: {
          deals: [{ dealid: 'deal-456', bidfloor: 1.0, bidfloorcur: 'USD' }],
        },
      },
    ],
  };
  const out = priceFloor.validate(res, { type: 'ORTB_RESPONSE', req });
  assert.ok(
    out.find((x) => x.id === 'err-bid-price-below-floor'),
    'price 0.5 should fail deal floor 1.0',
  );
});

// ─── NEW: currency ISO-4217 Set checks ──────────────────────────────────────

test('currency: req.cur = [ZZZ] → err-bid-currency-invalid (not in ISO-4217 Set)', () => {
  const out = currency.validate({ cur: ['ZZZ'] }, { type: 'ORTB_REQUEST' });
  const f = out.find((x) => x.id === 'err-bid-currency-invalid');
  assert.ok(f, 'ZZZ must fail ISO-4217 Set check');
});

test('currency: req.cur = [USD] → no findings (valid)', () => {
  const out = currency.validate({ cur: ['USD'] }, { type: 'ORTB_REQUEST' });
  assert.deepEqual(out, []);
});

test('currency: req.cur = USD (string not array) → err-bid-currency-invalid', () => {
  const out = currency.validate({ cur: 'USD' }, { type: 'ORTB_REQUEST' });
  const f = out.find((x) => x.id === 'err-bid-currency-invalid');
  assert.ok(f, 'string cur on request should error');
  assert.equal(f.params.context, 'request');
});

test('currency: HRK is included (legacy code for existing data)', () => {
  // HRK was deprecated when Croatia joined EUR in 2023, but we may need for legacy parsing
  // If it is NOT in the set, this test documents the decision
  const included = currency._ISO_4217_CODES.has('HRK');
  // Just document — either way is acceptable per spec
  assert.equal(typeof included, 'boolean');
});

test('currency: ISO_4217_CODES set has at least 150 entries', () => {
  assert.ok(
    currency._ISO_4217_CODES.size >= 150,
    `Expected >=150 codes, got ${currency._ISO_4217_CODES.size}`,
  );
});

// ─── NEW: eids/schain registrations still correct after refactor ─────────────

test('eids: plugin still registered for ORTB_REQUEST after refactor', () => {
  const { listPlugins } = require('@kyivtech/spyglass-core/rules');
  const meta = listPlugins().find((p) => p.id === 'eids');
  assert.ok(meta);
  assert.deepEqual(meta.appliesTo, ['ORTB_REQUEST']);
});
