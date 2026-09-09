/* global document, window, location */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startIsolatedApp } = require('./isolated-browser-app');
const { prepareSavedFixtures } = require('./saved-history-fixtures');
const { browserSkipReason, launchBrowser, openInspector } = require('./corpus/lib/browser');
const { setPayload, analyze } = require('./corpus/lib/browser');
const { loadCorpus } = require('./corpus/lib/load');
const historyCases = require('../specs/033-close-remaining-questions/matrix-manifest.json')
  .history_cases.ids;

test(
  'browser-light: saved handoff rejects invalid, missing, foreign and malformed saved records',
  { skip: browserSkipReason, timeout: 90000 },
  async () => {
    const app = await startIsolatedApp();
    const browser = await launchBrowser();
    try {
      const { page, pageErrors } = await openInspector(browser, app.url);
      const owner = await prepareSavedFixtures(page, 'handoff-owner');
      await page.evaluate(() => /** @type {any} */ (window).signOut());
      const other = await prepareSavedFixtures(page, 'handoff-other');
      const requests = [];
      const responses = [];
      let malformed = false;
      page.removeAllListeners('request');
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (/^\/api\/samples\//.test(path)) {
          requests.push(path);
          if (malformed)
            return request.respond({
              status: 200,
              contentType: 'application/json',
              body: '{"sample":{"id":1,"bid_req":17}}',
            });
        }
        return request.continue();
      });
      page.on('response', (response) => {
        if (/\/api\/samples\//.test(response.url())) responses.push(response.status());
      });
      for (const query of [
        'saved=bad',
        'saved=01',
        'saved=9007199254740992',
        'saved=1&saved=2',
        `saved=${other.legacyId}&sample=clean-banner`,
      ]) {
        const before = requests.length;
        await page.goto(app.url + '/inspector?' + query, { waitUntil: 'networkidle2' });
        await page.waitForFunction(
          () =>
            !new URL(location.href).searchParams.has('saved') &&
            !!document.getElementById('bidReq'),
        );
        assert.equal(requests.length, before, query + ' must not fetch a coerced ID');
        assert.equal(
          await page.$eval('#bidReq', (el) => /** @type {HTMLTextAreaElement} */ (el).value),
          '',
        );
      }
      for (const id of [owner.legacyId, 999999]) {
        await page.goto(app.url + '/inspector?saved=' + id, { waitUntil: 'networkidle2' });
        await page.waitForFunction(() => !!document.querySelector('#toastContainer .toast'));
        assert.equal(responses.at(-1), 404);
        assert.equal(
          await page.$eval('#bidReq', (el) => /** @type {HTMLTextAreaElement} */ (el).value),
          '',
        );
        assert.equal(
          await page.$eval('#bidRes', (el) => /** @type {HTMLTextAreaElement} */ (el).value),
          '',
        );
        assert.equal(
          await page.evaluate(() => /** @type {any} */ (window).OrtbtoolsSession.currentSampleId),
          null,
        );
        assert.equal(
          await page.$eval('#toastContainer', (el) => el.textContent.includes('Loaded ·')),
          false,
        );
      }
      malformed = true;
      await page.goto(app.url + '/inspector?saved=' + other.legacyId, {
        waitUntil: 'networkidle2',
      });
      await page.waitForFunction(() => !!document.querySelector('#toastContainer .toast'));
      assert.equal(
        await page.$eval('#bidReq', (el) => /** @type {HTMLTextAreaElement} */ (el).value),
        '',
      );
      assert.equal(
        await page.$eval('#toastContainer', (el) => el.textContent.includes('Loaded ·')),
        false,
      );
      assert.deepEqual(pageErrors, []);
    } finally {
      await browser.close();
      await app.stop();
    }
  },
);

