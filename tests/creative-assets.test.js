'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
function harness(t, fetcher) {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = fetcher;
  dom.window.eval(
    fs.readFileSync(path.join(__dirname, '../public/modules/inspector/creative-assets.js'), 'utf8'),
  );
  return dom.window.OrtbtoolsCreativeAssets;
}
const good = () => ({ ok: true, json: async () => ({ ok: true, dataUri: PNG }) });

test('asset manifest: responsive/CSS references deduplicate; complete document and nonimage sources survive rewriting', async (t) => {
  const calls = [];
  const api = harness(t, async (_url, options) => {
    calls.push(JSON.parse(options.body).url);
    return good();
  });
  const html = `<!DOCTYPE html><html lang="en"><head><title>Kept</title><style>
  @font-face {font-family:test;src:url("https://fonts.example.test/f.woff2")}
  @import url("https://styles.example.test/remote.css");
  @media(min-width:1px){.card {width:240px;background-image:url('https://img.example.test/a.png')}}
  .label::after {content:"url(https://not-image.example.test/string.png)"}
  .responsive {background-image:image-set("https://img.example.test/a.png" 1x, url(https://img.example.test/b.png) 2x)}
  </style><script src="https://scripts.example.test/script.js"></script></head><body>
  <picture><source srcset="https://img.example.test/a.png 1x, https://img.example.test/b.png 2x"><img src="https://img.example.test/a.png"></picture>
  <video src="https://video.example.test/v.mp4" poster="https://img.example.test/poster.png"><source srcset="https://video.example.test/not-image.mp4"></video>
  <div style="background: url(https://img.example.test/c.png) no-repeat; font-family:test"></div>
  <a href="https://img.example.test/a.png">https://img.example.test/a.png</a>
  <iframe src="https://frames.example.test/f"></iframe></body></html>`;
  const manifest = api.createManifest(html);
  assert.deepEqual(
    Array.from(manifest.entries, (e) => e.url).sort(),
    ['a.png', 'b.png', 'c.png', 'poster.png'].map((v) => 'https://img.example.test/' + v).sort(),
  );
  const res = await api.inlineAssets(html, { manifest });
  assert.equal(calls.length, 4);
  assert.match(res.html, /^<!DOCTYPE html>/);
  assert.match(res.html, /<head><title>Kept<\/title><style>/);
  assert.match(res.html, /width:240px/);
  assert.match(res.html, /https:\/\/fonts.example.test\/f.woff2/);
  assert.match(res.html, /https:\/\/styles.example.test\/remote.css/);
  assert.match(res.html, /href="https:\/\/img.example.test\/a.png"/);
  assert.match(res.html, />https:\/\/img.example.test\/a.png<\/a>/);
  assert.ok(res.html.includes('srcset="' + PNG + ' 1x, ' + PNG + ' 2x"'));
});

test('asset cap is explicit and retry fetches unresolved resources only', async (t) => {
  const calls = [];
  let fail = true;
  const api = harness(t, async (_url, options) => {
    const url = JSON.parse(options.body).url;
    calls.push(url);
    return url.endsWith('/1.png') && fail
      ? { ok: false, json: async () => ({ code: 'timeout' }) }
      : good();
  });
  const html = Array.from(
    { length: 15 },
    (_, i) => `<img src="https://img.example.test/${i}.png">`,
  ).join('');
  const manifest = api.createManifest(html);
  assert.equal(manifest.total, 15);
  assert.equal(manifest.entries.length, 12);
  assert.equal(manifest.omitted, 3);
  const first = await api.inlineAssets(html, { manifest });
  assert.equal(first.inlined, 11);
  assert.equal(first.failed.length, 1);
  fail = false;
  const second = await api.inlineAssets(html, { manifest });
  assert.equal(second.inlined, 1);
  assert.equal(calls.length, 13);
  assert.equal(calls.at(-1), 'https://img.example.test/1.png');
  assert.ok(manifest.entries.every((entry) => entry.status === 'loaded'));
  assert.equal((await api.inlineAssets(html, { manifest })).inlined, 0);
  assert.equal(calls.length, 13);
});

test('asset cancellation stops the queue and ignores a late response; invalid data cannot weaken the raster boundary', async (t) => {
  const controller = new AbortController();
  const calls = [];
  const api = harness(t, async (_url, options) => {
    calls.push(JSON.parse(options.body).url);
    controller.abort(); // Simulate a response delivered after selection was replaced.
    return good();
  });
  const html =
    '<img src="https://img.example.test/a.png"><img src="https://img.example.test/b.png">';
  const manifest = api.createManifest(html);
  const res = await api.inlineAssets(html, { manifest, signal: controller.signal });
  assert.equal(calls.length, 1);
  assert.equal(res.inlined, 0);
  assert.equal(res.cancelled, true);
  assert.equal(res.html, html);
  const unsafe = harness(t, async () => ({
    ok: true,
    json: async () => ({ ok: true, dataUri: 'data:image/svg+xml,<svg onload="alert(1)"/>' }),
  }));
  assert.equal((await unsafe.inlineAssets(html)).inlined, 0);
});
