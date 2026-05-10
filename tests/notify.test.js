'use strict';

/**
 * notifyAdmin tests. Mocks https.request the same way email.test.js does.
 * Resets the throttle map between tests via the exported _resetThrottle.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

const notify = require('../notify');

function mockHttps({ statusCode = 200, responseBody = '{"ok":true}' } = {}) {
  const observed = { opts: null, body: '', destroyed: false };
  const original = https.request;
  https.request = (opts, cb) => {
    observed.opts = opts;
    const req = new EventEmitter();
    /** @type {any} */ (req).write = (chunk) => {
      observed.body += chunk;
    };
    /** @type {any} */ (req).setTimeout = () => {};
    /** @type {any} */ (req).destroy = () => {
      observed.destroyed = true;
    };
    /** @type {any} */ (req).end = () => {
      setImmediate(() => {
        const res = new EventEmitter();
        /** @type {any} */ (res).statusCode = statusCode;
        /** @type {any} */ (res).setEncoding = () => {};
        cb(res);
        res.emit('data', responseBody);
        res.emit('end');
      });
    };
    return /** @type {any} */ (req);
  };
  return {
    observed,
    restore: () => {
      https.request = original;
    },
  };
}

function withEnv(mutate, fn) {
  const saved = {
    TG_BOT_TOKEN: process.env.TG_BOT_TOKEN,
    TG_ADMIN_CHAT_ID: process.env.TG_ADMIN_CHAT_ID,
  };
  mutate();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(saved)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

test('dev-mode short-circuits when TG env missing', async () => {
  const mock = mockHttps();
  const origLog = console.log;
  console.log = () => {};
  try {
    notify._resetThrottle();
    await withEnv(
      () => {
        delete process.env.TG_BOT_TOKEN;
        delete process.env.TG_ADMIN_CHAT_ID;
      },
      async () => {
        const result = await notify.notifyAdmin('test message', { tag: 't1' });
        assert.equal(result.ok, true);
        assert.equal(result.dev, true);
        assert.equal(mock.observed.opts, null, 'must not call https.request in dev mode');
      },
    );
  } finally {
    mock.restore();
    console.log = origLog;
  }
});

test('prod-mode posts to api.telegram.org with token in path', async () => {
  const mock = mockHttps();
  try {
    notify._resetThrottle();
    await withEnv(
      () => {
        process.env.TG_BOT_TOKEN = 'tok-abc';
        process.env.TG_ADMIN_CHAT_ID = '123456';
      },
      async () => {
        // Message body is treated as HTML — callers wrap dynamic content in
        // tags like <code> / <pre>, so escapeHtml only runs on the tag.
        const result = await notify.notifyAdmin('hello <code>world</code>', {
          tag: 'tag<bad>',
          level: 'error',
        });
        assert.equal(result.ok, true);
        assert.equal(mock.observed.opts.host, 'api.telegram.org');
        assert.equal(mock.observed.opts.path, '/bottok-abc/sendMessage');
        const parsed = JSON.parse(mock.observed.body);
        assert.equal(parsed.chat_id, '123456');
        assert.equal(parsed.parse_mode, 'HTML');
        assert.ok(parsed.text.includes('🔴'), 'error level → red icon');
        assert.ok(
          parsed.text.includes('<b>tag&lt;bad&gt;</b>'),
          'tag is escaped to prevent breaking the structural HTML',
        );
        assert.ok(
          parsed.text.includes('<code>world</code>'),
          'message HTML passes through verbatim',
        );
      },
    );
  } finally {
    mock.restore();
  }
});

test('throttle: same tag within window returns throttled=true without sending', async () => {
  const mock = mockHttps();
  try {
    notify._resetThrottle();
    await withEnv(
      () => {
        process.env.TG_BOT_TOKEN = 'tok';
        process.env.TG_ADMIN_CHAT_ID = '1';
      },
      async () => {
        const r1 = await notify.notifyAdmin('first', { tag: 'rate-test' });
        assert.equal(r1.ok, true);
        assert.equal(r1.throttled, undefined);
        // Reset opts so we can confirm the second call doesn't hit https.
        const before = mock.observed.body.length;
        const r2 = await notify.notifyAdmin('second', { tag: 'rate-test' });
        assert.equal(r2.ok, true);
        assert.equal(r2.throttled, true);
        assert.equal(mock.observed.body.length, before, 'throttled call must not POST');
      },
    );
  } finally {
    mock.restore();
  }
});

test('different tags bypass throttle', async () => {
  const mock = mockHttps();
  try {
    notify._resetThrottle();
    await withEnv(
      () => {
        process.env.TG_BOT_TOKEN = 'tok';
        process.env.TG_ADMIN_CHAT_ID = '1';
      },
      async () => {
        await notify.notifyAdmin('a', { tag: 'tag-A' });
        const lenA = mock.observed.body.length;
        await notify.notifyAdmin('b', { tag: 'tag-B' });
        const lenB = mock.observed.body.length;
        assert.ok(lenB > lenA, 'second tag should send another POST');
      },
    );
  } finally {
    mock.restore();
  }
});

test('non-2xx response surfaces ok=false without throwing', async () => {
  const mock = mockHttps({ statusCode: 401, responseBody: '{"description":"unauthorized"}' });
  const origErr = console.error;
  console.error = () => {};
  try {
    notify._resetThrottle();
    await withEnv(
      () => {
        process.env.TG_BOT_TOKEN = 'bad';
        process.env.TG_ADMIN_CHAT_ID = '1';
      },
      async () => {
        const r = await notify.notifyAdmin('x', { tag: 'errpath' });
        assert.equal(r.ok, false);
        assert.equal(r.error, 'HTTP 401');
      },
    );
  } finally {
    mock.restore();
    console.error = origErr;
  }
});
