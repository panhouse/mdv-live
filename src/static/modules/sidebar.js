/**
 * MDV - Sidebar Management + Resize Handler
 * Pure move from app.js (Stage 3b). No logic changes.
 * Grouped together because ResizeHandler only ever calls SidebarManager.
 */
import { STORAGE_KEYS } from './constants.js';
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
        if (width < 50) {
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
    // Tracked SYNCHRONOUSLY on every mousemove (a number assignment is
    // free): a fast drag can coalesce straight past every expanded
    // position before one animation frame fires, and the persistence on
    // mouseup must still know the last expanded width this drag passed
    // through (codex 0.6.11 round-2).
    _lastExpandedX: null,

    start() {
        state.isResizing = true;
        elements.resizeHandle.classList.add('active');
        // The sidebar's width transition (0.2s, for the collapse animation)
        // makes every drag update EASE toward the cursor instead of
        // following it — the whole perceived lag (owner report, 0.6.11).
        // Suspend it for the duration of the drag.
        elements.sidebar.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    },

    move(clientX) {
        if (!state.isResizing) return;
        if (clientX < 0 || clientX > 500) return;
        // One width write per FRAME, not per mousemove event (which can
        // fire far more often than the display refreshes).
        this._pendingX = clientX;
        if (clientX >= 50) this._lastExpandedX = clientX;
        if (this._rafId !== null) return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            SidebarManager.setWidth(this._pendingX, { persist: false });
        });
    },

    end() {
        if (state.isResizing) {
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
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    },

    init() {
        elements.resizeHandle.addEventListener('mousedown', () => this.start());
        document.addEventListener('mousemove', (e) => this.move(e.clientX));
        document.addEventListener('mouseup', () => this.end());
    }
};
