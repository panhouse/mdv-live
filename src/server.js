/**
 * MDV - Markdown Viewer Server
 * Express + WebSocket server with Marp support
 */

import express from 'express';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { setupFileRoutes } from './api/file.js';
import { setupMarpNoteRoutes } from './api/marpNote.js';
import { setupPdfRoutes } from './api/pdf.js';
import { setupTreeRoutes } from './api/tree.js';
import { setupUploadRoutes } from './api/upload.js';
import { setupWatcher } from './watcher.js';
import { setupWebSocket } from './websocket.js';
import { sweepStaleTemps } from './utils/atomicWrite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, 'static');
const { version: VERSION } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
);

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

  app.post('/api/shutdown', (req, res) => {
    res.json({ success: true });
    setTimeout(() => process.exit(0), 100);
  });
}

/**
 * Create and configure the MDV server
 * @param {Object} options - Server options
 * @param {string} options.rootDir - Root directory to serve
 * @param {number} [options.port=8080] - Port to listen on
 * @param {number} [options.depth=3] - Directory watch depth (prevents EMFILE errors)
 * @returns {{ app: express.Application, server: http.Server, watcher: FSWatcher, wss: WebSocketServer, port: number, start: () => Promise<{port: number}>, stop: () => Promise<void> }}
 */
export function createMdvServer(options) {
  const { rootDir, port = 8080, depth = 3 } = options;

  const app = express();
  const server = createServer(app);

  app.locals.rootDir = path.resolve(rootDir);

  app.use(express.json({ limit: '128kb' }));
  app.use(express.urlencoded({ extended: true, limit: '128kb' }));
  app.use('/static', express.static(STATIC_DIR));

  setupApiRoutes(app, { port });

  // Body-parser error handler (size limit, malformed JSON) must come AFTER
  // the routes so route-level errors fall through to the default handler.
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        error: 'request body exceeds limit'
      });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_NOTE',
        error: 'malformed JSON'
      });
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
        console.log(`MDV server running at http://localhost:${port}`);
        resolve({ port });
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
