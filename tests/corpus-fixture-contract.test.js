'use strict';

/**
 * Independently check selected source properties of positive corpus fixtures.
 * No product validator/detector supplies these rules or their expected values.
 * This is deliberately not an OpenRTB/AdCOM schema certification: negative
 * mutations and vendor-valid reference conventions have different oracles.
 *
 * Pinned primary sources:
 * https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md
 *   #object_device: os is integer; device kind is type, not 2.x devicetype.
 *   #object_audio / #object_video: mime is a string array on both media objects.
 *   #object_displayplacement / #object_display: nativefmt/native are nested
 *   display subtypes. #object_assetformat: required assets use req=1 and unique
 *   integer IDs. #object_asset: id references the placement's AssetFormat.id.
 *   #requestcontext: context objects are optional; one distribution channel.
 * https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbidrequest
 * https://iabtechlab.com/wp-content/uploads/2016/07/OpenRTB-API-Specification-Version-2-5-FINAL.pdf
 *   BidRequest Site/App/Device and Device Types; DOOH is a 2.6 addition.
 * https://github.com/InteractiveAdvertisingBureau/VAST/blob/e0858cd714474bf17ef61065097456d7643ff838/vast_4.1.xsd
 * https://github.com/InteractiveAdvertisingBureau/VAST/blob/e0858cd714474bf17ef61065097456d7643ff838/vast_4.2.xsd
 *   Inline_type requires AdServingId. Its documentation requires a generated
 *   pseudo-unique identifier; an empty value supplies no identifier. This rule
 *   does not apply to VAST 4.0 or to Wrapper elements.
 *
 * The coverage axis has one primary context label. CTV takes precedence over
 * its site/app channel; the expected detector set, when supplied, retains both.
 * OpenRTB 2.x payloads can be compatible with multiple minor revisions, so this
 * guard never invents a detectable minor version from a metadata label alone.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadCorpus } = require('./corpus/lib/load');

// DOMParser parses inert XML only. No creative scripts or resources execute.
const xmlWindow = new JSDOM('').window;
const xmlParser = new xmlWindow.DOMParser();
after(() => xmlWindow.close());

/** @param {any} value */
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {any} c */
function standardPositive(c) {
  return (
    c.kind === 'pair' &&
    c.meta.reference?.validity === 'valid' &&
    /^openrtb-/.test(c.meta.reference.wireProtocol)
  );
}

/** @param {any} c */
function isAdcom(c) {
  return (
    c.meta.protocol === 'ortb-3.0' ||
    c.request?.openrtb !== undefined ||
    c.response?.openrtb !== undefined
  );
}

/** @param {any} c @returns {string[]} */
function contextProblems(c) {
  const errors = [];
  const adcom = isAdcom(c);
  const context = adcom ? c.request?.openrtb?.request?.context : c.request;
  const channels = [
    ['site', 'web'],
    ['app', 'inapp'],
    ['dooh', 'dooh'],
  ].filter(([field]) => object(context?.[field]));
  if (channels.length > 1) errors.push('request: multiple standard distribution channels');
  if (c.meta.protocol === 'ortb-2.5' && context?.dooh !== undefined)
    errors.push('request.dooh: no standard OpenRTB 2.5 DOOH object');
  const device = context?.device;
  if (adcom && device?.devicetype !== undefined)
    errors.push('context.device.devicetype: use AdCOM Device.type');
  const deviceType = adcom ? device?.type : device?.devicetype;
  const contexts = channels.map(([, label]) => label);
  // Type 3 is Connected TV; type 7 is Set Top Box, grouped with CTV by
  // the existing documented corpus runtime-context vocabulary.
  if (deviceType === 3 || deviceType === 7) contexts.push('ctv');
  const primary = contexts.includes('ctv') ? 'ctv' : contexts[0] || 'n/a';
  if (c.meta.context !== primary)
    errors.push(`context metadata: expected ${primary}, declared ${c.meta.context}`);
  const declaredSet = c.meta.expect?.format?.contexts;
  if (
    declaredSet !== undefined &&
    [...new Set(declaredSet)].sort().join('|') !== [...new Set(contexts)].sort().join('|')
  )
    errors.push(`context oracle: expected [${contexts.join(', ')}] from the supplied payload`);
  return errors;
}

