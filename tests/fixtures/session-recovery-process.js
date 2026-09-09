'use strict';

// Synthetic IPC harness. Tokens travel only between the test's owned processes;
// stdout, diagnostics and tracked fixtures never contain issued credentials.
const fs = require('node:fs');
const path = require('node:path');
const { Users, Sessions, db } = require('../../db');
const { createAuth } = require('../../auth');
const { createSessionRecovery } = require('../../lib/session-recovery');
const faults = { deletion: false, journal: false };
const store = {
  ...Sessions,
  destroy(id) {
    if (faults.deletion) throw new Error('synthetic deletion fault');
    return Sessions.destroy(id);
  },
  destroyForUser(id) {
    if (faults.deletion) throw new Error('synthetic deletion fault');
    return Sessions.destroyForUser(id);
  },
  destroyAll() {
    if (process.env.TEST_RECOVERY_DELETE_FAILURE) throw new Error('synthetic recovery fault');
    return Sessions.destroyAll();
  },
};
const io = {
  ...fs,
  fsyncSync(fd) {
    if (faults.journal) throw new Error('synthetic sync fault');
    return fs.fsyncSync(fd);
  },
};
let auth;
let recovery;
try {
  recovery = createSessionRecovery({
    directory: path.join(process.env.ORTBTOOLS_DATA_DIR, 'session-recovery'),
    store,
    io,
    maxEntries: Number(process.env.TEST_RECOVERY_CAP) || undefined,
  });
  auth = createAuth({ Users, Sessions: store, recovery, logger: { info() {}, error() {} } });
  process.send({ ready: true });
} catch (e) {
  process.send({ ready: false, error: e.code || e.message });
  db.close();
  process.disconnect();
}

function request(cookie = '') {
  return { headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } };
}
function response() {
  return {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
}
if (auth)
  process.on('message', (message) => {
    const m = /** @type {any} */ (message);
    try {
      let result;
      if (m.op === 'mint') {
        let user = Users.getByEmail(m.name + '@example.test');
        if (!user)
          user = Users.create({ email: m.name + '@example.test', password_hash: 'synthetic-v1' });
        const out = response();
        auth.createSession(request(), out, auth.sessionUser(user.id));
        result = { cookie: out.headers['Set-Cookie'].split(';')[0], userId: user.id };
      } else if (m.op === 'check') {
        result = { authenticated: !!auth.getCurrentUser(request(m.cookie)) };
      } else if (m.op === 'faults') {
        Object.assign(faults, m.value);
        result = {};
      } else if (m.op === 'logout') {
        const out = response();
        let error = null;
        try {
          auth.destroySession(request(m.cookie), out);
        } catch (e) {
          error = e.code || e.message;
        }
        result = { error, expired: /Max-Age=0/.test(out.headers['Set-Cookie']) };
      } else if (m.op === 'invalidate') {
        auth.invalidateUserSessions(m.userId);
        result = {};
      } else if (m.op === 'stats') {
        result = { ...recovery.stats(), rows: Sessions.loadActive().map((row) => row.token) };
      } else if (m.op === 'shutdown') {
        auth.beginShutdown();
        const clean = auth.shutdown({ clean: true });
        db.close();
        process.send({ id: m.id, result: { clean } }, () => process.disconnect());
        return;
      } else throw new Error('unknown test operation');
      process.send({ id: m.id, result });
    } catch (e) {
      process.send({ id: m.id, error: e.code || e.message });
    }
  });
