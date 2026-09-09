'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const INVENTORY = path.join(ROOT, 'specs/032-close-cleanup-inventory/capability-coverage.md');

function assertionNames(source) {
  const names = new Set();
  const file = ts.createSourceFile(
    'assertions.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const call = node.expression;
      const isTest =
        (ts.isIdentifier(call) && call.text === 'test') ||
        (ts.isPropertyAccessExpression(call) &&
          ts.isIdentifier(call.expression) &&
          call.expression.text === 't' &&
          call.name.text === 'test');
      const name = node.arguments[0];
      if (isTest && name && (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)))
        names.add(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

function problemsFor(rows, read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')) {
  if (!Array.isArray(rows) || !rows.length) return ['inventory must have records'];
  const problems = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      problems.push('invalid record');
      continue;
    }
    for (const key of ['id', 'capability', 'scenario', 'scope', 'limits']) {
      if (typeof row[key] !== 'string' || !row[key].trim())
        problems.push(`${key}: nonempty text required`);
    }
    if (seen.has(row.id)) problems.push(`duplicate scenario: ${row.id}`);
    seen.add(row.id);
    if (!['unit-only', 'browser-tested', 'uncovered'].includes(row.coverage))
      problems.push(`${row.id}: invalid coverage`);
    if (!Array.isArray(row.evidence)) {
      problems.push(`${row.id}: evidence must be an array`);
      continue;
    }
    if ((row.coverage === 'uncovered') !== (row.evidence.length === 0))
      problems.push(`${row.id}: uncovered has no asserted coverage; covered needs an assertion`);
    for (const ref of row.evidence) {
      if (
        !ref ||
        typeof ref.file !== 'string' ||
        !/^tests\/[a-z0-9-]+\.test\.js$/.test(ref.file) ||
        typeof ref.test !== 'string' ||
        !ref.test.trim()
      ) {
        problems.push(`${row.id}: invalid assertion reference`);
        continue;
      }
      try {
        if (!assertionNames(read(ref.file)).has(ref.test))
          problems.push(`${row.id}: missing assertion ${ref.file}: ${ref.test}`);
      } catch (error) {
        problems.push(`${row.id}: unreadable assertion file: ${error.message}`);
      }
    }
  }
  return problems;
}

test('capability inventory names real assertions and preserves explicit uncovered boundaries', () => {
  const markdown = fs.readFileSync(INVENTORY, 'utf8');
  const match = markdown.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(match, 'machine-readable assertion inventory is present');
  const rows = JSON.parse(match[1]);
  assert.deepEqual(problemsFor(rows), []);
  for (const coverage of ['unit-only', 'browser-tested', 'uncovered'])
    assert.ok(
      rows.some((row) => row.coverage === coverage),
      coverage,
    );
});

test('inventory guard rejects comments as assertions and uncovered rows with coverage claims', () => {
  const row = {
    id: 'sample',
    capability: 'Example',
    scenario: 'One scenario',
    scope: 'Synthetic',
    limits: 'Bounded',
    coverage: 'unit-only',
    evidence: [{ file: 'tests/example.test.js', test: 'real assertion' }],
  };
  assert.deepEqual(
    problemsFor([row], () => "test('real assertion', () => {});"),
    [],
  );
  assert.ok(
    problemsFor(
      [row],
      () => "// test('real assertion', () => {});\nconst example = \"test('real assertion')\";",
    ).some((problem) => problem.includes('missing assertion')),
  );
  assert.ok(
    problemsFor(
      [{ ...row, coverage: 'uncovered' }],
      () => "test('real assertion', () => {});",
    ).some((problem) => problem.includes('uncovered')),
  );
  assert.ok(
    problemsFor([{ ...row, evidence: [] }]).some((problem) =>
      problem.includes('needs an assertion'),
    ),
  );
  assert.ok(
    problemsFor([row, row], () => "test('real assertion', () => {});").some((problem) =>
      problem.includes('duplicate scenario'),
    ),
  );
});
