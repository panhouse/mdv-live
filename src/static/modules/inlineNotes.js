/**
 * MDV - Inline Speaker Notes Panel (under each Marp slide in the main view)
 * Pure move from app.js (Stage 3d). No logic changes except that
 * readEditableText() — previously a module-level function defined just
 * above this object in app.js (and duplicated byte-for-byte in
 * presenter.html) — now lives in lib/notesEditor.js and is imported (P1
 * dedup from the 2026-07 audit).
 *
 * Stage 3f (SSOT polish, behavior-preserving): the hand-rolled
 * saveTimer/scheduleSave/flush debounce was rebuilt on
 * lib/debounce.js's createDebouncedAction(), and the 'COALESCED'/'STALE'
 * string literals now come from lib/errorCodes.js ERROR_CODES.
 *
 * Forward references: sendSave() reads PresenterView.saveQueue and
 * handleFocusOut() calls ContentRenderer.renderMarp() / PresenterView
 * .broadcastSlides(). Both are only touched at runtime (inside async/
 * event-handler bodies), never at module-eval time, so the resulting
 * inlineNotes.js <-> contentRenderer.js import cycle is safe for native
 * ESM (live bindings resolve by the time these callbacks actually fire —
 * see contentRenderer.js for the other side of the cycle).
 */
import { STORAGE_KEYS, NOTES_AUTOSAVE_DEBOUNCE_MS } from './constants.js';
import { state } from './state.js';
import { elements } from './dom.js';
import { readEditableText } from '../lib/notesEditor.js';
import { ERROR_CODES } from '../lib/errorCodes.js';
import { createDebouncedAction } from '../lib/debounce.js';
import { PresenterView } from './presenterView.js';
import { ContentRenderer } from './contentRenderer.js';

// The debounced action's `fn` runs InlineNotesPanel.sendSave() — declared
// as a closure (not a direct method reference) so it always dispatches
// through the live `InlineNotesPanel` binding, same as every other
// forward-reference in this codebase. sendSave() reads all the state it
// needs (editingSlideIndex/editingPath/editingEtag) off InlineNotesPanel
// itself, so the debounced action needs no arguments.
const saveDebounce = createDebouncedAction({
    fn: () => InlineNotesPanel.sendSave(),
    delayMs: NOTES_AUTOSAVE_DEBOUNCE_MS
});

