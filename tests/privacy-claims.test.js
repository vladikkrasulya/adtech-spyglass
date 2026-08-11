'use strict';

/**
 * Privacy-claim regression guard.
 *
 * The public UI and user-facing docs must not reintroduce absolute privacy
 * claims that contradict the real network flow:
 *
 *   - The Inspector (POST /api/analyze) sends pasted bid data over HTTPS and
 *     analyzes it SERVER-SIDE. Raw payload bodies are processed transiently and
 *     never stored, but the server keeps derived metadata (ClickHouse
 *     validation_logs + per-user analyze_log) and an operational request log
 *     (ClickHouse event_log) that records the client IP, sampled.
 *   - The browser keeps up to 50 raw recent analyses in same-origin
 *     localStorage; this survives reloads and synchronizes across tabs.
 *   - Login passwords are sent to the server over TLS and hashed with bcrypt
 *     server-side; only the bcrypt hash is stored. Sessions store IP + UA.
 *   - The current web flow encrypts saved request/response bodies + the DEK.
 *     Sample notes, partner/dialect metadata, and saved Behavior Corpus data
 *     are plaintext; direct API clients are not forced to encrypt sample bodies.
 *
 * See docs/PRIVACY.md for the full, code-verified contract.
 *
 * This test fails if any scanned current/public surface contains a forbidden
 * absolute claim. The patterns are written to catch the FALSE *data / payload /
 * password* claims while leaving legitimately-scoped statements intact — e.g.
 * "the KEK never leaves the browser" (true: the KEK really is browser-only) and
 * the offline CLI's "your payloads never leave the machine" (true: it makes no
 * network calls). Historical changelog / migration notes are exempt via
 * ALLOWLIST.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Forbidden absolute claims. Each contradicts the verified flow above. `\s+`
// (not a literal space) is used between words so a claim wrapped across two
// lines by Prettier is still caught.
const FORBIDDEN = [
  { label: '"100% client-side"', re: /100\s*%\s*client[-\s]?side/i },
  { label: '"no servers"', re: /\bno\s+servers\b/i },
  { label: '"no logs"', re: /\bno\s+logs\b/i },
  { label: '"password never leaves"', re: /password\s+never\s+leaves?/i },
  {
    // "the password and KEK never leave the browser" — note this deliberately
    // requires "password and <word>" so it does NOT match the legitimate
    // "the KEK derived from your password ... never leaves the browser".
    label: 'password "and … never leave[s]"',
    re: /password\s+and\s+\w+\s+never\s+leaves?/i,
  },
  {
    // Catches data / payload "never leaves the browser/device/tab" — but NOT
    // "the KEK / DEK / key never leaves the browser" (those subjects are absent
    // from the list, and they are genuinely browser-only).
    label: 'bid data / payload "never leaves the browser"',
    re: /\b(?:bid[-\s]+stream\s+payload\s+values?|payload\s+values?|payloads?|bid\s+data|data)\s+never\s+leaves?\b/i,
  },
  {
    // The "no ... payload values leave the user's browser" construction (the
    // negation is "no", not "never"). Location-anchored to avoid false hits.
    label: 'payload values "leave the browser/tab"',
    re: /payload\s+values?\s+(?:never\s+)?leaves?\s+(?:the\s+|your\s+|the\s+user'?s\s+)?(?:browser|tab|device)\b/i,
  },
  { label: 'UK "дані не залишають …"', re: /дан[іи]\s+не\s+залишают[ьйи]/i },
  { label: 'RU "данные не покидают …"', re: /данные\s+не\s+покидают/i },
  { label: 'UK "без логів, без серверів"', re: /без\s+логів,?\s*без\s+серверів/i },
  { label: 'RU "без логов, без серверов"', re: /без\s+логов,?\s*без\s+серверов/i },
  {
    // "client-side validation" — validation actually runs server-side via
    // /api/analyze. Note: this matches "client-side validation" but NOT the
    // legitimate "validation findings ... applied client-side" (the temp-dialect
    // overlay genuinely IS merged in the browser), nor "client-side encryption".
    label: '"client-side validation"',
    re: /client[-\s]?side\s+validation/i,
  },
  {
    // "runs/does validation client-side" / "validation runs client-side".
    label: 'validation "runs client-side"',
    re: /(?:\b(?:runs?|does|performs?)\s+validat\w*\s+client[-\s]?side|\bvalidat\w*\s+(?:runs?|happens?|done|performed|executed)\s+client[-\s]?side)/i,
  },
  {
    // "no phoning home" as a product promise — the hosted app DOES POST to
    // /api/analyze. (Accurate only for the offline core lib / CLI, which are
    // out of this scan's scope / allowlisted.)
    label: '"no phoning home"',
    re: /\bno\s+phoning\s+home\b/i,
  },
  {
    // "validation runs in your browser" — validation runs server-side. Requires
    // a run-verb between "validat…" and "in the/your browser" so it does NOT
    // match the legitimate "validation findings render in the browser" (UI) or
    // "the key derivation happens in your browser".
    label: 'validation "runs in the/your browser"',
    re: /\bvalidat\w*\s+(?:runs?|happens?|performed|done|executed|occurs?)\s+in\s+(?:the|your)\s+browser\b/i,
  },
  {
    label: '"everything you save is encrypted"',
    re: /everything\s+you\s+save\s+is\s+encrypted/i,
  },
  {
    label: 'UK "все що зберігається, шифрується"',
    re: /все\s+що\s+зберігається[,.]?\s+шифрується/i,
  },
  {
    label: 'RU "всё что сохраняется, шифруется"',
    re: /вс[её]\s+что\s+сохраняется[,.]?\s+шифруется/i,
  },
  {
    label: '"server stores ciphertext only"',
    re: /server\s+stores\s+ciphertext\s+only/i,
  },
  {
    label: 'UK/RU "server stores ciphertext only"',
    re: /(?:на\s+сервері\s+зберігається|на\s+сервере\s+хранится)\s+лише?\s*шифротекст|на\s+сервере\s+хранится\s+только\s+шифротекст/i,
  },
  {
    label: 'encrypted samples and partners',
    re: /(?:zero[-\s]?knowledge\s+)?(?:encrypted|зашифрован\w*)\s+(?:bid\s+)?samples?\s*(?:and|\+)\s*partners?|зашифрован\w*\s+bid\s+samples?\s*\+\s*партнер/i,
  },
  {
    label: 'share/embed payload "never reaches the server"',
    re: /\b(?:payloads?|bid\s+payloads?)\b[\s\S]{0,120}\b(?:never\s+reaches?|does\s+not\s+reach)\s+the\s+server\b/i,
  },
  {
    label: 'UK share/embed payload "не потрапляє на сервер"',
    re: /\b(?:payload|bid)\b[\s\S]{0,120}(?:на\s+сервер\s+(?:ніколи\s+)?не\s+(?:потрапляє|йде|доходить)|ніколи\s+не\s+доходить\s+до\s+сервера)/i,
  },
  {
    label: 'RU share/embed payload "не попадает на сервер"',
    re: /\b(?:payload|bid)\b[\s\S]{0,120}(?:на\s+сервер\s+не\s+(?:попадает|ид[её]т|доходит)|никогда\s+не\s+доходит\s+до\s+сервера)/i,
  },
  {
    label: 'anonymous history "browser tab only / reload empty"',
    re: /\banonymous\b[\s\S]{0,140}(?:browser\s+tab\s+only|reload\s*(?:=|—|-)\s*empty)/i,
  },
  {
    label: 'UK anonymous history "tab only / reload empty"',
    re: /\bанонім\b[\s\S]{0,140}(?:тільки\s+у\s+вкладці|reload\s*(?:=|—|-)\s*(?:і\s+)?пуст)/i,
  },
  {
    label: 'RU anonymous history "tab only / reload empty"',
    re: /\bаноним\b[\s\S]{0,140}(?:только\s+во?\s+вкладке|reload\s*(?:=|—|-)\s*(?:и\s+)?пуст)/i,
  },
  {
    label: 'whole library "is encrypted"',
    re: /\blibrary\s+is\s+encrypted\b/i,
  },
  {
    label: 'UK whole library "зашифрована"',
    re: /\bбібліотека\s+зашифрована\b/i,
  },
  {
    label: 'RU whole library "зашифрована"',
    re: /\bбиблиотека\s+зашифрована\b/i,
  },
  {
    label: 'recovery scoped to the whole library/data',
    re: /recover\s+access\s+to\s+your\s+library|operator[\s\S]{0,80}(?:can(?:no|')t|cannot)\s+recover\s+your\s+data/i,
  },
  {
    label: 'UK recovery scoped to the whole library/data',
    re: /відновити\s+доступ\s+до\s+тво(?:єї|єі)\s+бібліотеки|оператор[\s\S]{0,80}не\s+зможе\s+відновити\s+твої\s+дані/i,
  },
  {
    label: 'RU recovery scoped to the whole library/data',
    re: /восстановить\s+доступ\s+к\s+твоей\s+библиотеке|оператор[\s\S]{0,80}не\s+сможет\s+восстановить\s+твои\s+данные/i,
  },
  {
    label: 'wipe everything',
    re: /\bwipe\s+everything\b/i,
  },
  {
    label: 'UK "стерти все"',
    re: /\bстерти\s+все\b/i,
  },
  {
    label: 'RU "стереть всё"',
    re: /\bстереть\s+вс[её]\b/i,
  },
  {
    label: 'wipe "signed out everywhere"',
    re: /\bsigned\s+out\s+everywhere\b/i,
  },
  {
    label: 'UK wipe "all sessions end"',
    re: /\bусі\s+сесії\s+заверш(?:аться|уються)\b/i,
  },
  {
    label: 'RU wipe "all sessions end"',
    re: /\bвсе\s+сессии\s+заверш(?:атся|аются)\b/i,
  },
];

// Surfaces intentionally exempt from the policy. Historical changelog / dated
// audits quote past claims verbatim; the offline CLI's claim is accurate (no
// network calls). To exempt a file, add its repo-relative path here WITH a
// documented reason in this comment.
const ALLOWLIST = new Set([
  // Internal (not user-facing) docs — exempt by policy.
  'CHANGELOG.md', // historical: quotes past claims verbatim
  'ROADMAP.md', // internal roadmap / decision log
  'CONTRIBUTING.md', // internal contributor doc
  'CLAUDE.md', // internal agent instructions
  // Offline packages — "no phoning home" / "runs in browser AND Node" are
  // accurate for the network-free core library + CLI (verified: zero fetch).
  'packages/cli/README.md',
  'packages/core/README.md',
  'packages/core/knowledge_base/README.md',
  // Dated / historical / superseded — describe a past state verbatim. New
  // dated docs must be added here explicitly (the scan picks up every
  // root/docs Markdown file by default).
  'docs/audit-2026-05-12.md',
  'docs/cu-pops-audit-2026-05-12.md',
  'docs/functional-audit-2026-05-12.md',
  'docs/tech-debt-2026-05-04.md',
  'docs/tech-debt-2026-05-12.md',
  'docs/jsfiddle-comparison-2026-05-04.md',
  'docs/jsonfeed-research-adkernel-2026-05-04.md',
  'docs/next-chapters-2026-05-09.md',
  'docs/validator-roadmap-2026-05-09.md',
  'docs/sonnet-orchestration-plan.md',
  'docs/superseded/stream-platform-pivot-2026-05-05.md',
]);

// Current, user-facing surfaces that must stay accurate: the served UI under
// public/ (.html + .js), the live user docs, and the server-side copy emitters
// (lib/seo.js builds the per-route SEO meta tags; lib/landings.js builds the
// /docs/openrtb-* landing pages — both inject public copy that overrides or
// supplements the static HTML).
function collectFiles() {
  const files = [];

  // 1. The served UI — every .html + .js under public/.
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (/\.(html|js)$/.test(ent.name)) files.push(abs);
    }
  })(path.join(ROOT, 'public'));

  // 2. Server-side copy emitters (inject public meta + landing copy).
  files.push(path.join(ROOT, 'lib', 'seo.js'), path.join(ROOT, 'lib', 'landings.js'));

  // 3. Every current user / architecture doc: root-level *.md (non-recursive,
  //    so we skip node_modules/packages) + everything under docs/ (recursive,
  //    to include docs/superseded/). Historical/internal docs are removed by
  //    the ALLOWLIST below — so a NEW active doc is policed automatically.
  for (const ent of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith('.md')) files.push(path.join(ROOT, ent.name));
  }
  (function walkMd(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walkMd(abs);
      else if (ent.name.endsWith('.md')) files.push(abs);
    }
  })(path.join(ROOT, 'docs'));

  return [...new Set(files)].filter((abs) => !ALLOWLIST.has(path.relative(ROOT, abs)));
}

const FILES = collectFiles();

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

test('scan set covers the public marketing surfaces', () => {
  assert.ok(FILES.length > 10, `expected to scan many files, got ${FILES.length}`);
  const rels = new Set(FILES.map((f) => path.relative(ROOT, f)));
  for (const must of [
    'public/index.en.html',
    'public/index.uk.html',
    'public/index.ru.html',
    'public/about.en.html',
    'public/about.uk.html',
    'public/about.ru.html',
    'public/account.en.html',
    'docs/PRIVACY.md',
    'docs/ARCHMAP.md',
    'docs/api-v1.md',
    'ARCHITECTURE.md',
    'lib/seo.js',
    'lib/landings.js',
  ]) {
    assert.ok(rels.has(must), `scan set must include ${must}`);
  }
});

for (const abs of FILES) {
  const rel = path.relative(ROOT, abs);
  test(`no forbidden privacy claim in ${rel}`, () => {
    const text = fs.readFileSync(abs, 'utf8');
    for (const { label, re } of FORBIDDEN) {
      const m = re.exec(text);
      assert.equal(
        m,
        null,
        m
          ? `${rel}:${lineOf(text, m.index)} reintroduces forbidden claim ${label} — "${m[0].replace(/\s+/g, ' ')}"`
          : '',
      );
    }
  });
}

// Positive lock-in: each landing page must keep the accurate server-side
// contract phrase, so a silent revert of the hero/meta copy also fails CI.
const CONTRACT = {
  'public/index.en.html': /analyzed\s+on\s+the\s+server/i,
  'public/index.uk.html': /аналізуються\s+на\s+сервері/i,
  'public/index.ru.html': /анализируются\s+на\s+сервере/i,
};
for (const [rel, re] of Object.entries(CONTRACT)) {
  test(`${rel} states the accurate server-side contract`, () => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(text, re, `${rel} lost its accurate "analyzed on the server" contract line`);
  });
}

// Stricter check for the two server-side copy emitters. lib/seo.js (per-route
// meta descriptions) and lib/landings.js (the /docs/openrtb-* landing pages) are
// pure marketing copy: validation runs SERVER-SIDE, so any "client-side / in the
// browser / у браузері / в браузере" phrasing there is necessarily false. This is
// scoped to these two files only — public/*.js and other docs legitimately use
// "client-side" in code comments and "in the browser" for UI rendering, so the
// global FORBIDDEN list above stays narrower.
const MARKETING_LOCALITY = [
  { label: '"client-side"', re: /\bclient[-\s]?side\b/i },
  { label: '"in the/your browser"', re: /\bin\s+(?:the|your)\s+browser\b/i },
  { label: 'UK "у/в браузері"', re: /\b[ув]\s+браузер[іе]\b/i },
  { label: 'RU "в браузере"', re: /\bв\s+браузере\b/i },
];
for (const rel of ['lib/seo.js', 'lib/landings.js']) {
  test(`${rel} makes no browser-side validation claim`, () => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const { label, re } of MARKETING_LOCALITY) {
      const m = re.exec(text);
      assert.equal(
        m,
        null,
        m
          ? `${rel}:${lineOf(text, m.index)} claims browser-side processing ${label} — "${m[0]}" (validation is server-side)`
          : '',
      );
    }
  });
}

// Positive assertions — lock in the accurate flows so a silent revert fails CI.

// Behavior flow: the about page must describe probe-in-iframe → POST
// /api/analyze-behavior → engine runs SERVER-SIDE (not "in the browser").
const BEHAVIOR_FLOW = {
  'public/about.en.html': [/\/api\/analyze-behavior/, /server-side/i],
  'public/about.uk.html': [/\/api\/analyze-behavior/, /на сервері/],
  'public/about.ru.html': [/\/api\/analyze-behavior/, /на сервере/],
};
for (const [rel, regexes] of Object.entries(BEHAVIOR_FLOW)) {
  test(`${rel} describes the behavior engine running server-side`, () => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of regexes) {
      assert.match(text, re, `${rel} lost the accurate behavior-flow description (${re})`);
    }
  });
}

// Mixed preference storage: the account page must disclose that the locale
// preference is persisted server-side (cross-device) via /api/auth/preferences,
// i.e. NOT all-preferences-are-local.
for (const rel of ['public/account.en.html', 'public/account.uk.html', 'public/account.ru.html']) {
  test(`${rel} discloses server-side (cross-device) locale preference`, () => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(
      text,
      /\/api\/auth\/preferences/,
      `${rel} no longer discloses that the locale preference syncs server-side (/api/auth/preferences)`,
    );
  });
}

// Architecture docs must describe the real server-side validation path.
const SERVER_SIDE_VALIDATION = {
  'docs/ARCHMAP.md':
    /\/api\/analyze[\s\S]{0,160}server-side|server-side[\s\S]{0,160}\/api\/analyze/i,
  'ARCHITECTURE.md': /validate[sd]?\s+\*\*server-side\*\*|server-side[\s\S]{0,120}\/api\/analyze/i,
};
for (const [rel, re] of Object.entries(SERVER_SIDE_VALIDATION)) {
  test(`${rel} describes server-side /api/analyze validation`, () => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(text, re, `${rel} lost its accurate server-side /api/analyze description`);
  });
}

test('privacy docs disclose persistent browser history using the runtime limit', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
  const limitMatch = app.match(/const\s+HISTORY_MAX\s*=\s*(\d+)/);
  assert.ok(limitMatch, 'public/ortbtools.app.js must declare HISTORY_MAX');
  const limit = limitMatch[1];

  for (const rel of [
    'README.md',
    'docs/PRIVACY.md',
    'docs/USER_GUIDE.md',
    'public/about.en.html',
    'public/about.uk.html',
    'public/about.ru.html',
  ]) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(text, /localStorage/, `${rel} must disclose browser localStorage history`);
    assert.match(
      text,
      new RegExp(`(?:up to|до)\\s+${limit}\\b`, 'i'),
      `${rel} must track the runtime HISTORY_MAX=${limit}`,
    );
  }
});

test('share and embed copy distinguishes the initial fragment request from automatic analysis', () => {
  const shareRuntime = fs.readFileSync(path.join(ROOT, 'public/modules/share/index.js'), 'utf8');
  const inspectorRuntime = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
  assert.match(
    shareRuntime,
    /loadFromHash[\s\S]{0,1800}window\.runAnalysis\(\)/,
    'hash restore must stay covered as an automatic analysis trigger',
  );
  assert.match(
    inspectorRuntime,
    /fetch\(analyzeUrl\(\)[\s\S]{0,180}body:\s*JSON\.stringify\(body\)/,
    'runAnalysis must stay covered as a body POST to /api/analyze',
  );

  const copyContracts = {
    'public/modules/share/i18n.js': [
      /initial[\s\S]{0,80}(?:HTTP\s+)?request/i,
      /(?:початков|перш)\w*[\s\S]{0,80}(?:HTTP[-\s]?)?запит/i,
      /(?:первонач|перв)\w*[\s\S]{0,80}(?:HTTP[-\s]?)?запрос/i,
    ],
    'public/modules/embed/i18n.js': [
      /initial[\s\S]{0,80}(?:HTTP\s+)?request/i,
      /(?:початков|перш)\w*[\s\S]{0,80}(?:HTTP[-\s]?)?запит/i,
      /(?:первонач|перв)\w*[\s\S]{0,80}(?:HTTP[-\s]?)?запрос/i,
    ],
    'public/modules/inspector/template.en.html': [/initial[\s\S]{0,80}request/i],
    'public/modules/inspector/template.uk.html': [/(?:початков|перш)\w*[\s\S]{0,80}запит/i],
    'public/modules/inspector/template.ru.html': [/(?:первонач|перв)\w*[\s\S]{0,80}запрос/i],
    'public/about.en.html': [/initial[\s\S]{0,80}request/i],
    'public/about.uk.html': [/(?:початков|перш)\w*[\s\S]{0,80}запит/i],
    'public/about.ru.html': [/(?:первонач|перв)\w*[\s\S]{0,80}запрос/i],
  };
  for (const [rel, localePatterns] of Object.entries(copyContracts)) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const re of localePatterns) {
      assert.match(text, re, `${rel} must scope fragment privacy to the initial request (${re})`);
    }
    const analyzeMentions = text.match(/\/api\/analyze/g) || [];
    assert.ok(
      analyzeMentions.length >= localePatterns.length,
      `${rel} must disclose automatic /api/analyze submission in every locale`,
    );
  }
});

test('current security docs disclose plaintext metadata and the direct-API caveat', () => {
  const privacy = fs.readFileSync(path.join(ROOT, 'docs/PRIVACY.md'), 'utf8');
  assert.match(privacy, /sample\s+titles,\s+statuses\s+and\s+notes/i);
  assert.match(privacy, /Partner\s+`name`[\s\S]{0,180}plaintext/i);
  assert.match(privacy, /custom\s+dialect[\s\S]{0,220}plaintext/i);
  assert.match(privacy, /Behavior\s+Corpus[\s\S]{0,400}plaintext/i);
  assert.match(privacy, /API\s+does\s+not\s+cryptographically\s+verify/i);

  const security = fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf8');
  assert.match(security, /Sample\s+title[\s\S]{0,160}notes/i);
  assert.match(security, /Partner\s+names[\s\S]{0,160}dialect/i);
});

const ACCOUNT_METADATA_CONTRACT = {
  'public/account.en.html': /sample\s+notes[\s\S]{0,160}server-readable/i,
  'public/account.uk.html': /Нотатки\s+зразків[\s\S]{0,180}читає\s+сервер/i,
  'public/account.ru.html': /Заметки\s+образцов[\s\S]{0,180}читает\s+сервер/i,
};
for (const [rel, re] of Object.entries(ACCOUNT_METADATA_CONTRACT)) {
  test(`${rel} scopes encryption to payload bodies`, () => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(text, re, `${rel} must disclose that library metadata is server-readable`);
  });
}

test('cabinet labels the IV marker without claiming cryptographically proven encryption', () => {
  const dbText = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(
    dbText,
    /\(req_iv\s+IS\s+NOT\s+NULL\)\s+AS\s+is_encrypted/i,
    'test assumptions changed: is_encrypted is expected to remain an IV-presence marker',
  );

  const dictionary = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');
  assert.match(
    dictionary,
    /'cabinet\.pill\.encrypted':\s*\{[\s\S]{0,100}en:\s*'[^']*\bIV\b[^']*(?:present|marked|not verified)[^']*'/i,
    'EN cabinet pill must say that an IV/marker is present, not claim proven encryption',
  );
  assert.match(
    dictionary,
    /'cabinet\.pill\.encrypted':\s*\{[\s\S]{0,180}uk:\s*'(?=[^']*\bIV\b)(?=[^']*(?:є|наяв|познач|не перевір))[^']*'/i,
    'UK cabinet pill must say that an IV/marker is present, not claim proven encryption',
  );
  assert.match(
    dictionary,
    /'cabinet\.pill\.encrypted':\s*\{[\s\S]{0,260}ru:\s*'[^']*\bIV\b[^']*(?:есть|присутств|помеч|не провер)[^']*'/i,
    'RU cabinet pill must say that an IV/marker is present, not claim proven encryption',
  );

  const statLabels = {
    'public/account.en.html': /\bIV\b[\s\S]{0,40}(?:present|marked|not verified)/i,
    'public/account.uk.html':
      /(?:\bIV\b[\s\S]{0,40}(?:є|наяв|познач|не перевір)|(?:є|наяв|познач|не перевір)[\s\S]{0,40}\bIV\b)/i,
    'public/account.ru.html':
      /(?:\bIV\b[\s\S]{0,40}(?:есть|присутств|помеч|не провер)|(?:есть|присутств|помеч|не провер)[\s\S]{0,40}\bIV\b)/i,
  };
  for (const [rel, re] of Object.entries(statLabels)) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const markerAt = text.indexOf('id="statEncrypted"');
    assert.notEqual(markerAt, -1, `${rel} lost the sample marker statistic`);
    assert.match(
      text.slice(markerAt, markerAt + 320),
      re,
      `${rel} must label statEncrypted as an IV marker, not proven encryption`,
    );
  }
});

test('recovery and unlock copy scopes protection to encrypted bid bodies', () => {
  const recovery = fs.readFileSync(path.join(ROOT, 'public/modules/recovery/i18n.js'), 'utf8');
  const bodyBlock = recovery.match(/'recovery\.body':\s*\{([\s\S]*?)\n\s*\},/);
  assert.ok(bodyBlock, 'recovery.body locale block must exist');
  const bodyWords = /** @type {Record<string, RegExp>} */ ({
    en: /bod(?:y|ies)/i,
    uk: /тіл/i,
    ru: /тел/i,
  });
  for (const [locale, bodyWord] of Object.entries(bodyWords)) {
    const value = bodyBlock[1].match(new RegExp(`${locale}:\\s*'([^']+)'`));
    assert.ok(value, `recovery.body must include ${locale}`);
    assert.match(
      value[1],
      /bid|request\/response/i,
      `${locale} recovery copy must name bid bodies`,
    );
    assert.match(value[1], bodyWord, `${locale} recovery copy must be body-scoped`);
  }

  const dictionary = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');
  const unlockCopy = [...dictionary.matchAll(/'sample\.unlock_cta':\s*'([^']+)'/g)].map(
    (m) => m[1],
  );
  assert.equal(unlockCopy.length, 3, 'sample.unlock_cta must exist in all three locales');
  for (const value of unlockCopy) {
    assert.match(value, /bid/i, 'unlock copy must identify bid content, not the whole library');
    assert.match(value, /bod|тіл|тел/i, 'unlock copy must be scoped to payload bodies');
  }
});

