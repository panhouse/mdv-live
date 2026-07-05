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

    setWidth(width) {
        if (width < 50) {
            elements.sidebar.classList.add('collapsed');
        } else {
            elements.sidebar.classList.remove('collapsed');
            elements.sidebar.style.width = width + 'px';
            state.sidebarWidth = width;
            localStorage.setItem(STORAGE_KEYS.SIDEBAR_WIDTH, width);
        }
    },

    init() {
        elements.sidebar.style.width = state.sidebarWidth + 'px';
        elements.sidebarToggle.addEventListener('click', () => this.toggle());
    }
};

export const ResizeHandler = {
    start() {
        state.isResizing = true;
        elements.resizeHandle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    },

    move(clientX) {
        if (!state.isResizing) return;
        if (clientX >= 0 && clientX <= 500) {
            SidebarManager.setWidth(clientX);
        }
    },

    end() {
        if (state.isResizing) {
            state.isResizing = false;
            elements.resizeHandle.classList.remove('active');
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
