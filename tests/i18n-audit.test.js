'use strict';

/**
 * Audit regressions for the two things that decide whether a finding is
 * READABLE and whether it is FINDABLE: the localized message catalogs and the
 * location contract that turns a finding into a line number.
 *
 * Three defects are pinned here, all of the same shape — a value was computed
 * correctly and then thrown away on the way to the reader:
 *
 *   1. en.json rendered a literal `{path}` in `err-schain-invalid` and
 *      `err-eids-entry-invalid`. The interpolator leaves unknown variables
 *      standing on purpose (it helps while writing catalogs), so the English
 *      reader — and every consumer of /api/v1/finding-catalog, whose default
 *      language is `en` — got curly braces where a JSON path belonged. The uk
 *      and ru templates never referenced the variable, so the emitters never
 *      had a reason to pass it.
 *
 *   2. en.json silently dropped data that uk and ru show: the allowed slot
 *      sizes in `crosscheck.bid.size_mismatch` and the top auction price in
 *      `crosscheck.auction.summary`. Both parameters are computed and passed;
 *      only the English sentence declined to use them, which left an English
 *      operator told that the creative does not fit without being told what
 *      would.
 *
 *   3. finding-location.js classified every `payload.*` id as 'envelope' and
 *      envelope means "no jump", so a duplicate bid floor — an ERROR — carried
 *      no location at all. That is worse than a dead chip: the gutter painter
 *      skips any finding without `location.primary`, so the line stayed
 *      unpainted, which reads as a statement that nothing is wrong there.
 *
 * The catalog tests deliberately assert the CLASS, not the two strings. A
 * placeholder-parity check across all three locales is the invariant that both
 * catalog defects violate, and it is the one that keeps the next translation
 * from re-introducing them.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = require('../packages/core');
const FL = require('../packages/core/finding-location');
const { buildSourceMap } = require('../packages/core/source-map');
const messages = require('../packages/core/messages');

const CATALOGS = {
  en: require('../packages/core/messages/en.json'),
  uk: require('../packages/core/messages/uk.json'),
  ru: require('../packages/core/messages/ru.json'),
};

const SAMPLES = path.join(__dirname, '..', 'samples');

/**
 * The set of variables a template actually consumes.
 *
 * Mirrors the interpolator in messages/index.js exactly, including its `{{x}}`
 * escape: a doubled brace renders as a literal `{x}` (JSON previews use it for
 * macros like `${MACRO}`) and is therefore NOT a variable the emitter has to
 * supply. Re-deriving it here rather than importing keeps this test honest if
 * the interpolator is ever swapped for ICU — the test would then fail loudly
 * instead of agreeing with whatever the new implementation does.
 */
function templateVars(tpl) {
  const out = new Set();
  String(tpl).replace(/\{(\{?)(\w+)\}?\}/g, function (whole, escaped, key) {
    if (escaped !== '{') out.add(key);
    return whole;
  });
  return out;
}

/** Placeholders left standing in a RENDERED message = a variable nobody passed. */
function unresolvedVars(msg) {
  return String(msg || '').match(/\{\w+\}/g) || [];
}

/**
 * @typedef {{id: string, keys: Record<string, Record<string, string>>}} BrowserModuleDictionary
 */

/**
 * @param {string} relativePath
 * @returns {BrowserModuleDictionary}
 */
function loadBrowserModuleDictionary(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  let registered = null;
  const window = {
    registerI18nModule(spec) {
      registered = spec;
    },
  };
  new Function('window', source)(window);
  assert.ok(registered, `${relativePath} did not register an i18n module`);
  return /** @type {BrowserModuleDictionary} */ (/** @type {unknown} */ (registered));
}

function loadSamples() {
  return fs
    .readdirSync(SAMPLES)
    .filter(function (n) {
      return n.endsWith('.json');
    })
    .sort()
    .map(function (name) {
      const raw = fs.readFileSync(path.join(SAMPLES, name), 'utf8');
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (_e) {
        payload = raw;
      }
      return { name: name, raw: raw, payload: payload };
    });
}

/**
 * A minimal stubbed-browser vm context for evaluating public/i18n.js and its
 * module dictionaries. Both reference bare `document`/`localStorage` globals
 * (not `window.document`), which is why this needs node:vm rather than the
 * `new Function('window', src)(window)` trick used above and in
 * source-nav-i18n.test.js — that trick only ever injects `window`.
 */
function makeBrowserSandbox() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const document = { documentElement: { getAttribute: () => null } };
  const window = { kt_i18n_modules: [] };
  return vm.createContext({ window, document, localStorage, console });
}

/** Every `i18n.js` / `*.i18n.js` file one level under public/modules/. */
function findModuleI18nFiles() {
  const modulesDir = path.join(__dirname, '..', 'public', 'modules');
  const out = [];
  for (const dir of fs.readdirSync(modulesDir)) {
    const dirPath = path.join(modulesDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const name of fs.readdirSync(dirPath)) {
      if (name === 'i18n.js' || name.endsWith('.i18n.js')) {
        out.push(path.join('public', 'modules', dir, name));
      }
    }
  }
  return out.sort();
}

/**
 * Boots public/i18n.js in a stubbed browser context, then loads every module
 * i18n.js in the SAME context, so each one takes the real "central script
 * already booted" path (window.registerI18nModule is a function → call it
 * directly, per the either-or contract every module file documents and
 * source-nav-i18n.test.js pins for one of them). window.registerI18nModule
 * is wrapped here, not replaced, so the real merge into the app's I18N table
 * still runs — this captures the exact specs the app itself would register,
 * not a re-derived approximation of them.
 *
 * A file that fails to evaluate as a classic script (public/modules/
 * dialects/i18n.js is ESM — `export const uk = …` — and is being deleted
 * elsewhere this session) is SKIPPED rather than fatal: one broken module
 * must not take the whole regression net down with it. But the skip is
 * logged via console.warn so it stays visible in `node --test` output — a
 * catalog that silently fails to load must not be able to pass this test
 * merely by not being there.
 */
