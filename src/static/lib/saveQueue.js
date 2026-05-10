/**
 * Per-deck save queue with per-slide coalescing.
 *
 * - Saves to the same deck are processed strictly serially (the server has
 *   a per-path mutex, but client-side serialization keeps user-visible
 *   ordering intuitive).
 * - New edits for the same slideIndex overwrite any pending value (coalesce).
 *   When coalesced, the superseded enqueue() Promise resolves with
 *   { ok: false, reason: 'COALESCED' } so callers awaiting the older write
 *   can drop their stale UI state instead of hanging forever.
 * - Other slides' pending edits keep their place in insertion order.
 * - `saveFn(path, slideIndex, note, etag, origin)` is supplied by the
 *   caller; `origin` is an optional tag (e.g. 'presenter' / 'inline') that
 *   the queue forwards verbatim so saveFn can route notifications back to
 *   the right editor. Its resolved value is forwarded to enqueue().
 * - enqueue() returns a Promise that resolves with the saveFn's result (or a
 *   COALESCED sentinel). Existing callers that ignore the return value or
 *   skip the origin argument keep working unchanged.
 *
 * Loaded as a classic <script>; exposes window.MDVSaveQueue.
 */
(function () {
  'use strict';

  function createSaveQueue({ saveFn }) {
    /** @type {Map<string, { pendingBySlide: Map<number, {note:string, etag:string|null, origin:string|undefined, resolve:Function}>, isDraining: boolean }>} */
    const queue = new Map();

    function enqueue(path, slideIndex, note, etag, origin) {
      return new Promise((resolve) => {
        let entry = queue.get(path);
        if (!entry) {
          entry = { pendingBySlide: new Map(), isDraining: false };
          queue.set(path, entry);
        }
        const existing = entry.pendingBySlide.get(slideIndex);
        if (existing) {
          existing.resolve({ ok: false, reason: 'COALESCED' });
        }
        entry.pendingBySlide.set(slideIndex, { note, etag, origin, resolve });
        if (!entry.isDraining) drain(path);
      });
    }

    async function drain(path) {
      const entry = queue.get(path);
      if (!entry || entry.isDraining) return;
      entry.isDraining = true;
      try {
        while (entry.pendingBySlide.size > 0) {
          const it = entry.pendingBySlide.entries().next();
          if (it.done) break;
          const [slideIndex, payload] = it.value;
          entry.pendingBySlide.delete(slideIndex);
          let result;
          try {
            result = await saveFn(
              path, slideIndex, payload.note, payload.etag, payload.origin
            );
          } catch (err) {
            console.error('saveQueue saveFn error', err);
            result = { ok: false, reason: String(err && err.message || err) };
          }
          payload.resolve(result);
        }
      } finally {
        entry.isDraining = false;
        if (entry.pendingBySlide.size === 0) queue.delete(path);
      }
    }

    /** Drop all pending edits for a path (e.g. when its tab is closed). */
    function dropPath(path) {
      const entry = queue.get(path);
      if (!entry) return;
      entry.pendingBySlide.forEach((payload) => {
        payload.resolve({ ok: false, reason: 'DROPPED' });
      });
      entry.pendingBySlide.clear();
      // If a drain is in-flight, it will exit cleanly once the map is empty.
      if (!entry.isDraining) queue.delete(path);
    }

    /** Test/observation helper. */
    function _size() { return queue.size; }

    return { enqueue, drain, dropPath, _size };
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.MDVSaveQueue = { createSaveQueue };
  }
})();
