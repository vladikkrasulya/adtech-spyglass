'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { resolveLocaleRoute } = require('../lib/locale-routes');

function response() {
  return {
    status: 0,
    body: null,
    writeHead(status) {
      this.status = status;
    },
    end(text) {
      this.body = JSON.parse(String(text));
    },
  };
}

function harness(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-promotion-integrity-'));
  const content = path.join(root, 'content');
  const originalEnv = Object.fromEntries(
    ['CONTENT_DIR', 'ADMIN_STATS_TOKEN', 'CLICKHOUSE_URL'].map((key) => [key, process.env[key]]),
  );
  process.env.CONTENT_DIR = content;
  process.env.ADMIN_STATS_TOKEN = 'synthetic-promotion-token';
  delete process.env.CLICKHOUSE_URL;
  const modulePaths = [
    '../lib/blog-service',
    '../modules/admin/blog',
    '../modules/blog/handler',
  ].map((name) => require.resolve(name));
  const originalModules = modulePaths.map((name) => require.cache[name]);
  const clickhouse = require('../lib/clickhouse');
  const originalClickhouse = { ...clickhouse };
  const draft = {
    id: 'draft-019',
    title: 'Synthetic editorial title',
    summary: 'Synthetic editorial body',
    lang: 'en',
    category: 'news',
    status: 'pending',
    slug: '',
    url: 'https://example.invalid/source',
    ...overrides,
  };
  const state = {
    draft,
    queries: [],
    inserts: [],
    mutations: [],
    failMutation: false,
    failReadback: false,
    rejectDuringMutation: false,
    beforeMutation: async () => {},
  };
  clickhouse.isEnabled = () => false;
  clickhouse.chQuery = async (sql) => {
    state.queries.push(sql);
    if (state.failReadback && sql.startsWith('SELECT status')) throw new Error('synthetic outage');
    return [{ ...draft }];
  };
  clickhouse.chInsert = async (table, rows) => {
    state.inserts.push({ table, rows });
  };
  clickhouse.chExec = async (sql) => {
    state.mutations.push(sql);
    await state.beforeMutation();
    if (state.failMutation) throw new Error('synthetic status timeout');
    if (state.rejectDuringMutation) {
      draft.status = 'rejected';
      return;
    }
    draft.status = sql.match(/status = '([^']+)'/)[1];
    draft.slug = sql.match(/slug = '([^']+)'/)?.[1] || draft.slug;
  };
  for (const name of modulePaths) delete require.cache[name];
  const service = require('../lib/blog-service');
  const admin = require('../modules/admin/blog').createAdminBlogModule();
  const publicBlog = require('../modules/blog/handler').createBlogModule({});
  t.after(() => {
    Object.assign(clickhouse, originalClickhouse);
    modulePaths.forEach((name, index) => {
      if (originalModules[index]) require.cache[name] = originalModules[index];
      else delete require.cache[name];
    });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function act(body, route = '/api/admin/blog/approve', token = 'synthetic-promotion-token') {
    const req = /** @type {Readable & {headers: Record<string, string>}} */ (
      Readable.from([JSON.stringify(body)])
    );
    req.headers = { authorization: `Bearer ${token}` };
    const res = response();
    await admin.routes.find((entry) => entry.path === route).handler(req, res);
    return res;
  }

  async function readPublic(slug, lang) {
    const url = new URL(`https://example.invalid/api/v1/blog/post?slug=${slug}&lang=${lang}`);
    const res = response();
    await publicBlog.routes
      .find((entry) => entry.path === '/api/v1/blog/post')
      .handler({ headers: {}, url: url.pathname + url.search }, res, url);
    return res;
  }

  return { root, content, state, service, act, readPublic };
}

test('promotion rejects persisted invalid states and path metadata before any side effect', async (t) => {
  for (const overrides of [
    { status: 'rejected' },
    { status: 'unknown' },
    { status: undefined },
    { lang: '../sibling' },
    { lang: '/tmp' },
    { lang: 'en/..' },
    { lang: 'EN' },
    { lang: ['en'] },
    { category: 'news\nindexable: true' },
    { category: 'unreviewed' },
    { title: null },
    { summary: {} },
  ]) {
    await t.test(JSON.stringify(overrides), async (t) => {
      const h = harness(t, overrides);
      const res = await h.act({ id: h.state.draft.id, action: 'promote', slug: 'article' });
      assert.ok([400, 409].includes(res.status));
      assert.deepEqual(fs.readdirSync(h.root), []);
      assert.equal(h.state.inserts.length, 0);
      assert.equal(h.state.mutations.length, 0);
    });
  }
});

test('promotion rejects unsafe or unreadable explicit slugs and an unsafe fallback identifier', async (t) => {
  for (const slug of [
    '../article',
    'a/b',
    'a\\b',
    'article.md',
    'новина',
    '',
    {},
    'x'.repeat(122),
  ]) {
    await t.test(String(slug), async (t) => {
      const h = harness(t);
      const res = await h.act({ id: h.state.draft.id, action: 'promote', slug });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'invalid_slug');
      assert.deepEqual(fs.readdirSync(h.root), []);
      assert.equal(h.state.mutations.length, 0);
    });
  }
  await t.test('fallback', async (t) => {
    const h = harness(t, { id: '../', title: 'Новина' });
    const res = await h.act({ id: h.state.draft.id, action: 'promote' });
    assert.equal(res.status, 400);
    assert.deepEqual(fs.readdirSync(h.root), []);
  });
});