function loadRegisteredBrowserSpecs() {
  const ctx = makeBrowserSandbox();
  const centralSrc = fs.readFileSync(path.join(__dirname, '..', 'public/i18n.js'), 'utf8');
  vm.runInContext(centralSrc, ctx, { filename: 'public/i18n.js' });

  const specs = [];
  const realRegister = ctx.window.registerI18nModule;
  ctx.window.registerI18nModule = function (spec) {
    specs.push(spec);
    return realRegister(spec);
  };

  const skipped = [];
  for (const rel of findModuleI18nFiles()) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    try {
      vm.runInContext(src, ctx, { filename: rel });
    } catch (e) {
      skipped.push({ file: rel, error: e.message });
    }
  }
  for (const s of skipped) {
    console.warn(`[i18n-audit] skipped ${s.file} (could not evaluate as a script): ${s.error}`);
  }
  return { specs, skipped };
}

/**
 * The central `I18N` table in public/i18n.js — ~1300 lines of hand-written
 * uk/en/ru object literals plus several later batches merged in via loops
 * (`cab`, `tier4`, ...) — is a `const` sealed inside that file's own IIFE, so
 * nothing outside it (including `window.t()`) exposes the raw per-locale
 * strings; `window.t()` only returns ONE locale's resolution of one key at a
 * time, chosen by `activeLocale()`, and never the other two locales' text to
 * compare against.
 *
 * Rather than re-deriving the whole table by regex (fragile against the
 * very hand-edits this guard exists to catch), this patches a single
 * `window.__i18nTableForAudit = I18N;` line onto the real source, in
 * memory, immediately before its closing `})();` — the same
 * extract-and-eval-a-copy approach tests/plural-forms.test.js already uses
 * to reach a function sealed inside a different browser IIFE. The app's own
 * `window.tInfo()` reports key counts for exactly this table, so a count
 * mismatch here would mean the patch point moved.
 */
function loadCentralI18NTable() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/i18n.js'), 'utf8');
  const closeMarker = '\n})();';
  const at = src.lastIndexOf(closeMarker);
  assert.notEqual(at, -1, 'public/i18n.js must still end with its self-invoking closure');
  const patched = src.slice(0, at) + '\n  window.__i18nTableForAudit = I18N;' + src.slice(at);
  const ctx = makeBrowserSandbox();
  vm.runInContext(patched, ctx, { filename: 'public/i18n.js (audit copy, I18N exposed)' });
  const table = ctx.window.__i18nTableForAudit;
  assert.ok(table && table.uk && table.en && table.ru, 'expected the patched I18N table');
  const info = ctx.window.tInfo();
  assert.equal(
    Object.keys(table.uk).length,
    info.keys_uk,
    'uk key count must match window.tInfo()',
  );
  assert.equal(
    Object.keys(table.ru).length,
    info.keys_ru,
    'ru key count must match window.tInfo()',
  );
  return table;
}

// Ukrainian-only letters (і/ї/є/ґ) must never appear in a Russian value, and
// Russian-only letters (ы/ъ/э/ё) must never appear in a Ukrainian value — the
// two alphabets overlap almost completely, so a value written in the wrong
// one still LOOKS like plausible text at a glance; only these four letters
// per language give it away. English must contain no Cyrillic at all. This
// is the exact class of defect "Сидбід" was: one dotted Ukrainian і sitting
// inside an otherwise fully Russian ru.json sentence.
const UK_ONLY_LETTERS = /[іїєґІЇЄҐ]/;
const RU_ONLY_LETTERS = /[ыъэёЫЪЭЁ]/;
const ANY_CYRILLIC = /[Ѐ-ӿ]/;

// A small, explicitly-named allowlist for a legitimate cross-alphabet letter
// (a quoted foreign term, a proper noun). Empty today — add an entry only for
// a real, confirmed case, and say why right here when you do.
const SCRIPT_HYGIENE_EXCEPTIONS = new Set([
  // 'core:ru:some.id' — none needed yet.
]);

function scriptHygieneViolations(sourceTag, id, locale, value) {
  if (typeof value !== 'string') return [];
  if (SCRIPT_HYGIENE_EXCEPTIONS.has(`${sourceTag}:${locale}:${id}`)) return [];
  const out = [];
  if (locale === 'ru' && UK_ONLY_LETTERS.test(value)) {
    out.push(`${sourceTag}/${id} (ru) uses a Ukrainian-only letter: ${value}`);
  }
  if (locale === 'uk' && RU_ONLY_LETTERS.test(value)) {
    out.push(`${sourceTag}/${id} (uk) uses a Russian-only letter: ${value}`);
  }
  if (locale === 'en' && ANY_CYRILLIC.test(value)) {
    out.push(`${sourceTag}/${id} (en) contains Cyrillic: ${value}`);
  }
  return out;
}

// ── 1. the two templates that printed their own placeholder ─────────────────

test('en: err-schain-invalid renders the type, not a literal {path}', () => {
  const req = {
    id: 'r1',
    imp: [{ id: '1', banner: { w: 300, h: 250 } }],
    site: { id: 's', page: 'https://a.b/c' },
    source: { ext: { schain: 'not-an-object' } },
  };
  const f = core
    .validate(req, { locale: 'en' })
    .findings.find((x) => x.id === 'err-schain-invalid');
  assert.ok(f, 'expected err-schain-invalid');
  assert.deepEqual(unresolvedVars(f.msg), [], `unresolved placeholder in: ${f.msg}`);
  assert.match(f.msg, /type: string/, 'the one parameter the emitter passes must survive');
  // The path is not lost to the reader — it travels in the finding's own
  // `path` field, which is what the UI chip and the location contract read.
  assert.equal(f.path, 'source.ext.schain');
});

