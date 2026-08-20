/* global window, document */
'use strict';

/**
 * tests/site-behavior.test.js — the three surfaces owned by the behavior /
 * corpus / insights group, driven in a real browser.
 *
 * Every case here is a defect that shipped, reproduced first and then pinned:
 *
 *   1. The corpus capture bar used to live ~155ms. behavior-tab.js paints the
 *      timeline synchronously, ortbtools.app.js prepends the bar right after,
 *      and the debounced engine response then re-painted the container with
 *      `innerHTML =` — deleting the ONLY button that opens the corpus flow,
 *      with no code path that ever put it back.
 *   2. Double-clicking "save" in the corpus modal POSTed twice and produced
 *      two identical corpus rows, which then counted twice in the confusion
 *      matrix.
 *   3. /insights printed a share percentage next to a bar normalised to a
 *      different denominator, so the top row was always drawn full-width.
 *   4. /insights clipped figures — the count column at a hard 52px, the KPI
 *      figures against `overflow:hidden` — with no ellipsis and no tell, so a
 *      truncated number read as a smaller, plausible one.
 *   5. /insights had no button at all: a failed load could only be retried by
 *      reloading the page, and picking a refresh cadence did not fetch.
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
      },
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let started = false;
    const timer = setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error('Server did not start within 15s'));
      }
    }, 15000);
    const onData = (chunk) => {
      if (!started && chunk.toString().includes('listening')) {
        started = true;
        clearTimeout(timer);
        resolve({ proc, url: `http://127.0.0.1:${port}` });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(timer);
        reject(new Error(`Server exited ${code}`));
      }
    });
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

/** Register a fresh user and hand back the session cookie value. */
async function registerUser(baseUrl, email) {
  const res = await fetch(baseUrl + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Str0ng-Passw0rd-2026!' }),
  });
  const body = await res.json();
  assert.equal(body.success, true, 'registration failed: ' + JSON.stringify(body));
  // Node exposes Set-Cookie unsplit via getSetCookie(); the cookie is HttpOnly,
  // which is exactly why it has to be lifted off the header rather than read
  // back out of the browser later.
  const raw = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')];
  const session = raw.map((c) => String(c)).find((c) => c.startsWith('ot_session='));
  assert.ok(session, 'no ot_session cookie in register response');
  return session.split(';')[0].slice('ot_session='.length);
}

const PROBE_EVENTS = [
  { kind: 'probe_ready', ts: 1 },
  { kind: 'frozen_thread', ts: 2, method: 'watchdog' },
  { kind: 'auto_navigate', ts: 3, method: 'location.href', url: 'https://evil.example/x' },
];

const SUMMARY_FIXTURE = {
  success: true,
  // Peak deliberately ≥ 100 000 so the count column and the KPI figures are
  // both exercised at the width where the old CSS started silently clipping.
  stream_activity: Array.from({ length: 60 }, (_, i) => ({
    minute: i,
    count: i === 30 ? 123456 : 20000 + i * 137,
  })),
  validation_totals: { errors: 142, warnings: 1873, info: 910210 },
  format_mix: [{ format: 'banner', pct: 62.5 }],
  version_mix: [{ version: '2.6', pct: 88.0 }],
};