test('provided and persisted uppercase slugs cannot create unreachable posts or replace lowercase articles', async (t) => {
  for (const [action, status] of [
    ['publish', 'pending'],
    ['promote', 'pending'],
    ['promote', 'published'],
    ['promote', 'promoted'],
  ]) {
    for (const source of ['provided', 'persisted']) {
      await t.test(`${action} ${status} ${source}`, async (t) => {
        const slug = 'Example-Post';
        const h = harness(t, { status, slug: source === 'persisted' ? slug : '' });
        fs.mkdirSync(path.join(h.content, 'en'), { recursive: true });
        const existing = path.join(h.content, 'en', 'example-post.md');
        fs.writeFileSync(existing, 'KEEP LOWERCASE ARTICLE');
        const res = await h.act({
          id: h.state.draft.id,
          action,
          ...(source === 'provided' ? { slug } : {}),
        });
        assert.equal(res.status, 400);
        assert.equal(res.body.code, 'invalid_slug');
        assert.equal(h.state.draft.status, status);
        assert.equal(h.state.draft.slug, source === 'persisted' ? slug : '');
        assert.equal(h.state.inserts.length, 0);
        assert.equal(h.state.mutations.length, 0);
        assert.deepEqual(fs.readdirSync(path.join(h.content, 'en')), ['example-post.md']);
        assert.equal(fs.readFileSync(existing, 'utf8'), 'KEEP LOWERCASE ARTICLE');
        if (action === 'promote' && status !== 'promoted') {
          const collision = await h.act({ id: h.state.draft.id, action, slug: 'example-post' });
          assert.equal(collision.status, 409);
          assert.equal(collision.body.code, 'slug_exists');
          assert.equal(h.state.mutations.length, 0);
          assert.equal(fs.readFileSync(existing, 'utf8'), 'KEEP LOWERCASE ARTICLE');
        }
      });
    }
  }
});

