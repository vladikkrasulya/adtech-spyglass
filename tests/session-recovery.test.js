'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork, spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');

const fixture = path.join(__dirname, 'fixtures/session-recovery-process.js');
function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
async function start(t, directory, env = {}) {
  const proc = fork(fixture, [], {
    env: {
      PATH: process.env.PATH,
      ORTBTOOLS_DATA_DIR: directory,
      ORTBTOOLS_ANALYTICS_DISABLED: '1',
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  t.after(() => {
    if (proc.exitCode === null) proc.kill('SIGKILL');
  });
  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let serial = 0;
  const ready = await new Promise((resolve, reject) => {
    proc.once('message', resolve);
    proc.once('exit', () => reject(new Error('recovery child exited before readiness: ' + stderr)));
  });
  const call = (op, args = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const listener = (message) => {
        if (message.id !== id) return;
        proc.off('message', listener);
        if (message.error) reject(new Error(message.error));
        else resolve(message.result);
      };
      proc.on('message', listener);
      proc.send({ id, op, ...args });
    });
  const exit = () =>
    new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) resolve();
      else proc.once('exit', resolve);
    });
  return { proc, ready, call, exit };
}
async function cleanStop(child) {
  const result = await child.call('shutdown');
  await child.exit();
  return result;
}

test('durable logout survives real restart while another session keeps orderly continuity', async (t) => {
  const directory = temp(t);
  const first = await start(t, directory);
  assert.deepEqual(first.ready, { ready: true });
  const a = await first.call('mint', { name: 'first' });
  const b = await first.call('mint', { name: 'second' });
  assert.match(a.cookie, /^ot_session=[a-f0-9]{64}$/);
  await first.call('faults', { value: { deletion: true } });
  assert.deepEqual(await first.call('logout', { cookie: a.cookie }), {
    error: null,
    expired: true,
  });
  assert.deepEqual(await first.call('check', { cookie: a.cookie }), { authenticated: false });
  const stored = await first.call('stats');
  assert.equal(stored.rows.length, 2, 'the deletion fault must leave the original SQLite row');
  assert.ok(stored.rows.every((id) => /^sr1:[a-f0-9]{64}$/.test(id)));
  assert.ok(
    !stored.rows.includes(a.cookie.slice('ot_session='.length)),
    'old auth cannot look up a raw cookie',
  );
  assert.deepEqual(await cleanStop(first), { clean: true });
  const second = await start(t, directory);
  assert.deepEqual(second.ready, { ready: true });
  assert.deepEqual(await second.call('check', { cookie: a.cookie }), { authenticated: false });
  assert.deepEqual(await second.call('check', { cookie: b.cookie }), { authenticated: true });
  await cleanStop(second);
});

test('total-write failure plus crash cannot revive old cookies and unsafe recovery stays unavailable', async (t) => {
  const directory = temp(t);
  const first = await start(t, directory);
  const a = await first.call('mint', { name: 'first' });
  const b = await first.call('mint', { name: 'second' });
  await first.call('faults', { value: { deletion: true, journal: true } });
  const outcome = await first.call('logout', { cookie: a.cookie });
  assert.equal(outcome.error, 'session_persistence_failed');
  assert.equal(outcome.expired, true);
  assert.deepEqual(await first.call('check', { cookie: a.cookie }), { authenticated: false });
  first.proc.kill('SIGKILL');
  await first.exit();
  const unsafe = await start(t, directory, { TEST_RECOVERY_DELETE_FAILURE: '1' });
  assert.deepEqual(unsafe.ready, { ready: false, error: 'session_recovery_unavailable' });
  await unsafe.exit();
  const recovered = await start(t, directory);
  assert.deepEqual(recovered.ready, { ready: true });
  for (const cookie of [a.cookie, b.cookie])
    assert.deepEqual(await recovered.call('check', { cookie }), { authenticated: false });
  await cleanStop(recovered);
});

test('kernel ownership rejects a concurrent owner and releases on actual process crash', async (t) => {
  const directory = temp(t);
  const first = await start(t, directory);
  const second = await start(t, directory);
  assert.deepEqual(second.ready, { ready: false, error: 'session_recovery_unavailable' });
  await second.exit();
  assert.deepEqual(first.ready, { ready: true });
  first.proc.kill('SIGKILL');
  await first.exit();
  const third = await start(t, directory);
  assert.deepEqual(third.ready, { ready: true });
  await cleanStop(third);
});

test('unexpired intent cap never evicts a revocation and cannot produce a clean checkpoint', async (t) => {
  const directory = temp(t);
  const first = await start(t, directory, { TEST_RECOVERY_CAP: '1' });
  const a = await first.call('mint', { name: 'first' });
  const b = await first.call('mint', { name: 'second' });
  await first.call('faults', { value: { deletion: true } });
  assert.equal((await first.call('logout', { cookie: a.cookie })).error, null);
  assert.equal(
    (await first.call('logout', { cookie: b.cookie })).error,
    'session_persistence_failed',
  );
  assert.equal((await first.call('stats')).revocations, 1);
  assert.deepEqual(await cleanStop(first), { clean: false });
  const second = await start(t, directory);
  for (const cookie of [a.cookie, b.cookie])
    assert.deepEqual(await second.call('check', { cookie }), { authenticated: false });
  await cleanStop(second);
});

test(
  'real server waits for an in-flight HTTP body before certifying a clean auth checkpoint',
  { timeout: 15_000 },
  async (t) => {
    const directory = temp(t);
    const port = await new Promise((resolve) => {
      const socket = net.createServer();
      socket.listen(0, '127.0.0.1', () => {
        const value = /** @type {import('node:net').AddressInfo} */ (socket.address()).port;
        socket.close(() => resolve(value));
      });
    });
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        PORT: String(port),
        ORTBTOOLS_DATA_DIR: directory,
        ORTBTOOLS_ANALYTICS_DISABLED: '1',
        NEWS_CRAWLER_DISABLED: '1',
        FX_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL');
    });
    let output = '';
    proc.stdout.on('data', (chunk) => {
      output += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      output += chunk;
    });
    async function logged(text) {
      const end = Date.now() + 5000;
      while (!output.includes(text)) {
        assert.equal(proc.exitCode, null, 'server must remain alive before its recorded phase');
        assert.ok(Date.now() < end, 'server phase was not observed: ' + text);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    await logged('backend listening');
    const pending = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        Expect: '100-continue',
        'Content-Type': 'application/json',
        'Content-Length': '2',
      },
    });
    t.after(() => pending.destroy());
    const accepted = once(pending, 'continue');
    const response = once(pending, 'response');
    pending.flushHeaders();
    await accepted; // Node has accepted this request, but its JSON body is held.
    proc.kill('SIGTERM');
    await logged('shutting down');
    const checkpoint = path.join(directory, 'session-recovery/checkpoint.json');
    assert.equal(JSON.parse(fs.readFileSync(checkpoint, 'utf8')).clean, false);
    assert.equal(proc.exitCode, null, 'shutdown must wait for the in-flight request');
    pending.end('{}');
    const [out] = await response;
    let body = '';
    out.on('data', (chunk) => {
      body += chunk;
    });
    await once(out, 'end');
    assert.equal(out.statusCode, 503);
    assert.equal(JSON.parse(body).code, 'auth_unavailable');
    const [code] = await once(proc, 'exit');
    assert.equal(code, 0);
    assert.equal(JSON.parse(fs.readFileSync(checkpoint, 'utf8')).clean, true);
  },
);
