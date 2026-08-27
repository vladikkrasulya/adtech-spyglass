'use strict';

/**
 * tests/ai-label.test.js
 *
 * Covers the dialect labelling assistant's two deterministic halves. The
 * model call itself is not exercised here — it needs a GPU and a loaded
 * persona, so it belongs in a manual/integration check, not in `npm test`.
 * What IS testable is everything that decides whether the model is called
 * at all, and what it would be allowed to see.
 *
 * Assertions:
 *   1. signal-lexicon resolves the cases it should, and ABSTAINS on the
 *      ones where a guess would be harmful (numeric codes, contradictions).
 *   2. The three label vocabularies agree — lexicon, ollama client, and the
 *      dialects store. A drift here produces a suggestion the user cannot
 *      save, which is invisible until someone clicks accept.
 *   3. redactImp() is an allowlist: fields nobody named do not travel to
 *      the model. This is the privacy claim, so it is asserted directly
 *      rather than inferred from the happy path.
 *   4. `locale` reaches the reason prose and nothing else. The lexicon's
 *      verdict, the persona's calibrated body and the label vocabulary are
 *      identical in every language; only the sentence a human reads moves
 *      (feature 015, ADR-014 — English is the default, not Ukrainian).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');

const lex = require('../packages/core/dialects/signal-lexicon');
const ollama = require('../lib/ollama');
const { redactImp, createAiLabelModule } = require('../modules/ai-label/handler');
const { PERSONA, buildPersona } = require('../lib/label-persona');

// ── 1. lexicon behaviour ─────────────────────────────────────────────

test('lexicon: format word corroborated by the impression resolves high', () => {
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.type',
    signalValue: 'preroll_video',
    imp: { id: '1', video: { mimes: ['video/mp4'], w: 640, h: 480 } },
  });
  assert.ok(r, 'expected a resolution');
  assert.equal(r.label, 'video');
  assert.equal(r.source, 'lexicon');
  assert.ok(r.confidence >= 0.9, `expected high confidence, got ${r.confidence}`);
});

test('lexicon: numeric vendor codes always abstain', () => {
  for (const value of [8, '8', 0, 42]) {
    const r = lex.resolveSignal({
      signalPath: 'imp[0].ext.adtype',
      signalValue: value,
      imp: { id: '1', banner: { w: 1, h: 1 } },
    });
    assert.equal(r, null, `numeric ${JSON.stringify(value)} must not resolve`);
  }
});

test('lexicon: a format word contradicted by the impression abstains', () => {
  // "video_slider" on an imp carrying only a real banner. Either the naming
  // is misleading or the slot is a hybrid — a human decides, not a table.
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.type',
    signalValue: 'video_slider',
    imp: { id: '1', banner: { w: 300, h: 250 } },
  });
  assert.equal(r, null);
});

test('lexicon: 1x1 banner is not banner corroboration', () => {
  // A 1x1 banner is the placeholder pop networks send, not display
  // inventory — so it must not corroborate a "banner" word.
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.type',
    signalValue: 'banner',
    imp: { id: '1', banner: { w: 1, h: 1 } },
  });
  assert.ok(r === null || r.confidence < 0.9, 'must not read 1x1 as banner evidence');
});

test('lexicon: pop allow-flags and sizeID:[0] resolve to pop', () => {
  const flag = lex.resolveSignal({
    signalPath: 'imp[0].ext.allowShock',
    signalValue: 1,
    imp: { id: '1', banner: { w: 1, h: 1 } },
  });
  assert.equal(flag && flag.label, 'pop');

  const size = lex.resolveSignal({
    signalPath: 'imp[0].ext.sizeID',
    signalValue: [0],
    imp: { id: '1', banner: { w: 1, h: 1 } },
  });
  assert.equal(size && size.label, 'pop');
});

test('lexicon: a real sizeID array is not a pop signal', () => {
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.sizeID',
    signalValue: [300, 250],
    imp: { id: '1', banner: { w: 300, h: 250 } },
  });
  assert.equal(r, null);
});

test('lexicon: a set flag resolves, an unset one abstains', () => {
  const on = lex.resolveSignal({ signalPath: 'imp[0].ext.popunder', signalValue: 1, imp: null });
  assert.equal(on && on.label, 'pop');
  // `popunder: 0` is the vendor saying this slot is NOT one.
  const off = lex.resolveSignal({ signalPath: 'imp[0].ext.popunder', signalValue: 0, imp: null });
  assert.equal(off, null);
});

test('lexicon: bookkeeping and metadata keys resolve on the key alone', () => {
  const id = lex.resolveSignal({
    signalPath: 'imp[0].ext.custom_tracking_id',
    signalValue: 'a8f3e91c-4d22',
    imp: { id: '1', banner: { w: 300, h: 250 } },
  });
  assert.equal(id && id.label, 'ignore');

  const ver = lex.resolveSignal({ signalPath: 'ext.pv', signalValue: '3.2.1', imp: null });
  assert.equal(ver && ver.label, 'informational');
});

test('lexicon: a key that merely contains a format word does not declare one', () => {
  // `creative_video_url` is not a format declaration; only format-declaring
  // keys get their value read as a format.
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.creative_video_url',
    signalValue: 'https://cdn.example/v.mp4',
    imp: { id: '1', video: { w: 640, h: 480 } },
  });
  assert.equal(r, null);
});

test('lexicon: a bookkeeping key wins over a format word in its value', () => {
  const r = lex.resolveSignal({
    signalPath: 'imp[0].ext.session_id',
    signalValue: 'video-42',
    imp: { id: '1', video: { w: 640, h: 480 } },
  });
  assert.equal(r && r.label, 'ignore');
});

test('lexicon: every resolution returns a storable label', () => {
  /** @type {Array<[string, any, any]>} */
  const samples = [
    ['imp[0].ext.type', 'preroll_video', { video: {} }],
    ['imp[0].ext.adtype', 'popunder', { banner: { w: 1, h: 1 } }],
    ['imp[0].ext.format', 'interstitial', { banner: { w: 320, h: 480 }, instl: 1 }],
    ['imp[0].ext.type', 'native', { native: { request: '{}' } }],
    ['ext.sdkver', '1.2', null],
  ];
  for (const [signalPath, signalValue, imp] of samples) {
    const r = lex.resolveSignal({ signalPath, signalValue, imp });
    if (!r) continue;
    assert.ok(
      lex.SEMANTIC_LABELS.includes(r.label),
      `${signalPath} produced unstorable label ${r.label}`,
    );
    assert.ok(r.confidence > 0 && r.confidence <= 1, 'confidence out of range');
    assert.ok(r.reason && r.reason.length > 0, 'a resolution must explain itself');
  }
});