test('en: err-eids-entry-invalid names the entry index instead of a literal {path}', () => {
  const req = {
    id: 'r1',
    imp: [{ id: '1', banner: { w: 300, h: 250 } }],
    site: { id: 's', page: 'https://a.b/c' },
    user: { ext: { eids: ['nope', { source: 'x.com', uids: [{ id: 'a' }] }] } },
  };
  const f = core
    .validate(req, { locale: 'en' })
    .findings.find((x) => x.id === 'err-eids-entry-invalid');
  assert.ok(f, 'expected err-eids-entry-invalid');
  assert.deepEqual(unresolvedVars(f.msg), [], `unresolved placeholder in: ${f.msg}`);
  assert.match(f.msg, /\[0\]/, 'the offending index must be named');
  assert.match(f.msg, /type: string/);
  assert.equal(f.path, 'user.ext.eids[0]');
});

// ── 2. the English catalog must not quietly show less than the others ───────

test('en: size_mismatch lists the allowed formats and the summary names the top price', () => {
  const req = {
    id: 'r',
    imp: [
      {
        id: '1',
        banner: {
          format: [
            { w: 300, h: 250 },
            { w: 728, h: 90 },
          ],
        },
      },
    ],
    site: { id: 's', page: 'https://a.b/c' },
  };
  const res = {
    id: 'r',
    cur: 'USD',
    seatbid: [
      {
        bid: [
          { id: 'b', impid: '1', price: 1, adm: 'x', adomain: ['a.com'], crid: 'c', w: 320, h: 50 },
        ],
      },
    ],
  };
  const en = core.crosscheck(req, res, { locale: 'en' });
  const size = en.find((f) => f.id === 'crosscheck.bid.size_mismatch');
  const summary = en.find((f) => f.id === 'crosscheck.auction.summary');
  assert.ok(size && summary);

  // The operator is told what the creative does NOT fit; they must also be told
  // what it would fit, which is the whole actionable half of the finding.
  assert.match(size.msg, /300×250, 728×90/, `allowed sizes missing from: ${size.msg}`);
  assert.match(summary.msg, /1\.0000/, `top price missing from: ${summary.msg}`);
  assert.deepEqual(unresolvedVars(size.msg), []);
  assert.deepEqual(unresolvedVars(summary.msg), []);
});

test('catalogs: every locale consumes the SAME parameters for the same finding id', () => {
  // This is the class-level guard. Both catalog defects above are instances of
  // one thing — a template that references a variable no emitter passes, or
  // ignores one that every other language shows — and both are invisible in a
  // per-string review because nothing crashes either way. Set equality over
  // the shared keys catches both directions at once.
  const ids = Object.keys(CATALOGS.en).filter((k) => k[0] !== '_');
  assert.ok(ids.length > 300, 'expected the full English catalog, not a stub');

  // Key-set parity FIRST, before comparing placeholders. The confirmed
  // weakness this closes: `if (!(id in CATALOGS[locale])) continue` used to
  // treat an id missing from a locale entirely the same as an id with
  // nothing to report — silently fine either way. It is not fine: a missing
  // id is exactly what resolve() prints as a raw `[id]` to a real reader.
  // And because the loop below only ever walks Object.keys(CATALOGS.en), an
  // id that exists in uk/ru but was never added to en.json could not have
  // been caught by any loop keyed off en's list — so this checks every
  // locale against the UNION of all three id sets, not just en's.
  const allIds = new Set(
    [...Object.keys(CATALOGS.en), ...Object.keys(CATALOGS.uk), ...Object.keys(CATALOGS.ru)].filter(
      (k) => k[0] !== '_',
    ),
  );
  const missing = [];
  for (const id of allIds) {
    for (const locale of ['en', 'uk', 'ru']) {
      if (!(id in CATALOGS[locale])) missing.push(`${id}: missing from ${locale}.json`);
    }
  }
  assert.deepEqual(missing, [], 'a finding id must exist in all three locale catalogs');

  const drift = [];
  for (const id of ids) {
    const base = templateVars(CATALOGS.en[id]);
    for (const locale of ['uk', 'ru']) {
      // Defense in depth: the parity assertion above already fails loudly,
      // by id, when a locale is missing one. This loop must not go back to
      // silently skipping it if it is ever reached in isolation — e.g. a
      // future refactor that runs this half without the check above.
      if (!(id in CATALOGS[locale])) {
        drift.push(`${id}: missing entirely from ${locale}.json`);
        continue;
      }
      const other = templateVars(CATALOGS[locale][id]);
      const onlyThere = [...other].filter((v) => !base.has(v));
      const onlyEn = [...base].filter((v) => !other.has(v));
      if (onlyThere.length || onlyEn.length) {
        drift.push(`${id}: ${locale}-only={${onlyThere}} en-only={${onlyEn}}`);
      }
    }
  }
  assert.deepEqual(drift, [], 'placeholder drift between locales');
});

