/**
 * MDV - File Tree Manager
 * Pure move from app.js (Stage 3c). No logic changes.
 * No forward references: every dependency (state, elements, escapeHtml,
 * getFileIcon, MDVApi) is already an extracted module or lib by this
 * stage, so unlike websocket.js this manager needs no DI wiring.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { escapeHtml, getFileIcon } from './utils.js';
import { MDVApi } from '../lib/apiClient.js';

export const FileTreeManager = {
        async load(retries = 5) {
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await MDVApi.fetchTree();
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const tree = await response.json();
                    elements.fileTree.innerHTML = this.renderItems(tree);
                    return;
                } catch (e) {
                    console.warn(`Failed to load tree (attempt ${i + 1}/${retries}):`, e);
                    if (i < retries - 1) {
                        await new Promise(r => setTimeout(r, 300 + 400 * i)); // 300, 700, 1100, 1500ms
                    }
                }
            }
            // 最後の手段: ページに再読み込みボタンを表示
            elements.fileTree.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">読み込みに失敗しました。<br><button onclick="location.reload()" style="margin-top: 8px; cursor: pointer;">再読み込み</button></div>';
        },

        // --- tree refresh coalescing --------------------------------------
        // A burst of tree_update frames (a bulk FS operation emits hundreds)
        // must collapse into a single tree refresh. Refreshing once per frame
        // tears down and rebuilds the whole tree repeatedly and freezes the
        // tab. We also never run two refreshes concurrently: the old code did
        // `await refresh()` per ws message, so overlapping fetches could let a
        // stale response overwrite a newer tree. `_refreshInFlight` serializes
        // them; `_refreshDirty` runs exactly one more pass for events that
        // arrived mid-flight.
        _refreshTimer: null,
        _refreshInFlight: false,
        _refreshDirty: false,

        scheduleRefresh() {
            if (this._refreshInFlight) {
                // A refresh is running; remember to re-run once after it ends.
                this._refreshDirty = true;
                return;
            }
            if (this._refreshTimer) return; // burst already scheduled
            this._refreshTimer = setTimeout(() => {
                this._refreshTimer = null;
                this.refresh();
            }, 50);
        },

        async refresh() {
            if (this._refreshInFlight) {
                this._refreshDirty = true;
                return;
            }
            this._refreshInFlight = true;
            try {
                const response = await MDVApi.fetchTree();
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const tree = await response.json();
                await this.update(tree);
            } catch (e) {
                console.error('Failed to refresh tree:', e);
            } finally {
                this._refreshInFlight = false;
                if (this._refreshDirty) {
                    this._refreshDirty = false;
                    this.scheduleRefresh();
                }
            }
        },

        async update(tree) {
            // Keyed, in-place reconcile instead of an innerHTML teardown. The
            // old code rebuilt the whole tree on every external change, which
            // (a) flickered, (b) lost scroll position, and (c) collapsed any
            // folder deeper than the lookahead because those nodes were not in
            // the rebuilt DOM. Reconciling by path key preserves scroll,
            // selection, and already-expanded subtrees, and only touches nodes
            // that actually changed.
            const treeEl = elements.fileTree;
            const prevScroll = treeEl.scrollTop;

            // `tree` is the first capped page of the root. If the user paged the
            // root past it ("load more"), refetch the full shown range so
            // reconcile keeps AND refreshes those extra rows rather than pruning
            // them or going stale.
            const rootCapped = tree.length > 0 && tree[tree.length - 1].type === 'more';
            const rootRows = this.countItemRows(treeEl);
            const rootList = (rootCapped && rootRows > tree.length - 1)
                ? await this.fetchChildrenUpTo('', rootRows)
                : tree;
            this.reconcile(treeEl, rootList);

            // `/api/tree` only carries the top level, so every directory whose
            // children have been loaded must be refreshed explicitly to pick up
            // changes. Done in parallel and reconciled in place (keeps each
            // folder's expansion state).
            await this.refreshLoaded();

            treeEl.scrollTop = prevScroll;
            this.updateHighlight();
        },

        nodeKey(el) {
            if (el.classList && el.classList.contains('tree-item')) {
                // Include kind so a file and a directory at the same path get
                // different keys: if an entry is replaced by one of the other
                // kind, reconcile treats it as remove+add and rebuilds correct
                // markup instead of reusing a node that can't toggle kind.
                const kind = el.querySelector(':scope > .tree-children') ? 'd' : 'f';
                return 'item:' + kind + ':' + el.dataset.path;
            }
            if (el.classList && el.classList.contains('tree-more')) return 'more:' + (el.dataset.dir || '');
            return null;
        },

        itemKey(item) {
            if (item.type === 'more') return 'more:' + (item.path || '');
            const kind = item.type === 'directory' ? 'd' : 'f';
            return 'item:' + kind + ':' + item.path;
        },

        // Reconcile `container`'s direct children against `items` by path key:
        // reuse matching nodes (preserving their subtrees), create new ones,
        // remove deleted ones, and fix ordering — without tearing the list down.
        reconcile(container, items) {
            const list = Array.isArray(items) ? items : [];

            // Callers always pass a list covering at least the rows currently
            // shown (paged directories are refetched in full via
            // fetchChildrenUpTo before reconciling), so the keyed diff below can
            // prune freely without dropping load-more'd rows.
            const existing = new Map();
            for (const el of Array.from(container.children)) {
                const key = this.nodeKey(el);
                if (key) existing.set(key, el);
            }

            const used = new Set();
            let prev = null;
            for (const item of list) {
                const key = this.itemKey(item);
                let el = existing.get(key);
                if (el && !used.has(key)) {
                    this.updateNode(el, item);
                } else {
                    el = this.createNode(item);
                }
                used.add(key);

                const desiredNext = prev ? prev.nextSibling : container.firstChild;
                if (el !== desiredNext) {
                    container.insertBefore(el, desiredNext);
                }
                prev = el;
            }

            for (const [key, el] of existing) {
                if (!used.has(key)) el.remove();
            }
        },

        updateNode(el, item) {
            if (item.type === 'directory') {
                // Only refresh the child level when the new data carries it
                // (loaded:true). When it doesn't (loaded:false), leave the
                // existing — possibly deeper-expanded — subtree untouched and
                // never downgrade an already-loaded directory.
                if (item.loaded === true) {
                    el.dataset.loaded = 'true';
                    const childrenBox = el.querySelector(':scope > .tree-children');
                    if (childrenBox) this.reconcile(childrenBox, item.children || []);
                }
            } else if (item.type === 'more') {
                el.dataset.offset = item.offset;
                el.dataset.total = item.total;
                const name = el.querySelector('.name');
                if (name) {
                    const remaining = item.remaining != null ? item.remaining : (item.total - item.offset);
                    name.textContent = `… 残り ${remaining} 件を表示`;
                }
            }
            // files: name/icon are keyed by path, so a rename is add + remove
        },

        createNode(item) {
            const html = item.type === 'directory' ? this.renderDirectory(item)
                : item.type === 'more' ? this.renderMore(item)
                : this.renderFile(item);
            const tmp = document.createElement('div');
            tmp.innerHTML = html.trim();
            return tmp.firstElementChild;
        },

        countItemRows(container) {
            let n = 0;
            for (const el of container.children) {
                if (el.classList && el.classList.contains('tree-item')) n++;
            }
            return n;
        },

        // Fetch a directory's children up to at least `minCount` rows, paging
        // through /api/tree/page. Used to refresh a directory the user has
        // "load more"d past the cap: re-read exactly what is currently shown
        // (plus a trailing "more" row if further entries remain) so reconcile
        // can apply adds/deletes without dropping the loaded rows. For a normal
        // (<= one page) directory this is a single request. `dirPath` is '' for
        // the root.
        async fetchChildrenUpTo(dirPath, minCount) {
            let items = [];
            let offset = 0;
            // Bounded as a safety net; each page advances the offset.
            for (let guard = 0; guard < 1000; guard++) {
                const response = await MDVApi.pageTree(dirPath, offset);
                if (!response.ok) break;
                const page = await response.json();
                let more = null;
                if (page.length && page[page.length - 1].type === 'more') {
                    more = page.pop();
                }
                items = items.concat(page);
                if (!more) return items;             // directory fully read
                if (items.length >= minCount) {       // covered what is shown
                    items.push(more);                 // keep the "load more" row
                    return items;
                }
                offset = more.offset;
            }
            return items;
        },

        // Refresh every directory whose children have been loaded — expanded or
        // collapsed. A collapsed-but-loaded folder still holds cached rows in
        // the DOM; without refetching it here, a file added or removed inside it
        // stays stale until reload (the top-level payload no longer carries a
        // lookahead that refreshed those folders for free). reconcile keeps each
        // folder's expanded descendants intact.
        async refreshLoaded() {
            const loaded = [];
            document.querySelectorAll('.tree-item').forEach(item => {
                const box = item.querySelector(':scope > .tree-children');
                if (item.dataset.loaded === 'true' && box) {
                    loaded.push({ path: item.dataset.path, count: this.countItemRows(box) });
                }
            });

            await Promise.all(loaded.map(async ({ path: dirPath, count }) => {
                try {
                    // Re-read exactly what is shown (paging if it was load-more'd)
                    // so reconcile refreshes the directory without dropping rows.
                    const children = await this.fetchChildrenUpTo(dirPath, count);
                    const item = document.querySelector(`.tree-item[data-path="${CSS.escape(dirPath)}"]`);
                    const box = item && item.querySelector(':scope > .tree-children');
                    if (box) this.reconcile(box, children);
                } catch (e) {
                    // best-effort refresh of one loaded directory; ignore
                }
            }));
        },

        renderItems(items) {
            if (!items || items.length === 0) return '';

            return items.map(item => {
                if (item.type === 'directory') return this.renderDirectory(item);
                if (item.type === 'more') return this.renderMore(item);
                return this.renderFile(item);
            }).join('');
        },

        // "Load more" row shown when a directory has more children than the
        // per-directory cap. Clicking it fetches the next page and splices the
        // rows in. Not a .tree-item, so it never matches the file-open / drag /
        // context-menu delegation.
        renderMore(item) {
            const remaining = item.remaining != null ? item.remaining : (item.total - item.offset);
            const safeDir = escapeHtml(item.path || '');
            return `
                <div class="tree-more" data-dir="${safeDir}" data-offset="${item.offset}" data-total="${item.total}" onclick="MDV.loadMore(this)">
                    <span class="name">… 残り ${remaining} 件を表示</span>
                </div>
            `;
        },

        async loadMore(el) {
            if (el.classList.contains('loading')) return;
            el.classList.add('loading');
            const dir = el.dataset.dir || '';
            const offset = parseInt(el.dataset.offset, 10) || 0;
            try {
                const response = await MDVApi.pageTree(dir, offset);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const items = await response.json();
                // Splice the new rows in before this node, then drop it. The
                // page response carries its own trailing "more" row if needed.
                el.insertAdjacentHTML('beforebegin', this.renderItems(items));
                el.remove();
            } catch (e) {
                console.error('Failed to load more:', e);
                el.classList.remove('loading');
            }
        },

        renderDirectory(item) {
            const loaded = item.loaded !== false;
            const safePath = escapeHtml(item.path);
            const safeName = escapeHtml(item.name);
            return `
                <div class="tree-item" data-path="${safePath}" data-loaded="${loaded}" draggable="true">
                    <div class="tree-item-content" onclick="MDV.toggleDirectory(this)">
                        <svg class="chevron" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span class="name">${safeName}</span>
                    </div>
                    <div class="tree-children collapsed">${this.renderItems(item.children)}</div>
                </div>
            `;
        },

        async expandDirectory(path, childrenContainer) {
            try {
                const response = await MDVApi.expandTree(path);
                const children = await response.json();
                childrenContainer.innerHTML = this.renderItems(children);

                // 親要素をloaded=trueに更新
                const treeItem = childrenContainer.closest('.tree-item');
                if (treeItem) {
                    treeItem.dataset.loaded = 'true';
                }
            } catch (e) {
                console.error('Failed to expand directory:', e);
            }
        },

        // Page a directory's listing until `targetPath` appears, so URL/link
        // navigation can reveal an entry that sorts past the per-directory cap.
        // The parent must already be loaded (expandToPath processes parents
        // first). Returns the node, or null if it genuinely isn't there.
        async revealInParent(targetPath) {
            const slash = targetPath.lastIndexOf('/');
            const parentPath = slash >= 0 ? targetPath.slice(0, slash) : '';
            const container = parentPath
                ? document.querySelector(`.tree-item[data-path="${CSS.escape(parentPath)}"] > .tree-children`)
                : elements.fileTree;
            if (!container) return null;

            const sel = `:scope > .tree-item[data-path="${CSS.escape(targetPath)}"]`;
            for (let guard = 0; guard < 1000; guard++) {
                const found = container.querySelector(sel);
                if (found) return found;
                const more = container.querySelector(':scope > .tree-more');
                if (!more) return null; // listing exhausted; target not present
                const offsetBefore = more.dataset.offset;
                await this.loadMore(more);
                const moreAfter = container.querySelector(':scope > .tree-more');
                if (moreAfter && moreAfter.dataset.offset === offsetBefore) return null; // no progress
            }
            return null;
        },

        async expandToPath(filePath) {
            // パスを分割して順番に展開
            const parts = filePath.split('/');

            let currentPath = '';
            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}/${part}` : part;

                let item = document.querySelector(`.tree-item[data-path="${CSS.escape(currentPath)}"]`);
                if (!item) {
                    // The node may sort past its parent's per-directory cap and
                    // not be rendered yet. Page the parent in until it appears.
                    item = await this.revealInParent(currentPath);
                }
                if (!item) continue;

                const children = item.querySelector('.tree-children');
                const chevron = item.querySelector('.chevron');

                // ディレクトリの場合のみ展開
                if (children && children.classList.contains('collapsed')) {
                    // 未読み込みの場合は子要素を取得
                    if (item.dataset.loaded !== 'true') {
                        await this.expandDirectory(currentPath, children);
                    }
                    children.classList.remove('collapsed');
                    if (chevron) chevron.classList.add('expanded');
                }
            }

            // ファイルをハイライト
            this.updateHighlight();
        },

        renderFile(item) {
            const iconClass = item.icon ? `icon-${item.icon}` : '';
            const iconSvg = getFileIcon(item.icon);
            const safePath = escapeHtml(item.path);
            const safeName = escapeHtml(item.name);
            return `
                <div class="tree-item" data-path="${safePath}" draggable="true">
                    <div class="tree-item-content" data-action="open">
                        <span class="${iconClass}" style="margin-left: 22px; display: flex; align-items: center;">
                            ${iconSvg}
                        </span>
                        <span class="name">${safeName}</span>
                    </div>
                </div>
            `;
        },

        updateHighlight() {
            document.querySelectorAll('.tree-item-content.active').forEach(el => {
                el.classList.remove('active');
            });
            if (state.activeTabIndex >= 0) {
                const path = state.tabs[state.activeTabIndex].path;
                const el = document.querySelector(`.tree-item[data-path="${CSS.escape(path)}"] > .tree-item-content`);
                if (el) el.classList.add('active');
            }
        }
};
