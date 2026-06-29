'use strict';

/**
 * source-map.js — JSON range mapper + URL query locator.
 * All ranges are UTF-16 [start,end) into the ORIGINAL text, so every test
 * asserts text.slice(range) equals the literal source token (quotes included
 * for keys/strings) — never a re-serialized value.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSourceMap,
  locateUrlParam,
  escapeToken,
  unescapeToken,
} = require('../packages/core/source-map');

const slice = (t, e, which) =>
  which === 'key' ? t.slice(e.keyStart, e.keyEnd) : t.slice(e.valueStart, e.valueEnd);

test('pointer escaping round-trips (RFC 6901)', () => {
  assert.equal(escapeToken('a/b~c'), 'a~1b~0c');
  assert.equal(unescapeToken('a~1b~0c'), 'a/b~c');
});

test('repeated key NAMES at different paths resolve independently', () => {
  const text = JSON.stringify(
    { id: 'root', imp: [{ id: 'imp-a' }, { id: 'imp-b' }], seatbid: [{ bid: [{ id: 'bid-x' }] }] },
    null,
    2,
  );
  const m = buildSourceMap(text);
  assert.ok(m.ok);
  assert.equal(slice(text, m.resolve('/id'), 'value'), '"root"');
  assert.equal(slice(text, m.resolve('/imp/0/id'), 'value'), '"imp-a"');
  assert.equal(slice(text, m.resolve('/imp/1/id'), 'value'), '"imp-b"');
  assert.equal(slice(text, m.resolve('/seatbid/0/bid/0/id'), 'value'), '"bid-x"');
});

test('arrays index correctly incl. nested', () => {
  const text = '{"a":[10,20,[30,40]]}';
  const m = buildSourceMap(text);
  assert.equal(slice(text, m.resolve('/a/0'), 'value'), '10');
  assert.equal(slice(text, m.resolve('/a/2/1'), 'value'), '40');
});

test('duplicate same-level keys → last wins (JSON.parse semantics)', () => {
  const text = '{"a":1,"a":2,"a":3}';
  const m = buildSourceMap(text);
  assert.equal(slice(text, m.resolve('/a'), 'value'), '3');
  // and the key range points at the LAST "a"
  assert.equal(text.slice(m.resolve('/a').keyStart, m.resolve('/a').keyEnd), '"a"');
  assert.equal(m.resolve('/a').keyStart, text.lastIndexOf('"a"'));
});

test('escaped unicode key + surrogate-pair value + slash key', () => {
  const text = '{"na\\u006de":"\\uD83D\\uDE00 \\"q\\"","a\\/b":7}';
  const m = buildSourceMap(text);
  // key decoded to "name" → pointer /name; key RANGE covers the raw escaped key token
  assert.equal(text.slice(m.resolve('/name').keyStart, m.resolve('/name').keyEnd), '"na\\u006de"');
  assert.equal(slice(text, m.resolve('/name'), 'value'), '"\\uD83D\\uDE00 \\"q\\""');
  // slash key → escaped pointer token
  assert.equal(slice(text, m.resolve('/a~1b'), 'value'), '7');
});

test('minified and pretty produce equivalent ranges for the same pointer', () => {
  const obj = { seatbid: [{ bid: [{ price: 1.25, impid: 'x' }] }] };
  const pretty = JSON.stringify(obj, null, 2);
  const min = JSON.stringify(obj);
  assert.equal(
    slice(pretty, buildSourceMap(pretty).resolve('/seatbid/0/bid/0/price'), 'value'),
    '1.25',
  );
  assert.equal(slice(min, buildSourceMap(min).resolve('/seatbid/0/bid/0/price'), 'value'), '1.25');
});

test('BOM is skipped', () => {
  const text = '﻿{"x":1}';
  const m = buildSourceMap(text);
  assert.ok(m.ok);
  assert.equal(slice(text, m.resolve('/x'), 'value'), '1');
});

test('node target spans the whole object/array', () => {
  const text = '{"imp":[{"id":"a"}]}';
  const m = buildSourceMap(text);
  assert.equal(slice(text, m.resolve('/imp'), 'value'), '[{"id":"a"}]');
  assert.equal(slice(text, m.resolve('/imp/0'), 'value'), '{"id":"a"}');
});

test('line/column are 1-based UTF-16 and correct across lines', () => {
  const text = '{\n  "a": 1,\n  "b": 2\n}';
  const m = buildSourceMap(text);
  const b = m.resolve('/b');
  const pos = m.positionAt(b.valueStart);
  assert.equal(pos.line, 3);
  assert.equal(text.split('\n')[pos.line - 1].slice(pos.col - 1, pos.col), '2');
});

test('invalid JSON → ok:false with offset/line/col, never throws', () => {
  for (const bad of ['{"x":}', '{"x" 1}', '[1,2', '{"a":1} trailing', 'nope', '']) {
    const m = buildSourceMap(bad);
    assert.equal(m.ok, false, bad);
    assert.equal(typeof m.error.offset, 'number');
    assert.ok(m.error.line >= 1 && m.error.col >= 1);
    assert.equal(m.resolve('/x'), null);
  }
});

test('control chars inside strings are tolerated (superset of JSON.parse)', () => {
  const text = '{"a":"line1\nline2"}'; // raw newline JSON.parse would reject
  const m = buildSourceMap(text);
  assert.ok(m.ok);
  assert.equal(slice(text, m.resolve('/a'), 'value'), '"line1\nline2"');
});

test('large payload builds in well under the 50ms budget', () => {
  const big = { imp: [] };
  for (let i = 0; i < 5000; i++) big.imp.push({ id: 'imp-' + i, bidfloor: i / 100, ext: { k: i } });
  const text = JSON.stringify(big, null, 2);
  const start = process.hrtime.bigint();
  const m = buildSourceMap(text);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(m.ok);
  assert.equal(slice(text, m.resolve('/imp/4999/id'), 'value'), '"imp-4999"');
  assert.ok(ms < 50, `tokenize took ${ms.toFixed(1)}ms (>50ms) for ${text.length} chars`);
});

test('URL locator returns exact raw ranges for present params; null otherwise', () => {
  const url = 'https://ssp.example/win?ch-model=&url=http%3A%2F%2Fx%3F&ch-uafull=%22147%22#frag';
  const m = locateUrlParam(url, 'url');
  assert.equal(url.slice(m.keyStart, m.keyEnd), 'url');
  assert.equal(url.slice(m.valStart, m.valEnd), 'http%3A%2F%2Fx%3F');
  const empty = locateUrlParam(url, 'ch-model');
  assert.equal(url.slice(empty.valStart, empty.valEnd), ''); // present but empty value
  assert.equal(locateUrlParam(url, 'device.ipv6'), null); // not a raw param → null (disabled)
  assert.equal(locateUrlParam('no-query-here', 'x'), null);
});
