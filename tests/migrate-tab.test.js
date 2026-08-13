'use strict';

/**
 * tests/migrate-tab.test.js — the Migration tab's own logic, without a browser.
 *
 * The advisor is already pinned by tests/migration-rules.test.js. What is NEW
 * here, and therefore what this file covers, is the layer the tab adds on top:
 *
 *   1. Pairing the advisor's flat operations back into ATOMIC proposals. The
 *      advisor emits a promotion as an `add` plus a `remove`; if the tab paired
 *      those wrongly, a user could tick one checkbox and delete a consent
 *      string. The imp-boundary case below is the exact way naive pairing goes
 *      wrong.
 *   2. The applier — the only code in the app that writes a derived structure
 *      back into a user's payload.
 *
 * The tab module is loaded with a bare object as `window`, the same way
 * tests/macro-evaluator.test.js loads the macro engine, so this runs with no
 * DOM and no Chrome.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { adviseMigration25To26 } = require('../packages/core/migrate');

const ROOT = path.join(__dirname, '..');
const TAB_SOURCE = path.join(ROOT, 'public/modules/migrate/index.js');

function loadTab() {
  const code = fs.readFileSync(TAB_SOURCE, 'utf8');
  const win = {};
  new Function('window', 'document', code)(win, {});
  assert.ok(win.OrtbtoolsMigrateTab, 'the tab module must expose its global');
  return win.OrtbtoolsMigrateTab.__test;
}

const T = loadTab();

/** Resolve an RFC 6901 pointer for assertions. */
function get(doc, pointer) {
  const segments = T.parsePointer(pointer);
  let node = doc;
  for (const segment of segments) {
    if (node === null || typeof node !== 'object') return undefined;
    node = Array.isArray(node) ? node[Number(segment)] : node[segment];
  }
  return node;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// ━━━ 1. Zero network ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The tab reads the editor and writes the editor. Nothing about a migration
// proposal needs the network, so nothing about it may reach for one.
test('migration tab performs no network access', () => {
  const code = fs
    .readFileSync(TAB_SOURCE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(code, /\bnew\s+Image\s*\(/);
  assert.doesNotMatch(code, /\bsendBeacon\s*\(/);
});

// ━━━ 2. Selection defaults ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('`review` proposals are never pre-selected', () => {
  assert.equal(T.DEFAULT_SELECTED.certain, true);
  assert.equal(T.DEFAULT_SELECTED.likely, true);
  assert.notEqual(
    T.DEFAULT_SELECTED.review,
    true,
    'a proposal the advisor itself cannot justify must not be ticked for the user',
  );
});

// ━━━ 3. Pairing ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('a promotion becomes ONE proposal carrying both operations', () => {
  const proposals = T.groupProposals(
    adviseMigration25To26({ imp: [{ id: 'i1' }], user: { ext: { consent: 'CONSENT' } } }),
  );
  const consent = proposals.filter((p) => p.rule === 'ortb26.user.consent');
  assert.equal(consent.length, 1, JSON.stringify(consent, null, 2));
  assert.equal(consent[0].kind, 'move');
  assert.equal(consent[0].fromPath, '/user/ext/consent');
  assert.equal(consent[0].toPath, '/user/consent');
  assert.equal(consent[0].operations.length, 2);
});

test('pairing never crosses an imp boundary', () => {
  // imp 0 already carries the 2.6 field, so the advisor emits only a `remove`
  // for it. imp 1 needs the full promotion. Pairing by "first free add" would
  // attach imp 1's `add` to imp 0's `remove`, leaving imp 1's `remove` alone —
  // a checkbox that deletes a rewarded flag and writes nothing back.
  const payload = {
    imp: [
      { id: 'i0', rwdd: 1, video: { ext: { rewarded: 1 } } },
      { id: 'i1', video: { ext: { rewarded: 1 } } },
    ],
  };
  const proposals = T.groupProposals(adviseMigration25To26(payload)).filter(
    (p) => p.rule === 'ortb26.imp.rwdd',
  );
  assert.equal(proposals.length, 2, JSON.stringify(proposals.map((p) => p.key)));

  const zero = proposals.find((p) => (p.fromPath || '').startsWith('/imp/0/'));
  const one = proposals.find((p) => (p.fromPath || '').startsWith('/imp/1/'));
  assert.ok(zero && one, JSON.stringify(proposals.map((p) => p.fromPath)));
  assert.equal(zero.kind, 'drop', 'imp 0 already has rwdd — only the legacy copy goes');
  assert.equal(zero.toPath, null);
  assert.equal(one.kind, 'move');
  assert.equal(one.toPath, '/imp/1/rwdd', 'imp 1 must keep its OWN add');
});

