'use strict';

/**
 * tests/ui-audit.test.js — the inspector's interface, audited 2026-08-18.
 *
 * Four defects, one theme: a surface that answered confidently while being
 * wrong, or answered nothing at all, and in every case did it silently.
 *
 *  1. THE DETAIL PANEL READ THE OTHER PANE. `resolveFindingValue()` guessed
 *     which editor a finding belonged to with a regex over the finding id,
 *     the exact derivation packages/core/finding-location.js forbids in its
 *     header ("HARD RULE: `side` comes ONLY from the validate() call
 *     context — never from an id/path regex"), while the authoritative
 *     answer sat unused in `finding.location.primary.side`. Request and
 *     response share key names on purpose — `cur`, `id`, `at`, `bidfloor` —
 *     so the guess plus its cross-pane fallback did not fail to find a
 *     value, it found a DIFFERENT one: err-bid-currency-invalid printed the
 *     request's ["USD"] while complaining about the response's "usd", two
 *     lines under a badge that read "response".
 *
 *  2. `question` HAD NO SEVERITY COPY. A first-class engine level since v8,
 *     and the most common one on a real payload, rendered its severity row
 *     as `question · ` — the raw English level name, a separator, and
 *     nothing after it.
 *
 *  3. THE PARTNER-SUGGESTION BUTTONS WERE DEAD. #modalRoot is a SIBLING of
 *     #app-root in the shell chrome, so the inspector's delegated dispatcher
 *     cannot see a click inside any modal. save-sample's two hint verbs were
 *     in neither that dispatcher's reach nor modal-host's case list.
 *
 *  4. THE INSPECTOR SHIPPED A SECOND LIVE CLIENT. It consumed another one of
 *     the eight SSE slots per IP and carried its own auction-shape rules,
 *     already divergent from the canonical /live section. The duplicate is
 *     retired; Streams remains permanently reachable from the rail.
 *
 * Two of the four are asserted against the SHIPPED SOURCE, not a restatement
 * of it: the functions under test are sliced out of public/ortbtools.app.js by
 * name and evaluated, so a rewrite that reintroduces the defect fails here
 * rather than passing a paraphrase.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createBrowserEsmLoader } = require('./browser-esm-loader');

const ROOT = path.join(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
const I18N_SRC = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');

const core = require('../packages/core');
const { attachLocations } = require('../packages/core/finding-location');

// ── Slicing the real source ───────────────────────────────────────────────
// Everything interesting lives inside mountInspector(), which cannot be called
// without a shell, a session service and a network. The declarations we need
// are all at mountInspector's own indentation (two spaces), so a declaration
// runs from its opening line to the first line that is exactly `  }` / `  };`.
// Deliberately not a brace counter: this is a shape the file actually has, and
// when the file stops having it the slice returns nothing and every assertion
// below fails loudly instead of quietly testing an empty string.
function sliceDeclaration(source, header, closer) {
  const start = source.indexOf(`\n  ${header}`);
  assert.notEqual(start, -1, `public/ortbtools.app.js no longer declares \`${header}\``);
  const end = source.indexOf(`\n  ${closer}\n`, start);
  assert.notEqual(end, -1, `could not find the end of \`${header}\``);
  // +3 for the leading newline and the two-space indent that `closer` sits on.
  return source.slice(start, end + closer.length + 3);
}

const SLICES = {
  getJsonAtPath: () => sliceDeclaration(APP_SRC, 'function getJsonAtPath(', '}'),
  resolveFindingValue: () => sliceDeclaration(APP_SRC, 'function resolveFindingValue(', '}'),
  questionI18n: () => sliceDeclaration(APP_SRC, 'const QUESTION_SEVERITY_I18N = {', '};'),
  // Sliced from its guard flag, not from the `function` line: the once-only
  // registration is the flag plus the function, and half of it is not a thing.
  ensureQuestionSeverityCopy: () =>
    sliceDeclaration(APP_SRC, 'let _questionCopyChecked = false;', '}'),
  severityCopy: () => sliceDeclaration(APP_SRC, 'function severityCopy(', '}'),
  buildFindingDetailHtml: () => sliceDeclaration(APP_SRC, 'function buildFindingDetailHtml(', '}'),
};

/**
 * Evaluate the named slices with `window`, `t` and `escapeHtml` injected, and
 * hand back the requested functions. `t`/`escapeHtml` are parameters rather
 * than globals because that is what they are in the real file too — one an
 * implicit window global, the other an ES import from /core/utils.js.
 */
