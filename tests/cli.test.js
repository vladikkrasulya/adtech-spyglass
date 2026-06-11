'use strict';

/**
 * tests/cli.test.js — @ortbtools/cli (packages/cli).
 *
 * Drives run(argv, io) in-process with a captured io object (fast path), plus
 * one spawn of the real bin to verify the shebang/wrapper wiring end-to-end.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { run, EXIT_OK, EXIT_FINDINGS, EXIT_USAGE } = require('../packages/cli/lib/cli');

const BIN = path.join(__dirname, '..', 'packages', 'cli', 'bin', 'ortbtools.js');

// Minimal-but-parseable payloads. The request is deliberately incomplete so
// validate yields errors (deterministic exit-1 material); the pair is
// consistent so crosscheck yields warn/ok only (deterministic exit-0).
const REQ = { id: '1', imp: [{ id: '1', banner: { w: 300, h: 250 } }], at: 1 };
const RES = {
  id: '1',
  seatbid: [{ bid: [{ id: 'b1', impid: '1', price: 1.2, adm: '<div></div>' }] }],
};

function tmpFile(name, contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-cli-')), name);
  fs.writeFileSync(file, contents);
  return file;
}

function capture() {
  const io = { outLines: [], errLines: [], isTTY: false };
  io.out = (s) => io.outLines.push(s);
  io.err = (s) => io.errLines.push(s);
  return io;
}

test('validate: incomplete request → findings printed, exit 1', () => {
  const file = tmpFile('req.json', JSON.stringify(REQ));
  const io = capture();
  const code = run(['validate', file], io);
  assert.strictEqual(code, EXIT_FINDINGS);
  const out = io.outLines.join('\n');
  assert.match(out, /BidRequest/);
  assert.match(out, /request\.device_required/);
  assert.match(out, /\d+ finding\(s\)/);
});

test('validate: --fail-on never → exit 0 despite errors', () => {
  const file = tmpFile('req.json', JSON.stringify(REQ));
  const code = run(['validate', file, '--fail-on', 'never'], capture());
  assert.strictEqual(code, EXIT_OK);
});

test('validate: --json emits parseable result with findings[]', () => {
  const file = tmpFile('req.json', JSON.stringify(REQ));
  const io = capture();
  run(['validate', file, '--json'], io);
  const parsed = JSON.parse(io.outLines.join('\n'));
  assert.strictEqual(parsed.status, 'errors');
  assert.ok(Array.isArray(parsed.findings) && parsed.findings.length > 0);
  assert.ok(parsed.findings[0].id);
});

test('validate: default locale is en (no Cyrillic), --locale uk switches', () => {
  const file = tmpFile('req.json', JSON.stringify(REQ));
  const en = capture();
  run(['validate', file], en);
  assert.doesNotMatch(en.outLines.join('\n'), /[а-яА-ЯіїєґІЇЄҐ]/);
  const uk = capture();
  run(['validate', file, '--locale', 'uk'], uk);
  assert.match(uk.outLines.join('\n'), /[а-яіїєґ]/);
});

test('validate: missing file → exit 2, error on stderr', () => {
  const io = capture();
  const code = run(['validate', '/nonexistent/nope.json'], io);
  assert.strictEqual(code, EXIT_USAGE);
  assert.match(io.errLines.join('\n'), /cannot read/);
});

test('validate: non-JSON junk degrades to a validation finding, not a crash', () => {
  const file = tmpFile('junk.txt', 'definitely not json and not a URL');
  const io = capture();
  const code = run(['validate', file], io);
  assert.strictEqual(code, EXIT_FINDINGS);
  assert.match(io.outLines.join('\n'), /payload\.invalid_root/);
});

test('crosscheck: consistent pair → warn/ok findings, exit 0 at default fail-on', () => {
  const reqFile = tmpFile('req.json', JSON.stringify(REQ));
  const resFile = tmpFile('res.json', JSON.stringify(RES));
  const io = capture();
  const code = run(['crosscheck', reqFile, resFile], io);
  assert.strictEqual(code, EXIT_OK);
  assert.match(io.outLines.join('\n'), /crosscheck\.id_match/);
});

test('crosscheck: --fail-on warn flips the floor warning into exit 1', () => {
  const reqFile = tmpFile('req.json', JSON.stringify(REQ));
  const resFile = tmpFile('res.json', JSON.stringify(RES));
  const code = run(['crosscheck', reqFile, resFile, '--fail-on', 'warn'], capture());
  assert.strictEqual(code, EXIT_FINDINGS);
});

test('crosscheck: non-object side → exit 2', () => {
  const reqFile = tmpFile('req.json', JSON.stringify(REQ));
  const junk = tmpFile('junk.txt', 'not json');
  const io = capture();
  assert.strictEqual(run(['crosscheck', reqFile, junk], io), EXIT_USAGE);
  assert.match(io.errLines.join('\n'), /not a JSON object/);
});

test('detect: prints type/version/format, exit 0', () => {
  const file = tmpFile('req.json', JSON.stringify(REQ));
  const io = capture();
  const code = run(['detect', file], io);
  assert.strictEqual(code, EXIT_OK);
  const out = io.outLines.join('\n');
  assert.match(out, /type: {4}oRTB BidRequest/);
  assert.match(out, /version: 2\.5/);
  assert.match(out, /banner/);
});

test('dialects + locales list the built-ins', () => {
  const d = capture();
  run(['dialects'], d);
  assert.ok(d.outLines.includes('iab'));
  const l = capture();
  run(['locales'], l);
  for (const loc of ['en', 'uk', 'ru']) assert.ok(l.outLines.includes(loc));
});

test('usage errors: unknown command / unknown flag / no args → exit 2', () => {
  assert.strictEqual(run(['frobnicate'], capture()), EXIT_USAGE);
  assert.strictEqual(run(['validate', '/tmp/x.json', '--frobnicate'], capture()), EXIT_USAGE);
  assert.strictEqual(run([], capture()), EXIT_USAGE);
  assert.strictEqual(run(['--fail-on', 'sometimes', 'validate', 'x'], capture()), EXIT_USAGE);
});

test('help and version exit 0', () => {
  const h = capture();
  assert.strictEqual(run(['help'], h), EXIT_OK);
  assert.match(h.outLines.join('\n'), /Usage:/);
  const v = capture();
  assert.strictEqual(run(['--version'], v), EXIT_OK);
  assert.match(v.outLines.join('\n'), /@ortbtools\/cli \d+\.\d+\.\d+/);
});

test('bin wrapper: spawning the real executable works end-to-end (stdin path)', () => {
  const out = execFileSync(
    process.execPath,
    [BIN, 'validate', '-', '--json', '--fail-on', 'never'],
    {
      input: JSON.stringify(REQ),
      encoding: 'utf8',
    },
  );
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.status, 'errors');
});
