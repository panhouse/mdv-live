/**
 * MDV - Diff Review (0.6.4: 差分バー + ハイライト + ジャンプ →
 * 0.6.8: 専用バーを廃止し、ツールバーの「変更 N」/「✓ 確認」ボタンに置き換え)
 *
 * Task ② of the 0.6.x review-surface plan
 * (docs/plan-review-surface-0.6.x.md) — see that doc's "② 変更ハイライト"
 * section for the ORIGINAL (0.6.4〜0.6.6) product spec and
 * docs/ARCHITECTURE.md's "§ WS file_update" / "GET /api/diff" notes for the
 * backend contract — both unchanged by 0.6.8, which only touches the
 * frontend surface described below.
 *
 * ---------------------------------------------------------------------
 * 0.6.8: Word's 変更履歴 model — no more 3rd band
 * ---------------------------------------------------------------------
 * Owner feedback verbatim: 「Wordと全く同じ機能にしたほうがみやすい。変更
 * 履歴on/offボタンを一番上におす。3列目でてくるのうざい」「機能が過剰」.
 * The standalone `#diffReviewBar` row that used to sit between the tab bar
 * and the content pane (0.6.4-0.6.7) is DELETED — no replacement band.
 * Instead, two buttons live as ordinary static markup in the TOOLBAR
 * (index.html, right after the Edit button, cached in dom.js's `elements`
 * like every other toolbar button) and are shown/hidden per active-tab
 * state by `_syncToolbar()`:
 *   - `#diffToggleBtn` ("変更 N", N = `_current.count`) — Word's 変更内容
 *     の表示 toggle. `aria-pressed` mirrors `_highlightsOn`; toggling only
 *     adds/removes the SAME .diff-added/.diff-changed marks (plus the
 *     0.6.10 removed-inline blocks below) as before (_applyHighlightClasses())
 *     — the ⌥↑↓ jump (_handleJumpKey()) is untouched and keeps working
 *     whenever those marks are visible. (0.6.8 remembered this choice PER
 *     PATH; 0.6.10 replaced that — see the "0.6.10" section below.)
 *   - `#diffConfirmBtn` ("✓ 確認") — identical action to the old
 *     0.6.4-0.6.7 「最新を確認済みにする」: adopts `currentHash` as the new
 *     baseline via markSeen(), which clears both buttons AND (via the
 *     onSeen seam below) the tree's unread ● in modules/unreadBadges.js.
 * Unknown-baseline/too-large (`kind: 'unavailable'`) shows "変更 ?" (title
 * tooltip 「差分は取得できませんでした」) + the confirm button, with no
 * highlighting — same case the old bar's "unavailable" branch handled.
 * Both buttons carry the `.hidden` class (no diff / non-diffable tab /
 * welcome / edit mode) — the toolbar shows NOTHING extra in the normal
 * case; that subtraction is the entire point of this revision.
 *
 * ---------------------------------------------------------------------
 * 0.6.10: global markup toggle (default OFF), inline deletions, one color
 * ---------------------------------------------------------------------
 * Three owner requests, all verbatim: 「トグルとかで変更履歴がでるかでない
 * かを選べるようにしてほしい」「削除行がwordみたいに横棒線がでるといいよ
 * ね」「デフォルトはオフでok この変更履歴のモードは」「追加も変更も黄色で
 * 良い気がする」.
 *
 * 1. GLOBAL persisted toggle, default OFF. 0.6.8's `_highlightsOnByPath`
 *    (a Map, reset per-path by markSeen()) is GONE. `_highlightsOn` is now
 *    backed by ONE localStorage boolean, STORAGE_KEYS.REVIEW_MARKUP
 *    ('mdv-review-markup', see constants.js) — `readMarkupPref()`/
 *    `writeMarkupPref()` below are the only functions that touch it. It
 *    applies to every file (Word's 変更履歴の表示 on/off is a single
 *    document-wide-feeling setting, not remembered per-document) and
 *    survives reload. Default OFF means a brand-new diff still shows the
 *    「変更 N」 count + 「✓ 確認」 (there IS a change to look at — that's
 *    still worth surfacing) but starts with NO highlights/inline deletions
 *    painted, until the user clicks 「変更 N」 to turn markup on.
 * 2. Deleted lines render inline, Word-style. `.diff-removed-after` (a
 *    small tick on the block after which a deletion happened, with no way
 *    to see what was actually deleted) is GONE — REPLACED by
 *    `.diff-removed-inline`, a presentational `<div aria-hidden="true">`
 *    injected right after the same nearest-block anchor the old tick used,
 *    showing the deleted OLD-text lines themselves (escaped, line-through,
 *    red-tinted) — see `_injectRemovedInline()`. Capped at 8 lines +
 *    「…（あと N 行削除）」. These are throwaway DOM nodes with no
 *    src-of-truth role: `_clearHighlightClasses()` removes every one of
 *    them on every re-paint (toggle OFF, ✓ 確認, tab switch/re-render,
 *    entering edit mode) — never leave a stale one behind. They never
 *    render in edit mode (refresh() hides everything there) or for Marp
 *    (canHighlight — and therefore kind:'full' — is never true for Marp,
 *    so `_injectRemovedInline()` is never called for a Marp tab; see
 *    styles.css's @media print / body.marp-fullscreen rules for the
 *    belt-and-suspenders CSS-level exclusion of the classes themselves).
 * 3. One highlight color. `.diff-added` and `.diff-changed` are still two
 *    separate CSS classes (kept for structure/tests/the ⌥↑↓ jump query)
 *    but styles.css now points both at the same yellow (`--warning`) tint
 *    — the green (`--success`) tint `.diff-added` used is gone. Deletions
 *    stay red-struck (item 2 above) — that is still a meaningfully
 *    different kind of change (nothing to show inline for pure adds).
 *
 * ---------------------------------------------------------------------
 * 0.6.12: the markup toggle is GONE — Review mode subsumes it
 * ---------------------------------------------------------------------
 * Owner's direction (Word's 校閲/Review tab mental model, see
 * modules/reviewMode.js's docstring): ONE permanent toolbar button
 * (`#reviewModeToggle`) now gates the entire review surface, not just
 * highlight visibility. 0.6.10's independent `_highlightsOn` preference
 * (STORAGE_KEYS.REVIEW_MARKUP, `readMarkupPref()`/`writeMarkupPref()`) is
 * DELETED — this module now imports `isReviewMode()` from
 * modules/reviewMode.js and treats it as the sole visibility gate:
 *   - `_syncToolbar()` hides BOTH toolbar buttons whenever Review is OFF,
 *     regardless of `_current` (previously only "no diff" hid them).
 *   - `_applyHighlightClasses()` paints nothing whenever Review is OFF —
 *     Review ON always shows highlights/strikethrough for a `kind:
 *     'full'` diff now (no more separate on/off within that).
 *   - `_handleJumpKey()` (⌥↑↓) is inert while Review is OFF ("shortcuts
 *     inert while OFF" — nothing is visible to jump between).
 * `refresh()`'s underlying diff computation is UNCHANGED by any of this
 * — background tracking (baseline recording, journal seeding, `_current`
 * itself) keeps running while Review is OFF, so flipping Review ON shows
 * the accurate current state immediately with no re-scan. See
 * modules/reviewMode.js's docstring's "Visibility gate, not a tracking
 * gate" section for the full rationale, shared with modules/
 * unreadBadges.js.
 *
 * `#diffToggleBtn` ("変更 N") also changes ROLE: it no longer toggles
 * anything (there is nothing left for it to toggle — Review ON already
 * implies markup shown). Clicking it now JUMPS to the next change, the
 * same action as ⌥↓ (`_jumpChange(1)`, shared by both the click handler
 * and `_handleJumpKey()`). `aria-pressed` is gone from this button
 * accordingly (a jump action isn't a toggle); `#diffConfirmBtn` is
 * unaffected.
 *
 * ---------------------------------------------------------------------
 * 0.6.14: moved next to Review, renamed, and no longer pops in/out
 * ---------------------------------------------------------------------
 * Three owner complaints, all verbatim: 「変更N/✓確認がEditとPDFの間にある
 * のはおかしい。Reviewボタンの右にあるべき」「『変更』というラベルは何が
 * 起きるか分からない」「ボタンが出たり消えたりするたびに後ろのPDF/Style/
 * Review/検索ボックスが横にガタガタ動くのがだるい」.
 *
 * 1. index.html moved both buttons from between Edit/PDF to right after
 *    `#reviewModeToggle` (before the search trigger) — pure markup
 *    reordering, this module doesn't care about DOM position.
 * 2. `#diffToggleBtn`'s label is now "次の変更 N" ("次の変更 ?" when
 *    unavailable) — it jumps to the next change, so the label says so.
 * 3. Layout stability: `_syncToolbar()` used to add/remove `.hidden` on
 *    BOTH buttons every time `_current` changed (pending diff appears/
 *    resolves, tab switch, ...), which visibly shifted every toolbar
 *    control to their right. Now `.hidden` is toggled ONLY by the
 *    Review-mode ON/OFF transition itself (one deliberate user click,
 *    acceptable) — while Review is ON, both buttons stay permanently
 *    MOUNTED and instead flip the `disabled` attribute:
 *      - `_current` is null (no pending diff / non-diffable tab / no tab
 *        at all, e.g. via `_hide()`) → both buttons disabled, label
 *        "次の変更 0" (nothing to jump to, nothing to confirm).
 *      - `_current.kind === 'unavailable'` → jump button disabled (no
 *        jump target — see `_jumpChange()`'s early-return), confirm
 *        button stays ENABLED (`_confirmLatest()` only needs
 *        `_current.path`/`currentHash`, both present here — confirming
 *        an unavailable diff is still meaningful).
 *      - `_current.kind` is `'full'`/`'bar-only'` (real pending diff) →
 *        both enabled.
 *    `disabled` (an HTML attribute, not a CSS class) both grays the
 *    button out (styles.css's `.toolbar-btn:disabled`) and blocks the
 *    click handler from firing — no extra guard needed in
 *    `_jumpChange()`/`_confirmLatest()` beyond what they already check.
 *    Every `_syncToolbar()` call now updates textContent/title/disabled
 *    on EVERY path (previously the hidden branches returned early without
 *    touching them, which was fine when hidden also meant "not visible
 *    to worry about" — now that the buttons can stay mounted, a stale
 *    label would otherwise flash before the next real update).
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
 * touch this storage key — 0.6.5 (未読●フォルダバッジ,
 * modules/unreadBadges.js; its ✓ badge was removed in 0.6.8, see that
 * module's docstring) imports both directly from this module rather than
 * re-deriving the schema. It also needs to know the MOMENT a path becomes
 * seen (first-sight, 確認 click, or 0.6.5's own フォルダ内を確認済みにする,
 * which calls markSeen() per-path) so its unread map can clear that path's
 * ● without polling — onSeen(fn) below is the tiny subscription seam for
 * that, rather than duplicating the "what does seen mean" logic in a
 * second module.
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
 * legitimately match a later real hash, so the toolbar would falsely claim
 * "changed" forever. _resolveCurrentHash() below closes that gap by
 * falling back to `MDVApi.diff(path, '')`'s `currentHash` (every /api/diff
 * response includes it except the one pre-hash "file too large to even
 * read for hashing" bail-out — see src/api/diff.js).
 *
 * ---------------------------------------------------------------------
 * Wiring (no changes to modules/tabs.js — out of this task's file scope)
 * ---------------------------------------------------------------------
 * refresh() is the single entry point that re-checks the ACTIVE tab
 * against its localStorage baseline and updates the toolbar controls/
 * highlights. Two
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
 *      nothing there), or a range inside one of the wrapper tags markdown.js
 *      still leaves untagged on purpose (SOURCE_LINE_EXCLUDED_TYPES — the
 *      `<ul>`/`<ol>`/`<blockquote>`/`<table>` opening tag itself, NOT their
 *      `<li>`/row contents, which have carried their own data-source-line
 *      since 0.6.6) — fall back to the nearest PRECEDING tagged block, or
 *      the first block if the range is before all of them. Same fallback
 *      convention `removed[].afterLine` uses below (0.6.10 — it replaced
 *      removedAt as the anchor for what's now an injected inline block
 *      instead of a bare tick, see this docstring's "0.6.10" section; the
 *      resolved anchor is identical, only what gets attached to it
 *      changed), and the one searchPalette.js's _scrollToSourceLine() uses
 *      for search-jump.
 *      (Before 0.6.6, list items fell into this fallback constantly — a
 *      tight list's own `<li>` had no data-source-line anywhere inside it,
 *      so a changed 議事録 decision bullet always highlighted whatever
 *      heading/paragraph preceded the list instead of the bullet itself.
 *      Tagging `list_item_open` closed that gap; pass 1 now matches
 *      bullets directly, and this fallback is back to covering only
 *      genuine gaps like blank separator lines.)
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
import { escapeHtml } from './utils.js';
import { isReviewMode, onReviewModeChange } from './reviewMode.js';

// Deleted-line inline display (0.6.10, Word-style strikethrough) — cap so a
// huge deleted block doesn't flood the pane; see _injectRemovedInline().
const DIFF_REMOVED_INLINE_MAX_LINES = 8;

// Tabs the change-tracking toolbar controls apply to at all (matches the
// plan doc's "共通基盤" scope: non-Marp markdown gets full highlighting;
// Marp/code/text get the count-only 「次の変更 N」 button — no per-line
// mapping). Binary/image/pdf/video/audio/office/html tabs never show it.
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
        // Storage full/unavailable (private-browsing quota, etc.) — the
        // toolbar controls just won't persist across reloads; not fatal.
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

// 0.6.5 subscription seam (see this module's docstring) — subscribers are
// notified synchronously, in registration order, every time markSeen()
// actually runs (including the delete-baseline branch, with hash `null`).
// A listener throwing must not break markSeen() for the others, or for the
// caller that triggered it.
const seenListeners = [];

/**
 * Register a callback invoked as `fn(path, hash)` every time markSeen()
 * runs — `hash` is `null` when markSeen() cleared the baseline instead of
 * setting one. There is no unsubscribe: every current caller
 * (modules/unreadBadges.js) subscribes once at bootstrap, for the app's
 * lifetime.
 * @param {(path: string, hash: string|null) => void} fn
 */
