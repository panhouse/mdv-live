/**
 * In-memory "change journal" — keeps a bounded number of recent raw-content
 * snapshots per file path, keyed by content hash, so src/api/diff.js can
 * compute a line diff between "what the client last saw" (a hash) and the
 * current file content.
 *
 * Pure in-memory, no fs — a server restart forgets everything (by design;
 * src/api/diff.js surfaces that as `{ available: false, reason:
 * 'unknown-baseline' }`, never a crash). Backs the 0.6.3 change-tracking
 * backend (docs/plan-review-surface-0.6.x.md §②).
 *
 * Two independent bounds, both eviction-driven (never an error):
 *  - `maxBytesTotal` — a global LRU (across every path) on total content
 *    bytes held. Recording a new snapshot that would push the running total
 *    over this limit evicts the globally least-recently-touched snapshot(s)
 *    first (their *content* is dropped; the version record itself — hash,
 *    byte size, timestamp — is kept so latestHash()/listVersions() stay
 *    accurate; see the `hasContent` flag on listVersions()).
 *  - `maxVersionsPerFile` — a per-path cap on how many distinct-hash
 *    versions are remembered at all, independent of the byte budget. The
 *    oldest version for that path is dropped once a new one would exceed it.
 *  - `maxBytesPerFile` — a single file's content is only stored if it fits;
 *    an oversized file still gets a "hash-only" version record (same
 *    `get()` contract as an evicted one: content is null).
 *
 * get(path, hash) cannot distinguish "hash never seen" from "hash seen but
 * content evicted/oversized" — both return null. That's intentional: every
 * consumer of get() (src/api/diff.js) only needs "do I have the content to
 * diff against right now?", and both cases mean "no".
 */

import { makeEtag } from '../utils/etag.js';
import {
  JOURNAL_MAX_BYTES,
  JOURNAL_MAX_FILE_BYTES,
  JOURNAL_MAX_VERSIONS_PER_FILE,
} from '../config/constants.js';

/** UTF-8 byte length of a string (matches makeEtag/atomicWrite's byte-oriented size checks elsewhere). */
function byteLength(content) {
  return Buffer.byteLength(content, 'utf8');
}

/**
 * @param {Object} [options]
 * @param {number} [options.maxBytesTotal] - Global content-byte budget (JOURNAL_MAX_BYTES).
 * @param {number} [options.maxBytesPerFile] - Per-snapshot size cap (JOURNAL_MAX_FILE_BYTES).
 * @param {number} [options.maxVersionsPerFile] - Per-path version-count cap (JOURNAL_MAX_VERSIONS_PER_FILE).
 * @returns {{
 *   record: (path: string, content: string) => string,
 *   get: (path: string, hash: string) => string|null,
 *   latestHash: (path: string) => string|null,
 *   listVersions: (path: string) => Array<{hash: string, bytes: number, ts: number, hasContent: boolean}>,
 * }}
 */
