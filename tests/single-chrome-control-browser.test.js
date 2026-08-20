/* global document, getComputedStyle */
'use strict';

/**
 * tests/single-chrome-control-browser.test.js — one control per job.
 *
 * WHY THIS EXISTS
 * ---------------
 * The v1.14 redesign gave the rail the mockup's bottom block — an account
 * row and a theme toggle — without removing the topbar's copies of the same
 * two controls. The result was visible to the user before it was visible to
 * any test: two theme toggles and two account entries on one screen, and of
 * the two theme buttons only the topbar's actually worked, so which one you
 * pressed decided whether anything happened.
 *
 * The layout audit missed it because the pair differ in every attribute a
 * text- or action-based comparison looks at: one reads "Dark" and carries
 * data-action="toggle-theme", the other reads "◐" and carries a class. They
 * are the same control only by FUNCTION, which is the thing this file names
 * explicitly — a small list of jobs, each of which the interface may offer
 * exactly once.
 *
 * Visibility is the whole question, so this runs in a real browser: the
 * topbar's nodes still exist and are still written to (the topbar module
 * owns the auth fetch and needs a place to put the result), they are simply
 * not shown. A DOM-presence test would fail on a correct page.
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

/**
 * Jobs the chrome may offer exactly once, each described by what it DOES
 * rather than by how it is written. Selectors are unions on purpose: a
 * second implementation of the same job is precisely what this catches.
 */
const JOBS = [
  {
    job: 'switch the theme',
    selector: '.kt-theme-toggle, [data-action="toggle-theme"], .theme-toggle',
  },
  {
    job: 'reach the account / sign in',
    selector:
      '.kt-topbar__signin, .kt-topbar__profile, #authWidget button, #authWidget a, .kt-nav__account, [data-action="open-auth"]',
  },
  {
    job: 'collapse the navigation rail',
    selector: '[data-action="collapse-nav"], [data-action="toggle-nav"]',
  },
];

const ROUTES = ['/inspector', '/live', '/library', '/dialects', '/insights', '/docs'];

test(
  'browser: the chrome offers each job exactly once, on every route',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-chrome-'));
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

      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 1000 });

      for (const route of ROUTES) {
        await page.goto(`${serverInfo.url}${route}`, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        await delay(2200);

        const found = await page.evaluate((jobs) => {
          const out = {};
          for (const { job, selector } of jobs) {
            out[job] = [...document.querySelectorAll(selector)]
              .filter((el) => {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return false;
                if (/** @type {any} */ (el).hidden) return false;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              })
              .map((el) => {
                const r = el.getBoundingClientRect();
                const where = el.closest('#kt-nav-root')
                  ? 'rail'
                  : el.closest('.kt-topbar')
                    ? 'topbar'
                    : el.closest('.workbar')
                      ? 'workbar'
                      : 'elsewhere';
                const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20);
                return `${where}:"${text}"@${Math.round(r.x)},${Math.round(r.y)}`;
              });
          }
          return out;
        }, JOBS);

        for (const { job } of JOBS) {
          const hits = found[job];
          assert.equal(
            hits.length,
            1,
            `${route}: "${job}" is offered ${hits.length} times — ${hits.join('  ')}. ` +
              'Two controls for one job means the user has to guess which is live, and on ' +
              'the theme toggle exactly that happened: one of the two did nothing.',
          );
        }
      }

      // The single theme control must also WORK — a lone dead button passes a
      // count and fails a user. But "works" is not "one press flips
      // data-theme", and asserting that is how this check spent four days
      // failing on CI while passing on every developer machine.
      //
      // The control cycles THREE states — auto → the value opposite what is on
      // screen → the system-matching value → auto — stored
      // under 'kt-theme' by the head IIFE in public/index.*.html, which owns
      // that key. `data-theme` carries only the RESOLVED theme, so it is only
      // ever 'light' or 'dark'. Three states over two appearances means one
      // press in the cycle cannot repaint; 007 moved that press onto the
      // return INTO auto, where an unchanged appearance is correct, and off
      // the first press out of auto, which every new visitor makes. A
      // two-state assertion calls the whole arrangement a failure. Developer machines here run a
      // dark desktop, so the assertion happened to hold locally and broke on
      // GitHub's light-defaulting runner — the classic shape of a test that
      // encodes its author's environment.
      //
      // So: pin the media feature instead of inheriting it, start from a known
      // auto, and walk the whole cycle. Liveness — the thing this check is
      // actually for — is that the resolved theme reaches BOTH values over one
      // cycle. A dead button cannot do that.
      for (const scheme of ['light', 'dark']) {
        const sys = scheme;
        const opp = scheme === 'dark' ? 'light' : 'dark';
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
        await page.goto(`${serverInfo.url}/inspector`, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        await delay(2200);
        await page.evaluate(() => {
          try {
            localStorage.removeItem('kt-theme');
          } catch (_e) {
            /* blocked storage degrades to auto, which is the state we want */
          }
        });
        await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
        await delay(2200);

        const readState = () =>
          page.evaluate(() => {
            const label = document.querySelector('[data-theme-label]');
            let stored = null;
            try {
              stored = localStorage.getItem('kt-theme');
            } catch (_e) {
              stored = null;
            }
            return {
              stored,
              resolved: document.documentElement.getAttribute('data-theme'),
              label: label ? (label.textContent || '').trim() : null,
            };
          });

        const pressTheme = () =>
          page.evaluate(() => {
            const all = [
              ...document.querySelectorAll('.kt-theme-toggle, [data-action="toggle-theme"]'),
            ];
            const visible = all.find((e) => e.getBoundingClientRect().width > 0);
            /** @type {any} */ (visible || all[0]).click();
          });

        const walk = [await readState()];
        for (let i = 0; i < 3; i += 1) {
          await pressTheme();
          await delay(600);
          walk.push(await readState());
        }

        const trail = walk
          .map((s) => `${s.stored === null ? 'auto' : s.stored}/${s.resolved}`)
          .join(' → ');

        assert.deepEqual(
          walk.map((s) => s.stored),
          [null, opp, sys, null],
          `${scheme}: the theme control did not walk auto → ${opp} → ${sys} → auto (${trail})`,
        );

        const resolvedSeen = new Set(walk.map((s) => s.resolved));
        assert.ok(
          resolvedSeen.has('light') && resolvedSeen.has('dark'),
          `the one visible theme control never reached both resolved themes — a dead ` +
            `button looks exactly like this (${trail})`,
        );

        // The press that does not move the resolved theme must still say
        // something, or the user presses a button and the interface answers with
        // nothing at all.
        assert.notEqual(
          walk[0].resolved,
          walk[1].resolved,
          `${scheme}: the first press out of auto must repaint — that is the press every ` +
            `new visitor makes (${trail})`,
        );

        assert.equal(
          walk[2].resolved,
          walk[3].resolved,
          `${scheme}: the silent press must be the return into auto, not any other (${trail})`,
        );

        assert.notEqual(
          walk[3].label,
          walk[2].label,
          `${scheme}: the press into auto left the label unchanged at "${walk[2].label}", so the ` +
            `one press that cannot repaint gives the user no feedback either`,
        );
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