test(
  'browser-light: saved handoff discards delayed loads after typing, account change and locked logout',
  { skip: browserSkipReason, timeout: 90000 },
  async () => {
    const app = await startIsolatedApp();
    const browser = await launchBrowser();
    try {
      const { page, pageErrors } = await openInspector(browser, app.url);
      let fixture = await prepareSavedFixtures(page, 'handoff-race');
      page.removeAllListeners('request');
      await page.setRequestInterception(false);
      for (const change of ['typing', 'clear', 'account']) {
        const sample = await page.evaluate(
          (id) => /** @type {any} */ (window).OrtbtoolsSession.api('GET', 'api/samples/' + id),
          fixture.legacyId,
        );
        let release = () => {};
        const held = new Promise((resolve) => {
          release = () => resolve(null);
        });
        let seen = () => {};
        const started = new Promise((resolve) => {
          seen = () => resolve(null);
        });
        await page.setRequestInterception(true);
        const intercept = async (request) => {
          if (new URL(request.url()).pathname === '/api/samples/' + fixture.legacyId) {
            seen();
            await held;
            return request.respond({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(sample),
            });
          }
          return request.continue();
        };
        page.on('request', intercept);
        await page.goto(app.url + '/inspector?saved=' + fixture.legacyId, {
          waitUntil: 'domcontentloaded',
        });
        await started;
        if (change === 'account') {
          await page.evaluate(() => /** @type {any} */ (window).signOut());
          fixture = await prepareSavedFixtures(page, 'handoff-new-account');
        }
        if (change === 'clear') {
          await page.click('[data-action="clear-input"][data-target="bidReq"]');
        } else
          await page.evaluate((change) => {
            const req = /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq'));
            const res = /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes'));
            req.value = 'Preserve new ' + change;
            res.value = 'Preserve response ' + change;
            req.dispatchEvent(new Event('input', { bubbles: true }));
          }, change);
        release();
        await page.waitForNetworkIdle({ idleTime: 100 });
        assert.equal(
          await page.$eval('#bidReq', (el) => /** @type {HTMLTextAreaElement} */ (el).value),
          change === 'clear' ? '' : 'Preserve new ' + change,
        );
        assert.equal(
          await page.$eval('#bidRes', (el) => /** @type {HTMLTextAreaElement} */ (el).value),
          change === 'clear' ? '' : 'Preserve response ' + change,
        );
        assert.equal(
          await page.evaluate(() => /** @type {any} */ (window).OrtbtoolsSession.currentSampleId),
          null,
        );
        page.off('request', intercept);
        await page.setRequestInterception(false);
      }
      await page.evaluate(() => /** @type {any} */ (window).OrtbtoolsSession.clearDEK());
      await page.goto(app.url + '/inspector?saved=' + fixture.encryptedId, {
        waitUntil: 'networkidle2',
      });
      await page.waitForSelector('#unlockPwInput');
      await page.evaluate(() => /** @type {any} */ (window).signOut());
      assert.equal(new URL(page.url()).searchParams.has('saved'), false);
      await prepareSavedFixtures(page, 'handoff-after-locked-logout');
      await page.evaluate(() => /** @type {any} */ (window).OrtbtoolsSession.refreshSamples());
      assert.equal(
        await page.$eval('#bidReq', (el) => /** @type {HTMLTextAreaElement} */ (el).value),
        '',
      );
      assert.equal(
        await page.evaluate(() => /** @type {any} */ (window).OrtbtoolsSession.currentSampleId),
        null,
      );
      assert.deepEqual(pageErrors, []);
    } finally {
      await browser.close();
      await app.stop();
    }
  },
);

