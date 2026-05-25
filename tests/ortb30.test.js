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

const { validate, detectType, detectVersion, TYPES, VERSIONS } = require('@kyivtech/spyglass-core');
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
  const f = validateRequest30({
    openrtb: { request: { id: 'r1', item: [{ id: '1', spec: {} }], context: {} } },
  });
  assert.ok(findById(f, 'request.30.ver_required'));
  assert.equal(findById(f, 'request.30.ver_required').level, 'error');
});

test('validateRequest30: ver = "2.5" → ver_invalid', () => {
  const f = validateRequest30({
    openrtb: { ver: '2.5', request: { id: 'r', item: [{ id: '1', spec: {} }], context: {} } },
  });
  const m = findById(f, 'request.30.ver_invalid');
  assert.ok(m);
  assert.equal(m.params.ver, '2.5');
});

test('validateRequest30: ver = "3.1" passes (any 3.x is valid)', () => {
  const f = validateRequest30({
    openrtb: { ver: '3.1', request: { id: 'r', item: [{ id: '1', spec: {} }], context: {} } },
  });
  assert.equal(findById(f, 'request.30.ver_invalid'), undefined);
});

test('validateRequest30: missing openrtb.request → request_required + early return', () => {
  const f = validateRequest30({ openrtb: { ver: '3.0' } });
  assert.ok(findById(f, 'request.30.request_required'));
});

test('validateRequest30: missing request.id → id_required', () => {
  const f = validateRequest30({
    openrtb: { ver: '3.0', request: { item: [{ id: '1', spec: {} }], context: {} } },
  });
  assert.ok(findById(f, 'request.30.id_required'));
});

test('validateRequest30: empty item[] → item_required', () => {
  const f = validateRequest30({
    openrtb: { ver: '3.0', request: { id: 'r', item: [], context: {} } },
  });
  assert.ok(findById(f, 'request.30.item_required'));
});

test('validateRequest30: missing context → context_recommended WARN', () => {
  const f = validateRequest30({
    openrtb: { ver: '3.0', request: { id: 'r', item: [{ id: '1', spec: {} }] } },
  });
  const m = findById(f, 'request.30.context_recommended');
  assert.ok(m);
  assert.equal(m.level, 'warning');
});

test('validateRequest30: per-item id missing + spec missing → both fire', () => {
  const f = validateRequest30({
    openrtb: { ver: '3.0', request: { id: 'r', item: [{}], context: {} } },
  });
  assert.ok(findById(f, 'request.30.item.id_required'));
  assert.ok(findById(f, 'request.30.item.spec_required'));
});

test('validateRequest30: item.qty = 0 → qty_invalid WARN', () => {
  const f = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: { id: 'r', item: [{ id: '1', qty: 0, spec: {} }], context: {} },
    },
  });
  const m = findById(f, 'request.30.item.qty_invalid');
  assert.ok(m);
  assert.equal(m.params.qty, 0);
});

test('validateRequest30: item.qty absent does NOT fire qty_invalid (defaults to 1 per spec)', () => {
  const f = validateRequest30({
    openrtb: { ver: '3.0', request: { id: 'r', item: [{ id: '1', spec: {} }], context: {} } },
  });
  assert.equal(findById(f, 'request.30.item.qty_invalid'), undefined);
});

test('validateRequest30: well-formed envelope fires only deep_validation_limited INFO', () => {
  const f = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: { placement: { display: { w: 300, h: 250 } } } }],
        context: {
          site: { id: 's1', domain: 'example.com' },
          device: { ip: '1.2.3.4', ua: 'Mozilla', lang: 'en' },
        },
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
  const r = validate({
    openrtb: {
      ver: '3.0',
      request: { id: 'r1', item: [{ id: '1', spec: {} }], context: { site: { id: 's1' } } },
    },
  });
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
        seatbid: [
          {
            seat: 's1',
            bid: [
              {
                id: 'b1',
                item: '1',
                price: 1.5,
                media: {
                  adomain: ['example.com'],
                  display: { adm: '<div>ad</div>' },
                },
              },
            ],
          },
        ],
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
  const r = validate({
    openrtb: {
      ver: '3.0',
      response: { id: 'r1', seatbid: [{ seat: 's1', bid: [{ id: 'b1', item: '1', price: 1.5 }] }] },
    },
  });
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

