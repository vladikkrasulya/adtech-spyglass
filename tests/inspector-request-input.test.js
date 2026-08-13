'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserEsmLoader } = require('./browser-esm-loader');

async function loadSubject(salt) {
  const loader = createBrowserEsmLoader({ realmSalt: salt });
  return loader.import('/modules/inspector/request-input.js');
}

test('Inspector request input preserves a raw legacy-feed URL across History', async () => {
  const { parseRequestInput, serializeRequestInput } = await loadSubject(
    'inspector-request-input-url',
  );
  const raw =
    '  http://feed.example/search?feed=123&auth=redacted&url=https%3A%2F%2Fpublisher.example  ';

  const parsed = parseRequestInput(raw);
  assert.equal(
    parsed,
    'http://feed.example/search?feed=123&auth=redacted&url=https%3A%2F%2Fpublisher.example',
  );
  assert.equal(serializeRequestInput(parsed), parsed, 'History must not add JSON string quotes');
  assert.equal(parseRequestInput(serializeRequestInput(parsed)), parsed);
});

test('Inspector request input still parses and pretty-prints OpenRTB JSON', async () => {
  const { parseRequestInput, serializeRequestInput } = await loadSubject(
    'inspector-request-input-json',
  );
  const parsed = parseRequestInput('{"id":"r1","imp":[]}');

  assert.deepEqual(parsed, { id: 'r1', imp: [] });
  assert.equal(serializeRequestInput(parsed), '{\n  "id": "r1",\n  "imp": []\n}');
});

test('Inspector request input rejects malformed non-URL text', async () => {
  const { parseRequestInput } = await loadSubject('inspector-request-input-invalid');
  assert.throws(() => parseRequestInput('not JSON and not a URL'), SyntaxError);
});

test('a mangled URL still routes as a URL request instead of aborting the analysis', async () => {
  // The adversarial review of the first version caught this as a regression:
  // a wrapped copy-paste with a space, or a bare "http://", threw SyntaxError
  // from the FIRST line of runAnalysis — so the response pane's findings and
  // the history entry were lost, and the toast blamed JSON for a URL. The
  // baseline passed anything /^https?:\/\//i through verbatim and let the
  // server render a verdict about it. Routing must stay that permissive;
  // only the BADGE uses the strict well-formedness test.
  const { parseRequestInput, isUrlLikeInput, isHttpUrlInput } = await loadSubject(
    'inspector-request-input-mangled',
  );
  const mangled = 'http://feed vendor.example/link?format=json&feed=1&auth=t';
  assert.equal(parseRequestInput(mangled), mangled, 'must pass through, not throw');
  assert.equal(parseRequestInput('http://'), 'http://');
  assert.equal(isUrlLikeInput(mangled), true);
  assert.equal(isHttpUrlInput(mangled), false, 'strict test still calls it malformed');
});

test('History round-trips a JSON string scalar without corrupting it', async () => {
  // serializeRequestInput used to emit ANY string bare, so the JSON scalar
  // "hello" was stored unquoted and its own History entry threw on reload.
  const { parseRequestInput, serializeRequestInput } = await loadSubject(
    'inspector-request-input-scalar',
  );
  for (const source of ['"hello"', '"ftp://h.example/link"', '"http://feed vendor.example/x"']) {
    const value = parseRequestInput(source);
    const stored = serializeRequestInput(value);
    assert.deepEqual(
      parseRequestInput(stored),
      value,
      `round trip corrupted ${source} → stored as ${stored}`,
    );
  }
  // A JSON string scalar that IS a URL may legitimately come back bare —
  // value-identical, which is what History promises.
  const urlScalar = parseRequestInput('"https://feed.example/link?a=1"');
  assert.equal(parseRequestInput(serializeRequestInput(urlScalar)), urlScalar);
});
