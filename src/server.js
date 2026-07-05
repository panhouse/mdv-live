/**
 * MDV - Markdown Viewer Server
 * Express + WebSocket server with Marp support
 */

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { setupFileRoutes } from './api/file.js';
import { setupMarpNoteRoutes } from './api/marpNote.js';
import { makeOriginGuard, buildAllowedHosts } from './api/middleware/originGuard.js';
import { setupPdfRoutes } from './api/pdf.js';
import { setupTreeRoutes } from './api/tree.js';
import { setupUploadRoutes } from './api/upload.js';
import { DEFAULT_PORT, DEFAULT_DEPTH, JSON_BODY_LIMIT } from './config/constants.js';
import { mkError, sendError } from './utils/errors.js';
import { getVersion } from './utils/version.js';
import { setupWatcher } from './watcher.js';
import { setupWebSocket } from './websocket.js';
import { sweepStaleTemps } from './utils/atomicWrite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, 'static');
const VERSION = getVersion();

/**
 * Setup API routes for the Express app
 * @param {express.Application} app - Express application instance
 */
function setupApiRoutes(app, options) {
  setupTreeRoutes(app);
  setupFileRoutes(app);
  setupUploadRoutes(app);
  setupPdfRoutes(app);
  setupMarpNoteRoutes(app, { port: options.port });

  app.get('/api/info', (req, res) => {
    res.json({
      rootPath: app.locals.rootDir,
      version: VERSION
    });
  });

  // Shuts the process down — same Origin/Host guard as the marpNote
  // mutation routes (see the app.locals contract note in createMdvServer).
  app.post('/api/shutdown', makeOriginGuard(), (req, res) => {
    res.json({ success: true });
    setTimeout(() => process.exit(0), 100);
  });
}

/**
 * Create and configure the MDV server
 * @param {Object} options - Server options
 * @param {string} options.rootDir - Root directory to serve
 * @param {number} [options.port=8642] - Port to listen on (DEFAULT_PORT)
 * @param {number} [options.depth=3] - Directory watch depth (prevents EMFILE errors)
 * @returns {{ app: express.Application, server: http.Server, watcher: FSWatcher, wss: WebSocketServer, port: number, start: () => Promise<{port: number}>, stop: () => Promise<void> }}
 */
export function createMdvServer(options) {
  const { rootDir, port = DEFAULT_PORT, depth = DEFAULT_DEPTH } = options;

  const app = express();
  const server = createServer(app);

  app.locals.rootDir = path.resolve(rootDir);

  // --- app.locals contract for Origin/Host guard consumers -----------------
  // Any mutation route that wants src/api/middleware/originGuard.js's
  // makeOriginGuard() (file.js POST/DELETE/mkdir/move, upload.js, the
  // /api/shutdown route, ...) calls it with NO options; the middleware then
  // reads `req.app.locals.allowedHosts` per request, so every route agrees
  // on this one Origin/Host allow-list. Initialized from the requested
  // `port` option here and REFRESHED with the actual bound port inside
  // `start()` — so `port: 0` (OS-assigned ephemeral port) guards correctly.
  app.locals.port = port;
  app.locals.allowedHosts = buildAllowedHosts(port);

  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
  app.use('/static', express.static(STATIC_DIR));

  setupApiRoutes(app, { port });

  // Body-parser error handler (size limit, malformed JSON) must come AFTER
  // the routes so route-level errors fall through to the default handler.
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return sendError(res, mkError('PAYLOAD_TOO_LARGE', 'request body exceeds limit'));
    }
    if (err && err.type === 'entity.parse.failed') {
      return sendError(res, mkError('INVALID_NOTE', 'malformed JSON'));
    }
    next(err);
  });

  // Catch-all: serve index.html for SPA (path-based routing)
  // Express matches routes in order, so API/static routes above take priority
  app.get('*', (req, res) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });

  const wss = setupWebSocket(server);
  const watcher = setupWatcher(app.locals.rootDir, wss, { depth });

  app.locals.watcher = watcher;
  app.locals.wss = wss;

  function start() {
    // Best-effort sweep of stale temp files left by a previous crashed write.
    sweepStaleTemps(app.locals.rootDir).catch(() => {});
    return new Promise((resolve) => {
      server.listen(port, () => {
        // Resolve with the ACTUAL bound port (not the requested `port`
        // option) so callers passing `port: 0` for an OS-assigned ephemeral
        // port can discover what it was.
        const boundPort = server.address().port;
        // Refresh the Origin/Host allow-list with the real bound port (see
        // the app.locals contract above) so ephemeral-port servers guard
        // correctly. Guards read app.locals lazily per request.
        app.locals.port = boundPort;
        app.locals.allowedHosts = buildAllowedHosts(boundPort);
        console.log(`MDV server running at http://localhost:${boundPort}`);
        resolve({ port: boundPort });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      watcher.close();
      wss.close();
      server.close(resolve);
    });
  }

  return { app, server, watcher, wss, port, start, stop };
}

export default createMdvServer;
