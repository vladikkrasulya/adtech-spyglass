'use strict';

/**
 * AdPod / multi-bid video+audio validation — IAB OpenRTB 2.6 §3.2.7 / §3.2.8.
 *
 * AdPod fields (`podid`, `podseq`, `minadlen`, `maxadlen`) on imp.video and
 * imp.audio govern multi-bid ad pod auctions. Misconfigured pod fields
 * cause the exchange to treat the impression as a standalone slot and
 * silently ignore pod logic.
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#327-object-video
 *       https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#328-object-audio
 *
 * Rules:
 *   err-pod-id-seq-mismatch    — podid/podseq must be used together
 *   err-podseq-invalid         — podseq is present but not a non-negative integer
 *   err-pod-len-mismatch       — minadlen > maxadlen
 *   err-pod-len-invalid        — minadlen or maxadlen is not a positive integer
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

/**
 * Validate pod-related fields on a single video/audio object.
 * @param {object} media   The video or audio sub-object
 * @param {string} path    JSON path prefix (e.g. "imp[0].video")
 * @param {Array}  findings  Accumulator
 */
function validatePodFields(media, path, findings) {
  if (!media || typeof media !== 'object') return;

  const hasPodId  = media.podid  != null;
  const hasPodSeq = media.podseq != null;

  // podid and podseq are coupled — either both or neither
  if (hasPodId !== hasPodSeq) {
    findings.push(F('err-pod-id-seq-mismatch', LEVELS.ERROR, path, {
      has: hasPodId ? 'podid' : 'podseq',
      missing: hasPodId ? 'podseq' : 'podid',
    }));
  }

  // podseq — must be a non-negative integer when present
  if (hasPodSeq) {
    const seq = media.podseq;
    if (!Number.isInteger(seq) || seq < 0) {
      findings.push(F('err-podseq-invalid', LEVELS.ERROR, path + '.podseq', { val: String(seq) }));
    }
  }

  // minadlen / maxadlen — sanity checks when either or both are present
  const hasMin = media.minadlen != null;
  const hasMax = media.maxadlen != null;

  if (hasMin || hasMax) {
    // Type check — each must be a positive integer
    if (hasMin && (!Number.isInteger(media.minadlen) || media.minadlen <= 0)) {
      findings.push(F('err-pod-len-invalid', LEVELS.ERROR, path + '.minadlen', {
        field: 'minadlen', val: String(media.minadlen),
      }));
    }
    if (hasMax && (!Number.isInteger(media.maxadlen) || media.maxadlen <= 0)) {
      findings.push(F('err-pod-len-invalid', LEVELS.ERROR, path + '.maxadlen', {
        field: 'maxadlen', val: String(media.maxadlen),
      }));
    }

    // Range check — only meaningful when both are present and valid
    if (
      hasMin && hasMax &&
      Number.isInteger(media.minadlen) && media.minadlen > 0 &&
      Number.isInteger(media.maxadlen) && media.maxadlen > 0 &&
      media.minadlen > media.maxadlen
    ) {
      findings.push(F('err-pod-len-mismatch', LEVELS.ERROR, path, {
        min: media.minadlen,
        max: media.maxadlen,
      }));
    }
  }
}

function validate(req /*, ctx */) {
  const findings = [];
  if (!req || !Array.isArray(req.imp)) return findings;

  req.imp.forEach((imp, i) => {
    if (!imp || typeof imp !== 'object') return;

    if (imp.video && typeof imp.video === 'object') {
      validatePodFields(imp.video, `imp[${i}].video`, findings);
    }
    if (imp.audio && typeof imp.audio === 'object') {
      validatePodFields(imp.audio, `imp[${i}].audio`, findings);
    }
  });

  return findings;
}

module.exports = {
  id: 'adpod',
  description: 'Validates AdPod fields on imp.video/imp.audio: podid/podseq coupling and minadlen/maxadlen sanity.',
  appliesTo: ['ORTB_REQUEST'],
  validate,
};