function loadSlices(names, { window: win, t, escapeHtml }) {
  const body = names.map((n) => SLICES[n]()).join('\n');
  // questionI18n is a const, not a function — it is evaluated for its effect on
  // the closure the other slices read, and there is nothing to hand back.
  const returns = names.filter((n) => n !== 'questionI18n');
  const src = `${body}\nreturn { ${returns.join(', ')} };`;
  return new Function('window', 't', 'escapeHtml', src)(win, t, escapeHtml);
}

const plainEscape = (s) =>
  s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── The payload from the reproduction ─────────────────────────────────────
const REPRO_REQ = {
  id: 'r1',
  imp: [{ id: '1', banner: { w: 300, h: 250 } }],
  cur: ['USD'],
  site: { id: 's', domain: 'a.com', page: 'http://a.com/x' },
};
const REPRO_RES = {
  id: 'r1',
  cur: 'usd',
  seatbid: [
    {
      bid: [{ id: 'b', impid: '1', price: 1, adm: 'x', adomain: ['a.com'], crid: 'c' }],
    },
  ],
};

/** The real finding, produced by the real engine + the real location contract. */
function currencyFinding() {
  const validation = core.validate(REPRO_RES, { pairReq: REPRO_REQ });
  attachLocations(validation.findings, { side: 'response', kind: 'ortb' });
  const f = (validation.findings || []).find((x) => x.id === 'err-bid-currency-invalid');
  assert.ok(f, 'the engine must still emit err-bid-currency-invalid for cur:"usd"');
  return f;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. The value the panel shows comes from the finding's own side
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the defect is real: the finding is response-side, its path is a bare `cur`, and both panes have one', () => {
  // Without this the rest of the file could pass against a payload that never
  // reproduced anything. Every clause the old heuristic needed to go wrong is
  // asserted here, from the engine, not from memory.
  const f = currencyFinding();
  assert.equal(f.path, 'cur', 'path must be the bare key both panes share');
  assert.equal(f.location.primary.side, 'response', 'the contract must declare the response side');
  assert.doesNotMatch(f.id, /^response\b|^crosscheck\.bid\b/, 'the id gives the old regex nothing');
  assert.doesNotMatch(f.path, /^seatbid\b/, 'the path gives the old regex nothing either');
  assert.notDeepEqual(REPRO_REQ.cur, REPRO_RES.cur, 'the two panes must disagree at that path');
});

test('resolveFindingValue answers a response-side finding out of the response', () => {
  const win = { __ortbtoolsLast: { req: REPRO_REQ, res: REPRO_RES } };
  const { resolveFindingValue } = loadSlices(['getJsonAtPath', 'resolveFindingValue'], {
    window: win,
    t: (k) => k,
    escapeHtml: plainEscape,
  });
  const f = currencyFinding();

  assert.deepEqual(
    resolveFindingValue(f.path, f.id, f.location.primary.side),
    { found: true, value: 'usd' },
    'the panel must show the response currency the finding is complaining about, ' +
      'not the request currency that happens to sit at the same key',
  );
  assert.deepEqual(
    resolveFindingValue('cur', 'whatever', 'request'),
    { found: true, value: ['USD'] },
    'a request-side finding at the same path must still read the request',
  );
});

test('a declared side is never overridden by the other pane, even when its own is empty', () => {
  // The cross-pane fallback is what turned a guess into a confident wrong
  // answer. With a declared side the honest answer to "not there" is "not
  // there" — which is also what the value_missing copy already says.
  const win = { __ortbtoolsLast: { req: { cur: ['USD'] }, res: { id: 'r1' } } };
  const { resolveFindingValue } = loadSlices(['getJsonAtPath', 'resolveFindingValue'], {
    window: win,
    t: (k) => k,
    escapeHtml: plainEscape,
  });
  assert.deepEqual(resolveFindingValue('cur', 'err-bid-currency-invalid', 'response'), {
    found: false,
  });
});

