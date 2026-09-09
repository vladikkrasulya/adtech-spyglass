'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const PROFILE_PREFIX = 'puppeteer_dev_chrome_profile-';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Only group leaders using a profile created inside this attempt are eligible. */
function ownedBrowsers(snapshot, tempDir) {
  const profiles = fs
    .readdirSync(tempDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PROFILE_PREFIX))
    .map((entry) => path.join(tempDir, entry.name));
  return snapshot.split('\n').flatMap((line) => {
    // lstart contributes five whitespace-separated fields and records PID identity.
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/);
    if (!match) return [];
    const [, pidText, groupText, started, command] = match;
    const pid = Number(pidText);
    if (pid !== Number(groupText) || pid <= 1 || pid === process.pid) return [];
    const ownsProfile = profiles.some((profile) => {
      const token = `--user-data-dir=${profile}`;
      const at = command.indexOf(token);
      return (
        at >= 0 &&
        (at === 0 || /\s/.test(command[at - 1])) &&
        (at + token.length === command.length || /\s/.test(command[at + token.length]))
      );
    });
    return ownsProfile ? [{ pid, started, command }] : [];
  });
}

async function snapshotProcesses(pid) {
  const args = pid
    ? ['-ww', '-p', String(pid), '-o', 'pid=,pgid=,lstart=,args=']
    : ['-ww', '-axo', 'pid=,pgid=,lstart=,args='];
  try {
    return (await exec('ps', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })).stdout;
  } catch (error) {
    if (pid && error.code === 1) return '';
    throw error;
  }
}

function signalGroup(pid, signal) {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/** The caller registers this group at spawn; no process-name discovery is used. */
async function stopOwnedGroup(pid, graceMs = 250) {
  if (!pid || pid <= 1 || pid === process.pid) return;
  if (!signalGroup(pid, 'SIGTERM')) return;
  await delay(graceMs);
  signalGroup(pid, 'SIGKILL');
}

/**
 * Chromium creates its own detached group, outside the node:test group. Its
 * profile is under the attempt's private TMPDIR. Re-check both PID identity and
 * exact profile ownership before each signal, never a shared profile pattern.
 */
async function cleanupBrowsers(tempDir, graceMs = 250) {
  if (process.platform === 'win32') return 0;
  const candidates = ownedBrowsers(await snapshotProcesses(), tempDir);
  let cleaned = 0;
  for (const candidate of candidates) {
    const stillOwned = async () =>
      ownedBrowsers(await snapshotProcesses(candidate.pid), tempDir).some(
        (current) =>
          current.pid === candidate.pid &&
          current.started === candidate.started &&
          current.command === candidate.command,
      );
    if (!(await stillOwned())) continue;
    if (!signalGroup(candidate.pid, 'SIGTERM')) continue;
    cleaned++;
    await delay(graceMs);
    if (await stillOwned()) signalGroup(candidate.pid, 'SIGKILL');
  }
  return cleaned;
}

module.exports = { PROFILE_PREFIX, ownedBrowsers, cleanupBrowsers, stopOwnedGroup };
