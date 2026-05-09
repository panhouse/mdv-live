import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { isMarp } from '../rendering/markdown.js';
import { validatePath, validatePathReal } from '../utils/path.js';
import { exportMarpPdf, exportMarkdownPdf } from '../services/pdf.js';

/**
 * Resolve an optional user-selected file path under the server root.
 *
 * @param {string | undefined} relativePath - Path supplied by the web UI.
 * @param {string} rootDir - Server root directory.
 * @returns {Promise<string | null>} Absolute path or null.
 */
async function resolveOptionalUserFile(relativePath, rootDir) {
  if (!relativePath) return null;
  if (!await validatePathReal(relativePath, rootDir)) {
    throw new Error(`Access denied: ${relativePath}`);
  }
  const fullPath = path.join(rootDir, relativePath);
  const stat = await fs.stat(fullPath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }
  return fullPath;
}

/**
 * Setup PDF export routes.
 *
 * - Marp files → `marp-cli` (slide PDF, landscape, themed)
 * - Plain Markdown → `md-to-pdf` (document PDF, optional CSS / PDF options)
 *
 * 実装は `src/services/pdf.js` に集約。CLI (`bin/mdv.js convert`) も同じ
 * service を使う。
 *
 * @param {Express} app - Express application
 * @returns {void}
 */
export function setupPdfRoutes(app) {
  const { rootDir } = app.locals;

  app.post('/api/pdf/export', async (req, res) => {
    const { filePath, stylePath, pdfOptionsPath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    if (!validatePath(filePath, rootDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // realpath check: symlink で root 外を指す source を拒否
    if (!await validatePathReal(filePath, rootDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const fullPath = path.join(rootDir, filePath);
    const baseName = path.basename(fullPath, '.md');
    const outputPath = path.join(os.tmpdir(), `mdv-${Date.now()}-${baseName}.pdf`);
    const outputFileName = `${baseName}.pdf`;

    try {
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        return res.status(404).json({ error: 'File not found' });
      }
      if (!stat.isFile()) {
        return res.status(404).json({ error: 'File not found' });
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      if (isMarp(content)) {
        await exportMarpPdf(fullPath, outputPath);
      } else {
        const [stylesheetPath, resolvedPdfOptionsPath] = await Promise.all([
          resolveOptionalUserFile(stylePath, rootDir),
          resolveOptionalUserFile(pdfOptionsPath, rootDir),
        ]);
        await exportMarkdownPdf(fullPath, outputPath, {
          stylesheetPath,
          pdfOptionsPath: resolvedPdfOptionsPath,
        });
      }

      res.download(outputPath, outputFileName, async (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        try { await fs.unlink(outputPath); } catch { /* ignore cleanup errors */ }
      });
    } catch (err) {
      console.error('PDF export error:', err);
      try { await fs.unlink(outputPath); } catch { /* ignore */ }
      if (err.code === 'PDF_TOOL_UNAVAILABLE') {
        return res.status(503).json({
          error: `PDF tool unavailable: ${err.message} Run \`npm install --include=optional\` and retry.`,
        });
      }
      res.status(500).json({ error: 'PDF export failed' });
    }
  });
}

export default setupPdfRoutes;
