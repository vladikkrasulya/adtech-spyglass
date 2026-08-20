'use strict';

/**
 * A cached /live specimen must reach the matching Inspector editor for both
 * OpenRTB generations. The old handoff only recognised top-level 2.x arrays,
 * so a wrapped 3.0 response silently landed in the request editor.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { createBrowserEsmLoader } = require('./browser-esm-loader');
const core = require('../packages/core');

const loader = createBrowserEsmLoader({ realmSalt: 'inspector-specimen-handoff' });
const classifierSubject = loader.import('/core/auction-shape.js');
const handoffSubject = loader.import('/modules/inspector/specimen-handoff.js');

const CASES = [
  {
    name: 'OpenRTB 2.x request',
    specimen: { id: 'req-2', imp: [] },
    kind: 'req',
    body: 'root',
    version: null,
    target: 'bidReq',
  },
  {
    name: 'OpenRTB 2.x response',
    specimen: { id: 'res-2', seatbid: [] },
    kind: 'res',
    body: 'root',
    version: null,
    target: 'bidRes',
  },
  {
    name: 'OpenRTB 3.0 request',
    specimen: { openrtb: { ver: '3.0', request: { id: 'req-3', item: [] } } },
    kind: 'req',
    body: 'request',
    version: '3.0',
    target: 'bidReq',
  },
  {
    name: 'OpenRTB 3.0 response',
    specimen: { openrtb: { ver: '3.0', response: { id: 'res-3', seatbid: [] } } },
    kind: 'res',
    body: 'response',
    version: '3.0',
    target: 'bidRes',
  },
  {
    name: 'stray empty envelope does not hide a 2.x request',
    specimen: { openrtb: {}, id: 'req-stray', imp: [] },
    kind: 'req',
    body: 'root',
    version: null,
    target: 'bidReq',
  },
  {
    name: 'stray empty envelope does not hide a 2.x response',
    specimen: { openrtb: {}, id: 'res-stray', seatbid: [] },
    kind: 'res',
    body: 'root',
    version: null,
    target: 'bidRes',
  },
  {
    name: 'peeled OpenRTB 3.0 request',
    specimen: { id: 'req-3-inner', item: [] },
    kind: 'req',
    body: 'root',
    version: '3.0',
    target: 'bidReq',
  },
  {
    name: 'peeled OpenRTB 3.0 response',
    specimen: {
      id: 'res-3-inner',
      seatbid: [{ bid: [{ item: 'item-1', media: { display: { adm: '<div>ad</div>' } } }] }],
    },
    kind: 'res',
    body: 'root',
    version: '3.0',
    target: 'bidRes',
  },
  {
    name: 'ordinary 2.x response with impid',
    specimen: { id: 'res-2-inner', seatbid: [{ bid: [{ impid: 'imp-1' }] }] },
    kind: 'res',
    body: 'root',
    version: null,
    target: 'bidRes',
  },
  {
    name: 'unknown payload keeps the request fallback',
    specimen: { id: 'unknown' },
    kind: 'unknown',
    body: 'root',
    version: null,
    target: 'bidReq',
  },
];

test('shared auction classifier covers the 2.x/3.0 request-response matrix', async () => {
  const { classifyAuctionPayload } = await classifierSubject;

  for (const entry of CASES) {
    const shape = classifyAuctionPayload(entry.specimen);
    assert.equal(shape.kind, entry.kind, entry.name);
    assert.equal(shape.version, entry.version, entry.name);
    const expectedBody =
      entry.body === 'root' ? entry.specimen : entry.specimen.openrtb[entry.body];
    assert.equal(shape.body, expectedBody, `${entry.name}: body identity`);

    const coreType = core.detectType(entry.specimen);
    const coreKind =
      coreType === core.TYPES.ORTB_REQUEST
        ? 'req'
        : coreType === core.TYPES.ORTB_RESPONSE
          ? 'res'
          : 'unknown';
    const coreVersion = core.detectVersion(entry.specimen).version === '3.0' ? '3.0' : null;
    assert.equal(shape.kind, coreKind, `${entry.name}: browser/core kind parity`);
    assert.equal(shape.version, coreVersion, `${entry.name}: browser/core version parity`);
  }

  const intentionallyUnknown = [
    { specimen: null, body: null, version: null },
    { specimen: { imp: [], seatbid: [] }, body: 'root', version: null },
    {
      specimen: { imp: [], seatbid: [{ bid: [{ item: 'item-1', media: {} }] }] },
      body: 'root',
      version: '3.0',
    },
    { specimen: { item: ['not-an-adcom-item'] }, body: 'root', version: null },
    { specimen: { openrtb: {} }, body: 'envelope', version: '3.0' },
    {
      specimen: { openrtb: { request: {}, response: {} } },
      body: 'envelope',
      version: '3.0',
    },
  ];
  for (const entry of intentionallyUnknown) {
    const shape = classifyAuctionPayload(entry.specimen);
    assert.equal(shape.kind, 'unknown', 'malformed or contradictory payloads must not be guessed');
    assert.equal(shape.version, entry.version);
    if (entry.body === 'root') assert.equal(shape.body, entry.specimen);
    if (entry.body === 'envelope') assert.equal(shape.body, entry.specimen.openrtb);
  }
});

test('cached specimens load the full payload into exactly one matching editor', async () => {
  const { loadSpecimenIntoEditor } = await handoffSubject;

  for (const entry of CASES) {
    const dom = new JSDOM(
      '<!doctype html><textarea id="bidReq"></textarea><textarea id="bidRes"></textarea>',
    );
    const { document } = dom.window;
    const inputEvents = { bidReq: 0, bidRes: 0 };
    for (const id of Object.keys(inputEvents)) {
      document.getElementById(id).addEventListener('input', () => inputEvents[id]++);
    }

    const target = loadSpecimenIntoEditor(entry.specimen, document);
    const other = entry.target === 'bidReq' ? 'bidRes' : 'bidReq';

    assert.equal(target, entry.target, entry.name);
    assert.equal(
      document.getElementById(entry.target).value,
      JSON.stringify(entry.specimen, null, 2),
    );
    assert.equal(
      document.getElementById(other).value,
      '',
      `${entry.name}: other editor stays empty`,
    );
    assert.equal(inputEvents[entry.target], 1, `${entry.name}: target emits one input event`);
    assert.equal(inputEvents[other], 0, `${entry.name}: other editor emits no input event`);
    dom.window.close();
  }
});

test('handoff reports a missing target instead of touching the other editor', async () => {
  const { loadSpecimenIntoEditor } = await handoffSubject;
  const dom = new JSDOM('<!doctype html><textarea id="bidReq"></textarea>');
  assert.equal(loadSpecimenIntoEditor({ seatbid: [] }, dom.window.document), null);
  assert.equal(dom.window.document.getElementById('bidReq').value, '');
  dom.window.close();
});
