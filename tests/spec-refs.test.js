'use strict';

/**
 * tests/spec-refs.test.js — finding-id metadata coverage gates.
 *
 * Two invariants over the same set of ids, both about metadata the repo
 * publishes *about* a finding rather than the finding itself:
 *   1. spec-refs.json has an entry for every id rules code emits.
 *   2. packages/core/severity-registry.js knows the level every id is emitted
 *      at, and the public catalog serialises that level rather than a guess.
 *
 * ── PART 1: spec-refs.json ─────────────────────────────────────────────────
 *
 * Every finding id emitted by rules code must have an entry in
 * spec-refs.json. The value can be either:
 *   - a string URL (IAB spec anchor or vendor doc), or
 *   - null / "" (explicit "no spec ref" — used for ortbtools-own
 *     checks like behavior.* and dialect-specific findings)
 *
 * Missing entries are a fail: when someone adds a new finding to
 * rules-*.js or a plugin, they must also record it here. Forces the
 * "every finding has a documented disposition" invariant.
 *
 * Discovery: greps source files in packages/core/ for two emission
 * shapes used across rules + plugins + dialects:
 *   F('id.…', LEVELS.X, …)               — alias from makeFinding
 *   makeFinding('id.…', LEVELS.X, …)     — direct call
 *
 * Anything that doesn't match these literal patterns is invisible to
 * this test. If you add a new emission style (e.g. helper that
 * wraps makeFinding), extend EMISSION_REGEXES below.
 *
 * TRAP, and it is not hypothetical — it caught two people on 2026-08-14,
 * hours apart, both of them while writing about this grep. The discovery
 * pass reads source text, not code: it cannot tell an emission from a
 * sentence describing one. So a docblock ANYWHERE under packages/core that
 * spells out a realistic example — the factory name, then a quoted id made
 * only of [a-zA-Z0-9._-] — registers as a real emission site, and this test
 * then fails demanding a spec-refs entry for an id no rule emits. One of the
 * two casualties was a finding id literally named `id`.
 *
 * Every example in this docblock, including the two shapes above, carries a
 * `…` inside the quotes on purpose: `…` is outside the character class, so
 * none of them can match itself. Do the same in any comment you add under
 * packages/core. This file is not scanned — CORE_DIR is — so an example
 * written here is safe where the identical text would not be there, which is
 * exactly how it would reach packages/core by copy without anyone noticing.
 * The alternative, a grep that understands JavaScript, is not worth it here;
 * a reader who does not know this loses an hour to it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE_DIR = path.join(__dirname, '..', 'packages', 'core');
const SPEC_REFS_PATH = path.join(CORE_DIR, 'spec-refs.json');
const MESSAGES_EN_PATH = path.join(CORE_DIR, 'messages', 'en.json');
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

const severityRegistry = require('../packages/core/severity-registry');
const core = require('@ortbtools/core');
const behavior = require('@ortbtools/core/behavior');
const findingCatalog = require('../modules/findings/handler');

const EMISSION_REGEXES = [
  /\bF\(\s*['"]([a-zA-Z0-9._-]+)['"]/g,
  /\bmakeFinding\(\s*['"]([a-zA-Z0-9._-]+)['"]/g,
];

// `_comment` / `_base` are metadata in spec-refs.json, not finding ids.
const METADATA_KEYS = new Set(['_comment', '_base']);

function walkJsFiles(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsFiles(full, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
}

function collectEmittedIds() {
  const files = [];
  walkJsFiles(CORE_DIR, files);
  const ids = new Set();
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const re of EMISSION_REGEXES) {
      // Reset lastIndex defensively for /g regex reuse across files.
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt))) ids.add(m[1]);
    }
  }
  return ids;
}

test('spec-refs: every finding id emitted by rules code has an entry', () => {
  const specRefs = JSON.parse(fs.readFileSync(SPEC_REFS_PATH, 'utf8'));
  const known = new Set(Object.keys(specRefs).filter((k) => !METADATA_KEYS.has(k)));
  const emitted = collectEmittedIds();
  const missing = [...emitted].filter((id) => !known.has(id)).sort();
  assert.equal(
    missing.length,
    0,
    `Finding ids missing from spec-refs.json — add an entry (URL or null) for each:\n  ${missing.join('\n  ')}`,
  );
});

test('spec-refs: every entry value is a string URL or null/empty', () => {
  const specRefs = JSON.parse(fs.readFileSync(SPEC_REFS_PATH, 'utf8'));
  const badValues = [];
  for (const [k, v] of Object.entries(specRefs)) {
    if (METADATA_KEYS.has(k)) continue;
    if (v === null || v === '') continue;
    if (typeof v === 'string' && /^https?:\/\//.test(v)) continue;
    badValues.push(`${k}: ${JSON.stringify(v)}`);
  }
  assert.equal(
    badValues.length,
    0,
    `spec-refs entries must be a URL string or null/empty:\n  ${badValues.join('\n  ')}`,
  );
});

test('spec-refs: _base + _comment metadata keys are still present', () => {
  const specRefs = JSON.parse(fs.readFileSync(SPEC_REFS_PATH, 'utf8'));
  assert.ok(specRefs._base, 'spec-refs.json should declare _base URL');
  assert.ok(/^https?:\/\//.test(specRefs._base), '_base should be an absolute URL');
  assert.ok(specRefs._comment, 'spec-refs.json should declare _comment');
});

test('spec-refs: no orphan entries (entry without matching emission)', () => {
  // This is a softer assertion — emitted IDs found in code. If an entry
  // sits in spec-refs.json but no rule file emits it, it's likely a
  // stale id from a removed rule. WARN-style: a list, but not a fail.
  // We DO fail if the orphan list is implausibly large (>20% of total)
  // — that suggests a refactor missed cleanup.
  const specRefs = JSON.parse(fs.readFileSync(SPEC_REFS_PATH, 'utf8'));
  const known = new Set(Object.keys(specRefs).filter((k) => !METADATA_KEYS.has(k)));
  const emitted = collectEmittedIds();
  const orphans = [...known].filter((id) => !emitted.has(id));
  const ratio = orphans.length / known.size;
  assert.ok(
    ratio < 0.2,
    `>=20% of spec-refs entries are orphaned (${orphans.length} / ${known.size}) — possibly stale after a refactor:\n  ${orphans.slice(0, 15).join('\n  ')}${orphans.length > 15 ? '\n  ...' : ''}`,
  );
});

// ── PART 2: severity registry ──────────────────────────────────────────────
//
// GET /api/v1/finding-catalog used to derive severity from the shape of the id
// string — `_required` → error, `_missing` → warning, unmatched → info. That
// guess disagreed with the validator for 25 of the 64 ids reachable from
// samples/ (`vast.mediafile_missing` published as warning against an emitted
// error; `request.30.item.qty_invalid` as error against an emitted warning),
// and had no way at all to express `question`. severity-registry.js replaced it
// by reading the level out of the makeFinding/makeCross call sites.
//
// These tests are the reason it cannot rot back: a rule that changes its level,
// a new rule the scanner cannot read, or a catalog that stops asking the
// registry all fail here rather than shipping a wrong badge to /docs/findings.

const VALIDATOR_LEVEL_VALUES = Object.values(severityRegistry.VALIDATOR_LEVELS);
const CROSSCHECK_LEVEL_VALUES = Object.values(severityRegistry.CROSSCHECK_LEVELS);

/**
 * Every (id, level) pair the engine actually produces over the samples/ corpus.
 * Sweeps all three dialects, the behavior analyzer, and the full
 * request × response crosscheck matrix so both branches of a pass/fail pair
 * (`crosscheck.id_match` / `crosscheck.id_mismatch`) get exercised.
 */
