/**
 * MDV - Marp diff indicator (0.6.16)
 *
 * Owner's ask: Review mode's diff tracking already highlights changed lines
 * in the plain-markdown view (modules/diffReview.js), but the Marp preview
 * tab shows nothing at all — you have to flip through every slide to find
 * what changed. This module adds the smallest visible trace that answers
 * "does the slide I'm looking at contain a change": a single small dot next
 * to the existing `.marp-nav` slide counter (contentRenderer.js), lit
 * whenever the CURRENTLY DISPLAYED slide overlaps an added/changed line
 * range.
 *
 * ---------------------------------------------------------------------
 * Why a single current-slide dot, not a dot strip across every slide
 * ---------------------------------------------------------------------
 * There is no thumbnail rail in this app (`.marp-nav` is just prev/next +
 * a "N / M" counter) — the owner's design instinct (0.6.8-0.6.15: every
 * revision of the review surface REMOVED chrome, never added a persistent
 * new panel) argues against inventing an M-dot strip purely for this
 * feature. One small dot that appears/disappears with the existing counter
 * as you navigate matches the nav's current visual weight exactly and costs
 * nothing when there is nothing to show.
 *
 * ---------------------------------------------------------------------
 * How "does this slide have a change" is computed
 * ---------------------------------------------------------------------
 * GET /api/diff (src/api/diff.js) reports `added`/`changed` as one-based
 * raw-line ranges, and — for a Marp deck specifically — a `slideRanges`
 * array in the same convention (from marpitAdapter.js's `parseDeck()`, the
 * one place Marp/Marpit parsing happens; never re-parsed here). Both are
 * already threaded onto modules/diffReview.js's `_current` object (that
 * module computes them for every diffable tab, Marp included — only the
 * line-highlight PAINT skips Marp via `canHighlight`). This module never
 * fetches anything itself: it just subscribes to diffReview.js's
 * `onCurrentChange()` seam (fired every time `_current` changes: a new
 * diff arrives, the pending diff resolves via ✓ 確認, or the tab/path
 * changes) and reviewMode.js's `onReviewModeChange()`, and re-derives the
 * changed-slide-index Set via the pure `changedSlideIndices()` helper
 * (lib/marpDiffMap.js) whenever either fires.
 *
 * ---------------------------------------------------------------------
 * DOM lifecycle — created/removed, never just class-hidden
 * ---------------------------------------------------------------------
 * Unlike the permanently-mounted `#diffToggleBtn`/`#diffConfirmBtn` (static
 * markup in index.html, gated by toggling `.hidden`), this dot does not
 * exist in contentRenderer.js's nav template at all. `_repaint()` below
 * CREATES a `<span class="marp-diff-dot">` right after `.slide-counter` the
 * moment it should be visible, and REMOVES it outright the moment it
 * shouldn't — same convention as diffReview.js's own `.diff-removed-inline`
 * blocks (throwaway DOM nodes, not a class on a persistent element). This
 * guarantees genuinely zero DOM trace (no element, no class) whenever
 * Review mode is OFF, the active tab isn't a Marp deck, or the current
 * slide has no change — not just zero visible trace.
 *
 * `contentRenderer.js`'s `showSlide(index)` calls `onSlideChange(index)`
 * here on every slide navigation (prev/next/keyboard) — cheap, since the
 * changed-slide Set is already computed; this only creates/removes one node.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { getCurrentSlide } from './marpState.js';
import { isReviewMode, onReviewModeChange } from './reviewMode.js';
import { onCurrentChange } from './diffReview.js';
import { changedSlideIndices } from '../lib/marpDiffMap.js';

export const MarpDiffIndicator = {
    _current: null, // last payload from diffReview.js's onCurrentChange (or null)
    _changedSlides: new Set(),

    init() {
        onReviewModeChange(() => this._repaint());
        onCurrentChange((current) => {
            this._current = current;
            this._changedSlides = this._computeChangedSlides(current);
            this._repaint();
        });
    },

    /**
     * Called by contentRenderer.js's showSlide() on every slide navigation
     * — the changed-slide Set is already computed, so this is just a
     * cheap re-check against the new index. Takes the index explicitly
     * (rather than re-reading marpState.getCurrentSlide()) so this call
     * doesn't depend on being placed after setCurrentSlide() in the
     * caller's body.
     * @param {number} index
     */
    onSlideChange(index) {
        this._repaint(index);
    },

    _computeChangedSlides(current) {
        if (!current || !Array.isArray(current.slideRanges)) return new Set();
        const ranges = [...(current.added || []), ...(current.changed || [])];
        return changedSlideIndices(ranges, current.slideRanges);
    },

    _repaint(index = getCurrentSlide()) {
        const nav = elements.content.querySelector('.marp-nav');
        if (!nav) return; // no Marp nav mounted right now — nothing to paint
        const counter = nav.querySelector('.slide-counter');
        if (!counter) return;

        const tab = state.tabs[state.activeTabIndex];
        const show = isReviewMode()
            && !!tab
            && tab.isMarp
            && !!this._current
            && this._current.path === tab.path
            && this._changedSlides.has(index);

        const existing = nav.querySelector('.marp-diff-dot');
        if (!show) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return; // already shown for this slide
        const dot = document.createElement('span');
        dot.className = 'marp-diff-dot';
        dot.title = 'このスライドに変更があります';
        counter.insertAdjacentElement('afterend', dot);
    }
};
