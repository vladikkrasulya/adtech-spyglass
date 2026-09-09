'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('@ortbtools/core');
const { inspectSchain, listInspectionProfiles, evaluateDeclaredRoute } = core;
const chain = (nodes = [{ asi: 'seller.example', sid: 'Seller-A', hp: 1 }]) => ({
  ver: '1.0',
  complete: 1,
  nodes,
});
const req = (schain) => ({
  id: 'request-1',
  imp: [{ id: 'imp-1', video: { mimes: ['video/mp4'] } }],
  app: { bundle: 'com.unrelated.app' },
  source: { schain },
});
const sender = { asi: 'seller.example', sid: 'Seller-A', provenance: 'declared' };
const ids = (result) => result.findings.map((f) => f.id);
const route = {
  adapterId: 'logan',
  direction: 'request',
  revision: '0ba352315253f6692af6497d553cfb12909a1b8b',
  provenance: 'declared',
};

test('inspection: complete single node and absent optional metadata remain valid', () => {
  const result = inspectSchain(req(chain()));
  assert.equal(result.status, 'valid');
  assert.equal(result.copies[0].nodeCount, 1);
  assert.ok(result.findings.every((finding) => finding.level === 'info'));
  assert.equal(result.comparison.status, 'unknown');
  assert.equal(result.comparison.provenance, 'none');
  assert.ok(!ids(result).some((id) => id.includes('domain_mismatch')));
});

test('inspection: all current, historical and normative3 source paths retain precision', () => {
  for (const [input, path] of [
    [{ source: { schain: { ...chain(), ver: '9' } } }, 'source.schain'],
    [{ source: { ext: { schain: { ...chain(), ver: '9' } } } }, 'source.ext.schain'],
    [{ ext: { schain: { ...chain(), ver: '9' } } }, 'ext.schain'],
    [
      { openrtb: { request: { source: { schain: { ...chain(), ver: '9' } } } } },
      'openrtb.request.source.schain',
    ],
  ]) {
    const result = inspectSchain(input);
    assert.equal(result.status, 'invalid');
    assert.equal(result.findings.find((f) => f.id === 'err-schain-version').path, `${path}.ver`);
  }
});

test('inspection: only repeated domain plus case-sensitive seller identity is duplicate', () => {
  const nodes = [
    { asi: 'seller.example', sid: 'A', hp: 1 },
    { asi: 'SELLER.EXAMPLE', sid: 'B', hp: 1 },
    { asi: 'seller.example', sid: 'a', hp: 1 },
  ];
  assert.ok(!ids(inspectSchain(chain(nodes))).includes('schain.duplicate_identity'));
  nodes.push({ asi: 'SELLER.EXAMPLE', sid: 'A', hp: 1 });
  const finding = inspectSchain(chain(nodes)).findings.find(
    (f) => f.id === 'schain.duplicate_identity',
  );
  assert.equal(finding.path, '$.nodes[3]');
  assert.equal(finding.params.first, 0);
});

test('inspection: key order and domain case compare equal but seller account/node order differ', () => {
  const a = chain([
    { asi: 'seller.example', sid: 'A', hp: 1 },
    { asi: 'next.example', sid: 'B', hp: 1 },
  ]);
  const b = {
    nodes: a.nodes.map((node) => ({ hp: 1, sid: node.sid, asi: node.asi.toUpperCase() })),
    complete: 1,
    ver: '1.0',
  };
  const input = { source: { schain: a, ext: { schain: b } } };
  assert.ok(!ids(inspectSchain(input)).includes('schain.copy_conflict'));
  b.nodes.reverse();
  assert.equal(
    inspectSchain(input).findings.find((f) => f.id === 'schain.copy_conflict').path,
    'source.ext.schain',
  );
  b.nodes.reverse();
  b.nodes[0].sid = 'a';
  assert.ok(ids(inspectSchain(input)).includes('schain.copy_conflict'));
});

test('inspection: unknown extension strings are not case-normalized as seller domains', () => {
  const a = { ...chain(), ext: { domain: 'Case-Sensitive' } };
  const b = { ...chain(), ext: { domain: 'case-sensitive' } };
  assert.ok(
    ids(inspectSchain({ source: { schain: a, ext: { schain: b } } })).includes(
      'schain.copy_conflict',
    ),
  );
});