function observeEmittedLevels() {
  const parsed = [];
  for (const name of fs.readdirSync(SAMPLES_DIR)) {
    if (!name.endsWith('.json')) continue;
    const rawText = fs.readFileSync(path.join(SAMPLES_DIR, name), 'utf8');
    try {
      parsed.push({ rawText, payload: JSON.parse(rawText) });
    } catch (_e) {
      /* a fixture that is deliberately unparseable has nothing to observe */
    }
  }

  const seen = new Map(); // id → Set(level)
  const record = (findings) => {
    for (const f of findings || []) {
      if (!f || !f.id || typeof f.level !== 'string') continue;
      if (!seen.has(f.id)) seen.set(f.id, new Set());
      seen.get(f.id).add(f.level);
    }
  };

  for (const { rawText, payload } of parsed) {
    for (const dialect of [undefined, 'ext-rtb', 'inpage-push']) {
      try {
        record(core.validate(payload, { rawText, dialect }).findings);
      } catch (_e) {
        /* a fixture the validator refuses still tells us nothing about levels */
      }
    }
    try {
      record(behavior.analyze(payload).findings);
    } catch (_e) {
      /* not a behavior scenario */
    }
  }
  for (const a of parsed) {
    for (const b of parsed) {
      try {
        // crosscheck() returns the finding array directly, unlike validate().
        record(core.crosscheck(a.payload, b.payload));
      } catch (_e) {
        /* mismatched shapes are expected across the matrix */
      }
    }
  }
  return seen;
}

