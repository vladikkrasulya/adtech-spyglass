'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MIGRATE_DIR = path.join(ROOT, 'packages/core/migrate');
const FIXTURE_DIR = path.join(__dirname, 'fixtures/migrate');

const EXPECTED_FIXTURE_RULES = new Map([
  ['category-cattax', 'ortb26.category.cattax'],
  ['content-prodq', 'ortb26.content.prodq'],
  ['imp-rwdd', 'ortb26.imp.rwdd'],
  ['regs-gdpr', 'ortb26.regs.gdpr'],
  ['source-schain', 'ortb26.source.schain'],
  ['user-consent', 'ortb26.user.consent'],
  ['user-eids', 'ortb26.user.eids'],
  ['video-protocols', 'ortb26.video.protocols'],
]);

const KNOWN_LEGACY_SOURCE_PATHS = [
  /^\/imp\/\d+\/video\/ext\/rewarded$/,
  /^\/imp\/\d+\/video\/protocol$/,
  /^\/(?:site|app)\/content\/videoquality$/,
  /^\/regs\/ext\/gdpr$/,
  /^\/source\/ext\/schain$/,
  /^\/user\/ext\/(?:consent|eids)$/,
];

/** @returns {any} */
function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function decodePointer(pointer) {
  if (pointer === '') return [];
  assert.match(pointer, /^\//);
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** @param {any} input @param {any[]} operations @returns {any} */
function applyPatchForTest(input, operations) {
  const output = structuredClone(input);
  for (const operation of operations) {
    const segments = decodePointer(operation.path);
    assert.ok(segments.length > 0, 'fixtures never patch the document root');
    const key = segments.pop();
    let parent = output;
    for (const segment of segments) {
      assert.ok(parent !== null && typeof parent === 'object');
      assert.equal(Object.hasOwn(parent, segment), true, `missing parent at ${operation.path}`);
      parent = parent[segment];
    }

    if (operation.op === 'add') {
      assert.equal(Object.hasOwn(parent, key), false, `add target exists at ${operation.path}`);
      assert.equal(operation.before, null);
      Object.defineProperty(parent, key, {
        value: structuredClone(operation.after),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else if (operation.op === 'remove') {
      assert.equal(Object.hasOwn(parent, key), true, `remove target missing at ${operation.path}`);
      assert.deepEqual(parent[key], operation.before);
      assert.equal(operation.after, null);
      delete parent[key];
    } else {
      assert.fail(`unsupported test patch operation: ${operation.op}`);
    }
  }
  return output;
}

function listJsonFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJsonFiles(filename));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(filename);
  }
  return files.sort();
}

/**
 * Assert that every original field remains byte-for-byte equivalent except
 * for an exact source subtree named by a remove operation.
 * @param {any} before
 * @param {any} after
 * @param {Set<string>} removedPaths
 * @param {string} [pointer]
 */
function assertOriginalFieldsPreserved(before, after, removedPaths, pointer = '') {
  if (
    [...removedPaths].some((removed) => pointer === removed || pointer.startsWith(`${removed}/`))
  ) {
    return;
  }
  if (before === null || typeof before !== 'object') {
    assert.deepEqual(after, before, `field changed at ${pointer || '/'}`);
    return;
  }
  if (Array.isArray(before)) {
    assert.ok(Array.isArray(after), `array changed type at ${pointer || '/'}`);
    assert.equal(after.length, before.length, `array length changed at ${pointer || '/'}`);
    for (let index = 0; index < before.length; index++) {
      assertOriginalFieldsPreserved(
        before[index],
        after[index],
        removedPaths,
        `${pointer}/${index}`,
      );
    }
    return;
  }
  assert.ok(after !== null && typeof after === 'object' && !Array.isArray(after));
  for (const key of Object.keys(before)) {
    const childPointer = `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    if (!removedPaths.has(childPointer)) {
      assert.equal(Object.hasOwn(after, key), true, `field disappeared at ${childPointer}`);
    }
    assertOriginalFieldsPreserved(before[key], after[key], removedPaths, childPointer);
  }
}

function assertOnlyKnownLegacySourcesRemoved(operations) {
  for (const operation of operations) {
    if (operation.op === 'remove') {
      assert.ok(
        KNOWN_LEGACY_SOURCE_PATHS.some((pattern) => pattern.test(operation.path)),
        `advisor attempted to remove an unknown field at ${operation.path}`,
      );
    }
  }
}

test('module exposes advice data only, with a stable rule registry and no apply API', () => {
  const migration = require('../packages/core/migrate');
  assert.deepEqual(Object.keys(migration).sort(), ['MIGRATION_RULES', 'adviseMigration25To26']);
  assert.deepEqual(
    migration.MIGRATION_RULES.map((rule) => rule.id),
    [...EXPECTED_FIXTURE_RULES.values()],
  );
});

test('each rule has a before/after fixture and is idempotent after its patch', () => {
  const { adviseMigration25To26 } = require('../packages/core/migrate');

  for (const [fixture, expectedRule] of EXPECTED_FIXTURE_RULES) {
    const before = readJson(path.join(FIXTURE_DIR, `${fixture}.before.json`));
    const expectedAfter = readJson(path.join(FIXTURE_DIR, `${fixture}.after.json`));
    const original = JSON.stringify(before);
    const operations = adviseMigration25To26(before);

    assert.ok(operations.length > 0, `${fixture} must emit a patch`);
    assert.deepEqual(
      [...new Set(operations.map((operation) => operation.rule))],
      [expectedRule],
      `${fixture} must exercise exactly its named rule`,
    );
    assert.equal(JSON.stringify(before), original, `${fixture} input was mutated`);

    const migrated = applyPatchForTest(before, operations);
    assert.deepEqual(
      migrated,
      expectedAfter,
      `${fixture} patch does not produce its after fixture`,
    );
    assert.deepEqual(
      adviseMigration25To26(migrated),
      [],
      `${fixture} is not idempotent after migration`,
    );
  }
});

test('every operation is self-contained, serializable, and links an official 2.6 section', () => {
  const { adviseMigration25To26 } = require('../packages/core/migrate');
  const before = readJson(path.join(FIXTURE_DIR, 'category-cattax.before.json'));
  const operations = adviseMigration25To26(before);

  for (const operation of operations) {
    assert.deepEqual(Object.keys(operation), [
      'path',
      'op',
      'before',
      'after',
      'rule',
      'spec',
      'confidence',
      'rationale',
    ]);
    assert.match(operation.path, /^\//);
    assert.ok(['add', 'remove'].includes(operation.op));
    assert.match(
      operation.spec,
      /^https:\/\/github\.com\/InteractiveAdvertisingBureau\/openrtb2\.x\/blob\/main\/2\.6\.md#.+/,
    );
    assert.ok(['certain', 'likely', 'review'].includes(operation.confidence));
    assert.equal(typeof operation.rationale, 'string');
    assert.ok(operation.rationale.length > 0);
    assert.doesNotMatch(operation.rationale, /[\r\n]/);
  }
  assert.doesNotThrow(() => JSON.stringify(operations));
});

test('same input produces byte-identical operations in deterministic order', () => {
  const { adviseMigration25To26 } = require('../packages/core/migrate');
  const input = {
    imp: [
      { id: 'b', video: { protocol: 3, ext: { rewarded: 1 } } },
      { id: 'a', video: { protocol: 2, ext: { rewarded: 0 } } },
    ],
    bcat: ['IAB25'],
    regs: { ext: { gdpr: 1 } },
    user: { ext: { consent: 'opaque-consent', vendor: 'keep' } },
  };
  const expected = JSON.stringify(adviseMigration25To26(input));

  for (let attempt = 0; attempt < 25; attempt++) {
    assert.equal(JSON.stringify(adviseMigration25To26(input)), expected);
  }
  const paths = adviseMigration25To26(input).map((operation) => operation.path);
  assert.deepEqual(paths, [...paths].sort());
});

test('conflicting modern and legacy values are never overwritten or deleted', () => {
  const { adviseMigration25To26 } = require('../packages/core/migrate');
  const input = {
    id: 'conflicts',
    imp: [{ id: '1', video: { protocol: 2, protocols: [3], ext: { rewarded: 1 } }, rwdd: 0 }],
    regs: { gdpr: 0, ext: { gdpr: 1 } },
    user: { consent: 'modern', ext: { consent: 'legacy' } },
  };

  assert.deepEqual(adviseMigration25To26(input), []);
});

test('an equal modern value makes the proposal cleanup-only and remains idempotent', () => {
  const { adviseMigration25To26 } = require('../packages/core/migrate');
  const input = {
    id: 'equal-values',
    imp: [{ id: '1', video: { protocol: 3, protocols: [3] } }],
    regs: { gdpr: 1, ext: { gdpr: 1, vendor: 'keep' } },
  };

  const operations = adviseMigration25To26(input);
  assert.deepEqual(
    operations.map(({ path, op }) => ({ path, op })),
    [
      { path: '/imp/0/video/protocol', op: 'remove' },
      { path: '/regs/ext/gdpr', op: 'remove' },
    ],
  );
  const migrated = applyPatchForTest(input, operations);
  assert.equal(migrated.regs.ext.vendor, 'keep');
  assert.deepEqual(adviseMigration25To26(migrated), []);
});

test('non-request JSON returns an empty proposal without throwing', () => {
  const { adviseMigration25To26 } = require('../packages/core/migrate');
  for (const input of [null, true, 42, 'json', [], {}, { seatbid: [] }, { openrtb: {} }]) {
    assert.deepEqual(adviseMigration25To26(input), []);
  }
});

test('unknown extension and vendor fields survive every proposed operation', () => {
  const { adviseMigration25To26 } = require('../packages/core/migrate');
  const input = {
    id: 'vendor-preservation',
    imp: [
      {
        id: '1',
        video: { protocol: 3, ext: { rewarded: true, vendor_video: { nested: 'keep' } } },
        ext: { vendor_imp: [1, 2, 3] },
      },
    ],
    source: {
      ext: {
        schain: { ver: '1.0', complete: 1, nodes: [] },
        vendor_source: 'keep',
      },
    },
    regs: { ext: { gdpr: 1, us_privacy: '1YNN', vendor_reg: true } },
    user: {
      ext: {
        consent: 'opaque',
        eids: [{ source: 'id.example', uids: [{ id: 'abc' }] }],
        vendor_user: { untouched: true },
      },
    },
    ext: { top_level_vendor: { untouched: true } },
    vendor_top_level: 'keep',
  };

  const operations = adviseMigration25To26(input);
  assertOnlyKnownLegacySourcesRemoved(operations);
  const migrated = applyPatchForTest(input, operations);
  const removedPaths = new Set(
    operations.filter((operation) => operation.op === 'remove').map((operation) => operation.path),
  );
  assertOriginalFieldsPreserved(input, migrated, removedPaths);
  assert.deepEqual(migrated.ext, input.ext);
  assert.deepEqual(migrated.imp[0].ext, input.imp[0].ext);
  assert.deepEqual(migrated.imp[0].video.ext.vendor_video, { nested: 'keep' });
  assert.equal(migrated.source.ext.vendor_source, 'keep');
  assert.equal(migrated.regs.ext.us_privacy, '1YNN');
  assert.equal(migrated.regs.ext.vendor_reg, true);
  assert.deepEqual(migrated.user.ext.vendor_user, { untouched: true });
  assert.equal(migrated.vendor_top_level, 'keep');
});

test('all repository sample and OpenRTB knowledge-base JSON survives advisory and patching', () => {
  const { adviseMigration25To26 } = require('../packages/core/migrate');
  const sampleFiles = listJsonFiles(path.join(ROOT, 'samples'));
  const knowledgeFiles = [
    ...listJsonFiles(path.join(ROOT, 'packages/core/knowledge_base/ortb-2.5')),
    ...listJsonFiles(path.join(ROOT, 'packages/core/knowledge_base/ortb-2.6')),
  ].sort();

  assert.ok(sampleFiles.length >= 29, 'the complete samples/ JSON corpus must be discovered');
  assert.ok(knowledgeFiles.length >= 8, 'both OpenRTB knowledge-base corpora must be discovered');

  for (const filename of [...sampleFiles, ...knowledgeFiles]) {
    const input = readJson(filename);
    const original = JSON.stringify(input);
    /** @type {any[]} */
    let operations = [];
    assert.doesNotThrow(() => {
      operations = adviseMigration25To26(input);
    }, filename);
    assert.equal(JSON.stringify(input), original, `${filename} was mutated by advisory`);
    assertOnlyKnownLegacySourcesRemoved(operations);
    const migrated = applyPatchForTest(input, operations);
    const removedPaths = new Set(
      operations
        .filter((operation) => operation.op === 'remove')
        .map((operation) => operation.path),
    );
    assertOriginalFieldsPreserved(input, migrated, removedPaths);
  }
});

test('engine source remains pure and does not emit validator findings', () => {
  const source = fs
    .readdirSync(MIGRATE_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(MIGRATE_DIR, name), 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /\b(?:window|document|fetch|XMLHttpRequest|sendBeacon)\b/);
  assert.doesNotMatch(source, /require\(['"](?:node:)?(?:fs|path|http|https)['"]\)/);
  assert.doesNotMatch(source, /\bDate\.now\s*\(/);
  assert.doesNotMatch(source, /\bMath\.random\s*\(/);
  assert.doesNotMatch(source, /\b(?:F|makeFinding)\s*\(/);
});