export function onSeen(fn) {
    seenListeners.push(fn);
}

// 0.6.16 subscription seam for modules/marpDiffIndicator.js — same shape as
// onSeen() above, but fired every time `_current` itself changes (a new
// diff arrives, the active tab/path changes, or the pending diff resolves
// via ✓ 確認), not just on confirm. `current` is the same object
// `_applyResponse()` builds (or null once hidden) — see its shape there;
// Marp tabs carry `slideRanges`/`added`/`changed` on it even though
// `kind !== 'full'` skips the line-highlight paint for them.
const currentListeners = [];

/**
 * @param {(current: object|null) => void} fn
 */
export function onCurrentChange(fn) {
    currentListeners.push(fn);
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
    // (0.6.8 used to drop a remembered PER-PATH highlight-toggle preference
    // here — 0.6.10 replaced that with ONE global preference, see this
    // module's docstring's "0.6.10" section, so there is nothing per-path
    // left to clean up on resolution.)
    for (const fn of seenListeners) {
        try {
            fn(path, hash || null);
        } catch (e) {
            console.error('diffReview: onSeen listener failed:', e);
        }
    }
}

export const DiffReviewManager = {
    _current: null, // see _applyResponse() for shape
    _jumpIndex: -1,
    _reviewSeq: 0,
    // Keyed by `${path}::${hash}` — NOT by path alone (codex P1,
    // 2026-07-14 review round). See _seedBaseline() below for why: a bare
    // path key would suppress seeding a LATER hash for the same path once
    // any earlier hash had already been seeded once this page load.
    _seededPaths: new Set(),
    _lastPath: null,
    // app.js injects the bootstrap-level refreshCurrentTab() here so a
    // stale pane (see refresh()) can be refetched before diffs apply.
    _requestTabRefresh: null,
    _staleRefetchKey: null,
    setRequestTabRefresh(fn) { this._requestTabRefresh = fn; },
    /**
     * Forget which paths have been journal-seeded. Called on WebSocket
     * reconnect (app.js wiring): a reconnect may mean the server —
     * and its in-memory journal — restarted, so every fast-path seed
     * suppression is stale (codex round-16).
     */
    resetSeeds() {
        this._seededPaths.clear();
        this._staleRefetchKey = null;
    },

    /**
     * Fire-and-forget: tell the server "`hash` IS the confirmed baseline
     * for `path`" so src/api/diff.js's `from === currentHash` branch pins
     * it in the change journal, protecting it from the version-cap/LRU
     * eviction an editing session's autosave flood would otherwise cause
     * (Fix 5, 2026-07-13 — see refresh()'s fast-path comment above).
     *
     * Suppressed to once per (path, hash) PAIR per page load, not once per
     * path (codex P1, 2026-07-14 review round): `_seededPaths` used to be
     * keyed by path alone, so once a path's FIRST baseline (e.g. H0) had
     * been seeded, `_confirmLatest()` advancing that same path's baseline
     * to a LATER hash (H1) could never seed/pin H1 — every future fast-path
     * refresh silently no-opped (`_seededPaths.has(path)` was already
     * true), and H1 sat unpinned until an editing session's autosave churn
     * evicted it, reintroducing unknown-baseline right after the most
     * natural "review → ✓ 確認 → edit" flow. Keying by `${path}::${hash}`
     * instead means a new baseline always gets its own fresh seed attempt.
     *
     * Called from two places: refresh()'s fast path above (nothing changed
     * since last seen — the ORIGINAL codex round-8 seeding case), and
     * _confirmLatest() below (baseline just advanced via ✓ 確認). The
     * latter matters on its own, independent of the path/hash keying fix:
     * entering edit mode right after confirming does NOT reliably trigger
     * another fast-path refresh() first — app.js's init() wraps
     * EditorManager.show() to call refresh() afterward, but state.isEditMode
     * is already true by then (EditorManager.toggle() sets it BEFORE
     * calling show()), so that refresh() call hits the `state.isEditMode`
     * guard at the top and returns before ever reaching the fast path.
     * Without this explicit call, the newly-confirmed baseline would only
     * ever get seeded by some UNRELATED later trigger (a tab switch, theme
     * toggle, etc.) that happens to fire before autosave's churn evicts it
     * — not guaranteed by the "confirm then edit" flow itself.
     * @param {string} path
     * @param {string|null|undefined} hash
     */
    _seedBaseline(path, hash) {
        if (!hash) return;
        const key = `${path}::${hash}`;
        if (this._seededPaths.has(key)) return;
        this._seededPaths.add(key);
        // On failure, forget the suppression so a later visit retries
        // instead of silently degrading to unknown-baseline (codex
        // round-16).
        MDVApi.diff(path, hash).catch(() => {
            this._seededPaths.delete(key);
        });
    },

    /**
     * The ONE place `this._current` is assigned — notifies
     * modules/marpDiffIndicator.js's onCurrentChange() seam every time,
     * including the null (hidden) case, so it never has to poll or
     * duplicate this module's diff-fetch logic.
     * @param {object|null} value
     */
    _setCurrent(value) {
        this._current = value;
        for (const fn of currentListeners) {
            try {
                fn(value);
            } catch (e) {
                console.error('diffReview: onCurrentChange listener failed:', e);
            }
        }
    },

    init() {
        this._bindToolbarControls();
        // 0.6.12: repaint from the already-current `_current` whenever
        // Review mode flips — no full refresh() needed, see
        // modules/reviewMode.js's docstring's "Visibility gate, not a
        // tracking gate" section.
        onReviewModeChange(() => {
            this._syncToolbar();
            this._applyHighlightClasses();
        });
    },

    /**
     * Wire the two STATIC toolbar buttons (index.html, cached in dom.js's
     * `elements` like every other toolbar button — see this module's
     * docstring's "0.6.8" section for why they're static markup now
     * instead of a JS-built `#diffReviewBar`). Both start `.hidden`;
     * `_syncToolbar()` is the only place that flips that.
     */
    _bindToolbarControls() {
        const toggleBtn = elements.diffToggleBtn;
        const confirmBtn = elements.diffConfirmBtn;
        // 0.6.12: clicking 「変更 N」 no longer toggles markup (Review mode
        // now owns that) — it jumps to the next change, same as ⌥↓.
        if (toggleBtn) toggleBtn.addEventListener('click', () => this._jumpChange(1));
        if (confirmBtn) confirmBtn.addEventListener('click', () => this._confirmLatest());

        // ⌥↑↓ jump. keyboard.js's shortcut table only recognizes
        // Cmd/Ctrl+<key> (see its handleModShortcut()) — no Alt support —
        // so this is a scoped listener here instead, matching the task's
        // "if its table supports modifiers, else scoped listener" guidance.
        document.addEventListener('keydown', (e) => this._handleJumpKey(e));
    },

    /**
     * Re-check the ACTIVE tab against its localStorage baseline and
     * update the toolbar controls/highlights. Safe to call redundantly
     * (tab reselect, theme toggle re-render, etc.) — idempotent, and
     * guarded against out-of-order async responses via _reviewSeq.
     */
    async refresh() {
        const mySeq = ++this._reviewSeq;
        const tab = state.tabs[state.activeTabIndex];

        if (!tab || state.isEditMode || !DIFFABLE_FILE_TYPES.has(tab.fileType)) {
            // Edit mode: the textarea replaces the rendered blocks, so
            // highlights/jump have no targets and a confirm click could
            // acknowledge a pre-edit hash (codex round-5) — hide until the
            // editor closes (EditorManager.hide() re-renders through
            // renderActive(), which brings the controls back if relevant).
            this._hide();
            return;
        }

        const lastSeen = getLastSeen(tab.path);

        // Path switches hide the PREVIOUS tab's toolbar controls
        // synchronously, before any await: a slow/failed request otherwise
        // leaves the old tab's 確認 button mounted over the new content,
        // confirming the wrong file (codex round-15).
        const pathChanged = tab.path !== this._lastPath;
        this._lastPath = tab.path;
        if (pathChanged) this._hide();

        if (!lastSeen) {
            const currentHash = await this._resolveCurrentHash(tab);
            if (mySeq !== this._reviewSeq) return; // superseded
            // First-sight race (codex round-15): the file may have changed
            // between the /api/file render and this /api/diff call — the
            // resolved hash would then be NEWER than the pane the user is
            // looking at, and storing it as seen would swallow that change
            // forever. Same stale-pane rule as the baseline path: refetch
            // first, then this branch re-runs against a fresh pane.
            if (currentHash && tab.etag && currentHash !== tab.etag && this._requestTabRefresh) {
                const key = `${tab.path}::${currentHash}`;
                if (this._staleRefetchKey !== key) {
                    this._staleRefetchKey = key;
                    this._requestTabRefresh();
                    return;
                }
            }
            if (currentHash) markSeen(tab.path, currentHash);
            this._hide();
            return;
        }

        // (pathChanged computed above — codex round-11: the fast path below
        // is only sound for the already-watched active path, so the first
        // refresh after a path switch always asks the server.)

        // Fast path: no network call needed when we already know the
        // current hash and it matches the baseline. One catch: after a
        // server restart the in-memory journal is empty even though
        // localStorage remembers this hash — seed it (fire-and-forget,
        // once per path+hash per page load, see _seedBaseline() below) so
        // the NEXT edit produces real counts instead of unknown-baseline
        // (codex round-8). Sending `lastSeen.hash` (not '') as `from`
        // matters beyond seeding, too (Fix 5, 2026-07-13): it makes this an
        // identical-hash request, which src/api/diff.js now pins as the
        // confirmed baseline. Before Fix 5 this sent `from=''`, which
        // src/api/diff.js never pins — a file opened via Review ON with
        // nothing changed yet had NO pin protecting its baseline, so
        // entering edit mode right after let autosave's flood of
        // journal.record() calls evict it before a single real diff was
        // ever requested (実装計画_2026-07-13_reviewベースライン消失.md §3
        // Fix 5).
        if (!pathChanged && tab.etag && tab.etag === lastSeen.hash) {
            this._seedBaseline(tab.path, lastSeen.hash);
            this._hide();
            return;
        }

        let data;
        try {
            const res = await MDVApi.diff(tab.path, lastSeen.hash);
            if (!res.ok) {
                // Controlled error envelope (file deleted/unreadable): NOT
                // a diff result. Treating it as one made _applyResponse
                // read undefined hunks and markSeen(undefined) — deleting
                // the baseline (codex round-17). Leave the baseline alone.
                if (mySeq === this._reviewSeq) this._hide();
                return;
            }
            data = await res.json();
        } catch (e) {
            console.error('diff review: /api/diff request failed:', e);
            // Same supersession rule as the success path: a stale request's
            // failure must not clear the UI a newer refresh() just rendered.
            if (mySeq === this._reviewSeq) this._hide();
            return;
        }
        if (mySeq !== this._reviewSeq) return; // a newer refresh() superseded this one

        // Stale-pane guard (codex round-13): an inactive tab is not
        // WS-watched, so its rendered DOM can lag the on-disk content the
        // server just diffed. Applying highlights — or worse, letting
        // 確認済み store data.currentHash — against a pane the user has
        // not actually seen is wrong. Refetch the tab first; the refetch
        // re-enters refresh() with a fresh pane (guard key prevents loops
        // when the refetch cannot advance the pane).
        const stalePane = data.currentHash && tab.etag && data.currentHash !== tab.etag;
        if (stalePane && this._requestTabRefresh) {
            const key = `${tab.path}::${data.currentHash}`;
            if (this._staleRefetchKey !== key) {
                this._staleRefetchKey = key;
                this._requestTabRefresh();
                return;
            }
        }

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
            if (!res.ok) return tab.etag || null;
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
                // toolbar controls, and drop any stale baseline (codex
                // round-4).
                markSeen(tab.path, null);
                this._hide();
                return;
            }
            this._setCurrent({ path: tab.path, kind: 'unavailable', currentHash: data.currentHash });
            this._jumpIndex = -1;
            this._clearHighlightClasses();
            this._syncToolbar();
            return;
        }

        const added = data.added || [];
        const changed = data.changed || [];
        const removedAt = data.removedAt || [];
        const removed = data.removed || [];
        const canHighlight = tab.fileType === 'markdown' && !tab.isMarp;

        const count = added.length + changed.length + removedAt.length;
        if (count === 0) {
            // identical:false but zero hunks: a CRLF/trailing-newline-only
            // change that diffLines() normalizes away. No visible line
            // difference to review — silently adopt the new hash instead
            // of showing 「変更 0」 (codex round-3).
            markSeen(tab.path, data.currentHash);
            this._hide();
            return;
        }
        this._setCurrent({
            path: tab.path,
            kind: canHighlight ? 'full' : 'bar-only',
            currentHash: data.currentHash,
            added,
            changed,
            removedAt,
            removed,
            count,
            // Only present for Marp tabs (src/api/diff.js) — modules/
            // marpDiffIndicator.js intersects it against added/changed to
            // work out which slide(s) a hunk touches. undefined for
            // non-Marp tabs, same as data.slideRanges itself.
            slideRanges: data.slideRanges
        });
        // 0.6.12: visibility is gated by isReviewMode() (modules/
        // reviewMode.js), a preference this module doesn't own — a
        // newly-arrived diff does NOT touch it either way, unlike 0.6.8's
        // per-path default-ON memory (see this module's docstring's
        // "0.6.8"/"0.6.12" sections).
        this._jumpIndex = -1;
        this._syncToolbar();
        this._applyHighlightClasses();
    },

    _hide() {
        this._setCurrent(null);
        this._jumpIndex = -1;
        this._syncToolbar();
        this._clearHighlightClasses();
    },

    /**
     * Paint the two static toolbar buttons from `_current` — the 0.6.8
     * replacement for the old `_renderBar()`'s innerHTML rebuild. 0.6.12:
     * gated on `isReviewMode()` FIRST — both buttons stay hidden whenever
     * Review is OFF, regardless of `_current` (background tracking still
     * computed it — see this module's docstring's "0.6.12" section — only
     * the paint is skipped).
     * 0.6.14 (layout-stability fix — see this module's docstring's "0.6.14"
     * section): while Review is ON, `.hidden` is never touched here again —
     * both buttons stay mounted and only their `disabled` attribute/label
     * change, so neighboring toolbar controls never shift when a diff
     * appears/resolves or the active tab switches. Three ON-states:
     *   - no `_current` (nothing to review) → both disabled, "次の変更 0".
     *   - `_current.kind === 'unavailable'` → jump disabled (no jump
     *     target), confirm stays enabled (confirming is still meaningful).
     *   - a real pending diff (`'full'`/`'bar-only'`) → both enabled.
     */
    _syncToolbar() {
        const toggleBtn = elements.diffToggleBtn;
        const confirmBtn = elements.diffConfirmBtn;
        if (!toggleBtn || !confirmBtn) return;
        const c = this._current;

        if (!isReviewMode()) {
            toggleBtn.classList.add('hidden');
            confirmBtn.classList.add('hidden');
            return;
        }

        toggleBtn.classList.remove('hidden');
        confirmBtn.classList.remove('hidden');

        if (!c) {
            toggleBtn.disabled = true;
            confirmBtn.disabled = true;
            toggleBtn.textContent = '次の変更 0';
            toggleBtn.title = '次の変更へジャンプ（⌥↓ でも移動）';
            return;
        }

        if (c.kind === 'unavailable') {
            toggleBtn.disabled = true;
            confirmBtn.disabled = false;
            toggleBtn.textContent = '次の変更 ?';
            toggleBtn.title = '差分は取得できませんでした';
            return;
        }

        toggleBtn.disabled = false;
        confirmBtn.disabled = false;
        toggleBtn.textContent = `次の変更 ${c.count}`;
        toggleBtn.title = '次の変更へジャンプ（⌥↓ でも移動）';
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
        // Pin the just-confirmed hash server-side right away instead of
        // waiting for some later fast-path refresh() to do it (codex P1,
        // 2026-07-14 review round — see _seedBaseline()'s docstring for why
        // that wait is not reliable for the "confirm then edit" flow).
        this._seedBaseline(path, hash);
        this._hide();
    },

    _handleJumpKey(e) {
        // Shift excluded: Alt+Shift+ArrowDown belongs to unreadBadges.js's
        // 次の未読へ shortcut — without this both handlers fired (codex
        // 0.6.5 round-7).
        if (!e.altKey || e.shiftKey || e.metaKey || e.ctrlKey) return;
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

        const active = document.activeElement;
        const isTextInput = active && (
            active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
        );
        if (isTextInput) return;

        // 0.6.12: inert while Review mode is OFF — there is nothing
        // visible on screen for this shortcut to act on (see
        // modules/reviewMode.js's docstring). _jumpChange() re-checks the
        // same condition (shared with the 「次の変更 N」 click handler), but
        // checking here too lets us skip preventDefault() when the
        // shortcut has nothing to do.
        if (!isReviewMode() || !this._current || this._current.kind !== 'full') return;

        e.preventDefault();
        this._jumpChange(e.key === 'ArrowDown' ? 1 : -1);
    },

    /**
     * Move the ⌥↑↓ jump cursor by `delta` and scroll/flash the target —
     * shared by `_handleJumpKey()` (⌥↑↓) and `#diffToggleBtn`'s click
     * handler (0.6.12: clicking 「変更 N」 now jumps instead of toggling
     * markup, see this module's docstring's "0.6.12" section). No-ops
     * while Review is OFF or there is nothing highlighted to jump between.
     */
    _jumpChange(delta) {
        if (!isReviewMode() || !this._current || this._current.kind !== 'full') return;

        // 0.6.10: .diff-removed-after (a bare tick) is gone — the injected
        // .diff-removed-inline block is its replacement jump target, so
        // ⌥↑↓ still cycles through deletions, not just adds/changes.
        const targets = Array.from(
            elements.content.querySelectorAll('.diff-added, .diff-changed, .diff-removed-inline')
        );
        if (!targets.length) return;

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

    /**
     * Largest data-source-line <= pos, else the first block (covers
     * pos === 0 "deleted/changed before line 1", and any position that
     * falls before every tagged block) — same fallback convention as
     * searchPalette.js's _scrollToSourceLine(). Shared by markRange()'s
     * pass 2 and _injectRemovedInline()'s anchor lookup below.
     * @param {{el: Element, line: number}[]} blocks - ascending, from _collectBlocks()
     * @param {number} pos
     * @returns {{el: Element, line: number}|null}
     */
    _nearestBlock(blocks, pos) {
        let best = null;
        for (const b of blocks) {
            if (b.line <= pos) best = b;
            else break;
        }
        return best || blocks[0] || null;
    },

    /**
     * Remove BOTH kinds of diff markup this module ever paints: the
     * persistent .diff-added/.diff-changed classes, and the injected
     * .diff-removed-inline elements (0.6.10 — these are throwaway DOM
     * nodes, not classes on existing blocks, so clearing them means
     * removing them outright; see this module's docstring's "0.6.10"
     * section for every path that must call this).
     */
    _clearHighlightClasses() {
        elements.content.querySelectorAll('.diff-added, .diff-changed')
            .forEach((el) => el.classList.remove('diff-added', 'diff-changed'));
        elements.content.querySelectorAll('.diff-removed-inline[data-mdv-injected]')
            .forEach((el) => el.remove());
    },

    _applyHighlightClasses() {
        this._clearHighlightClasses();
        // 0.6.12: Review ON always shows highlights/strikethrough for a
        // full diff now — no separate `_highlightsOn` sub-toggle left to
        // check (see this module's docstring's "0.6.12" section).
        if (!isReviewMode() || !this._current || this._current.kind !== 'full') return;

        const blocks = this._collectBlocks();
        if (!blocks.length) {
            // No anchors left (e.g. the whole document was deleted, or a
            // tight-list-only doc). Range highlights have nothing to paint,
            // but DELETIONS must still show — inject them straight into
            // the content container (codex 0.6.10 round-2).
            if (this._current.removed && this._current.removed.length) {
                const container = elements.content.querySelector('.markdown-body') || elements.content;
                const insertAfter = new Map();
                this._current.removed.forEach((hunk) =>
                    this._injectRemovedInline([], hunk, insertAfter, container));
            }
            return;
        }

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
            const best = this._nearestBlock(blocks, start);
            if (best) best.el.classList.add(cls);
        };

        // 0.6.10: added and changed share one (yellow) visual treatment —
        // see styles.css — but stay two classes for structure/tests/jump.
        this._current.added.forEach((r) => markRange(r, 'diff-added'));
        this._current.changed.forEach((r) => markRange(r, 'diff-changed'));

        // insertAfter threads multiple deletions that resolve to the SAME
        // anchor block into stable top-to-bottom order: insertAdjacentElement
        // always inserts immediately after its reference node, so without
        // this a second hunk anchored at the same block would land BETWEEN
        // the block and the first hunk's already-inserted div instead of
        // after it.
        const insertAfter = new Map();
        this._current.removed.forEach((hunk) => this._injectRemovedInline(blocks, hunk, insertAfter));
    },

    /**
     * Inject one presentational, Word-style strikethrough block for a
     * pure-deletion hunk (0.6.10) — replaces the old .diff-removed-after
     * tick. Never called for kind !== 'full' (Marp/code/text tabs), edit
     * mode (refresh() hides everything there before this can run), or when
     * markup is toggled off (guarded by the caller).
     * @param {{el: Element, line: number}[]} blocks
     * @param {{afterLine: number, lines: string[]}} hunk
     * @param {Map<Element, Element>} insertAfter - anchor el -> last node inserted after it
     */
    _injectRemovedInline(blocks, hunk, insertAfter, fallbackContainer = null) {
        const anchorBlock = this._nearestBlock(blocks, hunk.afterLine);
        if (!anchorBlock && !fallbackContainer) return;

        const shown = hunk.lines.slice(0, DIFF_REMOVED_INLINE_MAX_LINES);
        let html = shown.map((line) => escapeHtml(line)).join('<br>');
        if (hunk.lines.length > DIFF_REMOVED_INLINE_MAX_LINES) {
            const remaining = hunk.lines.length - DIFF_REMOVED_INLINE_MAX_LINES;
            html += `<br><span class="diff-removed-inline-more">…（あと ${remaining} 行削除）</span>`;
        }

        // Placement decision (codex 0.6.10 rounds 4-5, opposing pulls):
        // a raw <div> inside <ul>/<pre> is invalid — but hoisting a
        // MID-LIST deletion to after the whole list breaks Word-style
        // positioning. Resolution: if the deletion sits BETWEEN items of
        // the same list (anchor li and the next mapped block's li share a
        // list container), render it as an <li> inside that list;
        // otherwise hoist to the top-level block.
        // Never the list-item path for a deletion that belongs ABOVE the
        // anchor (afterLine < anchor's own line): a heading deleted above
        // a list must not become a bullet of that list (codex round-6).
        const beforeAnchor = anchorBlock && hunk.afterLine < anchorBlock.line;
        const anchorLi = anchorBlock && !beforeAnchor && anchorBlock.el.closest('li');
        let asListItem = false;
        if (anchorLi) {
            const next = blocks.find((b) => b.line > hunk.afterLine);
            const nextLi = next && next.el.closest('li');
            asListItem = !!(nextLi && anchorLi.parentElement === nextLi.parentElement);
        }

        const div = document.createElement(asListItem ? 'li' : 'div');
        div.className = 'diff-removed-inline';
        // Marker so cleanup removes ONLY nodes WE injected — markdown can
        // contain user-authored raw HTML with the same class, which must
        // survive markup-off (codex round-6).
        div.setAttribute('data-mdv-injected', '1');
        div.setAttribute('aria-hidden', 'true');
        div.innerHTML = html; // safe: every line went through escapeHtml() above; <br>/the
        // .diff-removed-inline-more span are the only raw markup, both ours.

        if (!anchorBlock) {
            // Whole-document deletion: no anchor exists — append into the
            // content container in hunk order (codex 0.6.10 round-2).
            fallbackContainer.appendChild(div);
            return;
        }
        // Hoist the insertion point to the top-level document block: the
        // nearest source-line node can be NESTED (a <li> inside <ul>, a
        // <code data-source-line> inside <pre>) and inserting a <div>
        // adjacent to it would land inside that structure — invalid HTML
        // in lists/tables, garbled rendering in code blocks
        // (codex 0.6.10 round-4).
        const host = asListItem ? anchorLi : this._topLevelBlock(anchorBlock.el);
        // A deletion anchored BEFORE the first visible block's own line
        // (afterLine 0, or any position among leading unmapped lines) must
        // appear ABOVE that block, not below it (codex 0.6.10 rounds 1+3).
        if (hunk.afterLine < anchorBlock.line && !insertAfter.has(host)) {
            host.insertAdjacentElement('beforebegin', div);
            return;
        }
        const anchor = insertAfter.get(host) || host;
        anchor.insertAdjacentElement('afterend', div);
        insertAfter.set(host, div);
    },

    /**
     * Walk up from a (possibly nested) source-line node to its top-level
     * block — the direct child of the rendered-content container — so
     * injected review elements always sit BETWEEN document blocks.
     */
    _topLevelBlock(el) {
        const container = elements.content.querySelector('.markdown-body') || elements.content;
        let node = el;
        while (node.parentElement && node.parentElement !== container
            && node.parentElement !== elements.content) {
            node = node.parentElement;
        }
        return node;
    }
};
