/**
 * Factory for the hand-rolled "debounced action" pattern that used to be
 * duplicated between modules/inlineNotes.js (speaker-notes autosave) and
 * modules/editor.js (markdown editor autosave) — audit item P2, Stage 3f.
 *
 * schedule() (re)arms a timer that fires `fn` after `delayMs` of
 * inactivity, clearing any previous pending timer first (so only the
 * LAST schedule() call in a burst actually fires). flush() fires `fn`
 * immediately if a timer is pending (used before navigation/close so a
 * debounced write isn't lost), and is a no-op if nothing is pending.
 * cancel() drops a pending timer WITHOUT firing `fn` (used on an explicit
 * discard, so a queued autosave can't sneak in after the user said "don't
 * save this").
 *
 * Loaded as a native ES module (`<script type="module">`).
 *
 * NOTE: only modules/inlineNotes.js was rebuilt on this factory.
 * modules/editor.js's autosave (EditorManager.scheduleAutosave/
 * cancelPendingAutosave/flushAutosave) was deliberately left as its
 * hand-rolled original — see editor.js's own docstring ("most
 * correctness-dense file in the app") and the Stage 3f task notes: its
 * debounce is entangled with an in-flight AbortController, a serialized
 * promise chain (`inFlight`), and a `lastAutosaveError` replay path that
 * flushAutosave's own draining loop depends on. Extracting just the
 * timer-scheduling sliver here would still leave the harder half
 * (inFlight chaining / abort / error replay) duplicated in editor.js, so
 * this factory would only be a partial, cosmetic dedup while adding a
 * layer of indirection to the one file in the app where ordering bugs are
 * costliest to get wrong. Deferred rather than forced.
 *
 * @param {{ fn: () => void, delayMs: number }} opts
 * @returns {{ schedule: () => void, flush: () => void, cancel: () => void }}
 */
export function createDebouncedAction({ fn, delayMs }) {
  let timer = null;

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn();
    }
  }

  function cancel() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { schedule, flush, cancel };
}