test('severity-registry: the emitted level is one the registry records', () => {
  // The anti-rot gate. Runs the corpus and compares what came out of
  // packages/core against what the catalog would publish.
  const observed = observeEmittedLevels();
  assert.ok(observed.size > 40, `corpus sweep observed only ${observed.size} ids — sweep broke`);

  const mismatches = [];
  for (const [id, levels] of observed) {
    const rec = severityRegistry.describe(id);
    for (const level of levels) {
      if (rec.levels.indexOf(level) < 0) {
        mismatches.push(
          `${id}: engine emits '${level}', registry says '${rec.levels.join('|') || rec.severity}'`,
        );
      }
    }
  }
  assert.equal(
    mismatches.length,
    0,
    'The finding catalog would publish a severity the validator does not emit.\n' +
      'Fix the rule or let the registry see its level — never edit the catalog to match:\n  ' +
      mismatches.sort().join('\n  '),
  );
});

test('severity-registry: no level expression is left unresolved', () => {
  // An unresolved level means the id silently answers `unknown` in the public
  // catalog. `makeFinding(id, inGrace ? LEVELS.WARNING : LEVELS.ERROR, …)` is
  // the shape that used to defeat a naive scan; conditionals resolve to both
  // branches now, so anything landing here is a genuinely new shape.
  const unresolved = severityRegistry.unresolvedLevelSites();
  assert.equal(
    unresolved.length,
    0,
    'severity-registry.js could not read the level at these call sites:\n  ' +
      unresolved.map((u) => `${u.file}:${u.line} ${u.id} → ${u.expr}`).join('\n  '),
  );
});

test('severity-registry: every computed-id call site is declared', () => {
  // A call site that assembles its id at runtime is invisible to the scanner,
  // so its ids are declared by hand in COMPUTED_ID_SITES. Counting the sites
  // means a new one fails here instead of quietly dropping its ids to unknown.
  const found = severityRegistry.computedIdSites();
  assert.equal(
    found.length,
    severityRegistry.COMPUTED_ID_SITES.length,
    'packages/core has ' +
      found.length +
      ' call site(s) that build the finding id at runtime, but severity-registry.js ' +
      'declares ' +
      severityRegistry.COMPUTED_ID_SITES.length +
      '. Add the new one to COMPUTED_ID_SITES with the ids it can produce:\n  ' +
      found.map((s) => `${s.file}:${s.line} ${s.expr}`).join('\n  '),
  );
});

test('severity-registry: every emitted finding id has a level', () => {
  const emitted = [...collectEmittedIds()].sort();
  const unresolved = emitted.filter(
    (id) => severityRegistry.describe(id).family === severityRegistry.FAMILIES.UNKNOWN,
  );
  assert.equal(
    unresolved.length,
    0,
    `These ids are emitted by rules code but severity-registry.js has no level for them:\n  ${unresolved.join('\n  ')}`,
  );
});

