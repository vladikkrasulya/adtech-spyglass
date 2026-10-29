'use strict';

/**
 * tests/account-delete-ui.test.js — "Delete account" control on the cabinet.
 * Markup parity across the three locales + the controller's behaviour
 * (jsdom, fetch stubbed): disabled until password + confirmation, 401/429/
 * network messages, success clears the unlocked key and redirects.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ACCOUNT_SOURCE = read('public/account.js');

function controllerSource() {
  const start = ACCOUNT_SOURCE.indexOf('  // ── Delete account ──');
  const end = ACCOUNT_SOURCE.indexOf('  // "Forgot recovery key?', start);
  assert.ok(start >= 0 && end > start, 'delete-account controller must remain extractable');
  return ACCOUNT_SOURCE.slice(start, end);
}

test('every locale ships the delete-account form and no longer tells users to email for deletion', () => {
  for (const locale of ['en', 'uk', 'ru']) {
    const html = read(`public/account.${locale}.html`);
    assert.doesNotMatch(
      html,
      /mailto:hi@ortbtools\.com">hi@ortbtools\.com<\/a> —\s*(automated|автоматичн)/,
    );
    const dom = new JSDOM(html);
    const { document } = dom.window;
    const form = document.getElementById('deleteAccountForm');
    assert.ok(form, `${locale}: form`);
    assert.ok(form.hidden, `${locale}: hidden until opened`);
    assert.equal(document.getElementById('deleteAccountPassword').type, 'password');
    assert.equal(document.getElementById('deleteAccountPassword').autocomplete, 'current-password');
    assert.equal(document.getElementById('deleteAccountConfirm').type, 'checkbox');
    const submit = document.getElementById('deleteAccountSubmit');
    assert.equal(submit.type, 'submit');
    assert.ok(submit.disabled, `${locale}: submit disabled initially`);
    assert.ok(document.querySelector('[data-action="delete-account-open"]'));
    assert.ok(document.querySelector('[data-action="delete-account-cancel"]'));
    assert.ok(document.getElementById('deleteAccountError').getAttribute('role') === 'alert');
    assert.match(html, /\/account\.js\?v=8/, `${locale}: asset version bumped`);
    dom.window.close();
  }
});

function boot(fetchImpl) {
  const dom = new JSDOM(read('public/account.en.html'), {
    runScripts: 'outside-only',
    url: 'https://ortbtools.test/account',
  });
  const { window } = dom;
  window.fetch = fetchImpl;
  const messages = {
    'cabinet.delete.deleting': 'Deleting…',
    'cabinet.delete.wrong_password': 'WRONG',
    'cabinet.delete.rate_limited': 'LIMITED',
    'cabinet.delete.failed': 'FAILED',
  };
  window.t = (k) => messages[k] || k;
  // Wrapped in a function so the controller sees a stub `location` (jsdom cannot
  // navigate and Location.href is not overridable).
  const nav = { href: '' };
  window.eval(
    `window.__make = function (location) {
       const $ = (id) => document.getElementById(id);
       const T = (k, p) => window.t(k, p);
       ${controllerSource()}
       return deleteAccountToggle;
     };`,
  );
  window.__toggle = window.__make(nav);
  const document = window.document;
  const el = {
    form: document.getElementById('deleteAccountForm'),
    password: document.getElementById('deleteAccountPassword'),
    confirm: document.getElementById('deleteAccountConfirm'),
    submit: document.getElementById('deleteAccountSubmit'),
    error: document.getElementById('deleteAccountError'),
  };
  const type = (value) => {
    el.password.value = value;
    el.password.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const tick = (checked) => {
    el.confirm.checked = checked;
    el.confirm.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const submit = async () => {
    el.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
  };
  return { dom, window, el, type, tick, submit, nav };
}

test('submit stays disabled until a password is typed AND the confirmation is ticked', () => {
  const { window, el, type, tick } = boot(async () => ({ ok: true, status: 200 }));
  window.__toggle(true);
  assert.equal(el.form.hidden, false);
  assert.ok(el.submit.disabled);
  type('hunter2hunter2');
  assert.ok(el.submit.disabled, 'password alone is not enough');
  tick(true);
  assert.equal(el.submit.disabled, false);
  tick(false);
  assert.ok(el.submit.disabled);
  window.close();
});

test('cancel hides the form and clears the typed password', () => {
  const { window, el, type, tick } = boot(async () => ({ ok: true, status: 200 }));
  window.__toggle(true);
  type('secret-secret');
  tick(true);
  window.__toggle(false);
  assert.equal(el.form.hidden, true);
  assert.equal(el.password.value, '');
  assert.equal(el.confirm.checked, false);
  assert.ok(el.submit.disabled);
  window.close();
});

test('wrong password / rate limit / outage show a localized message and keep the form usable', async () => {
  for (const [status, expected] of [
    [401, 'WRONG'],
    [429, 'LIMITED'],
    [500, 'FAILED'],
  ]) {
    const calls = [];
    const { window, el, type, tick, submit } = boot(async (url, init) => {
      calls.push({ url, init });
      return { ok: false, status };
    });
    window.__toggle(true);
    type('whatever-pass');
    tick(true);
    await submit();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/auth/delete-account');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].init.body), { password: 'whatever-pass' });
    assert.equal(el.error.hidden, false);
    assert.equal(el.error.textContent, expected);
    assert.equal(el.submit.disabled, false, 'can retry');
    window.close();
  }
  const { window, el, type, tick, submit } = boot(async () => {
    throw new Error('network');
  });
  window.__toggle(true);
  type('whatever-pass');
  tick(true);
  await submit();
  assert.equal(el.error.textContent, 'FAILED');
  window.close();
});

test('success drops the unlocked key and leaves the page', async () => {
  const { window, el, type, tick, submit, nav } = boot(async () => ({ ok: true, status: 200 }));
  window.sessionStorage.setItem('kt-dek-v1', 'wrapped-key');
  window.__toggle(true);
  type('whatever-pass');
  tick(true);
  await submit();
  assert.equal(nav.href, '/');
  assert.equal(window.sessionStorage.getItem('kt-dek-v1'), null);
  assert.equal(el.error.hidden, true);
  window.close();
});
