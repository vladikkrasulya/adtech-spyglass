'use strict';

/**
 * tests/site-server.test.js — the origin's answers: analytics, framing, SEO.
 *
 * WHY THIS EXISTS
 * ---------------
 * Five defects, all of them the server saying something untrue about a page.
 *
 * 1. /api/v1/analytics/summary answered 500 analytics_failed on every host
 *    without ClickHouse — including the configuration .env.example documents
 *    for self-hosting ("leave CLICKHOUSE_USER empty"). Three writers of that
 *    table honour lib/analytics-enabled; the reader did not, so Insights was a
 *    dead page plus a stack trace per auto-refresh tick. A disabled telemetry
 *    backend is an EMPTY dataset, not a fault.
 *
 * 2. The embed snippet's whole promise is "paste this into your blog". Every
 *    response carried frame-ancestors 'self' + X-Frame-Options: SAMEORIGIN, so
 *    the frame died on any third-party page. The fix is scoped: only the SPA
 *    shell, only with ?embed=1 — /account, /api/* and non-embed page loads keep
 *    the deny-by-default baseline, which is what the last four assertions here
 *    are really guarding.
 *
 * 3. /docs/findings (the 344-entry catalog) had no SECTION_SEO entry, so it
 *    served the INSPECTOR's title and canonical — telling Google the page does
 *    not exist apart from /inspector — and never reached the sitemap.
 *
 * 4. The kt-lang cookie steered /inspector but not /vast, /native, /openrtb/*,
 *    i.e. exactly the pages people arrive on from search.
 *
 * 5. A dead blog link answered 404 with the two words "Not Found" — no shell,
 *    no navigation, no locale, no way back. The pretty localized screen existed
 *    but only on the SPA path, which the person following a stale link never
 *    takes.
 *
 * WHAT IS ASSERTED, AND HOW
 * -------------------------
 * Through HTTP, against a real server process, in terms a visitor could check:
 * the status, the headers a browser enforces, the title/canonical a crawler
 * reads, and the words on the page. Two servers are booted — one with no
 * ClickHouse at all (the self-host shape) and one pointed at a stub ClickHouse
 * that answers "no such row", which is the only way to reach the confirmed-
 * absent branch behind the blog 404.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

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

function startServer(env) {
  return new Promise((resolve, reject) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-site-server-'));
    const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        ORTBTOOLS_DATA_DIR: dataDir,
        NEWS_CRAWLER_DISABLED: '1',
        FX_DISABLED: '1',
        ...env,
      },
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let started = false;
    const timer = setTimeout(() => {
      if (!started) {
        proc.kill('SIGKILL');
        reject(new Error('server did not start within 15s'));
      }
    }, 15000);
    const onData = (chunk) => {
      if (!started && chunk.toString().includes('listening')) {
        started = true;
        clearTimeout(timer);
        resolve({ proc, url: `http://127.0.0.1:${env.PORT}`, dataDir });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(timer);
        reject(new Error(`server exited ${code}`));
      }
    });
  });
}

function stopServer(started) {
  if (!started || !started.proc) return Promise.resolve();
  const proc = started.proc;
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => proc.kill('SIGKILL'), 2000);
    proc.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

/**
 * A stub ClickHouse. SELECTs answer "no rows" in whichever dialect the caller
 * asked for (lib/clickhouse uses JSONEachRow, the analytics module appends
 * FORMAT JSON); INSERTs are swallowed. Enough to make the server believe CH is
 * configured and reachable, which is what the confirmed-absent 404 branch and
 * the enabled-analytics path both require.
 */
function startStubClickHouse(rows) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const q = decodeURIComponent((req.url || '').replace(/^.*[?&]query=/, '').split('&')[0]);
      let chunks = '';
      req.on('data', (c) => (chunks += c));
      req.on('end', () => {
        if (/FORMAT JSON\s*$/i.test(q)) {
          const data = rows && rows[matchTable(q)] ? rows[matchTable(q)] : [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('');
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('net').AddressInfo} */ (srv.address()).port;
      resolve({ srv, url: `http://127.0.0.1:${port}` });
    });
  });
}