export function createChangeJournal({
  maxBytesTotal = JOURNAL_MAX_BYTES,
  maxBytesPerFile = JOURNAL_MAX_FILE_BYTES,
  maxVersionsPerFile = JOURNAL_MAX_VERSIONS_PER_FILE,
} = {}) {
  // path -> version records, OLDEST FIRST: { hash, content: string|null, bytes, ts }
  const filesByPath = new Map();

  // Global LRU of "cells" that currently hold stored content bytes.
  // key = `${path}\u0000${hash}` -> bytes stored. A `Map` preserves
  // insertion order, so the first key is always the globally
  // least-recently-touched one; delete+re-set on a touch moves it to the
  // most-recently-used end. Hash-only (oversized/evicted) entries are never
  // present here and don't count against maxBytesTotal.
  const lru = new Map();
  let totalBytes = 0;

  function cellKey(path, hash) {
    return `${path}\u0000${hash}`;
  }

  /** Evict the single globally-oldest content cell. Returns false if there's nothing left to evict. */
  function evictOldestCell() {
    const oldestKey = lru.keys().next().value;
    if (oldestKey === undefined) return false;

    const bytes = lru.get(oldestKey);
    lru.delete(oldestKey);
    totalBytes -= bytes;

    const sep = oldestKey.indexOf('\u0000');
    const path = oldestKey.slice(0, sep);
    const hash = oldestKey.slice(sep + 1);
    const versions = filesByPath.get(path);
    const entry = versions && versions.find((v) => v.hash === hash);
    if (entry) entry.content = null; // keep the version record; drop only the bytes

    return true;
  }

  /**
   * Record a snapshot of `content` for `path`, keyed by its content hash.
   * Re-recording identical content (same hash) is a no-op besides touching
   * recency. Returns the hash (same value makeEtag(content) would).
   * @param {string} path
   * @param {string} content
   * @returns {string} content hash (`sha256:<hex>`)
   */
  function record(path, content) {
    const hash = makeEtag(content);

    let versions = filesByPath.get(path);
    if (!versions) {
      versions = [];
      filesByPath.set(path, versions);
    }

    const existingIndex = versions.findIndex((v) => v.hash === hash);
    if (existingIndex !== -1) {
      const [existing] = versions.splice(existingIndex, 1);
      existing.ts = Date.now();
      versions.push(existing); // move to most-recent end (per-file order)

      const key = cellKey(path, hash);
      if (lru.has(key)) {
        const bytes = lru.get(key);
        lru.delete(key);
        lru.set(key, bytes); // touch: move to most-recently-used end
      } else if (existing.content === null) {
        // The record survived but its bytes were LRU-evicted (or it was
        // recorded oversized). Re-recording the same content is our one
        // chance to RESTORE it — otherwise lazy seeding via /api/diff can
        // never recover this baseline until the file changes hash.
        const restoredBytes = byteLength(content);
        if (restoredBytes <= maxBytesPerFile) {
          existing.content = content;
          existing.bytes = restoredBytes;
          lru.set(key, restoredBytes);
          totalBytes += restoredBytes;
          while (totalBytes > maxBytesTotal) {
            if (!evictOldestCell()) break;
          }
        }
      }
      return hash;
    }

    const bytes = byteLength(content);
    const oversized = bytes > maxBytesPerFile;
    const entry = {
      hash,
      content: oversized ? null : content,
      bytes: oversized ? 0 : bytes,
      ts: Date.now(),
    };
    versions.push(entry);

    if (!oversized) {
      lru.set(cellKey(path, hash), bytes);
      totalBytes += bytes;
    }

    // Per-file version cap FIRST (codex round-6): dropping this path's
    // over-cap version often brings the journal back under budget on its
    // own — running the global eviction before it could sacrifice another
    // file's baseline for a transient overage.
    while (versions.length > maxVersionsPerFile) {
      const dropped = versions.shift();
      const key = cellKey(path, dropped.hash);
      if (lru.has(key)) {
        totalBytes -= lru.get(key);
        lru.delete(key);
      }
    }

    while (totalBytes > maxBytesTotal) {
      if (!evictOldestCell()) break;
    }

    return hash;
  }

  /**
   * @param {string} path
   * @param {string} hash
   * @returns {string|null} The stored content, or null if the hash was
   *   never recorded for this path, or its content was evicted/oversized.
   */
  function get(path, hash) {
    const versions = filesByPath.get(path);
    if (!versions) return null;
    const entry = versions.find((v) => v.hash === hash);
    if (!entry) return null;
    if (entry.content !== null) {
      // Touch the LRU cell: an actively-diffed baseline must not be the
      // next eviction victim while colder entries survive (codex round-3).
      const key = cellKey(path, hash);
      if (lru.has(key)) {
        const bytes = lru.get(key);
        lru.delete(key);
        lru.set(key, bytes);
      }
    }
    return entry.content;
  }

  /**
   * @param {string} path
   * @returns {string|null} The hash of the most recently recorded version, or null if none.
   */
  function latestHash(path) {
    const versions = filesByPath.get(path);
    if (!versions || versions.length === 0) return null;
    return versions[versions.length - 1].hash;
  }

  /**
   * Test/inspection hook: every version record currently kept for `path`,
   * oldest first.
   * @param {string} path
   * @returns {Array<{hash: string, bytes: number, ts: number, hasContent: boolean}>}
   */
  function listVersions(path) {
    const versions = filesByPath.get(path);
    if (!versions) return [];
    return versions.map((v) => ({
      hash: v.hash,
      bytes: v.bytes,
      ts: v.ts,
      hasContent: v.content !== null,
    }));
  }

  return { record, get, latestHash, listVersions };
}

export default createChangeJournal;
