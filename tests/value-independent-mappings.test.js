'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const Database = require('better-sqlite3');
const { createDialectsModule } = require('../modules/dialects/handler');
const {
  loadUserDialect,
  getDefaultDialectForUser,
} = require('../packages/core/dialects/user-dialect-runtime');
const { ROLE_LABELS, LEGACY_LABELS } = require('../packages/core/dialects/key-role-vocabulary');
const core = require('../packages/core');

function harness(t) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE user_dialects(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, is_default INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE dialect_mappings(id INTEGER PRIMARY KEY, dialect_id INTEGER REFERENCES user_dialects(id) ON DELETE CASCADE, signal_path TEXT, signal_value TEXT NOT NULL, semantic_label TEXT, shape_fingerprint TEXT, params TEXT, version INTEGER NOT NULL DEFAULT 1, confidence TEXT, notes TEXT, created_at INTEGER);`);
  t.after(() => db.close());
  const mod = createDialectsModule({
    db,
    auth: { getCurrentUser: (req) => (req.userId ? { id: req.userId } : null) },
  });
  async function call(method, path, body, userId = 1) {
    const route = mod.routes.find(
      (r) =>
        r.method === method &&
        new RegExp('^' + r.path.replace(/:[^/]+/g, '([^/]+)') + '$').test(path),
    );
    assert.ok(route, path);
    const values = path
      .match(new RegExp('^' + route.path.replace(/:[^/]+/g, '([^/]+)') + '$'))
      .slice(1);
    const params = Object.fromEntries(
      (route.path.match(/:[^/]+/g) || []).map((key, i) => [key.slice(1), values[i]]),
    );
    const req = /** @type {any} */ (
      Readable.from(body === undefined ? [] : [JSON.stringify(body)])
    );
    req.userId = userId;
    req.headers = { 'content-type': 'application/json' };
    let status;
    /** @type {any} */
    let result;
    const res = {
      setHeader() {},
      writeHead(s) {
        status = s;
      },
      end(value) {
        result = JSON.parse(value);
      },
    };
    await route.handler(req, res, null, { params });
    return { status, ...result };
  }
  const make = async (name, userId = 1) =>
    (await call('POST', '/api/dialects', { name, is_default: true }, userId)).dialect.id;
  const add = (id, body, userId) => call('POST', `/api/dialects/${id}/mappings`, body, userId);
  return { db, call, make, add };
}
const field = { signal_path: 'imp[7].ext.uid', match_scope: 'path', semantic_label: 'identifier' };

test('path scope API/runtime: all nine roles, exact precedence, private value omission and account/default isolation', async (t) => {
  const { db, call, make, add } = harness(t);
  const a = await make('A');
  for (const [i, role] of ROLE_LABELS.entries()) {
    const r = await add(a, { ...field, signal_path: `imp[2].ext.key${i}`, semantic_label: role });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.mapping.version, 2);
    assert.equal(r.mapping.signal_value, '');
    assert.equal(r.mapping.signal_path, `imp[].ext.key${i}`);
  }
  await add(a, field);
  let rt = loadUserDialect(db, a);
  assert.equal(rt.lookupMapping('imp[3].ext.uid', 'private-B').match_scope, 'path');
  assert.equal(rt.lookupMapping('imp[].ext.uid', null).semantic_label, field.semantic_label);
  assert.equal(rt.lookupMapping('imp[].ext.other', 'private-B'), null);
  const payload = {
    id: 'mapping-format-control',
    imp: [{ id: '1', banner: { w: 300, h: 250 }, ext: { uid: 'private-B' } }],
  };
  assert.deepEqual(core.detectFormat(payload, rt), core.detectFormat(payload));
  assert.ok(
    core
      .validate(payload)
      .findings.some((finding) => finding.id === 'dialects.question.unknown_ext_signal'),
  );
  assert.equal(
    core
      .validate(payload, { userDialect: rt })
      .findings.some((finding) => finding.id === 'dialects.question.unknown_ext_signal'),
    false,
  );
  await add(a, {
    signal_path: 'imp[].ext.uid',
    signal_value: 'override',
    semantic_label: 'custom',
    params: { untouched: true },
  });
  rt = loadUserDialect(db, a);
  assert.equal(rt.lookupMapping('imp[8].ext.uid', 'override').semantic_label, 'custom');
  assert.equal(rt.lookupMapping('imp[8].ext.uid', 'next').semantic_label, field.semantic_label);
  assert.equal(
    rt.shouldSuppress({
      id: 'dialects.question.unknown_ext_signal',
      path: 'imp[0].ext.uid',
      level: 'question',
      params: { value: 'next' },
    }),
    true,
  );
  for (const level of ['warning', 'error'])
    assert.equal(
      rt.shouldSuppress({
        id: 'some.normative.rule',
        path: 'imp[0].ext.uid',
        level,
        params: { value: 'next' },
      }),
      false,
    );
  assert.equal(
    rt.shouldSuppress({
      id: 'other.question',
      path: 'imp[0].ext.uid',
      level: 'question',
      params: { value: 'next' },
    }),
    false,
  );
  const b = await make('B');
  const other = await make('Other account', 2);
  assert.equal(getDefaultDialectForUser(db, 1), b);
  assert.equal(getDefaultDialectForUser(db, 2), other);
  assert.equal(loadUserDialect(db, b).lookupMapping('imp[].ext.uid', 'next'), null);
  assert.equal((await call('GET', `/api/dialects/${a}/mappings`, undefined, 2)).status, 404);
  assert.equal((await add(a, field, 2)).status, 404);
  await call('PATCH', `/api/dialects/${a}`, { is_default: true });
  assert.equal(getDefaultDialectForUser(db, 1), a);
});

test('legacy exact semantics and unknown versions never become wildcard mappings', async (t) => {
  const { db, call, make, add } = harness(t);
  const id = await make('Legacy');
  for (const [i, label] of LEGACY_LABELS.entries()) {
    const r = await add(id, {
      signal_path: `ext.legacy${i}`,
      signal_value: i === 0 ? '*' : 'null',
      semantic_label: label,
      params: { scope: 'path' },
      shape_fingerprint: 'metadata',
    });
    assert.equal(r.status, 200);
  }
  const rt = loadUserDialect(db, id);
  assert.equal(rt.lookupMapping('ext.legacy0', 'anything'), null);
  assert.ok(rt.lookupMapping('ext.legacy0', '*'));
  assert.ok(rt.lookupMapping('ext.legacy1', null));
  assert.equal(rt.lookupMapping('ext.legacy1', 'changed'), null);
  assert.equal((await call('GET', `/api/dialects/${id}/export`)).schema_version, 1);
  db.prepare(
    'INSERT INTO dialect_mappings(dialect_id,signal_path,signal_value,semantic_label,version) VALUES(?,?,?,?,?)',
  ).run(id, 'ext.future', '', ROLE_LABELS[0], 99);
  assert.equal(loadUserDialect(db, id, { skipCache: true }).lookupMapping('ext.future', 'x'), null);
  assert.equal((await call('GET', `/api/dialects/${id}/export`)).status, 409);
});

test('conversion, conflict and delete invalidate runtime cache immediately', async (t) => {
  const { db, call, make, add } = harness(t);
  const id = await make('Mutable');
  const created = await add(id, {
    signal_path: 'imp[].ext.uid',
    signal_value: 'first',
    semantic_label: field.semantic_label,
  });
  const url = `/api/dialects/${id}/mappings/${created.mapping.id}`;
  assert.equal(loadUserDialect(db, id).lookupMapping('imp[].ext.uid', 'second'), null);
  assert.equal((await call('PATCH', url, { match_scope: 'path' })).status, 200);
  assert.equal(
    loadUserDialect(db, id).lookupMapping('imp[].ext.uid', 'second').match_scope,
    'path',
  );
  assert.equal((await call('PATCH', url, { notes: 'edited' })).mapping.match_scope, 'path');
  assert.equal((await add(id, field)).status, 409);
  assert.equal((await call('PATCH', url, { match_scope: 'value' })).status, 400);
  assert.equal(
    (await call('PATCH', url, { match_scope: 'value', signal_value: 'third' })).status,
    200,
  );
  assert.equal(loadUserDialect(db, id).lookupMapping('imp[].ext.uid', 'second'), null);
  assert.ok(loadUserDialect(db, id).lookupMapping('imp[].ext.uid', 'third'));
  const id2 = await make('Second');
  assert.equal(
    (await call('DELETE', `/api/dialects/${id2}/mappings/${created.mapping.id}`)).status,
    404,
  );
  assert.equal((await call('DELETE', url, undefined, 2)).status, 403);
  assert.equal((await call('DELETE', url)).status, 200);
  assert.equal(loadUserDialect(db, id).lookupMapping('imp[].ext.uid', 'third'), null);
  await call('DELETE', `/api/dialects/${id}`);
  assert.throws(() => loadUserDialect(db, id), /dialect_not_found/);
});

test('schema 1/2 round trips and malformed imports are atomic; path scope cannot smuggle a format or observed value', async (t) => {
  const { db, call, make, add } = harness(t);
  const id = await make('Portable');
  await add(id, field);
  await add(id, { signal_path: 'ext.literal', signal_value: '*', semantic_label: 'ignore' });
  const exported = await call('GET', `/api/dialects/${id}/export`);
  assert.equal(exported.schema_version, 2);
  assert.ok(exported.mappings.every((m) => m.version && m.match_scope));
  const imported = await call('POST', '/api/dialects/import', exported, 2);
  assert.equal(imported.status, 200);
  assert.ok(loadUserDialect(db, imported.dialect.id).lookupMapping('imp[].ext.uid', 'fresh'));
  assert.equal(getDefaultDialectForUser(db, 2), null, 'import never silently activates');
  const count = () => db.prepare('SELECT count(*) n FROM user_dialects').get().n;
  const before = count();
  for (const bad of [
    {
      ...exported,
      mappings: [
        ...exported.mappings,
        {
          ...exported.mappings.find((m) => m.match_scope === 'path'),
          signal_path: 'imp[4].ext.uid',
        },
      ],
    },
    { ...exported, mappings: [...exported.mappings, { ...field, version: 99 }] },
    { ...exported, schema_version: 1 },
    { ...exported, mappings: [field] },
  ]) {
    assert.ok((await call('POST', '/api/dialects/import', bad)).status >= 400);
    assert.equal(count(), before);
  }
  for (const body of [
    { ...field, signal_value: 'private' },
    { ...field, semantic_label: 'banner' },
    { ...field, version: 1 },
    { ...field, signal_path: 'device.ua' },
    { ...field, signal_path: 'ext.bad..field' },
  ])
    assert.equal((await add(id, body)).status, 400);
  const legacy = await call('POST', '/api/dialects/import', {
    schema_version: 1,
    name: 'Old',
    mappings: [
      {
        signal_path: 'ext.x',
        signal_value: 'null',
        semantic_label: 'custom',
        params: { match_scope: 'path' },
      },
    ],
  });
  assert.equal(legacy.status, 200);
  assert.equal(loadUserDialect(db, legacy.dialect.id).lookupMapping('ext.x', 'other'), null);
});
