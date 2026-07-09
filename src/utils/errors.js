/**
 * Single source of truth for application error codes, HTTP status mapping,
 * and error construction.
 *
 * Replaces the four duplicated `mkError` helpers and the scattered
 * status-code logic that the audit flagged.
 *
 * KEEP IN SYNC with src/static/lib/errorCodes.js ERROR_CODES — that file
 * mirrors every key below (plus a few client-only codes) so frontend
 * modules can compare against `ERROR_CODES.X` instead of hand-typing the
 * string. If you add/rename a code here, update the other file too.
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
  // Added so src/api/file.js, tree.js, pdf.js, upload.js can migrate their
  // hand-rolled res.status().json({error}) calls to sendError() without
  // changing any HTTP status (see refactoring-2026-07-strategy.md Phase 2).
  PATH_REQUIRED: 400, // "Path is required" / "filePath is required"
  ACCESS_DENIED: 403, // "Access denied" (validatePath/validatePathReal failed)
  NOT_A_FILE: 400, // "Not a file" (target exists but is a directory)
  IS_DIRECTORY: 400, // "Cannot read directory" (GET /api/file on a dir)
  SOURCE_DEST_REQUIRED: 400, // "Source and destination are required" (move)
  NO_FILES_UPLOADED: 400, // "No files uploaded" (POST /api/upload)
  PDF_TOOL_UNAVAILABLE: 503, // services/pdf.js throws err.code === this
  PDF_EXPORT_FAILED: 500, // generic PDF export failure
  SEARCH_QUERY_REQUIRED: 400, // GET /api/search: `q` missing/empty, or exceeds SEARCH_QUERY_MAX_LENGTH
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
    // `error` predates `code` (pre-0.6.0 flat shape). It is now PERMANENT
    // public API, not a compat shim awaiting removal: the package has been
    // on npm/GitHub as a public tool since 0.6.9, so external callers may
    // match on it (decided 2026-07-09).
    error: (err && err.message) || code
  };
  if (err && err.currentEtag) payload.currentEtag = err.currentEtag;
  return res.status(status).json(payload);
}
