'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const view = require('../packages/core/auction-view');
const core = require('../packages/core');
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
test('auction view retains original identity, indices, original paths and frozen input', () => {
  const req = freeze({
    openrtb: {
      request: {
        id: 'q',
        item: [null, { id: 'slot', flr: 2, spec: { placement: { display: { w: 300, h: 250 } } } }],
      },
    },
  });
  const res = freeze({
    openrtb: {
      response: {
        id: 'q',
        seatbid: [
          null,
          {
            bid: [
              null,
              {
                item: 'slot',
                price: 3,
                media: { ad: { display: { adm: '<b>x</b>', w: 300, h: 250 } } },
              },
            ],
          },
        ],
      },
    },
  });
  const rv = view.buildRequestView(req);
  assert.equal(rv.original, req);
  assert.equal(rv.items[1].raw, req.openrtb.request.item[1]);
  assert.equal(rv.items[1].path, 'openrtb.request.item[1]');
  assert.equal(rv.imp[1].banner.w, 300);
  const [bid] = view.flattenBids(view.buildResponseView(res));
  assert.equal(bid.raw, res.openrtb.response.seatbid[1].bid[1]);
  assert.deepEqual([bid.sNum, bid.bNum, bid.bid.impid], [2, 2, 'slot']);
  assert.equal(
    bid.path + '.' + bid.leaf.adm,
    'openrtb.response.seatbid[1].bid[1].media.ad.display.adm',
  );
});
test('auction adapters preserve crosscheck eligibility and classify peeled UI payloads', () => {
  const req = { item: [{ id: 'i' }] };
  const res = { seatbid: [{ bid: [{ item: 'i', media: { display: { adm: 'x' } } }] }] };
  assert.equal(view.buildRequestView(req), null);
  assert.equal(view.buildRequestView(req, { consumer: 'ui' }).items[0].path, 'item[0]');
  assert.equal(view.buildResponseView(res).v30, false);
  assert.equal(view.flattenBids(view.buildResponseView(res, { consumer: 'ui' }))[0].bid.impid, 'i');
  assert.equal(view.classifyAuctionPayload({ openrtb: {}, imp: [] }).kind, 'req');
  assert.equal(
    view.classifyAuctionPayload({ openrtb: { request: {}, response: {} } }).kind,
    'unknown',
  );
  assert.equal(view.classifyAuctionPayload({ imp: [], seatbid: [] }).kind, 'unknown');
  assert.equal(
    view.classifyAuctionPayload({ seatbid: [{ bid: [{ item: 'i', impid: 'x' }] }] }).version,
    null,
  );
});
test('request plugin adapter maps only normative compatible AdCOM fields and preserves source paths', () => {
  const req = freeze({
    id: 'q',
    item: [
      {
        id: 'i',
        ext: { format: 'popunder', unknown_signal: 1 },
        spec: {
          placement: {
            secure: 2,
            display: { instl: 1 },
            video: { mindur: -1, maxdur: 0, mime: ['video/mp4'], ctype: [2] },
          },
        },
      },
    ],
    context: { device: { os: 6 }, restrictions: { battr: [8] } },
  });
  const mapped = view.projectRequestForRules(req);
  assert.equal(mapped.payload.imp[0].secure, 2);
  assert.equal(mapped.payload.imp[0].instl, 1);
  assert.equal(mapped.payload.imp[0].video.minduration, -1);
  assert.equal(mapped.payload.device, undefined);
  assert.equal(mapped.payload.imp[0].banner.battr, undefined);
  const findings = core.validate(
    { openrtb: { ver: '3.0', request: req } },
    { locale: 'en' },
  ).findings;
  assert.ok(
    findings.some(
      (f) =>
        f.id === 'imp.secure_invalid' && f.path === 'openrtb.request.item[0].spec.placement.secure',
    ),
  );
  assert.ok(
    findings.some(
      (f) =>
        f.id === 'err-pod-len-invalid' &&
        f.path === 'openrtb.request.item[0].spec.placement.video.mindur' &&
        f.params.field === 'mindur',
    ),
  );
  for (const f of findings.filter((f) => f.params && f.params.path))
    assert.ok(!f.params.path.startsWith('imp['));
  const paired = { openrtb: { request: { cur: ['EUR'], item: req.item } } };
  assert.deepEqual(view.projectResponsePairRequest(paired), { cur: ['EUR'] });
});
test('auction browser mirror and built-in dialect registry match Core', () => {
  const context = vm.createContext({});
  vm.runInContext(
    fs.readFileSync(require.resolve('../public/core/auction-view.js'), 'utf8'),
    context,
  );
  const input = { item: [{ id: 'i' }] };
  assert.equal(context.OrtbtoolsAuctionView.classifyAuctionPayload(input).body, input);
  assert.deepEqual(core.listDialects(), require('../packages/core/dialect-registry').ids);
});

