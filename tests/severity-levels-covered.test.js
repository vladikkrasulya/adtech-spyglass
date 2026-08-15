'use strict';

/**
 * Every level the engine emits must have a home in the findings panel, and
 * every section of that panel must name a level the engine emits.
 *
 * HISTORY. `packages/core/findings.js` emits four levels — error, warning,
 * info, question — and the Inspector's severity-filter chips once offered
 * three plus "All". On a payload carrying a question-level finding the row
 * read "All 8 · Errors 1 · Warnings 4 · Info 2", which sums to seven: the
 * eighth finding was reachable only under "All", rendered with a warning's
 * stripe and icon, and was counted by nothing. Nothing failed, because
 * nothing compared the chip list to the level list.
 *
 * THE PANEL CHANGED SHAPE, THE GUARD KEPT ITS SUBJECT. The v2 redesign
 * (per the mockup) replaced filter chips with always-visible groups —
 * Blocking / Should fix / Needs your input / Info. A group is a filter that
 * costs nothing, and the original defect is now impossible to hide: a level
 * with no group does not lose its count in a row of chips, it vanishes from
 * the panel entirely. Which is exactly why this guard survives the redesign:
 * it asserts the GROUPS map in renderSeverityTabs covers Core's LEVELS in
 * both directions, the same two directions the chips were checked in.
 *
 * Both sides are derived rather than restated: LEVELS is required from Core,
 * and the group entries are parsed out of the array that renders them, so a
 * fifth engine level fails here instead of shipping a panel that silently
 * omits it.
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
 * Group entries, read from the array that renders them. Key, the level it
 * collects, and the label key it shows are all captured, so an entry whose
 * pieces disagree cannot pass.
 */
const GROUPS = [
  ...APP.matchAll(
    /\{\s*key:\s*'([a-z_]+)',\s*level:\s*'([a-z]+)',\s*labelKey:\s*'(group\.[a-z_]+)'/g,
  ),
].map((m) => ({ key: m[1], level: m[2], labelKey: m[3] }));

const ENGINE_LEVELS = Object.values(LEVELS);

test('the group list is actually readable — a regex matching nothing must not pass', () => {
  // A guard whose parse silently returns [] asserts nothing at all while
  // reporting success. That failure mode is what let the browser-mirror parity
  // test guard one pair of six while promising no drift.
  assert.ok(
    GROUPS.length >= ENGINE_LEVELS.length,
    `expected one group per engine level, parsed ${GROUPS.length}: ` +
      JSON.stringify(GROUPS.map((g) => g.key)),
  );
  assert.ok(ENGINE_LEVELS.length >= 4, `expected the engine's levels, got ${ENGINE_LEVELS}`);
});

test('every level the engine emits has a group', () => {
  const covered = new Set(GROUPS.map((g) => g.level));
  const missing = ENGINE_LEVELS.filter((l) => !covered.has(l));
  assert.deepEqual(
    missing,
    [],
    `packages/core/findings.js emits ${missing} with no group in renderSeverityTabs — ` +
      'findings at that level would not render in the panel at all, which is worse than ' +
      'the chip-era defect this guard was written for',
  );
});

test('every group collects a level the engine can emit', () => {
  const levels = new Set(ENGINE_LEVELS);
  const phantom = GROUPS.filter((g) => !levels.has(g.level)).map((g) => g.key);
  assert.deepEqual(phantom, [], `groups ${phantom} collect levels nothing emits — always empty`);
});

test('no two groups collect the same level', () => {
  // A level claimed twice renders every such finding twice, and the section
  // counts stop summing to the verdict's totals.
  const seen = new Map();
  for (const g of GROUPS) {
    assert.ok(
      !seen.has(g.level),
      `level "${g.level}" is collected by both "${seen.get(g.level)}" and "${g.key}"`,
    );
    seen.set(g.level, g.key);
  }
});

test('each group has its header label in all three locales', () => {
  for (const { labelKey } of GROUPS) {
    const pattern = new RegExp(`'${labelKey.replace('.', '\\.')}'\\s*:`, 'g');
    assert.equal(
      (I18N.match(pattern) || []).length,
      LOCALES,
      `${labelKey} must exist in all ${LOCALES} locale blocks of public/i18n.js — ` +
        'a missing key renders as a bracketed id on the locale that lacks it',
    );
  }
});

test('a question renders as itself, not as a warning', () => {
  // The class chain previously fell through to `warning`, giving a question
  // the amber stripe while no counter owned it.
  assert.match(
    APP,
    /lvl === 'question'\s*\?\s*'question'/,
    'the class chain must give question its own class rather than falling through to warning',
  );
  assert.match(
    fs.readFileSync(path.join(ROOT, 'public/modules/inspector/inspector.css'), 'utf8'),
    /\.validation-item\.question\s*\{/,
    'inspector.css must style .validation-item.question, or the class renders unstyled',
  );
});
