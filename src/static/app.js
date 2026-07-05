/**
 * MDV - Markdown Viewer Frontend
 * Modular application structure
 */
import './lib/presenterChannel.js';
import './lib/apiClient.js';
import './lib/saveQueue.js';
import './lib/tabRegistry.js';
import { state } from './modules/state.js';
import { elements } from './modules/dom.js';
import {
    saveScrollPosition,
    restoreScrollPosition,
    updateUrlPath
} from './modules/utils.js';
import { ThemeManager } from './modules/theme.js';
import { PdfStyleManager } from './modules/pdfStyle.js';
import { SidebarManager, ResizeHandler } from './modules/sidebar.js';
import { DialogManager } from './modules/dialog.js';
import { ShutdownManager } from './modules/shutdown.js';
import { FileTreeManager } from './modules/fileTree.js';
import { WebSocketManager } from './modules/websocket.js';
import { InlineNotesPanel } from './modules/inlineNotes.js';
import { PresenterView } from './modules/presenterView.js';
import { ContentRenderer } from './modules/contentRenderer.js';
import { TabManager } from './modules/tabs.js';
import { applyRenderedFile } from './modules/renderedFile.js';
import { EditorManager } from './modules/editor.js';
import { PrintManager } from './modules/print.js';
import { ContextMenuManager } from './modules/contextMenu.js';
import { DragDropManager } from './modules/dragDrop.js';
import { KeyboardManager } from './modules/keyboard.js';
import { SearchPalette } from './modules/searchPalette.js';
import { DiffReviewManager } from './modules/diffReview.js';
import { MDVApi } from './lib/apiClient.js';

// ============================================================
// Public API (Global Functions for onclick handlers)
// ============================================================

window.MDV = {
    openFile: (path) => TabManager.open(path),
    switchTab: (index) => TabManager.switch(index),
    closeTab: (index) => TabManager.close(index),
    loadMore: (element) => FileTreeManager.loadMore(element),
    toggleDirectory: async (element) => {
        const chevron = element.querySelector('.chevron');
        const children = element.nextElementSibling;
        const treeItem = element.closest('.tree-item');
        const path = treeItem.dataset.path;
        const isLoaded = treeItem.dataset.loaded === 'true';
        const isExpanding = children.classList.contains('collapsed');

        // 展開時に未読み込みならAPIで取得
        if (isExpanding && !isLoaded) {
            chevron.classList.add('loading');
            await FileTreeManager.expandDirectory(path, children);
            chevron.classList.remove('loading');
        }

        chevron.classList.toggle('expanded');
        children.classList.toggle('collapsed');

        // 展開時にURLを更新（ディレクトリは末尾に/）
        if (isExpanding) {
            updateUrlPath(path + '/');
        }
    }
};

// ============================================================
// Initialize Application
// ============================================================

const MEDIA_FILE_TYPES = ['image', 'pdf', 'video', 'audio', 'archive', 'office', 'executable', 'binary'];

async function refreshCurrentTab() {
    if (state.activeTabIndex < 0 || state.isEditMode) return;
    const tab = state.tabs[state.activeTabIndex];
    if (!tab || MEDIA_FILE_TYPES.includes(tab.fileType)) return;

    WebSocketManager.watchFile(tab.path);

    try {
        const response = await MDVApi.fetchFile(tab.path);
        const data = await response.json();
        // Compare by content hash, not rendered HTML: a source-only change
        // (equivalent markdown, whitespace) can render identically while
        // the raw text — and therefore the review baseline — moved
        // (codex round-8). etag is universal on text envelopes as of 0.6.4.
        // Hash comparison only when the envelope HAS a hash — html previews
        // (and any future non-text type) carry no etag, and undefined !==
        // null would otherwise force a spurious re-render through the wrong
        // renderer on every focus (codex round-10).
        const changed = data.content
            && ((data.etag && data.etag !== tab.etag) || data.content !== tab.content);
        if (changed) {
            // Full rendered-file contract via the SSOT helper — hand-copying
            // only content/raw left tab.etag stale, which tricked
            // DiffReviewManager's fast path into hiding a real change
            // (codex round-6).
            applyRenderedFile(tab, data);
            const currentScroll = saveScrollPosition(elements.content);
            if (tab.isMarp) {
                // Marp decks must repaint through the Marp renderer — the
                // generic render() would replace the split/notes/navigation
                // UI with plain HTML (codex round-9). Same call the WS
                // file_update path uses — including notifying an open
                // presenter window, which otherwise kept the old slides
                // when the change arrived via this path (codex round-14).
                ContentRenderer.renderMarp(data.content, tab.css);
                PresenterView.broadcastSlides();
            } else {
                ContentRenderer.render(data.content, data.fileType || tab.fileType);
            }
            restoreScrollPosition(elements.content, currentScroll);
            // This render path bypasses the renderActive() wrapper and the
            // WS onFileRendered seam — refresh the diff bar here too or a
            // focus/reconnect repaint leaves it stale (codex round-2).
            DiffReviewManager.refresh();
        } else {
            // Even with nothing to repaint, run the diff refresh: after a
            // server restart the fast path must get its chance to re-seed
            // the (now empty) journal with this baseline (codex round-16).
            DiffReviewManager.refresh();
        }
    } catch (e) {
        console.error('Failed to refresh tab:', e);
    }
}

