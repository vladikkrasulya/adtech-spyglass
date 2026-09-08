'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Core = require('../packages/core');
const { run, EXIT_OK, EXIT_FINDINGS } = require('../packages/cli/lib/cli');
const { startServer, postAnalyzeRaw } = require('./corpus/lib/http-run');

function response(fields = {}) {
  return {
    id: 'semantic-response',
    seatbid: [
      {
        seat: 'buyer-a',
        bid: [
          {
            id: 'bid',
            impid: 'slot',
            price: 1,
            adomain: ['advertiser.example.test'],
            adm: '<p>Creative</p>',
            ...fields,
          },
        ],
      },
    ],
  };
}

function request(fields = {}) {
  return {
    id: 'semantic-response',
    imp: [{ id: 'slot', banner: { w: 300, h: 250 } }],
    site: { domain: 'publisher.example.test' },
    device: { ua: 'Synthetic validator test', ip: '192.0.2.8' },
    ...fields,
  };
}

function response30(display) {
  return {
    openrtb: {
      ver: '3.0',
      response: {
        id: 'semantic-response',
        seatbid: [
          {
            seat: 'buyer-a',
            bid: [
              {
                id: 'bid',
                item: 'slot',
                price: 1,
                media: { ad: { adomain: ['advertiser.example.test'], display } },
              },
            ],
          },
        ],
      },
    },
  };
}

function finding(payload, id, options = {}) {
  return Core.validate(payload, options).findings.filter((f) => f.id === id);
}

function exact(payload, id, expectedPath, level, options = {}) {
  const hits = finding(payload, id, options);
  assert.equal(hits.length, 1, `${id}: ${JSON.stringify(hits)}`);
  assert.equal(hits[0].path, expectedPath);
  assert.equal(hits[0].level, level);
  return hits[0];
}

test('026 response: optional markup types are strict integer values 1–4', () => {
  for (const value of [undefined, 1, 2, 3, 4]) {
    assert.deepEqual(finding(response({ mtype: value }), 'response.bid.mtype_invalid_enum'), []);
  }
  for (const value of [null, false, '2', [], {}, 0, 5, 500, 1.5, NaN, Infinity]) {
    const f = exact(
      response({ mtype: value }),
      'response.bid.mtype_invalid_enum',
      'seatbid[0].bid[0].mtype',
      'error',
    );
    assert.deepEqual(f.params.mtype, value);
  }
});

test('026 response: duplicate seats refer to repeated groups, not several bids in one group', () => {
  const payload = response();
  payload.seatbid[0].bid.push({ ...payload.seatbid[0].bid[0], id: 'bid-2' });
  assert.deepEqual(finding(payload, 'response.seatbid_seat_duplicated'), []);
  for (const seat of ['buyer-b', undefined, null, 7]) {
    payload.seatbid[1] = { seat: /** @type {any} */ (seat), bid: [payload.seatbid[0].bid[0]] };
    assert.deepEqual(finding(payload, 'response.seatbid_seat_duplicated'), []);
  }
  payload.seatbid[1].seat = 'buyer-a';
  const f = exact(payload, 'response.seatbid_seat_duplicated', 'seatbid[1].seat', 'error');
  assert.equal(f.params.seat, 'buyer-a');
  const modern = response30({ adm: '<p>Creative</p>' });
  modern.openrtb.response.seatbid.push(structuredClone(modern.openrtb.response.seatbid[0]));
  exact(modern, 'response.30.seatbid_seat_duplicated', 'openrtb.response.seatbid[1].seat', 'error');
  exact(modern.openrtb.response, 'response.30.seatbid_seat_duplicated', 'seatbid[1].seat', 'error');
});