export const InlineNotesPanel = {
        attached: false,
        editing: false,
        editingSlideIndex: -1,
        editingPath: '',
        editingEtag: null,
        // Auto-clear save status text after a delay (one timer per slide).
        statusClearTimers: new Map(),

        // Build a panel for one slide. Caller appends it to the notes area.
        // The editor's text is set via textContent (NOT innerHTML) so a note
        // containing HTML-like characters can never inject markup. Status
        // (保存中… / 保存済み / 失敗) floats in the panel's top-right via CSS
        // — no header chrome eats vertical space.
        buildPanel(slideIndex, noteText, multiplicity, hasEtag) {
            const canEdit = hasEtag && multiplicity <= 1;
            const panel = document.createElement('aside');
            panel.className = 'speaker-notes-panel';
            panel.dataset.slideIndex = String(slideIndex);
            panel.innerHTML = `
                <span class="speaker-notes-status" data-role="status" aria-live="polite"></span>
                <div class="speaker-notes-banner" data-role="banner" hidden></div>
                <div class="speaker-notes-editor"
                     data-role="editor"
                     data-placeholder="（ノートなし）"
                     spellcheck="false"
                     role="textbox"
                     aria-label="Speaker notes for slide ${slideIndex + 1}"></div>
            `;
            const editor = panel.querySelector('[data-role="editor"]');
            editor.textContent = noteText || '';
            editor.contentEditable = canEdit ? 'true' : 'false';

            if (!canEdit) {
                const banner = panel.querySelector('[data-role="banner"]');
                let msg = '';
                if (!hasEtag) {
                    msg = 'このファイルは現在解析できないため自動保存は無効です。';
                } else if (multiplicity > 1) {
                    msg = 'このスライドは複数のコメントを含むため自動保存を無効化しています（markdown editor で直接編集してください）。';
                }
                banner.textContent = msg;
                banner.hidden = false;
            }
            return panel;
        },

        // Attach event delegation to the content area. Idempotent: calling
        // attach() twice is a no-op until detach() runs.
        attach() {
            if (this.attached) return;
            elements.content.addEventListener('focusin', this.handleFocusIn);
            elements.content.addEventListener('focusout', this.handleFocusOut);
            elements.content.addEventListener('input', this.handleInput);
            elements.content.addEventListener('keydown', this.handleKeydown);
            this.attached = true;
        },

        detach() {
            // Always run flush even if attached=false: a previous detach call
            // already removed the listeners but the editor could still be in
            // the DOM with a pending debounced save (race during fast tab
            // switching).
            this.flush();
            if (!this.attached) return;
            elements.content.removeEventListener('focusin', this.handleFocusIn);
            elements.content.removeEventListener('focusout', this.handleFocusOut);
            elements.content.removeEventListener('input', this.handleInput);
            elements.content.removeEventListener('keydown', this.handleKeydown);
            this.attached = false;
            this.statusClearTimers.forEach((t) => clearTimeout(t));
            this.statusClearTimers.clear();
            this.editing = false;
            this.editingSlideIndex = -1;
            this.editingPath = '';
            this.editingEtag = null;
        },

        flush() {
            saveDebounce.flush();
        },

        scheduleSave(editor) {
            this.setStatus(editor, '編集中…', '');
            saveDebounce.schedule();
        },

        async sendSave() {
            const idx = this.editingSlideIndex;
            const path = this.editingPath;
            const etag = this.editingEtag;
            if (idx < 0 || !path || !etag) return;
            const editor = this.findEditor(idx);
            if (!editor) return;
            const value = readEditableText(editor);
            this.setStatus(editor, '保存中…', '');

            // Use the same saveQueue as the presenter window so concurrent
            // edits to the same deck are serialized. The Promise resolves
            // with the saveFn result (saveNote returns {ok, etag, reason}).
            const saveQueue = PresenterView.saveQueue;
            if (!saveQueue) {
                this.setStatus(editor, '保存失敗: queue 未初期化', 'err');
                return;
            }
            // Tag the request as 'inline' so the Presenter window's
            // note-saved handler ignores it (otherwise an inline save
            // would overwrite the Presenter's pinned editingEtag and
            // skip the STALE conflict its next autosave should hit).
            const result = await saveQueue.enqueue(path, idx, value, etag, 'inline');

            // The user may have switched tabs while the save was in flight.
            // Only touch DOM/UI for the deck we actually saved against —
            // findEditor() runs against elements.content which always shows
            // the active tab, so we must verify the active tab still matches
            // `path` before treating the editor as ours. Otherwise a status
            // string for deck A would land on deck B's panel and a STALE
            // backup could be filled with text from the wrong deck.
            const activeTab = state.tabs[state.activeTabIndex];
            const activeTabMatches = !!(activeTab && activeTab.path === path);
            const liveEditor = activeTabMatches ? this.findEditor(idx) : null;
            if (!result || result.reason === ERROR_CODES.COALESCED) {
                // A newer enqueue superseded us. The newer one will update
                // status when it resolves; don't overwrite "保存中…" here.
                return;
            }
            if (result.ok) {
                if (this.editing
                    && this.editingPath === path
                    && this.editingSlideIndex === idx
                    && result.etag) {
                    this.editingEtag = result.etag;
                }
                if (liveEditor) {
                    // Only show "保存済み" when the live editor still
                    // matches what we just saved AND no newer autosave is
                    // pending. Otherwise the user has already typed more
                    // and the success message would be a lie about which
                    // text is actually durable; leave the status as-is so
                    // the upcoming save's "編集中…/保存中…/保存済み" can
                    // describe the truth.
                    const liveText = readEditableText(liveEditor);
                    if (liveText === value && !this.saveTimer) {
                        this.setStatus(liveEditor, '保存済み', 'ok', 1800);
                    }
                }
            } else {
                const isStale = result.code === ERROR_CODES.STALE
                    || (typeof result.reason === 'string' && result.reason.indexOf(ERROR_CODES.STALE) === 0);
                if (isStale) {
                    // Back up the in-progress text so the user can recover
                    // after reloading. Mirror presenter.html behavior. Use
                    // the captured `value` (text we tried to save) — never
                    // read from the live DOM here, because by the time we
                    // resolve the user may have switched tabs and the
                    // editor in the DOM belongs to a different deck.
                    try {
                        if (value) {
                            const key = STORAGE_KEYS.NOTES_STALE_BACKUP + ':' + path + '#' + idx;
                            localStorage.setItem(key, value);
                        }
                    } catch (e) { /* ignore */ }
                }
                const reason = result.reason || 'Save failed';
                if (liveEditor) {
                    // STALE messages stay until the next edit; transient
                    // errors auto-clear after 5s.
                    this.setStatus(liveEditor, '保存失敗: ' + reason, 'err', isStale ? 0 : 5000);
                }
            }
        },

        findEditor(slideIndex) {
            return elements.content.querySelector(
                `.speaker-notes-panel[data-slide-index="${slideIndex}"] [data-role="editor"]`
            );
        },

        setStatus(editor, text, kind, autoClearMs) {
            const panel = editor.closest('.speaker-notes-panel');
            if (!panel) return;
            const status = panel.querySelector('[data-role="status"]');
            if (!status) return;
            status.textContent = text || '';
            status.classList.remove('ok', 'err');
            if (kind) status.classList.add(kind);

            const idx = Number(panel.dataset.slideIndex);
            const prev = this.statusClearTimers.get(idx);
            if (prev) clearTimeout(prev);
            this.statusClearTimers.delete(idx);
            if (autoClearMs && autoClearMs > 0) {
                const t = setTimeout(() => {
                    if (status.textContent === text) {
                        status.textContent = '';
                        status.classList.remove('ok', 'err');
                    }
                    this.statusClearTimers.delete(idx);
                }, autoClearMs);
                this.statusClearTimers.set(idx, t);
            }
        },

        // ----- Event handlers (arrow funcs to keep `this` bound) -----------

        handleFocusIn: (event) => {
            const editor = event.target.closest('[data-role="editor"]');
            if (!editor) return;
            const panel = editor.closest('.speaker-notes-panel');
            if (!panel) return;
            if (editor.contentEditable !== 'true') return;
            const tab = state.tabs[state.activeTabIndex];
            if (!tab || !tab.isMarp) return;
            InlineNotesPanel.editing = true;
            InlineNotesPanel.editingSlideIndex = Number(panel.dataset.slideIndex);
            InlineNotesPanel.editingPath = tab.path;
            // Pin the etag at edit start, NOT the live tab.etag — a watcher
            // refresh during the debounce would otherwise smuggle a write
            // past the optimistic lock with the post-refresh etag.
            InlineNotesPanel.editingEtag = tab.etag || null;
        },

        handleFocusOut: (event) => {
            const editor = event.target.closest('[data-role="editor"]');
            if (!editor) return;
            const justEditedPath = InlineNotesPanel.editingPath;
            InlineNotesPanel.editing = false;
            InlineNotesPanel.flush();
            InlineNotesPanel.editingSlideIndex = -1;
            InlineNotesPanel.editingPath = '';
            InlineNotesPanel.editingEtag = null;

            // If a watcher update arrived for this deck while the user was
            // editing, we suppressed the re-render to avoid yanking their
            // cursor. Now that focus is gone, catch the slide pane up.
            // Defer to a microtask so the active blur completes first
            // (re-rendering inside focusout can re-target focus weirdly in
            // some browsers).
            const tab = state.tabs[state.activeTabIndex];
            if (tab && tab.isMarp
                && tab.path === justEditedPath
                && tab.pendingRender) {
                tab.pendingRender = false;
                queueMicrotask(() => {
                    // Re-check before firing: the user could have switched
                    // tabs in the same tick.
                    const t = state.tabs[state.activeTabIndex];
                    if (t && t.path === justEditedPath && t.isMarp) {
                        ContentRenderer.renderMarp(t.content, t.css);
                        PresenterView.broadcastSlides();
                    }
                });
            }
        },

        handleInput: (event) => {
            const editor = event.target.closest('[data-role="editor"]');
            if (!editor) return;
            const panel = editor.closest('.speaker-notes-panel');
            if (!panel) return;
            // Pin at first input as a safety net (focusin should already
            // have set these but defenders add belts to suspenders).
            if (InlineNotesPanel.editingSlideIndex < 0) {
                const tab = state.tabs[state.activeTabIndex];
                if (!tab || !tab.isMarp) return;
                InlineNotesPanel.editing = true;
                InlineNotesPanel.editingSlideIndex = Number(panel.dataset.slideIndex);
                InlineNotesPanel.editingPath = tab.path;
                InlineNotesPanel.editingEtag = tab.etag || null;
            }
            // Mirror local cache so a subsequent slide-switch + re-render
            // doesn't immediately overwrite the just-typed value.
            const tab = state.tabs[state.activeTabIndex];
            if (tab && Array.isArray(tab.notes)) {
                tab.notes[InlineNotesPanel.editingSlideIndex] = readEditableText(editor);
            }
            InlineNotesPanel.scheduleSave(editor);
        },

        handleKeydown: (event) => {
            // Stop Marp's slide-navigation shortcuts (←/→/Space/F/N/P) from
            // firing while the user is typing in the notes editor.
            const editor = event.target.closest('[data-role="editor"]');
            if (!editor) return;
            event.stopPropagation();
        }
};
