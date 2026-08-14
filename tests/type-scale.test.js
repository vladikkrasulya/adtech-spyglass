'use strict';

/**
 * The type scale is a scale, not a suggestion.
 *
 * `public/design-system.css` defines ten steps — 11, 13, 15, 17, 20, 28, 40,
 * 56, 80, 112 — and the Inspector rendered fourteen distinct sizes on one
 * screen, of which 121 elements were at 10px or below and one was 8px. The
 * scale's own body size, 15px, appeared on 9 elements out of roughly 450. Sizes
 * that exist nowhere in the system — 8, 9, 10, 12, 14, 16, 18, 22, 24 — carried
 * most of the interface.
 *
 * Nothing failed, because nothing compared what shipped to the scale it was
 * supposed to be on. That is why a one-off cleanup is not the fix: the sizes
 * would drift back the same way, one reasonable-looking `font-size: 12px` at a
 * time, and nothing would notice.
 *
 * So this is a ratchet rather than a pass/fail on perfection. Every stylesheet
 * carries its current count of off-scale literals and the count must match
 * EXACTLY. Adding one fails. Removing one also fails, with the number to write
 * instead — which keeps progress deliberate and visible in the diff rather than
 * letting the budget quietly absorb a regression somewhere else.
 *
 * public/modules/inspector/inspector.css is 0 and must stay 0: it is the file
 * this started with, all 55 of its literals now read tokens, and the rendered
 * result went from fourteen sizes to six with nothing below 11px.
 *
 * A stylesheet not listed here must have none at all, so a new file cannot
 * arrive with off-scale sizes unremarked.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

/** The steps public/design-system.css actually defines, as `--fs-*`. */
const SCALE = new Set(['11', '13', '15', '17', '20', '28', '40', '56', '80', '112']);

/**
 * Current off-scale literal count per stylesheet. Lower these as files are
 * converted; the test names the number to write when one drops.
 */
const BUDGET = {
  'core/modal-host.css': 2,
  'design-system.css': 5,
  'modules/admin-blog/admin-blog.css': 2,
  'modules/behavior/behavior.css': 4,
  'modules/blog/blog.css': 4,
  'modules/dialects/dialects.css': 4,
  'modules/docs/docs.css': 9,
  'modules/insights/insights.css': 7,
  'modules/library/library.css': 2,
  'modules/macros/styles.css': 4,
  'modules/nav/nav.css': 4,
  'modules/search/search.css': 6,
  'modules/stream/stream.css': 9,
  'modules/topbar/topbar.css': 1,
  'ortbtools-shell.css': 2,
  // Converted. Must stay at zero.
  'modules/inspector/inspector.css': 0,
};

function stylesheets(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) stylesheets(full, acc);
    else if (entry.name.endsWith('.css')) acc.push(full);
  }
  return acc;
}

/** Off-scale `font-size: Npx` literals, comments stripped so prose never counts. */
function offScale(file) {
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/font-size:\s*([0-9.]+)px/g)]
    .map((m) => m[1])
    .filter((px) => !SCALE.has(px));
}

const FILES = stylesheets(PUBLIC);

test('the scan finds stylesheets at all', () => {
  // A walk that silently returns nothing would pass every assertion below while
  // checking none of them.
  assert.ok(FILES.length >= 15, `expected the public stylesheets, found ${FILES.length}`);
});

test('the design system still defines the scale this budget is measured against', () => {
  const ds = fs.readFileSync(path.join(PUBLIC, 'design-system.css'), 'utf8');
  const defined = [...ds.matchAll(/--fs-[a-z0-9-]+:\s*(\d+)px/g)].map((m) => m[1]);
  for (const step of defined) {
    assert.ok(
      SCALE.has(step),
      `design-system.css defines --fs-* at ${step}px, which this test does not treat as on-scale ` +
        '— update SCALE, or the budget below is measured against the wrong ruler',
    );
  }
});

test('the inspector stays fully on the scale', () => {
  const found = offScale(path.join(PUBLIC, 'modules/inspector/inspector.css'));
  assert.deepEqual(
    found,
    [],
    `inspector.css must use --fs-* tokens only; found literals at ${[...new Set(found)].join(', ')}px`,
  );
});

test('no stylesheet exceeds its off-scale budget, and none quietly improves', () => {
  for (const file of FILES) {
    const rel = path.relative(PUBLIC, file).split(path.sep).join('/');
    const count = offScale(file).length;
    const budget = Object.hasOwn(BUDGET, rel) ? BUDGET[rel] : 0;
    assert.equal(
      count,
      budget,
      count > budget
        ? `${rel} has ${count} off-scale font-size literals, budget ${budget}. Use a --fs-* token ` +
            'rather than raising the number.'
        : `${rel} is down to ${count} off-scale literals from ${budget} — good. Set its budget to ` +
            `${count} so the ground that was won cannot be given back.`,
    );
  }
});

test('every budgeted file still exists', () => {
  // A renamed or deleted file would otherwise leave a budget entry guarding
  // nothing, and its sizes could return in the new file unnoticed.
  for (const rel of Object.keys(BUDGET)) {
    assert.ok(
      fs.existsSync(path.join(PUBLIC, rel)),
      `${rel} is budgeted but does not exist — remove the entry, or the budget guards nothing`,
    );
  }
});
