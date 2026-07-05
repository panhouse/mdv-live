/**
 * Single source of truth for every error `code` string that crosses the
 * client/server boundary (or, for the client-only ones, the
 * BroadcastChannel boundary between the main window and Presenter View).
 *
 * KEEP IN SYNC with src/utils/errors.js ERROR_STATUS on the server — that
 * file owns the HTTP-status mapping for every code the server can send;
 * this file owns the same code *names* for frontend code that needs to
 * compare against them (`data.code === ERROR_CODES.STALE`, etc.) without
 * hand-typing the string each time. If you add/rename a code in either
 * file, update the other.
 *
 * Client-only codes (never produced by sendError(), never sent over HTTP —
 * these are invented by the frontend's own BroadcastChannel protocol
 * between the main window and Presenter View, or reserved for future use):
 *   NO_DECK        — presenterView.saveNote(): this window's active tab no
 *                     longer holds the deck a routed save targeted.
 *   COALESCED      — lib/saveQueue.js: a newer enqueue() for the same
 *                     (slideIndex, origin) superseded an older pending one.
 *   NETWORK_ERROR  — reserved: a fetch/BroadcastChannel round trip failed
 *                     before any server response existed.
 *   DEGRADED       — reserved: server responded but couldn't fully parse
 *                     the deck (see errors.js NOT_PARSEABLE for the server
 *                     analog).
 *
 * Loaded as a native ES module (`<script type="module">`). Exposes named
 * exports for direct `import`, and also sets `globalThis.MDVErrorCodes` for
 * consistency with the other lib/*.js modules.
 */
export const ERROR_CODES = Object.freeze({
  // --- mirrors src/utils/errors.js ERROR_STATUS keys ---
  PATH_INVALID: 'PATH_INVALID',
  NOT_FOUND: 'NOT_FOUND',
  NOT_MARP: 'NOT_MARP',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  INVALID_NOTE: 'INVALID_NOTE',
  MULTI_NOTE_READONLY: 'MULTI_NOTE_READONLY',
  STALE: 'STALE',
  IF_MATCH_REQUIRED: 'IF_MATCH_REQUIRED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  ORIGIN_REJECTED: 'ORIGIN_REJECTED',
  READONLY: 'READONLY',
  NOT_PARSEABLE: 'NOT_PARSEABLE',
  WRITE_FAILED: 'WRITE_FAILED',
  READ_FAILED: 'READ_FAILED',
  PATH_REQUIRED: 'PATH_REQUIRED',
  SEARCH_QUERY_REQUIRED: 'SEARCH_QUERY_REQUIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_A_FILE: 'NOT_A_FILE',
  IS_DIRECTORY: 'IS_DIRECTORY',
  SOURCE_DEST_REQUIRED: 'SOURCE_DEST_REQUIRED',
  NO_FILES_UPLOADED: 'NO_FILES_UPLOADED',
  PDF_TOOL_UNAVAILABLE: 'PDF_TOOL_UNAVAILABLE',
  PDF_EXPORT_FAILED: 'PDF_EXPORT_FAILED',
  // --- client-only codes (see doc comment above) ---
  NETWORK_ERROR: 'NETWORK_ERROR',
  DEGRADED: 'DEGRADED',
  NO_DECK: 'NO_DECK',
  COALESCED: 'COALESCED'
});

if (typeof globalThis !== 'undefined') {
  globalThis.MDVErrorCodes = { ERROR_CODES };
}
