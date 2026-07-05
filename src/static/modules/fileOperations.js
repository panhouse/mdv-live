/**
 * MDV - File Operations Manager
 * Pure move from app.js (Stage 3e). No logic changes. MDVApi.* calls were
 * already migrated from raw fetch in Stage 3a; this stage only relocates
 * the file.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { updateTabPaths } from './utils.js';
import { DialogManager } from './dialog.js';
import { TabManager } from './tabs.js';
import { MDVApi } from '../lib/apiClient.js';

export const FileOperationsManager = {
    async createDirectory(parentPath) {
        DialogManager.show('新規フォルダ', {
            showInput: true,
            defaultValue: '新しいフォルダ',
            onConfirm: async (name) => {
                if (!name) return;
                const path = parentPath ? `${parentPath}/${name}` : name;
                try {
                    await MDVApi.mkdir(path);
                } catch (e) {
                    alert('Error: ' + e.message);
                }
            }
        });
    },

    async deleteItem(path, isDirectory) {
        const name = path.split('/').pop();
        const typeText = isDirectory ? 'フォルダ' : 'ファイル';
        DialogManager.show(`${typeText}を削除`, {
            message: `"${name}" を削除しますか？この操作は取り消せません。`,
            isConfirm: true,
            danger: true,
            confirmText: '削除',
            onConfirm: async () => {
                try {
                    await MDVApi.deleteFile(path);
                    const tabIndex = state.tabs.findIndex(t => t.path === path || t.path.startsWith(path + '/'));
                    if (tabIndex >= 0) {
                        TabManager.close(tabIndex);
                    }
                } catch (e) {
                    alert('Error: ' + e.message);
                }
            }
        });
    },

    async renameItem(path, _isDirectory) {
        const oldName = path.split('/').pop();
        const parentPath = path.substring(0, path.lastIndexOf('/'));
        DialogManager.show('名前を変更', {
            showInput: true,
            defaultValue: oldName,
            onConfirm: async (newName) => {
                if (!newName || newName === oldName) return;
                const destination = parentPath ? `${parentPath}/${newName}` : newName;
                await this.executeMoveOperation(path, destination);
            }
        });
    },

    async moveItem(source, destinationFolder) {
        const fileName = source.split('/').pop();
        const destination = destinationFolder ? `${destinationFolder}/${fileName}` : fileName;
        await this.executeMoveOperation(source, destination);
    },

    async executeMoveOperation(source, destination) {
        try {
            const result = await MDVApi.moveItem(source, destination);
            if (result.success && updateTabPaths(source, destination)) {
                TabManager.render();
            }
        } catch (e) {
            alert('Error: ' + e.message);
        }
    },

    async upload(targetPath, files) {
        if (!files || files.length === 0) return;

        elements.uploadOverlay.classList.remove('hidden');
        elements.uploadProgressFill.style.width = '0%';
        elements.uploadProgressText.textContent = '0%';

        const formData = new FormData();
        formData.append('path', targetPath || '');
        for (const file of files) {
            formData.append('files', file);
        }

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload');

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    elements.uploadProgressFill.style.width = percent + '%';
                    elements.uploadProgressText.textContent = percent + '%';
                }
            };

            xhr.onload = () => {
                elements.uploadOverlay.classList.add('hidden');
                if (xhr.status !== 200) {
                    try {
                        const result = JSON.parse(xhr.responseText);
                        alert('Error: ' + (result.detail || result.error || 'Upload failed'));
                    } catch {
                        alert('Error: Upload failed');
                    }
                }
            };

            xhr.onerror = () => {
                elements.uploadOverlay.classList.add('hidden');
                alert('Upload failed');
            };

            const fileName = files.length === 1 ? files[0].name : `${files.length}ファイル`;
            elements.uploadFileName.textContent = `${fileName} をアップロード中...`;

            xhr.send(formData);
        } catch (e) {
            elements.uploadOverlay.classList.add('hidden');
            alert('Error: ' + e.message);
        }
    },

    download(path) {
        const a = document.createElement('a');
        a.href = `/api/download?path=${encodeURIComponent(path)}`;
        a.download = path.split('/').pop() || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
};
