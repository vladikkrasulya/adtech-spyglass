'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLEANUP = path.join(ROOT, 'scripts', 'cleanup-rollback-tags.sh');

function runCleanup(t, rows, { listFails = false } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-cleanup-test-'));
  const binDir = path.join(tempDir, 'bin');
  const scenarioPath = path.join(tempDir, 'scenario.tsv');
  const removeLog = path.join(tempDir, 'removed.log');
  const cleanupLog = path.join(tempDir, 'cleanup.log');
  fs.mkdirSync(binDir);
  fs.writeFileSync(
    scenarioPath,
    rows.map((row) => row.join('\t')).join('\n') + (rows.length ? '\n' : ''),
  );
  fs.writeFileSync(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail

if [ "\${1:-} \${2:-}" = "image ls" ]; then
    if [ "\${FAKE_LIST_FAIL:-0}" = 1 ]; then
        printf 'daemon unavailable\n' >&2
        exit 42
    fi
    cut -f1 "$FAKE_SCENARIO"
    exit 0
fi

if [ "\${1:-} \${2:-}" = "image inspect" ]; then
    ref="\${!#}"
    line="$(awk -F '\\t' -v wanted="$ref" '$1 == wanted { print; exit }' "$FAKE_SCENARIO")"
    [ -n "$line" ] || { printf 'missing %s\n' "$ref" >&2; exit 1; }
    IFS=$'\\t' read -r _ created inspect_state _ <<< "$line"
    if [ "$inspect_state" = inspect-fail ]; then
        printf 'image disappeared: %s\n' "$ref" >&2
        exit 1
    fi
    printf '%s\n' "$created"
    exit 0
fi

if [ "\${1:-} \${2:-}" = "image rm" ]; then
    ref="\${3:-}"
    printf '%s\n' "$ref" >> "$FAKE_REMOVE_LOG"
    line="$(awk -F '\\t' -v wanted="$ref" '$1 == wanted { print; exit }' "$FAKE_SCENARIO")"
    IFS=$'\\t' read -r _ _ _ remove_state <<< "$line"
    if [ "$remove_state" = remove-fail ]; then
        printf 'removal raced: %s\n' "$ref" >&2
        exit 1
    fi
    printf 'removed %s\n' "$ref"
    exit 0
fi

printf 'unexpected docker invocation: %s\n' "$*" >&2
exit 64
`,
    { mode: 0o755 },
  );

  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const run = spawnSync('bash', [CLEANUP, cleanupLog], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_SCENARIO: scenarioPath,
      FAKE_REMOVE_LOG: removeLog,
      FAKE_LIST_FAIL: listFails ? '1' : '0',
    },
  });

  return {
    ...run,
    removed: fs.existsSync(removeLog)
      ? fs.readFileSync(removeLog, 'utf8').trim().split('\n').filter(Boolean)
      : [],
    log: fs.existsSync(cleanupLog) ? fs.readFileSync(cleanupLog, 'utf8') : '',
  };
}

test('rollback cleanup removes only timestamped candidates older than the newest ten', (t) => {
  const valid = Array.from({ length: 13 }, (_, index) => {
    const created = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
    const reverseName = String(12 - index).padStart(2, '0');
    return [
      `ortbtools:rollback-pre-z${reverseName}`,
      created,
      'inspect-ok',
      index === 1 ? 'remove-fail' : 'remove-ok',
    ];
  });
  const uninspectable = [
    'ortbtools:rollback-pre-uninspectable',
    '2026-01-02T00:00:00.000Z',
    'inspect-fail',
    'remove-ok',
  ];
  const malformed = [
    'ortbtools:rollback-pre-malformed',
    'not-a-timestamp',
    'inspect-ok',
    'remove-ok',
  ];

  const result = runCleanup(t, [...valid, uninspectable, malformed]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.removed, [valid[2][0], valid[1][0], valid[0][0]]);
  assert.doesNotMatch(result.removed.join('\n'), /uninspectable|malformed/);
  assert.match(result.log, /keeping the 10 newest by image creation time and removing 3 older/);
  assert.match(result.log, /retaining 2 tag\(s\) with unreadable timestamps/);
  assert.match(result.log, /could not inspect .*uninspectable/);
  assert.match(result.log, /could not parse creation time for .*malformed/);
  assert.match(result.log, /failed to remove rollback tag .*z11; continuing cleanup/);
  assert.match(result.log, new RegExp(`Removing old rollback tag ${valid[0][0]}`));
});

test('rollback cleanup keeps every candidate when at most ten timestamps are readable', (t) => {
  const rows = Array.from({ length: 10 }, (_, index) => [
    `ortbtools:rollback-pre-${index}`,
    new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    'inspect-ok',
    'remove-ok',
  ]);

  const result = runCleanup(t, rows);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.removed, []);
  assert.match(result.log, /keeping all 10 timestamped tag\(s\)/);
});

test('rollback cleanup retains everything when Docker cannot list candidates', (t) => {
  const result = runCleanup(t, [], { listFails: true });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.removed, []);
  assert.match(result.log, /could not list ortbtools rollback tags; retaining all/);
  assert.match(result.log, /daemon unavailable/);
});
