'use strict';

/**
 * Deterministic, offline guards for the repository's Spec Kit working memory.
 *
 * The Specify CLI remains the authority for generating managed files, but CI
 * must be able to detect governance drift without installing or querying it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PINNED_VERSION = '0.16.2';
const PINNED_REVISION = '4871b485f97c7fa452ec58eba325d87536c55c34';

const SUPPORTED_INTEGRATIONS = ['claude', 'codex', 'cursor-agent', 'gemini'];
const CORE_CAPABILITIES = [
  'analyze',
  'checklist',
  'clarify',
  'constitution',
  'converge',
  'implement',
  'plan',
  'specify',
  'tasks',
  'taskstoissues',
];
const CONTEXT_BEARING_CAPABILITIES = [
  'analyze',
  'checklist',
  'clarify',
  'converge',
  'implement',
  'plan',
  'specify',
  'tasks',
];
const ASSESS_CAPABILITIES = [
  'assess.decide',
  'assess.define',
  'assess.intake',
  'assess.research',
  'assess.shape',
];
const APPROVED_CAPABILITIES = [...CORE_CAPABILITIES, ...ASSESS_CAPABILITIES].sort();

const ASSESS_ADAPTER_HASHES = {
  '.agents/skills/speckit-assess-decide/SKILL.md':
    '952943dc8fd3b25ee100ef3ff69d037728b9e75160bdc5ac935b53892234a22c',
  '.agents/skills/speckit-assess-define/SKILL.md':
    '94873b96776174fefa0c11d633b73a9ea22e3872784c7d959a18d8b0966539b5',
  '.agents/skills/speckit-assess-intake/SKILL.md':
    'e939fb50fa47a36b46eb1117f0224382db8404107a36a5b3570da2541070e6dd',
  '.agents/skills/speckit-assess-research/SKILL.md':
    '062bf21e0870c5209a465ae35b3c80085869b484b681a75c1ade0e988eda1042',
  '.agents/skills/speckit-assess-shape/SKILL.md':
    '160c19c1eaac282663db27cdc0366448344563dd28ea573aba9ab304be2406e7',
  '.claude/skills/speckit-assess-decide/SKILL.md':
    '24353a7126c5b737df5ed50b2e0b208ae3bca5513a4e4fa71dbcbc6d6e32d36f',
  '.claude/skills/speckit-assess-define/SKILL.md':
    '234eeda7535e26a0f807f2e63ebcbf3102eb886b7818e9e33e14d8a5a1790efd',
  '.claude/skills/speckit-assess-intake/SKILL.md':
    '1da23c639c7c02050794a525af12300612e7b0ca26ff36820e0bdacb88a1b59d',
  '.claude/skills/speckit-assess-research/SKILL.md':
    '8303bd714700adda9669c53d18d9cd07b8653e727be82b12020f2a40c7cf7adf',
  '.claude/skills/speckit-assess-shape/SKILL.md':
    'ee796e854b900aade6e5e159930c292b2212486d3cea7c8621884500c2023102',
  '.cursor/skills/speckit-assess-decide/SKILL.md':
    '24353a7126c5b737df5ed50b2e0b208ae3bca5513a4e4fa71dbcbc6d6e32d36f',
  '.cursor/skills/speckit-assess-define/SKILL.md':
    '234eeda7535e26a0f807f2e63ebcbf3102eb886b7818e9e33e14d8a5a1790efd',
  '.cursor/skills/speckit-assess-intake/SKILL.md':
    '1da23c639c7c02050794a525af12300612e7b0ca26ff36820e0bdacb88a1b59d',
  '.cursor/skills/speckit-assess-research/SKILL.md':
    '8303bd714700adda9669c53d18d9cd07b8653e727be82b12020f2a40c7cf7adf',
  '.cursor/skills/speckit-assess-shape/SKILL.md':
    'ee796e854b900aade6e5e159930c292b2212486d3cea7c8621884500c2023102',
  '.gemini/commands/speckit.assess.decide.toml':
    'd2ca7636ec1b2ce634d5c0af46f26c3dfa5d0c5da68dd0a9ccb05a21b5ce1752',
  '.gemini/commands/speckit.assess.define.toml':
    'd60dd0ebdf5a711c97b07a18685365ed3cbbebe27bfb49305ae9889fc2a4503d',
  '.gemini/commands/speckit.assess.intake.toml':
    '96e0614982738e62dd5d5c7938dd4146136342209fbf2fe6b058a2c2554252ee',
  '.gemini/commands/speckit.assess.research.toml':
    'ecc2eb3c4e306a673a4c6a171ab1da8f0093aff06704c607e0ed66339c96fb7f',
  '.gemini/commands/speckit.assess.shape.toml':
    '578e55cc6b6440fcb4f5085cd68ada16dce63f51f05a36afa90e71308875641a',
};

const BASELINE_CONTRACTS = [
  'content-seo.md',
  'core-validator.md',
  'data-retention.md',
  'frontend-modules.md',
  'http-api.md',
  'locales-versioning.md',
  'release-deploy.md',
];

const REQUIRED_TREE = [
  '.specify/memory/constitution.md',
  'specs/README.md',
  'specs/ROADMAP.md',
  'specs/DECISIONS.md',
  'specs/000-platform-baseline/spec.md',
  'specs/000-platform-baseline/plan.md',
  'specs/000-platform-baseline/research.md',
  'specs/000-platform-baseline/data-model.md',
  'specs/000-platform-baseline/quickstart.md',
  ...BASELINE_CONTRACTS.map((name) => `specs/000-platform-baseline/contracts/${name}`),
  'specs/001-spec-kit-foundation/spec.md',
  'specs/001-spec-kit-foundation/plan.md',
  'specs/001-spec-kit-foundation/research.md',
  'specs/001-spec-kit-foundation/data-model.md',
  'specs/001-spec-kit-foundation/quickstart.md',
  'specs/001-spec-kit-foundation/tasks.md',
  'specs/001-spec-kit-foundation/checklists/requirements.md',
  'specs/001-spec-kit-foundation/contracts/agent-integration.md',
  'specs/001-spec-kit-foundation/contracts/document-ownership.md',
  'specs/001-spec-kit-foundation/contracts/governance-validation.md',
];

const RETIRED_PATHS = [
  'CLAUDE.md',
  '.claude/agents',
  '.Jules/palette.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  '.gemini/GEMINI.md',
  'GEMINI.md',
  'ROADMAP.md',
  'ARCHITECTURE.md',
  'docs/ARCHMAP.md',
  'docs/sonnet-orchestration-plan.md',
  'docs/TESTING.md',
];

const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));
const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));

function sha256(relativePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, relativePath)))
    .digest('hex');
}

/**
 * @param {string} relativeDir
 * @param {(relativePath: string) => boolean} [predicate]
 */
