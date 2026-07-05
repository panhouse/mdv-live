/**
 * Change-tracking diff API — GET /api/diff?path=&from=<hash>.
 *
 * Read-only (no originGuard, same as tree/file/search GETs). Delegates the
 * actual line diff to src/utils/lineDiff.js (pure) and snapshot storage to
 * src/services/changeJournal.js (one instance shared across the app, at
 * app.locals.changeJournal — see src/server.js).
 *
 * Every call also records the file's CURRENT content into the journal, so a
 * diff becomes computable for any hash a client reports as `from` on a
 * LATER call — this is the "lazy initial snapshot" mechanism: there is no
 * separate "start tracking this file" step. src/watcher.js additionally
 * records a snapshot on every filesystem change, so a hash the client saw
 * via a `file_update` WS message is normally already journaled by the time
 * a diff is requested against it.
 *
 * Response shapes (all 200 OK — "no diff available" is data, not an error):
 *   - `from` matches the current content's hash:
 *       { available: true, identical: true, currentHash, added: [], changed: [], removedAt: [] }
 *   - `from` matches an EARLIER hash the journal still has content for:
 *       { available: true, identical: false, currentHash, added, changed, removedAt }
 *   - `from` missing, unknown, or its content was evicted/oversized:
 *       { available: false, reason: 'unknown-baseline', currentHash }
 *   - current file content exceeds JOURNAL_MAX_FILE_BYTES (never read/hashed):
 *       { available: false, reason: 'too-large' }
 *   - current+baseline are both readable but line diff exceeds DIFF_MAX_LINES:
 *       { available: false, reason: 'too-large', currentHash }
 *
 * Actual errors (bad path, not found, directory, read failure) go through
 * sendError/mkError as usual.
 */

import fs from 'fs/promises';

import { JOURNAL_MAX_FILE_BYTES } from '../config/constants.js';
import { makeEtag } from '../utils/etag.js';
import { diffLines } from '../utils/lineDiff.js';
import { mkError, sendError } from '../utils/errors.js';
import { resolveWithinRoot } from '../utils/path.js';

/**
 * Setup the change-tracking diff route.
 * @param {Express} app - Express app instance (reads app.locals.rootDir / app.locals.changeJournal)
 */
export function setupDiffRoutes(app) {
  app.get('/api/diff', async (req, res) => {
    const { rootDir, changeJournal: journal } = app.locals;
    const relativePath = typeof req.query.path === 'string' ? req.query.path : '';
    const from = typeof req.query.from === 'string' ? req.query.from : '';

    const { valid, fullPath } = await resolveWithinRoot(relativePath, rootDir);

    if (!relativePath) {
      return sendError(res, mkError('PATH_REQUIRED', 'Path is required'));
    }
    if (!valid) {
      return sendError(res, mkError('ACCESS_DENIED', 'Access denied'));
    }

    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        return sendError(res, mkError('IS_DIRECTORY', 'Cannot read directory'));
      }
      if (stats.size > JOURNAL_MAX_FILE_BYTES) {
        return res.json({ available: false, reason: 'too-large' });
      }

      const current = await fs.readFile(fullPath, 'utf-8');
      const currentHash = makeEtag(current);

      // Lazy initial snapshot: every diff request seeds the journal with the
      // CURRENT content, so a later diff against this exact hash is possible
      // even if the watcher never fired (e.g. this is the first time the
      // file has been looked at, or it was written outside the watch tree's
      // debounce window).
      journal.record(relativePath, current);

      if (from === currentHash) {
        return res.json({
          available: true,
          identical: true,
          currentHash,
          added: [],
          changed: [],
          removedAt: [],
        });
      }

      const baseline = from ? journal.get(relativePath, from) : null;
      if (baseline === null) {
        return res.json({ available: false, reason: 'unknown-baseline', currentHash });
      }

      const diff = diffLines(baseline, current);
      if (diff.available === false) {
        return res.json({ available: false, reason: 'too-large', currentHash });
      }

      return res.json({ available: true, identical: false, currentHash, ...diff });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return sendError(res, mkError('NOT_FOUND', 'File not found'));
      }
      return sendError(res, mkError('READ_FAILED', err.message, { cause: err }));
    }
  });
}

export default setupDiffRoutes;