test('findings with no location contract keep the old heuristic, fallback and all', () => {
  // Browser-side temp-dialect findings are pushed onto validation.findings
  // after the server attached locations to everything else, so they arrive
  // with no side at all. Dropping the heuristic would have regressed them
  // from "a guess" to "nothing".
  const win = { __ortbtoolsLast: { req: { cur: ['USD'] }, res: { seatbid: [{ bid: [{}] }] } } };
  const { resolveFindingValue } = loadSlices(['getJsonAtPath', 'resolveFindingValue'], {
    window: win,
    t: (k) => k,
    escapeHtml: plainEscape,
  });
  assert.deepEqual(resolveFindingValue('cur', 'err-bid-currency-invalid', ''), {
    found: true,
    value: ['USD'],
  });
  assert.deepEqual(resolveFindingValue('seatbid[0]', 'x', undefined), {
    found: true,
    value: { bid: [{}] },
  });
});

test('the side reaches the detail body through the markup, not through a second guess', () => {
  // buildFindingHtml writes it and buildFindingDetailHtml reads it; the two
  // are separated by a lazy <details> toggle, so the attribute IS the channel.
  assert.match(
    APP_SRC,
    /const locSide = f\.location && f\.location\.primary \? f\.location\.primary\.side : null;/,
    'buildFindingHtml must take the side from the location contract',
  );
  assert.match(
    APP_SRC,
    /'" data-finding-side="' \+\n\s*escapeHtml\(authoritativeSide \|\| ''\)/,
    'the <details> must carry the authoritative side',
  );
  assert.match(
    APP_SRC,
    /const r = resolveFindingValue\(path, id, side\);/,
    'the detail body must pass the declared side down',
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. `question` says something, in every locale
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** A jsdom window running the REAL public/i18n.js, in the given locale. */
function i18nWindow(locale) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://ortbtools.test/inspector',
  });
  dom.window.document.documentElement.lang = locale;
  dom.window.eval(I18N_SRC);
  return dom;
}

test('question is still missing from the central catalogue — the fallback has a job', () => {
  // If somebody adds the keys to public/i18n.js this fails, and the right
  // response is to delete QUESTION_SEVERITY_I18N rather than keep a shadow.
  const dom = i18nWindow('uk');
  try {
    assert.equal(
      dom.window.t('finding.severity.question.text'),
      '[finding.severity.question.text]',
      'public/i18n.js now answers this key; the in-file fallback should be removed',
    );
  } finally {
    dom.window.close();
  }
});

