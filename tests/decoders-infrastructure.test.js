'use strict';

/**
 * Tests for the decoder infrastructure (registry + canonical shape).
 * These test the contracts, not any specific decoder — those land in
 * their own test files as decoders are added.
 *
 * Privacy: all fixtures are synthetic. Never paste partner-supplied
 * feed IDs, auth tokens, or credentials here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeCanonical,
  makeItem,
  decoderError,
} = require('@kyivtech/spyglass-core/decoders/_canonical');
const decoders = require('@kyivtech/spyglass-core/decoders');

// ── Canonical shape ─────────────────────────────────────────────────────────

test('makeCanonical: returns the expected envelope', () => {
  const c = makeCanonical('demo-variant', 'json');
  assert.equal(c.variant, 'demo-variant');
  assert.equal(c.meta.rawFormat, 'json');
  assert.equal(c.meta.detectedVariant, 'demo-variant');
  assert.deepEqual(c.items, []);
});

test('makeItem: parses bid + preserves _raw', () => {
  const item = makeItem({
    bid: '0.0123',
    clickUrl: 'https://example.test/click',
    impressionUrl: 'https://example.test/pixel',
    _raw: { foo: 'bar' },
  });
  assert.equal(item.bid, 0.0123);
  assert.equal(item.clickUrl, 'https://example.test/click');
  assert.equal(item.impressionUrl, 'https://example.test/pixel');
  assert.deepEqual(item._raw, { foo: 'bar' });
});

test('makeItem: optional fields copied only when non-empty', () => {
  const item = makeItem({
    bid: 0.01,
    clickUrl: 'x',
    title: 'Hello',
    description: '', // empty — should NOT appear
    image: undefined, // undefined — should NOT appear
    icon: 'https://example.test/icon.png',
  });
  assert.equal(item.title, 'Hello');
  assert.ok(!('description' in item), 'empty description omitted');
  assert.ok(!('image' in item), 'undefined image omitted');
  assert.equal(item.icon, 'https://example.test/icon.png');
});

test('makeItem: throws on missing required fields', () => {
  // Each case intentionally passes a malformed arg — cast as any so
  // tsc doesn't refuse to compile the deliberate-bad-input test.
  const bad = /** @type {any} */ (makeItem);
  assert.throws(() => bad({ clickUrl: 'x' }), /bid/);
  assert.throws(() => bad({ bid: 'not-a-number', clickUrl: 'x' }), /bid/);
  assert.throws(() => bad({ bid: 0.01 }), /clickUrl/);
  assert.throws(() => bad({ bid: 0.01, clickUrl: '' }), /clickUrl/);
});

test('decoderError: returns structured rejection', () => {
  const e = decoderError('item_malformed', 'bid was a string banana');
  assert.equal(e.ok, false);
  assert.equal(e.reason, 'item_malformed');
  assert.equal(e.detail, 'bid was a string banana');
});

// ── Registry dispatch ──────────────────────────────────────────────────────

test('decode: null for empty/non-string payload', () => {
  // Each non-string is intentional. Cast so tsc accepts the deliberate
  // bad-input check.
  const dec = /** @type {any} */ (decoders.decode);
  assert.equal(dec(''), null);
  assert.equal(dec(null), null);
  assert.equal(dec(undefined), null);
  assert.equal(dec(42), null);
});

test('decode: null when no decoder claims the payload (empty DECODERS)', () => {
  // Phase A ships with zero decoders registered. Any input should
  // return null until a decoder lands.
  assert.equal(decoders.decode('<result><link bid="0.01" url="x" /></result>'), null);
  assert.equal(decoders.decode('{"Response":[]}'), null);
});

test('listDecoders: returns array (empty in Phase A)', () => {
  const list = decoders.listDecoders();
  assert.ok(Array.isArray(list));
});

// ── Sniffer + XML walker (internal helpers) ────────────────────────────────

test('_sniffFormat: detects XML by leading <', () => {
  assert.equal(decoders._sniffFormat('<result>x</result>'), 'xml');
  assert.equal(decoders._sniffFormat('  <?xml version="1.0"?> <result/>'), 'xml');
});

test('_sniffFormat: detects JSON otherwise', () => {
  assert.equal(decoders._sniffFormat('{"x":1}'), 'json');
  assert.equal(decoders._sniffFormat('[1,2,3]'), 'json');
});

test('_xmlShallowParse: extracts root + self-closing children with attrs', () => {
  const parsed = /** @type {any} */ (
    decoders._xmlShallowParse('<result><link bid="0.01" url="https://example.test/x" /></result>')
  );
  assert.equal(parsed.root, 'result');
  assert.equal(parsed.children.length, 1);
  assert.equal(parsed.children[0].tag, 'link');
  assert.equal(parsed.children[0].attrs.bid, '0.01');
  assert.equal(parsed.children[0].attrs.url, 'https://example.test/x');
});

test('_xmlShallowParse: strips xml declaration', () => {
  const parsed = /** @type {any} */ (
    decoders._xmlShallowParse(
      '<?xml version="1.0" encoding="UTF-8"?><result><link bid="0.1" url="x" /></result>',
    )
  );
  assert.equal(parsed.root, 'result');
  assert.equal(parsed.children[0].attrs.bid, '0.1');
});

test('_xmlShallowParse: multiple self-closing children', () => {
  const parsed = /** @type {any} */ (
    decoders._xmlShallowParse(
      '<result><link bid="0.01" url="a" /><link bid="0.02" url="b" /></result>',
    )
  );
  assert.equal(parsed.children.length, 2);
  assert.equal(parsed.children[0].attrs.url, 'a');
  assert.equal(parsed.children[1].attrs.url, 'b');
});

test('_xmlShallowParse: different child tag name (e.g. <listing>)', () => {
  const parsed = /** @type {any} */ (
    decoders._xmlShallowParse('<result><listing title="Hello" bid="0.5" url="x" /></result>')
  );
  assert.equal(parsed.children[0].tag, 'listing');
  assert.equal(parsed.children[0].attrs.title, 'Hello');
});
