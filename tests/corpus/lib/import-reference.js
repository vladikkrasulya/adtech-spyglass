'use strict';

/**
 * Import the reviewed portable corpus, retaining wire payloads and attribution.
 * Expectations below follow the cited protocol contracts, never coreObservations.
 * Usage: node tests/corpus/lib/import-reference.js /path/ad-format-corpus.json
 * Re-import preserves separately reviewed known-gap annotations and mutations.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ROOT = path.join(__dirname, '..');
const CLASSIFICATION_NOTES = {
  'inpage-kadam-native-square':
    'Core/HTTP assert the Native request/response asset contract. This wire pair has no unambiguous inpage discriminator, so its inpage grouping is from vendor provenance; automatic inpage format tagging is not claimed.',
  'inpage-exads-native-501':
    'Core/HTTP assert the Native carrier asset contract. EXADS plcmttype 501 is a vendor-defined inpage placement signal, but automatic inpage tagging is not asserted by this case; it is a bounded classification coverage gap, not an invented IAB rule.',
  'push-exads-openrtb-native-500':
    'Core/HTTP assert the Native carrier asset contract. EXADS plcmttype 500 is a vendor-defined push placement signal, but automatic push tagging is not asserted by this case; it is a bounded classification coverage gap, not an invented IAB rule.',
};
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function unwrapNative(adm) {
  try {
    const parsed = typeof adm === 'string' ? JSON.parse(adm) : adm;
    return parsed && (parsed.native || parsed);
  } catch (_error) {
    return null;
  }
}

function firstBid(c) {
  const response = c.response.openrtb ? c.response.openrtb.response : c.response;
  return response.seatbid && response.seatbid[0] && response.seatbid[0].bid[0];
}

function creativeBody(bid) {
  if (bid.adm) return bid.adm;
  const ad = bid.media && bid.media.ad;
  return (
    ad &&
    ((ad.display && ad.display.adm) || (ad.video && ad.video.adm) || (ad.audio && ad.audio.adm))
  );
}

function creativeMarker(body) {
  const native = unwrapNative(body);
  if (native && Array.isArray(native.assets)) {
    const title = native.assets.find((asset) => asset.title);
    if (title) return title.title.text;
  }
  const text = String(body || '');
  const title = text.match(/<AdTitle[^>]*>(?:<!\[CDATA\[)?([^<\]]+)/i);
  if (title) return title[1].trim();
  const heading = text.match(/<(?:h[1-6]|strong|b|span)[^>]*>([^<]+)/i);
  if (heading) return heading[1].trim();
  if (/^https?:\/\//.test(text)) return text;
  return text
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function previewFor(c) {
  const bid = firstBid(c);
  const body = bid && creativeBody(bid);
  const declared = c.expectedPreview.kind;
  const kind = {
    html: 'markup',
    'native-card': 'native',
    'push-card': 'push',
    'inert-vast': 'vast',
    'inert-url': 'url',
  }[declared];
  const inert = kind === 'vast' || kind === 'url';
  const remoteArt = (c.assetRefs || []).length > 0 && (kind === 'native' || kind === 'push');
  let marker = body ? creativeMarker(body) : '';
  if (!marker) {
    const response = c.response;
    const material = Array.isArray(response)
      ? response[0]
      : response.bid ||
        (response.ads && response.ads[0]) ||
        (response.result && response.result.listing[0]);
    marker = material && (kind === 'url' ? material.url || material.link : material.title);
  }
  const preview = {
    kind: kind || 'unidentified',
    rendered: inert ? 'inert-text' : remoteArt ? 'partial' : 'full',
    mediaPlays: kind === 'vast' ? 'no' : 'n/a',
    marker: marker || c.id,
    limitation: remoteArt
      ? 'Remote creative assets are blocked by the preview content policy.'
      : null,
    capabilityGap:
      kind === 'vast'
        ? 'The current VAST preview is inert XML; video/audio playback and Wrapper resolution are not implemented.'
        : remoteArt
          ? 'Images remain blocked in the initial sealed preview; request interception does not bypass CSP.'
          : null,
  };
  const response = c.response.openrtb ? c.response.openrtb.response : c.response;
  const bids = [];
  (response.seatbid || []).forEach((seat, seatIndex) =>
    (seat.bid || []).forEach((item, bidIndex) => {
      bids.push({ seatIndex, bidIndex, marker: creativeMarker(creativeBody(item)) });
    }),
  );
  if (bids.length > 1) preview.bids = bids;
  return preview;
}

function expectations(c) {
  /** @type {any} */
  const e = {
    request: { maxLevel: 'warning' },
    response: { maxLevel: 'warning' },
    crosscheck: { empty: true },
    http: { status: 200 },
    preview: previewFor(c),
  };
  if (c.pairApplicability.kind !== 'bid-pair') {
    e.format = { formats: [c.format === 'pop' ? 'pops' : c.format] };
    if (typeof c.request === 'string') e.request.type = 'URL Request';
    return e;
  }
  const is30 = !!c.request.openrtb;
  const req = is30 ? c.request.openrtb.request : c.request;
  const res = is30 ? c.response.openrtb.response : c.response;
  const prefix = is30 ? 'openrtb.response.' : '';
  const items = is30 ? req.item : req.imp;
  e.request.type = 'oRTB BidRequest';
  e.response.type = 'oRTB BidResponse';
  /** @type {import('./oracle').FindingRef[]} */
  const refs = [
    { id: 'crosscheck.id_match', path: prefix + 'id', level: 'ok', params: { id: req.id } },
  ];
  const forbidden = [
    'crosscheck.id_mismatch',
    'crosscheck.bid.impid_unresolved',
    'crosscheck.bid.native_missing_assets',
    'crosscheck.bid.native_invalid_adm',
  ];
  (res.seatbid || []).forEach((seat, si) =>
    (seat.bid || []).forEach((bid, bi) => {
      const base = `${prefix}seatbid[${si}].bid[${bi}]`;
      const item = items.find((imp) => imp.id === bid[is30 ? 'item' : 'impid']);
      if (!item) throw new Error(c.id + ': source pair has an unmatched impression');
      refs.push({
        id: 'crosscheck.bid.impid_resolved',
        path: base + (is30 ? '.item' : '.impid'),
        level: 'ok',
      });
      const deal =
        !is30 && bid.dealid && item.pmp && (item.pmp.deals || []).find((d) => d.id === bid.dealid);
      const floor = is30 ? item.flr : deal ? deal.bidfloor : item.bidfloor;
      const currency = is30 ? item.flrcur : deal ? deal.bidfloorcur : item.bidfloorcur;
      if (typeof floor === 'number' && (currency || 'USD') === (res.cur || 'USD')) {
        refs.push({
          id: 'crosscheck.bid.above_floor',
          path: base + '.price',
          level: 'ok',
          params: { floor: floor.toFixed(4) },
        });
      }
      if (item.native)
        refs.push({ id: 'crosscheck.bid.native_complete', path: base + '.adm', level: 'ok' });
      if (item.banner)
        refs.push({ id: 'crosscheck.bid.size_match', path: base + '.size', level: 'ok' });
    }),
  );
  e.crosscheck = { must: refs, mustNot: forbidden };
  if (c.format === 'audio') e.response.mustNot = ['vast.mediafile_type_invalid'];
  if (c.dialect === 'iab')
    e.format = {
      formats: [c.format],
      contexts:
        c.context === 'ctv' && req.app
          ? ['ctv', 'inapp']
          : [c.context === 'in-app' ? 'inapp' : c.context],
    };
  if (is30) {
    e.response.mustNot = ['err-bid-currency-mismatch'];
    e.crosscheck.mustNot.push('crosscheck.bid.floor_currency_mismatch');
  }
  return e;
}

