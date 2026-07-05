/**
 * MDV - Keyboard Shortcuts
 * Pure move from app.js (Stage 3e). No logic changes.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { SidebarManager } from './sidebar.js';
import { TabManager } from './tabs.js';
import { EditorManager } from './editor.js';
import { PrintManager } from './print.js';
import { FileOperationsManager } from './fileOperations.js';
import { SearchPalette } from './searchPalette.js';

export const KeyboardManager = {
    selectedTreePath: null,

    shortcuts: {
        'b': { handler: () => SidebarManager.toggle() },
        'w': { handler: () => TabManager.close(state.activeTabIndex), requiresTab: true },
        'e': { handler: () => EditorManager.toggle().catch(() => { /* status already shown */ }), requiresTab: true },
        's': { handler: () => EditorManager.save(), requiresEditMode: true },
        'p': { handler: () => PrintManager.print(), requiresTab: true },
        'k': { handler: () => SearchPalette.open() }
    },

    handleModShortcut(key) {
        const shortcut = this.shortcuts[key];
        if (!shortcut) return false;
        if (shortcut.requiresTab && state.activeTabIndex < 0) return false;
        if (shortcut.requiresEditMode && !state.isEditMode) return false;
        shortcut.handler();
        return true;
    },

    handleTreeItemShortcut(key) {
        if (!this.selectedTreePath) return false;

        const isTextInput = document.activeElement.tagName === 'INPUT' ||
                            document.activeElement.tagName === 'TEXTAREA';

        const activeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(this.selectedTreePath)}"]`);
        const isDir = activeItem && !!activeItem.querySelector('.tree-children');

        if ((key === 'Delete' || key === 'Backspace') && !isTextInput) {
            FileOperationsManager.deleteItem(this.selectedTreePath, isDir);
            return true;
        }
        if (key === 'F2') {
            FileOperationsManager.renameItem(this.selectedTreePath, isDir);
            return true;
        }
        return false;
    },

    init() {
        document.addEventListener('keydown', (e) => {
            const isMod = e.metaKey || e.ctrlKey;

            if (isMod && this.handleModShortcut(e.key)) {
                e.preventDefault();
                return;
            }

            if (this.handleTreeItemShortcut(e.key)) {
                e.preventDefault();
            }
        });

        elements.fileTree.addEventListener('click', (e) => {
            const treeItem = e.target.closest('.tree-item');
            if (treeItem) {
                this.selectedTreePath = treeItem.dataset.path;
            }
            // Event delegation for file open (replaces inline onclick)
            const openTarget = e.target.closest('[data-action="open"]');
            if (openTarget) {
                const item = openTarget.closest('.tree-item');
                if (item && item.dataset.path) {
                    TabManager.open(item.dataset.path);
                }
            }
        });
    }
};
