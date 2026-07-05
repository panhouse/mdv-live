/**
 * MDV - Mutable application state singleton
 * Pure move from app.js (Stage 3b). No logic changes.
 */
import { STORAGE_KEYS } from './constants.js';

export const state = {
    theme: localStorage.getItem(STORAGE_KEYS.THEME) || 'light',
    sidebarWidth: parseInt(localStorage.getItem(STORAGE_KEYS.SIDEBAR_WIDTH)) || 280,
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
