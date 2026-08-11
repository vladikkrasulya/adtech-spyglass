'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = fs.realpathSync(path.join(__dirname, '..'));
const OBSOLETE_ASSET = 'public/vendor/marked.esm.min.js';

const VENDORS = [
  {
    displayName: 'Marked',
    packageName: 'marked',
    version: '15.0.12',
    repository: 'https://github.com/markedjs/marked',
    release: 'v15.0.12',
    sourceAsset: 'node_modules/marked/lib/marked.esm.js',
    publicAsset: 'public/vendor/marked.es.js',
    sourceLicense: 'node_modules/marked/LICENSE.md',
    publicLicense: 'public/vendor/licenses/Marked-MIT.txt',
    license: 'MIT',
  },
  {
    displayName: 'DOMPurify',
    packageName: 'dompurify',
    version: '3.4.13',
    repository: 'https://github.com/cure53/DOMPurify',
    release: '3.4.13 (signed tag commit 3067f77)',
    sourceAsset: 'node_modules/dompurify/dist/purify.es.mjs',
    publicAsset: 'public/vendor/dompurify.es.js',
    sourceLicense: 'node_modules/dompurify/LICENSE',
    publicLicense: 'public/vendor/licenses/DOMPurify-Apache-2.0.txt',
    license: 'Apache-2.0',
  },
];

function absolute(relativePath) {
  return path.join(ROOT, relativePath);
}

function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function unsafePath(relativePath, reason) {
  throw new Error(`refusing unsafe browser vendor path ${relativePath}: ${reason}`);
}

function resolveOwnedTarget(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    unsafePath(String(relativePath), 'path must be repository-relative');
  }

  const target = path.resolve(ROOT, relativePath);
  const ownedRelative = path.relative(ROOT, target);
  if (
    ownedRelative === '' ||
    ownedRelative === '..' ||
    ownedRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(ownedRelative)
  ) {
    unsafePath(relativePath, 'path escapes the real repository');
  }

  return { target, ownedRelative };
}

function assertOwnedDirectory(target, relativePath, ownedAncestor) {
  const stat = lstatIfPresent(target);
  if (!stat) return false;
  if (stat.isSymbolicLink()) {
    unsafePath(relativePath, `ancestor ${ownedAncestor} is a symbolic link`);
  }
  if (!stat.isDirectory()) {
    unsafePath(relativePath, `ancestor ${ownedAncestor} is not a directory`);
  }

  const realTarget = fs.realpathSync(target);
  const realRelative = path.relative(ROOT, realTarget);
  if (
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    unsafePath(relativePath, `ancestor ${ownedAncestor} escapes the real repository`);
  }
  return true;
}

function inspectMutationPath(relativePath) {
  const { target, ownedRelative } = resolveOwnedTarget(relativePath);
  const parentRelative = path.dirname(ownedRelative);
  let current = ROOT;

  if (parentRelative !== '.') {
    for (const segment of parentRelative.split(path.sep)) {
      current = path.join(current, segment);
      if (!assertOwnedDirectory(current, relativePath, path.relative(ROOT, current))) break;
    }
  }

  const targetStat = lstatIfPresent(target);
  if (targetStat?.isSymbolicLink()) {
    unsafePath(relativePath, 'target is a symbolic link');
  }
  if (targetStat && !targetStat.isFile()) {
    unsafePath(relativePath, 'target is not a regular file');
  }
  return target;
}

function ensureOwnedParentDirectories(relativePath) {
  const { target, ownedRelative } = resolveOwnedTarget(relativePath);
  const parentRelative = path.dirname(ownedRelative);
  let current = ROOT;

  if (parentRelative !== '.') {
    for (const segment of parentRelative.split(path.sep)) {
      current = path.join(current, segment);
      if (!lstatIfPresent(current)) fs.mkdirSync(current);
      assertOwnedDirectory(current, relativePath, path.relative(ROOT, current));
    }
  }

  return target;
}

