/**
 * MDV - Review Mode (0.6.12)
 *
 * Owner's direction, verbatim: 「校閲だけ英語じゃないの違和感」 (re: the
 * button label — see below) plus the driving mental model behind this
 * whole revision: Word's 校閲/Review tab. In Word, ONE tab press gates
 * everything review-related — track changes, comments, the change count —
 * on or off at once. 0.6.8-0.6.10 built that surface piece by piece
 * (unread ● tree badges in modules/unreadBadges.js, the 「変更 N」/
 * 「✓ 確認」 toolbar buttons + highlights in modules/diffReview.js) but
 * left TWO independent visibility switches: unread badges had no switch
 * at all (always shown when non-zero) and the highlight markup had its
 * own separate global toggle (0.6.10's STORAGE_KEYS.REVIEW_MARKUP). This
 * module collapses both into the ONE switch Word users expect.
 *
 * ---------------------------------------------------------------------
 * What this module owns
 * ---------------------------------------------------------------------
 * A single boolean, persisted under STORAGE_KEYS.REVIEW_MODE
 * ('mdv-review-mode', see constants.js), plus the toolbar button
 * (`#reviewModeToggle`, index.html — permanent, plain `.toolbar-btn`
 * markup right after the Style button, exactly like Edit/PDF/Style) that
 * flips it. The button's label is the English word "Review" (owner:
 * it sits beside Edit/PDF/Style, which are all English — a Japanese
 * label would be the odd one out; the *tooltip* stays Japanese like every
 * other toolbar button's `title`, matching this app's convention of
 * English labels + Japanese tooltips throughout the toolbar). DEFAULT OFF
 * — same instinct as 0.6.10's now-superseded REVIEW_MARKUP default.
 *
 * This module does NOT know about diffs, baselines, or tree badges — it
 * is purely the on/off switch and its persistence. modules/diffReview.js
 * and modules/unreadBadges.js each import `isReviewMode()` to gate their
 * own painting, and both call `onReviewModeChange()` (this module's
 * subscription seam, same shape as diffReview.js's own `onSeen()`) so a
 * toggle click repaints both surfaces immediately without a full
 * `DiffReviewManager.refresh()`/`UnreadBadgesManager.decorate()` re-scan —
 * both already hold the current computed state (`_current` /
 * `_unreadEtag`) from background tracking that runs regardless of this
 * switch (see "Visibility gate, not a tracking gate" below); toggling
 * Review only needs to re-run the PAINT step against that already-current
 * state, not recompute it.
 *
 * ---------------------------------------------------------------------
 * Visibility gate, not a tracking gate
 * ---------------------------------------------------------------------
 * Turning Review OFF must not stop the underlying bookkeeping — only
 * hide its visible trace. If it did, turning Review back ON later would
 * show a stale, incomplete picture (or require a slow full re-scan)
 * instead of "immediately accurate". Concretely, while this module's
 * boolean is OFF, these keep running exactly as before, unchanged:
 *   - modules/diffReview.js: `getLastSeen`/`markSeen` baseline recording
 *     on tab open (first-sight) and confirm, `refresh()`'s diff
 *     computation against the active tab, and change-journal seeding.
 *   - modules/unreadBadges.js: `handleFilesChanged()` still updates its
 *     internal `_unreadEtag` map from every `files_changed` broadcast,
 *     and `onSeen()` still clears entries from it.
 * Only the PAINT functions consult `isReviewMode()`: diffReview.js's
 * `_syncToolbar()`/`_applyHighlightClasses()` (hide the toolbar buttons
 * and strip highlight classes/injected deletion blocks when OFF, instead
 * of skipping the computation that feeds them) and unreadBadges.js's
 * `decorate()`/`_updateHeaderChip()` (paint zero badges/a hidden chip
 * when OFF, without forgetting `_unreadEtag`'s contents). The ⌥↑↓ jump
 * (diffReview.js) and ⌥⇧↓ next-unread (unreadBadges.js) keyboard
 * shortcuts also consult it directly and no-op while OFF ("shortcuts
 * inert while OFF" — there is nothing on screen for them to act on, and
 * silently jumping/opening a file with no visible cue would be
 * disorienting).
 *
 * ---------------------------------------------------------------------
 * Migration from 0.6.10's REVIEW_MARKUP key
 * ---------------------------------------------------------------------
 * The 0.6.10 per-file-type highlight sub-toggle (STORAGE_KEYS.
 * REVIEW_MARKUP, literal key `'mdv-review-markup'`) is GONE — Review ON
 * now unconditionally implies markup shown (diffReview.js's
 * `_applyHighlightClasses()` no longer has an independent on/off of its
 * own; see that module's docstring). A returning user's old preference
 * is still meaningful, though: `_migrateLegacyKey()` below reads the old
 * key ONCE at `init()` time, and IF the new REVIEW_MODE key has never
 * been written before (a genuinely fresh migration, not a second run),
 * adopts the old boolean as the initial Review Mode value — a user who
 * had left markup ON starts with Review ON; a user who left it OFF (the
 * more common case, since OFF was the 0.6.10 default) starts OFF, same as
 * a brand-new profile. Either way the legacy key is deleted afterward so
 * this only ever runs once per browser profile. The literal string is
 * hardcoded here rather than re-imported from constants.js, matching the
 * project's convention for a superseded/removed key (constants.js's
 * STORAGE_KEYS no longer exports it, on purpose — see that file).
 *
 * ---------------------------------------------------------------------
 * Wiring (app.js's init())
 * ---------------------------------------------------------------------
 * `ReviewModeManager.init()` must run before `DiffReviewManager.init()`/
 * `UnreadBadgesManager.init()` subscribe via `onReviewModeChange()` (order
 * doesn't strictly matter for correctness — subscribing before or after
 * `init()` both work, since `init()` only performs the one-time migration
 * + button wiring, not an initial notify — but it runs first in app.js
 * for readability, as the surface the other two gate against).
 */
