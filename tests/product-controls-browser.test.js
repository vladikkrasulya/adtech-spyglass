/* global document, getComputedStyle */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let puppeteer = null;
try {
  puppeteer = require('puppeteer-core');
} catch (_error) {
  // The test reports a normal skip below when browser dependencies are absent.
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
const skip = !puppeteer
  ? 'puppeteer-core unavailable'
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

test(
  'browser-light: shared controls keep focus, open state, inline theme geometry, and phone bounds',
  { timeout: 120000, skip },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-controls-'));
    const port = await getFreePort();
    let serverInfo = null;
    let browser = null;

    try {
      serverInfo = await startServer(port, dataDir);
      browser = await puppeteer.launch({
        headless: true,
        executablePath: chromeExecutable,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const cases = [
        { route: '/account', width: 320, standalone: true },
        { route: '/account', width: 390, standalone: true },
        { route: '/about', width: 320, standalone: true },
        { route: '/about', width: 390, standalone: true },
        { route: '/inspector', width: 390, standalone: false },
      ];

      for (const { route, width, standalone } of cases) {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
        await page.evaluateOnNewDocument(() => localStorage.setItem('kt-theme', 'light'));
        await page.goto(`${serverInfo.url}${route}`, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        await page.waitForSelector('.kt-lang-menu > summary.kt-lang-toggle');

        const result = await page.evaluate(async () => {
          const details = /** @type {HTMLDetailsElement} */ (
            document.querySelector('.kt-lang-menu')
          );
          const summary = /** @type {HTMLElement} */ (details.querySelector('summary'));
          const list = /** @type {HTMLElement} */ (details.querySelector('.kt-lang-menu-list'));
          const closedDisplay = getComputedStyle(list).display;
          const closedSummaryStyle = getComputedStyle(summary);
          const closedState = {
            background: closedSummaryStyle.backgroundColor,
            border: closedSummaryStyle.borderColor,
          };

          summary.focus();
          const focus = getComputedStyle(summary);
          const focusRing = { style: focus.outlineStyle, width: focus.outlineWidth };

          details.open = true;
          // The design-system language trigger transitions its background and
          // border for 150ms. Sample after that user-visible transition and
          // after the :has()-driven header layout has settled.
          await new Promise((resolve) => setTimeout(resolve, 200));
          const rect = list.getBoundingClientRect();
          const summaryStyle = getComputedStyle(summary);
          const openState = {
            background: summaryStyle.backgroundColor,
            border: summaryStyle.borderColor,
          };
          const listStyle = getComputedStyle(list);
          const topnav = /** @type {HTMLElement | null} */ (document.querySelector('.kt-topnav'));
          const topnavInner = /** @type {HTMLElement | null} */ (
            document.querySelector('.kt-topnav-inner')
          );
          const actions = /** @type {HTMLElement | null} */ (
            document.querySelector('.kt-topnav-actions')
          );
          const theme = /** @type {HTMLElement | null} */ (
            document.querySelector('.kt-topnav .kt-theme-toggle')
          );
          const content = /** @type {HTMLElement | null} */ (
            document.querySelector('main.cab-container, body > section.kt-section')
          );
          const primary = /** @type {HTMLElement | null} */ (
            document.querySelector('#analyzeBtn, .btn-primary')
          );
          const primaryStyle = primary ? getComputedStyle(primary) : null;
          const headerRect = topnav?.getBoundingClientRect() || null;
          const actionsRect = actions?.getBoundingClientRect() || null;
          const themeRect = theme?.getBoundingClientRect() || null;
          const themeStyle = theme ? getComputedStyle(theme) : null;
          const standaloneMetrics = topnav
            ? {
                header: {
                  left: headerRect.left,
                  right: headerRect.right,
                  bottom: headerRect.bottom,
                },
                actions: {
                  left: actionsRect.left,
                  right: actionsRect.right,
                },
                theme: {
                  left: themeRect.left,
                  top: themeRect.top,
                  right: themeRect.right,
                  bottom: themeRect.bottom,
                  width: themeRect.width,
                  height: themeRect.height,
                  position: themeStyle.position,
                  radius: themeStyle.borderRadius,
                  shadow: themeStyle.boxShadow,
                },
                contentTop: content?.getBoundingClientRect().top ?? null,
                menuBottom: rect.bottom,
                innerOverflow: topnavInner.scrollWidth - topnavInner.clientWidth,
                documentOverflow:
                  document.documentElement.scrollWidth - document.documentElement.clientWidth,
              }
            : null;
          const summaryRadius = summaryStyle.borderRadius;
          const listRadius = listStyle.borderRadius;
          const primaryState = primaryStyle
            ? {
                background: primaryStyle.backgroundColor,
                color: primaryStyle.color,
                border: primaryStyle.borderColor,
                radius: primaryStyle.borderRadius,
              }
            : null;
          const wasOpen = details.open;

          details.open = false;
          return {
            wasOpen,
            closedDisplay,
            closedAgain: getComputedStyle(list).display,
            closedState,
            openState,
            focusRing,
            bounds: { left: rect.left, right: rect.right },
            summaryRadius,
            listRadius,
            standalone: standaloneMetrics,
            primary: primaryState,
          };
        });

        const at = `${route} at ${width}px`;
        assert.equal(result.closedDisplay, 'none', `${at}: popup is closed before interaction`);
        assert.equal(result.wasOpen, true, `${at}: disclosure enters its native open state`);
        assert.equal(result.closedAgain, 'none', `${at}: popup closes after interaction`);
        assert.equal(result.focusRing.style, 'solid', `${at}: summary has a visible focus outline`);
        assert.equal(result.focusRing.width, '2px', `${at}: summary focus outline is 2px`);
        assert.notEqual(
          result.openState.background,
          result.closedState.background,
          `${at}: open trigger background differs from closed`,
        );
        assert.notEqual(
          result.openState.border,
          result.closedState.border,
          `${at}: open trigger border differs from closed`,
        );
        assert.ok(result.bounds.left >= 10, `${at}: popup starts at x=${result.bounds.left}`);
        assert.ok(
          result.bounds.right <= width - 10,
          `${at}: popup ends at x=${result.bounds.right}`,
        );
        assert.equal(result.summaryRadius, '6px', `${at}: trigger uses the control radius`);
        assert.equal(result.listRadius, '10px', `${at}: popup uses the menu radius`);

        if (standalone) {
          assert.ok(result.standalone, `${at}: standalone topnav metrics exist`);
          assert.equal(result.standalone.theme.position, 'static', `${at}: theme is in flow`);
          assert.equal(result.standalone.theme.width, 36, `${at}: theme width`);
          assert.equal(result.standalone.theme.height, 36, `${at}: theme height`);
          assert.equal(result.standalone.theme.radius, '6px', `${at}: theme radius`);
          assert.equal(
            result.standalone.theme.shadow,
            'none',
            `${at}: theme has no floating shadow`,
          );
          assert.ok(
            result.standalone.theme.top >= 0 &&
              result.standalone.theme.bottom <= result.standalone.header.bottom,
            `${at}: theme remains inside the header`,
          );
          assert.ok(result.standalone.actions.left >= 10, `${at}: actions keep a left gutter`);
          assert.ok(
            result.standalone.actions.right <= width - 10,
            `${at}: actions keep a right gutter`,
          );
          assert.ok(
            result.standalone.contentTop >= result.standalone.menuBottom,
            `${at}: menu bottom ${result.standalone.menuBottom} must not cover content at ${result.standalone.contentTop}`,
          );
          assert.ok(result.standalone.innerOverflow <= 1, `${at}: header does not overflow`);
          assert.ok(result.standalone.documentOverflow <= 1, `${at}: page does not overflow`);
        } else {
          assert.equal(result.standalone, null, `${at}: SPA topbar stays outside standalone rules`);
        }

        if (route !== '/about') {
          assert.deepEqual(
            result.primary,
            {
              background: 'rgb(3, 105, 161)',
              color: 'rgb(255, 255, 255)',
              border: 'rgb(3, 105, 161)',
              radius: '6px',
            },
            `${route}: primary control keeps the accessible light-theme pair`,
          );
        }
        await page.close();
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopServer(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
