'use strict';

/**
 * tests/creative-preview-classify.test.js
 *
 * The classification table from
 * specs/012-creative-preview-repair/contracts/creative-preview.md §1.
 *
 * This exists because `setAdPreview`'s third branch used to be an
 * unconditional catch-all: four different payload shapes — envelope-less
 * native, a bare URL, base64, and text that is not markup at all — were handed
 * to the browser as `srcdoc` and came out as a line of garbage. The worst of
 * them threw nothing, so the `console.error` meant to leave a trail never
 * fired and the failure was silent.
 *
 * The invariant every row here defends: `markup` is the ONLY kind that may
 * reach an iframe.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

/**
 * Load the classifier into a fresh window, the same way
 * tests/macro-evaluator.test.js loads the macro engine.
 *
 * @param {{withVastCore?: boolean}} [opts] mount the generated core detector too
 */
function loadClassifier(opts) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const win = /** @type {any} */ (dom.window);
  // The browser module reaches for these as globals inside the frame; jsdom's
  // window does not carry them, and Node's do the same job.
  win.atob = globalThis.atob;
  win.TextDecoder = globalThis.TextDecoder;
  win.Uint8Array = globalThis.Uint8Array;

  if (opts && opts.withVastCore) {
    // The generated copy is a UMD that hangs itself on `globalThis` when there
    // is no CommonJS `module` — so `globalThis` is what has to be shadowed, not
    // `window`. Getting this wrong loads the detector onto the real Node global
    // and the classifier silently takes its fallback path, which is exactly the
    // failure the delegation test below is watching for.
    const core = fs.readFileSync(path.join(ROOT, 'public/core/vast-shape.js'), 'utf8');
    new Function('globalThis', 'module', 'exports', core)(win, undefined, undefined);
  }

  const code = fs.readFileSync(
    path.join(ROOT, 'public/modules/inspector/creative-classify.js'),
    'utf8',
  );
  new Function('window', 'document', 'atob', 'TextDecoder', 'Uint8Array', code)(
    win,
    win.document,
    globalThis.atob,
    globalThis.TextDecoder,
    globalThis.Uint8Array,
  );
  return { api: win.OrtbtoolsCreativeClassify, win };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// ── the generated core detector is what the classifier must delegate to ──
test('the browser copy of the VAST detector loads and exposes isVastShape', () => {
  const { win } = loadClassifier({ withVastCore: true });
  assert.ok(win.OrtbtoolsVastShape, 'public/core/vast-shape.js must expose OrtbtoolsVastShape');
  assert.equal(typeof win.OrtbtoolsVastShape.isVastShape, 'function');
});

// ── §1, row by row ───────────────────────────────────────────────
const ROWS = [
  {
    row: 1,
    kind: 'vast',
    name: 'plain VAST',
    body: '<VAST version="4.0"><Ad></Ad></VAST>',
  },
  {
    row: 1,
    kind: 'vast',
    name: 'VAST behind an XML declaration',
    body: '<?xml version="1.0" encoding="UTF-8"?><VAST version="4.2"><Ad/></VAST>',
  },
  {
    row: 2,
    kind: 'native',
    name: 'native, wrapped',
    body: JSON.stringify({ native: { assets: [{ id: 1 }] } }),
  },
  {
    row: 2,
    kind: 'native',
    name: 'native, envelope-less — the silent failure this package exists for',
    body: JSON.stringify({ assets: [{ id: 1 }], link: { url: 'https://example.test/' } }),
  },
  {
    row: 3,
    kind: 'json',
    name: 'JSON that carries no native assets',
    body: JSON.stringify({ seatbid: [], cur: 'USD' }),
  },
  {
    row: 5,
    kind: 'url',
    name: 'a bare absolute URL',
    body: 'https://cdn.example.test/banner-300x250.png',
  },
  {
    row: 6,
    kind: 'markup',
    name: 'a banner',
    body: '<a href="https://example.test/"><img src="https://cdn.example.test/b.png"></a>',
  },
  {
    row: 6,
    kind: 'markup',
    name: 'a full document',
    body: '<!DOCTYPE html><html><body><div>ad</div></body></html>',
  },
  {
    row: 7,
    kind: 'unidentified',
    name: 'prose',
    body: 'no bid, nothing to render here',
  },
  {
    row: 7,
    kind: 'unidentified',
    name: 'empty',
    body: '   ',
  },
  {
    row: 7,
    kind: 'unidentified',
    name: 'opens like JSON but is not JSON and is not markup',
    body: '{seatbid: [oops}',
  },
];

for (const r of ROWS) {
  test(`§1 row ${r.row} — ${r.name} classifies as ${r.kind}`, () => {
    const { api } = loadClassifier({ withVastCore: true });
    const got = api.classify(r.body);
    assert.equal(got.kind, r.kind, `reason given: ${got.reason}`);
    assert.equal(got.decoded, false);
  });
}

