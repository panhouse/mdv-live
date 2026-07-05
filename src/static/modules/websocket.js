/**
 * MDV - WebSocket Manager
 * Pure move from app.js (Stage 3c). Logic is unchanged except for the
 * mechanical forward-reference wiring described below.
 *
 * Forward-reference pattern (see modules/theme.js for the original
 * rationale): handleFileUpdate() calls into ContentRenderer,
 * InlineNotesPanel and PresenterView, and connect()'s onopen calls
 * refreshCurrentTab() — all four still live in the app.js monolith
 * (the Marp cluster is Stage 3d; refreshCurrentTab is a bootstrap-level
 * helper). Rather than import app.js (a cycle) or reach for a global,
 * this module exposes setters that app.js calls once at bootstrap,
 * before the socket connects or any file event can arrive.
 * ContentRenderer/InlineNotesPanel/PresenterView are stored by object
 * reference, so later mutations on them (e.g. InlineNotesPanel.editing
 * toggling during a note edit) are visible here without re-wiring.
 * FileTreeManager, unlike those three, is already an extracted module by
 * this stage, so scheduleRefresh() is a direct import — no DI needed.
 *
 * Stage 3f (SSOT polish, behavior-preserving): handleFileUpdate()'s
 * field-by-field tab.{content,raw,isMarp,css,notes,...} reassignment now
 * goes through the shared modules/renderedFile.js applyRenderedFile()
 * helper instead of its own truthy guards — see that module's docstring
 * for the full field/guard table and why folding the `if (tab.isMarp)`
 * block into one call is behavior-preserving.
 *
 * 0.6.4 (diff review): a fourth forward reference, same pattern as the
 * three above — modules/diffReview.js needs to re-run its baseline-diff
 * check whenever a live file_update actually repaints the content pane
 * (so the change-count bar / highlights stay live for the active tab),
 * but it has no reason to depend on WebSocketManager any other way. Rather
 * than import it directly (this module has no other need of it, and
 * diffReview.js has no need of this module either — an import here would
 * exist solely for this one call), app.js wires it via setOnFileRendered()
 * once at bootstrap. Only called on the two branches that actually replace
 * elements.content's markup (renderMarp / render) — NOT on the early
 * returns above them (image reload, no-content, or the "deferred render
 * while mid-edit of inline notes" branch, none of which touch the DOM
 * diffReview.js reads data-source-line out of).
 *
 * 0.6.5 (unread tree badges): a fifth forward reference, same setter
 * pattern — the new `files_changed` message type (docs/ARCHITECTURE.md
 * §2.2) has nothing to do with the active tab/content pane at all, so it
 * is dispatched straight to modules/unreadBadges.js via
 * setUnreadBadgesManager() rather than growing this module's own state.
 * Unlike file_update, files_changed is broadcast to every client
 * regardless of `watch` — no `state.activeTabIndex >= 0` gate on this
 * branch.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { saveScrollPosition, restoreScrollPosition } from './utils.js';
import { FileTreeManager } from './fileTree.js';
import { applyRenderedFile } from './renderedFile.js';

export const WebSocketManager = {
    _contentRenderer: null,
    _inlineNotesPanel: null,
    _presenterView: null,
    _refreshCurrentTab: null,
    _onFileRendered: null,
    _unreadBadgesManager: null,

    // Called once from app.js at bootstrap to wire the forward references
    // into managers/functions that still live in the app.js monolith.
    setContentRenderer(renderer) {
        this._contentRenderer = renderer;
    },

    setInlineNotesPanel(panel) {
        this._inlineNotesPanel = panel;
    },

    setPresenterView(presenterView) {
        this._presenterView = presenterView;
    },

    setRefreshCurrentTab(fn) {
        this._refreshCurrentTab = fn;
    },

    // 0.6.4: post-render seam for modules/diffReview.js — see this
    // module's docstring above.
    setOnFileRendered(fn) {
        this._onFileRendered = fn;
    },

    // 0.6.5: files_changed dispatch seam for modules/unreadBadges.js — see
    // this module's docstring above.
    setUnreadBadgesManager(manager) {
        this._unreadBadgesManager = manager;
    },

    connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        state.ws = new WebSocket(`${protocol}//${location.host}/ws`);

        state.ws.onopen = async () => {
            elements.statusDot.classList.remove('disconnected');
            elements.statusText.textContent = 'Connected';
            if (state.activeTabIndex >= 0) {
                this.watchFile(state.tabs[state.activeTabIndex].path);
                // 再接続時に最新データを取得
                await this._refreshCurrentTab();
            }
        };

        state.ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'file_update' && state.activeTabIndex >= 0) {
                this.handleFileUpdate(data);
            } else if (data.type === 'tree_update') {
                // Coalesce bursts: bulk FS ops (git checkout, npm install)
                // emit hundreds of tree_update frames. Schedule a single
                // refresh instead of refreshing once per frame.
                FileTreeManager.scheduleRefresh();
            } else if (data.type === 'files_changed') {
                // Broadcast to every client (no watch/active-tab gate,
                // unlike file_update above) — see this module's docstring.
                if (this._unreadBadgesManager) {
                    this._unreadBadgesManager.handleFilesChanged(data.items || []);
                }
            }
        };

        state.ws.onclose = () => {
            elements.statusDot.classList.add('disconnected');
            elements.statusText.textContent = 'Disconnected';
            setTimeout(() => this.connect(), 3000);
        };

        state.ws.onerror = () => state.ws.close();
    },

    watchFile(path) {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ type: 'watch', path }));
        }
    },

    handleFileUpdate(data) {
        const tab = state.tabs[state.activeTabIndex];

        if (data.fileType === 'image' && data.reload) {
            this._contentRenderer.renderImage(tab.imageUrl, tab.name);
            return;
        }

        if (!data.content) return;

        // applyRenderedFile() covers content/raw/isMarp here AND the
        // marp-only fields (css/notes/notesMultiplicity/etag/lineEnding/
        // hasBom) applied further below inside `if (tab.isMarp)` — those
        // fields are only ever present in `data` when the file actually is
        // Marp (see renderedFile.js field table), so folding both updates
        // into one call here is behavior-preserving: the per-field guards
        // already no-op exactly where the old `if (tab.isMarp) { ... }`
        // gate did.
        applyRenderedFile(tab, data);

        if (state.isEditMode) {
            if (!state.hasUnsavedChanges && data.raw) {
                const textarea = document.getElementById('editorTextarea');
                if (textarea) {
                    const currentScroll = saveScrollPosition(textarea);
                    textarea.value = data.raw;
                    restoreScrollPosition(textarea, currentScroll);
                }
            }
            return;
        }

        if (tab.isMarp) {
            // css/notes/notesMultiplicity/etag/lineEnding/hasBom were
            // already refreshed by the applyRenderedFile() call above.
            //
            // If the user is mid-edit in the inline notes panel for THIS
            // deck, suppress the re-render so their cursor isn't yanked
            // out of contenteditable mid-keystroke. tab.{notes,etag,…}
            // have already been refreshed above so the next render after
            // blur will show fresh data; the presenter window still gets
            // the broadcast and updates immediately because that path
            // has its own `if (!editing)` guard.
            //
            // We mark a deferred render on the tab so that when the user
            // blurs the editor (handleFocusOut → render hook), the slide
            // SVGs catch up to whatever external edit landed during the
            // edit session. Without this, an external write to the same
            // file leaves the slide pane stale until the next full
            // navigation.
            if (this._inlineNotesPanel.editing
                && this._inlineNotesPanel.editingPath === tab.path) {
                tab.pendingRender = true;
                this._presenterView.broadcastSlides();
                return;
            }

            tab.pendingRender = false;
            this._contentRenderer.renderMarp(data.content, tab.css);
            this._presenterView.broadcastSlides();
        } else {
            const currentScroll = saveScrollPosition(elements.content);
            this._contentRenderer.render(data.content, data.fileType || tab.fileType);
            restoreScrollPosition(elements.content, currentScroll);
        }

        if (this._onFileRendered) this._onFileRendered(tab);
    }
};
