/**
 * MDV - Diff Review (0.6.4: 差分バー + ハイライト + ジャンプ)
 *
 * Task ② of the 0.6.x review-surface plan
 * (docs/plan-review-surface-0.6.x.md) — see that doc's "② 変更ハイライト"
 * section for the product spec, docs/ARCHITECTURE.md's "§ WS file_update" /
 * "GET /api/diff" notes for the backend contract, and the mock
 * (`mock/mdv-review-surface-mock.html`, scene 1 — ignore its agent-banner
 * and 検収 buttons, out of scope) for the look this replicates with the
 * app's own CSS variables (both themes).
 *
 * ---------------------------------------------------------------------
 * Baseline model (localStorage) — THE SHARED FOUNDATION 0.6.5 builds on
 * ---------------------------------------------------------------------
 * STORAGE_KEYS.LAST_SEEN ('mdv-last-seen') holds a single JSON object:
 *   { [path]: { hash: string|null, ts: number } }
 * `hash` is a content hash in the same `sha256:<hex>` format
 * src/utils/etag.js's makeEtag() produces (GET /api/diff's `currentHash` /
 * a `file_update` message's `etag`). `ts` is `Date.now()` at the moment the
 * client last confirmed having seen that hash (either "first sight" or an
 * explicit 確認済み click — see markSeen()).
 *
 * getLastSeen(path) / markSeen(path, hash) are the ONLY functions that
 * touch this storage key — 0.6.5 (未読●/✓/フォルダバッジ) imports both
 * directly from this module rather than re-deriving the schema.
 *
 * ---------------------------------------------------------------------
 * Why this module does NOT trust `tab.etag` as "always populated"
 * ---------------------------------------------------------------------
 * The task brief for this feature (and the 0.6.3 author's handoff note)
 * describes `tab.etag` as "now truthy for ALL text tabs". That is true of
 * the `file_update` WebSocket broadcast (src/watcher.js stamps `etag` onto
 * every text-renderable file unconditionally) but NOT of `GET /api/file`
 * (src/rendering/index.js renderMarkdownFile() only computes `etag` for
 * Marp decks) — see modules/renderedFile.js's docstring for the exact
 * field table. Concretely: a freshly-opened non-Marp markdown/code/text
 * tab that hasn't yet received a live `file_update` has `tab.etag === null`
 * (renderedFile.js's CREATE-mode fallback).
 *
 * If this module blindly used `tab.etag` as "the current hash" it would
 * (a) silently mark a brand-new tab as "seen" with hash `null` instead of
 * its real content hash, and (b) on every later visit skip the fast-path
 * `tab.etag === lastSeen.hash` check (since `tab.etag` may still be null)
 * and ask the server — which is merely a wasted round trip, not a
 * correctness bug, EXCEPT for step (a): a `null` baseline can never
 * legitimately match a later real hash, so the bar would falsely claim
 * "changed" forever. _resolveCurrentHash() below closes that gap by
 * falling back to `MDVApi.diff(path, '')`'s `currentHash` (every /api/diff
 * response includes it except the one pre-hash "file too large to even
 * read for hashing" bail-out — see src/api/diff.js).
 *
 * ---------------------------------------------------------------------
 * Wiring (no changes to modules/tabs.js — out of this task's file scope)
 * ---------------------------------------------------------------------
 * refresh() is the single entry point that re-checks the ACTIVE tab
 * against its localStorage baseline and updates the bar/highlights. Two
 * call sites, both wired from app.js's init() (see that file):
 *   1. WebSocketManager.setOnFileRendered(() => DiffReviewManager.refresh())
 *      — after a live file_update repaints the content pane (see
 *      websocket.js's docstring for why this exists).
 *   2. A wrap of TabManager.renderActive() (the one method every content
 *      re-render funnels through — tab open/switch/close, theme toggle,
 *      PDF-style-panel apply, and EditorManager.hide() all call it) so
 *      refresh() runs after every one of those, without tabs.js needing to
 *      import or know about this module at all.
 *
 * ---------------------------------------------------------------------
 * Highlighting (markdown, non-Marp, only)
 * ---------------------------------------------------------------------
 * Reuses the data-source-line attribute markdown.js's mdv_source_line core
 * rule bakes onto rendered blocks (see searchPalette.js's docstring for the
 * same building block used for search-jump). A block only carries its OWN
 * start line, not a span, so matching an added/changed [start,end] range
 * against blocks is two-pass:
 *   1. Any block whose OWN line falls inside [start,end] is highlighted
 *      (handles the common case, including a range that spans several
 *      consecutive blocks).
 *   2. If NONE do — e.g. a change to a later line of a multi-line block
 *      past its own tagged first line, a range that's entirely a blank
 *      *separator* line between two blocks (that separator doesn't belong
 *      to either block's visible content, so pass 1 correctly finds
 *      nothing there), or a range inside an untagged tight-list item
 *      (SOURCE_LINE_EXCLUDED_TYPES, see markdown.js) — fall back to the
 *      nearest PRECEDING tagged block, or the first block if the range is
 *      before all of them. Same fallback convention removedAt markers use
 *      below, and the one searchPalette.js's _scrollToSourceLine() uses
 *      for search-jump.
 * (An earlier version of this matched ranges against each block's
 * *coverage* — its own line up to the next block's line minus one — but
 * that misattributed a newly-inserted blank separator line to whichever
 * unchanged block preceded it, e.g. flagging an untouched paragraph as
 * changed just because a new blank line was appended right after it.)
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { STORAGE_KEYS, DIFF_JUMP_FLASH_MS } from './constants.js';
import { MDVApi } from '../lib/apiClient.js';

// Tabs the change-tracking bar applies to at all (matches the plan doc's
// "共通基盤" scope: non-Marp markdown gets full highlighting; Marp/code/
// text get the bar with API-sourced counts only — no per-line mapping).
// Binary/image/pdf/video/audio/office/html tabs never show the bar.
const DIFFABLE_FILE_TYPES = new Set(['markdown', 'code', 'text']);

// ---------------------------------------------------------------------
// localStorage baseline store — getLastSeen()/markSeen() are the public,
// 0.6.5-facing API. Everything else below is diffReview.js-internal UI.
// ---------------------------------------------------------------------

function readStore() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.LAST_SEEN);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Baselines are namespaced by the SERVED ROOT (state.rootPath from
 * /api/info): localhost origins share localStorage, so without this a
 * baseline saved for project A's README.md would be reused for project
 * B's README.md when a different root is served on the same port
 * (codex round-4). Returns null until rootPath is known — callers
 * treat that as "no baseline yet" and never persist under a wrong root.
 * @param {string} path
 * @returns {string|null}
 */
