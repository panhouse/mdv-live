/**
 * Thin HTTP client used by the main MDV window.
 *
 * Centralizes URL construction, common headers (If-Match), JSON parsing, and
 * error normalization. Loaded as a native ES module (`<script
 * type="module">`). Exposes named exports for direct `import`, and also
 * still sets `window.MDVApi` for any not-yet-migrated code that reads the
 * global directly.
 *
 * Note: POST /api/upload deliberately stays XHR-based in app.js (not here)
 * because it needs `progress` events for the upload progress bar, which
 * `fetch()` does not expose for request bodies.
 */

async function jsonOrEmpty(res) {
  try { return await res.json(); } catch { return {}; }
}

/**
 * Fetch `url`, parse the JSON body, and throw if the payload signals an
 * error (`data.error` or `data.detail`). Mirrors the app.js apiRequest() /
 * apiPost() helpers this client folds in.
 */
async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (data.error || data.detail) {
    throw new Error(data.error || data.detail);
  }
  return data;
}

/** GET /api/marp/decks/:path */
async function getDeck(path) {
  const res = await fetch('/api/marp/decks/' + encodeURIComponent(path));
  return { res, data: await jsonOrEmpty(res) };
}

/** PUT /api/marp/decks/:path/slides/:N/note (If-Match required) */
async function saveMarpNote(path, slideIndex, note, ifMatch) {
  const url = '/api/marp/decks/' + encodeURIComponent(path)
    + '/slides/' + slideIndex + '/note';
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': ifMatch
    },
    body: JSON.stringify({ note })
  });
  return { res, data: await jsonOrEmpty(res) };
}

// --- Other MDV endpoints used throughout the app -------------------------

function fetchTree() { return fetch('/api/tree'); }
function expandTree(path) {
  return fetch('/api/tree/expand?path=' + encodeURIComponent(path));
}
/** GET /api/tree/page — next page of a large directory's children */
function pageTree(path, offset, limit) {
  const params = new URLSearchParams({ path: path || '', offset: String(offset || 0) });
  if (limit) params.set('limit', String(limit));
  return fetch('/api/tree/page?' + params.toString());
}
function fetchFile(path) {
  return fetch('/api/file?path=' + encodeURIComponent(path));
}
function saveFile(path, content, signal) {
  return fetch('/api/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
    signal
  });
}
function fetchInfo() { return fetch('/api/info'); }
function exportPdf(payload) {
  return fetch('/api/pdf/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/** POST /api/mkdir — create a directory. Parses JSON, throws on API error. */
function mkdir(path) {
  return requestJson('/api/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
}

/** POST /api/move — move/rename a file or directory. Parses JSON, throws on API error. */
function moveItem(source, destination) {
  return requestJson('/api/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, destination })
  });
}

/** DELETE /api/file — delete a file or directory. Parses JSON, throws on API error. */
function deleteFile(path) {
  return requestJson('/api/file?path=' + encodeURIComponent(path), { method: 'DELETE' });
}

/**
 * POST /api/shutdown — ask the server to stop. Returns the raw fetch
 * Promise (not parsed) — a connection failure is expected here (the server
 * disappears mid-response), so callers swallow errors themselves rather
 * than have this throw.
 */
function shutdown() {
  return fetch('/api/shutdown', { method: 'POST' });
}

/**
 * GET /raw/:path — fetch a raw (unrendered) file, e.g. a PDF style CSS file
 * for live preview. Returns the raw Response (not parsed) so callers can
 * inspect `.ok` / `.status` and read `.text()` themselves.
 */
function fetchRawCss(path) {
  return fetch('/raw/' + path);
}

/**
 * GET /api/search?q=&limit= — full-text search across the tree
 * (src/services/search.js). Returns the raw Response (not parsed, mirrors
 * fetchFile/fetchTree) so the caller can inspect `.ok`/`.status` and parse
 * `{ results, truncated, stats }` itself. `signal` is optional (mirrors
 * saveFile's abort-support) — modules/searchPalette.js aborts the previous
 * in-flight request when a newer keystroke supersedes it.
 */
function search(q, limit, signal) {
  const params = new URLSearchParams({ q });
  if (limit) params.set('limit', String(limit));
  return fetch('/api/search?' + params.toString(), signal ? { signal } : undefined);
}

const api = {
  getDeck,
  saveMarpNote,
  fetchTree,
  expandTree,
  pageTree,
  fetchFile,
  saveFile,
  fetchInfo,
  exportPdf,
  mkdir,
  moveItem,
  deleteFile,
  shutdown,
  fetchRawCss,
  search
};

export {
  getDeck,
  saveMarpNote,
  fetchTree,
  expandTree,
  pageTree,
  fetchFile,
  saveFile,
  fetchInfo,
  exportPdf,
  mkdir,
  moveItem,
  deleteFile,
  shutdown,
  fetchRawCss,
  search,
  api as MDVApi
};

if (typeof globalThis !== 'undefined') {
  globalThis.MDVApi = api;
}