for (const locale of /** @type {const} */ (['en', 'uk', 'ru']))
  test(
    `browser-light: saved library handoff survives locked reload and loads exact encrypted and legacy bodies (${locale})`,
    { skip: browserSkipReason, timeout: 90000 },
    async () => {
      const app = await startIsolatedApp();
      const browser = await launchBrowser();
      try {
        const { page, pageErrors } = await openInspector(browser, app.url, { locale });
        const fixture = await prepareSavedFixtures(page, `handoff-${locale}`);
        const prefix = locale === 'en' ? '' : '/' + locale;
        await page.evaluate(() => /** @type {any} */ (window).OrtbtoolsSession.clearDEK());
        await page.goto(app.url + prefix + '/library', { waitUntil: 'networkidle2' });
        await page.click('[data-scope="saved"]');
        await page.waitForSelector(`[data-row][data-id="${fixture.encryptedId}"] a`);
        await page.click(`[data-row][data-id="${fixture.encryptedId}"] a`);
        await page.waitForFunction(() => location.pathname.endsWith('/inspector'));
        await page.waitForSelector('#unlockPwInput');
        const title = {
          en: 'unlock library',
          uk: 'розблокувати бібліотеку',
          ru: 'разблокировать библиотеку',
        }[locale];
        const subtitle = {
          en: 'enter your password to decrypt saved samples',
          uk: 'введи пароль щоб розшифрувати збережені запити',
          ru: 'введи пароль чтобы расшифровать сохранённые запросы',
        }[locale];
        assert.equal(await page.$eval('#unlockForm .modal-title', (el) => el.textContent), title);
        assert.ok(
          await page.$eval('#unlockForm', (el, text) => el.textContent.includes(text), subtitle),
        );
        assert.equal(new URL(page.url()).searchParams.get('saved'), String(fixture.encryptedId));
        await page.reload({ waitUntil: 'networkidle2' });
        await page.waitForSelector('#unlockPwInput');
        await page.type('#unlockPwInput', require('./saved-history-fixtures').PASSWORD);
        await page.click('#unlockForm button[type="submit"]');
        await page.waitForFunction(
          (f) =>
            /** @type {any} */ (window).OrtbtoolsSession.currentSampleId === f.encryptedId &&
            /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value ===
              f.req &&
            /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value === '',
          {},
          fixture,
        );
        assert.equal(new URL(page.url()).searchParams.has('saved'), false);
        await page.reload({ waitUntil: 'networkidle2' });
        await page.waitForSelector('#bidReq');
        assert.equal(
          await page.$eval('#bidReq', (el) => /** @type {HTMLTextAreaElement} */ (el).value),
          '',
        );
        await page.goto(app.url + prefix + '/library', { waitUntil: 'networkidle2' });
        await page.click('[data-scope="saved"]');
        await page.waitForSelector(`[data-row][data-id="${fixture.legacyId}"] a`);
        await page.click(`[data-row][data-id="${fixture.legacyId}"] a`);
        await page.waitForFunction(
          (f) =>
            /** @type {any} */ (window).OrtbtoolsSession.currentSampleId === f.legacyId &&
            /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value ===
              f.legacyReq &&
            /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value ===
              f.legacyRes,
          {},
          fixture,
        );
        assert.equal(new URL(page.url()).searchParams.has('saved'), false);
        assert.deepEqual(pageErrors, []);
      } finally {
        await browser.close();
        await app.stop();
      }
    },
  );