// ── 2. vocabulary parity ─────────────────────────────────────────────

test('label vocabularies agree across lexicon, model client and store', () => {
  // The store's list is the authority — it is what the save route validates
  // against. Read it from the source rather than restating it here, so this
  // test fails when the store changes and nobody updated the other two.
  const handlerSrc = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'modules', 'dialects', 'handler.js'),
    'utf8',
  );
  const block = handlerSrc.match(/const SEMANTIC_LABELS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'could not locate SEMANTIC_LABELS in the dialects store');
  const storeLabels = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  assert.deepEqual(
    [...lex.SEMANTIC_LABELS].sort(),
    [...storeLabels].sort(),
    'signal-lexicon and the dialects store disagree on the label vocabulary',
  );
  assert.deepEqual(
    [...ollama.LABELS].sort(),
    [...storeLabels].sort(),
    'the model client and the dialects store disagree on the label vocabulary',
  );
});

// ── 3. redaction is an allowlist ─────────────────────────────────────

test('redactImp keeps only structural fields', () => {
  const { sketch } = redactImp({
    id: 'imp-1',
    tagid: 'publisher-slot-name',
    banner: { w: 300, h: 250, pos: 1 },
    instl: 0,
    bidfloor: 0.16,
    bidfloorcur: 'USD',
    displaymanager: 'SomeSDK',
    ext: { type: 'preroll_video', secret_partner_token: 'shh' },
  });
  const flat = JSON.stringify(sketch);
  assert.ok(!flat.includes('publisher-slot-name'), 'tagid must not travel');
  assert.ok(!flat.includes('SomeSDK'), 'displaymanager must not travel');
  assert.ok(!flat.includes('shh'), 'ext values must not travel');
  assert.ok(!flat.includes('imp-1'), 'imp id must not travel');
  assert.equal(sketch.banner.w, 300);
  assert.equal(sketch.bidfloor, 0.16);
});

