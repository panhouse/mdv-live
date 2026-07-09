/**
 * Pure extraction of presenter.html's "save routing" protocol — deciding
 * WHICH main window a Presenter-window note edit gets sent to, and how a
 * lost/unresponsive window is replaced, independent of the DOM/BroadcastChannel
 * plumbing that carries it. Byte-for-byte behavior moved out of presenter.html's
 * inline `<script type="module">` (audit: save-routing was previously
 * DOM-entangled and untested — no unit or E2E coverage of the routing/failover
 * branches).
 *
 * Background (mirrors the BroadcastChannel protocol documented in
 * lib/presenterChannel.js and docs/ARCHITECTURE.md §2.3): a Presenter window
 * can be fed slides by several main windows (the same deck open in more than
 * one tab/window), but exactly ONE of them must perform note saves — routing
 * every edit to every window would have them all fire a PUT and collide on
 * the optimistic lock (spurious "STALE"). So the Presenter pins the first
 * window that proves it holds the deck (a non-empty `slides` broadcast) as
 * its "saver", and stamps every `edit-note` with that window's id as
 * `targetWindowId` so only the pinned window acts on it.
 *
 * State owned by a router instance (mirrors the module-scope `let`s that used
 * to live directly in presenter.html):
 *   - `saverWindowId` — the window currently pinned to receive edit-note
 *     sends for the active deck, or `null` before any window is pinned.
 *   - `inflightSave` — a frozen copy of the edit that was just sent to the
 *     saver `{ path, slideIndex, note, etag, requestId }`, awaiting its
 *     `note-saved` ack, or `null` when nothing is in flight.
 *   - `pendingSave` — a frozen edit `{ path, slideIndex, note, etag }`
 *     waiting for a saver to be (re)pinned via `find-saver`/`saver-here`, or
 *     `null`.
 *
 * Failover: if the pinned saver stops answering (ack timeout) or answers but
 * no longer holds the deck (`note-saved` with `code: NO_DECK` — the window's
 * active tab moved away from this deck), the router un-pins, broadcasts
 * `find-saver`, and re-sends the SAME frozen edit to whichever window answers
 * `saver-here` first — never a live re-read of what the editor currently
 * shows, so a slide navigation or blur during the round trip can't smuggle a
 * different edit into a resend. Each actual send carries a fresh requestId
 * (via the caller-supplied `newRequestId()`) so a stale ack from a
 * superseded/timed-out send can never be mistaken for the current one's ack.
 *
 * This module has no DOM/window references. Every side effect it needs
 * (broadcasting on the channel, telling the UI a save started, telling the UI
 * no saver was found) is an injected callback, so it is usable and testable
 * with `node:test` alone.
 *
 * Loaded as a native ES module (`<script type="module">`). Exposes a named
 * export for direct `import`, and also sets `globalThis.MDVPresenterSaveRouter`
 * for consistency with the other lib/*.js modules (not currently read as a
 * bare global anywhere — presenter.html imports it directly).
 */
import { TYPES } from './presenterChannel.js';
import { ERROR_CODES } from './errorCodes.js';

const DEFAULT_ACK_TIMEOUT_MS = 6000;
const DEFAULT_FIND_SAVER_TIMEOUT_MS = 3000;

/**
 * @param {Object} deps
 * @param {(msg: object) => void} deps.postMessage - send a message on the
 *   BroadcastChannel (the router only ever sends `find-saver`/`edit-note`).
 * @param {() => string} deps.newRequestId - generates a fresh, globally
 *   unique requestId for each actual `edit-note` send.
 * @param {(path: string) => void} [deps.onNoSaverFound] - called when a
 *   `find-saver` query goes unanswered within `findSaverTimeoutMs` AND the
 *   edit it was looking for a home for is still pending (not already
 *   resolved by a `saver-here` reply in the meantime).
 * @param {(payload: object) => void} [deps.onSaveStart] - called at the very
 *   start of every `sendEditNote()` call (including internal resends after a
 *   `saver-here` reply), whether or not a saver is currently pinned.
 * @param {number} [deps.ackTimeoutMs]
 * @param {number} [deps.findSaverTimeoutMs]
 */