function walk(relativeDir, predicate = () => true) {
  const root = path.join(ROOT, relativeDir);
  if (!fs.existsSync(root)) return [];
  const files = [];
  const skippedRoots = new Set(['.git', 'coverage', 'node_modules']);

  (function visit(absoluteDir) {
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolutePath = path.join(absoluteDir, entry.name);
      const relativePath = path.relative(ROOT, absolutePath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!skippedRoots.has(relativePath.split('/')[0])) visit(absolutePath);
      } else {
        if (predicate(relativePath)) files.push(relativePath);
      }
    }
  })(root);

  return files.sort();
}

function authoredProse(markdown) {
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

function capabilityFromPath(integration, relativePath) {
  const name = path.basename(relativePath, path.extname(relativePath));
  if (integration === 'gemini') return name.replace(/^speckit\./, '');
  return path
    .basename(path.dirname(relativePath))
    .replace(/^speckit-/, '')
    .replace(/-/g, '.');
}

function adapterPath(integration, capability) {
  if (integration === 'gemini') return `.gemini/commands/speckit.${capability}.toml`;
  const roots = {
    claude: '.claude/skills',
    codex: '.agents/skills',
    'cursor-agent': '.cursor/skills',
  };
  return `${roots[integration]}/speckit-${capability.replace(/\./g, '-')}/SKILL.md`;
}

function adapterFiles(integration) {
  const roots = {
    claude: '.claude/skills',
    codex: '.agents/skills',
    'cursor-agent': '.cursor/skills',
    gemini: '.gemini/commands',
  };
  return walk(roots[integration]);
}

test('canonical Spec Kit memory tree has exactly named owners for every live concern', () => {
  const missing = REQUIRED_TREE.filter((relativePath) => !exists(relativePath));
  assert.deepEqual(missing, [], `canonical Spec Kit paths are missing:\n${missing.join('\n')}`);

  const index = read('specs/README.md');
  for (const target of [
    '.specify/memory/constitution.md',
    '000-platform-baseline',
    'ROADMAP.md',
    'DECISIONS.md',
    '001-spec-kit-foundation',
    'docs/PRIVACY.md',
    'SECURITY.md',
    'docs/OPERATIONS.md',
  ]) {
    assert.ok(index.includes(target), `specs/README.md must route readers to ${target}`);
  }

  for (const entryPoint of ['README.md', 'CONTRIBUTING.md']) {
    const source = read(entryPoint);
    assert.match(source, /specs\/README\.md/, `${entryPoint} must link to the memory index`);
    assert.match(
      source,
      /\.specify\/memory\/constitution\.md/,
      `${entryPoint} must link to the sole normative constitution`,
    );
  }
});

test('managed Spec Kit manifests are hash-clean and generated shell scripts stay executable', () => {
  for (const integration of [...SUPPORTED_INTEGRATIONS, 'speckit']) {
    const manifestPath = `.specify/integrations/${integration}.manifest.json`;
    const manifest = readJson(manifestPath);
    assert.equal(manifest.integration, integration, `${manifestPath} identity drifted`);
    assert.equal(manifest.version, PINNED_VERSION, `${manifestPath} version drifted`);

    for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
      assert.ok(exists(relativePath), `${manifestPath} manages missing file ${relativePath}`);
      assert.equal(
        sha256(relativePath),
        expectedHash,
        `${relativePath} was hand-edited or corrupted`,
      );
    }
  }

  for (const relativePath of walk('.specify/scripts/bash', (file) => file.endsWith('.sh'))) {
    const mode = fs.statSync(path.join(ROOT, relativePath)).mode;
    assert.notEqual(mode & 0o111, 0, `${relativePath} must remain executable`);
  }
});

