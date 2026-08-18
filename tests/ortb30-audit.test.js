'use strict';

/**
 * Audit 2026-08-18 — the oRTB 3.0 branch and the detection axes feeding it.
 *
 * Five defects, all of the same family: the 3.0 path was written as a thin
 * structural check bolted onto an engine that assumes 2.x everywhere else, so
 * every axis that was not explicitly taught about 3.0 answered confidently and
 * wrongly rather than saying nothing. Each test below pins the behaviour that
 * was actually observed to be broken, not the shape of the fix.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validate, detectVersion, detectFormat, VERSIONS } = require('@ortbtools/core');
const { detect30ResponseSignals } = require('../packages/core/detect');
const { validateResponse30 } = require('../packages/core/rules-response-30');

const ids = (findings) => findings.map((f) => f.id);
const byId = (findings, id) => findings.find((f) => f.id === id);

// ─────────────────────────────────────────────────────────────────────────
// 1. AdCOM Ad object — the inverted verdict (P0)
//
// AdCOM 1.0 puts the creative on Media.ad (the Ad object): bid.media.ad.display,
// bid.media.ad.adomain. The rule file read bid.media.display / bid.media.adomain
// straight off Media, a shape the spec has no room for — so the spec-correct
// bid came back with an ERROR and a WARNING while the invented flat one came
// back 'clean'. Exactly backwards.
// ─────────────────────────────────────────────────────────────────────────

const adcomBid = {
  id: 'b1',
  item: '1',
  price: 1.5,
  media: {
    ad: { id: 'a1', adomain: ['adv.com'], display: { w: 300, h: 250, adm: '<div>x</div>' } },
  },
};

const wrapResponse = (bid) => ({
  openrtb: { ver: '3.0', response: { id: 'auc-1', seatbid: [{ seat: 's1', bid: [bid] }] } },
});

test('3.0 response: AdCOM-correct bid.media.ad creative validates clean', () => {
  const r = validate(wrapResponse(adcomBid));
  assert.equal(r.status, 'clean', `unexpected findings: ${ids(r.findings).join(', ')}`);
  assert.equal(byId(r.findings, 'response.30.bid.media.format_required'), undefined);
  assert.equal(byId(r.findings, 'response.30.bid.adomain_missing'), undefined);
});

test('3.0 response: the pre-audit flat media.display shape keeps validating', () => {
  // Not endorsed by AdCOM, but it is what this repo's own samples and several
  // live integrations emit. The Ad object wins when present; the flat reading
  // remains the fallback so nobody's payload turns red overnight.
  const r = validate(
    wrapResponse({
      id: 'b1',
      item: '1',
      price: 1.5,
      media: { adomain: ['adv.com'], display: { adm: '<div>x</div>' } },
    }),
  );
  assert.equal(r.status, 'clean', `unexpected findings: ${ids(r.findings).join(', ')}`);
});

test('3.0 response: media.ad present but not an object is reported at .media.ad', () => {
  const f = validateResponse30(
    wrapResponse({ id: 'b1', item: '1', price: 1.5, media: { ad: 'junk' } }),
  );
  const m = byId(f, 'response.30.bid.media_invalid');
  assert.ok(m, 'expected media_invalid for an unreadable Ad wrapper');
  assert.equal(m.path, 'openrtb.response.seatbid[0].bid[0].media.ad');
  // Not the weaker "no creative format here" claim: the wrapper IS there.
  assert.equal(byId(f, 'response.30.bid.media.format_required'), undefined);
});

test('3.0 response: missing creative under the Ad object still errors', () => {
  const f = validateResponse30(
    wrapResponse({ id: 'b1', item: '1', price: 1.5, media: { ad: { adomain: ['a.com'] } } }),
  );
  const m = byId(f, 'response.30.bid.media.format_required');
  assert.ok(m);
  assert.equal(m.path, 'openrtb.response.seatbid[0].bid[0].media.ad');
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Envelope-less 3.0 BidResponse (P1)
//
// The body an operator copies out of a log has no `openrtb` wrapper; it has
// `seatbid[]`, a key 2.x owns. It went to the 2.x rules and collected four
// false statements — two of them naming the very fields (`item`, `media`) that
// identify the version.
// ─────────────────────────────────────────────────────────────────────────

const nakedBody = {
  id: 'auc-1',
  seatbid: [
    {
      seat: 's1',
      bid: [
        {
          id: 'b1',
          item: '1',
          price: 1.5,
          media: { adomain: ['x.com'], display: { adm: '<div/>', w: 300, h: 250 } },
        },
      ],
    },
  ],
};

test('naked 3.0 response body detects as 3.0, not 2.5-by-default', () => {
  const v = detectVersion(nakedBody);
  assert.equal(v.version, VERSIONS.V_3_0);
  // 0.7, not 1: the fields are 3.0-only, but the structural proof (the
  // envelope) is not in front of us.
  assert.equal(v.confidence, 0.7);
  assert.deepEqual(v.signals.sort(), ['seatbid[].bid[].item', 'seatbid[].bid[].media']);
});

test('naked 3.0 response body: none of the four false 2.x claims survive', () => {
  const r = validate(nakedBody);
  const got = ids(r.findings);
  for (const wrong of [
    'response.bid.impid_required', // 3.0 replaced impid with item
    'response.bid.payload_missing', // markup is in media.display.adm
    'response.bid.adomain_missing', // adomain is in media
    'payload.field_unrecognized', // 'item' / 'media' ARE OpenRTB fields
    'version.assumed', // two version-specific fields were found
  ]) {
    assert.equal(got.includes(wrong), false, `${wrong} should not fire: ${got.join(', ')}`);
  }
  // The envelope really is absent, so it is still said — as a WARNING, since
  // for a pasted inner body it was never there to be wrong.
  const env = byId(r.findings, 'response.30.envelope_required');
  assert.ok(env);
  assert.equal(env.level, 'warning');
});

test('naked 3.0 body: findings carry root-relative paths, not a phantom envelope', () => {
  const f = validateResponse30({ seatbid: [{ bid: [{ item: '1', media: {} }] }] });
  assert.equal(byId(f, 'response.30.id_required').path, 'id');
  assert.equal(byId(f, 'response.30.bid.id_required').path, 'seatbid[0].bid[0].id');
  // `ver` lives on the envelope. Demanding it from a body that never carried
  // one manufactures a second error out of one missing wrapper.
  assert.equal(byId(f, 'response.30.ver_required'), undefined);
});

test('a bid carrying BOTH impid and item is not claimed as 3.0', () => {
  // A mixture is a mixture. Resolving it by silent preference is the failure
  // this detector was extended to stop, not one to reproduce in the other
  // direction.
  const mixed = { id: 'a', seatbid: [{ bid: [{ id: 'b', impid: '1', item: '1', price: 1 }] }] };
  assert.deepEqual(detect30ResponseSignals(mixed), []);
  assert.equal(detectVersion(mixed).version, VERSIONS.V_2_5);
});

test('a plain 2.x BidResponse is untouched by the 3.0 body probe', () => {
  const v = detectVersion({
    id: 'a',
    seatbid: [{ bid: [{ id: 'b', impid: '1', price: 1, adm: '<div/>' }] }],
  });
  assert.equal(v.version, VERSIONS.V_2_5);
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Plugins / consent / TCF on a 3.0 payload (P1)
//
// They read 2.x paths on the root envelope, where those paths do not exist, so
// eleven plugins and the TC-string checks all returned empty and a request full
// of defects rolled up to 'clean'.
// ─────────────────────────────────────────────────────────────────────────

const defective30 = {
  openrtb: {
    ver: '3.0',
    request: {
      id: 'r1',
      tmax: -5,
      cur: ['XXXX'],
      source: { schain: { ver: '9.9', complete: 7, nodes: [] } },
      context: {
        site: { domain: 'x.com' },
        device: { ua: 'UA', ip: '1.2.3.4', lang: 'en' },
        regs: { gdpr: 1 },
        user: { consent: 'COabc' },
      },
      item: [{ id: '1', spec: { placement: { display: { w: 300, h: 250 } } } }],
    },
  },
};

test('3.0 request: schain / tmax / currency defects are no longer invisible', () => {
  const r = validate(defective30);
  const got = ids(r.findings);
  for (const expected of [
    'err-schain-version',
    'err-schain-complete',
    'err-schain-nodes-empty',
    'err-tmax-invalid',
    'err-bid-currency-invalid',
  ]) {
    assert.ok(got.includes(expected), `${expected} missing from: ${got.join(', ')}`);
  }
  assert.equal(r.status, 'errors');
});

test('3.0 request: TC-string checks reach context.user.consent', () => {
  const r = validate(defective30);
  const c = byId(r.findings, 'consent.tcstring_implausible');
  assert.ok(c, `consent finding missing from: ${ids(r.findings).join(', ')}`);
  assert.equal(c.path, 'openrtb.request.context.user.consent');
});

test('3.0 request: projected findings are re-addressed to real 3.0 paths', () => {
  const r = validate(defective30);
  // A finding the operator cannot click is worth little more than none.
  assert.equal(byId(r.findings, 'err-schain-version').path, 'openrtb.request.source.schain.ver');
  assert.equal(byId(r.findings, 'err-tmax-invalid').path, 'openrtb.request.tmax');
  assert.equal(byId(r.findings, 'err-bid-currency-invalid').path, 'openrtb.request.cur[0]');
});

test('3.0 request: AdCOM Device is deliberately NOT fed to the 2.x client-hints rule', () => {
  // AdCOM's Device is not 2.x's Device at a new address: `os` is an integer
  // from an enumerated list where 2.x has a free string, and the device kind
  // is `type`, not `devicetype`. Running a rule that reads those as 2.x
  // strings would assert facts the object does not carry.
  const r = validate(defective30);
  const got = ids(r.findings);
  assert.equal(got.includes('device.client_hints.os_unknown'), false);
  assert.equal(got.includes('device.client_hints.sua_missing'), false);
});

test('3.0 control sample stays clean once the rule groups run', () => {
  // The guard on the whole projection: turning rules ON must not turn the
  // repo's own "this is what correct looks like" sample red.
  const fp = path.join(__dirname, '..', 'samples', 'synthetic-ortb30-clean.json');
  const r = validate(JSON.parse(fs.readFileSync(fp, 'utf8')));
  const loud = r.findings.filter((f) => f.level === 'error' || f.level === 'warning');
  assert.equal(loud.length, 0, `unexpected: ${ids(loud).join(', ')}`);
});

test('3.0 response: price / currency plugins reach the response object', () => {
  const r = validate({
    openrtb: {
      ver: '3.0',
      response: {
        id: 'r1',
        cur: 'NOTACUR',
        seatbid: [
          {
            seat: 's1',
            bid: [
              {
                id: 'b1',
                item: '1',
                price: 1.5,
                media: { ad: { adomain: ['a.com'], display: { adm: '<i/>' } } },
              },
            ],
          },
        ],
      },
    },
  });
  const cur = r.findings.find((f) => f.id.includes('currency'));
  assert.ok(cur, `no currency finding in: ${ids(r.findings).join(', ')}`);
  assert.ok(cur.path.startsWith('openrtb.response'), `path not re-addressed: ${cur.path}`);
});

// ─────────────────────────────────────────────────────────────────────────
// 4. 2.6 fields promoted out of ext (P1)
//
// The detector's 2.6 signal table was missing exactly the set this repo's own
// 2.5→2.6 migrator writes, so the migrator's output fed back into validate()
// came back "2.5, no version-specific fields found" — with five 2.6-only
// fields sitting in it.
// ─────────────────────────────────────────────────────────────────────────

const migratedTo26 = {
  id: 'a',
  imp: [{ id: '1', banner: { w: 300, h: 250 }, secure: 1 }],
  site: {
    domain: 'ex.com',
    page: 'https://ex.com/',
    content: { cat: ['IAB1-1'], cattax: 1, prodq: 2 },
  },
  device: { ua: 'M', ip: '1.2.3.4' },
  user: { consent: 'CO' },
  regs: { gdpr: 1, us_privacy: '1YNN' },
};

test('migrator output is detected as 2.6, with the signals named', () => {
  const v = detectVersion(migratedTo26);
  assert.equal(v.version, VERSIONS.V_2_6);
  assert.equal(v.confidence, 1);
  for (const s of ['regs.gdpr', 'regs.us_privacy', 'user.consent', 'site.content.cattax']) {
    assert.ok(v.signals.includes(s), `${s} missing from ${JSON.stringify(v.signals)}`);
  }
});

test('"No version-specific fields found" is no longer said about a 2.6 payload', () => {
  const r = validate(migratedTo26);
  assert.equal(byId(r.findings, 'version.assumed'), undefined);
});

test('pinning expectedVersion 2.6 on migrator output no longer reports a mismatch', () => {
  const r = validate(migratedTo26, { expectedVersion: '2.6' });
  assert.equal(byId(r.findings, 'version.mismatch'), undefined);
});

test('each promoted field is a marker on its own', () => {
  const base = { id: 'a', imp: [{ id: '1' }] };
  const cases = /** @type {Array<[string, any]>} */ ([
    ['regs.gdpr', { regs: { gdpr: 1 } }],
    ['regs.us_privacy', { regs: { us_privacy: '1YNN' } }],
    ['user.consent', { user: { consent: 'CO' } }],
    ['user.eids', { user: { eids: [] } }],
    ['source.schain', { source: { schain: { ver: '1.0' } } }],
    ['cattax', { cattax: 2 }],
    ['site.content.cattax', { site: { content: { cattax: 2 } } }],
    ['app.content.producer.cattax', { app: { content: { producer: { cattax: 2 } } } }],
  ]);
  for (const [signal, extra] of cases) {
    const v = detectVersion(Object.assign({}, base, extra));
    assert.equal(v.version, VERSIONS.V_2_6, `${signal} did not raise the version`);
    assert.ok(v.signals.includes(signal), `${signal} not reported as the signal`);
  }
});

