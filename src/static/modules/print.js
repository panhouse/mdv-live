/**
 * MDV - Print Manager
 * Pure move from app.js (Stage 3e). No logic changes.
 */
import { state } from './state.js';
import { elements } from './dom.js';
import { PdfStyleManager } from './pdfStyle.js';
import { EditorManager } from './editor.js';
import { MDVApi } from '../lib/apiClient.js';

export const PrintManager = {
    isMarpPresentation() {
        return !!elements.content.querySelector('.marpit');
    },

    isHtmlPreview() {
        return !!elements.content.querySelector('.html-preview iframe');
    },

    async print() {
        if (state.activeTabIndex < 0) return;

        const tab = state.tabs[state.activeTabIndex];

        // editモード中は閉じてからPDF生成。autosave が失敗していた
        // ら toggle() が throw する → 印刷を中止して edit モード維持
        // (古い on-disk 内容で勝手に PDF 化しないように)。
        if (state.isEditMode) {
            try {
                await EditorManager.toggle();
            } catch (_e) {
                return;
            }
        }

        if (tab.isMarp || this.isMarpPresentation()) {
            await this.exportPdf(tab.path);
        } else if (this.isHtmlPreview()) {
            this.printHtmlPreview(tab.name);
        } else if (tab.fileType === 'markdown' && PdfStyleManager.shouldUseServerPdf()) {
            // PDF options JSON が指定されている時のみサーバー md-to-pdf。
            // CSS だけ / 何もなしの場合は printDialog で OS にページ制御
            // を委ね、preview の CSS injection が styled PDF を作る。
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

    printHtmlPreview(_fileName) {
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
            // サーバーが返したエラーメッセージを status に表示
            // (Claude Code 連携などで「何が悪いか分からない」を防ぐ)
            const detail = (error.message || 'unknown error').slice(0, 100);
            statusText.textContent = `PDF export failed: ${detail}`;
            setTimeout(() => {
                statusText.textContent = originalStatus;
            }, 4500);
        }
    },

    init() {
        elements.printBtn.addEventListener('click', () => this.print());
    }
};
