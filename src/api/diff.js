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
 *       { available: true, identical: true, currentHash, added: [], changed: [], removedAt: [], removed: [] }
 *   - `from` matches an EARLIER hash the journal still has content for:
 *       { available: true, identical: false, currentHash, added, changed, removedAt, removed }
 *       (`removed`, 0.6.10: [{ afterLine, lines }, ...] — the deleted OLD-text
 *       lines for each pure-deletion hunk, same positions as `removedAt`,
 *       straight from src/utils/lineDiff.js's `diffLines()` — see that
 *       module's docstring. Backs the frontend's Word-style strikethrough
 *       inline display, modules/diffReview.js.)
 *       When the current content is a Marp deck, this branch also carries
 *       `slideRanges: [{ start, end }, ...]` — ONE-based inclusive raw-line
 *       ranges per slide (same convention as `added`/`changed` above),
 *       derived from marpitAdapter.js's `parseDeck()` (the Marp/Marpit
 *       parsing SSOT — never re-parsed in the browser). Lets the frontend's
 *       modules/marpDiffIndicator.js work out which slide(s) a hunk touches
 *       without a second Marp parser client-side. Parsed only here (on an
 *       actual pending diff), not on every render, and best-effort: a deck
 *       too malformed for `parseDeck()` (`NOT_PARSEABLE`) just omits the
 *       field rather than failing the whole diff response.
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
import { isMarp, parseDeck } from '../rendering/marpitAdapter.js';

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

      // Lazy initial snapshot: EVERY diff request (including the identical
      // early-return below — codex round-4) seeds the journal with the
      // CURRENT content, so a later diff against this exact hash is
      // possible even if the watcher never fired. Ordering matters twice
      // over: the baseline is looked up BEFORE recording (recording first
      // can evict the very version being asked about at the per-file
      // version cap — codex round-1), and recording happens BEFORE the
      // identical return (or a client holding /api/file's etag could
      // "confirm" a baseline that was never stored).
      const baseline = from && from !== currentHash
        ? journal.get(relativePath, from)
        : null;
      journal.record(relativePath, current);

      if (from === currentHash) {
        return res.json({
          available: true,
          identical: true,
          currentHash,
          added: [],
          changed: [],
          removedAt: [],
          removed: [],
        });
      }
      if (baseline === null) {
        return res.json({ available: false, reason: 'unknown-baseline', currentHash });
      }

      const diff = diffLines(baseline, current);
      if (diff.available === false) {
        return res.json({ available: false, reason: 'too-large', currentHash });
      }

      const response = { available: true, identical: false, currentHash, ...diff };
      if (isMarp(current)) {
        try {
          response.slideRanges = parseDeck(current).slideRanges.map((r) => ({
            start: r.startLine + 1,
            end: r.endLine
          }));
        } catch {
          // Malformed deck (NOT_PARSEABLE) — the slide indicator just won't
          // show for this file; the diff itself is still valid and useful.
        }
      }
      return res.json(response);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return sendError(res, mkError('NOT_FOUND', 'File not found'));
      }
      // Fixed message — raw fs errors can leak absolute paths/OS details
      // (same contract as the other read routes).
      return sendError(res, mkError('READ_FAILED', 'read failed', { cause: err }));
    }
  });
}

export default setupDiffRoutes;
