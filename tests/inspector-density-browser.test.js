/* global document, getComputedStyle, innerWidth */
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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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

/* Exercise every translation at the hard 320px floor, then retain the common
   Ukrainian phone widths from the original regression. */

test(
  'browser: desktop Inspector preserves readable density and bounded panels',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-density-'));
    let serverInfo;
    let browser;
    const observations = [];
    const errors = [];
    const artifactDir = process.env.ORTBTOOLS_DENSITY_ARTIFACTS;
    if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });
    try {
      serverInfo = await startServer(await getFreePort(), dataDir);
      browser = await puppeteer.launch({
        headless: true,
        executablePath: chromeExecutable,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      for (const locale of ['en', 'uk', 'ru']) {
        const page = await browser.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.setViewport({ width: 2560, height: 1440 });
        await page.goto(`${serverInfo.url}/${locale === 'en' ? '' : locale + '/'}inspector`);
        await page.waitForSelector('#bidReq');
        await page.evaluate(() => {
          const el = /** @type {HTMLTextAreaElement} */ (document.querySelector('#bidReq'));
          el.value = JSON.stringify(
            {
              id: 'desktop-review',
              imp: [
                {
                  id: '1',
                  instl: 1,
                  tagid: 'sample-slot',
                  bidfloor: 0.05,
                  bidfloorcur: 'USD',
                  secure: 1,
                },
              ],
              site: {
                id: 'publisher',
                domain: 'publisher.example',
                cat: ['IAB1'],
                page: 'https://publisher.example/article',
                publisher: { id: 'example-publisher' },
              },
              device: {
                geo: { country: 'NPL' },
                dnt: 0,
                ua: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/100.0 Mobile Safari/537.36',
                devicetype: 1,
                language: 'en',
              },
              at: 1,
              tmax: 1000,
              cur: ['USD'],
            },
            null,
            2,
          );
          el.dispatchEvent(new Event('input', { bubbles: true }));
          /** @type {HTMLElement} */ (document.querySelector('[data-action="analyze"]')).click();
        });
        await page.waitForSelector('details.finding-detail');
        await page.click('[data-action="switch-tab"][data-target="tValidation"]');
        for (const width of [1440, 1920, 2560, 3840]) {
          await page.setViewport({ width, height: 1440 });
          for (const theme of ['light', 'dark']) {
            await page.evaluate(
              (theme) => document.documentElement.setAttribute('data-theme', theme),
              theme,
            );
            for (const context of [false, true]) {
              const hidden = await page.evaluate(() =>
                document.body.classList.contains('sb-left-hidden'),
              );
              if (hidden === context) await page.click('#toggleSidebarLeft');
              await delay(100);
              const geometry = await page.evaluate(() => {
                const rect = (selector) => {
                  const el = document.querySelector(selector);
                  const b = el.getBoundingClientRect();
                  const c = getComputedStyle(el);
                  return {
                    x: b.x,
                    right: b.right,
                    width: b.width,
                    height: b.height,
                    font: parseFloat(c.fontSize),
                    line: c.lineHeight,
                    scroll: el.scrollWidth,
                    client: el.clientWidth,
                  };
                };
                return {
                  viewport: innerWidth,
                  document: document.documentElement.scrollWidth,
                  canvas: rect('#app-root'),
                  payload: rect('.workbench-payload'),
                  results: rect('.center-panel'),
                  context: rect('.sidebar-left'),
                  title: rect('.finding-title'),
                  meta: rect('.finding-code'),
                  editor: rect('#bidReq'),
                  gutter: rect('.line-gutter'),
                  verdict: rect('.verdict-headline'),
                  cards: [...document.querySelectorAll('details.finding-detail')].map((el) => ({
                    width: el.clientWidth,
                    scroll: el.scrollWidth,
                    summary: el.querySelector('summary').getBoundingClientRect().height,
                  })),
                };
              });
              const label = `${locale}-${width}-${theme}-${context}`;
              observations.push({ label, ...geometry });
              assert.equal(geometry.title.font, 13, label + ': finding type stays compact');
              assert.equal(geometry.editor.font, 13, label + ': editor type stays compact');
              assert.equal(
                geometry.gutter.font,
                geometry.editor.font,
                label + ': gutter type alignment',
              );
              assert.equal(
                geometry.gutter.line,
                geometry.editor.line,
                label + ': gutter row alignment',
              );
              assert.ok(geometry.meta.font <= 12, label + ': metadata subordinate');
              assert.equal(geometry.verdict.font, 17, label + ': verdict scale');
              assert.ok(geometry.canvas.width <= 2200, label + ': bounded canvas');
              assert.ok(geometry.results.width <= 800.5, label + ': bounded results');
              assert.ok(
                geometry.payload.right <= geometry.results.x + 1,
                label + ': distinct columns',
              );
              assert.ok(geometry.payload.width > 350, label + ': usable editor');
              if (context) {
                assert.ok(geometry.context.width <= 240.5, label + ': compact context');
                assert.ok(
                  geometry.context.right <= geometry.payload.x + 1,
                  label + ': context does not cover editor',
                );
              }
              assert.ok(geometry.document <= geometry.viewport, label + ': no document overflow');
              for (const c of geometry.cards)
                assert.ok(c.scroll <= c.width + 1, label + ': no card overflow');
              if (
                artifactDir &&
                locale === 'ru' &&
                (width === 2560 || (theme === 'dark' && context && width !== 1440))
              ) {
                await page.screenshot({ path: path.join(artifactDir, `${label}.png`) });
              }
            }
          }
        }
        await page.evaluate(() =>
          document.querySelectorAll('details.finding-detail').forEach((el) => {
            const detail = /** @type {HTMLDetailsElement} */ (el);
            detail.open = true;
          }),
        );
        const expanded = await page.evaluate(() =>
          [...document.querySelectorAll('details.finding-detail')].map((el) => ({
            open: /** @type {HTMLDetailsElement} */ (el).open,
            width: el.clientWidth,
            scroll: el.scrollWidth,
            body: el.querySelector('.finding-detail-body').getBoundingClientRect().height,
          })),
        );
        assert.ok(
          expanded.every((c) => c.open && c.body > 0 && c.scroll <= c.width + 1),
          locale + ': expanded findings remain readable',
        );
        await page.close();
      }
      assert.deepEqual(errors, [], 'no browser errors');
    } finally {
      if (artifactDir)
        fs.writeFileSync(
          path.join(artifactDir, 'measurements.json'),
          JSON.stringify({ observations, errors }, null, 2) + '\n',
        );
      if (browser) await browser.close();
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
