'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../packages/core');
const { loadCorpus } = require('./corpus/lib/load');
const { matches } = require('./corpus/lib/oracle');
const { startServer, postAnalyzeRaw } = require('./corpus/lib/http-run');

const corpus = loadCorpus({ caseFilter: '', formatFilter: '' });
const nativeIds = [
  'native-x-structured-bid-object',
  'native-x-ortb30-adcom-stub',
  'cover-context-native-30-ctv',
  'cover-context-native-30-inapp',
  'cover-context-native-30-dooh',
  'cover-context-native-30-unspecified',
];
const fixture = (id) => structuredClone(corpus.all.find((c) => c.id === id));
const nativeFindings = (c) =>
  Core.crosscheck(c.request, c.response).filter((f) => f.id.startsWith('crosscheck.bid.native_'));
const noComplete = (findings) =>
  assert.equal(
    findings.some((f) => f.id === 'crosscheck.bid.native_complete'),
    false,
  );

test('026 Native: all six existing cases satisfy their unchanged crosscheck requirements', () => {
  for (const id of nativeIds) {
    const c = fixture(id);
    const before = structuredClone([c.request, c.response]);
    const findings = Core.crosscheck(c.request, c.response);
    for (const ref of c.meta.expect.crosscheck.must)
      assert.ok(matches(findings, ref).length, `${id}: ${JSON.stringify(ref)}`);
    for (const ref of c.meta.expect.crosscheck.mustNot)
      assert.equal(matches(findings, ref).length, 0, `${id}: ${JSON.stringify(ref)}`);
    assert.deepEqual([c.request, c.response], before, 'projection does not alter caller payloads');
  }
});

test('026 Native: structured 2.x content has the same fitness as inline JSON and takes precedence over notices', () => {
  const c = fixture(nativeIds[0]);
  const original = nativeFindings(c);
  const bid = c.response.seatbid[0].bid[0];
  bid.nurl = 'https://notice.example.test/win';
  assert.deepEqual(nativeFindings(c), original);
  const native = bid.native;
  delete bid.native;
  bid.adm = JSON.stringify({ native });
  assert.deepEqual(nativeFindings(c), original);
  const mixed = fixture(nativeIds[0]);
  mixed.request.imp[0].banner = { w: 300, h: 250 };
  delete mixed.response.seatbid[0].bid[0].mtype;
  assert.ok(nativeFindings(mixed).some((f) => f.id === 'crosscheck.bid.native_complete'));
});

test('026 Native: required AdCOM assets retain kind, content, dimensions and id checks', () => {
  /** @type {Array<[string, (native: any) => unknown, string]>} */
  const controls = [
    ['missing id', (n) => n.asset.pop(), 'crosscheck.bid.native_missing_assets'],
    [
      'wrong kind',
      (n) => {
        n.asset[0] = { id: 1, data: { value: 'Wrong type' } };
      },
      'crosscheck.bid.native_asset_kind',
    ],
    [
      'blank title',
      (n) => {
        n.asset[0].title.text = '   ';
      },
      'crosscheck.bid.native_asset_empty',
    ],
    [
      'overlength title',
      (n) => {
        n.asset[0].title.text = 'x'.repeat(91);
      },
      'crosscheck.bid.native_over_length',
    ],
    [
      'wrong dimensions',
      (n) => {
        n.asset[1].image.w = 9;
      },
      'crosscheck.bid.native_img_size',
    ],
    [
      'blank image URL',
      (n) => {
        n.asset[1].image.url = ' \t\n';
      },
      'crosscheck.bid.native_asset_empty',
    ],
  ];
  for (const [label, mutate, id] of controls) {
    const c = fixture(nativeIds[1]);
    mutate(c.response.openrtb.response.seatbid[0].bid[0].media.ad.display.native);
    const findings = nativeFindings(c);
    assert.ok(
      findings.some((f) => f.id === id),
      label,
    );
    noComplete(findings);
    assert.ok(findings.every((f) => f.path === 'openrtb.response.seatbid[0].bid[0].media.ad'));
  }
  const noLink = fixture(nativeIds[1]);
  delete noLink.response.openrtb.response.seatbid[0].bid[0].media.ad.display.native.link;
  assert.ok(nativeFindings(noLink).some((f) => f.id === 'crosscheck.bid.native_complete'));
  const optional = fixture(nativeIds[1]);
  optional.request.openrtb.request.item[0].spec.placement.display.nativefmt.asset[2].req = 0;
  optional.response.openrtb.response.seatbid[0].bid[0].media.ad.display.native.asset.pop();
  assert.equal(
    nativeFindings(optional).find((f) => f.id === 'crosscheck.bid.native_complete').params.count,
    2,
  );
});

test('026 Native: malformed supplied asset containers never produce a complete verdict', () => {
  for (const value of [undefined, null, {}, 'assets', 1]) {
    const responseIssue =
      value === undefined
        ? 'crosscheck.bid.native_missing_assets'
        : 'crosscheck.bid.native_invalid_adm';
    const c = fixture(nativeIds[1]);
    c.response.openrtb.response.seatbid[0].bid[0].media.ad.display.native.asset = value;
    const findings = nativeFindings(c);
    assert.ok(findings.some((f) => f.id === responseIssue));
    noComplete(findings);
    const requestCase = fixture(nativeIds[1]);
    requestCase.request.openrtb.request.item[0].spec.placement.display.nativefmt.asset = value;
    const requestFindings = nativeFindings(requestCase);
    assert.ok(requestFindings.some((f) => f.id === 'crosscheck.bid.native_invalid_request'));
    noComplete(requestFindings);
    const native2 = fixture(nativeIds[0]);
    native2.response.seatbid[0].bid[0].native.assets = value;
    const native2Findings = nativeFindings(native2);
    assert.ok(native2Findings.some((f) => f.id === responseIssue));
    noComplete(native2Findings);
  }
  for (const assets of [[], [null], [{}], ['asset']]) {
    const c = fixture(nativeIds[1]);
    c.request.openrtb.request.item[0].spec.placement.display.nativefmt.asset = assets;
    const findings = nativeFindings(c);
    assert.ok(findings.some((f) => f.id === 'crosscheck.bid.native_invalid_request'));
    noComplete(findings);
  }
});

