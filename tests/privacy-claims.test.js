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
];

// Surfaces intentionally exempt from the policy. Historical changelog / dated
// audits quote past claims verbatim; the offline CLI's claim is accurate (no
// network calls). To exempt a file, add its repo-relative path here WITH a
// documented reason in this comment.
const ALLOWLIST = new Set([
  'CHANGELOG.md', // historical: quotes past claims verbatim
  'ROADMAP.md', // internal roadmap / decision log
  'CONTRIBUTING.md', // internal contributor doc
  'CLAUDE.md', // internal agent instructions
  'packages/cli/README.md', // offline CLI: "never leave the machine" is accurate (no network calls)
  'docs/audit-2026-05-12.md',
  'docs/functional-audit-2026-05-12.md',
  'docs/tech-debt-2026-05-04.md',
  'docs/jsfiddle-comparison-2026-05-04.md',
  'docs/superseded/stream-platform-pivot-2026-05-05.md',
]);

// Current, user-facing surfaces that must stay accurate: the served UI under
// public/ (.html + .js) plus the live user docs.
function collectFiles() {
  const files = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (/\.(html|js)$/.test(ent.name)) files.push(abs);
    }
  })(path.join(ROOT, 'public'));

  for (const doc of ['README.md', 'SECURITY.md', 'docs/PRIVACY.md', 'docs/USER_GUIDE.md']) {
    files.push(path.join(ROOT, doc));
  }

  return files.filter((abs) => !ALLOWLIST.has(path.relative(ROOT, abs)));
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
