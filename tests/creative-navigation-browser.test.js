/* global document, window */
'use strict';

/**
 * A sandboxed `allow-scripts` creative frame cannot reach the parent, but a
 * sandbox does not stop the frame navigating ITSELF, and a content policy has
 * no word for WebRTC. This browser contract pins both closures against a real
 * Chromium: no navigation of the preview frame leaves its srcdoc document, and
 * no STUN/ICE packet leaves the machine, while an ordinary creative still renders.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

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

const SAMPLE_REQ = JSON.stringify({
  id: 'creative-navigation-request',
  imp: [{ id: 'imp-1', banner: { w: 300, h: 250 } }],
  site: { domain: 'example.test' },
});

function responseWithAdm(adm) {
  return JSON.stringify({
    id: 'creative-navigation-response',
    cur: 'USD',
    seatbid: [
      { seat: 'test-seat', bid: [{ id: 'bid-1', impid: 'imp-1', price: 1, w: 300, h: 250, adm }] },
    ],
  });
}

async function analyze(page, adm) {
  await page.evaluate(
    (req, res) => {
      /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value = req;
      /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value = res;
      /** @type {any} */ (window).runAnalysis();
    },
    SAMPLE_REQ,
    responseWithAdm(adm),
  );
}

test(
  'browser: a preview frame cannot navigate away or open a WebRTC channel',
  { timeout: 120000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-nav-'));
    const port = await getFreePort();

    // A stand-in for "somewhere else": any HTTP request or UDP datagram it sees
    // is a request that left the preview.
    const httpHits = [];
    const outside = http.createServer((req, res) => {
      httpHits.push(req.url);
      res.end('outside');
    });
    await new Promise((resolve) => outside.listen(0, '127.0.0.1', () => resolve(undefined)));
    const outsidePort = /** @type {import('node:net').AddressInfo} */ (outside.address()).port;
    const udpHits = [];
    const stun = dgram.createSocket('udp4');
    stun.on('message', () => udpHits.push(1));
    await new Promise((resolve) => stun.bind(0, '127.0.0.1', () => resolve(undefined)));
    const stunPort = stun.address().port;

    let serverInfo = null;
    let browser = null;
    try {
      serverInfo = await startServer(port, dataDir);
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

      const out = `http://127.0.0.1:${outsidePort}`;
      const navigations = {
        'location assignment': `<script>location.href='${out}/loc'</script>`,
        'meta refresh': `<meta http-equiv="refresh" content="0;url=${out}/refresh">`,
        'anchor click': `<a id="a" href="${out}/a">x</a><script>document.getElementById('a').click()</script>`,
        'data: document': `<script>location.href='data:text/html,<p>phish</p>'</script>`,
        'blob: document': `<script>location.href=URL.createObjectURL(new Blob(['<p>phish</p>'],{type:'text/html'}))</script>`,
        'own origin': `<script>location.href='/inspector'</script>`,
        'form submit': `<form id="f" action="${out}/form"></form><script>document.getElementById('f').submit()</script>`,
      };

      for (const [name, adm] of Object.entries(navigations)) {
        const page = await browser.newPage();
        try {
          await page.goto(serverInfo.url + '/inspector', {
            waitUntil: 'networkidle2',
            timeout: 30000,
          });
          await page.waitForSelector('#bidReq', { timeout: 10000 });
          await analyze(page, adm);
          await page.waitForSelector('#creativePreview iframe', { timeout: 8000 });
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const handle = await page.$('#creativePreview iframe');
          assert.ok(handle, `${name}: preview frame missing`);
          const frame = await handle.contentFrame();
          assert.ok(frame, `${name}: preview frame has no content frame`);
          // A refused navigation leaves the frame on the browser's own error
          // document; what must never happen is a load of anything else.
          assert.match(
            frame.url(),
            /^(about:srcdoc|chrome-error:\/\/chromewebdata\/)$/u,
            `${name}: the preview frame must not load another document`,
          );
        } finally {
          await page.close();
        }
      }
      assert.deepEqual(httpHits, [], 'no request may reach a host the creative chose');

      const rtc = await browser.newPage();
      try {
        await rtc.goto(serverInfo.url + '/inspector', {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        await rtc.waitForSelector('#bidReq', { timeout: 10000 });
        const webrtcAdm =
          `<script>window.addEventListener('load',function(){var r='';try{` +
          `var p=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${stunPort}'}]});` +
          `p.createDataChannel('x');p.createOffer().then(function(o){return p.setLocalDescription(o)});` +
          `r='constructed'}catch(e){r='refused'}` +
          `Object.defineProperty(window,'__rtc',{value:r});` +
          `try{Object.defineProperty(window,'RTCPeerConnection',{value:function(){}});r+='+restored'}catch(e){}` +
          `window.__rtcRestore=r;});</script><div>rtc</div>`;
        await analyze(rtc, webrtcAdm);
        await rtc.waitForSelector('#creativePreview iframe', { timeout: 8000 });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const frame = await (await rtc.$('#creativePreview iframe')).contentFrame();
        assert.ok(frame);
        assert.equal(
          await frame.evaluate(() => /** @type {any} */ (window).__rtc),
          'refused',
          'RTCPeerConnection must not be constructible inside the preview',
        );
        assert.equal(
          await frame.evaluate(() => /** @type {any} */ (window).__rtcRestore),
          'refused',
          'the creative must not be able to put the constructor back',
        );
        assert.equal(udpHits.length, 0, 'no STUN datagram may leave the preview');
      } finally {
        await rtc.close();
      }

      // A nested frame gets a fresh window, which would still have the WebRTC
      // constructors. Every route to a nested document the creative can write
      // (markup, attribute and property setters, string-to-element APIs,
      // script-scheme URLs) must leave the socket silent.
      const CLOSE = '</' + 'script>';
      const probe = `var p=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${stunPort}'}]});p.createDataChannel('x');p.createOffer().then(function(o){return p.setLocalDescription(o)});`;
      const nestedDoc = `<script>try{${probe}}catch(e){}${CLOSE}`;
      const attr = nestedDoc.replace(/"/g, '&quot;');
      const js = (text) => JSON.stringify(text).replace(/<\//g, '<\\/');
      const nested = {
        'markup srcdoc': `<iframe srcdoc="${attr}"></iframe>`,
        'markup srcdoc, odd spelling': `<IFRAME/SRCDOC="${attr}"></IFRAME>`,
        'markup srcdoc after a > in an attribute': `<iframe title=">" srcdoc="${attr}"></iframe>`,
        'markup script-scheme src': `<iframe src="java&Tab;script:${encodeURIComponent(probe)}"></iframe>`,
        'markup srcdoc in a template': `<template id="t"><iframe srcdoc="${attr}"></iframe></template><script>document.documentElement.appendChild(document.getElementById('t').content.cloneNode(true))${CLOSE}`,
        'setAttribute srcdoc': `<script>var f=document.createElement('iframe');f.setAttribute('srcdoc',${js(nestedDoc)});document.documentElement.appendChild(f)${CLOSE}`,
        'srcdoc property': `<script>var f=document.createElement('iframe');f.srcdoc=${js(nestedDoc)};document.documentElement.appendChild(f)${CLOSE}`,
        'script-scheme src property': `<script>var f=document.createElement('iframe');f.src='java'+'script:'+${js(encodeURIComponent(probe))};document.documentElement.appendChild(f)${CLOSE}`,
        insertAdjacentHTML: `<div id="d"></div><script>document.getElementById('d').insertAdjacentHTML('beforeend','<iframe srcdoc="'+${js(attr)}+'"></iframe>')${CLOSE}`,
        'document.write': `<script>document.write('<iframe srcdoc="'+${js(attr)}+'"></iframe>')${CLOSE}`,
        createContextualFragment: `<script>document.documentElement.appendChild(document.createRange().createContextualFragment('<iframe srcdoc="'+${js(attr)}+'"></iframe>'))${CLOSE}`,
        DOMParser: `<script>var d=new DOMParser().parseFromString('<iframe srcdoc="'+${js(attr)}+'"></iframe>','text/html');document.documentElement.appendChild(document.adoptNode(d.querySelector('iframe')))${CLOSE}`,
        'shadow root innerHTML': `<div id="d"></div><script>document.getElementById('d').attachShadow({mode:'open'}).innerHTML='<iframe srcdoc="'+${js(attr)}+'"></iframe>'${CLOSE}`,
        'attribute node': `<script>var f=document.createElement('iframe');var a=document.createAttribute('srcdoc');a.value=${js(nestedDoc)};f.attributes.setNamedItem(a);document.documentElement.appendChild(f)${CLOSE}`,
      };
      for (const [name, adm] of Object.entries(nested)) {
        const page = await browser.newPage();
        try {
          await page.goto(serverInfo.url + '/inspector', {
            waitUntil: 'networkidle2',
            timeout: 30000,
          });
          await page.waitForSelector('#bidReq', { timeout: 10000 });
          await analyze(page, adm);
          await page.waitForSelector('#creativePreview iframe', { timeout: 8000 });
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } finally {
          await page.close();
        }
        assert.equal(udpHits.length, 0, `${name}: no STUN datagram may leave a nested frame`);
      }

      // The inspector must still show an ordinary creative.
      const ok = await browser.newPage();
      try {
        await ok.goto(serverInfo.url + '/inspector', {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        await ok.waitForSelector('#bidReq', { timeout: 10000 });
        await analyze(ok, '<div id="ordinary" style="width:300px;height:250px">hello</div>');
        await ok.waitForSelector('#creativePreview iframe', { timeout: 8000 });
        await new Promise((resolve) => setTimeout(resolve, 800));
        const frame = await (await ok.$('#creativePreview iframe')).contentFrame();
        assert.ok(frame);
        assert.equal(await frame.$eval('#ordinary', (el) => el.textContent), 'hello');
      } finally {
        await ok.close();
      }
    } finally {
      if (browser) await browser.close();
      await stopServer(serverInfo && serverInfo.proc);
      outside.close();
      stun.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