test(
  'browser-light: history ring, corpus dimensions, reload, two tabs, quota and server-record isolation',
  { skip: browserSkipReason, timeout: 120000 },
  async () => {
    const app = await startIsolatedApp();
    const browser = await launchBrowser();
    try {
      const { page, pageErrors } = await openInspector(browser, app.url);
      page.on('dialog', async (dialog) => {
        if (dialog.type() === 'beforeunload') await dialog.accept();
      });
      const fixture = await prepareSavedFixtures(page, 'history');
      await page.evaluate((req) => {
        localStorage.setItem(
          'ortbtools_history_v1',
          JSON.stringify(
            Array.from({ length: 53 }, (_, i) => ({
              ts: 1700000000000 + i,
              req,
              res: '',
              title: `Synthetic history ${i}`,
              status: 'clean',
            })),
          ),
        );
      }, fixture.req);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForFunction(() => /** @type {any} */ (window).historyStore?.length === 50);
      const corpus = loadCorpus();
      for (const id of historyCases) {
        const item = corpus.all.find((entry) => entry.id === id);
        assert.ok(item, id);
        await setPayload(page, item);
        assert.equal(await analyze(page), 'success', id);
        const stored = await page.evaluate(() => ({
          first: /** @type {any} */ (window).historyStore[0],
          count: /** @type {any} */ (window).historyStore.length,
        }));
        assert.equal(stored.count, 50, id);
        if (typeof item.request === 'string') assert.equal(stored.first.req, item.request, id);
        else if (item.request !== undefined)
          assert.deepEqual(JSON.parse(stored.first.req), item.request, id);
        if (item.response !== undefined)
          assert.deepEqual(JSON.parse(stored.first.res), item.response, id);
      }
      const latest = await page.evaluate(() => /** @type {any} */ (window).historyStore[0]);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForFunction(() => /** @type {any} */ (window).historyStore?.length === 50);
      assert.deepEqual(
        await page.evaluate(() => /** @type {any} */ (window).historyStore[0]),
        latest,
      );
      const other = (await openInspector(browser, app.url)).page;
      await page.bringToFront();
      await page.click('[data-action="toggle-sidebar"][data-side="left"]');
      await page.click('[data-action="history-delete"][data-idx="0"]');
      await other.waitForFunction(() => /** @type {any} */ (window).historyStore.length === 49);
      // Simulate a real quota exception at the browser Storage boundary.
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        /** @type {any} */ (window).__restore033Storage = () => {
          Storage.prototype.setItem = original;
        };
        Storage.prototype.setItem = function (key, value) {
          if (key === 'ortbtools_history_v1')
            throw new DOMException('Synthetic full storage', 'QuotaExceededError');
          return original.call(this, key, value);
        };
      });
      await setPayload(
        page,
        corpus.all.find((entry) => entry.id === historyCases[0]),
      );
      assert.equal(await analyze(page), 'success', 'quota analysis');
      const afterQuota = await page.evaluate(() => ({
        memory: /** @type {any} */ (window).historyStore.length,
        rendered: document.querySelectorAll('#hList .history-item').length,
      }));
      assert.deepEqual(afterQuota, { memory: 25, rendered: 25 });
      await page.evaluate(() => /** @type {any} */ (window).__restore033Storage());
      page.once('dialog', (dialog) => dialog.accept());
      await page.click('[data-action="clear-history"]');
      await other.waitForFunction(() => /** @type {any} */ (window).historyStore.length === 0);
      const saved = await page.evaluate(() =>
        /** @type {any} */ (window).OrtbtoolsSession.api('GET', 'api/samples'),
      );
      assert.equal(saved.samples.length, 2);
      assert.ok(saved.samples.some((entry) => entry.id === fixture.encryptedId));
      assert.deepEqual(pageErrors, []);
    } finally {
      await browser.close();
      await app.stop();
    }
  },
);

