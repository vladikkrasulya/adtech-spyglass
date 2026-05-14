'use strict';

/**
 * tests/event-log.test.js — lib/event-log.js
 *
 * Verifies the SQLite-backed event log: synchronous record(), batched
 * flushNow(), filtered query(), prune. Uses the live db.js singleton —
 * tests run with NODE_ENV=test which keeps the table inside the on-disk
 * file but each test isolates its writes by component prefix.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Steer db.js to a temp dir before requiring it. db.js runs init() at
// require-time and would otherwise try to mkdir('/data') on the test host.
const TMP = mkdtempSync(join(tmpdir(), 'spyglass-event-log-'));
process.env.SPYGLASS_DATA_DIR = TMP;

let db, eventLog;
before(() => {
  ({ db } = require('../db'));
  eventLog = require('../lib/event-log');
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// Each test scopes its rows under a unique component string so concurrent
// or repeated runs don't trample each other.
function uniqComponent(label) {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function clear(component) {
  db.prepare('DELETE FROM event_log WHERE component = ?').run(component);
}

test('event-log: record + flushNow persists a single entry', () => {
  const c = uniqComponent('basic');
  try {
    eventLog.record({ level: 'info', component: c, msg: 'hello' });
    eventLog.flushNow();
    const rows = db
      .prepare('SELECT level, component, msg FROM event_log WHERE component = ?')
      .all(c);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].level, 'info');
    assert.equal(rows[0].msg, 'hello');
  } finally {
    clear(c);
  }
});

test('event-log: record clamps invalid level to info', () => {
  const c = uniqComponent('level');
  try {
    eventLog.record({ level: 'banana', component: c, msg: 'x' });
    eventLog.flushNow();
    const row = db.prepare('SELECT level FROM event_log WHERE component = ?').get(c);
    assert.equal(row.level, 'info');
  } finally {
    clear(c);
  }
});

test('event-log: empty msg is dropped (no row)', () => {
  const c = uniqComponent('empty');
  try {
    eventLog.record({ level: 'info', component: c, msg: '' });
    eventLog.flushNow();
    const row = db.prepare('SELECT id FROM event_log WHERE component = ?').get(c);
    assert.equal(row, undefined);
  } finally {
    clear(c);
  }
});

test('event-log: HTTP fields persist (method, path, status, latency)', () => {
  const c = uniqComponent('http');
  try {
    eventLog.record({
      level: 'info',
      component: c,
      msg: 'GET /api/foo → 200',
      method: 'GET',
      path: '/api/foo',
      status: 200,
      latency_ms: 42,
      user_id: 7,
      ip: '127.0.0.1',
      request_id: 'abc123',
    });
    eventLog.flushNow();
    const row = db
      .prepare(
        'SELECT method, path, status, latency_ms, user_id, ip, request_id FROM event_log WHERE component = ?',
      )
      .get(c);
    assert.equal(row.method, 'GET');
    assert.equal(row.path, '/api/foo');
    assert.equal(row.status, 200);
    assert.equal(row.latency_ms, 42);
    assert.equal(row.user_id, 7);
    assert.equal(row.ip, '127.0.0.1');
    assert.equal(row.request_id, 'abc123');
  } finally {
    clear(c);
  }
});

test('event-log: ctx JSON round-trips through query()', () => {
  const c = uniqComponent('ctx');
  try {
    eventLog.record({
      level: 'warn',
      component: c,
      msg: 'with ctx',
      ctx: { foo: 'bar', n: 7 },
    });
    eventLog.flushNow();
    const result = eventLog.query({ component: c, limit: 10 });
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0].ctx, { foo: 'bar', n: 7 });
  } finally {
    clear(c);
  }
});

test('event-log: query filters by level', () => {
  const c = uniqComponent('filter');
  try {
    eventLog.record({ level: 'info', component: c, msg: 'i' });
    eventLog.record({ level: 'warn', component: c, msg: 'w' });
    eventLog.record({ level: 'error', component: c, msg: 'e' });
    eventLog.flushNow();
    const onlyWarn = eventLog.query({ component: c, level: 'warn' });
    assert.equal(onlyWarn.items.length, 1);
    assert.equal(onlyWarn.items[0].msg, 'w');
  } finally {
    clear(c);
  }
});

test('event-log: query filters by user_id', () => {
  const c = uniqComponent('user');
  try {
    eventLog.record({ level: 'info', component: c, msg: 'a', user_id: 1 });
    eventLog.record({ level: 'info', component: c, msg: 'b', user_id: 2 });
    eventLog.record({ level: 'info', component: c, msg: 'c', user_id: 1 });
    eventLog.flushNow();
    const u1 = eventLog.query({ component: c, user_id: 1 });
    assert.equal(u1.items.length, 2);
    assert.equal(u1.total, 2);
  } finally {
    clear(c);
  }
});

test('event-log: query honours limit and returns total separately', () => {
  const c = uniqComponent('limit');
  try {
    for (let i = 0; i < 5; i++) {
      eventLog.record({ level: 'info', component: c, msg: 'm' + i });
    }
    eventLog.flushNow();
    const result = eventLog.query({ component: c, limit: 2 });
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 5);
  } finally {
    clear(c);
  }
});

test('event-log: query returns rows in descending ts order', () => {
  const c = uniqComponent('order');
  try {
    eventLog.record({ level: 'info', component: c, msg: 'first' });
    eventLog.flushNow();
    // Force a different ts for the second record. Sleeping 2ms is enough
    // since SQLite ts is unix-ms.
    const stop = Date.now() + 3;
    while (Date.now() < stop) {
      /* spin briefly */
    }
    eventLog.record({ level: 'info', component: c, msg: 'second' });
    eventLog.flushNow();
    const result = eventLog.query({ component: c });
    assert.equal(result.items[0].msg, 'second');
    assert.equal(result.items[1].msg, 'first');
  } finally {
    clear(c);
  }
});

test('event-log: pruneOlderThan removes ancient rows but keeps recent', () => {
  const c = uniqComponent('prune');
  try {
    const oldTs = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
    db.prepare('INSERT INTO event_log (ts, level, component, msg) VALUES (?, ?, ?, ?)').run(
      oldTs,
      'info',
      c,
      'ancient',
    );
    eventLog.record({ level: 'info', component: c, msg: 'fresh' });
    eventLog.flushNow();

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_log WHERE component = ?').get(c).n, 2);
    const removed = eventLog.pruneOlderThan(7);
    assert.ok(removed >= 1);
    const remaining = db.prepare('SELECT msg FROM event_log WHERE component = ?').all(c);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].msg, 'fresh');
  } finally {
    clear(c);
  }
});

test('event-log: listComponents returns distinct values', () => {
  const a = uniqComponent('listA');
  const b = uniqComponent('listB');
  try {
    eventLog.record({ level: 'info', component: a, msg: 'x' });
    eventLog.record({ level: 'info', component: a, msg: 'y' });
    eventLog.record({ level: 'info', component: b, msg: 'z' });
    eventLog.flushNow();
    const all = eventLog.listComponents();
    assert.ok(all.includes(a));
    assert.ok(all.includes(b));
    // Distinct: each name appears only once.
    assert.equal(all.filter((n) => n === a).length, 1);
  } finally {
    clear(a);
    clear(b);
  }
});
