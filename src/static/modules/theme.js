/**
 * MDV - Theme Management
 * Pure move from app.js (Stage 3b). No logic changes.
 *
 * Forward-reference pattern (documented once here; stages 3c-3e replicate
 * it for their own not-yet-extracted call targets): ThemeManager.toggle()
 * needs to re-render the active tab, but TabManager still lives in the
 * app.js monolith at this stage. Rather than import app.js (a cycle) or
 * reach for a global, this module exposes a `setRenderActive(fn)` setter.
 * app.js calls it once at bootstrap (before any user interaction can reach
 * toggle()) with `() => TabManager.renderActive()`. The manager itself
 * stays a plain object with no hidden globals.
 */
import { STORAGE_KEYS, HLJS_THEMES, MERMAID_THEMES } from './constants.js';
import { state } from './state.js';
import { elements } from './dom.js';
import { saveScrollPosition, restoreScrollPosition } from './utils.js';

export const ThemeManager = {
    _renderActive: null,

    // Called once from app.js at bootstrap to wire the forward reference
    // into TabManager.renderActive() (still defined in app.js).
    setRenderActive(fn) {
        this._renderActive = fn;
    },

    set(theme) {
        state.theme = theme;
        document.documentElement.dataset.theme = theme;
        document.body.dataset.theme = theme;
        localStorage.setItem(STORAGE_KEYS.THEME, theme);

        const isLight = theme === 'light';
        elements.sunIcon.style.display = isLight ? 'none' : 'block';
        elements.moonIcon.style.display = isLight ? 'block' : 'none';
        elements.hljsTheme.href = HLJS_THEMES[theme];

        const mermaidConfig = MERMAID_THEMES[theme];
        mermaid.initialize({
            startOnLoad: false,
            theme: mermaidConfig.theme,
            themeVariables: mermaidConfig.variables
        });
    },

    toggle() {
        this.set(state.theme === 'dark' ? 'light' : 'dark');
        if (state.activeTabIndex >= 0) {
            const currentScroll = saveScrollPosition(elements.content);
            if (this._renderActive) this._renderActive();
            restoreScrollPosition(elements.content, currentScroll);
        }
    },

    init() {
        this.set(state.theme);
        elements.themeToggle.addEventListener('click', () => this.toggle());
    }
};
