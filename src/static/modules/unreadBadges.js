/**
 * MDV - Unread/Seen Tree Badges (0.6.5)
 *
 * Task ③ of the 0.6.x review-surface plan
 * (docs/plan-review-surface-0.6.x.md — "③ 確認チェック") — see that doc's
 * "③" section for the product spec and modules/diffReview.js's docstring
 * for the baseline model (`getLastSeen`/`markSeen`, localStorage,
 * namespaced by served root) this module reuses rather than re-derives.
 *
 * ---------------------------------------------------------------------
 * Design: event-driven, never poll-driven
 * ---------------------------------------------------------------------
 * This module never hash-scans the tree. Its only two inputs are:
 *  1. `handleFilesChanged(items)` — fed by websocket.js's dispatch of the
 *     server's `files_changed` broadcast (src/watcher.js; see
 *     docs/ARCHITECTURE.md §2.2). Each item is compared against
 *     diffReview.js's `getLastSeen(path)` baseline to decide unread vs.
 *     already-known-seen — no request is made to learn this.
 *  2. diffReview.js's `onSeen(fn)` subscription — fired every time
 *     `markSeen()` runs anywhere (first-sight on tab open, 確認済み click,
 *     or this module's own `markFolderSeen()`), so opening/confirming a
 *     file flips it to ✓ without this module duplicating that logic.
 *
 * Consequently a path this module has never heard about via one of the
 * two feeds above shows NO badge at all — first load must not "light up"
 * the whole tree (spec requirement). The session-only `_unreadEtag`
 * Map / `_seenKnown` Set below are deliberately not persisted: badge state
 * only reflects what happened while this tab has been open.
 *
 * ---------------------------------------------------------------------
 * Decoration seam (fileTree.js is untouched)
 * ---------------------------------------------------------------------
 * decorate() is a pure "paint from current state" pass over every
 * `[data-path]` row already in the DOM (idempotent — safe to call
 * redundantly, cheap — the tree's own 500/dir cap bounds the query). It
 * does not create/remove tree rows, only adds/updates/removes a small
 * badge child under each row's `.tree-item-content`.
 *
 * fileTree.js has no single post-render callback (load()/update()/
 * expandDirectory()/loadMore() each mutate the DOM independently), and the
 * task brief prefers decorating from outside over adding one — so
 * app.js's init() wraps those four methods the same way it already wraps
 * `TabManager.renderActive`/`ContentRenderer.renderMarp`/etc. for
 * modules/diffReview.js. See app.js for the wrapper list.
 *
 * ---------------------------------------------------------------------
 * Wiring (all at app.js's init(), before FileTreeManager.load()/WS connect)
 * ---------------------------------------------------------------------
 *   1. WebSocketManager.setUnreadBadgesManager(UnreadBadgesManager) — the
 *      `files_changed` dispatch seam (see modules/websocket.js docstring).
 *   2. The FileTreeManager method wraps described above.
 *   3. UnreadBadgesManager.init() — builds the sidebar header chip and
 *      subscribes to diffReview.js's onSeen().
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { TabManager } from './tabs.js';
import { DiffReviewManager, getLastSeen, markSeen, onSeen } from './diffReview.js';

export const UnreadBadgesManager = {
    // path -> etag|null. Presence = unread. `null` etag means "unread but
    // we have no known-good hash for it" (an 'added' item, or a 'too
    // large to hash' baseline) — markFolderSeen() treats that as the
    // documented "can't confirm, just clear" case.
    _unreadEtag: new Map(),
    // Paths POSITIVELY known seen-at-current-content this session (✓).
    // Never inferred — only set from an onSeen() firing or a 'changed'
    // item whose etag already matches the stored baseline.
    _seenKnown: new Set(),
    _chipEl: null,

    init() {
        this._buildHeaderChip();
        onSeen((path, hash) => this._handleSeen(path, hash));
        document.addEventListener('keydown', (e) => this._handleShortcut(e));
    },

    _buildHeaderChip() {
        const header = document.querySelector('.sidebar-header');
        if (!header) return; // defensive — index.html always has one, but never crash boot over a chip
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.id = 'unreadCountChip';
        chip.className = 'unread-chip hidden';
        chip.title = '次の未読へ (Alt+Shift+↓)';
        chip.addEventListener('click', () => this.openNextUnread());
        header.appendChild(chip);
        this._chipEl = chip;
    },

    // ⌥⇧↓ jump to the next unread file. keyboard.js's shortcut table only
    // recognizes Cmd/Ctrl+<key> (see diffReview.js's docstring, which faced
    // the same gap for ⌥↑↓) — scoped listener here, same convention.
    _handleShortcut(e) {
        if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey) return;
        if (e.key !== 'ArrowDown') return;
        const active = document.activeElement;
        const isTextInput = active && (
            active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
        );
        if (isTextInput) return;
        e.preventDefault();
        this.openNextUnread();
    },

    /**
     * Handle a `files_changed` WS broadcast (websocket.js dispatch seam).
     * @param {Array<{path: string, etag?: string, kind: 'changed'|'added'|'removed'}>} items
     */
    handleFilesChanged(items) {
        if (!Array.isArray(items)) return;
        for (const item of items) {
            if (!item || typeof item.path !== 'string') continue;

            if (item.kind === 'removed') {
                // Deleted (or rename-source) file: forget it entirely, or
                // the header chip counts a ghost and 次の未読へ opens a
                // dead path (codex round-1).
                this._unreadEtag.delete(item.path);
                this._seenKnown.delete(item.path);
                continue;
            }

            if (item.kind === 'added' && !item.etag) {
                // Etag-less add (oversized/unreadable at add time): the
                // content CANNOT be compared to any baseline, so a stale ✓
                // must not survive — unconditionally unread (codex
                // round-4). Normal-size adds carry an etag and take the
                // hash-compare branch below instead.
                this._unreadEtag.set(item.path, null);
                this._seenKnown.delete(item.path);
                continue;
            }

            if (item.kind === 'added' || item.kind === 'changed') {
                // 'added' now carries an etag too (codex rounds 2-3): the
                // hash comparison resolves BOTH races — a late add after
                // create+open matches the baseline (stays ✓), a recreated
                // file with different content mismatches (goes unread).
                const lastSeen = getLastSeen(item.path);
                if (!lastSeen || lastSeen.hash !== item.etag) {
                    this._unreadEtag.set(item.path, item.etag || null);
                    this._seenKnown.delete(item.path);
                } else {
                    // The reported hash already matches what this client
                    // last confirmed seeing — positive knowledge of ✓, not
                    // just "no badge".
                    this._unreadEtag.delete(item.path);
                    this._seenKnown.add(item.path);
                }
            }
        }
        this.decorate();
        this._updateHeaderChip();
    },

    // onSeen() fires for every markSeen() call app-wide (first-sight tab
    // open, 確認済み click, or our own markFolderSeen() below).
    _handleSeen(path, hash) {
        if (hash) {
            this._seenKnown.add(path);
            this._unreadEtag.delete(path);
        } else {
            // Baseline was cleared (e.g. file too large to hash) — no
            // positive knowledge either way, so no badge at all.
            this._seenKnown.delete(path);
            this._unreadEtag.delete(path);
        }
        this.decorate();
        this._updateHeaderChip();
    },

    /**
     * Context-menu action on a DIRECTORY row (contextMenu.js):
     * 「フォルダ内を確認済みにする」. Every unread path under `dirPath`
     * whose etag is KNOWN gets markSeen()'d for real (flows through the
     * onSeen seam like any other confirm); an unread path with no known
     * etag (an 'added' item, or a too-large baseline) can't be confirmed
     * against anything, so it's just cleared from the session's unread set
     * — documented limitation (task brief).
     * @param {string} dirPath - '' for the tree root
     */
    markFolderSeen(dirPath) {
        const prefix = dirPath ? dirPath + '/' : '';
        const toClear = Array.from(this._unreadEtag.entries())
            .filter(([p]) => p.startsWith(prefix));
        for (const [p, etag] of toClear) {
            if (etag) {
                markSeen(p, etag); // triggers _handleSeen via onSeen
            } else {
                this._unreadEtag.delete(p);
            }
        }
        this.decorate();
        this._updateHeaderChip();
        // The bulk confirm may include the ACTIVE file — its diff bar must
        // not keep claiming "changed" for a baseline this action just
        // updated (codex round-5).
        DiffReviewManager.refresh();
    },

    /**
     * Cycle to the next unread file, in tree (DOM) order where the row is
     * currently rendered; unread paths whose row isn't in the DOM yet
     * (collapsed/unloaded ancestor) are appended after, in discovery order,
     * so an unread file is never simply unreachable.
     */
    openNextUnread() {
        const list = this._unreadPathsInOrder();
        if (!list.length) return;
        const activeTab = state.activeTabIndex >= 0 ? state.tabs[state.activeTabIndex] : null;
        const idx = activeTab ? list.indexOf(activeTab.path) : -1;
        const next = list[(idx + 1) % list.length];
        TabManager.open(next);
    },

    _unreadPathsInOrder() {
        const treeEl = elements.fileTree;
        const domOrder = [];
        if (treeEl) {
            treeEl.querySelectorAll('.tree-item[data-path]').forEach((el) => {
                if (el.querySelector(':scope > .tree-children')) return; // directories never "open"
                const p = el.dataset.path;
                if (this._unreadEtag.has(p)) domOrder.push(p);
            });
        }
        const inDom = new Set(domOrder);
        const rest = Array.from(this._unreadEtag.keys()).filter((p) => !inDom.has(p));
        return domOrder.concat(rest);
    },

    _updateHeaderChip() {
        if (!this._chipEl) return;
        const count = this._unreadEtag.size;
        this._chipEl.textContent = count > 0 ? String(count) : '';
        this._chipEl.classList.toggle('hidden', count === 0);
    },

    /**
     * Paint every `[data-path]` row currently in the DOM from the current
     * unread/seen state. Idempotent, no full-tree rebuild — only adds/
     * updates/removes one small badge child per row. Safe (and cheap) to
     * call redundantly; see this module's docstring for when app.js calls
     * it.
     */
    decorate() {
        const treeEl = elements.fileTree;
        if (!treeEl) return;
        const unreadPaths = Array.from(this._unreadEtag.keys());

        treeEl.querySelectorAll('.tree-item[data-path]').forEach((el) => {
            const path = el.dataset.path;
            const contentEl = el.querySelector(':scope > .tree-item-content');
            if (!contentEl) return;
            const isDir = !!el.querySelector(':scope > .tree-children');

            if (isDir) {
                const prefix = path ? path + '/' : '';
                const count = unreadPaths.reduce((n, p) => n + (p.startsWith(prefix) ? 1 : 0), 0);
                this._renderCountBadge(contentEl, count);
            } else {
                const status = this._unreadEtag.has(path) ? 'unread'
                    : this._seenKnown.has(path) ? 'seen'
                        : null;
                this._renderStatusBadge(contentEl, status);
            }
        });
    },

    _renderStatusBadge(contentEl, status) {
        let el = contentEl.querySelector(':scope > .tree-badge-status');
        if (!status) {
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = document.createElement('span');
            el.className = 'tree-badge-status';
            contentEl.appendChild(el);
        }
        el.classList.toggle('is-unread', status === 'unread');
        el.classList.toggle('is-seen', status === 'seen');
        el.textContent = status === 'unread' ? '●' : '✓';
        el.setAttribute('aria-label', status === 'unread' ? '未読' : '確認済み');
    },

    _renderCountBadge(contentEl, count) {
        let el = contentEl.querySelector(':scope > .tree-badge-count');
        if (count <= 0) {
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = document.createElement('span');
            el.className = 'tree-badge-count';
            contentEl.appendChild(el);
        }
        el.textContent = String(count);
        el.setAttribute('aria-label', `未読 ${count} 件`);
    }
};