test('026 Native: optional assets do not make malformed creative containers complete', () => {
  for (const native of [null, false, 0, { native: null }, { native: false }, { native: 0 }]) {
    for (const id of nativeIds.slice(0, 2)) {
      const c = fixture(id);
      if (c.request.openrtb) {
        for (const asset of c.request.openrtb.request.item[0].spec.placement.display.nativefmt
          .asset)
          asset.req = 0;
        c.response.openrtb.response.seatbid[0].bid[0].media.ad.display.native = native;
      } else {
        const request = JSON.parse(c.request.imp[0].native.request);
        for (const asset of request.assets) asset.required = 0;
        c.request.imp[0].native.request = JSON.stringify(request);
        c.response.seatbid[0].bid[0].native = native;
      }
      const findings = nativeFindings(c);
      assert.ok(
        findings.some((f) => f.id === 'crosscheck.bid.native_invalid_adm'),
        `${id}: ${JSON.stringify(native)}`,
      );
      noComplete(findings);
      if (!c.request.openrtb) {
        delete c.response.seatbid[0].bid[0].native;
        c.response.seatbid[0].bid[0].adm = JSON.stringify({ native });
        const wrapped = nativeFindings(c);
        assert.ok(wrapped.some((f) => f.id === 'crosscheck.bid.native_invalid_adm'));
        noComplete(wrapped);
      }
    }
  }
});

test('026 Native: embedded raster images do not relax navigation or document URL checks', () => {
  const png = fixture(nativeIds[0]).response.seatbid[0].bid[0].native.assets[1].img.url;
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  for (const url of [png, gif, 'https://cdn.example.test/image.png']) {
    const c = fixture(nativeIds[0]);
    c.response.seatbid[0].bid[0].native.assets[1].img.url = url;
    assert.ok(nativeFindings(c).some((f) => f.id === 'crosscheck.bid.native_complete'));
  }
  for (const url of [
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,',
    'data:image/png;base64,%%%',
  ]) {
    const c = fixture(nativeIds[0]);
    c.response.seatbid[0].bid[0].native.assets[1].img.url = url;
    const findings = nativeFindings(c);
    assert.ok(
      findings.some(
        (f) =>
          f.id === 'crosscheck.bid.native_unsafe_scheme' &&
          f.params.field === 'img.url' &&
          f.level === 'crit',
      ),
    );
    noComplete(findings);
  }
  for (const url of [png, 'javascript:alert(1)']) {
    const c = fixture(nativeIds[0]);
    c.response.seatbid[0].bid[0].native.link.url = url;
    const findings = nativeFindings(c);
    assert.ok(
      findings.some(
        (f) =>
          f.id === 'crosscheck.bid.native_unsafe_scheme' &&
          f.params.field === 'link.url' &&
          f.level === 'crit',
      ),
    );
    noComplete(findings);
  }
});

test('026 crosscheck: valid markup declarations must name an offered medium', () => {
  const original = fixture('mut-format-mismatch-mtype-video-banner-only');
  const hits = Core.crosscheck(original.request, original.response);
  const mismatch = hits.find((f) => f.id === 'crosscheck.bid.mtype_offered_mismatch');
  assert.ok(mismatch);
  assert.equal(mismatch.level, 'crit');
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.path, 'seatbid[0].bid[0].mtype');
  assert.ok(
    hits.some((f) => f.id === 'crosscheck.bid.size_match'),
    'actual HTML still gets offered banner dimension checks',
  );
  for (const mtype of [undefined, null, 0, 5, 500, '2', 1.5]) {
    const c = structuredClone(original);
    c.response.seatbid[0].bid[0].mtype = mtype;
    assert.equal(
      Core.crosscheck(c.request, c.response).some(
        (f) => f.id === 'crosscheck.bid.mtype_offered_mismatch',
      ),
      false,
    );
  }
  const all = structuredClone(original);
  Object.assign(all.request.imp[0], { video: {}, audio: {}, native: {} });
  for (const mtype of [1, 2, 3, 4]) {
    all.response.seatbid[0].bid[0].mtype = mtype;
    assert.equal(
      Core.crosscheck(all.request, all.response).some(
        (f) => f.id === 'crosscheck.bid.mtype_offered_mismatch',
      ),
      false,
    );
  }
});

test('026 Native: HTTP preserves structured Native verdict paths', async () => {
  const server = await startServer();
  try {
    for (const id of nativeIds.slice(0, 2)) {
      const c = fixture(id);
      const result = await postAnalyzeRaw(
        server.url,
        JSON.stringify({ bidReq: c.request, bidRes: c.response }),
      );
      assert.equal(result.status, 200);
      const expected = c.meta.expect.crosscheck.must.find(
        (ref) => ref.id === 'crosscheck.bid.native_complete',
      );
      assert.ok(matches(result.body.crosscheck, expected).length, id);
    }
  } finally {
    await server.stop();
  }
});