async function init() {
    // Wire forward references broken by ESM extraction: theme.js
    // and pdfStyle.js were pulled out of this file in Stage 3b,
    // but they still need to trigger a re-render via TabManager
    // (which moved to modules/tabs.js in Stage 3e). Instead of an
    // import cycle, each module exposes a setRenderActive(fn) setter that
    // we call once here. See modules/theme.js docstring.
    ThemeManager.setRenderActive(() => TabManager.renderActive());
    PdfStyleManager.setRenderActive(() => TabManager.renderActive());

    // websocket.js was pulled out of this file in Stage 3c but still
    // needs to call into ContentRenderer/InlineNotesPanel/PresenterView
    // (the Marp cluster — extracted to modules/ in Stage 3d, but
    // websocket.js keeps taking them via setter injection rather than
    // importing them directly, since it doesn't otherwise depend on
    // the cluster) and refreshCurrentTab (defined above, staying here
    // since it's a bootstrap-level helper). Same setter pattern as above.
    // See modules/websocket.js docstring.
    WebSocketManager.setContentRenderer(ContentRenderer);
    WebSocketManager.setInlineNotesPanel(InlineNotesPanel);
    WebSocketManager.setPresenterView(PresenterView);
    WebSocketManager.setRefreshCurrentTab(() => {
        // A reconnect may mean the server (and its in-memory change
        // journal) restarted — drop the client's seed suppressions so
        // baselines get re-recorded (codex round-16).
        DiffReviewManager.resetSeeds();
        return refreshCurrentTab();
    });
    // 0.6.4 (diff review): re-run the active tab's baseline-diff check
    // after a live file_update actually repaints the content pane — see
    // modules/websocket.js's docstring.
    WebSocketManager.setOnFileRendered(() => DiffReviewManager.refresh());
    DiffReviewManager.setRequestTabRefresh(() => refreshCurrentTab());

    // modules/diffReview.js needs to react to every tab activation (open/
    // switch/close-then-reselect) and to the theme/PDF-style re-renders
    // that also funnel through TabManager.renderActive() (see editor.js's
    // hide() and the ThemeManager/PdfStyleManager wiring above) — but
    // tabs.js is out of this feature's file scope, so rather than add a
    // setter inside it, wrap the one method every content re-render already
    // goes through. This is the same forward-reference idea as
    // ThemeManager.setRenderActive() above, applied from the opposite
    // direction (the reactor wraps the trigger instead of the trigger
    // taking a setter), since tabs.js has no reason to import or know about
    // diff review. Must happen before anything can call renderActive() —
    // first possible call is inside TabManager.open() further down.
    const originalRenderActive = TabManager.renderActive.bind(TabManager);
    TabManager.renderActive = function () {
        originalRenderActive();
        DiffReviewManager.refresh();
    };
    // Closing the LAST tab takes ContentRenderer.showWelcome() without
    // ever calling renderActive(), which would leave a stale diff bar
    // above the welcome view (codex) — wrap that exit path too.
    const originalShowWelcome = ContentRenderer.showWelcome.bind(ContentRenderer);
    ContentRenderer.showWelcome = function () {
        originalShowWelcome();
        DiffReviewManager.refresh();
    };
    // Entering edit mode swaps the pane to a textarea WITHOUT passing
    // through renderActive() — refresh here too so the bar hides while
    // editing (leaving it mounted invites confirming a pre-edit hash).
    const originalEditorShow = EditorManager.show.bind(EditorManager);
    EditorManager.show = function (...args) {
        const out = originalEditorShow(...args);
        DiffReviewManager.refresh();
        return out;
    };

    // Initialize all managers
    ThemeManager.init();
    PdfStyleManager.init();
    SidebarManager.init();
    ResizeHandler.init();
    EditorManager.init();
    PrintManager.init();
    ShutdownManager.init();
    DialogManager.init();
    ContextMenuManager.init();
    DragDropManager.init();
    SearchPalette.init();
    DiffReviewManager.init();
    KeyboardManager.init();
    PresenterView.init();

    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (state.isEditMode && state.hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
    TabManager.render();

    try {
        const infoResponse = await MDVApi.fetchInfo();
        const info = await infoResponse.json();
        state.rootPath = info.rootPath;
        // mdv.config.json の css/pdfOptions を Style パネルの初期値に
        // （ユーザーがパネルで設定済みなら何もしない）。
        PdfStyleManager.applyConfigDefaults(info.pdfStyleDefaults);
    } catch (e) {
        console.error('Failed to fetch server info:', e);
    }

    await FileTreeManager.load();
    WebSocketManager.connect();

    // Refresh content when window regains focus
    const handleFocusChange = () => refreshCurrentTab();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') handleFocusChange();
    });
    window.addEventListener('focus', handleFocusChange);

    // パスベースURL: /README.md → path = "README.md"
    // ?path= も後方互換で対応
    let initialPath = decodeURIComponent(window.location.pathname).replace(/^\//, '');
    if (!initialPath) {
        initialPath = new URLSearchParams(window.location.search).get('path') || '';
    }
    if (initialPath) {
        const isDirectoryPath = initialPath.endsWith('/');
        const cleanPath = isDirectoryPath ? initialPath.slice(0, -1) : initialPath;

        await FileTreeManager.expandToPath(cleanPath);

        if (!isDirectoryPath) {
            await TabManager.open(cleanPath);
        }
    }

    // Markdown内リンクのクリックをインターセプト
    elements.content.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (!link) return;

        const href = link.getAttribute('href');
        if (!href) return;

        // 外部リンク・非HTTPスキーム・アンカーはブラウザに任せる
        if (href.startsWith('#') || href.startsWith('http') || href.startsWith('//') ||
            /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return;

        e.preventDefault();

        // フラグメントを保持しつつパスを取り出す
        const hashIndex = href.indexOf('#');
        const fragment = hashIndex >= 0 ? href.slice(hashIndex + 1) : '';
        const urlPath = (hashIndex >= 0 ? href.slice(0, hashIndex) : href).split('?')[0];
        const decoded = decodeURIComponent(urlPath);

        // 相対パスを現在のファイルパスから解決
        let targetPath;
        if (!decoded.startsWith('/')) {
            const currentTab = state.tabs[state.activeTabIndex];
            const currentDir = currentTab ? currentTab.path.replace(/[^/]*$/, '') : '';
            targetPath = currentDir + decoded;
        } else {
            targetPath = decoded.replace(/^\//, '');
        }

        // 末尾スラッシュ（ディレクトリ）を保持
        const isDirectory = targetPath.endsWith('/');

        // パス正規化（foo/../bar → bar）
        const parts = targetPath.split('/');
        const resolved = [];
        for (const part of parts) {
            if (part === '..') resolved.pop();
            else if (part !== '.' && part !== '') resolved.push(part);
        }
        targetPath = resolved.join('/');

        if (isDirectory) {
            // ディレクトリはツリーを展開
            FileTreeManager.expandToPath(targetPath);
            updateUrlPath(targetPath + '/');
        } else {
            TabManager.open(targetPath).then(() => {
                // フラグメントがあればアンカーにスクロール
                if (fragment) {
                    const decodedFragment = decodeURIComponent(fragment);
                    // id一致 → heading textContent一致 の順で検索
                    const target = elements.content.querySelector(`#${CSS.escape(decodedFragment)}`) ||
                        Array.from(elements.content.querySelectorAll('h1, h2, h3, h4, h5, h6'))
                            .find(h => h.textContent.trim().toLowerCase() === decodedFragment.toLowerCase());
                    if (target) target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        }
    });
}

// DOMContentLoadedを待ってから初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
