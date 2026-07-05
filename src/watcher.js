/**
 * File watcher for MDV using chokidar
 */

import chokidar from 'chokidar';
import path from 'path';
import {
  AWAIT_WRITE_FINISH_POLL_MS,
  AWAIT_WRITE_FINISH_STABILITY_MS,
  TREE_UPDATE_DEBOUNCE_MS
} from './config/constants.js';
import { renderFile } from './rendering/index.js';
import { CHOKIDAR_IGNORED } from './utils/ignorePatterns.js';
import { broadcastTreeUpdate as sendTreeUpdate } from './websocket.js';

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
    ignored: CHOKIDAR_IGNORED,
    persistent: true,
    ignoreInitial: true,
    depth,
    awaitWriteFinish: {
      stabilityThreshold: AWAIT_WRITE_FINISH_STABILITY_MS,
      pollInterval: AWAIT_WRITE_FINISH_POLL_MS
    }
  });

  function toRelativePath(filePath) {
    return path.relative(rootDir, filePath).split(path.sep).join('/');
  }

  // Coalesce bursts: a bulk FS operation (git checkout, npm install, unzip)
  // fires many add/unlink events. Emit at most one tree_update per debounce
  // window so clients don't re-fetch and re-render the whole tree per event.
  let treeUpdateTimer = null;

  function broadcastTreeUpdate() {
    if (treeUpdateTimer) return; // a broadcast is already scheduled for this burst
    treeUpdateTimer = setTimeout(() => {
      treeUpdateTimer = null;
      sendTreeUpdate(wss);
    }, TREE_UPDATE_DEBOUNCE_MS);
  }

  watcher.on('change', async (filePath) => {
    const relativePath = toRelativePath(filePath);
    const relativeDir = path.dirname(relativePath);

    try {
      const rendered = await renderFile(filePath, relativeDir === '.' ? '' : relativeDir);
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
