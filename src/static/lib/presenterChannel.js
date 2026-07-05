/**
 * Single source of truth for the BroadcastChannel name and message schemas
 * used between the main MDV window and the Presenter window.
 *
 * Loaded as a native ES module (`<script type="module">`). Exposes named
 * exports for direct `import`, and also still sets
 * `window.MDVPresenterChannel` for presenter.html's inline script and any
 * not-yet-migrated code that reads the global directly.
 *
 * Message types (discriminated by `type`):
 *
 *   main → presenter
 *     { type: 'slides', path, html, css, etag, notes, notesMultiplicity,
 *       current, sourceWindowId }
 *     { type: 'slides', empty: true, reason, sourceWindowId }   ← clear / no-deck
 *     { type: 'index', index }
 *     { type: 'note-saved', path, slideIndex, ok, etag?, normalizedNote?,
 *       code?, reason?, origin, sourceWindowId, requestId }
 *     { type: 'saver-here', path, windowId }                    ← failover reply
 *
 *   presenter → main
 *     { type: 'request-slides' }
 *     { type: 'goto', index }
 *     { type: 'edit-note', path, etag, slideIndex, note, requestId,
 *       targetWindowId }
 *     { type: 'find-saver', path }                              ← failover query
 *
 * Window routing: every main window has a unique `windowId`. Each `slides`
 * message carries the broadcasting window's id as `sourceWindowId`; the
 * presenter pins the first one that can serve the deck and echoes it back as
 * `edit-note.targetWindowId`. Only that one main window performs the save.
 * Without this, N main windows showing the same deck each fire their own PUT
 * and all but one collide on the optimistic lock → spurious "STALE" errors.
 *
 * Failover: if the pinned saver stops answering, the presenter broadcasts
 * `find-saver`; any main window holding the deck (active OR background tab)
 * replies `saver-here` and the presenter re-pins it. Each `edit-note` carries
 * a unique `requestId` echoed back in `note-saved` so the presenter matches a
 * result to the exact save that produced it.
 *
 * The 8 `type` strings above are also exported as the frozen `TYPES` map
 * below (`TYPES.SLIDES === 'slides'`, etc.) so modules/presenterView.js and
 * presenter.html's inline script can compare against `TYPES.X` instead of
 * hand-typing the string. Values are unchanged — this is a rename-free
 * SSOT promotion (audit P3).
 */
const CHANNEL_NAME = 'mdv-marp-presenter';

export const TYPES = Object.freeze({
  SLIDES: 'slides',
  INDEX: 'index',
  NOTE_SAVED: 'note-saved',
  GOTO: 'goto',
  REQUEST_SLIDES: 'request-slides',
  EDIT_NOTE: 'edit-note',
  FIND_SAVER: 'find-saver',
  SAVER_HERE: 'saver-here'
});

function create() {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

// Per-window identifier used to route presenter saves to a single main
// window. crypto.randomUUID is available on localhost (a secure context);
// the fallback keeps things working in any odd environment.
function newWindowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'w-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export { CHANNEL_NAME, create, newWindowId };

if (typeof globalThis !== 'undefined') {
  globalThis.MDVPresenterChannel = { CHANNEL_NAME, create, newWindowId, TYPES };
}
