/**
 * Common guards / preconditions for the marpNote endpoints.
 *
 * Each function returns an Error (with `.code`) on rejection or `null` on
 * success. The caller then uses `sendError(res, err)` from utils/errors.js.
 */

import { mkError } from '../../utils/errors.js';
import { validateNoteText } from '../../rendering/marpNoteWriter.js';

const MAX_SLIDE_INDEX = 1000;

export function buildAllowedHosts(port) {
  return [`localhost:${port}`, `127.0.0.1:${port}`];
}

/** Origin / Sec-Fetch-Site judgement (CSRF / DNS rebinding defence). */
export function checkOrigin(req, allowedHosts) {
  const origin = req.get('Origin');
  if (origin) {
    for (const host of allowedHosts) {
      if (origin === `http://${host}`) return null;
    }
    return mkError('ORIGIN_REJECTED', 'origin not allowed');
  }
  if (req.get('Sec-Fetch-Site') === 'same-origin') return null;
  return mkError('ORIGIN_REJECTED', 'origin not allowed');
}

export function checkHost(req, allowedHosts) {
  const host = req.get('Host');
  if (host && allowedHosts.includes(host)) return null;
  return mkError('ORIGIN_REJECTED', 'host header not allowed');
}

export function checkJsonContent(req) {
  const ct = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (ct === 'application/json') return null;
  return mkError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
}

export function checkIfMatch(req) {
  if (req.get('If-Match')) return null;
  return mkError('IF_MATCH_REQUIRED', 'If-Match header required');
}

export function parseSlideIndex(req) {
  const n = Number(req.params.slideIndex);
  if (!Number.isInteger(n) || n < 0 || n >= MAX_SLIDE_INDEX) {
    return { error: mkError('OUT_OF_RANGE', 'slideIndex out of range') };
  }
  return { value: n };
}

export function sanitiseRelativePath(decoded) {
  // Express already decoded :encodedPath route param; do not decode again.
  if (typeof decoded !== 'string') return null;
  if (decoded.length === 0 || decoded.length > 1024) return null;
  if (decoded.includes('\0')) return null;
  return decoded;
}

/** Pull and validate the `note` field from the request body. */
export function extractNote(req) {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return { error: mkError('INVALID_NOTE', 'body must be JSON object') };
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'note')) {
    return { error: mkError('INVALID_NOTE', 'note required') };
  }
  const note = body.note;
  if (typeof note !== 'string') {
    return { error: mkError('INVALID_NOTE', 'note must be string') };
  }
  const reason = validateNoteText(note);
  if (reason) return { error: mkError('INVALID_NOTE', reason) };
  return { value: note };
}
