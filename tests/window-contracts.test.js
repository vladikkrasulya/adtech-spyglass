'use strict';
/**
 * tests/window-contracts.test.js
 *
 * Guards the cross-module window.* contract between:
 *   - ES-module provider: spyglass.app.js (mountInspector exposes globals on window)
 *   - IIFE consumers: share/index.js, embed/index.js, export.js, shortcuts/index.js,
 *     behavior/index.js — classic scripts that can't import ES modules directly.
 *
 * Two assertions:
 *
 * 1. PROVIDER COMPLETENESS — every `typeof window.X === 'function'` guard in an
 *    IIFE consumer has a matching `window.X =` assignment somewhere in the
 *    public/ tree (including IIFE self-providers like share.js or the plain
 *    i18n.js global). If X is checked but never assigned, a future refactor
 *    will silently break user-visible feedback — exactly the v0.48.0 regression
 *    where window.toast was consumed but never exposed.
 *
 * 2. CLEANUP PARITY — every `window.X =` assignment inside mountInspector()
 *    appears in the cleanup `exposed[]` array (so it gets deleted on unmount).
 *    Missing entries cause stale globals to persist across module switches.
 *
 * When you add a new IIFE script that reads window globals, add it to
 * IIFE_CONSUMERS below. When you add a new window.X assignment to mountInspector
 * that is NOT in the cleanup list intentionally, add X to CLEANUP_SKIP.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── Config ────────────────────────────────────────────────────────────────────

// IIFE scripts that consume window globals from other modules.
// These files cannot use ES `import` so they rely on window.* being set.
const IIFE_CONSUMERS = [
  'public/export.js',
  'public/modules/share/index.js',
  'public/modules/embed/index.js',
  'public/modules/shortcuts/index.js',
  'public/modules/behavior/index.js',
];

// window.X = assignments in mountInspector that are intentionally NOT in
// exposed[] (e.g. __spyglassBehavior is reset on each probe start, not
// set once at mount — so it doesn't belong in the cleanup sweep).
const CLEANUP_SKIP = new Set([
  // Set during probe lifecycle, not at mount-time:
  '__spyglassBehavior',
  // Set by lazy modules and managed by the module loader, not this sweep:
  'SpyglassIntelBuilder',
  'SpyglassSession',
  'getJsonAtPath',
  'setTabStatus',
  'humanStatus',
  'refreshPartners',
  'getPartners',
  'refreshSamples',
  'paintFooterDialect',
  'injectCorpusBar',
  'renderBehaviorTab',
  'updateCharCount',
  'snapshotPendingHistoryMerge',
  'lazyOpenAuth',
  '__spyglassRecoveryClosed',
  'requestVerifyEmail',
  'openAuthModal',
  'doLogin',
  'doRegister',
  'signOut',
  'openSaveModal',
  'confirmSave',
  'editSample',
  'confirmEdit',
  'openPartnerModal',
  'confirmAddPartner',
  'deletePartner',
  '_vendorRef',
  '__spyglassLast',
  'clearHistory',
  'historyStore',
  'closeModal',
  'toggleSidebar',
  'resetLayout',
  'handleKeydown',
  'switchTab',
  'clearInput',
  'utils',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Walk public/ and return all .js files (sync, no glob dep needed). */
