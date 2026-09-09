/* global document, window, requestAnimationFrame */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startIsolatedApp } = require('./isolated-browser-app');
const { browserSkipReason, launchBrowser, openInspector } = require('./corpus/lib/browser');
const { prepareSavedFixtures } = require('./saved-history-fixtures');

test(
  'browser-light: closed navigation is skipped by Tab and open navigation supports Escape and resizing',
  { skip: browserSkipReason, timeout: 60000 },
  async () => {
    const app = await startIsolatedApp(),
      browser = await launchBrowser();
    try {
      for (const locale of /** @type {const} */ (['en', 'uk', 'ru'])) {
        const { page, pageErrors } = await openInspector(browser, app.url, {
          locale,
          viewport: { width: 480, height: 600 },
        });
        await page.evaluate(() => {
          document.body.setAttribute('tabindex', '-1');
          document.body.focus();
          document.body.removeAttribute('tabindex');
        });
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press('Tab');
          assert.equal(
            await page.evaluate(() =>
              document.getElementById('kt-nav-root').contains(document.activeElement),
            ),
            false,
            `${locale}: closed nav tab ${i}`,
          );
        }
        await page.click('[data-action="toggle-nav"]');
        await page.waitForFunction(() =>
          document.getElementById('kt-nav-root').contains(document.activeElement),
        );
        assert.equal(await page.$eval('#kt-nav-root', (el) => el.hasAttribute('inert')), false);
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('#kt-nav-root', (el) => el.hasAttribute('inert')), true);
        assert.equal(
          await page.evaluate(
            () => /** @type {HTMLElement} */ (document.activeElement).dataset.action,
          ),
          'toggle-nav',
        );
        await page.setViewport({ width: 1366, height: 768 });
        await page.waitForFunction(
          () => !document.getElementById('kt-nav-root').hasAttribute('inert'),
        );
        await page.focus('#kt-nav-root [data-route="/library"]');
        await page.setViewport({ width: 960, height: 600 });
        await page.waitForFunction(() =>
          document.getElementById('kt-nav-root').hasAttribute('inert'),
        );
        assert.equal(
          await page.evaluate(
            () => /** @type {HTMLElement} */ (document.activeElement).dataset.action,
          ),
          'toggle-nav',
        );
        assert.deepEqual(pageErrors, []);
        await page.close();
      }
    } finally {
      await browser.close();
      await app.stop();
    }
  },
);

test(
  'browser-light: account navigation keeps each Tab and ShiftTab target fully visible',
  { skip: browserSkipReason, timeout: 120000 },
  async () => {
    const app = await startIsolatedApp();
    const browser = await launchBrowser();
    try {
      for (const locale of /** @type {const} */ (['en', 'uk', 'ru'])) {
        const { page, pageErrors } = await openInspector(browser, app.url, { locale });
        await prepareSavedFixtures(page, `account-focus-${locale}`);
        await page.goto(app.url + (locale === 'en' ? '' : '/' + locale) + '/account#profile', {
          waitUntil: 'networkidle2',
        });
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll('.cab-section')).some(
            (el) => /** @type {HTMLElement} */ (el).hidden,
          ),
        );
        const links = await page.$$eval('#cabNav .cab-nav-item', (items) =>
          items.map((item) => item.getAttribute('href')),
        );
        assert.equal(links.length, 8);
        for (const width of [427, 854]) {
          await page.setViewport({ width, height: 768 });
          await page.evaluate(() => {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('cabNav').scrollLeft = 0;
          });
          await page.focus('#cabNav .cab-nav-item');
          async function assertVisible(index, direction) {
            // Let native focus scrolling and the focus handler settle before
            // checking the entire link against its clipping ancestor.
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
                ),
            );
            const actual = await page.evaluate(() => {
              const nav = document.getElementById('cabNav');
              const link = document.activeElement;
              const n = nav.getBoundingClientRect();
              const r = link.getBoundingClientRect();
              return {
                href: link.getAttribute('href'),
                left: r.left,
                right: r.right,
                navLeft: n.left + nav.clientLeft,
                navRight: n.left + nav.clientLeft + nav.clientWidth,
                viewport: window.innerWidth,
              };
            });
            assert.equal(actual.href, links[index], `${locale}/${width}/${direction}/${index}`);
            assert.ok(
              actual.left >= Math.max(0, actual.navLeft) - 1 &&
                actual.right <= Math.min(actual.viewport, actual.navRight) + 1,
              `${locale}/${width}/${direction}/${index}: ${JSON.stringify(actual)}`,
            );
          }
          await assertVisible(0, 'Tab');
          for (let index = 1; index < links.length; index++) {
            await page.keyboard.press('Tab');
            await assertVisible(index, 'Tab');
          }
          for (let index = links.length - 2; index >= 0; index--) {
            await page.keyboard.down('Shift');
            try {
              await page.keyboard.press('Tab');
            } finally {
              await page.keyboard.up('Shift');
            }
            await assertVisible(index, 'ShiftTab');
          }
        }
        assert.deepEqual(pageErrors, []);
        await page.close();
      }
    } finally {
      await browser.close();
      await app.stop();
    }
  },
);
