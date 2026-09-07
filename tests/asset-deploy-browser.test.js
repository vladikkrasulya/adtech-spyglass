/* global document, window */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { createStaticAssets } = require('../lib/static-assets');

const chrome = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
  .filter(Boolean)
  .find((file) => fs.existsSync(file));
const ROOT = path.join(__dirname, '..');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-asset-browser-'));
  const write = (name, source) => {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  };
  for (const name of [
    'shell-boot.js',
    'core/registry.js',
    'core/router.js',
    'core/utils.js',
    'core/events.js',
    'modules/inspector/index.js',
  ]) {
    write(name, fs.readFileSync(path.join(ROOT, 'public', name), 'utf8'));
  }
  write(
    'core/session.js',
    'export const session={ensureBooted(){}}; export function installSessionFacade(){}',
  );
  write('core/modal-host.js', 'export function installModalHost(){}');
  write(
    'modules/nav/index.js',
    "export function mountNav(){}; export const canonicalize=path=>path.replace(/^\\/(uk|ru)(?=\\/)/,'');",
  );
  write('modules/topbar/index.js', 'export function mountTopbar(){}');
  write('modules/nav/nav.css', 'nav {display:block}');
  write('modules/topbar/topbar.css', 'header {display:block}');
  write(
    'modules/library/index.js',
    "export default {id:'library',mount(root){root.innerHTML='<textarea id=notes>draft</textarea>';}};",
  );
  write('modules/inspector/specimen-handoff.js', 'export function loadSpecimenIntoEditor(){}');
  write('ortbtools.app.js', "export function mountInspector(root){root.dataset.mounted='yes';}");
  write('modules/inspector/inspector.css', '.old-view { color: rgb(1, 2, 3); }');
  for (const lang of ['en', 'uk', 'ru']) {
    write(
      `modules/inspector/template.${lang}.html`,
      `<section class="old-view" data-locale="${lang}"><textarea id="bidReq">draft</textarea></section>`,
    );
  }
  write(
    'index.en.html',
    '<!doctype html><html lang="en"><head></head><body><div class="kt-shell"><main id="app-root"></main></div><script type="module" src="/shell-boot.js"></script></body></html>',
  );
  const assets = createStaticAssets(dir);
  const requests = [];
  const controls = { failCss: false, missingLocale: '', delayTemplates: false };
  const delayed = [];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname.includes('.') ? pathname : '/index.en.html';
    const reply = () => {
      try {
        let status = assets.cachePolicy(file, req.url).status;
        const policy = assets.cachePolicy(file, req.url);
        if (controls.failCss && file === '/modules/inspector/inspector.css') status = 503;
        if (file === `/modules/inspector/template.${controls.missingLocale}.html`) status = 404;
        requests.push({ pathname, url: req.url, status });
        const type = file.endsWith('.js')
          ? 'application/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html';
        const body = status === 200 ? assets.render(file) : 'asset_unavailable';
        res.writeHead(status, {
          ...policy.headers,
          ...(status === 200 ? {} : { 'Cache-Control': 'no-store' }),
          'Content-Type': type,
        });
        res.end(body);
      } catch (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Cache-Control': 'no-store' });
        res.end('missing');
      }
    };
    if (controls.delayTemplates && file.includes('/template.')) delayed.push(reply);
    else reply();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  t.after(async () => {
    await browser.close();
    delayed.splice(0).forEach((reply) => reply());
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    browser,
    assets,
    requests,
    write,
    controls,
    delayed,
    url: `http://127.0.0.1:${address.port}`,
  };
}

test(
  'old deferred imports fail without replacing unsaved input; a fresh page uses the new release',
  { skip: !chrome },
  async (t) => {
    const f = await fixture(t);
    const page = await f.browser.newPage();
    await page.goto(f.url + '/library');
    await page.waitForSelector('#notes');
    await page.$eval('#notes', (/** @type {HTMLTextAreaElement} */ node) => {
      node.value = 'unsaved <private synthetic> draft';
    });
    f.write(
      'modules/inspector/template.en.html',
      '<section class="new-view"><textarea id="bidReq">new</textarea></section>',
    );
    await page.evaluate(() => window['OrtbtoolsShell'].navigateTo('/inspector'));
    await page.waitForSelector('#section-load-recovery');
    assert.equal(
      await page.$eval('#notes', (/** @type {HTMLTextAreaElement} */ node) => node.value),
      'unsaved <private synthetic> draft',
    );
    assert.equal(await page.$('#bidReq'), null);
    assert.ok(
      f.requests.some(
        (request) => request.pathname === '/modules/inspector/index.js' && request.status === 409,
      ),
    );
    await page.reload();
    await page.waitForSelector('#bidReq');
    assert.equal(
      await page.$eval('#bidReq', (/** @type {HTMLTextAreaElement} */ node) => node.value),
      'new',
    );
    assert.equal(await page.$('#section-load-recovery'), null);
  },
);

