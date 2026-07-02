'use strict';

/**
 * AdPod / multi-bid video+audio validation — IAB OpenRTB 2.6 §3.2.7 / §3.2.8.
 *
 * AdPod fields (`podid`, `podseq`, `poddur`, `maxseq`, `minduration`,
 * `maxduration`, `rqddurs`) on imp.video and imp.audio govern multi-bid ad pod auctions.
 * Misconfigured pod fields cause the exchange to treat the impression as a
 * standalone slot and silently ignore pod logic.
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#327-object-video
 *       https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#328-object-audio
 *
 * Rules:
 *   err-pod-len-invalid    — minduration not a whole number >= 0, or
 *                            maxduration/poddur/maxseq not a positive integer
 *   err-pod-len-mismatch   — minduration > maxduration (when both present)
 *   err-podseq-invalid     — podseq not one of -1 (last), 0 (any), 1 (first)
 *   err-podid-invalid      — podid is present but not a non-empty string or
 *                            positive integer
 *   err-rqddurs-invalid    — rqddurs not a non-empty array of positive integers
 *   err-rqddurs-conflict   — rqddurs present with minduration or maxduration
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;
const VALID_PODSEQ = new Set([-1, 0, 1]);

function isValidRqddurs(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const item of value) {
    if (!Number.isInteger(item) || item <= 0) return false;
  }
  return true;
}

/**
 * Validate pod-related fields on a single video/audio object.
 * @param {object} media   The video or audio sub-object
 * @param {string} path    JSON path prefix (e.g. "imp[0].video")
 * @param {Array}  findings  Accumulator
 */
function validatePodFields(media, path, findings) {
  if (!media || typeof media !== 'object') return;

  if (media.minduration != null) {
    if (!Number.isInteger(media.minduration) || media.minduration < 0) {
      findings.push(
        F('err-pod-len-invalid', LEVELS.ERROR, `${path}.minduration`, {
          field: 'minduration',
          val: String(media.minduration),
        }),
      );
    }
  }

  const posIntFields = ['maxduration', 'poddur', 'maxseq'];
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

  if (media.minduration != null && media.maxduration != null) {
    const minOk = Number.isInteger(media.minduration) && media.minduration >= 0;
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

  if (media.podseq != null) {
    if (!Number.isInteger(media.podseq) || !VALID_PODSEQ.has(media.podseq)) {
      findings.push(
        F('err-podseq-invalid', LEVELS.ERROR, `${path}.podseq`, {
          val: String(media.podseq),
        }),
      );
    }
  }

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

  if (media.rqddurs != null) {
    if (!isValidRqddurs(media.rqddurs)) {
      findings.push(
        F('err-rqddurs-invalid', LEVELS.ERROR, `${path}.rqddurs`, {
          val: JSON.stringify(media.rqddurs),
        }),
      );
    }
    if (media.minduration != null || media.maxduration != null) {
      findings.push(F('err-rqddurs-conflict', LEVELS.ERROR, path, {}));
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
    'Validates AdPod fields on imp.video/imp.audio: minduration >= 0, maxduration/poddur/maxseq positive integers, podseq in {-1,0,1}, rqddurs array.',
  appliesTo: ['ORTB_REQUEST'],
  validate,
};
