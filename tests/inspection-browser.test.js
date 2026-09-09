/* global document, getComputedStyle, innerHeight, requestAnimationFrame, window */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startIsolatedApp } = require('./isolated-browser-app');
const { browserSkipReason, launchBrowser, openInspector } = require('./corpus/lib/browser');

test(
  'browser-light: actual SChain inspection and declared-route analysis work in all locales',
  { skip: browserSkipReason, timeout: 120000 },
  async () => {
    const app = await startIsolatedApp();
    const browser = await launchBrowser();
    try {
      for (const locale of /** @type {const} */ (['en', 'uk', 'ru'])) {
        const { page, pageErrors: errors } = await openInspector(browser, app.url, {
          locale,
          viewport: { width: 1366, height: 768 },
        });
        await page.click('.kt-tools-menu summary');
        await page.click('[data-action="inspect-schain"]');
        await page.waitForSelector('.inspection-dialog[role="dialog"]');
        await page.waitForFunction(
          () => document.querySelector('#inspectionRoute').children.length > 1,
        );
        await page.$eval('#inspectionInput', (el) => {
          el.value = '1.0,1!seller.example,seller-A,1';
        });
        await page.click('#inspectionRun');
        await page.waitForFunction(() => document.querySelector('#inspectionResult a'));
        const copy = await page.$eval('#inspectionResult', (el) => el.textContent);
        assert.ok(copy.includes('1'), copy);
        assert.ok(
          copy.includes(locale === 'en' ? 'Valid' : locale === 'uk' ? 'Валідний' : 'Валидна'),
          copy,
        );
        assert.ok(
          copy.includes(
            locale === 'en'
              ? 'Serialized chain'
              : locale === 'uk'
                ? 'Серіалізований ланцюжок'
                : 'Сериализованная цепочка',
          ),
          copy,
        );
        await page.click('#inspectionSenderEnabled');
        await page.type('#inspectionAsi', 'other.example');
        await page.type('#inspectionSid', 'seller-B');
        await page.click('#inspectionRun');
        await page.waitForFunction(() =>
          document.querySelector('#inspectionResult').textContent.includes('other.example'),
        );
        const routeValue = await page.$eval(
          '#inspectionRoute',
          (el) => Array.from(el.options).find((o) => o.textContent.startsWith('logan ')).value,
        );
        await page.select('#inspectionRoute', routeValue);
        await page.click('#inspectionApply');
        await page.waitForFunction(() => !document.querySelector('.inspection-dialog'));
        await page.$eval('#bidReq', (el) => {
          el.value = JSON.stringify({
            id: 'synthetic-route',
            site: { domain: 'example.test' },
            imp: [{ id: 'i1', banner: { w: 300, h: 250 } }],
          });
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const response = page.waitForResponse(
          (r) => new URL(r.url()).pathname === '/api/analyze' && r.request().method() === 'POST',
        );
        await page.click('#analyzeBtn');
        const analyzed = await (await response).json();
        assert.equal(analyzed.inspection.route.provenance, 'declared');
        assert.equal(analyzed.inspection.route.profile.adapterId, 'logan');
        assert.equal(analyzed.inspection.schain.comparison.status, 'unknown');
        await page.click('.kt-tools-menu summary');
        await page.click('[data-action="inspect-schain"]');
        await page.waitForSelector('#inspectionRouteResult a');
        const overflow = await page.$eval('.inspection-dialog', (el) => ({
          width: el.scrollWidth - el.clientWidth,
          h: el.getBoundingClientRect().height,
          max: innerHeight,
          bg: getComputedStyle(el).backgroundColor,
        }));
        assert.ok(overflow.width <= 1, JSON.stringify(overflow));
        assert.ok(overflow.h < overflow.max, JSON.stringify(overflow));
        assert.notEqual(overflow.bg, 'rgba(0, 0, 0, 0)');
        // Sender-only analysis must finish with an actual comparison. A route
        // result cannot stand in for, or hide, that independently declared input.
        await page.waitForFunction(
          () => document.querySelector('#inspectionRoute').children.length > 1,
        );
        await page.select('#inspectionRoute', '');
        await page.click('#inspectionApply');
        await page.$eval('#bidReq', (el) => {
          el.value = JSON.stringify({
            id: 'synthetic-sender-and-conditional-route',
            site: { domain: 'example.test' },
            source: {
              ext: {
                schain: {
                  ver: '1.0',
                  complete: 1,
                  nodes: [{ asi: 'other.example', sid: 'seller-B', hp: 1 }],
                },
              },
            },
            imp: [{ id: 'i1', audio: { mimes: ['audio/mpeg'] }, banner: { w: 300, h: 250 } }],
          });
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const senderResponse = page.waitForResponse(
          (r) => new URL(r.url()).pathname === '/api/analyze' && r.request().method() === 'POST',
        );
        await page.click('#analyzeBtn');
        const senderAnalyzed = await (await senderResponse).json();
        assert.equal(senderAnalyzed.inspection.schain.comparison.status, 'match');
        assert.equal(senderAnalyzed.inspection.route, undefined);
        const comparison =
          locale === 'en'
            ? 'Declared sender comparison: Match'
            : locale === 'uk'
              ? 'Порівняння із заявленим відправником: Збігається'
              : 'Сравнение с заявленным отправителем: Совпадает';
        await page.waitForFunction(
          (expected) =>
            document.querySelector('#inspectionContextSummary').textContent === expected,
          {},
          comparison,
        );
        await page.click('.kt-tools-menu summary');
        await page.click('[data-action="inspect-schain"]');
        await page.waitForFunction(
          () => document.querySelector('#inspectionRoute').children.length > 1,
        );
        assert.equal(
          await page.$eval('#inspectionRouteResult', (el) => el.textContent),
          comparison,
        );
        const conditionalRouteValue = await page.$eval(
          '#inspectionRoute',
          (el) => Array.from(el.options).find((o) => o.textContent.startsWith('huaweiads ')).value,
        );
        await page.select('#inspectionRoute', conditionalRouteValue);
        await page.click('#inspectionApply');
        const conditionalResponse = page.waitForResponse(
          (r) => new URL(r.url()).pathname === '/api/analyze' && r.request().method() === 'POST',
        );
        await page.click('#analyzeBtn');
        const conditionalAnalyzed = await (await conditionalResponse).json();
        const audioStatement = conditionalAnalyzed.inspection.route.statements.find(
          (s) => s.field === 'imp.audio',
        );
        assert.equal(audioStatement.applicability, 'present');
        assert.ok(audioStatement.detail.length > 30);
        await page.click('.kt-tools-menu summary');
        await page.click('[data-action="inspect-schain"]');
        await page.waitForSelector('#inspectionRouteResult a');
        const routeCopy = await page.$eval('#inspectionRouteResult', (el) => el.textContent);
        assert.ok(routeCopy.includes(audioStatement.detail), routeCopy);
        assert.ok(routeCopy.includes(comparison), routeCopy);
        // Re-applying the same declarations preserves the completed result.
        await page.waitForFunction(
          () => document.querySelector('#inspectionRoute').children.length > 1,
        );
        await page.click('#inspectionApply');
        assert.ok(
          (await page.$eval('#inspectionContextSummary', (el) => el.textContent)).includes(
            comparison,
          ),
        );
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
      await app.stop();
    }
  },
);

test(
  'browser-light: edited inspection input and changed declared context reject held old responses',
  { skip: browserSkipReason, timeout: 60000 },
  async () => {
    const app = await startIsolatedApp();
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.setViewport({ width: 1366, height: 768 });
      let held = null;
      /** @type {Record<string, any> | null} */
      let lastAnalyzeBody = null;
      await page.setRequestInterception(true);
      page.on('request', async (request) => {
        if (new URL(request.url()).origin !== new URL(app.url).origin) {
          await request.abort('blockedbyclient');
          return;
        }
        if (new URL(request.url()).pathname === '/api/analyze')
          lastAnalyzeBody = JSON.parse(request.postData());
        const active = held;
        if (!active || new URL(request.url()).pathname !== active.path) {
          await request.continue();
          return;
        }
        held = null;
        const actual = await fetch(request.url(), {
          method: request.method(),
          headers: { 'Content-Type': 'application/json' },
          body: request.postData(),
        });
        const body = active.bodyOverride || (await actual.text());
        active.received();
        await active.gate;
        try {
          await request.respond({ status: actual.status, contentType: 'application/json', body });
        } catch (_e) {
          // The product aborts this owned, deliberately held request on edit.
        }
        active.completed();
      });
      function hold(path, bodyOverride = '') {
        let release = () => {};
        let received = () => {};
        let completed = () => {};
        const gate = new Promise((resolve) => {
          release = () => resolve(undefined);
        });
        const ready = new Promise((resolve) => {
          received = () => resolve(undefined);
        });
        const done = new Promise((resolve) => {
          completed = () => resolve(undefined);
        });
        held = { path, gate, received, completed, bodyOverride };
        return { ready, release, done };
      }
      const settlePaint = () =>
        page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
            ),
        );
      const open = async () => {
        await page.click('.kt-tools-menu summary');
        await page.click('[data-action="inspect-schain"]');
        await page.waitForSelector('.inspection-dialog');
        await page.waitForFunction(
          () => document.querySelector('#inspectionRoute').children.length > 2,
        );
      };
      await page.goto(app.url + '/inspector', { waitUntil: 'networkidle2' });
      await page.waitForSelector('#analyzeBtn');
      await open();
      await page.type('#inspectionInput', '1.0,1!first.example,first,1');
      const first = hold('/api/inspection/schain');
      await page.click('#inspectionRun');
      await first.ready;
      await page.$eval('#inspectionInput', (el) => {
        el.value = '1.0,1!second.example,second,1';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      first.release();
      await first.done;
      await settlePaint();
      assert.equal(await page.$eval('#inspectionResult', (el) => el.textContent), '');
      assert.equal(await page.$eval('#inspectionRun', (el) => el.disabled), false);
      await page.click('#inspectionRun');
      await page.waitForSelector('#inspectionResult a');
      await page.click('#inspectionSenderEnabled');
      assert.equal(await page.$eval('#inspectionResult', (el) => el.textContent), '');
      await page.type('#inspectionAsi', 'second.example');
      await page.type('#inspectionSid', 'second');
      await page.click('#inspectionRun');
      await page.waitForSelector('#inspectionResult a');
      await page.type('#inspectionSid', '-edited');
      assert.equal(await page.$eval('#inspectionResult', (el) => el.textContent), '');
      await page.click('#inspectionSenderEnabled');
      await page.select('#inspectionRoute', '0');
      await page.click('#inspectionApply');
      await page.$eval('#bidReq', (el) => {
        el.value = JSON.stringify({
          id: 'synthetic-context-race',
          imp: [{ id: 'i', banner: { w: 300, h: 250 } }],
        });
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const oldAnalysis = hold('/api/analyze');
      await page.click('#analyzeBtn');
      await oldAnalysis.ready;
      await open();
      await page.select('#inspectionRoute', '1');
      await page.click('#inspectionApply');
      oldAnalysis.release();
      await oldAnalysis.done;
      await settlePaint();
      assert.equal(
        await page.$eval('#inspectionContextSummary', (el) => el.textContent),
        'Declared context selected — run analysis',
      );
      assert.equal(await page.$eval('#analyzeBtn', (el) => el.disabled), false);
      await page.click('#analyzeBtn');
      await page.waitForFunction(() =>
        document
          .querySelector('#inspectionContextSummary')
          .textContent.startsWith('Declared route profile applies'),
      );
      await open();
      const malformed = hold(
        '/api/analyze',
        JSON.stringify({
          success: true,
          validation: null,
          inspection: { route: { status: 'known' } },
        }),
      );
      await page.evaluate(() => {
        void (/** @type {any} */ (window).runAnalysis());
      });
      await malformed.ready;
      assert.equal(
        await page.$eval('#inspectionRouteResult', (el) => el.textContent),
        'Declared context selected — run analysis',
      );
      malformed.release();
      await malformed.done;
      await page.waitForFunction(
        () => !(/** @type {HTMLButtonElement} */ (document.querySelector('#analyzeBtn')).disabled),
      );
      await settlePaint();
      assert.equal(
        await page.$eval('#inspectionContextSummary', (el) => el.textContent),
        'Declared context selected — run analysis',
      );
      assert.equal(
        await page.$eval('#inspectionRouteResult', (el) => el.textContent),
        'Declared context selected — run analysis',
      );
      await page.keyboard.press('Escape');
      assert.ok(lastAnalyzeBody, 'The actual analysis request was captured');
      const preservedRoute = lastAnalyzeBody.declaredRoute;
      const malformedCatalog = hold(
        '/api/inspection/profiles',
        JSON.stringify({ success: true, profiles: [{ adapterId: 'malformed', revision: null }] }),
      );
      await page.click('.kt-tools-menu summary');
      await page.click('[data-action="inspect-schain"]');
      await malformedCatalog.ready;
      malformedCatalog.release();
      await malformedCatalog.done;
      await page.waitForFunction(
        () =>
          document.querySelector('#inspectionProfilesState').textContent ===
          'Route profiles could not load. Close and reopen to retry.',
      );
      assert.equal(await page.$eval('#inspectionRoute', (el) => el.disabled), true);
      await page.click('#inspectionApply');
      await page.click('#analyzeBtn');
      await page.waitForFunction(() =>
        document
          .querySelector('#inspectionContextSummary')
          .textContent.startsWith('Declared route profile applies'),
      );
      assert.ok(lastAnalyzeBody, 'The subsequent analysis request was captured');
      assert.deepEqual(lastAnalyzeBody.declaredRoute, preservedRoute);
      assert.deepEqual(pageErrors, []);
    } finally {
      await browser.close();
      await app.stop();
    }
  },
);