test('Inspector module dictionary keeps locale and placeholder parity', () => {
  const spec = loadBrowserModuleDictionary('public/modules/inspector/dialect-label.i18n.js');
  assert.equal(spec.id, 'inspector-dialect-label');
  assert.ok(spec.keys['creative.kind.trimmed'], 'the localized VAST trim notice is required');

  const drift = [];
  for (const [key, translations] of Object.entries(spec.keys)) {
    const base = templateVars(translations.en);
    for (const locale of ['uk', 'en', 'ru']) {
      const value = translations[locale];
      if (typeof value !== 'string' || !value.trim()) {
        drift.push(`${key}: missing ${locale}`);
        continue;
      }
      const variables = templateVars(value);
      const onlyLocale = [...variables].filter((name) => !base.has(name));
      const onlyEnglish = [...base].filter((name) => !variables.has(name));
      if (onlyLocale.length || onlyEnglish.length) {
        drift.push(
          `${key}: ${locale}-only={${onlyLocale.join(',')}} en-only={${onlyEnglish.join(',')}}`,
        );
      }
    }
  }
  assert.deepEqual(drift, [], 'module dictionary locale/placeholder drift');
});

test('catalogs: no finding over the sample corpus renders an unresolved placeholder', () => {
  // The parity test above proves the three catalogs agree with each other; it
  // cannot prove they agree with the EMITTERS. This one does, by rendering
  // every finding the real corpus produces in every locale. `rawText` is passed
  // so the byte-level rules (duplicate keys, unsafe numbers) are exercised too.
  const samples = loadSamples();
  assert.ok(samples.length > 10, 'expected a corpus to sweep');

  const bad = [];
  let rendered = 0;
  for (const s of samples) {
    for (const locale of ['en', 'uk', 'ru']) {
      let r;
      try {
        r = core.validate(s.payload, { locale: locale, rawText: s.raw });
      } catch (_e) {
        continue; // a sample the validator refuses is not this test's subject
      }
      for (const f of r.findings) {
        rendered++;
        const left = unresolvedVars(f.msg);
        if (left.length) bad.push(`${s.name} [${locale}] ${f.id}: ${left.join(' ')}`);
      }
    }
  }
  assert.ok(rendered > 100, `expected a meaningful sweep, rendered ${rendered}`);
  assert.deepEqual(bad.slice(0, 20), [], 'messages rendered with a variable nobody passed');
});

// ── 3. payload.* findings that name a real place must carry it ──────────────

// Two `bidfloor` keys and one misspelled `bidfloorcurr`, written as text
// because both defects exist only in the bytes: `JSON.parse` keeps one floor
// and erases the other, and an unknown key is by spec ignored in silence.
const RAW_WITH_BYTE_DEFECTS = [
  '{',
  '  "id": "req-1",',
  '  "imp": [',
  '    {',
  '      "id": "1",',
  '      "banner": { "w": 300, "h": 250 },',
  '      "bidfloor": 0.5,',
  '      "bidfloorcurr": "USD",',
  '      "bidfloor": 2.5',
  '    }',
  '  ],',
  '  "site": { "id": "s", "page": "https://a.b/c" }',
  '}',
].join('\n');

function analyzeRaw(raw) {
  const r = core.validate(JSON.parse(raw), { locale: 'en', rawText: raw });
  FL.attachLocations(r.findings, { side: 'request', kind: 'ortb' });
  return r.findings;
}

test('payload.duplicate_key carries an exact location that resolves to the duplicated KEY', () => {
  const findings = analyzeRaw(RAW_WITH_BYTE_DEFECTS);
  const dup = findings.find((f) => f.id === 'payload.duplicate_key');
  assert.ok(dup, 'expected payload.duplicate_key from the raw bytes');
  assert.equal(dup.level, 'error', 'a duplicate bid floor is a money-ambiguity error');
  assert.equal(dup.path, 'imp[0].bidfloor');

  const loc = dup.location;
  assert.equal(loc.dialect, 'ortb-json', 'a finding that names a JSON place is not an envelope');
  assert.equal(loc.precision, 'exact');
  assert.ok(loc.primary, 'the gutter painter skips anything without a primary');
  assert.equal(loc.primary.side, 'request');
  assert.equal(loc.primary.pointer, '/imp/0/bidfloor');
  // The defect IS the name, not the number behind it — underlining `2.5` would
  // tell the reader to fix a value that is not what is wrong.
  assert.equal(loc.primary.target, 'key');

  const map = buildSourceMap(RAW_WITH_BYTE_DEFECTS);
  assert.ok(map.ok);
  const entry = map.resolve(loc.primary.pointer);
  assert.ok(entry, 'the pointer must resolve against the very bytes it came from');
  assert.equal(RAW_WITH_BYTE_DEFECTS.slice(entry.keyStart, entry.keyEnd), '"bidfloor"');
  // A pointer names one place and a duplicate key occupies two. The map keeps
  // the last, which is also the one `JSON.parse` kept and therefore the value
  // every other rule in the same run was reading — so the jump lands on the
  // occurrence that won, which is the honest answer to "where is this".
  assert.equal(map.positionAt(entry.keyStart).line, 9);
});

test('payload.field_misspelled points at the misspelled name, not at its value', () => {
  const findings = analyzeRaw(RAW_WITH_BYTE_DEFECTS);
  const typo = findings.find((f) => f.id === 'payload.field_misspelled');
  assert.ok(typo, 'expected payload.field_misspelled for bidfloorcurr');
  assert.equal(typo.location.dialect, 'ortb-json');
  assert.equal(typo.location.primary.pointer, '/imp/0/bidfloorcurr');
  assert.equal(typo.location.primary.target, 'key');

  const map = buildSourceMap(RAW_WITH_BYTE_DEFECTS);
  const entry = map.resolve(typo.location.primary.pointer);
  assert.ok(entry);
  assert.equal(RAW_WITH_BYTE_DEFECTS.slice(entry.keyStart, entry.keyEnd), '"bidfloorcurr"');
  assert.equal(map.positionAt(entry.keyStart).line, 8);
});

