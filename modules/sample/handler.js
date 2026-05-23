'use strict';

/**
 * modules/sample/handler.js — GET /api/v1/sample
 *
 * Extracted from server.js as part of the backend-module migration
 * (see lib/router.js narrow waist). Returns one synthetic example
 * pulled from the on-disk samples/ corpus so the Playground's
 * "🎲 приклад" button can pre-fill request + response editors with
 * real-looking JSON.
 *
 * Handler has no closure deps — only fs/path + shared http helpers —
 * so it exports the plain module shape rather than the factory shape
 * used by replay/health.
 *
 * Sample-shape autodetect (kept verbatim from server.js):
 *   - has `seatbid`            → 2.x BidResponse; synthesise minimal request
 *   - has `openrtb.response{}` → 3.0 BidResponse; load into response editor
 *   - has imp[]/item[]/openrtb → BidRequest; load into request editor
 */

const fs = require('fs');
const path = require('path');
const { sendJson, sendError } = require('../../lib/http');

// Resolve samples/ relative to the project root. __dirname here is
// .../modules/sample/, so '..', '..' walks up to the root where the
// samples/ directory lives. Using an absolute path here keeps the
// handler indifferent to process.cwd().
const SAMPLES_DIR = path.join(__dirname, '..', '..', 'samples');

function handleSample(req, res) {
  try {
    const dir = SAMPLES_DIR;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('synthetic-') && f.endsWith('.json'));
    if (!files.length) return sendError(res, 503, 'no_samples', 'Sample corpus is empty');
    // Optional ?type=<slug> picks a specific specimen (e.g. type=clean-banner,
    // type=frame-bust-form). Slug is matched against the filename minus the
    // 'synthetic-' prefix and '.json' suffix. Anything unmatched falls back
    // to random — keeps the URL forgiving for bookmarks / typos.
    const url = new URL(req.url, 'http://x');
    const wanted = (url.searchParams.get('type') || '').trim();
    let pick = null;
    if (wanted) {
      const match = files.find((f) => f === 'synthetic-' + wanted + '.json');
      if (match) pick = match;
    }
    if (!pick) pick = files[Math.floor(Math.random() * files.length)];
    const sample = JSON.parse(fs.readFileSync(path.join(dir, pick), 'utf8'));
    const note = sample._note;
    const label = pick
      .replace(/^synthetic-/, '')
      .replace(/\.json$/, '')
      .replace(/-/g, ' ');

    // Sample shape autodetect:
    //   - has `seatbid` → it IS a BidResponse; synthesize a matching 2.x
    //     BidRequest from the first bid (today's path, used by every
    //     creative-attack specimen)
    //   - has `openrtb` OR top-level `item[]` OR top-level `imp[]` → it
    //     IS a BidRequest; load it directly into the request editor and
    //     leave the response editor empty (used by 3.0 samples + future
    //     request-only specimens)
    const isPlainObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
    // Three discriminators:
    //   1. legacy 2.x BidResponse — has top-level `seatbid[]`
    //   2. oRTB 3.0 BidResponse — has `openrtb.response{}` envelope
    //   3. BidRequest (2.x or 3.0) — has imp[] / item[] / openrtb.request{}
    //      OR `openrtb` envelope without `response` (broken 3.0 request)
    const is2xResponse = Array.isArray(sample.seatbid);
    const is30Response = isPlainObj(sample.openrtb) && isPlainObj(sample.openrtb.response);
    const isBidResponse = is2xResponse || is30Response;
    const isBidRequest =
      !isBidResponse &&
      (isPlainObj(sample.openrtb) || Array.isArray(sample.item) || Array.isArray(sample.imp));
    const cleanSample = Object.assign({}, sample);
    delete cleanSample._note;

    if (isBidRequest) {
      sendJson(res, 200, {
        success: true,
        label,
        _note: note,
        bid_request: cleanSample,
        bid_response: {},
      });
      return;
    }

    if (is30Response) {
      // 3.0 BidResponse — load into the response editor, leave request
      // editor empty (no synthesized 2.x request would make sense here).
      sendJson(res, 200, {
        success: true,
        label,
        _note: note,
        bid_request: {},
        bid_response: cleanSample,
      });
      return;
    }

    // Default: treat as BidResponse and synthesize a minimal 2.x request.
    const firstBid =
      (sample.seatbid && sample.seatbid[0] && sample.seatbid[0].bid && sample.seatbid[0].bid[0]) ||
      {};
    const request = {
      id: 'demo-' + String(sample.id || 'sample').slice(0, 40),
      imp: [
        {
          id: firstBid.impid || '1',
          banner: {
            w: firstBid.w || 300,
            h: firstBid.h || 250,
          },
          bidfloor: 0.1,
          bidfloorcur: 'USD',
        },
      ],
      site: {
        id: 'demo-site',
        domain: 'example.com',
        page: 'https://example.com/demo',
        cat: ['IAB1'],
      },
      device: {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ip: '203.0.113.42',
        devicetype: 2,
      },
      user: { id: 'demo-user' },
      at: 2,
      tmax: 200,
      cur: ['USD'],
    };
    sendJson(res, 200, {
      success: true,
      label,
      _note: note,
      bid_request: request,
      bid_response: cleanSample,
    });
  } catch (e) {
    sendError(res, 500, 'sample_failed', e.message);
  }
}

// ── GET /api/sample-preview/:id ─────────────────────────────────────────────
// Public, no-auth endpoint feeding the "Try with sample" CTA on the hero.
// Three curated fixtures, fixed whitelist so the URL is bookmarkable and the
// caller doesn't need to know the on-disk filenames. Returns the raw fixture
// JSON wrapped so the client doesn't have to second-guess the shape.
const PREVIEW_FIXTURES = {
  banner26: { file: 'iab-banner-valid.json', label: 'OpenRTB 2.6 banner' },
  video26: { file: 'iab-video-valid.json', label: 'OpenRTB 2.6 video' },
  env30: { file: 'synthetic-ortb30-clean.json', label: 'OpenRTB 3.0 envelope' },
};

function handlePreview(req, res, _parsed, match) {
  const id = (match && match.params && match.params.id) || '';
  const fixture = PREVIEW_FIXTURES[id];
  if (!fixture) {
    return sendError(res, 404, 'unknown_preview', 'Unknown sample preview id');
  }
  try {
    const raw = fs.readFileSync(path.join(SAMPLES_DIR, fixture.file), 'utf8');
    const json = JSON.parse(raw);
    // Strip the human-targeted _note for parity with handleSample (which
    // delete-strips it via cleanSample). Otherwise the preview UX shows
    // an extra field in the editor that the corpus sample doesn't.
    if (json && typeof json === 'object') delete json._note;
    res.setHeader('Cache-Control', 'public, max-age=3600');
    sendJson(res, 200, { ok: true, id, label: fixture.label, json });
  } catch (e) {
    sendError(res, 500, 'preview_failed', e.message);
  }
}

module.exports = {
  id: 'sample',
  routes: [
    { method: 'GET', path: '/api/v1/sample', handler: handleSample },
    { method: 'GET', path: '/api/sample-preview/:id', handler: handlePreview },
  ],
};
