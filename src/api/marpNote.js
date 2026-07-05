/**
 * /api/marp/decks/:encodedPath endpoint family — orchestration only.
 *
 * Routing:
 *   GET    /api/marp/decks/:encodedPath              → handleGet
 *   PUT    /api/marp/decks/:encodedPath/slides/:N/note  → handlePut
 *   OPTIONS  ...                                     → CORS preflight (same-origin only)
 */

import { DEFAULT_PORT } from '../config/constants.js';
import { sendError } from '../utils/errors.js';
import { buildAllowedHosts, checkHost, checkOrigin } from './marpNote/guards.js';
import { makeGetHandler } from './marpNote/handleGet.js';
import { makePutHandler } from './marpNote/handlePut.js';

function makeOptionsHandler(allowedHosts) {
  return function handleOptions(req, res) {
    const hostErr = checkHost(req, allowedHosts);
    if (hostErr) return sendError(res, hostErr);
    const originErr = checkOrigin(req, allowedHosts);
    if (originErr) return sendError(res, originErr);
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match');
    // Note: deliberately NOT setting Allow-Private-Network; PNA is rejected.
    return res.status(204).end();
  };
}

export function setupMarpNoteRoutes(app, options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const allowedHosts = buildAllowedHosts(port);
  const rootDir = () => app.locals.rootDir;

  const handleOptions = makeOptionsHandler(allowedHosts);
  app.options('/api/marp/decks/:encodedPath/slides/:slideIndex/note', handleOptions);
  app.options('/api/marp/decks/:encodedPath', handleOptions);

  app.get('/api/marp/decks/:encodedPath', makeGetHandler({ rootDir, allowedHosts }));
  app.put('/api/marp/decks/:encodedPath/slides/:slideIndex/note',
    makePutHandler({ rootDir, allowedHosts }));
}
