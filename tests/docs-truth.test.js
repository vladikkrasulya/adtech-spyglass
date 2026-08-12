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
  'specs/000-platform-baseline/spec.md',
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

test('Sentry health copy reports local SDK configuration, not upstream delivery', () => {
  const requiredSurfaces = [
    '.env.example',
    'docs/OPERATIONS.md',
    'specs/000-platform-baseline/plan.md',
    'specs/000-platform-baseline/contracts/http-api.md',
    'specs/000-platform-baseline/contracts/release-deploy.md',
    'specs/002-dependency-sentry-refresh/contracts/sentry-health.md',
  ];

  for (const relativePath of requiredSurfaces) {
    const text = read(relativePath);
    assert.match(
      text,
      /(?:(?:local|locally)[\s\S]{0,180}(?:configur|parsed|SDK)|(?:configur|parsed|SDK)[\s\S]{0,180}(?:local|locally))/i,
      `${relativePath} must state the local SDK/configuration boundary`,
    );
    assert.match(
      text,
      /(?:does not|not a|never)[\s\S]{0,180}(?:reachability|connectivity|ingestion|delivery)/i,
      `${relativePath} must reject an upstream availability/delivery claim`,
    );
  }

  const http = read('specs/000-platform-baseline/contracts/http-api.md');
  assert.match(http, /`sentry:\s*\{ ready:\s*boolean \}`/);
  assert.match(http, /Database health[^.]+HTTP `200`\/`503` status/i);

  const release = read('specs/000-platform-baseline/contracts/release-deploy.md');
  assert.match(release, /`sentry\.ready`[^.]+not a\s+deployment gate/i);

  const logger = read('lib/logger.js');
  assert.doesNotMatch(logger, /\/srv\/DATA\/Stacks\/glitchtip|no SaaS dependency/i);
  assert.match(logger, /does NOT[\s\S]{0,100}(?:upstream|delivery)/);
});

test('content and security contracts own the closed Blog-body fragment boundary', () => {
  const contract = read('specs/000-platform-baseline/contracts/content-seo.md');
  const security = read('SECURITY.md');
  const adr = read('specs/decisions/ADR-011-browser-markdown-sanitization.md');

  for (const [relativePath, text] of [
    ['content contract', contract],
    ['SECURITY.md', security],
    ['ADR-011', adr],
  ]) {
    assert.match(
      text,
      /every (?:public )?(?:browser-rendered )?Blog body[\s\S]{0,180}(?:untrusted|regardless of `source`)/i,
      `${relativePath} must state the source-neutral untrusted-body invariant`,
    );
    assert.match(
      text,
      /DOMPurify[\s\S]{0,180}(?:DocumentFragment|fragment)/i,
      `${relativePath} must state the sanitizer-to-fragment boundary`,
    );
  }

  assert.match(contract, /token-gated admin `promote` action/i);
  assert.match(contract, /Raw HTML remains visible as literal text/i);
  assert.match(
    contract,
    /Source-URL scheme parity outside[\s\S]{0,240}remain separately assessed/i,
  );
  assert.doesNotMatch(contract, /full, unsanitized Marked|trusted-editorial assumption/i);
  assert.doesNotMatch(contract, /runtime hardening requires a separate assessed feature/i);
});