test('the gutter predicate now holds: every located ERROR has a primary to paint', () => {
  // Reproduces paintGutterSeverity's exact gate (ortbtools.app.js): a finding
  // with a level but no `location.primary` is skipped, and the line it belongs
  // to stays unpainted. For a byte-level ERROR that is the gutter asserting the
  // line is clean, on the one line where two receivers can read different money.
  const findings = analyzeRaw(RAW_WITH_BYTE_DEFECTS);
  const payloadErrors = findings.filter(
    (f) => f.id.indexOf('payload.') === 0 && f.level === 'error',
  );
  assert.ok(payloadErrors.length > 0, 'expected at least one byte-level error');
  for (const f of payloadErrors) {
    assert.ok(f.location && f.location.primary, `${f.id} would leave its line unpainted`);
  }
});

test('the key-target table answers only for ids it actually lists', () => {
  // A plain object indexed by a string taken from a finding answers truthy for
  // every name on Object.prototype. `constructor` is not a finding id today, so
  // this pins the guard rather than a bug — the table has to be able to say no.
  for (const id of ['constructor', 'toString', 'hasOwnProperty', 'payload.unsafe_number']) {
    const l = FL.buildNormalLocation(
      { id: id, path: 'imp[0].bidfloor' },
      { side: 'request', kind: 'ortb' },
    );
    assert.equal(l.primary.target, 'value', `${id} must not be treated as key-targeted`);
  }
});

// ── 3b. the other half of `payload.*` must stay honest ──────────────────────

test('payload.* about the whole payload keeps precision none and dialect envelope', () => {
  // invalid_root / unknown_type / ambiguous_* / raw_scan_truncated carry no
  // path because there is no place to jump to. Promoting the family wholesale
  // would have invented one.
  for (const id of [
    'payload.invalid_root',
    'payload.unknown_type',
    'payload.ambiguous_both_sides',
    'payload.raw_scan_truncated',
  ]) {
    const l = FL.buildNormalLocation({ id: id, path: '' }, { side: 'request', kind: 'ortb' });
    assert.equal(l.dialect, 'envelope', `${id} must stay envelope`);
    assert.equal(l.precision, 'none');
    assert.equal(l.primary, null);
  }
});

test('a payload path outside the display grammar stays envelope rather than pointerless', () => {
  // raw-json.js bracket-quotes a key that is not an identifier, so a JSON
  // object with a key literally named `a.b` produces the path `["a.b"]`, which
  // the display grammar cannot parse. The corpus invariant is that every
  // ortb-json finding with a path yields a pointer; such a finding therefore
  // has to stay envelope instead of becoming an ortb-json one with nowhere to go.
  const raw = '{"id":"x","a.b":1,"a.b":2,"imp":[{"id":"1"}]}';
  const dup = analyzeRaw(raw).find(
    (f) => f.id === 'payload.duplicate_key' && f.path.indexOf('[') === 0,
  );
  assert.ok(dup, 'expected a bracket-quoted duplicate-key path');
  assert.equal(FL.pathToPointer(dup.path), null, 'precondition: unparseable display path');
  assert.equal(dup.location.dialect, 'envelope');
  assert.equal(dup.location.precision, 'none');
});

test('version.* and jsonfeed.* are untouched — still envelope, still no jump', () => {
  for (const id of ['version.assumed', 'version.mismatch', 'jsonfeed.not_validated']) {
    const l = FL.buildNormalLocation({ id: id, path: '' }, { side: 'request', kind: 'ortb' });
    assert.equal(l.dialect, 'envelope', `${id} must stay envelope`);
    assert.equal(l.precision, 'none');
  }
});

test('corpus: every promoted payload.* finding yields a pointer, and envelope still means no jump', () => {
  // finding-location-corpus.test.js runs the same shape of check, but over a
  // `synthetic-*`/`iab-*` subset and WITHOUT `rawText` — so the byte-level rules
  // this change promoted out of 'envelope' never fire there and could not have
  // been covered. This sweep passes the raw text for every sample.
  //
  // The pointer assertion is scoped to `payload.*` on purpose. It is the family
  // this change moved into 'ortb-json', so it is the family that has to hold its
  // side of the corpus invariant. Widening it to all ids fails today on a
  // pre-existing, unrelated gap — the JSON-feed rules emit array-rooted display
  // paths like `[0].click_url`, which parsePathSegments rejects because the
  // grammar requires a leading identifier. Those already resolve to precision
  // 'none', so nothing is broken by them; pinning that here would only make this
  // test fail for someone else's reason.
  for (const s of loadSamples()) {
    let r;
    try {
      r = core.validate(s.payload, { locale: 'en', rawText: s.raw });
    } catch (_e) {
      continue;
    }
    FL.attachLocations(r.findings, { side: 'request', kind: 'ortb' });
    for (const f of r.findings) {
      const l = f.location;
      if (l.dialect === 'envelope') {
        assert.equal(l.precision, 'none', `${s.name} ${f.id}: envelope must mean no jump`);
      }
      if (f.id.indexOf('payload.') === 0 && l.dialect === 'ortb-json') {
        assert.notEqual(
          FL.pathToPointer(f.path),
          null,
          `${s.name} ${f.id}: ortb-json path "${f.path}" has no pointer`,
        );
      }
    }
  }
});

test('location contract still carries no payload VALUE for byte-level findings', () => {
  // The privacy rule for the contract is that it derives from ids, paths and
  // structure only. Promoting payload.* added pointers built from KEY names;
  // this pins that no value came along with them.
  const findings = analyzeRaw(RAW_WITH_BYTE_DEFECTS);
  const blob = JSON.stringify(findings.map((f) => f.location));
  for (const value of ['0.5', '2.5', 'req-1', 'https://a.b/c']) {
    assert.ok(!blob.includes(value), `location contract leaked payload value "${value}"`);
  }
});