/** @param {any} c @returns {string[]} */
function adcomProblems(c) {
  const errors = [];
  if (!isAdcom(c)) return errors;
  if (c.meta.protocol !== 'ortb-3.0')
    errors.push('protocol metadata: an OpenRTB 3.0 envelope requires ortb-3.0');
  for (const side of ['request', 'response']) {
    if (c[side] === undefined) continue;
    if (
      c[side]?.openrtb?.ver !== '3.0' ||
      c[side]?.openrtb?.domainspec !== 'adcom' ||
      !object(c[side]?.openrtb?.[side])
    )
      errors.push(`${side}: expected an OpenRTB 3.0 AdCOM ${side} envelope`);
  }
  const request = c.request?.openrtb?.request;
  const response = c.response?.openrtb?.response;
  const device = request?.context?.device;
  if (device?.os !== undefined && !Number.isInteger(device.os))
    errors.push('context.device.os: AdCOM requires an integer');

  const items = Array.isArray(request?.item) ? request.item : [];
  for (const [index, item] of items.entries()) {
    const placement = item.spec?.placement;
    if (placement?.native !== undefined || placement?.display?.native !== undefined)
      errors.push(`item[${index}]: NativeFormat belongs at spec.placement.display.nativefmt`);
    const format = placement?.display?.nativefmt;
    if (format === undefined) continue;
    if (!Array.isArray(format?.asset)) {
      errors.push(`item[${index}].nativefmt.asset: required array`);
      continue;
    }
    const ids = new Set();
    for (const asset of format.asset) {
      if (!Number.isInteger(asset?.id))
        errors.push(`item[${index}].nativefmt.asset.id: required integer`);
      else if (ids.has(asset.id))
        errors.push(`item[${index}].nativefmt.asset.id: duplicate ${asset.id}`);
      ids.add(asset?.id);
    }
  }
  const seats = Array.isArray(response?.seatbid) ? response.seatbid : [];
  for (const [si, seat] of seats.entries()) {
    const bids = Array.isArray(seat.bid) ? seat.bid : [];
    for (const [bi, bid] of bids.entries()) {
      const where = `seatbid[${si}].bid[${bi}]`;
      const ad = bid.media?.ad;
      if (ad?.native !== undefined || ad?.display?.nativefmt !== undefined)
        errors.push(`${where}: Native belongs at media.ad.display.native`);
      for (const media of ['audio', 'video']) {
        const mime = ad?.[media]?.mime;
        if (
          mime !== undefined &&
          (!Array.isArray(mime) || mime.some((value) => typeof value !== 'string' || !value))
        )
          errors.push(`${where}.media.ad.${media}.mime: expected string array`);
      }
      const native = ad?.display?.native;
      if (native === undefined) continue;
      if (native.asset !== undefined && !Array.isArray(native.asset)) {
        errors.push(`${where}.native.asset: expected array when supplied`);
        continue;
      }
      const assets = native.asset || [];
      for (const asset of assets) {
        if (asset?.id !== undefined && !Number.isInteger(asset.id))
          errors.push(`${where}.native.asset.id: expected integer when supplied`);
      }
      const item = items.find((offered) => offered.id === bid.item);
      const formats = item?.spec?.placement?.display?.nativefmt?.asset;
      if (!Array.isArray(formats)) continue;
      for (const format of formats) {
        if (format.req === 1 && !assets.some((asset) => asset?.id === format.id))
          errors.push(`${where}.native.asset: missing required placement asset ${format.id}`);
      }
    }
  }
  return errors;
}

/** @param {any} c @returns {string[]} */
function fixtureProblems(c) {
  if (!standardPositive(c)) return [];
  return [...contextProblems(c), ...adcomProblems(c)];
}

/** @param {string} body @returns {string[]} */
function vastServingIdProblems(body) {
  if (!/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<(?:[A-Za-z_][\w.-]*:)?VAST\b/.test(body)) return [];
  const document = xmlParser.parseFromString(body, 'application/xml');
  if (document.documentElement.localName === 'parsererror')
    return ['positive VAST body: malformed XML'];
  const root = document.documentElement;
  if (root.localName !== 'VAST') return [];
  const version = root.getAttribute('version');
  if (version !== '4.1' && version !== '4.2') return [];
  const errors = [];
  const inlines = [...root.getElementsByTagNameNS(root.namespaceURI, 'InLine')];
  for (const [index, inline] of inlines.entries()) {
    const ids = [...inline.children].filter(
      (child) => child.localName === 'AdServingId' && child.namespaceURI === root.namespaceURI,
    );
    if (ids.length !== 1 || !ids[0].textContent.trim())
      errors.push(`VAST ${version} InLine[${index}]: one nonempty AdServingId is required`);
  }
  return errors;
}

/** @param {any} c @returns {string[]} */
function bidMarkup(c) {
  const response = c.response?.openrtb?.response || c.response;
  const bodies = [];
  for (const seat of response?.seatbid || []) {
    for (const bid of seat.bid || []) {
      const ad = bid.media?.ad;
      bodies.push(bid.adm, ad?.display?.adm, ad?.video?.adm, ad?.audio?.adm);
      // Native 1.2 can carry VAST inside video.vasttag. Its outer adm is JSON,
      // so extract the actual XML child instead of parsing that JSON as XML.
      if (typeof bid.adm === 'string' && bid.adm.trimStart().startsWith('{')) {
        try {
          const parsed = JSON.parse(bid.adm);
          for (const asset of (parsed.native || parsed).assets || [])
            bodies.push(asset.video?.vasttag);
        } catch {
          // This guard checks VAST fields; Native JSON validity has its own oracle.
        }
      }
    }
  }
  return bodies.filter((body) => typeof body === 'string');
}

