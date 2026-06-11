'use strict';

/**
 * lib/cli.js — `ortbtools` command-line interface over @kyivtech/spyglass-core.
 *
 * Pure-ish by design: run(argv, io) does all the work and RETURNS the exit
 * code; the bin wrapper assigns it to process.exitCode. io carries the output
 * sinks ({ out, err, isTTY }) so tests run the CLI in-process.
 *
 * Exit-code contract (scriptable, CI-friendly):
 *   0 — command succeeded; no findings at or above the --fail-on level
 *   1 — payload analyzed, findings at/above the --fail-on level exist
 *   2 — usage / IO / parse error (nothing was analyzed)
 */

const fs = require('fs');
const core = require('@kyivtech/spyglass-core');
const pkg = require('../package.json');

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_USAGE = 2;

// Severity buckets shared by validate (error/warning/info/question) and
// crosscheck (crit/warn/ok) findings, so --fail-on means the same thing in
// both commands.
const ERROR_LEVELS = new Set([core.LEVELS.ERROR, core.CROSS_LEVELS.CRIT]);
const WARN_LEVELS = new Set([core.LEVELS.WARNING, core.CROSS_LEVELS.WARN]);

const USAGE = [
  `ortbtools ${pkg.version} — OpenRTB validator CLI (engine of ortbtools.com)`,
  '',
  'Usage:',
  '  ortbtools validate <file|->            Validate a BidRequest/BidResponse/feed payload',
  '  ortbtools crosscheck <req.json> <res.json>',
  '                                         Semantic request↔response crosscheck',
  '  ortbtools detect <file|->              Detect payload type / oRTB version / format',
  '  ortbtools dialects                     List built-in dialects',
  '  ortbtools locales                      List finding-message locales',
  '  ortbtools help | version',
  '',
  'Options:',
  '  --json                 Machine-readable JSON output',
  '  --locale <en|uk|ru>    Finding-message language (default: en)',
  '  --dialect <id>         Validation dialect (see `ortbtools dialects`; default: iab)',
  '  --expect-version <v>   Pin the oRTB version you target (e.g. 2.5) — emits',
  '                         version.mismatch when detection lands elsewhere',
  '  --fail-on <level>      Exit 1 threshold: error (default) | warn | never',
  '  --refs                 Show IAB spec links under each finding',
  '  --no-color             Disable ANSI colors (also honors NO_COLOR env)',
  '',
  'Reading from stdin: pass `-` as the file argument.',
  '  curl -s https://ortbtools.com/api/samples/bid-request | ortbtools validate -',
].join('\n');

function makePaint(enabled) {
  const wrap = (code) => (s) => (enabled ? `\u001b[${code}m${s}\u001b[0m` : String(s));
  return {
    red: wrap('31'),
    yellow: wrap('33'),
    green: wrap('32'),
    cyan: wrap('36'),
    bold: wrap('1'),
    dim: wrap('2'),
  };
}

/** Minimal flag parser — the option surface is small enough that a dependency
 *  (commander/yargs) would outweigh the whole CLI. Unknown flags are usage
 *  errors so typos (`--local en`) fail loudly instead of silently no-opping. */
function parseArgs(argv) {
  const opts = {
    json: false,
    refs: false,
    color: null, // null = auto (TTY && !NO_COLOR)
    locale: 'en',
    dialect: undefined,
    expectedVersion: undefined,
    failOn: 'error',
  };
  const positional = [];
  const VALUE_FLAGS = {
    '--locale': 'locale',
    '--dialect': 'dialect',
    '--expect-version': 'expectedVersion',
    '--fail-on': 'failOn',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--refs') opts.refs = true;
    else if (a === '--no-color') opts.color = false;
    else if (a === '-h' || a === '--help') positional.unshift('help');
    else if (a === '-v' || a === '--version') positional.unshift('version');
    else if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, a)) {
      const value = argv[++i];
      if (value === undefined) return { error: `${a} requires a value` };
      opts[VALUE_FLAGS[a]] = value;
    } else if (a.startsWith('--')) return { error: `unknown option: ${a}` };
    else positional.push(a);
  }
  if (!['error', 'warn', 'never'].includes(opts.failOn)) {
    return { error: `--fail-on must be error|warn|never (got: ${opts.failOn})` };
  }
  return { opts, positional };
}

/** Read a payload argument: `-` = stdin, anything else = a file path.
 *  Returns { raw } on success or { error } on IO failure. */
function readRaw(fileArg) {
  try {
    const raw = fileArg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(fileArg, 'utf8');
    return { raw };
  } catch (e) {
    return { error: `cannot read ${fileArg === '-' ? 'stdin' : fileArg}: ${e.message}` };
  }
}

/** JSON if it parses; otherwise the raw string (core's validate() accepts
 *  URL-style GET requests as strings and degrades gracefully on junk). */
function parsePayload(raw) {
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return raw.trim();
  }
}

function countLevels(findings) {
  let errors = 0;
  let warns = 0;
  for (const f of findings) {
    if (ERROR_LEVELS.has(f.level)) errors++;
    else if (WARN_LEVELS.has(f.level)) warns++;
  }
  return { errors, warns };
}

function exitFor(findings, failOn) {
  if (failOn === 'never') return EXIT_OK;
  const { errors, warns } = countLevels(findings);
  if (errors > 0) return EXIT_FINDINGS;
  if (failOn === 'warn' && warns > 0) return EXIT_FINDINGS;
  return EXIT_OK;
}