test('026 response: a supplied blank creative has its own diagnostic and carriers remain distinct', () => {
  for (const adm of ['   ', '\t\r\n', '\u00a0']) {
    for (const nurl of [undefined, 'https://notice.example.test/win']) {
      const payload = response({ adm, nurl });
      exact(payload, 'response.bid.adm_blank', 'seatbid[0].bid[0].adm', 'warning');
      assert.deepEqual(finding(payload, 'response.bid.payload_missing'), []);
    }
  }
  for (const adm of [undefined, '']) {
    exact(response({ adm }), 'response.bid.payload_missing', 'seatbid[0].bid[0].adm', 'warning');
  }
  assert.deepEqual(
    finding(
      response({ adm: undefined, nurl: 'https://notice.example.test/win' }),
      'response.bid.payload_missing',
    ),
    [],
  );
  const native = {
    assets: [{ id: 1, title: { text: 'A native title' } }],
    link: { url: 'https://advertiser.example.test' },
  };
  assert.deepEqual(
    finding(response({ adm: undefined, native }), 'response.bid.payload_missing'),
    [],
  );
  for (const value of [null, [], 'native', 1]) {
    exact(
      response({ adm: undefined, native: value }),
      'response.bid.payload_missing',
      'seatbid[0].bid[0].adm',
      'warning',
    );
  }
});

test('026 response: AdCOM structured native replaces display markup while invalid supplied native stays an error', () => {
  const native = { asset: [{ id: 1, title: { text: 'Native title' } }] };
  for (const payload of [response30({ native }), response30({ native }).openrtb.response]) {
    assert.deepEqual(finding(payload, 'response.30.bid.display.markup_required'), []);
    assert.deepEqual(finding(payload, 'response.30.bid.native_invalid'), []);
  }
  for (const value of [null, [], false, 1, 'native']) {
    for (const adm of [undefined, '<p>Alternate supplied markup</p>']) {
      exact(
        response30({ native: value, adm }),
        'response.30.bid.native_invalid',
        'openrtb.response.seatbid[0].bid[0].media.ad.display.native',
        'error',
      );
    }
  }
  exact(
    response30({}),
    'response.30.bid.display.markup_required',
    'openrtb.response.seatbid[0].bid[0].media.ad.display',
    'error',
  );
});

test('026 response: unassigned no-bid reasons remain distinct from malformed types and the private range', () => {
  for (const modern of [false, true]) {
    const id = modern ? 'response.30.nbr_code_unassigned' : 'response.nbr_code_unassigned';
    const invalidId = modern ? 'response.30.nbr_invalid' : 'response.nbr_invalid';
    const p = modern ? 'openrtb.response.nbr' : 'nbr';
    const make = (nbr) =>
      modern
        ? { openrtb: { ver: '3.0', response: { id: 'no-bid', seatbid: [], nbr } } }
        : { id: 'no-bid', seatbid: [], nbr };
    for (const nbr of [undefined, ...Array.from({ length: 18 }, (_, i) => i), 500, 700]) {
      assert.deepEqual(finding(make(nbr), id), []);
      assert.deepEqual(finding(make(nbr), invalidId), []);
    }
    for (const nbr of [-1, 18, 42, 499]) exact(make(nbr), id, p, 'warning');
    for (const nbr of [null, '0', false, [], {}, 1.5, NaN, Infinity]) {
      exact(make(nbr), invalidId, p, 'error');
      assert.deepEqual(finding(make(nbr), id), []);
    }
  }
});

test('026 request: COPPA is optional but supplied values must be integer 0 or 1', () => {
  for (const coppa of [undefined, 0, 1])
    assert.deepEqual(finding(request({ regs: { coppa } }), 'regs.coppa_invalid'), []);
  for (const coppa of [null, '0', false, [], {}, -1, 2, 0.5])
    exact(request({ regs: { coppa } }), 'regs.coppa_invalid', 'regs.coppa', 'error');
});