test(
  'browser: behavior tab, corpus save and the insights dashboard',
  { timeout: 180000, skip: browserSkipReason },
  async (t) => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-sitebehavior-'));
    const port = await getFreePort();
    let server = null;
    let browser = null;

    try {
      server = await startServer(port, dataDir);
      const session = await registerUser(server.url, 'site-behavior@example.com');

      browser = await puppeteer.launch({
        headless: true,
        // Explicit, because the default is what the flaky runs hit: a single
        // CDP call missing its deadline aborts the whole file with
        // 'Runtime.callFunctionOn timed out'. Serial execution removed the
        // contention that caused it; this is the belt to that pair of braces.
        protocolTimeout: 120_000,
        executablePath: chromeExecutable,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      await browser.setCookie({
        name: 'ot_session',
        value: session,
        domain: '127.0.0.1',
        path: '/',
      });

      // ── 1. The corpus bar outlives the engine re-paint ──────────────────
      await t.test('the corpus bar survives the engine response', async () => {
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(server.url + '/en/inspector', { waitUntil: 'networkidle2' });
        await page.waitForSelector('#tBehavior', { timeout: 20000 });

        const seeded = await page.evaluate((events) => {
          /** @type {any} */ (window).__ortbtoolsBehavior =
            /** @type {any} */ (window).__ortbtoolsBehavior || {};
          /** @type {any} */ (window).__ortbtoolsBehavior.events = events;
          /** @type {any} */ (window).renderBehaviorTab();
          const tab = document.getElementById('tBehavior');
          return {
            bar: !!tab.querySelector('.kt-corpus-bar'),
            firstChildIsBar: tab.firstElementChild?.classList.contains('kt-corpus-bar') === true,
          };
        }, PROBE_EVENTS);
        assert.equal(seeded.bar, true, 'bar was never injected — auth or probe wiring changed');
        assert.equal(seeded.firstChildIsBar, true, 'bar must be the first child of the tab');

        // 150ms debounce + the /api/analyze-behavior round trip. This is the
        // window in which the bar used to be destroyed for good.
        await delay(1200);

        const after = await page.evaluate(() => {
          const tab = document.getElementById('tBehavior');
          return {
            bar: !!tab.querySelector('.kt-corpus-bar'),
            firstChildIsBar: tab.firstElementChild?.classList.contains('kt-corpus-bar') === true,
            barCount: tab.querySelectorAll('.kt-corpus-bar').length,
            saveButtons: tab.querySelectorAll('[data-action="open-corpus-save"]').length,
            // Proof the destructive re-paint really happened: findings are
            // only ever rendered by the engine response, never by the fast path.
            engineRepainted: !!tab.querySelector('.behavior-findings'),
          };
        });
        assert.equal(
          after.engineRepainted,
          true,
          'engine never re-painted — case is not exercised',
        );
        assert.equal(after.bar, true, 'corpus bar was wiped by the engine re-paint');
        assert.equal(after.barCount, 1, 'exactly one bar, never a duplicate');
        assert.equal(
          after.saveButtons,
          1,
          'the save button is the only entry point and must exist',
        );
        assert.equal(after.firstChildIsBar, true, 'bar must stay at the top after the re-paint');

        // …and it goes away honestly when there is nothing left to save.
        const emptied = await page.evaluate(() => {
          /** @type {any} */ (window).__ortbtoolsBehavior.events = [{ kind: 'probe_ready', ts: 1 }];
          /** @type {any} */ (window).renderBehaviorTab();
          const tab = document.getElementById('tBehavior');
          return !!tab.querySelector('.kt-corpus-bar');
        });
        assert.equal(emptied, false, 'no events must mean no corpus bar');

        assert.deepEqual(pageErrors, []);
        await page.close();
      });

      // ── 2. One save per click, however fast the clicking ────────────────
      await t.test('double-clicking save writes exactly one corpus entry', async () => {
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        await page.setViewport({ width: 1440, height: 900 });

        let posts = 0;
        await page.setRequestInterception(true);
        page.on('request', async (req) => {
          if (req.url().includes('/api/behavior/corpus') && req.method() === 'POST') {
            posts += 1;
            // Hold the response open so the second click lands mid-flight —
            // the exact race the guard exists for.
            await delay(600);
            return req.continue();
          }
          req.continue();
        });

        await page.goto(server.url + '/en/inspector', { waitUntil: 'networkidle2' });
        await page.waitForSelector('#tBehavior', { timeout: 20000 });
        await page.evaluate((events) => {
          /** @type {any} */ (window).__ortbtoolsBehavior =
            /** @type {any} */ (window).__ortbtoolsBehavior || {};
          /** @type {any} */ (window).__ortbtoolsBehavior.events = events;
          /** @type {any} */ (window).renderBehaviorTab();
          /** @type {any} */ (document.querySelector('[data-action="open-corpus-save"]')).click();
        }, PROBE_EVENTS);

        await page.waitForSelector('[data-action="confirm-corpus-save"]', { timeout: 10000 });
        const mid = await page.evaluate(async () => {
          const btn = /** @type {any} */ (
            document.querySelector('[data-action="confirm-corpus-save"]')
          );
          btn.click();
          await new Promise((r) => setTimeout(r, 80));
          const disabled = btn.disabled;
          btn.click();
          // Also go around the DOM entirely: a disabled attribute does not
          // stop a programmatic call, only the in-flight flag does.
          /** @type {any} */ (window).confirmCorpusSave();
          return { disabled };
        });
        assert.equal(mid.disabled, true, 'the save button must disable itself while saving');

        await delay(2000);

        const listed = await page.evaluate(async () => {
          const r = await fetch('/api/behavior/corpus');
          return r.json();
        });
        assert.equal(posts, 1, `expected one POST, saw ${posts}`);
        assert.equal(listed.entries.length, 1, 'a double-click must not duplicate the corpus row');
        assert.equal(listed.counts.total, 1);

        assert.deepEqual(pageErrors, []);
        await page.close();
      });

      // ── 3. /insights tells the truth and can be asked to refresh ────────
      await t.test('insights: bars match their labels, figures are never clipped', async () => {
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        let summaryHits = 0;
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          if (req.url().includes('/api/v1/analytics/summary')) {
            summaryHits += 1;
            return req.respond({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(SUMMARY_FIXTURE),
            });
          }
          req.continue();
        });

        for (const [w, h] of [
          [1440, 900],
          [1024, 800],
          [390, 844],
        ]) {
          await page.setViewport({ width: w, height: h });
          await page.goto(server.url + '/en/insights', { waitUntil: 'networkidle2' });
          await page.waitForSelector('.ins-kpis', { timeout: 20000 });
          await delay(300);

          const seen = await page.evaluate(() => ({
            rows: Array.from(document.querySelectorAll('.ins-find-row')).map((row) => ({
              share: row.querySelector('.ins-find-share').textContent.trim(),
              width: /** @type {any} */ (row.querySelector('.ins-find-fill')).style.width,
              countClient: row.querySelector('.ins-find-count').clientWidth,
              countScroll: row.querySelector('.ins-find-count').scrollWidth,
              countText: row.querySelector('.ins-find-count').textContent.trim(),
            })),
            kpis: Array.from(document.querySelectorAll('.ins-kpi__value')).map((el) => ({
              text: el.textContent.trim(),
              client: el.clientWidth,
              scroll: el.scrollWidth,
            })),
            docWidth: document.documentElement.clientWidth,
            docScroll: document.documentElement.scrollWidth,
            activityTitle: Array.from(document.querySelectorAll('.ins-card__title'))
              .map((el) => el.textContent.trim())
              .find((s) => /activity/i.test(s)),
          }));

          assert.equal(seen.rows.length, 3, `three severity rows at ${w}px`);
          for (const row of seen.rows) {
            // The label and the picture must come off the same denominator.
            const share = Number.parseFloat(row.share);
            const width = Number.parseFloat(row.width);
            assert.ok(
              Math.abs(share - width) < 0.1,
              `at ${w}px "${row.share}" was drawn as ${row.width}`,
            );
            assert.ok(
              row.countScroll <= row.countClient,
              `count "${row.countText}" clipped at ${w}px (${row.countScroll} > ${row.countClient})`,
            );
          }
          // The fixture puts a six-digit figure in the count column on purpose.
          assert.ok(
            seen.rows.some((r) => r.countText.replace(/\D/g, '').length >= 6),
            'fixture must exercise a count of 100 000 or more',
          );

          for (const kpi of seen.kpis) {
            assert.ok(
              kpi.scroll <= kpi.client,
              `KPI "${kpi.text}" clipped at ${w}px (${kpi.scroll} > ${kpi.client})`,
            );
          }
          assert.ok(
            seen.docScroll <= seen.docWidth,
            `page scrolls sideways at ${w}px (${seen.docScroll} > ${seen.docWidth})`,
          );

          // The card counts /api/analyze calls, not the /live stream.
          assert.equal(seen.activityTitle, 'Analysis activity');
        }

        // Manual refresh exists and actually fetches.
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(server.url + '/en/insights', { waitUntil: 'networkidle2' });
        await page.waitForSelector('.ins-kpis', { timeout: 20000 });
        await delay(200);

        let before = summaryHits;
        await page.click('#ins-refresh-now');
        await delay(500);
        assert.equal(summaryHits - before, 1, 'the Refresh button must fetch');

        // Arming a cadence refreshes immediately instead of waiting a tick…
        before = summaryHits;
        await page.select('#ins-refresh-select', '15');
        await delay(500);
        assert.equal(summaryHits - before, 1, 'picking a cadence must fetch at once');

        // …and switching it off must not fetch at all.
        before = summaryHits;
        await page.select('#ins-refresh-select', '0');
        await delay(500);
        assert.equal(summaryHits - before, 0, '"Refresh: off" must not fire a request');

        assert.deepEqual(pageErrors, []);
        await page.close();
      });

      // ── 4. The failure state is not a dead end ──────────────────────────
      await t.test('insights: a failed load offers a retry that works', async () => {
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        await page.setViewport({ width: 1280, height: 800 });

        let fail = true;
        let hits = 0;
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          if (req.url().includes('/api/v1/analytics/summary')) {
            hits += 1;
            if (fail) {
              return req.respond({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, error: 'analytics_failed' }),
              });
            }
            return req.respond({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(SUMMARY_FIXTURE),
            });
          }
          req.continue();
        });

        await page.goto(server.url + '/en/insights', { waitUntil: 'networkidle2' });
        await page.waitForSelector('[data-ins-retry]', { timeout: 20000 });

        const state = await page.evaluate(() =>
          document.querySelector('#ins-status-state').textContent.trim(),
        );
        assert.equal(state, 'unavailable');

        fail = false;
        const before = hits;
        await page.click('[data-ins-retry]');
        await page.waitForSelector('.ins-kpis', { timeout: 10000 });
        assert.equal(hits - before, 1, 'retry must issue exactly one request');

        const recovered = await page.evaluate(() => ({
          state: document.querySelector('#ins-status-state').textContent.trim(),
          retryGone: !document.querySelector('[data-ins-retry]'),
        }));
        assert.equal(recovered.state, 'ready');
        assert.equal(recovered.retryGone, true, 'the error card must be replaced on success');

        assert.deepEqual(pageErrors, []);
        await page.close();
      });
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (server) await stopChild(server.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
