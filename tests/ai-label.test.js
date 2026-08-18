'use strict';

/**
 * tests/ai-label.test.js
 *
 * Covers the dialect labelling assistant's two deterministic halves. The
 * model call itself is not exercised here — it needs a GPU and a loaded
 * persona, so it belongs in a manual/integration check, not in `npm test`.
 * What IS testable is everything that decides whether the model is called
 * at all, and what it would be allowed to see.
 *
 * Assertions:
 *   1. signal-lexicon resolves the cases it should, and ABSTAINS on the
 *      ones where a guess would be harmful (numeric codes, contradictions).
 *   2. The three label vocabularies agree — lexicon, ollama client, and the
 *      dialects store. A drift here produces a suggestion the user cannot
 *      save, which is invisible until someone clicks accept.
 *   3. redactImp() is an allowlist: fields nobody named do not travel to
 *      the model. This is the privacy claim, so it is asserted directly
 *      rather than inferred from the happy path.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const lex = require('../packages/core/dialects/signal-lexicon');
const ollama = require('../lib/ollama');
const { redactImp } = require('../modules/ai-label/handler');

// ── 1. lexicon behaviour ─────────────────────────────────────────────

test('lexicon: format word corroborated by the impression resolves high', () => {
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.type',
    signalValue: 'preroll_video',
    imp: { id: '1', video: { mimes: ['video/mp4'], w: 640, h: 480 } },
  });
  assert.ok(r, 'expected a resolution');
  assert.equal(r.label, 'video');
  assert.equal(r.source, 'lexicon');
  assert.ok(r.confidence >= 0.9, `expected high confidence, got ${r.confidence}`);
});

test('lexicon: numeric vendor codes always abstain', () => {
  for (const value of [8, '8', 0, 42]) {
    const r = lex.resolveSignal({
      signalPath: 'imp[0].ext.adtype',
      signalValue: value,
      imp: { id: '1', banner: { w: 1, h: 1 } },
    });
    assert.equal(r, null, `numeric ${JSON.stringify(value)} must not resolve`);
  }
});

test('lexicon: a format word contradicted by the impression abstains', () => {
  // "video_slider" on an imp carrying only a real banner. Either the naming
  // is misleading or the slot is a hybrid — a human decides, not a table.
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.type',
    signalValue: 'video_slider',
    imp: { id: '1', banner: { w: 300, h: 250 } },
  });
  assert.equal(r, null);
});

test('lexicon: 1x1 banner is not banner corroboration', () => {
  // A 1x1 banner is the placeholder pop networks send, not display
  // inventory — so it must not corroborate a "banner" word.
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.type',
    signalValue: 'banner',
    imp: { id: '1', banner: { w: 1, h: 1 } },
  });
  assert.ok(r === null || r.confidence < 0.9, 'must not read 1x1 as banner evidence');
});

test('lexicon: pop allow-flags and sizeID:[0] resolve to pop', () => {
  const flag = lex.resolveSignal({
    signalPath: 'imp[0].ext.allowShock',
    signalValue: 1,
    imp: { id: '1', banner: { w: 1, h: 1 } },
  });
  assert.equal(flag && flag.label, 'pop');

  const size = lex.resolveSignal({
    signalPath: 'imp[0].ext.sizeID',
    signalValue: [0],
    imp: { id: '1', banner: { w: 1, h: 1 } },
  });
  assert.equal(size && size.label, 'pop');
});

test('lexicon: a real sizeID array is not a pop signal', () => {
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.sizeID',
    signalValue: [300, 250],
    imp: { id: '1', banner: { w: 300, h: 250 } },
  });
  assert.equal(r, null);
});

test('lexicon: a set flag resolves, an unset one abstains', () => {
  const on = lex.resolveSignal({ signalPath: 'imp[0].ext.popunder', signalValue: 1, imp: null });
  assert.equal(on && on.label, 'pop');
  // `popunder: 0` is the vendor saying this slot is NOT one.
  const off = lex.resolveSignal({ signalPath: 'imp[0].ext.popunder', signalValue: 0, imp: null });
  assert.equal(off, null);
});

test('lexicon: bookkeeping and metadata keys resolve on the key alone', () => {
  const id = lex.resolveSignal({
    signalPath: 'imp[0].ext.custom_tracking_id',
    signalValue: 'a8f3e91c-4d22',
    imp: { id: '1', banner: { w: 300, h: 250 } },
  });
  assert.equal(id && id.label, 'ignore');

  const ver = lex.resolveSignal({ signalPath: 'ext.pv', signalValue: '3.2.1', imp: null });
  assert.equal(ver && ver.label, 'informational');
});

test('lexicon: a key that merely contains a format word does not declare one', () => {
  // `creative_video_url` is not a format declaration; only format-declaring
  // keys get their value read as a format.
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.creative_video_url',
    signalValue: 'https://cdn.example/v.mp4',
    imp: { id: '1', video: { w: 640, h: 480 } },
  });
  assert.equal(r, null);
});

test('lexicon: a bookkeeping key wins over a format word in its value', () => {
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.session_id',
    signalValue: 'video-42',
    imp: { id: '1', video: { w: 640, h: 480 } },
  });
  assert.equal(r && r.label, 'ignore');
});

test('lexicon: every resolution returns a storable label', () => {
  /** @type {Array<[string, any, any]>} */
  const samples = [
    ['imp[0].ext.type', 'preroll_video', { video: {} }],
    ['imp[0].ext.adtype', 'popunder', { banner: { w: 1, h: 1 } }],
    ['imp[0].ext.format', 'interstitial', { banner: { w: 320, h: 480 }, instl: 1 }],
    ['imp[0].ext.type', 'native', { native: { request: '{}' } }],
    ['ext.sdkver', '1.2', null],
  ];
  for (const [signalPath, signalValue, imp] of samples) {
    const r = lex.resolveSignal({ signalPath, signalValue, imp });
    if (!r) continue;
    assert.ok(
      lex.SEMANTIC_LABELS.includes(r.label),
      `${signalPath} produced unstorable label ${r.label}`,
    );
    assert.ok(r.confidence > 0 && r.confidence <= 1, 'confidence out of range');
    assert.ok(r.reason && r.reason.length > 0, 'a resolution must explain itself');
  }
});