function matchTable(sql) {
  if (/toStartOfMinute/i.test(sql)) return 'activity';
  if (/sum\(error_count\)/i.test(sql)) return 'totals';
  if (/SELECT format/i.test(sql)) return 'format';
  if (/SELECT version/i.test(sql)) return 'version';
  return 'other';
}

async function get(url, opts = {}) {
  const resp = await fetch(url, { redirect: 'manual', ...opts });
  const text = await resp.text();
  return { status: resp.status, headers: resp.headers, text };
}

function jsonLdOf(html) {
  const m = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(m, 'the shell ships a JSON-LD block');
  return JSON.parse(m[1]);
}

function headOf(html) {
  const m = html.match(/<head>([\s\S]*?)<\/head>/i);
  return m ? m[1] : html;
}

function appRootOf(html) {
  const m = html.match(/<main id="app-root">([\s\S]*?)<\/main>/i);
  assert.ok(m, 'the served shell has an #app-root');
  return m[1];
}

// ── two servers: the self-host shape, and one with a stub ClickHouse ─────────
let plain = null; // no ClickHouse configured at all
let withCh = null; // CLICKHOUSE_USER set, stub answers
let stub = null;

before(async () => {
  const plainPort = await getFreePort();
  plain = await startServer({ PORT: String(plainPort), ORTBTOOLS_ANALYTICS_DISABLED: '1' });

  stub = await startStubClickHouse({
    activity: [{ minute: '2026-01-01 00:00:00', count: 7 }],
    totals: [{ errors: 3, warnings: 2, info: 1 }],
    format: [{ format: 'banner', count: 4 }],
    version: [{ version: '2.6', count: 4 }],
  });
  const chPort = await getFreePort();
  withCh = await startServer({
    PORT: String(chPort),
    CLICKHOUSE_URL: stub.url,
    CLICKHOUSE_USER: 'stub',
    CLICKHOUSE_PASSWORD: '',
  });
});

after(async () => {
  await stopServer(plain);
  await stopServer(withCh);
  if (stub) await new Promise((r) => stub.srv.close(r));
});

// ── 1. Insights without ClickHouse: an empty hour, not a 500 ────────────────
test('analytics summary answers an empty window when telemetry is off', async () => {
  const r = await get(`${plain.url}/api/v1/analytics/summary`);
  assert.equal(r.status, 200, 'a disabled backend is not a server fault');
  const body = JSON.parse(r.text);
  assert.equal(body.ok, true);
  assert.equal(body.enabled, false, 'the page can tell "off" from "quiet"');
  assert.equal(body.window, '1h');
  assert.equal(body.stream_activity.length, 60, 'the chart still gets its 60 buckets');
  assert.deepEqual(
    body.stream_activity.map((b) => b.count),
    new Array(60).fill(0),
  );
  assert.deepEqual(body.validation_totals, { errors: 0, warnings: 0, info: 0 });
  assert.deepEqual(body.format_mix, []);
  assert.deepEqual(body.version_mix, []);
});

test('analytics summary still reports real figures when ClickHouse is configured', async () => {
  const r = await get(`${withCh.url}/api/v1/analytics/summary`);
  assert.equal(r.status, 200);
  const body = JSON.parse(r.text);
  assert.equal(body.enabled, true, 'the gate must not swallow a working backend');
  assert.deepEqual(body.validation_totals, { errors: 3, warnings: 2, info: 1 });
  assert.deepEqual(body.format_mix, [{ format: 'banner', count: 4, pct: 100 }]);
  assert.deepEqual(body.version_mix, [{ version: '2.6', count: 4, pct: 100 }]);
});

