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
import { makeEtag } from './utils/etag.js';
import { CHOKIDAR_IGNORED } from './utils/ignorePatterns.js';
import { broadcastTreeUpdate as sendTreeUpdate } from './websocket.js';

const TREE_CHANGE_EVENTS = ['add', 'unlink', 'addDir', 'unlinkDir'];

/**
 * Setup file watcher
 * @param {string} rootDir - Root directory to watch
 * @param {WebSocketServer} wss - WebSocket server for broadcasting
 * @param {Object} [options] - Watcher options
 * @param {number} [options.depth=3] - Directory depth to watch (prevents EMFILE errors)
 * @param {{ record: (path: string, content: string) => string }} [options.journal] -
 *   Change journal (src/services/changeJournal.js) to record a snapshot of
 *   every changed file into, BEFORE broadcasting file_update. Optional so
 *   callers that don't need change tracking (e.g. tests exercising the
 *   watcher in isolation) can omit it.
 * @returns {FSWatcher} Chokidar watcher instance
 */
export function setupWatcher(rootDir, wss, options = {}) {
  const { depth = 3, journal } = options;

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

      // Change tracking (0.6.3): journal the raw source BEFORE broadcasting,
      // so a diff request racing this WS message can already use this
      // version as a `from` baseline. `etag` is set AFTER spreading
      // `...rendered` so every text-renderable file gets a content-hash
      // etag on file_update — Marp decks already computed one (identical
      // value, since it's also makeEtag() of the same raw source); this
      // just makes it universal instead of Marp-only.
      if (journal) journal.record(relativePath, rendered.raw);
      const etag = makeEtag(rendered.raw);

      wss.broadcastFileUpdate(relativePath, {
        type: 'file_update',
        path: relativePath,
        ...rendered,
        etag
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