test('promotion preserves scalar text and body in both readers without metadata injection', async (t) => {
  for (const lang of ['en', 'uk', 'ru']) {
    await t.test(lang, async (t) => {
      const title =
        'Text "quoted" \\ literal\\n\nindexable: true\r\nsummary: injected\n---\nЗаголовок';
      const summary = `Body with \\ and <b>literal markup</b>\n\n${Array(160).fill('word').join(' ')}`;
      const h = harness(t, { title, summary, lang });
      const res = await h.act({ id: h.state.draft.id, action: 'promote', slug: 'text-roundtrip' });
      assert.equal(res.status, 200);
      const raw = fs.readFileSync(path.join(h.content, lang, 'text-roundtrip.md'), 'utf8');
      const parsed = h.service.parseFrontmatter(raw);
      assert.deepEqual(Object.keys(parsed.meta).sort(), [
        'category',
        'date',
        'frontmatter_encoding',
        'indexable',
        'slug',
        'source_draft_id',
        'tags',
        'title',
      ]);
      assert.equal(parsed.meta.title, title);
      assert.equal(parsed.meta.frontmatter_encoding, 'json-v1');
      assert.equal(parsed.meta.indexable, 'false');
      const pagePath = `${lang === 'en' ? '' : `/${lang}`}/blog/${lang}/${res.body.slug}`;
      assert.deepEqual(resolveLocaleRoute(pagePath), { file: `/index.${lang}.html` });
      const publicSlug = pagePath.split('/').at(-1);
      const ssr = await h.service.getPost(publicSlug, lang);
      assert.equal(ssr.status, 'found');
      assert.equal(ssr.post.title, title);
      assert.equal(ssr.post.body, `\n${summary}\n`);
      assert.equal(h.service.isIndexable(ssr.post), false);
      const api = await h.readPublic(publicSlug, lang);
      assert.equal(api.status, 200);
      assert.equal(api.body.post.title, title);
      assert.equal(api.body.post.body, ssr.post.body);
      assert.equal(api.body.post.lang, lang);
    });
  }
});

test('pending publication and published-to-editorial promotion remain supported', async (t) => {
  const h = harness(t);
  assert.equal((await h.act({ id: h.state.draft.id, action: 'publish' })).status, 200);
  assert.equal(h.state.inserts.length, 1);
  assert.equal(h.state.draft.status, 'published');
  const res = await h.act({ id: h.state.draft.id, action: 'promote' });
  assert.equal(res.status, 200);
  assert.equal(h.state.draft.status, 'promoted');
  assert.equal((await h.readPublic(res.body.slug, 'en')).status, 200);
  const duplicatePublish = await h.act({ id: h.state.draft.id, action: 'publish' });
  assert.equal(duplicatePublish.status, 409);
  assert.equal(h.state.inserts.length, 1);
});

test('a localized title with no supplied slug gets a readable bounded identifier fallback', async (t) => {
  const h = harness(t, { title: 'Українська новина', lang: 'uk' });
  const res = await h.act({ id: h.state.draft.id, action: 'promote' });
  assert.equal(res.status, 200);
  assert.equal((await h.service.getPost(res.body.slug, 'uk')).status, 'found');
});

test('existing articles and symlink targets cannot be replaced by promotion', async (t) => {
  const h = harness(t);
  fs.mkdirSync(path.join(h.content, 'en'), { recursive: true });
  const existing = path.join(h.content, 'en', 'existing.md');
  fs.writeFileSync(existing, 'KEEP EXISTING');
  const target = path.join(h.root, 'outside.md');
  fs.writeFileSync(target, 'KEEP TARGET');
  fs.symlinkSync(target, path.join(h.content, 'en', 'linked.md'));
  for (const slug of ['existing', 'linked']) {
    const res = await h.act({ id: h.state.draft.id, action: 'promote', slug });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'slug_exists');
  }
  assert.equal(fs.readFileSync(existing, 'utf8'), 'KEEP EXISTING');
  assert.equal(fs.readFileSync(target, 'utf8'), 'KEEP TARGET');
  assert.equal(h.state.mutations.length, 0);
  fs.mkdirSync(path.join(h.root, 'sibling'));
  fs.symlinkSync(path.join(h.root, 'sibling'), path.join(h.content, 'uk'));
  h.state.draft.lang = 'uk';
  assert.equal(
    (await h.act({ id: h.state.draft.id, action: 'promote', slug: 'article' })).status,
    409,
  );
  assert.deepEqual(fs.readdirSync(path.join(h.root, 'sibling')), []);
});

