/**
 * Full-text search API route — GET /api/search?q=&limit=.
 *
 * Read-only (no originGuard, same as the tree/file GETs). All actual search
 * logic lives in src/services/search.js (dependency-injectable, unit-tested
 * without HTTP); this module only does query-string validation and clamping.
 */

import { searchFiles } from '../services/search.js';
import { SEARCH_MAX_RESULTS, SEARCH_QUERY_MAX_LENGTH } from '../config/constants.js';
import { mkError, sendError } from '../utils/errors.js';

/**
 * Setup full-text search routes.
 * @param {Express} app - Express app instance
 */
export function setupSearchRoutes(app) {
  app.get('/api/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';

      if (!q) {
        return sendError(res, mkError('SEARCH_QUERY_REQUIRED', 'q is required'));
      }
      if (q.length > SEARCH_QUERY_MAX_LENGTH) {
        return sendError(
          res,
          mkError('SEARCH_QUERY_REQUIRED', `q exceeds ${SEARCH_QUERY_MAX_LENGTH} characters`)
        );
      }

      const requestedLimit = parseInt(req.query.limit, 10) || SEARCH_MAX_RESULTS;
      const limit = Math.min(SEARCH_MAX_RESULTS, Math.max(1, requestedLimit));

      const result = await searchFiles({ rootDir: app.locals.rootDir, query: q, limit });
      res.json(result);
    } catch (err) {
      sendError(res, mkError('READ_FAILED', err.message, { cause: err }));
    }
  });
}

export default setupSearchRoutes;
