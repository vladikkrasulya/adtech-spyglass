'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const Core = require('../packages/core');
const { inspectVastMedia } = require('../packages/core/rules-vast');

const mediaFile = (mime) =>
  `<MediaFile type="${mime}" width="640" height="360">https://media.example.test/ad</MediaFile>`;
const linear = (media = mediaFile('video/mp4'), duration = '00:00:15') =>
  `<Creative><Linear><Duration>${duration}</Duration><MediaFiles>${media}</MediaFiles></Linear></Creative>`;
const nonlinear =
  '<Creative><NonLinearAds><NonLinear width="300" height="100"><StaticResource creativeType="image/png">https://media.example.test/overlay.png</StaticResource></NonLinear></NonLinearAds></Creative>';
const inlineAd = (creatives) =>
  `<Ad><InLine><AdSystem>test</AdSystem><AdTitle>test</AdTitle><Impression>https://track.example.test/i</Impression><Creatives>${creatives}</Creatives></InLine></Ad>`;
const document = (ads, version = '4.2', root = 'VAST') =>
  `<${root} version="${version}">${ads}</${root}>`;
const response = (adm) => ({
  id: 'media-pair',
  seatbid: [{ seat: 'seat', bid: [{ id: 'bid', impid: 'slot', price: 1, adm }] }],
});

test('VAST semantics: NonLinear-only is valid while every inline Linear still needs media', () => {
  /** @type {[string, string, boolean][]} */
  const controls = [
    ['nonlinear only', nonlinear, false],
    ['linear with media', linear(), false],
    ['mixed complete', nonlinear + linear(), false],
    ['linear missing media', linear(''), true],
    ['nonlinear cannot hide broken linear', nonlinear + linear(''), true],
    ['second linear cannot hide broken first linear', linear('') + linear(), true],
    ['no supported creative', '', true],
  ];
  for (const [label, creatives, missing] of controls) {
    const result = Core.validate(response(document(inlineAd(creatives))));
    const finding = result.findings.find((f) => f.id === 'vast.mediafile_missing');
    assert.equal(Boolean(finding), missing, label);
    if (finding) {
      assert.equal(finding.level, 'error');
      assert.equal(finding.path, 'seatbid[0].bid[0].adm');
    }
  }
  const pod = document(inlineAd(linear('')) + inlineAd(nonlinear + linear()));
  assert.ok(Core.validate(response(pod)).findings.some((f) => f.id === 'vast.mediafile_missing'));
  assert.ok(
    Core.validate(response('<VAST version="4.2"><InLine/></VAST>')).findings.some(
      (f) => f.id === 'vast.mediafile_missing',
    ),
  );
});

test('VAST semantics: metadata or text cannot supply missing Linear media', () => {
  for (const fake of [
    `<!-- ${mediaFile('video/mp4')} -->`,
    `<![CDATA[${mediaFile('video/mp4')}]]>`,
    `<?vendor ${mediaFile('video/mp4')}?>`,
    `<Extensions><Extension>${mediaFile('video/mp4')}</Extension></Extensions>`,
    `<CreativeExtensions><CreativeExtension>${mediaFile('video/mp4')}</CreativeExtension></CreativeExtensions>`,
    `<Metadata note='${mediaFile('video/mp4')}'/>`,
  ]) {
    const findings = Core.validate(response(document(inlineAd(linear(fake))))).findings;
    assert.ok(
      findings.some((f) => f.id === 'vast.mediafile_missing'),
      fake,
    );
  }
});

test('VAST media evidence: keep each Linear rendition set and duration separate', () => {
  const adm = document(
    inlineAd(
      linear(mediaFile('video/webm') + mediaFile(' VIDEO/MP4 '), '<![CDATA[00:00:15.250]]>') +
        linear(mediaFile('audio/mpeg'), '01:02:03') +
        nonlinear,
    ),
  );
  const actual = inspectVastMedia(adm);
  assert.equal(actual.root, 'vast');
  assert.equal(actual.hasAudioMedia, true);
  assert.equal(actual.hasVideoMedia, true);
  assert.equal(actual.hasNonLinear, true);
  assert.equal(actual.inlineMediaMissing, false);
  assert.deepEqual(
    actual.linears.map((row) => row.mimes),
    [['video/webm', 'video/mp4'], ['audio/mpeg']],
  );
  assert.deepEqual(
    actual.linears.map((row) => row.durations),
    [[15.25], [3723]],
  );
  assert.ok(actual.linears.every((row) => row.inline && row.hasDuration));
  const invalid = inspectVastMedia(document(inlineAd(linear(mediaFile('video/mp4'), '00:90:00'))));
  assert.deepEqual(invalid.linears[0].durations, []);
  assert.equal(invalid.linears[0].hasDuration, true);
});

test('VAST crosscheck: one compatible creative does not hide another incompatible Linear', () => {
  const request = {
    id: 'media-pair',
    imp: [
      {
        id: 'slot',
        video: { mimes: ['video/mp4'], minduration: 10, maxduration: 20, protocols: [13] },
      },
    ],
  };
  const mismatch = (adm) =>
    Core.crosscheck(request, response(adm)).filter((f) =>
      /video_(mime|duration|protocol)_mismatch$/.test(f.id),
    );
  const incompatible = document(
    inlineAd(linear()) + inlineAd(linear(mediaFile('video/webm'), '00:00:30')),
  );
  assert.deepEqual(
    mismatch(incompatible)
      .map((f) => f.id)
      .sort(),
    ['crosscheck.bid.video_duration_mismatch', 'crosscheck.bid.video_mime_mismatch'],
  );
  const allowed = document(
    inlineAd(linear()) +
      inlineAd(linear(mediaFile('video/webm') + mediaFile('video/mp4'), '00:00:20')),
  );
  assert.deepEqual(mismatch(allowed), []);
  const fakeAllowed = document(
    inlineAd(linear(mediaFile('video/webm') + `<!-- ${mediaFile('video/mp4')} -->`)),
  );
  assert.deepEqual(
    mismatch(fakeAllowed).map((f) => f.id),
    ['crosscheck.bid.video_mime_mismatch'],
  );
});

