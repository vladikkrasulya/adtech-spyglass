/* global document, getComputedStyle */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (_error) {
  // Browser dependencies are optional on hosts running only the unit suite.
}
const chrome = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((candidate) => {
  if (!candidate) return false;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch (_error) {
    return false;
  }
});

async function startServer(dataDir) {
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('node:net').AddressInfo} */ (socket.address()).port;
      socket.close(() => resolve(port));
    });
  });
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      ORTBTOOLS_DATA_DIR: dataDir,
      ORTBTOOLS_ANALYTICS_DISABLED: '1',
      NEWS_CRAWLER_DISABLED: '1',
      FX_DISABLED: '1',
    },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Typography test app startup timed out'));
    }, 15000);
    const ready = (chunk) => {
      if (!String(chunk).includes('listening')) return;
      clearTimeout(timer);
      resolve(undefined);
    };
    proc.stdout.on('data', ready);
    proc.stderr.on('data', ready);
    proc.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Typography test app exited ${code}`));
    });
  });
  return { proc, base: `http://127.0.0.1:${port}` };
}

test(
  'browser: localized account and article typography retain hierarchy across desktop widths',
  {
    timeout: 120000,
    skip: !puppeteer ? 'puppeteer-core unavailable' : !chrome && 'Set CHROME_BIN to run Chrome',
  },
  async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-typography-'));
    const artifactDir = process.env.ORTBTOOLS_UI_ARTIFACTS;
    if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });
    let server;
    let browser;
    try {
      server = await startServer(dataDir);
      browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      const errors = [];
      for (const locale of ['en', 'uk', 'ru']) {
        for (const theme of ['light', 'dark']) {
          const page = await browser.newPage();
          page.on('pageerror', (error) => errors.push(String(error)));
          let authenticated = true;
          const title = {
            en: 'Saved OpenRTB example for a long partner integration name ',
            uk: 'Збережений приклад OpenRTB для інтеграції з довгою назвою партнера ',
            ru: 'Сохранённый пример OpenRTB для интеграции с длинным названием партнёра ',
          }[locale];
          const samples = [title.repeat(5), 'OpenRTB_'.repeat(60)].map((title, i) => ({
            id: 9001 + i,
            title,
            created_at: 1788868800000 - i * 1000,
            is_encrypted: Boolean(i),
            status: 'clean',
          }));
          await page.setRequestInterception(true);
          page.on('request', (request) => {
            const url = new URL(request.url());
            if (url.origin !== server.base) {
              return url.protocol === 'data:' ? request.continue() : request.abort();
            }
            if (!url.pathname.startsWith('/api/')) return request.continue();
            // Synthetic API responses keep the real rendering path while never
            // requiring a login, a private account, or a production database.
            const responses = {
              '/api/auth/me': {
                user: authenticated
                  ? { id: 1, email: 'typography@example.test', email_verified_at: 1788868800000 }
                  : null,
              },
              '/api/samples': { samples },
              '/api/partners': { partners: [] },
              '/api/account/insights': { insights: { total: 0 } },
              '/api/dialects': { dialects: [] },
              '/api/behavior/corpus': { entries: [], counts: { total: 0 } },
              '/api/behavior/corpus/matrix': { matrix: null },
              '/api/v1/blog/post': {
                ok: true,
                post: {
                  slug: 'typography-fixture',
                  lang: locale,
                  title: title.trim(),
                  category: 'guide',
                  published_at: '2026-09-08T12:00:00Z',
                  source: 'markdown',
                  body: '# Overview\n\n## Details\n\n### Example\n\n#### Notes\n\nReadable article text.',
                },
              },
            };
            return request.respond({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(responses[url.pathname] || {}),
            });
          });
          await page.evaluateOnNewDocument(
            (theme) => localStorage.setItem('kt-theme', theme),
            theme,
          );
          const prefix = locale === 'en' ? '' : `/${locale}`;
          await page.setViewport({ width: 1280, height: 900 });
          await page.goto(`${server.base}${prefix}/account#library`);
          await page.waitForSelector('#recentList .cab-recent__title', { visible: true });
          await page.evaluate(() => document.fonts.ready);

          for (const width of [1280, 1366, 1440, 1536, 1920, 2560, 3440]) {
            await page.setViewport({ width, height: 1080 });
            const label = `${locale}/${theme}/${width}`;
            const metrics = await page.evaluate(() => ({
              bodyFamily: getComputedStyle(document.body).fontFamily,
              headings: [...document.querySelectorAll('#library .cab-card h2')].map((el) =>
                Number.parseFloat(getComputedStyle(el).fontSize),
              ),
              documentOverflow:
                document.documentElement.scrollWidth - document.documentElement.clientWidth,
              rows: [...document.querySelectorAll('#recentList li')].map((row) => {
                const title = row.querySelector('.cab-recent__title');
                const meta = row.querySelector('.cab-recent__meta');
                const state = row.querySelector('.cab-recent__state');
                const titleStyle = getComputedStyle(title);
                const bounds = row.getBoundingClientRect();
                return {
                  titleSize: Number.parseFloat(titleStyle.fontSize),
                  metaSize: Number.parseFloat(getComputedStyle(meta).fontSize),
                  titleFamily: titleStyle.fontFamily,
                  ellipsis: titleStyle.textOverflow,
                  titleRight: title.getBoundingClientRect().right,
                  stateLeft: state.getBoundingClientRect().left,
                  stateRight: state.getBoundingClientRect().right,
                  rowRight: bounds.right,
                  rowOverflow: row.scrollWidth - row.clientWidth,
                  text: title.textContent,
                };
              }),
            }));
            assert.equal(
              metrics.rows.length,
              samples.length,
              `${label}: both recent samples render`,
            );
            assert.ok(metrics.headings.length > 0, `${label}: library headings render`);
            assert.ok(
              metrics.headings.every((size) => size === 20),
              `${label}: card heading scale`,
            );
            assert.ok(metrics.documentOverflow <= 1, `${label}: document fits viewport`);
            for (const [index, row] of metrics.rows.entries()) {
              assert.equal(row.text, samples[index].title, `${label}: full sample title retained`);
              assert.equal(row.titleSize, 13, `${label}: sample name remains compact`);
              assert.equal(row.metaSize, 11, `${label}: ID/date remain secondary metadata`);
              assert.equal(
                row.titleFamily,
                metrics.bodyFamily,
                `${label}: human title uses body font`,
              );
              assert.equal(row.ellipsis, 'ellipsis', `${label}: long title truncates visibly`);
              assert.ok(row.titleRight <= row.stateLeft, `${label}: title does not cover state`);
              assert.ok(row.stateRight <= row.rowRight + 1, `${label}: state stays inside row`);
              assert.ok(row.rowOverflow <= 1, `${label}: long sample row does not overflow`);
            }
            if (artifactDir && locale !== 'ru' && [1366, 1920].includes(width)) {
              await page.screenshot({
                path: path.join(artifactDir, `account-library-${locale}-${theme}-${width}.png`),
                fullPage: true,
              });
            }
          }

          authenticated = false;
          await page.goto(`${server.base}${prefix}/account`);
          await page.waitForSelector('#cabGate h1', { visible: true });
          for (const width of [1366, 1920, 390]) {
            await page.setViewport({ width, height: 900 });
            const size = await page.$eval('#cabGate h1', (el) =>
              Number.parseFloat(getComputedStyle(el).fontSize),
            );
            assert.equal(
              size,
              width < 600 ? 20 : 28,
              `${locale}/${theme}/${width}: gate heading scale`,
            );
            if (artifactDir && locale !== 'ru' && width !== 390) {
              await page.screenshot({
                path: path.join(artifactDir, `account-gate-${locale}-${theme}-${width}.png`),
                fullPage: true,
              });
            }
          }

          await page.setViewport({ width: 1280, height: 900 });
          await page.goto(`${server.base}${prefix}/blog/${locale}/typography-fixture`);
          await page.waitForSelector('.blog-post__body h4', { visible: true });
          for (const width of [1366, 1920]) {
            await page.setViewport({ width, height: 1080 });
            const headings = await page.$$eval(
              '.blog-post__title, .blog-post__body h1, .blog-post__body h2, .blog-post__body h3, .blog-post__body h4',
              (els) => els.map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
            );
            assert.deepEqual(
              headings,
              [28, 28, 20, 17, 15],
              `${locale}/${theme}/${width}: article headings respect the title hierarchy`,
            );
            if (artifactDir && locale !== 'ru') {
              await page.screenshot({
                path: path.join(artifactDir, `blog-article-${locale}-${theme}-${width}.png`),
                fullPage: true,
              });
            }
          }
          if (locale === 'en' && theme === 'dark') {
            // At compact desktop widths the document owns vertical scrolling.
            // A desktop-only overflow lock previously trapped the footer below
            // the viewport between the mobile and full desktop breakpoints.
            await page.setViewport({ width: 912, height: 800 });
            await page.goto(`${server.base}/inspector`);
            await page.waitForSelector('#bidReq', { visible: true });
            await page.waitForSelector('.app-footer');
            await page.mouse.move(456, 750);
            await page.mouse.wheel({ deltaY: 4000 });
            await page.waitForFunction(
              () => document.querySelector('.app-footer').getBoundingClientRect().bottom <= 801,
              { timeout: 3000 },
            );
            const scrollTop = await page.evaluate(() => document.scrollingElement.scrollTop);
            assert.ok(scrollTop > 0, '912px Inspector document scroll reaches the footer');

            const historyCases = [
              ['clean', 'clean', 'healthy'],
              ['warnings', 'warnings', 'warning'],
              ['invalid', 'invalid payload', 'critical'],
              ['errors', 'critical errors', 'critical'],
              ['local', 'local', 'neutral'],
              ['Critical', 'critical errors', 'critical'],
              ['Healthy', 'clean', 'healthy'],
              ['Invalid', 'invalid payload', 'critical'],
              ['Valid', 'clean', 'healthy'],
              ['pending', 'pending', 'neutral'],
              ['constructor', 'constructor', 'neutral'],
              ['__proto__', '__proto__', 'neutral'],
            ];
            await page.evaluate((cases) => {
              localStorage.setItem(
                'ortbtools_history_v1',
                JSON.stringify(
                  cases.map(([status], i) => ({
                    ts: 1788868800000 - i * 1000,
                    title: `Synthetic ${status} example`,
                    status,
                    req: '{}',
                    res: '',
                  })),
                ),
              );
            }, historyCases);
            await page.setViewport({ width: 1920, height: 1080 });
            await page.reload();
            await page.waitForSelector('#hList .history-status');
            if (await page.$eval('body', (el) => el.classList.contains('sb-left-hidden'))) {
              await page.click('#toggleSidebarLeft');
            }
            await page.waitForSelector('#hList .history-status', { visible: true });
            const statuses = await page.$$eval('#hList .history-status', (els) =>
              els.map((el) => ({
                label: el.textContent,
                classes: [...el.classList],
                color: getComputedStyle(el).color,
                background: getComputedStyle(el).backgroundColor,
              })),
            );
            assert.equal(
              statuses.length,
              historyCases.length,
              'canonical and legacy history render',
            );
            for (const [index, [stored, label, tone]] of historyCases.entries()) {
              const badge = statuses[index];
              assert.equal(badge.label, label, `${stored}: history label preserves verdict`);
              assert.ok(badge.classes.includes(tone), `${stored}: history uses ${tone} tone`);
              if (tone !== 'healthy') {
                assert.notEqual(
                  badge.color,
                  statuses[0].color,
                  `${stored}: text is not success green`,
                );
                assert.notEqual(
                  badge.background,
                  statuses[0].background,
                  `${stored}: badge fill differs from healthy`,
                );
              }
            }
          }
          await page.close();
        }
      }
      assert.deepEqual(
        errors,
        [],
        'real account and article renderers complete without page errors',
      );
    } finally {
      if (browser) await browser.close();
      if (server && server.proc.exitCode === null && server.proc.signalCode === null) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => server.proc.kill('SIGKILL'), 2000);
          server.proc.once('exit', () => {
            clearTimeout(timer);
            resolve(undefined);
          });
          server.proc.kill('SIGTERM');
        });
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
