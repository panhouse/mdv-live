/**
 * MDV - Editor Manager
 * Pure move from app.js (Stage 3e). No logic changes.
 *
 * Mutual dependency with tabs.js — see modules/tabs.js docstring for the
 * cycle rationale. The only cross-reference here is EditorManager.hide()
 * calling TabManager.renderActive(), inside an async method body (never
 * at module-eval time), so the live-binding cycle is safe.
 *
 * This is the most correctness-dense file in the app (in-flight
 * AbortController, serialized promise tail, lastAutosaveError replay for
 * a debounce-fired save whose caller silently swallowed the rejection) —
 * moved byte-identical, including every comment.
 *
 * Stage 3f (SSOT polish, behavior-preserving): hide()'s post-refetch
 * reassignment and save()'s post-save refresh reassignment both used to
 * hand-roll their own truthy/typeof/Array.isArray guards over
 * content/raw/css/notes/notesMultiplicity/etag/lineEnding/hasBom/isMarp.
 * Both now call modules/renderedFile.js applyRenderedFile(tab, data) —
 * see that module's docstring for the unified per-field guard table and
 * why widening each site to the full field list (e.g. hide() now also
 * updates tab.fileType, save()'s refresh now also updates
 * raw/lineEnding/hasBom) is inert here: fileType is invariant for a given
 * open tab.path, and this specific refetch's raw/lineEnding/hasBom are
 * recomputed from the exact content this same save() call just wrote to
 * disk. lib/debounce.js's createDebouncedAction() was deliberately NOT
 * applied to this file's autosave — see lib/debounce.js's own docstring
 * for why.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { escapeHtml } from './utils.js';
import { WebSocketManager } from './websocket.js';
import { TabManager } from './tabs.js';
import { MDVApi } from '../lib/apiClient.js';
import { applyRenderedFile } from './renderedFile.js';

const EDITOR_AUTOSAVE_DEBOUNCE_MS = 1500;

export const EditorManager = {
    // Debounced-autosave state. saveTimer is the pending input→save
    // schedule; savedStatusTimer auto-clears the "Saved!" toast so the
    // toolbar doesn't pin a stale success message. inFlight serializes
    // overlapping save() calls so a slow earlier POST can't reach the
    // last-write-wins server endpoint after a faster newer POST and
    // overwrite the user's newer text. saveAbortController abort()s
    // every save sharing the chain, so an explicit discard (close-
    // without-saving) can cancel an in-flight POST instead of letting
    // it persist text the user just discarded. lastAutosaveError
    // remembers a failure that was thrown from a debounce-fired save
    // (whose own caller silently caught it because the toolbar
    // status had already been updated) so a later flushAutosave for
    // navigation can refuse to drop the user's buffer.
    saveTimer: null,
    savedStatusTimer: null,
    inFlight: null,
    saveAbortController: null,
    lastAutosaveError: null,

    async toggle() {
        if (state.activeTabIndex < 0) return;
        const tab = state.tabs[state.activeTabIndex];

        if (tab.fileType === 'image') {
            alert('Cannot edit image files');
            return;
        }

        state.isEditMode = !state.isEditMode;
        this.updateButton();
        state.isEditMode ? this.show() : await this.hide();
    },

    scheduleAutosave() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            // Debounce-fired saves swallow rejections — the toolbar
            // status already reflects the error, and there is no
            // caller waiting for the Promise. Without this catch
            // every failed autosave would surface as an
            // "Unhandled Promise rejection" in the console.
            this.save().catch(() => { /* status already shown */ });
        }, EDITOR_AUTOSAVE_DEBOUNCE_MS);
    },

    // Cancel a pending debounce AND any in-flight POST so a discard-
    // on-close is fully honored. The aborted save() resolves silently
    // (its catch maps AbortError → no-op), so the chain unblocks and
    // no toolbar status mutation runs.
    cancelPendingAutosave() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.saveAbortController) {
            this.saveAbortController.abort();
            this.saveAbortController = null;
        }
        // Drop any stored failure too — discard means "I don't care
        // about that buffer anymore." Without this, the next edit
        // session for an unrelated file would inherit the prior
        // failure and flushAutosave would throw on its first
        // navigation, blocking work that has nothing to do with
        // the discarded tab.
        this.lastAutosaveError = null;
    },

    // Flush a pending autosave NOW (instead of waiting for the
    // debounce timer). Used by Cmd+S, hide(), and tab switching so
    // leaving edit mode never silently drops the last unsaved
    // keystrokes — and so a slow in-flight save can't run its
    // post-success "clear dirty / show Saved!" branch after the user
    // has already moved on to a different tab (the global
    // hasUnsavedChanges flag would clobber the new editor's state).
    //
    // The loop keeps draining until both the debounce queue and the
    // in-flight chain are empty: while we await an in-flight POST
    // the textarea is still editable, so a new keystroke can arm a
    // fresh saveTimer. We have to re-check after each await or the
    // tail of typing escapes the flush and the eventual save() call
    // returns no-op because the textarea has been removed by the
    // navigation that triggered us.
    async flushAutosave() {
        // Surface a previously-silenced autosave failure first.
        // If the last debounce-fired save threw and nobody else
        // has seen it (its caller .catch'd silently), we MUST
        // throw before letting navigation continue — otherwise
        // hide() would refetch over the unsaved buffer.
        if (this.lastAutosaveError) {
            throw this.lastAutosaveError;
        }
        let lastError = null;
        while (this.saveTimer || this.inFlight) {
            if (this.saveTimer) {
                clearTimeout(this.saveTimer);
                this.saveTimer = null;
                try {
                    await this.save();
                } catch (e) {
                    // First failure aborts the drain. Re-trying
                    // the same chain would just replay the failure
                    // and risk an infinite loop if the user keeps
                    // typing. The next input will arm a fresh
                    // saveTimer and we can flush again on the next
                    // navigation attempt.
                    lastError = e;
                    break;
                }
            } else {
                try {
                    await this.inFlight;
                } catch (e) {
                    lastError = e;
                    break;
                }
            }
        }
        // Propagate so navigation callers (hide / switch / open) can
        // bail out instead of silently dropping the user's buffer.
        if (lastError) throw lastError;
    },

    updateButton() {
        elements.editToggle.classList.toggle('active', state.isEditMode);
        elements.editLabel.textContent = state.isEditMode ? 'View' : 'Edit';
    },

    show() {
        if (state.activeTabIndex < 0) return;
        const tab = state.tabs[state.activeTabIndex];

        const viewTopLine = this.getViewTopLine();
        const viewMaxScroll = elements.content.scrollHeight - elements.content.clientHeight;
        let scrollPercentage = 0;
        if (viewMaxScroll > 0) {
            scrollPercentage = elements.content.scrollTop / viewMaxScroll;
        }

        elements.content.innerHTML = `
            <div class="editor-container">
                <textarea class="editor-textarea" id="editorTextarea" spellcheck="false">${escapeHtml(tab.raw || '')}</textarea>
            </div>
        `;

        elements.editorStatus.style.display = 'inline';
        elements.editorStatus.textContent = 'Ready';
        elements.editorStatus.className = 'editor-status';

        const textarea = document.getElementById('editorTextarea');
        textarea.addEventListener('input', () => {
            state.hasUnsavedChanges = true;
            elements.editorStatus.textContent = 'Modified';
            elements.editorStatus.className = 'editor-status modified';
            EditorManager.scheduleAutosave();
        });

        setTimeout(() => {
            textarea.focus();
            if (viewTopLine >= 0) {
                const lineHeight = this.getTextareaLineHeight(textarea);
                textarea.scrollTop = viewTopLine * lineHeight;
            } else if (scrollPercentage > 0) {
                const editMaxScroll = textarea.scrollHeight - textarea.clientHeight;
                textarea.scrollTop = editMaxScroll * scrollPercentage;
            }
        }, 0);
    },

    getViewTopLine() {
        const contentRect = elements.content.getBoundingClientRect();
        const topY = contentRect.top + 10;
        const centerX = contentRect.left + contentRect.width / 2;

        let el = document.elementFromPoint(centerX, topY);
        if (!el || !elements.content.contains(el)) {
            return -1;
        }

        while (el && el !== elements.content) {
            const dataLine = el.getAttribute('data-line');
            if (dataLine !== null) {
                return parseInt(dataLine, 10);
            }
            el = el.parentElement;
        }
        return -1;
    },

    getTextareaLineHeight(textarea) {
        const lines = textarea.value.split('\n');
        if (lines.length > 0 && textarea.scrollHeight > 0) {
            return textarea.scrollHeight / lines.length;
        }
        const style = window.getComputedStyle(textarea);
        return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
    },

    async hide() {
        if (state.activeTabIndex < 0) return;
        const tab = state.tabs[state.activeTabIndex];

        // Flush any pending autosave BEFORE we read the textarea +
        // re-fetch the file. Otherwise the post-fetch render would
        // overwrite tab.raw with the on-disk version while the user's
        // last keystrokes (still inside the debounce window) are
        // silently discarded.
        //
        // If the flush throws (a write failed somewhere in the chain),
        // bail out: the on-disk content does NOT match the user's
        // textarea, so swapping back to View mode would refetch the
        // older version and lose the in-progress edits. Stay in edit
        // mode with the existing 'Error: ...' status visible so the
        // user can retry / fix the underlying issue. Re-throw so
        // toggle()'s callers (PrintManager.print and friends) can
        // detect the failure instead of silently exporting from the
        // pre-edit on-disk content.
        try {
            await this.flushAutosave();
        } catch (e) {
            state.isEditMode = true;
            this.updateButton();
            throw e;
        }

        const textarea = document.getElementById('editorTextarea');
        let topLineNumber = -1;
        let scrollPercentage = 0;

        if (textarea) {
            tab.raw = textarea.value;
            topLineNumber = this.getEditTopLineNumber(textarea);
            const maxScroll = textarea.scrollHeight - textarea.clientHeight;
            if (maxScroll > 0) {
                scrollPercentage = textarea.scrollTop / maxScroll;
            }
        }

        elements.editorStatus.style.display = 'none';

        try {
            const response = await MDVApi.fetchFile(tab.path);
            const data = await response.json();
            applyRenderedFile(tab, data);
        } catch (e) {
            console.error('Failed to fetch updated content:', e);
        }

        WebSocketManager.watchFile(tab.path);

        state.skipScrollRestore = true;
        TabManager.renderActive();
        state.skipScrollRestore = false;

        requestAnimationFrame(() => {
            if (topLineNumber >= 0) {
                const targetElement = this.findElementByLine(topLineNumber);
                if (targetElement) {
                    const contentRect = elements.content.getBoundingClientRect();
                    const targetRect = targetElement.getBoundingClientRect();
                    const offsetTop = targetRect.top - contentRect.top + elements.content.scrollTop;
                    elements.content.scrollTop = offsetTop - 10;
                    return;
                }
            }
            if (scrollPercentage > 0) {
                const maxScroll = elements.content.scrollHeight - elements.content.clientHeight;
                elements.content.scrollTop = maxScroll * scrollPercentage;
            }
        });
        state.hasUnsavedChanges = false;
    },

    getEditTopLineNumber(textarea) {
        const lineHeight = this.getTextareaLineHeight(textarea);
        return Math.floor(textarea.scrollTop / lineHeight);
    },

    findElementByLine(lineNumber) {
        const markdownBody = elements.content.querySelector('.markdown-body');
        if (!markdownBody) return null;

        const elementsWithLine = markdownBody.querySelectorAll('[data-line]');
        let bestElement = null;
        let bestLine = -1;

        for (const el of elementsWithLine) {
            const line = parseInt(el.getAttribute('data-line'), 10);
            if (line <= lineNumber && line > bestLine) {
                bestLine = line;
                bestElement = el;
            }
        }

        return bestElement;
    },

    async save() {
        if (state.activeTabIndex < 0) return;

        // Cancel any pending debounce; whether we got here via the
        // timer, Cmd+S, or flushAutosave, this single save covers it.
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        // Pin tab, path, and content NOW. We must not re-read these
        // after the prior save completes, because by then the active
        // tab and textarea may have changed under us — and we still
        // need to persist the snapshot the user actually authored
        // when this save() was invoked.
        const initialTab = state.tabs[state.activeTabIndex];
        const textarea = document.getElementById('editorTextarea');
        if (!initialTab || !textarea) return;
        const path = initialTab.path;
        const content = textarea.value;

        // One AbortController governs the whole chain: cancel-pending
        // calls .abort() once and every queued / in-flight save sees
        // the same signal. We only create a fresh one when the chain
        // is currently empty (or has been previously aborted+cleared).
        if (!this.saveAbortController) {
            this.saveAbortController = new AbortController();
        }
        const signal = this.saveAbortController.signal;

        // Chain after the previous save's Promise so concurrent saves
        // reach the last-write-wins endpoint in invocation order.
        // flushAutosave() awaits this.inFlight to drain the entire
        // chain (not just the head), so any number of queued saves
        // are guaranteed to complete before navigation proceeds.
        const prior = this.inFlight;
        const self = this;
        const mine = (async () => {
            if (prior) {
                try { await prior; } catch (_e) { /* ignore */ }
            }
            // If the chain was aborted while we were waiting in line,
            // skip the POST entirely.
            if (signal.aborted) return;
            try {
                elements.editorStatus.textContent = 'Saving...';
                elements.editorStatus.className = 'editor-status';

                const response = await MDVApi.saveFile(path, content, signal);
                const result = await response.json();

                if (result.error) {
                    // Only paint status onto the toolbar if the user
                    // is still on the deck we tried to save.
                    const active = state.tabs[state.activeTabIndex];
                    if (active && active.path === path) {
                        elements.editorStatus.textContent = 'Error: ' + result.error;
                        elements.editorStatus.className = 'editor-status modified';
                    }
                    // Throw so flushAutosave / hide() can detect that
                    // the write failed and avoid silently overwriting
                    // the user's edits with the on-disk content.
                    throw new Error(result.error);
                }

                // Mirror the saved content into the deck's tab even
                // if the user has navigated away — the on-disk file
                // and tab.raw should agree on what was persisted.
                const target = state.tabs.find((t) => t.path === path);
                if (target) {
                    target.raw = content;
                    // Re-fetch rendered HTML / Marp metadata INLINE,
                    // not fire-and-forget. The save chain is
                    // serialized per-tab; awaiting the refresh here
                    // ensures the older save's refresh can never
                    // arrive after a newer save's refresh and
                    // overwrite the newer rendered state. The
                    // perceived latency cost is the round trip,
                    // which only blocks a *follow-up* autosave (the
                    // user's typing is unblocked the instant we
                    // dispatched POST).
                    try {
                        const refreshRes = await MDVApi.fetchFile(path);
                        const data = await refreshRes.json();
                        const t = state.tabs.find((x) => x.path === path);
                        if (t) applyRenderedFile(t, data);
                    } catch (_e) { /* watcher will catch up */ }
                }

                // Global hasUnsavedChanges and the toolbar are tied
                // to the ACTIVE tab. Don't clear them on behalf of a
                // save whose deck the user has already left, and
                // don't clear them when the user has typed more text
                // since this save was scheduled — the next debounce
                // is already requeued and will settle state itself.
                const active = state.tabs[state.activeTabIndex];
                if (active && active.path === path) {
                    const liveTextarea = document.getElementById('editorTextarea');
                    const stillFresh = liveTextarea && liveTextarea.value === content;
                    if (stillFresh) {
                        state.hasUnsavedChanges = false;
                        elements.editorStatus.textContent = 'Saved!';
                        elements.editorStatus.className = 'editor-status saved';
                        if (self.savedStatusTimer) clearTimeout(self.savedStatusTimer);
                        self.savedStatusTimer = setTimeout(() => {
                            if (elements.editorStatus.textContent === 'Saved!') {
                                elements.editorStatus.textContent = 'Ready';
                                elements.editorStatus.className = 'editor-status';
                            }
                            self.savedStatusTimer = null;
                        }, 2000);
                    }
                }
                // Whatever earlier failure we may have remembered is
                // moot now — the chain went through.
                self.lastAutosaveError = null;
            } catch (e) {
                // Abort is intentional (discard-on-close cancelled
                // us). Don't treat that as a failure.
                if (e.name === 'AbortError') return;
                const active = state.tabs[state.activeTabIndex];
                if (active && active.path === path) {
                    elements.editorStatus.textContent = 'Error: ' + e.message;
                    elements.editorStatus.className = 'editor-status modified';
                }
                // Remember the failure so a later flushAutosave —
                // even one fired AFTER saveTimer/inFlight have both
                // settled — can surface it. Without this a debounced
                // save that fails silently (its caller's `.catch(()
                // => {})`) would leave hasUnsavedChanges=true with
                // no observable error, and hide()'s subsequent flush
                // would return success and refetch the on-disk file
                // over the user's unsaved buffer.
                self.lastAutosaveError = e;
                // Re-throw so a flushAutosave caller (hide / switch /
                // open / Cmd+S) can react and refuse to discard the
                // unsaved buffer.
                throw e;
            }
        })();

        // Make `mine` the new chain tail. flushAutosave awaits whatever
        // is at the tail, so as long as each save replaces the tail
        // with a Promise that internally awaits its predecessor, the
        // caller always waits for the entire pending chain.
        this.inFlight = mine;
        try {
            await mine;
        } finally {
            // Only the tail clears inFlight. If a newer save has
            // chained on after us, leave its Promise in place — and
            // leave the shared AbortController in place too so the
            // newer save can still be cancelled via the same handle.
            if (this.inFlight === mine) {
                this.inFlight = null;
                if (this.saveAbortController
                    && this.saveAbortController.signal === signal) {
                    this.saveAbortController = null;
                }
            }
        }
    },

    init() {
        elements.editToggle.addEventListener('click', () => {
            this.toggle().catch(() => { /* status already shown */ });
        });
    }
};
