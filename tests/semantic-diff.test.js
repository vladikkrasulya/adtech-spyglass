'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { diffJson, rawDiff, semanticDiff } = require('@ortbtools/core');

const ROOT = path.join(__dirname, '..');

function sortResult(result) {
  return {
    ...result,
    changes: [...result.changes].sort((a, b) =>
      `${a.path}\0${a.op}`.localeCompare(`${b.path}\0${b.op}`),
    ),
    warnings: [...result.warnings].sort((a, b) =>
      `${a.path}\0${a.code}`.localeCompare(`${b.path}\0${b.code}`),
    ),
  };
}

function mirrorResult(result) {
  const changes = result.changes.map((change) => {
    const { before: _before, after: _after, ...stable } = change;
    const mirrored = {
      ...stable,
      op: change.op === 'add' ? 'remove' : change.op === 'remove' ? 'add' : 'replace',
      leftPath: change.rightPath,
      rightPath: change.leftPath,
    };

    if (Object.hasOwn(change, 'before')) {
      mirrored.after = change.before;
    }
    if (Object.hasOwn(change, 'after')) {
      mirrored.before = change.after;
    }
    return mirrored;
  });

  const warnings = result.warnings.map((warning) => ({
    ...warning,
    leftPath: warning.rightPath,
    rightPath: warning.leftPath,
    left: warning.right,
    right: warning.left,
  }));

  return sortResult({ ...result, changes, warnings });
}

function nestedValue(depth) {
  /** @type {any} */
  let value = 1;
  for (let level = 0; level < depth; level++) {
    value = { a: value };
  }
  return value;
}

test('raw diff ignores object key order but compares arrays positionally', () => {
  const equal = rawDiff(
    { id: 'req-1', site: { page: 'https://example.com', domain: 'example.com' } },
    { site: { domain: 'example.com', page: 'https://example.com' }, id: 'req-1' },
  );
  assert.deepEqual(equal, { mode: 'raw', equal: true, changes: [], warnings: [] });

  const changed = diffJson({ cur: ['USD', 'EUR'] }, { cur: ['EUR', 'USD'] }, { mode: 'raw' });
  assert.equal(changed.equal, false);
  assert.deepEqual(
    changed.changes.map(({ op, path, before, after }) => ({ op, path, before, after })),
    [
      { op: 'replace', path: '/cur/0', before: 'USD', after: 'EUR' },
      { op: 'replace', path: '/cur/1', before: 'EUR', after: 'USD' },
    ],
  );
});

test('semantic diff matches imp by id and reports concrete left/right pointers', () => {
  const left = {
    imp: [
      { id: 'a', banner: { w: 300, h: 250 } },
      { id: 'b', banner: { w: 728, h: 90 } },
    ],
  };
  const right = {
    imp: [
      { id: 'b', banner: { w: 970, h: 90 } },
      { id: 'a', banner: { w: 300, h: 250 } },
    ],
  };

  const result = semanticDiff(left, right);
  assert.equal(result.equal, false);
  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.changes[0], {
    op: 'replace',
    path: '/imp/@id=%22b%22/banner/w',
    leftPath: '/imp/1/banner/w',
    rightPath: '/imp/0/banner/w',
    before: 728,
    after: 970,
  });
  assert.deepEqual(result.warnings, []);
});

test('semantic diff matches seatbid by seat and bid by id regardless of order', () => {
  const left = {
    seatbid: [
      {
        seat: 'dsp-a',
        bid: [
          { id: 'bid-1', impid: 'imp-1', price: 1.1 },
          { id: 'bid-2', impid: 'imp-2', price: 2.2 },
        ],
      },
      { seat: 'dsp-b', bid: [{ id: 'bid-3', impid: 'imp-1', price: 3.3 }] },
    ],
  };
  const right = {
    seatbid: [
      { seat: 'dsp-b', bid: [{ price: 3.3, impid: 'imp-1', id: 'bid-3' }] },
      {
        seat: 'dsp-a',
        bid: [
          { price: 2.2, id: 'bid-2', impid: 'imp-2' },
          { price: 1.1, id: 'bid-1', impid: 'imp-1' },
        ],
      },
    ],
  };

  assert.deepEqual(semanticDiff(left, right), {
    mode: 'semantic',
    equal: true,
    changes: [],
    warnings: [],
  });
});

