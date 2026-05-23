'use strict';

/**
 * Format detection tests. Use stable enum values from `FORMATS / CONTEXTS /
 * PROTOCOLS` rather than literal strings, so renaming an enum value at the
 * source forces a coordinated update here too.
 *
 * Knowledge-base round-trip: every sample shipped in the KB must be
 * recognised by `detectFormat`. The KB is the canonical truth — when you
 * add a sample, the detector tags it correctly or you fix the heuristic.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { detectFormat, FORMATS, CONTEXTS, PROTOCOLS } = require('@kyivtech/spyglass-core');
const kb = require('../packages/core/knowledge-base');

test('detectFormat: returns empty shape for null / non-object input', () => {
  for (const v of [null, undefined, 'string', 42, true]) {
    const r = detectFormat(v);
    assert.deepEqual(r.formats, []);
    assert.deepEqual(r.contexts, []);
    assert.deepEqual(r.protocols, []);
    assert.equal(r.confidence, 0);
  }
});

test('detectFormat: oRTB banner request → BANNER + WEB', () => {
  const req = {
    imp: [{ banner: { w: 300, h: 250 } }],
    site: { domain: 'example.com' },
  };
  const r = detectFormat(req);
  assert.ok(r.formats.includes(FORMATS.BANNER));
  assert.ok(r.contexts.includes(CONTEXTS.WEB));
  assert.equal(r.confidence, 1);
});

test('detectFormat: oRTB video request → VIDEO + protocol family from imp.video.protocols', () => {
  const req = {
    imp: [{ video: { mimes: ['video/mp4'], protocols: [3, 6] } }],
    site: { domain: 'video.example' },
  };
  const r = detectFormat(req);
  assert.ok(r.formats.includes(FORMATS.VIDEO));
  assert.ok(r.protocols.includes(PROTOCOLS.VAST_3));
});

test('detectFormat: VAST 4 protocols → vast-4 family', () => {
  const req = {
    imp: [{ video: { mimes: ['video/mp4'], protocols: [7, 8, 10, 11] } }],
  };
  const r = detectFormat(req);
  assert.ok(r.protocols.includes(PROTOCOLS.VAST_4));
});

test('detectFormat: imp.audio → AUDIO format', () => {
  const req = { imp: [{ audio: { mimes: ['audio/mp4'] } }] };
  const r = detectFormat(req);
  assert.ok(r.formats.includes(FORMATS.AUDIO));
});

test('detectFormat: imp.native → NATIVE format', () => {
  const req = { imp: [{ native: { request: '{}' } }] };
  const r = detectFormat(req);
  assert.ok(r.formats.includes(FORMATS.NATIVE));
});

test('detectFormat: app context → INAPP', () => {
  const req = {
    imp: [{ banner: { w: 320, h: 50 } }],
    app: { bundle: 'com.example.app' },
  };
  const r = detectFormat(req);
  assert.ok(r.contexts.includes(CONTEXTS.INAPP));
});

test('detectFormat: dooh top-level → DOOH context', () => {
  const req = { imp: [{ video: {} }], dooh: { id: 'panel-1' } };
  const r = detectFormat(req);
  assert.ok(r.contexts.includes(CONTEXTS.DOOH));
});

test('detectFormat: device.devicetype 3 → CTV context', () => {
  const req = {
    imp: [{ video: {} }],
    app: { bundle: 'tv.example' },
    device: { devicetype: 3 },
  };
  const r = detectFormat(req);
  assert.ok(r.contexts.includes(CONTEXTS.CTV));
  assert.ok(r.contexts.includes(CONTEXTS.INAPP));
});

test('detectFormat: BidResponse mtype=2 → VIDEO format', () => {
  const resp = { id: 'r', seatbid: [{ bid: [{ id: 'b', impid: 'i', price: 1, mtype: 2 }] }] };
  const r = detectFormat(resp);
  assert.ok(r.formats.includes(FORMATS.VIDEO));
});

test('detectFormat: BidResponse adm contains <VAST version="3.0"> → VAST_3 + VIDEO', () => {
  const resp = {
    id: 'r',
    seatbid: [
      {
        bid: [
          {
            id: 'b',
            impid: 'i',
            price: 2,
            adm: '<VAST version="3.0"><Ad/></VAST>',
          },
        ],
      },
    ],
  };
  const r = detectFormat(resp);
  assert.ok(r.formats.includes(FORMATS.VIDEO));
  assert.ok(r.protocols.includes(PROTOCOLS.VAST_3));
});

test('detectFormat: push-materials feed array → PUSH', () => {
  const feed = [
    {
      title: 'Hello',
      image: 'https://cdn.example/img.jpg',
      clickurl: 'https://click.example/c/1',
    },
  ];
  const r = detectFormat(feed);
  assert.ok(r.formats.includes(FORMATS.PUSH));
});

test('detectFormat: redirect-only single object → POPS', () => {
  const pop = { id: 'p', redirecturl: 'https://lp.example' };
  const r = detectFormat(pop);
  assert.ok(r.formats.includes(FORMATS.POPS));
});

test('detectFormat: ext.widget_id distinguishes inpage from push', () => {
  const ip = {
    title: 'Card',
    image: 'https://cdn.example/x.jpg',
    clickurl: 'https://click.example/c/2',
    ext: { widget_id: 'w-1' },
  };
  const r = detectFormat(ip);
  assert.ok(r.formats.includes(FORMATS.INPAGE));
  assert.ok(!r.formats.includes(FORMATS.PUSH));
});

test('detectFormat: ambiguous payload (banner + video) tags both honestly', () => {
  const req = { imp: [{ banner: { w: 300, h: 250 }, video: { mimes: ['video/mp4'] } }] };
  const r = detectFormat(req);
  assert.ok(r.formats.includes(FORMATS.BANNER));
  assert.ok(r.formats.includes(FORMATS.VIDEO));
});

// ── Knowledge Base round-trip ──────────────────────────────────

test('KB round-trip: every shipped sample is detected as its declared format', () => {
  const samples = kb.listSamples();
  assert.ok(samples.length > 0, 'manifest has samples');
  for (const entry of samples) {
    const payload = kb.loadSample(entry.id);
    assert.ok(payload != null, `sample ${entry.id} loads from disk`);
    const r = detectFormat(payload);
    assert.ok(
      r.formats.includes(entry.format),
      `sample ${entry.id} (declared "${entry.format}") not in detector output [${r.formats.join(', ')}]`,
    );
  }
});

test('KB loader: listSamples filter by format', () => {
  const banners = kb.listSamples({ format: 'banner' });
  assert.ok(banners.length >= 1);
  for (const b of banners) assert.equal(b.format, 'banner');
});

test('KB loader: fewShotForFormat returns ≤limit anonymized field lists', () => {
  const shots = kb.fewShotForFormat('banner', { limit: 1 });
  assert.equal(shots.length, 1);
  assert.ok(Array.isArray(shots[0].fields));
  assert.ok(shots[0].fields.length > 0);
  // Field names only — no values:
  for (const f of shots[0].fields) assert.equal(typeof f, 'string');
});

test('KB loader: unknown format returns []', () => {
  assert.deepEqual(kb.fewShotForFormat('nonexistent-format'), []);
});

test('KB loader: loadSample with bogus id returns null', () => {
  assert.equal(kb.loadSample('bogus-id-9999'), null);
});
