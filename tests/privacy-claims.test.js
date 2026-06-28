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
 *   - Login passwords are sent to the server over TLS and hashed with bcrypt
 *     server-side; only the bcrypt hash is stored. Sessions store IP + UA.
 *   - Zero-knowledge applies ONLY to saved-library sample bodies + the DEK
 *     (encrypted in the browser; the server holds ciphertext + a wrapped key).
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