test('only explicitly registered set paths ignore order; schain.nodes remains ordered', () => {
  const setOrderOnly = semanticDiff(
    { bcat: ['IAB1', 'IAB2'], imp: [{ id: 'i1', video: { mimes: ['video/mp4', 'video/webm'] } }] },
    { bcat: ['IAB2', 'IAB1'], imp: [{ id: 'i1', video: { mimes: ['video/webm', 'video/mp4'] } }] },
  );
  assert.equal(setOrderOnly.equal, true);

  const schainOrder = semanticDiff(
    { source: { ext: { schain: { nodes: [{ asi: 'a' }, { asi: 'b' }] } } } },
    { source: { ext: { schain: { nodes: [{ asi: 'b' }, { asi: 'a' }] } } } },
  );
  assert.equal(schainOrder.equal, false);
  assert.ok(schainOrder.changes.some((change) => change.path === '/source/ext/schain/nodes/0/asi'));

  const unregistered = semanticDiff(
    { ext: { values: ['a', 'b'] } },
    { ext: { values: ['b', 'a'] } },
  );
  assert.equal(unregistered.equal, false);
});

test('set-like paths emit deterministic member additions/removals and collapse duplicates', () => {
  const result = semanticDiff(
    { bcat: ['IAB1', 'IAB1', 'IAB2'] },
    { bcat: ['IAB2', 'IAB3', 'IAB3'] },
  );

  assert.deepEqual(
    result.changes.map(({ op, path, before, after }) => ({ op, path, before, after })),
    [
      {
        op: 'remove',
        path: '/bcat/@set=%22IAB1%22',
        before: 'IAB1',
        after: undefined,
      },
      {
        op: 'add',
        path: '/bcat/@set=%22IAB3%22',
        before: undefined,
        after: 'IAB3',
      },
    ],
  );
});

test('duplicate identity falls back to indices and emits an explicit symmetric warning', () => {
  const left = {
    imp: [
      { id: 'dup', tag: 'a' },
      { id: 'dup', tag: 'b' },
    ],
  };
  const right = {
    imp: [
      { id: 'dup', tag: 'b' },
      { id: 'dup', tag: 'a' },
    ],
  };
  const result = semanticDiff(left, right);

  assert.equal(result.equal, false);
  assert.deepEqual(result.warnings, [
    {
      code: 'array_identity_fallback',
      path: '/imp',
      leftPath: '/imp',
      rightPath: '/imp',
      identityKey: 'id',
      left: {
        missingIndices: [],
        invalidIndices: [],
        duplicates: [{ value: 'dup', indices: [0, 1] }],
      },
      right: {
        missingIndices: [],
        invalidIndices: [],
        duplicates: [{ value: 'dup', indices: [0, 1] }],
      },
    },
  ]);
  assert.ok(result.changes.some((change) => change.path === '/imp/0/tag'));
  assert.deepEqual(sortResult(semanticDiff(right, left)), mirrorResult(result));
});

test('missing and invalid identities fall back to indices without hiding data', () => {
  const result = semanticDiff(
    { imp: [{ id: 'ok' }, { banner: { w: 300 } }, { id: { nested: true } }] },
    { imp: [{ id: 'ok' }, { banner: { w: 320 } }, { id: { nested: false } }] },
  );

  assert.equal(result.equal, false);
  assert.deepEqual(result.warnings[0].left, {
    missingIndices: [1],
    invalidIndices: [2],
    duplicates: [],
  });
  assert.deepEqual(result.warnings[0].right, {
    missingIndices: [1],
    invalidIndices: [2],
    duplicates: [],
  });
  assert.ok(result.changes.some((change) => change.path === '/imp/1/banner/w'));
  assert.ok(result.changes.some((change) => change.path === '/imp/2/id/nested'));
});

test('diff symmetry mirrors add/remove, before/after, concrete pointers, and warnings', () => {
  const left = {
    bcat: ['IAB1', 'IAB2'],
    imp: [
      { id: 'a', bidfloor: 1 },
      { id: 'b', bidfloor: 2 },
    ],
  };
  const right = {
    bcat: ['IAB2', 'IAB3'],
    imp: [
      { id: 'c', bidfloor: 4 },
      { id: 'a', bidfloor: 3 },
    ],
  };

  const forward = semanticDiff(left, right);
  const reverse = semanticDiff(right, left);
  assert.deepEqual(sortResult(reverse), mirrorResult(forward));
});