function normalize(c, archive, archiveSha256) {
  const sourceIds = c.provenance.sourceIds;
  const sources = sourceIds.map((id) => archive.sources.find((source) => source.id === id));
  if (sources.some((source) => !source)) throw new Error(c.id + ': unresolved source ID');
  const primary = sources[0];
  const proto = /^openrtb-/.test(c.protocol)
    ? c.protocol.replace('openrtb-', 'ortb-')
    : /openrtb/.test(c.protocol)
      ? 'ortb-2.5'
      : 'jsonfeed';
  const context = c.context === 'in-app' ? 'inapp' : c.context;
  return {
    kind: 'pair',
    id: c.id,
    title: c.variant,
    format: c.format,
    protocol: proto,
    context,
    dialect: c.dialect === 'iab' ? 'iab' : 'ext-rtb',
    scenario: 'pair',
    tags: ['public-reference', c.expectedSemantics.validity, c.dialect, c.protocol],
    provenance: {
      synthetic: true,
      source: {
        name: primary.title,
        url: primary.url,
        version: primary.revision || 'accessed ' + primary.accessedAt,
        license: c.provenance.license || primary.licenseNote,
        notes: 'All source records are retained in assets/sources.json by reference.sourceIds.',
      },
      modifications: c.provenance.changes || [],
      sanitized:
        typeof c.provenance.sanitized === 'string'
          ? c.provenance.sanitized
          : 'Only independently authored synthetic identifiers and reserved domains; no real subscriber IDs, device advertising IDs or consent strings. TEST-NET addresses only.',
      notes: c.provenance.kind,
    },
    reference: {
      wireProtocol: c.protocol,
      vendorDialect: c.dialect,
      validity: c.expectedSemantics.validity,
      pairApplicability: clone(c.pairApplicability),
      sourceIds,
      archiveSha256,
    },
    assetRefs: c.assetRefs || [],
    request: c.request,
    response: c.response,
    specNotes: [
      ...c.expectedSemantics.notes,
      ...c.expectedPreview.notes,
      ...(CLASSIFICATION_NOTES[c.id] ? [CLASSIFICATION_NOTES[c.id]] : []),
    ],
    notes: [
      'Core observations in the source archive were deliberately excluded from expectations. Protocol metadata may describe a vendor-specific 2.x carrier; it does not claim a normative minor-version inference.',
    ],
    expect: expectations(c),
    knownGap: null,
  };
}

