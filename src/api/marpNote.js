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
    const hosts = allowedHosts();
    const hostErr = checkHost(req, hosts);
    if (hostErr) return sendError(res, hostErr);
    const originErr = checkOrigin(req, hosts);
    if (originErr) return sendError(res, originErr);
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match');
    // Note: deliberately NOT setting Allow-Private-Network; PNA is rejected.
    return res.status(204).end();
  };
}

export function setupMarpNoteRoutes(app, options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  // Thunk, like rootDir below: read app.locals per request so a server
  // started with port:0 (start() refreshes app.locals.allowedHosts with
  // the OS-assigned port) guards against the REAL bound host, not a
  // stale "localhost:0" list captured at setup time.
  const staticHosts = buildAllowedHosts(port);
  const allowedHosts = () => app.locals.allowedHosts ?? staticHosts;
  const rootDir = () => app.locals.rootDir;

  const handleOptions = makeOptionsHandler(allowedHosts);
  app.options('/api/marp/decks/:encodedPath/slides/:slideIndex/note', handleOptions);
  app.options('/api/marp/decks/:encodedPath', handleOptions);

  app.get('/api/marp/decks/:encodedPath', makeGetHandler({ rootDir, allowedHosts }));
  app.put('/api/marp/decks/:encodedPath/slides/:slideIndex/note',
    makePutHandler({ rootDir, allowedHosts }));
}