// ── 2. vocabulary parity ─────────────────────────────────────────────

test('label vocabularies agree across lexicon, model client and store', () => {
  // The store's list is the authority — it is what the save route validates
  // against. Read it from the source rather than restating it here, so this
  // test fails when the store changes and nobody updated the other two.
  const handlerSrc = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'modules', 'dialects', 'handler.js'),
    'utf8',
  );
  const block = handlerSrc.match(/const SEMANTIC_LABELS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'could not locate SEMANTIC_LABELS in the dialects store');
  const storeLabels = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  assert.deepEqual(
    [...lex.SEMANTIC_LABELS].sort(),
    [...storeLabels].sort(),
    'signal-lexicon and the dialects store disagree on the label vocabulary',
  );
  assert.deepEqual(
    [...ollama.LABELS].sort(),
    [...storeLabels].sort(),
    'the model client and the dialects store disagree on the label vocabulary',
  );
});

// ── 3. redaction is an allowlist ─────────────────────────────────────

test('redactImp keeps only structural fields', () => {
  const { sketch } = redactImp({
    id: 'imp-1',
    tagid: 'publisher-slot-name',
    banner: { w: 300, h: 250, pos: 1 },
    instl: 0,
    bidfloor: 0.16,
    bidfloorcur: 'USD',
    displaymanager: 'SomeSDK',
    ext: { type: 'preroll_video', secret_partner_token: 'shh' },
  });
  const flat = JSON.stringify(sketch);
  assert.ok(!flat.includes('publisher-slot-name'), 'tagid must not travel');
  assert.ok(!flat.includes('SomeSDK'), 'displaymanager must not travel');
  assert.ok(!flat.includes('shh'), 'ext values must not travel');
  assert.ok(!flat.includes('imp-1'), 'imp id must not travel');
  assert.equal(sketch.banner.w, 300);
  assert.equal(sketch.bidfloor, 0.16);
});

test('redactImp passes sibling ext key NAMES but never their values', () => {
  const { siblingKeys } = redactImp({
    banner: { w: 1, h: 1 },
    ext: { allowShock: 1, type: 'popunder', auth_token: 'sensitive-value' },
  });
  assert.deepEqual(siblingKeys.sort(), ['allowShock', 'auth_token', 'type'].sort());
  assert.ok(
    !JSON.stringify(siblingKeys).includes('sensitive-value'),
    'sibling values must not travel',
  );
});

test('redactImp drops unknown vendor fields entirely', () => {
  const { sketch } = redactImp({
    banner: { w: 300, h: 250 },
    some_future_vendor_field: 'user@example.com',
    nested: { deeply: { pii: '192.168.1.1' } },
  });
  const flat = JSON.stringify(sketch);
  assert.ok(!flat.includes('user@example.com'));
  assert.ok(!flat.includes('192.168.1.1'));
  assert.ok(!flat.includes('some_future_vendor_field'));
});

test('redactImp tolerates junk input', () => {
  for (const junk of [null, undefined, 'string', 42, [], [{ banner: {} }]]) {
    const out = redactImp(junk);
    assert.equal(out.sketch, null);
    assert.deepEqual(out.siblingKeys, []);
  }
});

test('redactImp reports native presence without its asset layout', () => {
  const { sketch } = redactImp({
    native: { request: '{"assets":[{"title":{"text":"publisher headline"}}]}' },
  });
  assert.deepEqual(sketch.native, { present: true });
  assert.ok(!JSON.stringify(sketch).includes('publisher headline'));
});