function walkJs(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJs(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract all `window.X =` assignments (excluding `===`, `!==`, `==`).
 * Returns a Set of names.
 */
function extractAssignments(src) {
  const names = new Set();
  // =(?!=) means: `=` not followed by another `=` — excludes == and ===
  for (const m of src.matchAll(/window\.(\w+)\s*=(?!=)/g)) {
    names.add(m[1]);
  }
  return names;
}

/**
 * Extract names from `typeof window.X === 'function'` guards.
 * This is the most explicit "I need this Spyglass global" pattern.
 */
function extractTypeofGuards(src) {
  const names = new Set();
  for (const m of src.matchAll(/typeof\s+window\.(\w+)\s*===?\s*['"]function['"]/g)) {
    names.add(m[1]);
  }
  // Also catch: `window.X && window.X(` — require trailing `(` to avoid matching
  // non-function property checks like `if (window.config && window.config)`.
  for (const m of src.matchAll(/window\.(\w+)\s*&&\s*(?:typeof\s+)?window\.\1\s*\(/g)) {
    names.add(m[1]);
  }
  return names;
}

/**
 * Extract the `exposed[]` cleanup array names from spyglass.app.js.
 * Matches: const exposed = [ ... ];
 */
function extractExposedArray(src) {
  const m = src.match(/const exposed = \[([\s\S]+?)\];/);
  if (!m) return new Set();
  const names = new Set();
  for (const nm of m[1].matchAll(/'(\w+)'/g)) {
    names.add(nm[1]);
  }
  return names;
}

/**
 * Extract `window.X =` assignments that appear INSIDE the mountInspector
 * function body (between `export async function mountInspector` and the
 * closing `}` of the ctx.addCleanup block — we use a heuristic: everything
 * before the cleanup sweep).
 */
function extractMountAssignments(src) {
  // Find the function boundary
  const start = src.indexOf('export async function mountInspector');
  if (start === -1) return new Set();
  // Everything from the function start to end of file (cleanup is inside)
  const body = src.slice(start);
  return extractAssignments(body);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('every window.X guard in an IIFE consumer has a provider in public/', () => {
  // Build the full provider set from all .js files under public/
  const publicDir = path.join(ROOT, 'public');
  const allJsFiles = walkJs(publicDir);
  const allProviders = new Set();
  for (const f of allJsFiles) {
    const src = fs.readFileSync(f, 'utf8');
    for (const name of extractAssignments(src)) {
      allProviders.add(name);
    }
  }

  const issues = [];

  for (const rel of IIFE_CONSUMERS) {
    const src = read(rel);
    const needed = extractTypeofGuards(src);
    for (const name of needed) {
      if (!allProviders.has(name)) {
        issues.push(
          `${rel} guards typeof window.${name} === 'function' but no window.${name} = assignment found anywhere in public/`,
        );
      }
    }
  }

  assert.deepEqual(
    issues,
    [],
    `Cross-module window.* contract violations detected:\n\n${issues.join('\n')}\n\n` +
      `Add the missing window.X = assignment in the appropriate provider, or ` +
      `move the provider registration to the correct module.`,
  );
});

test('every window.X = in mountInspector is listed in the cleanup exposed[] array', () => {
  const src = read('public/spyglass.app.js');
  const assigned = extractMountAssignments(src);
  const exposed = extractExposedArray(src);

  const missing = [];
  for (const name of assigned) {
    if (!exposed.has(name) && !CLEANUP_SKIP.has(name)) {
      missing.push(`window.${name} = … is assigned in mountInspector but missing from exposed[]`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Cleanup parity violations — these window globals will leak past module deactivate:\n\n` +
      `${missing.join('\n')}\n\n` +
      `Either add the name to the exposed[] array in spyglass.app.js, ` +
      `or add it to CLEANUP_SKIP in this test file if the omission is intentional.`,
  );
});

test('exposed[] array has no phantom entries (every listed name is assigned somewhere in public/)', () => {
  const appSrc = read('public/spyglass.app.js');
  const exposed = extractExposedArray(appSrc);

  // Build provider set from ALL .js files in public/ (lazy modules, IIFE scripts, ES modules).
  // exposed[] legitimately contains globals set by lazy modules (auth/index.js, save-sample/index.js,
  // mirror/index.js, etc.) so we can't restrict the search to mountInspector alone.
  const publicDir = path.join(ROOT, 'public');
  const allProviders = new Set();
  for (const f of walkJs(publicDir)) {
    for (const name of extractAssignments(fs.readFileSync(f, 'utf8'))) {
      allProviders.add(name);
    }
  }

  const phantoms = [];
  for (const name of exposed) {
    if (!allProviders.has(name)) {
      phantoms.push(
        `'${name}' is in exposed[] cleanup list but no window.${name} = found anywhere in public/`,
      );
    }
  }

  assert.deepEqual(
    phantoms,
    [],
    `Phantom cleanup entries (stale names that are never set anywhere in public/):\n\n` +
      `${phantoms.join('\n')}\n\n` +
      `Remove them from exposed[] or find where window.${'{name}'} = should be set.`,
  );
});
