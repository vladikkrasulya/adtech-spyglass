'use strict';

/**
 * tests/json-syntax.test.js — the payload editor's tokenizer, and specifically
 * the part of it that is not a tokenizer.
 *
 * WHAT IS ACTUALLY AT RISK HERE
 * -----------------------------
 * Colouring braces is not interesting and does not break. The oRTB SEMANTIC
 * layer is: it claims that a given key at a given depth is an auction join, or
 * money, or a creative, and every one of those claims is a small piece of
 * domain knowledge that a refactor can silently invert. A wrong claim is worse
 * than no claim — a reader who has learned that azure means "this id is joined
 * against the other payload" and then sees `site.publisher.id` in azure has
 * been taught to distrust the whole colour scheme.
 *
 * So the assertions below are mostly about CONTEXT: the same key name landing
 * in different categories depending on what encloses it, which is the reason
 * this module is a scanner with a stack instead of a set of regexes.
 *
 * The module is a browser IIFE attaching to window; we run it against a
 * minimal stub, the same way tests/source-nav-i18n.test.js does.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'public/modules/inspector/json-syntax.js'),
  'utf8',
);

function load() {
  const win = {};
  new Function('window', SRC)(win);
  return win.OrtbtoolsJsonSyntax;
}
const LIB = load();

/** Tokens keyed by the exact source text they cover — the readable way to
 *  assert "this key got this class" without hard-coding offsets. */
function classesOf(text) {
  const out = {};
  for (const t of LIB.tokenize(text)) {
    const raw = text.slice(t.s, t.e);
    (out[raw] = out[raw] || []).push(t.c);
  }
  return out;
}
const PRETTY = (o) => JSON.stringify(o, null, 2);

// ── the structural invariants everything else rests on ─────────────────────

test('tokens are ascending, non-overlapping and inside the text', () => {
  const text = PRETTY({
    id: 'r1',
    imp: [{ id: '1', bidfloor: 1.5, banner: { w: 300, h: 250 }, secure: true }],
    cur: ['USD'],
    ext: { vendor: { x: null } },
  });
  const toks = LIB.tokenize(text);
  assert.ok(toks.length > 0);
  let prev = -1;
  for (const t of toks) {
    assert.ok(t.s >= prev, 'ascending');
    assert.ok(t.e > t.s, 'non-empty');
    assert.ok(t.e <= text.length, 'inside the text');
    prev = t.e;
  }
});

test('a long value is ONE token — a 13KB VAST in adm must not cost 13k nodes', () => {
  const vast = '<VAST version="4.0">' + 'x'.repeat(13000) + '</VAST>';
  const text = PRETTY({ seatbid: [{ bid: [{ adm: vast, price: 1 }] }] });
  const toks = LIB.tokenize(text);
  const admValue = toks.find((t) => t.e - t.s > 13000);
  assert.ok(admValue, 'the creative is a single token');
  assert.ok(admValue.c.includes('jt-creative'), 'and it is marked as the creative');
  // The whole response is a couple of dozen tokens, not thousands. This is the
  // property that keeps the pathological real-world payload cheap.
  assert.ok(toks.length < 40, `expected a handful of tokens, got ${toks.length}`);
});

// ── context: the same name, different meanings ─────────────────────────────

test('`id` is a join key at the root and inside imp/bid/deals — and nowhere else', () => {
  const req = {
    id: 'AUCTION',
    imp: [{ id: 'IMPID', pmp: { deals: [{ id: 'DEALID' }] } }],
    site: { id: 'SITEID', publisher: { id: 'PUBID' } },
    user: { id: 'USERID' },
  };
  const text = PRETTY(req);
  const toks = LIB.tokenize(text);
  // Every `"id"` KEY token, in source order, paired with the value that follows.
  const idKeys = toks.filter((t) => text.slice(t.s, t.e) === '"id"');
  assert.equal(idKeys.length, 6);
  const linked = idKeys.map((t) => t.c.includes('jt-link'));
  assert.deepEqual(
    linked,
    [true, true, true, false, false, false],
    'root id, imp[].id and deals[].id join; site.id / publisher.id / user.id do not',
  );
  // …and the value inherits the key's meaning, since the value is what you read.
  const c = classesOf(text);
  assert.ok(c['"AUCTION"'][0].includes('jt-link'));
  assert.ok(c['"IMPID"'][0].includes('jt-link'));
  assert.ok(c['"SITEID"'][0] === 'jt-s', 'an ordinary id value stays an ordinary string');
});

test('w/h is a creative size under banner but hardware under device', () => {
  const text = PRETTY({
    imp: [{ banner: { w: 300, h: 250 } }],
    device: { w: 1920, h: 1080, geo: { lat: 1 } },
  });
  const c = classesOf(text);
  assert.ok(c['300'][0].includes('jt-shape'));
  assert.ok(c['250'][0].includes('jt-shape'));
  assert.equal(c['1920'][0], 'jt-n', 'device.w is a screen, not a creative size');
  assert.equal(c['1080'][0], 'jt-n');
});