test('VAST media evidence: protocols come from the real root and Inline/Wrapper shape', () => {
  const wrapper =
    '<Ad><Wrapper><VASTAdTagURI>https://next.example.test/vast</VASTAdTagURI></Wrapper></Ad>';
  /** @type {[string, number, number, string][]} */
  const versions = [
    ['2.0', 2, 5, 'VAST'],
    ['3.0', 3, 6, 'VAST'],
    ['4.0', 7, 8, 'VAST'],
    ['4.1', 11, 12, 'VAST'],
    ['4.2', 13, 14, 'VAST'],
    ['1.0', 9, 10, 'DAAST'],
  ];
  for (const [version, inlineCode, wrapperCode, root] of versions) {
    assert.deepEqual(inspectVastMedia(document(inlineAd(linear()), version, root)).protocols, [
      inlineCode,
    ]);
    assert.deepEqual(inspectVastMedia(document(wrapper, version, root)).protocols, [wrapperCode]);
    assert.deepEqual(
      inspectVastMedia(document(inlineAd(linear()) + wrapper, version, root)).protocols,
      [inlineCode, wrapperCode],
    );
  }
  for (const version of ['4.4', '__proto__', 'constructor', 'toString']) {
    assert.deepEqual(inspectVastMedia(document(inlineAd(linear()), version)).protocols, []);
  }
  assert.deepEqual(
    inspectVastMedia('<VAST id=\'note version="2.0"\'><Ad><Wrapper/></Ad></VAST>').protocols,
    [],
  );
  assert.equal(inspectVastMedia('<div><VAST version="4.2"/></div>').root, null);
});

test('VAST media evidence: XML lexical controls do not manufacture an audio rendition', () => {
  const audio = mediaFile('audio/mpeg');
  for (const extra of [
    `<!-- ${audio} -->`,
    `<![CDATA[${audio}]]>`,
    `<?vendor ${audio}?>`,
    `<Extensions><Extension><Nested/>${audio}</Extension></Extensions>`,
    `<CreativeExtensions><CreativeExtension><Nested>${audio}</Nested></CreativeExtension></CreativeExtensions>`,
    `<MediaFile id='note type="audio/mpeg"' type="video/mp4"/>`,
  ]) {
    const actual = inspectVastMedia(document(inlineAd(linear(extra + mediaFile('video/mp4')))));
    assert.equal(actual.hasAudioMedia, false, extra);
    assert.equal(actual.hasVideoMedia, true, extra);
  }
  const prolog = `<!DOCTYPE VAST [<!-- ]> ${audio} --><?vendor ]> ${audio}?><!ENTITY x "${audio}">]>`;
  const actual = inspectVastMedia(prolog + document(inlineAd(linear())));
  assert.equal(actual.root, 'vast');
  assert.equal(actual.hasAudioMedia, false);
  assert.equal(actual.hasVideoMedia, true);
  assert.equal(
    inspectVastMedia(document(inlineAd(linear('<Extensions/>' + audio)))).hasAudioMedia,
    true,
  );
});

test('VAST media evidence: hostile XML terminates under a process watchdog', () => {
  const inputs = [
    ...[
      '">" type="audio/mpeg"',
      "'>' type='audio/mpeg'",
      'type=',
      'type="audio/mpeg',
      'type audio/mpeg',
      'bogus/ type="audio/mpeg"',
    ].map((attrs) => document(inlineAd(linear(`<MediaFile ${attrs}/>`)))),
    document(inlineAd(linear('<MediaFile '.repeat(100000)))),
    document(inlineAd(linear(`<![CDATA[${'<MediaFile '.repeat(100000)}]]>`))),
    document(inlineAd(linear('<Extensions>'.repeat(10000) + '</Extensions>'.repeat(10000)))),
    '<!DOCTYPE VAST [<!-- unterminated ' + '<MediaFile '.repeat(100000),
  ];
  const code = `const {inspectVastMedia}=require(process.argv[1]); const inputs=JSON.parse(require('node:fs').readFileSync(0,'utf8')); process.stdout.write(JSON.stringify(inputs.map(s=>inspectVastMedia(s).hasAudioMedia)));`;
  const nodeArgs = [
    '--max-old-space-size=96',
    '-e',
    code,
    require.resolve('../packages/core/rules-vast'),
  ];
  const unix = process.platform !== 'win32';
  const result = spawnSync(
    unix ? '/bin/sh' : process.execPath,
    unix
      ? ['-c', 'ulimit -c 0; exec "$@"', 'vast-media-test', process.execPath, ...nodeArgs]
      : nodeArgs,
    {
      input: JSON.stringify(inputs),
      encoding: 'utf8',
      timeout: 5000,
      killSignal: 'SIGKILL',
      maxBuffer: 16384,
    },
  );
  assert.equal(result.error, undefined, 'XML media inspection exceeded its 5s watchdog');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout),
    inputs.map(() => false),
  );
});
