'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Core = require('../packages/core');
const { run, EXIT_OK, EXIT_FINDINGS } = require('../packages/cli/lib/cli');
const { startServer, postAnalyzeRaw } = require('./corpus/lib/http-run');

function response(adm) {
  return { id: 'audio-review', seatbid: [{ bid: [{ id: 'bid', impid: 'slot', price: 1, adm }] }] };
}

function vast(media) {
  return `<VAST version="4.1"><Ad><InLine><Creatives><Creative><Linear><MediaFiles>${media}</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;
}

function audioRequest(mimes) {
  return {
    id: 'audio-review',
    imp: [{ id: 'slot', audio: { mimes, minduration: 5, maxduration: 30, protocols: [7] } }],
    site: { domain: 'publisher.example.test' },
    device: { ua: 'Synthetic test agent', ip: '192.0.2.9' },
  };
}

const video = '<MediaFile type="video/mp4">https://example.test/video.mp4</MediaFile>';
const audio = '<MediaFile type="audio/mpeg">https://example.test/audio.mp3</MediaFile>';
/** @type {[string, string, string[]][]} */
const xmlControls = [
  ['audio media', vast(audio), ['audio']],
  ['video media', vast(video), ['video']],
  ['mixed media', vast(audio + video), ['audio', 'video']],
  ['comment', vast(`<!-- ${audio} -->${video}`), ['video']],
  ['CDATA', vast(`<![CDATA[${audio}]]>${video}`), ['video']],
  ['processing instruction', `<?example type="audio/mpeg"?>${vast(video)}`, ['video']],
  [
    'quoted MediaFile id',
    vast(`<MediaFile id='note type="audio/mpeg"' type="video/mp4"/>`),
    ['video'],
  ],
  [
    'quoted Ad id',
    `<VAST version="4.2"><Ad id='note adType="audio"'><Wrapper/></Ad></VAST>`,
    ['video'],
  ],
  ['actual Ad type', '<VAST version="4.2"><Ad adType="audio"><Wrapper/></Ad></VAST>', ['audio']],
  ['DOCTYPE comment', `<!DOCTYPE VAST [<!-- note > ${audio} -->]>${vast(video)}`, ['video']],
  ['DOCTYPE PI', `<!DOCTYPE VAST [<?meta note > ${audio}?>]>${vast(video)}`, ['video']],
  [
    'vendor extension',
    vast(
      `<Extensions><Extension type="measurement"><Nested/>${audio}</Extension></Extensions>${video}`,
    ),
    ['video'],
  ],
  [
    'creative extension',
    vast(
      `<CreativeExtensions><CreativeExtension><Nested>${audio}</Nested></CreativeExtension></CreativeExtensions>${video}`,
    ),
    ['video'],
  ],
  ['audio after empty extension', vast(`<Extensions/>${audio}`), ['audio']],
  [
    'audio after nested extension',
    vast(`<Extensions><Extension><Nested>${video}</Nested></Extension></Extensions>${audio}`),
    ['audio'],
  ],
  ['DAAST root', '<?xml version="1.0"?><!-- note --><p:DAAST xmlns:p="urn:test"/>', ['audio']],
  ['DAAST prefix only', '<DAAST:Creative xmlns:DAAST="urn:test"/>', []],
];

test('audio repair: only real XML attributes and roots contribute format evidence', () => {
  for (const [label, adm, expected] of xmlControls) {
    assert.deepEqual(Core.detectFormat(response(adm)).formats.sort(), [...expected].sort(), label);
  }
  const conflict = response(vast(video));
  conflict.seatbid[0].bid[0].mtype = 3;
  assert.deepEqual(Core.detectFormat(conflict).formats.sort(), ['audio', 'video']);
});

test('audio repair: request arrays and response scalar ctype remain distinct', () => {
  /** @type {[number, string][]} */
  const families = [
    [2, 'vast-2'],
    [5, 'vast-2'],
    [3, 'vast-3'],
    [6, 'vast-3'],
    [7, 'vast-4'],
    [8, 'vast-4'],
    [9, 'daast'],
    [10, 'daast'],
    [11, 'vast-4'],
    [12, 'vast-4'],
    [13, 'vast-4'],
    [14, 'vast-4'],
  ];
  for (const kind of ['audio', 'video']) {
    for (const [code, family] of families) {
      const request = { imp: [{ [kind]: { protocols: [code] } }] };
      assert.deepEqual(Core.detectFormat(request).protocols, [family]);
      const placement = {
        openrtb: { request: { item: [{ spec: { placement: { [kind]: { ctype: [code] } } } }] } },
      };
      assert.deepEqual(Core.detectFormat(placement).protocols, [family]);
      const reply = {
        openrtb: {
          response: {
            seatbid: [
              { bid: [{ media: { ad: { [kind]: { ctype: /** @type {unknown} */ (code) } } } }] },
            ],
          },
        },
      };
      assert.deepEqual(Core.detectFormat(reply).protocols, [family]);
      for (const invalid of [[code], String(code), null, 99]) {
        reply.openrtb.response.seatbid[0].bid[0].media.ad[kind].ctype = invalid;
        assert.deepEqual(Core.detectFormat(reply).protocols, []);
      }
    }
    assert.deepEqual(Core.detectFormat({ imp: [{ [kind]: { protocols: [4] } }] }).protocols, []);
  }
});

// Isolate synchronous parser regressions: an infinite loop or allocation must fail
// this test without hanging or exhausting the node:test runner itself.
function detectInChild(payloads) {
  const code = `
    const Core = require(process.argv[1]);
    const payloads = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    process.stdout.write(JSON.stringify(payloads.map(p => Core.detectFormat(p))));
  `;
  const nodeArgs = ['--max-old-space-size=64', '-e', code, require.resolve('../packages/core')];
  const unix = process.platform !== 'win32';
  // Disable core dumps on Unix; a regression must not leave a large dump behind.
  const result = spawnSync(
    unix ? '/bin/sh' : process.execPath,
    unix
      ? ['-c', 'ulimit -c 0; exec "$@"', 'audio-parser-test', process.execPath, ...nodeArgs]
      : nodeArgs,
    {
      input: JSON.stringify(payloads),
      encoding: 'utf8',
      timeout: 5000,
      killSignal: 'SIGKILL',
      maxBuffer: 16384,
    },
  );
  assert.equal(result.error, undefined, 'Malformed XML detection exceeded its 5s watchdog');
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const malformed = [
  '">" type="audio/mpeg"',
  "'>' type='audio/mpeg'",
  'type=',
  'type="audio/mpeg',
  'type audio/mpeg',
  'bogus/ type="audio/mpeg"',
];

test('audio repair: malformed attributes terminate without fabricated audio evidence', () => {
  const payloads = malformed.map((attrs) => response(vast(`<MediaFile ${attrs}/>`)));
  payloads.push(response(vast(video)), response(vast(audio)));
  const results = detectInChild(payloads);
  assert.equal(results.length, payloads.length);
  for (const result of results.slice(0, malformed.length)) {
    assert.ok(!result.formats.includes('audio'));
  }
  assert.deepEqual(results.at(-2).formats, ['video']);
  assert.deepEqual(results.at(-1).formats, ['audio']);
});

test('audio repair: MIME findings preserve type, element path, locale and reference', () => {
  for (const locale of ['en', 'uk', 'ru']) {
    for (const value of [undefined, null, false, 'audio/mpeg', {}, []]) {
      const result = Core.validate(audioRequest(value), { locale });
      const finding = result.findings.find((f) => f.id === 'imp.audio.mimes_required');
      assert.equal(result.status, 'errors');
      assert.equal(finding?.level, 'error');
      assert.equal(finding.path, 'imp[0].audio.mimes');
      assert.ok(finding.specRef?.endsWith('#objectaudio'));
      assert.ok(finding.msg && !finding.msg.includes('[imp.audio.'));
    }
    for (const value of [null, false, 42, {}, [], '', '  ']) {
      const result = Core.validate(audioRequest(['audio/mpeg', value]), { locale });
      const finding = result.findings.find((f) => f.id === 'imp.audio.mimes_invalid');
      assert.equal(finding?.level, 'error');
      assert.equal(finding.path, 'imp[0].audio.mimes[1]');
      assert.ok(finding.specRef?.endsWith('#objectaudio'));
      assert.ok(finding.msg && !finding.msg.includes('[imp.audio.'));
    }
    const valid = Core.validate(audioRequest(['audio/mpeg', 'audio/mp4']), { locale });
    assert.ok(!valid.findings.some((f) => f.id.startsWith('imp.audio.mimes_')));
    assert.notEqual(valid.status, 'errors');
  }
});

test('audio repair: default CLI rejects invalid MIME values and accepts the valid control', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-audio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [mimes, expected] of [
    [undefined, EXIT_FINDINGS],
    [[''], EXIT_FINDINGS],
    [['audio/mpeg'], EXIT_OK],
  ]) {
    const file = path.join(dir, 'request.json');
    fs.writeFileSync(file, JSON.stringify(audioRequest(mimes)));
    const output = [];
    const code = run(['validate', file, '--json'], {
      out: (s) => output.push(s),
      err: (s) => assert.fail(s),
      isTTY: false,
    });
    assert.equal(code, expected);
    assert.equal(JSON.parse(output.join('\n')).status === 'errors', expected === EXIT_FINDINGS);
  }
});

test('audio repair: HTTP exposes localized MIME errors and corrected XML format evidence', async () => {
  const server = await startServer();
  try {
    for (const locale of ['en', 'uk', 'ru']) {
      for (const [mimes, id] of [
        [undefined, 'imp.audio.mimes_required'],
        [[''], 'imp.audio.mimes_invalid'],
      ]) {
        const result = await postAnalyzeRaw(
          server.url,
          JSON.stringify({ bidReq: audioRequest(mimes) }),
          { locale },
        );
        assert.equal(result.status, 200);
        const finding = result.body.validation.findings.find((f) => f.id === id);
        assert.equal(finding?.level, 'error');
        assert.ok(finding.msg && !finding.msg.includes('[' + id + ']'));
      }
    }
    for (const [label, adm, expected] of xmlControls) {
      const result = await postAnalyzeRaw(server.url, JSON.stringify({ bidRes: response(adm) }));
      assert.equal(result.status, 200, label);
      assert.deepEqual(result.body.meta.format.formats.sort(), [...expected].sort(), label);
    }
  } finally {
    await server.stop();
  }
});
