/* global document, getComputedStyle */
'use strict';

/**
 * tests/finding-contrast-browser.test.js — the finding text a user reads must
 * be legible against the surface it is painted on.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before the v2 finding restyle, severity was painted three times on every
 * row: a tinted background, a tinted border, and tinted body text. Measured
 * in real Chrome on the shipped dark theme, that produced:
 *
 *     error findings    1.75:1
 *     warning findings  1.49:1
 *
 * against a WCAG AA floor of 4.5:1 for text this size. The two sentences
 * that say what is blocking a bid were the least readable text in the
 * product, and nothing checked. Both the light and dark palettes drifted
 * there independently, which is the tell that this needed a measurement and
 * not a review: red-on-red and amber-on-amber look deliberate in a mockup.
 *
 * v2 states severity once — a 3px bar on the leading edge — and gives the
 * sentence the body colour. This file pins that: it renders a payload that
 * produces every severity, then measures the real composited contrast of
 * each row through getComputedStyle, walking up for the first opaque
 * ancestor background the way the compositor does.
 *
 * SCOPE. Body text only. The severity ICON keeps its hue on purpose — a
 * glyph can carry colour at full strength without costing a sentence its
 * contrast — and is asserted separately, at the 3:1 non-text floor.
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

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch (_err) {
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

/* A payload chosen to produce errors, warnings, info and a question at once,
   so one render exercises every severity class the stylesheet defines. */
const MIXED = JSON.stringify({
  id: '',
  imp: [
    {
      id: '1',
      banner: { w: 300, h: 250, battr: [16] },
      bidfloor: 0.45,
      bidfloorcur: 'USD',
      secure: 1,
      ext: { adtype: 'popunder', viewability_provider: 'acme' },
    },
  ],
  device: { ua: 'Mozilla/5.0 (Linux; Android 14)', geo: { country: 'UKR', city: 'Kyiv' } },
  site: { domain: 'example-publisher.com', cat: ['IAB1'] },
  regs: { gpp: 'DBABMA~CPXxRfAPXxRfA' },
  source: { ext: { schain: { complete: 0, nodes: [{ asi: 'ssp.example', sid: '42', hp: 1 }] } } },
});

/* WCAG 2.1: 4.5:1 for body text, 3:1 for large text and non-text glyphs. */
const AA_TEXT = 4.5;
const AA_GLYPH = 3;

test(
  'browser: every finding row states its severity without costing the sentence its contrast',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-contrast-'));
    const port = await getFreePort();

    let serverInfo = null;
    let browser = null;

    try {
      serverInfo = await new Promise((resolve, reject) => {
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
        proc.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        proc.on('exit', (code) => {
          if (!started) {
            clearTimeout(timeout);
            reject(new Error(`Server exited ${code}`));
          }
        });
      });

      browser = await puppeteer.launch({
        headless: true,
        executablePath: chromeExecutable,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.setViewport({ width: 1600, height: 1100 });

      /** Measure composited contrast for every rendered severity class.
       *  Runs in the page so it reads what the compositor reads, not what
       *  the stylesheet declares — a rule can be overridden, inherited or
       *  lost to specificity, and only the computed value is the truth. */
      const measure = (theme) =>
        page.evaluate((th) => {
          document.documentElement.setAttribute('data-theme', th);
          const relLum = (css) => {
            const parts = (css.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
            const [r, g, b] = parts.map((v) => {
              const c = v / 255;
              return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          /* First opaque ancestor background — what the text is actually
             composited against. A row can be transparent and inherit the
             panel behind it. */
          const opaqueBg = (el) => {
            let node = el;
            while (node && node !== document.documentElement) {
              const c = getComputedStyle(node).backgroundColor;
              if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
              node = node.parentElement;
            }
            return getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)';
          };
          const ratio = (fg, bg) => {
            const a = relLum(fg);
            const b = relLum(bg);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          };

          const out = {};
          for (const cls of ['danger', 'warning', 'info', 'question']) {
            const row = document.querySelector('.validation-item.' + cls);
            if (!row) continue;
            const bg = opaqueBg(row);
            const entry = {
              text: +ratio(getComputedStyle(row).color, bg).toFixed(2),
              fontSize: Math.round(parseFloat(getComputedStyle(row).fontSize)),
            };
            const icon = row.querySelector('.validation-icon');
            if (icon) entry.icon = +ratio(getComputedStyle(icon).color, bg).toFixed(2);
            out[cls] = entry;
          }
          return out;
        }, theme);

      await page.goto(`${serverInfo.url}/inspector`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForSelector('#bidReq', { timeout: 15000 });

      await page.evaluate((v) => {
        const el = /** @type {any} */ (document.getElementById('bidReq'));
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, MIXED);
      await page.evaluate(() =>
        /** @type {any} */ (document.querySelector('[data-action="analyze"]')).click(),
      );
      await page.waitForSelector('.validation-item', { timeout: 15000 });
      await delay(600);

      /* Both palettes. They drifted below AA independently, so passing in
         one theme says nothing about the other. */
      for (const theme of ['dark', 'light']) {
        await delay(200);
        const seen = await measure(theme);
        const classes = Object.keys(seen);
        assert.ok(
          classes.includes('danger') && classes.includes('warning'),
          `${theme}: the payload must render at least one error and one warning row, got ${classes.join(', ') || 'none'}`,
        );

        for (const [cls, m] of Object.entries(seen)) {
          assert.ok(
            m.text >= AA_TEXT,
            `${theme}/${cls}: finding text is ${m.text}:1 at ${m.fontSize}px — below the ${AA_TEXT}:1 WCAG AA floor. ` +
              `Severity belongs in the leading-edge bar and the icon, not in the sentence's colour.`,
          );
          if (typeof m.icon === 'number') {
            assert.ok(
              m.icon >= AA_GLYPH,
              `${theme}/${cls}: the severity icon is ${m.icon}:1 — below the ${AA_GLYPH}:1 non-text floor`,
            );
          }
        }
      }

      assert.deepEqual(pageErrors, [], 'no page errors while rendering findings');
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