test('redactImp passes sibling ext key NAMES but never their values', () => {
  const { siblingKeys } = redactImp({
    banner: { w: 1, h: 1 },
    ext: { allowShock: 1, type: 'popunder', auth_token: 'sensitive-value' },
  });
  assert.deepEqual(siblingKeys.sort(), ['allowShock', 'auth_token', 'type'].sort());
  assert.ok(
    !JSON.stringify(siblingKeys).includes('sensitive-value'),
    'sibling values must not travel',
  );
});

test('redactImp drops unknown vendor fields entirely', () => {
  const { sketch } = redactImp({
    banner: { w: 300, h: 250 },
    some_future_vendor_field: 'user@example.com',
    nested: { deeply: { pii: '192.168.1.1' } },
  });
  const flat = JSON.stringify(sketch);
  assert.ok(!flat.includes('user@example.com'));
  assert.ok(!flat.includes('192.168.1.1'));
  assert.ok(!flat.includes('some_future_vendor_field'));
});

test('redactImp tolerates junk input', () => {
  for (const junk of [null, undefined, 'string', 42, [], [{ banner: {} }]]) {
    const out = redactImp(junk);
    assert.equal(out.sketch, null);
    assert.deepEqual(out.siblingKeys, []);
  }
});

test('redactImp reports native presence without its asset layout', () => {
  const { sketch } = redactImp({
    native: { request: '{"assets":[{"title":{"text":"publisher headline"}}]}' },
  });
  assert.deepEqual(sketch.native, { present: true });
  assert.ok(!JSON.stringify(sketch).includes('publisher headline'));
});

// ── 4. locale governs the reason prose and nothing else ──────────────
//
// The labeller answers in the operator's language (feature 015). What makes
// that safe to add to Core is that `locale` reaches exactly one thing: the
// `reason:` sentence a human reads. The label, the confidence and the
// abstain/resolve decision are the same in every locale — so resolveSignal
// stays the deterministic data-to-data function the Core contract promises
// (specs/000-platform-baseline/contracts/core-validator.md), with one more
// input rather than one more behaviour. Both halves of that are asserted:
// the prose changes, the verdict does not.

/**
 * Samples chosen to hit every branch of REASONS — one per reason id.
 * @type {Array<[name: string, signalPath: string, signalValue: unknown, imp: object|null]>}
 */
const LOCALIZED_BRANCHES = [
  ['sizeID [0]', 'imp[0].ext.sizeID', [0], { id: '1', banner: { w: 1, h: 1 } }],
  ['pop shape flag', 'imp[0].ext.allowShock', 1, { id: '1', banner: { w: 1, h: 1 } }],
  ['format-naming flag key', 'imp[0].ext.popunder', 1, null],
  ['bookkeeping key', 'imp[0].ext.custom_tracking_id', 'a8f3e91c', { id: '1' }],
  ['metadata key', 'ext.pv', '3.2.1', null],
  ['pop token', 'imp[0].ext.type', 'popunder', { id: '1', banner: { w: 1, h: 1 } }],
  ['push token', 'imp[0].ext.type', 'push_notification', null],
  [
    'media corroborated',
    'imp[0].ext.type',
    'preroll_video',
    { id: '1', video: { w: 640, h: 480 } },
  ],
  ['media with no object', 'imp[0].ext.type', 'native', null],
  ['non-media, instl=1', 'imp[0].ext.format', 'interstitial', { id: '1', instl: 1 }],
  [
    'non-media, no instl',
    'imp[0].ext.format',
    'interstitial',
    { id: '1', banner: { w: 320, h: 480 } },
  ],
];