// ── 2. Embed mode is frameable; nothing else moved ──────────────────────────
test('the embed shell may be framed by another site', async () => {
  const r = await get(`${plain.url}/inspector?embed=1`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-frame-options'), null, 'XFO has no "any origin" value — drop it');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors \*/);
});

test('the same page without ?embed=1 stays deny-by-default', async () => {
  const r = await get(`${plain.url}/inspector`);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
});

test('?embed=1 does not unlock the account page or the API', async () => {
  for (const p of ['/account?embed=1', '/about?embed=1', '/api/health?embed=1']) {
    const r = await get(`${plain.url}${p}`);
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN', `${p} must stay unframeable`);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/, p);
  }
});

test('the embed relaxation survives the / → /inspector hop the snippet takes', async () => {
  const r = await get(`${plain.url}/?embed=1`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/inspector?embed=1', 'embed=1 is carried over');
  assert.equal(r.headers.get('x-frame-options'), null);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors \*/);
});

// ── 3. /docs/findings is its own page ───────────────────────────────────────
test('/docs/findings carries its own title, canonical and hreflang cluster', async () => {
  const r = await get(`${plain.url}/docs/findings`);
  assert.equal(r.status, 200);
  const head = headOf(r.text);
  assert.match(head, /<link rel="canonical" href="https:\/\/ortbtools\.com\/docs\/findings" \/>/);
  assert.doesNotMatch(
    head,
    /<link rel="canonical" href="https:\/\/ortbtools\.com\/inspector" \/>/,
    'the catalog must stop declaring itself to be the inspector',
  );
  assert.match(head, /<title>[^<]*Finding Catalog[^<]*<\/title>/);
  assert.match(head, /hreflang="uk" href="https:\/\/ortbtools\.com\/uk\/docs\/findings"/);
  assert.match(head, /hreflang="ru" href="https:\/\/ortbtools\.com\/ru\/docs\/findings"/);
  assert.match(head, /<meta name="description" content="[^"]{40,}"/);
});

test('/uk/docs/findings is Ukrainian and self-canonical', async () => {
  const r = await get(`${plain.url}/uk/docs/findings`);
  const head = headOf(r.text);
  assert.match(
    head,
    /<link rel="canonical" href="https:\/\/ortbtools\.com\/uk\/docs\/findings" \/>/,
  );
  assert.match(head, /<title>Каталог знахідок[^<]*<\/title>/);
});

test('sitemap advertises the findings catalog in all three locales', async () => {
  const r = await get(`${plain.url}/sitemap.xml`);
  assert.equal(r.status, 200);
  for (const loc of [
    'https://ortbtools.com/docs/findings',
    'https://ortbtools.com/uk/docs/findings',
    'https://ortbtools.com/ru/docs/findings',
  ]) {
    assert.equal(r.text.split(`<loc>${loc}</loc>`).length - 1, 1, `${loc} listed exactly once`);
  }
});

// ── 4. The language you picked follows you onto the landing pages ───────────
test('kt-lang steers the SEO landings, not just the app sections', async () => {
  const cases = [
    ['/vast', 'uk', '/uk/vast'],
    ['/native', 'uk', '/uk/native'],
    ['/openrtb/2-6', 'ru', '/ru/openrtb/2-6'],
    ['/iab-categories', 'ru', '/ru/iab-categories'],
    ['/docs/findings', 'uk', '/uk/docs/findings'],
  ];
  for (const [from, lang, to] of cases) {
    const r = await get(`${plain.url}${from}`, { headers: { Cookie: `kt-lang=${lang}` } });
    assert.equal(r.status, 302, `${from} with kt-lang=${lang}`);
    assert.equal(r.headers.get('location'), to);
    assert.equal(r.headers.get('vary'), 'Cookie', 'the redirect depends on the cookie');
  }
});

test('a visitor without the cookie keeps the English landing', async () => {
  const r = await get(`${plain.url}/vast`);
  assert.equal(r.status, 200);
  assert.match(r.text, /<html lang="en">/);
});

// ── 5. Structured data describes the page it is on ─────────────────────────
test('JSON-LD on a landing names the landing, not the inspector', async () => {
  const r = await get(`${plain.url}/uk/vast`);
  const ld = jsonLdOf(r.text);
  assert.equal(ld.url, 'https://ortbtools.com/uk/vast');
  assert.equal(ld.inLanguage, 'uk');
  assert.match(ld.name, /Валідатор VAST/);
  assert.match(ld.description, /VAST/);
  // The head's canonical and the structured data must agree — they were two
  // different pages before.
  assert.match(
    headOf(r.text),
    /<link rel="canonical" href="https:\/\/ortbtools\.com\/uk\/vast" \/>/,
  );
});

test('JSON-LD on a blog post is an article, not a renamed web app', async () => {
  const r = await get(`${plain.url}/blog/en/welcome`);
  const ld = jsonLdOf(r.text);
  assert.equal(ld['@type'], 'BlogPosting');
  assert.equal(ld.url, 'https://ortbtools.com/blog/en/welcome');
  assert.equal(ld.applicationCategory, undefined, 'a post is not a DeveloperApplication');
});

// ── 6. The server-rendered post speaks the page's language ─────────────────
test('SSR post chrome is localized and links back inside the locale', async () => {
  const r = await get(`${plain.url}/uk/blog/uk/welcome`);
  assert.equal(r.status, 200);
  const article = appRootOf(r.text);
  assert.match(article, /<a class="blog-back" href="\/uk\/blog">← До блогу<\/a>/);
  assert.doesNotMatch(article, /← Blog/, 'no English chrome on a Ukrainian page');
  assert.match(article, /<div class="blog-post__cat">Гайди<\/div>/);
  assert.doesNotMatch(article, />guide</, 'the raw category key is not a label');
});

test('SSR post renders lists and code instead of flattening them', async () => {
  const r = await get(`${plain.url}/uk/blog/uk/welcome`);
  const article = appRootOf(r.text);
  assert.match(article, /<ul><li>/, 'markdown bullets become a real list');
  assert.doesNotMatch(article, /<p>- /, 'and not a paragraph of dashes');
  assert.match(article, /<code>\/blog\/rss\.xml<\/code>/, 'backticks become code');
});

test('SSR post prints the opening paragraph once', async () => {
  const r = await get(`${plain.url}/uk/blog/uk/welcome`);
  const article = appRootOf(r.text);
  const opening = 'Блог ortbtools — це місце';
  assert.equal(article.split(opening).length - 1, 1, 'summary + body no longer double up');
});

test('an English post keeps English chrome', async () => {
  const r = await get(`${plain.url}/blog/en/welcome`);
  const article = appRootOf(r.text);
  assert.match(article, /<a class="blog-back" href="\/blog">← Back to blog<\/a>/);
});

// ── 7. A dead post link lands on a page, not on two words ──────────────────
test('a missing post answers 404 with the localized screen and a way back', async () => {
  const r = await get(`${withCh.url}/uk/blog/uk/no-such-post`);
  assert.equal(r.status, 404, 'still a real 404 for crawlers');
  assert.notEqual(r.text.trim(), 'Not Found', 'but not a bare-text dead end');
  assert.match(r.text, /<main id="app-root">/, 'the shell (nav, topbar, chrome) is served');
  const article = appRootOf(r.text);
  assert.match(article, /Пост не знайдено\./);
  assert.match(article, /<a class="blog-back" href="\/uk\/blog">← До блогу<\/a>/);
  assert.match(headOf(r.text), /<meta name="robots" content="noindex,follow" \/>/);
});

test('a missing post in the EN shell is answered in English', async () => {
  const r = await get(`${withCh.url}/blog/en/no-such-post`);
  assert.equal(r.status, 404);
  const article = appRootOf(r.text);
  assert.match(article, /Post not found\./);
  assert.match(article, /<a class="blog-back" href="\/blog">← Back to blog<\/a>/);
});

test('an existing post is unaffected by the 404 path', async () => {
  const r = await get(`${withCh.url}/blog/en/welcome`);
  assert.equal(r.status, 200);
  assert.match(appRootOf(r.text), /blog-post__body/);
});