// ─────────────────────────────────────────────────────────────────
// Deep 3.0 Request Validation (Context & Placements) — unit & integration
// ─────────────────────────────────────────────────────────────────

test('validateRequest30: deep context validation (site vs app both/neither)', () => {
  const findingsBoth = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: {} }],
        context: { site: { id: 's1', domain: 'a.com' }, app: { id: 'a1', bundle: 'b.com' } },
      },
    },
  });
  assert.ok(findById(findingsBoth, 'request.30.context.site_and_app_both'));

  const findingsNeither = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: {} }],
        context: {},
      },
    },
  });
  assert.ok(findById(findingsNeither, 'request.30.context.no_site_or_app'));
});

test('validateRequest30: DOOH-only context does NOT false-fire no_site_or_app', () => {
  const f = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: {} }],
        context: { dooh: { id: 'd1' }, device: { ip: '1.2.3.4', ua: 'M', lang: 'en' } },
      },
    },
  });
  assert.equal(findById(f, 'request.30.context.no_site_or_app'), undefined);
});

test('validateRequest30: site domain and app bundle missing checks', () => {
  const fSite = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: {} }],
        context: { site: { id: 's1' } },
      },
    },
  });
  assert.ok(findById(fSite, 'request.30.context.site.domain_missing'));

  const fApp = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: {} }],
        context: { app: { id: 'a1' } },
      },
    },
  });
  assert.ok(findById(fApp, 'request.30.context.app.bundle_missing'));
});

test('validateRequest30: device IP, UA, country and lang validations', () => {
  const fDevice = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: {} }],
        context: {
          site: { domain: 'a.com' },
          device: { geo: { country: 'USAA' }, lang: 'ENG' },
        },
      },
    },
  });
  assert.ok(findById(fDevice, 'request.30.context.device.ip_required'));
  assert.ok(findById(fDevice, 'request.30.context.device.ua_required'));
  assert.ok(findById(fDevice, 'request.30.context.device.geo.country_invalid'));
  assert.ok(findById(fDevice, 'request.30.context.device.language_invalid'));
});

test('validateRequest30: privacy framework regs validations (GDPR/COPPA/CCPA/GPP)', () => {
  const fPrivacy = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: {} }],
        context: {
          site: { domain: 'a.com' },
          device: { ip: '1.2.3.4', ua: 'Mozilla', geo: { lat: 34, lon: -118 } },
          regs: { gdpr: 1, coppa: 1, gpp_sid: [2], ext: { us_privacy: 'INVALID' } },
          user: { id: 'u1' },
        },
      },
    },
  });
  assert.ok(findById(fPrivacy, 'request.30.regs.gdpr_consent_missing'));
  assert.ok(findById(fPrivacy, 'request.30.regs.coppa_pii_present'));
  assert.ok(findById(fPrivacy, 'request.30.regs.us_privacy_invalid'));
  assert.ok(findById(fPrivacy, 'request.30.regs.gpp_sid_without_string'));
});

test('validateRequest30: user gender validation', () => {
  const fUser = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [{ id: '1', spec: {} }],
        context: {
          site: { domain: 'a.com' },
          user: { gender: 'X' },
        },
      },
    },
  });
  assert.ok(findById(fUser, 'request.30.context.user.gender_invalid'));
});

test('validateRequest30: deep placement spec validations (formats, display w/h, video mime/ctype/dur)', () => {
  const fPlacement = validateRequest30({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r1',
        item: [
          {
            id: '1',
            spec: {
              placement: {
                display: { w: -100, h: 0 },
                video: { mime: [], mindur: 15, maxdur: 5 },
                audio: { mime: [] },
                native: 'not_an_obj',
              },
            },
          },
        ],
      },
    },
  });
  assert.ok(findById(fPlacement, 'request.30.item.display.size_invalid'));
  assert.ok(findById(fPlacement, 'request.30.item.video.mime_required'));
  assert.ok(findById(fPlacement, 'request.30.item.video.ctype_recommended'));
  assert.ok(findById(fPlacement, 'request.30.item.video.dur_invalid'));
  assert.ok(findById(fPlacement, 'request.30.item.audio.mime_required'));
  assert.ok(findById(fPlacement, 'request.30.item.native_invalid'));
});

