/**
 * MDV - Shared utility functions
 * Pure move from app.js (Stage 3b). No logic changes.
 */
import { FILE_ICONS } from './constants.js';
import { state } from './state.js';

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function getFileIcon(iconName) {
    return FILE_ICONS[iconName] || FILE_ICONS.default;
}

export function saveScrollPosition(element) {
    return element.scrollTop;
}

export function restoreScrollPosition(element, position) {
    requestAnimationFrame(() => {
        element.scrollTop = position;
    });
}

export function normalizeUserPath(path) {
    return path.trim().replace(/^\/+/, '');
}

export function updateTabPaths(oldPath, newPath) {
    let updated = false;
    const newName = newPath.split('/').pop();
    state.tabs.forEach(tab => {
        if (tab.path === oldPath) {
            tab.path = newPath;
            tab.name = newName;
            updated = true;
        } else if (tab.path.startsWith(oldPath + '/')) {
            tab.path = newPath + tab.path.substring(oldPath.length);
            updated = true;
        }
    });
    return updated;
}

// ============================================================
// URL State Management
// ============================================================

export function updateUrlPath(path) {
    if (path) {
        // パスベースURL: /README.md, /04_提案/10億円戦略.md
        const encoded = path.split('/').map(s => encodeURIComponent(s)).join('/');
        history.replaceState(null, '', '/' + encoded);
    } else {
        history.replaceState(null, '', '/');
    }
}
