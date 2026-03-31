/**
 * PDF Export API
 * Uses marp-cli for Marp presentations
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { validatePath } from '../utils/path.js';

const execFileAsync = promisify(execFile);
const marpBin = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'node_modules',
  '.bin',
  'marp'
);

/**
 * Setup PDF export routes
 * @param {Express} app - Express application
 * @returns {void}
 */
export function setupPdfRoutes(app) {
  const { rootDir } = app.locals;

  app.post('/api/pdf/export', async (req, res) => {
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    if (!validatePath(filePath, rootDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const fullPath = path.join(rootDir, filePath);

    try {
      await fs.access(fullPath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    const baseName = path.basename(fullPath, '.md');
    const outputPath = path.join(os.tmpdir(), `mdv-${Date.now()}-${baseName}.pdf`);
    const outputFileName = `${baseName}.pdf`;

    try {
      await execFileAsync(marpBin, [fullPath, '-o', outputPath, '--html', '--allow-local-files', '--no-stdin'], { timeout: 60000 });
      res.download(outputPath, outputFileName, async (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        try { await fs.unlink(outputPath); } catch { /* ignore cleanup errors */ }
      });
    } catch (err) {
      console.error('PDF export error:', err);
      try { await fs.unlink(outputPath); } catch { /* ignore */ }
      res.status(500).json({ error: 'PDF export failed' });
    }
  });
}

export default setupPdfRoutes;
