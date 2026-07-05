/**
 * MDV - DOM element cache
 * Pure move from app.js (Stage 3b). No logic changes.
 * Runs at module-eval time; fine since <script type="module"> is deferred.
 */

export const elements = {
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
