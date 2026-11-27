'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const ollama = require('../lib/ollama');
const { createAiLabelModule } = require('../modules/ai-label/handler');
const { createGate } = require('../lib/concurrency-gate');
const newsModerator = require('../lib/news-moderator');

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    payload: null,
    writableEnded: false,
    setHeader(k, v) {
      res.headers[k.toLowerCase()] = v;
    },
    writeHead(code, headers) {
      res.statusCode = code;
      for (const [k, v] of Object.entries(headers || {})) {
        res.headers[k.toLowerCase()] = v;
      }
    },
    end(text) {
      res.writableEnded = true;
      res.payload = text ? JSON.parse(text) : null;
    },
    once() {},
  };
  return res;
}

function callExplain(mod, body) {
  const route = mod.routes.find((r) => r.path === '/api/dialects/explain-findings');
  assert.ok(route, 'POST /api/dialects/explain-findings route must be registered');
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const res = makeRes();
  return route.handler(Readable.from([raw]), res).then(() => res);
}

// ── 1. lib/ollama.js: timeout, chatJson, explainFindings ──────────────

test('ollama: DEFAULT_TIMEOUT_MS defaults to 30_000', () => {
  assert.equal(ollama.DEFAULT_TIMEOUT_MS, 30_000);
});

test('ollama.chatJson: posts to /api/chat with think:false and returns content', async (t) => {
  /** @type {{ url: string, body: any } | null} */
  let seen = null;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    seen = { url: String(url), body: JSON.parse(init.body) };
    return {
      ok: true,
      json: async () => ({
        model: 'gemma4-prod',
        message: { role: 'assistant', content: '{"category":"news"}' },
      }),
    };
  });

  const messages = [
    { role: 'system', content: 'Return JSON' },
    { role: 'user', content: 'Hello' },
  ];
  const content = await ollama.chatJson(messages);

  assert.equal(content, '{"category":"news"}');
  assert.ok(seen, 'fetch must be called');
  assert.match(seen.url, /\/api\/chat$/);
  assert.equal(seen.body.model, ollama.DEFAULT_MODEL);
  assert.deepEqual(seen.body.messages, messages);
  assert.equal(seen.body.stream, false);
  assert.equal(seen.body.think, false);
  assert.equal(seen.body.format, 'json');
  assert.deepEqual(seen.body.options, { temperature: 0.2, num_predict: 1200 });
});

test('ollama.chatJson: respects custom schema/options and maps HTTP errors', async (t) => {
  const customSchema = { type: 'object', properties: { ok: { type: 'boolean' } } };
  /** @type {any} */
  let capturedBody = null;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: '{"ok":true}' } }) };
  });

  const out = await ollama.chatJson([{ role: 'user', content: 'hi' }], {
    schema: customSchema,
    temperature: 0.05,
    numPredict: 512,
  });
  assert.equal(out, '{"ok":true}');
  assert.deepEqual(capturedBody.format, customSchema);
  assert.deepEqual(capturedBody.options, { temperature: 0.05, num_predict: 512 });

  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 404,
    text: async () => 'model not found',
  }));
  await assert.rejects(
    () => ollama.chatJson([{ role: 'user', content: 'hi' }]),
    (err) => /** @type {any} */ (err).code === 'model_not_found',
  );
});

test('ollama.explainFindings: sends think:false, EXPLAIN_SCHEMA, and localized prompts', async (t) => {
  /** @type {any[]} */
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    return {
      ok: true,
      json: async () => ({
        model: 'gemma4-prod',
        response: JSON.stringify({
          summary: 'Missing secure flag on HTTPS impression.',
          rootCauses: ['imp.secure is 0 while site.domain uses HTTPS'],
          fixHint: 'Set imp[0].secure = 1.',
        }),
      }),
    };
  });

  for (const locale of ['en', 'uk', 'ru']) {
    const res = await ollama.explainFindings({
      findings: [
        { id: 'SECURE_FLAG', level: 'warn', path: 'imp[0].secure', message: 'Expected 1' },
      ],
      crosscheck: [
        { id: 'X_HTTPS', level: 'error', path: 'imp[0].secure', message: 'Mismatch with HTTPS' },
      ],
      impSketch: { banner: { w: 300, h: 250 }, secure: 0 },
      locale,
    });
    assert.equal(res.summary, 'Missing secure flag on HTTPS impression.');
    assert.deepEqual(res.rootCauses, ['imp.secure is 0 while site.domain uses HTTPS']);
    assert.equal(res.fixHint, 'Set imp[0].secure = 1.');
    assert.equal(res.model, 'gemma4-prod');
    assert.equal(res.source, 'model');
  }

  // Unsupported locale falls back to en
  await ollama.explainFindings({
    findings: [{ id: 'SECURE_FLAG', level: 'warn', path: 'imp[0].secure', message: 'Expected 1' }],
    crosscheck: [],
    impSketch: null,
    locale: 'fr',
  });

  assert.equal(requests.length, 4);
  const [en, uk, ru, fallback] = requests;
  for (const req of requests) {
    assert.match(req.url, /\/api\/generate$/);
    assert.equal(req.body.model, ollama.DEFAULT_MODEL);
    assert.equal(req.body.stream, false);
    assert.equal(req.body.think, false);
    assert.deepEqual(req.body.format, ollama.EXPLAIN_SCHEMA);
    assert.deepEqual(req.body.options, { temperature: 0.1 });
  }

  assert.match(en.body.system, /Respond in English/);
  assert.match(uk.body.system, /Відповідайте українською/);
  assert.match(ru.body.system, /Отвечайте по-русски/);
  assert.equal(fallback.body.system, en.body.system);
  assert.match(en.body.prompt, /Validation findings:/);
  assert.match(uk.body.prompt, /Зауваження валідації:/);
  assert.match(ru.body.prompt, /Замечания валидации:/);
});

