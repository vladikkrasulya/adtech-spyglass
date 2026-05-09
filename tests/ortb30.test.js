'use strict';

/**
 * oRTB 3.0 routing + envelope validation.
 *
 * Tests organized in three layers:
 *   - detect: detectVersion / detectType pick the 3.0 path even when the
 *     envelope is partially broken
 *   - unit: validateRequest30() called directly for fast structural checks
 *   - integration: validate() over a full payload exercises the dispatch
 *     in index.js (3.0 → validateRequest30, 2.x → validateRequest)
 *   - sample-integrity: the demo dropdown samples can't silently rot
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  validate,
  detectType,
  detectVersion,
  TYPES,
  VERSIONS,
} = require('@kyivtech/spyglass-core');
const { validateRequest30 } = require('../packages/core/rules-request-30');
const { validateResponse30 } = require('../packages/core/rules-response-30');

const findById = (findings, id) => findings.find((f) => f.id === id);

// ─────────────────────────────────────────────────────────────────
// detect: 3.0 envelope detection
// ─────────────────────────────────────────────────────────────────

test('detectVersion: minimal 3.0 envelope is V_3_0 confidence 1', () => {
  const v = detectVersion({ openrtb: { ver: '3.0', request: { id: 'r1', item: [] } } });
  assert.equal(v.version, VERSIONS.V_3_0);
  assert.equal(v.confidence, 1);
});

test('detectVersion: BROKEN 3.0 envelope (empty ver) still detects as 3.0', () => {
  const v = detectVersion({ openrtb: { ver: '' } });
  assert.equal(v.version, VERSIONS.V_3_0);
  assert.ok(v.signals.includes('openrtb'));
});

test('detectVersion: broken 3.0 envelope (no ver at all) still detects as 3.0', () => {
  const v = detectVersion({ openrtb: { request: {} } });
  assert.equal(v.version, VERSIONS.V_3_0);
});

test('detectVersion: top-level item[] alone (no openrtb) detects as 3.0', () => {
  const v = detectVersion({ item: [{ id: '1' }] });
  assert.equal(v.version, VERSIONS.V_3_0);
  assert.ok(v.signals.includes('item[]'));
});

test('detectType: 3.0 envelope routes through ORTB_REQUEST type', () => {
  assert.equal(detectType({ openrtb: { ver: '3.0', request: {} } }), TYPES.ORTB_REQUEST);
  assert.equal(detectType({ openrtb: {} }), TYPES.ORTB_REQUEST);
  assert.equal(detectType({ item: [] }), TYPES.ORTB_REQUEST);
});

// ─────────────────────────────────────────────────────────────────
// validateRequest30() — unit
// ─────────────────────────────────────────────────────────────────

test('validateRequest30: missing openrtb envelope → envelope_required + early return', () => {
  const f = validateRequest30({ id: 'r1', imp: [] });
  assert.ok(findById(f, 'request.30.envelope_required'));
  assert.ok(findById(f, 'request.30.deep_validation_limited'));
});

test('validateRequest30: missing ver → ver_required', () => {
  const f = validateRequest30({ openrtb: { request: { id: 'r1', item: [{ id: '1', spec: {} }], context: {} } } });
  assert.ok(findById(f, 'request.30.ver_required'));
  assert.equal(findById(f, 'request.30.ver_required').level, 'error');
});

test('validateRequest30: ver = "2.5" → ver_invalid', () => {
  const f = validateRequest30({ openrtb: { ver: '2.5', request: { id: 'r', item: [{ id: '1', spec: {} }], context: {} } } });
  const m = findById(f, 'request.30.ver_invalid');
  assert.ok(m);
  assert.equal(m.params.ver, '2.5');
});

test('validateRequest30: ver = "3.1" passes (any 3.x is valid)', () => {
  const f = validateRequest30({ openrtb: { ver: '3.1', request: { id: 'r', item: [{ id: '1', spec: {} }], context: {} } } });
  assert.equal(findById(f, 'request.30.ver_invalid'), undefined);
});

test('validateRequest30: missing openrtb.request → request_required + early return', () => {
  const f = validateRequest30({ openrtb: { ver: '3.0' } });
  assert.ok(findById(f, 'request.30.request_required'));
});

test('validateRequest30: missing request.id → id_required', () => {
  const f = validateRequest30({ openrtb: { ver: '3.0', request: { item: [{ id: '1', spec: {} }], context: {} } } });
  assert.ok(findById(f, 'request.30.id_required'));
});

test('validateRequest30: empty item[] → item_required', () => {
  const f = validateRequest30({ openrtb: { ver: '3.0', request: { id: 'r', item: [], context: {} } } });
  assert.ok(findById(f, 'request.30.item_required'));
});

test('validateRequest30: missing context → context_recommended WARN', () => {
  const f = validateRequest30({ openrtb: { ver: '3.0', request: { id: 'r', item: [{ id: '1', spec: {} }] } } });
  const m = findById(f, 'request.30.context_recommended');
  assert.ok(m);
  assert.equal(m.level, 'warning');
});

test('validateRequest30: per-item id missing + spec missing → both fire', () => {
  const f = validateRequest30({ openrtb: { ver: '3.0', request: { id: 'r', item: [{}], context: {} } } });
  assert.ok(findById(f, 'request.30.item.id_required'));
  assert.ok(findById(f, 'request.30.item.spec_required'));
});

test('validateRequest30: item.qty = 0 → qty_invalid WARN', () => {
  const f = validateRequest30({ openrtb: { ver: '3.0', request: { id: 'r', item: [{ id: '1', qty: 0, spec: {} }], context: {} } } });
  const m = findById(f, 'request.30.item.qty_invalid');
  assert.ok(m);
  assert.equal(m.params.qty, 0);
});

test('validateRequest30: item.qty absent does NOT fire qty_invalid (defaults to 1 per spec)', () => {
  const f = validateRequest30({ openrtb: { ver: '3.0', request: { id: 'r', item: [{ id: '1', spec: {} }], context: {} } } });
  assert.equal(findById(f, 'request.30.item.qty_invalid'), undefined);
});

test('validateRequest30: well-formed envelope fires only deep_validation_limited INFO', () => {
  const f = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: {} }],
        context: { site: { id: 's1' } },
      },
    },
  });
  assert.equal(f.length, 1);
  assert.equal(f[0].id, 'request.30.deep_validation_limited');
  assert.equal(f[0].level, 'info');
});

// ─────────────────────────────────────────────────────────────────
// integration through validate() — version dispatch
// ─────────────────────────────────────────────────────────────────

test('validate(): 3.0 payload routes to validateRequest30 (NOT to 2.x rules)', () => {
  const r = validate({ openrtb: { ver: '3.0', request: { id: 'r1', item: [{ id: '1', spec: {} }], context: { site: { id: 's1' } } } } });
  // Should NOT see 2.x findings like "imp_required" or "no_site_or_app"
  assert.equal(findById(r.findings, 'request.imp_required'), undefined);
  assert.equal(findById(r.findings, 'request.no_site_or_app'), undefined);
  // SHOULD see the 3.0 INFO note
  assert.ok(findById(r.findings, 'request.30.deep_validation_limited'));
});

test('validate(): 2.x payload still routes to validateRequest (unaffected)', () => {
  // Bare imp[] alone — detectType picks ORTB_REQUEST, detectVersion stays 2.x.
  // Should fire 2.x rules (no_site_or_app, device_required, etc.) NOT 3.0 ones.
  const r = validate({ id: 'r1', imp: [{ id: '1' }] });
  assert.equal(r.version.version, VERSIONS.V_2_5);
  assert.ok(r.findings.some((f) => f.id.startsWith('request.') && !f.id.startsWith('request.30.')));
  // No 3.0 findings on 2.x payloads
  assert.equal(findById(r.findings, 'request.30.deep_validation_limited'), undefined);
});

test('validate(): broken 3.0 envelope produces 3.0-specific findings (not "unknown_type")', () => {
  const r = validate({ openrtb: { ver: '' } });
  assert.equal(r.version.version, VERSIONS.V_3_0);
  assert.equal(findById(r.findings, 'payload.unknown_type'), undefined);
  assert.ok(findById(r.findings, 'request.30.ver_required'));
  assert.ok(findById(r.findings, 'request.30.request_required'));
});

test('validate(): 3.0 findings carry resolved msg via i18n', () => {
  const r = validate({ openrtb: {} }, { locale: 'uk' });
  const f = findById(r.findings, 'request.30.ver_required');
  assert.ok(f);
  assert.ok(f.msg && f.msg.length > 10);
});

test('validate(): 3.0 findings respect disabledRules option', () => {
  const baseline = validate({ openrtb: {} });
  const baselineCount = baseline.findings.filter((f) => f.id.startsWith('request.30.')).length;
  assert.ok(baselineCount > 0);

  const filtered = validate({ openrtb: {} }, { disabledRules: ['request.30.*'] });
  assert.equal(filtered.findings.filter((f) => f.id.startsWith('request.30.')).length, 0);
});

// ─────────────────────────────────────────────────────────────────
// Sample-file integrity
// ─────────────────────────────────────────────────────────────────

test('samples: synthetic-ortb30-clean.json fires only deep_validation_limited INFO', () => {
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-ortb30-clean.json');
  const sample = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const r = validate(sample);
  const errs = r.findings.filter((f) => f.level === 'error');
  const warns = r.findings.filter((f) => f.level === 'warning');
  assert.equal(errs.length, 0);
  assert.equal(warns.length, 0);
  assert.ok(findById(r.findings, 'request.30.deep_validation_limited'));
});

// ─────────────────────────────────────────────────────────────────
// validateResponse30() — unit
// ─────────────────────────────────────────────────────────────────

test('validateResponse30: missing envelope → envelope_required + early return', () => {
  const f = validateResponse30({ id: 'r' });
  assert.ok(findById(f, 'response.30.envelope_required'));
  assert.ok(findById(f, 'response.30.deep_validation_limited'));
});

test('validateResponse30: missing ver → ver_required', () => {
  const f = validateResponse30({ openrtb: { response: { id: 'r' } } });
  assert.ok(findById(f, 'response.30.ver_required'));
});

test('validateResponse30: ver = "2.5" → ver_invalid', () => {
  const f = validateResponse30({ openrtb: { ver: '2.5', response: { id: 'r' } } });
  const m = findById(f, 'response.30.ver_invalid');
  assert.ok(m);
  assert.equal(m.params.ver, '2.5');
});

test('validateResponse30: missing response → response_required', () => {
  const f = validateResponse30({ openrtb: { ver: '3.0' } });
  assert.ok(findById(f, 'response.30.response_required'));
});

test('validateResponse30: missing seatbid AND nbr → seatbid_or_nbr_required ERROR', () => {
  const f = validateResponse30({ openrtb: { ver: '3.0', response: { id: 'r' } } });
  assert.ok(findById(f, 'response.30.seatbid_or_nbr_required'));
});

test('validateResponse30: nbr-only no-bid → response.30.no_bid INFO', () => {
  const f = validateResponse30({ openrtb: { ver: '3.0', response: { id: 'r', nbr: 4 } } });
  const m = findById(f, 'response.30.no_bid');
  assert.ok(m);
  assert.equal(m.level, 'info');
  assert.equal(m.params.nbr, 4);
});

test('validateResponse30: empty seatbid without nbr → seatbid_empty_no_nbr ERROR', () => {
  const f = validateResponse30({ openrtb: { ver: '3.0', response: { id: 'r', seatbid: [] } } });
  assert.ok(findById(f, 'response.30.seatbid_empty_no_nbr'));
});

test('validateResponse30: per-bid id + item + price all required', () => {
  const f = validateResponse30({
    openrtb: { ver: '3.0', response: { id: 'r', seatbid: [{ seat: 's1', bid: [{}] }] } },
  });
  assert.ok(findById(f, 'response.30.bid.id_required'));
  assert.ok(findById(f, 'response.30.bid.item_required'));
  assert.ok(findById(f, 'response.30.bid.price_required'));
});

test('validateResponse30: well-formed response fires only deep_validation_limited INFO', () => {
  const f = validateResponse30({
    openrtb: {
      ver: '3.0',
      response: {
        id: 'r1',
        seatbid: [{ seat: 's1', bid: [{ id: 'b1', item: '1', price: 1.5 }] }],
      },
    },
  });
  assert.equal(f.length, 1);
  assert.equal(f[0].id, 'response.30.deep_validation_limited');
});

// ─────────────────────────────────────────────────────────────────
// integration: 3.0 response routing
// ─────────────────────────────────────────────────────────────────

test('integration: validate() routes 3.0 response to validateResponse30 (not 2.x)', () => {
  const r = validate({ openrtb: { ver: '3.0', response: { id: 'r1', seatbid: [{ seat: 's1', bid: [{ id: 'b1', item: '1', price: 1.5 }] }] } } });
  assert.equal(r.type, 'oRTB BidResponse');
  assert.equal(r.version.version, VERSIONS.V_3_0);
  // Should NOT see 2.x findings like "response.id_required" / "response.seatbid_or_nbr_required"
  assert.equal(findById(r.findings, 'response.seatbid_or_nbr_required'), undefined);
  assert.equal(findById(r.findings, 'response.id_required'), undefined);
  // SHOULD see the 3.0 INFO note
  assert.ok(findById(r.findings, 'response.30.deep_validation_limited'));
});

test('integration: detectType picks RESPONSE for envelope with response{}', () => {
  assert.equal(detectType({ openrtb: { response: {} } }), TYPES.ORTB_RESPONSE);
  // Vs. request with `request{}`
  assert.equal(detectType({ openrtb: { request: {} } }), TYPES.ORTB_REQUEST);
});

test('integration: i18n + sample integrity for 3.0 clean response', () => {
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-ortb30-clean-response.json');
  const sample = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const r = validate(sample, { locale: 'uk' });
  assert.equal(r.type, 'oRTB BidResponse');
  const errs = r.findings.filter((f) => f.level === 'error');
  assert.equal(errs.length, 0);
  const info = findById(r.findings, 'response.30.deep_validation_limited');
  assert.ok(info && info.msg && info.msg.length > 10);
});

test('samples: synthetic-ortb30-broken-envelope.json fires expected ERROR set', () => {
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-ortb30-broken-envelope.json');
  const sample = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const r = validate(sample);
  // The broken sample is missing: ver value, request.id, item[0].id, item[0].spec.
  // Should fire at least 4 ERROR-level rules.
  const errs = r.findings.filter((f) => f.level === 'error');
  assert.ok(errs.length >= 4, `expected ≥4 errors, got ${errs.length}`);
  assert.ok(findById(r.findings, 'request.30.ver_required'));
  assert.ok(findById(r.findings, 'request.30.id_required'));
  assert.ok(findById(r.findings, 'request.30.item.id_required'));
  assert.ok(findById(r.findings, 'request.30.item.spec_required'));
  // qty=0 fires the WARN
  assert.ok(findById(r.findings, 'request.30.item.qty_invalid'));
});
