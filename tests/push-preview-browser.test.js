/* global document, window */
'use strict';

/**
 * Browser contract for the push creative preview (spec 014).
 *
 * A push material's creative is the material itself — icon (#1 per the owner),
 * large image (#2), title/description, click link. These cases prove the
 * Inspector synthesizes a notification card from it and pipes that card through
 * the SAME probed, sandboxed, srcdoc-based pipeline banner and native
 * creatives use — and that payload-controlled strings enter the document only
 * entity-escaped. Structural source checks cannot prove any of that; a real
 * browser can.
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

const browserSkipReason = !puppeteer
  ? `puppeteer-core unavailable: ${puppeteerLoadError}`
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

// Synthetic replica of the reported material (013 fixture discipline — never
// the production record).
const MATERIAL = {
  tId: '00000000-0000-4000-8000-000000000001',
  title: 'Synthetic push headline',
  description: 'Synthetic push body text for the preview',
  icon: 'https://ads.example.com/icn.png',
  image: 'https://ads.example.com/img.jpg',
  link: 'https://ads.example.com/click',
  linkTtl: 1900000000000,
  cpc: 0.01,
  crid: 'SYNTHETICCRID000000000000000000',
  cid: 'SYNTHETICCID0000000000000000000',
};

async function analyzePush(page, payload) {
  await page.evaluate((res) => {
    /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value = '';
    /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value = res;
    /** @type {any} */ (window).runAnalysis();
  }, JSON.stringify(payload));
  await page.waitForFunction(
    () => {
      const el = document.getElementById('creativePreview');
      if (!el) return false;
      if (el.querySelector('iframe')) return true;
      const empty = el.querySelector('.preview-empty');
      return empty ? 'empty' : false;
    },
    { timeout: 15000 },
  );
  return page.evaluate(() => {
    const el = document.getElementById('creativePreview');
    const iframe = el.querySelector('iframe');
    return {
      hasIframe: !!iframe,
      sandbox: iframe ? iframe.getAttribute('sandbox') : null,
      srcdoc: iframe ? String(iframe.srcdoc || '') : '',
      text: el.innerText || '',
      priceChip: (document.getElementById('mPrice') || {}).innerText || '',
    };
  });
}

test(
  'browser: push material renders the synthetic notification card through the probed sandbox',
  { timeout: 180000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-pushprev-'));
    const port = await getFreePort();
    let serverInfo = null;
    let browser = null;
    try {
      serverInfo = await startServer(port, dataDir);
      browser = await puppeteer.launch({
        headless: true,
        protocolTimeout: 120000,
        executablePath: chromeExecutable,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const page = await browser.newPage();
      await page.goto(serverInfo.url + '/inspector', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // ── US1: full material → card in the probed sandboxed frame ──────────
      const full = await analyzePush(page, MATERIAL);
      assert.ok(full.hasIframe, 'expected a preview iframe for the push material');
      assert.equal(full.sandbox, 'allow-scripts', 'frame policy must stay allow-scripts-only');
      assert.ok(full.srcdoc.includes(MATERIAL.icon), 'icon URL must be in the card');
      assert.ok(full.srcdoc.includes(MATERIAL.image), 'image URL must be in the card');
      assert.ok(full.srcdoc.includes('Synthetic push headline'), 'title must be in the card');
      assert.ok(
        full.srcdoc.includes('Synthetic push body text for the preview'),
        'description must be in the card',
      );
      assert.ok(full.srcdoc.includes(MATERIAL.link), 'click destination must be on the card');
      assert.ok(
        full.srcdoc.includes('push · synthetic render'),
        'card must be labeled as a synthetic push render',
      );
      assert.match(
        full.srcdoc,
        /PROBE_CHANNEL = '[0-9a-f]{48}'/,
        'card must travel the probed pipeline',
      );
      assert.ok(
        !full.text.includes('No renderable creative'),
        'empty state must not appear beside the card',
      );
      // The frame CSP blocks remote images by design; the card must inherit
      // the standing explicit "load assets" action (server-side inlining) so
      // the icon and image are one click away, like remote banner art.
      const inlineOffer = await page.evaluate(() => {
        const btn = document.querySelector('.creative-inline-assets');
        return btn ? btn.textContent : null;
      });
      assert.ok(inlineOffer, 'load-assets action must be offered for the push card');
      assert.ok(/2/.test(inlineOffer), `offer must count both images, got "${inlineOffer}"`);

      // ── FR-004: payload-controlled markup enters only entity-escaped ─────
      const hostile = await analyzePush(page, {
        ...MATERIAL,
        title: '<img src=x onerror=alert(1)>',
      });
      assert.ok(hostile.hasIframe, 'hostile-title material still renders a card');
      assert.ok(
        hostile.srcdoc.includes('&lt;img src=x onerror=alert(1)&gt;'),
        'hostile title must appear entity-escaped',
      );
      assert.ok(
        !hostile.srcdoc.includes('<img src=x onerror=alert(1)>'),
        'hostile title must not appear as raw markup',
      );

      // ── FR-005: icon-only and image-only materials still render ──────────
      const iconOnly = await analyzePush(page, {
        tId: 't-icon',
        title: 'Icon only',
        icon: 'https://ads.example.com/icn.png',
        link: 'https://ads.example.com/click',
        cpc: 0.02,
      });
      assert.ok(iconOnly.hasIframe, 'icon-only material must render a card');
      assert.ok(iconOnly.srcdoc.includes('https://ads.example.com/icn.png'));

      const imageOnly = await analyzePush(page, {
        tId: 't-img',
        image: 'https://ads.example.com/img.jpg',
        link: 'https://ads.example.com/click',
        price: 0.03,
      });
      assert.ok(imageOnly.hasIframe, 'image-only material must render a card');
      assert.ok(imageOnly.srcdoc.includes('https://ads.example.com/img.jpg'));

      // ── US2 (FR-002): the list form previews its first material ──────────
      const arr = await analyzePush(page, [MATERIAL]);
      assert.ok(arr.hasIframe, 'one-element materials array must render the same card');
      assert.ok(arr.srcdoc.includes(MATERIAL.icon), 'array form: icon URL in the card');
      assert.ok(arr.srcdoc.includes(MATERIAL.image), 'array form: image URL in the card');
      assert.ok(arr.srcdoc.includes('push · synthetic render'));

      // ── US3 (FR-006): the price chip shows the material's cpc ────────────
      const priced = await analyzePush(page, MATERIAL);
      assert.ok(
        priced.priceChip.includes('0.01'),
        `price chip must show the material cpc, got "${priced.priceChip}"`,
      );
      assert.ok(!/^BID$/.test(priced.priceChip.trim()), 'price chip must not fall back to BID');
    } finally {
      if (browser) await browser.close();
      if (serverInfo) await stopServer(serverInfo.proc);
    }
  },
);