function createSaveRouter({
  postMessage,
  newRequestId,
  onNoSaverFound = () => {},
  onSaveStart = () => {},
  ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS,
  findSaverTimeoutMs = DEFAULT_FIND_SAVER_TIMEOUT_MS
}) {
  let saverWindowId = null;
  let saveAckTimer = null;
  let findSaverTimer = null;
  let inflightSave = null;
  let pendingSave = null;

  // Pin (or re-pin) the window serving the current deck as our saver, so
  // edit-note saves route to exactly one window. A non-empty `slides`
  // broadcast proves the sender holds the deck. Only called by the caller
  // for non-empty `slides` payloads (an `empty` payload never reaches this
  // decision — see presenter.html's loadSlides).
  //
  // `prevDeckPath` must be the deck path BEFORE this `slides` payload is
  // applied, so a deck switch is detected even though the Presenter window
  // can be reused by another main window for a different deck (in which case
  // the previous pin may not hold the new deck at all, and must be re-pinned
  // rather than kept just because it's non-null).
  function pinFromSlides({ prevDeckPath, path, sourceWindowId }) {
    const deckChanged = !!path && path !== prevDeckPath;
    if (sourceWindowId && (saverWindowId === null || deckChanged)) {
      saverWindowId = sourceWindowId;
    }
  }

  // Broadcast a find-saver query for `path` and bound the wait: a deck open
  // in ANY window's tab (active OR background) answers `saver-here`; if none
  // does within the timeout, the deck has no reachable window.
  function requestSaver(path) {
    postMessage({ type: TYPES.FIND_SAVER, path });
    if (findSaverTimer !== null) clearTimeout(findSaverTimer);
    findSaverTimer = setTimeout(() => {
      findSaverTimer = null;
      if (pendingSave !== null) {
        pendingSave = null;
        onNoSaverFound(path);
      }
    }, findSaverTimeoutMs);
  }

  // Re-pin a live saver and resend `payload` (the exact edit that could not
  // be delivered). Used when the saver window stops answering or no longer
  // holds the deck.
  function failOver(payload) {
    if (saveAckTimer !== null) {
      clearTimeout(saveAckTimer);
      saveAckTimer = null;
    }
    saverWindowId = null;
    inflightSave = null;
    if (!payload) return;
    pendingSave = payload;
    requestSaver(payload.path);
  }

  // The saver window never acknowledged our edit-note (closed or frozen).
  // Fail over, resending the exact edit that timed out.
  function onSaveAckTimeout() {
    saveAckTimer = null;
    failOver(inflightSave);
  }

  // Route one frozen edit payload ({ path, slideIndex, note, etag }) to the
  // pinned saver, or defer it until a saver is (re)pinned.
  function sendEditNote(payload) {
    onSaveStart(payload);

    // No live saver pinned yet (first edit before slides arrived, or the
    // previous saver window went away). Routing an edit-note without a
    // targetWindowId would let EVERY main window save it and collide on the
    // optimistic lock — the exact bug this routing fixes. Instead ask who
    // can serve this deck; the saver-here handler re-pins and resends.
    if (saverWindowId === null) {
      pendingSave = payload;
      requestSaver(payload.path);
      return;
    }

    // Fresh requestId per actual send: a failover resend must NOT reuse the
    // timed-out original's id, or that original's late ack would be mistaken
    // for the resend's ack.
    inflightSave = {
      path: payload.path,
      slideIndex: payload.slideIndex,
      note: payload.note,
      etag: payload.etag,
      requestId: newRequestId()
    };
    if (saveAckTimer !== null) clearTimeout(saveAckTimer);
    saveAckTimer = setTimeout(onSaveAckTimeout, ackTimeoutMs);
    postMessage({
      type: TYPES.EDIT_NOTE,
      path: inflightSave.path,
      etag: inflightSave.etag,
      slideIndex: inflightSave.slideIndex,
      note: inflightSave.note,
      requestId: inflightSave.requestId,
      targetWindowId: saverWindowId
    });
  }

  // A window answered our find-saver query. Pin it and resend the deferred
  // edit — but only if it serves the exact deck that edit targets
  // (find-saver is path-scoped, yet guard defensively). The first answer
  // wins; later answers find pendingSave already null (returns false, a
  // silent no-op, same as the original inline handler).
  function handleSaverHere(msg) {
    if (pendingSave !== null && msg.windowId && msg.path === pendingSave.path) {
      if (findSaverTimer !== null) {
        clearTimeout(findSaverTimer);
        findSaverTimer = null;
      }
      saverWindowId = msg.windowId;
      const queued = pendingSave;
      pendingSave = null;
      sendEditNote(queued);
      return true;
    }
    return false;
  }

  // Classify an incoming `note-saved` broadcast against the routed save (if
  // any) currently in flight. Returns one of:
  //   'drop'     — a foreign/superseded routed save's ack (carries a
  //                requestId that isn't our current inflightSave's) — the
  //                caller must return without touching any display state.
  //   'failover' — our own routed save's ack says the saver no longer holds
  //                the deck (NO_DECK); a failover retry has just been
  //                started, and the caller must return without surfacing an
  //                error (the retry is silent from the user's perspective).
  //   'continue' — either a genuine ack for our own routed save (the ack
  //                timer has just been cleared and inflightSave nulled), or
  //                a requestId-less broadcast (e.g. an inline-panel save)
  //                that was never part of routing to begin with — the
  //                caller should proceed with its normal display/backup
  //                logic exactly as before.
  function handleNoteSaved(msg) {
    const isOwnAck = inflightSave !== null
      && msg.requestId != null
      && msg.requestId === inflightSave.requestId;
    if (!isOwnAck && msg.requestId != null) return 'drop';
    if (isOwnAck) {
      if (msg.code === ERROR_CODES.NO_DECK) {
        failOver(inflightSave);
        return 'failover';
      }
      if (saveAckTimer !== null) {
        clearTimeout(saveAckTimer);
        saveAckTimer = null;
      }
      inflightSave = null;
    }
    return 'continue';
  }

  /** Test/observation helper. */
  function _debugState() {
    return { saverWindowId, inflightSave, pendingSave };
  }

  return {
    pinFromSlides,
    sendEditNote,
    handleSaverHere,
    handleNoteSaved,
    requestSaver,
    failOver,
    _debugState
  };
}

export { createSaveRouter };

if (typeof globalThis !== 'undefined') {
  globalThis.MDVPresenterSaveRouter = { createSaveRouter };
}
