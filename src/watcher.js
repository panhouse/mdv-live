/**
 * File watcher for MDV using chokidar
 */

import chokidar from 'chokidar';
import path from 'path';
import { renderFile } from './rendering/index.js';

/**
 * Setup file watcher
 * @param {string} rootDir - Root directory to watch
 * @param {WebSocketServer} wss - WebSocket server for broadcasting
 * @returns {FSWatcher} Chokidar watcher instance
 */
export function setupWatcher(rootDir, wss) {
  const watcher = chokidar.watch(rootDir, {
    ignored: [
      /(^|[\/\\])\../,  // Ignore dotfiles
      /node_modules/,
      /\.git/,
      /__pycache__/,
      /\.pyc$/,
      // Python cache/build
      /\.cache/,
      /\.pytest_cache/,
      /\.mypy_cache/,
      /\.ruff_cache/,
      /venv/,
      /\.venv/,
      // Build outputs
      /dist/,
      /build/,
      // Framework specific
      /\.next/,
      /\.nuxt/,
      // Test coverage
      /coverage/,
      // OS generated files
      /\.DS_Store/,
      /Thumbs\.db/,
      /desktop\.ini/,
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50
    }
  });

  // Helper to get relative path
  const getRelativePath = (filePath) => {
    return path.relative(rootDir, filePath).split(path.sep).join('/');
  };

  // File change handler
  watcher.on('change', async (filePath) => {
    const relativePath = getRelativePath(filePath);

    try {
      // Render the file content
      const rendered = await renderFile(filePath);

      // Broadcast to clients watching this file
      wss.broadcastFileUpdate(relativePath, {
        type: 'file_update',
        path: relativePath,
        ...rendered
      });
    } catch (err) {
      console.error(`Error rendering ${relativePath}:`, err);
    }
  });

  // Tree change handlers
  const broadcastTreeUpdate = async () => {
    // We'll implement getFileTree in api/tree.js
    // For now, just notify clients to refresh
    wss.broadcast({
      type: 'tree_update',
      tree: null // Client will fetch via API
    });
  };

  watcher.on('add', broadcastTreeUpdate);
  watcher.on('unlink', broadcastTreeUpdate);
  watcher.on('addDir', broadcastTreeUpdate);
  watcher.on('unlinkDir', broadcastTreeUpdate);

  watcher.on('error', (err) => {
    console.error('Watcher error:', err);
  });

  return watcher;
}

export default setupWatcher;