// ── 4. browser catalogs: module i18n.js files keep the same triple-locale ───
//      + placeholder contract the core catalogs do ──────────────────────────

test('browser catalogs: every registered module key carries full uk/en/ru with matching placeholders', () => {
  // Same class of defect as the core-catalog test above, one layer down: a
  // module i18n.js is a hand-written object literal per key, and it is
  // exactly as easy to add a key with `uk:`/`en:` and forget the `ru:` line
  // as it was to forget a whole id in ru.json. This sweeps every key any
  // module ACTUALLY registers through the real /i18n.js merge — not a
  // re-derived guess at what should be there — and is the invariant that
  // would have caught a module catalog shipping a key with no ru line.
  const { specs } = loadRegisteredBrowserSpecs();
  assert.ok(specs.length >= 15, `expected most module catalogs to load, got ${specs.length}`);

  let totalKeys = 0;
  const drift = [];
  for (const spec of specs) {
    for (const [key, translations] of Object.entries(spec.keys || {})) {
      totalKeys++;
      const base = templateVars(translations.en);
      for (const locale of ['uk', 'en', 'ru']) {
        const value = translations[locale];
        if (typeof value !== 'string' || !value.trim()) {
          drift.push(`${spec.id}/${key}: missing ${locale}`);
          continue;
        }
        const variables = templateVars(value);
        const onlyLocale = [...variables].filter((v) => !base.has(v));
        const onlyEn = [...base].filter((v) => !variables.has(v));
        if (onlyLocale.length || onlyEn.length) {
          drift.push(
            `${spec.id}/${key}: ${locale}-only={${onlyLocale.join(',')}} en-only={${onlyEn.join(',')}}`,
          );
        }
      }
    }
  }
  assert.ok(totalKeys > 100, `expected a meaningful sweep of module keys, got ${totalKeys}`);
  assert.deepEqual(drift, [], 'module catalog locale/placeholder drift');
  // No assertion is pinned to a fixed file list or count here — see the
  // loader's own comment for why. A silently-empty skip list is not required
  // for this test to be meaningful: it still sweeps every module that DID
  // load, and console.warn above makes any skip visible in the run's output.
});

// ── 5. script hygiene: no locale spells its text with another alphabet ──────

test('script hygiene: core and browser catalogs never use another locale exclusive letters', () => {
  const violations = [];
  for (const locale of ['en', 'uk', 'ru']) {
    for (const [id, value] of Object.entries(CATALOGS[locale])) {
      if (id[0] === '_') continue;
      violations.push(...scriptHygieneViolations('core', id, locale, value));
    }
  }
  const { specs } = loadRegisteredBrowserSpecs();
  for (const spec of specs) {
    for (const [key, translations] of Object.entries(spec.keys || {})) {
      for (const locale of ['en', 'uk', 'ru']) {
        violations.push(
          ...scriptHygieneViolations(`browser:${spec.id}`, key, locale, translations[locale]),
        );
      }
    }
  }
  assert.deepEqual(violations, [], 'a locale value used another locale exclusive alphabet');
});

// ── 6. lexical calques: a wrong word can spell itself with the RIGHT ────────
//      alphabet, so the script-hygiene scan above cannot see it ────────────

/**
 * The script-hygiene scan two tests up catches a value written in the wrong
 * ALPHABET. It structurally cannot catch a value written in the wrong
 * LANGUAGE using letters the two alphabets share — and Ukrainian and Russian
 * share almost all of theirs. That gap is not hypothetical: this very
 * feature shipped «rules-движок» inside an otherwise-Ukrainian sentence in
 * public/modules/simulate/i18n.js (fixed alongside this guard), and
 * packages/core/dialects/signal-lexicon.js carried the same word in its own
 * uk reason table until a human read the diff. Every letter in «движок»
 * exists in the Ukrainian alphabet too, so it read as plausible text at a
 * glance and sailed through every automated check that existed at the time.
 *
 * This guard and the script-hygiene one are deliberately two separate checks
 * covering two separate defect classes — a shared alphabet does not imply a
 * shared vocabulary, and a value can fail either check without failing the
 * other. Neither subsumes the other, so neither may be deleted in favor of
 * the other.
 *
 * DESIGN: precision over coverage. A false positive here teaches the next
 * person to weaken the guard, which loses the real defects it does catch —
 * so this list stays small, and every entry is a word that is simply WRONG
 * in its flagged locale, never a stylistic preference between two correct
 * options. Two consequences follow:
 *
 *   - Entries that risk colliding with an unrelated, legitimate word (e.g.
 *     "відмінити" shares its "відмін-" stem with the ordinary adjective
 *     "відмінний" = "excellent") are matched by an explicit, finite list of
 *     inflected forms rather than an open stem, so the unrelated word can
 *     never match.
 *   - "любий" in the "any" sense (a suggested candidate) is deliberately
 *     NOT included: its ordinary sense is "beloved/dear", a common
 *     legitimate adjective, and no unambiguous phrase-level pattern for the
 *     calque sense turned up anywhere in this catalog to anchor a safe
 *     match against. A miss here is preferable to flagging someone's dear.
 */

// Cyrillic letters that count as "still inside the word" for boundary
// purposes — both alphabets combined, so the same boundary works regardless
// of which locale is being scanned. JS `\b` is ASCII-only (`\w` = [A-Za-z0-9_])
// and does not know Cyrillic exists, so without this every Cyrillic
// "boundary" is silently a non-boundary — a bare `\bслідуючий\b` would match
// exactly as well glued inside a longer word as standing alone.
const CYR_WORD_CHAR = 'а-яёіїєґА-ЯЁІЇЄҐ';

/**
 * A regex that matches `alternation` (one or more `|`-joined literal
 * Cyrillic forms, already safe to embed — none of this file's entries use
 * regex metacharacters) only when it is not glued to further Cyrillic
 * letters on either side.
 */