test('all four integrations expose one identical, approved capability set with Codex default', () => {
  const state = readJson('.specify/integration.json');
  assert.deepEqual(
    [...state.installed_integrations].sort(),
    SUPPORTED_INTEGRATIONS,
    'installed integration set drifted',
  );
  assert.deepEqual(
    Object.keys(state.integration_settings).sort(),
    SUPPORTED_INTEGRATIONS,
    'integration settings must cover exactly the supported set',
  );
  assert.equal(state.integration, 'codex', 'active integration must return to Codex');
  assert.equal(state.default_integration, 'codex', 'Codex must be the default integration');
  assert.equal(state.integration_settings.codex.parsed_options.skills, true);

  for (const integration of SUPPORTED_INTEGRATIONS) {
    const files = adapterFiles(integration);
    const expectedFiles = APPROVED_CAPABILITIES.map((capability) =>
      adapterPath(integration, capability),
    ).sort();
    assert.deepEqual(
      files,
      expectedFiles,
      `${integration} adapter root contains unapproved or missing files`,
    );
    const capabilities = files
      .map((relativePath) => capabilityFromPath(integration, relativePath))
      .sort();
    assert.deepEqual(
      capabilities,
      APPROVED_CAPABILITIES,
      `${integration} adapter capability set drifted`,
    );
    for (const capability of CONTEXT_BEARING_CAPABILITIES) {
      const relativePath = adapterPath(integration, capability);
      assert.match(
        read(relativePath),
        /\.specify\/memory\/constitution\.md/,
        `${relativePath} must load the canonical constitution before delivery`,
      );
    }
  }
});

test('.gitignore tracks only reviewed adapter subtrees under agent-local roots', () => {
  const rules = new Set(read('.gitignore').split('\n'));
  const adapterRules = [
    '.agents/*',
    '!.agents/skills/',
    '.agents/skills/*',
    '!.agents/skills/speckit-*/',
    '.agents/skills/speckit-*/*',
    '!.agents/skills/speckit-*/SKILL.md',
    '.codex/',
    '.claude/*',
    '!.claude/skills/',
    '.claude/skills/*',
    '!.claude/skills/speckit-*/',
    '.claude/skills/speckit-*/*',
    '!.claude/skills/speckit-*/SKILL.md',
    '.cursor/*',
    '!.cursor/skills/',
    '.cursor/skills/*',
    '!.cursor/skills/speckit-*/',
    '.cursor/skills/speckit-*/*',
    '!.cursor/skills/speckit-*/SKILL.md',
    '.gemini/*',
    '!.gemini/commands/',
    '.gemini/commands/*',
    '!.gemini/commands/speckit.*.toml',
  ];
  for (const rule of adapterRules) {
    assert.ok(rules.has(rule), `.gitignore must preserve adapter security rule ${rule}`);
  }
});