test('severity-registry: all four findings.js LEVELS are representable', () => {
  // The suffix scheme this replaced had no `question` at all, so
  // dialects.question.unknown_ext_signal could not be published correctly
  // under any rule it contained.
  const inUse = new Set();
  for (const id of severityRegistry.knownIds()) {
    for (const l of severityRegistry.describe(id).levels) inUse.add(l);
  }
  for (const level of VALIDATOR_LEVEL_VALUES) {
    assert.ok(inUse.has(level), `no finding id resolves to the '${level}' level`);
  }
  assert.equal(
    severityRegistry.severityOf('dialects.question.unknown_ext_signal'),
    'question',
    'the question level must survive the trip through the registry',
  );
});

test('severity-registry: the catalog publishes no check the engine does not run', () => {
  // messages/en.json outlives the rules that used it, and an id left behind is
  // a published claim that a check runs with nothing verifying that it does.
  //
  // This gate USED to report those ids as `unknown` and pass. That was correct
  // while two of them existed and had not been triaged: `unknown` is the honest
  // answer, and unlike the old `info` guess it makes a stale entry findable
  // rather than plausible. Both were traced to rules replaced by more precise
  // ids and removed in faf2534, so the count is now zero — at which point
  // reporting becomes the wrong behaviour, because the next orphan would get
  // the same honest shrug and live exactly as long as these two did.
  //
  // So: zero is now the contract. If this fails, an id has message text with no
  // rule behind it. Do not add it to an allowlist. Either the rule was replaced
  // and the record should go (check for a more precise id covering the same
  // case, and verify that replacement actually fires before deleting anything),
  // or the check was specified and never written, and it should be written. The
  // catalog looks identical in both cases, which is why this has to fail rather
  // than describe.
  const messages = JSON.parse(fs.readFileSync(MESSAGES_EN_PATH, 'utf8'));
  const messageIds = Object.keys(messages).filter(
    (k) => !k.startsWith('_') && typeof messages[k] === 'string',
  );
  const unknown = messageIds.filter(
    (id) => severityRegistry.describe(id).family === severityRegistry.FAMILIES.UNKNOWN,
  );
  assert.deepEqual(
    unknown,
    [],
    `The finding catalog advertises ${unknown.length} check(s) that nothing in the engine emits:\n  ${unknown.join('\n  ')}`,
  );
  // Belt and braces: a registry that failed to build answers `unknown` for
  // everything. That would now trip the assertion above, but this says why.
  assert.ok(
    messageIds.length > 100,
    `only ${messageIds.length} message ids found — the scan likely broke`,
  );
});

test('finding-catalog: served severity is the registry severity', () => {
  const route = findingCatalog.routes.find((r) => r.path === '/api/v1/finding-catalog');
  assert.ok(route, 'findings module must still serve /api/v1/finding-catalog');

  let body = '';
  const res = {
    setHeader() {},
    writeHead() {},
    end(chunk) {
      body = String(chunk == null ? '' : chunk);
    },
  };
  route.handler({ url: '/api/v1/finding-catalog?lang=en' }, res);
  const payload = JSON.parse(body);
  assert.equal(payload.ok, true);
  assert.ok(payload.count > 300, `catalog served only ${payload.count} items`);

  const wrong = [];
  for (const item of payload.items) {
    const rec = severityRegistry.describe(item.id);
    if (item.severity !== rec.severity)
      wrong.push(`${item.id}: served ${item.severity}, registry ${rec.severity}`);
    if (item.family !== rec.family)
      wrong.push(`${item.id}: served family ${item.family}, registry ${rec.family}`);
  }
  assert.equal(
    wrong.length,
    0,
    `the catalog is not serialising the registry:\n  ${wrong.slice(0, 20).join('\n  ')}`,
  );

  // Guard the shape the three consumers read (docs table, dialect tallies,
  // search index): a severity string on a scale `family` identifies.
  const families = new Set(payload.items.map((i) => i.family));
  for (const f of families) {
    assert.ok(
      Object.values(severityRegistry.FAMILIES).indexOf(f) >= 0,
      `catalog served an unknown family '${f}'`,
    );
  }
  for (const item of payload.items) {
    const scale =
      item.family === severityRegistry.FAMILIES.CROSSCHECK
        ? CROSSCHECK_LEVEL_VALUES
        : item.family === severityRegistry.FAMILIES.VALIDATOR
          ? VALIDATOR_LEVEL_VALUES
          : [severityRegistry.NONE, severityRegistry.UNKNOWN];
    assert.ok(
      scale.indexOf(item.severity) >= 0,
      `${item.id}: severity '${item.severity}' is not on the ${item.family} scale`,
    );
    assert.ok(Array.isArray(item.severities) && item.severities.length > 0);
  }
});

