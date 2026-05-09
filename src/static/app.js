/**
 * MDV - Markdown Viewer Frontend
 * Modular application structure
 */
(function() {
    'use strict';

    // ============================================================
    // Constants
    // ============================================================

    const STORAGE_KEYS = {
        THEME: 'mdv-theme',
        SIDEBAR_WIDTH: 'mdv-sidebar-width',
        PDF_STYLE_PATH: 'mdv-pdf-style-path',
        PDF_OPTIONS_PATH: 'mdv-pdf-options-path'
    };

    const HLJS_THEMES = {
        light: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css',
        dark: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
    };

    const MERMAID_THEMES = {
        light: {
            theme: 'default',
            variables: {
                primaryColor: '#0066cc',
                primaryTextColor: '#1a1a1a',
                primaryBorderColor: '#d0d0d0',
                lineColor: '#6a6a6a',
                secondaryColor: '#e8e8e8',
                tertiaryColor: '#f5f5f5'
            }
        },
        dark: {
            theme: 'dark',
            variables: {
                primaryColor: '#89b4fa',
                primaryTextColor: '#cdd6f4',
                primaryBorderColor: '#45475a',
                lineColor: '#6c7086',
                secondaryColor: '#313244',
                tertiaryColor: '#181825'
            }
        }
    };

    const FILE_ICONS = {
        markdown: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>',
        python: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 5.5 2.875 5.5 2.875v2.5h6.5v.75H3.857S0 5.5 0 12s3.357 6.375 3.357 6.375h2.143v-3.063s-.125-3.312 3.25-3.312h5.5s3.25.063 3.25-3.125v-4.75S18 0 12 0zm-2.5 1.688a.937.937 0 110 1.874.937.937 0 010-1.874z"/></svg>',
        javascript: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.405-.6-.586-.78-.63-.705-1.47-1.065-2.834-1.035l-.705.09c-.676.165-1.32.525-1.71 1.005-1.14 1.29-.81 3.54.6 4.47 1.394.935 3.434 1.14 3.69 2.025.255 1.05-.6 1.39-1.365 1.26-.9-.165-1.395-.75-1.935-1.71l-1.815.99c.21.6.555 1.035.885 1.365.885.885 2.07 1.185 3.305 1.125 1.38-.165 2.73-.735 3.09-2.355.165-.555.165-1.095.015-1.755l-.06.075z"/></svg>',
        typescript: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 12v12h24V0H0v12zm19.341-.956c.61.152 1.074.423 1.501.865.221.236.549.666.575.77.008.03-1.036.73-1.668 1.123-.023.015-.115-.084-.217-.236-.31-.45-.633-.644-1.128-.678-.728-.05-1.196.331-1.192.967a.88.88 0 00.102.45c.16.331.458.53 1.39.933 1.719.74 2.454 1.227 2.911 1.92.51.773.625 2.008.278 2.926-.38 1.003-1.328 1.685-2.655 1.907-.411.073-1.386.062-1.828-.018-.964-.172-1.878-.648-2.442-1.273-.221-.243-.652-.88-.625-.925.011-.016.11-.077.22-.141.108-.061.511-.294.892-.515l.69-.4.145.214c.202.308.643.731.91.872.767.404 1.82.347 2.335-.118a.883.883 0 00.313-.72c0-.278-.035-.4-.18-.61-.186-.266-.567-.49-1.649-.96-1.238-.533-1.771-.864-2.259-1.39a3.165 3.165 0 01-.659-1.2c-.091-.339-.114-1.189-.042-1.531.255-1.2 1.158-2.031 2.461-2.278.423-.08 1.406-.05 1.821.053zm-5.634 1.002l.008.983H10.59v8.876H8.38v-8.876H5.258v-.964c0-.534.011-.98.026-.99.012-.016 1.913-.024 4.217-.02l4.195.012z"/></svg>',
        json: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>',
        yaml: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>',
        html: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>',
        css: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>',
        image: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>',
        pdf: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>',
        text: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>',
        config: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>',
        shell: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>',
        database: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>',
        react: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.11c1.03 0 1.87.84 1.87 1.89 0 1-.84 1.85-1.87 1.85S10.13 13 10.13 12c0-1.05.84-1.89 1.87-1.89M7.37 20c.63.38 2.01-.2 3.6-1.7-.52-.59-1.03-1.23-1.51-1.9a22.7 22.7 0 01-2.4-.36c-.51 2.14-.32 3.61.31 3.96m.71-5.74l-.29-.51c-.11.29-.22.58-.29.86.27.06.57.11.88.16l-.3-.51m6.54-.76l.81-1.5-.81-1.5c-.3-.53-.62-1-.91-1.47C13.17 9 12.6 9 12 9s-1.17 0-1.71.03c-.29.47-.61.94-.91 1.47L8.57 12l.81 1.5c.3.53.62 1 .91 1.47.54.03 1.11.03 1.71.03s1.17 0 1.71-.03c.29-.47.61-.94.91-1.47M12 6.78c-.19.22-.39.45-.59.72h1.18c-.2-.27-.4-.5-.59-.72m0 10.44c.19-.22.39-.45.59-.72h-1.18c.2.27.4.5.59.72M16.62 4c-.62-.38-2 .2-3.59 1.7.52.59 1.03 1.23 1.51 1.9.82.08 1.63.2 2.4.36.51-2.14.32-3.61-.32-3.96m-.7 5.74l.29.51c.11-.29.22-.58.29-.86-.27-.06-.57-.11-.88-.16l.3.51m1.45-7.05c1.47.84 1.63 3.05 1.01 5.63 2.54.75 4.37 1.99 4.37 3.68 0 1.69-1.83 2.93-4.37 3.68.62 2.58.46 4.79-1.01 5.63-1.46.84-3.45-.12-5.37-1.95-1.92 1.83-3.91 2.79-5.38 1.95-1.46-.84-1.62-3.05-1-5.63-2.54-.75-4.37-1.99-4.37-3.68 0-1.69 1.83-2.93 4.37-3.68-.62-2.58-.46-4.79 1-5.63 1.47-.84 3.46.12 5.38 1.95 1.92-1.83 3.91-2.79 5.37-1.95M17.08 12c.34.75.64 1.5.89 2.26 2.1-.63 3.28-1.53 3.28-2.26 0-.73-1.18-1.63-3.28-2.26-.25.76-.55 1.51-.89 2.26M6.92 12c-.34-.75-.64-1.5-.89-2.26-2.1.63-3.28 1.53-3.28 2.26 0 .73 1.18 1.63 3.28 2.26.25-.76.55-1.51.89-2.26m9 2.26l-.3.51c.31-.05.61-.1.88-.16-.07-.28-.18-.57-.29-.86l-.29.51m-2.89 4.04c1.59 1.5 2.97 2.08 3.59 1.7.64-.35.83-1.82.32-3.96-.77.16-1.58.28-2.4.36-.48.67-.99 1.31-1.51 1.9M8.08 9.74l.3-.51c-.31.05-.61.1-.88.16.07.28.18.57.29.86l.29-.51m2.89-4.04C9.38 4.2 8 3.62 7.37 4c-.63.35-.82 1.82-.31 3.96a22.7 22.7 0 012.4-.36c.48-.67.99-1.31 1.51-1.9z"/></svg>',
        vue: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2 3h3.5L12 15l6.5-12H22L12 21 2 3zm4.5 0h3L12 8l2.5-5h3L12 12.5 6.5 3z"/></svg>',
        video: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>',
        audio: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>',
        archive: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>',
        office: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>',
        executable: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>',
        binary: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z" /></svg>',
        default: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>'
    };

    // ============================================================
    // State
    // ============================================================

    const state = {
        theme: localStorage.getItem(STORAGE_KEYS.THEME) || 'light',
        sidebarWidth: parseInt(localStorage.getItem(STORAGE_KEYS.SIDEBAR_WIDTH)) || 280,
        tabs: [],
        activeTabIndex: -1,
        ws: null,
        isEditMode: false,
        hasUnsavedChanges: false,
        isResizing: false,
        skipScrollRestore: false,
        uploadTargetPath: '',
        rootPath: '',
        pdfStylePath: localStorage.getItem(STORAGE_KEYS.PDF_STYLE_PATH) || '',
        pdfOptionsPath: localStorage.getItem(STORAGE_KEYS.PDF_OPTIONS_PATH) || ''
    };

    // ============================================================
    // URL State Management
    // ============================================================

    function updateUrlPath(path) {
        if (path) {
            // パスベースURL: /README.md, /04_提案/10億円戦略.md
            const encoded = path.split('/').map(s => encodeURIComponent(s)).join('/');
            history.replaceState(null, '', '/' + encoded);
        } else {
            history.replaceState(null, '', '/');
        }
    }

    // ============================================================
    // DOM Elements
    // ============================================================

    const elements = {
        sidebar: document.getElementById('sidebar'),
        sidebarToggle: document.getElementById('sidebarToggle'),
        themeToggle: document.getElementById('themeToggle'),
        printBtn: document.getElementById('printBtn'),
        sunIcon: document.getElementById('sunIcon'),
        moonIcon: document.getElementById('moonIcon'),
        hljsTheme: document.getElementById('hljs-theme'),
        fileTree: document.getElementById('fileTree'),
        tabBar: document.getElementById('tabBar'),
        content: document.getElementById('content'),
        statusDot: document.getElementById('statusDot'),
        statusText: document.getElementById('statusText'),
        resizeHandle: document.getElementById('resizeHandle'),
        editToggle: document.getElementById('editToggle'),
        pdfStyleToggle: document.getElementById('pdfStyleToggle'),
        pdfStylePanel: document.getElementById('pdfStylePanel'),
        pdfStylePath: document.getElementById('pdfStylePath'),
        pdfOptionsPath: document.getElementById('pdfOptionsPath'),
        pdfStyleApply: document.getElementById('pdfStyleApply'),
        pdfStyleClear: document.getElementById('pdfStyleClear'),
        editLabel: document.getElementById('editLabel'),
        editorStatus: document.getElementById('editorStatus'),
        shutdownBtn: document.getElementById('shutdownBtn'),
        // File browser elements
        contextMenu: document.getElementById('contextMenu'),
        dialogOverlay: document.getElementById('dialogOverlay'),
        dialogTitle: document.getElementById('dialogTitle'),
        dialogInput: document.getElementById('dialogInput'),
        dialogMessage: document.getElementById('dialogMessage'),
        dialogCancel: document.getElementById('dialogCancel'),
        dialogConfirm: document.getElementById('dialogConfirm'),
        uploadOverlay: document.getElementById('uploadOverlay'),
        uploadFileName: document.getElementById('uploadFileName'),
        uploadProgressFill: document.getElementById('uploadProgressFill'),
        uploadProgressText: document.getElementById('uploadProgressText'),
        fileInput: document.getElementById('fileInput')
    };

    // ============================================================
    // Utilities
    // ============================================================

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function getFileIcon(iconName) {
        return FILE_ICONS[iconName] || FILE_ICONS.default;
    }

    function saveScrollPosition(element) {
        return element.scrollTop;
    }

    function restoreScrollPosition(element, position) {
        requestAnimationFrame(() => {
            element.scrollTop = position;
        });
    }

    function normalizeUserPath(path) {
        return path.trim().replace(/^\/+/, '');
    }

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, options);
        const data = await response.json();
        if (data.error || data.detail) {
            throw new Error(data.error || data.detail);
        }
        return data;
    }

    async function apiPost(url, body) {
        return apiRequest(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    function updateTabPaths(oldPath, newPath) {
        let updated = false;
        const newName = newPath.split('/').pop();
        state.tabs.forEach(tab => {
            if (tab.path === oldPath) {
                tab.path = newPath;
                tab.name = newName;
                updated = true;
            } else if (tab.path.startsWith(oldPath + '/')) {
                tab.path = newPath + tab.path.substring(oldPath.length);
                updated = true;
            }
        });
        return updated;
    }

    // ============================================================
    // Theme Management
    // ============================================================

    const ThemeManager = {
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
                TabManager.renderActive();
                restoreScrollPosition(elements.content, currentScroll);
            }
        },

        init() {
            this.set(state.theme);
            elements.themeToggle.addEventListener('click', () => this.toggle());
        }
    };

    // ============================================================
    // PDF Style Preview
    // ============================================================

    const PdfStyleManager = {
        scopedCssId: 'pdf-style-preview-css',

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

        // Style 設定があるか (PDF dispatch を server vs print dialog で切り替えるため)
        hasStyle() {
            return !!(normalizeUserPath(state.pdfStylePath) || normalizeUserPath(state.pdfOptionsPath));
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
            TabManager.renderActive();
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
            TabManager.renderActive();
            elements.statusText.textContent = 'PDF style cleared';
            setTimeout(() => { elements.statusText.textContent = 'Connected'; }, 1600);
        },

        async loadPreviewCss() {
            const oldStyle = document.getElementById(this.scopedCssId);
            if (oldStyle) oldStyle.remove();
            if (!state.pdfStylePath) return;

            try {
                const response = await fetch(`/raw/${state.pdfStylePath}`);
                if (!response.ok) throw new Error('CSS file not found');
                const cssText = await response.text();
                const style = document.createElement('style');
                style.id = this.scopedCssId;
                style.textContent = this.scopeCss(cssText);
                document.head.appendChild(style);
                elements.statusText.textContent = 'PDF style applied';
                setTimeout(() => { elements.statusText.textContent = 'Connected'; }, 1600);
            } catch (error) {
                console.error('PDF style preview error:', error);
                elements.statusText.textContent = 'PDF style failed';
                setTimeout(() => { elements.statusText.textContent = 'Connected'; }, 2500);
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

    // ============================================================
    // Sidebar Management
    // ============================================================

    const SidebarManager = {
        toggle() {
            elements.sidebar.classList.toggle('collapsed');
            if (!elements.sidebar.classList.contains('collapsed')) {
                elements.sidebar.style.width = state.sidebarWidth + 'px';
            }
        },

        setWidth(width) {
            if (width < 50) {
                elements.sidebar.classList.add('collapsed');
            } else {
                elements.sidebar.classList.remove('collapsed');
                elements.sidebar.style.width = width + 'px';
                state.sidebarWidth = width;
                localStorage.setItem(STORAGE_KEYS.SIDEBAR_WIDTH, width);
            }
        },

        init() {
            elements.sidebar.style.width = state.sidebarWidth + 'px';
            elements.sidebarToggle.addEventListener('click', () => this.toggle());
        }
    };

    // ============================================================
    // Resize Handler
    // ============================================================

    const ResizeHandler = {
        start() {
            state.isResizing = true;
            elements.resizeHandle.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        },

        move(clientX) {
            if (!state.isResizing) return;
            if (clientX >= 0 && clientX <= 500) {
                SidebarManager.setWidth(clientX);
            }
        },

        end() {
            if (state.isResizing) {
                state.isResizing = false;
                elements.resizeHandle.classList.remove('active');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        },

        init() {
            elements.resizeHandle.addEventListener('mousedown', () => this.start());
            document.addEventListener('mousemove', (e) => this.move(e.clientX));
            document.addEventListener('mouseup', () => this.end());
        }
    };

    // ============================================================
    // WebSocket Manager
    // ============================================================

    const WebSocketManager = {
        connect() {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            state.ws = new WebSocket(`${protocol}//${location.host}/ws`);

            state.ws.onopen = async () => {
                elements.statusDot.classList.remove('disconnected');
                elements.statusText.textContent = 'Connected';
                if (state.activeTabIndex >= 0) {
                    this.watchFile(state.tabs[state.activeTabIndex].path);
                    // 再接続時に最新データを取得
                    await refreshCurrentTab();
                }
            };

            state.ws.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'file_update' && state.activeTabIndex >= 0) {
                    this.handleFileUpdate(data);
                } else if (data.type === 'tree_update') {
                    // tree_update を受信したらAPIから最新ツリーを取得
                    await FileTreeManager.refresh();
                }
            };

            state.ws.onclose = () => {
                elements.statusDot.classList.add('disconnected');
                elements.statusText.textContent = 'Disconnected';
                setTimeout(() => this.connect(), 3000);
            };

            state.ws.onerror = () => state.ws.close();
        },

        watchFile(path) {
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ type: 'watch', path }));
            }
        },

        handleFileUpdate(data) {
            const tab = state.tabs[state.activeTabIndex];

            if (data.fileType === 'image' && data.reload) {
                ContentRenderer.renderImage(tab.imageUrl, tab.name);
                return;
            }

            if (!data.content) return;

            tab.content = data.content;
            if (data.raw) tab.raw = data.raw;
            if (typeof data.isMarp !== 'undefined') tab.isMarp = data.isMarp;

            if (state.isEditMode) {
                if (!state.hasUnsavedChanges && data.raw) {
                    const textarea = document.getElementById('editorTextarea');
                    if (textarea) {
                        const currentScroll = saveScrollPosition(textarea);
                        textarea.value = data.raw;
                        restoreScrollPosition(textarea, currentScroll);
                    }
                }
                return;
            }

            if (tab.isMarp) {
                if (data.css) tab.css = data.css;
                if (data.notes) tab.notes = data.notes;
                if (data.notesMultiplicity) tab.notesMultiplicity = data.notesMultiplicity;
                if (data.etag) tab.etag = data.etag;
                if (data.lineEnding) tab.lineEnding = data.lineEnding;
                if (typeof data.hasBom !== 'undefined') tab.hasBom = !!data.hasBom;
                ContentRenderer.renderMarp(data.content, tab.css);
                PresenterView.broadcastSlides();
            } else {
                const currentScroll = saveScrollPosition(elements.content);
                ContentRenderer.render(data.content, data.fileType || tab.fileType);
                restoreScrollPosition(elements.content, currentScroll);
            }
        }
    };

    // ============================================================
    // File Tree Manager
    // ============================================================

    const FileTreeManager = {
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

        async refresh() {
            try {
                const response = await MDVApi.fetchTree();
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const tree = await response.json();
                await this.update(tree);
            } catch (e) {
                console.error('Failed to refresh tree:', e);
            }
        },

        async update(tree) {
            // 展開済みかつ読み込み済みのパスを保存
            const expandedPaths = new Set();
            document.querySelectorAll('.tree-item').forEach(item => {
                const children = item.querySelector('.tree-children');
                if (children && !children.classList.contains('collapsed') && item.dataset.loaded === 'true') {
                    expandedPaths.add(item.dataset.path);
                }
            });

            elements.fileTree.innerHTML = this.renderItems(tree);

            // 展開済みディレクトリを復元（子要素も再取得）
            for (const path of expandedPaths) {
                const item = document.querySelector(`.tree-item[data-path="${CSS.escape(path)}"]`);
                if (item) {
                    const children = item.querySelector('.tree-children');
                    const chevron = item.querySelector('.chevron');

                    // 子要素を再取得
                    if (children && item.dataset.loaded !== 'true') {
                        await this.expandDirectory(path, children);
                    }

                    if (children) children.classList.remove('collapsed');
                    if (chevron) chevron.classList.add('expanded');
                }
            }

            this.updateHighlight();
        },

        renderItems(items) {
            if (!items || items.length === 0) return '';

            return items.map(item => {
                if (item.type === 'directory') {
                    return this.renderDirectory(item);
                }
                return this.renderFile(item);
            }).join('');
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

        async expandToPath(filePath) {
            // パスを分割して順番に展開
            const parts = filePath.split('/');

            let currentPath = '';
            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}/${part}` : part;

                const item = document.querySelector(`.tree-item[data-path="${CSS.escape(currentPath)}"]`);
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

    // ============================================================
    // Content Renderer
    // ============================================================

    // Marp state (module-level to persist across renders)
    let marpCurrentSlide = 0;
    let marpKeyHandler = null;

    // ============================================================
    // Presenter View (separate window with speaker notes)
    // ============================================================

    const PresenterView = {
        channel: null,
        presenterWindow: null,
        saveQueue: null,            // MDVSaveQueue instance (created in init)
        lastSavedEtag: new Map(),   // Map<path, etag> — own-save chain rebase

        init() {
            if (typeof BroadcastChannel === 'undefined') return;
            if (!window.MDVPresenterChannel || !window.MDVSaveQueue) return;
            this.channel = window.MDVPresenterChannel.create();
            if (!this.channel) return;

            // saveQueue rebases queued edits onto the etag of our last own
            // save when there has been no external watcher update. If an
            // external edit arrives, fallback to the originally-pinned etag
            // so optimistic locking can detect the conflict via 412.
            this.saveQueue = window.MDVSaveQueue.createSaveQueue({
                saveFn: (path, slideIndex, note, etag) => {
                    const tab = state.tabs.find((t) => t.path === path);
                    const own = this.lastSavedEtag.get(path);
                    const useEtag = (tab && own && tab.etag === own) ? own : etag;
                    return this.saveNote(path, slideIndex, note, useEtag);
                }
            });

            this.channel.addEventListener('message', (e) => {
                const msg = e.data || {};
                if (msg.type === 'request-slides') {
                    this.broadcastSlides();
                } else if (msg.type === 'goto') {
                    this.gotoSlide(msg.index);
                } else if (msg.type === 'edit-note') {
                    if (!msg.path) return;
                    this.saveQueue.enqueue(msg.path, msg.slideIndex, msg.note, msg.etag || null);
                }
            });

            // When a tab closes, drop its queued saves and own-etag entry to
            // prevent a slow leak under long sessions with many decks.
            if (window.MDVTabRegistry) {
                window.MDVTabRegistry.onTabClosed((path) => {
                    if (this.saveQueue) this.saveQueue.dropPath(path);
                    this.lastSavedEtag.delete(path);
                });
            }

            window.addEventListener('beforeunload', () => {
                if (this.presenterWindow && !this.presenterWindow.closed) {
                    this.presenterWindow.close();
                }
            });
        },

        // Persist a speaker note edit via the Marpit-token-based API. The
        // server resolves the path, validates ETag, and rewrites surgically.
        // `editTimeEtag` is the etag captured by the presenter at edit start;
        // we send that as If-Match (NOT the live tab.etag) so a watcher
        // refresh during the debounce can't smuggle a write past the lock.
        async saveNote(path, slideIndex, note, editTimeEtag) {
            const tab = state.tabs.find((t) => t.path === path);
            if (!tab || !tab.isMarp) return;
            const ifMatch = editTimeEtag || tab.etag;
            if (!ifMatch) {
                // GET degrade or no etag yet — refuse without writing.
                this.channel.postMessage({
                    type: 'note-saved',
                    slideIndex,
                    ok: false,
                    reason: 'Deck not parseable (degraded mode)'
                });
                return;
            }

            let res, data;
            try {
                ({ res, data } = await window.MDVApi.saveMarpNote(path, slideIndex, note, ifMatch));
            } catch (err) {
                console.error('saveNote network error', err);
                this.channel.postMessage({
                    type: 'note-saved', slideIndex, ok: false, reason: 'Network error'
                });
                return;
            }

            if (res.status === 412 && data.code === 'STALE') {
                // The file changed under us. Do NOT update tab.etag here —
                // tab.content/notes/slideRanges are still the pre-conflict
                // version, so adopting the new etag would let the next edit
                // pass If-Match while the deck index is wrong. The watcher's
                // file_update event will refresh tab.{content,notes,etag}
                // together once chokidar sees the change. Until then, all
                // PUTs from this tab keep returning 412.
                this.channel.postMessage({
                    type: 'note-saved',
                    slideIndex,
                    ok: false,
                    reason: 'STALE — file changed externally; please reload'
                });
                return;
            }

            if (res.ok && data.ok) {
                // Update local tab state from the server's authoritative
                // post-rewrite payload so re-broadcasts and the editor
                // immediately see the saved content. Otherwise raw/notes
                // would lag until the watcher's file_update event arrives.
                tab.etag = data.etag;
                this.lastSavedEtag.set(path, data.etag);
                if (typeof data.source === 'string') tab.raw = data.source;
                if (Array.isArray(data.notes)) tab.notes = data.notes;
                if (Array.isArray(data.notesMultiplicity)) {
                    tab.notesMultiplicity = data.notesMultiplicity;
                }
                this.channel.postMessage({
                    type: 'note-saved',
                    slideIndex,
                    ok: true,
                    etag: data.etag,
                    normalizedNote: data.normalizedNote
                });
                // Re-broadcast so the presenter window picks up the new
                // notes/etag without waiting for the watcher event.
                this.broadcastSlides();
                return;
            }

            const reason = data && (data.error || data.code) || 'Save failed';
            this.channel.postMessage({
                type: 'note-saved', slideIndex, ok: false, reason
            });
        },

        open() {
            const tab = state.tabs[state.activeTabIndex];
            if (!tab || !tab.isMarp) return;

            if (this.presenterWindow && !this.presenterWindow.closed) {
                this.presenterWindow.focus();
                this.broadcastSlides();
                return;
            }

            this.presenterWindow = window.open(
                '/static/presenter.html',
                'mdv-presenter',
                'width=1280,height=720,resizable=yes,scrollbars=yes'
            );

            // presenter sends `request-slides` on load, but broadcast as a fallback
            setTimeout(() => this.broadcastSlides(), 300);
        },

        broadcastSlides() {
            if (!this.channel) return;
            const tab = state.tabs[state.activeTabIndex];
            if (!tab || !tab.isMarp) {
                // Active tab is not a Marp deck (or no tab) — clear the
                // presenter so it doesn't keep showing stale slides /
                // accept edits against the wrong file.
                this.channel.postMessage({
                    type: 'slides',
                    empty: true,
                    reason: 'main-switched-away'
                });
                return;
            }
            this.channel.postMessage({
                type: 'slides',
                path: tab.path,
                html: tab.content,
                css: tab.css,
                notes: tab.notes || [],
                notesMultiplicity: tab.notesMultiplicity || [],
                etag: tab.etag || null,
                current: marpCurrentSlide
            });
        },

        broadcastIndex(index) {
            if (!this.channel) return;
            this.channel.postMessage({ type: 'index', index });
        },

        gotoSlide(index) {
            const slides = elements.content.querySelectorAll('.marpit > svg[data-marpit-svg]');
            if (!slides.length || index < 0 || index >= slides.length) return;
            slides.forEach((s, i) => s.classList.toggle('active', i === index));
            marpCurrentSlide = index;
            const counter = elements.content.querySelector('.slide-counter');
            if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
            const prevBtn = elements.content.querySelector('.marp-prev');
            const nextBtn = elements.content.querySelector('.marp-next');
            if (prevBtn) prevBtn.disabled = index === 0;
            if (nextBtn) nextBtn.disabled = index === slides.length - 1;
        }
    };

    const ContentRenderer = {
        render(htmlContent, fileType) {
            const containerClass = fileType === 'code'
                ? 'markdown-body code-view-container'
                : fileType === 'markdown'
                    ? 'markdown-body pdf-style-preview'
                    : 'markdown-body';
            elements.content.innerHTML = `<div class="${containerClass}">${htmlContent}</div>`;

            elements.content.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });

            if (fileType === 'markdown') {
                this.renderMermaid();
            }
        },

        renderMarp(htmlContent, css) {
            // Clean up previous Marp handlers
            this.cleanupMarp();

            elements.content.classList.add('marp-viewer');

            // Apply Marp CSS from marp-core (preserves exact structure for CSS selectors)
            if (css) {
                // Remove previous Marp style
                const oldStyle = document.getElementById('marp-style');
                if (oldStyle) oldStyle.remove();

                // Add new Marp style with navigation overrides
                const style = document.createElement('style');
                style.id = 'marp-style';
                // Add slide navigation CSS
                const navOverrides = `
                    /* Marp slide navigation */
                    .marpit {
                        position: relative;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        padding: 20px;
                        padding-bottom: 80px;
                    }
                    .marpit > svg[data-marpit-svg] {
                        display: none;
                        max-width: 100%;
                        height: auto;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                        border-radius: 4px;
                    }
                    .marpit > svg[data-marpit-svg].active {
                        display: block;
                    }
                    @media print {
                        .marpit {
                            padding: 0 !important;
                            background: transparent !important;
                        }
                        .marpit > svg[data-marpit-svg] {
                            display: block !important;
                            width: 100% !important;
                            height: auto !important;
                            max-width: none !important;
                            box-shadow: none !important;
                            border-radius: 0 !important;
                            page-break-after: always;
                            page-break-inside: avoid;
                        }
                        .marpit > svg[data-marpit-svg]:last-child {
                            page-break-after: avoid;
                        }
                        .marp-nav { display: none !important; }
                    }
                `;
                style.textContent = css + navOverrides;
                document.head.appendChild(style);
            }

            elements.content.innerHTML = htmlContent;

            // Add navigation controls to marpit container
            const marpit = elements.content.querySelector('.marpit');
            if (marpit) {
                const nav = document.createElement('div');
                nav.className = 'marp-nav';
                nav.innerHTML = `
                    <button class="marp-prev" title="Previous (←)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <span class="slide-counter">1 / 1</span>
                    <button class="marp-next" title="Next (→)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                    <button class="marp-fullscreen-btn" title="Fullscreen (F)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                    </button>
                    <button class="marp-presenter-btn" title="Presenter View (P)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                    </button>
                    <button class="marp-close-nav" title="Hide (N to show)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                `;
                marpit.appendChild(nav);
            }

            // Initialize slide navigation
            this.initMarpNavigation();

            // Syntax highlight
            elements.content.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });

            // Mermaid
            this.renderMermaid();
        },

        initMarpNavigation() {
            // Marp uses svg[data-marpit-svg] for each slide
            const slides = elements.content.querySelectorAll('.marpit > svg[data-marpit-svg]');
            const counter = elements.content.querySelector('.slide-counter');
            const prevBtn = elements.content.querySelector('.marp-prev');
            const nextBtn = elements.content.querySelector('.marp-next');

            if (slides.length === 0) return;

            // Reset to first slide (or restore position if within bounds)
            if (marpCurrentSlide >= slides.length) {
                marpCurrentSlide = 0;
            }

            const showSlide = (index) => {
                slides.forEach((slide, i) => {
                    slide.classList.toggle('active', i === index);
                });
                marpCurrentSlide = index;
                if (counter) {
                    counter.textContent = `${index + 1} / ${slides.length}`;
                }
                if (prevBtn) prevBtn.disabled = index === 0;
                if (nextBtn) nextBtn.disabled = index === slides.length - 1;
                PresenterView.broadcastIndex(index);
            };

            const nextSlide = () => {
                if (marpCurrentSlide < slides.length - 1) {
                    showSlide(marpCurrentSlide + 1);
                }
            };

            const prevSlide = () => {
                if (marpCurrentSlide > 0) {
                    showSlide(marpCurrentSlide - 1);
                }
            };

            // Show initial slide
            showSlide(marpCurrentSlide);

            // Button handlers
            if (prevBtn) prevBtn.addEventListener('click', prevSlide);
            if (nextBtn) nextBtn.addEventListener('click', nextSlide);

            // Fullscreen toggle
            const fullscreenBtn = elements.content.querySelector('.marp-fullscreen-btn');
            const expandIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>';
            const shrinkIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9V4m0 5H4m5 0L4 4m11 5h5m-5 0V4m0 5l5-5M9 15v5m0-5H4m5 0l-5 5m11-5h5m-5 0v5m0-5l5 5" /></svg>';
            const toggleFullscreen = () => {
                document.body.classList.toggle('marp-fullscreen');
                const isFullscreen = document.body.classList.contains('marp-fullscreen');
                if (fullscreenBtn) {
                    fullscreenBtn.innerHTML = isFullscreen ? shrinkIcon : expandIcon;
                    fullscreenBtn.title = isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen (F)';
                }
                // Reset nav position when exiting fullscreen
                const nav = elements.content.querySelector('.marp-nav');
                if (!isFullscreen && nav) {
                    nav.style.left = '';
                    nav.style.top = '';
                    nav.style.right = '';
                    nav.style.bottom = '';
                    nav.style.transform = '';
                }
            };
            if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);

            // Presenter view button
            const presenterBtn = elements.content.querySelector('.marp-presenter-btn');
            if (presenterBtn) presenterBtn.addEventListener('click', () => PresenterView.open());

            // Make nav draggable and closeable
            const nav = elements.content.querySelector('.marp-nav');
            if (nav) {
                let isDragging = false;
                let dragStartX, dragStartY, navStartX, navStartY;

                nav.addEventListener('mousedown', (e) => {
                    // Don't drag when clicking buttons or not in fullscreen
                    if (e.target.closest('button')) return;
                    if (!document.body.classList.contains('marp-fullscreen')) return;
                    isDragging = true;
                    nav.classList.add('dragging');
                    dragStartX = e.clientX;
                    dragStartY = e.clientY;
                    const rect = nav.getBoundingClientRect();
                    navStartX = rect.left;
                    navStartY = rect.top;
                    e.preventDefault();
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    const dx = e.clientX - dragStartX;
                    const dy = e.clientY - dragStartY;
                    const newX = Math.max(0, Math.min(window.innerWidth - nav.offsetWidth, navStartX + dx));
                    const newY = Math.max(0, Math.min(window.innerHeight - nav.offsetHeight, navStartY + dy));
                    nav.style.left = newX + 'px';
                    nav.style.top = newY + 'px';
                    nav.style.right = 'auto';
                    nav.style.bottom = 'auto';
                    nav.style.transform = 'none';
                });

                document.addEventListener('mouseup', () => {
                    if (isDragging) {
                        isDragging = false;
                        nav.classList.remove('dragging');
                    }
                });

                // Close button to hide nav
                const closeBtn = nav.querySelector('.marp-close-nav');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                        nav.classList.add('hidden');
                    });
                }
            }

            // Keyboard navigation
            marpKeyHandler = (e) => {
                // Don't handle if editing or in dialog
                if (state.isEditMode || !elements.dialogOverlay.classList.contains('hidden')) {
                    return;
                }
                const nav = elements.content.querySelector('.marp-nav');
                if (e.key === 'ArrowRight' || e.key === ' ') {
                    e.preventDefault();
                    nextSlide();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    prevSlide();
                } else if (e.key === 'f' || e.key === 'F') {
                    e.preventDefault();
                    toggleFullscreen();
                } else if (e.key === 'n' || e.key === 'N') {
                    e.preventDefault();
                    if (nav) nav.classList.toggle('hidden');
                } else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    // Skip if modifiers are held — Cmd/Ctrl+P is the print
                    // shortcut and must not also open the presenter view.
                    e.preventDefault();
                    PresenterView.open();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    if (document.body.classList.contains('marp-fullscreen')) {
                        toggleFullscreen();
                    } else if (nav && nav.classList.contains('hidden')) {
                        nav.classList.remove('hidden');
                    }
                }
            };
            document.addEventListener('keydown', marpKeyHandler);
        },

        cleanupMarp() {
            elements.content.classList.remove('marp-viewer');
            document.body.classList.remove('marp-fullscreen');
            if (marpKeyHandler) {
                document.removeEventListener('keydown', marpKeyHandler);
                marpKeyHandler = null;
            }
        },

        async renderMermaid() {
            const blocks = elements.content.querySelectorAll('code.language-mermaid');
            for (let i = 0; i < blocks.length; i++) {
                const block = blocks[i];
                const pre = block.parentElement;
                const mermaidCode = block.textContent;
                const div = document.createElement('div');
                div.className = 'mermaid';

                try {
                    const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i}`, mermaidCode);
                    div.innerHTML = svg;
                    pre.replaceWith(div);
                } catch (e) {
                    console.error('Mermaid error:', e);
                }
            }
        },

        renderImage(imageUrl, name) {
            const url = imageUrl + '&t=' + Date.now();
            const safeName = escapeHtml(name);
            elements.content.innerHTML = `
                <div class="image-preview">
                    <img src="${url}" alt="${safeName}" />
                    <div class="image-info">${safeName}</div>
                </div>
            `;
        },

        renderPDF(pdfUrl, name) {
            const url = pdfUrl + '&t=' + Date.now();
            const safeName = escapeHtml(name);
            elements.content.style.padding = '0';
            elements.content.innerHTML = `
                <div class="pdf-viewer">
                    <iframe src="${url}" title="${safeName}"></iframe>
                </div>
            `;
        },

        renderHTML(htmlUrl, name) {
            const safeName = escapeHtml(name);
            elements.content.style.padding = '0';
            elements.content.innerHTML = `
                <div class="html-preview">
                    <iframe src="${htmlUrl}" title="${safeName}"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-modals">
                    </iframe>
                </div>
            `;
        },

        renderVideo(mediaUrl, name) {
            const safeName = escapeHtml(name);
            elements.content.innerHTML = `
                <div class="video-preview">
                    <video controls>
                        <source src="${mediaUrl}" type="video/mp4">
                        お使いのブラウザは動画再生に対応していません。
                    </video>
                    <div class="media-info">${safeName}</div>
                </div>
            `;
        },

        renderAudio(mediaUrl, name) {
            const safeName = escapeHtml(name);
            elements.content.innerHTML = `
                <div class="audio-preview">
                    <audio controls>
                        <source src="${mediaUrl}">
                        お使いのブラウザは音声再生に対応していません。
                    </audio>
                    <div class="media-info">${safeName}</div>
                </div>
            `;
        },

        renderBinary(name, icon) {
            const safeName = escapeHtml(name);
            const iconSvg = getFileIcon(icon);
            elements.content.innerHTML = `
                <div class="binary-preview">
                    <div class="binary-icon">${iconSvg}</div>
                    <div class="binary-info">${safeName}</div>
                </div>
            `;
        },

        showWelcome() {
            elements.content.innerHTML = `
                <div class="welcome">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h2>Select a file</h2>
                    <p>Choose a file from the sidebar</p>
                    <p><kbd>Cmd+E</kbd> Edit &nbsp; <kbd>Cmd+S</kbd> Save &nbsp; <kbd>Cmd+P</kbd> PDF</p>
                </div>
            `;
        }
    };

    // ============================================================
    // Tab Manager
    // ============================================================

    const TabManager = {
        async open(path) {
            const existingIndex = state.tabs.findIndex(t => t.path === path);
            if (existingIndex >= 0) {
                this.switch(existingIndex);
                return;
            }

            const response = await MDVApi.fetchFile(path);
            const data = await response.json();

            if (data.error) {
                alert('Error: ' + data.error);
                return;
            }

            state.tabs.push({
                path,
                name: data.name,
                content: data.content,
                raw: data.raw,
                fileType: data.fileType,
                isMarp: data.isMarp || false,
                css: data.css || null,  // Marp CSS from marp-core
                notes: data.notes || [],  // Marp speaker notes per slide
                notesMultiplicity: data.notesMultiplicity || [],
                etag: data.etag || null,
                lineEnding: data.lineEnding || '\n',
                hasBom: !!data.hasBom,
                imageUrl: data.imageUrl,
                pdfUrl: data.pdfUrl,
                htmlUrl: data.htmlUrl,
                mediaUrl: data.mediaUrl,
                downloadUrl: data.downloadUrl,
                scrollTop: 0
            });

            if (state.isEditMode) {
                state.isEditMode = false;
                EditorManager.updateButton();
            }

            state.activeTabIndex = state.tabs.length - 1;
            this.render();
            this.renderActive();
            WebSocketManager.watchFile(path);
            FileTreeManager.updateHighlight();
            updateUrlPath(path);
        },

        switch(index) {
            if (state.activeTabIndex >= 0 && state.activeTabIndex < state.tabs.length) {
                if (state.isEditMode) {
                    const textarea = document.getElementById('editorTextarea');
                    if (textarea) {
                        state.tabs[state.activeTabIndex].raw = textarea.value;
                        const maxScroll = textarea.scrollHeight - textarea.clientHeight;
                        if (maxScroll > 0) {
                            const percentage = textarea.scrollTop / maxScroll;
                            const viewMaxScroll = elements.content.scrollHeight - elements.content.clientHeight;
                            state.tabs[state.activeTabIndex].scrollTop = viewMaxScroll * percentage;
                        }
                    }
                } else {
                    state.tabs[state.activeTabIndex].scrollTop = elements.content.scrollTop;
                }
            }

            if (state.isEditMode) {
                state.isEditMode = false;
                EditorManager.updateButton();
            }

            state.activeTabIndex = index;
            this.render();
            this.renderActive();
            WebSocketManager.watchFile(state.tabs[index].path);
            FileTreeManager.updateHighlight();
            updateUrlPath(state.tabs[index].path);
        },

        close(index) {
            // Warn about unsaved changes
            if (state.isEditMode && state.hasUnsavedChanges && index === state.activeTabIndex) {
                DialogManager.show('未保存の変更', {
                    message: '変更を保存せずにタブを閉じますか？',
                    isConfirm: true,
                    danger: true,
                    confirmText: '閉じる',
                    onConfirm: () => {
                        state.hasUnsavedChanges = false;
                        state.isEditMode = false;
                        EditorManager.updateButton();
                        TabManager.close(index);
                    }
                });
                return;
            }
            const closingPath = state.tabs[index] && state.tabs[index].path;
            state.tabs.splice(index, 1);
            if (closingPath && window.MDVTabRegistry) {
                window.MDVTabRegistry.notifyClosed(closingPath);
            }

            if (state.tabs.length === 0) {
                state.activeTabIndex = -1;
                this.render();
                ContentRenderer.showWelcome();
                FileTreeManager.updateHighlight();
                updateUrlPath(null);
                return;
            }

            if (state.activeTabIndex >= state.tabs.length) {
                state.activeTabIndex = state.tabs.length - 1;
            } else if (index < state.activeTabIndex) {
                state.activeTabIndex--;
            }
            this.render();
            this.renderActive();
            FileTreeManager.updateHighlight();
            updateUrlPath(state.tabs[state.activeTabIndex].path);
        },

        render() {
            elements.tabBar.innerHTML = state.tabs.map((tab, i) => `
                <button class="tab ${i === state.activeTabIndex ? 'active' : ''}" onclick="MDV.switchTab(${i})">
                    ${escapeHtml(tab.name)}
                    <span class="tab-close" onclick="event.stopPropagation(); MDV.closeTab(${i})">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </span>
                </button>
            `).join('');
            // タブがない時はタブバーを非表示
            elements.tabBar.style.display = state.tabs.length === 0 ? 'none' : 'flex';
        },

        renderActive() {
            if (state.activeTabIndex < 0 || state.activeTabIndex >= state.tabs.length) return;
            const tab = state.tabs[state.activeTabIndex];

            elements.content.style.padding = '';
            this.renderByFileType(tab);

            if (!state.skipScrollRestore) {
                setTimeout(() => { elements.content.scrollTop = tab.scrollTop; }, 0);
            }
        },

        renderByFileType(tab) {
            ContentRenderer.cleanupMarp();

            if (tab.isMarp) {
                ContentRenderer.renderMarp(tab.content, tab.css);
                PresenterView.broadcastSlides();
                return;
            }

            const fileType = tab.fileType;
            const binaryTypes = ['archive', 'office', 'executable', 'binary'];

            if (fileType === 'image') {
                ContentRenderer.renderImage(tab.imageUrl, tab.name);
            } else if (fileType === 'pdf') {
                ContentRenderer.renderPDF(tab.pdfUrl, tab.name);
            } else if (fileType === 'html' && tab.htmlUrl && !state.isEditMode) {
                ContentRenderer.renderHTML(tab.htmlUrl, tab.name);
            } else if (fileType === 'video') {
                ContentRenderer.renderVideo(tab.mediaUrl, tab.name);
            } else if (fileType === 'audio') {
                ContentRenderer.renderAudio(tab.mediaUrl, tab.name);
            } else if (binaryTypes.includes(fileType)) {
                ContentRenderer.renderBinary(tab.name, fileType);
            } else {
                ContentRenderer.render(tab.content, fileType);
            }
        }
    };

    // ============================================================
    // Editor Manager
    // ============================================================

    const EditorManager = {
        async toggle() {
            if (state.activeTabIndex < 0) return;
            const tab = state.tabs[state.activeTabIndex];

            if (tab.fileType === 'image') {
                alert('Cannot edit image files');
                return;
            }

            state.isEditMode = !state.isEditMode;
            this.updateButton();
            state.isEditMode ? this.show() : await this.hide();
        },

        updateButton() {
            elements.editToggle.classList.toggle('active', state.isEditMode);
            elements.editLabel.textContent = state.isEditMode ? 'View' : 'Edit';
        },

        show() {
            if (state.activeTabIndex < 0) return;
            const tab = state.tabs[state.activeTabIndex];

            const viewTopLine = this.getViewTopLine();
            const viewMaxScroll = elements.content.scrollHeight - elements.content.clientHeight;
            let scrollPercentage = 0;
            if (viewMaxScroll > 0) {
                scrollPercentage = elements.content.scrollTop / viewMaxScroll;
            }

            elements.content.innerHTML = `
                <div class="editor-container">
                    <textarea class="editor-textarea" id="editorTextarea" spellcheck="false">${escapeHtml(tab.raw || '')}</textarea>
                </div>
            `;

            elements.editorStatus.style.display = 'inline';
            elements.editorStatus.textContent = 'Ready';
            elements.editorStatus.className = 'editor-status';

            const textarea = document.getElementById('editorTextarea');
            textarea.addEventListener('input', () => {
                state.hasUnsavedChanges = true;
                elements.editorStatus.textContent = 'Modified';
                elements.editorStatus.className = 'editor-status modified';
            });

            setTimeout(() => {
                textarea.focus();
                if (viewTopLine >= 0) {
                    const lineHeight = this.getTextareaLineHeight(textarea);
                    textarea.scrollTop = viewTopLine * lineHeight;
                } else if (scrollPercentage > 0) {
                    const editMaxScroll = textarea.scrollHeight - textarea.clientHeight;
                    textarea.scrollTop = editMaxScroll * scrollPercentage;
                }
            }, 0);
        },

        getViewTopLine() {
            const contentRect = elements.content.getBoundingClientRect();
            const topY = contentRect.top + 10;
            const centerX = contentRect.left + contentRect.width / 2;

            let el = document.elementFromPoint(centerX, topY);
            if (!el || !elements.content.contains(el)) {
                return -1;
            }

            while (el && el !== elements.content) {
                const dataLine = el.getAttribute('data-line');
                if (dataLine !== null) {
                    return parseInt(dataLine, 10);
                }
                el = el.parentElement;
            }
            return -1;
        },

        getTextareaLineHeight(textarea) {
            const lines = textarea.value.split('\n');
            if (lines.length > 0 && textarea.scrollHeight > 0) {
                return textarea.scrollHeight / lines.length;
            }
            const style = window.getComputedStyle(textarea);
            return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
        },

        async hide() {
            if (state.activeTabIndex < 0) return;
            const tab = state.tabs[state.activeTabIndex];

            const textarea = document.getElementById('editorTextarea');
            let topLineNumber = -1;
            let scrollPercentage = 0;

            if (textarea) {
                tab.raw = textarea.value;
                topLineNumber = this.getEditTopLineNumber(textarea);
                const maxScroll = textarea.scrollHeight - textarea.clientHeight;
                if (maxScroll > 0) {
                    scrollPercentage = textarea.scrollTop / maxScroll;
                }
            }

            elements.editorStatus.style.display = 'none';

            try {
                const response = await MDVApi.fetchFile(tab.path);
                const data = await response.json();
                if (data.content) tab.content = data.content;
                if (data.raw) tab.raw = data.raw;
                if (data.css) tab.css = data.css;
                if (data.notes) tab.notes = data.notes;
                if (data.notesMultiplicity) tab.notesMultiplicity = data.notesMultiplicity;
                if (data.etag) tab.etag = data.etag;
                if (data.lineEnding) tab.lineEnding = data.lineEnding;
                if (typeof data.hasBom !== 'undefined') tab.hasBom = !!data.hasBom;
                if (typeof data.isMarp !== 'undefined') tab.isMarp = data.isMarp;
            } catch (e) {
                console.error('Failed to fetch updated content:', e);
            }

            WebSocketManager.watchFile(tab.path);

            state.skipScrollRestore = true;
            TabManager.renderActive();
            state.skipScrollRestore = false;

            requestAnimationFrame(() => {
                if (topLineNumber >= 0) {
                    const targetElement = this.findElementByLine(topLineNumber);
                    if (targetElement) {
                        const contentRect = elements.content.getBoundingClientRect();
                        const targetRect = targetElement.getBoundingClientRect();
                        const offsetTop = targetRect.top - contentRect.top + elements.content.scrollTop;
                        elements.content.scrollTop = offsetTop - 10;
                        return;
                    }
                }
                if (scrollPercentage > 0) {
                    const maxScroll = elements.content.scrollHeight - elements.content.clientHeight;
                    elements.content.scrollTop = maxScroll * scrollPercentage;
                }
            });
            state.hasUnsavedChanges = false;
        },

        getEditTopLineNumber(textarea) {
            const lineHeight = this.getTextareaLineHeight(textarea);
            return Math.floor(textarea.scrollTop / lineHeight);
        },

        findElementByLine(lineNumber) {
            const markdownBody = elements.content.querySelector('.markdown-body');
            if (!markdownBody) return null;

            const elementsWithLine = markdownBody.querySelectorAll('[data-line]');
            let bestElement = null;
            let bestLine = -1;

            for (const el of elementsWithLine) {
                const line = parseInt(el.getAttribute('data-line'), 10);
                if (line <= lineNumber && line > bestLine) {
                    bestLine = line;
                    bestElement = el;
                }
            }

            return bestElement;
        },

        async save() {
            if (state.activeTabIndex < 0 || !state.isEditMode) return;

            const tab = state.tabs[state.activeTabIndex];
            const textarea = document.getElementById('editorTextarea');
            if (!textarea) return;

            const newContent = textarea.value;

            try {
                elements.editorStatus.textContent = 'Saving...';
                elements.editorStatus.className = 'editor-status';

                const response = await MDVApi.saveFile(tab.path, newContent);

                const result = await response.json();

                if (result.error) {
                    elements.editorStatus.textContent = 'Error: ' + result.error;
                    elements.editorStatus.className = 'editor-status modified';
                    return;
                }

                tab.raw = newContent;
                state.hasUnsavedChanges = false;
                elements.editorStatus.textContent = 'Saved!';
                elements.editorStatus.className = 'editor-status saved';

                setTimeout(() => {
                    elements.editorStatus.textContent = 'Ready';
                    elements.editorStatus.className = 'editor-status';
                }, 2000);

            } catch (e) {
                elements.editorStatus.textContent = 'Error: ' + e.message;
                elements.editorStatus.className = 'editor-status modified';
            }
        },

        init() {
            elements.editToggle.addEventListener('click', () => this.toggle());
        }
    };

    // ============================================================
    // Print Manager
    // ============================================================

    const PrintManager = {
        isMarpPresentation() {
            return !!elements.content.querySelector('.marpit');
        },

        isHtmlPreview() {
            return !!elements.content.querySelector('.html-preview iframe');
        },

        async print() {
            if (state.activeTabIndex < 0) return;

            const tab = state.tabs[state.activeTabIndex];

            // editモード中は閉じてからPDF生成
            if (state.isEditMode) {
                await EditorManager.toggle();
            }

            if (tab.isMarp || this.isMarpPresentation()) {
                await this.exportPdf(tab.path);
            } else if (this.isHtmlPreview()) {
                this.printHtmlPreview(tab.name);
            } else if (tab.fileType === 'markdown' && PdfStyleManager.hasStyle()) {
                // Style パネルで CSS / PDF options が設定されている場合のみ
                // サーバー側 md-to-pdf で styled PDF を生成 (Watanabe 設計)。
                // 設定がなければデフォルトの印刷ダイアログ経路に落とす。
                await this.exportPdf(tab.path);
            } else {
                this.browserPrint(tab.name);
            }
        },

        browserPrint(fileName) {
            const pdfName = fileName.replace(/\.(md|txt)$/, '.pdf');
            const originalTitle = document.title;

            document.title = pdfName;
            window.print();
            document.title = originalTitle;
        },

        printHtmlPreview(fileName) {
            const iframe = elements.content.querySelector('.html-preview iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.print();
            }
        },

        async exportPdf(filePath) {
            const statusText = elements.statusText;
            const originalStatus = statusText.textContent;

            try {
                statusText.textContent = 'Generating PDF...';
                const exportOptions = PdfStyleManager.getExportOptions();

                const response = await MDVApi.exportPdf({ filePath, ...exportOptions });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.details || error.error || 'PDF export failed');
                }

                // Download the PDF
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filePath.replace(/\.md$/, '.pdf').split('/').pop();
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                statusText.textContent = 'PDF exported';
                setTimeout(() => {
                    statusText.textContent = originalStatus;
                }, 2000);
            } catch (error) {
                console.error('PDF export error:', error);
                statusText.textContent = 'PDF export failed';
                setTimeout(() => {
                    statusText.textContent = originalStatus;
                }, 3000);
            }
        },

        init() {
            elements.printBtn.addEventListener('click', () => this.print());
        }
    };

    // ============================================================
    // Shutdown Manager
    // ============================================================

    const ShutdownManager = {
        async shutdown() {
            elements.statusText.textContent = 'Stopping...';
            // Connection failure is expected when server stops
            fetch('/api/shutdown', { method: 'POST' }).catch(() => {});
        },

        init() {
            elements.shutdownBtn.addEventListener('click', () => this.shutdown());
        }
    };

    // ============================================================
    // Dialog Manager
    // ============================================================

    const DialogManager = {
        currentCallback: null,
        isConfirmDialog: false,

        show(title, options = {}) {
            elements.dialogTitle.textContent = title;
            const hasInput = options.showInput;
            const hasMessage = options.message;
            elements.dialogInput.style.display = hasInput ? 'block' : 'none';
            elements.dialogMessage.textContent = hasMessage || '';
            elements.dialogMessage.style.display = hasMessage ? 'block' : 'none';

            if (hasInput) {
                elements.dialogInput.value = options.defaultValue || '';
            }

            elements.dialogConfirm.className = options.danger ? 'btn-danger' : 'btn-confirm';
            elements.dialogConfirm.textContent = options.confirmText || 'OK';

            this.isConfirmDialog = options.isConfirm || false;
            this.currentCallback = options.onConfirm;

            elements.dialogOverlay.classList.remove('hidden');

            if (hasInput) {
                setTimeout(() => {
                    elements.dialogInput.focus();
                    elements.dialogInput.select();
                }, 100);
            }
        },

        hide() {
            elements.dialogOverlay.classList.add('hidden');
            this.currentCallback = null;
        },

        confirm() {
            if (this.currentCallback) {
                const value = this.isConfirmDialog ? true : elements.dialogInput.value;
                this.currentCallback(value);
            }
            this.hide();
        },

        init() {
            elements.dialogCancel.addEventListener('click', () => this.hide());
            elements.dialogConfirm.addEventListener('click', () => this.confirm());
            elements.dialogInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.confirm();
                }
                if (e.key === 'Escape') {
                    this.hide();
                }
            });
            elements.dialogOverlay.addEventListener('click', (e) => {
                if (e.target === elements.dialogOverlay) {
                    this.hide();
                }
            });
        }
    };

    // ============================================================
    // File Operations Manager
    // ============================================================

    const FileOperationsManager = {
        async createDirectory(parentPath) {
            DialogManager.show('新規フォルダ', {
                showInput: true,
                defaultValue: '新しいフォルダ',
                onConfirm: async (name) => {
                    if (!name) return;
                    const path = parentPath ? `${parentPath}/${name}` : name;
                    try {
                        await apiPost('/api/mkdir', { path });
                    } catch (e) {
                        alert('Error: ' + e.message);
                    }
                }
            });
        },

        async deleteItem(path, isDirectory) {
            const name = path.split('/').pop();
            const typeText = isDirectory ? 'フォルダ' : 'ファイル';
            DialogManager.show(`${typeText}を削除`, {
                message: `"${name}" を削除しますか？この操作は取り消せません。`,
                isConfirm: true,
                danger: true,
                confirmText: '削除',
                onConfirm: async () => {
                    try {
                        await apiRequest(`/api/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
                        const tabIndex = state.tabs.findIndex(t => t.path === path || t.path.startsWith(path + '/'));
                        if (tabIndex >= 0) {
                            TabManager.close(tabIndex);
                        }
                    } catch (e) {
                        alert('Error: ' + e.message);
                    }
                }
            });
        },

        async renameItem(path, isDirectory) {
            const oldName = path.split('/').pop();
            const parentPath = path.substring(0, path.lastIndexOf('/'));
            DialogManager.show('名前を変更', {
                showInput: true,
                defaultValue: oldName,
                onConfirm: async (newName) => {
                    if (!newName || newName === oldName) return;
                    const destination = parentPath ? `${parentPath}/${newName}` : newName;
                    await this.executeMoveOperation(path, destination);
                }
            });
        },

        async moveItem(source, destinationFolder) {
            const fileName = source.split('/').pop();
            const destination = destinationFolder ? `${destinationFolder}/${fileName}` : fileName;
            await this.executeMoveOperation(source, destination);
        },

        async executeMoveOperation(source, destination) {
            try {
                const result = await apiPost('/api/move', { source, destination });
                if (result.success && updateTabPaths(source, destination)) {
                    TabManager.render();
                }
            } catch (e) {
                alert('Error: ' + e.message);
            }
        },

        async upload(targetPath, files) {
            if (!files || files.length === 0) return;

            elements.uploadOverlay.classList.remove('hidden');
            elements.uploadProgressFill.style.width = '0%';
            elements.uploadProgressText.textContent = '0%';

            const formData = new FormData();
            formData.append('path', targetPath || '');
            for (const file of files) {
                formData.append('files', file);
            }

            try {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/upload');

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        elements.uploadProgressFill.style.width = percent + '%';
                        elements.uploadProgressText.textContent = percent + '%';
                    }
                };

                xhr.onload = () => {
                    elements.uploadOverlay.classList.add('hidden');
                    if (xhr.status !== 200) {
                        try {
                            const result = JSON.parse(xhr.responseText);
                            alert('Error: ' + (result.detail || result.error || 'Upload failed'));
                        } catch {
                            alert('Error: Upload failed');
                        }
                    }
                };

                xhr.onerror = () => {
                    elements.uploadOverlay.classList.add('hidden');
                    alert('Upload failed');
                };

                const fileName = files.length === 1 ? files[0].name : `${files.length}ファイル`;
                elements.uploadFileName.textContent = `${fileName} をアップロード中...`;

                xhr.send(formData);
            } catch (e) {
                elements.uploadOverlay.classList.add('hidden');
                alert('Error: ' + e.message);
            }
        },

        download(path) {
            const a = document.createElement('a');
            a.href = `/api/download?path=${encodeURIComponent(path)}`;
            a.download = path.split('/').pop() || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    // ============================================================
    // Context Menu Manager
    // ============================================================

    const ContextMenuManager = {
        currentPath: null,
        isDirectory: false,

        show(x, y, path, isDir) {
            this.currentPath = path;
            this.isDirectory = isDir;

            const items = this.getMenuItems(isDir);
            elements.contextMenu.innerHTML = items.map(item => {
                if (item.separator) {
                    return '<div class="context-menu-separator"></div>';
                }
                return `<div class="context-menu-item ${item.danger ? 'danger' : ''}" data-action="${item.action}">${item.label}</div>`;
            }).join('');

            const menuRect = elements.contextMenu.getBoundingClientRect();
            const maxX = window.innerWidth - 170;
            const maxY = window.innerHeight - (items.length * 36);
            elements.contextMenu.style.left = Math.min(x, maxX) + 'px';
            elements.contextMenu.style.top = Math.min(y, maxY) + 'px';

            elements.contextMenu.classList.remove('hidden');
        },

        hide() {
            elements.contextMenu.classList.add('hidden');
            this.currentPath = null;
        },

        getMenuItems(isDir) {
            if (isDir) {
                return [
                    { label: '新規フォルダ', action: 'newFolder' },
                    { label: 'アップロード', action: 'upload' },
                    { separator: true },
                    { label: '名前を変更', action: 'rename' },
                    { label: 'パスをコピー', action: 'copyPath' },
                    { separator: true },
                    { label: '削除', action: 'delete', danger: true }
                ];
            }
            return [
                { label: '開く', action: 'open' },
                { label: 'ダウンロード', action: 'download' },
                { separator: true },
                { label: '名前を変更', action: 'rename' },
                { label: 'パスをコピー', action: 'copyPath' },
                { separator: true },
                { label: '削除', action: 'delete', danger: true }
            ];
        },

        handleAction(action) {
            const path = this.currentPath;
            const isDir = this.isDirectory;
            this.hide();

            if (action === 'open') {
                TabManager.open(path);
            } else if (action === 'download') {
                FileOperationsManager.download(path);
            } else if (action === 'rename') {
                FileOperationsManager.renameItem(path, isDir);
            } else if (action === 'delete') {
                FileOperationsManager.deleteItem(path, isDir);
            } else if (action === 'newFolder') {
                FileOperationsManager.createDirectory(path);
            } else if (action === 'upload') {
                state.uploadTargetPath = path;
                elements.fileInput.click();
            } else if (action === 'copyPath') {
                const fullPath = state.rootPath ? `${state.rootPath}/${path}` : path;
                navigator.clipboard.writeText(fullPath).catch(err => {
                    console.error('コピーに失敗:', err);
                    alert('パスのコピーに失敗しました');
                });
            }
        },

        init() {
            elements.contextMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.context-menu-item');
                if (item) {
                    this.handleAction(item.dataset.action);
                }
            });

            document.addEventListener('click', (e) => {
                if (!elements.contextMenu.contains(e.target)) {
                    this.hide();
                }
            });

            document.addEventListener('contextmenu', (e) => {
                const treeItem = e.target.closest('.tree-item');
                if (treeItem && elements.fileTree.contains(treeItem)) {
                    e.preventDefault();
                    const path = treeItem.dataset.path;
                    const isDir = !!treeItem.querySelector('.tree-children');
                    this.show(e.clientX, e.clientY, path, isDir);
                }
            });

            elements.fileTree.addEventListener('contextmenu', (e) => {
                if (e.target === elements.fileTree) {
                    e.preventDefault();
                    this.show(e.clientX, e.clientY, '', true);
                }
            });

            elements.fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    FileOperationsManager.upload(state.uploadTargetPath || '', e.target.files);
                    e.target.value = '';
                }
            });
        }
    };

    // ============================================================
    // Drag & Drop Manager
    // ============================================================

    const DragDropManager = {
        draggedPath: null,

        clearDragOverStyles() {
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            elements.fileTree.classList.remove('drag-over');
        },

        init() {
            elements.fileTree.addEventListener('dragstart', (e) => {
                const treeItem = e.target.closest('.tree-item');
                if (treeItem) {
                    this.draggedPath = treeItem.dataset.path;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', this.draggedPath);
                    treeItem.style.opacity = '0.5';
                }
            });

            elements.fileTree.addEventListener('dragend', (e) => {
                const treeItem = e.target.closest('.tree-item');
                if (treeItem) {
                    treeItem.style.opacity = '';
                }
                this.draggedPath = null;
                this.clearDragOverStyles();
            });

            elements.fileTree.addEventListener('dragover', (e) => {
                e.preventDefault();

                // Root area drop (external files or internal move to root)
                if (e.target === elements.fileTree) {
                    if (e.dataTransfer.types.includes('Files') || this.draggedPath) {
                        elements.fileTree.classList.add('drag-over');
                    }
                    return;
                }

                // Directory drop
                const treeItem = e.target.closest('.tree-item');
                if (treeItem && treeItem.querySelector('.tree-children')) {
                    e.dataTransfer.dropEffect = 'move';
                    treeItem.querySelector('.tree-item-content').classList.add('drag-over');
                }
            });

            elements.fileTree.addEventListener('dragleave', (e) => {
                if (e.target === elements.fileTree) {
                    elements.fileTree.classList.remove('drag-over');
                    return;
                }

                const treeItem = e.target.closest('.tree-item');
                if (treeItem) {
                    treeItem.querySelector('.tree-item-content')?.classList.remove('drag-over');
                }
            });

            elements.fileTree.addEventListener('drop', (e) => {
                e.preventDefault();
                this.clearDragOverStyles();

                // Root area drop
                if (e.target === elements.fileTree) {
                    // Internal file move to root
                    if (this.draggedPath) {
                        // Already at root? (no '/' in path means it's at root)
                        if (!this.draggedPath.includes('/')) {
                            return;
                        }
                        FileOperationsManager.moveItem(this.draggedPath, '');
                        return;
                    }
                    // External file upload to root
                    if (e.dataTransfer.files.length > 0) {
                        FileOperationsManager.upload('', e.dataTransfer.files);
                    }
                    return;
                }

                // Directory drop
                const treeItem = e.target.closest('.tree-item');
                if (!treeItem || !treeItem.querySelector('.tree-children')) return;

                const targetPath = treeItem.dataset.path;

                if (this.draggedPath && this.draggedPath !== targetPath) {
                    if (targetPath.startsWith(this.draggedPath + '/')) {
                        alert('フォルダを自身のサブフォルダに移動することはできません');
                        return;
                    }
                    FileOperationsManager.moveItem(this.draggedPath, targetPath);
                } else if (e.dataTransfer.files.length > 0) {
                    FileOperationsManager.upload(targetPath, e.dataTransfer.files);
                }
            });
        }
    };

    // ============================================================
    // Keyboard Shortcuts
    // ============================================================

    const KeyboardManager = {
        selectedTreePath: null,

        shortcuts: {
            'b': { handler: () => SidebarManager.toggle() },
            'w': { handler: () => TabManager.close(state.activeTabIndex), requiresTab: true },
            'e': { handler: () => EditorManager.toggle(), requiresTab: true },
            's': { handler: () => EditorManager.save(), requiresEditMode: true },
            'p': { handler: () => PrintManager.print(), requiresTab: true }
        },

        handleModShortcut(key) {
            const shortcut = this.shortcuts[key];
            if (!shortcut) return false;
            if (shortcut.requiresTab && state.activeTabIndex < 0) return false;
            if (shortcut.requiresEditMode && !state.isEditMode) return false;
            shortcut.handler();
            return true;
        },

        handleTreeItemShortcut(key) {
            if (!this.selectedTreePath) return false;

            const isTextInput = document.activeElement.tagName === 'INPUT' ||
                                document.activeElement.tagName === 'TEXTAREA';

            const activeItem = document.querySelector(`.tree-item[data-path="${CSS.escape(this.selectedTreePath)}"]`);
            const isDir = activeItem && !!activeItem.querySelector('.tree-children');

            if ((key === 'Delete' || key === 'Backspace') && !isTextInput) {
                FileOperationsManager.deleteItem(this.selectedTreePath, isDir);
                return true;
            }
            if (key === 'F2') {
                FileOperationsManager.renameItem(this.selectedTreePath, isDir);
                return true;
            }
            return false;
        },

        init() {
            document.addEventListener('keydown', (e) => {
                const isMod = e.metaKey || e.ctrlKey;

                if (isMod && this.handleModShortcut(e.key)) {
                    e.preventDefault();
                    return;
                }

                if (this.handleTreeItemShortcut(e.key)) {
                    e.preventDefault();
                }
            });

            elements.fileTree.addEventListener('click', (e) => {
                const treeItem = e.target.closest('.tree-item');
                if (treeItem) {
                    this.selectedTreePath = treeItem.dataset.path;
                }
                // Event delegation for file open (replaces inline onclick)
                const openTarget = e.target.closest('[data-action="open"]');
                if (openTarget) {
                    const item = openTarget.closest('.tree-item');
                    if (item && item.dataset.path) {
                        TabManager.open(item.dataset.path);
                    }
                }
            });
        }
    };

    // ============================================================
    // Public API (Global Functions for onclick handlers)
    // ============================================================

    window.MDV = {
        openFile: (path) => TabManager.open(path),
        switchTab: (index) => TabManager.switch(index),
        closeTab: (index) => TabManager.close(index),
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
            if (data.content && data.content !== tab.content) {
                tab.content = data.content;
                if (data.raw) {
                    tab.raw = data.raw;
                }
                const currentScroll = saveScrollPosition(elements.content);
                ContentRenderer.render(data.content, data.fileType || tab.fileType);
                restoreScrollPosition(elements.content, currentScroll);
            }
        } catch (e) {
            console.error('Failed to refresh tab:', e);
        }
    }

    async function init() {
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
            let targetPath = decoded;
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

})();
