/* global document, window */
'use strict';

/**
 * End-to-end contract tests for the creative preview boundary.
 *
 * These cases intentionally use a real browser. Structural source checks cannot
 * prove that a sandboxed frame's messages stay bounded, that Chrome's
 * `*-src-elem` directive spellings are localized, or that the exact body put in
 * `srcdoc` is also the body sent to the static behavior scanner.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let puppeteer = null;
let puppeteerLoadError = '';
try {
  puppeteer = require('puppeteer-core');
} catch (err) {
  puppeteerLoadError = err instanceof Error ? err.message : String(err);
}

const ROOT = path.join(__dirname, '..');
const chromeExecutable = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
  .filter(Boolean)
  .find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch (_error) {
      return false;
    }
  });

const browserSkipReason = !puppeteer
  ? `puppeteer-core unavailable: ${puppeteerLoadError}`
  : !chromeExecutable
    ? 'No executable Chrome/Chromium found; set CHROME_BIN'
    : false;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function startServer(port, dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        ORTBTOOLS_DATA_DIR: dataDir,
        ORTBTOOLS_ANALYTICS_DISABLED: '1',
        NEWS_CRAWLER_DISABLED: '1',
        FX_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      reject(new Error('Server did not start within 10s'));
    }, 10000);
    const onData = (chunk) => {
      if (settled || !chunk.toString().includes('listening')) return;
      settled = true;
      clearTimeout(timer);
      resolve({ proc, url: `http://127.0.0.1:${port}` });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('error', reject);
    proc.once('exit', (code) => {
      if (!settled) reject(new Error(`Server exited ${code}`));
    });
  });
}

function stopServer(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => proc.kill('SIGKILL'), 2000);
    proc.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP4z8DwHxkzkC4AADxAH+HggXe0AAAAAElFTkSuQmCC';
async function request(page, url, body, method = 'POST') {
  return page.evaluate(
    async (args) => {
      const response = await fetch(args.url, {
        method: args.method,
        headers: { 'Content-Type': 'application/json' },
        ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, body, method },
  );
}
async function captureEvidence(page, name) {
  const directory = process.env.ORTBTOOLS_UI_EVIDENCE_DIR;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  await page.click('[data-action="reveal-creative"]');
  await page.$eval('.creative-asset-inventory', (el) => {
    /** @type {HTMLDetailsElement} */ (el).open = true;
  });
  await page.waitForFunction(() => !document.querySelector('#toastContainer .toast'), {
    timeout: 5000,
  });
  await page.screenshot({ path: path.join(directory, name + '.png'), fullPage: true });
}

async function ready(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () =>
      typeof (/** @type {any} */ (window).runAnalysis) === 'function' &&
      /** @type {any} */ (window).OrtbtoolsDialectLabel,
  );
}
async function renderResponse(page, response, marker) {
  await page.evaluate(async (res) => {
    const w = /** @type {any} */ (window);
    /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value = '';
    /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value =
      JSON.stringify(res);
    await w.runAnalysis();
  }, response);
  await page.waitForFunction(
    (text) =>
      /** @type {HTMLIFrameElement} */ (
        document.querySelector('#creativePreview iframe')
      )?.srcdoc.includes(text),
    { timeout: 15000 },
    marker,
  );
  await page.waitForFunction(
    (expected) => {
      const last = /** @type {any} */ (window).__ortbtoolsLast;
      return last && JSON.stringify(last.res) === JSON.stringify(expected);
    },
    { timeout: 15000 },
    response,
  );
  await page.click('[data-target="tCreative"]');
}
function bids(adms) {
  return {
    id: 'asset-browser',
    cur: 'USD',
    seatbid: [
      {
        seat: 'synthetic',
        bid: adms.map((adm, i) => ({
          id: String(i),
          impid: String(i),
          price: 1,
          w: 300,
          h: 250,
          adm,
        })),
      },
    ],
  };
}