// ── PART 3: the catalog's renderers ────────────────────────────────────────
//
// Part 2 proves the endpoint publishes the engine's own level. It says
// nothing about whether the two pages that read the endpoint can show it,
// and before this part existed they could not:
//
//   /docs/findings   filter chips were a hardcoded all / error / warning /
//                    info. Of the 344 rows served on 2026-08-14, 286 landed
//                    under a chip; the other 58 — 34 crosscheck, 23 mirror
//                    notes, 1 `question` — matched none and were reachable
//                    only under "All". severityBadge() also collapsed every
//                    unrecognised severity to the `info` class, so a
//                    crosscheck row rendered an info-blue pill whose text
//                    read "crit".
//   /dialects        each card tallied severity === error|warning|info and
//                    dropped the rest silently — 58 of the 330 rows in the
//                    `iab` bucket were counted by nobody, under a number
//                    labelled as that bucket's rule count.
//
// The counts above are a snapshot; the assertions below recompute their
// expectations from whatever the handler serves, so the catalog can move
// without turning these into false alarms.
//
// These tests mount the real browser modules against the real serialised
// catalog, so "every row is reachable" and "the numbers add up" are measured
// on the same bytes a browser gets, not asserted about a fixture.

const { JSDOM } = require('jsdom');
const { createBrowserEsmLoader } = require('./browser-esm-loader');

const DOCS_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'modules', 'docs', 'docs.css'),
  'utf8',
);

function servedCatalog(lang) {
  const route = findingCatalog.routes.find((r) => r.path === '/api/v1/finding-catalog');
  let body = '';
  const res = {
    setHeader() {},
    writeHead() {},
    end(chunk) {
      body = String(chunk == null ? '' : chunk);
    },
  };
  route.handler({ url: `/api/v1/finding-catalog?lang=${lang}` }, res);
  return JSON.parse(body);
}

/** Define browser globals the module graph reads at import/mount time. */
function installGlobals(values) {
  const originals = new Map();
  for (const [name, value] of Object.entries(values)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

async function mountSectionModule({ specifier, url, lang, realmSalt, payload }) {
  const dom = new JSDOM('<!doctype html><body><main id="app-root"></main></body>', {
    runScripts: 'outside-only',
    url,
  });
  const { window } = dom;
  const root = window.document.getElementById('app-root');

  const browserFetch = async (input) => {
    const href = String(input && input.url ? input.url : input);
    if (href.startsWith('/api/v1/finding-catalog')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return payload;
        },
      };
    }
    // The dialect page also asks who is signed in; anonymous is enough here.
    if (href.startsWith('/api/auth/me')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { user: null };
        },
      };
    }
    throw new Error(`unexpected fetch in section module test: ${href}`);
  };

  const restoreGlobals = installGlobals({
    AbortController: window.AbortController,
    AbortSignal: window.AbortSignal,
    CustomEvent: window.CustomEvent,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    URL: window.URL,
    document: window.document,
    fetch: browserFetch,
    location: window.location,
    window,
  });

  const controller = new window.AbortController();
  // The ctx a real mount receives is the one documented in
  // public/core/registry.js — not just lang+signal. This harness used to pass
  // two of those fields, so a module reaching for any of the rest died here
  // with "ctx.addCleanup is not a function" while working perfectly in the
  // app. Supplying the whole contract keeps the stub honest, and the cleanup
  // queue is real so a module that registers teardown gets it run.
  /** @type {Array<() => void>} */
  const cleanups = [];
  const ctx = {
    lang,
    signal: controller.signal,
    theme: 'light',
    t: (key) => key,
    toast: () => {},
    escapeHtml: (v) => String(v == null ? '' : v),
    emit: () => {},
    on: () => {},
    off: () => {},
    addCleanup: (fn) => {
      if (typeof fn === 'function') cleanups.push(fn);
    },
  };
  try {
    const loader = createBrowserEsmLoader({ realmSalt });
    const mod = await loader.import(specifier);
    await mod.default.mount(root, ctx);
  } catch (error) {
    controller.abort();
    restoreGlobals();
    window.close();
    throw error;
  }

  return {
    root,
    window,
    click(el) {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    },
    close() {
      controller.abort();
      restoreGlobals();
      window.close();
    },
  };
}

