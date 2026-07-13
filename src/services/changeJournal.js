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
 * THREE independent protections, layered:
 *  - `maxBytesTotal` — a global LRU (across every path) on total content
 *    bytes held. Recording a new snapshot that would push the running total
 *    over this limit evicts the globally least-recently-touched snapshot(s)
 *    first (their *content* is dropped; the version record itself — hash,
 *    byte size, timestamp — is kept so latestHash()/listVersions() stay
 *    accurate; see the `hasContent` flag on listVersions()).
 *  - `maxVersionsPerFile` — a per-path cap on how many distinct-hash
 *    versions are remembered at all, independent of the byte budget.
 *  - **pin** (`pinnedByPath`, Fix 1/2, 2026-07-13; public `pin()`, Fix 5,
 *    2026-07-13; **pin HISTORY (not a single slot), codex round-2 P1,
 *    2026-07-14**) — `pin(path, hash)` adds `hash` to `path`'s pinned-hash
 *    WINDOW (most-recently-pinned last, capped at `pinHistorySize` — see
 *    below), and is a no-op if the hash is unknown or its content has been
 *    evicted/oversized. `get(path, hash)` calls it internally the moment a
 *    lookup SUCCEEDS (entry exists AND its content hasn't been
 *    evicted/oversized) — that was the ONLY way to pin before Fix 5;
 *    src/api/diff.js's `from === currentHash` (identical) branch now also
 *    calls `pin()` directly, since that branch never calls `get()` (there
 *    is no earlier hash to look up) but still represents the client
 *    confirming its current baseline is correct. Each pin is the client's
 *    confirmed diff baseline AT THE TIME it was pinned (the `from` hash of
 *    a GET /api/diff request — see src/api/diff.js) and is never
 *    time-limited on its own: it holds until it falls out of the window
 *    (see below). Both eviction paths below skip a path's currently-pinned
 *    versions/cells — UNLESS every other candidate is also excluded
 *    (pinned or newest), in which case the byte budget still wins; a pin
 *    must never become an unbounded memory leak. A cell force-evicted that
 *    way has its pin removed from the window too (`evictCell()`) — a
 *    stale pin pointing at a content-less shell would otherwise block
 *    per-file cap eviction from ever choosing that (now-worthless) shell,
 *    sacrificing a real, still-retrievable version in its place instead.
 *
 *    Why a WINDOW of pins, not one slot: a single slot meant a late,
 *    still-in-flight GET /api/diff for an OLDER `from` hash (e.g. a request
 *    issued before the user clicked "✓確認" that only reaches the server
 *    AFTER a newer hash was already pinned) would call `get()` on that
 *    older hash and silently re-pin it — evicting the newer pin's
 *    protection even though the client has already moved on. Keeping the
 *    last `pinHistorySize` (default `JOURNAL_PIN_HISTORY_SIZE`, see
 *    constants.js) distinct pinned hashes per path means that race no
 *    longer costs the newer pin its protection — both stay protected until
 *    the window itself grows past its cap.
 *
 *    Why a pin (window) and not just "touch recency on get()" (the design
 *    the single-slot version replaced): mdv's own editor stops polling
 *    /api/diff while the user is actively typing
 *    (src/static/modules/diffReview.js early-returns in edit mode), so a
 *    purely time-based/recency protection goes cold mid-edit and the
 *    autosave-driven flood of record() calls evicts the baseline anyway. A
 *    pin set once at the start of editing survives because it isn't
 *    re-earned by repeated touches — it's held until it ages out of the
 *    window.
 *
 *    `lastUsed` (per version entry) is unrelated to `ts`: `ts` is the
 *    wall-clock time of the entry's most recent record() call (inspection
 *    only, via listVersions()); `lastUsed` is a monotonically increasing
 *    counter (`++accessSeq`, NOT Date.now() — ms-granularity ties let a
 *    just-touched baseline be selected as its own eviction victim) bumped
 *    only by a successful get(), used purely to rank version-cap eviction
 *    candidates that are neither pinned nor the newest version.
 *
 *  - `maxBytesPerFile` — a single file's content is only stored if it fits;
 *    an oversized file still gets a "hash-only" version record (same
 *    `get()` contract as an evicted one: content is null). A null-content
 *    lookup NEVER pins or touches — there is nothing to diff against, so
 *    "using" it isn't meaningful, and doing so would let a shell block
 *    eviction forever (see get() below).
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
  JOURNAL_PIN_HISTORY_SIZE,
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
 * @param {number} [options.pinHistorySize] - Per-path count of simultaneously
 *   protected pinned hashes (JOURNAL_PIN_HISTORY_SIZE) — see the module
 *   docstring's pin section above for why this is a window, not one slot.
 * @returns {{
 *   record: (path: string, content: string) => string,
 *   get: (path: string, hash: string) => string|null,
 *   pin: (path: string, hash: string) => boolean,
 *   latestHash: (path: string) => string|null,
 *   listVersions: (path: string) => Array<{hash: string, bytes: number, ts: number, hasContent: boolean}>,
 * }}
 */
