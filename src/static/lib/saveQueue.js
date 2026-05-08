/**
 * Per-deck save queue with per-slide coalescing.
 *
 * - Saves to the same deck are processed strictly serially (the server has
 *   a per-path mutex, but client-side serialization keeps user-visible
 *   ordering intuitive).
 * - New edits for the same slideIndex overwrite any pending value (coalesce).
 * - Other slides' pending edits keep their place in insertion order.
 * - `saveFn(path, slideIndex, note, etag)` is supplied by the caller.
 *
 * Loaded as a classic <script>; exposes window.MDVSaveQueue.
 */
(function () {
  'use strict';

  function createSaveQueue({ saveFn }) {
    /** @type {Map<string, { pendingBySlide: Map<number, {note:string, etag:string|null}>, isDraining: boolean }>} */
    const queue = new Map();

    function enqueue(path, slideIndex, note, etag) {
      let entry = queue.get(path);
      if (!entry) {
        entry = { pendingBySlide: new Map(), isDraining: false };
        queue.set(path, entry);
      }
      entry.pendingBySlide.set(slideIndex, { note, etag });
      if (!entry.isDraining) drain(path);
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
          try {
            await saveFn(path, slideIndex, payload.note, payload.etag);
          } catch (err) {
            // Caller logs; never let drain break.
            console.error('saveQueue saveFn error', err);
          }
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
      entry.pendingBySlide.clear();
      // If a drain is isDraining, it will exit cleanly when the map is empty.
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
