/**
 * MDV - Dialog Manager
 * Pure move from app.js (Stage 3b). No logic changes.
 * No forward references: not-yet-extracted managers (FileOperationsManager,
 * EditorManager, etc.) call INTO DialogManager.show(), which is a normal
 * import direction and needs no wiring.
 */
import { elements } from './dom.js';

export const DialogManager = {
    currentCallback: null,
    isConfirmDialog: false,

    show(title, options = {}) {
        elements.dialogTitle.textContent = title;
        const hasInput = options.showInput;
        const hasMessage = options.message;
        elements.dialogInput.style.display = hasInput ? 'block' : 'none';
        elements.dialogMessage.textContent = hasMessage || '';
        elements.dialogMessage.style.display = hasMessage ? 'block' : 'none';

        if (hasInput) {
            elements.dialogInput.value = options.defaultValue || '';
        }

        elements.dialogConfirm.className = options.danger ? 'btn-danger' : 'btn-confirm';
        elements.dialogConfirm.textContent = options.confirmText || 'OK';

        this.isConfirmDialog = options.isConfirm || false;
        this.currentCallback = options.onConfirm;

        elements.dialogOverlay.classList.remove('hidden');

        if (hasInput) {
            setTimeout(() => {
                elements.dialogInput.focus();
                elements.dialogInput.select();
            }, 100);
        }
    },

    hide() {
        elements.dialogOverlay.classList.add('hidden');
        this.currentCallback = null;
    },

    confirm() {
        if (this.currentCallback) {
            const value = this.isConfirmDialog ? true : elements.dialogInput.value;
            this.currentCallback(value);
        }
        this.hide();
    },

    init() {
        elements.dialogCancel.addEventListener('click', () => this.hide());
        elements.dialogConfirm.addEventListener('click', () => this.confirm());
        elements.dialogInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.confirm();
            }
            if (e.key === 'Escape') {
                this.hide();
            }
        });
        elements.dialogOverlay.addEventListener('click', (e) => {
            if (e.target === elements.dialogOverlay) {
                this.hide();
            }
        });
    }
};