// ─────────────────────────────────────────────────────────────────
// Deep 3.0 Response Validation (Media & Creative) — unit & integration
// ─────────────────────────────────────────────────────────────────

test('validateResponse30: deep creative validation (media missing/empty, display/video/audio markup)', () => {
  const fMedia = validateResponse30({
    openrtb: {
      ver: '3.0',
      response: {
        id: 'r1',
        seatbid: [
          {
            seat: 's1',
            bid: [
              { id: 'b1', item: '1', price: 1.5 }, // media missing
              { id: 'b2', item: '2', price: 1.5, media: {} }, // media empty
              { id: 'b3', item: '3', price: 1.5, media: { display: {} } }, // display empty
              { id: 'b4', item: '4', price: 1.5, media: { video: {} } }, // video empty
              { id: 'b5', item: '5', price: 1.5, media: { audio: {} } }, // audio empty
            ],
          },
        ],
      },
    },
  });
  assert.ok(findById(fMedia, 'response.30.bid.media_missing'));
  assert.ok(findById(fMedia, 'response.30.bid.media.format_required'));
  assert.ok(findById(fMedia, 'response.30.bid.display.markup_required'));
  assert.ok(findById(fMedia, 'response.30.bid.video.markup_required'));
  assert.ok(findById(fMedia, 'response.30.bid.audio.markup_required'));
  assert.ok(findById(fMedia, 'response.30.bid.adomain_missing'));
});

test('validateResponse30: recursive VAST validation inside video.adm', () => {
  const fVast = validateResponse30({
    openrtb: {
      ver: '3.0',
      response: {
        id: 'r1',
        seatbid: [
          {
            seat: 's1',
            bid: [
              {
                id: 'b1',
                item: '1',
                price: 1.5,
                media: {
                  video: {
                    adm: '<VAST version="4.0"><Ad><InLine></InLine></Ad></VAST>',
                  },
                },
              },
            ],
          },
        ],
      },
    },
  });
  // Should see standard VAST findings propagated
  assert.ok(findById(fVast, 'vast.adsystem_missing'));
});

// ─────────────────────────────────────────────────────────────────
// Integration with synthetic sample files
// ─────────────────────────────────────────────────────────────────

test('samples: synthetic-ortb30-deep-errors.json fires expected deep errors', () => {
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-ortb30-deep-errors.json');
  const sample = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const r = validate(sample);
  const errs = r.findings.filter((f) => f.level === 'error');
  const warns = r.findings.filter((f) => f.level === 'warning');

  assert.ok(errs.length > 0);
  assert.ok(warns.length > 0);
  assert.ok(findById(r.findings, 'request.30.context.site_and_app_both'));
  assert.ok(findById(r.findings, 'request.30.context.device.ua_required'));
  assert.ok(findById(r.findings, 'request.30.context.device.geo.country_invalid'));
  assert.ok(findById(r.findings, 'request.30.regs.gdpr_consent_missing'));
  assert.ok(findById(r.findings, 'request.30.regs.coppa_pii_present'));
  assert.ok(findById(r.findings, 'request.30.regs.us_privacy_invalid'));
  assert.ok(findById(r.findings, 'request.30.context.user.gender_invalid'));
  assert.ok(findById(r.findings, 'request.30.item.display.size_invalid'));
  assert.ok(findById(r.findings, 'request.30.item.video.mime_required'));
  assert.ok(findById(r.findings, 'request.30.item.video.dur_invalid'));
});

test('samples: synthetic-ortb30-deep-response-errors.json fires expected deep response errors', () => {
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-ortb30-deep-response-errors.json');
  const sample = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const r = validate(sample);

  assert.ok(findById(r.findings, 'response.30.bid.media_missing'));
  assert.ok(findById(r.findings, 'response.30.bid.display.markup_required'));
  assert.ok(findById(r.findings, 'vast.adtitle_missing')); // inside bid[2] VAST adm
  assert.ok(findById(r.findings, 'response.30.bid.media.format_required'));
});