test('inspection: malformed copies and identities get structural findings without fake conflicts', () => {
  const result = inspectSchain({
    source: { schain: chain(), ext: { schain: { ...chain(), nodes: [null, null] } } },
    ext: { schain: null },
  });
  assert.equal(result.status, 'invalid');
  assert.ok(ids(result).includes('err-schain-node-invalid'));
  assert.ok(ids(result).includes('err-schain-invalid'));
  assert.ok(!ids(result).includes('schain.copy_conflict'));
  assert.ok(!ids(result).includes('schain.duplicate_identity'));
});

test('inspection: malformed optional structured fields cannot support copy or sender verdicts', () => {
  const optionalFields = [
    { field: 'ext', id: 'schain.ext_invalid', at: 'chain' },
    { field: 'ext', id: 'schain.node.ext_invalid', at: 'node' },
    { field: 'name', id: 'schain.node.name_invalid', at: 'node' },
  ];
  for (const { field, id, at } of optionalFields) {
    const values = field === 'name' ? [17, [], {}, null, false] : [17, [], 'opaque', null, false];
    for (const value of values) {
      const malformed = chain();
      (at === 'chain' ? malformed : malformed.nodes[0])[field] = value;
      const path = `source.ext.schain${at === 'node' ? '.nodes[0]' : ''}.${field}`;
      for (const locale of ['en', 'uk', 'ru']) {
        const result = inspectSchain(
          { source: { schain: chain(), ext: { schain: malformed } } },
          { declaredSender: sender, locale },
        );
        assert.equal(result.status, 'invalid', `${id}: ${JSON.stringify(value)}`);
        assert.deepEqual(
          result.copies.map((copy) => copy.valid),
          [true, false],
        );
        assert.ok(!ids(result).includes('schain.copy_conflict'));
        assert.deepEqual(result.comparison.copies, [{ path: 'source.schain', status: 'match' }]);
        const finding = result.findings.find((item) => item.id === id);
        assert.equal(finding.path, path);
        assert.equal(finding.level, 'error');
        assert.ok(finding.specRef);
        assert.ok(!finding.msg.startsWith('['));
        assert.ok(!/\{\w+\}/.test(finding.msg));
      }
      const standalone = inspectSchain(malformed, { declaredSender: sender });
      assert.equal(standalone.comparison.status, 'unknown');
      assert.equal(standalone.comparison.reason, 'no_valid_chain');
      const wrapped = {
        openrtb: {
          ver: '3.0',
          request: {
            id: 'r',
            item: [{ id: 'i', spec: { placement: { video: { mime: ['video/mp4'] } } } }],
            source: { schain: malformed },
          },
        },
      };
      for (const [input, prefix] of [
        [req(malformed), ''],
        [wrapped, 'openrtb.request.'],
      ]) {
        const finding = core.validate(input).findings.find((item) => item.id === id);
        assert.equal(finding.path, `${prefix}${path.replace('source.ext.', 'source.')}`);
      }
    }
  }
  const valid = chain([{ ...chain().nodes[0], name: '', ext: { vendor: ['opaque', 1] } }]);
  valid.ext = { vendor: 'structured' };
  const before = JSON.stringify(valid);
  assert.equal(inspectSchain(valid).status, 'valid');
  assert.equal(JSON.stringify(valid), before);
});

test('inspection: serialized node extensions stay opaque but unsupported header fields fail', () => {
  const opaque = 'vendor!not,json%21';
  const serialized = `1.0,1!seller.example,A,1,,,,${encodeURIComponent(opaque).replace(/!/g, '%21')}`;
  for (const input of [
    serialized,
    `?schain=${serialized}`,
    `?schain=${encodeURIComponent(serialized)}`,
  ]) {
    const result = inspectSchain(input);
    assert.equal(result.status, 'valid');
    assert.equal(result.copies[0].chain.nodes[0].ext, opaque);
    // A serialized extension has no specified JSON representation. Pasting
    // the resulting string as a structured object still requires object ext.
    assert.ok(ids(inspectSchain(result.copies[0].chain)).includes('schain.node.ext_invalid'));
  }
  for (const header of ['1.0,1,unexpected', '1.0,1,']) {
    const result = inspectSchain(`${header}!seller.example,A,1`);
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'serialized_shape');
  }
});

test('inspection: sender comparison uses only typed declared context and preserves account case', () => {
  assert.equal(inspectSchain(chain(), { declaredSender: sender }).comparison.status, 'match');
  const result = inspectSchain(chain(), { declaredSender: { ...sender, sid: 'seller-a' } });
  assert.equal(result.comparison.status, 'mismatch');
  assert.equal(result.comparison.provenance, 'declared');
  assert.ok(ids(result).includes('schain.declared_sender_mismatch'));
  for (const invalid of [
    'seller.example',
    { ...sender, provenance: 'observed' },
    { ...sender, extra: true },
    { ...sender, sid: null },
  ]) {
    const unknown = inspectSchain(chain(), { declaredSender: invalid });
    assert.equal(unknown.comparison.status, 'unknown');
    assert.equal(unknown.comparison.reason, 'invalid_sender');
    assert.ok(!ids(unknown).includes('schain.declared_sender_mismatch'));
  }
});