test('lexicon: locale changes the reason and leaves the verdict alone', () => {
  const base = {
    signalPath: 'imp[0].ext.allowShock',
    signalValue: 1,
    imp: { id: '1', banner: { w: 1, h: 1 } },
  };
  const en = lex.resolveSignal({ ...base, locale: 'en' });
  const uk = lex.resolveSignal({ ...base, locale: 'uk' });
  const ru = lex.resolveSignal({ ...base, locale: 'ru' });

  // Cast to a tuple array: a bare array literal here would infer each slot
  // as `string | (resolveSignal's return type)`, which is what produced the
  // TS2339s below — `r` is always the resolveSignal result, never a string.
  for (const [name, r] of /** @type {Array<[string, ReturnType<typeof lex.resolveSignal>]>} */ ([
    ['en', en],
    ['uk', uk],
    ['ru', ru],
  ])) {
    assert.ok(r, `${name} must resolve`);
    assert.equal(r.label, 'pop', `${name} label drifted`);
    assert.equal(r.source, 'lexicon');
    assert.equal(r.confidence, en.confidence, `${name} confidence drifted from en`);
  }

  assert.equal(
    new Set([en.reason, uk.reason, ru.reason]).size,
    3,
    'each locale must get its own sentence',
  );
  // Pinned to the actual prose, not just "they differ" — a table that
  // returned the key name three times would satisfy a distinctness check.
  assert.match(en.reason, /vendor flag that pop networks send/);
  assert.match(uk.reason, /vendor-прапорець/);
  assert.match(ru.reason, /vendor-флаг/);
});

test('lexicon: every resolving branch is translated in all three locales', () => {
  // The failure this catches: a new branch (or a new reason id) added with an
  // `en` sentence only. `reason()` falls back to `en` for a missing key, so
  // the gap is silent — a Russian operator just gets an English sentence back
  // and nothing throws. Comparing against `en` is what makes it loud.
  for (const [name, signalPath, signalValue, imp] of LOCALIZED_BRANCHES) {
    const of = (locale) => lex.resolveSignal({ signalPath, signalValue, imp, locale });
    const en = of('en');
    assert.ok(en, `${name}: sample no longer resolves — pick another for this branch`);
    for (const locale of ['uk', 'ru']) {
      const r = of(locale);
      assert.equal(r.label, en.label, `${name}: ${locale} label drifted`);
      assert.notEqual(
        r.reason,
        en.reason,
        `${name}: ${locale} fell back to the English sentence — reason id missing from REASONS.${locale}`,
      );
    }
  }
});

test('lexicon: reason defaults to English, and an unknown locale falls back to it', () => {
  // ADR-014: English is the default, not Ukrainian. Callers that predate the
  // locale parameter must get English rather than whatever shipped first.
  const base = {
    signalPath: 'imp[0].ext.sizeID',
    signalValue: [0],
    imp: { id: '1', banner: { w: 1, h: 1 } },
  };
  const en = lex.resolveSignal({ ...base, locale: 'en' });
  // Asserted against the English prose itself, not just against `en` — the two
  // being equal is also true of an implementation that ignores locale entirely
  // and answers in Ukrainian every time, which is the bug this pins.
  assert.match(en.reason, /characteristic pop-inventory marker/, 'locale en must be English');
  // Same tuple-cast reasoning as the loop above — `arg` is always a
  // resolveSignal input object, never the label string alongside it.
  for (const [
    name,
    arg,
  ] of /** @type {Array<[string, Parameters<typeof lex.resolveSignal>[0]]>} */ ([
    ['no locale argument', base],
    ['an unsupported locale', { ...base, locale: 'de' }],
  ])) {
    const r = lex.resolveSignal(arg);
    assert.equal(r.reason, en.reason, `${name} must fall back to English`);
    assert.match(r.reason, /characteristic pop-inventory marker/, `${name} must be English`);
  }
});

// ── 5. the route threads the caller's locale through ─────────────────

/** Minimal req/res pair — enough for lib/http's readJson/sendJson. */
function callSuggest(body) {
  const mod = createAiLabelModule({ auth: { getCurrentUser: () => ({ id: 'u1' }) } });
  const route = mod.routes.find((r) => r.path === '/api/dialects/suggest-label');
  const req = Readable.from([JSON.stringify(body)]);
  const res = {
    statusCode: 0,
    payload: null,
    writeHead(code) {
      res.statusCode = code;
    },
    end(text) {
      res.payload = text ? JSON.parse(text) : null;
    },
  };
  return route.handler(req, res).then(() => res);
}