test('output is deterministic and inputs are never mutated', () => {
  const left = {
    imp: [
      { id: 'b', ext: { z: 1, a: 2 } },
      { id: 'a', ext: { x: true } },
    ],
    bcat: ['IAB2', 'IAB1'],
  };
  const right = {
    bcat: ['IAB3', 'IAB2'],
    imp: [
      { ext: { x: false }, id: 'a' },
      { ext: { a: 2, z: 9 }, id: 'b' },
    ],
  };
  const leftBefore = JSON.stringify(left);
  const rightBefore = JSON.stringify(right);
  const first = JSON.stringify(semanticDiff(left, right));

  for (let i = 0; i < 20; i++) {
    assert.equal(JSON.stringify(semanticDiff(left, right)), first);
  }
  assert.equal(JSON.stringify(left), leftBefore);
  assert.equal(JSON.stringify(right), rightBefore);
});

test('change payloads are detached snapshots and preserve JSON __proto__ keys', () => {
  const special = JSON.parse('{"__proto__":{"safe":true}}');
  const right = { added: special };
  const result = rawDiff({}, right);
  const snapshot = result.changes[0].after;

  assert.notStrictEqual(snapshot, special);
  assert.equal(Object.hasOwn(snapshot, '__proto__'), true);
  assert.deepEqual(snapshot.__proto__, { safe: true });
  snapshot.__proto__.safe = false;
  assert.equal(special.__proto__.safe, true);
  assert.equal({}.safe, undefined);
});

test('large keyed OpenRTB payload stays within a generous anti-quadratic budget', () => {
  const size = 5000;
  const left = { imp: [], bcat: ['IAB1', 'IAB2'] };
  for (let i = 0; i < size; i++) {
    left.imp.push({
      id: `imp-${i}`,
      bidfloor: i / 100,
      banner: {
        format: [
          { w: 300, h: 250 },
          { w: 728, h: 90 },
        ],
      },
      ext: { index: i },
    });
  }
  const right = structuredClone(left);
  right.imp.reverse();
  right.imp.find((imp) => imp.id === 'imp-2500').bidfloor = 999;

  const started = process.hrtime.bigint();
  const result = semanticDiff(left, right);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(result.changes.length, 1);
  assert.equal(result.warnings.length, 0);
  assert.ok(
    elapsedMs < 2000,
    `semantic diff took ${elapsedMs.toFixed(1)}ms for ${size} keyed imps — possible O(n²)`,
  );
});

test('engine source is pure and does not emit validator findings', () => {
  const diffDir = path.join(ROOT, 'packages/core/diff');
  const source = fs
    .readdirSync(diffDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(diffDir, name), 'utf8'))
    .join('\n')
    // Strip comments before the DOM/network check. The module is isomorphic and
    // its header has to SAY so — naming `window.OrtbtoolsDiff` in prose is
    // documentation, not an access. Scanning comments would force the file to
    // describe itself vaguely to stay green. Executable code is still held to
    // the full rule: it reaches the browser global through `globalThis`, never
    // through a DOM reference.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.doesNotMatch(source, /\b(?:window|document|fetch|XMLHttpRequest|sendBeacon)\b/);
  assert.doesNotMatch(source, /require\(['"](?:node:)?fs['"]\)/);
  assert.doesNotMatch(source, /\bDate\.now\s*\(/);
  assert.doesNotMatch(source, /\bMath\.random\s*\(/);
  assert.doesNotMatch(source, /\b(?:F|makeFinding)\s*\(/);
});

test('invalid mode and non-JSON values fail explicitly', () => {
  assert.throws(
    () => diffJson({}, {}, /** @type {any} */ ({ mode: 'magic' })),
    /Unsupported diff mode/,
  );
  assert.throws(() => semanticDiff({ value: undefined }, {}), /left is not JSON-compatible/);
  assert.throws(() => rawDiff({ value: Number.NaN }, {}), /left is not JSON-compatible/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => rawDiff(cycle, {}), /left is not JSON-compatible/);
});

test('nesting depth is bounded with a typed error before stack exhaustion', () => {
  const tooDeep = nestedValue(600);
  assert.throws(
    () => rawDiff(tooDeep, tooDeep),
    (error) => {
      if (!(error instanceof Error)) return false;
      assert.equal(error.constructor, TypeError);
      assert.equal(error instanceof RangeError, false);
      assert.match(error.message, /^left is not JSON-compatible at \/a(?:\/a)+:/);
      assert.match(error.message, /nesting depth exceeds 512$/);
      return true;
    },
  );

  const supported = nestedValue(100);
  assert.deepEqual(rawDiff(supported, supported), {
    mode: 'raw',
    equal: true,
    changes: [],
    warnings: [],
  });
});
