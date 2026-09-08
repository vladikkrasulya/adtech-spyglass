'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Core = require('../packages/core');
const { run } = require('../packages/cli/lib/cli');
const { loadCorpus } = require('./corpus/lib/load');
const { startServer, postAnalyzeRaw } = require('./corpus/lib/http-run');

const corpus = loadCorpus();
function pair(id = 'video-web-26-companion-vast3') {
  const c = corpus.all.find((c) => c.id === id);
  assert.ok(c, id);
  return { request: structuredClone(c.request), response: structuredClone(c.response) };
}
const bid = (p) => p.response.seatbid[0].bid[0];
const video = (p) => p.request.imp[0].video;
const check = (p, opts = {}) => Core.crosscheck(p.request, p.response, opts);
const ids = (p) => check(p).map((f) => f.id);
const mismatchIds = [
  'crosscheck.bid.video_mime_mismatch',
  'crosscheck.bid.video_duration_mismatch',
  'crosscheck.bid.video_protocol_mismatch',
];

test('026 media: each negotiated video axis is checked independently against actual VAST', () => {
  for (const [caseId, id] of [
    ['video-mime-incompatible', mismatchIds[0]],
    ['video-duration-incompatible', mismatchIds[1]],
    ['video-protocol-incompatible', mismatchIds[2]],
  ]) {
    const p = pair(caseId);
    const findings = check(p);
    const f = findings.find((f) => f.id === id);
    assert.equal(f?.level, 'crit', caseId);
    assert.equal(f?.path, 'seatbid[0].bid[0].adm', caseId);
    assert.deepEqual(
      findings.filter((f) => mismatchIds.includes(f.id)).map((f) => f.id),
      [id],
    );
  }
  assert.ok(!ids(pair()).some((id) => mismatchIds.includes(id)));
});

test('026 media: alternate renditions, fractional durations and wrapper evidence stay distinct', () => {
  const p = pair();
  video(p).mimes = ['video/webm'];
  bid(p).adm = bid(p).adm.replace(
    '</MediaFiles>',
    '<MediaFile type="video/webm">https://media.example.test/ad.webm</MediaFile></MediaFiles>',
  );
  assert.ok(!ids(p).includes(mismatchIds[0]), 'one supported rendition is enough');
  bid(p).adm = bid(p).adm.replace('00:00:15', '00:00:15.500');
  video(p).maxduration = 15;
  assert.ok(
    ids(p).includes(mismatchIds[1]),
    'fractional time must not truncate to a permitted integer',
  );
  video(p).maxduration = 16;
  assert.ok(!ids(p).includes(mismatchIds[1]));
  const wrapper = pair();
  bid(wrapper).adm =
    '<VAST version="3.0"><Ad><Wrapper><VASTAdTagURI>https://media.example.test/wrapper</VASTAdTagURI></Wrapper></Ad></VAST>';
  delete bid(wrapper).protocol;
  assert.ok(ids(wrapper).includes(mismatchIds[2]), 'inline code3 does not accept wrapper code6');
  video(wrapper).protocols = [6];
  assert.ok(
    !ids(wrapper).some((id) => mismatchIds.includes(id)),
    'unfetched wrapper has no duration or MIME proof',
  );
});

test('026 media: declared metadata cannot hide incompatible actual document evidence', () => {
  const p = pair();
  video(p).protocols = [7];
  bid(p).protocol = 7;
  assert.ok(
    ids(p).includes(mismatchIds[2]),
    'actual VAST3 still contradicts an accepted declaration of VAST4',
  );
  delete bid(p).protocol;
  assert.ok(
    ids(p).includes(mismatchIds[2]),
    'omitted metadata does not disable document comparison',
  );
  const audio = pair('mut-format-mismatch-audio-video-mediafile');
  assert.ok(ids(audio).includes('crosscheck.bid.audio_media_mismatch'));
  bid(audio).adm = bid(pair('video-x-web-42-nonlinear-overlay')).adm;
  delete bid(audio).protocol;
  assert.ok(
    ids(audio).includes('crosscheck.bid.audio_media_mismatch'),
    'NonLinear-only content cannot fill an audio impression',
  );
  assert.ok(
    ids(pair('cover-preview-audio-unidentified-inert')).includes('crosscheck.bid.audio_not_vast'),
  );
  assert.ok(
    ids(pair('mut-format-mismatch-banner-vast-adm')).includes('crosscheck.bid.banner_not_banner'),
  );
  assert.ok(
    !ids(pair('mut-format-mismatch-banner-vast-adm')).includes('crosscheck.bid.size_match'),
    'matching dimensions cannot endorse a different content family',
  );
  assert.ok(
    !ids(pair('audio-web-25-mp3-legacy')).some((id) => id.startsWith('crosscheck.bid.audio_')),
  );
});

