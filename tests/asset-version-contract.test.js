'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createStaticAssets } = require('../lib/static-assets');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-assets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, text) => {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  write(
    'shell.js',
    "import view from '/modules/view/index.js'; export { value } from './shared.js';",
  );
  write('shared.js', 'export const value = 1;');
  write('core/modal.css', 'dialog { color: red; }');
  write(
    'modules/view/index.js',
    "export const version = '__VIEW_BUNDLE_HASH__'; const css = '/core/modal.css';",
  );
  write('modules/view/style.css', '.view { color: red; }');
  write('modules/view/template.en.html', '<main class="view">Old</main>');
  return { dir, write, assets: createStaticAssets(dir) };
}

test('asset identity hashes exactly the final JS including bundle tokens and relative imports', (t) => {
  const { assets } = fixture(t);
  const body = assets.render('/shell.js');
  const expected = 'a2-' + crypto.createHash('sha256').update(body).digest('hex');
  assert.equal(assets.version('/shell.js'), expected);
  assert.match(body.toString(), /from '\/shared\.js\?v=a2-[a-f0-9]{64}'/);
  const moduleBody = assets.render('/modules/view/index.js').toString();
  assert.doesNotMatch(moduleBody, /__VIEW_BUNDLE_HASH__/);
  assert.match(moduleBody, /\/core\/modal\.css\?v=a2-[a-f0-9]{64}/);
});

test('template-only, external style and relative dependency edits invalidate their importers', (t) => {
  const { assets, write } = fixture(t);
  let previous = assets.version('/shell.js');
  for (const [file, source] of [
    ['modules/view/template.en.html', '<main class="view">New</main>'],
    ['core/modal.css', 'dialog { color: blue; }'],
    ['shared.js', 'export const value = 2;'],
  ]) {
    write(file, source);
    const current = assets.version('/shell.js');
    assert.notEqual(current, previous, file);
    previous = current;
  }
});

test('side-effect imports are versioned; comment examples do not create false self dependencies', (t) => {
  const { assets, write } = fixture(t);
  write(
    'side.js',
    "// import '/side.js';\n/* import './side.js'; */\nimport './shared.js';\nconst url = 'https://example.test/';",
  );
  const body = assets.render('/side.js').toString();
  assert.match(body, /import '\/shared\.js\?v=a2-[a-f0-9]{64}'/);
  assert.match(body, /\/\/ import '\/side\.js';/);
  assert.match(body, /https:\/\/example\.test\//);
});

test('bundle identities distinguish filename changes and content boundaries', (t) => {
  const { assets, write, dir } = fixture(t);
  write('modules/view/a.txt', 'ab');
  write('modules/view/b.txt', 'c');
  const first = assets.bundleVersion('view');
  write('modules/view/a.txt', 'a');
  write('modules/view/b.txt', 'bc');
  assert.notEqual(assets.bundleVersion('view'), first);
  const second = assets.bundleVersion('view');
  fs.renameSync(path.join(dir, 'modules/view/a.txt'), path.join(dir, 'modules/view/z.txt'));
  assert.notEqual(assets.bundleVersion('view'), second);
});

test('only exact supported versions are immutable; stale and malformed requests fail closed', (t) => {
  const { assets } = fixture(t);
  const file = '/modules/view/style.css';
  const version = assets.version(file);
  const bundle = assets.bundleVersion('view');
  for (const token of [version, bundle]) {
    assert.equal(assets.cachePolicy(file, `${file}?v=${token}`).status, 200);
    assert.match(
      assets.cachePolicy(file, `${file}?v=${token}`).headers['Cache-Control'],
      /immutable/,
    );
  }
  for (const query of ['v=deadbeef', 'v=', `v=${version}&v=${version}`, 'v=%ZZ', 'v=a2-deadbeef']) {
    const response = assets.cachePolicy(file, `${file}?${query}`);
    assert.equal(response.status, 409, query);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['CDN-Cache-Control'], 'no-store');
  }
  assert.equal(assets.cachePolicy(file, `${file}?other=1&v=${version}`).status, 200);
  assert.equal(assets.cachePolicy(file, file).headers['Cache-Control'], 'no-cache');
  assert.equal(
    assets.cachePolicy('/modules/view/index.js', `/modules/view/index.js?v=${bundle}`).status,
    409,
  );
});

test('old module CSS and template cannot receive new bytes under their old bundle identity', (t) => {
  const { assets, write } = fixture(t);
  const old = assets.bundleVersion('view');
  const template = '/modules/view/template.en.html';
  assert.match(
    assets.cachePolicy(template, `${template}?v=${old}`).headers['Cache-Control'],
    /immutable/,
  );
  write('modules/view/template.en.html', '<main class="new-view">New markup</main>');
  assert.equal(assets.cachePolicy(template, `${template}?v=${old}`).status, 409);
  assert.equal(
    assets.cachePolicy('/modules/view/style.css', `/modules/view/style.css?v=${old}`).status,
    409,
  );
  assert.equal(
    assets.cachePolicy('/index.html', '/index.html').headers['Cache-Control'],
    'no-cache',
  );
});

test('real origin serves exact gzip-decoded identities and rejects invented versions before returning bytes', async (t) => {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (listener.address()).port;
  await new Promise((resolve) => listener.close(resolve));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-asset-origin-'));
  const root = path.join(__dirname, '..');
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
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
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('asset origin did not start')), 15000);
    const check = (chunk) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timeout);
        resolve(undefined);
      }
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.once('error', reject);
  });
  const base = `http://127.0.0.1:${port}`;
  const shell = await fetch(base + '/inspector');
  assert.equal(shell.headers.get('cache-control'), 'no-cache');
  const html = await shell.text();
  const scriptUrl = html.match(/\/shell-boot\.js\?v=a2-[a-f0-9]{64}/)[0];
  const script = await fetch(base + scriptUrl, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(script.status, 200);
  assert.equal(script.headers.get('content-encoding'), 'gzip');
  const body = await script.text();
  const version = 'a2-' + crypto.createHash('sha256').update(body).digest('hex');
  assert.equal(new URL(scriptUrl, base).searchParams.get('v'), version);
  assert.match(script.headers.get('cache-control'), /immutable/);
  const inspector = await fetch(base + '/modules/inspector/index.js');
  const inspectorText = await inspector.text();
  const bundle = inspectorText.match(/const ASSET_VERSION = '(m2-[a-f0-9]{64})'/)[1];
  const template = await fetch(base + `/modules/inspector/template.uk.html?v=${bundle}`);
  assert.equal(template.status, 200);
  assert.match(template.headers.get('cache-control'), /immutable/);
  for (const request of [
    '/modules/inspector/inspector.css?v=deadbeef',
    '/modules/inspector/template.uk.html?v=deadbeef',
    scriptUrl + '&v=' + version,
  ]) {
    const response = await fetch(base + request);
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
    assert.equal(await response.text(), 'asset_version_unavailable');
  }
});