test('content.prodq alone does NOT flip a payload to 2.6', () => {
  // Deliberate, and the one item from the audit note that was not adopted:
  // `prodq` is in the 2.5 Content object — it replaced `videoquality` back in
  // 2.4. The only repo anchor calling it 2.6 is the migration rule that MOVES
  // videoquality into it, and that rule exists because 2.6 removed
  // videoquality, not because it added prodq. Treating it as definitive would
  // raise real 2.5 payloads to 2.6 at confidence 1 off a single field.
  const v = detectVersion({
    id: 'a',
    imp: [{ id: '1' }],
    site: { content: { prodq: 1 } },
  });
  assert.notEqual(v.version, VERSIONS.V_2_6);
});

test('a 2.5 payload with none of the promoted fields still reads 2.5', () => {
  const v = detectVersion({
    id: 'a',
    imp: [{ id: '1', banner: { w: 300, h: 250 } }],
    site: { domain: 'ex.com' },
    device: { ua: 'M', ip: '1.2.3.4' },
    source: { fd: 1 },
  });
  assert.equal(v.version, VERSIONS.V_2_5);
});

// ─────────────────────────────────────────────────────────────────────────
// 5. detectFormat() on 3.0 (P2)
//
// The third axis had branches for 2.x shapes only and returned "nothing is
// known" for a readable 3.0 CTV video request — while the equivalent 2.5
// payload answered video + inapp + ctv at confidence 1.
// ─────────────────────────────────────────────────────────────────────────

