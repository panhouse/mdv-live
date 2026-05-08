/**
 * Single source of truth for application error codes, HTTP status mapping,
 * and error construction.
 *
 * Replaces the four duplicated `mkError` helpers and the scattered
 * status-code logic that the audit flagged.
 */

export const ERROR_STATUS = Object.freeze({
  PATH_INVALID: 403,
  NOT_FOUND: 404,
  NOT_MARP: 400,
  OUT_OF_RANGE: 400,
  INVALID_NOTE: 400,
  MULTI_NOTE_READONLY: 409,
  STALE: 412,
  IF_MATCH_REQUIRED: 428,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  ORIGIN_REJECTED: 403,
  READONLY: 403,
  NOT_PARSEABLE: 500,
  WRITE_FAILED: 500,
  READ_FAILED: 500,
  // client-only codes (do not produce HTTP responses)
  NETWORK_ERROR: 0,
  DEGRADED: 0
});

/** Construct a coded Error with optional `cause`. */
export function mkError(code, message, opts = {}) {
  const err = new Error(message || code);
  err.code = code;
  if (opts.cause) err.cause = opts.cause;
  if (opts.currentEtag) err.currentEtag = opts.currentEtag;
  return err;
}

/** Send an Error as a normalized JSON response. Stack traces are NOT leaked. */
export function sendError(res, err) {
  const code = err && err.code in ERROR_STATUS ? err.code : 'WRITE_FAILED';
  const status = ERROR_STATUS[code] || 500;
  const payload = {
    ok: false,
    code,
    error: (err && err.message) || code
  };
  if (err && err.currentEtag) payload.currentEtag = err.currentEtag;
  return res.status(status).json(payload);
}
