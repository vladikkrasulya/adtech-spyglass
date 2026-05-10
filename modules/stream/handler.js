'use strict';

/**
 * modules/stream/handler.js — GET /api/v1/stream
 *
 * Public RTB observability feed (Phase 1 Step 1.2, see
 * docs/stream-platform-pivot-2026-05-05.md). Long-lived SSE connection:
 * server emits one synthetic specimen per cadence tick (~1Hz) until the
 * client disconnects, with a 15s heartbeat comment to keep CF/nginx from
 * killing idle streams.
 *
 * Unlike sample/mirror this is NOT a request/response handler — there is
 * no JSON body, no sendJson. Output is raw `res.write(...)` framed as
 * SSE messages (`event:` / `data:` / `:comment`). Connection lifecycle
 * is owned by the client; we attach listeners on entry and tear them
 * down on `req.on('close' | 'error', …)`.
 *
 * Factory shape (mirrors createMirrorModule): server.js owns the
 * singleton generator + buffer (boot-time setup + graceful shutdown via
 * generator.stop()), and passes references here at registration time.
 * Keeping the lifecycle outside the module means tests can substitute
 * a fake EventEmitter without spinning up a real corpus loader.
 *
 * Wiring (in server.js):
 *   const { createStreamModule } = require('./modules/stream/handler');
 *   router.register(createStreamModule({
 *     streamGenerator,        // EventEmitter — .on/.off('specimen', cb)
 *     streamBuffer,           // Array<envelope> — replay ring buffer
 *     STREAM_REPLAY_MAX,      // how many recent specimens to seed
 *     STREAM_HEARTBEAT_MS,    // comment-frame cadence (anti-idle)
 *   }));
 *
 * SSE leak hazards (the reason this handler exists separately):
 *   - The per-connection `setInterval` MUST be cleared on disconnect.
 *     If it isn't, every dropped client leaves a timer plus a closure
 *     pinning `res` alive → unbounded heap growth.
 *   - The 'specimen' listener MUST be removed on disconnect. The
 *     generator has setMaxListeners(0), so Node won't warn — leaks
 *     would silently accumulate and each emit would write into a
 *     dead socket (EPIPE noise + GC pressure).
 *   - Both cleanups are idempotent: `cleaned` boolean gates against
 *     'close' + 'error' firing back-to-back.
 */

/**
 * @param {{
 *   streamGenerator: import('events').EventEmitter,
 *   streamBuffer: Array<unknown>,
 *   STREAM_REPLAY_MAX: number,
 *   STREAM_HEARTBEAT_MS: number,
 * }} deps
 */
function createStreamModule(deps) {
  const { streamGenerator, streamBuffer, STREAM_REPLAY_MAX, STREAM_HEARTBEAT_MS } = deps;

  function handleStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      // Nginx/CF buffering would batch SSE frames and break realtime. Disable.
      'X-Accel-Buffering': 'no',
    });
    res.write(': ok\n\n'); // initial comment flushes headers, opens stream

    // Replay last N for context. Snapshot via slice — avoids race if buffer
    // mutates mid-iteration.
    const replay = streamBuffer.slice(-STREAM_REPLAY_MAX);
    for (const envelope of replay) {
      res.write('data: ' + JSON.stringify(envelope) + '\n\n');
    }

    const onSpecimen = (envelope) => {
      res.write('data: ' + JSON.stringify(envelope) + '\n\n');
    };
    streamGenerator.on('specimen', onSpecimen);

    const heartbeat = setInterval(() => res.write(': hb\n\n'), STREAM_HEARTBEAT_MS);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      streamGenerator.off('specimen', onSpecimen);
      clearInterval(heartbeat);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  }

  return {
    id: 'stream',
    routes: [{ method: 'GET', path: '/api/v1/stream', handler: handleStream }],
  };
}

module.exports = { createStreamModule };