test('inspection: ordinary validate includes declared sender on2x and projected3 paths', () => {
  const opts = { declaredSender: { ...sender, sid: 'other' }, locale: 'en' };
  assert.equal(
    core
      .validate(req(chain()), opts)
      .findings.find((f) => f.id === 'schain.declared_sender_mismatch').path,
    'source.schain.nodes[0]',
  );
  const input = {
    openrtb: {
      ver: '3.0',
      request: {
        id: 'r',
        item: [{ id: 'i', spec: { placement: { video: { mime: ['video/mp4'] } } } }],
        source: { schain: chain() },
      },
    },
  };
  assert.equal(
    core.validate(input, opts).findings.find((f) => f.id === 'schain.declared_sender_mismatch')
      .path,
    'openrtb.request.source.schain.nodes[0]',
  );
  Object.assign(input.openrtb.request.source, { ext: { schain: { ...chain(), complete: 0 } } });
  const conflict = core.validate(input, opts).findings.find((f) => f.id === 'schain.copy_conflict');
  assert.equal(conflict.params.otherPath, 'openrtb.request.source.schain');
});

test('inspection: raw serialized fields decode exactly after delimiters', () => {
  const result = inspectSchain('1.0,1!seller.example,Seller%21A%2CB%2521,1,,,');
  assert.equal(result.status, 'valid');
  assert.equal(result.copies[0].chain.nodes[0].sid, 'Seller!A,B%21');
  assert.equal(result.kind, 'serialized');
});

test('inspection: exposed and outer-encoded query values preserve escaped field boundaries', () => {
  const serialized = '1.0,1!seller.example,Seller%21A%2CB,1';
  for (const value of [serialized, encodeURIComponent(serialized)]) {
    const result = inspectSchain(`https://example.invalid/tag?schain=${value}`);
    assert.equal(result.status, 'valid');
    assert.equal(result.kind, 'query');
    assert.equal(result.copies[0].chain.nodes[0].sid, 'Seller!A,B');
  }
});

test('inspection: ambiguous query, malformed escapes and invalid grammar are explicit failures', () => {
  for (const [input, reason] of [
    ['?schain=1.0,1!seller.example,A,1&%73chain=1.0,1!seller.example,A,1', 'duplicate_parameter'],
    ['1.0,1!seller.example,%ZZ,1', 'malformed_encoding'],
    ['1.0,1!seller.example,A', 'serialized_shape'],
    ['1.0,1', 'serialized_shape'],
    ['?schain=', 'serialized_shape'],
    ['file:///tmp/example?schain=1.0,1!seller.example,A,1', 'unsupported_scheme'],
    ['{bad', 'invalid_json'],
  ]) {
    const result = inspectSchain(input);
    assert.equal(result.status, 'invalid', input);
    assert.equal(result.reason, reason);
  }
});

test('inspection: missing chain and unsupported roots are visibly unknown', () => {
  for (const input of [{}, null, 12, [], 'https://example.invalid/tag?other=1'])
    assert.equal(inspectSchain(input).status, 'unknown');
});

test('inspection: factual counts have no four-node or ten-node compliance threshold', () => {
  for (const length of [1, 3, 4, 10, 11]) {
    const input = req(
      chain(
        Array.from({ length }, (_, i) => ({ asi: 'seller.example', sid: `seller-${i}`, hp: 1 })),
      ),
    );
    const result = inspectSchain(input);
    assert.equal(result.status, 'valid');
    assert.equal(result.copies[0].nodeCount, length);
  }
});

test('inspection: bounds and cycles fail safely; output mutation does not mutate input', () => {
  assert.equal(inspectSchain('x'.repeat(200001)).reason, 'input_limit');
  const tooMany = chain(
    Array.from({ length: 257 }, () => ({ asi: 'seller.example', sid: 'A', hp: 1 })),
  );
  assert.ok(ids(inspectSchain(tooMany)).includes('schain.nodes_limit'));
  const cyclic = chain();
  cyclic.ext = cyclic;
  assert.equal(inspectSchain(cyclic).status, 'unknown');
  const input = chain();
  const before = JSON.stringify(input);
  inspectSchain(input).copies[0].chain.nodes[0].sid = 'changed';
  assert.equal(JSON.stringify(input), before);
});