test('a standalone `remove` proposal is genuinely lossless', () => {
  // The "drop" kind claims the 2.6 field already holds the value. Apply one on
  // its own and check that claim rather than trusting the label.
  const payload = { imp: [{ id: 'i0', rwdd: 1, video: { ext: { rewarded: 1 } } }] };
  const proposals = T.groupProposals(adviseMigration25To26(payload));
  const drop = proposals.find((p) => p.kind === 'drop');
  assert.ok(drop, JSON.stringify(proposals.map((p) => p.kind)));

  const doc = clone(payload);
  T.applyOperations(doc, drop.operations);
  assert.equal(get(doc, '/imp/0/rwdd'), 1, 'the 2.6 field must survive the drop');
  assert.equal(get(doc, '/imp/0/video/ext/rewarded'), undefined);
});

test('every proposal is self-contained: no operation is left unassigned', () => {
  const payload = {
    imp: [{ id: 'i1', video: { protocol: 3, ext: { rewarded: 1 } } }],
    regs: { ext: { gdpr: 1 } },
    user: { ext: { consent: 'C', eids: [{ source: 'x.com', uids: [{ id: 'u' }] }] } },
    source: { ext: { schain: { complete: 1, nodes: [{ asi: 'a.com' }] } } },
    site: { cat: ['IAB1'], content: { videoquality: 1 } },
  };
  const operations = adviseMigration25To26(payload);
  const proposals = T.groupProposals(operations);
  const regrouped = proposals.reduce((all, p) => all.concat(p.operations), []);

  assert.equal(regrouped.length, operations.length, 'no operation may be dropped or duplicated');
  const key = (o) => `${o.op} ${o.path}`;
  assert.deepEqual(
    regrouped.map(key).sort(),
    operations.map(key).sort(),
    'the regrouped set must be exactly the advisor’s set',
  );
});

// ━━━ 4. The applier ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('applying every proposal produces a payload the advisor considers migrated', () => {
  const payload = {
    imp: [{ id: 'i1', video: { protocol: 3, ext: { rewarded: 1 } } }],
    regs: { ext: { gdpr: 1 } },
    user: { ext: { consent: 'C', eids: [{ source: 'x.com', uids: [{ id: 'u' }] }] } },
    source: { ext: { schain: { complete: 1, nodes: [{ asi: 'a.com' }] } } },
    site: { cat: ['IAB1'], content: { videoquality: 1 } },
  };
  const doc = clone(payload);
  const proposals = T.groupProposals(adviseMigration25To26(doc));
  const result = T.applyOperations(
    doc,
    proposals.reduce((all, p) => all.concat(p.operations), []),
  );

  assert.deepEqual(result.skipped, [], JSON.stringify(result.skipped));
  assert.deepEqual(adviseMigration25To26(doc), [], 'a fully migrated payload advises nothing');
  assert.equal(get(doc, '/user/consent'), 'C');
  assert.equal(get(doc, '/regs/gdpr'), 1);
  assert.deepEqual(get(doc, '/imp/0/video/protocols'), [3]);
  assert.equal(get(doc, '/site/content/prodq'), 1);
  assert.equal(get(doc, '/site/cattax'), 1);
});

test('unrelated fields, vendor ext and empty containers survive', () => {
  const payload = {
    id: 'auction-1',
    imp: [{ id: 'i1', bidfloor: 0.5, ext: { acme: { secret: 'keep' } }, video: { protocol: 2 } }],
    user: { id: 'u-1', ext: { consent: 'C', vendorThing: 'keep-me' } },
  };
  const doc = clone(payload);
  const proposals = T.groupProposals(adviseMigration25To26(doc));
  T.applyOperations(
    doc,
    proposals.reduce((all, p) => all.concat(p.operations), []),
  );

  assert.equal(doc.id, 'auction-1');
  assert.equal(get(doc, '/imp/0/bidfloor'), 0.5);
  assert.equal(get(doc, '/imp/0/ext/acme/secret'), 'keep');
  assert.equal(get(doc, '/user/id'), 'u-1');
  assert.equal(get(doc, '/user/ext/vendorThing'), 'keep-me');
  assert.ok(get(doc, '/user/ext'), 'an emptied ext container is left in place, not deleted');
});