test(
  'cached old CSS cannot pair with a revalidated new template; recovery keeps the old editor',
  { skip: !chrome },
  async (t) => {
    const f = await fixture(t);
    const page = await f.browser.newPage();
    await page.goto(f.url + '/inspector');
    await page.waitForSelector('#bidReq');
    await page.$eval('#bidReq', (/** @type {HTMLTextAreaElement} */ node) => {
      node.value = 'keep this input';
    });
    f.write(
      'modules/inspector/template.en.html',
      '<section class="incompatible"><textarea id="bidReq">replacement</textarea></section>',
    );
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = (url, options) => original(url, { ...options, cache: 'no-cache' });
      return window['OrtbtoolsShell'].activateFromUrl();
    });
    await page.waitForSelector('#section-load-recovery');
    assert.equal(
      await page.$eval('#bidReq', (/** @type {HTMLTextAreaElement} */ node) => node.value),
      'keep this input',
    );
    assert.equal(await page.$('.incompatible'), null);
    assert.equal(await page.$$eval('link[href*="inspector.css"]', (nodes) => nodes.length), 1);
    assert.ok(
      f.requests.some(
        (request) => request.pathname.endsWith('template.en.html') && request.status === 409,
      ),
    );
  },
);

test(
  'stylesheet failure and aborted template preparation preserve the active section and clean staged links',
  { skip: !chrome },
  async (t) => {
    const f = await fixture(t);
    const page = await f.browser.newPage();
    await page.goto(f.url + '/library');
    await page.waitForSelector('#notes');
    f.controls.failCss = true;
    await page.evaluate(() => window['OrtbtoolsShell'].navigateTo('/inspector'));
    await page.waitForSelector('#section-load-recovery');
    assert.equal(
      await page.$eval('#notes', (/** @type {HTMLTextAreaElement} */ node) => node.value),
      'draft',
    );
    assert.equal(await page.$$eval('link[href*="inspector.css"]', (nodes) => nodes.length), 0);
    f.controls.failCss = false;
    f.controls.delayTemplates = true;
    await page.evaluate(() => {
      window['OrtbtoolsShell'].activateFromUrl();
    });
    await page.waitForFunction(() => document.querySelector('link[href*="inspector.css"]'));
    await page.evaluate(() => window['OrtbtoolsShell'].navigateTo('/library'));
    f.controls.delayTemplates = false;
    f.delayed.splice(0).forEach((reply) => reply());
    assert.equal(
      await page.$eval('#notes', (/** @type {HTMLTextAreaElement} */ node) => node.value),
      'draft',
    );
    assert.equal(await page.$$eval('link[href*="inspector.css"]', (nodes) => nodes.length), 0);
  },
);

test(
  'only a missing translation falls back to English, with all locale recovery messages available',
  { skip: !chrome },
  async (t) => {
    const f = await fixture(t);
    for (const lang of ['en', 'uk', 'ru']) {
      const page = await f.browser.newPage();
      await page.goto(f.url + '/library');
      await page.waitForSelector('#notes');
      await page.evaluate((locale) => {
        document.documentElement.lang = locale;
      }, lang);
      f.controls.missingLocale = lang === 'en' ? '' : lang;
      await page.evaluate(() => window['OrtbtoolsShell'].navigateTo('/inspector'));
      await page.waitForSelector('#bidReq');
      assert.equal(
        await page.$eval('[data-locale]', (/** @type {HTMLElement} */ node) => node.dataset.locale),
        'en',
      );
      const attempts = await page.evaluate(async () => {
        const original = window.fetch;
        let calls = 0;
        window.fetch = (url, options) => {
          if (String(url).includes('/template.')) {
            calls++;
            return Promise.resolve(new Response('asset_version_unavailable', { status: 409 }));
          }
          return original(url, options);
        };
        await window['OrtbtoolsShell'].activateFromUrl();
        return calls;
      });
      assert.equal(attempts, 1, 'stale template must not trigger an English fallback');
      assert.equal(
        await page.$eval('#section-load-recovery h2', (node) => node.textContent),
        {
          en: 'This section could not load',
          uk: 'Не вдалося завантажити розділ',
          ru: 'Не удалось загрузить раздел',
        }[lang],
      );
      assert.ok(await page.$('#bidReq'), 'the previous editor remains available');
      await page.close();
    }
  },
);