test('ollama.explainFindings: rejects unparseable or malformed model output with bad_model_output', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ response: 'not-json' }),
  }));
  await assert.rejects(
    () =>
      ollama.explainFindings({ findings: [{ id: 'A', level: 'warn', path: 'id', message: 'm' }] }),
    (err) => /** @type {any} */ (err).code === 'bad_model_output',
  );

  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ response: JSON.stringify({ summary: 'only summary' }) }),
  }));
  await assert.rejects(
    () =>
      ollama.explainFindings({ findings: [{ id: 'A', level: 'warn', path: 'id', message: 'm' }] }),
    (err) => /** @type {any} */ (err).code === 'bad_model_output',
  );
});

// ── 2. POST /api/dialects/explain-findings route ──────────────────────

test('explain-findings route: enforces auth and rate limiting', async () => {
  const unauthMod = createAiLabelModule({ auth: { getCurrentUser: () => null } });
  const res401 = await callExplain(unauthMod, {
    findings: [{ id: 'F1', level: 'error', path: 'id', message: 'Missing' }],
  });
  assert.equal(res401.statusCode, 401);
  assert.equal(res401.payload.code, 'unauthorized');

  const limitedMod = createAiLabelModule({
    auth: { getCurrentUser: () => ({ id: 'u1' }) },
    aiLabelLimiter: () => false,
  });
  const res429 = await callExplain(limitedMod, {
    findings: [{ id: 'F1', level: 'error', path: 'id', message: 'Missing' }],
  });
  assert.equal(res429.statusCode, 429);
  assert.equal(res429.payload.code, 'rate_limited');
});

test('explain-findings route: validates input and checks verifyPersona', async (t) => {
  const mod = createAiLabelModule({
    auth: { getCurrentUser: () => ({ id: 'u1' }) },
    aiLabelLimiter: () => true,
  });

  const badBody = await callExplain(mod, '[]');
  assert.equal(badBody.statusCode, 400);
  assert.equal(badBody.payload.code, 'bad_request');

  const badTypes = await callExplain(mod, { findings: 'not-an-array' });
  assert.equal(badTypes.statusCode, 400);
  assert.equal(badTypes.payload.code, 'bad_request');

  const emptyFindings = await callExplain(mod, { findings: [], crosscheck: [] });
  assert.equal(emptyFindings.statusCode, 400);
  assert.equal(emptyFindings.payload.code, 'findings_required');

  t.mock.method(ollama, 'verifyPersona', async () => ({
    ok: false,
    reason: 'model_missing',
    model: 'gemma4-prod',
  }));
  const unavailable = await callExplain(mod, {
    findings: [{ id: 'F1', level: 'warn', path: 'imp[0].bidfloor', message: 'Low floor' }],
  });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.payload.code, 'labeller_unavailable');
});

