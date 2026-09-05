'use strict';

/**
 * Offline regression guard for the dependency floors reviewed in feature 002.
 *
 * This file intentionally reads only the checked-in manifests. It catches a
 * regression to the known affected versions, but it does not replace either
 * full or production-only `npm audit` against the current advisory service.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');

function parseVersion(version) {
  if (typeof version !== 'string') throw new TypeError(`invalid version: ${String(version)}`);

  const match = version.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) throw new TypeError(`invalid version: ${version}`);

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }

  return 0;
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);

  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

const advisoryRules = {
  '@sentry/node': {
    affected: (version) => compareVersions(version, '10.53.1') <= 0,
    affectedRange: '<=10.53.1',
    required: true,
  },
  '@opentelemetry/core': {
    affected: (version) => compareVersions(version, '2.8.0') < 0,
    affectedRange: '<2.8.0',
    required: true,
  },
  '@opentelemetry/instrumentation-http': {
    affected: (version) => compareVersions(version, '0.218.0') <= 0,
    affectedRange: '<=0.218.0',
    required: false,
  },
  'brace-expansion': {
    affected: (version) => compareVersions(version, '5.0.9') < 0,
    affectedRange: '<5.0.9',
    required: true,
  },
  undici: {
    affected: (version) => {
      const parsed = parseVersion(version);
      return parsed.major === 7 && compareVersions(version, '7.29.0') < 0;
    },
    affectedRange: '7.x <7.29.0',
    required: true,
  },
};

function lockPathMatchesPackage(lockPath, packageName) {
  const suffix = `node_modules/${packageName}`;
  return lockPath === suffix || lockPath.endsWith(`/${suffix}`);
}

test('version comparator and advisory predicates enforce their exact boundaries', () => {
  assert.equal(lockPathMatchesPackage('node_modules/@sentry/node', '@sentry/node'), true);
  assert.equal(
    lockPathMatchesPackage('node_modules/parent/node_modules/@sentry/node', '@sentry/node'),
    true,
  );
  assert.equal(lockPathMatchesPackage('node_modules/@sentry/node-core', '@sentry/node'), false);

  for (const [left, right, expectedSign] of [
    ['10.53.0', '10.53.1', -1],
    ['10.53.1', '10.53.1', 0],
    ['10.53.2', '10.53.1', 1],
    ['2.8.0-rc.1', '2.8.0', -1],
    ['7.29.0+build.1', '7.29.0', 0],
  ]) {
    assert.equal(Math.sign(compareVersions(left, right)), expectedSign, `${left} vs ${right}`);
  }

  for (const [packageName, version, expected] of [
    ['@sentry/node', '10.53.1', true],
    ['@sentry/node', '10.53.2', false],
    ['@opentelemetry/core', '2.7.0', true],
    ['@opentelemetry/core', '2.8.0', false],
    ['@opentelemetry/instrumentation-http', '0.218.0', true],
    ['@opentelemetry/instrumentation-http', '0.219.0', false],
    ['brace-expansion', '5.0.8', true],
    ['brace-expansion', '5.0.9', false],
    ['undici', '7.28.0', true],
    ['undici', '7.29.0', false],
    ['undici', '8.0.0', false],
  ]) {
    assert.equal(
      advisoryRules[packageName].affected(version),
      expected,
      `${packageName}@${version}`,
    );
  }
});

test('root manifest and lock retain the reviewed Sentry 10.x floor', () => {
  const expectedRange = '^10.72.0';
  const rootLockEntry = packageLock.packages?.[''];
  const sentryLockEntry = packageLock.packages?.['node_modules/@sentry/node'];

  assert.equal(packageJson.dependencies?.['@sentry/node'], expectedRange);
  assert.equal(rootLockEntry?.dependencies?.['@sentry/node'], expectedRange);
  assert.ok(sentryLockEntry, 'package-lock.json must resolve the root @sentry/node dependency');
  assert.equal(parseVersion(sentryLockEntry.version).major, 10);
  assert.ok(
    compareVersions(sentryLockEntry.version, '10.70.0') >= 0,
    `root @sentry/node resolved to ${sentryLockEntry.version}; expected >=10.70.0`,
  );
});

test('locked graph stays above the feature-002 known affected floors', () => {
  assert.ok(packageLock.packages, 'package-lock.json must contain a lockfile v2/v3 packages graph');

  const matches = Object.fromEntries(Object.keys(advisoryRules).map((name) => [name, []]));
  const violations = [];

  for (const [lockPath, lockEntry] of Object.entries(packageLock.packages)) {
    for (const [packageName, rule] of Object.entries(advisoryRules)) {
      if (!lockPathMatchesPackage(lockPath, packageName)) continue;

      assert.equal(
        typeof lockEntry.version,
        'string',
        `${lockPath} must have an exact locked version`,
      );
      matches[packageName].push(`${lockPath}@${lockEntry.version}`);
      if (rule.affected(lockEntry.version)) {
        violations.push(
          `${lockPath}@${lockEntry.version} matches reviewed affected range ${rule.affectedRange}`,
        );
      }
    }
  }

  for (const [packageName, rule] of Object.entries(advisoryRules)) {
    if (rule.required) {
      assert.ok(
        matches[packageName].length > 0,
        `required locked package is missing: ${packageName}`,
      );
    }
  }

  assert.deepEqual(
    violations,
    [],
    `known dependency-floor regressions found:\n${violations.join('\n')}\nRun both npm audit modes for current advisory coverage.`,
  );
});
