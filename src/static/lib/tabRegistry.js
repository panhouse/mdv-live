/**
 * Lightweight tab life-cycle hub.
 *
 * Subscribers (e.g. PresenterView) register cleanup callbacks once at init
 * time, and TabManager fires `notifyClosed(path)` when a tab is closed.
 * Solves the memory leak the audit found in `lastSavedEtag` and the save
 * queue when users open and close many decks.
 *
 * Loaded as a native ES module (`<script type="module">`). Exposes named
 * exports for direct `import`, and also still sets `window.MDVTabRegistry`
 * for any not-yet-migrated code that reads the global directly.
 */
const closeListeners = [];
const switchListeners = [];

function onTabClosed(fn) { if (typeof fn === 'function') closeListeners.push(fn); }
function onTabSwitched(fn) { if (typeof fn === 'function') switchListeners.push(fn); }

function notifyClosed(path) {
  for (const fn of closeListeners) {
    try { fn(path); } catch (err) { console.error('tabRegistry close listener error', err); }
  }
}
function notifySwitched(activePath) {
  for (const fn of switchListeners) {
    try { fn(activePath); } catch (err) { console.error('tabRegistry switch listener error', err); }
  }
}

export { onTabClosed, onTabSwitched, notifyClosed, notifySwitched };

if (typeof globalThis !== 'undefined') {
  globalThis.MDVTabRegistry = { onTabClosed, onTabSwitched, notifyClosed, notifySwitched };
}