test('an inapplicable operation is reported, never silently skipped', () => {
  const doc = { imp: [{ id: 'i1' }] };
  const result = T.applyOperations(doc, [
    { op: 'add', path: '/regs/gdpr', after: 1 }, // parent absent
    { op: 'remove', path: '/user/ext/consent', before: 'C' }, // parent absent
    { op: 'remove', path: '/imp/0', before: {} }, // array element
    { op: 'add', path: 'not-a-pointer', after: 1 },
  ]);
  assert.equal(result.applied.length, 0);
  assert.deepEqual(result.skipped.map((s) => s.reason).sort(), [
    'array_parent',
    'bad_path',
    'missing_parent',
    'missing_parent',
  ]);
  assert.deepEqual(doc, { imp: [{ id: 'i1' }] }, 'a refused operation must change nothing');
});

test('a removal of an already-absent key is reported, not counted as applied', () => {
  const doc = { imp: [{ id: 'i1' }], user: { ext: {} } };
  const result = T.applyOperations(doc, [{ op: 'remove', path: '/user/ext/consent', before: 'C' }]);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped[0].reason, 'already_absent');
});

test('the applier refuses prototype-polluting pointers', () => {
  const doc = { imp: [{ id: 'i1' }] };
  const result = T.applyOperations(doc, [
    { op: 'add', path: '/__proto__/polluted', after: 'yes' },
    { op: 'add', path: '/constructor/prototype/polluted', after: 'yes' },
  ]);
  assert.equal(result.applied.length, 0);
  assert.deepEqual(
    result.skipped.map((s) => s.reason),
    ['unsafe_path', 'unsafe_path'],
  );
  assert.equal({}.polluted, undefined, 'Object.prototype must be untouched');
});

test('`add` runs before `remove` regardless of the order it is handed', () => {
  const payload = { imp: [{ id: 'i1' }], regs: { ext: { gdpr: 1 } } };
  const operations = adviseMigration25To26(payload).slice().reverse();
  const doc = clone(payload);
  T.applyOperations(doc, operations);
  assert.equal(get(doc, '/regs/gdpr'), 1);
  assert.equal(get(doc, '/regs/ext/gdpr'), undefined);
});

test('pointer escaping round-trips (~1 = "/", ~0 = "~")', () => {
  assert.deepEqual(T.parsePointer('/a~1b/c~0d'), ['a/b', 'c~d']);
  assert.deepEqual(T.parsePointer(''), []);
  assert.equal(T.parsePointer('nope'), null);
  assert.equal(T.parentPointer('/regs/ext/gdpr'), '/regs/ext');
  assert.equal(T.parentPointer('/cattax'), '');
});

// ━━━ 5. Real payloads ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('every real sample groups and applies cleanly and idempotently', () => {
  const dir = path.join(ROOT, 'samples');
  let examined = 0;
  let advised = 0;

  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch (_e) {
      continue;
    }
    examined++;

    const operations = adviseMigration25To26(payload);
    const proposals = T.groupProposals(operations);
    assert.equal(
      proposals.reduce((n, p) => n + p.operations.length, 0),
      operations.length,
      `${name}: grouping lost or duplicated an operation`,
    );
    if (!operations.length) continue;
    advised++;

    const doc = clone(payload);
    const result = T.applyOperations(
      doc,
      proposals.reduce((all, p) => all.concat(p.operations), []),
    );
    assert.deepEqual(result.skipped, [], `${name}: ${JSON.stringify(result.skipped)}`);
    assert.doesNotThrow(() => JSON.stringify(doc), `${name}: result is not serializable`);
    assert.deepEqual(adviseMigration25To26(doc), [], `${name}: advice is not idempotent`);
  }

  assert.ok(examined > 0, 'no sample payloads were examined');
  assert.ok(advised > 0, 'no sample payload exercised the applier — the test proves nothing');
});
