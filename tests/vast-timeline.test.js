'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const MODULE_DIR = path.join(ROOT, 'packages/core/vast-timeline');
const REAL_VAST_FILES = [
  'samples/synthetic-vast-clean-inline.json',
  'samples/synthetic-vast-broken-inline.json',
  'samples/synthetic-vast-insecure-wrapper.json',
  'samples/synthetic-vast-vpaid-deprecated.json',
];

function loadModule() {
  return require('../packages/core/vast-timeline');
}

function readAdm(relativeFilename) {
  const payload = JSON.parse(fs.readFileSync(path.join(ROOT, relativeFilename), 'utf8'));
  return payload.seatbid[0].bid[0].adm;
}

function assertRichError(result, expectedCode) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, expectedCode);
  assert.equal(typeof result.error.message, 'string');
  assert.ok(result.error.message.length > 40);
  assert.equal(typeof result.error.expected, 'string');
  assert.ok(result.error.expected.length > 0);
  assert.equal(typeof result.error.spec, 'string');
  assert.equal(typeof result.error.offset, 'number');
  assert.equal(typeof result.error.line, 'number');
  assert.equal(typeof result.error.column, 'number');
  assert.equal(typeof result.error.excerpt, 'string');
  assert.match(result.error.excerpt, /\^/);
}

