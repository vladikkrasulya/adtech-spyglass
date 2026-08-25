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

const core = require('../packages/core');
const FL = require('../packages/core/finding-location');
const { buildSourceMap } = require('../packages/core/source-map');

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

  const drift = [];
  for (const id of ids) {
    const base = templateVars(CATALOGS.en[id]);
    for (const locale of ['uk', 'ru']) {
      if (!(id in CATALOGS[locale])) continue;
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