test('ext is vendor territory all the way down — ext.price is not money', () => {
  const text = PRETTY({
    imp: [{ bidfloor: 2.5, ext: { prebid: { bidder: { price: 99, w: 1 } } } }],
  });
  const toks = LIB.tokenize(text);
  const keyClass = (name) => {
    const t = toks.find((x) => text.slice(x.s, x.e) === '"' + name + '"');
    return t ? t.c : null;
  };
  assert.ok(keyClass('bidfloor').includes('jt-money'), 'the real floor is money');
  assert.ok(keyClass('ext').includes('jt-vendor'));
  assert.ok(keyClass('prebid').includes('jt-vendor'));
  assert.ok(keyClass('price').includes('jt-vendor'), 'ext.….price is NOT the auction price');
  assert.ok(!keyClass('price').includes('jt-money'));
  assert.ok(keyClass('w').includes('jt-vendor'), 'and ext.….w is not a creative size');
  // The DATA inside a vendor blob keeps its ordinary colour — dimming the
  // labels says "non-spec"; dimming the values too would make the one
  // readable thing in a vendor blob unreadable.
  const c = classesOf(text);
  assert.equal(c['99'][0], 'jt-n');
});

test('a category reaches scalar values and array elements, but not object subtrees', () => {
  const text = PRETTY({
    bcat: ['IAB25', 'IAB26'],
    cur: ['USD'],
    imp: [{ banner: { w: 300, pos: 3 } }],
  });
  const c = classesOf(text);
  // array of scalars: every element carries the key's meaning
  assert.ok(c['"IAB25"'][0].includes('jt-brand'));
  assert.ok(c['"IAB26"'][0].includes('jt-brand'));
  assert.ok(c['"USD"'][0].includes('jt-money'));
  // object subtree: the KEY is marked, the contents are not blanket-coloured
  const toks = LIB.tokenize(text);
  const banner = toks.find((t) => text.slice(t.s, t.e) === '"banner"');
  assert.ok(banner.c.includes('jt-shape'));
  assert.equal(c['3'][0], 'jt-n', 'banner.pos is not itself a shape field');
});

// ── error tolerance: the editor's normal condition ─────────────────────────

test('broken payloads still tokenize — that is when highlighting matters most', () => {
  const cases = [
    '{"id": "unterminated',
    '{"id": "a", "imp": [{"id": ',
    '{{{{[[[["id"',
    '}}}]]] "price": 5.75',
    '{"a": 1,,,, "price": 2}',
    '{"a": @@@ "price": 3}',
    '',
    '   \n\n\t  ',
    'not json at all',
  ];
  for (const text of cases) {
    const toks = LIB.tokenize(text); // must not throw
    assert.ok(Array.isArray(toks), `array for ${JSON.stringify(text)}`);
    let prev = -1;
    for (const t of toks) {
      assert.ok(t.s >= prev && t.e > t.s && t.e <= text.length, `sane token in ${text}`);
      prev = t.e;
    }
  }
});

test('an unbalanced closer never pops past the root, so later keys still classify', () => {
  // A stray `}` early on must not throw the stack away — everything after it
  // would then be read at a bogus depth and coloured wrongly.
  const text = '{ "a": 1 } } } "price": 5.75, "imp": [{ "id": "1" }]';
  const c = classesOf(text);
  assert.ok(c['"price"'][0].includes('jt-money'));
  assert.ok(c['"id"'][0].includes('jt-link'));
});

test('a key is only a key where a key can appear — the same word as a VALUE is a string', () => {
  const text = PRETTY({ note: 'price', tags: ['adm', 'bidfloor'] });
  const c = classesOf(text);
  assert.equal(c['"price"'][0], 'jt-s', 'a string that says "price" is not the price field');
  assert.equal(c['"adm"'][0], 'jt-s');
  assert.equal(c['"bidfloor"'][0], 'jt-s');
});

// ── the size ceiling ───────────────────────────────────────────────────────

test('past the ceiling tokenize() returns null — a signal, not an empty result', () => {
  // null and [] must stay distinguishable: [] means "nothing to colour here",
  // null means "we refused", and only the second one gets a notice in the UI.
  assert.deepEqual(LIB.tokenize(''), []);
  const big = '{"a":"' + 'x'.repeat(LIB.MAX_CHARS + 10) + '"}';
  assert.equal(LIB.tokenize(big), null);
  const justUnder = '{"a":1}'.padEnd(LIB.MAX_CHARS - 1, ' ');
  assert.ok(Array.isArray(LIB.tokenize(justUnder)));
});

test('tokenize() is total — non-strings do not throw', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.deepEqual(LIB.tokenize(/** @type {any} */ (bad)), []);
  }
});
