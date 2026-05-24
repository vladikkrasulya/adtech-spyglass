'use strict';

/**
 * AdPod / multi-bid video+audio validation — IAB OpenRTB 2.6 §3.2.7 / §3.2.8.
 *
 * AdPod fields (`podid`, `podseq`, `poddur`, `maxseq`, `minduration`,
 * `maxduration`) on imp.video and imp.audio govern multi-bid ad pod auctions.
 * Misconfigured pod fields cause the exchange to treat the impression as a
 * standalone slot and silently ignore pod logic.
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#327-object-video
 *       https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#328-object-audio
 *
 * Rules:
 *   err-pod-len-invalid    — minduration, maxduration, poddur, or maxseq is
 *                            present but not a positive integer
 *   err-pod-len-mismatch   — minduration > maxduration (when both present)
 *   err-podseq-invalid     — podseq is present but not a non-negative integer
 *   err-podid-invalid      — podid is present but not a non-empty string or
 *                            positive integer
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

  // minduration, maxduration, poddur, maxseq — each must be a positive integer when present
  const posIntFields = ['minduration', 'maxduration', 'poddur', 'maxseq'];
  for (const field of posIntFields) {
    if (media[field] != null) {
      if (!Number.isInteger(media[field]) || media[field] <= 0) {
        findings.push(
          F('err-pod-len-invalid', LEVELS.ERROR, `${path}.${field}`, {
            field,
            val: String(media[field]),
          }),
        );
      }
    }
  }

  // minduration <= maxduration when both are present and valid
  if (media.minduration != null && media.maxduration != null) {
    const minOk = Number.isInteger(media.minduration) && media.minduration > 0;
    const maxOk = Number.isInteger(media.maxduration) && media.maxduration > 0;
    if (minOk && maxOk && media.minduration > media.maxduration) {
      findings.push(
        F('err-pod-len-mismatch', LEVELS.ERROR, path, {
          min: media.minduration,
          max: media.maxduration,
        }),
      );
    }
  }

  // podseq — must be a non-negative integer when present
  if (media.podseq != null) {
    if (!Number.isInteger(media.podseq) || media.podseq < 0) {
      findings.push(
        F('err-podseq-invalid', LEVELS.ERROR, `${path}.podseq`, {
          val: String(media.podseq),
        }),
      );
    }
  }

  // podid — must be a non-empty string OR a positive integer when present
  if (media.podid != null) {
    const valid =
      (typeof media.podid === 'string' && media.podid.length > 0) ||
      (Number.isInteger(media.podid) && media.podid > 0);
    if (!valid) {
      findings.push(
        F('err-podid-invalid', LEVELS.ERROR, `${path}.podid`, {
          val: String(media.podid),
        }),
      );
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
  description:
    'Validates AdPod fields on imp.video/imp.audio: minduration/maxduration/poddur/maxseq positive integers, podseq non-negative, podid string/int.',
  appliesTo: ['ORTB_REQUEST'],
  validate,
};