function storeKey(path) {
    if (!state.rootPath) return null;
    return `${state.rootPath}\u0000${path}`;
}

function writeStore(store) {
    try {
        localStorage.setItem(STORAGE_KEYS.LAST_SEEN, JSON.stringify(store));
    } catch {
        // Storage full/unavailable (private-browsing quota, etc.) — the bar
        // just won't persist across reloads in that case; not fatal.
    }
}

/**
 * @param {string} path
 * @returns {{ hash: string|null, ts: number }|null}
 */
export function getLastSeen(path) {
    const key = storeKey(path);
    if (!key) return null;
    const entry = readStore()[key];
    return entry && typeof entry === 'object' ? entry : null;
}

/**
 * Record `path` as confirmed-seen at `hash` (now).
 * @param {string} path
 * @param {string|null|undefined} hash
 */
export function markSeen(path, hash) {
    const key = storeKey(path);
    if (!key) return;
    const store = readStore();
    if (!hash) {
        // A null baseline can never match a later real hash — storing it
        // would flag the file as changed forever (and 確認済み would never
        // stick for files too large to hash). Delete instead (codex).
        delete store[key];
    } else {
        store[key] = { hash, ts: Date.now() };
    }
    writeStore(store);
}

function formatHHMM(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export const DiffReviewManager = {
    _barEl: null,
    _current: null, // see _applyResponse() for shape
    _highlightsOn: true,
    _jumpIndex: -1,
    _reviewSeq: 0,
    _seededPaths: new Set(),
    _lastPath: null,

    init() {
        this._buildDom();
    },

    _buildDom() {
        const bar = document.createElement('div');
        bar.id = 'diffReviewBar';
        bar.className = 'diff-bar hidden';
        // Sibling insertion (below the tab bar, above the content pane —
        // mock scene-1 placement), rather than static markup in
        // index.html: mirrors modules/searchPalette.js's DOM-ownership
        // approach (build once here, own it entirely) instead of adding
        // index.html markup this task doesn't otherwise need to touch.
        elements.content.parentElement.insertBefore(bar, elements.content);
        this._barEl = bar;

        bar.addEventListener('click', (e) => {
            if (e.target.closest('#diffHighlightToggle')) {
                this._toggleHighlights();
            } else if (e.target.closest('#diffConfirmBtn')) {
                this._confirmLatest();
            }
        });

        // ⌥↑↓ jump. keyboard.js's shortcut table only recognizes
        // Cmd/Ctrl+<key> (see its handleModShortcut()) — no Alt support —
        // so this is a scoped listener here instead, matching the task's
        // "if its table supports modifiers, else scoped listener" guidance.
        document.addEventListener('keydown', (e) => this._handleJumpKey(e));
    },

    /**
     * Re-check the ACTIVE tab against its localStorage baseline and
     * update the bar/highlights. Safe to call redundantly (tab reselect,
     * theme toggle re-render, etc.) — idempotent, and guarded against
     * out-of-order async responses via _reviewSeq.
     */
    async refresh() {
        const mySeq = ++this._reviewSeq;
        const tab = state.tabs[state.activeTabIndex];

        if (!tab || state.isEditMode || !DIFFABLE_FILE_TYPES.has(tab.fileType)) {
            // Edit mode: the textarea replaces the rendered blocks, so
            // highlights/jump have no targets and a confirm click could
            // acknowledge a pre-edit hash (codex round-5) — hide until
            // the editor closes (EditorManager.hide() re-renders through
            // renderActive(), which brings the bar back if still relevant).
            this._hide();
            return;
        }

        const lastSeen = getLastSeen(tab.path);

        if (!lastSeen) {
            const currentHash = await this._resolveCurrentHash(tab);
            if (mySeq !== this._reviewSeq) return; // superseded
            if (currentHash) markSeen(tab.path, currentHash);
            this._hide();
            return;
        }

        // The fast path below is only sound while this tab has been the
        // WS-watched active path — an INACTIVE tab's file can change with
        // no event reaching us, leaving tab.etag stale. So the first
        // refresh after switching paths always asks the server
        // (codex round-11); same-path re-renders (theme toggle, PDF style)
        // may use the cached hash.
        const pathChanged = tab.path !== this._lastPath;
        this._lastPath = tab.path;

        // Fast path: no network call needed when we already know the
        // current hash and it matches the baseline. One catch: after a
        // server restart the in-memory journal is empty even though
        // localStorage remembers this hash — seed it (fire-and-forget,
        // once per path per page load) so the NEXT edit produces real
        // counts instead of unknown-baseline (codex round-8).
        if (!pathChanged && tab.etag && tab.etag === lastSeen.hash) {
            if (!this._seededPaths.has(tab.path)) {
                this._seededPaths.add(tab.path);
                MDVApi.diff(tab.path, '').catch(() => {});
            }
            this._hide();
            return;
        }

        let data;
        try {
            const res = await MDVApi.diff(tab.path, lastSeen.hash);
            data = await res.json();
        } catch (e) {
            console.error('diff review: /api/diff request failed:', e);
            // Same supersession rule as the success path: a stale request's
            // failure must not clear the UI a newer refresh() just rendered.
            if (mySeq === this._reviewSeq) this._hide();
            return;
        }
        if (mySeq !== this._reviewSeq) return; // a newer refresh() superseded this one

        // Re-resolve by path (not by object identity) in case the tab
        // list moved on during the await (closed/reopened at a new index).
        const stillActive = state.tabs[state.activeTabIndex];
        if (!stillActive || stillActive.path !== tab.path) return;

        this._applyResponse(stillActive, lastSeen, data);
    },

    /**
     * Resolve the current content hash for `tab`, for the "no lastSeen
     * yet" (first-sight) path. Always asks the server via /api/diff —
     * NOT tab.etag, even when present (Marp): every /api/diff call also
     * seeds the change journal with the current content, and skipping it
     * on Marp first-sight left the stored baseline hash with no backend
     * snapshot, so every later diff came back unknown-baseline (codex).
     */
    async _resolveCurrentHash(tab) {
        try {
            const res = await MDVApi.diff(tab.path, '');
            const data = await res.json();
            return data.currentHash || tab.etag || null;
        } catch (e) {
            console.error('diff review: could not resolve current hash:', e);
            return tab.etag || null;
        }
    },

    _applyResponse(tab, lastSeen, data) {
        if (data.identical) {
            // from === currentHash by definition here — lastSeen.hash is
            // already the current hash, nothing to update.
            this._hide();
            return;
        }

        if (data.available === false) {
            if (!data.currentHash) {
                // File too large to even hash (/api/diff's pre-read bail).
                // It can never become diffable and 確認済み could never
                // stick (no hash to store) — treat like a binary tab: no
                // bar, and drop any stale baseline (codex round-4).
                markSeen(tab.path, null);
                this._hide();
                return;
            }
            this._current = { path: tab.path, kind: 'unavailable', currentHash: data.currentHash };
            this._jumpIndex = -1;
            this._clearHighlightClasses();
            this._renderBar();
            return;
        }

        const added = data.added || [];
        const changed = data.changed || [];
        const removedAt = data.removedAt || [];
        const canHighlight = tab.fileType === 'markdown' && !tab.isMarp;

        const count = added.length + changed.length + removedAt.length;
        if (count === 0) {
            // identical:false but zero hunks: a CRLF/trailing-newline-only
            // change that diffLines() normalizes away. No visible line
            // difference to review — silently adopt the new hash instead
            // of showing a 「0箇所」 bar (codex round-3).
            markSeen(tab.path, data.currentHash);
            this._hide();
            return;
        }
        this._current = {
            path: tab.path,
            kind: canHighlight ? 'full' : 'bar-only',
            currentHash: data.currentHash,
            added,
            changed,
            removedAt,
            count,
            lastSeenTs: lastSeen.ts
        };
        this._highlightsOn = true; // default ON each time a new diff is shown
        this._jumpIndex = -1;
        this._renderBar();
        this._applyHighlightClasses();
    },

    _hide() {
        this._current = null;
        this._jumpIndex = -1;
        if (this._barEl) {
            this._barEl.classList.add('hidden');
            this._barEl.innerHTML = '';
        }
        this._clearHighlightClasses();
    },

    _renderBar() {
        if (!this._barEl || !this._current) return;
        const c = this._current;
        this._barEl.classList.remove('hidden');

        if (c.kind === 'unavailable') {
            this._barEl.innerHTML = `
                <span class="diff-bar-summary">変更あり（差分は取得できませんでした）</span>
                <button type="button" id="diffConfirmBtn" class="btn-confirm diff-bar-confirm">最新を確認済みにする</button>
            `;
            return;
        }

        const timeStr = formatHHMM(c.lastSeenTs);
        const summary = `前回確認 <b>${timeStr}</b> から <span class="diff-bar-count">${c.count}箇所</span>変更されました`;

        if (c.kind === 'full') {
            this._barEl.innerHTML = `
                <span class="diff-bar-summary">${summary}</span>
                <button type="button" id="diffHighlightToggle" class="diff-toggle" aria-pressed="${this._highlightsOn}">
                    <span class="diff-toggle-track"></span>変更をハイライト
                </button>
                <span class="diff-bar-hint">⌥↑↓ で変更箇所へジャンプ</span>
                <button type="button" id="diffConfirmBtn" class="btn-confirm diff-bar-confirm">最新を確認済みにする</button>
            `;
        } else {
            // 'bar-only': Marp/code/text — counts from the API, no inline
            // highlight support (no per-line source mapping in v1).
            this._barEl.innerHTML = `
                <span class="diff-bar-summary">${summary}</span>
                <span class="diff-bar-note">ハイライトは Markdown のみ対応</span>
                <button type="button" id="diffConfirmBtn" class="btn-confirm diff-bar-confirm">最新を確認済みにする</button>
            `;
        }
    },

    _toggleHighlights() {
        if (!this._current || this._current.kind !== 'full') return;
        this._highlightsOn = !this._highlightsOn;
        this._applyHighlightClasses();
        const btn = this._barEl.querySelector('#diffHighlightToggle');
        if (btn) btn.setAttribute('aria-pressed', String(this._highlightsOn));
    },

    async _confirmLatest() {
        if (!this._current) return;
        const path = this._current.path;
        let hash = this._current.currentHash;
        if (!hash) {
            // The one response shape with no currentHash at all: the
            // current file itself exceeds the journal's per-file byte cap
            // before it's even read/hashed (src/api/diff.js's pre-hash
            // "too-large" bail). Best-effort fallback so a shrunk-back-down
            // file doesn't stay stuck; if it's still oversized this comes
            // back null again, which markSeen() stores as-is (see its
            // docstring / getLastSeen()'s shape).
            const tab = state.tabs.find((t) => t.path === path);
            hash = tab ? await this._resolveCurrentHash(tab) : null;
        }
        markSeen(path, hash);
        this._hide();
    },

    _handleJumpKey(e) {
        if (!e.altKey || e.metaKey || e.ctrlKey) return;
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        if (!this._current || this._current.kind !== 'full' || !this._highlightsOn) return;

        const active = document.activeElement;
        const isTextInput = active && (
            active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
        );
        if (isTextInput) return;

        const targets = Array.from(
            elements.content.querySelectorAll('.diff-added, .diff-changed, .diff-removed-after')
        );
        if (!targets.length) return;

        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        this._jumpIndex = (this._jumpIndex + delta + targets.length) % targets.length;
        const el = targets[this._jumpIndex];
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('diff-jump-flash');
        setTimeout(() => el.classList.remove('diff-jump-flash'), DIFF_JUMP_FLASH_MS);
    },

    /**
     * Every rendered block carrying data-source-line, sorted ascending —
     * the shared building block for both range-intersection (added/
     * changed) and nearest-preceding lookup (removedAt).
     * @returns {{ el: Element, line: number }[]}
     */
    _collectBlocks() {
        return Array.from(elements.content.querySelectorAll('[data-source-line]'))
            .map((el) => ({ el, line: parseInt(el.dataset.sourceLine, 10) }))
            .filter((b) => !Number.isNaN(b.line))
            .sort((a, b) => a.line - b.line);
    },

    _clearHighlightClasses() {
        elements.content.querySelectorAll('.diff-added, .diff-changed, .diff-removed-after')
            .forEach((el) => el.classList.remove('diff-added', 'diff-changed', 'diff-removed-after'));
    },

    _applyHighlightClasses() {
        this._clearHighlightClasses();
        if (!this._highlightsOn || !this._current || this._current.kind !== 'full') return;

        const blocks = this._collectBlocks();
        if (!blocks.length) return; // tight-list-only / no-mapping doc — never crash, just skip

        const markRange = ([start, end], cls) => {
            // Pass 1: any block whose own line falls inside the range.
            const exactHits = blocks.filter((b) => b.line >= start && b.line <= end);
            if (exactHits.length) {
                exactHits.forEach((b) => b.el.classList.add(cls));
                return;
            }
            // Pass 2 (fallback): nearest preceding tagged block, or the
            // first block if the range is before all of them — see this
            // module's docstring for why a coverage-span match would
            // misattribute blank separator lines to the wrong block.
            let best = null;
            for (const b of blocks) {
                if (b.line <= start) best = b;
                else break;
            }
            if (!best) best = blocks[0];
            best.el.classList.add(cls);
        };

        this._current.added.forEach((r) => markRange(r, 'diff-added'));
        this._current.changed.forEach((r) => markRange(r, 'diff-changed'));

        this._current.removedAt.forEach((pos) => {
            // Largest data-source-line <= pos, else the first block
            // (covers pos === 0 "deleted before line 1", and any position
            // that falls before every tagged block) — same fallback
            // convention as searchPalette.js's _scrollToSourceLine().
            let best = null;
            for (const b of blocks) {
                if (b.line <= pos) best = b;
                else break;
            }
            if (!best) best = blocks[0];
            best.el.classList.add('diff-removed-after');
        });
    }
};
