/**
 * MDV - Mutable application state singleton
 * Pure move from app.js (Stage 3b). No logic changes.
 */
import { STORAGE_KEYS, SIDEBAR_COLLAPSE_THRESHOLD, SIDEBAR_MAX_WIDTH } from './constants.js';

// A stale localStorage value from before the resize-drag clamp fix (or any
// hand-edited value) could sit outside [SIDEBAR_COLLAPSE_THRESHOLD,
// SIDEBAR_MAX_WIDTH] — normalize it on load so the sidebar doesn't render
// pinned past a bound the UI itself can no longer produce. NaN (missing/
// corrupt value) keeps the 280 default rather than being clamped.
function normalizedSidebarWidth() {
    const raw = parseInt(localStorage.getItem(STORAGE_KEYS.SIDEBAR_WIDTH));
    if (Number.isNaN(raw)) return 280;
    return Math.max(SIDEBAR_COLLAPSE_THRESHOLD, Math.min(raw, SIDEBAR_MAX_WIDTH));
}

export const state = {
    theme: localStorage.getItem(STORAGE_KEYS.THEME) || 'light',
    sidebarWidth: normalizedSidebarWidth(),
    tabs: [],
    activeTabIndex: -1,
    ws: null,
    isEditMode: false,
    hasUnsavedChanges: false,
    isResizing: false,
    skipScrollRestore: false,
    uploadTargetPath: '',
    rootPath: '',
    pdfStylePath: localStorage.getItem(STORAGE_KEYS.PDF_STYLE_PATH) || '',
    pdfOptionsPath: localStorage.getItem(STORAGE_KEYS.PDF_OPTIONS_PATH) || ''
};