test('normative 3.0 fixture activates all four item-plugin families at original source paths', () => {
  const request = {
    id: 'q',
    item: [
      {
        id: 'i',
        ext: { popunder: 1, unrecognizedFoo: 'x' },
        spec: {
          placement: {
            secure: 2,
            display: { instl: 1 },
            video: { mindur: 60, maxdur: 30 },
            audio: { mindur: 10, maxdur: 5 },
          },
        },
      },
    ],
  };
  const findings = core.validate({ openrtb: { ver: '3.0', request } }).findings;
  for (const [id, path] of [
    ['imp.secure_invalid', 'openrtb.request.item[0].spec.placement.secure'],
    ['imp.pop.instl_conflict', 'openrtb.request.item[0].spec.placement.display.instl'],
    ['err-pod-len-mismatch', 'openrtb.request.item[0].spec.placement.video'],
    ['err-pod-len-mismatch', 'openrtb.request.item[0].spec.placement.audio'],
    ['dialects.question.unknown_ext_signal', 'openrtb.request.item[0].ext.unrecognizedFoo'],
  ])
    assert.ok(
      findings.some((f) => f.id === id && f.path === path),
      id + ' at ' + path,
    );
  const question = findings.find(
    (f) => f.id === 'dialects.question.unknown_ext_signal' && f.path.endsWith('unrecognizedFoo'),
  );
  assert.equal(question.params.path, question.path);
});

test('mixed incomplete envelope keeps the selected 2.x crosscheck fallback and original handles', () => {
  const req = freeze({
    id: 'r',
    imp: [{ id: 'i', banner: { w: 300, h: 250 } }],
    openrtb: { request: { id: 'incomplete-envelope' } },
  });
  const selected = view.buildRequestView(req);
  assert.equal(selected.body, req);
  assert.equal(selected.version, null);
  assert.equal(selected.items[0].raw, req.imp[0]);
  assert.equal(selected.items[0].path, 'imp[0]');
  const res = {
    id: 'r',
    seatbid: [{ bid: [{ id: 'b', impid: 'i', price: 1, adm: 'x', w: 300, h: 250 }] }],
  };
  const findings = core.crosscheck(req, res);
  assert.ok(findings.some((f) => f.id === 'crosscheck.id_match'));
  assert.ok(findings.some((f) => f.id === 'crosscheck.bid.impid_resolved'));
});

test('UI 3.0 request facts include normative audio/security/instl and MIME aliases without broadening crosscheck', () => {
  const req = freeze({
    openrtb: {
      request: {
        item: [
          {
            id: 'audio',
            ext: { signal: 1 },
            spec: {
              placement: { secure: 1, audio: { mime: ['audio/mp4'], mindur: 10, maxdur: 30 } },
            },
          },
          {
            id: 'display',
            spec: {
              placement: {
                secure: 1,
                display: { instl: 1, displayfmt: [{ w: 728, h: 90 }] },
                video: { mime: ['video/mp4'] },
              },
            },
          },
          { id: 'native', spec: { placement: { display: { nativefmt: { asset: [] } } } } },
        ],
      },
    },
  });
  const plain = view.buildRequestView(req),
    ui = view.buildRequestView(req, { consumer: 'ui' });
  assert.equal(plain.imp[0].audio, undefined);
  assert.equal(plain.imp[0].secure, undefined);
  assert.equal(plain.imp[1].video.mimes, undefined);
  assert.deepEqual(ui.imp[0].audio.mimes, ['audio/mp4']);
  assert.equal(ui.imp[0].audio.minduration, 10);
  assert.equal(ui.imp[0].secure, 1);
  assert.equal(ui.imp[1].instl, 1);
  assert.deepEqual(ui.imp[1].video.mimes, ['video/mp4']);
  assert.deepEqual(ui.imp[1].banner.format, [{ w: 728, h: 90 }]);
  assert.equal(ui.imp[2].banner, undefined);
  assert.equal(ui.items[0].raw, req.openrtb.request.item[0]);
  assert.equal(ui.items[0].imp, ui.imp[0]);
});