test('inspection: all three locales resolve new and preserved IDs with source references', () => {
  for (const locale of ['en', 'uk', 'ru']) {
    const result = inspectSchain(
      chain([
        { asi: 'seller.example', sid: 'A', hp: 1 },
        { asi: 'seller.example', sid: 'A', hp: 1 },
      ]),
      { locale, declaredSender: sender },
    );
    for (const finding of result.findings) {
      assert.ok(finding.specRef);
      assert.ok(!finding.msg.startsWith('['));
      assert.ok(!/\{\w+\}/.test(finding.msg));
    }
    const profile = listInspectionProfiles({ locale }).find((p) => p.adapterId === 'logan');
    assert.match(
      profile.statements[0].detail,
      locale === 'en' ? /overwrites/ : locale === 'uk' ? /замінює/ : /заменяет/,
    );
  }
});

test('declared route: bounded pinned catalog has14profiles and19source-linked statements', () => {
  const profiles = listInspectionProfiles();
  assert.equal(profiles.length, 14);
  assert.equal(profiles.flatMap((p) => p.statements).length, 19);
  for (const profile of profiles) {
    assert.equal(profile.revision, route.revision);
    assert.equal(profile.direction, 'request');
    for (const source of profile.sources) {
      assert.match(source.sha256, /^[a-f0-9]{64}$/);
      assert.ok(source.url.includes(route.revision));
    }
  }
  profiles[0].statements[0].detail = 'mutated';
  assert.notEqual(listInspectionProfiles()[0].statements[0].detail, 'mutated');
});

test('declared route: missing, malformed, unsupported and incompatible contexts remain unknown', () => {
  for (const [context, reason] of [
    [undefined, 'missing_context'],
    [{ ...route, provenance: 'observed' }, 'invalid_context'],
    [{ ...route, extra: true }, 'invalid_context'],
    [{ ...route, adapterId: 'invented' }, 'unsupported_adapter'],
    [{ ...route, direction: 'response' }, 'unsupported_direction'],
    [{ ...route, revision: 'other' }, 'revision_mismatch'],
  ]) {
    const result = evaluateDeclaredRoute(req(chain()), context);
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, reason);
    assert.deepEqual(result.statements, []);
  }
  assert.equal(evaluateDeclaredRoute({ seatbid: [] }, route).reason, 'incompatible_input');
});

test('declared route: supplied profile selects field presence, no label or endpoint inference', () => {
  const input = {
    id: 'r',
    imp: [{ id: 'i', ext: { prebid: { bidder: { logan: { type: 'custom' } } } } }],
    partner: 'sovrn',
    endpoint: 'https://sovrn.com/',
  };
  const result = evaluateDeclaredRoute(input, route);
  assert.equal(result.status, 'known');
  assert.equal(result.provenance, 'declared');
  assert.equal(result.profile.adapterId, 'logan');
  assert.equal(result.statements[0].applicability, 'present');
  assert.equal(evaluateDeclaredRoute(input).status, 'unknown');
  assert.equal(
    evaluateDeclaredRoute(input, { ...route, adapterId: 'sovrn' }).statements[0].applicability,
    'absent',
  );
});

test('declared route: malformed impressions and bounded carrier traversal remain unknown', () => {
  const cycle = [];
  cycle.push(cycle);
  const deep = JSON.parse(
    '['.repeat(10000) + '{"bidder":{"type":"synthetic"}}' + ']'.repeat(10000),
  );
  for (const input of [
    { imp: cycle },
    { imp: [null] },
    { imp: [17] },
    { imp: [[]] },
    { imp: [{ ext: cycle }] },
    { imp: [{ ext: { prebid: cycle } }] },
    { imp: [{ ext: deep }] },
    { imp: Array.from({ length: 10001 }, () => ({ id: 'bounded' })) },
  ]) {
    const result = evaluateDeclaredRoute(input, route);
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'incompatible_input');
    assert.deepEqual(result.statements, []);
  }
  // A shared (acyclic) carrier and bounded existing array traversal preserve
  // supplied-field detection. Unrelated vendor extensions are never scanned.
  const carrier = [{ bidder: { type: 'synthetic' } }];
  const result = evaluateDeclaredRoute(
    { imp: [{ ext: carrier }, { ext: carrier }], unrelated: cycle },
    route,
  );
  assert.equal(result.status, 'known');
  assert.equal(result.statements[0].applicability, 'present');
});