test('detectFormat: 3.0 CTV video request is read, not shrugged at', () => {
  const out = detectFormat({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r',
        context: { app: { bundle: 'com.x' }, device: { ua: 'UA', ip: '1.2.3.4', devicetype: 3 } },
        item: [{ id: '1', spec: { placement: { video: { mime: ['video/mp4'], ctype: [7] } } } }],
      },
    },
  });
  assert.deepEqual(out.formats, ['video']);
  assert.deepEqual(out.contexts.sort(), ['ctv', 'inapp']);
  // AdCOM ctype 7 = VAST 4.0. It is NOT the 2.x `protocols` table — the two
  // enumerations diverge, and reading ctype through the 2.x map would report
  // this request as VAST 4.0 wrapper's neighbour instead.
  assert.deepEqual(out.protocols, ['vast-4']);
  assert.equal(out.confidence, 1);
});

test('detectFormat: AdCOM spells the device kind `type`; both spellings are read', () => {
  const out = detectFormat({
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r',
        context: { site: { domain: 'x.com' }, device: { type: 3 } },
        item: [{ id: '1', spec: { placement: { display: { w: 300, h: 250 } } } }],
      },
    },
  });
  // AdCOM says "display" where this axis says "banner" — one vocabulary
  // across versions is the point of the axis; the version question belongs to
  // detectVersion.
  assert.deepEqual(out.formats, ['banner']);
  assert.deepEqual(out.contexts.sort(), ['ctv', 'web']);
});

test('detectFormat: 3.0 response reads the AdCOM Ad object and sniffs its VAST', () => {
  const out = detectFormat({
    openrtb: {
      ver: '3.0',
      response: {
        id: 'r',
        seatbid: [
          {
            bid: [
              {
                id: 'b',
                item: '1',
                price: 1,
                media: { ad: { video: { adm: '<VAST version="4.0"><Ad></Ad></VAST>' } } },
              },
            ],
          },
        ],
      },
    },
  });
  assert.deepEqual(out.formats, ['video']);
  assert.deepEqual(out.protocols, ['vast-4']);
});

test('detectFormat: envelope-less 3.0 response body is read too', () => {
  const out = detectFormat(nakedBody);
  assert.deepEqual(out.formats, ['banner']);
  assert.equal(out.confidence, 1);
});

test('detectFormat: 2.x payloads answer exactly as before', () => {
  const out = detectFormat({
    imp: [{ id: '1', video: { protocols: [7] } }],
    app: { bundle: 'x' },
    device: { devicetype: 3 },
  });
  assert.deepEqual(out.formats, ['video']);
  assert.deepEqual(out.contexts.sort(), ['ctv', 'inapp']);
  assert.deepEqual(out.protocols, ['vast-4']);
});