test('026 media: mixed impressions apply only the selected offered family', () => {
  const selectedVideo = pair('format-mixed-impression-video-wins');
  assert.ok(ids(selectedVideo).includes('crosscheck.bid.video_vast'));
  assert.ok(!ids(selectedVideo).includes('crosscheck.bid.size_mismatch'));
  assert.ok(!ids(selectedVideo).includes('crosscheck.bid.native_invalid_adm'));
  delete bid(selectedVideo).mtype;
  assert.ok(
    !ids(selectedVideo).includes('crosscheck.bid.size_mismatch'),
    'actual VAST supplies selection when mtype is absent',
  );
  const selectedBanner = pair('mut-format-mismatch-mixed-video-mtype-banner');
  assert.ok(ids(selectedBanner).includes('crosscheck.bid.size_match'));
  assert.ok(!ids(selectedBanner).includes('crosscheck.bid.video_not_vast'));
  bid(selectedBanner).w = 728;
  assert.ok(
    ids(selectedBanner).includes('crosscheck.bid.size_mismatch'),
    'selected banner constraints remain effective',
  );
});

test('026 seats: restrictions compare explicit identities once per seat group', () => {
  for (const [caseId, seatIndex, seatName] of [
    ['multiplicity-wseat-allows-other-seat', '1', 'synthetic-seat-b'],
    ['multiplicity-bseat-blocks-responding-seat', '0', 'synthetic-seat-a'],
  ]) {
    const p = pair(caseId);
    const id = 'crosscheck.seat.not_allowed';
    const f = check(p).find((f) => f.id === id);
    assert.equal(f?.level, 'crit');
    assert.equal(f?.path, `seatbid[${seatIndex}].seat`);
    assert.equal(f?.params.seat, seatName);
    p.response.seatbid[Number(seatIndex)].bid.push(
      structuredClone(p.response.seatbid[Number(seatIndex)].bid[0]),
    );
    assert.equal(check(p).filter((f) => f.id === id).length, 1);
    p.request.wseat = ['synthetic-seat-a', 'synthetic-seat-b'];
    p.request.bseat = [];
    assert.ok(!ids(p).some((id) => id.startsWith('crosscheck.seat.')));
    p.request.wseat = ['SYNTHETIC-SEAT-B'];
    assert.ok(ids(p).includes('crosscheck.seat.not_allowed'), 'seat IDs are case sensitive');
    p.response.seatbid.forEach((s) => delete s.seat);
    assert.ok(
      !ids(p).some((id) => id.startsWith('crosscheck.seat.')),
      'missing identities are not fabricated',
    );
  }
});

test('026 media: CLI uses the unchanged failure policy for semantic contradictions', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-semantics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  /** @type {[string, number][]} */
  const cases = [
    ['video-mime-incompatible', 1],
    ['video-web-26-companion-vast3', 0],
  ];
  for (const [caseId, expected] of cases) {
    const p = pair(caseId);
    const req = path.join(dir, 'request.json');
    const res = path.join(dir, 'response.json');
    fs.writeFileSync(req, JSON.stringify(p.request));
    fs.writeFileSync(res, JSON.stringify(p.response));
    const output = [];
    const code = run(['crosscheck', req, res, '--json'], {
      out: (s) => output.push(s),
      err: (s) => assert.fail(s),
      isTTY: false,
    });
    assert.equal(code, expected);
    assert.ok(output.length);
  }
});

test('026 media: actual HTTP exposes deterministic localized semantic findings', async () => {
  const server = await startServer();
  try {
    for (const locale of ['en', 'uk', 'ru']) {
      const p = pair('video-mime-incompatible');
      const result = await postAnalyzeRaw(
        server.url,
        JSON.stringify({ bidReq: p.request, bidRes: p.response }),
        { locale },
      );
      assert.equal(result.status, 200);
      const findings = result.body.crosscheck;
      const f = findings.find((f) => f.id === mismatchIds[0]);
      assert.equal(f?.level, 'crit');
      assert.equal(f?.path, 'seatbid[0].bid[0].adm');
      assert.ok(f.msg && !f.msg.includes('[' + f.id + ']'));
      assert.ok(f.specRef);
      assert.deepEqual(check(p, { locale }), check(p, { locale }));
    }
  } finally {
    await server.stop();
  }
});