import { elements } from './dom.js';
import { STORAGE_KEYS } from './constants.js';

// 0.6.10's now-removed key — see this module's docstring's "Migration"
// section for why this is a hardcoded literal rather than a constants.js
// export.
const LEGACY_REVIEW_MARKUP_KEY = 'mdv-review-markup';

function readPersisted() {
    try {
        return localStorage.getItem(STORAGE_KEYS.REVIEW_MODE) === 'true';
    } catch {
        return false;
    }
}

function writePersisted(value) {
    try {
        localStorage.setItem(STORAGE_KEYS.REVIEW_MODE, value ? 'true' : 'false');
    } catch {
        // Storage full/unavailable (private-browsing quota, etc.) — the
        // toggle just won't persist across reloads; not fatal.
    }
}

export const ReviewModeManager = {
    _isOn: false,
    _listeners: [],

    init() {
        this._migrateLegacyKey();
        this._isOn = readPersisted();
        this._bindToolbarButton();
        this._syncButton();
    },

    /**
     * One-time adopt-then-remove of the 0.6.10 REVIEW_MARKUP boolean —
     * see this module's docstring's "Migration" section.
     */
    _migrateLegacyKey() {
        try {
            const legacy = localStorage.getItem(LEGACY_REVIEW_MARKUP_KEY);
            if (legacy === null) return; // nothing to migrate
            if (localStorage.getItem(STORAGE_KEYS.REVIEW_MODE) === null) {
                writePersisted(legacy === 'true');
            }
            localStorage.removeItem(LEGACY_REVIEW_MARKUP_KEY);
        } catch {
            // Storage unavailable — leave both keys alone; this profile
            // simply starts at the (false) default, same as any other
            // read failure elsewhere in this module.
        }
    },

    _bindToolbarButton() {
        const btn = elements.reviewModeToggle;
        if (btn) btn.addEventListener('click', () => this._toggle());
    },

    _toggle() {
        this._isOn = !this._isOn;
        writePersisted(this._isOn);
        this._syncButton();
        for (const fn of this._listeners) {
            try {
                fn(this._isOn);
            } catch (e) {
                console.error('reviewMode: onChange listener failed:', e);
            }
        }
    },

    _syncButton() {
        const btn = elements.reviewModeToggle;
        if (!btn) return;
        btn.classList.toggle('active', this._isOn);
        btn.setAttribute('aria-pressed', String(this._isOn));
    },

    isOn() {
        return this._isOn;
    },

    /**
     * @param {(isOn: boolean) => void} fn - called after every toggle,
     *   with the new value. No unsubscribe: every current caller
     *   (modules/diffReview.js, modules/unreadBadges.js) subscribes once
     *   at bootstrap, for the app's lifetime — same convention as
     *   diffReview.js's own `onSeen()`.
     */
    onChange(fn) {
        this._listeners.push(fn);
    }
};

/** @returns {boolean} whether Review mode is currently ON. */
export function isReviewMode() {
    return ReviewModeManager.isOn();
}

/** @param {(isOn: boolean) => void} fn */
export function onReviewModeChange(fn) {
    ReviewModeManager.onChange(fn);
}