test('deployment truth separates the operator backup gate and records the live v1.6.1 release', () => {
  const release = read('specs/000-platform-baseline/contracts/release-deploy.md');
  const operations = read('docs/OPERATIONS.md');
  const roadmap = read('specs/ROADMAP.md');
  const deploy = read('scripts/deploy.sh');
  const rollback = read('scripts/rollback.sh');

  assert.match(
    release,
    /Backup readiness is a separate operator gate and is not created or validated by `deploy\.sh`/i,
    'release contract must not claim that deploy.sh creates or validates the backup gate',
  );
  assert.match(
    operations,
    /sudo -n \/srv\/DATA\/Stacks\/ortbtools\/scripts\/backup-db\.sh/,
    'root-owned backup archives require the documented sudo-capable command',
  );
  assert.match(
    operations,
    /`deploy\.sh`[^.]{0,180}(?:does not|doesn't)[^.]{0,100}(?:create|validate|verify)[^.]{0,80}backup/i,
    'operations must state that the deploy script does not enforce the backup gate',
  );

  assert.doesNotMatch(deploy, /records intent \(STATUS=DEPLOYING\)/);
  assert.match(deploy, /records intent \(STATUS=CANDIDATE_STARTING\)/);
  assert.doesNotMatch(deploy, /Never touches \/data SQLite or\s*# persistent content/);
  assert.match(deploy, /seeds only missing persistent content/i);
  assert.doesNotMatch(deploy, /docker-compose\.yml `restart: 'no'`/);
  assert.match(deploy, /deploy-transition override[\s\S]{0,100}`restart: 'no'`/i);
  assert.doesNotMatch(rollback, /docker-compose\.yml default is 'no'/);
  assert.match(rollback, /deploy-transition override[\s\S]{0,100}restart policy[\s\S]{0,100}'no'/i);
  assert.doesNotMatch(release, /Rollback does not alter Git or `\/data`/);
  assert.match(release, /write transition state under `\/data`/i);
  assert.match(operations, /write `deploy-state\.env` under `\/data`/i);

  assert.match(roadmap, /`v1\.6\.1`/);
  assert.match(roadmap, /`d6c873d`/);
  assert.match(roadmap, /PR #59/);
  assert.doesNotMatch(
    roadmap,
    /Harden the browser Markdown trust boundary[^\n]+not committed or deployed/i,
  );
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

const RETAINED_CURRENT_MARKDOWN = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/NPM_PUBLISH.md',
  'docs/OPERATIONS.md',
  'docs/PRIVACY.md',
  'docs/USER_GUIDE.md',
  'docs/api-v1.md',
  'packages/core/README.md',
  'packages/cli/README.md',
  'public/modules/README.md',
];

function collectMarkdown(relativeDir) {
  const files = [];
  const absoluteRoot = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absoluteRoot)) return files;

  (function walk(absoluteDir) {
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) walk(absolutePath);
      else if (entry.name.endsWith('.md')) {
        files.push(path.relative(ROOT, absolutePath).split(path.sep).join('/'));
      }
    }
  })(absoluteRoot);

  return files.sort();
}

const CURRENT_MARKDOWN = [
  ...RETAINED_CURRENT_MARKDOWN,
  '.specify/memory/constitution.md',
  ...collectMarkdown('specs'),
];

const HISTORICAL_MARKDOWN = collectMarkdown('docs').filter(
  (relativePath) => !RETAINED_CURRENT_MARKDOWN.includes(relativePath),
);

test('active Markdown registry uses canonical Spec Kit owners, not retired mirrors', () => {
  for (const required of [
    '.specify/memory/constitution.md',
    'specs/README.md',
    'specs/ROADMAP.md',
    'specs/DECISIONS.md',
    'specs/000-platform-baseline/spec.md',
    'specs/001-spec-kit-foundation/spec.md',
  ]) {
    assert.ok(CURRENT_MARKDOWN.includes(required), `active Markdown scan must include ${required}`);
  }

  for (const retired of [
    'CLAUDE.md',
    'ROADMAP.md',
    'ARCHITECTURE.md',
    'docs/ARCHMAP.md',
    'docs/TESTING.md',
  ]) {
    assert.equal(
      CURRENT_MARKDOWN.includes(retired),
      false,
      `${retired} is a retired document owner`,
    );
  }
});

test('dated reports excluded from current truth are explicitly historical and route to current owners', () => {
  assert.ok(HISTORICAL_MARKDOWN.length > 0, 'expected dated historical documents');
  for (const relativePath of HISTORICAL_MARKDOWN) {
    const text = read(relativePath);
    assert.match(
      text,
      /\*\*(?:Historical snapshot|SUPERSEDED)\b/i,
      `${relativePath} must identify itself as historical or superseded`,
    );
    assert.match(
      text,
      /specs\/000-platform-baseline\/plan\.md/,
      `${relativePath} must route current behavior to the platform baseline`,
    );
    assert.match(
      text,
      /specs\/ROADMAP\.md/,
      `${relativePath} must route active work to the Spec Kit roadmap`,
    );
  }
});

test('active Ukrainian documentation consistently uses “вразливість”', () => {
  const violations = [];
  for (const relativePath of CURRENT_MARKDOWN) {
    const match = /(?<!\p{L})[Уу]разлив\p{L}*/u.exec(read(relativePath));
    if (match) violations.push(`${relativePath}: ${match[0]}`);
  }
  assert.deepEqual(
    violations,
    [],
    `active Markdown contains the rejected “уразлив-” form:\n${violations.join('\n')}`,
  );
  assert.match(
    read('specs/000-platform-baseline/contracts/locales-versioning.md'),
    /(?<!\p{L})вразливість(?!\p{L})/iu,
    'the locale contract must pin the preferred Ukrainian term “вразливість”',
  );
});

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