const rowIds = (root) =>
  [...root.querySelectorAll('.docs-table tbody tr')].map((tr) =>
    tr.querySelector('.col-id').textContent.trim(),
  );

const facetChips = (root) =>
  [...root.querySelectorAll('.docs-chip')].filter((c) => c.dataset.filter !== 'all');

test('docs catalog: every served row is reachable under a chip, not only under All', async () => {
  const payload = servedCatalog('en');
  const harness = await mountSectionModule({
    specifier: '/modules/docs/index.js',
    url: 'https://ortbtools.test/docs/findings',
    lang: 'en',
    realmSalt: 'docs-catalog-reachability',
    payload,
  });

  try {
    const { root, click } = harness;
    const allIds = payload.items.map((i) => i.id);
    assert.equal(rowIds(root).length, allIds.length, 'the default view must show every row');

    const chips = facetChips(root);
    assert.ok(chips.length > 0, 'the catalog must render severity facets');

    const reached = new Set();
    for (const chip of chips) {
      click(chip);
      const shown = rowIds(root);
      // A chip that reveals nothing is a chip built from something other
      // than the served rows — the exact failure mode being fixed.
      assert.ok(shown.length > 0, `chip '${chip.dataset.filter}' matched no rows`);
      const declared = Number(chip.querySelector('.docs-chip__n').textContent);
      assert.equal(
        shown.length,
        declared,
        `chip '${chip.dataset.filter}' counts ${declared} rows but shows ${shown.length}`,
      );
      for (const id of shown) reached.add(id);
    }

    const unreachable = allIds.filter((id) => !reached.has(id));
    assert.deepEqual(
      unreachable,
      [],
      `${unreachable.length} of ${allIds.length} rows are reachable only under "All":\n  ${unreachable.slice(0, 20).join('\n  ')}`,
    );

    // And the converse: the chips describe a partition of what was served,
    // not of some hardcoded idea of what the catalog contains.
    for (const id of reached) assert.ok(allIds.includes(id), `chip surfaced unserved id ${id}`);
  } finally {
    harness.close();
  }
});

test('docs catalog: no badge renders a colour that contradicts its own text', async () => {
  const payload = servedCatalog('en');
  const harness = await mountSectionModule({
    specifier: '/modules/docs/index.js',
    url: 'https://ortbtools.test/docs/findings',
    lang: 'en',
    realmSalt: 'docs-catalog-badges',
    payload,
  });

  try {
    const byId = new Map(payload.items.map((i) => [i.id, i]));
    const wrong = [];

    for (const tr of harness.root.querySelectorAll('.docs-table tbody tr')) {
      const id = tr.querySelector('.col-id').textContent.trim();
      const item = byId.get(id);
      const badges = [...tr.querySelectorAll('.docs-badge')];
      const texts = badges.map((b) => b.textContent.trim());

      // Every level the endpoint published, shown — none dropped, none added.
      if (texts.join('|') !== item.severities.join('|')) {
        wrong.push(`${id}: rendered [${texts}] for severities [${item.severities}]`);
      }
      if (tr.querySelector('.docs-sev__family').textContent.trim() !== item.family) {
        wrong.push(`${id}: severity cell does not name the ${item.family} scale`);
      }

      for (const badge of badges) {
        const text = badge.textContent.trim();
        const modifiers = [...badge.classList].filter((c) => c.startsWith('docs-badge--'));
        // The modifier decides the colour. It must name this badge's own
        // family and its own word: `docs-badge--info` on a badge reading
        // "crit" is what this assertion exists to catch.
        assert.deepEqual(
          modifiers,
          [`docs-badge--${item.family}-${text}`],
          `${id}: badge "${text}" carries ${JSON.stringify(modifiers)}`,
        );
      }
    }

    assert.deepEqual(wrong, [], `severity cells misreport the catalog:\n  ${wrong.join('\n  ')}`);
  } finally {
    harness.close();
  }
});

