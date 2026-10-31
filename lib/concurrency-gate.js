'use strict';

/**
 * lib/concurrency-gate.js — bounded concurrency with a short, bounded queue.
 *
 * The local model runner serves one request at a time. Without a gate every
 * caller sends its request at once and waits inside the runner's own queue, with
 * its per-call timeout already running: under load the callers at the back of
 * that invisible queue time out without ever having been served, and each one
 * still costs the runner an abandoned job. The gate moves the waiting in front
 * of the call, where it can be bounded and answered honestly:
 *
 *   - at most `maxActive` calls run at once;
 *   - at most `maxQueue` more may wait, each for at most `maxWaitMs`;
 *   - anything beyond that is refused at once with code `gate_full`, and a
 *     waiter whose turn does not come in time with `gate_wait_timeout`.
 *
 * The caller maps both to one "busy, try again shortly" answer.
 */

/**
 * @param {string} message
 * @param {'gate_full'|'gate_wait_timeout'} code
 */
function gateError(message, code) {
  return Object.assign(new Error(message), { code });
}

/**
 * @param {{maxActive?: number, maxQueue?: number, maxWaitMs?: number}} [opts]
 */
function createGate(opts = {}) {
  const maxActive = Math.max(1, Math.floor(opts.maxActive || 1));
  const maxQueue = Math.max(0, Math.floor(opts.maxQueue === undefined ? 4 : opts.maxQueue));
  const maxWaitMs = Math.max(1, Number(opts.maxWaitMs) || 12_000);

  let active = 0;
  /** @type {Array<{start: () => void, cancel: () => void}>} */
  const waiting = [];

  function release() {
    active -= 1;
    const next = waiting.shift();
    if (next) next.start();
  }

  /**
   * Run `fn` when a slot is free.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function run(fn) {
    const exec = () => {
      active += 1;
      return Promise.resolve().then(fn).finally(release);
    };
    if (active < maxActive) return exec();
    if (waiting.length >= maxQueue) {
      return Promise.reject(gateError('The model queue is full', 'gate_full'));
    }
    return new Promise((resolve, reject) => {
      const entry = {
        start() {
          clearTimeout(timer);
          exec().then(resolve, reject);
        },
        cancel() {
          reject(gateError('Timed out waiting for the model', 'gate_wait_timeout'));
        },
      };
      const timer = setTimeout(() => {
        const i = waiting.indexOf(entry);
        if (i >= 0) {
          waiting.splice(i, 1);
          entry.cancel();
        }
      }, maxWaitMs);
      timer.unref();
      waiting.push(entry);
    });
  }

  return {
    run,
    stats: () => ({ active, queued: waiting.length, maxActive, maxQueue, maxWaitMs }),
  };
}

module.exports = { createGate };