test(
  'browser: localized mapping lifecycle and actual Native/push/responsive image pixels stay within the sealed preview',
  { timeout: 180000, skip: browserSkipReason },
  async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-mapping-assets-'));
    let serverInfo, browser;
    try {
      serverInfo = await startServer(await getFreePort(), dataDir);
      browser = await puppeteer.launch({
        headless: true,
        executablePath: chromeExecutable,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      for (const locale of ['en', 'uk', 'ru']) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport({ width: 1366, height: 900 });
        await ready(page, serverInfo.url + '/' + locale + '/inspector');
        const registered = await request(page, '/api/auth/register', {
          email: 'mapping-' + locale + '@example.test',
          password: 'Synthetic-Only-Password-2026!',
        });
        assert.equal(registered.status, 200, JSON.stringify(registered));
        await ready(page, serverInfo.url + '/' + locale + '/inspector');
        const savedBodies = [];
        page.on('request', (req) => {
          if (req.method() === 'POST' && /\/api\/dialects\/\d+\/mappings$/.test(req.url()))
            savedBodies.push(JSON.parse(req.postData()));
        });
        await page.evaluate(() =>
          /** @type {any} */ (window).OrtbtoolsDialectLabel.openBuilder({
            path: 'imp[3].ext.synthetic_identifier_for_long_mapping_path_with_an_unbroken_vendor_suffix_abcdefghijklmnop',
            value: 'PRIVATE-NONCE-ONE',
          }),
        );
        await page.waitForSelector('#dlLabel');
        await page.select('#dlLabel', 'identifier');
        await page.select('#dlScope', 'path');
        assert.equal(
          await page.$eval('#dlScopeNote', (el) => el.textContent.includes('[')),
          false,
          'localized text must resolve',
        );
        await page.click('#dlSave');
        await page.waitForFunction(() => !document.getElementById('dlSave'));
        assert.equal(savedBodies.length, 1);
        assert.equal(savedBodies[0].match_scope, 'path');
        assert.equal('signal_value' in savedBodies[0], false);
        assert.equal(JSON.stringify(savedBodies).includes('PRIVATE-NONCE-ONE'), false);
        const listed = await request(page, '/api/dialects', undefined, 'GET');
        const dialect = listed.body.dialects[0];
        await request(
          page,
          '/api/dialects/' + dialect.id,
          {
            name: 'Synthetic desktop mapping — довга назва з перевіркою перенесення та меж картки',
          },
          'PATCH',
        );
        for (const value of ['PRIVATE-NONCE-TWO', 'PRIVATE-NONCE-THREE']) {
          const suggestion = await request(page, '/api/dialects/suggest-label', {
            signal_path:
              'imp[0].ext.synthetic_identifier_for_long_mapping_path_with_an_unbroken_vendor_suffix_abcdefghijklmnop',
            signal_value: value,
            locale,
          });
          assert.equal(suggestion.body.suggestion.source, 'saved-mapping');
          assert.equal(suggestion.body.suggestion.match_scope, 'path');
        }
        const exact = await request(page, '/api/dialects/' + dialect.id + '/mappings', {
          signal_path:
            'imp[].ext.synthetic_identifier_for_long_mapping_path_with_an_unbroken_vendor_suffix_abcdefghijklmnop',
          signal_value: 'override',
          semantic_label: 'custom',
        });
        assert.equal(exact.status, 200);
        const override = await request(page, '/api/dialects/suggest-label', {
          signal_path:
            'imp[0].ext.synthetic_identifier_for_long_mapping_path_with_an_unbroken_vendor_suffix_abcdefghijklmnop',
          signal_value: 'override',
          locale,
        });
        assert.equal(override.body.suggestion.label, 'custom');
        const mapped = await request(
          page,
          '/api/dialects/' + dialect.id + '/mappings',
          undefined,
          'GET',
        );
        const field = mapped.body.mappings.find((m) => m.match_scope === 'path');
        const exported = await request(
          page,
          '/api/dialects/' + dialect.id + '/export',
          undefined,
          'GET',
        );
        assert.equal(exported.body.schema_version, 2);
        assert.equal(JSON.stringify(exported.body).includes('PRIVATE-NONCE'), false);
        await page.goto(serverInfo.url + '/' + locale + '/account#dialects', {
          waitUntil: 'networkidle2',
        });
        await page.setViewport({ width: 1024, height: 768 });
        await page.waitForSelector('.dialect-mappings-item summary');
        await page.click('.dialect-mappings-item summary');
        await page.waitForSelector('[data-mapping-id="' + field.id + '"]');
        assert.ok(
          (
            await page.$eval('[data-mapping-id="' + field.id + '"]', (el) => el.textContent)
          ).includes(
            'imp[].ext.synthetic_identifier_for_long_mapping_path_with_an_unbroken_vendor_suffix_abcdefghijklmnop',
          ),
        );
        const mappingBounds = await page.evaluate(() => {
          const list = document.getElementById('dialectMappingsList');
          const card = list.closest('.cab-card').getBoundingClientRect();
          return {
            cardRight: card.right,
            viewport: window.innerWidth,
            listScroll: list.scrollWidth,
            listWidth: list.clientWidth,
            edges: Array.from(
              list.querySelectorAll('summary, code, button'),
              (el) => el.getBoundingClientRect().right,
            ),
          };
        });
        assert.ok(
          mappingBounds.edges.every(
            (right) => right <= Math.min(mappingBounds.cardRight, mappingBounds.viewport) + 1,
          ),
          JSON.stringify(mappingBounds),
        );
        assert.ok(
          mappingBounds.listScroll <= mappingBounds.listWidth + 1,
          JSON.stringify(mappingBounds),
        );
        await page.click('[data-mapping-id="' + field.id + '"] [data-dialect-action="edit"]');
        await page.select('[data-mapping-editor] [name="semantic_label"]', 'metadata');
        assert.equal(
          await page.$eval(
            '[data-mapping-editor] [name="signal_value"]',
            (el) => el.parentElement.getBoundingClientRect().height,
          ),
          0,
        );
        await page.click('[data-mapping-editor] [data-dialect-action="save"]');
        await page.waitForFunction(() => !document.querySelector('[data-mapping-editor]'));
        const edited = await request(
          page,
          '/api/dialects/' + dialect.id + '/mappings',
          undefined,
          'GET',
        );
        assert.equal(
          edited.body.mappings.find((m) => m.id === field.id).semantic_label,
          'metadata',
        );
        await page.click('[data-dialect-activate="' + dialect.id + '"]');
        await page.waitForSelector('[data-dialect-action="activate"]');
        assert.equal(
          (await request(page, '/api/dialects', undefined, 'GET')).body.dialects.some(
            (d) => d.is_default,
          ),
          false,
        );
        await page.click('[data-dialect-action="activate"]');
        await page.waitForSelector('[data-dialect-action="deactivate"]');
        page.on('dialog', (dialog) => dialog.accept());
        await page.$eval('.dialect-mappings-item', (el) => {
          /** @type {HTMLDetailsElement} */ (el).open = true;
        });
        await page.waitForSelector('[data-mapping-id="' + field.id + '"]');
        await page.click('[data-mapping-id="' + field.id + '"] [data-dialect-action="remove"]');
        await page.waitForFunction(
          (id) => !document.querySelector('[data-mapping-id="' + id + '"]'),
          {},
          field.id,
        );
        assert.equal(
          (
            await request(page, '/api/dialects/' + dialect.id + '/mappings', undefined, 'GET')
          ).body.mappings.some((m) => m.id === field.id),
          false,
        );
        const importPath = path.join(dataDir, 'import-' + locale + '.json');
        fs.writeFileSync(importPath, JSON.stringify(exported.body));
        await (await page.$('input[data-dialect-import]')).uploadFile(importPath);
        await page.waitForFunction(
          () => document.querySelectorAll('.dialect-mappings-item').length === 2,
        );
        const afterImport = await request(page, '/api/dialects', undefined, 'GET');
        assert.equal(
          afterImport.body.dialects.filter((d) => d.is_default).length,
          1,
          'import preserves explicit activation',
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          false,
        );
        await context.close();
      }

      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      const pageErrors = [];
      page.on('pageerror', (error) =>
        pageErrors.push(error instanceof Error ? error.message : String(error)),
      );
      await ready(page, serverInfo.url + '/en/inspector');
      const denied = await request(page, '/api/creative/asset', {
        url: 'https://images.example.test/anonymous.png',
      });
      assert.equal(denied.status, 401, 'raster loading remains authenticated');
      assert.equal(
        (
          await request(page, '/api/auth/register', {
            email: 'raster@example.test',
            password: 'Synthetic-Only-Password-2026!',
          })
        ).status,
        200,
      );
      await ready(page, serverInfo.url + '/en/inspector');
      const assetCalls = [];
      const advertiserRequests = [];
      let failSecond = true;
      let holdAssets = false;
      /** @type {any} */
      let heldAsset = null;
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().endsWith('/api/creative/asset')) {
          const body = JSON.parse(req.postData());
          assetCalls.push(body.url);
          if (holdAssets) {
            heldAsset = req;
            return;
          }
          const fail = failSecond && body.url.endsWith('/two.png');
          req.respond({
            status: fail ? 502 : 200,
            contentType: 'application/json',
            body: JSON.stringify(
              fail ? { ok: false, code: 'timeout' } : { ok: true, dataUri: PNG },
            ),
          });
        } else if (req.url().includes('example.test') && !req.url().startsWith(serverInfo.url)) {
          advertiserRequests.push(req.url());
          req.abort();
        } else req.continue();
      });
      await ready(page, serverInfo.url + '/en/inspector');
      const markup =
        '<!DOCTYPE html><html><head><style>.pixel{width:48px;height:48px}.card{width:240px;background-image:url(https://images.example.test/one.png)}</style></head><body><div class="card" data-wave="responsive"><picture><source srcset="https://images.example.test/one.png 1x, https://images.example.test/two.png 2x"><img class="pixel" src="https://images.example.test/one.png"></picture><img class="pixel" src="https://images.example.test/two.png"></div></body></html>';
      await renderResponse(page, bids([markup]), 'data-wave="responsive"');
      assert.equal(assetCalls.length, 0, 'display alone must not start the raster batch');
      await page.click('.creative-inline-assets');
      await page.waitForSelector('[data-asset-status="failed"]');
      await page.waitForFunction(
        () =>
          !(
            /** @type {HTMLButtonElement} */ (document.querySelector('.creative-inline-assets'))
              .disabled
          ),
      );
      assert.deepEqual(assetCalls, [
        'https://images.example.test/one.png',
        'https://images.example.test/two.png',
      ]);
      failSecond = false;
      await page.click('.creative-inline-assets');
      await page.waitForFunction(
        () => document.querySelectorAll('[data-asset-status="loaded"]').length === 2,
      );
      assert.equal(assetCalls.length, 3);
      assert.equal(assetCalls[2], 'https://images.example.test/two.png');
      let frame = await (await page.$('#creativePreview iframe')).contentFrame();
      await frame
        .waitForFunction(
          () => [...document.images].every((img) => img.complete && img.naturalWidth > 0),
          { timeout: 6000 },
        )
        .catch(async (error) => {
          throw new Error(
            error.message +
              ' synthetic frame images: ' +
              JSON.stringify(
                await frame.evaluate(() =>
                  Array.from(document.images, (img) => ({
                    src: img.getAttribute('src'),
                    current: img.currentSrc,
                    width: img.naturalWidth,
                    complete: img.complete,
                  })),
                ),
              ),
          );
        });
      const pixels = await frame.evaluate(() => {
        const image = document.images[0];
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return {
          compatMode: document.compatMode,
          alpha: ctx.getImageData(0, 0, 1, 1).data[3],
          imageWidth: image.getBoundingClientRect().width,
          cardWidth: document.querySelector('.card').getBoundingClientRect().width,
          background: window.getComputedStyle(document.querySelector('.card')).backgroundImage,
          headStyle: !!document.head.querySelector('style'),
        };
      });
      assert.equal(pixels.alpha, 255);
      assert.equal(pixels.compatMode, 'CSS1Compat', 'the preserved doctype must control layout');
      assert.equal(pixels.imageWidth, 48);
      assert.equal(pixels.cardWidth, 240);
      assert.equal(pixels.headStyle, true);
      assert.ok(pixels.background.includes('data:image/png'));
      assert.equal(
        await page.$eval('#creativePreviewSafe', (el) => el.classList.contains('is-revealed')),
        false,
      );
      await captureEvidence(page, 'responsive-css-loaded');
      const native = JSON.stringify({
        native: {
          assets: [
            { id: 1, title: { text: 'Native wave two' } },
            { id: 2, img: { url: 'https://images.example.test/native.png', w: 48, h: 48 } },
          ],
          link: { url: 'https://click.example.test/' },
        },
      });
      await renderResponse(page, bids([native]), 'Native wave two');
      const beforeNative = assetCalls.length;
      await page.click('.creative-inline-assets');
      await page.waitForFunction(
        () => document.querySelectorAll('[data-asset-status="loaded"]').length === 1,
      );
      frame = await (await page.$('#creativePreview iframe')).contentFrame();
      await frame.waitForFunction(() => document.images[0]?.naturalWidth > 0);
      assert.equal(assetCalls.length, beforeNative + 1);
      await captureEvidence(page, 'native-loaded');
      const beforeSelection = assetCalls.length;
      await renderResponse(
        page,
        bids([
          '<img data-wave="first" src="https://images.example.test/first.png">',
          '<img data-wave="second" src="https://images.example.test/second.png">',
        ]),
        'data-wave="first"',
      );
      await page.click('[data-action="select-creative-bid"][data-bid-index="1"]');
      await page.waitForFunction(
        () =>
          /** @type {HTMLIFrameElement} */ (
            document.querySelector('#creativePreview iframe')
          )?.srcdoc.includes('data-wave="second"'),
        { timeout: 4000 },
      );
      await page.click('.creative-inline-assets');
      await page.waitForFunction(
        () => document.querySelectorAll('[data-asset-status="loaded"]').length === 1,
      );
      frame = await (await page.$('#creativePreview iframe')).contentFrame();
      await frame.waitForFunction(() => document.images[0]?.naturalWidth > 0);
      assert.deepEqual(assetCalls.slice(beforeSelection), [
        'https://images.example.test/second.png',
      ]);
      assert.equal(
        await page.$eval('[data-action="select-creative-bid"][data-bid-index="1"]', (el) =>
          el.getAttribute('aria-pressed'),
        ),
        'true',
      );

      for (const invalidate of ['edit', 'selection']) {
        await renderResponse(
          page,
          bids([
            '<img data-wave="queued" src="https://images.example.test/queue-one.png"><img src="https://images.example.test/queue-two.png">',
            '<div data-wave="replacement">replacement</div>',
          ]),
          'data-wave="queued"',
        );
        const beforeCancel = assetCalls.length;
        holdAssets = true;
        heldAsset = null;
        await page.click('.creative-inline-assets');
        for (let i = 0; i < 100 && !heldAsset; i++)
          await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(heldAsset, 'first synthetic asset request reached the transport');
        if (invalidate === 'edit') {
          await page.$eval('#bidRes', (el) => {
            /** @type {HTMLTextAreaElement} */ (el).value = '{}';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await page.waitForFunction(() => !document.querySelector('#creativePreview iframe'));
        } else {
          await page.click('[data-action="select-creative-bid"][data-bid-index="1"]');
          await page.waitForFunction(() =>
            /** @type {HTMLIFrameElement} */ (
              document.querySelector('#creativePreview iframe')
            )?.srcdoc.includes('data-wave="replacement"'),
          );
        }
        holdAssets = false;
        await heldAsset
          .respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, dataUri: PNG }),
          })
          .catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
          assetCalls.length,
          beforeCancel + 1,
          'invalidation must cancel unsent queued requests',
        );
        assert.equal(
          await page.$eval('#creativePreview', (el) => el.innerHTML.includes('data-wave="queued"')),
          false,
          'late response must not restore the old creative',
        );
      }
      const push = {
        tId: '00000000-0000-4000-8000-000000000001',
        title: 'Push wave two',
        description: 'Synthetic',
        icon: 'https://images.example.test/icon.png',
        image: 'https://images.example.test/hero.png',
        link: 'https://click.example.test/',
        cpc: 0.01,
      };
      await renderResponse(page, push, 'Push wave two');
      await page.click('.creative-inline-assets');
      await page.waitForFunction(
        () => document.querySelectorAll('[data-asset-status="loaded"]').length === 2,
      );
      frame = await (await page.$('#creativePreview iframe')).contentFrame();
      await frame.waitForFunction(() =>
        [...document.images].every((image) => image.naturalWidth > 0),
      );
      assert.equal(
        await frame.evaluate(() => document.images[0].getBoundingClientRect().width),
        48,
        'push icon CSS must survive the full-document round trip',
      );
      assert.equal(
        await page.$eval('#creativePreview iframe', (el) => el.getAttribute('sandbox')),
        'allow-scripts',
      );
      await captureEvidence(page, 'push-loaded');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
      );
      assert.deepEqual(advertiserRequests, []);
      assert.equal(
        await page.$eval('.creative-inline-assets', (el) => el.getBoundingClientRect().width),
        0,
        'a completed manifest must not display Retry 0',
      );
      assert.equal(
        await page.$eval('.creative-cancel-assets', (el) => el.getBoundingClientRect().width),
        0,
        'a completed batch must not display Cancel',
      );
      assert.deepEqual(pageErrors, []);
    } finally {
      if (browser) await browser.close();
      if (serverInfo) await stopServer(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
