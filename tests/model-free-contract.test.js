'use strict';

/**
 * Model-free runtime and documentation contract.
 *
 * Historical changelogs/audits intentionally keep the old architecture. This
 * guard covers current operator, contributor, package, and public-copy surfaces
 * so a removed Ollama bridge cannot be advertised or configured again by
 * accident.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CURRENT_SURFACES = [
  '.env.example',
  '.specify/memory/constitution.md',
  'README.md',
  'CONTRIBUTING.md',
  'docs/OPERATIONS.md',
  'packages/core/knowledge-base.js',
  'packages/core/knowledge_base/README.md',
  'packages/core/rules/README.md',
  'public/account.en.html',
  'public/account.uk.html',
  'public/account.ru.html',
  'public/account.js',
  'public/about.en.html',
  'public/about.uk.html',
  'public/about.ru.html',
  'public/i18n.js',
  'public/modules/README.md',
  'public/modules/inspector/template.en.html',
  'public/modules/inspector/template.uk.html',
  'public/modules/inspector/template.ru.html',
  'public/modules/save-sample/README.md',
  'public/modules/simulate/i18n.js',
  'public/modules/simulate/README.md',
  'specs/000-platform-baseline/plan.md',
  'specs/000-platform-baseline/contracts/core-validator.md',
];

const RETIRED_CLAIMS = [
  { label: 'deleted setup guide', re: /LLM_SETUP\.md/i },
  { label: 'deleted bridge source', re: /\bintel-llm\.js\b/i },
  { label: 'retired Ollama environment', re: /\bOLLAMA_(?:URL|MODEL|TIMEOUT_MS)\b/ },
  { label: 'retired Ollama network', re: /\bollama_default\b/i },
  { label: 'local LLM product claim', re: /\blocal\s+LLM\b/i },
  { label: 'LLM bridge product claim', re: /\bLLM[- ]bridge\b/i },
];

for (const rel of CURRENT_SURFACES) {
  test(`${rel} has no retired model-integration claim`, () => {
    const source = read(rel);
    for (const { label, re } of RETIRED_CLAIMS) {
      assert.doesNotMatch(source, re, `${rel} still contains ${label}`);
    }
  });
}

test('interactive intel runtime is wired only to deterministic rules', () => {
  const compose = read('docker-compose.yml');
  const server = read('server.js');
  const handler = read('modules/intel/handler.js');

  assert.doesNotMatch(compose, /OLLAMA_|ollama_default|intel-llm/i);
  assert.match(server, /require\(['"]\.\/lib\/intel-rules['"]\)/);
  assert.match(handler, /engine:\s*["']rules["']/);
  assert.doesNotMatch(handler, /require\([^\n]*intel-llm/i);
});

test('canonical Core contract locks deterministic, network-free validation semantics', () => {
  const contract = read('specs/000-platform-baseline/contracts/core-validator.md');
  for (const required of [
    /deterministic/i,
    /stable\s+`?(?:finding\s+)?ids?`?/i,
    /findings\s+sort\s+by\s+severity[\s\S]{0,100}path\s+ascending[\s\S]{0,80}id\s+ascending/i,
    /dedup/i,
    /(?:do\s+not\s+perform|no|without)[\s\S]{0,40}(?:external\s+)?network\s+(?:calls?|requests?)/i,
    /lib\/intel-rules\.js/,
  ]) {
    assert.match(contract, required, `Core baseline lost deterministic contract ${required}`);
  }
  assert.doesNotMatch(contract, /intel-llm|OLLAMA_|ollama_default/i);
});

for (const rel of ['public/about.en.html', 'public/about.uk.html', 'public/about.ru.html']) {
  test(`${rel} names deterministic rules provenance`, () => {
    assert.match(read(rel), /lib\/intel-rules\.js/);
  });
}

test('simulator copy discloses transient server-side processing', () => {
  const copy = read('public/modules/simulate/i18n.js');
  assert.match(copy, /processed transiently by the ortbtools server/i);
  assert.match(copy, /тимчасово обробляється сервером ortbtools/i);
  assert.match(copy, /временно обрабатывается сервером ortbtools/i);
  assert.doesNotMatch(copy, /never leave the page|нікуди не передаються|никуда не передаются/i);
});
