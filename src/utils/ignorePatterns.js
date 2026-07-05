/**
 * Single source of truth for "paths hidden from the user" — the file tree
 * and the file watcher must agree on what is invisible.
 *
 * Before this file existed they had drifted: `src/api/tree.js` hid only
 * `node_modules`, `__pycache__`, `.git` while `src/watcher.js` hid 19
 * patterns (dotfiles, build output dirs, OS cruft, language caches). The
 * result was a live bug — directories like `dist/` or `venv/` rendered in
 * the tree but were not watched, so external changes to them never
 * refreshed the UI.
 *
 * Two matching styles are exported because the two call sites see
 * different inputs:
 *  - `src/api/tree.js` walks one directory level at a time and only has
 *    the bare entry `name` → use `isIgnoredName`.
 *  - chokidar walks recursively and matches against full paths it
 *    discovers → pass `CHOKIDAR_IGNORED` straight to its `ignored` option.
 */

/**
 * Canonical list of ignored directory/file names (documentation + the
 * non-dotfile part of `isIgnoredName`). Dotfiles are handled separately
 * (any name starting with `.` is hidden, mirroring the watcher's
 * `/(^|[/\\])\../` rule) so several of these overlap with that rule; they
 * are still listed for clarity on what is intentionally hidden.
 */
export const IGNORED_NAMES = Object.freeze([
  'node_modules',
  '__pycache__',
  '.git',
  '.cache',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'venv',
  '.venv',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini'
]);

/** Name suffixes that are always hidden (e.g. compiled Python bytecode). */
const IGNORED_SUFFIXES = Object.freeze(['.pyc']);

/**
 * Direct-child filter used by tree traversal (src/api/tree.js).
 * @param {string} name - Bare file/directory name (not a path)
 * @returns {boolean} True if the entry should be hidden from the tree
 */
export function isIgnoredName(name) {
  if (name.startsWith('.')) return true;
  if (IGNORED_NAMES.includes(name)) return true;
  return IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Regex array for chokidar's `ignored` option (matches against the full
 * paths chokidar walks). Verbatim from the pre-consolidation
 * `src/watcher.js` list — chokidar's watch behavior is unchanged by this
 * refactor.
 */
export const CHOKIDAR_IGNORED = Object.freeze([
  /(^|[/\\])\../,  // Dotfiles
  /node_modules/,
  /\.git/,
  /__pycache__/,
  /\.pyc$/,
  /\.cache/,
  /\.pytest_cache/,
  /\.mypy_cache/,
  /\.ruff_cache/,
  /venv/,
  /\.venv/,
  /dist/,
  /build/,
  /\.next/,
  /\.nuxt/,
  /coverage/,
  /\.DS_Store/,
  /Thumbs\.db/,
  /desktop\.ini/,
]);
