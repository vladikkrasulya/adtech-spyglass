'use strict';

/**
 * Child process for tests/sentry-data-collection.test.js.
 * Starts a local stub that stands in for the Sentry-compatible server, boots
 * lib/logger.js against it exactly as production does, triggers one captured
 * error from inside a request handler, and prints the received event as JSON.
 * Nothing leaves the machine.
 *
 * The SDK's http instrumentation is not active in this process (http is loaded
 * before the logger), so the request data an instrumented server would attach
 * is put on the isolation scope by hand, in the shape the SDK itself uses
 * (`normalizedRequest`). PROBE_MODE=defaults runs the same flow with the SDK's
 * own `dataCollection` defaults instead of the project's settings; the test uses
 * it to prove that this probe can tell the two apart.
 */
const http = require('node:http');
const path = require('node:path');

// Built at run time so the values do not appear in the source lines the SDK
// attaches to stack frames.
const V = {
  cookie: ['COOKIE', 'SENTINEL'].join(''),
  auth: ['AUTH', 'SENTINEL'].join(''),
  query: ['QUERY', 'SENTINEL'].join(''),
  ip: ['203.0.113', '77'].join('.'),
};

const received = [];
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
});

stub.listen(0, '127.0.0.1', () => {
  const port = /** @type {import('node:net').AddressInfo} */ (stub.address()).port;
  process.env.NODE_ENV = 'production';
  process.env.LOG_LEVEL = 'silent';
  process.env.SENTRY_DSN = `http://probekey@127.0.0.1:${port}/1`;
  const Sentry = require('@sentry/node');
  if (process.env.PROBE_MODE === 'defaults') {
    const init = Sentry.init;
    Sentry.init = (options) => {
      const { dataCollection: _dropped, ...rest } = options;
      return init(rest);
    };
  }
  const logger = require(path.join(__dirname, '..', '..', 'lib', 'logger'));

  const app = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      Sentry.getIsolationScope().setSDKProcessingMetadata({
        normalizedRequest: {
          method: req.method,
          url: `http://127.0.0.1${req.url}`,
          query_string: String(req.url).split('?')[1] || '',
          headers: req.headers,
          cookies: { visitor: V.cookie },
        },
      });
      logger.captureException(new Error('probe'), {
        request: { method: req.method, url: req.url },
      });
      res.end('ok');
    });
  });
  app.listen(0, '127.0.0.1', () => {
    const clientReq = http.request(
      {
        host: '127.0.0.1',
        port: /** @type {import('node:net').AddressInfo} */ (app.address()).port,
        method: 'POST',
        path: `/probe?q=${V.query}`,
        headers: {
          'content-type': 'application/json',
          cookie: `visitor=${V.cookie}`,
          authorization: `Bearer ${V.auth}`,
          'x-forwarded-for': V.ip,
          'user-agent': 'probe-agent',
        },
      },
      (res) => {
        res.resume();
        res.on('end', async () => {
          await logger.flushSentry(3000);
          const events = [];
          for (const envelope of received) {
            for (const line of envelope.split('\n')) {
              try {
                const parsed = JSON.parse(line);
                if (parsed && parsed.exception) events.push(parsed);
              } catch (_e) {
                /* header or item-header line that is not an event */
              }
            }
          }
          process.stdout.write(
            JSON.stringify({ ready: logger.sentryReady(), events, raw: received.join('\n') }),
          );
          process.exit(0);
        });
      },
    );
    clientReq.end('{}');
  });
});