function importArchive(file, output = ROOT) {
  const bytes = fs.readFileSync(file);
  const archive = JSON.parse(bytes.toString('utf8'));
  const archiveSha256 = digest(bytes);
  const manifest = { schemaVersion: 1, sourceArchiveSha256: archiveSha256, assets: [] };
  const extensions = {
    'image/svg+xml': 'svg',
    'image/png': 'png',
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'application/xml': 'xml',
    'text/xml': 'xml',
  };
  for (const asset of archive.assets) {
    if (!/^asset-[a-f0-9]+$/.test(asset.id)) throw new Error('Unsafe asset ID');
    const encoded = Buffer.from(
      asset.body,
      asset.bodyEncoding.includes('base64') ? 'base64' : 'utf8',
    );
    const body = asset.bodyEncoding === 'gzip+base64' ? zlib.gunzipSync(encoded) : encoded;
    if (digest(body) !== asset.sha256) throw new Error(asset.id + ': asset hash mismatch');
    const relative = `${asset.id}.${extensions[asset.contentType] || 'bin'}`;
    fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(output, 'assets', relative), body);
    const record = {
      id: asset.id,
      url: asset.url,
      contentType: asset.contentType,
      path: relative,
      sha256: asset.sha256,
      role: asset.role,
      byteLength: body.length,
    };
    for (const key of ['width', 'height', 'durationSeconds'])
      if (asset[key] !== undefined) record[key] = asset[key];
    manifest.assets.push(record);
  }
  writeJson(path.join(output, 'assets', 'manifest.json'), manifest);
  writeJson(path.join(output, 'assets', 'sources.json'), {
    schemaVersion: 1,
    sourceArchiveSha256: archiveSha256,
    sources: archive.sources,
  });
  for (const original of archive.cases) {
    const c = normalize(original, archive, archiveSha256);
    const filePath = path.join(output, 'pairs', c.format, c.id + '.json');
    if (fs.existsSync(filePath))
      c.knownGap = JSON.parse(fs.readFileSync(filePath, 'utf8')).knownGap || null;
    writeJson(filePath, c);
  }
  return { cases: archive.cases.length, assets: manifest.assets.length, archiveSha256 };
}

if (require.main === module) {
  if (!process.argv[2])
    throw new Error('Usage: node tests/corpus/lib/import-reference.js /path/ad-format-corpus.json');
  process.stdout.write(JSON.stringify(importArchive(process.argv[2])) + '\n');
}
module.exports = { importArchive, normalize, expectations, previewFor, creativeMarker };
