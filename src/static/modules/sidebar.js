/**
 * MDV - Sidebar Management + Resize Handler
 * Pure move from app.js (Stage 3b). No logic changes.
 * Grouped together because ResizeHandler only ever calls SidebarManager.
 */
import { STORAGE_KEYS, SIDEBAR_COLLAPSE_THRESHOLD, SIDEBAR_MAX_WIDTH } from './constants.js';
import { state } from './state.js';
import { elements } from './dom.js';

export const SidebarManager = {
    toggle() {
        elements.sidebar.classList.toggle('collapsed');
        if (!elements.sidebar.classList.contains('collapsed')) {
            elements.sidebar.style.width = state.sidebarWidth + 'px';
        }
    },

    setWidth(width, { persist = true } = {}) {
        if (width < SIDEBAR_COLLAPSE_THRESHOLD) {
            elements.sidebar.classList.add('collapsed');
        } else {
            elements.sidebar.classList.remove('collapsed');
            elements.sidebar.style.width = width + 'px';
            state.sidebarWidth = width;
            // During a drag, persisting every mousemove is a synchronous
            // disk-backed write per event — the caller persists once on
            // mouseup instead (owner-reported drag lag, 0.6.11).
            if (persist) localStorage.setItem(STORAGE_KEYS.SIDEBAR_WIDTH, width);
        }
    },

    init() {
        elements.sidebar.style.width = state.sidebarWidth + 'px';
        elements.sidebarToggle.addEventListener('click', () => this.toggle());
    }
};

export const ResizeHandler = {
    _rafId: null,
    _pendingX: null,
    // Tracked SYNCHRONOUSLY on every pointermove (a number assignment is
    // free): a fast drag can coalesce straight past every expanded
    // position before one animation frame fires, and the persistence on
    // pointerup must still know the last expanded width this drag passed
    // through (codex 0.6.11 round-2).
    _lastExpandedX: null,
    // The pointerId this drag captured, so end() can release capture
    // explicitly on every exit path (not just the pointerup/pointercancel
    // paths the browser releases automatically) — e.g. a window `blur`
    // mid-drag leaves the button physically down with capture still held.
    _pointerId: null,

    start() {
        state.isResizing = true;
        elements.resizeHandle.classList.add('active');
        // The sidebar's width transition (0.2s, for the collapse animation)
        // makes every drag update EASE toward the cursor instead of
        // following it — the whole perceived lag (owner report, 0.6.11).
        // Suspend it for the duration of the drag.
        elements.sidebar.classList.add('resizing');
        // Content panes (iframes especially) can eat pointer/selection
        // events mid-drag; gate them off for the duration (0.6.15,
        // styles.css `body.sidebar-dragging .main`).
        document.body.classList.add('sidebar-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    },

    move(clientX) {
        if (!state.isResizing) return;
        // Clamp instead of ignoring out-of-range input (0.6.15) — the old
        // `if (clientX < 0 || clientX > 500) return;` guard made the drag
        // feel "stuck" the moment the cursor crossed either bound, since
        // tracking simply stopped instead of pinning to the bound.
        const clamped = Math.max(0, Math.min(clientX, SIDEBAR_MAX_WIDTH));
        // One width write per FRAME, not per pointermove event (which can
        // fire far more often than the display refreshes).
        this._pendingX = clamped;
        if (clamped >= SIDEBAR_COLLAPSE_THRESHOLD) this._lastExpandedX = clamped;
        if (this._rafId !== null) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            SidebarManager.setWidth(this._pendingX, { persist: false });
        });
    },

    // Idempotent: every exit path (pointerup, pointercancel,
    // lostpointercapture, window blur) calls end() directly, and the
    // `state.isResizing` guard means only the first call of the bunch does
    // anything — later calls (e.g. blur after pointerup already fired) are
    // harmless no-ops.
    end() {
        if (!state.isResizing) return;
        state.isResizing = false;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._pendingX !== null) {
            SidebarManager.setWidth(this._pendingX, { persist: false });
            this._pendingX = null;
        }
        // Persist ONCE per drag, unconditionally. _lastExpandedX (not
        // state.sidebarWidth) is the source of truth for "the last
        // expanded width this drag passed through": rAF coalescing can
        // skip the state update entirely on a fast collapse-release
        // (codex 0.6.11 rounds 1-2).
        if (this._lastExpandedX !== null) {
            state.sidebarWidth = this._lastExpandedX;
            this._lastExpandedX = null;
        }
        localStorage.setItem(STORAGE_KEYS.SIDEBAR_WIDTH, state.sidebarWidth);
        elements.resizeHandle.classList.remove('active');
        elements.sidebar.classList.remove('resizing');
        document.body.classList.remove('sidebar-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (this._pointerId !== null) {
            // No-op if already released (spec-guaranteed) — safe even when
            // pointerup/pointercancel already released capture themselves.
            elements.resizeHandle.releasePointerCapture(this._pointerId);
            this._pointerId = null;
        }
        // Let interested modules (marpZoomGlue.js) know a drag just ended,
        // instead of relying on an implicit re-notification (codex 0.6.15).
        document.dispatchEvent(new CustomEvent('mdv:sidebar-resize-end'));
    },

    init() {
        const handle = elements.resizeHandle;
        // Pointer Events + setPointerCapture replace the old mousedown +
        // document-wide mousemove/mouseup pair (0.6.15). The old pattern
        // routed mousemove/mouseup through whatever element was under the
        // cursor — crossing an iframe (HTML/PDF preview panes) handed
        // those events to the iframe's own document instead, silently
        // killing the drag mid-motion (owner: "途中でとまったりする").
        // Capturing the pointer on the handle keeps every subsequent
        // pointer event routed to `handle` regardless of what's
        // underneath the cursor.
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this._pointerId = e.pointerId;
            handle.setPointerCapture(e.pointerId);
            this.start();
        });
        handle.addEventListener('pointermove', (e) => this.move(e.clientX));
        handle.addEventListener('pointerup', () => this.end());
        handle.addEventListener('pointercancel', () => this.end());
        handle.addEventListener('lostpointercapture', () => this.end());
        // Tab switch / OS-level focus loss during a drag doesn't always
        // deliver pointerup/pointercancel to the page — blur is the
        // catch-all so a drag never gets stuck "active" (codex 0.6.15).
        window.addEventListener('blur', () => this.end());
    }
};