export function createChangeJournal({
  maxBytesTotal = JOURNAL_MAX_BYTES,
  maxBytesPerFile = JOURNAL_MAX_FILE_BYTES,
  maxVersionsPerFile = JOURNAL_MAX_VERSIONS_PER_FILE,
  pinHistorySize = JOURNAL_PIN_HISTORY_SIZE,
} = {}) {
  // path -> version records, LEAST-RECENTLY-RECORDED FIRST:
  // { hash, content: string|null, bytes, ts, lastUsed }
  const filesByPath = new Map();

  // path -> pinned-hash WINDOW (string[], least-recently-pinned first,
  // length <= pinHistorySize): every hash in the array is CURRENTLY
  // protected for that path — see module docstring above (codex round-2
  // P1, 2026-07-14). A hash pinned again while already in the window just
  // moves to the most-recent end rather than duplicating.
  const pinnedByPath = new Map();

  /** Is `hash` currently within `path`'s pinned window? */
  function isPinned(path, hash) {
    const pins = pinnedByPath.get(path);
    return !!pins && pins.includes(hash);
  }

  // Monotonic counter backing `lastUsed`. Deliberately NOT Date.now() —
  // ms-granularity ties would let a just-pinned entry be chosen as its own
  // eviction victim in the same tick (codex #2, 2026-07-13).
  let accessSeq = 0;

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

  /** Evict a single content cell (helper shared by evictOldestCell()'s two passes). */
  function evictCell(key) {
    const bytes = lru.get(key);
    lru.delete(key);
    totalBytes -= bytes;

    const sep = key.indexOf('\u0000');
    const path = key.slice(0, sep);
    const hash = key.slice(sep + 1);
    const versions = filesByPath.get(path);
    const entry = versions && versions.find((v) => v.hash === hash);
    if (entry) entry.content = null; // keep the version record; drop only the bytes

    // codex round-2 P2 (2026-07-14): a forced eviction can target a
    // PINNED cell when every other candidate is also pinned/newest (the
    // "byte budget always wins" tier below). If it does, the pin must be
    // removed here too -- otherwise pinnedByPath keeps pointing at a
    // content-less shell, and the per-file version-cap loop's "skip
    // pinned hashes" rule would then treat that worthless shell as
    // untouchable forever, sacrificing a DIFFERENT, still-retrievable
    // version in its place (an avoidable unknown-baseline).
    const pins = pinnedByPath.get(path);
    if (pins) {
      const idx = pins.indexOf(hash);
      if (idx !== -1) {
        pins.splice(idx, 1);
        if (pins.length === 0) pinnedByPath.delete(path);
      }
    }

    return true;
  }

  /**
   * Evict a content cell to bring totalBytes back under budget. Called
   * from record() right after it added-or-restored ITS OWN path cell,
   * passed in as `justWrittenKey` (codex round-2 P2, 2026-07-14 -- record()
   * knows this key directly, O(1), instead of this function inferring it by
   * materializing/copying every lru key just to read off the last one) --
   * that cell is excluded from candidacy too, or a record() whose two
   * other tracked paths both happen to be pinned would immediately null
   * out the content it just wrote, defeating the write (surfaced by the
   * pre-existing global byte-budget LRU eviction unit test once pins were
   * added, 2026-07-13).
   *
   * Priority (Fix 2, 2026-07-13): (1) oldest cell that is neither pinned
   * nor the just-written one, (2) if every OTHER cell is pinned, the oldest
   * of those -- the byte budget must never be violated just to keep every
   * pin alive, (3) only if the just-written cell is the ONLY cell that
   * exists at all (maxBytesTotal smaller than a single entry) does it get
   * sacrificed too. Returns false if there is nothing to evict.
   *
   * Iterates the `lru` Map's own key iterator directly, breaking as soon as
   * a victim is found -- NOT `[...lru.keys()]` (codex round-2 P2,
   * 2026-07-14): with many tracked snapshots, materializing and copying
   * every key on EVERY eviction call, repeated once per victim needed, was
   * avoidable quadratic-ish overhead on the request thread.
   * @param {string} [justWrittenKey]
   */
  function evictOldestCell(justWrittenKey) {
    if (lru.size === 0) return false;

    for (const key of lru.keys()) {
      if (key === justWrittenKey) continue;
      const sep = key.indexOf("\u0000");
      const path = key.slice(0, sep);
      const hash = key.slice(sep + 1);
      if (isPinned(path, hash)) continue; // protected -- try the next-oldest
      return evictCell(key);
    }
    for (const key of lru.keys()) {
      if (key === justWrittenKey) continue;
      return evictCell(key); // every other cell is pinned -- the budget still wins
    }
    return justWrittenKey !== undefined ? evictCell(justWrittenKey) : false; // nothing else exists at all
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
            if (!evictOldestCell(key)) break;
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
      lastUsed: 0, // bumped only by a successful get() — see module docstring
    };
    versions.push(entry);

    // The cell THIS call itself wrote to lru (undefined if oversized — an
    // oversized entry is never added to lru, so there is nothing of this
    // call's own to protect from eviction below). Tracked directly (codex
    // round-2 P2, 2026-07-14) so evictOldestCell() never has to infer it by
    // materializing/copying lru's keys.
    let justWrittenKey;
    if (!oversized) {
      justWrittenKey = cellKey(path, hash);
      lru.set(justWrittenKey, bytes);
      totalBytes += bytes;
    }

    // Per-file version cap FIRST (codex round-6): dropping this path's
    // over-cap version often brings the journal back under budget on its
    // own — running the global eviction before it could sacrifice another
    // file's baseline for a transient overage.
    //
    // Victim selection (Fix 2, 2026-07-13; pin WINDOW not a single slot,
    // codex round-2 P1, 2026-07-14): never the newest version (last array
    // element — always excluded regardless of pin/lastUsed) or any of the
    // path's currently-pinned versions (see isPinned() / module docstring).
    // Among the rest, prefer an already-content-less "shell" (content ===
    // null — nothing left to lose by dropping the record too), then the
    // version least recently used (lowest `lastUsed`; ties keep the
    // earliest-recorded candidate, matching the old shift()-oldest
    // behavior when nothing has ever been touched). If every remaining
    // version is pinned or newest, there is nothing safe to evict —
    // tolerate the cap overage for this record() call rather than destroy
    // a live baseline.
    while (versions.length > maxVersionsPerFile) {
      const newest = versions[versions.length - 1];
      let victimIndex = -1;
      for (let i = 0; i < versions.length; i++) {
        const v = versions[i];
        if (v === newest) continue;
        if (isPinned(path, v.hash)) continue;
        if (victimIndex === -1) {
          victimIndex = i;
          continue;
        }
        const candidate = versions[victimIndex];
        const vIsShell = v.content === null;
        const candidateIsShell = candidate.content === null;
        if (vIsShell && !candidateIsShell) {
          victimIndex = i;
        } else if (vIsShell === candidateIsShell && v.lastUsed < candidate.lastUsed) {
          victimIndex = i;
        }
      }
      if (victimIndex === -1) break; // nothing evictable — tolerate cap overage

      const [dropped] = versions.splice(victimIndex, 1);
      const key = cellKey(path, dropped.hash);
      if (lru.has(key)) {
        totalBytes -= lru.get(key);
        lru.delete(key);
      }
    }

    while (totalBytes > maxBytesTotal) {
      if (!evictOldestCell(justWrittenKey)) break;
    }

    return hash;
  }

  /**
   * Pin `hash` into `path`'s pinned-hash WINDOW — protected from both the
   * version cap and the global LRU (see module docstring) until it ages
   * out of that window (more than `pinHistorySize` DIFFERENT hashes have
   * been pinned for `path` since). No-ops (returns false) if `hash` was
   * never recorded for `path`, or its content has already been
   * evicted/oversized — a content-less shell has nothing to diff against,
   * so "confirming" it as a baseline would be meaningless and would let a
   * shell block eviction forever (same rule get() enforced inline before
   * Fix 5).
   *
   * This is the ONE place the pin/lastUsed/LRU-touch condition lives
   * (SSOT, Fix 5, 2026-07-13) — get() below is just "look up, then pin()
   * on success" so the two can never drift. src/api/diff.js's `from ===
   * currentHash` (identical, nothing changed yet) branch calls this
   * directly: that branch never calls get() (there is no earlier hash to
   * look up), so without a standalone pin() it had no way to protect the
   * baseline a client had just confirmed is still current — the gap that
   * let a file opened via Review ON with no pending edit lose its
   * baseline the moment edit-mode autosave started churning versions.
   *
   * Re-pinning an ALREADY-pinned hash just moves it to the most-recent end
   * of the window (no duplicate entry, no window churn) — this matters for
   * the race the window itself exists to close (codex round-2 P1,
   * 2026-07-14): a late, still-in-flight request re-confirming an OLDER
   * hash no longer costs a NEWER hash its protection, because both simply
   * coexist in the window rather than fighting over one slot.
   * @param {string} path
   * @param {string} hash
   * @returns {boolean} true if `hash` was pinned, false if it couldn't be
   *   (unknown path/hash, or a content-less shell).
   */
  function pin(path, hash) {
    const versions = filesByPath.get(path);
    if (!versions) return false;
    const entry = versions.find((v) => v.hash === hash);
    if (!entry || entry.content === null) return false;

    let pins = pinnedByPath.get(path);
    if (!pins) {
      pins = [];
      pinnedByPath.set(path, pins);
    }
    const existingPinIndex = pins.indexOf(hash);
    if (existingPinIndex !== -1) pins.splice(existingPinIndex, 1); // re-pin: move to the end, don't duplicate
    pins.push(hash);
    if (pins.length > pinHistorySize) pins.shift(); // window full: the OLDEST pin ages out

    entry.lastUsed = ++accessSeq; // monotonic — see module docstring for why not Date.now()

    // Touch the LRU cell too: an actively-diffed baseline must not be the
    // next eviction victim while colder entries survive (codex round-3).
    const key = cellKey(path, hash);
    if (lru.has(key)) {
      const bytes = lru.get(key);
      lru.delete(key);
      lru.set(key, bytes);
    }
    return true;
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
    // Only a SUCCESSFUL lookup (entry exists, content still held) pins or
    // touches anything (Fix 1, 2026-07-13) — a shell with nothing to diff
    // against isn't a meaningful "use", and pinning it would let a
    // content-less record block eviction forever. pin() re-checks the
    // same condition (SSOT, Fix 5) — the redundant lookup is cheap
    // (versions arrays are capped at maxVersionsPerFile, currently 32).
    if (!entry || entry.content === null) return null;
    pin(path, hash);
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
   * least-recently-recorded first — NOT strictly creation order: re-
   * recording an already-known hash (see record() above) moves it to the
   * end, so a version that keeps getting re-saved with unchanged content
   * stays "newest" even though it was first seen long ago. `ts` is the
   * wall-clock time of the entry's most recent record() call; it is
   * unrelated to `lastUsed` (bumped only by get(), used only to rank
   * version-cap eviction candidates — see the module docstring above),
   * which this method does not expose.
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

  return { record, get, pin, latestHash, listVersions };
}

export default createChangeJournal;
