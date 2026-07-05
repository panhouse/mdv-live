/**
 * Full-text search engine for the file tree — dependency-injectable
 * (rootDir/query/limit in, plain data out) and unit-testable without an
 * HTTP server. Backs `src/api/search.js` (GET /api/search).
 *
 * Design notes:
 *  - Walk order/visibility mirrors the tree API: `isIgnoredName`
 *    (src/utils/ignorePatterns.js) applied to every directory AND file name
 *    encountered, so a search never surfaces something the tree itself
 *    hides (node_modules, dotfiles, build output, ...).
 *  - Only files whose `getFileType` (src/utils/fileTypes.js) classification
 *    is markdown/code/text are read — binary/office/image/etc. types are
 *    skipped by construction (no content sniffing needed).
 *  - Literal substring search only — no regex is ever built from user
 *    input. Smart-case: an all-lowercase query matches case-insensitively;
 *    a query containing any uppercase character matches case-sensitively
 *    (same heuristic as ripgrep/vim smartcase).
 *  - Two independent early-exit guards, both surfaced as `truncated: true`:
 *    `SEARCH_MAX_RESULTS` (total result rows) and `SEARCH_MAX_FILES`
 *    (total files scanned — a runaway guard for huge trees with few hits).
 */

import fs from 'fs/promises';
import path from 'path';

import { SEARCH_MAX_FILE_BYTES, SEARCH_MAX_FILES, SEARCH_MAX_RESULTS } from '../config/constants.js';
import { getFileType } from '../utils/fileTypes.js';
import { isIgnoredName } from '../utils/ignorePatterns.js';
import { getRelativePath } from '../utils/path.js';

/** getFileType() classifications eligible for search (binary/office/image/... are excluded). */
const SEARCHABLE_TYPES = new Set(['markdown', 'code', 'text']);

/** Target snippet length (chars). Clipped windows are centered on the match. */
const SNIPPET_MAX_CHARS = 160;
const SNIPPET_HALF_CHARS = SNIPPET_MAX_CHARS / 2;

/** Marker prepended/appended to a snippet when it was clipped (matches the "…" used elsewhere, e.g. fileTree.js's "more" rows). */
const ELLIPSIS = '…';

/**
 * Smart-case: true (case-insensitive match) iff the query has no uppercase
 * characters at all.
 * @param {string} query
 * @returns {boolean}
 */
function isCaseInsensitive(query) {
  return query === query.toLowerCase();
}

/**
 * Build the display snippet for a matching line: trimmed, and clipped to
 * ~SNIPPET_MAX_CHARS centered on the match with ellipsis markers when the
 * clip cuts off real content.
 * @param {string} rawLine - The raw (untrimmed) line the match was found in
 * @param {number} matchIndex - 0-based char index of the match within rawLine
 * @param {number} matchLength - Length of the matched query, in chars
 * @returns {string}
 */
function buildSnippet(rawLine, matchIndex, matchLength) {
  const trimmedLine = rawLine.trim();
  const leading = rawLine.length - rawLine.trimStart().length;
  const trimmedMatchIndex = Math.max(0, Math.min(matchIndex - leading, trimmedLine.length));

  if (trimmedLine.length <= SNIPPET_MAX_CHARS) {
    return trimmedLine;
  }

  const matchCenter = trimmedMatchIndex + matchLength / 2;
  const maxStart = trimmedLine.length - SNIPPET_MAX_CHARS;
  const windowStart = Math.max(0, Math.min(Math.round(matchCenter - SNIPPET_HALF_CHARS), maxStart));
  const windowEnd = windowStart + SNIPPET_MAX_CHARS;

  let snippet = trimmedLine.slice(windowStart, windowEnd);
  if (windowStart > 0) snippet = ELLIPSIS + snippet;
  if (windowEnd < trimmedLine.length) snippet = snippet + ELLIPSIS;
  return snippet;
}

/**
 * Recursively search a directory tree for a literal substring.
 * @param {Object} options
 * @param {string} options.rootDir - Absolute root directory to search from
 * @param {string} options.query - Literal substring to search for (never treated as regex)
 * @param {number} [options.limit] - Max results to return (clamped to SEARCH_MAX_RESULTS); defaults to SEARCH_MAX_RESULTS
 * @param {number} [options.maxFiles] - Runaway guard: max FILE ENTRIES WALKED
 *   (including type/size-skipped ones — a folder of 50k images must still
 *   terminate). Defaults to SEARCH_MAX_FILES; overridable for tests.
 * @returns {Promise<{
 *   results: Array<{ path: string, line: number, col: number, snippet: string }>,
 *   truncated: boolean,
 *   stats: { filesScanned: number, elapsedMs: number }
 * }>}
 */
export async function searchFiles({ rootDir, query, limit, maxFiles = SEARCH_MAX_FILES }) {
  const startedAt = Date.now();

  if (!query) {
    return { results: [], truncated: false, stats: { filesScanned: 0, elapsedMs: Date.now() - startedAt } };
  }

  const caseInsensitive = isCaseInsensitive(query);
  const needle = caseInsensitive ? query.toLowerCase() : query;
  const requestedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SEARCH_MAX_RESULTS;
  const cap = Math.min(requestedLimit, SEARCH_MAX_RESULTS);

  const results = [];
  let filesScanned = 0; // files actually opened and grepped (reported in stats)
  let filesWalked = 0;  // every file entry considered, incl. skipped — feeds the runaway guard
  let truncated = false;
  let stopped = false;

  /** @param {string} dirPath */
  async function walk(dirPath) {
    if (stopped) return;

    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return; // unreadable directory (permissions, race with a delete) — skip silently
    }

    const visible = entries
      .filter((entry) => !isIgnoredName(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of visible) {
      if (stopped) return;
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        // Guard on WALKED entries, not grepped ones: type/size-skipped
        // files (images, >1MB logs, ...) must also consume the budget or a
        // huge binary-heavy folder walks forever (codex review finding).
        if (filesWalked >= maxFiles) {
          truncated = true;
          stopped = true;
          return;
        }
        filesWalked++;
        await searchFile(fullPath);
      }
      // symlinks/sockets/etc. (neither isFile() nor isDirectory()) are skipped
    }
  }

  /** @param {string} fullPath */
  async function searchFile(fullPath) {
    if (!SEARCHABLE_TYPES.has(getFileType(fullPath).type)) return;

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size > SEARCH_MAX_FILE_BYTES) return;

    filesScanned++;

    let content;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch {
      return; // unreadable (permissions, race with a delete) — skip silently
    }

    const haystackWhole = caseInsensitive ? content.toLowerCase() : content;
    if (!haystackWhole.includes(needle)) return;

    const relPath = getRelativePath(fullPath, rootDir);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (results.length >= cap) {
        truncated = true;
        stopped = true;
        return;
      }

      const rawLine = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
      const haystackLine = caseInsensitive ? rawLine.toLowerCase() : rawLine;
      const matchIndex = haystackLine.indexOf(needle);
      if (matchIndex === -1) continue;

      results.push({
        path: relPath,
        line: i + 1,
        col: matchIndex + 1,
        snippet: buildSnippet(rawLine, matchIndex, query.length),
      });
    }
  }

  await walk(rootDir);

  return {
    results,
    truncated,
    stats: { filesScanned, elapsedMs: Date.now() - startedAt },
  };
}

export default searchFiles;