test('docs catalog: a crosscheck pass is not painted as a problem', () => {
  // `ok` means the check succeeded. It is the one value on the page that a
  // reader would misread as a defect if it borrowed the error or warning
  // tint, so the stylesheet is asserted directly rather than by eye.
  const ruleFor = (modifier) => {
    const re = new RegExp(`\\.docs-badge--${modifier}\\s*\\{([^}]*)\\}`);
    const m = re.exec(DOCS_CSS);
    assert.ok(m, `docs.css must style .docs-badge--${modifier}`);
    return m[1];
  };

  const errorRule = ruleFor('validator-error');
  const warningRule = ruleFor('validator-warning');
  const okRule = ruleFor('crosscheck-ok');

  const colorOf = (rule) => /(^|[\s;])color:\s*([^;]+);/.exec(rule)[2].trim();
  const okColor = colorOf(okRule);
  assert.notEqual(okColor, colorOf(errorRule), '`ok` must not take the error colour');
  assert.notEqual(okColor, colorOf(warningRule), '`ok` must not take the warning colour');
  assert.match(okColor, /--success/, '`ok` should read as the pass state it is');

  // The base badge has to be readable on its own: an unstyled (family,
  // severity) pair falls through to it, and a transparent-on-transparent
  // pill would be a new way to lose a row.
  const base = /\.docs-badge\s*\{([^}]*)\}/.exec(DOCS_CSS);
  assert.ok(base, 'docs.css must define a base .docs-badge rule');
  assert.match(base[1], /(^|[\s;])background:/, '.docs-badge needs a neutral background');
  assert.match(base[1], /(^|[\s;])color:/, '.docs-badge needs a neutral colour');
});

test('docs catalog: an id with two levels shows both and filters under both', async () => {
  const payload = servedCatalog('en');
  const dual = payload.items.filter((i) => i.severities.length > 1);
  assert.ok(dual.length > 0, 'the catalog no longer has a dual-level id — retarget this test');

  const harness = await mountSectionModule({
    specifier: '/modules/docs/index.js',
    url: 'https://ortbtools.test/docs/findings',
    lang: 'en',
    realmSalt: 'docs-catalog-dual',
    payload,
  });

  try {
    const { root, click } = harness;

    // Stated on the page, because the chip counts add to more than the row
    // count once an id is listed twice.
    const note = root.querySelector('.docs-facets__note');
    assert.ok(note, 'dual-level ids must be disclosed');
    assert.match(note.textContent, new RegExp(`\\b${dual.length}\\b`));

    for (const item of dual) {
      for (const level of item.severities) {
        const chip = root.querySelector(`.docs-chip[data-filter="${item.family}/${level}"]`);
        assert.ok(chip, `no chip for ${item.family}/${level}`);
        click(chip);
        assert.ok(
          rowIds(root).includes(item.id),
          `${item.id} is emitted at ${level} but is not listed under that chip`,
        );
      }
    }
  } finally {
    harness.close();
  }
});