test('severityCopy("question") returns a label AND an explanation in uk/en/ru', () => {
  const seen = new Set();
  for (const locale of ['uk', 'en', 'ru']) {
    const dom = i18nWindow(locale);
    try {
      const win = dom.window;
      const { severityCopy } = loadSlices(
        ['questionI18n', 'ensureQuestionSeverityCopy', 'severityCopy'],
        { window: win, t: (...a) => win.t(...a), escapeHtml: plainEscape },
      );
      const copy = severityCopy('question');
      assert.equal(
        copy.label,
        'question',
        `${locale}: label matches its error/warning/info siblings`,
      );
      assert.ok(copy.text.length > 20, `${locale}: severity text must not be empty`);
      assert.doesNotMatch(copy.text, /^\[/, `${locale}: must not render as a bracketed key id`);
      seen.add(copy.text);

      // The other three levels must be untouched by the fallback.
      assert.doesNotMatch(severityCopy('error').text, /^\[/, `${locale}: error copy intact`);
      assert.doesNotMatch(severityCopy('warning').text, /^\[/, `${locale}: warning copy intact`);
      assert.doesNotMatch(severityCopy('info').text, /^\[/, `${locale}: info copy intact`);
    } finally {
      dom.window.close();
    }
  }
  assert.equal(seen.size, 3, 'the three locales must be three different sentences, not one copy');
});

test('the severity row loses its dangling separator when a level has no copy', () => {
  // "question · " with nothing after it was the visible symptom. Any future
  // level that reaches the fallback branch must read as a bare name.
  const dom = i18nWindow('uk');
  try {
    const win = dom.window;
    win.__ortbtoolsLast = { req: REPRO_REQ, res: REPRO_RES };
    const api = loadSlices(
      [
        'getJsonAtPath',
        'resolveFindingValue',
        'questionI18n',
        'ensureQuestionSeverityCopy',
        'severityCopy',
        'buildFindingDetailHtml',
      ],
      { window: win, t: (...a) => win.t(...a), escapeHtml: plainEscape },
    );

    const questionHtml = api.buildFindingDetailHtml({
      findingPath: '',
      findingId: 'dialects.question.unknown_ext_signal',
      findingLevel: 'question',
      findingSide: 'request',
      findingSpec: '',
    });
    assert.match(questionHtml, /<strong>question<\/strong> · ./, 'question must explain itself');
    assert.doesNotMatch(questionHtml, /<strong>question<\/strong> · <\/div>/);

    const unknownHtml = api.buildFindingDetailHtml({
      findingPath: '',
      findingId: 'x',
      findingLevel: 'someday',
      findingSide: '',
      findingSpec: '',
    });
    assert.match(unknownHtml, /<strong>someday<\/strong><\/div>/, 'no separator without text');
  } finally {
    dom.window.close();
  }
});

test('the detail body prints the response value for the response-side finding', () => {
  // The end-to-end shape of defect 1, through the function the panel calls.
  const dom = i18nWindow('uk');
  try {
    const win = dom.window;
    win.__ortbtoolsLast = { req: REPRO_REQ, res: REPRO_RES };
    const api = loadSlices(
      [
        'getJsonAtPath',
        'resolveFindingValue',
        'questionI18n',
        'ensureQuestionSeverityCopy',
        'severityCopy',
        'buildFindingDetailHtml',
      ],
      { window: win, t: (...a) => win.t(...a), escapeHtml: plainEscape },
    );
    const f = currencyFinding();
    const html = api.buildFindingDetailHtml({
      findingPath: f.path,
      findingId: f.id,
      findingLevel: f.level,
      findingSide: f.location.primary.side,
      findingSpec: f.specRef || '',
    });
    assert.match(html, /<pre class="finding-detail-value">"usd"<\/pre>/);
    assert.doesNotMatch(html, /USD/, 'the request currency must not appear anywhere in the body');
  } finally {
    dom.window.close();
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. No verb rendered into #modalRoot may be unreachable
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PUBLIC_ROOT = path.join(ROOT, 'public');

function jsFilesUnder(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFilesUnder(p, acc);
    else if (entry.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

/**
 * Every data-action a modal renderer can emit, mapped to the file that emits
 * it. "Modal renderer" = a file that writes into #modalRoot. The per-file
 * granularity is deliberate: these modules render nothing but modal chrome, so
 * every data-action in them ends up inside #modalRoot — including the ones
 * built in a helper (save-sample's suggestion banner is filled in long after
 * the card is written, which is precisely why eyeballing the innerHTML
 * assignment missed it).
 */
function modalActionsByFile() {
  const out = new Map();
  for (const file of jsFilesUnder(path.join(PUBLIC_ROOT, 'modules'))) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/modalRoot/.test(src)) continue;
    if (!/\.innerHTML\s*=/.test(src)) continue;
    const actions = new Set([...src.matchAll(/data-action="([a-z0-9-]+)"/g)].map((m) => m[1]));
    if (actions.size) out.set(path.relative(ROOT, file), actions);
  }
  return out;
}

/** The case labels of /core/modal-host.js's #modalRoot-scoped dispatcher. */
function modalHostActions() {
  const src = fs.readFileSync(path.join(PUBLIC_ROOT, 'core/modal-host.js'), 'utf8');
  const from = src.indexOf('function bindModalDispatcher');
  const to = src.indexOf('// ── Dialog semantics');
  assert.ok(from !== -1 && to > from, 'modal-host.js no longer has a recognisable dispatcher');
  return new Set([...src.slice(from, to).matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1]));
}

/**
 * Actions a file handles itself with its own click listener.
 *
 * The listener node is not pattern-matched — dialect-label.js binds to a
 * `root` variable read from #modalRoot 120 lines earlier, and any regex tight
 * enough to prove the binding target would be looser about everything else.
 * The file is already known to render into #modalRoot; a click listener in it,
 * naming the verb, is the claim we are checking. Both comparison spellings
 * count: `action === 'dl-cancel'` and the guard-clause `action !== 'dl-save'`.
 */
function locallyHandled(relFile) {
  const src = fs.readFileSync(path.join(ROOT, relFile), 'utf8');
  if (!/addEventListener\(\s*'click'/.test(src)) return new Set();
  const named = [
    ...src.matchAll(/action\s*[=!]==?\s*'([a-z0-9-]+)'/g),
    ...src.matchAll(/case '([a-z0-9-]+)':/g),
  ];
  return new Set(named.map((m) => m[1]));
}

// Known-dead verbs OUTSIDE this audit's file ownership. `confirm-corpus-save`
// is the save button of the behavior-corpus modal; it is rendered into
// #modalRoot by /modules/corpus-save/index.js, is in neither dispatcher, and
// is therefore inert — reported rather than fixed here because that file
// belongs to another worktree owner. Subset, not equality, so FIXING it keeps
// this green while a NEW dead verb anywhere fails.
const KNOWN_DEAD_ACTIONS = new Set(['confirm-corpus-save']);

test('every data-action rendered into #modalRoot reaches a handler', () => {
  const hostActions = modalHostActions();
  assert.ok(hostActions.size > 15, 'the dispatcher parse must not silently return nothing');

  const byFile = modalActionsByFile();
  assert.ok(byFile.size >= 8, `expected the modal renderers, found ${byFile.size}`);

  const dead = [];
  for (const [file, actions] of byFile) {
    const local = locallyHandled(file);
    for (const action of actions) {
      if (hostActions.has(action) || local.has(action)) continue;
      dead.push(`${action} (${file})`);
    }
  }
  const unexpected = dead.filter((d) => !KNOWN_DEAD_ACTIONS.has(d.split(' ')[0]));
  assert.deepEqual(
    unexpected,
    [],
    'these verbs render inside #modalRoot and reach neither /core/modal-host.js nor a local ' +
      'listener. #modalRoot is a SIBLING of #app-root, so the inspector dispatcher cannot see ' +
      'them: the buttons are drawn, clickable, and do nothing',
  );
});

test("save-sample's two suggestion verbs are specifically among the reachable ones", () => {
  const local = locallyHandled('public/modules/save-sample/index.js');
  assert.ok(local.has('hint-pick-partner'), 'hint-pick-partner must be handled locally');
  assert.ok(local.has('hint-create-partner'), 'hint-create-partner must be handled locally');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3b. …and the buttons actually work, with no #app-root dispatcher in sight
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The shell's real DOM shape: #modalRoot OUTSIDE #app-root, exactly as
 * index.{uk,en,ru}.html declares it. Getting this wrong would make the whole
 * class of defect untestable, so it is asserted against the shipped HTML in
 * its own test below.
 */
const SHELL_HTML =
  '<!doctype html><html><body>' +
  '<main id="app-root">' +
  '<textarea id="bidReq"></textarea><textarea id="bidRes"></textarea>' +
  '<span id="stEntity"></span>' +
  '</main>' +
  '<div id="modalRoot"></div>' +
  '<div class="toast-container" id="toastContainer"></div>' +
  '</body></html>';

function shellDom() {
  return new JSDOM(SHELL_HTML, {
    runScripts: 'outside-only',
    url: 'https://ortbtools.test/inspector',
  });
}

/** Install a jsdom window's globals for the duration of a module import. */
function withGlobals(win, extra = {}) {
  const values = { window: win, document: win.document, ...extra };
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

const tick = () => new Promise((r) => setTimeout(r, 0));

// ── Loading real browser modules ──────────────────────────────────────────
// browser-esm-loader finds a module's dependencies by regex over its raw text,
// and almost every lazy module in public/modules ends with a usage note that
// quotes its OWN specifier in a line comment:
//
//   //   await import('/modules/mirror/index.js'); window.openMirrorModal();
//
// A regex cannot tell a comment from code, so the module looks like it imports
// itself and the loader — correctly, on the evidence it has — refuses the
// cycle. Blanking exactly those comment lines, and nothing else, is the
// smallest intervention that keeps every module under test the real one. The
// list is derived by scanning rather than typed out, so a module that grows
// the same footnote tomorrow does not fail here for an unrelated reason.
function selfReferentialModules() {
  const out = [];
  for (const file of jsFilesUnder(path.join(PUBLIC_ROOT, 'modules'))) {
    const specifier = '/' + path.relative(PUBLIC_ROOT, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    const re = new RegExp(`^\\s*//.*import\\(\\s*['"]${specifier}['"]`, 'm');
    if (re.test(src)) out.push(specifier);
  }
  return out;
}

const COMMENTED_IMPORT_LINE = /^\s*\/\/.*\bimport\(.*$/gm;

function browserLoader(salt) {
  const substitutions = {};
  for (const specifier of selfReferentialModules()) {
    const file = path.join(PUBLIC_ROOT, specifier.replace(/^\//, ''));
    substitutions[specifier] = () =>
      fs.readFileSync(file, 'utf8').replace(COMMENTED_IMPORT_LINE, '//');
  }
  return createBrowserEsmLoader({ realmSalt: salt, substitutions });
}

test('#modalRoot really is a sibling of #app-root in the shipped shell', () => {
  // The premise of defects 3 and 4. Asserted from the HTML rather than trusted.
  for (const locale of ['uk', 'en', 'ru']) {
    const html = fs.readFileSync(path.join(PUBLIC_ROOT, `index.${locale}.html`), 'utf8');
    const mainClose = html.indexOf('</main>');
    const modalRoot = html.indexOf('id="modalRoot"');
    assert.ok(mainClose !== -1 && modalRoot !== -1, `${locale}: shell markup changed shape`);
    assert.ok(
      mainClose < modalRoot,
      `${locale}: #modalRoot must sit outside #app-root — if it ever moves inside, the local ` +
        'modal listeners become redundant rather than required',
    );
  }
});

test('clicking the partner suggestion selects the partner, with nothing bound to #app-root', async () => {
  const dom = shellDom();
  const win = dom.window;
  win.t = (k) => k;
  const seenByAppRoot = [];
  win.document.getElementById('app-root').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (el) seenByAppRoot.push(el.dataset.action);
  });

  win.OrtbtoolsSession = {
    user: { id: 1 },
    currentSampleId: null,
    currentSampleMeta: null,
    partnerCache: [{ id: 42, name: 'Adform' }],
    partnerOptionsHtml: () => '<option value="">—</option><option value="42">Adform</option>',
    wireEnterSubmit: () => {},
    api: async (method, url) => {
      if (url === 'api/intel/suggest-partner') {
        return { suggestion: { name: 'Adform', confidence: 'high' } };
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  };
  win.document.getElementById('bidReq').value = '{"id":"r1","site":{"domain":"adform.com"}}';

  const restore = withGlobals(win);
  try {
    const loader = browserLoader('ui-audit-save-sample');
    const mod = await loader.import('/modules/save-sample/index.js');
    mod.openSaveModal();
    await tick();
    await tick();

    const banner = win.document.getElementById('mPartnerHint');
    assert.ok(banner && !banner.hidden, 'the suggestion banner must have rendered');
    const btn = banner.querySelector('[data-action="hint-pick-partner"]');
    assert.ok(btn, 'the "use existing partner" button must be drawn');

    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick();

    assert.equal(
      win.document.getElementById('mPartner').value,
      '42',
      'the click must actually select the suggested partner',
    );
    assert.ok(banner.hidden, 'and dismiss the banner');
    assert.deepEqual(
      seenByAppRoot,
      [],
      'the click must never have reached #app-root — which is exactly why the ' +
        'inspector dispatcher could not handle it and the button was dead',
    );
  } finally {
    restore();
    win.close();
  }
});

test('the suggestion listener is bound once, however many times the modal opens', async () => {
  // #modalRoot is permanent chrome: closeModal() empties it but never replaces
  // the node, so a listener attached per-open accumulates. Five saves would
  // have meant five POSTs to /api/partners from one click on "create".
  const dom = shellDom();
  const win = dom.window;
  win.t = (k) => k;
  let created = 0;
  win.OrtbtoolsSession = {
    user: { id: 1 },
    currentSampleId: null,
    currentSampleMeta: null,
    partnerCache: [],
    partnerOptionsHtml: () => '<option value="">—</option>',
    wireEnterSubmit: () => {},
    refreshPartners: async () => {},
    api: async (method, url) => {
      if (url === 'api/intel/suggest-partner') return { suggestion: null };
      if (url === 'api/partners') {
        created++;
        return { partner: { id: 7, name: 'Fresh SSP' } };
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  };
  win.document.getElementById('bidReq').value = '{"id":"r1"}';

  const restore = withGlobals(win);
  try {
    const loader = browserLoader('ui-audit-save-sample-rebind');
    const mod = await loader.import('/modules/save-sample/index.js');
    for (let i = 0; i < 3; i++) {
      mod.openSaveModal();
      await tick();
      await tick();
      win.document.getElementById('modalRoot').innerHTML = '';
    }
    mod.openSaveModal();
    await tick();
    await tick();
    const banner = win.document.getElementById('mPartnerHint');
    banner.hidden = false;
    banner.innerHTML =
      '<button data-action="hint-create-partner" data-name="Fresh SSP">create</button>';
    banner
      .querySelector('[data-action="hint-create-partner"]')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick();
    await tick();

    assert.equal(created, 1, 'four opens must not turn one click into four partner POSTs');
  } finally {
    restore();
    win.close();
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. The duplicate Live modal stays retired
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('the canonical /live section is the only live-stream surface', () => {
  for (const locale of ['en', 'uk', 'ru']) {
    const template = fs.readFileSync(
      path.join(PUBLIC_ROOT, 'modules', 'inspector', `template.${locale}.html`),
      'utf8',
    );
    assert.doesNotMatch(template, /\bid=["']liveBtn["']/u, `${locale}: duplicate button`);
    assert.doesNotMatch(template, /\bdata-action=["']live["']/u, `${locale}: duplicate action`);
  }

  for (const relative of [
    'modules/live/index.js',
    'modules/live/i18n.js',
    'modules/live/README.md',
  ]) {
    assert.equal(fs.existsSync(path.join(PUBLIC_ROOT, relative)), false, relative);
  }

  const streamEndpointOwners = [];
  for (const file of jsFilesUnder(PUBLIC_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes('/api/v1/stream')) {
      streamEndpointOwners.push(path.relative(PUBLIC_ROOT, file).split(path.sep).join('/'));
    }
  }
  assert.deepEqual(
    streamEndpointOwners,
    ['modules/stream/index.js'],
    'only the canonical Streams module may consume the SSE endpoint',
  );

  const modalHost = fs.readFileSync(path.join(PUBLIC_ROOT, 'core/modal-host.js'), 'utf8');
  const inspectorCss = fs.readFileSync(
    path.join(PUBLIC_ROOT, 'modules/inspector/inspector.css'),
    'utf8',
  );
  assert.doesNotMatch(APP_SRC, /case\s+['"]live['"]|\/modules\/live\//u);
  assert.doesNotMatch(
    modalHost,
    /live-(?:load|pause)|__ortbtoolsLive/u,
    'legacy modal dispatch must not return',
  );
  assert.doesNotMatch(inspectorCss, /\.kt-live-/u, 'legacy modal CSS must not return');

  const shellBoot = fs.readFileSync(path.join(PUBLIC_ROOT, 'shell-boot.js'), 'utf8');
  const nav = fs.readFileSync(path.join(PUBLIC_ROOT, 'modules/nav/index.js'), 'utf8');
  assert.match(
    shellBoot,
    /registry\.registerLazy\('stream', '\/live',/u,
    'the canonical section remains registered',
  );
  assert.match(
    nav,
    /id:\s*'live',[\s\S]{0,80}?route:\s*'\/live'/u,
    'Streams remains permanently reachable from the rail',
  );
});
