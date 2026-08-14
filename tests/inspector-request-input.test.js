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
  // server render a verdict about it. Routing must stay that permissive, and
  // the badge now reports that routing rather than second-guessing it.
  const { parseRequestInput, isUrlLikeInput, inputBadgeState } = await loadSubject(
    'inspector-request-input-mangled',
  );
  const mangled = 'http://feed vendor.example/link?format=json&feed=1&auth=t';
  assert.equal(parseRequestInput(mangled), mangled, 'must pass through, not throw');
  assert.equal(parseRequestInput('http://'), 'http://');
  assert.equal(isUrlLikeInput(mangled), true);
  // A mangled URL reads as a URL request because that is what it becomes. The
  // verdict about how mangled it is comes from the server, with the bytes.
  assert.equal(inputBadgeState(mangled, { allowUrl: true }).kind, 'url');
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

// F-01 — the browser's URL gate was strictly narrower than the server's repair
// contract (packages/core/decoders/request/_input-repair.js), so most repair
// steps were unreachable from the UI. `isUrlLikeInput` only matched
// `^https?://` on the TRIMMED string, but three of repairInput()'s six steps —
// invisible_chars, wrappers, scheme — exist precisely for text that does not
// start with a scheme. Each input below was measured: rejected by the old
// client gate, repaired correctly by the server. The user saw
// `Unexpected token '<', "<https://f"... is not valid JSON` instead of a
// verdict about their URL, and only trailing_punctuation and html_amp were
// reachable at all.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const REPAIRABLE_SHAPES = [
  ['feed.vendor.example/search?a=1', 'scheme'],
  ['//feed.vendor.example/search?a=1', 'scheme'],
  ['<https://feed.vendor.example/search?a=1>', 'wrappers'],
  ['[feed](https://feed.vendor.example/search?a=1)', 'wrappers'],
  // trim() does not strip U+200B — it is not whitespace in ECMAScript, which
  // is exactly why the old gate missed this one.
  [`${ZERO_WIDTH_SPACE}https://feed.vendor.example/search?a=1`, 'invisible_chars'],
];

test('routing reaches every shape the server repair contract accepts', async () => {
  const { parseRequestInput, isUrlLikeInput } = await loadSubject('inspector-request-input-repair');
  const { repairInput } = require('../packages/core/decoders/request/_input-repair');

  for (const [input, step] of REPAIRABLE_SHAPES) {
    assert.equal(isUrlLikeInput(input), true, `client gate still rejects ${JSON.stringify(input)}`);
    // Verbatim, not normalised: the server owns the repair, and `repairs[0]
    // .before` has to stay the operator's own bytes so the UI can show them
    // what was removed.
    assert.equal(parseRequestInput(input), input, `must not throw for ${JSON.stringify(input)}`);

    const { text, repairs } = repairInput(input);
    assert.equal(text, 'https://feed.vendor.example/search?a=1', `server repair of ${input}`);
    assert.ok(
      repairs.some((r) => r.step === step),
      `expected the ${step} step to fire for ${JSON.stringify(input)}`,
    );
  }
});

test('widening the URL gate does not steal text that meant to be JSON', async () => {
  // The routing test is permissive on purpose, so the interesting cases are
  // the ones where a JSON paste fails to parse for an unrelated reason: the
  // user debugging a trailing comma must get the JSON syntax error, never a
  // confusing URL verdict. A bare dotted token is the other trap — the repair
  // contract would happily prepend a scheme to `request.json`, so the client
  // additionally requires a marker prose does not carry (`//`, `:port`, or a
  // `/` `?` `#` delimiter).
  const { parseRequestInput, isUrlLikeInput } = await loadSubject(
    'inspector-request-input-json-guard',
  );

  const mustStayJson = [
    '{"id":"r1","imp":[]', // truncated object
    '{"id":"r1",}', // trailing comma
    '[{"id":1},]', // trailing comma in an array
    "{id: 'r1'}", // JS object literal, not JSON
    '"id":"r1","imp":[]', // fragment pasted without its braces
    `${ZERO_WIDTH_SPACE}{"id":"r1",}`, // invisible char AND broken JSON
    'request.json', // a filename
    '2.5.1', // a version
    'req.imp.0.banner', // a field path
    'SELECT * FROM bids;',
    '// TODO: fix the feed', // a code comment
    '12:30', // not a host:port
    'NaN',
  ];

  for (const source of mustStayJson) {
    assert.equal(isUrlLikeInput(source), false, `routed as URL: ${JSON.stringify(source)}`);
    assert.throws(
      () => parseRequestInput(source),
      SyntaxError,
      `should have stayed a JSON error: ${JSON.stringify(source)}`,
    );
  }

  // Obvious JSON keeps winning outright — JSON.parse runs first.
  assert.deepEqual(parseRequestInput('{"id":"r1","imp":[]}'), { id: 'r1', imp: [] });
  assert.deepEqual(parseRequestInput('[1,2]'), [1, 2]);
});

