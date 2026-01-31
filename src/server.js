/**
 * MDV - Markdown Viewer Server
 * Express + WebSocket server with Marp support
 */

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocket } from './websocket.js';
import { setupWatcher } from './watcher.js';
import { setupTreeRoutes } from './api/tree.js';
import { setupFileRoutes } from './api/file.js';
import { setupUploadRoutes } from './api/upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create and configure the MDV server
 * @param {Object} options - Server options
 * @param {string} options.rootDir - Root directory to serve
 * @param {number} options.port - Port to listen on
 * @returns {Object} Server instance and control functions
 */
export function createMdvServer(options) {
  const { rootDir, port = 8080 } = options;

  const app = express();
  const server = createServer(app);

  // Store root directory in app locals for access in routes
  app.locals.rootDir = path.resolve(rootDir);

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static files
  const staticDir = path.join(__dirname, 'static');
  app.use('/static', express.static(staticDir));

  // API routes
  setupTreeRoutes(app);
  setupFileRoutes(app);
  setupUploadRoutes(app);

  // Server info endpoint
  app.get('/api/info', (req, res) => {
    res.json({
      rootPath: app.locals.rootDir,
      version: '1.0.0'
    });
  });

  // Shutdown endpoint
  app.post('/api/shutdown', (req, res) => {
    res.json({ success: true });
    setTimeout(() => {
      process.exit(0);
    }, 100);
  });

  // Serve index.html for root
  app.get('/', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  // Setup WebSocket
  const wss = setupWebSocket(server);

  // Setup file watcher
  const watcher = setupWatcher(app.locals.rootDir, wss);

  // Store watcher reference
  app.locals.watcher = watcher;
  app.locals.wss = wss;

  return {
    app,
    server,
    watcher,
    wss,
    port,

    start() {
      return new Promise((resolve) => {
        server.listen(port, () => {
          console.log(`MDV server running at http://localhost:${port}`);
          resolve({ port });
        });
      });
    },

    stop() {
      return new Promise((resolve) => {
        watcher.close();
        wss.close();
        server.close(() => {
          resolve();
        });
      });
    }
  };
}

export default createMdvServer;
