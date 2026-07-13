'use strict';

/**
 * Brand guard — the Spyglass name is retired (naming canon: internal codename
 * Themis, public brand ortbtools; vault «Spyglass — ortbtools», Етап 0).
 *
 * This test FAILS the build if any tracked file reintroduces the retired
 * name outside the explicit allowlist below. Three escape hatches:
 *   1. FILE allowlist — historical documents quoted as they existed.
 *   2. LINE marker `legacy-spyglass-ok` — compatibility shims that must keep
 *      the old identifier (cookie/env/db/storage migration paths, ~v1.6).
 *   3. SUBSTRING allowlist — pointers to external artifacts that carry the
 *      old name (Obsidian-vault note filenames, host paths pending wave F).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const FILE_ALLOWLIST = new Set([
  'CHANGELOG.md',
  'docs/audit-2026-05-12.md',
  'docs/tech-debt-2026-05-04.md',
  'docs/tech-debt-2026-05-12.md',
  'docs/jsfiddle-comparison-2026-05-04.md',
  'tests/brand-guard.test.js',
]);

const SUBSTRING_ALLOWLIST = [
  // Obsidian-vault note names — external paper trail, renaming the strings
  // would break the pointers without renaming the vault files.
  'spyglass_crypto_architecture',
  'spyglass_phase_8_plan',
  'spyglass-audit-2026-06-14',
  'spyglass_working_rules',
  'spyglass_cabinet_draft',
  'spyglass_i18n_debt',
  'spyglass_jsonfeed_research',
  // Host repo path — renamed with a compat symlink in migration wave F; drop
  // this entry once the directory is flipped.
  '/srv/DATA/Stacks/adtech-spyglass',
];

const LINE_MARKER = 'legacy-spyglass-ok';
const RE = /spyglass|spy_session/i;
const BINARY_EXT = new Set(['.png', '.woff2', '.ico', '.jpg', '.gif', '.pdf', '.gz', '.zip']);

test('no tracked file reintroduces the retired Spyglass name', () => {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const violations = [];
  for (const rel of tracked) {
    if (FILE_ALLOWLIST.has(rel)) continue;
    if (rel.includes('.bak')) continue; // checked-in historical snapshots
    if (BINARY_EXT.has(path.extname(rel))) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      continue; // deleted/binary
    }
    if (!RE.test(text)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!RE.test(line)) continue;
      if (line.includes(LINE_MARKER)) continue;
      if (SUBSTRING_ALLOWLIST.some((s) => line.includes(s))) continue;
      violations.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `retired "Spyglass" name found outside the allowlist:\n${violations.join('\n')}\n` +
      'Use the new ortbtools identifiers, or mark an intentional compatibility ' +
      `shim with a "${LINE_MARKER}" comment.`,
  );
});