test('the widened gate keeps serialize/parse symmetrical across History', async () => {
  // The invariant that makes the two functions symmetrical by construction:
  // everything isUrlLikeInput() accepts is text JSON.parse rejects. Break it
  // and a stored bare string reloads as a DIFFERENT value — the bug the file
  // header warns about. `"//a.b/c"` and `"1.5"` are the shapes that would have
  // broken it had the double-quote wrapper been peeled like repairInput() does.
  const { parseRequestInput, serializeRequestInput } = await loadSubject(
    'inspector-request-input-symmetry',
  );

  const sources = [
    ...REPAIRABLE_SHAPES.map(([input]) => input),
    '"//a.b/c"',
    '"1.5"',
    '"2.5.1"',
    '"request.json"',
    '"feed.example/x?a=1"',
    '1.5',
    '{"id":"r1","imp":[]}',
  ];

  for (const source of sources) {
    const value = parseRequestInput(source);
    const stored = serializeRequestInput(value);
    assert.deepEqual(
      parseRequestInput(stored),
      value,
      `round trip corrupted ${JSON.stringify(source)} → stored as ${JSON.stringify(stored)}`,
    );
  }
});

test('the badge reads invalid exactly when the router rejects the text', async () => {
  // The badge used to run its own stricter judgement (`isHttpUrlInput`: the
  // routing test, then a strict `new URL()` on the text AS TYPED). It had one
  // caller — the badge — and it disagreed with the judgement the app acts on,
  // so six of the shapes below read "invalid" while analysing as clean URL
  // requests. The operator was told the paste was broken and then watched it
  // work.
  //
  // Mirroring repairInput() into the browser and re-testing the REPAIRED text
  // was measured as the alternative: it fixes five and leaves `ftp://`
  // disagreeing, since that one is routed to the server precisely so the
  // server can answer about the scheme. So the second judgement is gone rather
  // than mirrored.
  //
  // Derived, not restated: the expected badge kind is read off the router for
  // each input. A hand-written table of expected kinds would be another record
  // describing behaviour it is never checked against — the defect this
  // replaced, wearing the test's hat.
  const { parseRequestInput, inputBadgeState } = await loadSubject(
    'inspector-request-input-badge-router',
  );

  const corpus = [
    ...REPAIRABLE_SHAPES.map(([input]) => input),
    'https://feed.example/search?x=1',
    'ftp://h.example/link',
    'http://feed vendor.example/link?a=1',
    'http://',
    'request.json',
    '2.5.1',
    '12:30',
    'NaN',
    'SELECT * FROM bids;',
    '// TODO: fix the feed',
    '{"id":"r1",}',
    '{"id":"r1","imp":[]}',
    '[1,2]',
    '"hello"',
    '"https://feed.example/link?a=1"',
    '1.5',
  ];

  for (const input of corpus) {
    let routerAccepts = true;
    try {
      parseRequestInput(input);
    } catch {
      routerAccepts = false;
    }

    const kind = inputBadgeState(input, { allowUrl: true }).kind;
    assert.equal(
      kind === 'invalid',
      !routerAccepts,
      `badge says "${kind}" but the router ${routerAccepts ? 'accepts' : 'rejects'} ` +
        JSON.stringify(input),
    );
  }

  // The two accepting kinds stay distinguishable — agreeing with the router is
  // the invariant, but the badge must still tell JSON from a URL request.
  assert.equal(inputBadgeState('https://feed.example/search?x=1', { allowUrl: true }).kind, 'url');
  assert.equal(inputBadgeState('{"id":"r1","imp":[]}', { allowUrl: true }).kind, 'valid');
  // A quoted URL is a JSON string scalar and must read as JSON, not as a URL —
  // the History round-trip above depends on that branch, not on this one.
  assert.equal(
    inputBadgeState('"https://feed.example/link?a=1"', { allowUrl: true }).kind,
    'valid',
  );
  // Without allowUrl the URL branch is unreachable and a URL is just bad JSON.
  assert.equal(inputBadgeState('https://feed.example/search?x=1').kind, 'invalid');
});

test('a non-http scheme reaches the server so it can answer about the scheme', async () => {
  // detect.js routes `unsupported_scheme` to URL_REQUEST on purpose — "the
  // operator typed `javascript:`/`mailto:`/`ftp:` themselves; answering about
  // the scheme beats answering about JSON". The old `^https?://` gate made
  // that answer unreachable: `ftp://h.example/link` died as a JSON error.
  const { parseRequestInput, inputBadgeState } = await loadSubject(
    'inspector-request-input-scheme',
  );

  assert.equal(parseRequestInput('ftp://h.example/link'), 'ftp://h.example/link');
  // The badge says "URL request" because that is exactly what the app is about
  // to make of it. Whether the scheme is supported is the server's answer, and
  // it is a better one than a red chip: `unsupported_scheme`, with the bytes.
  assert.equal(inputBadgeState('ftp://h.example/link', { allowUrl: true }).kind, 'url');
});