test('password-reset wipe copy enumerates deletion and retention boundaries per locale', () => {
  const text = fs.readFileSync(path.join(ROOT, 'public/modules/password-reset/i18n.js'), 'utf8');
  const localeCopy = (locale) =>
    [...text.matchAll(new RegExp(`${locale}:\\s*'([^']*)'`, 'g'))].map((m) => m[1]).join(' ');

  const contracts = {
    en: {
      deleted: [
        /saved samples/i,
        /partners/i,
        /custom dialects/i,
        /activity history/i,
        /Behavior Corpus entries/i,
        /old sessions/i,
      ],
      browser: /browser\s+History[\s\S]{0,120}(?:remains|stays|is not cleared)/i,
      operational: /operational\s+(?:logs?|telemetry)/i,
      backups: /backups?/i,
      retention: /retention/i,
    },
    uk: {
      deleted: [
        /збережені\s+(?:зразки|запити)/i,
        /партнер/i,
        /(?:власні|користувацькі)\s+діалект/i,
        /історі[яю]\s+активності/i,
        /Behavior Corpus/i,
        /(?:старі|попередні)\s+сесі/i,
      ],
      browser: /(?:браузерна\s+)?History[\s\S]{0,120}(?:залиша|не\s+(?:очищ|видал))/i,
      operational: /операційн[а-яіїєґ]*\s+(?:лог|журнал|телеметр)/i,
      backups: /(?:backup|резервн[а-яіїєґ]*\s+коп)/i,
      retention: /(?:retention|строк[а-яіїєґ]*\s+зберіган)/i,
    },
    ru: {
      deleted: [
        /сохран[её]нные\s+(?:образцы|запросы)/i,
        /партн[её]р/i,
        /(?:собственные|пользовательские)\s+диалект/i,
        /истори[яю]\s+активности/i,
        /Behavior Corpus/i,
        /(?:старые|предыдущие)\s+сесси/i,
      ],
      browser: /(?:браузерная\s+)?History[\s\S]{0,120}(?:оста|не\s+(?:очищ|удал))/i,
      operational: /операционн[а-яё]*\s+(?:лог|журнал|телеметр)/i,
      backups: /(?:backup|резервн[а-яё]*\s+коп)/i,
      retention: /(?:retention|срок[а-яё]*\s+хранен)/i,
    },
  };

  for (const [locale, contract] of Object.entries(contracts)) {
    const copy = localeCopy(locale);
    assert.ok(copy, `password-reset copy must include ${locale}`);
    for (const required of contract.deleted) {
      assert.match(copy, required, `${locale} wipe copy lost deleted class ${required}`);
    }
    assert.match(copy, contract.browser, `${locale} wipe copy must preserve browser History`);
    assert.match(
      copy,
      contract.operational,
      `${locale} wipe copy must disclose operational retention`,
    );
    assert.match(copy, contract.backups, `${locale} wipe copy must disclose backup retention`);
    assert.match(copy, contract.retention, `${locale} wipe copy must name the retention policy`);
  }
});