const TRAP_VAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.2">
  <Ad id="ad-1" sequence="1">
    <InLine>
      <Impression id="imp-a"><![CDATA[
        https://track.example/impression?a=1&b=2
      ]]></Impression>
      <Impression> https://track.example/impression?a=1&amp;b=2 </Impression>
      <Creatives>
        <Creative id="creative-1">
          <Linear>
            <Duration>00:00:20</Duration>
            <TrackingEvents>
              <Tracking event="complete"><![CDATA[ https://track.example/complete?a=1&b=2 ]]></Tracking>
              <Tracking event="progress" offset="25%"> https://track.example/progress-quarter?a=1&amp;b=2 </Tracking>
              <Tracking event="start"><![CDATA[
                https://track.example/start?a=1&b=2
              ]]></Tracking>
              <Tracking event="progress" offset="00:00:03.500"><![CDATA[ https://track.example/progress-3s ]]></Tracking>
              <Tracking event="firstQuartile">https://track.example/q1</Tracking>
              <Tracking event="midpoint">https://track.example/mid</Tracking>
              <Tracking event="thirdQuartile">https://track.example/q3</Tracking>
              <Tracking event="start">https://track.example/start?a=1&amp;b=2</Tracking>
            </TrackingEvents>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="640" height="360"><![CDATA[
                https://cdn.example/video.mp4?a=1&b=2
              ]]></MediaFile>
            </MediaFiles>
            <VideoClicks>
              <ClickThrough id="landing"> https://brand.example/?a=1&amp;b=2 </ClickThrough>
              <ClickTracking><![CDATA[ https://track.example/click?a=1&b=2 ]]></ClickTracking>
              <CustomClick> https://track.example/custom </CustomClick>
            </VideoClicks>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

test('extracts inline structure, trims CDATA, decodes entities, and preserves duplicates', () => {
  const { parseVastTimeline } = loadModule();
  const result = parseVastTimeline(TRAP_VAST);

  assert.equal(result.ok, true);
  assert.equal(result.version, '4.2');
  assert.equal(result.ads.length, 1);
  const ad = result.ads[0];
  assert.equal(ad.id, 'ad-1');
  assert.equal(ad.sequence, '1');
  assert.equal(ad.type, 'inline');
  assert.equal(ad.duration, '00:00:20');
  assert.equal(ad.durationSeconds, 20);
  assert.deepEqual(ad.impressions, [
    { id: 'imp-a', url: 'https://track.example/impression?a=1&b=2' },
    { id: null, url: 'https://track.example/impression?a=1&b=2' },
  ]);
  assert.deepEqual(
    ad.trackingEvents.find((group) => group.event === 'start'),
    {
      event: 'start',
      offset: null,
      urls: ['https://track.example/start?a=1&b=2', 'https://track.example/start?a=1&b=2'],
    },
  );
  assert.deepEqual(ad.videoClicks, {
    clickThrough: [{ id: 'landing', url: 'https://brand.example/?a=1&b=2' }],
    clickTracking: [{ id: null, url: 'https://track.example/click?a=1&b=2' }],
    customClick: [{ id: null, url: 'https://track.example/custom' }],
  });
  assert.deepEqual(ad.mediaFiles, [
    {
      url: 'https://cdn.example/video.mp4?a=1&b=2',
      attributes: {
        delivery: 'progressive',
        height: '360',
        type: 'video/mp4',
        width: '640',
      },
    },
  ]);
  assert.equal(ad.vastAdTagUri, null);
});

test('timeline is chronological and deterministic, including progress offsets', () => {
  const { parseVastTimeline } = loadModule();
  const first = parseVastTimeline(TRAP_VAST);
  assert.deepEqual(
    first.timeline.map(({ event, offset, timeSeconds }) => ({ event, offset, timeSeconds })),
    [
      { event: 'start', offset: null, timeSeconds: 0 },
      { event: 'progress', offset: '00:00:03.500', timeSeconds: 3.5 },
      { event: 'firstQuartile', offset: null, timeSeconds: 5 },
      { event: 'progress', offset: '25%', timeSeconds: 5 },
      { event: 'midpoint', offset: null, timeSeconds: 10 },
      { event: 'thirdQuartile', offset: null, timeSeconds: 15 },
      { event: 'complete', offset: null, timeSeconds: 20 },
    ],
  );
  const expected = JSON.stringify(first);
  for (let attempt = 0; attempt < 25; attempt++) {
    assert.equal(JSON.stringify(parseVastTimeline(TRAP_VAST)), expected);
  }
});

test('namespace declarations never shadow real tracking attributes', () => {
  const { parseVastTimeline } = loadModule();
  const result = parseVastTimeline(`<VAST version="4.2"><Ad><InLine>
    <Creatives><Creative><Linear><Duration>00:00:08</Duration><TrackingEvents>
      <Tracking xmlns:event="urn:x" event="start">https://track.example/start</Tracking>
    </TrackingEvents></Linear></Creative></Creatives>
  </InLine></Ad></VAST>`);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ads[0].trackingEvents, [
    { event: 'start', offset: null, urls: ['https://track.example/start'] },
  ]);
  assert.equal(result.timeline[0].event, 'start');
  assert.equal(result.timeline[0].timeSeconds, 0);
});

test('trims both percentage and clock progress offsets before grouping and timing', () => {
  const { parseVastTimeline } = loadModule();
  const result = parseVastTimeline(`<VAST version="4.2"><Ad><InLine>
    <Creatives><Creative><Linear><Duration>00:00:20</Duration><TrackingEvents>
      <Tracking event="progress" offset=" 25% ">https://track.example/percent</Tracking>
      <Tracking event="progress" offset=" 00:00:05 ">https://track.example/clock</Tracking>
    </TrackingEvents></Linear></Creative></Creatives>
  </InLine></Ad></VAST>`);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.timeline.map(({ offset, timeSeconds }) => ({ offset, timeSeconds })),
    [
      { offset: '00:00:05', timeSeconds: 5 },
      { offset: '25%', timeSeconds: 5 },
    ],
  );
});

test('accepts legal non-ASCII XML names without losing extracted VAST fields', () => {
  const { parseVastTimeline } = loadModule();
  const result = parseVastTimeline(`<VAST version="4.2"><Ad><InLine>
    <Impression>https://track.example/impression</Impression>
    <Extensions><Größe><Значення>ok</Значення></Größe></Extensions>
  </InLine></Ad></VAST>`);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ads[0].impressions, [
    { id: null, url: 'https://track.example/impression' },
  ]);
});

test('keeps parsing known permissive XML deviations and explains each one', () => {
  const { parseVastTimeline } = loadModule();
  const xml = `<VAST version="4.2"><Ad id="a"sequence="2"><InLine>
    <Impression>https://track.example/impression</Impression>
    <Extensions><Extension>&#1;&#xB;&#xFFFE;&#X26;</Extension></Extensions>
    <Creatives><Creative><Linear><Duration>00:00:10</Duration>
      <TrackingEvents><Tracking event="start">https://track.example/start</Tracking></TrackingEvents>
      <MediaFiles><MediaFile label="a
b" referenced="a&#10;b">https://cdn.example/video.mp4</MediaFile></MediaFiles>
    </Linear></Creative></Creatives>
  </InLine></Ad></VAST>`;
  const result = parseVastTimeline(xml);

  assert.equal(result.ok, true);
  assert.equal(result.ads[0].id, 'a');
  assert.equal(result.ads[0].sequence, '2');
  assert.equal(result.ads[0].mediaFiles[0].attributes.label, 'a b');
  assert.equal(result.ads[0].mediaFiles[0].attributes.referenced, 'a\nb');
  assert.deepEqual(
    result.notes.map((note) => note.code),
    [
      'vast.note.xml_attribute_separator_missing',
      'vast.note.xml_char_reference_nonconforming',
      'vast.note.xml_char_reference_uppercase_x',
      'vast.note.xml_attribute_whitespace_normalized',
    ],
  );
  assert.equal(JSON.stringify(parseVastTimeline(xml)), JSON.stringify(result));
});

test('explains an Ad containing both InLine and Wrapper without hiding the chosen branch', () => {
  const { parseVastTimeline } = loadModule();
  const result = parseVastTimeline(`<VAST version="4.2"><Ad id="both">
    <InLine><Impression>https://track.example/inline</Impression></InLine>
    <Wrapper><Impression>https://track.example/wrapper</Impression>
      <VASTAdTagURI>https://wrapper.example/vast</VASTAdTagURI>
    </Wrapper>
  </Ad></VAST>`);

  assert.equal(result.ok, true);
  assert.equal(result.ads[0].type, 'inline');
  assert.deepEqual(result.ads[0].impressions, [{ id: null, url: 'https://track.example/inline' }]);
  assert.deepEqual(result.ads[0].vastAdTagUri, {
    url: 'https://wrapper.example/vast',
    unresolved: true,
  });
  assert.ok(result.notes.some((note) => note.code === 'vast.note.ad_branches_conflict'));
});

test('wrapper URI is recorded as unresolved and is never resolved', () => {
  const { parseVastTimeline } = loadModule();
  const result = parseVastTimeline(readAdm('samples/synthetic-vast-insecure-wrapper.json'));
  assert.equal(result.ok, true);
  assert.equal(result.ads[0].type, 'wrapper');
  assert.deepEqual(result.ads[0].vastAdTagUri, {
    url: 'http://wrap.legacy-ssp.example/vast?campaign=001',
    unresolved: true,
  });
  assert.deepEqual(result.ads[0].mediaFiles, []);
});

test('all four repository VAST samples return typed results without exceptions', () => {
  const { parseVastTimeline } = loadModule();
  for (const filename of REAL_VAST_FILES) {
    const xml = readAdm(filename);
    /** @type {any} */
    let result = null;
    assert.doesNotThrow(() => {
      result = parseVastTimeline(xml);
    }, filename);
    assert.equal(typeof result.ok, 'boolean', filename);
    if (result.ok) {
      assert.ok(Array.isArray(result.ads), filename);
      assert.ok(Array.isArray(result.timeline), filename);
      assert.ok(Array.isArray(result.notes), filename);
    } else {
      assert.equal(typeof result.error.message, 'string', filename);
      assert.equal(typeof result.error.offset, 'number', filename);
    }
  }

  const broken = parseVastTimeline(readAdm('samples/synthetic-vast-broken-inline.json'));
  assert.equal(broken.ok, true);
  assert.equal(broken.version, null);
  assert.equal(broken.ads[0].type, 'inline');
  assert.equal(broken.ads[0].mediaFiles.length, 0);
  assert.deepEqual(
    broken.notes.map((note) => note.code),
    ['vast.note.version_missing', 'vast.note.timeline_empty'],
  );
  const wrapper = parseVastTimeline(readAdm('samples/synthetic-vast-insecure-wrapper.json'));
  const vpaid = parseVastTimeline(readAdm('samples/synthetic-vast-vpaid-deprecated.json'));
  assert.deepEqual(
    wrapper.notes.map((note) => note.code),
    ['vast.note.timeline_empty'],
  );
  assert.deepEqual(
    vpaid.notes.map((note) => note.code),
    ['vast.note.timeline_empty'],
  );
});

test('exports a complete, deeply frozen diagnostic catalog with official references', () => {
  const { VAST_DIAGNOSTICS } = loadModule();
  assert.ok(Array.isArray(VAST_DIAGNOSTICS));
  assert.ok(Object.isFrozen(VAST_DIAGNOSTICS));

  const catalogCodes = [];
  for (const diagnostic of VAST_DIAGNOSTICS) {
    assert.ok(Object.isFrozen(diagnostic), diagnostic.code);
    assert.match(diagnostic.code, /^vast\.(?:input|xml|runtime|note)\.[a-z0-9_]+$/);
    assert.ok(diagnostic.message.length > 40, diagnostic.code);
    assert.ok(diagnostic.expected.trim(), diagnostic.code);
    const spec = new URL(diagnostic.spec);
    assert.ok(
      ['www.w3.org', 'iabtechlab.com', 'interactiveadvertisingbureau.github.io'].includes(
        spec.hostname,
      ),
      diagnostic.code,
    );
    const codeWords = diagnostic.code.split('.').slice(2).join(' ').replaceAll('_', ' ');
    assert.notEqual(diagnostic.message.toLowerCase(), codeWords, diagnostic.code);
    assert.match(diagnostic.message, /Found|result|timeline|durationSeconds/i, diagnostic.code);
    assert.match(
      diagnostic.message,
      /Write|Use|Pass|Load|Provide|Add|Reduce|Keep|Remove|Close|Replace|Supply|Treat/i,
      diagnostic.code,
    );
    catalogCodes.push(diagnostic.code);
  }
  assert.equal(new Set(catalogCodes).size, catalogCodes.length);

  const source = fs.readFileSync(path.join(MODULE_DIR, 'index.js'), 'utf8');
  const referencedCodes = [
    ...source.matchAll(/\b(?:fail|failure|note|makeNote)\(\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
  assert.deepEqual([...new Set(referencedCodes)].sort(), [...catalogCodes].sort());
});

test('distinguishes bare ampersands, unterminated entities, and unknown entities', () => {
  const { parseVastTimeline } = loadModule();
  const bareXml =
    '<VAST version="4.2">\r\n  <Ad><InLine><Impression>https://t/i?a=1&b=2</Impression></InLine></Ad>\r\n</VAST>';
  const bareOffset = bareXml.indexOf('&b=2');
  const bare = parseVastTimeline(bareXml);
  assertRichError(bare, 'vast.xml.bare_ampersand');
  assert.ok(Object.hasOwn(bare.error, 'message'));
  assert.ok(Object.hasOwn(bare.error, 'offset'));
  assert.equal(bare.error.offset, bareOffset);
  assert.equal(bare.error.line, 2);
  assert.equal(bare.error.column, bareOffset - bareXml.indexOf('\n'));
  assert.match(bare.error.message, /XML treats & as the start of an entity reference/i);
  assert.match(bare.error.message, /&amp;/);
  assert.match(bare.error.message, /CDATA/);

  const unterminated = parseVastTimeline(
    '<VAST><Ad><InLine><Impression>https://t/i?a=1&amp</Impression></InLine></Ad></VAST>',
  );
  assertRichError(unterminated, 'vast.xml.entity_unterminated');

  const unknown = parseVastTimeline(
    '<VAST><Ad><InLine><Impression>https://t/i?a=1&vendor;</Impression></InLine></Ad></VAST>',
  );
  assertRichError(unknown, 'vast.xml.entity_unknown');
});

test('reports 1-based CRLF locations and emits a bounded local excerpt', () => {
  const { parseVastTimeline } = loadModule();
  const xml = `<VAST version="4.2">\r\n<Ad>\r\n<InLine>${'x'.repeat(
    5_000,
  )}&bad=1</InLine>\r\n</Ad>\r\n</VAST>`;
  const offset = xml.indexOf('&bad=1');
  const result = parseVastTimeline(xml);
  assertRichError(result, 'vast.xml.bare_ampersand');
  assert.equal(result.error.offset, offset);
  assert.equal(result.error.line, 3);
  assert.equal(result.error.column, '<InLine>'.length + 5_000 + 1);
  assert.ok(result.error.excerpt.length <= 160);
  assert.ok(result.error.excerpt.includes('&bad=1'));
  assert.ok(!result.error.excerpt.includes(xml));
  assert.ok(!result.error.excerpt.includes('<VAST version'));
});

test('success notes explain only empty or degenerate extractor output', () => {
  const { parseVastTimeline } = loadModule();
  const clean = parseVastTimeline(readAdm('samples/synthetic-vast-clean-inline.json'));
  assert.deepEqual(clean.notes, []);

  const degenerate = parseVastTimeline(`<VAST>
    <Ad id="unknown" />
    <Ad id="relative"><InLine><Creatives><Creative><Linear>
      <Duration>thirty seconds</Duration>
      <TrackingEvents><Tracking event="start">https://t/start</Tracking></TrackingEvents>
    </Linear></Creative></Creatives></InLine></Ad>
  </VAST>`);
  assert.equal(degenerate.ok, true);
  assert.deepEqual(
    degenerate.notes.map((note) => note.code),
    [
      'vast.note.version_missing',
      'vast.note.ad_type_unknown',
      'vast.note.duration_invalid',
      'vast.note.timeline_relative',
    ],
  );
  for (const note of degenerate.notes) {
    assert.deepEqual(Object.keys(note), ['code', 'message', 'spec']);
    assert.ok(note.message.length > 40, note.code);
    assert.match(note.spec, /^https:\/\//);
  }
});

test('malformed and non-VAST input returns typed errors with offsets and never throws', () => {
  const { parseVastTimeline } = loadModule();
  const cases = [
    '',
    'not xml',
    '<html></html>',
    '<VAST><Ad></VAST>',
    '<VAST><Ad id="unterminated></Ad></VAST>',
    '<VAST><![CDATA[unterminated</VAST>',
    '<VAST>&unknown;</VAST>',
    null,
    42,
  ];
  for (const input of cases) {
    /** @type {any} */
    let result = null;
    assert.doesNotThrow(() => {
      result = parseVastTimeline(input);
    });
    assert.deepEqual(Object.keys(result), ['ok', 'error']);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error.message, 'string');
    assert.equal(typeof result.error.offset, 'number');
    assert.ok(result.error.offset >= 0);
  }
});

test('preserves multiple Ads, namespace-prefixed children, numeric entities, and distinct offsets', () => {
  const { parseVastTimeline } = loadModule();
  const result = parseVastTimeline(`<VAST version="4.1" xmlns:v="urn:iab:vast">
    <Ad id="inline"><InLine>
      <Impression>https://track.example/?n=&#49;&#x32;</Impression>
      <Creatives><Creative><Linear><TrackingEvents>
        <v:Tracking event="progress">https://track.example/missing-offset</v:Tracking>
        <v:Tracking event="progress" offset="">https://track.example/empty-offset</v:Tracking>
      </TrackingEvents><MediaFiles>
        <MediaFile __proto__="safe">https://cdn.example/video.mp4</MediaFile>
      </MediaFiles></Linear></Creative></Creatives>
    </InLine></Ad>
    <Ad id="wrapper"><Wrapper>
      <VASTAdTagURI>https://wrapper.example/vast?a=1&amp;b=2</VASTAdTagURI>
    </Wrapper></Ad>
  </VAST>`);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ads.map((ad) => [ad.id, ad.type]),
    [
      ['inline', 'inline'],
      ['wrapper', 'wrapper'],
    ],
  );
  assert.equal(result.ads[0].impressions[0].url, 'https://track.example/?n=12');
  assert.deepEqual(
    result.ads[0].trackingEvents.map(({ offset, urls }) => ({ offset, urls })),
    [
      { offset: null, urls: ['https://track.example/missing-offset'] },
      { offset: '', urls: ['https://track.example/empty-offset'] },
    ],
  );
  assert.equal(Object.hasOwn(result.ads[0].mediaFiles[0].attributes, '__proto__'), true);
  assert.equal(result.ads[0].mediaFiles[0].attributes.__proto__, 'safe');
  assert.deepEqual(result.ads[1].vastAdTagUri, {
    url: 'https://wrapper.example/vast?a=1&b=2',
    unresolved: true,
  });
});

test('rejects unsupported or malformed XML constructs as typed data', () => {
  const { parseVastTimeline } = loadModule();
  const cases = [
    '<VAST><!DOCTYPE Ad SYSTEM "https://example.invalid/entity"><Ad/></VAST>',
    '<VAST><!-- bad -- comment --></VAST>',
    '<VAST version="bad<value"></VAST>',
    '<VAST>bad ]]></VAST>',
    '<VAST></VAST><VAST></VAST>',
  ];

  for (const xml of cases) {
    const result = parseVastTimeline(xml);
    assert.equal(result.ok, false, xml);
    assert.equal(typeof result.error.message, 'string', xml);
    assert.equal(typeof result.error.offset, 'number', xml);
  }
});

test('input size and nesting depth are bounded with typed failures', () => {
  const { MAX_DOCUMENT_LENGTH, MAX_XML_DEPTH, parseVastTimeline } = loadModule();
  const oversized = `<VAST>${' '.repeat(MAX_DOCUMENT_LENGTH)}</VAST>`;
  const sizeResult = parseVastTimeline(oversized);
  assert.equal(sizeResult.ok, false);
  assert.match(sizeResult.error.message, /size limit/i);
  assert.equal(sizeResult.error.offset, MAX_DOCUMENT_LENGTH);

  const depth = MAX_XML_DEPTH + 1;
  const deeplyNested = `<VAST>${'<Node>'.repeat(depth)}${'</Node>'.repeat(depth)}</VAST>`;
  const depthResult = parseVastTimeline(deeplyNested);
  assert.equal(depthResult.ok, false);
  assert.match(depthResult.error.message, /depth limit/i);
  assert.ok(depthResult.error.offset > 0);

  const acceptedDepth = Math.min(32, MAX_XML_DEPTH - 1);
  const accepted = `<VAST>${'<Node>'.repeat(acceptedDepth)}${'</Node>'.repeat(acceptedDepth)}</VAST>`;
  assert.equal(parseVastTimeline(accepted).ok, true);
});

test('Node and browser-global branches expose the same UMD-lite API', () => {
  // The REAL vast-shape.js is loaded first, exactly as the page loads it via a
  // script tag, rather than a stub standing in for it. A stub would agree with
  // the module by construction: it would pass even if the global were renamed
  // or the two files disagreed about what "is this VAST" means, which is the
  // only thing this test can usefully catch.
  const nodeApi = loadModule();
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(path.join(MODULE_DIR, '..', 'vast-shape.js'), 'utf8'),
    context,
    {
      filename: 'vast-shape.js',
    },
  );
  assert.ok(
    context.OrtbtoolsVastShape,
    'vast-shape.js must publish the global the extractor reads',
  );

  vm.runInNewContext(fs.readFileSync(path.join(MODULE_DIR, 'index.js'), 'utf8'), context, {
    filename: 'vast-timeline/index.js',
  });
  assert.deepEqual(Object.keys(context.OrtbtoolsVastTimeline).sort(), Object.keys(nodeApi).sort());

  // Same input, both branches, compared as a whole — not one hand-picked field.
  const xml =
    '<!-- adserver --><VAST version="4.2"><Ad id="a"><InLine>' +
    '<Impression><![CDATA[https://t/i?a=1&amp;b=2]]></Impression>' +
    '<Creatives><Creative><Linear><Duration>00:00:20</Duration><TrackingEvents>' +
    '<Tracking event="start">https://t/s</Tracking>' +
    '<Tracking event="progress" offset="50%">https://t/p</Tracking>' +
    '</TrackingEvents></Linear></Creative></Creatives></InLine></Ad></VAST>';
  const browserResult = context.OrtbtoolsVastTimeline.parseVastTimeline(xml);
  assert.equal(browserResult.ok, true, JSON.stringify(browserResult.error));
  assert.deepEqual(
    JSON.parse(JSON.stringify(browserResult)),
    JSON.parse(JSON.stringify(nodeApi.parseVastTimeline(xml))),
    'the two branches must produce identical results, not merely load',
  );

  // Without the shape helpers the module must say so, and say what to do.
  const bare = {};
  bare.globalThis = bare;
  vm.runInNewContext(fs.readFileSync(path.join(MODULE_DIR, 'index.js'), 'utf8'), bare, {
    filename: 'vast-timeline/index.js',
  });
  const unavailable = bare.OrtbtoolsVastTimeline.parseVastTimeline(xml);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'vast.runtime.detector_unavailable');
  assert.match(unavailable.error.message, /OrtbtoolsVastShape/);
});

test('canonical source has no network, DOM, clock, randomness, or findings primitives', () => {
  const source = fs
    .readdirSync(MODULE_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(MODULE_DIR, name), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

  assert.doesNotMatch(source, /\bfetch\b|XMLHttpRequest|DOMParser|\bdocument\b|\bwindow\b/);
  assert.doesNotMatch(source, /require\(['"](?:node:)?(?:http|https|fs)['"]\)/);
  assert.doesNotMatch(source, /\bDate\.now\s*\(|\bMath\.random\s*\(/);
  assert.doesNotMatch(source, /\b(?:F|makeFinding)\s*\(/);
});
