import js from '@eslint/js';

// Minimal drift-catching config: no-undef + no-unused-vars only.
// The frontend (src/static/) is native ES modules that still share some
// cross-file globals (via globalThis, for presenter.html's inline script
// and not-yet-migrated code); the cross-file contract is declared here so
// accidental global creation or typo'd references fail lint instead of
// failing at runtime.
export default [
  {
    ignores: [
      'node_modules/**',
      'src/static/vendor/**',
      '.playwright-mcp/**',
      'docs/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
    ],
  },
  {
    // Backend, CLI, scripts, tests: Node ESM.
    files: ['src/**/*.js', 'bin/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.js'],
    ignores: ['src/static/**'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        crypto: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        globalThis: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off', // NULバイト検出などの意図的な制御文字チェックがあるため
    },
  },
  {
    // E2E specs run in Node but page.evaluate() callbacks execute in the browser.
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        // 0.6.10 (18-diff-highlight.spec.js): reads computed styles from
        // inside a page.evaluate() callback to assert added/changed share
        // one color.
        getComputedStyle: 'readonly',
      },
    },
  },
  {
    // Frontend: native ES modules (zero-build, <script type="module">).
    files: ['src/static/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        queueMicrotask: 'readonly',
        crypto: 'readonly',
        CSS: 'readonly',
        WebSocket: 'readonly',
        XMLHttpRequest: 'readonly',
        BroadcastChannel: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        DOMParser: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        getComputedStyle: 'readonly',
        matchMedia: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        AbortController: 'readonly',
        CustomEvent: 'readonly',
        Node: 'readonly',
        NodeFilter: 'readonly',
        Element: 'readonly',
        HTMLElement: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        globalThis: 'readonly',
        // Vendor libraries loaded via <script> tags (src/static/vendor/)
        hljs: 'readonly',
        mermaid: 'readonly',
        tailwind: 'readonly',
        html2pdf: 'readonly',
        // mdv-live cross-file contract (src/static/lib/*.js globalThis.MDVXxx
        // transition compat; app.js reads these as bare globals rather than
        // named imports, and presenter.html's inline script reads them too)
        MDVApi: 'readonly',
        MDVSaveQueue: 'readonly',
        MDVPresenterChannel: 'readonly',
        MDVTabRegistry: 'readonly',
        MDVMarpZoom: 'readonly',
        // FOUC-prevention inline script in index.html
        __mdvTheme: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off', // NULバイト検出などの意図的な制御文字チェックがあるため
    },
  },
];
