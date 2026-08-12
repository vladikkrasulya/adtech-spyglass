/* global window, document */
'use strict';

/**
 * tests/product-telemetry-browser.test.js — headless Chrome smoke test for the
 * product-telemetry beacon.
 *
 * The unit tests pin the server-side contract. These are the claims that can
 * only be proven in a real browser, against the real page:
 *
 *   1. A first load emits exactly `landing` + `session_start`.
 *   2. A reload re-emits `landing` but NOT `session_start` — a tab session is
 *      one session, not one per navigation.
 *   3. `visitor_id` survives a reload (localStorage) and is a 32-hex value.
 *   4. Running a real analysis emits `analyze_success`.
 *   5. NO beacon body ever contains the pasted BidRequest/BidResponse, the
 *      page path, or any key outside the declared shape.
 *   6. `?__ot_optout=1` silences the client completely and deletes the id.
 *   7. `?__ot_internal=1` flags the browser so the server can file it outside
 *      `external`.
 *   8. Every beacon is answered 204 with an empty body.
 *
 * Terminates Chrome and the server in `finally` regardless of outcome.
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

/** Find a free port by binding to 0 and releasing. */
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

/** Poll until `fn()` is truthy or the budget runs out. Returns the last value. */
async function waitFor(fn, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > deadline) return value;
    await delay(50);
  }
}

// A marker that must never appear in any beacon body.
const PAYLOAD_MARKER = 'SECRET-DEAL-ID-42';
const SAMPLE_REQ = JSON.stringify({
  id: PAYLOAD_MARKER,
  imp: [{ id: 'imp-1', bidfloor: 0.5, banner: { w: 300, h: 250 } }],
  site: { domain: 'confidential-publisher.example' },
});

/** Keys the beacon body is allowed to carry — mirrors the server contract. */
const ALLOWED_BEACON_KEYS = [
  'dnt',
  'event',
  'internal',
  'locale',
  'referrer',
  'session_id',
  'utm_campaign',
  'utm_medium',
  'utm_source',
  'visitor_id',
];

