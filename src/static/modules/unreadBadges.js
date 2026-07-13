/**
 * MDV - Unread Tree Badges (0.6.5; ✓ seen badge REMOVED in 0.6.8; visibility
 * gated by Review mode in 0.6.12)
 *
 * Task ③ of the 0.6.x review-surface plan
 * (docs/plan-review-surface-0.6.x.md — "③ 確認チェック") — see that doc's
 * "③" section for the ORIGINAL (0.6.5) product spec (it also specced a
 * green ✓ "confirmed" badge — dropped below) and modules/diffReview.js's
 * docstring for the baseline model (`getLastSeen`/`markSeen`, localStorage,
 * namespaced by served root) this module reuses rather than re-derives.
 *
 * ---------------------------------------------------------------------
 * 0.6.8: the ✓ badge is gone — owner: 「既読マーク(緑✓)いらない。
 * チェックマーク毎回ついたらうざい」
 * ---------------------------------------------------------------------
 * This module now paints exactly ONE per-file status: the blue ● unread
 * dot. A file that is not unread simply has NO badge — there is no
 * "confirmed" visual state to show. The `_seenKnown` Set that existed
 * ONLY to remember which paths deserved a ✓ is deleted along with every
 * bit of bookkeeping that fed it; `_unreadEtag` (the ● source of truth)
 * and everything downstream of it — folder count badges, the header chip,
 * `⌥⇧↓`/next-unread cycling — are UNCHANGED.
 *
 * ---------------------------------------------------------------------
 * 0.6.12: gated by modules/reviewMode.js's isReviewMode() — owner's Word
 * 校閲/Review tab mental model
 * ---------------------------------------------------------------------
 * Every badge this module paints (the ● dot, folder count badges, the
 * sidebar header chip) is now part of the ONE review surface
 * modules/reviewMode.js's toolbar button gates. `decorate()` and
 * `_updateHeaderChip()` both check `isReviewMode()` FIRST and paint
 * zero/hidden when it's OFF — but `_unreadEtag` (the map both read from)
 * keeps getting updated by `handleFilesChanged()`/`_handleSeen()`
 * regardless, so flipping Review back ON immediately shows the accurate
 * current unread state with no re-scan. `init()` also subscribes to
 * `onReviewModeChange()` to repaint on every toggle. The ⌥⇧↓ shortcut
 * (`_handleShortcut()`) additionally no-ops outright while OFF — nothing
 * is visible for it to cycle to. See modules/reviewMode.js's docstring's
 * "Visibility gate, not a tracking gate" section for the shared rationale
 * with modules/diffReview.js.
 *
 * ---------------------------------------------------------------------
 * Design: event-driven, never poll-driven
 * ---------------------------------------------------------------------
 * This module never hash-scans the tree. Its only two inputs are:
 *  1. `handleFilesChanged(items)` — fed by websocket.js's dispatch of the
 *     server's `files_changed` broadcast (src/watcher.js; see
 *     docs/ARCHITECTURE.md §2.2). Each item is compared against
 *     diffReview.js's `getLastSeen(path)` baseline to decide unread vs.
 *     not — no request is made to learn this.
 *  2. diffReview.js's `onSeen(fn)` subscription — fired every time
 *     `markSeen()` runs anywhere (first-sight on tab open, 確認 click, or
 *     this module's own `markFolderSeen()`), so opening/confirming a file
 *     clears its ● without this module duplicating that logic.
 *
 * Consequently a path this module has never heard about via one of the
 * two feeds above shows NO badge at all — first load must not "light up"
 * the whole tree (spec requirement). The session-only `_unreadEtag` Map
 * below is deliberately not persisted: badge state only reflects what
 * happened while this tab has been open.
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
 *   3. UnreadBadgesManager.init() — builds the sidebar header chip,
 *      subscribes to diffReview.js's onSeen(), and (0.6.12) subscribes to
 *      reviewMode.js's onReviewModeChange() to repaint on toggle.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { TabManager } from './tabs.js';
import { DiffReviewManager, getLastSeen, markSeen, onSeen } from './diffReview.js';
import { isReviewMode, onReviewModeChange } from './reviewMode.js';

export const UnreadBadgesManager = {
    // path -> etag|null. Presence = unread (the ONLY per-file status this
    // module paints — see this module's docstring's "0.6.8" section).
    // `null` etag means "unread but we have no known-good hash for it" (an
    // 'added' item, or a 'too large to hash' baseline) — markFolderSeen()
    // treats that as the documented "can't confirm, just clear" case.
    _unreadEtag: new Map(),
    _chipEl: null,

    init() {
        this._buildHeaderChip();
        onSeen((path) => this._handleSeen(path));
        document.addEventListener('keydown', (e) => this._handleShortcut(e));
        // 0.6.12 (modules/reviewMode.js): repaint from the already-current
        // `_unreadEtag` map whenever Review mode flips — no re-scan
        // needed, tracking never stopped while it was OFF (see
        // reviewMode.js's docstring's "Visibility gate, not a tracking
        // gate" section).
        onReviewModeChange(() => {
            this.decorate();
            this._updateHeaderChip();
        });
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
        // 0.6.12: inert while Review mode is OFF — the chip/badges this
        // cycles between aren't even shown (see modules/reviewMode.js's
        // docstring).
        if (!isReviewMode()) return;
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
                continue;
            }

            if (item.kind === 'added' && !item.etag) {
                // Etag-less add (oversized/unreadable at add time): the
                // content CANNOT be compared to any baseline —
                // unconditionally unread (codex round-4). Normal-size adds
                // carry an etag and take the hash-compare branch instead.
                this._unreadEtag.set(item.path, null);
                continue;
            }

            if (item.kind === 'added' || item.kind === 'changed') {
                // 'added' now carries an etag too (codex rounds 2-3): the
                // hash comparison resolves BOTH races — a late add after
                // create+open matches the baseline (stays read), a
                // recreated file with different content mismatches (goes
                // unread).
                const lastSeen = getLastSeen(item.path);
                if (!lastSeen || lastSeen.hash !== item.etag) {
                    this._unreadEtag.set(item.path, item.etag || null);
                } else {
                    // The reported hash already matches what this client
                    // last confirmed seeing — not unread.
                    this._unreadEtag.delete(item.path);
                }
            }
        }
        this.decorate();
        this._updateHeaderChip();
    },

    // onSeen() fires for every markSeen() call app-wide (first-sight tab
    // open, 確認 click, or our own markFolderSeen() below) — regardless of
    // hash, the path is no longer unread (0.6.8: there is no ✓ to set).
    _handleSeen(path) {
        this._unreadEtag.delete(path);
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
     *
     * `{ pin: false }` on every one of these markSeen() calls (codex
     * 4th-round P2-a, 2026-07-14): without it, a folder with N unread files
     * fired N `GET /api/diff` requests from ONE click — each a real file
     * read + hash (and possibly a Myers diff) on the server — turning a bulk
     * confirm into a self-inflicted request flood. Pinning exists to survive
     * autosave churn on a file that is ACTIVELY being edited (see
     * diffReview.js's docstring's "markSeen()'s `{ pin }` opt-out" section);
     * a path bulk-confirmed from the tree context menu is by definition not
     * that.
     *
     * The ACTIVE tab's path is the one exception, and it needs `{ pin: true
     * }` explicitly (codex, 2026-07-14 — a later round than P2-a above): the
     * comment this replaced claimed the trailing `DiffReviewManager.
     * refresh()` call below re-pins it "for free" via refresh()'s fast path,
     * but that is only true when the active tab is NOT in edit mode —
     * refresh() early-returns the moment `state.isEditMode` is true (see
     * that method's guard at its very top), before it ever reaches the fast
     * path that calls `_seedBaseline()`. Bulk-confirming a folder while the
     * active file sits open in the editor is an entirely ordinary sequence
     * (open a file, start editing, then clear the rest of the folder from
     * the tree without leaving edit mode first) — under the old code that
     * file's newly-adopted baseline was written to localStorage but never
     * pinned server-side, so once autosave churn pushed it past the version
     * cap the next diff request came back `unknown-baseline`. Pinning it
     * directly here, unconditionally, closes that gap regardless of edit
     * mode.
     * @param {string} dirPath - '' for the tree root
     */
    markFolderSeen(dirPath) {
        const prefix = dirPath ? dirPath + '/' : '';
        const toClear = Array.from(this._unreadEtag.entries())
            .filter(([p]) => p.startsWith(prefix));
        const activeTab = state.activeTabIndex >= 0 ? state.tabs[state.activeTabIndex] : null;
        for (const [p, etag] of toClear) {
            if (etag) {
                // triggers _handleSeen via onSeen. The active tab is pinned
                // even here — see the `{ pin: true }` doc section above —
                // because refresh() below cannot be relied on to do it
                // while the active tab is in edit mode.
                markSeen(p, etag, { pin: activeTab ? p === activeTab.path : false });
            } else {
                this._unreadEtag.delete(p);
            }
        }
        this.decorate();
        this._updateHeaderChip();
        // The bulk confirm may include the ACTIVE file — its toolbar
        // controls must not keep claiming "changed" for a baseline this
        // action just updated (codex round-5).
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

    // 0.6.12: the chip is part of the review surface Review mode gates —
    // forced to 0/hidden while OFF, WITHOUT touching `_unreadEtag` itself
    // (see modules/reviewMode.js's docstring's "Visibility gate, not a
    // tracking gate" section).
    _updateHeaderChip() {
        if (!this._chipEl) return;
        const count = isReviewMode() ? this._unreadEtag.size : 0;
        this._chipEl.textContent = count > 0 ? String(count) : '';
        this._chipEl.classList.toggle('hidden', count === 0);
    },

    /**
     * Paint every `[data-path]` row currently in the DOM from the current
     * unread state (0.6.8: unread ● only, no ✓). Idempotent, no full-tree
     * rebuild — only adds/updates/removes one small badge child per row.
     * Safe (and cheap) to call redundantly; see this module's docstring
     * for when app.js calls it. 0.6.12: paints ZERO badges while Review
     * mode is OFF (`showBadges` below), without discarding `_unreadEtag` —
     * see modules/reviewMode.js's docstring's "Visibility gate, not a
     * tracking gate" section.
     */
    decorate() {
        const treeEl = elements.fileTree;
        if (!treeEl) return;
        const showBadges = isReviewMode();
        const unreadPaths = Array.from(this._unreadEtag.keys());

        treeEl.querySelectorAll('.tree-item[data-path]').forEach((el) => {
            const path = el.dataset.path;
            const contentEl = el.querySelector(':scope > .tree-item-content');
            if (!contentEl) return;
            const isDir = !!el.querySelector(':scope > .tree-children');

            if (isDir) {
                const prefix = path ? path + '/' : '';
                const count = showBadges
                    ? unreadPaths.reduce((n, p) => n + (p.startsWith(prefix) ? 1 : 0), 0)
                    : 0;
                this._renderCountBadge(contentEl, count);
            } else {
                this._renderStatusBadge(contentEl, showBadges && this._unreadEtag.has(path));
            }
        });
    },

    _renderStatusBadge(contentEl, isUnread) {
        let el = contentEl.querySelector(':scope > .tree-badge-status');
        if (!isUnread) {
            // 0.6.8: no ✓ replacement — a read file simply has no badge
            // (owner: 「既読マーク(緑✓)いらない」).
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = document.createElement('span');
            el.className = 'tree-badge-status';
            contentEl.appendChild(el);
        }
        el.classList.add('is-unread');
        el.textContent = '●';
        el.setAttribute('aria-label', '未読');
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