test('a partial filesystem write is removed and does not update the draft', async (t) => {
  const h = harness(t);
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = /** @type {typeof fs.writeFileSync} */ (
    (file, ...args) => {
      if (typeof file === 'number') {
        originalWrite(file, 'partial');
        throw new Error('synthetic disk failure');
      }
      return originalWrite(file, ...args);
    }
  );
  let res;
  try {
    res = await h.act({ id: h.state.draft.id, action: 'promote', slug: 'partial' });
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(res.status, 500);
  assert.equal(fs.existsSync(path.join(h.content, 'en', 'partial.md')), false);
  assert.equal(h.state.mutations.length, 0);
});

test('an unconfirmed status update preserves one artifact and same-draft retry reconciles it', async (t) => {
  for (const failure of ['failMutation', 'failReadback']) {
    await t.test(failure, async (t) => {
      const h = harness(t);
      h.state[failure] = true;
      const request = { id: h.state.draft.id, action: 'promote', slug: 'recoverable' };
      const failed = await h.act(request);
      assert.equal(failed.status, 503);
      assert.equal(failed.body.code, 'promotion_status_unconfirmed');
      const file = path.join(h.content, 'en', 'recoverable.md');
      const before = fs.readFileSync(file, 'utf8');
      const inode = fs.statSync(file).ino;
      h.state[failure] = false;
      assert.equal((await h.act(request)).status, 200);
      assert.equal((await h.act(request)).status, 200);
      assert.equal(fs.readFileSync(file, 'utf8'), before);
      assert.equal(fs.statSync(file).ino, inode);
      assert.equal(h.state.draft.status, 'promoted');
      assert.equal((await h.act({ ...request, slug: 'another' })).status, 409);
      assert.equal(fs.existsSync(path.join(h.content, 'en', 'another.md')), false);
    });
  }
});

test('Unicode line separators survive promotion, both readers, and an uncertain-status retry', async (t) => {
  for (const separator of ['\u2028', '\u2029']) {
    for (const failure of ['failMutation', 'failReadback']) {
      await t.test(`${separator.charCodeAt(0).toString(16)} ${failure}`, async (t) => {
        const title = `First${separator}indexable: true${separator}---${separator}Last`;
        const id = `draft${separator}019`;
        const h = harness(t, { title, id });
        h.state[failure] = true;
        const request = { id, action: 'promote', slug: 'unicode-separator' };
        assert.equal((await h.act(request)).status, 503);
        const file = path.join(h.content, 'en', 'unicode-separator.md');
        const raw = fs.readFileSync(file, 'utf8');
        assert.equal(raw.includes(separator), false);
        const parsed = h.service.parseFrontmatter(raw);
        assert.equal(parsed.meta.title, title);
        assert.equal(parsed.meta.source_draft_id, id);
        assert.equal(parsed.meta.indexable, 'false');
        const ssr = await h.service.getPost(request.slug, 'en');
        assert.equal(ssr.status, 'found');
        assert.equal(ssr.post.title, title);
        assert.equal(h.service.isIndexable(ssr.post), false);
        const api = await h.readPublic(request.slug, 'en');
        assert.equal(api.status, 200);
        assert.equal(api.body.post.title, title);
        h.state[failure] = false;
        assert.equal((await h.act(request)).status, 200);
        assert.equal((await h.act(request)).status, 200);
        assert.equal(fs.readFileSync(file, 'utf8'), raw);
      });
    }
  }
});

test('a changed draft decision removes only the file created by this attempt', async (t) => {
  const h = harness(t);
  h.state.rejectDuringMutation = true;
  const res = await h.act({ id: h.state.draft.id, action: 'promote', slug: 'changed' });
  assert.equal(res.status, 409);
  assert.equal(fs.existsSync(path.join(h.content, 'en', 'changed.md')), false);
});

test('concurrent admin decisions cannot duplicate or reject an in-flight promotion', async (t) => {
  const h = harness(t);
  let release = () => {};
  let entered = () => {};
  const started = new Promise((resolve) => {
    entered = () => resolve(undefined);
  });
  const blocked = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  h.state.beforeMutation = async () => {
    entered();
    await blocked;
  };
  const request = { id: h.state.draft.id, action: 'promote', slug: 'one-article' };
  const first = h.act(request);
  await started;
  try {
    assert.equal((await h.act(request)).body.code, 'draft_busy');
    assert.equal(
      (await h.act({ id: request.id }, '/api/admin/blog/reject')).body.code,
      'draft_busy',
    );
    h.state.draft.id = 'different-draft';
    assert.equal((await h.act({ ...request, id: 'different-draft' })).body.code, 'slug_exists');
    h.state.draft.id = request.id;
  } finally {
    release();
  }
  assert.equal((await first).status, 200);
  assert.equal(h.state.mutations.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(h.content, 'en')), ['one-article.md']);
});