function levelTag(level, paint) {
  if (ERROR_LEVELS.has(level)) return paint.red(level.padEnd(8));
  if (WARN_LEVELS.has(level)) return paint.yellow(level.padEnd(8));
  if (level === core.CROSS_LEVELS.OK) return paint.green(level.padEnd(8));
  return paint.cyan(String(level).padEnd(8));
}

function printFindings(findings, opts, paint, io) {
  for (const f of findings) {
    const path = f.path ? paint.bold(f.path) + '  ' : '';
    io.out(`  ${levelTag(f.level, paint)} ${path}${f.msg} ${paint.dim(`[${f.id}]`)}`);
    if (opts.refs && f.specRef) io.out(`           ${paint.dim(f.specRef)}`);
  }
}

function cmdValidate(positional, opts, paint, io) {
  if (positional.length !== 1) {
    io.err('usage: ortbtools validate <file|->');
    return EXIT_USAGE;
  }
  const { raw, error } = readRaw(positional[0]);
  if (error) {
    io.err(`ortbtools: ${error}`);
    return EXIT_USAGE;
  }
  const result = core.validate(parsePayload(raw), {
    locale: opts.locale,
    dialect: opts.dialect,
    expectedVersion: opts.expectedVersion,
  });
  if (opts.json) {
    io.out(JSON.stringify(result, null, 2));
    return exitFor(result.findings, opts.failOn);
  }
  const { errors, warns } = countLevels(result.findings);
  const mark = errors > 0 ? paint.red('✖') : warns > 0 ? paint.yellow('⚠') : paint.green('✔');
  const version =
    result.version && result.version.version && result.version.version !== 'unknown'
      ? ` · v${result.version.version}`
      : '';
  io.out(`${mark} ${paint.bold(result.type)}${version} · status: ${result.status}`);
  printFindings(result.findings, opts, paint, io);
  io.out(
    `${result.findings.length} finding(s): ${errors} error, ${warns} warning, ` +
      `${result.findings.length - errors - warns} other`,
  );
  return exitFor(result.findings, opts.failOn);
}

function cmdCrosscheck(positional, opts, paint, io) {
  if (positional.length !== 2) {
    io.err('usage: ortbtools crosscheck <request.json> <response.json>');
    return EXIT_USAGE;
  }
  const sides = [];
  for (const fileArg of positional) {
    const { raw, error } = readRaw(fileArg);
    if (error) {
      io.err(`ortbtools: ${error}`);
      return EXIT_USAGE;
    }
    const parsed = parsePayload(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      io.err(`ortbtools: ${fileArg} is not a JSON object — crosscheck needs oRTB JSON`);
      return EXIT_USAGE;
    }
    sides.push(parsed);
  }
  const findings = core.crosscheck(sides[0], sides[1], { locale: opts.locale });
  if (opts.json) {
    io.out(JSON.stringify(findings, null, 2));
    return exitFor(findings, opts.failOn);
  }
  const { errors, warns } = countLevels(findings);
  const mark = errors > 0 ? paint.red('✖') : warns > 0 ? paint.yellow('⚠') : paint.green('✔');
  io.out(`${mark} request ↔ response crosscheck`);
  printFindings(findings, opts, paint, io);
  io.out(`${findings.length} finding(s): ${errors} crit, ${warns} warn`);
  return exitFor(findings, opts.failOn);
}

function cmdDetect(positional, opts, paint, io) {
  if (positional.length !== 1) {
    io.err('usage: ortbtools detect <file|->');
    return EXIT_USAGE;
  }
  const { raw, error } = readRaw(positional[0]);
  if (error) {
    io.err(`ortbtools: ${error}`);
    return EXIT_USAGE;
  }
  const payload = parsePayload(raw);
  const type = core.detectType(payload);
  const version = core.detectVersion(payload);
  const format = core.detectFormat(payload);
  if (opts.json) {
    io.out(JSON.stringify({ type, version, format }, null, 2));
    return EXIT_OK;
  }
  io.out(`type:    ${paint.bold(type)}`);
  io.out(`version: ${version.version} ${paint.dim(`(confidence ${version.confidence})`)}`);
  const fmts = (format.formats || []).join(', ') || '—';
  io.out(`format:  ${fmts}`);
  return EXIT_OK;
}

function run(argv, io) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    io.err(`ortbtools: ${parsed.error}`);
    io.err("run 'ortbtools help' for usage");
    return EXIT_USAGE;
  }
  const { opts, positional } = parsed;
  const colorEnabled = opts.color !== null ? opts.color : io.isTTY && !process.env.NO_COLOR;
  const paint = makePaint(colorEnabled && !opts.json);
  const command = positional.shift();

  switch (command) {
    case 'validate':
      return cmdValidate(positional, opts, paint, io);
    case 'crosscheck':
      return cmdCrosscheck(positional, opts, paint, io);
    case 'detect':
      return cmdDetect(positional, opts, paint, io);
    case 'dialects':
      for (const d of core.listDialects()) io.out(d);
      return EXIT_OK;
    case 'locales':
      for (const l of core.listLocales()) io.out(l);
      return EXIT_OK;
    case 'version':
      io.out(
        `@ortbtools/cli ${pkg.version} ` +
          `(engine @kyivtech/spyglass-core ${require('@kyivtech/spyglass-core/package.json').version})`,
      );
      return EXIT_OK;
    case 'help':
      io.out(USAGE);
      return EXIT_OK;
    case undefined:
      io.err(USAGE);
      return EXIT_USAGE;
    default:
      io.err(`ortbtools: unknown command '${command}'`);
      io.err("run 'ortbtools help' for usage");
      return EXIT_USAGE;
  }
}

module.exports = { run, EXIT_OK, EXIT_FINDINGS, EXIT_USAGE };