test(
  'browser-light: failed saved-library fetch offers retry instead of claiming encryption is locked',
  { skip: browserSkipReason, timeout: 60000 },
  async () => {
    const app = await startIsolatedApp();
    const browser = await launchBrowser();
    try {
      const { page } = await openInspector(browser, app.url);
      const fixture = await prepareSavedFixtures(page, 'failure');
      await page.close();
      const library = await browser.newPage();
      let fail = true;
      await library.setRequestInterception(true);
      library.on('request', (req) => {
        if (new URL(req.url()).pathname === '/api/samples' && fail) {
          return req.respond({
            status: 503,
            contentType: 'application/json',
            body: '{"success":false,"code":"synthetic_failure"}',
          });
        }
        return req.continue();
      });
      await library.goto(app.url + '/library', { waitUntil: 'networkidle2' });
      await library.click('[data-scope="saved"]');
      await library.waitForSelector('[data-action="retry-saved"]', { timeout: 3000 });
      assert.ok(!(await library.$eval('[data-body]', (el) => el.textContent)).includes('Unlock'));
      fail = false;
      await library.click('[data-action="retry-saved"]');
      await library.waitForSelector(`[data-row][data-id="${fixture.encryptedId}"]`);
      assert.equal(await library.$$eval('[data-row]', (rows) => rows.length), 2);
      assert.equal(await library.$eval('[data-body]', (el) => !!el.querySelector('img')), false);
      await library.select('[data-facet]', String(fixture.partnerId));
      assert.equal(await library.$$eval('[data-row]', (rows) => rows.length), 1);
      await library.click(`[data-row][data-id="${fixture.encryptedId}"] a`);
      await library.waitForSelector('#unlockPwInput');
      await library.type('#unlockPwInput', require('./saved-history-fixtures').PASSWORD);
      await library.click('#unlockForm button[type="submit"]');
      await library.waitForFunction(
        (f) =>
          /** @type {any} */ (window).OrtbtoolsSession.currentSampleId === f.encryptedId &&
          /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value === f.req &&
          /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value === '',
        {},
        fixture,
      );
      await library.goto(app.url + '/library', { waitUntil: 'networkidle2' });
      await library.click('[data-scope="saved"]');
      await library.waitForSelector(`[data-row][data-id="${fixture.encryptedId}"]`);
      await library.evaluate(() => /** @type {any} */ (window).signOut());
      await library.waitForFunction(() => document.querySelectorAll('[data-row]').length === 0, {
        timeout: 3000,
      });
    } finally {
      await browser.close();
      await app.stop();
    }
  },
);