test('frontmatter keeps tracked editorial grammar and quoted scalar values', async (t) => {
  const h = harness(t);
  for (const lang of ['en', 'uk', 'ru']) {
    const raw = fs.readFileSync(
      path.join(__dirname, '..', 'content/posts', lang, 'welcome.md'),
      'utf8',
    );
    const { meta, body } = h.service.parseFrontmatter(raw);
    assert.deepEqual(meta.tags, ['meta', 'intro']);
    assert.equal(meta.slug, 'welcome');
    assert.equal(meta.category, 'guide');
    assert.ok(meta.title && body.length > 100);
  }
  const parsed = h.service.parseFrontmatter(
    '---\ntitle: "[literal]"\nlegacy: "C:\\path"\n---\nbody',
  );
  assert.deepEqual(parsed.meta.title, ['literal']);
  assert.equal(parsed.meta.legacy, 'C:\\path');
  const encoded = h.service.parseFrontmatter(
    '---\nfrontmatter_encoding: json-v1\ntitle: "[literal]"\n---\nbody',
  );
  assert.equal(encoded.meta.title, '[literal]');
  const crlf = h.service.parseFrontmatter(
    '---\r\nfrontmatter_encoding: json-v1\r\ntitle: "line\\nnext"\r\n---\r\nbody',
  );
  assert.equal(crlf.meta.title, 'line\nnext');
  for (const marker of [
    'frontmatter_encoding: json-v2',
    'other: "\u2028frontmatter_encoding: json-v1\u2029"',
  ]) {
    const unmarked = h.service.parseFrontmatter(`---\n${marker}\ntitle: "C:\\new"\n---\nbody`);
    assert.equal(unmarked.meta.title, 'C:\\new');
  }
});

test('unmarked legacy quoted backslashes stay literal in both public readers', async (t) => {
  const h = harness(t);
  fs.mkdirSync(path.join(h.content, 'en'), { recursive: true });
  const titles = [
    String.raw`Build C:\new`,
    String.raw`Tabs \t carriage \r backspace \b formfeed \f`,
    String.raw`Unicode \u2028 and \u2029`,
    String.raw`Say \"hello\" with \\ and \/`,
  ];
  for (const [index, title] of titles.entries()) {
    const slug = `legacy-${index}`;
    const raw = `---\ntitle: "${title}"\ndate: "2026-01-01T00:00:00Z"\ncategory: guide\ntags: [meta, intro]\nslug: ${slug}\n---\nLegacy body`;
    fs.writeFileSync(path.join(h.content, 'en', `${slug}.md`), raw);
    assert.equal(h.service.parseFrontmatter(raw).meta.title, title);
    const ssr = await h.service.getPost(slug, 'en');
    assert.equal(ssr.status, 'found');
    assert.equal(ssr.post.title, title);
    const api = await h.readPublic(slug, 'en');
    assert.equal(api.status, 200);
    assert.equal(api.body.post.title, title);
    assert.deepEqual(api.body.post.tags, ['meta', 'intro']);
  }
});
