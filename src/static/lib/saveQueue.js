/**
 * Per-deck save queue with per-slide-per-origin coalescing.
 *
 * - Saves to the same deck are processed strictly serially (the server has
 *   a per-path mutex, but client-side serialization keeps user-visible
 *   ordering intuitive).
 * - New edits for the same (slideIndex, origin) pair overwrite any pending
 *   value (coalesce). The superseded enqueue() Promise resolves with
 *   { ok: false, reason: 'COALESCED' } so callers awaiting the older write
 *   can drop their stale UI state instead of hanging forever.
 * - Crucially, coalescing is scoped per origin: an inline save and a
 *   presenter save for the same slide do NOT replace each other. Both run
 *   serially so neither editor silently loses a draft.
 * - `saveFn(path, slideIndex, note, etag, origin, requestId)` is supplied by
 *   the caller; `origin` is an optional tag (e.g. 'presenter' / 'inline') the
 *   queue uses for keying and also forwards verbatim so saveFn can route
 *   notifications back to the right editor. `requestId` is an optional
 *   opaque token forwarded verbatim so a caller can correlate the save's
 *   result with the request that triggered it.
 * - enqueue() returns a Promise that resolves with the saveFn's result (or a
 *   COALESCED sentinel). Existing callers that ignore the return value or
 *   skip the origin argument keep working unchanged.
 *
 * Loaded as a native ES module (`<script type="module">`). Exposes named
 * exports for direct `import`, and also still sets `window.MDVSaveQueue` for
 * any not-yet-migrated code that reads the global directly.
 */
function buildKey(slideIndex, origin) {
  return slideIndex + '|' + (origin || '');
}

function createSaveQueue({ saveFn }) {
  /** @type {Map<string, { pending: Map<string, {slideIndex:number, note:string, etag:string|null, origin:string|undefined, resolve:Function}>, isDraining: boolean }>} */
  const queue = new Map();

  function enqueue(path, slideIndex, note, etag, origin, requestId) {
    return new Promise((resolve) => {
      let entry = queue.get(path);
      if (!entry) {
        entry = { pending: new Map(), isDraining: false };
        queue.set(path, entry);
      }
      const key = buildKey(slideIndex, origin);
      const existing = entry.pending.get(key);
      if (existing) {
        existing.resolve({ ok: false, reason: 'COALESCED' });
      }
      entry.pending.set(key, { slideIndex, note, etag, origin, requestId, resolve });
      if (!entry.isDraining) drain(path);
    });
  }

  async function drain(path) {
    const entry = queue.get(path);
    if (!entry || entry.isDraining) return;
    entry.isDraining = true;
    try {
      while (entry.pending.size > 0) {
        const it = entry.pending.entries().next();
        if (it.done) break;
        const [key, payload] = it.value;
        entry.pending.delete(key);
        let result;
        try {
          result = await saveFn(
            path, payload.slideIndex, payload.note, payload.etag,
            payload.origin, payload.requestId
          );
        } catch (err) {
          console.error('saveQueue saveFn error', err);
          result = { ok: false, reason: String(err && err.message || err) };
        }
        payload.resolve(result);
      }
    } finally {
      entry.isDraining = false;
      if (entry.pending.size === 0) queue.delete(path);
    }
  }

  /** Drop all pending edits for a path (e.g. when its tab is closed). */
  function dropPath(path) {
    const entry = queue.get(path);
    if (!entry) return;
    entry.pending.forEach((payload) => {
      payload.resolve({ ok: false, reason: 'DROPPED' });
    });
    entry.pending.clear();
    // If a drain is in-flight, it will exit cleanly once the map is empty.
    if (!entry.isDraining) queue.delete(path);
  }

  /** Test/observation helper. */
  function _size() { return queue.size; }

  return { enqueue, drain, dropPath, _size };
}

export { createSaveQueue };

if (typeof globalThis !== 'undefined') {
  globalThis.MDVSaveQueue = { createSaveQueue };
}