// Explicit empty filters make this a repository integrity gate even when a
// caller narrows the executed Core/HTTP/browser cases with environment flags.
const corpus = loadCorpus({ caseFilter: '', formatFilter: '', kinds: ['pair'] });
const candidates = corpus.pairs.filter(standardPositive);

test('fixture contracts: positive standards cases have payload-grounded context metadata', () => {
  assert.ok(candidates.length > 0, 'the standards fixture guard must not be vacuous');
  const errors = candidates.flatMap((c) => contextProblems(c).map((error) => `${c.id}: ${error}`));
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('fixture contracts: positive AdCOM cases use source-defined types, Native paths and asset references', () => {
  const adcom = candidates.filter(isAdcom);
  assert.deepEqual([...new Set(adcom.map((c) => c.meta.format))].sort(), [
    'audio',
    'banner',
    'native',
    'video',
  ]);
  const errors = adcom.flatMap((c) => adcomProblems(c).map((error) => `${c.id}: ${error}`));
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('fixture contracts: positive VAST 4.1/4.2 inline bodies supply their required serving identifiers', () => {
  const errors = candidates.flatMap((c) =>
    bidMarkup(c).flatMap((body) => vastServingIdProblems(body).map((error) => `${c.id}: ${error}`)),
  );
  assert.ok(
    candidates.some((c) => bidMarkup(c).some((body) => /<VAST\s[^>]*version="4\.[12]"/.test(body))),
    'the required serving-identifier guard must exercise positive VAST fixtures',
  );
  assert.deepEqual(errors, [], errors.join('\n'));
});

/** Independently constructed contract example; no product output is read.
 * @returns {any}
 */
function nativeExample() {
  return {
    kind: 'pair',
    meta: {
      protocol: 'ortb-3.0',
      context: 'ctv',
      reference: { validity: 'valid', wireProtocol: 'openrtb-3.0' },
      expect: { format: { contexts: ['inapp', 'ctv'] } },
    },
    request: {
      openrtb: {
        ver: '3.0',
        domainspec: 'adcom',
        request: {
          context: { app: { bundle: 'test.example.television' }, device: { type: 3 } },
          item: [
            {
              id: 'native-slot',
              spec: {
                placement: {
                  display: {
                    nativefmt: {
                      asset: [
                        { id: 1, req: 1, title: { len: 40 } },
                        { id: 2, req: 0, img: { type: 3, w: 1, h: 1 } },
                      ],
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
    response: {
      openrtb: {
        ver: '3.0',
        domainspec: 'adcom',
        response: {
          seatbid: [
            {
              bid: [
                {
                  item: 'native-slot',
                  media: {
                    ad: { display: { native: { asset: [{ id: 1, title: { text: 'Ad' } }] } } },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  };
}

test('fixture contracts: optional Native assets, absent context and web/CTV context unions remain valid', () => {
  const c = nativeExample();
  assert.deepEqual(fixtureProblems(c), []);
  c.request.openrtb.request.context = {
    site: { domain: 'publisher.example.test' },
    device: { type: 3 },
  };
  c.meta.expect.format.contexts = ['ctv', 'web'];
  assert.deepEqual(fixtureProblems(c), []);
  delete c.request.openrtb.request.context;
  c.meta.context = 'n/a';
  c.meta.expect.format.contexts = [];
  assert.deepEqual(fixtureProblems(c), []);
  delete c.request;
  assert.deepEqual(
    fixtureProblems(c),
    [],
    'response-only Native needs no invented request context',
  );
});

test('fixture contracts: negative mutations and vendor reference conventions are not positive standards fixtures', () => {
  const c = nativeExample();
  c.request.openrtb.request.context.device.os = 'Linux';
  c.kind = 'mutation';
  assert.deepEqual(fixtureProblems(c), []);
  c.kind = 'pair';
  c.meta.reference.validity = 'vendor-valid';
  assert.deepEqual(fixtureProblems(c), []);
});

const corruptions = [
  {
    name: 'string OS borrowed from OpenRTB 2.x',
    edit: (c) => {
      c.request.openrtb.request.context.device.os = 'Linux';
    },
    failure: 'context.device.os: AdCOM requires an integer',
  },
  ...['audio', 'video'].map((media) => ({
    name: `singular ${media} MIME borrowed from Display`,
    edit: (c) => {
      c.response.openrtb.response.seatbid[0].bid[0].media.ad[media] = { mime: `${media}/mp4` };
    },
    failure: `seatbid[0].bid[0].media.ad.${media}.mime: expected string array`,
  })),
  {
    name: 'misplaced request NativeFormat',
    edit: (c) => {
      const p = c.request.openrtb.request.item[0].spec.placement;
      p.native = p.display.nativefmt;
      delete p.display.nativefmt;
    },
    failure: 'item[0]: NativeFormat belongs at spec.placement.display.nativefmt',
  },
  {
    name: 'misplaced response Native',
    edit: (c) => {
      const ad = c.response.openrtb.response.seatbid[0].bid[0].media.ad;
      ad.native = ad.display.native;
      delete ad.display.native;
    },
    failure: 'seatbid[0].bid[0]: Native belongs at media.ad.display.native',
  },
  {
    name: 'omitted required Native asset',
    edit: (c) => {
      c.response.openrtb.response.seatbid[0].bid[0].media.ad.display.native.asset = [];
    },
    failure: 'seatbid[0].bid[0].native.asset: missing required placement asset 1',
  },
  {
    name: 'duplicated placement asset ID',
    edit: (c) => {
      c.request.openrtb.request.item[0].spec.placement.display.nativefmt.asset[1].id = 1;
    },
    failure: 'item[0].nativefmt.asset.id: duplicate 1',
  },
  {
    name: 'changed context metadata without changing the payload',
    edit: (c) => {
      c.meta.context = 'dooh';
    },
    failure: 'context metadata: expected ctv, declared dooh',
  },
  {
    name: 'dropped app channel from the expected CTV union',
    edit: (c) => {
      c.meta.expect.format.contexts = ['ctv'];
    },
    failure: 'context oracle: expected [inapp, ctv] from the supplied payload',
  },
  {
    name: 'legacy device key inside AdCOM context',
    edit: (c) => {
      c.request.openrtb.request.context.device = { devicetype: 3 };
    },
    failure: 'context.device.devicetype: use AdCOM Device.type',
  },
];

for (const { name, edit, failure } of corruptions) {
  test(`fixture contracts: rejects ${name}`, () => {
    const c = nativeExample();
    assert.deepEqual(fixtureProblems(c), [], 'the unmodified example must satisfy the contract');
    edit(c);
    assert.ok(fixtureProblems(c).includes(failure), failure);
  });
}

test('fixture contracts: a standard 2.5 DOOH label cannot be manufactured from a later-version object', () => {
  const c = {
    kind: 'pair',
    meta: {
      protocol: 'ortb-2.5',
      context: 'dooh',
      reference: { validity: 'valid', wireProtocol: 'openrtb-2.5' },
    },
    request: { id: 'synthetic', dooh: { id: 'screen' }, imp: [] },
  };
  assert.ok(fixtureProblems(c).includes('request.dooh: no standard OpenRTB 2.5 DOOH object'));
});

test('fixture contracts: the serving-identifier rule excludes older VAST and Wrapper bodies', () => {
  assert.deepEqual(vastServingIdProblems('<VAST version="4.0"><Ad><InLine/></Ad></VAST>'), []);
  assert.deepEqual(vastServingIdProblems('<VAST version="4.2"><Ad><Wrapper/></Ad></VAST>'), []);
  const native = JSON.stringify({
    native: { assets: [{ video: { vasttag: '<VAST version="4.1"><Ad><InLine/></Ad></VAST>' } }] },
  });
  assert.deepEqual(vastServingIdProblems(native), [], 'Native JSON is not an XML document');
  const bodies = bidMarkup({ response: { seatbid: [{ bid: [{ adm: native }] }] } });
  assert.equal(bodies.flatMap(vastServingIdProblems).length, 1, 'inspect the extracted VAST child');
});

for (const version of ['4.1', '4.2']) {
  test(`fixture contracts: VAST ${version} serving identifiers must be real inline children`, () => {
    const wrapper = (contents) =>
      `<VAST version="${version}" xmlns="http://www.iab.com/VAST"><Ad><InLine>${contents}</InLine></Ad></VAST>`;
    assert.deepEqual(
      vastServingIdProblems(wrapper('<AdServingId>synthetic-serving-id</AdServingId>')),
      [],
    );
    for (const contents of [
      '',
      '<AdServingId> </AdServingId>',
      '<Extensions><AdServingId>misplaced</AdServingId></Extensions>',
      '<AdServingId xmlns="urn:unrelated">wrong-namespace</AdServingId>',
      '<AdTitle><![CDATA[<AdServingId>text-only</AdServingId>]]></AdTitle>',
    ]) {
      assert.deepEqual(vastServingIdProblems(wrapper(contents)), [
        `VAST ${version} InLine[0]: one nonempty AdServingId is required`,
      ]);
    }
  });
}
