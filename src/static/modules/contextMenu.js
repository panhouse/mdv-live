/**
 * MDV - Context Menu Manager
 * Pure move from app.js (Stage 3e). No logic changes.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { TabManager } from './tabs.js';
import { FileOperationsManager } from './fileOperations.js';

export const ContextMenuManager = {
    currentPath: null,
    isDirectory: false,

    show(x, y, path, isDir) {
        this.currentPath = path;
        this.isDirectory = isDir;

        const items = this.getMenuItems(isDir);
        elements.contextMenu.innerHTML = items.map(item => {
            if (item.separator) {
                return '<div class="context-menu-separator"></div>';
            }
            return `<div class="context-menu-item ${item.danger ? 'danger' : ''}" data-action="${item.action}">${item.label}</div>`;
        }).join('');

        const maxX = window.innerWidth - 170;
        const maxY = window.innerHeight - (items.length * 36);
        elements.contextMenu.style.left = Math.min(x, maxX) + 'px';
        elements.contextMenu.style.top = Math.min(y, maxY) + 'px';

        elements.contextMenu.classList.remove('hidden');
    },

    hide() {
        elements.contextMenu.classList.add('hidden');
        this.currentPath = null;
    },

    getMenuItems(isDir) {
        if (isDir) {
            return [
                { label: '新規フォルダ', action: 'newFolder' },
                { label: 'アップロード', action: 'upload' },
                { separator: true },
                { label: '名前を変更', action: 'rename' },
                { label: 'パスをコピー', action: 'copyPath' },
                { separator: true },
                { label: '削除', action: 'delete', danger: true }
            ];
        }
        return [
            { label: '開く', action: 'open' },
            { label: 'ダウンロード', action: 'download' },
            { separator: true },
            { label: '名前を変更', action: 'rename' },
            { label: 'パスをコピー', action: 'copyPath' },
            { separator: true },
            { label: '削除', action: 'delete', danger: true }
        ];
    },

    handleAction(action) {
        const path = this.currentPath;
        const isDir = this.isDirectory;
        this.hide();

        if (action === 'open') {
            TabManager.open(path);
        } else if (action === 'download') {
            FileOperationsManager.download(path);
        } else if (action === 'rename') {
            FileOperationsManager.renameItem(path, isDir);
        } else if (action === 'delete') {
            FileOperationsManager.deleteItem(path, isDir);
        } else if (action === 'newFolder') {
            FileOperationsManager.createDirectory(path);
        } else if (action === 'upload') {
            state.uploadTargetPath = path;
            elements.fileInput.click();
        } else if (action === 'copyPath') {
            const fullPath = state.rootPath ? `${state.rootPath}/${path}` : path;
            navigator.clipboard.writeText(fullPath).catch(err => {
                console.error('コピーに失敗:', err);
                alert('パスのコピーに失敗しました');
            });
        }
    },

    init() {
        elements.contextMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (item) {
                this.handleAction(item.dataset.action);
            }
        });

        document.addEventListener('click', (e) => {
            if (!elements.contextMenu.contains(e.target)) {
                this.hide();
            }
        });

        document.addEventListener('contextmenu', (e) => {
            const treeItem = e.target.closest('.tree-item');
            if (treeItem && elements.fileTree.contains(treeItem)) {
                e.preventDefault();
                const path = treeItem.dataset.path;
                const isDir = !!treeItem.querySelector('.tree-children');
                this.show(e.clientX, e.clientY, path, isDir);
            }
        });

        elements.fileTree.addEventListener('contextmenu', (e) => {
            if (e.target === elements.fileTree) {
                e.preventDefault();
                this.show(e.clientX, e.clientY, '', true);
            }
        });

        elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                FileOperationsManager.upload(state.uploadTargetPath || '', e.target.files);
                e.target.value = '';
            }
        });
    }
};