function cyrWordPattern(alternation) {
  return new RegExp(`(?<![${CYR_WORD_CHAR}])(?:${alternation})(?![${CYR_WORD_CHAR}])`, 'giu');
}

/**
 * One entry = one wrong form (or a finite family of inflections of it) that
 * must never appear in the given locale, the correct replacement, and WHY —
 * printed on failure so the guard teaches instead of just failing.
 *
 * @typedef {{id: string, forms: string[], right: string, reason: string, _pattern?: RegExp}} CalqueEntry
 */

/** @type {CalqueEntry[]} */
const UK_FORBIDDEN = [
  // The confirmed defect this guard exists for (see file header above).
  {
    id: 'ru-engine-noun',
    forms: ['движок'],
    right: 'рушій',
    reason:
      'Russian noun for "engine" — every letter also exists in Ukrainian, so ' +
      'the script-hygiene scan cannot see it sitting inside Ukrainian prose.',
  },
  {
    id: 'take-part-calque',
    forms: [
      'приймати участь',
      'приймаю участь',
      'приймаєш участь',
      'приймає участь',
      'приймаємо участь',
      'приймаєте участь',
      'приймають участь',
      'прийняти участь',
      'прийняв участь',
      'прийняла участь',
      'прийняли участь',
    ],
    right: 'брати участь (agree the verb: бере/беруть/... участь)',
    reason:
      'Word-for-word calque of Russian "принимать участие"; standard ' +
      'Ukrainian is "брати участь".',
  },
  {
    id: 'during-calque',
    forms: ['на протязі'],
    right: 'протягом',
    reason: 'Calque of Russian "в течение"; the Ukrainian preposition is "протягом".',
  },
  {
    id: 'coincide-calque',
    // No legitimate Ukrainian word begins with this stem in any inflection —
    // the correct verb family ("збігатися") shares none of it — so an open
    // stem match is safe here, unlike the finite lists below.
    forms: ['співпада'],
    right: 'збігатися (збігається/збігаються/...)',
    reason: 'Calque of Russian "совпадать"; standard Ukrainian is "збігатися".',
  },
  {
    id: 'cancel-calque',
    forms: [
      'відмінити',
      'відміняти',
      'відміняю',
      'відміняєш',
      'відміняє',
      'відміняємо',
      'відміняєте',
      'відміняють',
      'відмінив',
      'відмінила',
      'відмінили',
      'відміню',
      'відміниш',
      'відмінить',
    ],
    right: 'скасувати',
    reason:
      'Calque of Russian "отменить". Matched as an exact-form list, not a ' +
      '"відмін-" stem, because that stem also starts the unrelated, ' +
      'legitimate word "відмінний" ("excellent").',
  },
  {
    id: 'next-calque',
    forms: [
      'слідуючий',
      'слідуюча',
      'слідуюче',
      'слідуючі',
      'слідуючого',
      'слідуючій',
      'слідуючим',
      'слідуючими',
      'слідуючих',
    ],
    right: 'наступний',
    reason:
      'Calque of Russian "следующий". Matched as an exact-form list, not a ' +
      '"слідуюч-" stem, because that stem also starts the bare gerund ' +
      '"слідуючи" ("while following", from the legitimate verb "слідувати").',
  },
  {
    id: 'conclude-contract-calque',
    forms: [
      'заключати',
      'заключаю',
      'заключаєш',
      'заключає',
      'заключаємо',
      'заключаєте',
      'заключають',
      'заключив',
      'заключила',
      'заключили',
      'заключу',
      'заключиш',
      'заключить',
    ],
    right: 'укладати',
    reason:
      'Calque of Russian "заключать" (a contract). Matched as an exact-form ' +
      'list, not a "заключ-" stem, because that stem also starts the ' +
      'unrelated, legitimate word "заключний" ("final/concluding").',
  },
  {
    id: 'nothing-else-calque',
    forms: ['більш нічого'],
    right: 'більше нічого',
    reason:
      '"більш" is the comparative form used before an adjective ("більш ' +
      'складний"); before a pronoun like "нічого" standard Ukrainian requires "більше".',
  },
  {
    id: 'as-role-calque',
    forms: ['у якості', 'в якості'],
    right: 'як',
    reason: 'Calque of Russian "в качестве"; standard Ukrainian just uses "як" (e.g. "як член").',
  },
];

/** @type {CalqueEntry[]} */
const RU_FORBIDDEN = [
  // The mirror direction: Ukrainian words with no ru-exclusive letter (see
  // the script-hygiene UK_ONLY_LETTERS set above), so they read as plausible
  // Russian at a glance the same way «движок» read as plausible Ukrainian.
  {
    id: 'also-uk-word',
    forms: ['також'],
    right: 'также',
    reason:
      'Ukrainian for "also/too"; no letter here is Ukrainian-exclusive, so it is invisible to the alphabet scan.',
  },
  {
    id: 'so-that-uk-word',
    forms: ['щоб'],
    right: 'чтобы',
    reason:
      'Ukrainian conjunction "in order to/so that"; Russian uses "чтобы" (or informal "чтоб"), never "щоб".',
  },
  {
    id: 'own-uk-word',
    forms: [
      'власний',
      'власна',
      'власне',
      'власні',
      'власного',
      'власній',
      'власним',
      'власними',
      'власних',
    ],
    right: 'собственный (and its forms)',
    reason: 'Ukrainian adjective "own"; the Russian equivalent is "собственный".',
  },
  {
    id: 'developer-uk-word',
    forms: ['розробник', 'розробники', 'розробника', 'розробників'],
    right: 'разработчик (and its forms)',
    reason: 'Ukrainian for "developer"; the Russian equivalent is "разработчик".',
  },
  {
    id: 'only-uk-word',
    forms: ['лише'],
    right: 'только',
    reason: 'Ukrainian for "only"; the Russian equivalent is "только".',
  },
  {
    id: 'any-uk-word',
    forms: [
      'будь-який',
      'будь-яка',
      'будь-яке',
      'будь-які',
      'будь-якого',
      'будь-якій',
      'будь-яким',
      'будь-якими',
      'будь-яких',
    ],
    right: 'любой (and its forms)',
    reason: 'Ukrainian "any/whichever"; the Russian equivalent is "любой".',
  },
];