test('assess is the only installed extension and has parity across all integrations', () => {
  const config = read('.specify/extensions.yml');
  const installedBlock = config.match(/^installed:\s*\n((?:^\s*-\s+.*(?:\n|$))*)/m);
  assert.ok(installedBlock, '.specify/extensions.yml must declare installed extensions');
  const installed = [...installedBlock[1].matchAll(/^\s*-\s+([^\s#]+)\s*$/gm)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(installed, ['assess'], 'only the reviewed bundled assess extension is allowed');
  assert.match(config, /^hooks:\s*\{\}\s*$/m, 'automatic lifecycle hooks must remain empty');

  const registry = readJson('.specify/extensions/.registry');
  assert.deepEqual(Object.keys(registry.extensions), ['assess']);
  const assess = registry.extensions.assess;
  assert.equal(assess.enabled, true);
  assert.equal(assess.source, 'local');
  assert.equal(
    assess.manifest_hash,
    `sha256:${sha256('.specify/extensions/assess/extension.yml')}`,
    'assess extension manifest hash drifted',
  );

  for (const [relativePath, expectedHash] of Object.entries(ASSESS_ADAPTER_HASHES)) {
    assert.equal(
      sha256(relativePath),
      expectedHash,
      `${relativePath} drifted from the reviewed rendered extension adapter`,
    );
  }

  for (const integration of SUPPORTED_INTEGRATIONS) {
    assert.deepEqual(
      [...assess.registered_commands[integration]].sort(),
      ASSESS_CAPABILITIES.map((name) => `speckit.${name}`).sort(),
      `${integration} assessment commands drifted`,
    );
  }

  const workflowRegistry = readJson('.specify/workflows/workflow-registry.json');
  assert.deepEqual(
    Object.keys(workflowRegistry.workflows),
    ['speckit'],
    'only the pinned bundled workflow compatibility artifact is allowed',
  );
  assert.equal(
    workflowRegistry.workflows.speckit.source,
    'bundled',
    'the registered workflow must come from the pinned Spec Kit release',
  );

  const automationSurfaces = [
    'package.json',
    ...walk('.github/workflows', (relativePath) => /\.ya?ml$/.test(relativePath)),
    ...walk('.githooks', () => true),
    ...walk('scripts', () => true),
  ].filter(exists);

  for (const workflow of automationSurfaces) {
    assert.doesNotMatch(
      read(workflow),
      /specify\s+workflow\s+run|(?:^|[\s/])speckit[-.]implement(?:\s|$)/im,
      `${workflow} must not dispatch an unattended agent implementation workflow`,
    );
  }
});

test('legacy rulebooks, duplicate live owners, and stale specialist prompts stay retired', () => {
  const returned = RETIRED_PATHS.filter(exists);
  const agentRulebooks = walk(
    '.',
    (relativePath) => path.basename(relativePath) === 'AGENTS.md',
  ).filter(
    (relativePath) =>
      !relativePath.startsWith('node_modules/') &&
      !relativePath.startsWith('.git/') &&
      !relativePath.startsWith('coverage/'),
  );

  assert.deepEqual(
    [...returned, ...agentRulebooks],
    [],
    'parallel rulebooks or duplicate document owners returned',
  );
});

test('live authored memory contains no unresolved template or clarification placeholders', () => {
  const authored = [
    '.specify/memory/constitution.md',
    ...walk('specs', (relativePath) => relativePath.endsWith('.md')),
  ];
  const placeholder =
    /\[(?:NEEDS CLARIFICATION(?::[^\]]*)?|PROJECT_NAME|FEATURE_NAME|FEATURE_BRANCH|DATE|VERSION|PRINCIPLE_[A-Z0-9_]+)\]|\{\{[^}\n]+\}\}|<(?:INSERT|REPLACE|PROJECT|FEATURE|TODO)[^>\n]*>|\$ARGUMENTS\b|\b(?:TBD|FIXME|TODO)\b/i;
  const violations = [];

  for (const relativePath of authored) {
    const prose = authoredProse(read(relativePath));
    const match = placeholder.exec(prose);
    if (match) violations.push(`${relativePath}: ${match[0]}`);
  }

  assert.deepEqual(
    violations,
    [],
    `live authored memory has unresolved placeholders:\n${violations.join('\n')}`,
  );
});

test('active feature packages have valid statuses, complete artifacts, unique IDs, and task coverage', () => {
  const featureDirs = fs
    .readdirSync(path.join(ROOT, 'specs'), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && /^\d{3}-/.test(entry.name) && entry.name !== '000-platform-baseline',
    )
    .map((entry) => entry.name)
    .sort();
  assert.ok(featureDirs.length > 0, 'at least one governed feature package must exist');

  const roadmap = read('specs/ROADMAP.md');
  const allowedStatuses = new Set([
    'Draft',
    'Ready',
    'In Progress',
    'Verification',
    'Complete',
    'Blocked',
    'Superseded',
  ]);

  for (const featureDir of featureDirs) {
    const prefix = `specs/${featureDir}`;
    const spec = read(`${prefix}/spec.md`);
    const statusMatch = spec.match(/^\*\*Status\*\*:\s*(.+?)\s*$/m);
    assert.ok(statusMatch, `${prefix}/spec.md must declare **Status**`);
    const status = statusMatch[1];
    assert.ok(allowedStatuses.has(status), `${prefix}/spec.md has unsupported status ${status}`);

    if (!['Draft', 'Blocked', 'Superseded'].includes(status)) {
      for (const required of ['plan.md', 'tasks.md']) {
        assert.ok(
          exists(`${prefix}/${required}`),
          `${status} feature ${featureDir} is missing ${required}`,
        );
      }
      const checklists = walk(`${prefix}/checklists`, (relativePath) =>
        relativePath.endsWith('.md'),
      );
      assert.ok(checklists.length > 0, `${status} feature ${featureDir} requires a checklist`);
    }

    if (!['Complete', 'Superseded'].includes(status)) {
      const escapedFeatureDir = featureDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(
        roadmap,
        new RegExp(`\\]\\((?:\\./)?${escapedFeatureDir}/(?:spec\\.md)?(?:#[^)]*)?\\)`),
        `${featureDir} must have one current owner link in specs/ROADMAP.md`,
      );
    }

    const requirementDefinitions = [...spec.matchAll(/^- \*\*((?:FR|SC)-\d{3})\*\*:/gm)].map(
      (match) => match[1],
    );
    assert.equal(
      new Set(requirementDefinitions).size,
      requirementDefinitions.length,
      `${prefix}/spec.md repeats an FR/SC identifier`,
    );
    assert.ok(
      requirementDefinitions.some((id) => id.startsWith('FR-')),
      `${prefix}/spec.md must define functional requirements`,
    );
    assert.ok(
      requirementDefinitions.some((id) => id.startsWith('SC-')),
      `${prefix}/spec.md must define success criteria`,
    );

    const storyIds = [...spec.matchAll(/^### User Story (\d+)\b/gm)].map(
      (match) => `US${match[1]}`,
    );

    if (!['Draft', 'Blocked', 'Superseded'].includes(status)) {
      for (const checklist of walk(`${prefix}/checklists`, (relativePath) =>
        relativePath.endsWith('.md'),
      )) {
        const checklistSource = read(checklist);
        assert.match(checklistSource, /^- \[[ xX]\]/m, `${checklist} must contain checks`);
        assert.doesNotMatch(
          checklistSource,
          /^- \[ \]/m,
          `${status} feature ${featureDir} has an incomplete checklist`,
        );
      }
    }

    if (exists(`${prefix}/tasks.md`)) {
      const tasks = read(`${prefix}/tasks.md`);
      const checkboxLines = tasks.split('\n').filter((line) => /^- \[[ xX]\]/.test(line));
      const taskLines = checkboxLines.filter((line) => /^- \[[ xX]\] T/.test(line));
      assert.equal(
        taskLines.length,
        checkboxLines.length,
        `${prefix}/tasks.md contains a checkbox that is not a task`,
      );

      const taskPattern = /^- \[[ xX]\] (T\d{3})(?: \[P\])?(?: \[US\d+\])? \S.+$/;
      const taskIds = [];
      for (const line of taskLines) {
        const match = line.match(taskPattern);
        assert.ok(match, `${prefix}/tasks.md has malformed task: ${line}`);
        taskIds.push(match[1]);
        const story = line.match(/\[(US\d+)\]/)?.[1];
        if (story) {
          assert.ok(storyIds.includes(story), `${prefix}/tasks.md references unknown ${story}`);
        }
      }
      assert.equal(new Set(taskIds).size, taskIds.length, `${prefix}/tasks.md repeats a task ID`);
      assert.deepEqual(
        taskIds,
        taskIds.map((_, index) => `T${String(index + 1).padStart(3, '0')}`),
        `${prefix}/tasks.md task IDs must be ordered and gap-free`,
      );

      for (const requirement of requirementDefinitions.filter((id) => id.startsWith('FR-'))) {
        assert.match(
          tasks,
          new RegExp(`\\b${requirement}\\b`),
          `${requirement} has no task coverage`,
        );
      }

      if (status === 'Complete') {
        assert.doesNotMatch(tasks, /^- \[ \] T\d{3}/m, `${featureDir} is Complete with open tasks`);
      }
    }
  }
});

test('decision records are indexed, structurally complete, unique, and sequential', () => {
  const decisions = walk('specs/decisions', (relativePath) =>
    /\/ADR-\d{3}-.+\.md$/.test(relativePath),
  );
  assert.ok(decisions.length > 0, 'specs/decisions must contain accepted ADRs');

  const index = read('specs/DECISIONS.md');
  const ids = [];
  for (const relativePath of decisions) {
    const id = path.basename(relativePath).match(/^(ADR-\d{3})-/)[1];
    ids.push(id);
    assert.ok(
      index.includes(path.basename(relativePath)),
      `${id} is not linked from specs/DECISIONS.md`,
    );

    const source = read(relativePath);
    for (const field of ['Status', 'Date']) {
      assert.match(
        source,
        new RegExp(`^(?:#{1,3} |\\*\\*)${field}(?:\\*\\*)?(?::|\\b)`, 'm'),
        `${relativePath} is missing ${field}`,
      );
    }
    for (const heading of ['Context', 'Decision', 'Alternatives', 'Consequences', 'Related']) {
      assert.match(
        source,
        new RegExp(`^#{1,3} ${heading}\\b`, 'm'),
        `${relativePath} is missing ${heading}`,
      );
    }
  }

  assert.equal(new Set(ids).size, ids.length, 'ADR identifiers must be unique');
  assert.deepEqual(
    ids,
    ids.map((_, index) => `ADR-${String(index + 1).padStart(3, '0')}`),
    'ADR identifiers must be sequential',
  );
});

test('Spec Kit release, source revision, and non-destructive upgrade sequence are pinned offline', () => {
  const initOptions = readJson('.specify/init-options.json');
  const integration = readJson('.specify/integration.json');
  assert.equal(initOptions.speckit_version, PINNED_VERSION);
  assert.equal(integration.version, PINNED_VERSION);

  for (const relativePath of [
    'specs/001-spec-kit-foundation/plan.md',
    'specs/001-spec-kit-foundation/research.md',
  ]) {
    const source = read(relativePath);
    assert.match(source, /(?:tag\s+)?`?v0\.16\.2`?/i, `${relativePath} must name the pinned tag`);
    assert.ok(
      source.includes(PINNED_REVISION),
      `${relativePath} must name the pinned source commit`,
    );
  }

  const upgrade = read('specs/001-spec-kit-foundation/contracts/agent-integration.md');
  for (const required of [
    /specify self check/i,
    /target release/i,
    /temporary Git fixture/i,
    /preserving authored memory/i,
    /return Codex as default/i,
    /governance tests/i,
  ]) {
    assert.match(upgrade, required, `upgrade contract lost required step ${required}`);
  }

  const quickstart = read('specs/001-spec-kit-foundation/quickstart.md');
  assert.match(
    quickstart,
    /SPECIFY_FEATURE_DIRECTORY=specs\/001-spec-kit-foundation[\s\S]{0,240}check-prerequisites\.sh/,
    'clean checkouts need an explicit active-feature seed before prerequisite resolution',
  );
  assert.match(quickstart, /feature\.json/, 'quickstart must explain the local feature pointer');
  assert.match(
    quickstart,
    /(?:never\s+commit|must\s+not\s+be\s+committed|worktree-local|machine-local|gitignored)/i,
    'quickstart must state that feature.json is local state, never tracked project intent',
  );
  assert.match(
    read('.specify/.gitignore'),
    /^feature\.json\s*$/m,
    '.specify/feature.json must remain gitignored',
  );
});
