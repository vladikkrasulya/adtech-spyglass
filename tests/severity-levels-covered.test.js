'use strict';

/**
 * Every level the engine emits must have a chip, and every chip must name a
 * level the engine emits.
 *
 * `packages/core/findings.js` has emitted four levels — error, warning, info,
 * question — and the Inspector's severity chips offered three plus "All". On a
 * payload carrying a question-level finding the row read
 *
 *     All 8 · Errors 1 · Warnings 4 · Info 2
 *
 * which sums to seven. `listHtml()` filters by exact level, so the eighth
 * finding was reachable only under "All" and no chip could isolate it. Worse,
 * both the class and icon chains ended in `warning`, so it rendered with the
 * amber stripe and the `!` icon: it looked like a warning, was counted as
 * nothing, and the row did not add up to its own total.
 *
 * Nothing failed, because nothing compared the chip list to the level list.
 * Only one finding in the whole catalog is question-level
 * (`dialects.question.unknown_ext_signal`), so a payload had to carry an
 * unrecognised vendor extension before the arithmetic broke on screen.
 *
 * This guard derives both sides rather than restating either. LEVELS is
 * required from Core, and the chip keys are parsed out of the array that
 * builds them, so adding a fifth level to the engine fails here rather than
 * shipping a counter row that silently omits it. Both directions are checked:
 * a chip naming a level nothing emits is the same defect pointing the other
 * way, and that is the one that already bit us in the finding catalog.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { LEVELS } = require('../packages/core/findings');
const APP = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
const I18N = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');

const LOCALES = 3; // uk, en, ru — public/i18n.js carries one block each

/**
 * Chip keys, read from the array that renders them. The label is captured too
 * so a chip whose key and message key disagree cannot pass.
 */
const CHIPS = [
  ...APP.matchAll(/\{\s*key:\s*'([a-z]+)',\s*label:\s*t\('severity\.chip\.([a-z]+)'\)/g),
].map((m) => ({ key: m[1], labelKey: m[2] }));

const ENGINE_LEVELS = Object.values(LEVELS);

test('the chip list is actually readable — a regex matching nothing must not pass', () => {
  // A guard whose parse silently returns [] asserts nothing at all while
  // reporting success. That failure mode is what let the browser-mirror parity
  // test guard one pair of six while promising no drift.
  assert.ok(
    CHIPS.length >= ENGINE_LEVELS.length + 1,
    `expected an "all" chip plus one per level, parsed ${CHIPS.length}: ` +
      JSON.stringify(CHIPS.map((c) => c.key)),
  );
  assert.ok(ENGINE_LEVELS.length >= 4, `expected the engine's levels, got ${ENGINE_LEVELS}`);
});

test('every chip key matches the message key it renders', () => {
  for (const chip of CHIPS) {
    assert.equal(
      chip.key,
      chip.labelKey,
      `chip "${chip.key}" renders severity.chip.${chip.labelKey} — filtering and labelling ` +
        'would disagree, so the chip would count one set and name another',
    );
  }
});

test('every level the engine emits has a chip', () => {
  const keys = new Set(CHIPS.map((c) => c.key));
  const missing = ENGINE_LEVELS.filter((l) => !keys.has(l));
  assert.deepEqual(
    missing,
    [],
    `packages/core/findings.js emits ${missing} with no chip in renderSeverityTabs — ` +
      'those findings would be reachable only under "All" and the counter row would not ' +
      'add up to its own total',
  );
});

test('every chip names a level the engine can emit', () => {
  const levels = new Set([...ENGINE_LEVELS, 'all']);
  const phantom = CHIPS.map((c) => c.key).filter((k) => !levels.has(k));
  assert.deepEqual(phantom, [], `chips ${phantom} name levels nothing emits — always zero`);
});

test('each chip has its label and empty state in all three locales', () => {
  for (const { key } of CHIPS) {
    for (const kind of ['chip', 'empty']) {
      const pattern = new RegExp(`'severity\\.${kind}\\.${key}'\\s*:`, 'g');
      assert.equal(
        (I18N.match(pattern) || []).length,
        LOCALES,
        `severity.${kind}.${key} must exist in all ${LOCALES} locale blocks of public/i18n.js — ` +
          'a missing key renders as a bracketed id on the locale that lacks it',
      );
    }
  }
});

test('a question renders as itself, not as a warning', () => {
  // Both chains previously fell through to `warning`, giving a question the
  // amber stripe and the `!` icon while no chip counted it.
  assert.match(
    APP,
    /lvl === 'question'\s*\?\s*'question'/,
    'the class chain must give question its own class rather than falling through to warning',
  );
  assert.match(
    APP,
    /lvl === 'question' \? '\?'/,
    'the icon chain must give question its own icon rather than the warning "!"',
  );
  assert.match(
    fs.readFileSync(path.join(ROOT, 'public/modules/inspector/inspector.css'), 'utf8'),
    /\.validation-item\.question\s*\{/,
    'inspector.css must style .validation-item.question, or the new class renders unstyled',
  );
});