function readJson(relativePath) {
  const target = absolute(relativePath);
  if (!fs.existsSync(target)) throw new Error(`missing ${relativePath}`);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function readRequired(relativePath) {
  const target = absolute(relativePath);
  if (!fs.existsSync(target)) throw new Error(`missing ${relativePath}`);
  return fs.readFileSync(target);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function verifyPackageOwnership() {
  const manifest = readJson('package.json');
  const lock = readJson('package-lock.json');

  for (const vendor of VENDORS) {
    const manifestVersion = manifest.devDependencies?.[vendor.packageName];
    if (manifestVersion !== vendor.version) {
      throw new Error(
        `${vendor.packageName} must be an exact devDependency at ${vendor.version}; found ${manifestVersion || 'none'}`,
      );
    }

    const rootLockVersion = lock.packages?.['']?.devDependencies?.[vendor.packageName];
    if (rootLockVersion !== vendor.version) {
      throw new Error(
        `package-lock root must pin ${vendor.packageName} at ${vendor.version}; found ${rootLockVersion || 'none'}`,
      );
    }

    const lockEntry = lock.packages?.[`node_modules/${vendor.packageName}`];
    if (!lockEntry || lockEntry.version !== vendor.version || lockEntry.dev !== true) {
      throw new Error(
        `package-lock entry for ${vendor.packageName} must be development-only ${vendor.version}`,
      );
    }
    if (!/^https:\/\/registry\.npmjs\.org\//.test(lockEntry.resolved || '')) {
      throw new Error(`package-lock entry for ${vendor.packageName} has an unexpected source`);
    }
    if (!/^sha512-/.test(lockEntry.integrity || '')) {
      throw new Error(`package-lock entry for ${vendor.packageName} has no sha512 integrity`);
    }

    const installed = readJson(`node_modules/${vendor.packageName}/package.json`);
    if (installed.version !== vendor.version) {
      throw new Error(
        `installed ${vendor.packageName} must be ${vendor.version}; found ${installed.version || 'unknown'}`,
      );
    }
  }
}

function collectRecords() {
  return VENDORS.map((vendor) => {
    const assetBytes = readRequired(vendor.sourceAsset);
    const licenseBytes = readRequired(vendor.sourceLicense);
    return {
      vendor,
      assetBytes,
      licenseBytes,
      assetHash: sha256(assetBytes),
      licenseHash: sha256(licenseBytes),
    };
  });
}

function renderNotice(records) {
  const blocks = records.map(({ vendor, assetHash, licenseHash }) =>
    [
      vendor.displayName,
      `Package: ${vendor.packageName}@${vendor.version}`,
      `Repository: ${vendor.repository}`,
      `Release: ${vendor.release}`,
      `Source artifact: ${vendor.sourceAsset}`,
      `Public asset: ${vendor.publicAsset}`,
      `SHA-256: ${assetHash}`,
      'Parity: byte-identical',
      `License: ${vendor.license}`,
      `License source: ${vendor.sourceLicense}`,
      `License copy: ${vendor.publicLicense}`,
      `License SHA-256: ${licenseHash}`,
    ].join('\n'),
  );

  return [
    'Browser Vendor Provenance',
    'Generated by scripts/sync-browser-vendors.js --write.',
    'Owner: specs/003-blog-markdown-safety/contracts/vendor-integrity.md',
    'Update: node scripts/sync-browser-vendors.js --write',
    'Verify: node scripts/sync-browser-vendors.js --check',
    '',
    ...blocks.flatMap((block, index) => (index === 0 ? [block] : ['', block])),
    '',
  ].join('\n');
}

function writeExact(relativePath, bytes) {
  const target = ensureOwnedParentDirectories(relativePath);
  inspectMutationPath(relativePath);
  if (lstatIfPresent(target) && Buffer.compare(fs.readFileSync(target), bytes) === 0) return;
  fs.writeFileSync(target, bytes);
}

function removeExact(relativePath) {
  const target = inspectMutationPath(relativePath);
  if (!lstatIfPresent(target)) return;
  fs.unlinkSync(target);
}

function artifactMutationPaths(records) {
  return [
    ...records.flatMap(({ vendor }) => [vendor.publicAsset, vendor.publicLicense]),
    'public/vendor/NOTICE.txt',
    OBSOLETE_ASSET,
  ];
}

function preflightArtifactMutations(records) {
  for (const relativePath of artifactMutationPaths(records)) inspectMutationPath(relativePath);
}

function writeArtifacts(records) {
  preflightArtifactMutations(records);
  for (const { vendor, assetBytes, licenseBytes } of records) {
    writeExact(vendor.publicAsset, assetBytes);
    writeExact(vendor.publicLicense, licenseBytes);
  }
  writeExact('public/vendor/NOTICE.txt', Buffer.from(renderNotice(records), 'utf8'));
  removeExact(OBSOLETE_ASSET);
}

function assertExact(relativePath, expectedBytes) {
  const actualBytes = readRequired(relativePath);
  if (Buffer.compare(actualBytes, expectedBytes) !== 0) {
    throw new Error(`${relativePath} differs from its reviewed source`);
  }
}

function checkArtifacts(records) {
  preflightArtifactMutations(records);
  for (const { vendor, assetBytes, licenseBytes } of records) {
    assertExact(vendor.publicAsset, assetBytes);
    assertExact(vendor.publicLicense, licenseBytes);
  }
  assertExact('public/vendor/NOTICE.txt', Buffer.from(renderNotice(records), 'utf8'));
  if (fs.existsSync(absolute(OBSOLETE_ASSET))) {
    throw new Error(`obsolete asset remains at ${OBSOLETE_ASSET}`);
  }
}

function run(
  argv,
  writeOutput = (message) => {
    process.stdout.write(message);
  },
) {
  if (argv.length !== 1 || !['--check', '--write'].includes(argv[0])) {
    throw new Error('usage: node scripts/sync-browser-vendors.js --check|--write');
  }

  verifyPackageOwnership();
  const records = collectRecords();

  if (argv[0] === '--write') {
    writeArtifacts(records);
    writeOutput('Browser vendor assets synchronized.\n');
    return;
  }

  checkArtifacts(records);
  writeOutput('Browser vendor assets are synchronized.\n');
}

module.exports = { run };

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Browser vendor sync failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
