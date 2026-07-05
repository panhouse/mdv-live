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

/**
 * Full-text search (src/services/search.js engine, src/api/search.js route).
 */

/** Per-file size cap for search — larger files are skipped entirely (not read). 1MB. */
export const SEARCH_MAX_FILE_BYTES = 1 * 1024 * 1024;

/**
 * Hard cap on total results returned by one search request, regardless of
 * the caller-requested `limit`. Hitting it sets `truncated: true`.
 */
export const SEARCH_MAX_RESULTS = 500;

/**
 * Runaway guard: max files scanned (read + grepped) in one search request
 * before the walk stops early, independent of how many results were found.
 * Also sets `truncated: true` when hit.
 */
export const SEARCH_MAX_FILES = 5000;

/** Max accepted length (chars) of the `q` query-string param (GET /api/search). */
export const SEARCH_QUERY_MAX_LENGTH = 256;

/**
 * Change tracking (0.6.3): src/utils/lineDiff.js (Myers line diff),
 * src/services/changeJournal.js (in-memory snapshot store), src/api/diff.js
 * (GET /api/diff route).
 */

/**
 * Hard cap on lines-per-side for src/utils/lineDiff.js's diffLines(). The
 * Myers algorithm is O(N*D) (D = edit distance, up to N+M); above this line
 * count diffLines() bails out with `{ available: false }` instead of
 * potentially doing an unbounded amount of work on the request thread.
 */
export const DIFF_MAX_LINES = 20000;

// Myers トレースのメモリ予算（バイト）。1ステップあたり (2*(N+M)+1)*4 byte
// を消費するため、編集距離が大きい（=ほぼ全行が違う）ペアはこの予算で
// 打ち切り、too-large として返す（ハイライトの用をなさないため）。
export const DIFF_TRACE_BUDGET_BYTES = 32 * 1024 * 1024;

/**
 * Total in-memory budget (bytes) for src/services/changeJournal.js's raw
 * snapshot store, summed across every path/version it holds. LRU-evicted
 * (oldest-touched first) once a new snapshot would push the total over this
 * limit. 50MB.
 */
export const JOURNAL_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Per-file size cap (bytes) for a single changeJournal snapshot. A file
 * larger than this is still tracked (its hash is remembered so
 * latestHash()/listVersions() stay accurate) but its content is NOT stored
 * — get() returns null for it, same as an evicted/unknown version. Also
 * used by src/api/diff.js to cap how large a file it will read to compute
 * a live diff. 1MB.
 */
export const JOURNAL_MAX_FILE_BYTES = 1 * 1024 * 1024;

/**
 * Max snapshot versions changeJournal.js keeps per path, independent of the
 * global JOURNAL_MAX_BYTES byte budget — the oldest version for that path is
 * dropped once a new one pushes the count over this cap.
 */
export const JOURNAL_MAX_VERSIONS_PER_FILE = 4;
