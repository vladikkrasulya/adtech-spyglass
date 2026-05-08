'use strict';

/**
 * Email module tests. Mocks https.request at the module level so we can
 * assert what's being sent without hitting Resend.
 *
 * Each test saves+restores the relevant env vars; tests must NOT leak state
 * since dev-mode/prod-mode is decided per call from process.env.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

process.env.EMAIL_FROM = 'test-from@example.com';
process.env.PUBLIC_BASE_URL = 'https://example.com';

const email = require('../email');

// Helper: replace https.request with a mock that simulates a Resend response.
// Returns { restore, observed } where observed accumulates what the caller saw.
function mockHttps({ statusCode = 200, responseBody = '{"id":"em_test"}' } = {}) {
  const observed = { opts: null, body: '' };
  const original = https.request;
  https.request = (opts, cb) => {
    observed.opts = opts;
    const req = new EventEmitter();
    /** @type {any} */ (req).write = (chunk) => {
      observed.body += chunk;
    };
    /** @type {any} */ (req).setTimeout = () => {};
    /** @type {any} */ (req).destroy = () => {};
    /** @type {any} */ (req).end = () => {
      // Defer to next tick so caller can register handlers first.
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
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  mutate();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved.NODE_ENV;
      if (saved.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = saved.RESEND_API_KEY;
    });
}

test('dev-mode short-circuits and does not call https', async () => {
  const mock = mockHttps();
  const origLog = console.log;
  console.log = () => {};
  try {
    await withEnv(
      () => {
        delete process.env.RESEND_API_KEY;
        process.env.NODE_ENV = 'development';
      },
      async () => {
        const result = /** @type {any} */ (
          await email.sendVerifyEmail({ email: 'a@b.com' }, 'fake-token')
        );
        assert.equal(result.dev, true);
        // Link must hit the server confirm endpoint — front-end has no
        // handler for /?verify= so the previous URL was a dead link.
        assert.ok(result.link.includes('/api/auth/verify-email/confirm?token=fake-token'));
        assert.equal(mock.observed.opts, null, 'https.request must not be called in dev mode');
      },
    );
  } finally {
    mock.restore();
    console.log = origLog;
  }
});

test('prod-mode without API key still short-circuits (graceful degrade)', async () => {
  const mock = mockHttps();
  const origLog = console.log;
  console.log = () => {};
  try {
    await withEnv(
      () => {
        delete process.env.RESEND_API_KEY;
        process.env.NODE_ENV = 'production';
      },
      async () => {
        const result = /** @type {any} */ (
          await email.sendResetEmail({ email: 'r@s.com' }, 'reset-tok')
        );
        assert.equal(result.dev, true);
        assert.equal(mock.observed.opts, null);
      },
    );
  } finally {
    mock.restore();
    console.log = origLog;
  }
});

test('prod-mode posts to api.resend.com/emails with Bearer + JSON body', async () => {
  const mock = mockHttps({ statusCode: 200, responseBody: '{"id":"em_xyz"}' });
  try {
    await withEnv(
      () => {
        process.env.RESEND_API_KEY = 're_test_key_123';
        process.env.NODE_ENV = 'production';
      },
      async () => {
        const result = /** @type {any} */ (
          await email.sendResetEmail({ email: 'reset@example.com' }, 'token-abc-123')
        );
        assert.equal(result.id, 'em_xyz');
        assert.equal(mock.observed.opts.host, 'api.resend.com');
        assert.equal(mock.observed.opts.path, '/emails');
        assert.equal(mock.observed.opts.method, 'POST');
        assert.equal(mock.observed.opts.headers.Authorization, 'Bearer re_test_key_123');
        assert.equal(mock.observed.opts.headers['Content-Type'], 'application/json');
        const parsed = JSON.parse(mock.observed.body);
        assert.equal(parsed.from, 'test-from@example.com');
        assert.deepEqual(parsed.to, ['reset@example.com']);
        assert.ok(parsed.subject.includes('Скидання'));
        assert.ok(parsed.html.includes('reset=token-abc-123'));
        assert.ok(parsed.text.includes('token-abc-123'));
      },
    );
  } finally {
    mock.restore();
  }
});

test('verify email URL targets the confirm endpoint with URL-encoded token', async () => {
  const mock = mockHttps();
  try {
    await withEnv(
      () => {
        process.env.RESEND_API_KEY = 're_test';
        process.env.NODE_ENV = 'production';
      },
      async () => {
        await email.sendVerifyEmail({ email: 'verify@example.com' }, 'token+with/special=chars');
        const parsed = JSON.parse(mock.observed.body);
        // encodeURIComponent escapes +, /, =. The link must hit the server's
        // GET /api/auth/verify-email/confirm — front-end has no /?verify= handler.
        assert.ok(
          parsed.html.includes(
            '/api/auth/verify-email/confirm?token=token%2Bwith%2Fspecial%3Dchars',
          ),
        );
      },
    );
  } finally {
    mock.restore();
  }
});

test('non-2xx response surfaces as typed error with status', async () => {
  const mock = mockHttps({ statusCode: 403, responseBody: '{"error":"forbidden"}' });
  try {
    await withEnv(
      () => {
        process.env.RESEND_API_KEY = 're_test';
        process.env.NODE_ENV = 'production';
      },
      async () => {
        await assert.rejects(email.sendVerifyEmail({ email: 'x@y.com' }, 'tok'), (err) => {
          const e = /** @type {any} */ (err);
          assert.match(e.message, /Resend returned 403/);
          assert.equal(e.code, 'RESEND_API_ERROR');
          assert.equal(e.status, 403);
          return true;
        });
      },
    );
  } finally {
    mock.restore();
  }
});

test('HTML escapes user email to prevent injection in template', async () => {
  const mock = mockHttps();
  try {
    await withEnv(
      () => {
        process.env.RESEND_API_KEY = 're_test';
        process.env.NODE_ENV = 'production';
      },
      async () => {
        await email.sendResetEmail({ email: 'evil<script>@x.com' }, 'tok');
        const parsed = JSON.parse(mock.observed.body);
        assert.ok(!parsed.html.includes('<script>'), 'raw <script> must not appear');
        assert.ok(parsed.html.includes('&lt;script&gt;'), 'must be html-escaped');
      },
    );
  } finally {
    mock.restore();
  }
});