// ── row 4: base64, exactly one round ─────────────────────────────
test('§1 row 4 — base64 wrapping markup decodes once and renders as markup', () => {
  const { api } = loadClassifier({ withVastCore: true });
  const inner = '<div class="b">Sale ends today</div>';
  const got = api.classify(b64(inner));
  assert.equal(got.kind, 'markup');
  assert.equal(got.decoded, true);
  assert.equal(got.body, inner, 'the decoded body is what the frame must receive');
  assert.match(got.reason, /^base64 → /);
});

test('§1 row 4 — base64 wrapping envelope-less native survives the decode', () => {
  const { api } = loadClassifier({ withVastCore: true });
  const got = api.classify(b64(JSON.stringify({ assets: [{ id: 1 }] })));
  assert.equal(got.kind, 'native');
  assert.equal(got.decoded, true);
  assert.ok(got.native && Array.isArray(got.native.assets));
});

test('§1 row 4 — exactly one decode round; base64 of base64 is not unwrapped twice', () => {
  const { api } = loadClassifier({ withVastCore: true });
  const got = api.classify(b64(b64('<div>ad</div>')));
  assert.notEqual(got.kind, 'markup', 'a second decode round would have produced markup');
  assert.equal(got.decoded, false);
});

test('§1 row 4 — base64 that decodes to nothing recognisable stays unidentified', () => {
  const { api } = loadClassifier({ withVastCore: true });
  const got = api.classify(b64('just some words with no shape at all'));
  assert.equal(got.kind, 'unidentified');
  assert.equal(got.decoded, false);
});

test('§1 row 4 — the decode attempt is bounded by input length', () => {
  const { api } = loadClassifier({ withVastCore: true });
  const huge = 'QUFB'.repeat(api.MAX_DECODE_INPUT / 4 + 4);
  assert.ok(huge.length > api.MAX_DECODE_INPUT);
  const got = api.classify(huge);
  assert.equal(got.decoded, false, 'an oversized body must not be decoded');
});

// ── the invariant ────────────────────────────────────────────────
test('only `markup` is frameable — every other kind is inert text', () => {
  const { api } = loadClassifier({ withVastCore: true });
  for (const r of ROWS) {
    const got = api.classify(r.body);
    assert.equal(
      api.isFrameable(got),
      got.kind === 'markup',
      `${r.name}: isFrameable must agree with kind === 'markup'`,
    );
  }
  // And the one shape that is most tempting to paint: JSON.
  const json = api.classify(JSON.stringify({ assets: 'not an array' }));
  assert.equal(json.kind, 'json');
  assert.equal(api.isFrameable(json), false, 'a JSON payload must never reach a frame');
});

test('classification never rewrites the body, except on the base64 row', () => {
  const { api } = loadClassifier({ withVastCore: true });
  for (const r of ROWS) {
    const got = api.classify(r.body);
    assert.equal(got.body, r.body, `${r.name}: the bytes handed to the frame must be untouched`);
  }
});

test('every result carries a reason, and every kind is declared', () => {
  const { api } = loadClassifier({ withVastCore: true });
  for (const r of ROWS) {
    const got = api.classify(r.body);
    assert.ok(got.reason && typeof got.reason === 'string', `${r.name}: reason missing`);
    assert.ok(api.KINDS.includes(got.kind), `${r.name}: ${got.kind} is not a declared kind`);
  }
});

// ── delegation, not a private regex ──────────────────────────────
test('VAST recognition delegates to the core detector when it is loaded', () => {
  const withCore = loadClassifier({ withVastCore: true });
  const got = withCore.api.classify('<VAST version="3.0"><Ad/></VAST>');
  assert.equal(got.kind, 'vast');
  assert.equal(got.reason, 'core isVastShape', 'must take the delegated path, not the fallback');
});

test('a page missing the core detector still recognises VAST, and says so', () => {
  const withoutCore = loadClassifier();
  const got = withoutCore.api.classify('<VAST version="3.0"><Ad/></VAST>');
  assert.equal(got.kind, 'vast');
  assert.match(got.reason, /fallback/, 'the fallback must be identifiable in the reason');
});

// ── structural: this module reaches no network, ever ─────────────
test('the classifier adheres to the zero-network policy', () => {
  const raw = fs.readFileSync(
    path.join(ROOT, 'public/modules/inspector/creative-classify.js'),
    'utf8',
  );
  const code = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  assert.doesNotMatch(code, /\bfetch\s*\(/, 'must not call fetch()');
  assert.doesNotMatch(code, /\bXMLHttpRequest\b/, 'must not use XMLHttpRequest');
  assert.doesNotMatch(code, /\bnew\s+Image\s*\(/, 'must not create Image objects');
  assert.doesNotMatch(code, /\bsendBeacon\s*\(/, 'must not call sendBeacon()');
  assert.doesNotMatch(code, /\bimport\s*\(/, 'must not dynamically import');
});
