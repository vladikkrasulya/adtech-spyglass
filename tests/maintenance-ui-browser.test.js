/* global document, window */
'use strict';
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

function findChromeExecutable() {
  return [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
    .filter(Boolean)
    .find((c) => {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return true;
      } catch (_e) {
        return false;
      }
    });
}

const chromeExecutable = findChromeExecutable();
const browserSkipReason = !puppeteer
  ? `puppeteer-core unavailable: ${puppeteerLoadError}`
  : !chromeExecutable
    ? 'No executable Chrome/Chromium found; set CHROME_BIN'
    : false;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('net').AddressInfo} */ (srv.address()).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function stopChild(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    }, 2000);
    proc.once('exit', finish);
    proc.kill('SIGTERM');
  });
}

function startServer(port, dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
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
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error('Server did not start within 10s'));
      }
    }, 10000);
    const onData = (chunk) => {
      if (!started && chunk.toString().includes('listening')) {
        started = true;
        clearTimeout(timeout);
        resolve({ proc, url: `http://127.0.0.1:${port}` });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited ${code}`));
      }
    });
  });
}

const req = (id) => ({
  id,
  site: { domain: 'synthetic.example' },
  imp: [{ id: 'i1', banner: { w: 300, h: 250 } }],
});
function result(id, extra = {}) {
  return {
    success: true,
    validation: {
      type: 'oRTB Request',
      status: 'clean',
      findings: [],
      version: { version: '2.6', confidence: 1 },
      ...extra,
    },
    crosscheck: [],
    meta: { categories: {} },
    marker: id,
  };
}
async function put(page, value) {
  await page.evaluate((payload) => {
    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq'));
    input.value = JSON.stringify(payload);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function begin(page) {
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.analysisPromise = w.runAnalysis();
  });
  await page.waitForFunction(() => /** @type {any} */ (window).pendingAnalyze.length > 0);
}
async function complete(page, value) {
  await page.evaluate((payload) => {
    const w = /** @type {any} */ (window);
    w.pendingAnalyze.shift()({ ok: true, status: 200, json: async () => payload });
  }, value);
}
async function snapshot(page) {
  return page.evaluate(() => {
    const w = /** @type {any} */ (window);
    return {
      id: w.__ortbtoolsLast ? w.__ortbtoolsLast.req.id : null,
      history: JSON.parse(localStorage.getItem('ortbtools_history_v1') || '[]').length,
      disabled: /** @type {HTMLButtonElement} */ (document.getElementById('analyzeBtn')).disabled,
      spinner: !!document.querySelector('#analyzeBtn .spinner'),
      verdict: document.getElementById('verdict').hidden,
    };
  });
}

test(
  'browser: current analysis owns edits, clear, replacement, delayed Intel, remount and incomplete claims',
  { timeout: 120000, skip: browserSkipReason },
  async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-ui-'));
    let serverInfo;
    let browser;
    try {
      serverInfo = await startServer(await getFreePort(), dataDir);
      browser = await puppeteer.launch({
        headless: true,
        executablePath: chromeExecutable,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      const page = await browser.newPage();
      const applicationErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && message.text().startsWith('Analysis error:'))
          applicationErrors.push(message.text());
      });
      await page.setViewport({ width: 1280, height: 900 });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith(serverInfo.url) || /^(data:|about:)/.test(request.url()))
          request.continue();
        else request.abort();
      });
      await page.goto(serverInfo.url + '/inspector', { waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).runAnalysis) === 'function',
      );
      assert.equal(await page.$eval('[data-onboarding-anchor]', (el) => el.children.length), 1);
      await page.evaluate(() => {
        document.getElementById('verifyBanner').style.display = 'flex';
      });
      assert.equal(
        await page.$eval('.inspector-banners', (el) => el.getBoundingClientRect().height > 50),
        true,
      );
      await page.click('[data-action="dismiss-onboarding"]');
      assert.equal(await page.$('.kt-onboarding-banner'), null);
      assert.equal(
        await page.$eval('#toastContainer', (el) => el.getAttribute('aria-live')),
        'polite',
      );
      await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const nativeFetch = window.fetch.bind(window);
        w.pendingAnalyze = [];
        window.fetch = (url, opts) =>
          String(url).includes('/api/analyze')
            ? new Promise((resolve) => {
                w.pendingAnalyze.push(resolve);
              })
            : nativeFetch(url, opts);
      });
      // The stub deliberately ignores AbortSignal: identity must still defeat late completions.
      await put(page, req('A'));
      await begin(page);
      await put(page, req('edit-before-first-result'));
      await complete(page, result('A'));
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.deepEqual(await snapshot(page), {
        id: null,
        history: 0,
        disabled: false,
        spinner: false,
        verdict: true,
      });
      await begin(page);
      await page.evaluate(() => /** @type {any} */ (window).clearInput('bidReq'));
      await complete(page, result('cleared'));
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.equal((await snapshot(page)).history, 0);
      await put(page, req('old'));
      await begin(page);
      await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.oldPromise = w.analysisPromise;
      });
      await put(page, req('new'));
      await begin(page);
      await complete(page, result('old'));
      await page.evaluate(() => /** @type {any} */ (window).oldPromise);
      assert.equal(
        (await snapshot(page)).disabled,
        true,
        'stale finally does not unlock the newer run',
      );
      await complete(page, result('new'));
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.equal((await snapshot(page)).id, 'new');
      assert.equal((await snapshot(page)).history, 1);
      await put(page, req('intel'));
      await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        localStorage.setItem('ortbtools_dialect_v1', 'temp:synthetic');
        w.OrtbtoolsIntel = {
          applyToFindings: () =>
            new Promise((resolve) => {
              w.releaseIntel = resolve;
            }),
        };
      });
      await begin(page);
      await complete(page, result('intel'));
      await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).releaseIntel) === 'function',
      );
      await put(page, req('after-intel'));
      await page.evaluate(() => /** @type {any} */ (window).releaseIntel());
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.equal((await snapshot(page)).id, null);
      assert.equal((await snapshot(page)).history, 1);
      await page.evaluate(() => {
        localStorage.removeItem('ortbtools_dialect_v1');
      });
      await begin(page);
      await complete(
        page,
        result('incomplete', {
          status: 'warnings',
          completeness: { complete: false, failedFamilies: ['baseline'] },
        }),
      );
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.match(await page.$eval('#verdictHeadline', (el) => el.textContent), /incomplete/i);
      assert.match(await page.$eval('#tValidation', (el) => el.textContent), /incomplete/i);
      assert.doesNotMatch(await page.title(), /clean/);
      // An old mount cannot paint into a newly mounted inspector, even if the transport resolves.
      await put(page, req('unmounted'));
      await begin(page);
      await page.evaluate(async () => {
        const w = /** @type {any} */ (window);
        w.unmountedPromise = w.analysisPromise;
        const registryPath = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => /\/core\/registry\.js(?:\?|$)/.test(name));
        const registry = await import(registryPath);
        const root = document.getElementById('app-root');
        await registry.deactivate();
        await registry.activate('inspector', root);
      });
      await complete(page, result('unmounted'));
      await page.evaluate(() => /** @type {any} */ (window).unmountedPromise);
      assert.equal((await snapshot(page)).id, null);
      assert.equal((await snapshot(page)).disabled, false);
      assert.equal(await page.$('.kt-onboarding-banner'), null, 'dismissal survives remount');
      await put(page, req('programmatic-old'));
      await begin(page);
      await page.evaluate(() =>
        /** @type {any} */ (window)._vendorRef.pasteString(
          'bidReq',
          '{"id":"replacement","imp":[]}',
        ),
      );
      await complete(page, result('programmatic-old'));
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.equal(
        (await snapshot(page)).id,
        null,
        'programmatic replacements invalidate first-flight too',
      );

      await put(page, req('manual-format'));
      await begin(page);
      await page.evaluate(() => /** @type {any} */ (window).utils.format('bidReq'));
      await complete(page, result('manual-format'));
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.equal(
        (await snapshot(page)).id,
        null,
        'manual formatting establishes a new editor revision',
      );

      const req3 = {
        openrtb: {
          ver: '3.0',
          request: {
            id: 'context-3',
            cur: ['EUR'],
            context: { app: { name: 'Synthetic' }, device: { make: 'Apple', os: 'iOS' } },
            item: [
              {
                id: 'small',
                flr: 2,
                flrcur: 'EUR',
                spec: { placement: { display: { w: 300, h: 250 } } },
              },
              {
                id: 'wide',
                flr: 3,
                flrcur: 'EUR',
                spec: { placement: { display: { w: 728, h: 90 } } },
              },
              {
                id: 'audio-slot',
                spec: {
                  placement: { secure: 1, audio: { mime: ['audio/mp4'], mindur: 10, maxdur: 20 } },
                },
              },
            ],
          },
        },
      };
      await put(page, req3);
      await begin(page);
      /** @type {any} */
      const scoped = result('sides', {
        status: 'warnings',
        findings: [{ id: 'legacy-only', level: 'warning', msg: 'Legacy aggregate text' }],
      });
      scoped.sides = {
        request: {
          findings: [
            {
              id: 'request-structured',
              path: 'cur',
              level: 'warning',
              msg: '[response] Request meaning.',
              origin: { side: 'request', path: 'openrtb.request.cur' },
            },
            {
              id: 'unlocated-legacy',
              path: 'cur',
              level: 'warning',
              msg: '[response] Cosmetic only.',
            },
          ],
        },
        response: {
          findings: [
            {
              id: 'response-structured',
              path: 'cur',
              level: 'warning',
              msg: 'Response meaning.',
              location: { primary: { side: 'response' } },
            },
            {
              id: 'response-root',
              path: '',
              level: 'warning',
              msg: 'Unlocated response.',
              location: { primary: null },
            },
          ],
        },
      };
      await complete(page, scoped);
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.match(await page.$eval('#slotGrid', (el) => el.textContent), /728×90/);
      assert.match(await page.$eval('#slotGrid', (el) => el.textContent), /300×250/);
      const audioCard = await page.$$eval(
        '#slotGrid .slot-card',
        (cards) =>
          cards.find((card) => card.querySelector('.slot-id')?.textContent === 'audio-slot')
            ?.textContent || '',
      );
      assert.match(audioCard, /audio/);
      assert.match(audioCard, /audio\/mp4/);
      assert.match(audioCard, /secure/);

      assert.match(await page.$eval('#analysisStrip', (el) => el.textContent), /in-app.*Apple/);
      const findingCards = await page.$$eval('#tValidation details', (els) =>
        els.map((el) => ({
          text: el.textContent,
          side: el.getAttribute('data-finding-side'),
          badge: el.querySelector('.finding-side')?.textContent || '',
        })),
      );
      assert.equal(
        findingCards.find((item) => item.text.includes('Request meaning')).side,
        'request',
      );
      assert.match(
        findingCards.find((item) => item.text.includes('Request meaning')).badge,
        /request/i,
      );
      assert.equal(
        findingCards.find((item) => item.text.includes('Response meaning')).side,
        'response',
      );
      assert.match(
        findingCards.find((item) => item.text.includes('Cosmetic only')).badge,
        /request/i,
      );
      assert.match(
        findingCards.find((item) => item.text.includes('Unlocated response')).badge,
        /response/i,
      );
      await page.evaluate(() => {
        const detail = [...document.querySelectorAll('#tValidation details')].find((el) =>
          el.textContent.includes('Request meaning'),
        );
        detail.setAttribute('open', '');
      });
      await page.waitForFunction(() =>
        [...document.querySelectorAll('#tValidation details')]
          .find((el) => el.textContent.includes('Request meaning'))
          .querySelector('.finding-detail-value'),
      );
      assert.match(
        await page.$$eval('#tValidation .finding-detail-value', (els) =>
          els.map((el) => el.textContent).join(' '),
        ),
        /EUR/,
      );
      assert.equal(
        findingCards.some((item) => item.text.includes('Legacy aggregate text')),
        false,
        'side results drive current rendering',
      );

      await put(page, req('legacy-flat'));
      await begin(page);
      await complete(
        page,
        result('legacy-flat', {
          status: 'warnings',
          findings: [
            {
              id: 'legacy-unlocated',
              level: 'warning',
              path: 'cur',
              msg: '[response] Cosmetic only.',
            },
          ],
        }),
      );
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.equal(
        await page.$('#tValidation .finding-side'),
        null,
        'legacy flat-only text does not declare an authoritative side',
      );

      // A failed result belongs to its input revision just as a successful one does.
      const beforeFailureHistory = (await snapshot(page)).history;
      await put(page, req('will-fail'));
      await begin(page);
      await complete(page, { success: false, error: 'Synthetic analysis failure' });
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.match(
        await page.$eval('#tValidation', (el) => el.textContent),
        /Synthetic analysis failure/,
      );
      assert.equal((await snapshot(page)).id, null);
      await put(page, req('edited-after-failure'));
      assert.deepEqual(await snapshot(page), {
        id: null,
        history: beforeFailureHistory,
        disabled: false,
        spinner: false,
        verdict: true,
      });
      for (const panel of ['tValidation', 'tCross', 'tBehavior', 'slotGrid']) {
        assert.doesNotMatch(
          await page.$eval('#' + panel, (el) => el.textContent),
          /Synthetic analysis failure/,
        );
      }
      assert.equal(
        await page.$eval('#app-root', (el) => el.getAttribute('data-analysis-state')),
        'idle',
      );
      assert.equal(await page.$eval('#validationBadge', (el) => el.textContent), '');

      await put(page, req('network-rejection'));
      const networkErrorStart = applicationErrors.length;
      await page.evaluate(async () => {
        const w = /** @type {any} */ (window);
        const originalFetch = window.fetch;
        window.fetch = (url, opts) =>
          String(url).includes('/api/analyze')
            ? Promise.reject(new TypeError('Failed to fetch'))
            : originalFetch(url, opts);
        try {
          await w.runAnalysis();
        } finally {
          window.fetch = originalFetch;
        }
      });
      assert.match(await page.$eval('#tValidation', (el) => el.textContent), /backend unreachable/);
      assert.equal(
        applicationErrors.length,
        networkErrorStart,
        'an expected transport rejection is handled at the network boundary',
      );
      assert.deepEqual(await snapshot(page), {
        id: null,
        history: beforeFailureHistory,
        disabled: false,
        spinner: false,
        verdict: true,
      });
      await put(page, req('unexpected-processing-error'));
      await begin(page);
      await complete(page, result('unexpected-processing-error', { findings: [null] }));
      await page.evaluate(() => /** @type {any} */ (window).analysisPromise);
      assert.equal(
        applicationErrors.length,
        networkErrorStart + 1,
        'an unrelated processing exception retains its diagnostic',
      );
      assert.match(applicationErrors.at(-1), /^Analysis error: TypeError:/);

      for (const locale of ['en', 'uk', 'ru']) {
        const localized = await browser.newPage();
        await localized.setViewport({ width: 390, height: 844 });
        await localized.setRequestInterception(true);
        localized.on('request', (request) =>
          request.url().startsWith(serverInfo.url) || /^(data:|about:)/.test(request.url())
            ? request.continue()
            : request.abort(),
        );
        await localized.evaluateOnNewDocument(() => {
          localStorage.removeItem('themis.inspectorOnboardingDismissed');
        });
        await localized.goto(
          serverInfo.url + (locale === 'en' ? '' : '/' + locale) + '/inspector',
          { waitUntil: 'networkidle2' },
        );
        await localized.waitForSelector('.kt-onboarding-banner');
        const banner = await localized.$eval('.kt-onboarding-banner', (el) => {
          const rect = el.getBoundingClientRect();
          return { right: rect.right, width: rect.width, text: el.textContent };
        });
        assert.ok(banner.right <= 391 && banner.width > 0, locale + ' banner fits mobile viewport');
        assert.doesNotMatch(banner.text, /onboarding\.banner/);
        await localized.evaluate(async () => {
          const utilsPath = '/core/utils.js';
          const { toast } = await import(utilsPath);
          toast(
            /** @type {any} */ (window).t('toast.nothing_to_analyze') + ' <img src=x>',
            'error',
          );
        });
        assert.equal(
          await localized.$eval('#toastContainer', (el) => el.getAttribute('role')),
          'status',
        );
        assert.equal(await localized.$('#toastContainer img'), null);
        assert.doesNotMatch(
          await localized.$eval('#toastContainer', (el) => el.textContent),
          /toast\.nothing/,
        );
        const countDialogs = [];
        localized.on('dialog', async (dialog) => {
          countDialogs.push(dialog.message());
          await dialog.dismiss();
        });
        const expectedCountError = await localized.evaluate(async () => {
          const modulePath = '/modules/partners/index.js';
          const { deletePartner } = await import(modulePath);
          const originalFetch = window.fetch;
          window.fetch = (url, opts) =>
            String(url).endsWith('/samples-count')
              ? Promise.resolve(
                  new Response('{malformed', {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                  }),
                )
              : originalFetch(url, opts);
          try {
            await deletePartner(123);
          } finally {
            window.fetch = originalFetch;
          }
          return /** @type {any} */ (window).t('toast.partner_count_failed');
        });
        assert.equal(countDialogs.length, 1);
        assert.ok(
          countDialogs[0].includes(expectedCountError),
          locale + ' confirmation discloses unavailable count',
        );
        assert.doesNotMatch(expectedCountError, /toast\.partner/);
        assert.ok(
          (await localized.$eval('#toastContainer', (el) => el.textContent)).includes(
            expectedCountError,
          ),
          locale + ' malformed count JSON has visible error feedback',
        );
        await localized.close();
      }
    } finally {
      if (browser) await browser.close();
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