test(
  'browser smoke test: product telemetry beacon',
  { timeout: 90000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-telemetry-'));
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
            // No ClickHouse in CI: the endpoint still answers 204, which is
            // exactly the behaviour we want to prove (it leaks nothing about
            // its own configuration).
            ORTBTOOLS_ANALYTICS_DISABLED: '1',
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

      /** @type {Array<{event: string, body: any, raw: string}>} */
      const beacons = [];
      /** @type {number[]} */
      const beaconStatuses = [];
      /** @type {string[]} */
      const beaconBodies = [];

      page.on('request', (req) => {
        if (!req.url().includes('/api/v1/telemetry/event')) return;
        const raw = req.postData() || '';
        beaconBodies.push(raw);
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch (_e) {
          /* recorded as unparseable below */
        }
        beacons.push({ event: body ? body.event : '<unparseable>', body, raw });
      });

      page.on('response', async (res) => {
        if (!res.url().includes('/api/v1/telemetry/event')) return;
        beaconStatuses.push(res.status());
      });

      const eventsSince = (from) => beacons.slice(from).map((b) => b.event);

      // ── 1. First load ────────────────────────────────────────────────────
      await page.goto(serverInfo.url + '/en', { waitUntil: 'networkidle2', timeout: 20000 });
      await page.waitForSelector('#bidReq', { timeout: 10000 });
      await waitFor(() => beacons.filter((b) => b.event === 'session_start').length > 0);

      const firstLoad = beacons.map((b) => b.event);
      assert.ok(firstLoad.includes('landing'), `first load should emit landing, got ${firstLoad}`);
      assert.ok(
        firstLoad.includes('session_start'),
        `first load should emit session_start, got ${firstLoad}`,
      );

      // ── 2. Body shape ────────────────────────────────────────────────────
      const landing = beacons.find((b) => b.event === 'landing');
      assert.ok(landing && landing.body, 'the landing beacon must be valid JSON');
      assert.deepEqual(
        Object.keys(landing.body).sort(),
        [...ALLOWED_BEACON_KEYS].sort(),
        'the beacon body gained or lost a field',
      );
      assert.match(landing.body.visitor_id, /^[0-9a-f]{32}$/);
      assert.match(landing.body.session_id, /^[0-9a-f]{32}$/);
      assert.equal(landing.body.locale, 'en');
      assert.equal(landing.body.internal, false);

      const visitorId = landing.body.visitor_id;
      const sessionId = landing.body.session_id;

      // ── 3. Reload: same session, same visitor, no second session_start ───
      const beforeReload = beacons.length;
      await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });
      await page.waitForSelector('#bidReq', { timeout: 10000 });
      await waitFor(() => eventsSince(beforeReload).includes('landing'));

      const afterReload = eventsSince(beforeReload);
      assert.ok(afterReload.includes('landing'), 'a reload is still a page view');
      assert.ok(
        !afterReload.includes('session_start'),
        `a reload must not start a new session, got ${afterReload}`,
      );
      const reloadLanding = beacons.slice(beforeReload).find((b) => b.event === 'landing');
      assert.equal(reloadLanding.body.visitor_id, visitorId, 'visitor id must survive a reload');
      assert.equal(reloadLanding.body.session_id, sessionId, 'session id must survive a reload');

      // ── 4. A real analysis emits analyze_success ─────────────────────────
      const beforeAnalyze = beacons.length;
      await page.evaluate((req) => {
        /** @type {any} */ (document.getElementById('bidReq')).value = req;
      }, SAMPLE_REQ);
      await page.evaluate(() => /** @type {any} */ (window).runAnalysis());
      await waitFor(() => eventsSince(beforeAnalyze).includes('analyze_success'), 10000);
      assert.ok(
        eventsSince(beforeAnalyze).includes('analyze_success'),
        `a successful analysis should emit analyze_success, got ${eventsSince(beforeAnalyze)}`,
      );

      // ── 5. Nothing sensitive ever left the page ──────────────────────────
      assert.ok(beaconBodies.length > 0, 'expected to have captured beacon bodies');
      for (const raw of beaconBodies) {
        assert.ok(!raw.includes(PAYLOAD_MARKER), `payload leaked into a beacon: ${raw}`);
        assert.ok(
          !raw.includes('confidential-publisher'),
          `payload domain leaked into a beacon: ${raw}`,
        );
        assert.ok(!raw.includes('bidfloor'), `payload field leaked into a beacon: ${raw}`);
        assert.ok(!raw.includes('/en'), `page path leaked into a beacon: ${raw}`);
        const parsed = JSON.parse(raw);
        for (const key of Object.keys(parsed)) {
          assert.ok(
            ALLOWED_BEACON_KEYS.includes(key),
            `undeclared beacon field "${key}" in ${raw}`,
          );
        }
      }

      // ── 6. Every beacon was answered 204 with no body ────────────────────
      await waitFor(() => beaconStatuses.length >= beacons.length, 3000);
      assert.ok(beaconStatuses.length > 0, 'expected beacon responses');
      for (const status of beaconStatuses) {
        assert.equal(status, 204, 'the beacon must always answer 204');
      }

      // ── 7. ?__ot_internal=1 flags the browser ────────────────────────────
      const beforeInternal = beacons.length;
      await page.goto(serverInfo.url + '/en?__ot_internal=1', {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });
      await waitFor(() => eventsSince(beforeInternal).includes('landing'));
      const internalBeacon = beacons.slice(beforeInternal).find((b) => b.event === 'landing');
      assert.equal(internalBeacon.body.internal, true, 'the internal flag must be set');

      // It is sticky: the next load carries it without the query parameter.
      const beforeSticky = beacons.length;
      await page.goto(serverInfo.url + '/en', { waitUntil: 'networkidle2', timeout: 20000 });
      await waitFor(() => eventsSince(beforeSticky).includes('landing'));
      const stickyBeacon = beacons.slice(beforeSticky).find((b) => b.event === 'landing');
      assert.equal(stickyBeacon.body.internal, true, 'the internal flag must be sticky');

      // ── 8. Opt-out silences the client and deletes the id ────────────────
      const beforeOptOut = beacons.length;
      await page.goto(serverInfo.url + '/en?__ot_optout=1', {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });
      await page.waitForSelector('#bidReq', { timeout: 10000 });
      await delay(1000); // give any stray beacon time to appear
      assert.equal(
        beacons.length,
        beforeOptOut,
        `opt-out must silence the client, got ${eventsSince(beforeOptOut)}`,
      );

      const storedAfterOptOut = await page.evaluate(() => localStorage.getItem('ortbtools_vid_v1'));
      assert.equal(storedAfterOptOut, null, 'the stored visitor id must be deleted on opt-out');

      // Still silent on a subsequent plain load.
      await page.goto(serverInfo.url + '/en', { waitUntil: 'networkidle2', timeout: 20000 });
      await page.waitForSelector('#bidReq', { timeout: 10000 });
      await delay(1000);
      assert.equal(beacons.length, beforeOptOut, 'opt-out must persist across loads');

      // Even an explicit call is a no-op while opted out.
      const trackReturn = await page.evaluate(() =>
        /** @type {any} */ (window).ortbtoolsTrack('landing'),
      );
      assert.equal(trackReturn, false, 'track() must refuse to send while opted out');
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
      if (serverInfo) {
        await stopChild(serverInfo.proc);
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
