'use strict';

/**
 * Offline documentation-truth guards.
 *
 * Registry and repository availability are deliberately represented by the
 * checked-in documentation state. These tests never query npm, GitHub, or any
 * other network service, so they stay deterministic in local and CI runs.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const PACKAGE_DOCS = [
  'README.md',
  'packages/core/README.md',
  'packages/cli/README.md',
  'ARCHITECTURE.md',
];

const PACKAGE_INSTALL_COMMANDS = {
  '@ortbtools/core': [/\bnpm\s+(?:i|install)\s+@ortbtools\/core\b/i],
  '@ortbtools/cli': [
    /\bnpm\s+(?:i|install)\s+(?:-g|--global)\s+@ortbtools\/cli\b/i,
    /\bnpx\s+@ortbtools\/cli\b/i,
  ],
};

function packageRegistryStatus(runbook, packageName) {
  const statusRow = runbook.split('\n').find((line) => line.includes(`| \`${packageName}\``));
  assert.ok(statusRow, `docs/NPM_PUBLISH.md must list registry status for ${packageName}`);
  if (/\bunpublished\b/i.test(statusRow)) return 'unpublished';
  if (/\bpublished\b/i.test(statusRow)) return 'published';
  assert.fail(`${packageName} registry status must be Published or Unpublished`);
}

test('unpublished npm status forbids registry install commands in current package docs', () => {
  const runbook = read('docs/NPM_PUBLISH.md');
  const violations = [];

  for (const [packageName, patterns] of Object.entries(PACKAGE_INSTALL_COMMANDS)) {
    if (packageRegistryStatus(runbook, packageName) === 'published') continue;

    for (const relativePath of PACKAGE_DOCS) {
      const text = read(relativePath);
      for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match) violations.push(`${packageName} — ${relativePath}: ${match[0]}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `unpublished packages have executable registry install claims:\n${violations.join('\n')}`,
  );
});

test('first-publish workflow defaults the dependent CLI upload off', () => {
  const runbook = read('docs/NPM_PUBLISH.md');
  if (packageRegistryStatus(runbook, '@ortbtools/core') === 'published') return;

  const workflow = read('.github/workflows/publish-npm.yml');
  const start = workflow.indexOf('      publish_cli:');
  const end = workflow.indexOf('      dry_run:', start);
  assert.ok(start >= 0 && end > start, 'publish workflow must define publish_cli input');
  assert.match(
    workflow.slice(start, end),
    /^\s*default:\s*false\s*$/m,
    'publish_cli must default off until Core exists on the registry',
  );
});

test('live npm publishing is restricted to main', () => {
  const workflow = read('.github/workflows/publish-npm.yml');
  assert.match(
    workflow,
    /!inputs\.dry_run\s*&&\s*github\.ref\s*!=\s*'refs\/heads\/main'/,
    'publish workflow must reject live uploads from non-main refs',
  );
});

test('npm publish workflow defaults to dry-run mode', () => {
  const workflow = read('.github/workflows/publish-npm.yml');
  const start = workflow.indexOf('      dry_run:');
  const end = workflow.indexOf('\n\npermissions:', start);
  assert.ok(start >= 0 && end > start, 'publish workflow must define dry_run input');
  assert.match(
    workflow.slice(start, end),
    /^\s*default:\s*true\s*$/m,
    'manual publish must require an explicit opt-in to live upload',
  );
});

test('@ortbtools/core README describes the current server and validation contract', () => {
  const text = read('packages/core/README.md');
  const forbidden = [
    /validates entirely client-side/i,
    /3\.0\s*(?:—|–|-)\s*detection only/i,
    /\ben\b[^\n]{0,80}\bstub\b/i,
    /english[^\n]{0,160}\bstub\b/i,
    /english[^\n]{0,160}falls back to ukrainian/i,
  ];

  for (const pattern of forbidden) {
    assert.equal(
      pattern.test(text),
      false,
      `packages/core/README.md retains stale claim ${pattern}`,
    );
  }
});

const CANONICAL_REPOSITORY = 'https://github.com/vladikkrasulya/adtech-spyglass';
const RETIRED_REPOSITORY_RE = /github\.com\/vladikkrasulya\/ortbtools\b/i;
const IDENTITY_FILES = [
  'Dockerfile',
  'docs/PRIVACY.md',
  'packages/core/package.json',
  'packages/cli/package.json',
  'public/about.en.html',
  'public/about.uk.html',
  'public/about.ru.html',
  'public/index.en.html',
  'public/index.uk.html',
  'public/index.ru.html',
  'public/modules/inspector/template.en.html',
  'public/modules/inspector/template.uk.html',
  'public/modules/inspector/template.ru.html',
];

for (const relativePath of IDENTITY_FILES) {
  test(`${relativePath} uses the reachable canonical GitHub repository`, () => {
    const text = read(relativePath);
    assert.equal(
      RETIRED_REPOSITORY_RE.test(text),
      false,
      `${relativePath} points at the unavailable ortbtools repository slug`,
    );
    assert.ok(
      text.includes(CANONICAL_REPOSITORY),
      `${relativePath} must contain ${CANONICAL_REPOSITORY}`,
    );
  });
}

const CURRENT_MARKDOWN = [
  'README.md',
  'ARCHITECTURE.md',
  'ROADMAP.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/ARCHMAP.md',
  'docs/NPM_PUBLISH.md',
  'docs/OPERATIONS.md',
  'docs/PRIVACY.md',
  'docs/TESTING.md',
  'docs/USER_GUIDE.md',
  'docs/api-v1.md',
  'packages/core/README.md',
  'packages/cli/README.md',
  'public/modules/README.md',
];

function proseOnly(markdown) {
  let fence = null;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        const kind = marker[1][0];
        fence = fence === kind ? null : fence || kind;
        return '';
      }
      if (fence) return '';
      return line.replace(/`+[^`]*`+/g, '');
    })
    .join('\n');
}

function markdownTargets(markdown) {
  const targets = [];
  const patterns = [
    /!?\[[^\]]*\]\(([^)]+)\)/g,
    /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm,
    /<a\s+[^>]*href=["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(markdown))) {
      const raw = (match[1] || match[2] || '').trim();
      if (raw) targets.push(raw.replace(/^<|>$/g, '').split(/\s+["']/)[0]);
    }
  }
  return targets;
}

function headingSlug(heading) {
  return heading
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/\s+/g, '-');
}

function markdownAnchors(markdown) {
  const anchors = new Set();
  const duplicateCounts = new Map();

  for (const line of proseOnly(markdown).split('\n')) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const base = headingSlug(heading[1]);
      const duplicateCount = duplicateCounts.get(base) || 0;
      duplicateCounts.set(base, duplicateCount + 1);
      anchors.add(duplicateCount === 0 ? base : `${base}-${duplicateCount}`);
    }

    for (const explicit of line.matchAll(
      /<(?:a\s+(?:name|id)|[a-z][^>]*\sid)=["']([^"']+)["']/gi,
    )) {
      anchors.add(explicit[1]);
    }
  }
  return anchors;
}

function splitLocalTarget(rawTarget) {
  const hashIndex = rawTarget.indexOf('#');
  let filePart = hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex);
  let fragment = hashIndex === -1 ? '' : rawTarget.slice(hashIndex + 1);
  filePart = filePart.split('?')[0];
  try {
    filePart = decodeURIComponent(filePart);
    fragment = decodeURIComponent(fragment);
  } catch {
    // Keep the raw values; the existence/anchor assertion will explain the failure.
  }
  return { filePart, fragment };
}

test('current Markdown has no broken local file or heading links', () => {
  const violations = [];

  for (const relativePath of CURRENT_MARKDOWN) {
    const markdown = read(relativePath);
    for (const rawTarget of markdownTargets(proseOnly(markdown))) {
      if (
        /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(rawTarget) ||
        rawTarget.startsWith('/')
      ) {
        continue;
      }

      const { filePart, fragment } = splitLocalTarget(rawTarget);
      const sourcePath = path.join(ROOT, relativePath);
      const targetPath = filePart ? path.resolve(path.dirname(sourcePath), filePart) : sourcePath;

      if (!fs.existsSync(targetPath)) {
        violations.push(`${relativePath}: ${rawTarget} (missing target)`);
        continue;
      }

      if (fragment && path.extname(targetPath).toLowerCase() === '.md') {
        const anchors = markdownAnchors(fs.readFileSync(targetPath, 'utf8'));
        if (!anchors.has(fragment)) {
          violations.push(`${relativePath}: ${rawTarget} (missing heading anchor)`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], `broken local Markdown links:\n${violations.join('\n')}`);
});
