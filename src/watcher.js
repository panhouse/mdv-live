/**
 * File watcher for MDV using chokidar
 */

import chokidar from 'chokidar';
import fs from 'node:fs/promises';
import path from 'path';
import {
  AWAIT_WRITE_FINISH_POLL_MS,
  AWAIT_WRITE_FINISH_STABILITY_MS,
  FILES_CHANGED_DEBOUNCE_MS,
  JOURNAL_MAX_FILE_BYTES,
  TREE_UPDATE_DEBOUNCE_MS
} from './config/constants.js';
import { renderFile } from './rendering/index.js';
import { makeEtag } from './utils/etag.js';
import { getFileType } from './utils/fileTypes.js';
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

  // Unread/seen tree badges (0.6.5, event-driven per
  // docs/plan-review-surface-0.6.x.md §③, consumed by
  // src/static/modules/unreadBadges.js): coalesce filesystem changes into
  // ONE `files_changed` broadcast per debounce window, same shape as
  // broadcastTreeUpdate() above but carrying WHICH paths changed (keyed by
  // path in this Map, so a path touched more than once in one burst
  // collapses to its latest kind/etag) — the client never hash-scans the
  // whole tree, it only reacts to this feed plus diffReview.js's
  // markSeen()/getLastSeen() baseline. Sent to ALL clients (wss.broadcast),
  // unlike file_update's watch-scoped delivery, since every open client's
  // tree (not just the active tab) needs the badge.
  let filesChangedItems = new Map();
  let filesChangedTimer = null;

  function scheduleFilesChanged(item) {
    filesChangedItems.set(item.path, item);
    if (filesChangedTimer) return; // a broadcast is already scheduled for this burst
    filesChangedTimer = setTimeout(() => {
      filesChangedTimer = null;
      const items = Array.from(filesChangedItems.values());
      filesChangedItems = new Map();
      wss.broadcast({ type: 'files_changed', items });
    }, FILES_CHANGED_DEBOUNCE_MS);
  }

  // The badge feed only reports files the review surface can actually
  // track — the same {markdown, code, text} set diffReview.js's
  // DIFFABLE_FILE_TYPES covers. Anything else (html previews, binaries)
  // would become an unread the client can never mark seen by opening it
  // (codex 0.6.5 round-1).
  const isTrackable = (relativePath) => {
    const { type } = getFileType(relativePath);
    return type === 'markdown' || type === 'code' || type === 'text';
  };

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

      // Same raw-content etag file_update carries, reused (not
      // recomputed) so a hash the badge feed reports is guaranteed to
      // match the one diffReview.js's baseline comparison sees. Only
      // trackable types — see isTrackable below (codex 0.6.5 round-1).
      if (isTrackable(relativePath)) {
        scheduleFilesChanged({ path: relativePath, etag, kind: 'changed' });
      }

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

  // Brand-new files only (not directories). The etag lets the client
  // judge 'added' exactly like 'changed' (compare vs its baseline) —
  // without it, a late-arriving add after create+open flipped a just-seen
  // file back to unread, while skipping those flips left recreated files
  // wearing a stale ✓ (codex 0.6.5 rounds 2-3; the hash resolves both
  // directions of that race). Oversized files ship without an etag and
  // the client falls back to unconditionally-unread.
  watcher.on('add', async (filePath) => {
    const relativePath = toRelativePath(filePath);
    if (!isTrackable(relativePath)) return;
    let etag;
    try {
      const stat = await fs.stat(filePath);
      if (stat.size <= JOURNAL_MAX_FILE_BYTES) {
        const raw = await fs.readFile(filePath, 'utf-8');
        etag = makeEtag(raw);
        if (journal) journal.record(relativePath, raw);
      }
    } catch {
      // Unreadable/vanished before we got to it — fall through etag-less;
      // an unlink event will clean up if it's really gone.
    }
    scheduleFilesChanged(
      etag
        ? { path: relativePath, etag, kind: 'added' }
        : { path: relativePath, kind: 'added' }
    );
  });

  // Deleted files leave the badge feed too, or the client's unread map
  // keeps counting ghosts (and 次の未読へ opens a dead path). Renames
  // arrive as unlink+add pairs and are covered by both handlers
  // (codex 0.6.5 round-1).
  watcher.on('unlink', (filePath) => {
    const relativePath = toRelativePath(filePath);
    if (isTrackable(relativePath)) {
      scheduleFilesChanged({ path: relativePath, kind: 'removed' });
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
