/**
 * MDV - Search Palette (Cmd/Ctrl+K)
 *
 * Full-tree full-text search overlay backed by GET /api/search
 * (src/services/search.js via src/api/search.js, MDVApi.search() here).
 * Task C of the 0.6.1 review-surface plan (docs/plan-review-surface-0.6.x.md)
 * — see that doc's "① 全文検索" section for the product spec, and the
 * mock (`mock/mdv-review-surface-mock.html`, scene 2) for the look/feel this
 * replicates with the app's own CSS variables (both themes).
 *
 * DOM ownership: unlike DialogManager (which reuses a static overlay from
 * index.html), this module builds its whole overlay/palette subtree once in
 * _buildDom() and appends it to document.body — nothing outside this module
 * reaches into it, so there's no need for index.html markup beyond the
 * toolbar trigger button (#searchBoxToggle, wired here via elements.js).
 * This mirrors modules/inlineNotes.js's buildPanel()-style dynamic-DOM
 * construction rather than dialog.js's static-markup approach.
 *
 * No forward-reference wiring needed: this module imports TabManager
 * directly (a normal one-directional import — tabs.js has no reason to
 * import searchPalette.js back), and modules/keyboard.js imports THIS
 * module directly to wire Cmd/Ctrl+K (see keyboard.js's shortcuts table).
 *
 * Source-line jump (Enter key): markdown files use the data-source-line
 * attribute markdown.js's mdv_source_line core rule bakes onto rendered
 * blocks (see that module's "Source-line mapping" doc comment) — this finds
 * the rendered element whose data-source-line is the largest value <= the
 * hit's line and flash-highlights it. code/text files have no per-line
 * mapping (plain <pre>/<pre class="plain-text">), so we scroll the content
 * pane proportionally (line/totalLines) and flash the pane itself instead.
 * Marp decks have no source-line mapping at all in v1 (per the plan doc) —
 * we just open the deck and stop there; there is nothing to scroll to.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { escapeHtml } from './utils.js';
import {
    SEARCH_DEBOUNCE_MS,
    SEARCH_MIN_QUERY_LENGTH,
    SEARCH_PALETTE_LIMIT,
    SEARCH_JUMP_FLASH_MS
} from './constants.js';
import { createDebouncedAction } from '../lib/debounce.js';
import { MDVApi } from '../lib/apiClient.js';
import { TabManager } from './tabs.js';

/**
 * Highlight every occurrence of `query` inside `snippet`, HTML-escaping
 * everything (matched and unmatched text alike) via the app's existing
 * escapeHtml() — never innerHTML of raw server text. Matching follows the
 * same smart-case rule as the server (src/services/search.js
 * isCaseInsensitive): an all-lowercase query matches case-insensitively, a
 * query containing any uppercase character matches case-sensitively.
 * @param {string} snippet - Raw (unescaped) snippet text from the server
 * @param {string} query - Raw (unescaped) query text
 * @returns {string} HTML-safe string with matches wrapped in <mark>
 */
function highlightSnippet(snippet, query) {
    if (!query) return escapeHtml(snippet);

    const caseInsensitive = query === query.toLowerCase();
    const haystack = caseInsensitive ? snippet.toLowerCase() : snippet;
    const needle = caseInsensitive ? query.toLowerCase() : query;

    let out = '';
    let pos = 0;
    let idx = haystack.indexOf(needle, pos);
    while (idx !== -1) {
        out += escapeHtml(snippet.slice(pos, idx));
        out += '<mark>' + escapeHtml(snippet.slice(idx, idx + query.length)) + '</mark>';
        pos = idx + query.length;
        idx = haystack.indexOf(needle, pos);
    }
    out += escapeHtml(snippet.slice(pos));
    return out;
}

