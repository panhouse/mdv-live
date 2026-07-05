/**
 * MDV - Drag & Drop Manager
 * Pure move from app.js (Stage 3e). No logic changes.
 */
import { elements } from './dom.js';
import { FileOperationsManager } from './fileOperations.js';

export const DragDropManager = {
    draggedPath: null,

    clearDragOverStyles() {
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        elements.fileTree.classList.remove('drag-over');
    },

    init() {
        elements.fileTree.addEventListener('dragstart', (e) => {
            const treeItem = e.target.closest('.tree-item');
            if (treeItem) {
                this.draggedPath = treeItem.dataset.path;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', this.draggedPath);
                treeItem.style.opacity = '0.5';
            }
        });

        elements.fileTree.addEventListener('dragend', (e) => {
            const treeItem = e.target.closest('.tree-item');
            if (treeItem) {
                treeItem.style.opacity = '';
            }
            this.draggedPath = null;
            this.clearDragOverStyles();
        });

        elements.fileTree.addEventListener('dragover', (e) => {
            e.preventDefault();

            // Root area drop (external files or internal move to root)
            if (e.target === elements.fileTree) {
                if (e.dataTransfer.types.includes('Files') || this.draggedPath) {
                    elements.fileTree.classList.add('drag-over');
                }
                return;
            }

            // Directory drop
            const treeItem = e.target.closest('.tree-item');
            if (treeItem && treeItem.querySelector('.tree-children')) {
                e.dataTransfer.dropEffect = 'move';
                treeItem.querySelector('.tree-item-content').classList.add('drag-over');
            }
        });

        elements.fileTree.addEventListener('dragleave', (e) => {
            if (e.target === elements.fileTree) {
                elements.fileTree.classList.remove('drag-over');
                return;
            }

            const treeItem = e.target.closest('.tree-item');
            if (treeItem) {
                treeItem.querySelector('.tree-item-content')?.classList.remove('drag-over');
            }
        });

        elements.fileTree.addEventListener('drop', (e) => {
            e.preventDefault();
            this.clearDragOverStyles();

            // Root area drop
            if (e.target === elements.fileTree) {
                // Internal file move to root
                if (this.draggedPath) {
                    // Already at root? (no '/' in path means it's at root)
                    if (!this.draggedPath.includes('/')) {
                        return;
                    }
                    FileOperationsManager.moveItem(this.draggedPath, '');
                    return;
                }
                // External file upload to root
                if (e.dataTransfer.files.length > 0) {
                    FileOperationsManager.upload('', e.dataTransfer.files);
                }
                return;
            }

            // Directory drop
            const treeItem = e.target.closest('.tree-item');
            if (!treeItem || !treeItem.querySelector('.tree-children')) return;

            const targetPath = treeItem.dataset.path;

            if (this.draggedPath && this.draggedPath !== targetPath) {
                if (targetPath.startsWith(this.draggedPath + '/')) {
                    alert('フォルダを自身のサブフォルダに移動することはできません');
                    return;
                }
                FileOperationsManager.moveItem(this.draggedPath, targetPath);
            } else if (e.dataTransfer.files.length > 0) {
                FileOperationsManager.upload(targetPath, e.dataTransfer.files);
            }
        });
    }
};