test('026 request: the EXADS instl-only exception requires explicit dialect and valid shape', () => {
  const payload = request({ imp: [{ id: 'slot', instl: 1 }] });
  assert.deepEqual(finding(payload, 'imp.format_required', { dialect: 'ext-rtb' }), []);
  exact(payload, 'imp.format_required', 'imp[0]', 'error');
  for (const instl of [undefined, 0, '1', true]) {
    exact(request({ imp: [{ id: 'slot', instl }] }), 'imp.format_required', 'imp[0]', 'error', {
      dialect: 'ext-rtb',
    });
  }
  for (const banner of [null, false, 0]) {
    exact(
      request({ imp: [{ id: 'slot', instl: 1, banner }] }),
      'imp.format_required',
      'imp[0]',
      'error',
      { dialect: 'ext-rtb' },
    );
  }
  exact(
    request({ imp: [{ id: 'slot', instl: 1, banner: {} }] }),
    'imp.banner.size_required',
    'imp[0].banner',
    'error',
    { dialect: 'ext-rtb' },
  );
});

test('026 response: pop accepts valid notice-only bids without bypassing supplied bad markup', () => {
  const pop = (adm, nurl) => response({ adm, nurl, ext: { adtype: 'popunder' } });
  for (const nurl of [
    'https://notice.example.test/win',
    'https://notice.example.test/win?p=${AUCTION_PRICE}',
  ]) {
    assert.deepEqual(finding(pop(undefined, nurl), 'bid.pop.adm_not_redirect'), []);
    for (const adm of [null, '', '   ', '<p>Banner creative</p>', 2, {}]) {
      exact(pop(adm, nurl), 'bid.pop.adm_not_redirect', 'seatbid[0].bid[0].adm', 'error');
    }
  }
  for (const nurl of [
    undefined,
    null,
    '',
    '   ',
    'javascript:alert(1)',
    'https://notice.example.test/<iframe>',
  ]) {
    exact(pop(undefined, nurl), 'bid.pop.adm_not_redirect', 'seatbid[0].bid[0].adm', 'error');
  }
  assert.deepEqual(
    finding(pop('https://advertiser.example.test/landing', undefined), 'bid.pop.adm_not_redirect'),
    [],
  );
});

test('026 response: CLI keeps its severity policy for invalid mtype and unknown reason codes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-026-response-cli-'));
  try {
    const file = path.join(dir, 'response.json');
    const io = { out() {}, err() {}, isTTY: false };
    fs.writeFileSync(file, JSON.stringify(response({ mtype: 5 })));
    assert.equal(await run(['validate', file, '--json'], io), EXIT_FINDINGS);
    fs.writeFileSync(file, JSON.stringify(response({ mtype: 1 })));
    assert.equal(await run(['validate', file, '--json'], io), EXIT_OK);
    fs.writeFileSync(file, JSON.stringify({ id: 'no-bid', nbr: 42 }));
    assert.equal(await run(['validate', file, '--json'], io), EXIT_OK);
    assert.equal(await run(['validate', file, '--json', '--fail-on', 'warn'], io), EXIT_FINDINGS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('026 response: HTTP exposes the same strict field and Native semantics', async () => {
  const server = await startServer();
  try {
    for (const locale of ['en', 'uk', 'ru']) {
      const result = await postAnalyzeRaw(
        server.url,
        JSON.stringify({ bidReq: request({ regs: { coppa: 2 } }), bidRes: response({ mtype: 5 }) }),
        { locale },
      );
      assert.equal(result.status, 200);
      const findings = result.body.validation.findings;
      for (const [id, p] of [
        ['regs.coppa_invalid', 'regs.coppa'],
        ['response.bid.mtype_invalid_enum', 'seatbid[0].bid[0].mtype'],
      ]) {
        const hit = findings.find((f) => f.id === id);
        assert.ok(hit, id);
        assert.equal(hit.path, p);
        assert.equal(hit.level, 'error');
      }
    }
    const native = await postAnalyzeRaw(
      server.url,
      JSON.stringify({
        bidRes: response30({ native: { asset: [{ id: 1, title: { text: 'Native title' } }] } }),
      }),
    );
    assert.equal(native.status, 200);
    assert.equal(
      native.body.validation.findings.some(
        (f) => f.id === 'response.30.bid.display.markup_required',
      ),
      false,
    );
  } finally {
    await server.stop();
  }
});
