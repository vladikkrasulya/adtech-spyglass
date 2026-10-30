'use strict';

/**
 * GitHub Actions supply-chain hygiene (audit 2026-10-29): third-party actions
 * are pinned to a full commit SHA (a tag can be moved), checkout does not
 * persist the job token, the default token is read-only, and nothing runs on
 * the privileged `pull_request_target` trigger.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', '.github', 'workflows');
const workflows = fs
  .readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }));

test('there are workflows to check', () => {
  assert.ok(workflows.length >= 2);
});

test('every `uses:` is pinned to a 40-hex commit SHA', () => {
  for (const { file, text } of workflows) {
    for (const m of text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      const ref = m[1];
      if (ref.startsWith('./')) continue;
      assert.match(ref, /@[0-9a-f]{40}$/, `${file}: ${ref} must be pinned to a commit SHA`);
    }
  }
});

test('checkout never persists the job token', () => {
  for (const { file, text } of workflows) {
    const steps = text
      .split(/^\s*-\s*(?=uses:)/m)
      .filter((s) => /^uses:\s*actions\/checkout@/.test(s));
    for (const step of steps) {
      assert.match(
        step,
        /persist-credentials:\s*false/,
        `${file}: checkout must not persist credentials`,
      );
    }
  }
});

test('workflows default to a read-only token and avoid pull_request_target', () => {
  for (const { file, text } of workflows) {
    assert.match(
      text,
      /^permissions:\s*\n\s+contents:\s*read\s*$/m,
      `${file}: top-level permissions`,
    );
    assert.doesNotMatch(text, /pull_request_target/, `${file}: pull_request_target is forbidden`);
  }
});

test('CI audits production dependencies', () => {
  const ci = workflows.find((w) => w.file === 'ci.yml');
  assert.ok(ci);
  assert.match(ci.text, /npm audit --omit=dev --audit-level=high/);
});
