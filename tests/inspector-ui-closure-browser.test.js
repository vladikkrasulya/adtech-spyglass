/* global document, getComputedStyle, innerWidth, window */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  .filter(Boolean)
  .find((p) => fs.existsSync(p));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  'browser: Inspector selections, translated tab geometry and unlock form stay coherent',
  { timeout: 180000, skip: !chrome && 'Chrome unavailable' },
  async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-ui-closure-'));
    const artifactDir = process.env.ORTBTOOLS_UI_ARTIFACTS;
    if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });
    let proc;
    let browser;
    try {
      const port = await new Promise((resolve) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
          const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
          server.close(() => resolve(port));
        });
      });
      proc = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          PORT: String(port),
          NODE_ENV: 'test',
          LOG_LEVEL: 'info',
          ORTBTOOLS_DATA_DIR: dataDir,
          ORTBTOOLS_ANALYTICS_DISABLED: '1',
          NEWS_CRAWLER_DISABLED: '1',
          FX_DISABLED: '1',
        },
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Test app startup timed out')), 15000);
        const ready = (chunk) => {
          if (String(chunk).includes('listening')) {
            clearTimeout(timer);
            resolve(undefined);
          }
        };
        proc.stdout.on('data', ready);
        proc.stderr.on('data', ready);
        proc.once('error', reject);
        proc.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`App exited ${code}`));
        });
      });
      browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      const base = `http://127.0.0.1:${port}`;
      const errors = [];
      for (const locale of ['en', 'uk', 'ru']) {
        const page = await browser.newPage();
        page.on('pageerror', (err) => errors.push(String(err)));
        await page.setRequestInterception(true);
        page.on('request', (req) =>
          req.url().startsWith(base) || req.url().startsWith('data:')
            ? req.continue()
            : req.abort(),
        );
        await page.setViewport({ width: 1920, height: 1080, hasTouch: true });
        await page.evaluateOnNewDocument(() => localStorage.removeItem('ortbtools_version_pin'));
        await page.goto(`${base}/${locale === 'en' ? '' : locale + '/'}inspector`);
        await page.waitForSelector('#bidReq');
        assert.equal(
          await page.$$eval('.inspector-select', (els) => els.length),
          5,
          'every Inspector select is enhanced',
        );
        const accessibility = await page.createCDPSession();
        const tree = await accessibility.send('Accessibility.getFullAXTree');
        const comboNames = tree.nodes
          .filter((node) => !node.ignored && node.role?.value === 'combobox')
          .map((node) => node.name?.value)
          .sort();
        const expectedNames = await page.$$eval('#versionPinSelector, #dialectSelector', (els) =>
          els.map((el) => el.getAttribute('aria-label')).sort(),
        );
        assert.deepEqual(
          comboNames.filter((name) => expectedNames.includes(name)),
          expectedNames,
          'Chrome exposes each visible, localized Inspector combobox once',
        );
        await accessibility.detach();

        // Real Inspector dispatcher: a committed version changes both controls once.
        await page.evaluate(() => {
          /** @type {any} */ (window).__closureChanges = 0;
          document
            .getElementById('versionPinSelector')
            .addEventListener('change', () => /** @type {any} */ (window).__closureChanges++);
        });
        await page.focus('#versionPinSelectorControl');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        assert.deepEqual(
          await page.evaluate(() => ({
            desktop: /** @type {HTMLInputElement} */ (document.getElementById('versionPinSelector'))
              .value,
            mobile: /** @type {HTMLInputElement} */ (
              document.getElementById('versionPinSelectorMobile')
            ).value,
            stored: localStorage.getItem('ortbtools_version_pin'),
            count: /** @type {any} */ (window).__closureChanges,
            label: /** @type {HTMLInputElement} */ (
              document.getElementById('versionPinSelectorMobileControl')
            ).textContent.trim(),
          })),
          { desktop: '2.5', mobile: '2.5', stored: '2.5', count: 1, label: 'oRTB 2.5' },
        );
        await page.keyboard.press('Enter');
        await page.keyboard.press('End');
        await page.keyboard.press('Escape');
        assert.equal(
          await page.$eval('#versionPinSelector', (el) => el.value),
          '2.5',
          'Escape cancels pending selection',
        );

        if (locale === 'en') {
          // A synthetic select exercises the same component independently of
          // validation rules: disabled groups, typeahead and changing options.
          await page.evaluate(async () => {
            const modulePath = '/modules/inspector/select-control.js';
            const { enhanceSelectControls } = await import(modulePath);
            const fixture = document.createElement('div');
            fixture.id = 'selectionFixture';
            fixture.style.cssText = 'position:fixed;top:100px;left:20px;width:180px;z-index:1001';
            fixture.innerHTML =
              '<select id="fixtureSelect" aria-label="Synthetic choices"><option value="a">Alpha</option><option disabled value="bad">Bravo</option><option value="b">Beta</option><optgroup disabled label="Unavailable"><option value="bad-group">Blocked group</option></optgroup><option value="c">Cedar</option></select><button id="fixtureAfter">After</button>';
            document.body.append(fixture);
            const ctrl = new AbortController();
            const cleanup = [];
            const enhanced = enhanceSelectControls(fixture, {
              signal: ctrl.signal,
              addCleanup: (fn) => cleanup.push(fn),
            });
            /** @type {any} */ (window).__fixtureDestroy = () => {
              ctrl.abort();
              cleanup.forEach((fn) => fn());
              enhanced.destroy();
            };
            /** @type {any} */ (window).__fixtureChanges = 0;
            fixture
              .querySelector('select')
              .addEventListener('change', () => /** @type {any} */ (window).__fixtureChanges++);
          });
          await page.focus('#fixtureSelectControl');
          await page.keyboard.press('Enter');
          await page.keyboard.press('ArrowDown');
          assert.equal(
            await page.$eval('#fixtureSelectControl', (el) =>
              el.getAttribute('aria-activedescendant'),
            ),
            'fixtureSelectOptions-2',
            'arrow skips disabled option',
          );
          assert.equal(
            await page.$eval('#fixtureSelect', (el) => el.value),
            'a',
            'navigation does not commit',
          );
          await page.evaluate(() => {
            const select = /** @type {HTMLSelectElement} */ (
              document.getElementById('fixtureSelect')
            );
            const option = document.createElement('option');
            option.value = 'new';
            option.textContent = 'New first item';
            select.prepend(option);
          });
          await page.waitForFunction(
            () =>
              document
                .getElementById('fixtureSelectControl')
                .getAttribute('aria-activedescendant') === 'fixtureSelectOptions-3',
          );
          await page.evaluate(() =>
            document.getElementById('fixtureSelect').firstElementChild.remove(),
          );
          await page.waitForFunction(
            () =>
              document
                .getElementById('fixtureSelectControl')
                .getAttribute('aria-activedescendant') === 'fixtureSelectOptions-2',
          );
          await page.keyboard.press('End');
          await page.keyboard.press('Enter');
          assert.equal(await page.$eval('#fixtureSelect', (el) => el.value), 'c');
          await page.keyboard.press('Home');
          await page.keyboard.type('b');
          await page.keyboard.press('Tab');
          assert.equal(
            await page.$eval('#fixtureSelect', (el) => el.value),
            'b',
            'typeahead skips disabled option and group',
          );
          assert.equal(
            await page.evaluate(() => document.activeElement.id),
            'fixtureAfter',
            'Tab leaves combobox',
          );
          await page.click('#fixtureSelectControl');
          await page.click('#fixtureSelectOptions-0');
          assert.equal(
            await page.$eval('#fixtureSelect', (el) => el.value),
            'a',
            'pointer selection commits',
          );
          assert.equal(
            await page.evaluate(() => /** @type {any} */ (window).__fixtureChanges),
            3,
            'one change per committed selection',
          );
          await page.focus('#fixtureSelectControl');
          await page.keyboard.down('Alt');
          await page.keyboard.press('ArrowDown');
          await page.keyboard.up('Alt');
          await page.keyboard.press('PageDown');
          await page.keyboard.down('Alt');
          await page.keyboard.press('ArrowUp');
          await page.keyboard.up('Alt');
          assert.equal(
            await page.$eval('#fixtureSelect', (el) => el.value),
            'c',
            'Alt-Up accepts PageDown navigation',
          );
          await page.keyboard.press('ArrowUp');
          await page.keyboard.press('PageDown');
          await page.keyboard.press('PageUp');
          await page.keyboard.press(' ');
          assert.equal(
            await page.$eval('#fixtureSelect', (el) => el.value),
            'a',
            'PageUp and Space select the first enabled option',
          );
          await page.evaluate(() => {
            const select = /** @type {HTMLSelectElement} */ (
              document.getElementById('fixtureSelect')
            );
            const option = document.createElement('option');
            option.value = 'extra';
            option.textContent = 'Extra <b>synthetic</b> ' + 'long '.repeat(35);
            option.selected = true;
            select.append(option);
          });
          await page.waitForFunction(() =>
            document.getElementById('fixtureSelectControl').textContent.startsWith('Extra'),
          );
          await page.click('#fixtureSelectControl');
          assert.equal(
            await page.$eval('#fixtureSelectOptions', (el) => el.querySelectorAll('b').length),
            0,
            'option text is inert',
          );
          await page.evaluate(() => {
            /** @type {HTMLSelectElement} */ (document.getElementById('fixtureSelect')).disabled =
              true;
          });
          await page.waitForFunction(
            () =>
              /** @type {HTMLButtonElement} */ (document.getElementById('fixtureSelectControl'))
                .disabled,
          );
          assert.equal(
            await page.$eval('#fixtureSelectControl', (el) => el.getAttribute('aria-expanded')),
            'false',
            'disabling closes popup',
          );
          await page.evaluate(() => {
            const select = /** @type {HTMLSelectElement} */ (
              document.getElementById('fixtureSelect')
            );
            select.disabled = false;
            select.lastElementChild.remove();
          });
          await page.waitForFunction(
            () => document.getElementById('fixtureSelectControl').textContent === 'Alpha',
          );
          await page.click('#fixtureSelectControl');
          await page.click('#fixtureAfter');
          assert.equal(
            await page.$eval('#fixtureSelectControl', (el) => el.getAttribute('aria-expanded')),
            'false',
            'outside pointer dismisses',
          );
          await page.evaluate(() => /** @type {any} */ (window).__fixtureDestroy());
          assert.equal(
            await page.$$eval('#fixtureSelectControl, #fixtureSelectOptions', (els) => els.length),
            0,
            'unmount removes presentation and popup',
          );
          assert.equal(
            await page.$eval('#fixtureSelect', (el) => el.getAttribute('tabindex')),
            null,
            'native source restored',
          );
          await page.evaluate(() => document.getElementById('selectionFixture').remove());
        }

        await page.evaluate(() => {
          const el = /** @type {HTMLInputElement} */ (document.getElementById('bidReq'));
          el.value = JSON.stringify({
            id: 'ui-closure',
            imp: [{ id: '1', banner: { w: 300, h: 250 } }],
            site: { domain: 'publisher.example' },
          });
          el.dispatchEvent(new Event('input', { bubbles: true }));
          /** @type {HTMLInputElement} */ (
            document.querySelector('[data-action="analyze"]')
          ).click();
        });
        await page.waitForSelector('details.finding-detail');
        for (const width of [320, 768, 1920, 2560]) {
          await page.setViewport({ width, height: 1080, hasTouch: true });
          assert.ok(
            await page.$eval('#bidReq', (el) => el.value.includes('ui-closure')),
            'viewport changes retain synthetic analysis',
          );
          for (const theme of ['light', 'dark']) {
            await page.evaluate(
              (theme) => document.documentElement.setAttribute('data-theme', theme),
              theme,
            );
            await delay(40);
            const geometry = await page.evaluate(() => {
              const tabs = [
                ...document.querySelectorAll('.tab-list-scroll > .tab-btn, .tab-more > summary'),
              ].map((el) => {
                const box = el.getBoundingClientRect();
                const text = [...el.childNodes].find(
                  (node) => node.nodeType === 3 && node.textContent.trim(),
                );
                const range = document.createRange();
                range.selectNodeContents(text);
                return { height: box.height, textTop: range.getBoundingClientRect().top };
              });
              return { tabs, overflow: document.documentElement.scrollWidth - innerWidth };
            });
            const label = `${locale}/${theme}/${width}`;
            assert.ok(
              Math.max(...geometry.tabs.map((t) => t.height)) -
                Math.min(...geometry.tabs.map((t) => t.height)) <
                0.1,
              label + ': same tab height',
            );
            assert.ok(
              Math.max(...geometry.tabs.map((t) => t.textTop)) -
                Math.min(...geometry.tabs.map((t) => t.textTop)) <
                0.1,
              label + ': common text baseline',
            );
            assert.equal(geometry.overflow, 0, label + ': no document overflow');
            await page.click('.tab-more > summary');
            const menu = await page.$eval('.tab-more-menu', (el) => {
              const b = el.getBoundingClientRect();
              return { left: b.left, right: b.right, display: getComputedStyle(el).display };
            });
            assert.notEqual(menu.display, 'none', label + ': More opens');
            assert.ok(menu.left >= 0 && menu.right <= width, label + ': More fits');
            await page.keyboard.press('Escape');
            if (locale === 'en' && width === 320 && theme === 'light') {
              await page.tap('.workbar-settings-toggle');
              await page.tap('#versionPinSelectorMobileControl');
              const popup = await page.$eval('#versionPinSelectorMobileOptions', (el) => {
                const r = el.getBoundingClientRect();
                return {
                  left: r.left,
                  right: r.right,
                  top: r.top,
                  bottom: r.bottom,
                  hidden: el.hidden,
                };
              });
              assert.ok(
                !popup.hidden &&
                  popup.left >= 0 &&
                  popup.right <= width &&
                  popup.top >= 0 &&
                  popup.bottom <= 1080,
                'touch popup stays inside the phone',
              );
              if (artifactDir)
                await page.screenshot({ path: path.join(artifactDir, 'en-phone-select.png') });
              await page.tap('#versionPinSelectorMobileOptions-2');
              assert.equal(
                await page.$eval('#versionPinSelector', (el) => el.value),
                '2.6',
                'touch commits to the shared native value',
              );
              await page.tap('.workbar-settings-toggle');
            }
            if (artifactDir && locale === 'en' && width === 1920) {
              await page.click('#dialectSelectorControl');
              await page.screenshot({
                path: path.join(artifactDir, `en-desktop-select-${theme}.png`),
              });
              await page.keyboard.press('Escape');
            }
          }
        }

        // Synthetic identity only: this tests form boundaries and submission, not a
        // claim to reproduce a browser's private saved-password heuristics.
        await page.setViewport({ width: 1920, height: 1080, hasTouch: true });
        await page.evaluate(async () => {
          /** @type {any} */ (window).__closureSession = /** @type {any} */ (
            window
          ).OrtbtoolsSession;
          /** @type {any} */ (window).__closureUnlocks = 0;
          /** @type {any} */ (window).OrtbtoolsSession = {
            user: { email: 'synthetic+<tag>&"@example.invalid' },
            api: async () => ({ user: { id: 1 }, encryption: {} }),
            openFromPassword: async () => {
              /** @type {any} */ (window).__closureUnlocks++;
              await new Promise((r) => setTimeout(r, 80));
            },
            refreshSamples() {},
          };
          /** @type {HTMLInputElement} */ (
            document.querySelector('.kt-topbar__search-input')
          ).value = 'keep this query';
          const moduleRoot = '/modules/unlock/';
          await import(moduleRoot + 'i18n.js');
          await import(moduleRoot + 'index.js');
          /** @type {any} */ (window).openUnlockModal();
        });
        const form = await page.evaluate(() => {
          const pw = /** @type {HTMLInputElement} */ (document.getElementById('unlockPwInput'));
          const username = /** @type {HTMLInputElement} */ (
            document.querySelector('#modalRoot [autocomplete="username"]')
          );
          return {
            ownsPassword: !!pw.form,
            sameForm: username?.form === pw.form,
            username: username?.value,
            injected: !!(
              /** @type {HTMLInputElement} */ (document.querySelector('#modalRoot tag'))
            ),
            searchInForm: pw.form?.contains(
              /** @type {HTMLInputElement} */ (document.querySelector('.kt-topbar__search-input')),
            ),
          };
        });
        assert.deepEqual(form, {
          ownsPassword: true,
          sameForm: true,
          username: 'synthetic+<tag>&"@example.invalid',
          injected: false,
          searchInForm: false,
        });
        await page.type('#unlockPwInput', 'synthetic-password');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          () => !(/** @type {HTMLInputElement} */ (document.getElementById('unlockPwInput'))),
        );
        assert.equal(
          await page.evaluate(() => /** @type {any} */ (window).__closureUnlocks),
          1,
          'duplicate submit is guarded',
        );
        await page.evaluate(() => /** @type {any} */ (window).openUnlockModal());
        await page.type('#unlockPwInput', 'synthetic-password');
        await page.click('#unlockForm button[type="submit"]');
        await page.waitForFunction(
          () => !(/** @type {HTMLInputElement} */ (document.getElementById('unlockPwInput'))),
        );
        assert.equal(
          await page.evaluate(() => /** @type {any} */ (window).__closureUnlocks),
          2,
          'reopened modal submits exactly once',
        );
        assert.equal(
          await page.$eval('.kt-topbar__search-input', (el) => el.value),
          'keep this query',
        );
        await page.evaluate(() => {
          /** @type {any} */ (window).OrtbtoolsSession.api = () =>
            new Promise((resolve) => {
              /** @type {any} */ (window).__releaseUnlock = resolve;
            });
          /** @type {any} */ (window).openUnlockModal();
        });
        await page.type('#unlockPwInput', 'synthetic-password');
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          () => typeof (/** @type {any} */ (window).__releaseUnlock) === 'function',
        );
        await page.evaluate(() => {
          /** @type {any} */ (window).closeModal();
          /** @type {any} */ (window).openUnlockModal();
          /** @type {any} */ (window).__releaseUnlock({ user: { id: 1 }, encryption: {} });
        });
        await delay(100);
        assert.equal(
          await page.evaluate(() => /** @type {any} */ (window).__closureUnlocks),
          2,
          'canceled form cannot derive keys or close a newer dialog',
        );
        assert.ok(await page.$('#unlockForm'), 'new dialog stays open');
        await page.evaluate(() => /** @type {any} */ (window).closeModal());
        await page.evaluate(() => {
          /** @type {any} */ (window).OrtbtoolsSession = /** @type {any} */ (
            window
          ).__closureSession;
        });
        await page.close();
      }
      assert.deepEqual(errors, [], 'no browser exceptions');
    } finally {
      if (browser) await browser.close();
      if (proc && proc.exitCode === null) {
        const done = new Promise((resolve) => proc.once('exit', resolve));
        proc.kill('SIGTERM');
        const force = setTimeout(() => proc.kill('SIGKILL'), 2000);
        await done;
        clearTimeout(force);
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
