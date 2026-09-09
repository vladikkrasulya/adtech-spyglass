'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('@ortbtools/core');
const feature = path.join(__dirname, '../specs/033-close-remaining-questions');
const manifest = JSON.parse(fs.readFileSync(path.join(feature, 'witness-manifest.json'), 'utf8'));
const receipt = JSON.parse(fs.readFileSync(path.join(feature, 'witness-results.json'), 'utf8'));
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('dialect receipt: exactly the frozen19 IDs have execution outcomes and independent controls', () => {
  assert.equal(receipt.records.length, 19);
  assert.deepEqual(
    receipt.records.map((r) => r.id).sort(),
    manifest.records.map((r) => r.id).sort(),
  );
  assert.equal(new Set(receipt.records.map((r) => r.id)).size, 19);
  assert.equal(receipt.sourceRevision, manifest.source_revision);
  assert.equal(receipt.isolation.networkMode, 'none');
  assert.equal(receipt.isolation.readonlyRootfs, true);
  assert.equal(receipt.execution.exitCode, 0);
  assert.ok(receipt.frozenInputs.trackedSourceClean);
  for (const record of receipt.records) {
    assert.equal(record.outcome, 'pass');
    assert.ok(record.variantCount >= 3);
    assert.ok(record.assertions >= 6);
    assert.ok(record.oracle);
    assert.ok(record.after.witness033.ids.includes(record.id));
  }
  assert.equal(
    receipt.totals.variants,
    receipt.records.reduce((sum, r) => sum + r.variantCount, 0),
  );
  assert.equal(
    receipt.totals.assertions,
    receipt.records.reduce((sum, r) => sum + r.assertions, 0),
  );
});

test('dialect receipt: source profiles and current owned harness match executed bytes', () => {
  const profiles = core.listInspectionProfiles();
  assert.deepEqual(
    profiles.flatMap((p) => p.statements.map((s) => s.id)).sort(),
    manifest.records.map((r) => r.id).sort(),
  );
  for (const profile of profiles) {
    for (const source of profile.sources)
      assert.equal(receipt.frozenInputs.sourceFiles[source.path], source.sha256);
    for (const statement of profile.statements) {
      const record = receipt.records.find((r) => r.id === statement.id);
      assert.equal(statement.disposition, record.after.disposition);
    }
  }
  for (const file of ['witness_test.go', 'generate.py', 'run.py']) {
    assert.equal(
      hash(path.join(__dirname, '../scripts/dialect-witnesses', file)),
      receipt.frozenInputs.files[file],
      file,
    );
  }
  assert.equal(
    hash(path.join(__dirname, '../scripts/dialect-witnesses/amend.py')),
    receipt.amendmentScriptSha256,
  );
});

test('dialect receipt: four supported disposition changes preserve prior outcomes and failed attempts', () => {
  const changes = receipt.records.filter((r) => r.before.disposition !== r.after.disposition);
  assert.equal(changes.length, 4);
  assert.equal(receipt.totals.dispositionChanges, changes.length);
  assert.deepEqual(receipt.historicalB1, { pass: 36, fail: 0, inconclusive: 12 });
  assert.equal(receipt.historicalAuditTreeSha256, manifest.audit_tree_sha256);
  assert.equal(receipt.attempts[0].exitCode, 1);
  assert.equal(receipt.attempts[0].caseCount, 0);
  assert.equal(receipt.attempts[1].failedCaseIds.length, 3);
  assert.equal(receipt.attempts.at(-1).exitCode, 0);
});
