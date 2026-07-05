/**
 * MDV - Tab Manager
 * Pure move from app.js (Stage 3e). No logic changes.
 *
 * Stage 3f (SSOT polish, behavior-preserving): open()'s new-tab object
 * literal used to hand-roll `data.x || default` fallbacks for the
 * Marp-only fields (isMarp/css/notes/notesMultiplicity/etag/lineEnding/
 * hasBom). Those now come from modules/renderedFile.js
 * applyRenderedFile(tab, data, { withDefaults: true }) — same fallback
 * values, same field list, now shared with websocket.js/editor.js's
 * "refresh an existing tab" call sites. See that module's docstring.
 *
 * Mutual dependency with editor.js: TabManager.open/switch/close call
 * EditorManager.flushAutosave/updateButton/cancelPendingAutosave, and
 * EditorManager.hide() calls TabManager.renderActive(). Both modules
 * import each other directly (no forward-reference setter needed) —
 * every cross-reference here happens inside an async method body, never
 * at module-eval time, so native ESM's live-binding resolution of the
 * cycle is safe: by the time any of these methods actually run (first
 * possible trigger is DOMContentLoaded → init(), well after both modules
 * finish evaluating), the imported binding is already initialized. See
 * contentRenderer.js / inlineNotes.js for the same pattern applied to an
 * earlier cycle.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { escapeHtml, updateUrlPath } from './utils.js';
import { DialogManager } from './dialog.js';
import { FileTreeManager } from './fileTree.js';
import { WebSocketManager } from './websocket.js';
import { ContentRenderer } from './contentRenderer.js';
import { PresenterView } from './presenterView.js';
import { EditorManager } from './editor.js';
import { MDVApi } from '../lib/apiClient.js';
import { applyRenderedFile } from './renderedFile.js';

export const TabManager = {
    async open(path) {
        const existingIndex = state.tabs.findIndex(t => t.path === path);
        if (existingIndex >= 0) {
            await this.switch(existingIndex);
            return;
        }

        // The not-yet-open path used to skip the outgoing-tab flush
        // that switch() does. If the user types and then clicks a
        // brand-new file within the 1.5s debounce, the textarea is
        // ripped out before the timer fires and the last edits are
        // lost. Mirror switch()'s outgoing flush + raw capture here,
        // including the abort-on-flush-failure behavior so a failed
        // save doesn't quietly kick the user off the tab they were
        // editing.
        let outgoingTextarea = null;
        if (state.activeTabIndex >= 0
            && state.activeTabIndex < state.tabs.length
            && state.isEditMode) {
            try {
                await EditorManager.flushAutosave();
            } catch (_e) {
                return;
            }
            outgoingTextarea = document.getElementById('editorTextarea');
            if (outgoingTextarea) {
                state.tabs[state.activeTabIndex].raw = outgoingTextarea.value;
                // Lock the editor while the new file loads. Without
                // this, slow file loads let the user type more text
                // that schedules a fresh autosave, then open() tears
                // the textarea out before that timer ever fires and
                // the last keystrokes are lost.
                outgoingTextarea.readOnly = true;
            }
        }

        // Always restore the outgoing textarea's editability if we
        // bail out below. On the success path the textarea will be
        // wiped by render() anyway, so the unlock is harmless then.
        const unlockOnFailure = () => {
            if (outgoingTextarea) outgoingTextarea.readOnly = false;
        };

        let response, data;
        try {
            response = await MDVApi.fetchFile(path);
            data = await response.json();
        } catch (e) {
            unlockOnFailure();
            throw e;
        }

        if (data.error) {
            unlockOnFailure();
            alert('Error: ' + data.error);
            return;
        }

        state.tabs.push(applyRenderedFile({
            path,
            name: data.name,
            imageUrl: data.imageUrl,
            pdfUrl: data.pdfUrl,
            htmlUrl: data.htmlUrl,
            mediaUrl: data.mediaUrl,
            downloadUrl: data.downloadUrl,
            scrollTop: 0
        }, data, { withDefaults: true }));

        if (state.isEditMode) {
            state.isEditMode = false;
            EditorManager.updateButton();
        }

        state.activeTabIndex = state.tabs.length - 1;
        this.render();
        this.renderActive();
        WebSocketManager.watchFile(path);
        FileTreeManager.updateHighlight();
        updateUrlPath(path);
    },

    async switch(index) {
        // Pin the target by PATH (not by index) before any await:
        // the user could close a tab while we're flushing, which
        // would shift the indices and turn `index` into either the
        // wrong tab or an out-of-bounds dereference.
        const targetPath = state.tabs[index] && state.tabs[index].path;
        if (!targetPath) return;

        if (state.activeTabIndex >= 0 && state.activeTabIndex < state.tabs.length) {
            if (state.isEditMode) {
                // Flush a pending autosave for the OUTGOING tab before
                // we render it out. Otherwise the debounce timer
                // captures #editorTextarea at fire time, finds it
                // gone, and the last keystrokes are stuck only in
                // tab.raw without ever reaching disk.
                //
                // If the flush rejects, the user's edits did NOT
                // reach disk; aborting the switch keeps them in
                // edit mode so they can retry instead of losing
                // work behind a tab they walked away from.
                try {
                    await EditorManager.flushAutosave();
                } catch (_e) {
                    return;
                }
                const textarea = document.getElementById('editorTextarea');
                if (textarea) {
                    state.tabs[state.activeTabIndex].raw = textarea.value;
                    const maxScroll = textarea.scrollHeight - textarea.clientHeight;
                    if (maxScroll > 0) {
                        const percentage = textarea.scrollTop / maxScroll;
                        const viewMaxScroll = elements.content.scrollHeight - elements.content.clientHeight;
                        state.tabs[state.activeTabIndex].scrollTop = viewMaxScroll * percentage;
                    }
                }
            } else {
                state.tabs[state.activeTabIndex].scrollTop = elements.content.scrollTop;
            }
        }

        if (state.isEditMode) {
            state.isEditMode = false;
            EditorManager.updateButton();
        }

        // Re-resolve the target by path post-await — its index may
        // have shifted (or it may have been closed entirely) during
        // the flush.
        const newIndex = state.tabs.findIndex((t) => t.path === targetPath);
        if (newIndex < 0) return;
        state.activeTabIndex = newIndex;
        this.render();
        this.renderActive();
        WebSocketManager.watchFile(state.tabs[newIndex].path);
        FileTreeManager.updateHighlight();
        updateUrlPath(state.tabs[newIndex].path);
    },

    close(index) {
        // Warn about unsaved changes
        if (state.isEditMode && state.hasUnsavedChanges && index === state.activeTabIndex) {
            DialogManager.show('未保存の変更', {
                // The autosave runs every 1.5s. If a POST is already
                // in flight when the user discards, the server may
                // have received the request before our AbortController
                // can cancel it — so the discarded text can still
                // land on disk in that small window. Be honest about
                // it rather than promising a guarantee we can't keep.
                message: '変更を保存せずにタブを閉じますか？\n（自動保存処理中の場合、その時点までの内容がファイルに残る可能性があります）',
                isConfirm: true,
                danger: true,
                confirmText: '閉じる',
                onConfirm: () => {
                    state.hasUnsavedChanges = false;
                    state.isEditMode = false;
                    EditorManager.updateButton();
                    // Drop the pending debounce so a queued autosave
                    // can't fire after the tab is gone and persist
                    // text the user explicitly chose to discard.
                    EditorManager.cancelPendingAutosave();
                    TabManager.close(index);
                }
            });
            return;
        }
        // The clean-close path skips the confirm dialog entirely (no
        // unsaved changes thanks to autosave). It still has to exit
        // edit mode if we're closing the ACTIVE tab — otherwise
        // state.isEditMode stays true, the next tab renders in edit
        // mode (HTML files show source instead of preview, the
        // toolbar / shortcuts misbehave), and a fresh edit session
        // is needed to recover.
        if (state.isEditMode && index === state.activeTabIndex) {
            state.isEditMode = false;
            EditorManager.updateButton();
            EditorManager.cancelPendingAutosave();
        }

        const closingPath = state.tabs[index] && state.tabs[index].path;
        state.tabs.splice(index, 1);
        if (closingPath && window.MDVTabRegistry) {
            window.MDVTabRegistry.notifyClosed(closingPath);
        }

        if (state.tabs.length === 0) {
            state.activeTabIndex = -1;
            this.render();
            ContentRenderer.showWelcome();
            FileTreeManager.updateHighlight();
            updateUrlPath(null);
            return;
        }

        if (state.activeTabIndex >= state.tabs.length) {
            state.activeTabIndex = state.tabs.length - 1;
        } else if (index < state.activeTabIndex) {
            state.activeTabIndex--;
        }
        this.render();
        this.renderActive();
        FileTreeManager.updateHighlight();
        updateUrlPath(state.tabs[state.activeTabIndex].path);
    },

    render() {
        elements.tabBar.innerHTML = state.tabs.map((tab, i) => `
            <button class="tab ${i === state.activeTabIndex ? 'active' : ''}" onclick="MDV.switchTab(${i})">
                ${escapeHtml(tab.name)}
                <span class="tab-close" onclick="event.stopPropagation(); MDV.closeTab(${i})">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </span>
            </button>
        `).join('');
        // タブがない時はタブバーを非表示
        elements.tabBar.style.display = state.tabs.length === 0 ? 'none' : 'flex';
    },

    renderActive() {
        if (state.activeTabIndex < 0 || state.activeTabIndex >= state.tabs.length) return;
        const tab = state.tabs[state.activeTabIndex];

        elements.content.style.padding = '';
        this.renderByFileType(tab);

        if (!state.skipScrollRestore) {
            setTimeout(() => { elements.content.scrollTop = tab.scrollTop; }, 0);
        }
    },

    renderByFileType(tab) {
        ContentRenderer.cleanupMarp();

        if (tab.isMarp) {
            ContentRenderer.renderMarp(tab.content, tab.css);
            PresenterView.broadcastSlides();
            return;
        }

        const fileType = tab.fileType;
        const binaryTypes = ['archive', 'office', 'executable', 'binary'];

        if (fileType === 'image') {
            ContentRenderer.renderImage(tab.imageUrl, tab.name);
        } else if (fileType === 'pdf') {
            ContentRenderer.renderPDF(tab.pdfUrl, tab.name);
        } else if (fileType === 'html' && tab.htmlUrl && !state.isEditMode) {
            ContentRenderer.renderHTML(tab.htmlUrl, tab.name);
        } else if (fileType === 'video') {
            ContentRenderer.renderVideo(tab.mediaUrl, tab.name);
        } else if (fileType === 'audio') {
            ContentRenderer.renderAudio(tab.mediaUrl, tab.name);
        } else if (fileType === 'office' && typeof tab.content === 'string') {
            // docx/xlsx/pptx small enough for a server-rendered vibe preview
            // (src/api/file.js) carry `content`; oversized/legacy office
            // files (still fileType 'office') fall through to the plain
            // binary card below exactly as before.
            ContentRenderer.renderOffice(tab.content, tab.name, tab.downloadUrl);
        } else if (binaryTypes.includes(fileType)) {
            ContentRenderer.renderBinary(tab.name, fileType);
        } else {
            ContentRenderer.render(tab.content, fileType);
        }
    }
};
