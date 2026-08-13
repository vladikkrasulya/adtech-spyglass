/* global window, document */
'use strict';

/**
 * tests/gists-browser.test.js — end-to-end encrypted share links.
 *
 * The server contract is covered by tests/gists.test.js. These are the claims
 * only a real browser can settle, because they are about what crosses the wire
 * and what a URL fragment does:
 *
 *   1. A payload too large for a fragment link offers a gist, and only after an
 *      explicit confirmation. Declining uploads nothing.
 *   2. The upload carries ciphertext and nothing else — no key, no plaintext.
 *   3. The key never appears in any real network request, and the recipient
 *      fetches the bundle by id alone.
 *   4. Opening the link restores both payloads intact, and the transport itself
 *      (compress → encrypt → decrypt → decompress) is byte-for-byte lossless.
 *      Those are two separate assertions on purpose: the Inspector re-indents
 *      whatever lands in a pane, so pane text is compared as parsed JSON while
 *      byte fidelity is proven at the layer that actually owes it.
 *   5. A tampered key fails closed rather than yielding garbage.
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

async function waitFor(fn, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return value;
    await delay(75);
  }
}

/**
 * Past the 7000-char fragment budget, carrying markers that must not travel.
 *
 * The content has to be HIGH ENTROPY. buildShareUrl deflates before base64, and
 * a payload of near-identical imps compresses to a couple of KB — it would slip
 * under the budget and never reach the gist path at all. Per-imp SHA-256 digests
 * are incompressible, so the fixture stays large for the reason a real auction
 * would: it genuinely carries a lot of distinct data.
 */
const MARKER = 'CONFIDENTIAL-DEAL-7f3a';
const SECRET_DOMAIN = 'secret-publisher.example';
const noise = (seed) => require('node:crypto').createHash('sha256').update(seed).digest('hex');
const BIG_REQUEST = JSON.stringify({
  id: MARKER,
  site: { domain: SECRET_DOMAIN, page: `https://${SECRET_DOMAIN}/x` },
  imp: Array.from({ length: 200 }, (_, i) => ({
    id: `imp-${i}`,
    bidfloor: 0.5 + i / 1000,
    banner: { w: 300, h: 250, mimes: ['image/png', 'image/jpeg'] },
    ext: { deal: noise(`deal-${i}`), token: noise(`token-${i}`) },
  })),
});
const BIG_RESPONSE = JSON.stringify({
  id: 'resp-1',
  cur: 'USD',
  seatbid: [
    { seat: 'dsp-a', bid: [{ id: 'b1', impid: 'imp-0', price: 1.23, adomain: ['x.example'] }] },
  ],
});