test('explain-findings route: caps/redacts inputs and returns 200 explanation', async (t) => {
  /** @type {any} */
  let capturedInput = null;
  t.mock.method(ollama, 'verifyPersona', async () => ({
    ok: true,
    reason: null,
    model: 'gemma4-prod',
  }));
  t.mock.method(ollama, 'explainFindings', async (input) => {
    capturedInput = input;
    return {
      summary: 'Bidfloor currency mismatch',
      rootCauses: ['Floor is unusually low'],
      fixHint: 'Verify bidfloor and bidfloorcur.',
      model: 'gemma4-prod',
      source: 'model',
    };
  });

  const mod = createAiLabelModule({
    auth: { getCurrentUser: () => ({ id: 'u1' }) },
    aiLabelLimiter: () => true,
    gate: createGate({ maxActive: 1, maxQueue: 2, maxWaitMs: 5000 }),
  });

  const manyFindings = Array.from({ length: 20 }, (_, i) => ({
    id: `F_${i}_${'x'.repeat(260)}`,
    level: 'warn',
    path: `imp[0].ext.k${i}`,
    message: `msg_${i}_${'y'.repeat(260)}`,
    rawValue: 'SECRET_PAYLOAD_VALUE',
  }));
  const manyCrosscheck = Array.from({ length: 18 }, (_, i) => ({
    id: `C_${i}`,
    level: 'error',
    path: `imp[0].banner`,
    message: `cross_${i}`,
    payloadSnippet: 'ANOTHER_SECRET',
  }));

  const res = await callExplain(mod, {
    findings: manyFindings,
    crosscheck: manyCrosscheck,
    imp: {
      id: 'secret-imp-id',
      tagid: 'secret-tagid',
      displaymanager: 'SecretSDK',
      banner: { w: 300, h: 250 },
      secure: 1,
      ext: { private_key: 'never-send-this' },
    },
    locale: 'uk',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.explanation.summary, 'Bidfloor currency mismatch');

  assert.ok(capturedInput, 'explainFindings must be called');
  assert.equal(capturedInput.locale, 'uk');
  assert.equal(capturedInput.findings.length, 15, 'findings capped at 15');
  assert.equal(capturedInput.crosscheck.length, 15, 'crosscheck capped at 15');
  assert.equal(capturedInput.findings[0].id.length, 240, 'id clipped to 240 chars');
  assert.equal(capturedInput.findings[0].message.length, 240, 'message clipped to 240 chars');

  const serialized = JSON.stringify(capturedInput);
  assert.ok(!serialized.includes('SECRET_PAYLOAD_VALUE'), 'raw finding values must be stripped');
  assert.ok(!serialized.includes('ANOTHER_SECRET'), 'extra crosscheck fields must be stripped');
  assert.ok(!serialized.includes('secret-tagid'), 'tagid must be redacted');
  assert.ok(!serialized.includes('SecretSDK'), 'displaymanager must be redacted');
  assert.ok(!serialized.includes('never-send-this'), 'ext values must be redacted');
  assert.deepEqual(capturedInput.impSketch, { banner: { w: 300, h: 250 }, secure: 1 });
});

// ── 3. lib/news-moderator.js: local Ollama fallback ───────────────────

test('news-moderator: falls back to ollama.chatJson when OPENROUTER_API_KEY is unset', async (t) => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  t.after(() => {
    if (prevKey !== undefined) process.env.OPENROUTER_API_KEY = prevKey;
    else delete process.env.OPENROUTER_API_KEY;
  });

  let receivedMessages = null;
  t.mock.method(ollama, 'chatJson', async (messages) => {
    receivedMessages = messages;
    return JSON.stringify({
      category: 'news',
      slug: 'openrtb-2-6-update',
      tags: ['openrtb', 'ssp'],
      en: { title: 'EN Title', summary: 'EN Summary' },
      uk: { title: 'UK Title', summary: 'UK Summary' },
      ru: { title: 'RU Title', summary: 'RU Summary' },
    });
  });

  const draft = { title: 'OpenRTB 2.6 update', summary: 'New SSP capabilities.' };
  const result = await newsModerator.translateDraft(draft);

  assert.ok(receivedMessages, 'ollama.chatJson must be called when OPENROUTER_API_KEY is unset');
  assert.deepEqual(receivedMessages, newsModerator.buildTranslatePrompt(draft));
  assert.equal(result.slug, 'openrtb-2-6-update');
  assert.equal(result.uk.title, 'UK Title');
});

test('news-moderator: prefers opts.callOpenRouter or OPENROUTER_API_KEY over Ollama fallback', async (t) => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  t.after(() => {
    if (prevKey !== undefined) process.env.OPENROUTER_API_KEY = prevKey;
    else delete process.env.OPENROUTER_API_KEY;
  });

  let ollamaCalled = false;
  t.mock.method(ollama, 'chatJson', async () => {
    ollamaCalled = true;
    return '{}';
  });

  const draft = { title: 'Test', summary: 'Summary' };
  const fromOverride = await newsModerator.translateDraft(draft, {
    callOpenRouter: async () => ({
      content: JSON.stringify({
        category: 'guide',
        slug: 'override-slug',
        tags: ['dsp'],
        en: { title: 'E', summary: 'S' },
        uk: { title: 'U', summary: 'S' },
        ru: { title: 'R', summary: 'S' },
      }),
      usage: {},
      model: 'deepseek',
    }),
  });
  assert.equal(ollamaCalled, false, 'override must bypass Ollama');
  assert.equal(fromOverride.slug, 'override-slug');

  process.env.OPENROUTER_API_KEY = 'test-or-key';
  let openRouterUrl = null;
  t.mock.method(globalThis, 'fetch', async (url) => {
    openRouterUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                category: 'analysis',
                slug: 'openrouter-slug',
                tags: ['rtb'],
                en: { title: 'E2', summary: 'S2' },
                uk: { title: 'U2', summary: 'S2' },
                ru: { title: 'R2', summary: 'S2' },
              }),
            },
          },
        ],
      }),
    };
  });

  const fromEnv = await newsModerator.translateDraft(draft);
  assert.equal(ollamaCalled, false, 'OPENROUTER_API_KEY must use OpenRouter, not Ollama');
  assert.match(String(openRouterUrl), /openrouter\.ai/);
  assert.equal(fromEnv.slug, 'openrouter-slug');
});
