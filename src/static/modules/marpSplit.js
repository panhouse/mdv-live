/**
 * MDV - Marp Split-Pane Drag Handle (PowerPoint-style)
 * Pure move from app.js (Stage 3d). No logic changes.
 * Self-contained: no cross-references to the other Marp cluster modules.
 */
import {
    STORAGE_KEYS,
    NOTES_ROW_DEFAULT_PX,
    NOTES_ROW_MIN_PX,
    SPLIT_HANDLE_PX,
    SLIDE_ROW_MIN_PX
} from './constants.js';

export const MarpSplitHandle = {
        dragging: false,
        startY: 0,
        startNotesPx: 0,
        splitEl: null,
        handleEl: null,
        // Bound listener references — module-level so we can detach the
        // exact same function instance even if attach() is called twice.
        onMouseMove: null,
        onMouseUp: null,

        // Read the persisted notes row height. Returns NOTES_ROW_DEFAULT_PX
        // only when the value is missing or non-finite. A literal stored
        // `0` (user dragged the pane fully closed) is a valid value and is
        // preserved as 0.
        getSavedNotesPx() {
            const raw = localStorage.getItem(STORAGE_KEYS.NOTES_ROW_PX);
            if (raw === null) return NOTES_ROW_DEFAULT_PX;
            const n = parseFloat(raw);
            if (!Number.isFinite(n) || n < 0) return NOTES_ROW_DEFAULT_PX;
            return n;
        },

        setNotesPx(px) {
            if (!this.splitEl) return;
            this.splitEl.style.setProperty('--marp-notes-row', `${px}px`);
        },

        clampNotesPx(notesPx, totalHeight) {
            const max = Math.max(0, totalHeight - SPLIT_HANDLE_PX - SLIDE_ROW_MIN_PX);
            if (notesPx < NOTES_ROW_MIN_PX) return NOTES_ROW_MIN_PX;
            if (notesPx > max) return max;
            return notesPx;
        },

        // Always clear any body-level drag chrome we may have set so we
        // can't leak a row-resize cursor / userSelect:none into the rest
        // of the app even if the mouseup handler never gets a chance to
        // run (re-render mid-drag, tab switch, etc.).
        clearDragChrome() {
            this.dragging = false;
            if (this.handleEl) this.handleEl.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        },

        attach(splitEl, handleEl) {
            this.detach();
            this.splitEl = splitEl;
            this.handleEl = handleEl;
            // Clamp the restored value against the current split height —
            // a value persisted on a tall window should not collapse the
            // slide pane to nothing when the deck is reopened on a smaller
            // viewport. We can't measure before the element is in the DOM,
            // so do it lazily on the next animation frame.
            const requested = this.getSavedNotesPx();
            requestAnimationFrame(() => {
                if (!this.splitEl) return;
                const totalHeight = this.splitEl.getBoundingClientRect().height;
                const clamped = totalHeight > 0
                    ? this.clampNotesPx(requested, totalHeight)
                    : requested;
                this.setNotesPx(clamped);
            });

            this.onMouseMove = (e) => {
                if (!this.dragging) return;
                const dy = e.clientY - this.startY;
                const totalHeight = this.splitEl.getBoundingClientRect().height;
                const next = this.clampNotesPx(this.startNotesPx - dy, totalHeight);
                this.setNotesPx(next);
            };
            this.onMouseUp = () => {
                if (!this.dragging) return;
                this.clearDragChrome();
                // Persist the resolved px (read from CSS var, not the drag
                // delta) so a clamp at the edge is what we save, not the
                // unbounded value. Use an explicit Number.isFinite check
                // — `||` would coerce a legitimate 0 (pane fully closed)
                // back to the default and stop the user's choice from
                // surviving a reload.
                const computed = getComputedStyle(this.splitEl)
                    .getPropertyValue('--marp-notes-row');
                const parsed = parseFloat(computed);
                const px = Number.isFinite(parsed) && parsed >= 0
                    ? parsed
                    : NOTES_ROW_DEFAULT_PX;
                localStorage.setItem(STORAGE_KEYS.NOTES_ROW_PX, String(px));
            };

            handleEl.addEventListener('mousedown', this.onMouseDown);
            handleEl.addEventListener('dblclick', this.onDoubleClick);
            document.addEventListener('mousemove', this.onMouseMove);
            document.addEventListener('mouseup', this.onMouseUp);
        },

        detach() {
            // If the user is mid-drag when we tear down (re-render mid-
            // gesture, tab switch, etc.), the document mouseup handler
            // we registered would never fire — clean up the body chrome
            // ourselves so the cursor and userSelect don't get stuck.
            if (this.dragging) this.clearDragChrome();
            if (this.handleEl) {
                this.handleEl.removeEventListener('mousedown', this.onMouseDown);
                this.handleEl.removeEventListener('dblclick', this.onDoubleClick);
            }
            if (this.onMouseMove) document.removeEventListener('mousemove', this.onMouseMove);
            if (this.onMouseUp) document.removeEventListener('mouseup', this.onMouseUp);
            this.dragging = false;
            this.splitEl = null;
            this.handleEl = null;
            this.onMouseMove = null;
            this.onMouseUp = null;
        },

        onMouseDown: (e) => {
            const self = MarpSplitHandle;
            if (!self.splitEl || !self.handleEl) return;
            self.dragging = true;
            self.startY = e.clientY;
            // Use an explicit finite-number check so a stored 0 (the user
            // has previously collapsed the pane) isn't coerced to DEFAULT
            // by `||`. Otherwise the next drag jumps from 240px instead
            // of resizing from the collapsed state.
            const computed = getComputedStyle(self.splitEl)
                .getPropertyValue('--marp-notes-row');
            const parsed = parseFloat(computed);
            self.startNotesPx = Number.isFinite(parsed) && parsed >= 0
                ? parsed
                : NOTES_ROW_DEFAULT_PX;
            self.handleEl.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        },

        onDoubleClick: () => {
            const self = MarpSplitHandle;
            // Clamp the default against the current split height so the
            // reset can't violate SLIDE_ROW_MIN_PX in a short viewport.
            // Drag / restore paths already clamp; doubleclick used to
            // skip it and could shrink the slide pane to zero.
            const totalHeight = self.splitEl
                ? self.splitEl.getBoundingClientRect().height
                : 0;
            const target = totalHeight > 0
                ? self.clampNotesPx(NOTES_ROW_DEFAULT_PX, totalHeight)
                : NOTES_ROW_DEFAULT_PX;
            self.setNotesPx(target);
            localStorage.setItem(STORAGE_KEYS.NOTES_ROW_PX, String(target));
        }
};