test('suggest route: the lexicon reason comes back in the requested locale', async () => {
  // A signal the lexicon resolves, so the route answers from stage 1 and
  // never reaches Ollama — the locale threading is what is under test here,
  // not the model call.
  const signal = {
    signal_path: 'imp[0].ext.allowShock',
    signal_value: 1,
    imp: { id: '1', banner: { w: 1, h: 1 } },
  };
  const ru = await callSuggest({ ...signal, locale: 'ru' });
  assert.equal(ru.statusCode, 200);
  assert.equal(ru.payload.suggestion.label, 'pop');
  assert.equal(
    ru.payload.suggestion.reason,
    lex.resolveSignal({
      signalPath: signal.signal_path,
      signalValue: signal.signal_value,
      imp: signal.imp,
      locale: 'ru',
    }).reason,
    'the route must hand the lexicon the locale it was asked for',
  );
  assert.match(ru.payload.suggestion.reason, /vendor-флаг/, 'expected Russian prose');

  const uk = await callSuggest({ ...signal, locale: 'uk' });
  assert.match(uk.payload.suggestion.reason, /vendor-прапорець/, 'expected Ukrainian prose');
});

test('suggest route: a missing or unsupported locale falls back to English', async () => {
  const signal = {
    signal_path: 'imp[0].ext.allowShock',
    signal_value: 1,
    imp: { id: '1', banner: { w: 1, h: 1 } },
  };
  const expected = lex.resolveSignal({
    signalPath: signal.signal_path,
    signalValue: signal.signal_value,
    imp: signal.imp,
    locale: 'en',
  }).reason;

  // Pinned to the English sentence itself: comparing only against `expected`
  // would also hold for a route that ignored locale and answered in Ukrainian.
  assert.match(expected, /vendor flag that pop networks send/, 'locale en must be English');

  for (const locale of [undefined, 'de', '', 'UK', 'uk-UA', 42, null, ['ru']]) {
    const res = await callSuggest(locale === undefined ? signal : { ...signal, locale });
    const tag = `locale ${JSON.stringify(locale)}`;
    assert.equal(res.statusCode, 200, `${tag} must not break the route`);
    assert.equal(res.payload.suggestion.reason, expected, `${tag} must fall back to English`);
    assert.match(res.payload.suggestion.reason, /vendor flag that pop networks send/, tag);
  }
});

// ── 6. the persona varies by exactly one sentence ────────────────────

/** BODY and CLOSING are joined by a blank line; split them back apart. */
function splitPersona(text) {
  const cut = text.lastIndexOf('\n\n');
  return { body: text.slice(0, cut), closing: text.slice(cut + 2) };
}

test('persona: the calibrated body has not drifted', () => {
  // The persona's confidence scale was tuned against a live model and is the
  // difference between an honest `custom` at 0.2 and a confidently wrong
  // `native` at 0.95 (see lib/label-persona.js's header). Nothing in CI can
  // measure that, so this pins the bytes instead: if you meant to change the
  // persona, re-run scripts/label-calibration.js — watching its HOLDOUT set,
  // not just TUNE — and update this digest in the same commit.
  const body = splitPersona(buildPersona('uk')).body;
  assert.equal(
    createHash('sha256').update(body, 'utf8').digest('hex'),
    '6590777b82620a4c2510e506f76919b85a6be77a000f97a42d086558e4f2a7d4',
    'the persona body changed — re-run scripts/label-calibration.js before updating this digest',
  );
});

test('persona: PERSONA stays byte-identical to the Ukrainian build', () => {
  // scripts/label-calibration.js and any other importer still read the bare
  // constant; making it anything other than buildPersona('uk') would move the
  // bench off the text it has been scoring.
  assert.equal(PERSONA, buildPersona('uk'));
});

test('persona: locales differ only in the closing sentence', () => {
  const builds = ['en', 'uk', 'ru'].map((l) => ({ locale: l, ...splitPersona(buildPersona(l)) }));
  const [en, uk, ru] = builds;

  for (const b of builds) {
    assert.equal(b.body, en.body, `${b.locale} altered the calibrated body`);
    assert.ok(b.closing.length > 0, `${b.locale} has no closing sentence`);
    assert.ok(!b.body.includes(b.closing), `${b.locale} leaked its closing into the body`);
  }
  assert.equal(
    new Set(builds.map((b) => b.closing)).size,
    3,
    'each locale must name its own reason language',
  );
  assert.match(en.closing, /in English/);
  assert.match(uk.closing, /українською/);
  assert.match(ru.closing, /по-русски/);
});