const CALQUE_TABLES = { uk: UK_FORBIDDEN, ru: RU_FORBIDDEN };

// Precompile once — every entry's forms joined into a single alternation, so
// scanning a value is one regex exec per entry, not one per form.
for (const table of Object.values(CALQUE_TABLES)) {
  for (const entry of table) {
    entry._pattern = cyrWordPattern(entry.forms.join('|'));
  }
}

// A small, explicitly-named allowlist for a legitimate hit — a quoted
// example of the wrong form, a comment about the calque itself. Empty today;
// add an entry only for a real, confirmed case, and say why right here.
const LEXICAL_CALQUE_EXCEPTIONS = new Set([
  // 'core:uk:some.id:ru-engine-noun' — none needed yet.
]);

function lexicalCalqueViolations(sourceTag, id, locale, value) {
  const table = CALQUE_TABLES[locale];
  if (!table || typeof value !== 'string') return [];
  const out = [];
  for (const entry of table) {
    if (LEXICAL_CALQUE_EXCEPTIONS.has(`${sourceTag}:${locale}:${id}:${entry.id}`)) continue;
    entry._pattern.lastIndex = 0;
    const m = entry._pattern.exec(value);
    if (m) {
      out.push(
        `${sourceTag}/${id} (${locale}) uses "${m[0]}" — should be "${entry.right}": ${entry.reason}`,
      );
    }
  }
  return out;
}

test('lexical calques: no Ukrainian value uses a Russian word/calque, and no Russian value uses a Ukrainian one', () => {
  // Core catalogs first: only uk/ru carry calque risk (en has no Cyrillic at
  // all, already pinned by the script-hygiene test above).
  const violations = [];
  for (const locale of ['uk', 'ru']) {
    for (const [id, value] of Object.entries(CATALOGS[locale])) {
      if (id[0] === '_') continue;
      violations.push(...lexicalCalqueViolations('core', id, locale, value));
    }
  }

  // Then every browser module dictionary the app actually registers — same
  // real-merge loader the script-hygiene test uses above, not a re-derived
  // guess at what should be there.
  const { specs } = loadRegisteredBrowserSpecs();
  assert.ok(specs.length >= 15, `expected most module catalogs to load, got ${specs.length}`);
  for (const spec of specs) {
    for (const [key, translations] of Object.entries(spec.keys || {})) {
      for (const locale of ['uk', 'ru']) {
        violations.push(
          ...lexicalCalqueViolations(`browser:${spec.id}`, key, locale, translations[locale]),
        );
      }
    }
  }

  // Finally the central public/i18n.js table itself — the single largest
  // hand-maintained slab of uk/ru prose in the app (~1300 lines), and the
  // one place neither loader above reaches: it is not a packages/core
  // catalog and it never calls window.registerI18nModule. Skipping it would
  // leave the app's biggest surface for exactly this defect class unguarded.
  const central = loadCentralI18NTable();
  for (const locale of ['uk', 'ru']) {
    for (const [key, value] of Object.entries(central[locale])) {
      violations.push(...lexicalCalqueViolations('central', key, locale, value));
    }
  }

  assert.deepEqual(violations, [], 'a locale value used a calque or borrowed word from the other');
});

// ── 7. resolve() falls back requested → en → uk, never straight to uk ───────

test('messages/index.js resolve(): falls back requested -> en -> uk, never straight to uk', () => {
  // resolve() used to go straight from the requested locale to a hard-coded
  // UK fallback (`const FALLBACK_LOCALE = 'uk'`), skipping en entirely — the
  // same silent-uk-fallback shape public/i18n.js's window.t() had before its
  // own fix above. This pins the corrected contract: requested locale first,
  // then en, then uk as the true last resort.
  //
  // It mutates a REAL, shared id in place rather than inventing a synthetic
  // one — the JSON catalogs are require()-cached, so this file's CATALOGS.*
  // and messages/index.js's internal LOCALES.* are the identical in-memory
  // objects — and restores it in `finally` so no other test in this process
  // ever sees the gap, whether this test passes or throws.
  const id = 'crosscheck.bid.above_floor';
  assert.ok(
    CATALOGS.en[id] && CATALOGS.uk[id] && CATALOGS.ru[id],
    'fixture id must exist in all three catalogs to prove a real fallback step',
  );
  assert.notEqual(
    CATALOGS.en[id],
    CATALOGS.uk[id],
    'en and uk text must differ, or a wrong fallback would look identical to a right one',
  );

  const savedRu = CATALOGS.ru[id];
  const savedEn = CATALOGS.en[id];
  try {
    delete CATALOGS.ru[id];
    assert.equal(
      messages.resolve(id, {}, 'ru'),
      savedEn,
      'missing from ru, present in en and uk → must resolve via en, not uk',
    );

    delete CATALOGS.en[id];
    assert.equal(
      messages.resolve(id, {}, 'ru'),
      CATALOGS.uk[id],
      'missing from ru AND en → uk is still the true last resort',
    );
  } finally {
    CATALOGS.ru[id] = savedRu;
    CATALOGS.en[id] = savedEn;
  }
});