for (const locale of /** @type {const} */ (['en', 'uk', 'ru']))
  test(
    `browser-light: saved drawer locked/unlocked, legacy, filter, load, edit, delete and account isolation (${locale})`,
    { skip: browserSkipReason, timeout: 120000 },
    async () => {
      const app = await startIsolatedApp();
      const browser = await launchBrowser();
      try {
        const { page, pageErrors } = await openInspector(browser, app.url, {
          locale,
          viewport: { width: 1366, height: 768 },
        });
        const fixture = await prepareSavedFixtures(page, `drawer-${locale}`);
        await page.evaluate(async () => {
          const s = /** @type {any} */ (window).OrtbtoolsSession;
          await s.refreshPartners();
          await s.refreshSamples();
          s.clearDEK();
        });
        await page.reload({ waitUntil: 'networkidle2' });
        if (
          (await page.$eval('#toggleSidebarLeft', (el) => el.getAttribute('aria-expanded'))) !==
          'true'
        )
          await page.click('#toggleSidebarLeft');
        await page.waitForSelector('#savedList [data-action="open-unlock"]');
        await page.waitForFunction(() => {
          const r = document
            .querySelector('#savedList [data-action="open-unlock"]')
            ?.getBoundingClientRect();
          return r && r.width > 0 && r.left >= 0 && r.right <= window.innerWidth;
        });
        assert.equal(await page.$$eval('#savedList .saved-item', (rows) => rows.length), 0);
        await page.click('#savedList [data-action="open-unlock"]');
        await page.waitForSelector('#unlockPwInput');
        await page.type('#unlockPwInput', require('./saved-history-fixtures').PASSWORD);
        await page.click('#unlockForm button[type="submit"]');
        await page.waitForSelector(`[data-action="sample-load"][data-id="${fixture.encryptedId}"]`);
        assert.equal(await page.$$eval('#savedList .saved-item', (rows) => rows.length), 2);
        assert.equal(await page.$eval('#savedList', (el) => !!el.querySelector('img')), false);
        await page.select('#partnerFilter', String(fixture.partnerId));
        await page.waitForFunction(
          () => document.querySelectorAll('#savedList .saved-item').length === 1,
        );
        await page.click(`[data-action="sample-load"][data-id="${fixture.encryptedId}"]`);
        await page.waitForFunction(
          ({ id, req }) =>
            /** @type {any} */ (window).OrtbtoolsSession.currentSampleId === id &&
            /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value === req &&
            /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value === '',
          {},
          { id: fixture.encryptedId, req: fixture.req },
        );
        await page.click(`[data-action="sample-edit"][data-id="${fixture.encryptedId}"]`);
        await page.waitForSelector('#mTitle');
        await page.$eval('#mTitle', (el) => {
          /** @type {HTMLInputElement} */ (el).value = '';
        });
        await page.type('#mTitle', `Edited ${locale} <b>literal</b>`);
        await page.click('[data-action="confirm-edit"]');
        await page.waitForFunction(() => !document.getElementById('mTitle'));
        await page.waitForFunction(
          (text) => document.querySelector('#savedList')?.textContent.includes(text),
          {},
          `Edited ${locale} <b>literal</b>`,
        );
        await page.select('#partnerFilter', 'unassigned');
        await page.waitForSelector(`[data-action="sample-load"][data-id="${fixture.legacyId}"]`);
        assert.equal(await page.$$eval('#savedList .saved-item', (rows) => rows.length), 1);
        await page.click(`[data-action="sample-load"][data-id="${fixture.legacyId}"]`);
        await page.waitForFunction(
          ({ id, req, res }) =>
            /** @type {any} */ (window).OrtbtoolsSession.currentSampleId === id &&
            /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value === req &&
            /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value === res,
          { timeout: 5000 },
          { id: fixture.legacyId, req: fixture.legacyReq, res: fixture.legacyRes },
        );
        assert.deepEqual(
          await page.evaluate(() => ({
            req: /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value,
            res: /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value,
          })),
          { req: fixture.legacyReq, res: fixture.legacyRes },
          'both plaintext legacy bodies replace the previously loaded encrypted request',
        );
        page.once('dialog', (dialog) => dialog.accept());
        await page.click(`[data-action="sample-delete"][data-id="${fixture.legacyId}"]`);
        await page.waitForFunction(
          () => document.querySelectorAll('#savedList .saved-item').length === 0,
        );
        assert.equal(
          await page.$eval('#libraryWrap', (el) => /** @type {HTMLElement} */ (el).hidden),
          false,
          'empty active filter stays usable',
        );
        await page.select('#partnerFilter', '');
        await page.waitForSelector(`[data-action="sample-load"][data-id="${fixture.encryptedId}"]`);
        await page.evaluate(() => /** @type {any} */ (window).signOut());
        assert.equal(await page.$$eval('#savedList .saved-item', (rows) => rows.length), 0);
        const other = await prepareSavedFixtures(page, `other-${locale}`);
        await page.evaluate(() => /** @type {any} */ (window).OrtbtoolsSession.refreshSamples());
        await page.waitForSelector(`[data-action="sample-load"][data-id="${other.encryptedId}"]`);
        assert.equal(
          await page.$(`[data-action="sample-load"][data-id="${fixture.encryptedId}"]`),
          null,
        );
        const denied = await page.evaluate(async (id) => {
          try {
            await /** @type {any} */ (window).OrtbtoolsSession.api('GET', 'api/samples/' + id);
            return 200;
          } catch (e) {
            return e.status;
          }
        }, fixture.encryptedId);
        assert.equal(denied, 404);
        for (const [id, remaining] of [
          [other.encryptedId, 1],
          [other.legacyId, 0],
        ]) {
          page.once('dialog', (dialog) => dialog.accept());
          await page.click(`[data-action="sample-delete"][data-id="${id}"]`);
          await page.waitForFunction(
            (count) => document.querySelectorAll('#savedList .saved-item').length === count,
            {},
            remaining,
          );
        }
        assert.equal(
          await page.$eval('#libraryWrap', (el) => /** @type {HTMLElement} */ (el).hidden),
          true,
        );
        await page.goto(app.url + (locale === 'en' ? '' : '/' + locale) + '/library', {
          waitUntil: 'networkidle2',
        });
        await page.click('[data-scope="saved"]');
        await page.waitForFunction(() => document.querySelector('[data-body] .lib-note') !== null);
        assert.equal(await page.$$eval('[data-row]', (rows) => rows.length), 0);
        assert.deepEqual(pageErrors, []);
        await page.close();
      } finally {
        await browser.close();
        await app.stop();
      }
    },
  );
