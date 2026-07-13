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
 * @param {{ record: (path: string, content: string) => string, deletePath: (path: string) => void }} [options.journal] -
 *   Change journal (src/services/changeJournal.js) to record a snapshot of
 *   every changed file into, BEFORE broadcasting file_update, and to clean
 *   up (deletePath) when a file is unlinked. Optional so callers that don't
 *   need change tracking (e.g. tests exercising the watcher in isolation)
 *   can omit it.
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

  // Per-path monotonic event sequence (codex 0.6.5 round-6): the async
  // add/change handlers hash file contents, so a slow handler for an OLD
  // event can finish after a newer event's handler (rapid rewrite then
  // delete, large-to-small rewrite) and would otherwise overwrite the
  // newer item in the coalescing Map. Each handler claims a sequence
  // number SYNCHRONOUSLY at event time; by schedule time, only the
  // holder of the path's newest sequence may write.
  let fsEventCounter = 0;
  const pathEventSeq = new Map();

  function claimEventSeq(relativePath) {
    const seq = ++fsEventCounter;
    pathEventSeq.set(relativePath, seq);
    return seq;
  }

  function scheduleFilesChanged(item, seq) {
    if (seq !== undefined && pathEventSeq.get(item.path) !== seq) {
      return; // a newer fs event for this path superseded this work
    }
    filesChangedItems.set(item.path, { item, seq });
    if (filesChangedTimer) return; // a broadcast is already scheduled for this burst
    filesChangedTimer = setTimeout(() => {
      filesChangedTimer = null;
      const flushed = filesChangedItems;
      filesChangedItems = new Map();
      // Two rules per flushed path (codex rounds 7-8):
      // 1. Superseded items are NOT broadcast: if the path's newest claim
      //    belongs to a still-in-flight handler (its render/hash outlived
      //    the debounce window), this queued item is stale — the in-flight
      //    handler will schedule the fresh one when it finishes.
      // 2. Hygiene: items that ARE the newest claim are fully consumed —
      //    drop their pathEventSeq entry so the table doesn't grow one
      //    entry per unique path forever.
      const items = [];
      for (const [p, { item, seq: flushedSeq }] of flushed) {
        if (flushedSeq !== undefined && pathEventSeq.get(p) !== flushedSeq) {
          continue; // rule 1: superseded — a newer handler owns this path
        }
        if (flushedSeq !== undefined) pathEventSeq.delete(p); // rule 2
        items.push(item);
      }
      if (items.length === 0) return;
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
    const trackable = isTrackable(relativePath);
    // Claim a seq for EVERY path, not just badge-feed (trackable) ones
    // (codex P2-b, 2026-07-14 review round). journal.record() below runs
    // for ANY changed file regardless of trackability (see the 0.6.3
    // comment further down), so a non-trackable path (HTML etc.) needs the
    // same stale-event protection a trackable one gets — see the guard
    // comment below for the race this closes. Round-7's original concern
    // (the table growing one entry per path that never enters the badge
    // feed) is preserved, not reintroduced: a non-trackable path's claim is
    // deleted again the moment this handler is done with it (see the
    // `trackable` branch below) — nothing else (no scheduleFilesChanged
    // flush) would ever clean it up otherwise, unlike a trackable path's
    // entry, which the debounce flush's hygiene step consumes.
    const seq = claimEventSeq(relativePath);
    const relativeDir = path.dirname(relativePath);

    try {
      const rendered = await renderFile(filePath, relativeDir === '.' ? '' : relativeDir);

      // Superseded-event guard (codex P2, 2026-07-14 review round; widened
      // to cover every path, not just trackable ones, in a later P2-b
      // round the same day): the await above can resolve AFTER a LATER fs
      // event already claimed a newer seq for this same path — most
      // importantly 'unlink' (below), which calls journal.deletePath()
      // synchronously the instant it fires. A now-stale handler that still
      // journal.record()s would resurrect a just-deleted path's history (a
      // recreated file inheriting a pre-deletion baseline/pin it should
      // never have seen). This used to only apply when `seq !== undefined`
      // — non-trackable paths never claimed one, so a stale 'change'
      // handler for e.g. an .html file could race its own 'unlink' and
      // resurrect its journal entry unguarded. Every path now claims a
      // seq (above), so this is a plain inequality check.
      //
      // The whole handler bails, not just the journal write: record() and
      // broadcastFileUpdate() are a PAIR (see the 0.6.3 comment below —
      // the journal is seeded BEFORE broadcasting precisely so a diff
      // request racing the WS message can use that version as a `from`
      // baseline). Skipping only the record while still broadcasting would
      // ship the client an etag the journal has never heard of — the exact
      // unknown-baseline shape this whole change exists to eliminate.
      // Dropping the stale event entirely is also simply correct: a newer
      // event for this path already claimed the seq, and its own handler
      // broadcasts the newer content (or, for 'unlink', removes the file).
      if (pathEventSeq.get(relativePath) !== seq) return;

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
      if (trackable) {
        scheduleFilesChanged({ path: relativePath, etag, kind: 'changed' }, seq);
      } else {
        // No scheduleFilesChanged() flush will ever consume/delete this
        // path's pathEventSeq entry (that hygiene only runs for items that
        // entered the badge feed) — release it right away so the table
        // doesn't grow one entry per non-trackable path forever (codex
        // P2-b, 2026-07-14; see the claimEventSeq() call's comment above).
        pathEventSeq.delete(relativePath);
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
    const seq = claimEventSeq(relativePath);
    let etag;
    try {
      const stat = await fs.stat(filePath);
      if (stat.size <= JOURNAL_MAX_FILE_BYTES) {
        const raw = await fs.readFile(filePath, 'utf-8');
        etag = makeEtag(raw);
        // Superseded-event guard (codex P2, 2026-07-14 review round): same
        // race as the 'change' handler above — a slow stat/read here can
        // resolve AFTER a later 'unlink' already claimed a newer seq (and
        // called journal.deletePath()) for this path. `seq` is always
        // defined at this point (the isTrackable early-return above is the
        // only path that skips claimEventSeq()), so no `undefined` check is
        // needed here unlike the 'change' handler.
        if (journal && pathEventSeq.get(relativePath) === seq) {
          journal.record(relativePath, raw);
        }
      }
    } catch {
      // Unreadable/vanished before we got to it — fall through etag-less;
      // an unlink event will clean up if it's really gone.
    }
    scheduleFilesChanged(
      etag
        ? { path: relativePath, etag, kind: 'added' }
        : { path: relativePath, kind: 'added' },
      seq
    );
  });

  // Deleted files leave the badge feed too, or the client's unread map
  // keeps counting ghosts (and 次の未読へ opens a dead path). Renames
  // arrive as unlink+add pairs and are covered by both handlers
  // (codex 0.6.5 round-1).
  //
  // journal.deletePath() (Fix 4, 2026-07-13): a deleted file's version
  // history/pin/LRU cells are forgotten too, not left dangling — the
  // 'change' handler above journals EVERY changed file regardless of
  // isTrackable, so cleanup here can't be gated on isTrackable either, or
  // a non-trackable file's journal entries would survive its own deletion.
  watcher.on('unlink', (filePath) => {
    const relativePath = toRelativePath(filePath);
    if (journal) journal.deletePath(relativePath);
    if (isTrackable(relativePath)) {
      const seq = claimEventSeq(relativePath);
      scheduleFilesChanged({ path: relativePath, kind: 'removed' }, seq);
    } else {
      // Mirror of the 'change' handler's guard, for the other half of the
      // same race (codex P2-b, 2026-07-14): a 'change' handler for this
      // SAME non-trackable path may be mid-await right now (already past
      // its claimEventSeq() call above), about to journal.record() a
      // version of a file journal.deletePath() just forgot. Invalidate its
      // claim so that handler's stale-event guard sees a mismatch and
      // bails instead of resurrecting the just-deleted entry. Deleting the
      // pathEventSeq entry (rather than bumping it to a fresh number via
      // claimEventSeq()) is enough — the 'change' handler's guard only
      // checks for INEQUALITY with the seq it captured, and `undefined !==
      // <anything>` already satisfies that — and it also means there is
      // nothing left in the table afterward for round-7's cleanup concern
      // to worry about (no scheduleFilesChanged() call happens on this
      // branch, so nothing else would otherwise be able to release it).
      pathEventSeq.delete(relativePath);
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
