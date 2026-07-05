/**
 * Single source of truth for cross-module constants.
 *
 * Before this file existed these values were hard-coded independently in
 * several places and had already drifted:
 *  - `src/server.js` defaulted `port` to 8080 (wrong — the CLI's real
 *    default, set in `bin/mdv.js`, is 8642) and `src/api/marpNote.js` did
 *    `options.port || 8080` for the same reason. 8642 below is the correct
 *    value; consumers should stop defaulting to 8080.
 *  - Tree pagination/depth caps lived only in `src/api/tree.js`.
 *  - The relative-path length cap was a bare `1024` literal duplicated in
 *    `src/websocket.js` and `src/api/marpNote/guards.js`.
 *  - Watcher debounce/stability timings lived only in `src/watcher.js`.
 *
 * This module only centralizes the values — it does not change any of
 * them. Existing consumers keep their current literals until they are
 * migrated to import from here (tracked in the refactor strategy doc).
 */

/** Default HTTP port `mdv` (CLI) listens on when none is specified. */
export const DEFAULT_PORT = 8642;

/** Default chokidar watch depth (prevents EMFILE errors on huge trees). */
export const DEFAULT_DEPTH = 3;

/**
 * Cap on how many children of a single directory the tree API materializes
 * at once (src/api/tree.js). The remainder is fetched on demand via
 * /api/tree/page ("load more").
 */
export const MAX_CHILDREN_PER_DIR = 500;

/**
 * Depth at which tree traversal stops eagerly loading children (subdirs
 * come back unloaded: `loaded: false, children: []`).
 */
export const MAX_INITIAL_DEPTH = 1;

/**
 * Max length (in characters) accepted for a client-supplied relative path,
 * shared by the WebSocket `watch` message handler (src/websocket.js) and
 * the marpNote route params (src/api/marpNote/guards.js).
 */
export const MAX_RELATIVE_PATH_LENGTH = 1024;

/** express.json()/express.urlencoded() body size limit (src/server.js). */
export const JSON_BODY_LIMIT = '128kb';

/** ws WebSocketServer maxPayload option (src/websocket.js). */
export const WS_MAX_PAYLOAD = 64 * 1024;

/** multer file size limit for /api/upload (src/api/upload.js). 100MB. */
export const UPLOAD_FILE_SIZE_LIMIT = 100 * 1024 * 1024;

/**
 * Coalescing window for tree_update broadcasts (src/watcher.js). A bulk FS
 * operation (git checkout, npm install, unzip) fires many add/unlink
 * events; at most one tree_update is emitted per window.
 */
export const TREE_UPDATE_DEBOUNCE_MS = 150;

/** chokidar awaitWriteFinish.stabilityThreshold (src/watcher.js). */
export const AWAIT_WRITE_FINISH_STABILITY_MS = 100;

/** chokidar awaitWriteFinish.pollInterval (src/watcher.js). */
export const AWAIT_WRITE_FINISH_POLL_MS = 50;

/** Max slide index accepted by the marpNote PUT route (marpNote/guards.js). */
export const MAX_SLIDE_INDEX = 1000;

/**
 * Max file size (bytes) eligible for the office "vibe preview" (docx/xlsx/
 * pptx quick preview, src/rendering/office.js, wired in src/api/file.js).
 * Larger files fall back to the plain binary download card — unzipping and
 * regex-scanning a huge OOXML package synchronously on the request thread
 * would block the event loop for too long. 20MB.
 */
export const OFFICE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
