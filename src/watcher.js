/**
 * File watcher for MDV using chokidar
 */

import chokidar from 'chokidar';
import path from 'path';
import { renderFile } from './rendering/index.js';

const IGNORED_PATTERNS = [
  /(^|[\/\\])\../,  // Dotfiles
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
];

const TREE_CHANGE_EVENTS = ['add', 'unlink', 'addDir', 'unlinkDir'];

/**
 * Setup file watcher
 * @param {string} rootDir - Root directory to watch
 * @param {WebSocketServer} wss - WebSocket server for broadcasting
 * @param {Object} [options] - Watcher options
 * @param {number} [options.depth=3] - Directory depth to watch (prevents EMFILE errors)
 * @returns {FSWatcher} Chokidar watcher instance
 */
export function setupWatcher(rootDir, wss, options = {}) {
  const { depth = 3 } = options;

  const watcher = chokidar.watch(rootDir, {
    ignored: IGNORED_PATTERNS,
    persistent: true,
    ignoreInitial: true,
    depth,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50
    }
  });

  function toRelativePath(filePath) {
    return path.relative(rootDir, filePath).split(path.sep).join('/');
  }

  function broadcastTreeUpdate() {
    wss.broadcast({
      type: 'tree_update',
      tree: null
    });
  }

  watcher.on('change', async (filePath) => {
    const relativePath = toRelativePath(filePath);

    try {
      const rendered = await renderFile(filePath);
      wss.broadcastFileUpdate(relativePath, {
        type: 'file_update',
        path: relativePath,
        ...rendered
      });
    } catch (err) {
      console.error(`Error rendering ${relativePath}:`, err);
    }
  });

  for (const event of TREE_CHANGE_EVENTS) {
    watcher.on(event, broadcastTreeUpdate);
  }

  watcher.on('error', (err) => {
    console.error('Watcher error:', err);
  });

  return watcher;
}

export default setupWatcher;
