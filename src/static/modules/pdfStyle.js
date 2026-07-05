/**
 * MDV - PDF Style Preview
 * Pure move from app.js (Stage 3b). No logic changes.
 *
 * Forward-reference pattern: see theme.js for the rationale. Two call
 * sites here (applyFromInputs, clear) need to re-render the active tab via
 * TabManager.renderActive(), which still lives in the app.js monolith at
 * this stage. Wired the same way as ThemeManager via `setRenderActive(fn)`.
 */
import { STORAGE_KEYS } from './constants.js';
import { state } from './state.js';
import { elements } from './dom.js';
import { normalizeUserPath } from './utils.js';
import { MDVApi } from '../lib/apiClient.js';

export const PdfStyleManager = {
    scopedCssId: 'pdf-style-preview-css',
    _renderActive: null,

    // Called once from app.js at bootstrap to wire the forward reference
    // into TabManager.renderActive() (still defined in app.js).
    setRenderActive(fn) {
        this._renderActive = fn;
    },

    init() {
        elements.pdfStylePath.value = state.pdfStylePath;
        elements.pdfOptionsPath.value = state.pdfOptionsPath;
        elements.pdfStyleToggle.addEventListener('click', () => {
            elements.pdfStylePanel.classList.toggle('hidden');
        });
        elements.pdfStyleApply.addEventListener('click', () => this.applyFromInputs());
        elements.pdfStyleClear.addEventListener('click', () => this.clear());
        elements.pdfStylePath.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') this.applyFromInputs();
        });
        elements.pdfOptionsPath.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') this.applyFromInputs();
        });
        this.loadPreviewCss();
    },

    /**
     * mdv.config.json 由来の初期値（/api/info の pdfStyleDefaults、rootDir
     * 相対パス）を適用する。ユーザーがパネルで明示設定した値（localStorage）
     * が既にあればそちらを優先し、何もしない。localStorage には書かない —
     * config を変えれば次回起動時にそのまま追従する。
     * @param {{ css?: string, pdfOptions?: string }} defaults
     */
    applyConfigDefaults(defaults) {
        if (!defaults) return;
        const hasStored = localStorage.getItem(STORAGE_KEYS.PDF_STYLE_PATH) !== null
            || localStorage.getItem(STORAGE_KEYS.PDF_OPTIONS_PATH) !== null;
        if (hasStored) return;

        let changed = false;
        if (defaults.css && !state.pdfStylePath) {
            state.pdfStylePath = normalizeUserPath(defaults.css);
            elements.pdfStylePath.value = state.pdfStylePath;
            changed = true;
        }
        if (defaults.pdfOptions && !state.pdfOptionsPath) {
            state.pdfOptionsPath = normalizeUserPath(defaults.pdfOptions);
            elements.pdfOptionsPath.value = state.pdfOptionsPath;
            changed = true;
        }
        if (changed) {
            this.loadPreviewCss();
            if (this._renderActive) this._renderActive();
        }
    },

    // PDF dispatch 切替: PDF options JSON が指定されている時だけサーバー
    // md-to-pdf を使う。CSS のみ (or 何もなし) の場合は印刷ダイアログ経由
    // で OS のページ設定を活かしつつ、preview に当たっている CSS が
    // そのまま print engine に渡って styled PDF が出る。
    shouldUseServerPdf() {
        return !!normalizeUserPath(state.pdfOptionsPath);
    },

    getExportOptions() {
        return {
            stylePath: normalizeUserPath(state.pdfStylePath),
            pdfOptionsPath: normalizeUserPath(state.pdfOptionsPath)
        };
    },

    async applyFromInputs() {
        state.pdfStylePath = normalizeUserPath(elements.pdfStylePath.value);
        state.pdfOptionsPath = normalizeUserPath(elements.pdfOptionsPath.value);
        elements.pdfStylePath.value = state.pdfStylePath;
        elements.pdfOptionsPath.value = state.pdfOptionsPath;
        localStorage.setItem(STORAGE_KEYS.PDF_STYLE_PATH, state.pdfStylePath);
        localStorage.setItem(STORAGE_KEYS.PDF_OPTIONS_PATH, state.pdfOptionsPath);
        await this.loadPreviewCss();
        if (this._renderActive) this._renderActive();
    },

    clear() {
        state.pdfStylePath = '';
        state.pdfOptionsPath = '';
        elements.pdfStylePath.value = '';
        elements.pdfOptionsPath.value = '';
        localStorage.removeItem(STORAGE_KEYS.PDF_STYLE_PATH);
        localStorage.removeItem(STORAGE_KEYS.PDF_OPTIONS_PATH);
        const oldStyle = document.getElementById(this.scopedCssId);
        if (oldStyle) oldStyle.remove();
        if (this._renderActive) this._renderActive();
        elements.statusText.textContent = 'PDF style cleared';
        setTimeout(() => { elements.statusText.textContent = 'Connected'; }, 1600);
    },

    async loadPreviewCss() {
        const oldStyle = document.getElementById(this.scopedCssId);
        if (oldStyle) oldStyle.remove();
        if (!state.pdfStylePath) return;

        try {
            const response = await MDVApi.fetchRawCss(state.pdfStylePath);
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`CSS not found: ${state.pdfStylePath}`);
                }
                throw new Error(`CSS load error (HTTP ${response.status}): ${state.pdfStylePath}`);
            }
            const cssText = await response.text();
            const style = document.createElement('style');
            style.id = this.scopedCssId;
            style.textContent = this.scopeCss(cssText);
            document.head.appendChild(style);
            elements.statusText.textContent = 'PDF style applied';
            setTimeout(() => { elements.statusText.textContent = 'Connected'; }, 1600);
        } catch (error) {
            console.error('PDF style preview error:', error);
            // エラー詳細を status に出す (Claude Code 連携時の自己解決を助ける)
            const detail = (error.message || 'unknown error').slice(0, 100);
            elements.statusText.textContent = `Style failed: ${detail}`;
            setTimeout(() => { elements.statusText.textContent = 'Connected'; }, 4500);
        }
    },

    scopeCss(cssText) {
        const scope = '.markdown-body.pdf-style-preview';
        const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
        return withoutComments.replace(/([^{}]+)\{/g, (match, selectorText) => {
            const selectors = selectorText.trim();
            if (!selectors || selectors.startsWith('@')) return match;
            const scopedSelectors = selectors.split(',').map((selector) => {
                const trimmed = selector.trim();
                if (trimmed === ':root' || trimmed === 'body') return scope;
                if (trimmed.startsWith(scope)) return trimmed;
                return `${scope} ${trimmed}`;
            });
            return `${scopedSelectors.join(', ')} {`;
        });
    }
};