test('persona: an unknown locale keeps the Ukrainian build', () => {
  // Deliberately NOT the 'en' default resolveSignal uses: buildPersona's
  // fallback exists so the exported PERSONA constant — and the calibration
  // bench that reads it — keep the exact string they were tuned against.
  // Callers choose English by asking for it; classifySignal defaults to 'en'.
  assert.equal(buildPersona('de'), buildPersona('uk'));
  assert.equal(buildPersona(undefined), buildPersona('uk'));
});

// ── 7. the model prompt is built in the caller's locale ──────────────

test('model prompt: structural field labels and persona follow the locale', async () => {
  // classifySignal needs no GPU to be worth testing: what it sends is fully
  // determined before the request leaves. Stubbing fetch captures the exact
  // system+prompt pair, which is the thing feature 015 changed.
  const seen = [];
  const realFetch = globalThis.fetch;
  // Partial Response stub: lib/ollama.js's classifySignal only ever reads
  // `.ok` and `.json()` off the fetch result on this path, so a full
  // Response (headers, status, body stream, …) would be dead weight here.
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (_url, init) => {
      seen.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          response: JSON.stringify({ label: 'pop', confidence: 0.5, reason: 'stub' }),
          model: 'gemma4-prod',
        }),
      };
    }
  );

  try {
    const input = {
      signalPath: 'imp[0].ext.zone',
      signalValue: 'popunder',
      impSketch: { banner: { w: 1, h: 1 } },
      siblingKeys: ['allowShock'],
    };
    await ollama.classifySignal({ ...input, locale: 'en' });
    await ollama.classifySignal({ ...input, locale: 'uk' });
    await ollama.classifySignal({ ...input, locale: 'ru' });
    await ollama.classifySignal(input); // no locale at all
    await ollama.classifySignal({ ...input, locale: 'de' }); // unsupported

    const [en, uk, ru, implicit, unsupported] = seen;

    assert.match(en.prompt, /^Path: imp\[0\]\.ext\.zone\nValue: /);
    assert.match(uk.prompt, /^Шлях: imp\[0\]\.ext\.zone\nЗначення: /);
    assert.match(ru.prompt, /^Путь: imp\[0\]\.ext\.zone\nЗначение: /);

    assert.match(en.prompt, /Sibling keys in the same ext: allowShock/);
    assert.match(uk.prompt, /Сусідні ключі в тому самому ext: allowShock/);
    assert.match(ru.prompt, /Соседние ключи в том же ext: allowShock/);

    assert.match(en.prompt, /Impression structure: /);
    assert.match(uk.prompt, /Структура impression: /);
    assert.match(ru.prompt, /Структура impression: /);

    // The persona travels in the same language as the field labels, so the
    // model's whole context window is one language rather than two.
    assert.equal(en.system, buildPersona('en'));
    assert.equal(uk.system, buildPersona('uk'));
    assert.equal(ru.system, buildPersona('ru'));

    // ADR-014 again, at the other end of the chain.
    assert.equal(implicit.prompt, en.prompt, 'no locale must build the English prompt');
    assert.equal(implicit.system, en.system, 'no locale must send the English persona');
    assert.equal(unsupported.prompt, en.prompt, 'an unsupported locale must build English');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('model prompt: the no-impression line is localized too', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  // Partial Response stub — see the comment on the identical stub above.
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (_url, init) => {
      seen.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          response: JSON.stringify({ label: 'ignore', confidence: 0.4, reason: 'stub' }),
          model: 'gemma4-prod',
        }),
      };
    }
  );

  try {
    const input = { signalPath: 'ext.pv', signalValue: '3.2.1', impSketch: null, siblingKeys: [] };
    for (const locale of ['en', 'uk', 'ru']) await ollama.classifySignal({ ...input, locale });
    const [en, uk, ru] = seen;
    assert.match(en.prompt, /Request-level signal — no impression\.$/);
    assert.match(uk.prompt, /Сигнал на рівні запиту — impression відсутній\.$/);
    assert.match(ru.prompt, /Сигнал на уровне запроса — impression отсутствует\.$/);
    assert.equal(new Set([en.prompt, uk.prompt, ru.prompt]).size, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});