test('docs catalog: a scale the UI has never seen still gets a chip and a neutral badge', async () => {
  // The guard against the previous fix's failure mode. The chips are built
  // from the response, so a level added to findings.js later cannot fall out
  // of the UI the way `question`, `crit`, `ok` and `none` did.
  const payload = {
    ok: true,
    count: 1,
    lang: 'en',
    items: [
      {
        id: 'synthetic.future_level',
        severity: 'blocker',
        severities: ['blocker'],
        family: 'future-scale',
        message: 'synthetic row',
        specRef: '',
      },
    ],
  };
  const harness = await mountSectionModule({
    specifier: '/modules/docs/index.js',
    url: 'https://ortbtools.test/docs/findings',
    lang: 'en',
    realmSalt: 'docs-catalog-future-scale',
    payload,
  });

  try {
    const { root, click } = harness;
    const chip = root.querySelector('.docs-chip[data-filter="future-scale/blocker"]');
    assert.ok(chip, 'an unrecognised family/severity pair must still get its own chip');
    assert.equal(chip.textContent.trim().replace(/\s+/g, ' '), 'blocker 1');

    click(chip);
    assert.deepEqual(rowIds(root), ['synthetic.future_level']);

    const badge = root.querySelector('.docs-badge');
    assert.equal(badge.textContent.trim(), 'blocker');
    assert.deepEqual(
      [...badge.classList],
      ['docs-badge', 'docs-badge--future-scale-blocker'],
      'an unknown pair must not borrow a styled modifier',
    );
    assert.ok(
      !DOCS_CSS.includes('docs-badge--future-scale-blocker'),
      'the neutral fallback is the base rule — nothing claims a colour for this pair',
    );
  } finally {
    harness.close();
  }
});

test('dialect cards: the rule count covers every row the catalog serves', async () => {
  // What this test has always been about: a number printed on a dialect card
  // must be the whole bucket, not the part of it the UI happens to have a
  // colour for. It used to assert that through the per-severity chip rows,
  // because that was the shape the page had; the v2 redesign replaced those
  // rows with a single count (in the baseline card's description, in the
  // overlay cards' mono footer), so the assertions move to where the number
  // now lives. The guarantee is unchanged — and the fixture check at the
  // bottom still proves the bucket contains rows on scales the validator
  // never had, which is the omission that made this test necessary.
  const payload = servedCatalog('en');
  const harness = await mountSectionModule({
    specifier: '/modules/dialects/index.js',
    url: 'https://ortbtools.test/dialects',
    lang: 'en',
    realmSalt: 'dialect-card-tally',
    payload,
  });

  try {
    // The expectation is recomputed from the served rows rather than written
    // down: which families exist is the engine's business and it moves. The
    // point under test is that whatever was served is what the card counts.
    const bucketOf = (id) =>
      id.startsWith('extrtb.') ? 'ext-rtb' : id.startsWith('inpage-push.') ? 'inpage-push' : 'iab';
    const expected = new Map();
    for (const item of payload.items) {
      const bucket = expected.get(bucketOf(item.id)) || { total: 0, families: new Set() };
      bucket.total++;
      bucket.families.add(item.family);
      expected.set(bucketOf(item.id), bucket);
    }

    const cards = [...harness.root.querySelectorAll('#dlc-shipped-root .dlc-card')];
    assert.equal(cards.length, 3, 'three built-in dialects');

    let accounted = 0;
    for (const card of cards) {
      const slug = card.dataset.slug;
      const want = expected.get(slug) || { total: 0, families: new Set() };
      // The baseline card carries its count mid-description ("N finding
      // ids"), the overlays at the end of the footer ("ext-rtb · N rules").
      // Both mark it up as .dlc-card__count, so the assertion does not have
      // to guess which digits in the copy are the number.
      const carrier = card.querySelector('.dlc-card__count');
      assert.ok(carrier, `${slug}: the card prints no rule count at all`);
      const declared = Number(carrier.textContent.trim());
      assert.equal(declared, want.total, `${slug}: rule count disagrees with the served rows`);
      accounted += declared;
    }
    assert.equal(accounted, payload.count, 'the three cards must account for the whole catalog');

    // The catch-all bucket is where the non-validator rows land. If it ever
    // stops serving more than one scale, this fixture has stopped exercising
    // the omission the count exists to prevent.
    const iabFamilies = expected.get('iab').families;
    assert.ok(iabFamilies.size > 1, `the iab bucket serves only ${[...iabFamilies]}`);
  } finally {
    harness.close();
  }
});
