'use strict';

/**
 * Spyglass — Phase 1 synthetic generator.
 *
 * Loads JSON fixtures from `samples/` (peer files), then on a timer emits
 * mutated copies as if they were a live RTB feed. Consumers subscribe to
 * the `'specimen'` event to receive `{ source, specimen, emittedAt }`.
 *
 * Why this exists: until commercial-traffic approval clears (Risk B in
 * docs/stream-platform-pivot-2026-05-05.md), the public Stream surface
 * is fed from this generator. The mutation engine ensures each emitted
 * row in the UI looks like a unique event, not a literal duplicate.
 *
 * What it deliberately does NOT do:
 *   - Touch the network. Pure in-process EventEmitter.
 *   - Validate or anonymize. Those are downstream concerns (Step 1.2).
 *   - Persist. Each emitted specimen is fire-and-forget; the ring buffer
 *     in server.js will be the only retention layer.
 *
 * Usage:
 *
 *   const SyntheticGenerator = require('./samples/synthetic-generator');
 *   const gen = new SyntheticGenerator({ intervalMs: 2000 });
 *   gen.loadCorpus();
 *   gen.on('specimen', ({ source, specimen, emittedAt }) => { ... });
 *   gen.start();
 *
 * CLI mode (standalone smoke test):
 *
 *   node samples/synthetic-generator.js
 *   SYNTHETIC_RATE_MS=500 node samples/synthetic-generator.js
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const { pickCreative } = require('./creative-picker');

const DEFAULT_INTERVAL_MS = 1000;

class SyntheticGenerator extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.corpusDir]  Directory with `.json` fixtures.
   *                                   Defaults to this file's directory.
   * @param {number} [opts.intervalMs] Emit cadence. Defaults to 2000ms.
   */
  constructor(opts = {}) {
    super();
    this.corpusDir = opts.corpusDir || __dirname;
    this.intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : DEFAULT_INTERVAL_MS;
    this.corpus = []; // [{ name, base }, ...]
    this.timer = null;
    this.cursor = 0;
    this.emittedCount = 0;
  }

  /**
   * Read all `.json` files from corpusDir into memory. Idempotent.
   * @returns {number} corpus size
   */
  loadCorpus() {
    const files = fs
      .readdirSync(this.corpusDir)
      .filter((f) => f.endsWith('.json'))
      .sort(); // deterministic order for round-robin
    this.corpus = files.map((name) => {
      const raw = fs.readFileSync(path.join(this.corpusDir, name), 'utf8');
      return { name, base: JSON.parse(raw) };
    });
    if (this.corpus.length === 0) {
      throw new Error(`SyntheticGenerator: no .json fixtures in ${this.corpusDir}`);
    }
    return this.corpus.length;
  }

  /**
   * Produce a mutated copy of a base specimen.
   *
   * Mutation policy (Phase 1, intentionally minimal):
   *   - Deep-clone via JSON to avoid touching corpus
   *   - Replace request `id` with a unique synthetic id
   *   - Realign `source.tid` to match the new id (per oRTB convention)
   *
   * Other fields (imp ids, geo, device) stay constant. They will become
   * mutable in Phase 2 when corpus expands and we need more visual
   * variation in the stream.
   *
   * @param {object} base
   * @returns {{ specimen: object, emittedAt: number }}
   */
  mutate(base) {
    const clone = JSON.parse(JSON.stringify(base));
    const emittedAt = Date.now();
    const newId = `syn-${emittedAt}-${randomUUID().slice(0, 8)}`;
    clone.id = newId;
    if (clone.source && typeof clone.source === 'object' && 'tid' in clone.source) {
      clone.source.tid = newId;
    }
    return { specimen: clone, emittedAt };
  }

  /**
   * Pick the next base sample (round-robin), mutate, emit.
   * Returns the emitted specimen (useful for tests).
   */
  next() {
    if (this.corpus.length === 0) {
      throw new Error('SyntheticGenerator: corpus not loaded — call loadCorpus() first');
    }
    const item = this.corpus[this.cursor % this.corpus.length];
    this.cursor++;
    const { specimen, emittedAt } = this.mutate(item.base);
    this.emittedCount++;
    // Pick a deterministic placeholder creative for the stream thumb.
    // `creative` is a bare ref (filename minus .svg); the client
    // resolves it against /assets/creatives/. Null when picker can't
    // route the format (defensive — never observed in normal corpus).
    const creative = pickCreative(specimen);
    this.emit('specimen', { source: item.name, specimen, emittedAt, creative });
    return specimen;
  }

  /**
   * Begin emitting on the configured interval. Idempotent.
   */
  start() {
    if (this.timer) return this;
    if (this.corpus.length === 0) this.loadCorpus();
    this.timer = setInterval(() => {
      try {
        this.next();
      } catch (err) {
        this.emit('error', err);
      }
    }, this.intervalMs);
    this.emit('start');
    return this;
  }

  /**
   * Stop the timer. Idempotent. Subscribers are NOT removed.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.emit('stop');
    }
    return this;
  }

  /**
   * Snapshot of generator state. Cheap to call; safe for /health endpoints.
   */
  stats() {
    return {
      running: this.timer !== null,
      corpusSize: this.corpus.length,
      corpusFiles: this.corpus.map((c) => c.name),
      intervalMs: this.intervalMs,
      emittedCount: this.emittedCount,
      cursor: this.cursor,
    };
  }
}

module.exports = SyntheticGenerator;

// ── CLI mode ────────────────────────────────────────────────────────────
// Run directly to smoke-test:
//   node samples/synthetic-generator.js
// Override cadence via env:
//   SYNTHETIC_RATE_MS=500 node samples/synthetic-generator.js
if (require.main === module) {
  const intervalMs = parseInt(process.env.SYNTHETIC_RATE_MS, 10) || DEFAULT_INTERVAL_MS;
  const gen = new SyntheticGenerator({ intervalMs });
  const loaded = gen.loadCorpus();
  process.stdout.write(`[gen] loaded ${loaded} samples from ${gen.corpusDir}\n`);
  process.stdout.write(`[gen] cadence: ${intervalMs}ms — Ctrl+C to stop\n\n`);

  gen.on('specimen', ({ source, specimen, emittedAt }) => {
    const ctx = specimen.site
      ? `site=${specimen.site.domain || '?'}`
      : specimen.app
        ? `app=${specimen.app.bundle || '?'}`
        : 'ctx=?';
    const impCount = Array.isArray(specimen.imp) ? specimen.imp.length : 0;
    const fmt = (() => {
      const imp0 = specimen.imp && specimen.imp[0];
      if (!imp0) return '?';
      if (imp0.banner) return 'banner';
      if (imp0.video) return 'video';
      if (imp0.native) return 'native';
      if (imp0.audio) return 'audio';
      return '?';
    })();
    process.stdout.write(
      `${new Date(emittedAt).toISOString()}  ${source.padEnd(32)} ${fmt.padEnd(7)} imp=${impCount}  ${ctx}  id=${specimen.id}\n`,
    );
  });

  gen.on('error', (err) => {
    process.stderr.write(`[gen] ERROR: ${err.message}\n`);
  });

  process.on('SIGINT', () => {
    gen.stop();
    process.stdout.write(`\n[gen] stopped. ${JSON.stringify(gen.stats(), null, 2)}\n`);
    process.exit(0);
  });

  gen.start();
}
