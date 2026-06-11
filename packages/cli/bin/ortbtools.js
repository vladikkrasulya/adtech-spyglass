#!/usr/bin/env node
'use strict';

/**
 * bin/ortbtools.js — thin executable wrapper. All logic (arg parsing, command
 * dispatch, exit-code policy) lives in ../lib/cli.js so tests can drive it
 * in-process with a captured io object instead of spawning.
 */

const { run } = require('../lib/cli');

process.exitCode = run(process.argv.slice(2), {
  out: (s) => process.stdout.write(s + '\n'),
  err: (s) => process.stderr.write(s + '\n'),
  isTTY: Boolean(process.stdout.isTTY),
});