test(
  'browser smoke test: encrypted share links',
  { timeout: 150000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-gists-b-'));
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
            // 'info', not 'warn': readiness is detected from the "listening"
            // line, which pino emits at info level.
            LOG_LEVEL: 'info',
            ORTBTOOLS_DATA_DIR: dataDir,
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

      const context = browser.defaultBrowserContext();
      await context.overridePermissions(serverInfo.url, ['clipboard-read', 'clipboard-write']);

      const page = await browser.newPage();

      /** Every request the page makes, so we can prove what did NOT travel. */
      let requests = [];
      page.on('request', (req) => {
        requests.push({ url: req.url(), body: req.postData() || '' });
      });

      let dialogText = '';
      let dialogAction = 'dismiss';
      /** The share module falls back to prompt() when the clipboard is blocked. */
      let promptedUrl = '';
      page.on('dialog', async (d) => {
        if (d.type() === 'prompt') {
          promptedUrl = d.defaultValue();
          await d.dismiss();
          return;
        }
        dialogText = d.message();
        if (dialogAction === 'accept') await d.accept();
        else await d.dismiss();
      });

      const fillPanes = () =>
        page.evaluate(
          (req, res) => {
            /** @type {any} */ (document.getElementById('bidReq')).value = req;
            /** @type {any} */ (document.getElementById('bidRes')).value = res;
          },
          BIG_REQUEST,
          BIG_RESPONSE,
        );

      await page.goto(serverInfo.url + '/en', { waitUntil: 'networkidle2', timeout: 20000 });
      await page.waitForSelector('#bidReq', { timeout: 10000 });
      await fillPanes();

      // ── 1. Declining the prompt must upload nothing ───────────────────────
      requests = [];
      await page.evaluate(() => /** @type {any} */ (window).copyShareLink());
      await waitFor(async () => dialogText.length > 0);
      await delay(500);

      assert.match(
        dialogText,
        /encrypt/i,
        `the confirmation must explain the encryption trade, got: ${dialogText}`,
      );
      assert.equal(
        requests.filter((r) => r.url.includes('/api/v1/gists')).length,
        0,
        'declining the prompt must upload nothing',
      );

      // ── 2. Accepting uploads exactly one ciphertext body ──────────────────
      dialogAction = 'accept';
      requests = [];
      promptedUrl = '';
      await page.evaluate(() => /** @type {any} */ (window).copyShareLink());
      await waitFor(async () =>
        requests.some((r) => r.url.includes('/api/v1/gists') && r.body.length),
      );
      await delay(500);

      const uploads = requests.filter(
        (r) => r.url.includes('/api/v1/gists') && r.body && r.body.length,
      );
      assert.equal(uploads.length, 1, `expected exactly one upload, got ${uploads.length}`);

      const uploadBody = JSON.parse(uploads[0].body);
      assert.deepEqual(
        Object.keys(uploadBody).sort(),
        ['bundle_version', 'ciphertext', 'iv'],
        'the upload body gained a field — re-audit it against the privacy contract',
      );
      for (const leak of [MARKER, SECRET_DOMAIN, 'bidfloor', 'seatbid', 'imp-0']) {
        assert.ok(!uploads[0].body.includes(leak), `plaintext "${leak}" reached the server`);
      }

      // ── 3. Recover the link the user would paste ──────────────────────────
      const shareUrl =
        promptedUrl || (await page.evaluate(() => navigator.clipboard.readText().catch(() => '')));
      assert.ok(shareUrl, 'no share link was produced');
      assert.match(shareUrl, /#gist=[A-Za-z0-9_-]{22}&key=[A-Za-z0-9_-]{43}/, shareUrl);

      const key = shareUrl.split('&key=')[1];
      assert.ok(key && key.length >= 43, 'the link carries no usable key');

      // ── 4. The key crossed no wire ────────────────────────────────────────
      for (const r of requests) {
        assert.ok(!r.url.includes(key), `a request URL carried the key: ${r.url}`);
        assert.ok(!r.body.includes(key), 'a request body carried the key');
      }

      // ── 5. A fresh page restores both panes byte-for-byte ─────────────────
      const page2 = await browser.newPage();
      const requests2 = [];
      page2.on('request', (req) => {
        requests2.push({ url: req.url(), body: req.postData() || '' });
      });
      await page2.goto(shareUrl, { waitUntil: 'networkidle2', timeout: 20000 });
      await page2.waitForSelector('#bidReq', { timeout: 10000 });
      const restored = await waitFor(async () => {
        const v = await page2.evaluate(() => ({
          req: /** @type {any} */ (document.getElementById('bidReq')).value,
          res: /** @type {any} */ (document.getElementById('bidRes')).value,
        }));
        return v.req ? v : null;
      }, 15000);

      assert.ok(restored, 'the shared link did not populate the panes');

      // Nothing was lost or altered in transit. Compared as parsed JSON because
      // the Inspector re-indents whatever lands in a pane — ortbtools.app.js
      // rewrites both panes with JSON.stringify(…, null, 2) on every analysis,
      // for pasted input just as much as for a shared link. Byte-level fidelity
      // is the transport's job and is asserted separately below.
      assert.deepEqual(
        JSON.parse(restored.req),
        JSON.parse(BIG_REQUEST),
        'BidRequest did not survive the round trip',
      );
      assert.deepEqual(
        JSON.parse(restored.res),
        JSON.parse(BIG_RESPONSE),
        'BidResponse did not survive the round trip',
      );
      assert.ok(restored.req.includes(MARKER), 'the restored request lost its identifying field');

      // ── 5b. The transport itself is byte-for-byte lossless ────────────────
      // Same primitives the share module uses — deflate-raw plus the AES-GCM
      // content-key helpers — run over the exact fixture string. If compression
      // or encryption ever became lossy, the panes above could still look right
      // after re-serialisation while the bytes had quietly changed.
      const transportExact = await page2.evaluate(async (original) => {
        const enc = new TextEncoder().encode(original);
        const cs = new CompressionStream('deflate-raw');
        const w = cs.writable.getWriter();
        w.write(enc);
        w.close();
        const packed = new Uint8Array(await new Response(cs.readable).arrayBuffer());

        const api = /** @type {any} */ (window).OrtbtoolsCrypto;
        const { key } = await api.generateContentKey();
        const { iv, ct } = await api.encryptBytes(key, packed);
        const back = await api.decryptBytes(key, iv, ct);

        const ds = new DecompressionStream('deflate-raw');
        const w2 = ds.writable.getWriter();
        w2.write(back);
        w2.close();
        return (await new Response(ds.readable).text()) === original;
      }, BIG_REQUEST);
      assert.equal(transportExact, true, 'compress → encrypt → decrypt → decompress lost bytes');

      // The fragment must not have travelled on the way in either.
      //
      // The top-level navigation is excluded deliberately, and the exclusion is
      // not a loophole: a fragment is never placed in an HTTP request line, so
      // there is nothing on the wire to inspect. What puppeteer reports for a
      // navigation is the address the browser was asked to open — the address
      // bar, not the bytes sent. Every OTHER request is real network traffic
      // and is checked without exception.
      const subresources = requests2.filter((r) => r.url !== shareUrl);
      assert.ok(subresources.length > 0, 'no subresource requests captured to check');
      for (const r of subresources) {
        assert.ok(!r.url.includes(key), `a request URL carried the key on open: ${r.url}`);
        assert.ok(!r.body.includes(key), 'a request body carried the key on open');
      }

      // The positive half of the same claim: the recipient asked the server for
      // the bundle BY ID ALONE. The server had no opportunity to see a key.
      const fetches = requests2.filter((r) => r.url.includes('/api/v1/gists/'));
      assert.equal(fetches.length, 1, `expected one gist fetch, got ${fetches.length}`);
      const gistId = shareUrl.split('#gist=')[1].split('&')[0];
      assert.ok(
        fetches[0].url.endsWith(`/api/v1/gists/${gistId}`),
        `the gist was fetched with more than its id: ${fetches[0].url}`,
      );
      await page2.close();

      // ── 6. A tampered key fails closed ────────────────────────────────────
      const page3 = await browser.newPage();
      page3.on('dialog', async (d) => {
        await d.dismiss();
      });
      const flipped = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
      await page3.goto(shareUrl.replace(key, flipped), {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });
      await page3.waitForSelector('#bidReq', { timeout: 10000 });
      await delay(2500);
      const tampered = await page3.evaluate(
        () => /** @type {any} */ (document.getElementById('bidReq')).value,
      );
      assert.equal(tampered, '', 'a tampered key must not decrypt to anything');
      await page3.close();
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
