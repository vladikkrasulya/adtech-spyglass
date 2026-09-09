'use strict';
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

async function startIsolatedApp() {
  const root = path.resolve(__dirname, '..');
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = /** @type {import('node:net').AddressInfo} */ (listener.address()).port;
  await new Promise((resolve) => listener.close(resolve));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-033-browser-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      ORTBTOOLS_DATA_DIR: dataDir,
      ORTBTOOLS_ANALYTICS_DISABLED: '1',
      NEWS_CRAWLER_DISABLED: '1',
      FX_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.kill('SIGTERM');
      await exited;
      clearTimeout(force);
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Isolated app startup timeout')), 15000);
      const ready = (chunk) => {
        if (!chunk.toString().includes('listening')) return;
        clearTimeout(timer);
        resolve(null);
      };
      child.stdout.on('data', ready);
      child.stderr.on('data', ready);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Isolated app exited ${code}`));
      });
    });
  } catch (error) {
    await stop();
    throw error;
  }
  return { url: `http://127.0.0.1:${port}`, dataDir, child, stop };
}

module.exports = { startIsolatedApp };