export const SearchPalette = {
    _isOpen: false,
    _query: '',
    _hits: [],
    _selectedIndex: -1,
    _truncated: false,
    _stats: null,
    _abortController: null,
    _debounced: null,
    _overlay: null,
    _inputEl: null,
    _resultsEl: null,
    _footerEl: null,

    _buildDom() {
        const overlay = document.createElement('div');
        overlay.id = 'searchPaletteOverlay';
        overlay.className = 'search-overlay hidden';
        overlay.innerHTML = `
            <div class="search-palette">
                <div class="search-input-row">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input type="text" id="searchPaletteInput" placeholder="ファイルを横断して検索…" autocomplete="off" spellcheck="false" aria-label="Search all files">
                </div>
                <div class="search-results" id="searchPaletteResults"></div>
                <div class="search-footer" id="searchPaletteFooter"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        this._overlay = overlay;
        this._inputEl = overlay.querySelector('#searchPaletteInput');
        this._resultsEl = overlay.querySelector('#searchPaletteResults');
        this._footerEl = overlay.querySelector('#searchPaletteFooter');

        this._debounced = createDebouncedAction({
            fn: () => this._runSearch(),
            delayMs: SEARCH_DEBOUNCE_MS
        });

        this._inputEl.addEventListener('input', () => {
            this._query = this._inputEl.value;
            if (this._query.length < SEARCH_MIN_QUERY_LENGTH) {
                this._debounced.cancel();
                if (this._abortController) {
                    this._abortController.abort();
                    this._abortController = null;
                }
                this._hits = [];
                this._selectedIndex = -1;
                this._truncated = false;
                this._stats = null;
                this._renderResults();
                return;
            }
            this._debounced.schedule();
        });

        this._inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._moveSelection(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._moveSelection(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                this._openHitAtIndex(this._selectedIndex);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
        });

        // Click outside the palette (on the overlay backdrop) closes it —
        // same convention as DialogManager's overlay-click handler.
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.close();
        });

        this._resultsEl.addEventListener('click', (e) => {
            const hitEl = e.target.closest('.search-hit');
            if (!hitEl) return;
            const idx = parseInt(hitEl.dataset.index, 10);
            if (!Number.isNaN(idx)) this._openHitAtIndex(idx);
        });
    },

    open() {
        if (this._isOpen) {
            this._inputEl.focus();
            return;
        }
        this._isOpen = true;
        this._query = '';
        this._hits = [];
        this._selectedIndex = -1;
        this._truncated = false;
        this._stats = null;
        this._inputEl.value = '';
        this._renderResults();
        this._overlay.classList.remove('hidden');
        // Focus after the overlay is actually visible (removing .hidden is
        // synchronous, but giving the browser a frame avoids any focus
        // being swallowed while display flips from none).
        requestAnimationFrame(() => this._inputEl.focus());
    },

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        this._overlay.classList.add('hidden');
        this._debounced.cancel();
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    },

    async _runSearch() {
        const query = this._query;

        if (this._abortController) this._abortController.abort();
        const controller = new AbortController();
        this._abortController = controller;

        try {
            const res = await MDVApi.search(query, SEARCH_PALETTE_LIMIT, controller.signal);
            const data = await res.json();
            if (controller.signal.aborted) return; // superseded by a newer keystroke

            this._hits = Array.isArray(data.results) ? data.results : [];
            this._truncated = !!data.truncated;
            this._stats = data.stats || null;
        } catch (e) {
            if (e.name === 'AbortError') return; // superseded — a newer request already took over
            console.error('Search failed:', e);
            this._hits = [];
            this._truncated = false;
            this._stats = null;
        }

        this._selectedIndex = this._hits.length ? 0 : -1;
        this._renderResults();
    },

    /**
     * Group the (already file-ordered, per src/services/search.js's
     * per-file walk) flat hit list into consecutive runs sharing the same
     * path — cheaper and order-preserving vs. a Map + re-sort, and safe
     * because the server never interleaves two files' results.
     * @returns {Array<{path: string, hits: object[]}>}
     */
    _groupHits() {
        const groups = [];
        for (const hit of this._hits) {
            const last = groups[groups.length - 1];
            if (last && last.path === hit.path) {
                last.hits.push(hit);
            } else {
                groups.push({ path: hit.path, hits: [hit] });
            }
        }
        return groups;
    },

    _renderResults() {
        const groups = this._groupHits();

        if (this._query.length < SEARCH_MIN_QUERY_LENGTH) {
            this._resultsEl.innerHTML = `<div class="search-hint">${SEARCH_MIN_QUERY_LENGTH}文字以上入力してください</div>`;
        } else if (this._hits.length === 0) {
            this._resultsEl.innerHTML = '<div class="search-empty">一致する結果がありません</div>';
        } else {
            let flatIndex = 0;
            this._resultsEl.innerHTML = groups.map((group) => {
                const header = `<div class="search-group">${escapeHtml(group.path)} — ${group.hits.length}件</div>`;
                const rows = group.hits.map((hit) => {
                    const isSelected = flatIndex === this._selectedIndex;
                    const row = `
                        <div class="search-hit${isSelected ? ' selected' : ''}" data-index="${flatIndex}">
                            <span class="search-hit-line">L${hit.line}</span>
                            <span class="search-hit-snippet">${highlightSnippet(hit.snippet, this._query)}</span>
                        </div>`;
                    flatIndex++;
                    return row;
                }).join('');
                return header + rows;
            }).join('');
        }

        this._renderFooter(groups.length);
    },

    _renderFooter(fileCount) {
        let stats = '';
        if (this._query.length >= SEARCH_MIN_QUERY_LENGTH) {
            if (this._hits.length > 0) {
                stats = `${this._hits.length}件 / ${fileCount}ファイル`;
                if (this._stats && typeof this._stats.elapsedMs === 'number') {
                    stats += `（${this._stats.elapsedMs}ms）`;
                }
                if (this._truncated) {
                    stats += ' ・ さらに一致あり（絞り込んでください）';
                }
            } else {
                stats = '0件';
            }
        }

        this._footerEl.innerHTML = `
            <span><kbd>↑</kbd><kbd>↓</kbd> 移動</span>
            <span><kbd>Enter</kbd> 開いて該当行へ</span>
            <span><kbd>Esc</kbd> 閉じる</span>
            <span class="search-footer-stats">${escapeHtml(stats)}</span>
        `;
    },

    _moveSelection(delta) {
        if (!this._hits.length) return;
        const max = this._hits.length - 1;
        this._selectedIndex = Math.max(0, Math.min(max, this._selectedIndex + delta));
        this._updateSelectionHighlight();
    },

    _updateSelectionHighlight() {
        const rows = this._resultsEl.querySelectorAll('.search-hit');
        let selectedEl = null;
        rows.forEach((el) => {
            const idx = parseInt(el.dataset.index, 10);
            const isSelected = idx === this._selectedIndex;
            el.classList.toggle('selected', isSelected);
            if (isSelected) selectedEl = el;
        });
        if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' });
    },

    async _openHitAtIndex(index) {
        const hit = this._hits[index];
        if (!hit) return;
        this.close();
        // TabManager.renderActive() restores the tab's remembered scroll
        // position via setTimeout(0) (tabs.js), which would land AFTER an
        // immediate jump and yank the pane away from the hit. Suppress the
        // restore with the existing skipScrollRestore flag (same mechanism
        // editor.js uses), and run the jump in a macrotask queued behind
        // the render so layout has settled.
        state.skipScrollRestore = true;
        try {
            await TabManager.open(hit.path);
        } finally {
            setTimeout(() => {
                state.skipScrollRestore = false;
                this._scrollToHit(hit);
            }, 0);
        }
    },

    _scrollToHit(hit) {
        const tab = state.tabs[state.activeTabIndex];
        // Guard against the opened tab not matching the hit (shouldn't
        // normally happen — TabManager.open()/switch() always land on the
        // requested path — but a stray navigation mid-flight is cheap to
        // guard against).
        if (!tab || tab.path !== hit.path) return;

        if (tab.isMarp) {
            // Marp decks have no per-line source mapping in v1 (see the
            // plan doc's "共通基盤" note) — opening the deck is all we can
            // do; there is no slide-level line to jump to.
            return;
        }

        if (tab.fileType === 'markdown') {
            this._scrollToSourceLine(hit.line);
        } else if (typeof tab.raw === 'string') {
            this._scrollProportional(hit.line, tab.raw);
        }
    },

    _scrollToSourceLine(targetLine) {
        const candidates = elements.content.querySelectorAll('[data-source-line]');
        let best = null;
        let bestLine = -Infinity;
        candidates.forEach((el) => {
            const elLine = parseInt(el.dataset.sourceLine, 10);
            if (Number.isNaN(elLine) || elLine > targetLine) return;
            if (elLine > bestLine) {
                bestLine = elLine;
                best = el;
            }
        });
        // Some block types deliberately carry no data-source-line at all
        // (tight list items, bare <ul>/<table> wrappers — see
        // markdown.js's SOURCE_LINE_EXCLUDED_TYPES). If the hit line falls
        // inside one of those with nothing tagged at/before it, fall back
        // to the first tagged block so we still scroll somewhere.
        if (!best && candidates.length) best = candidates[0];
        if (best) this._flashElement(best);
    },

    _scrollProportional(targetLine, raw) {
        const totalLines = raw.split('\n').length;
        const ratio = totalLines > 1 ? (targetLine - 1) / (totalLines - 1) : 0;
        const maxScroll = Math.max(0, elements.content.scrollHeight - elements.content.clientHeight);
        elements.content.scrollTo({ top: maxScroll * ratio, behavior: 'smooth' });
        // No scrollIntoView here: elements.content IS the pane whose
        // internal scrollTop we just set above — scrolling the pane's own
        // position within the outer page would be meaningless (and could
        // fight the smooth-scroll we just started). Just flash it in place.
        this._flashPane(elements.content);
    },

    _flashElement(el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this._flashPane(el);
    },

    _flashPane(el) {
        el.classList.add('search-jump-flash');
        setTimeout(() => el.classList.remove('search-jump-flash'), SEARCH_JUMP_FLASH_MS);
    },

    init() {
        this._buildDom();
        if (elements.searchBoxToggle) {
            elements.searchBoxToggle.addEventListener('click', () => this.open());
        }
    }
};
