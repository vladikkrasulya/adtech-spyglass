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

/**
 * @template T
 * @param {() => void} mutate
 * @param {() => (T | PromiseLike<T>)} fn
 * @returns {Promise<T>}
 */
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
        // Locale is the 4th argument (3rd is a baseUrl override, left
        // undefined so PUBLIC_BASE_URL applies). 'uk' is passed explicitly
        // because this case asserts the Ukrainian template still renders —
        // an omitted locale now means English, not Ukrainian. See the
        // locale-selection tests below for that contract.
        const result = /** @type {any} */ (
          await email.sendResetEmail(
            { email: 'reset@example.com' },
            'token-abc-123',
            undefined,
            'uk',
          )
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

// ── Locale selection ────────────────────────────────────────────────────────
//
// Both senders take `locale` as their 4th argument and resolve it through the
// same {en, uk, ru} copy tables the templates are built from. The regression
// these cover: every transactional email used to be Ukrainian for every
// recipient regardless of account language (docs/i18n-audit-2026-08-27.md
// finding 1, P0). English is the fallback, not Ukrainian — a sender may be
// invoked with no request context at all, so "no locale" must not mean "the
// author's locale".

const LOCALE_EXPECTATIONS = {
  verify: {
    en: {
      subject: 'Confirm your email — ortbtools',
      heading: 'Confirm your email',
      textIntro: 'Confirm your email — ortbtools',
    },
    uk: {
      subject: 'Підтверди свою адресу — ortbtools',
      heading: 'Підтвердження адреси',
      textIntro: 'Підтвердження адреси ortbtools',
    },
    ru: {
      subject: 'Подтверди свой адрес — ortbtools',
      heading: 'Подтверждение адреса',
      textIntro: 'Подтверждение адреса ortbtools',
    },
  },
  reset: {
    en: {
      subject: 'Reset your password — ortbtools',
      heading: 'Password reset',
      textIntro: 'Password reset — ortbtools',
    },
    uk: {
      subject: 'Скидання паролю — ortbtools',
      heading: 'Скидання паролю',
      textIntro: 'Скидання паролю ortbtools',
    },
    ru: {
      subject: 'Сброс пароля — ortbtools',
      heading: 'Сброс пароля',
      textIntro: 'Сброс пароля ortbtools',
    },
  },
};

// `args` is spread, so a 2-element array genuinely omits `locale` rather than
// passing an explicit `undefined` — the "caller never heard of locales" case.
/**
 * @param {string} kind  'verify' | 'reset' — left as plain string because the
 *   call sites iterate `['verify', 'reset']`, which widens past the literal
 *   union anyway
 * @param {[user: {email: string}, token: string, baseUrl?: string, locale?: string]} args
 *   Tuple, not a plain array — sendVerifyEmail/sendResetEmail take this
 *   fixed, non-rest parameter list (see their JSDoc in email.js), and
 *   `send` below is a union of both, so the spread at the call site needs
 *   a tuple type to type-check.
 */
function sendAndParse(kind, args) {
  const mock = mockHttps();
  return withEnv(
    () => {
      process.env.RESEND_API_KEY = 're_test';
      process.env.NODE_ENV = 'production';
    },
    async () => {
      const send = kind === 'verify' ? email.sendVerifyEmail : email.sendResetEmail;
      await send(...args);
      return JSON.parse(mock.observed.body);
    },
  ).finally(() => mock.restore());
}

for (const kind of ['verify', 'reset']) {
  for (const locale of ['en', 'uk', 'ru']) {
    test(`${kind} email renders the ${locale} template when locale is '${locale}'`, async () => {
      const expected = LOCALE_EXPECTATIONS[kind][locale];
      const parsed = await sendAndParse(kind, [
        { email: 'locale@example.com' },
        'tok',
        undefined,
        locale,
      ]);
      assert.equal(parsed.subject, expected.subject);
      assert.ok(
        parsed.html.includes(`>${expected.heading}</h2>`),
        `html heading must be ${locale}: ${expected.heading}`,
      );
      assert.ok(
        parsed.text.startsWith(expected.textIntro),
        `text body must be ${locale}: ${expected.textIntro}`,
      );
    });
  }

  test(`${kind} email falls back to English when locale is omitted or invalid`, async () => {
    const en = LOCALE_EXPECTATIONS[kind].en;
    const omitted = await sendAndParse(kind, [{ email: 'nolocale@example.com' }, 'tok']);
    assert.equal(omitted.subject, en.subject, 'omitted locale must render English');
    assert.ok(omitted.text.startsWith(en.textIntro));

    const invalid = await sendAndParse(kind, [
      { email: 'nolocale@example.com' },
      'tok',
      undefined,
      'xx',
    ]);
    assert.equal(invalid.subject, en.subject, 'unrecognized locale must render English');
    assert.ok(invalid.text.startsWith(en.textIntro));
  });
}
